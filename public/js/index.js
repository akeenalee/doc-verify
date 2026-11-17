  const BASE = window.location.origin;
  const locCache = {};

  // ── DEMO STATUS ────────────────────────────────────────────────────────────
  fetch('/demo/status').then(r => r.json()).then(d => {
    if (d.name && d.name !== 'Guest') {
      document.getElementById('demo-greeting').textContent = 'Welcome, ' + d.name;
    }
  }).catch(() => {});

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/demo/logout', { method: 'POST' });
    window.location.href = '/demo-login.html';
  });

  // ── TAB SWITCHING (log vs visitors) ───────────────────────────────────────
  document.getElementById('tab-logs-btn').addEventListener('click', () => {
    document.getElementById('panel-logs').style.display = 'block';
    document.getElementById('panel-visitors').style.display = 'none';
    document.getElementById('tab-logs-btn').classList.add('active');
    document.getElementById('tab-visitors-btn').classList.remove('active');
  });

  document.getElementById('tab-visitors-btn').addEventListener('click', () => {
    document.getElementById('panel-logs').style.display = 'none';
    document.getElementById('panel-visitors').style.display = 'block';
    document.getElementById('tab-logs-btn').classList.remove('active');
    document.getElementById('tab-visitors-btn').classList.add('active');
    loadVisitors();
  });

  document.getElementById('refresh-btn').addEventListener('click', () => {
    const logsVisible = document.getElementById('panel-logs').style.display !== 'none';
    if (logsVisible) loadLogs();
    else loadVisitors();
  });

  // ── VERIFY TAB SWITCHING ──────────────────────────────────────────────────
  document.querySelectorAll('.vtab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.vtab').forEach(t => {
        t.style.color = '#888';
        t.style.borderBottomColor = 'transparent';
      });
      document.querySelectorAll('.vtab-content').forEach(c => c.style.display = 'none');
      tab.style.color = '#1a3a5c';
      tab.style.borderBottomColor = '#1a3a5c';
      document.getElementById('vtab-' + tab.dataset.vtab).style.display = 'block';
    });
  });

  // ── HELPERS ───────────────────────────────────────────────────────────────
  // ip-api.com blocks cloud server IPs on free tier.
  // We resolve location server-side via /verify/api/logs which now includes
  // geo data. Frontend falls back to showing the raw IP only.
  async function getLocation(ip) {
    if (!ip || ip === '127.0.0.1' || ip.startsWith('::') || ip === 'N/A') return 'Local';
    if (locCache[ip]) return locCache[ip];
    // Return IP directly — geolocation resolved server-side at log time
    locCache[ip] = ip;
    return ip;
  }

  function parseUA(ua) {
    if (!ua) return 'Unknown';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Macintosh/.test(ua)) return 'macOS';
    if (/Linux/.test(ua)) return 'Linux';
    return ua.slice(0, 25);
  }

  function fmtDate(d) {
    if (!d) return 'N/A';
    return new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  }

  function fmtDateTime(d) {
    if (!d) return 'N/A';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
      + '<br><span style="color:#aaa;font-size:11px">'
      + dt.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
      + '</span>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ── LOAD VERIFICATION LOGS ────────────────────────────────────────────────
  async function loadLogs() {
    const body = document.getElementById('log-body');
    try {
      const [logsRes, docsRes] = await Promise.all([
        fetch(BASE + '/verify/api/logs'),
        fetch(BASE + '/api/documents?limit=1')
      ]);
      const logsData = await logsRes.json();
      const docsData = await docsRes.json();
      const logs  = logsData.logs || [];
      const total = logsData.total || 0;
      const today = logs.filter(l =>
        new Date(l.verified_at).toDateString() === new Date().toDateString()
      ).length;

      document.getElementById('stat-total').textContent = total;
      document.getElementById('stat-today').textContent = today;
      document.getElementById('stat-docs').textContent = docsData.pagination?.total ?? '-';

      if (!logs.length) {
        body.innerHTML = '<tr><td colspan="7" class="empty">No verifications yet.</td></tr>';
        return;
      }

      body.innerHTML = logs.map((l, i) => {
        const bc = l.result === 'found' ? 'verified' : l.result === 'revoked' ? 'revoked' : 'not_found';
        const bl = l.result === 'found' ? 'Verified' : l.result === 'revoked' ? 'Revoked' : 'Not found';
        const docInfo = l.title
          ? '<strong>' + esc(l.title) + '</strong><div class="muted">' + esc(l.doc_id) + '</div><div class="muted">' + esc(l.issued_to || '') + '</div>'
          : '<span class="ip">' + esc(l.doc_id) + '</span>';
        return '<tr>'
          + '<td style="color:#aaa;font-size:12px">' + (total - i) + '</td>'
          + '<td>' + docInfo + '</td>'
          + '<td><span class="badge ' + bc + '">' + bl + '</span></td>'
          + '<td><span class="ip">' + esc(l.ip_address || 'N/A') + '</span></td>'
          + '<td class="muted" id="loc-' + l.id + '">...</td>'
          + '<td><div class="ua" title="' + esc(l.user_agent) + '">' + esc(parseUA(l.user_agent)) + '</div></td>'
          + '<td style="font-size:12px;white-space:nowrap">' + fmtDateTime(l.verified_at) + '</td>'
          + '</tr>';
      }).join('');

      // Geo location now resolved server-side — no ip-api.com calls needed
      logs.forEach(l => {
        const el = document.getElementById('loc-' + l.id);
        if (el) el.textContent = l.geo_location || l.ip_address || 'Unknown';
      });

    } catch (e) {
      body.innerHTML = '<tr><td colspan="7" class="empty">Failed to load logs.</td></tr>';
    }
  }

  // ── LOAD DEMO VISITORS ────────────────────────────────────────────────────
  async function loadVisitors() {
    const body = document.getElementById('visitors-body');
    body.innerHTML = '<tr><td colspan="7" class="empty">Loading...</td></tr>';
    try {
      const res  = await fetch('/demo/visitors');
      const data = await res.json();
      const visitors = data.visitors || [];

      // Update stat
      document.getElementById('stat-visitors').textContent = visitors.length;
      const badge = document.getElementById('visitor-count');
      if (visitors.length > 0) {
        badge.textContent = visitors.length;
        badge.style.display = 'inline-block';
      }

      if (!visitors.length) {
        body.innerHTML = '<tr><td colspan="7" class="empty">No demo visitors yet.</td></tr>';
        return;
      }

      body.innerHTML = visitors.map(v => {
        const device = parseUA(v.user_agent);
        return '<tr>'
          + '<td><strong style="color:#1a3a5c">' + esc(v.full_name || '—') + '</strong></td>'
          + '<td style="font-size:12px">' + esc(v.email || '—') + '</td>'
          + '<td>' + esc(v.company || '—') + '</td>'
          + '<td style="font-size:12px;color:#888">' + esc(v.role || '—') + '</td>'
          + '<td><span class="ip">' + esc(String(v.ip_address || '—')) + '</span></td>'
          + '<td><div class="ua">' + esc(device) + '</div></td>'
          + '<td style="font-size:12px;white-space:nowrap">' + fmtDateTime(v.first_seen_at) + '</td>'
          + '</tr>';
      }).join('');

    } catch (e) {
      body.innerHTML = '<tr><td colspan="7" class="empty">Failed to load visitors.</td></tr>';
    }
  }

  // ── INSTITUTION TYPE TAB SWITCHING ────────────────────────────────────────
  let activeGenTab = 'academic';

  document.getElementById('tab-academic').addEventListener('click', () => switchGenTab('academic'));
  document.getElementById('tab-other').addEventListener('click', () => switchGenTab('other'));

  function switchGenTab(tab) {
    activeGenTab = tab;
    document.getElementById('gen-academic').style.display = tab === 'academic' ? 'block' : 'none';
    document.getElementById('gen-other').style.display    = tab === 'other'    ? 'block' : 'none';

    // Update tab styles without touching display — display is controlled by applyTenantConfig
    const tabAc = document.getElementById('tab-academic');
    const tabOt = document.getElementById('tab-other');
    if (tabAc) {
      tabAc.style.color        = tab === 'academic' ? '#1a3a5c' : '#aaa';
      tabAc.style.borderBottom = tab === 'academic' ? '2px solid #1a3a5c' : '2px solid transparent';
    }
    if (tabOt) {
      tabOt.style.color        = tab === 'other' ? '#1a3a5c' : '#aaa';
      tabOt.style.borderBottom = tab === 'other' ? '2px solid #1a3a5c' : '2px solid transparent';
    }

    document.getElementById('g-result').classList.remove('show');
    document.getElementById('g-error').classList.remove('show');
  }

  // ── GENERATE DOC ──────────────────────────────────────────────────────────
  async function generateDoc() {
    const errEl    = document.getElementById('g-error');
    const btn      = document.getElementById('g-btn');
    const resultEl = document.getElementById('g-result');
    errEl.classList.remove('show');
    resultEl.classList.remove('show');

    let title, issuedTo, issuedBy, matric, docType, expiry, prefix, metadata;

    if (activeGenTab === 'academic') {
      title    = document.getElementById('g-title').value.trim();
      issuedTo = document.getElementById('g-issuedTo').value.trim();
      issuedBy = document.getElementById('g-issuedBy').value.trim();
      matric   = document.getElementById('g-matric').value.trim().toUpperCase();
      docType  = document.getElementById('g-docType').value;
      expiry   = document.getElementById('g-expiry').value;
      prefix   = document.getElementById('g-prefix').value.trim().toUpperCase() || 'DOC';
      metadata = { matric_number: matric, institution_type: 'academic' };
    } else {
      title    = document.getElementById('g-title-other').value.trim();
      issuedTo = document.getElementById('g-issuedTo-other').value.trim();
      issuedBy = document.getElementById('g-issuedBy-other').value.trim();
      matric   = document.getElementById('g-ref-other').value.trim().toUpperCase();
      docType  = document.getElementById('g-docType-other').value;
      expiry   = document.getElementById('g-expiry-other').value;
      prefix   = document.getElementById('g-prefix-other').value.trim().toUpperCase() || 'DOC';
      metadata = { matric_number: matric, institution_type: 'government' };
    }

    if (!title || !issuedTo || !issuedBy || !matric) {
      errEl.textContent = activeGenTab === 'academic'
        ? 'Title, Issued To, Institution, and Matric Number are all required.'
        : 'Title, Issued To, Issuing Authority, and Reference Number are all required.';
      errEl.classList.add('show');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Generating...';

    try {
      const res  = await fetch(BASE + '/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, issued_to: issuedTo, issued_by: issuedBy, doc_type: docType || null, expiry_date: expiry || null, prefix, metadata })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed.');

      const doc = data.document;
      document.getElementById('g-qr').src = data.qr.dataUrl;
      document.getElementById('g-docid').textContent = doc.doc_id;
      document.getElementById('g-fields').innerHTML =
        '<div class="field-row"><span>' + (activeGenTab === 'academic' ? 'Matric Number' : 'Reference Number') + '</span><span>' + esc(matric) + '</span></div>'
        + '<div class="field-row"><span>Issued To</span><span>' + esc(doc.issued_to) + '</span></div>'
        + '<div class="field-row"><span>Issued By</span><span>' + esc(doc.issued_by) + '</span></div>'
        + '<div class="field-row"><span>Type</span><span>' + esc(doc.doc_type || 'N/A') + '</span></div>'
        + '<div class="field-row"><span>Issue Date</span><span>' + fmtDate(doc.issue_date) + '</span></div>'
        + (doc.expiry_date ? '<div class="field-row"><span>Valid Until</span><span>' + fmtDate(doc.expiry_date) + '</span></div>' : '');
      document.getElementById('g-links').innerHTML =
        '<a href="' + BASE + '/api/documents/' + doc.doc_id + '/pdf" target="_blank" class="primary">Download PDF</a>'
        + '<a href="' + BASE + '/api/documents/' + doc.doc_id + '/qr" target="_blank">Download QR</a>'
        + '<a href="' + data.qr.url + '" target="_blank">Verify page</a>';
      document.getElementById('g-result').classList.add('show');
      setTimeout(loadLogs, 800);
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate QR code';
    }
  }

  // ── VERIFY DOC ────────────────────────────────────────────────────────────
  async function verifyDoc() {
    const docId  = document.getElementById('v-docid').value.trim();
    const errEl  = document.getElementById('v-error');
    const result = document.getElementById('v-result');
    const btn    = document.getElementById('v-btn');
    errEl.classList.remove('show');
    result.classList.remove('show');

    if (!docId) {
      errEl.textContent = 'Please enter a document ID.';
      errEl.classList.add('show');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Verifying...';

    try {
      const res  = await fetch(BASE + '/verify/api/' + encodeURIComponent(docId));
      const data = await res.json();
      const doc  = data.document;
      let bc = 'verified', bl = '&#10003; Verified Authentic';
      if (!data.valid) {
        bc = data.status === 'revoked' ? 'revoked' : 'error';
        bl = data.status === 'revoked' ? '&#10007; Revoked' : '&#33; Not Found';
      }
      result.innerHTML = '<div class="badge ' + bc + '" style="margin-bottom:14px">' + bl + '</div>'
        + (doc ? '<div class="doc-id">' + esc(doc.doc_id) + '</div>'
          + '<div class="field-row"><span>Title</span><span>' + esc(doc.title) + '</span></div>'
          + '<div class="field-row"><span>Issued To</span><span>' + esc(doc.issued_to) + '</span></div>'
          + '<div class="field-row"><span>Issued By</span><span>' + esc(doc.issued_by) + '</span></div>'
          + '<div class="field-row"><span>Issue Date</span><span>' + fmtDate(doc.issue_date) + '</span></div>'
          + (doc.expiry_date ? '<div class="field-row"><span>Valid Until</span><span>' + fmtDate(doc.expiry_date) + '</span></div>' : '')
          + '<div class="field-row"><span>Status</span><span>' + esc(doc.status) + '</span></div>'
          : '<p style="font-size:13px;color:#888;margin-top:8px">No document found for that ID.</p>');
      result.classList.add('show');
      setTimeout(loadLogs, 800);
    } catch (e) {
      errEl.textContent = 'Verification failed. Please try again.';
      errEl.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Verify document';
    }
  }

  // ── SEARCH ────────────────────────────────────────────────────────────────
  document.getElementById('s-btn').addEventListener('click', async () => {
    const q           = document.getElementById('s-query').value.trim();
    const institution = document.getElementById('s-institution').value.trim();
    const errEl       = document.getElementById('s-error');
    const results     = document.getElementById('s-results');
    const btn         = document.getElementById('s-btn');
    errEl.classList.remove('show');
    results.innerHTML = '';

    if (!q || q.length < 3) {
      errEl.textContent = 'Please enter at least 3 characters.';
      errEl.classList.add('show');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Searching...';

    try {
      const url = BASE + '/verify/api/search?q=' + encodeURIComponent(q) + (institution ? '&institution=' + encodeURIComponent(institution) : '');
      const res  = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed.');

      if (!data.results.length) {
        results.innerHTML = '<p style="font-size:13px;color:#888;text-align:center;padding:16px">No records found.</p>';
        return;
      }

      results.innerHTML = data.results.map(doc => {
        const isExpired   = doc.expiry_date && new Date(doc.expiry_date) < new Date();
        const statusColor = doc.status === 'active' && !isExpired ? '#0f6e56' : '#A32D2D';
        const statusLabel = doc.status === 'revoked' ? 'Revoked' : isExpired ? 'Expired' : 'Active';
        return '<div style="border:1px solid #eee;border-radius:10px;padding:14px;margin-bottom:10px">'
          + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">'
          + '<strong style="font-size:14px;color:#111">' + esc(doc.title) + '</strong>'
          + '<span style="font-size:11px;font-weight:600;color:' + statusColor + ';background:' + (doc.status === 'active' && !isExpired ? '#e1f5ee' : '#fcebeb') + ';padding:3px 8px;border-radius:12px">' + statusLabel + '</span>'
          + '</div>'
          + '<div style="font-size:12px;color:#888;margin-bottom:4px">Issued to: <strong style="color:#333">' + esc(doc.issued_to) + '</strong></div>'
          + '<div style="font-size:12px;color:#888;margin-bottom:4px">Issued by: ' + esc(doc.issued_by) + '</div>'
          + '<div style="font-size:11px;font-family:monospace;color:#555;margin-bottom:10px">' + esc(doc.doc_id) + '</div>'
          + '<a href="' + BASE + '/verify?doc=' + encodeURIComponent(doc.doc_id) + '" target="_blank" style="font-size:12px;color:#1a3a5c;font-weight:500;text-decoration:none;border:1px solid #1a3a5c;padding:5px 12px;border-radius:6px;display:inline-block">View verify page</a>'
          + '</div>';
      }).join('');

    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.add('show');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Search records';
    }
  });

  document.getElementById('s-query').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('s-btn').click();
  });

  // ── EVENT LISTENERS ───────────────────────────────────────────────────────
  document.getElementById('g-btn').addEventListener('click', generateDoc);
  document.getElementById('v-btn').addEventListener('click', verifyDoc);
  document.getElementById('v-docid').addEventListener('keydown', e => {
    if (e.key === 'Enter') verifyDoc();
  });

  // ── TENANT CONFIG ─────────────────────────────────────────────────────────
  let TENANT = { institution_type: 'academic', name: 'UniVerify' };

  async function loadTenantConfig() {
    try {
      const res = await fetch(BASE + '/api/tenant-info');
      if (res.ok) {
        TENANT = await res.json();
        applyTenantConfig();
      }
    } catch (e) { /* use defaults */ }
  }

  function applyTenantConfig() {
    const type = TENANT.institution_type || 'academic';

    // Update institution name in header if element exists
    const nameEl = document.getElementById('tenant-name');
    if (nameEl) nameEl.textContent = TENANT.name || 'UniVerify';

    const tabOther   = document.getElementById('tab-other');
    const tabAcademic= document.getElementById('tab-academic');

    // Pre-fill institution name in the generate form
    const issuedByEl      = document.getElementById('g-issuedBy');
    const issuedByOtherEl = document.getElementById('g-issuedBy-other');
    if (issuedByEl && TENANT.name) {
      issuedByEl.value = TENANT.name;
      if (type !== 'demo') {
        issuedByEl.readOnly = true;
        issuedByEl.style.background = '#f4f6f9';
        issuedByEl.style.color      = '#666';
        issuedByEl.style.cursor     = 'not-allowed';
        issuedByEl.title            = 'Institution name is set by your account';
      }
    }
    if (issuedByOtherEl && TENANT.name) {
      issuedByOtherEl.value = TENANT.name;
      if (type !== 'demo') {
        issuedByOtherEl.readOnly = true;
        issuedByOtherEl.style.background = '#f4f6f9';
        issuedByOtherEl.style.color      = '#666';
        issuedByOtherEl.style.cursor     = 'not-allowed';
        issuedByOtherEl.title            = 'Institution name is set by your account';
      }
    }

    // Pre-fill prefix from tenant short_code and lock it
    const prefixEl      = document.getElementById('g-prefix');
    const prefixOtherEl = document.getElementById('g-prefix-other');
    if (prefixEl && TENANT.short_code) {
      prefixEl.value = TENANT.short_code;
      if (type !== 'demo') {
        prefixEl.readOnly = true;
        prefixEl.style.background = '#f4f6f9';
        prefixEl.style.color      = '#666';
        prefixEl.style.cursor     = 'not-allowed';
      }
    }
    if (prefixOtherEl && TENANT.short_code) {
      prefixOtherEl.value = TENANT.short_code;
      if (type !== 'demo') {
        prefixOtherEl.readOnly = true;
        prefixOtherEl.style.background = '#f4f6f9';
        prefixOtherEl.style.color      = '#666';
        prefixOtherEl.style.cursor     = 'not-allowed';
      }
    }

    if (type === 'academic') {
      // Academic tenant — hide Other Institutions tab
      if (tabOther) tabOther.style.display = 'none';
      switchGenTab('academic');
    } else if (['government','hospital','court'].includes(type)) {
      // Government/hospital/court tenant — hide Academic tab
      if (tabAcademic) tabAcademic.style.display = 'none';
      switchGenTab('other');
    } else if (type === 'demo') {
      // Demo tenant — show both tabs so prospects see full platform capability
      if (tabOther)    tabOther.style.display    = '';
      if (tabAcademic) tabAcademic.style.display = '';
      switchGenTab('academic'); // start on academic by default
    }
    // Any other type — show both tabs, no change
  }

  // ── INIT ──────────────────────────────────────────────────────────────────
  loadTenantConfig();
  loadLogs();
  loadVisitors();
  setInterval(loadLogs, 30000);
