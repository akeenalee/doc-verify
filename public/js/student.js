const BASE = window.location.origin;
let selectedBundle = null;

const params = new URLSearchParams(window.location.search);
if (params.get('success') === 'tokens_added') {
  showGlobalSuccess(`${params.get('tokens')} verification token(s) added to your account.`);
}
if (params.get('error')) {
  const msgs = {
    payment_failed:      'Payment was not completed.',
    verification_failed: 'An error occurred. Please try again.',
  };
  showGlobalError(msgs[params.get('error')] || 'An error occurred.');
}

(async () => {
  try {
    const res = await fetch(`${BASE}/api/tokens/me`);
    if (res.ok) { const { student } = await res.json(); showPortal(student); }
  } catch (e) {}
})();

(async () => {
  try {
    const r = await fetch(`${BASE}/api/tokens/config`);
    const c = await r.json();
    if (c.claim_required === false) document.getElementById('reg-claim-wrap').style.display = 'none';
  } catch (e) {}
})();

document.getElementById('claim-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('claim-err');
  const btn   = document.getElementById('claim-btn');
  errEl.classList.remove('show');
  btn.disabled = true;
  try {
    const res = await fetch(`${BASE}/api/tokens/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim_code: document.getElementById('claim-code').value.trim() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showGlobalSuccess('Matric number confirmed. Your documents are now available.');
    showPortal({ ...data.student, claim_required: true });
  } catch (e) {
    errEl.textContent = e.message; errEl.classList.add('show');
  } finally { btn.disabled = false; }
});

document.getElementById('show-register').addEventListener('click', () => {
  document.getElementById('login-card').style.display    = 'none';
  document.getElementById('register-card').style.display = 'block';
});
document.getElementById('show-login').addEventListener('click', () => {
  document.getElementById('register-card').style.display = 'none';
  document.getElementById('login-card').style.display    = 'block';
});

document.getElementById('login-btn').addEventListener('click', async () => {
  const matric      = document.getElementById('login-matric').value.trim();
  const institution = document.getElementById('login-institution').value.trim();
  const pin         = document.getElementById('login-pin').value.trim();
  const errEl       = document.getElementById('login-err');
  const btn         = document.getElementById('login-btn');
  errEl.classList.remove('show');
  if (!matric || !institution || !pin) {
    errEl.textContent = 'All fields are required.'; errEl.classList.add('show'); return;
  }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Logging in...';
  try {
    const res  = await fetch(`${BASE}/api/tokens/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matric_number: matric, institution, pin }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showPortal(data.student);
  } catch (e) {
    errEl.textContent = e.message; errEl.classList.add('show');
  } finally { btn.disabled = false; btn.textContent = 'Log in'; }
});

