  const BASE = window.location.origin;

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function fmtDateTime(d) {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
      + ' ' + dt.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  }

  function parseUA(ua) {
    if (!ua) return 'Unknown';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Macintosh/.test(ua)) return 'macOS';
    if (/Linux/.test(ua)) return 'Linux';
    return ua.slice(0, 20);
  }

  // ── LOGOUT ────────────────────────────────────────────────────────────────
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/admin-api/logout', { method: 'POST' });
    window.location.href = '/admin-login.html';
  });

  // ── TABS ──────────────────────────────────────────────────────────────────
  const TABS = ['tokens', 'visitors', 'institutions'];
  function showTab(name) {
    TABS.forEach(n => {
      document.getElementById('panel-' + n).style.display = n === name ? 'block' : 'none';
      document.getElementById('tab-' + n + '-btn').classList.toggle('active', n === name);
    });
  }
  document.getElementById('tab-institutions-btn').addEventListener('click', () => {
    showTab('institutions');
    loadInstitutions();
  });
  document.getElementById('refresh-institutions-btn').addEventListener('click', loadInstitutions);

  document.getElementById('tab-tokens-btn').addEventListener('click', () => {
    showTab('tokens');
  });

  document.getElementById('tab-visitors-btn').addEventListener('click', () => {
    showTab('visitors');
    loadVisitors();
  });

  document.getElementById('refresh-tokens-btn').addEventListener('click', async () => {
    document.getElementById('refresh-tokens-btn').textContent = 'Refreshing...';
    await loadTokens();
    document.getElementById('refresh-tokens-btn').textContent = 'Refresh';
    toast('Token list refreshed.');
  });
  document.getElementById('refresh-visitors-btn').addEventListener('click', loadVisitors);

  // Onboarding is only offered on the Innovation Lens root tenant
  fetch('/admin-api/tenant').then(r => r.json()).then(d => {
    if (d.can_onboard) {
      document.getElementById('onboard-link').style.display = '';
      document.getElementById('tab-institutions-btn').style.display = '';
    }
  }).catch(() => {});

  // ── LOAD STATS ────────────────────────────────────────────────────────────
  async function loadStats() {
    try {
      const res  = await fetch('/admin-api/stats');
      const data = await res.json();
      document.getElementById('s-visitors').textContent = data.total_visitors || 0;
      document.getElementById('s-tokens').textContent   = data.active_tokens || 0;
      document.getElementById('s-scans').textContent    = data.total_scans || 0;
    } catch (e) {}
  }

  // ── LOAD TOKENS ───────────────────────────────────────────────────────────
  async function loadTokens() {
    const body = document.getElementById('tokens-body');
    try {
      const res  = await fetch('/admin-api/tokens');
      const data = await res.json();
      const tokens = data.tokens || [];

      if (!tokens.length) {
        body.innerHTML = '<tr><td colspan="7" class="empty">No tokens yet. Create one above.</td></tr>';
        return;
      }

      body.innerHTML = tokens.map(t => {
        const link     = BASE + '/demo/access?token=' + t.token;
        const isExpired = t.expires_at && new Date(t.expires_at) < new Date();
        const statusClass = !t.is_active ? 'inactive' : isExpired ? 'expired' : 'active';
        const statusLabel = !t.is_active ? 'Revoked' : isExpired ? 'Expired' : 'Active';
        const usePct = t.max_uses > 0 ? Math.min(100, (t.use_count / t.max_uses) * 100) : 0;
        const usesText = t.max_uses > 0
          ? t.use_count + ' / ' + t.max_uses
          : t.use_count + ' uses';

        return '<tr>'
          + '<td>'
          +   '<strong style="color:#fff">' + esc(t.label || t.name || 'Unnamed') + '</strong>'
          +   (t.name ? '<div style="font-size:11px;color:#8AADCC;margin-top:2px">' + esc(t.name) + '</div>' : '')
          +   (t.company ? '<div style="font-size:11px;color:#8AADCC">' + esc(t.company) + '</div>' : '')
          + '</td>'
          + '<td>'
          +   '<div class="link-pill" title="' + esc(link) + '" data-copy="' + esc(link) + '">' + esc(link) + '</div>'
          + '</td>'
          + '<td><span class="status-badge ' + statusClass + '">' + statusLabel + '</span></td>'
          + '<td>'
          +   '<div style="font-size:12px;color:#ccc">' + usesText + '</div>'
          +   (t.max_uses > 0 ? '<div class="uses-bar"><div class="uses-fill" style="width:' + usePct + '%"></div></div>' : '')
          + '</td>'
          + '<td style="font-size:12px;color:#8AADCC">' + (t.expires_at ? fmtDateTime(t.expires_at) : 'Never') + '</td>'
          + '<td style="font-size:12px;color:#8AADCC">' + (t.last_used_at ? fmtDateTime(t.last_used_at) : '—') + '</td>'
          + '<td style="white-space:nowrap">'
          +   '<button class="action-btn copy" style="margin-right:4px" data-copy="' + esc(link) + '">Copy</button>'
          +   (t.is_active && !isExpired
                ? '<button class="action-btn revoke" data-revoke="' + esc(t.id) + '">Revoke</button>'
                : '<button class="action-btn activate" data-activate="' + esc(t.id) + '">Activate</button>')
          + '</td>'
          + '</tr>';
      }).join('');

    } catch (e) {
      body.innerHTML = '<tr><td colspan="7" class="empty">Failed to load tokens.</td></tr>';
    }
  }

  // ── LOAD VISITORS ─────────────────────────────────────────────────────────
  async function loadVisitors() {
    const body = document.getElementById('visitors-body');
    body.innerHTML = '<tr><td colspan="7" class="empty">Loading...</td></tr>';
    try {
      const res  = await fetch('/admin-api/visitors');
      const data = await res.json();
      const visitors = data.visitors || [];

      // Today count
      const today = visitors.filter(v =>
        new Date(v.first_seen_at).toDateString() === new Date().toDateString()
      ).length;
      document.getElementById('s-today').textContent = today;

      if (!visitors.length) {
        body.innerHTML = '<tr><td colspan="7" class="empty">No visitors yet.</td></tr>';
        return;
      }

      body.innerHTML = visitors.map(v => {
        return '<tr>'
          + '<td><strong style="color:#fff">' + esc(v.full_name || '—') + '</strong></td>'
          + '<td style="font-size:12px">' + esc(v.email || '—') + '</td>'
          + '<td>' + esc(v.company || '—') + '</td>'
          + '<td style="font-size:12px;color:#8AADCC">' + esc(v.role || '—') + '</td>'
          + '<td><span style="font-family:monospace;font-size:11px;color:#8AADCC">' + esc(String(v.ip_address || '—')) + '</span></td>'
          + '<td style="font-size:12px;color:#8AADCC">' + esc(parseUA(v.user_agent)) + '</td>'
          + '<td style="font-size:12px;color:#8AADCC;white-space:nowrap">' + fmtDateTime(v.first_seen_at) + '</td>'
          + '</tr>';
      }).join('');

    } catch (e) {
      body.innerHTML = '<tr><td colspan="7" class="empty">Failed to load visitors.</td></tr>';
    }
  }

  // ── CREATE TOKEN ──────────────────────────────────────────────────────────
  document.getElementById('create-btn').addEventListener('click', async () => {
    const btn     = document.getElementById('create-btn');
    const errEl   = document.getElementById('create-err');
    const label   = document.getElementById('f-label').value.trim();
    const name    = document.getElementById('f-name').value.trim();
    const email   = document.getElementById('f-email').value.trim();
    const company = document.getElementById('f-company').value.trim();
    const role    = document.getElementById('f-role').value.trim();
    const expires = document.getElementById('f-expires').value;
    const maxuses = document.getElementById('f-maxuses').value;
    const notes   = document.getElementById('f-notes').value.trim();

    errEl.classList.remove('show');

    if (!label && !name) {
      errEl.textContent = 'Please enter at least a label or prospect name.';
      errEl.classList.add('show');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Generating...';

    try {
      const res  = await fetch('/admin-api/tokens', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ label, name, email, company, role, expires_days: expires, max_uses: maxuses, notes })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed.');

      const link = BASE + '/demo/access?token=' + data.token.token;
      document.getElementById('generated-link').textContent = link;
      document.getElementById('generated-wrap').style.display = 'block';

      // Clear form
      ['f-label','f-name','f-email','f-company','f-role','f-notes'].forEach(id => {
        document.getElementById(id).value = '';
      });

      loadTokens();
      loadStats();
      toast('Token created successfully.');

    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate Token & Link';
    }
  });

  document.getElementById('copy-link-btn').addEventListener('click', () => {
    const link = document.getElementById('generated-link').textContent;
    copyToClipboard(link);
  });

  // ── TOKEN ACTIONS ─────────────────────────────────────────────────────────
  async function revokeToken(id) {
    if (!confirm('Revoke this token? The prospect will no longer be able to access the demo with this link.')) return;
    const res = await fetch('/admin-api/tokens/' + id + '/revoke', { method: 'PATCH' });
    if (!res.ok) { toast('Failed to revoke token.'); return; }
    await loadTokens();
    await loadStats();
    toast('Token revoked.');
  }

  let _activateId   = null;
  let _selectedDays = 30;

  function activateToken(id) {
    _activateId   = id;
    _selectedDays = 30;
    // Reset selections
    document.querySelectorAll('.dur-btn').forEach(b => b.classList.remove('selected'));
    document.querySelector('.dur-btn[data-days="30"]').classList.add('selected');
    document.getElementById('custom-days').classList.remove('show');
    document.getElementById('custom-days').value = '';
    document.getElementById('activate-modal').classList.add('show');
  }

  // Duration button selection
  document.querySelectorAll('.dur-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dur-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      const val = btn.dataset.days;
      if (val === 'custom') {
        document.getElementById('custom-days').classList.add('show');
        document.getElementById('custom-days').focus();
        _selectedDays = null;
      } else {
        document.getElementById('custom-days').classList.remove('show');
        _selectedDays = parseInt(val);
      }
    });
  });

  document.getElementById('activate-cancel').addEventListener('click', () => {
    document.getElementById('activate-modal').classList.remove('show');
  });

  document.getElementById('activate-confirm').addEventListener('click', async () => {
    let days = _selectedDays;
    if (days === null) {
      days = parseInt(document.getElementById('custom-days').value);
      if (!days || days < 1) { toast('Please enter a valid number of days.'); return; }
    }
    document.getElementById('activate-modal').classList.remove('show');

    const res = await fetch('/admin-api/tokens/' + _activateId + '/activate', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extend_days: days })
    });
    if (!res.ok) { toast('Failed to activate token.'); return; }
    await loadTokens();
    await loadStats();
    const label = days === 0 ? 'no expiry' : days + ' days';
    toast('Token activated — valid for ' + label + '.');
  });

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard.')).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('Copied.');
    });
  }

  // ── INSTITUTIONS (IL root admin only) ──────────────────────────────────
  let ROOT_SUBDOMAIN = 'demo';
  function fmtDate(d) {
    return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  }
  async function loadInstitutions() {
    const body = document.getElementById('institutions-body');
    try {
      const res  = await fetch('/admin-api/tenants');
      const data = await res.json();
      if (!res.ok) { body.innerHTML = '<tr><td colspan="9" class="empty">' + esc(data.error || 'Failed to load.') + '</td></tr>'; return; }
      ROOT_SUBDOMAIN = data.root_subdomain || ROOT_SUBDOMAIN;
      const list = data.tenants || [];
      if (!list.length) { body.innerHTML = '<tr><td colspan="9" class="empty">No institutions yet.</td></tr>'; return; }
      body.innerHTML = list.map(t => {
        const isRoot = t.subdomain === ROOT_SUBDOMAIN;
        const status = isRoot ? '<span class="status-badge expired">ROOT</span>'
          : t.active ? '<span class="status-badge active">Active</span>'
          : '<span class="status-badge inactive">Suspended</span>';
        let presenter = '<span style="color:#8AADCC;font-size:12px">n/a</span>';
        if (!isRoot) {
          presenter = t.presenter_link
            ? '<div class="link-pill" title="' + esc(t.presenter_link) + '" data-copy="' + esc(t.presenter_link) + '">' + esc(t.presenter_link) + '</div>'
              + '<div style="font-size:11px;color:#8AADCC;margin-top:3px">Expires ' + esc(fmtDate(t.presenter_expires_at)) + '</div>'
            : '<button class="action-btn copy" data-newlink="' + esc(t.id) + '">Create link</button>';
        }
        const actions = isRoot ? '' : t.active
          ? '<button class="action-btn revoke" data-toggle="' + esc(t.id) + '" data-active="false" data-name="' + esc(t.name) + '">Suspend</button>'
          : '<button class="action-btn activate" data-toggle="' + esc(t.id) + '" data-active="true" data-name="' + esc(t.name) + '">Restore</button>';
        const ownerBtn = '<button class="action-btn copy" style="margin-right:4px" data-owner="' + esc(t.id) + '" data-name="' + esc(t.name) + '">Invite owner</button>';
        const copyBtn = (!isRoot && t.presenter_link)
          ? '<button class="action-btn copy" style="margin-right:4px" data-copy="' + esc(t.presenter_link) + '">Copy</button>' : '';
        return '<tr>'
          + '<td><strong style="color:#fff">' + esc(t.name) + '</strong>'
          +   (t.contact_email ? '<div style="font-size:11px;color:#8AADCC;margin-top:2px">' + esc(t.contact_email) + '</div>' : '') + '</td>'
          + '<td><a href="' + esc(t.url) + '" target="_blank" rel="noopener" style="color:#8AADCC">' + esc(t.subdomain) + '</a></td>'
          + '<td>' + esc(t.short_code) + '</td>'
          + '<td style="font-size:12px">' + esc(t.institution_type) + '</td>'
          + '<td>' + esc(String(t.documents || 0)) + '</td>'
          + '<td>' + status + '</td>'
          + '<td style="font-size:12px;color:#8AADCC">' + esc(fmtDate(t.created_at)) + '</td>'
          + '<td style="max-width:220px">' + presenter + '</td>'
          + '<td style="white-space:nowrap">' + ownerBtn + copyBtn + actions + '</td>'
          + '</tr>';
      }).join('');
    } catch (e) {
      body.innerHTML = '<tr><td colspan="9" class="empty">Failed to load.</td></tr>';
    }
  }

  document.getElementById('tokens-body').addEventListener('click', e => {
    const el = e.target.closest('[data-copy],[data-revoke],[data-activate]');
    if (!el) return;
    if (el.dataset.copy) copyToClipboard(el.dataset.copy);
    else if (el.dataset.revoke) revokeToken(el.dataset.revoke);
    else if (el.dataset.activate) activateToken(el.dataset.activate);
  });

  document.getElementById('institutions-body').addEventListener('click', async e => {
    const el = e.target.closest('[data-copy],[data-toggle],[data-newlink],[data-owner]');
    if (!el) return;
    if (el.dataset.copy) { copyToClipboard(el.dataset.copy); return; }
    if (el.dataset.owner) {
      // First Owner for the institution's staff app; they invite the rest
      const email = (prompt('Owner email for ' + el.dataset.name + ' (e.g. the Registrar):') || '').trim();
      if (!email) return;
      const fullName = (prompt('Owner full name:') || '').trim();
      el.disabled = true;
      const res = await fetch('/admin-api/tenants/' + el.dataset.owner + '/owner-invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, full_name: fullName })
      });
      const d = await res.json().catch(() => ({}));
      el.disabled = false;
      if (!res.ok) { toast(d.error || 'Failed to invite owner.'); return; }
      copyToClipboard(d.link);
      prompt((d.emailed ? 'Invite emailed to ' : 'Email not sent. Send this setup link to ') + d.email + ' (valid 72 hours, copied):', d.link);
      return;
    }
    if (el.dataset.newlink) {
      el.disabled = true;
      const res = await fetch('/admin-api/tenants/' + el.dataset.newlink + '/presenter-link', { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { el.disabled = false; toast(d.error || 'Failed to create link.'); return; }
      copyToClipboard(d.presenter_link);
      loadInstitutions();
      return;
    }
    const active = el.dataset.active === 'true';
    if (!active && !confirm('Suspend ' + el.dataset.name + '? Its subdomain will stop resolving until restored.')) return;
    el.disabled = true;
    const res = await fetch('/admin-api/tenants/' + el.dataset.toggle + '/active', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { el.disabled = false; toast(d.error || 'Failed to update institution.'); return; }
    toast(active ? 'Institution restored.' : 'Institution suspended.');
    loadInstitutions();
  });

  // ── INIT ──────────────────────────────────────────────────────────────────
  loadStats();
  loadTokens();