document.getElementById('register-btn').addEventListener('click', async () => {
  const full_name   = document.getElementById('reg-name').value.trim();
  const matric      = document.getElementById('reg-matric').value.trim();
  const institution = document.getElementById('reg-institution').value.trim();
  const email       = document.getElementById('reg-email').value.trim();
  const phone       = document.getElementById('reg-phone').value.trim();
  const pin         = document.getElementById('reg-pin').value.trim();
  const errEl       = document.getElementById('reg-err');
  const btn         = document.getElementById('register-btn');
  errEl.classList.remove('show');
  if (!matric || !institution || !pin) {
    errEl.textContent = 'Matric number, institution, and PIN are required.';
    errEl.classList.add('show'); return;
  }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Creating account...';
  try {
    const claim_code = document.getElementById('reg-claim').value.trim();
    const res  = await fetch(`${BASE}/api/tokens/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matric_number: matric, institution, full_name, email, phone, pin, claim_code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showPortal(data.student);
  } catch (e) {
    errEl.textContent = e.message; errEl.classList.add('show');
  } finally { btn.disabled = false; btn.textContent = 'Create account'; }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch(`${BASE}/api/tokens/logout`, { method: 'POST' });
  location.reload();
});

async function showPortal(student) {
  document.getElementById('auth-section').style.display   = 'none';
  document.getElementById('portal-section').style.display = 'block';
  document.getElementById('portal-name').textContent      = student.full_name || student.matric_number;
  document.getElementById('portal-matric').textContent    = `${student.matric_number} · ${student.institution}`;
  document.getElementById('token-balance').textContent    = student.token_balance;
  if (student.email) {
    document.getElementById('buy-email').value      = student.email;
    document.getElementById('settings-email').value = student.email;
  }
  if (student.phone) document.getElementById('settings-phone').value = student.phone;
  document.getElementById('notify-email').checked = student.notify_email || false;
  document.getElementById('notify-sms').checked   = student.notify_sms   || false;
  loadBundles();
  const locked = student.claim_required && !student.verified;
  document.getElementById('claim-card').style.display = locked ? 'block' : 'none';
  document.querySelectorAll('[data-tab="log"],[data-tab="docs"]').forEach(t => t.style.display = locked ? 'none' : '');
  if (locked) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('[data-tab="buy"]').classList.add('active');
    document.getElementById('tab-buy').classList.add('active');
  } else {
    loadLog();
  }
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'docs') loadMyDocs();
  });
});

document.getElementById('buy-tab-btn').addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('[data-tab="buy"]').classList.add('active');
  document.getElementById('tab-buy').classList.add('active');
});
async function loadMyDocs() {
  const list = document.getElementById('my-docs-list');
  list.innerHTML = '<p style="font-size:13px;color:#aaa;text-align:center;padding:20px">Loading your documents...</p>';
  try {
    // Use the dedicated my-documents endpoint which matches by metadata->matric_number
    const res  = await fetch(`${BASE}/api/tokens/my-documents`);
    if (!res.ok) throw new Error('Failed to fetch documents.');
    const data = await res.json();
    const docs = data.documents || [];

    if (!docs.length) {
      list.innerHTML = '<p style="font-size:13px;color:#aaa;text-align:center;padding:20px">No documents found under your matric number (<strong>' + esc(data.matric_number || '') + '</strong>).<br/>Ask your Registrar to generate your document using your matric number.</p>';
      return;
    }

    list.innerHTML = docs.map(doc => {
      const isExpired = doc.expiry_date && new Date(doc.expiry_date) < new Date();
      const statusColor = doc.status === 'active' && !isExpired ? '#0f6e56' : '#A32D2D';
      const statusLabel = doc.status === 'revoked' ? 'Revoked' : isExpired ? 'Expired' : 'Active';
      return `
      <div style="border:1px solid #eee;border-radius:10px;padding:16px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div style="font-size:14px;font-weight:600;color:#1a3a5c">${esc(doc.title)}</div>
          <span style="font-size:11px;font-weight:600;color:${statusColor};background:${doc.status === 'active' && !isExpired ? '#e1f5ee' : '#fcebeb'};padding:2px 8px;border-radius:10px;white-space:nowrap;margin-left:8px">${statusLabel}</span>
        </div>
        <div style="font-size:12px;color:#888;margin-bottom:2px">Document type: <strong style="color:#444">${esc(doc.doc_type || 'N/A')}</strong></div>
        <div style="font-size:12px;color:#888;margin-bottom:2px">Issued by: ${esc(doc.issued_by)}</div>
        <div style="font-size:12px;color:#888;margin-bottom:8px">Issue date: ${fmtDate(doc.issue_date)}</div>
        <div style="font-size:11px;font-family:monospace;color:#999;margin-bottom:12px">${esc(doc.doc_id)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a href="${esc(doc.verify_url || `${BASE}/verify?doc=${encodeURIComponent(doc.doc_id)}`)}" target="_blank"
             style="font-size:12px;color:#1a3a5c;font-weight:500;text-decoration:none;border:1px solid #1a3a5c;padding:6px 14px;border-radius:6px">
            View Verify Page
          </a>
          <a href="${BASE}/api/tokens/replacement-pdf/${encodeURIComponent(doc.doc_id)}" target="_blank"
             style="font-size:12px;color:#fff;font-weight:500;text-decoration:none;background:#1a3a5c;padding:6px 14px;border-radius:6px">
            Download Official PDF
          </a>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = '<p style="font-size:13px;color:#c0392b;text-align:center;padding:20px">Failed to load documents. Please try again.</p>';
  }
}
async function loadBundles() {
  try {
    const res  = await fetch(`${BASE}/api/tokens/bundles`);
    const data = await res.json();
    const grid = document.getElementById('bundle-grid');
    const saves = ['', 'Save N500', 'Save N1,000', 'Save N3,000'];
    grid.innerHTML = data.bundles.map(b => `
      <div class="bundle" data-id="${b.id}">
        <div class="tokens">${b.tokens}</div>
        <div style="font-size:11px;color:#888;margin-top:2px">${b.tokens === 1 ? 'verification' : 'verifications'}</div>
        <div class="price">N${(b.amountKobo / 100).toLocaleString()}</div>
        ${saves[b.id - 1] ? `<div class="save">${saves[b.id - 1]}</div>` : ''}
      </div>
    `).join('');
    grid.querySelectorAll('.bundle').forEach(el => {
      el.addEventListener('click', () => {
        grid.querySelectorAll('.bundle').forEach(b => b.classList.remove('selected'));
        el.classList.add('selected');
        selectedBundle = parseInt(el.dataset.id);
      });
    });
  } catch (e) {}
}

document.getElementById('buy-btn').addEventListener('click', async () => {
  const email = document.getElementById('buy-email').value.trim();
  const errEl = document.getElementById('buy-err');
  const btn   = document.getElementById('buy-btn');
  errEl.classList.remove('show');
  if (!selectedBundle) {
    errEl.textContent = 'Please select a bundle.'; errEl.classList.add('show'); return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEl.textContent = 'Please enter a valid email for your receipt.'; errEl.classList.add('show'); return;
  }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Initiating payment...';
  try {
    const res  = await fetch(`${BASE}/api/tokens/buy`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundle_id: selectedBundle }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    window.location.href = data.payment_url;
  } catch (e) {
    errEl.textContent = e.message; errEl.classList.add('show');
    btn.disabled = false; btn.textContent = 'Proceed to payment';
  }
});

async function loadLog() {
  const body = document.getElementById('log-body');
  try {
    const res  = await fetch(`${BASE}/api/tokens/log`);
    const data = await res.json();
    const logs = data.logs || [];
    if (!logs.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty">No verifications yet.</td></tr>';
      return;
    }
    body.innerHTML = logs.map(l => {
      const payBadge = l.payment_method === 'student_token'
        ? '<span class="badge token">Token</span>'
        : l.payment_method === 'employer_payment'
        ? '<span class="badge paid">Employer paid</span>'
        : '<span class="badge verified">Free</span>';
      return `<tr>
        <td><strong>${esc(l.title || l.doc_id)}</strong><div class="muted">${esc(l.doc_type || '')}</div></td>
        <td><span class="badge verified">Verified</span></td>
        <td>${payBadge}</td>
        <td class="muted">${esc(l.location || 'Unknown')}</td>
        <td style="font-size:12px;white-space:nowrap">${fmtDateTime(l.verified_at)}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    body.innerHTML = '<tr><td colspan="5" class="empty">Failed to load log.</td></tr>';
  }
}

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const btn   = document.getElementById('save-settings-btn');
  const errEl = document.getElementById('settings-err');
  errEl.classList.remove('show');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Saving...';
  try {
    const res = await fetch(`${BASE}/api/tokens/notifications`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notify_email: document.getElementById('notify-email').checked,
        notify_sms:   document.getElementById('notify-sms').checked,
        email:        document.getElementById('settings-email').value.trim() || null,
        phone:        document.getElementById('settings-phone').value.trim() || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showGlobalSuccess('Preferences saved.');
  } catch (e) {
    errEl.textContent = e.message; errEl.classList.add('show');
  } finally { btn.disabled = false; btn.textContent = 'Save preferences'; }
});

function fmtDate(d) {
  if (!d) return 'N/A';
  return new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

function fmtDateTime(d) {
  if (!d) return 'N/A';
  return new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
    + ' ' + new Date(d).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

function showGlobalSuccess(msg) {
  const el = document.getElementById('global-success');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 5000);
}

function showGlobalError(msg) {
  const el = document.getElementById('global-error');
  el.textContent = msg; el.classList.add('show');
}
