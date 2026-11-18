// UniVerify staff app: hash-routed single page over /app-api.
(function () {
  'use strict';

  // ── State and helpers ───────────────────────────────────────────────────
  const S = { user: null, tenant: null, meta: null };
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const has = (...roles) => S.user && S.user.roles.some(r => roles.includes(r));
  const canIssue = () => has('owner', 'officer', 'approver');
  const vendorOnly = () => S.user && S.user.roles.length === 1 && S.user.roles[0] === 'vendor';
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const fmtTime = d => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const ROLE_LABEL = { owner: 'Owner', officer: 'Records Officer', approver: 'Approver', auditor: 'Auditor', vendor: 'Print vendor' };
  const STATUS_LABEL = { active: 'Active', revoked: 'Revoked', superseded: 'Superseded', expired: 'Expired' };
  const RESULT_LABEL = { found: 'Verified', revoked: 'Revoked', superseded: 'Superseded', not_found: 'Not found', tampered: 'Tampered link', old_link: 'Older QR refused' };
  const PAY_LABEL = { none: 'None', student_token: 'Graduate credit', employer_payment: 'Verifier paid', replacement_pdf: 'Graduate download' };
  const ACTION_LABEL = {
    support_ticket_opened: 'Opened support ticket', support_ticket_replied: 'Replied to support ticket', support_ticket_closed: 'Closed support ticket',
    sign_in: 'Signed in', sign_in_recovery_code: 'Signed in with a recovery code', sign_out: 'Signed out',
    password_changed: 'Changed password', account_setup_completed: 'Finished account setup',
    document_issued: 'Issued document', document_revoked: 'Revoked document', document_restored: 'Restored document',
    document_superseded: 'Replaced by reissue', document_reissued: 'Reissued document', pdf_downloaded: 'Downloaded PDF',
    search: 'Searched records', user_invited: 'Invited user', user_roles_changed: 'Changed roles',
    user_enabled: 'Enabled user', user_disabled: 'Disabled user', user_access_reset: 'Reset user access',
    logo_updated: 'Changed logo', logo_removed: 'Removed logo', colours_updated: 'Changed colours',
    signatory_added: 'Added signatory', signatory_retired: 'Retired signatory', signatory_deleted: 'Deleted signatory',
    batch_uploaded: 'Uploaded batch', batch_submitted: 'Submitted batch for approval', batch_approved: 'Approved batch',
    batch_rejected: 'Rejected batch', batch_cancelled: 'Cancelled batch', batch_issued: 'Issued batch',
    batch_pdfs_downloaded: 'Downloaded batch PDFs', approval_enabled: 'Turned batch approval on', approval_disabled: 'Turned batch approval off',
    claim_code_issued: 'Created graduate claim code', batch_claim_codes_issued: 'Created claim codes for batch',
    payout_set_up: 'Payout bank account set up', payout_paused: 'Payouts paused',
    signing_key_rotated: 'Rotated QR signing key', strict_mode_enabled: 'Turned strict QR checking on', strict_mode_disabled: 'Turned strict QR checking off',
    claim_codes_required: 'Required claim codes for the graduate portal', claim_codes_not_required: 'Stopped requiring claim codes',
    print_spec_updated: 'Changed QR print layout', print_pack_downloaded: 'Downloaded print pack',
    print_job_created: 'Sent a print job', print_job_printed: 'Marked print job printed', print_job_delivered: 'Confirmed print job delivered',
    print_job_reissued: 'Reissued print pack', print_job_cancelled: 'Cancelled print job',
    disclosure_updated: 'Changed what verifiers see', scan_alert_acknowledged: 'Handled scan alert',
    student_list_uploaded: 'Uploaded student list', student_list_deleted: 'Deleted student list',
    registered_check_on: 'Required registered students', registered_check_off: 'Stopped requiring registered students',
    sis_connection_saved: 'Saved SIS connection', sis_connection_removed: 'Removed SIS connection', sis_connection_tested: 'Tested SIS connection',
  };
  const ALERT_LABEL = { many_scans: 'Many scans', many_places: 'Scanned in several cities', tampered: 'Tampered link' };
  const ALERT_TEXT = {
    many_scans: d => `${d.scans_24h} scans in 24 hours. A copied QR on fake certificates often shows up like this.`,
    many_places: d => `Scanned from ${(d.places || []).join(', ')} within 24 hours.`,
    tampered: () => 'Someone opened a link for this document with a signature that did not match. That can mean a forged or edited QR.',
  };
  const TYPE_LABEL = { Certificate: 'Degree Certificate', Transcript: 'Academic Transcript', Completion: 'Course Completion Certificate',
    Admission: 'Admission Letter', Attestation: 'Attestation Letter' };
  const typeLabel = t => TYPE_LABEL[t] || t || '';
  const badge = (cls, label) => `<span class="badge ${esc(cls)}">${esc(label)}</span>`;

  async function api(path, opts = {}) {
    const r = await fetch('/app-api' + path, {
      credentials: 'same-origin',
      method: opts.method || 'GET',
      headers: { Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (r.status === 401) { location.href = '/app/login.html?expired=1'; throw new Error('Signed out.'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Request failed.');
    return d;
  }

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied.'); }
    catch (e) { prompt('Copy this:', text); }
  }

  // Modal with a form. fields: [{ name, label, type, options, required, hint, value }]
  function modal({ title, lead, fields = [], submit = 'Save', danger = false, onSubmit, html = '' }) {
    const bg = $('modal-bg'), m = $('modal');
    const fieldHtml = fields.map(f => {
      const id = 'mf-' + f.name;
      let input;
      if (f.type === 'select') {
        input = `<select id="${id}" name="${esc(f.name)}">${f.options.map(o =>
          `<option value="${esc(o.value)}"${o.value === f.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      } else if (f.type === 'textarea') {
        input = `<textarea id="${id}" name="${esc(f.name)}">${esc(f.value || '')}</textarea>`;
      } else if (f.type === 'checks') {
        input = `<div class="checks">${f.options.map(o => `<label><input type="checkbox" name="${esc(f.name)}" value="${esc(o.value)}"${(f.value || []).includes(o.value) ? ' checked' : ''}/> <span>${esc(o.label)}${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</span></label>`).join('')}</div>`;
      } else if (f.type === 'file') {
        input = `<input type="file" id="${id}" name="${esc(f.name)}" accept="${esc(f.accept || '')}"/>${f.asText ? '' : `<div class="img-preview" id="${id}-pv"></div>`}`;
      } else {
        input = `<input type="${esc(f.type || 'text')}" id="${id}" name="${esc(f.name)}" value="${esc(f.value || '')}"/>`;
      }
      return `<div class="field"><label for="${id}">${esc(f.label)}</label>${input}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
    }).join('');
    m.innerHTML = `<h3>${esc(title)}</h3>${lead ? `<p class="lead">${esc(lead)}</p>` : ''}
      <div class="alert" id="m-msg"></div>${html}<form id="m-form">${fieldHtml}
      <div class="row"><button type="button" class="btn secondary" id="m-cancel">Cancel</button>
      ${onSubmit ? `<button type="submit" class="btn${danger ? ' danger' : ''}" id="m-ok">${esc(submit)}</button>` : ''}</div></form>`;
    bg.classList.add('open');
    const close = () => bg.classList.remove('open');
    $('m-cancel').onclick = close;
    bg.onclick = e => { if (e.target === bg) close(); };
    document.onkeydown = e => { if (e.key === 'Escape') close(); };
    const first = m.querySelector('input,select,textarea'); if (first) first.focus();
    fields.filter(f => f.type === 'file' && !f.asText).forEach(f => {
      const inp = $('mf-' + f.name);
      inp.onchange = async () => {
        const pv = $('mf-' + f.name + '-pv');
        pv.innerHTML = inp.files[0] ? `<img alt="" src="${esc(await readFile(inp.files[0]))}"/>` : '';
      };
    });
    $('m-form').onsubmit = async e => {
      e.preventDefault();
      if (!onSubmit) return close();
      const fd = new FormData($('m-form'));
      const values = {};
      const btn = $('m-ok'); btn.disabled = true;
      try {
        for (const f of fields) {
          if (f.type === 'checks') values[f.name] = fd.getAll(f.name);
          else if (f.type === 'file') {
            const file = $('mf-' + f.name).files[0];
            values[f.name] = file ? await (f.asText ? readText(file, f.maxKb) : readFile(file, f.maxKb)) : '';
            values[f.name + '_name'] = file ? file.name : '';
          }
          else values[f.name] = (fd.get(f.name) || '').toString().trim();
        }
        const keep = await onSubmit(values); if (keep !== true) close(); }
      catch (err) { const a = $('m-msg'); a.textContent = err.message; a.className = 'alert show err'; }
      finally { btn.disabled = false; }
    };
    return { close };
  }

  // File to a data: URL, refusing anything over maxKb before it's uploaded
  function readFile(file, maxKb) {
    return new Promise((resolve, reject) => {
      if (maxKb && file.size > maxKb * 1024) return reject(new Error(`That file is ${Math.ceil(file.size / 1024)} KB. The limit is ${maxKb} KB.`));
      if (!/^image\/(png|jpeg)$/.test(file.type)) return reject(new Error('Use a PNG or JPEG file.'));
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Could not read that file.'));
      r.readAsDataURL(file);
    });
  }

  function readText(file, maxKb) {
    return new Promise((resolve, reject) => {
      if (maxKb && file.size > maxKb * 1024) return reject(new Error(`That file is ${Math.ceil(file.size / 1024)} KB. The limit is ${maxKb} KB.`));
      if (!/\.csv$/i.test(file.name)) return reject(new Error('Use a .csv file. In Excel: File, Save As, CSV UTF-8.'));
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Could not read that file.'));
      r.readAsText(file, 'utf-8');
    });
  }

  function linkModal(title, lead, link) {
    modal({ title, lead, submit: 'Done', html: `<div class="copy-field" style="margin-bottom:6px"><input type="text" readonly value="${esc(link)}" id="lm-link"/><button type="button" class="btn sm" id="lm-copy">Copy</button></div>` });
    $('lm-copy').onclick = () => copy(link);
  }

  function pager(page, limit, total, go) {
    const pages = Math.max(1, Math.ceil(total / limit));
    const id = 'pg' + Math.random().toString(36).slice(2, 7);
    setTimeout(() => {
      const p = $(id + 'p'), n = $(id + 'n');
      if (p) p.onclick = () => go(page - 1);
      if (n) n.onclick = () => go(page + 1);
    });
    return `<div class="pager">${total} total · page ${page} of ${pages}
      <button class="btn secondary sm" id="${id}p" ${page <= 1 ? 'disabled' : ''}>Previous</button>
      <button class="btn secondary sm" id="${id}n" ${page >= pages ? 'disabled' : ''}>Next</button></div>`;
  }

  const qs = obj => Object.entries(obj).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  function routeParams() {
    const [path, query] = location.hash.slice(1).split('?');
    return { path: path || '/dashboard', q: new URLSearchParams(query || '') };
  }
  const go = (path, params) => { const h = '#' + path + (params ? '?' + qs(params) : ''); if (location.hash === h) render(); else location.hash = h; };

  // ── Navigation ──────────────────────────────────────────────────────────
  const NAV = [
    { group: 'Print', show: vendorOnly },
    { path: '/print', label: 'Print jobs', show: vendorOnly },
    { group: 'Work', show: () => !vendorOnly() },
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/documents', label: 'Documents' },
    { path: '/issue',     label: 'Issue document', show: canIssue },
    { path: '/batches',   label: 'Bulk issue' },
    { path: '/search',    label: 'Search' },
    { path: '/print',     label: 'Print jobs', show: canIssue },
    { group: 'Oversight', show: () => !vendorOnly() },
    { path: '/scans',     label: 'Verification log' },
    { path: '/alerts',    label: 'Scan alerts' },
    { path: '/activity',  label: 'Activity log', show: () => has('owner', 'auditor') },
    { group: 'Administration', show: () => has('owner') },
    { path: '/users',     label: 'Users and roles', show: () => has('owner') },
    { path: '/branding',  label: 'Branding', show: () => has('owner') },
    { path: '/signatories', label: 'Signatories', show: () => has('owner') },
    { path: '/security',  label: 'QR and portal security', show: () => has('owner') },
    { path: '/students',  label: 'Student records', show: () => has('owner') },
    { path: '/payouts',   label: 'Payments and payouts', show: () => has('owner') },
    { group: 'Help', show: () => !vendorOnly() },
    { path: '/support',   label: 'Support', show: () => !vendorOnly() },
  ];
  function renderNav(active) {
    $('nav').innerHTML = NAV.filter(i => i.show ? i.show() : !vendorOnly()).map(i => i.group
      ? `<div class="nav-group">${esc(i.group)}</div>`
      : `<a href="#${i.path}" class="${active.startsWith(i.path) ? 'active' : ''}">${esc(i.label)}</a>`).join('');
  }

  // ── Views ───────────────────────────────────────────────────────────────
  const V = {};

  V['/dashboard'] = async (el) => {
    const d = await api('/dashboard');
    const low = sessionStorage.getItem('uv-recovery-low');
    const tampered = parseInt(d.scans.tampered_30d) || 0;
    el.innerHTML = `
      <div class="page-head"><div><h1>Dashboard</h1><div class="sub">${esc(S.tenant.name)}</div></div>
        <div class="actions">${canIssue() ? '<a class="btn" href="#/issue">Issue document</a>' : ''}
        <a class="btn secondary" href="#/search">Search</a></div></div>
      ${low ? `<div class="notice">You have ${esc(low)} recovery codes left. Ask an Owner to reset your access to get new ones.</div>` : ''}
      <div id="dash-pending"></div>
      ${d.open_alerts ? `<div class="notice bad">${d.open_alerts} open scan alert${d.open_alerts > 1 ? 's' : ''}. <a href="#/alerts">Review</a></div>` : ''}
      ${tampered ? `<div class="notice bad">${tampered} scan${tampered > 1 ? 's' : ''} with a tampered link in the last 30 days. <a href="#/scans?result=tampered">Review</a></div>` : ''}
      <div class="cards">
        <div class="card"><div class="k">Active documents</div><div class="v">${esc(d.documents.active)}</div></div>
        <div class="card"><div class="k">Issued this month</div><div class="v">${esc(d.documents.issued_month)}</div></div>
        <div class="card"><div class="k">Verifications this month</div><div class="v">${esc(d.scans.month)}</div></div>
        <div class="card"><div class="k">Verifications today</div><div class="v">${esc(d.scans.today)}</div></div>
        <div class="card"><div class="k">Paid by verifiers / graduate credits (month)</div><div class="v">${esc(d.scans.paid_month)} / ${esc(d.scans.token_month)}</div></div>
        <div class="card"><div class="k">Revoked / superseded</div><div class="v">${esc(d.documents.revoked)} / ${esc(d.documents.superseded)}</div></div>
      </div>
      <div class="panel"><h2>Recent verifications</h2>${scansTable(d.recent_scans)}
        <p style="margin:12px 0 0"><a href="#/scans">View the full verification log</a></p></div>`;
    showPendingApprovals();
  };

  function scansTable(rows) {
    if (!rows.length) return '<div class="empty">No verifications yet.</div>';
    return `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Document</th><th>Holder</th><th>Result</th><th>Paid by</th><th>Location</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="click" data-doc="${esc(r.doc_id)}"><td>${esc(fmtTime(r.verified_at))}</td><td class="mono">${esc(r.doc_id)}</td>
        <td>${esc(r.issued_to || '')}</td><td>${badge(r.result, RESULT_LABEL[r.result] || r.result)}</td>
        <td>${esc(PAY_LABEL[r.payment_method] || r.payment_method)}</td><td>${esc(r.location)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  function docsTable(rows) {
    if (!rows.length) return '<div class="empty">No documents match.</div>';
    return `<div class="table-wrap"><table><thead><tr><th>Document ID</th><th>Holder</th><th>Matric</th><th>Type</th><th>Issued</th><th>Status</th><th>Scans</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="click" data-doc="${esc(r.doc_id)}"><td class="mono">${esc(r.doc_id)}</td><td>${esc(r.issued_to)}</td>
        <td class="mono">${esc(r.matric_number || '')}</td><td>${esc(typeLabel(r.doc_type))}</td><td>${esc(fmtDate(r.issue_date))}</td>
        <td>${badge(r.status, STATUS_LABEL[r.status] || r.status)}</td><td>${r.scans != null ? esc(r.scans) : ''}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  V['/documents'] = async (el, q) => {
    const f = { status: q.get('status') || '', type: q.get('type') || '', from: q.get('from') || '', to: q.get('to') || '' };
    const page = parseInt(q.get('page')) || 1;
    const d = await api('/documents?' + qs({ ...f, page }));
    el.innerHTML = `
      <div class="page-head"><div><h1>Documents</h1><div class="sub">Everything issued by ${esc(S.tenant.name)}</div></div>
        <div class="actions">${canIssue() ? '<a class="btn" href="#/issue">Issue document</a>' : ''}</div></div>
      <div class="panel">
        <form class="filters" id="doc-filters">
          <div class="field"><label>Status</label><select name="status"><option value="">All</option>
            ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}"${f.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label>Type</label><select name="type"><option value="">All</option>
            ${S.meta.doc_types.map(t => `<option value="${esc(t)}"${f.type === t ? ' selected' : ''}>${esc(typeLabel(t))}</option>`).join('')}</select></div>
          <div class="field"><label>Issued from</label><input type="date" name="from" value="${esc(f.from)}"/></div>
          <div class="field"><label>Issued to</label><input type="date" name="to" value="${esc(f.to)}"/></div>
          <button class="btn secondary" type="submit">Apply</button>
          <button class="btn ghost" type="button" id="clear-f">Clear</button>
        </form>
        ${docsTable(d.data)}
        ${pager(d.page, d.limit, d.total, p => go('/documents', { ...f, page: p }))}
      </div>`;
    $('doc-filters').onsubmit = e => { e.preventDefault(); go('/documents', Object.fromEntries(new FormData(e.target))); };
    $('clear-f').onclick = () => go('/documents');
  };

  async function showPendingApprovals() {
    if (!has('owner', 'approver')) return;
    try {
      const b = await api('/batches');
      const n = b.pending_count || 0;
      const box = $('dash-pending');
      if (n && box) box.innerHTML = `<div class="notice">${n} bulk batch${n > 1 ? 'es are' : ' is'} awaiting approval. <a href="#/batches">Review</a></div>`;
    } catch (e) { /* batches not set up yet */ }
  }

  V['/doc'] = async (el, q, id) => {
    const d = await api('/documents/' + encodeURIComponent(id));
    const doc = d.document, m = doc.metadata || {};
    const reason = doc.revoked_reason ? (S.meta.revoke_reasons[doc.revoked_reason] || doc.revoked_reason) : '';
    const who = u => u ? (u.full_name ? `${u.full_name} (${u.email})` : u.email) : '';
    const rows = [
      ['Document ID', `<span class="mono">${esc(doc.doc_id)}</span>`],
      ['Status', badge(doc.status, STATUS_LABEL[doc.status] || doc.status)],
      ['Title', esc(doc.title)], ['Holder', esc(doc.issued_to)], ['Matric number', `<span class="mono">${esc(m.matric_number || '')}</span>`],
      ['Type', esc(typeLabel(doc.doc_type))], ['Programme', esc(m.programme || '')], ['Faculty', esc(m.faculty || '')],
      ['Department', esc(m.department || '')], ['Class of degree', esc(m.degree_class || '')],
      ['Entry / graduation year', esc([m.entry_year, m.graduation_year].filter(Boolean).join(' / '))],
      ['Issued', esc(fmtDate(doc.issue_date))], ['Expires', esc(doc.expiry_date ? fmtDate(doc.expiry_date) : 'No expiry')],
      ['Issued by', esc(who(d.issued_by_user) || 'Legacy dashboard')],
    ].filter(([, v]) => v !== '');
    if (doc.status === 'revoked') rows.push(['Revoked', esc(`${fmtTime(doc.revoked_at)} by ${who(d.revoked_by_user)}, reason: ${reason}`)]);
    if (doc.replaces_doc_id) rows.push(['Replaces', `<a href="#/doc/${encodeURIComponent(doc.replaces_doc_id)}" class="mono">${esc(doc.replaces_doc_id)}</a>`]);
    if (doc.batch_id) rows.push(['Bulk upload', `<a href="#/batch/${encodeURIComponent(doc.batch_id)}">View batch</a>`]);
    if (doc.superseded_by) rows.push(['Replaced by', `<a href="#/doc/${encodeURIComponent(doc.superseded_by)}" class="mono">${esc(doc.superseded_by)}</a>`]);

    const base = '/app-api/documents/' + encodeURIComponent(doc.doc_id);
    const actions = [];
    if (canIssue()) {
      actions.push(`<a class="btn" href="${base}/pdf">Download PDF</a>`);
      actions.push(`<a class="btn secondary" href="${base}/qr">QR PNG</a>`);
      actions.push(`<a class="btn secondary" href="${base}/qr?size=print">QR PNG (print)</a>`);
      actions.push(`<a class="btn secondary" href="${base}/qr?format=svg">QR SVG (print)</a>`);
    }
    actions.push(`<button class="btn secondary" id="copy-verify">Copy verify link</button>`);
    if (canIssue() && ['active', 'revoked'].includes(doc.status)) actions.push(`<a class="btn secondary" href="#/issue?reissue=${encodeURIComponent(doc.doc_id)}">Reissue / correct</a>`);
    if (canIssue() && doc.status === 'active') actions.push(`<button class="btn danger" id="revoke">Revoke</button>`);
    if (has('owner') && d.can_restore) actions.push(`<button class="btn secondary" id="restore">Restore</button>`);
    if (canIssue() && doc.status === 'active' && m.matric_number) actions.push(`<button class="btn secondary" id="claim">Graduate claim code</button>`);
    if (canIssue() && doc.status === 'active') actions.push(`<button class="btn secondary" id="send-print">Send to printer</button>`);

    el.innerHTML = `
      <div class="page-head"><div><h1>${esc(doc.issued_to)}</h1><div class="sub">${esc(doc.title)}</div></div>
        <div class="actions"><a class="btn ghost" href="#/documents">Back to documents</a></div></div>
      ${doc.status === 'superseded' ? '<div class="notice">This document was replaced. Scans of its QR tell the verifier to ask the holder for the current copy.</div>' : ''}
      ${doc.status === 'revoked' ? '<div class="notice bad">This document is revoked. Scans show it as revoked, without the reason.</div>' : ''}
      <div class="detail-grid">
        <div class="panel"><dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
          <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:18px">${actions.join('')}</div></div>
        <div class="panel qr-side"><h2>QR code</h2>${canIssue() ? `<img src="${base}/qr" alt="QR code for ${esc(doc.doc_id)}"/>` : '<p class="muted">Download is limited to issuing roles.</p>'}
          <p class="muted" style="font-size:12px;word-break:break-all">${esc(d.verify_url)}</p></div>
      </div>
      <div class="panel"><h2>Verifications of this document</h2>${scansTable(d.scans.map(s => ({ ...s, doc_id: doc.doc_id, issued_to: doc.issued_to })))}</div>
      <div class="panel"><h2>History</h2>${d.history.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Who</th><th>What</th><th>Detail</th></tr></thead><tbody>
        ${d.history.map(h => `<tr><td>${esc(fmtTime(h.created_at))}</td><td>${esc(h.actor)}</td><td>${esc(ACTION_LABEL[h.action] || h.action)}</td><td>${esc(detailText(h.detail))}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No staff actions recorded for this document.</div>'}</div>`;

    $('copy-verify').onclick = () => copy(d.verify_url);
    if ($('send-print')) $('send-print').onclick = () => sendToPrinter({ doc_ids: [doc.doc_id] }, `${doc.issued_to}, ${typeLabel(doc.doc_type)}`);
    if ($('claim')) $('claim').onclick = () => modal({
      title: 'Graduate claim code', submit: 'Create code',
      lead: `${doc.issued_to} needs this code once, to open their graduate portal account for matric number ${m.matric_number}. It works for ${S.meta.claim_days || 90} days and only once. Creating a new code cancels any earlier one that hasn't been used.`,
      onSubmit: async () => {
        const r = await api(base.replace('/app-api', '') + '/claim-code', { method: 'POST' });
        modal({
          title: 'Claim code for ' + r.holder,
          html: `<div class="claim-code mono">${esc(r.code)}</div>
            <p class="muted">Matric number <span class="mono">${esc(r.matric_number)}</span>. Use it at <span class="mono">${esc(r.portal_url)}</span> before ${esc(fmtDate(r.expires_at))}.</p>
            <p class="muted">This is the only time the code is shown. Give it to the graduate directly (with the document, or by their own email or phone on your records), never to someone asking on their behalf.</p>
            <div class="row" style="justify-content:flex-start"><button type="button" class="btn secondary" id="claim-copy">Copy code</button></div>`,
        });
        $('claim-copy').onclick = () => copy(r.code);
        return true;
      },
    });
    if ($('revoke')) $('revoke').onclick = () => modal({
      title: 'Revoke ' + doc.doc_id, danger: true, submit: 'Revoke document',
      lead: 'Verifiers will see this document as revoked. They never see the reason. An Owner can restore it within ' + S.meta.restore_days + ' days.',
      fields: [
        { name: 'reason', label: 'Reason', type: 'select', value: 'issued_in_error',
          options: Object.entries(S.meta.revoke_reasons).map(([value, label]) => ({ value, label })) },
        { name: 'note', label: 'Note (required for Other)', type: 'textarea' },
      ],
      onSubmit: async v => { await api(base.replace('/app-api', '') + '/revoke', { method: 'POST', body: v }); toast('Document revoked.'); render(); },
    });
    if ($('restore')) $('restore').onclick = () => modal({
      title: 'Restore ' + doc.doc_id, submit: 'Restore',
      lead: 'The document becomes active again and scans verify as normal.',
      fields: [{ name: 'note', label: 'Why is it being restored?', type: 'textarea' }],
      onSubmit: async v => { await api(base.replace('/app-api', '') + '/restore', { method: 'POST', body: v }); toast('Document restored.'); render(); },
    });
  };

  function detailText(d) {
    if (!d) return '';
    const parts = [];
    if (d.reason) parts.push('Reason: ' + (S.meta.revoke_reasons[d.reason] || d.reason));
    if (d.note) parts.push(d.note);
    if (d.replaced_by) parts.push('Replaced by ' + d.replaced_by);
    if (d.replaces) parts.push('Replaces ' + d.replaces);
    if (d.q) parts.push(`"${d.q}" (${d.results} results)`);
    if (d.roles) parts.push('Roles: ' + d.roles.map(r => ROLE_LABEL[r] || r).join(', '));
    if (d.doc_type) parts.push(d.doc_type);
    if (d.matric_number) parts.push(d.matric_number);
    if (d.changes) parts.push(d.changes.join('; '));
    if (d.bank) parts.push(`${d.bank} ${d.account || ''}, platform fee ${d.fee_percent}%`);
    if (d.kind) parts.push(ALERT_LABEL[d.kind] || d.kind);
    if (d.size_mm) parts.push(`${d.paper || ''} ${d.anchor || ''}, ${d.x_mm} x ${d.y_mm} mm, ${d.size_mm} mm QR`);
    if (d.file_name) parts.push(d.file_name);
    if (d.ticket_no) parts.push(`Ticket #${d.ticket_no}${d.subject ? ': ' + d.subject : ''}`);
    if (d.vendor) parts.push(`${d.title ? d.title + ', ' : ''}${d.vendor}${d.documents ? `, ${d.documents} documents` : ''}`);
    if (d.download) parts.push('Download ' + d.download);
    if (d.rows != null) parts.push(`${d.rows} rows` + (d.errors ? `, ${d.errors} with errors` : ''));
    if (d.issued != null) parts.push(`${d.issued} issued`);
    if (d.batch_id && d.row) parts.push(`Bulk upload, row ${d.row}`);
    return parts.join(' · ');
  }

  V['/issue'] = async (el, q) => {
    if (!canIssue()) { el.innerHTML = '<div class="panel empty">Your role can\'t issue documents.</div>'; return; }
    const reissueId = q.get('reissue');
    let pre = {}, m = {};
    if (reissueId) {
      const d = await api('/documents/' + encodeURIComponent(reissueId));
      pre = d.document; m = pre.metadata || {};
    }
    const input = (name, label, value, opts = {}) => `<div class="field${opts.full ? ' full' : ''}"><label for="i-${name}">${esc(label)}${opts.req ? ' *' : ''}</label>
      <input type="${opts.type || 'text'}" id="i-${name}" name="${name}" value="${esc(value || '')}" ${opts.attrs || ''}/>${opts.hint ? `<div class="hint">${esc(opts.hint)}</div>` : ''}</div>`;
    el.innerHTML = `
      <div class="page-head"><div><h1>${reissueId ? 'Reissue / correct' : 'Issue document'}</h1>
        <div class="sub">${reissueId ? `Replaces <span class="mono">${esc(reissueId)}</span>. The old QR will tell verifiers to ask for the current copy.` : `Issued under ${esc(S.tenant.name)}, signed and QR-coded on save.`}</div></div></div>
      <div class="panel"><div class="alert" id="i-msg"></div>
      <form id="issue-form">
        <div class="lookup-row"><div class="field" style="flex:1;min-width:200px;margin:0"><label for="i-matric_number">Matric number *</label>
          <input type="text" id="i-matric_number" name="matric_number" value="${esc(m.matric_number || '')}" style="text-transform:uppercase" autocomplete="off"/></div>
          <button class="btn secondary" type="button" id="i-look">Look up student</button></div>
        <div class="alert" id="i-rec"></div>
        <div class="form-grid">
        <div class="field"><label for="i-doc_type">Document type *</label><select id="i-doc_type" name="doc_type">
          ${S.meta.doc_types.map(t => `<option value="${esc(t)}"${(pre.doc_type || 'Certificate') === t ? ' selected' : ''}>${esc(typeLabel(t))}</option>`).join('')}</select></div>
        ${input('title', 'Document title', pre.title, { req: true, attrs: 'placeholder="e.g. Bachelor of Science in Computer Science"' })}
        ${input('issued_to', 'Graduate full name', pre.issued_to, { req: true })}
        ${input('programme', 'Programme / course', m.programme || m.course)}
        ${input('degree_class', 'Class of degree', m.degree_class || m.class, { attrs: 'placeholder="e.g. Second Class Upper"' })}
        ${input('faculty', 'Faculty', m.faculty)}
        ${input('department', 'Department', m.department)}
        ${input('entry_year', 'Entry year', m.entry_year, { attrs: 'inputmode="numeric" maxlength="4"' })}
        ${input('graduation_year', 'Graduation year', m.graduation_year, { attrs: 'inputmode="numeric" maxlength="4"' })}
        ${input('expiry_date', 'Expiry date', pre.expiry_date ? String(pre.expiry_date).slice(0, 10) : '', { type: 'date', hint: 'Leave empty for certificates that never expire.' })}
        ${reissueId ? `<div class="field full"><label for="i-note">What was corrected? *</label><textarea id="i-note" name="note"></textarea></div>` : ''}
      </div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button class="btn" type="submit" id="i-save">${reissueId ? 'Reissue document' : 'Issue document'}</button>
        <a class="btn secondary" href="${reissueId ? '#/doc/' + encodeURIComponent(reissueId) : '#/documents'}">Cancel</a></div>
      </form></div>`;
    // Matric lookup: fill the form from the school's student records
    const SOURCE = { sis: 'the student information system', list: 'the uploaded student list' };
    const FILL = { issued_to: 'full_name', programme: 'programme', degree_class: 'degree_class', faculty: 'faculty',
                   department: 'department', entry_year: 'entry_year', graduation_year: 'graduation_year' };
    let looked = '';
    // Details from a found record are locked: the server prints the record's values anyway
    const lock = (rec, src) => Object.entries(FILL).forEach(([field, key]) => {
      const inp = $('i-' + field), on = !!(rec && rec[key]);
      inp.readOnly = on; inp.classList.toggle('locked', on);
      inp.title = on ? `From ${src}. Correct it there, not here.` : '';
    });
    const lookup = async () => {
      const mv = $('i-matric_number').value.trim().toUpperCase();
      const box = $('i-rec');
      lock(null);
      if (!mv) { box.className = 'alert'; return; }
      looked = mv;
      box.className = 'alert show info'; box.textContent = 'Looking up ' + mv + '...';
      try {
        const r = await api('/students/lookup?' + qs({ matric: mv, doc_type: $('i-doc_type').value }));
        if (looked !== mv) return;
        const sisNote = r.sis_error ? ` The SIS couldn't be reached (${r.sis_error}).` : '';
        if (!r.found) {
          box.className = 'alert show ' + (r.require_registered ? 'err' : 'warn');
          box.textContent = !r.has_records && !r.require_registered
            ? 'No student records to check against yet. An Owner can connect the SIS or upload a student list under Student records.'
            : `No student with matric number ${mv} in ${S.tenant.name}'s student records.${sisNote}` +
              (r.require_registered ? ' Only registered students can be issued documents, so check the number.' : ' You can still issue, but check the details carefully.');
          return;
        }
        const rec = r.record;
        // The record is the authority: a field it leaves out is cleared, not kept from an earlier student
        for (const [field, key] of Object.entries(FILL)) $('i-' + field).value = rec[key] || '';
        lock(rec, SOURCE[r.source] || 'student records');
        const t = $('i-title');
        if (!t.value && rec.programme && ['Certificate', 'Diploma'].includes($('i-doc_type').value)) t.value = rec.programme;
        const status = rec.status ? rec.status.charAt(0).toUpperCase() + rec.status.slice(1) : 'not given';
        const head = `Found in ${SOURCE[r.source] || 'student records'}: ${rec.full_name}, status ${status}. Greyed fields come from the record and can't be changed here.`;
        if (r.check.error) { box.className = 'alert show err'; box.textContent = `${head} ${r.check.error}`; }
        else if (r.check.warning) { box.className = 'alert show warn'; box.textContent = `${head} ${r.check.warning}`; }
        else { box.className = 'alert show ok'; box.textContent = head + sisNote; }
      } catch (err) { box.className = 'alert show err'; box.textContent = err.message; }
    };
    $('i-look').onclick = lookup;
    $('i-matric_number').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } };
    $('i-matric_number').onchange = () => { if ($('i-matric_number').value.trim().toUpperCase() !== looked) lookup(); };
    $('i-doc_type').onchange = () => { if (looked) lookup(); };
    if (reissueId && m.matric_number) lookup();   // reissue: lock what the record fixes

    $('issue-form').onsubmit = async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      const btn = $('i-save'); btn.disabled = true;
      try {
        const d = reissueId
          ? await api('/documents/' + encodeURIComponent(reissueId) + '/reissue', { method: 'POST', body })
          : await api('/documents', { method: 'POST', body });
        toast(reissueId ? 'Reissued. The old document is now superseded.' : 'Document issued.');
        go('/doc/' + d.document.doc_id);
      } catch (err) { const a = $('i-msg'); a.textContent = err.message; a.className = 'alert show err'; window.scrollTo(0, 0); }
      finally { btn.disabled = false; }
    };
  };

  V['/search'] = async (el, q) => {
    const term = q.get('q') || '';
    el.innerHTML = `
      <div class="page-head"><div><h1>Search</h1><div class="sub">Staff only. Each search is recorded in the activity log.</div></div></div>
      <div class="panel"><form class="filters" id="s-form">
        <div class="field" style="flex:1;min-width:220px"><label>Name, matric number or document ID</label><input type="search" name="q" value="${esc(term)}" minlength="3"/></div>
        <button class="btn" type="submit">Search</button></form><div id="s-out"></div></div>`;
    $('s-form').onsubmit = e => { e.preventDefault(); go('/search', { q: new FormData(e.target).get('q') }); };
    if (term.length >= 3) {
      $('s-out').innerHTML = '<div class="empty">Searching...</div>';
      try { const d = await api('/search?q=' + encodeURIComponent(term)); $('s-out').innerHTML = docsTable(d.results); }
      catch (err) { $('s-out').innerHTML = `<div class="alert show err">${esc(err.message)}</div>`; }
    } else if (term) {
      $('s-out').innerHTML = '<div class="empty">Type at least 3 characters.</div>';
    }
  };

  V['/scans'] = async (el, q) => {
    const f = { result: q.get('result') || '', payment: q.get('payment') || '', from: q.get('from') || '', to: q.get('to') || '' };
    const page = parseInt(q.get('page')) || 1;
    const d = await api('/scans?' + qs({ ...f, page }));
    el.innerHTML = `
      <div class="page-head"><div><h1>Verification log</h1><div class="sub">Every scan of a ${esc(S.tenant.name)} QR code</div></div>
        <div class="actions"><button class="btn secondary" id="csv">Export this page (CSV)</button></div></div>
      <div class="panel"><form class="filters" id="sc-f">
        <div class="field"><label>Result</label><select name="result"><option value="">All</option>
          ${Object.entries(RESULT_LABEL).map(([k, v]) => `<option value="${k}"${f.result === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>Paid by</label><select name="payment"><option value="">All</option>
          ${Object.entries(PAY_LABEL).map(([k, v]) => `<option value="${k}"${f.payment === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>From</label><input type="date" name="from" value="${esc(f.from)}"/></div>
        <div class="field"><label>To</label><input type="date" name="to" value="${esc(f.to)}"/></div>
        <button class="btn secondary" type="submit">Apply</button><button class="btn ghost" type="button" id="sc-clear">Clear</button></form>
        ${scansTable(d.data)}${pager(d.page, d.limit, d.total, p => go('/scans', { ...f, page: p }))}</div>`;
    $('sc-f').onsubmit = e => { e.preventDefault(); go('/scans', Object.fromEntries(new FormData(e.target))); };
    $('sc-clear').onclick = () => go('/scans');
    $('csv').onclick = () => {
      const head = ['time', 'doc_id', 'holder', 'doc_type', 'result', 'paid_by', 'location'];
      const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [head.join(',')].concat(d.data.map(r => [r.verified_at, r.doc_id, r.issued_to, r.doc_type, r.result, r.payment_method, r.location].map(cell).join(',')));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
      a.download = `verification-log-page${d.page}.csv`; a.click();
    };
  };

  V['/activity'] = async (el, q) => {
    const f = { action: q.get('action') || '' };
    const page = parseInt(q.get('page')) || 1;
    const d = await api('/activity?' + qs({ ...f, page }));
    el.innerHTML = `
      <div class="page-head"><div><h1>Activity log</h1><div class="sub">Every staff action in this workspace</div></div></div>
      <div class="panel"><form class="filters" id="a-f">
        <div class="field"><label>Action</label><select name="action"><option value="">All</option>
          ${Object.entries(ACTION_LABEL).map(([k, v]) => `<option value="${k}"${f.action === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
        <button class="btn secondary" type="submit">Apply</button></form>
      ${d.data.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Who</th><th>What</th><th>On</th><th>Detail</th><th>IP</th></tr></thead><tbody>
        ${d.data.map(a => `<tr${a.target_type === 'document' ? ` class="click" data-doc="${esc(a.target_id)}"` : ''}><td>${esc(fmtTime(a.created_at))}</td><td>${esc(a.actor)}</td>
          <td>${esc(ACTION_LABEL[a.action] || a.action)}</td><td class="mono">${esc(a.target_id || '')}</td><td>${esc(detailText(a.detail))}</td><td class="mono">${esc(a.ip_address || '')}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No activity yet.</div>'}
      ${pager(d.page, d.limit, d.total, p => go('/activity', { ...f, page: p }))}</div>`;
    $('a-f').onsubmit = e => { e.preventDefault(); go('/activity', Object.fromEntries(new FormData(e.target))); };
  };

  const ROLE_OPTIONS = [
    { value: 'owner', label: 'Owner', hint: 'Everything, including users and settings' },
    { value: 'officer', label: 'Records Officer', hint: 'Issue, revoke, reissue, search' },
    { value: 'approver', label: 'Approver', hint: 'Issues today; approves batches once approval is switched on' },
    { value: 'auditor', label: 'Auditor', hint: 'Read only: documents, logs, activity' },
    { value: 'vendor', label: 'Print vendor', hint: 'Outside printer: downloads QR print packs only. Can\'t be combined with other roles' },
  ];

  V['/users'] = async (el) => {
    if (!has('owner')) { el.innerHTML = '<div class="panel empty">Only an Owner can manage users.</div>'; return; }
    const d = await api('/users');
    el.innerHTML = `
      <div class="page-head"><div><h1>Users and roles</h1><div class="sub">Who can sign in to this workspace</div></div>
        <div class="actions"><button class="btn" id="invite">Invite user</button></div></div>
      <div class="panel"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>
        ${d.users.map(u => `<tr><td>${esc(u.full_name || '')}${u.id === S.user.id ? ' <span class="muted">(you)</span>' : ''}</td><td>${esc(u.email)}</td>
          <td>${u.roles.map(r => badge('role', ROLE_LABEL[r] || r)).join('')}</td>
          <td>${badge(u.status, u.status === 'invited' ? 'Invited' : u.status === 'active' ? (u.totp_enabled ? 'Active' : 'Setup pending') : 'Disabled')}</td>
          <td>${esc(u.last_login_at ? fmtTime(u.last_login_at) : 'Never')}</td>
          <td style="white-space:nowrap">
            <button class="btn secondary sm" data-roles="${esc(u.id)}">Roles</button>
            ${u.id !== S.user.id && u.status !== 'disabled' ? `<button class="btn secondary sm" data-reset="${esc(u.id)}">${u.status === 'invited' ? 'New link' : 'Reset access'}</button>` : ''}
            ${u.id !== S.user.id ? `<button class="btn ${u.status === 'disabled' ? 'secondary' : 'danger'} sm" data-toggle="${esc(u.id)}" data-on="${u.status === 'disabled'}">${u.status === 'disabled' ? 'Enable' : 'Disable'}</button>` : ''}
          </td></tr>`).join('')}
      </tbody></table></div></div>`;
    const byId = id => d.users.find(u => u.id === id);
    $('invite').onclick = () => modal({
      title: 'Invite user', submit: 'Send invite',
      lead: 'They get a single-use link, valid 72 hours, to set a password and two-factor sign-in.',
      fields: [
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'full_name', label: 'Full name' },
        { name: 'roles', label: 'Roles', type: 'checks', options: ROLE_OPTIONS, value: ['officer'] },
      ],
      onSubmit: async v => {
        const r = await api('/users', { method: 'POST', body: v });
        render();
        linkModal('Invite created', r.emailed ? `Emailed to ${r.user.email}. You can also share this link.` : `Email isn't configured, so send this link to ${r.user.email} yourself.`, r.link);
        return true;
      },
    });
    el.querySelectorAll('[data-roles]').forEach(b => b.onclick = () => {
      const u = byId(b.dataset.roles);
      modal({ title: 'Roles for ' + (u.full_name || u.email), submit: 'Save roles',
        fields: [{ name: 'roles', label: 'Roles', type: 'checks', options: ROLE_OPTIONS, value: u.roles }],
        onSubmit: async v => { await api('/users/' + u.id + '/roles', { method: 'PATCH', body: v }); toast('Roles updated.'); render(); } });
    });
    el.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => {
      const u = byId(b.dataset.reset);
      modal({ title: 'Reset access for ' + (u.full_name || u.email), submit: 'Create new setup link', danger: true,
        lead: 'Their password, two-factor app and recovery codes stop working. They set them again from the new link.',
        onSubmit: async () => {
          const r = await api('/users/' + u.id + '/reset-access', { method: 'POST' });
          render();
          linkModal('New setup link', r.emailed ? `Emailed to ${r.user.email}.` : `Send this link to ${r.user.email}.`, r.link);
          return true;
        } });
    });
    el.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
      const u = byId(b.dataset.toggle), on = b.dataset.on === 'true';
      if (!on && !confirm('Disable ' + (u.full_name || u.email) + '? They are signed out at once.')) return;
      try { await api('/users/' + u.id + '/status', { method: 'POST', body: { enabled: on } }); toast(on ? 'User enabled.' : 'User disabled.'); render(); }
      catch (err) { toast(err.message); }
    });
  };

  // ── Branding (Owner) ────────────────────────────────────────────────────
  // Logo is served same-origin from /brand/logo; external URLs are blocked by the CSP
  function setSideLogo(version) {
    $('brand-logo').innerHTML = version
      ? `<img src="/brand/logo?v=${encodeURIComponent(version)}" alt="${esc(S.tenant.name)} logo"/>`
      : `<div class="mono">${esc(S.tenant.short_code || '')}</div>`;
  }

  const previewControls = (types, id) => `<div class="preview-row">
      <div class="field"><label for="${id}-t">Document type</label><select id="${id}-t">${types.map(t => `<option value="${esc(t)}">${esc(typeLabel(t))}</option>`).join('')}</select></div>
      <div class="field"><label for="${id}-d">As issued on</label><input type="date" id="${id}-d" value="${new Date().toISOString().slice(0, 10)}"/></div>
      <button class="btn secondary" type="button" id="${id}-go">Open specimen PDF</button></div>`;
  const wirePreview = id => { $(id + '-go').onclick = () => window.open(`/app-api/settings/preview.pdf?${qs({ type: $(id + '-t').value, date: $(id + '-d').value })}`, '_blank'); };

  V['/branding'] = async (el) => {
    if (!has('owner')) { el.innerHTML = '<div class="panel empty">Only an Owner can change branding.</div>'; return; }
    const b = await api('/settings/branding');
    el.innerHTML = `
      <div class="page-head"><div><h1>Branding</h1><div class="sub">How ${esc(b.name)} appears on documents and in this workspace</div></div></div>
      <div class="panel"><h2>Logo</h2>
        <p class="muted">Printed in the header of every certificate and transcript, and shown on the sign-in page. PNG or JPEG, up to ${esc(b.limits.logo_kb)} KB. A square or wide logo on a white or transparent background works best.</p>
        <div class="swatch-row">
          <div class="logo-box">${b.logo ? `<img src="/brand/logo?v=${esc(b.logo.version)}" alt="Current logo"/>` : '<span class="muted">No logo</span>'}</div>
          <div><button class="btn" id="logo-up">${b.logo ? 'Replace logo' : 'Upload logo'}</button>
            ${b.logo ? ' <button class="btn secondary" id="logo-rm">Remove</button>' : ''}
            ${b.logo ? `<div class="muted" style="font-size:12px;margin-top:8px">Updated ${esc(fmtTime(b.logo.updated_at))} · ${esc(Math.ceil(b.logo.bytes / 1024))} KB</div>` : ''}</div>
        </div></div>
      <div class="panel"><h2>Colours</h2>
        <p class="muted">Used across this workspace and the sign-in pages. Document PDFs keep their standard colours so they always print clearly.</p>
        <form id="col-f" class="swatch-row">
          <div class="field"><label for="c-p">Main colour</label><input type="color" id="c-p" name="primary_colour" value="${esc(b.primary_colour || '#1A3A5C')}"/></div>
          <div class="field"><label for="c-a">Accent colour</label><input type="color" id="c-a" name="accent_colour" value="${esc(b.accent_colour || '#C9A84C')}"/></div>
          <button class="btn" type="submit">Save colours</button></form>
        <div class="alert" id="col-msg" style="margin-top:10px"></div></div>
      <div class="panel"><h2>Preview</h2>
        <p class="muted">Renders a specimen with your current logo and signatories. It's marked SPECIMEN and isn't saved.</p>
        ${previewControls(S.meta.doc_types, 'pv')}</div>`;
    wirePreview('pv');
    $('logo-up').onclick = () => modal({
      title: b.logo ? 'Replace logo' : 'Upload logo', submit: 'Save logo',
      lead: 'New documents use it straight away. Existing PDFs show it the next time they are downloaded.',
      fields: [{ name: 'image', label: 'Logo file', type: 'file', accept: 'image/png,image/jpeg', maxKb: b.limits.logo_kb }],
      onSubmit: async v => {
        if (!v.image) throw new Error('Choose a file.');
        await api('/settings/logo', { method: 'POST', body: { image: v.image } });
        const me = await api('/auth/me'); S.tenant = me.tenant; setSideLogo(S.tenant.logo_version);
        toast('Logo saved.'); render();
      },
    });
    if ($('logo-rm')) $('logo-rm').onclick = () => modal({
      title: 'Remove logo', submit: 'Remove', danger: true,
      lead: 'Documents go back to the text-only header.',
      onSubmit: async () => { await api('/settings/logo', { method: 'DELETE' }); setSideLogo(null); toast('Logo removed.'); render(); },
    });
    $('col-f').onsubmit = async e => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target));
      try {
        await api('/settings/colours', { method: 'PATCH', body: v });
        const root = document.documentElement.style;
        root.setProperty('--brand', v.primary_colour); root.setProperty('--accent', v.accent_colour);
        $('col-msg').className = 'alert';
        toast('Colours saved.');
      } catch (err) { const a = $('col-msg'); a.textContent = err.message; a.className = 'alert show err'; }
    };
  };

  const SIG_STATUS = { current: 'In use', scheduled: 'Starts later', retired: 'Retired' };
  V['/signatories'] = async (el) => {
    if (!has('owner')) { el.innerHTML = '<div class="panel empty">Only an Owner can manage signatories.</div>'; return; }
    const d = await api('/settings/signatories');
    const kb = d.limits.signature_kb;
    const scope = s => s.doc_types.length ? s.doc_types.map(typeLabel).join(', ') : 'All document types';
    const slotPanel = slot => {
      const rows = d.signatories.filter(s => s.slot === slot);
      return `<div class="panel"><div class="slot-head"><h2>${esc(d.slots[slot])}</h2>
          <button class="btn sm" data-add="${slot}">Add signatory</button></div>
        ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Signature</th><th>Name and title</th><th>Applies to</th><th>Dates</th><th>Status</th><th></th></tr></thead><tbody>
          ${rows.map(s => `<tr><td><img class="sig-img" src="/app-api/settings/signatories/${esc(s.id)}/image" alt="Signature of ${esc(s.full_name)}"/></td>
            <td><strong>${esc(s.full_name)}</strong><div class="muted">${esc(s.title)}</div></td>
            <td>${esc(scope(s))}</td>
            <td>${esc(fmtDate(s.effective_from))} to ${esc(s.effective_to ? fmtDate(s.effective_to) : 'open')}</td>
            <td>${badge(s.status, SIG_STATUS[s.status])}</td>
            <td style="white-space:nowrap">${s.status === 'scheduled'
              ? `<button class="btn danger sm" data-del="${esc(s.id)}">Delete</button>`
              : s.status === 'current' ? `<button class="btn secondary sm" data-retire="${esc(s.id)}">Retire</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">No signatory yet. Documents show an empty signature line here.</p>'}</div>`;
    };
    el.innerHTML = `
      <div class="page-head"><div><h1>Signatories</h1><div class="sub">Whose signature prints on each document</div></div></div>
      <div class="notice">Each document carries the signature that was in force on its issue date, so a 2025 certificate keeps the 2025 signature even when it's downloaded again later. When an office holder changes, add the new person with their start date; they take over from that day. Signatures can't be edited, only retired, so the record of who signed what stays intact.</div>
      ${slotPanel(1)}${slotPanel(2)}
      <div class="panel"><h2>Check a document</h2><p class="muted">See which signatures print on a given type and date.</p>${previewControls(S.meta.doc_types, 'sp')}</div>`;
    wirePreview('sp');
    const byId = id => d.signatories.find(s => s.id === id);
    el.querySelectorAll('[data-add]').forEach(btn => btn.onclick = () => {
      const slot = Number(btn.dataset.add);
      modal({
        title: 'Add signatory: ' + d.slots[slot], submit: 'Add signatory',
        lead: 'Use a clear scan of the signature on white or transparent background. Every change is recorded in the activity log.',
        fields: [
          { name: 'full_name', label: 'Full name, as printed', hint: 'For example Dr. A. B. Adeyemi' },
          { name: 'title', label: 'Title', value: slot === 1 ? 'Registrar' : 'Vice-Chancellor' },
          { name: 'image', label: `Signature image (PNG or JPEG, up to ${kb} KB)`, type: 'file', accept: 'image/png,image/jpeg', maxKb: kb },
          { name: 'effective_from', label: 'Signs documents issued from', type: 'date', value: new Date().toISOString().slice(0, 10) },
          { name: 'effective_to', label: 'Until (optional)', type: 'date', hint: 'Leave empty if there is no end date yet.' },
          { name: 'doc_types', label: 'Document types', type: 'checks', hint: 'Tick none to sign every type.',
            options: d.doc_types.map(t => ({ value: t, label: typeLabel(t) })), value: [] },
        ],
        onSubmit: async v => {
          if (!v.image) throw new Error('Choose the signature image.');
          await api('/settings/signatories', { method: 'POST', body: { ...v, slot } });
          toast('Signatory added.'); render();
        },
      });
    });
    el.querySelectorAll('[data-retire]').forEach(btn => btn.onclick = () => {
      const s = byId(btn.dataset.retire);
      modal({
        title: 'Retire ' + s.full_name, submit: 'Retire', danger: true,
        lead: 'Documents issued after the last day won\'t carry this signature. Documents issued before it keep it.',
        fields: [{ name: 'effective_to', label: 'Last day', type: 'date', value: new Date().toISOString().slice(0, 10) }],
        onSubmit: async v => { await api('/settings/signatories/' + s.id + '/retire', { method: 'POST', body: v }); toast('Signatory retired.'); render(); },
      });
    });
    el.querySelectorAll('[data-del]').forEach(btn => btn.onclick = () => {
      const s = byId(btn.dataset.del);
      modal({
        title: 'Delete ' + s.full_name, submit: 'Delete', danger: true,
        lead: 'This signature hasn\'t started yet, so no document uses it.',
        onSubmit: async () => { await api('/settings/signatories/' + s.id, { method: 'DELETE' }); toast('Signatory deleted.'); render(); },
      });
    });
  };


  // ── QR and portal security (Phase 4) ────────────────────────────────────
  V['/payouts'] = async (el) => {
    if (!has('owner')) { el.innerHTML = '<div class="panel empty">Only an Owner can see payouts.</div>'; return; }
    const d = await api('/settings/payout');
    const p = d.payout, s = d.last_30_days;
    const naira = k => '₦' + (Number(k || 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 });
    const BEARER = { account: 'Innovation Lens pays the Paystack charge', subaccount: `${S.tenant.name} pays the Paystack charge` };
    el.innerHTML = `
      <div class="page-head"><div><h1>Payments and payouts</h1><div class="sub">Where verification fees and graduate credit purchases for ${esc(S.tenant.name)} settle</div></div></div>
      <div class="panel"><h2>Payout account</h2>
        ${p && p.active ? `<dl class="kv">
            <dt>Status</dt><dd>${badge('active', 'Paying out')}</dd>
            <dt>Bank</dt><dd>${esc(p.bank_name || '')}</dd>
            <dt>Account</dt><dd><span class="mono">****${esc(p.account_last4)}</span> ${esc(p.account_name || '')}</dd>
            <dt>Platform fee</dt><dd>${esc(p.platform_fee_percent)}% of each payment, kept by Innovation Lens</dd>
            <dt>Paystack charge</dt><dd>${esc(BEARER[p.fee_bearer] || '')}</dd>
            <dt>Last changed</dt><dd>${esc(fmtTime(p.updated_at))}</dd></dl>
            <p class="muted">Paystack settles ${esc(S.tenant.name)}'s share straight to this account on its normal settlement schedule. To change the account, contact Innovation Lens.</p>`
          : `<div class="notice">${p ? 'Payouts are paused.' : 'No payout account is set up yet.'} Payments are collected by Innovation Lens until it is. Contact Innovation Lens to add ${esc(S.tenant.name)}'s bank account.</div>`}
      </div>
      <div class="panel"><h2>Last 30 days</h2>
        <div class="cards">
          <div class="card"><div class="k">Successful payments</div><div class="v">${esc(s.payments)}</div></div>
          <div class="card"><div class="k">Paid in total</div><div class="v">${esc(naira(s.gross_kobo))}</div></div>
          <div class="card"><div class="k">${esc(S.tenant.name)}'s share, split at Paystack</div><div class="v">${esc(naira(s.school_share_kobo))}</div></div>
          <div class="card"><div class="k">Platform fee</div><div class="v">${esc(naira(s.platform_fee_kobo))}</div></div>
        </div>
        ${s.unsplit_kobo ? `<p class="muted">${esc(naira(s.unsplit_kobo))} was paid before payouts were active and was collected by Innovation Lens.</p>` : ''}
        <p class="muted">Amounts are before Paystack's own charge. Paystack's dashboard has the settlement record.</p>
      </div>`;
  };

  V['/security'] = async (el) => {
    if (!has('owner')) { el.innerHTML = '<div class="panel empty">Only an Owner can change security settings.</div>'; return; }
    const [d, dis] = await Promise.all([api('/settings/security'), api('/settings/disclosure')]);
    const active = d.keys.find(k => k.status === 'active');
    const KEY_STATUS = { active: 'In use', retired: 'Retired, still checks older QRs', revoked: 'Revoked' };
    el.innerHTML = `
      <div class="page-head"><div><h1>QR and portal security</h1><div class="sub">How ${esc(S.tenant.name)} QR codes are signed and who can open a graduate account</div></div></div>
      <div class="panel"><h2>QR signing key</h2>
        <p class="muted">Every QR code carries a signature made with a key that belongs to ${esc(S.tenant.name)} alone. The signature covers the document ID, type, issue date and the holder's name, so a changed record or a made-up link fails the check. Nobody, including your staff, ever sees the key.</p>
        ${d.master === 'shared' ? '<div class="notice">Keys are currently protected by the platform\'s general secret. UniVerify will move them to a dedicated signing secret; rotate the key once that happens.</div>' : ''}
        <div class="table-wrap"><table><thead><tr><th>Key</th><th>Status</th><th>Created</th><th>Retired</th></tr></thead><tbody>
          ${d.keys.map(k => `<tr><td class="mono">Key ${esc(k.kid)}</td><td>${badge(k.status === 'active' ? 'active' : 'retired', KEY_STATUS[k.status])}</td>
            <td>${esc(fmtTime(k.created_at))}</td><td>${esc(k.retired_at ? fmtTime(k.retired_at) : '')}</td></tr>`).join('')}
        </tbody></table></div>
        <p style="margin-top:14px"><button class="btn secondary" id="rotate">Rotate key</button></p></div>
      <div class="panel"><h2>Strict checking</h2>
        <p class="muted">QR codes made before signing keys existed carry an older, weaker signature. They still verify while strict checking is off.</p>
        ${d.older_documents ? `<div class="notice">${esc(d.older_documents)} active document${d.older_documents > 1 ? 's were' : ' was'} issued before key 1. Printed copies of ${d.older_documents > 1 ? 'those' : 'that one'} may carry the older QR, which strict checking refuses. Reissue or reprint them first.</div>` : '<div class="notice ok">Every active document was issued under a signing key, so strict checking is safe to turn on.</div>'}
        <p>Strict checking is <strong>${d.sig_strict ? 'on' : 'off'}</strong>.</p>
        <button class="btn${d.sig_strict ? ' secondary' : ''}" id="strict">${d.sig_strict ? 'Turn strict checking off' : 'Turn strict checking on'}</button></div>
      <div class="panel"><h2>Graduate portal claim codes</h2>
        <p class="muted">With claim codes required, a graduate can only open a portal account for a matric number with the one-off code you give them. Without it, anyone who knows a matric number could see that graduate's documents and who verified them.</p>
        <p>Claim codes are <strong>${d.student_claim_required ? 'required' : 'not required'}</strong>.</p>
        <button class="btn${d.student_claim_required ? ' danger' : ''}" id="claims">${d.student_claim_required ? 'Stop requiring claim codes' : 'Require claim codes'}</button></div>
      <div class="panel"><h2>What verifiers see</h2>
        <p class="muted">After a verifier pays or the graduate uses a credit, the verify page always shows the document ID, ${esc(S.tenant.name)} as issuer, the document type, issue date and status. Choose what else it shows. Less is safer for graduates; more saves verifiers a phone call.</p>
        <form id="dis-f"><div class="checks">${Object.entries(dis.fields).map(([k, f]) => `<label><input type="checkbox" name="${esc(k)}"${dis.disclosure[k] ? ' checked' : ''}/> <span>${esc(f.label)}</span></label>`).join('')}</div>
        <button class="btn" type="submit" style="margin-top:12px">Save</button></form></div>`;
    $('dis-f').onsubmit = async e => {
      e.preventDefault();
      const body = {}; Object.keys(dis.fields).forEach(k => { body[k] = e.target.elements[k].checked; });
      try { await api('/settings/disclosure', { method: 'PATCH', body }); toast('Saved. The verify page uses this straight away.'); }
      catch (err) { toast(err.message); }
    };
    const save = (body, msg) => api('/settings/security', { method: 'PATCH', body }).then(() => { toast(msg); render(); });
    $('rotate').onclick = () => modal({
      title: 'Rotate QR signing key', submit: 'Rotate key',
      lead: `New QR codes, and every PDF downloaded from now on, use key ${active ? active.kid + 1 : 1}. QR codes already printed with older keys keep verifying. Do this once a year, when staff with access leave, or if you suspect a problem.`,
      onSubmit: async () => { await api('/settings/security/rotate-key', { method: 'POST' }); toast('Key rotated.'); render(); },
    });
    $('strict').onclick = () => modal({
      title: d.sig_strict ? 'Turn strict checking off' : 'Turn strict checking on',
      submit: d.sig_strict ? 'Turn off' : 'Turn on', danger: !d.sig_strict && d.older_documents > 0,
      lead: d.sig_strict ? 'Older QR codes will verify again.'
        : 'Scans of older QR codes will be refused and the verifier is told to ask the holder for a reissued copy.',
      onSubmit: () => save({ sig_strict: !d.sig_strict }, d.sig_strict ? 'Strict checking off.' : 'Strict checking on.'),
    });
    $('claims').onclick = () => modal({
      title: d.student_claim_required ? 'Stop requiring claim codes' : 'Require claim codes',
      submit: d.student_claim_required ? 'Stop requiring' : 'Require', danger: d.student_claim_required,
      lead: d.student_claim_required
        ? 'Anyone who knows a matric number will be able to open a portal account for it and see that graduate\'s documents. Only do this for a demonstration.'
        : 'New accounts need a claim code. Existing accounts that never used one must enter a code before they see documents again.',
      onSubmit: () => save({ student_claim_required: !d.student_claim_required }, 'Saved.'),
    });
  };

  // ── Student records: SIS connection and uploaded lists ─────────────────
  V['/students'] = async (el) => {
    if (!has('owner')) { el.innerHTML = '<div class="panel empty">Only an Owner can manage student records.</div>'; return; }
    const d = await api('/students');
    const sis = d.sis;
    const AUTH = { bearer: 'API token (Bearer)', basic: 'Username and password (Basic)', none: 'None (testing only)' };
    const sisState = !sis.configured ? 'Not connected.'
      : `${sis.enabled ? 'Switched on' : 'Saved but switched off'}.` +
        (sis.last_ok_at ? ` Last answered ${fmtTime(sis.last_ok_at)}.` : ' Not reached yet.');
    el.innerHTML = `
      <div class="page-head"><div><h1>Student records</h1><div class="sub">Who ${esc(S.tenant.name)} can issue documents to, and the details printed on them</div></div></div>
      <div class="panel"><h2>Registered students only</h2>
        <p class="muted">When issuing, staff type a matric number and the form fills from your student records. With this on, a document can only be issued to a matric number found there, with the same name. Awards (certificates, diplomas, completion) always need status Graduated or Completed when the record gives a status. Transcripts and other records of study can be issued at any stage of study.</p>
        <p>Registered students only is <strong>${d.require_registered ? 'on' : 'off'}</strong>.</p>
        <button class="btn${d.require_registered ? ' secondary' : ''}" id="st-req">${d.require_registered ? 'Turn off' : 'Turn on'}</button></div>
      <div class="panel"><h2>Student information system (SIS)</h2>
        <p class="muted">Looked up live, one matric number at a time, whenever staff issue. Nothing is copied or stored from it. Your SIS team implements the UniVerify SIS API (one read-only address that returns a student by matric number).</p>
        <div class="notice${sis.last_error ? ' bad' : sis.enabled ? ' ok' : ''}">${esc(sisState)}${sis.last_error ? ' Last error: ' + esc(sis.last_error) : ''}</div>
        <form id="sis-f"><div class="form-grid">
          <div class="field full"><label for="sis-url">SIS address</label><input type="text" id="sis-url" name="base_url" value="${esc(sis.base_url || '')}" placeholder="https://sis.example.edu.ng/univerify"/>
            <div class="hint">UniVerify calls this address followed by /students/ and the matric number.</div></div>
          <div class="field"><label for="sis-auth">Sign-in</label><select id="sis-auth" name="auth_type">
            ${Object.entries(AUTH).map(([k, v]) => `<option value="${k}"${(sis.auth_type || 'bearer') === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
          <div class="field"><label for="sis-secret">Token or username:password</label><input id="sis-secret" name="secret" type="password" autocomplete="new-password"
            placeholder="${sis.has_secret ? 'Saved. Leave empty to keep it' : ''}"/><div class="hint">Stored encrypted. Nobody can read it back.</div></div>
          <div class="field"><label for="sis-to">Wait for an answer (seconds)</label><input type="text" id="sis-to" name="timeout" inputmode="numeric" value="${esc(Math.round((sis.timeout_ms || 5000) / 1000))}"/></div>
          <div class="field"><label>&nbsp;</label><label style="font-weight:400"><input type="checkbox" name="enabled"${sis.enabled || !sis.configured ? ' checked' : ''}/> Use it when issuing</label></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="submit">Save connection</button>
          ${sis.configured ? '<button class="btn secondary" type="button" id="sis-test">Test with a matric number</button><button class="btn danger" type="button" id="sis-del">Remove</button>' : ''}</div>
        </form></div>
      <div class="panel"><h2>Uploaded student lists</h2>
        <p class="muted">For students the SIS doesn't answer for, or before it's connected: the convocation list, or this month's transcript requests. Only the details printed on documents and the student's status are kept. Each record is deleted 30 days after its first document is issued, and after 180 days at most.</p>
        <p>${esc(d.records.total)} student record${d.records.total === 1 ? '' : 's'} held, ${esc(d.records.waiting)} not yet issued.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><button class="btn" id="st-up">Upload list</button>
          <a class="btn secondary" href="/app-api/students/template.csv">Download template</a></div>
        ${d.lists.length ? `<div class="table-wrap"><table><thead><tr><th>File</th><th>Rows</th><th>Still held</th><th>Issued</th><th>Uploaded</th><th></th></tr></thead><tbody>
          ${d.lists.map(l => `<tr><td>${esc(l.file_name)}</td><td>${esc(l.row_count)}</td><td>${esc(l.remaining)}</td><td>${esc(l.issued)}</td>
            <td>${esc(fmtTime(l.created_at))}<br/><span class="muted">${esc(l.uploaded_by || '')}</span></td>
            <td><button class="btn secondary sm" data-del-list="${esc(l.id)}" data-name="${esc(l.file_name)}">Delete</button></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No lists uploaded.</div>'}</div>`;

    $('st-req').onclick = () => modal({
      title: d.require_registered ? 'Stop requiring registered students' : 'Require registered students',
      submit: d.require_registered ? 'Turn off' : 'Turn on', danger: d.require_registered,
      lead: d.require_registered
        ? 'Staff will be able to issue to matric numbers that aren\'t in your student records. They still see a warning.'
        : 'Documents can only be issued to matric numbers found in the SIS or an uploaded list, with a matching name. Check the SIS answers or a list is uploaded first.',
      onSubmit: async () => { await api('/students/settings', { method: 'PATCH', body: { require_registered: !d.require_registered } }); toast('Saved.'); render(); },
    });
    $('sis-f').onsubmit = async e => {
      e.preventDefault();
      const f = e.target.elements;
      try {
        await api('/students/sis', { method: 'PUT', body: { base_url: f.base_url.value.trim(), auth_type: f.auth_type.value,
          secret: f.secret.value, timeout_ms: (parseInt(f.timeout.value) || 5) * 1000, enabled: f.enabled.checked } });
        toast('SIS connection saved.'); render();
      } catch (err) { toast(err.message); }
    };
    if ($('sis-test')) $('sis-test').onclick = () => modal({
      title: 'Test the SIS connection', submit: 'Test',
      lead: 'UniVerify asks the SIS for one student, exactly as it does when issuing. Nothing is issued or stored.',
      fields: [{ name: 'matric', label: 'Matric number' }],
      onSubmit: async v => {
        const r = await api('/students/sis/test', { method: 'POST', body: { matric: v.matric } });
        const a = $('m-msg');
        if (!r.ok) { a.className = 'alert show err'; a.textContent = 'The SIS did not give a usable answer: ' + r.error; }
        else if (!r.found) { a.className = 'alert show warn'; a.textContent = 'Connected. The SIS says it has no student with that matric number.'; }
        else {
          const x = r.record;
          a.className = 'alert show ok';
          a.textContent = `Connected. ${x.full_name}, ${x.programme || 'no programme given'}, status ${x.status || 'not given'}.`;
        }
        return true;
      },
    });
    if ($('sis-del')) $('sis-del').onclick = () => modal({
      title: 'Remove the SIS connection', submit: 'Remove', danger: true,
      lead: 'Lookups will use uploaded lists only. The saved token is deleted.',
      onSubmit: async () => { await api('/students/sis', { method: 'DELETE' }); toast('SIS connection removed.'); render(); },
    });
    $('st-up').onclick = () => modal({
      title: 'Upload student list', submit: 'Upload',
      lead: 'One row per student. A student already held from an earlier list is replaced by this one.',
      fields: [{ name: 'csv', label: 'CSV file', type: 'file', accept: '.csv,text/csv', asText: true, maxKb: 1500,
                 hint: 'Required columns: matric_number, full_name. Add status so awards can be checked. In Excel use File, Save As, CSV UTF-8.' }],
      onSubmit: async v => {
        if (!v.csv) throw new Error('Choose a CSV file.');
        const r = await api('/students/lists', { method: 'POST', body: { csv: v.csv, file_name: v.csv_name } });
        toast(`${r.added} student${r.added === 1 ? '' : 's'} added${r.skipped_count ? `, ${r.skipped_count} row${r.skipped_count === 1 ? '' : 's'} skipped (first: row ${r.skipped[0].row}, ${r.skipped[0].error})` : ''}.`);
        render();
      },
    });
    el.querySelectorAll('[data-del-list]').forEach(b => b.onclick = () => modal({
      title: 'Delete student list', submit: 'Delete', danger: true,
      lead: `Deletes ${b.dataset.name} and every student record that came from it. Documents already issued are not affected.`,
      onSubmit: async () => { await api('/students/lists/' + encodeURIComponent(b.dataset.delList), { method: 'DELETE' }); toast('List deleted.'); render(); },
    }));
  };

  // ── Print jobs (Phase 4b) ───────────────────────────────────────────────
  const ANCHOR_LABEL = { 'top-left': 'Top left', 'top-right': 'Top right', 'bottom-left': 'Bottom left', 'bottom-right': 'Bottom right' };
  const JOB_LABEL = { assigned: 'Sent', downloaded: 'Downloaded', printed: 'Printed', delivered: 'Delivered', cancelled: 'Cancelled' };
  // Pick a vendor and create a print job for a batch or documents
  async function sendToPrinter(what, label) {
    const { vendors } = await api('/print/vendors');
    if (!vendors.length) {
      modal({ title: 'Send to printer', lead: has('owner')
        ? 'No print vendor has an account yet. Invite your printer under Users and roles with the Print vendor role, then send the job.'
        : 'No print vendor has an account yet. Ask an Owner to invite your printer with the Print vendor role.' });
      return;
    }
    modal({
      title: 'Send to printer', submit: 'Send job',
      lead: `${label}. Only the vendor you pick sees this job. They can download the QR pack up to 3 times within 30 days, and it locks once you confirm delivery.`,
      fields: [
        { name: 'vendor_id', label: 'Print vendor', type: 'select', value: vendors[0].id, options: vendors.map(v => ({ value: v.id, label: v.full_name ? `${v.full_name} (${v.email})` : v.email })) },
        { name: 'note', label: 'Note for the printer (optional)', type: 'textarea', hint: 'For example the paper stock, the delivery date or who collects.' },
      ],
      onSubmit: async v => { await api('/print/jobs', { method: 'POST', body: { ...what, ...v } }); toast('Sent to the printer.'); go('/print'); },
    });
  }

  V['/print'] = async (el) => {
    const [j, sp] = await Promise.all([api('/print/jobs'), api('/print/specs')]);
    const spec = t => sp.specs[t];
    const vendor = vendorOnly();
    const jobRow = x => {
      const acts = [];
      if (vendor) {
        acts.push(x.locked ? `<span class="muted">${esc(x.lock_reason)}</span>` : `<a class="btn sm" href="/app-api/print/jobs/${esc(x.id)}/pack.zip" data-dl>Download pack</a>`);
        if (x.status === 'downloaded') acts.push(`<button class="btn secondary sm" data-move="printed" data-job="${esc(x.id)}">Mark printed</button>`);
      } else {
        if (x.status !== 'cancelled') acts.push(`<a class="btn secondary sm" href="/app-api/print/jobs/${esc(x.id)}/pack.zip">Pack</a>`);
        if (['downloaded', 'printed'].includes(x.status)) acts.push(`<button class="btn sm" data-move="delivered" data-job="${esc(x.id)}">Confirm delivered</button>`);
        if (x.status !== 'cancelled' && (x.locked || x.status === 'delivered')) acts.push(`<button class="btn secondary sm" data-move="reissue" data-job="${esc(x.id)}">Reissue pack</button>`);
        if (['assigned', 'downloaded', 'printed'].includes(x.status)) acts.push(`<button class="btn ghost sm" data-move="cancel" data-job="${esc(x.id)}">Cancel</button>`);
      }
      return `<tr><td>${esc(x.title)}${x.note ? `<div class="muted">${esc(x.note)}</div>` : ''}</td><td>${esc(typeLabel(x.doc_type))}</td><td>${esc(x.documents)}</td>
        ${vendor ? '' : `<td>${esc(x.vendor_name || x.vendor_email)}</td>`}
        <td>${badge('j-' + x.status, JOB_LABEL[x.status])}</td>
        <td>${esc(x.download_count)} of ${esc(x.max_downloads)}${x.last_downloaded_at ? `<div class="muted">${esc(fmtTime(x.last_downloaded_at))}</div>` : ''}</td>
        <td>${esc(fmtDate(x.expires_at))}</td>
        <td><div class="row-actions">${acts.join(' ')}</div></td></tr>`;
    };
    const jobsTable = j.jobs.length ? `<div class="table-wrap"><table><thead><tr><th>Job</th><th>Type</th><th>Documents</th>${vendor ? '' : '<th>Vendor</th>'}<th>Status</th><th>Downloads</th><th>Pack until</th><th></th></tr></thead><tbody>
      ${j.jobs.map(jobRow).join('')}</tbody></table></div>`
      : `<div class="empty">${vendor ? 'No jobs for you yet. The school sends each job to you when it\'s ready to print.' : 'No print jobs yet. Send an issued batch below, or a single document from its page.'}</div>`;
    el.innerHTML = `
      <div class="page-head"><div><h1>Print jobs</h1><div class="sub">${vendor ? `Jobs ${esc(S.tenant.name)} has sent you` : 'QR codes for documents printed by an outside printer'}</div></div></div>
      ${vendor ? `<div class="notice">Each pack holds one QR per document (SVG and 600 dpi PNG), a manifest that says which QR goes on whose document, and the placement spec. You can download a pack ${esc(j.max_downloads)} times. Keep holograms and lamination off the QR, scan a sample before dispatch, mark the job printed, and delete the pack once it's delivered.</div>` : ''}
      <div class="panel"><h2>${vendor ? 'Your jobs' : 'Jobs sent to printers'}</h2>${jobsTable}</div>
      ${!vendor ? `<div class="panel"><h2>Ready to send</h2>
        ${j.unsent.length ? `<div class="table-wrap"><table><thead><tr><th>File</th><th>Type</th><th>Documents</th><th>Issued</th><th></th></tr></thead><tbody>
          ${j.unsent.map(b => `<tr><td>${esc(b.file_name || '')}</td><td>${esc(typeLabel(b.doc_type))}</td><td>${esc(b.issued_count)}</td><td>${esc(fmtTime(b.issued_at))}</td>
            <td><button class="btn sm" data-send="${esc(b.id)}" data-label="${esc(`${b.file_name || 'Batch'}, ${b.issued_count} documents`)}">Send to printer</button></td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">Every issued batch has been sent. New bulk uploads appear here once they\'re issued.</div>'}</div>` : ''}
      <div class="panel"><h2>QR placement by document type</h2>
        <p class="muted">Where the printer puts the QR. Codes are printed with a ${sp.dpi} dpi image or the SVG, and each dot must be at least ${sp.min_module_mm} mm for phones to read it reliably. Holograms and lamination stay at least 5 mm clear of the code.</p>
        <div class="table-wrap"><table><thead><tr><th>Document type</th><th>Paper</th><th>Corner</th><th>From side / edge</th><th>QR size</th><th>Dot size</th><th></th></tr></thead><tbody>
          ${sp.doc_types.map(t => { const s = spec(t); return `<tr><td>${esc(typeLabel(t))}${s.custom ? '' : ' <span class="muted">(default)</span>'}</td>
            <td>${esc(s.paper)}</td><td>${esc(ANCHOR_LABEL[s.anchor])}</td><td>${esc(s.x_mm)} / ${esc(s.y_mm)} mm</td><td>${esc(s.size_mm)} mm</td><td>${esc(s.module_mm)} mm</td>
            <td style="white-space:nowrap"><a class="btn secondary sm" target="_blank" href="/app-api/print/specs/${encodeURIComponent(t)}/sheet.pdf">Spec sheet</a>
            ${has('owner') ? ` <button class="btn ghost sm" data-spec="${esc(t)}">Change</button>` : ''}</td></tr>`; }).join('')}
        </tbody></table></div></div>`;
    el.querySelectorAll('[data-send]').forEach(btn => btn.onclick = () => sendToPrinter({ batch_id: btn.dataset.send }, btn.dataset.label));
    // The count changes on the server; refresh so the row shows it
    el.querySelectorAll('[data-dl]').forEach(a => a.addEventListener('click', () => setTimeout(render, 1500)));
    const MOVE = {
      printed: { title: 'Mark printed', submit: 'Mark printed', lead: 'Tells the school the job is printed. The pack locks for you; ask the school to reissue it if you need to reprint.' },
      delivered: { title: 'Confirm delivered', submit: 'Confirm delivered', lead: 'Locks the pack for the printer. Do this once the printed documents are in your hands.' },
      reissue: { title: 'Reissue pack', submit: 'Reissue', lead: 'Lets the printer download the pack again: the count goes back to 0 and the 30 days start again. Use it for a reprint or a lost file.', reason: true },
      cancel: { title: 'Cancel job', submit: 'Cancel job', danger: true, lead: 'The printer loses access to this job straight away. The documents stay valid.', reason: true },
    };
    el.querySelectorAll('[data-move]').forEach(btn => btn.onclick = () => {
      const mv = MOVE[btn.dataset.move];
      modal({ title: mv.title, submit: mv.submit, danger: mv.danger, lead: mv.lead,
        fields: mv.reason ? [{ name: 'reason', label: 'Reason (optional)', type: 'textarea' }] : [],
        onSubmit: async v => { await api(`/print/jobs/${btn.dataset.job}/${btn.dataset.move}`, { method: 'POST', body: v }); toast('Done.'); render(); } });
    });
    el.querySelectorAll('[data-spec]').forEach(btn => btn.onclick = () => {
      const t = btn.dataset.spec, s = spec(t);
      modal({
        title: 'QR placement: ' + typeLabel(t), submit: 'Save',
        lead: 'Measure on a printed sample of this document. Distances run from the chosen corner to the nearest edge of the QR.',
        fields: [
          { name: 'paper', label: 'Paper', type: 'select', value: s.paper, options: sp.papers.map(p => ({ value: p, label: p })) },
          { name: 'anchor', label: 'Corner', type: 'select', value: s.anchor, options: sp.anchors.map(a => ({ value: a, label: ANCHOR_LABEL[a] })) },
          { name: 'x_mm', label: 'From the side edge (mm)', type: 'number', value: String(s.x_mm) },
          { name: 'y_mm', label: 'From the top or bottom edge (mm)', type: 'number', value: String(s.y_mm) },
          { name: 'size_mm', label: 'QR size (mm)', type: 'number', value: String(s.size_mm), hint: '30 mm is a safe default. Smaller codes are refused when the dots would be too small to scan.' },
          { name: 'notes', label: 'Notes for the printer (optional)', type: 'textarea', value: s.notes },
        ],
        onSubmit: async v => { await api('/print/specs/' + encodeURIComponent(t), { method: 'PUT', body: v }); toast('Placement saved.'); render(); },
      });
    });
  };

  // ── Scan alerts (Phase 4b) ──────────────────────────────────────────────
  V['/alerts'] = async (el, q) => {
    const all = q.get('status') === 'all';
    const d = await api('/alerts' + (all ? '?status=all' : ''));
    el.innerHTML = `
      <div class="page-head"><div><h1>Scan alerts</h1><div class="sub">Scan patterns that may mean a copied or forged QR</div></div>
        <div class="actions"><a class="btn ghost" href="#/alerts${all ? '' : '?status=all'}">${all ? 'Show open alerts only' : 'Show handled alerts too'}</a></div></div>
      <div class="notice">An alert is not proof of fraud. A graduate applying to many employers in one day can trigger one too. Check the document's verification log, contact the graduate if needed, and revoke or reissue if the QR has been copied.</div>
      <div class="panel">${d.alerts.length ? `<div class="table-wrap"><table><thead><tr><th>Raised</th><th>Document</th><th>Holder</th><th>Alert</th><th>Detail</th><th>Status</th><th></th></tr></thead><tbody>
        ${d.alerts.map(a => `<tr><td>${esc(fmtTime(a.created_at))}</td><td class="mono"><a href="#/doc/${encodeURIComponent(a.doc_id)}">${esc(a.doc_id)}</a></td>
          <td>${esc(a.issued_to || '')}</td><td>${badge(a.kind === 'tampered' ? 'tampered' : 'superseded', ALERT_LABEL[a.kind] || a.kind)}</td>
          <td>${esc((ALERT_TEXT[a.kind] || (() => ''))(a.detail || {}))}</td>
          <td>${a.acknowledged_at ? `Handled by ${esc(a.acknowledged_by || '')} on ${esc(fmtTime(a.acknowledged_at))}: ${esc(a.note || '')}` : badge('revoked', 'Open')}</td>
          <td>${a.acknowledged_at ? '' : `<button class="btn secondary sm" data-ack="${esc(a.id)}">Mark handled</button>`}</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="empty">${all ? 'No alerts yet.' : 'No open alerts.'}</div>`}</div>`;
    el.querySelectorAll('[data-ack]').forEach(btn => btn.onclick = () => modal({
      title: 'Mark alert handled', submit: 'Mark handled',
      lead: 'The same kind of alert stays quiet for this document for 24 hours after you mark it handled.',
      fields: [{ name: 'note', label: 'What did you check or do?', type: 'textarea' }],
      onSubmit: async v => { await api('/alerts/' + btn.dataset.ack + '/acknowledge', { method: 'POST', body: v }); toast('Alert marked handled.'); render(); },
    }));
  };

  // ── Bulk issue (Phase 3) ────────────────────────────────────────────────
  const BATCH_LABEL = { draft: 'Draft', pending_approval: 'Awaiting approval', issued: 'Issued', rejected: 'Rejected', cancelled: 'Cancelled' };
  const COL_LABEL = { full_name: 'Full name', matric_number: 'Matric number', title: 'Title', programme: 'Programme', faculty: 'Faculty',
    department: 'Department', degree_class: 'Class of degree', graduation_year: 'Graduation year', entry_year: 'Entry year', expiry_date: 'Expiry date' };

  V['/batches'] = async (el, q) => {
    const page = parseInt(q.get('page')) || 1;
    const d = await api('/batches?page=' + page);
    const appr = d.approval_required;
    el.innerHTML = `
      <div class="page-head"><div><h1>Bulk issue</h1><div class="sub">Issue a whole class list from one CSV file, up to ${esc(d.max_rows)} rows at a time</div></div>
        <div class="actions"><a class="btn secondary" href="/app-api/batches/template.csv">Download template</a>
        ${canIssue() ? '<button class="btn" id="b-up">Upload CSV</button>' : ''}</div></div>
      <div class="panel"><div class="slot-head"><div><h2>Approval before issue: ${appr ? 'On' : 'Off'}</h2>
          <p class="muted" style="margin:6px 0 0">${appr
            ? 'A batch waits until an Owner or Approver who didn\'t prepare it approves it. Nothing is issued before then.'
            : 'Submitting a batch issues its documents straight away. An Owner can switch on a second pair of eyes.'}</p></div>
        ${has('owner') ? `<button class="btn secondary sm" id="b-appr">${appr ? 'Turn off' : 'Turn on'}</button>` : ''}</div></div>
      <div class="panel">${d.data.length ? `<div class="table-wrap"><table><thead><tr><th>Uploaded</th><th>File</th><th>Type</th><th>Rows</th><th>Status</th><th>By</th></tr></thead><tbody>
        ${d.data.map(b => `<tr class="click" data-batch="${esc(b.id)}"><td>${esc(fmtTime(b.created_at))}</td><td>${esc(b.file_name)}</td>
          <td>${esc(typeLabel(b.doc_type))}</td>
          <td>${b.status === 'issued' ? `${esc(b.issued_count)} issued` : `${esc(b.valid_count)} ready`}${b.error_count ? ` · <span class="bad-text">${esc(b.error_count)} with errors</span>` : ''}</td>
          <td>${badge('b-' + b.status, BATCH_LABEL[b.status])}</td><td>${esc(b.created_by_name || b.created_by_email || '')}</td></tr>`).join('')}
        </tbody></table></div>${pager(d.page, d.limit, d.total, p => go('/batches', { page: p }))}`
        : '<p class="muted">No uploads yet. Download the template, fill one row per graduate, save it as CSV, then upload it here. Nothing is issued until you check the rows and confirm.</p>'}</div>`;
    el.querySelectorAll('tr[data-batch]').forEach(tr => tr.onclick = () => go('/batch/' + tr.dataset.batch));
    if ($('b-up')) $('b-up').onclick = () => modal({
      title: 'Upload CSV', submit: 'Check file',
      lead: 'Every row is checked first. You see the results before anything is issued.',
      fields: [
        { name: 'doc_type', label: 'Document type for every row', type: 'select', value: 'Certificate',
          options: d.doc_types.map(t => ({ value: t, label: typeLabel(t) })) },
        { name: 'csv', label: 'CSV file', type: 'file', accept: '.csv,text/csv', asText: true, maxKb: 1500,
          hint: 'Required columns: full_name, matric_number, title. In Excel use File, Save As, CSV UTF-8.' },
      ],
      onSubmit: async v => {
        if (!v.csv) throw new Error('Choose a CSV file.');
        const r = await api('/batches', { method: 'POST', body: { doc_type: v.doc_type, csv: v.csv, file_name: v.csv_name } });
        if (r.ignored_columns && r.ignored_columns.length) sessionStorage.setItem('uv-ignored-' + r.batch.id, r.ignored_columns.join(', '));
        go('/batch/' + r.batch.id);
      },
    });
    if ($('b-appr')) $('b-appr').onclick = () => modal({
      title: appr ? 'Turn approval off' : 'Turn approval on', submit: appr ? 'Turn off' : 'Turn on', danger: appr,
      lead: appr ? 'New batches will issue as soon as they are submitted. Batches already waiting still need a decision.'
                 : 'Every batch will need an Owner or Approver, other than the person who prepared it, to approve it before anything is issued. Single documents are not affected.',
      onSubmit: async () => { await api('/settings/approval', { method: 'PATCH', body: { approval_required: !appr } }); toast(appr ? 'Approval turned off.' : 'Approval turned on.'); render(); },
    });
  };

  V['/batch'] = async (el, q, id) => {
    const d = await api('/batches/' + encodeURIComponent(id));
    const b = d.batch;
    const who = uid => { const u = d.users.find(x => x.id === uid); return u ? (u.full_name || u.email) : ''; };
    const warnCount = d.rows.filter(r => r.warnings.length && !r.errors.length).length;
    const onlyProblems = q.get('show') === 'problems';
    const rows = onlyProblems ? d.rows.filter(r => r.errors.length || r.warnings.length) : d.rows;
    const mine = b.created_by === S.user.id || b.submitted_by === S.user.id;
    const canDecide = has('owner', 'approver') && !mine;
    const ignored = sessionStorage.getItem('uv-ignored-' + b.id);
    const base = '/app-api/batches/' + encodeURIComponent(b.id);

    const actions = [];
    if (b.status === 'draft' && canIssue() && b.valid_count)
      actions.push(`<button class="btn" id="bt-submit">${d.approval_required ? `Submit ${b.valid_count} for approval` : `Issue ${b.valid_count} document${b.valid_count > 1 ? 's' : ''}`}</button>`);
    if (b.status === 'pending_approval' && canDecide)
      actions.push('<button class="btn" id="bt-approve">Approve and issue</button>', '<button class="btn danger" id="bt-reject">Reject</button>');
    if (['draft', 'pending_approval'].includes(b.status) && canIssue() && (b.created_by === S.user.id || has('owner')))
      actions.push('<button class="btn secondary" id="bt-cancel">Cancel batch</button>');
    if (b.status === 'issued' && canIssue()) actions.push(`<a class="btn" href="${base}/pdfs.zip">Download all PDFs (zip)</a>`);
    if (b.status === 'issued' && canIssue()) actions.push('<button class="btn secondary" id="bt-claims">Graduate claim codes (CSV)</button>');
    if (b.status === 'issued' && canIssue()) actions.push('<button class="btn secondary" id="bt-print">Send to printer</button>');
    if (b.error_count) actions.push(`<a class="btn secondary" href="${base}/errors.csv">Rows to fix (CSV)</a>`);

    let note = '';
    if (b.status === 'draft') note = b.valid_count
      ? `${b.valid_count} row${b.valid_count > 1 ? 's are' : ' is'} ready. ${b.error_count ? `${b.error_count} row${b.error_count > 1 ? 's have' : ' has'} errors and will be skipped; download them, fix them and upload them as a new file.` : ''} Nothing has been issued yet.`
      : 'No row is ready to issue. Download the rows to fix, correct them and upload the file again.';
    if (b.status === 'pending_approval') note = `Submitted by ${who(b.submitted_by)} on ${fmtTime(b.submitted_at)}. ${canDecide ? 'Check the rows, then approve or reject.' : 'Waiting for an Owner or Approver who didn\'t prepare it.'}`;
    if (b.status === 'issued') note = `${b.issued_count} document${b.issued_count > 1 ? 's' : ''} issued on ${fmtTime(b.issued_at)}${b.decided_by ? `, approved by ${who(b.decided_by)}` : ''}. Each one has its own QR code and appears under Documents.`;
    if (b.status === 'rejected') note = `Rejected by ${who(b.decided_by)} on ${fmtTime(b.decided_at)}: ${b.decision_note || ''}`;
    if (b.status === 'cancelled') note = `Cancelled by ${who(b.decided_by)} on ${fmtTime(b.decided_at)}. Nothing was issued.`;

    const wireClaims = () => { if ($('bt-print')) $('bt-print').onclick = () => sendToPrinter({ batch_id: b.id }, `${b.file_name}, ${b.issued_count} documents`);
      if ($('bt-claims')) $('bt-claims').onclick = () => modal({
      title: 'Graduate claim codes', submit: 'Create codes',
      lead: 'Makes a fresh claim code for every graduate in this batch and downloads them as a CSV, so you can send each graduate their own code. Any earlier code for these graduates that hasn\'t been used stops working. Keep the file safe and delete it once the codes are sent.',
      onSubmit: async () => {
        const r = await fetch(base + '/claim-codes.csv', { method: 'POST', credentials: 'same-origin' });
        if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'Failed to create claim codes.'); }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(await r.blob());
        a.download = `claim-codes-${b.id.slice(0, 8)}.csv`; a.click();
        toast('Claim codes downloaded.');
      },
    }); };
    el.innerHTML = `
      <div class="page-head"><div><h1>${esc(b.file_name)}</h1><div class="sub">${esc(typeLabel(b.doc_type))} · uploaded by ${esc(who(b.created_by))} on ${esc(fmtTime(b.created_at))}</div></div>
        <div class="actions">${badge('b-' + b.status, BATCH_LABEL[b.status])}</div></div>
      <div class="notice${b.status === 'rejected' ? ' bad' : b.status === 'issued' ? ' ok' : ''}">${esc(note)}</div>
      ${ignored ? `<div class="notice">These columns weren't recognised and were ignored: ${esc(ignored)}.</div>` : ''}
      <div class="cards">
        <div class="card"><div class="k">Rows</div><div class="v">${esc(b.row_count)}</div></div>
        <div class="card"><div class="k">${b.status === 'issued' ? 'Issued' : 'Ready'}</div><div class="v">${esc(b.status === 'issued' ? b.issued_count : b.valid_count)}</div></div>
        <div class="card${b.error_count ? ' alert-card' : ''}"><div class="k">Errors (skipped)</div><div class="v">${esc(b.error_count)}</div></div>
        <div class="card"><div class="k">Warnings</div><div class="v">${esc(warnCount)}</div></div>
      </div>
      ${actions.length ? `<div class="panel"><div class="actions" style="display:flex;gap:8px;flex-wrap:wrap">${actions.join('')}</div></div>` : ''}
      <div class="panel"><div class="slot-head"><h2>Rows</h2>
        <a class="btn ghost sm" href="#/batch/${esc(b.id)}${onlyProblems ? '' : '?show=problems'}">${onlyProblems ? 'Show all rows' : 'Show only rows with problems'}</a></div>
        <div class="table-wrap"><table><thead><tr><th>Row</th><th>Full name</th><th>Matric number</th><th>Title</th><th>Class</th><th>Result</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td>${esc(r.row_no)}</td><td>${esc(r.data.full_name || '')}</td><td class="mono">${esc(r.data.matric_number || '')}</td>
          <td>${esc(r.data.title || '')}</td><td>${esc(r.data.degree_class || '')}</td>
          <td>${r.doc_id ? `<a class="mono" href="#/doc/${encodeURIComponent(r.doc_id)}">${esc(r.doc_id)}</a>`
              : r.errors.length ? `<span class="bad-text">${esc(r.errors.join(' '))}</span>`
              : b.status === 'draft' || b.status === 'pending_approval' ? badge('active', 'Ready') : '<span class="muted">Not issued</span>'}
            ${r.warnings.length ? `<div class="warn-text">${esc(r.warnings.join(' '))}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No rows with problems.</td></tr>'}
        </tbody></table></div></div>`;

    const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (err) { toast(err.message); btn.disabled = false; } };
    wireClaims();
    if ($('bt-submit')) $('bt-submit').onclick = () => modal({
      title: d.approval_required ? 'Submit for approval' : `Issue ${b.valid_count} documents`, submit: d.approval_required ? 'Submit' : 'Issue now',
      lead: d.approval_required
        ? 'An Owner or Approver will check this batch. Nothing is issued until they approve it.'
        : `This creates ${b.valid_count} live ${typeLabel(b.doc_type)} records, each with its own QR code.${b.error_count ? ` The ${b.error_count} rows with errors are skipped.` : ''} A wrong record can be revoked or reissued later, but not deleted.`,
      onSubmit: async () => {
        const r = await api('/batches/' + b.id + '/submit', { method: 'POST' });
        toast(r.status === 'issued' ? `${r.issued} documents issued.` : 'Sent for approval.'); render();
      },
    });
    if ($('bt-approve')) $('bt-approve').onclick = () => modal({
      title: 'Approve and issue', submit: `Issue ${b.valid_count} documents`,
      lead: `This issues ${b.valid_count} ${typeLabel(b.doc_type)} records at once, each with its own QR code.`,
      fields: [{ name: 'note', label: 'Note (optional)', type: 'textarea' }],
      onSubmit: async v => { const r = await api('/batches/' + b.id + '/approve', { method: 'POST', body: v }); toast(`${r.issued} documents issued.`); render(); },
    });
    if ($('bt-reject')) $('bt-reject').onclick = () => modal({
      title: 'Reject batch', submit: 'Reject', danger: true,
      lead: 'Nothing is issued. The person who prepared it sees your reason and uploads a corrected file.',
      fields: [{ name: 'note', label: 'Reason', type: 'textarea' }],
      onSubmit: async v => { await api('/batches/' + b.id + '/reject', { method: 'POST', body: v }); toast('Batch rejected.'); render(); },
    });
    if ($('bt-cancel')) $('bt-cancel').onclick = () => modal({
      title: 'Cancel batch', submit: 'Cancel batch', danger: true, lead: 'Nothing in it is issued. It stays in the list as cancelled.',
      onSubmit: async () => { await api('/batches/' + b.id + '/cancel', { method: 'POST' }); toast('Batch cancelled.'); render(); },
    });
  };

  // ── Support tickets ─────────────────────────────────────────────────────
  const TICKET_LABEL = { open: 'Waiting on UniVerify', answered: 'Answered', resolved: 'Resolved', closed: 'Closed' };
  const TICKET_BADGE = { open: 'superseded', answered: 'active', resolved: 'b-issued', closed: 'b-cancelled' };
  const CAT_LABEL = { technical: 'Something isn\'t working', documents: 'Documents and QR codes', account: 'Users and sign-in', billing: 'Payments and payouts', other: 'Something else' };

  V['/support'] = async (el) => {
    const d = await api('/support');
    el.innerHTML = `
      <div class="page-head"><div><h1>Support</h1><div class="sub">Ask the UniVerify team for help. Everyone on your staff can see and follow your school's tickets.</div></div>
        <div class="actions"><button class="btn" id="t-new">New ticket</button></div></div>
      <div class="notice">Don't put passwords, authenticator codes or students' personal details in a ticket. A document ID or matric number is enough for us to find a record.</div>
      <div class="panel">${d.tickets.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Subject</th><th>Category</th><th>Opened by</th><th>Status</th><th>Updated</th></tr></thead><tbody>
        ${d.tickets.map(t => `<tr class="click" data-ticket="${esc(t.id)}"><td class="mono">${esc(t.ticket_no)}</td>
          <td>${esc(t.subject)}${t.priority === 'urgent' ? ' ' + badge('revoked', 'Urgent') : ''}</td><td>${esc(CAT_LABEL[t.category] || t.category)}</td>
          <td>${esc(t.created_by_name || '')}</td><td>${badge(TICKET_BADGE[t.status], TICKET_LABEL[t.status])}</td><td>${esc(fmtTime(t.updated_at))}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No tickets yet. If something isn\'t working or you have a question, open one and we\'ll reply here and by email.</div>'}</div>`;
    el.querySelectorAll('tr[data-ticket]').forEach(tr => tr.onclick = () => go('/support/' + tr.dataset.ticket));
    $('t-new').onclick = () => modal({
      title: 'New support ticket', submit: 'Send ticket',
      lead: 'We reply here and email you when we do.',
      fields: [
        { name: 'category', label: 'What is it about?', type: 'select', value: 'technical', options: Object.entries(CAT_LABEL).map(([value, label]) => ({ value, label })) },
        { name: 'subject', label: 'Subject', hint: 'For example: Bulk upload stops at row 40' },
        { name: 'message', label: 'What happened?', type: 'textarea', hint: 'What you did, what you expected, and what you saw instead. Include a document ID if it\'s about one.' },
        { name: 'priority', label: 'Is it blocking you?', type: 'select', value: 'normal', options: [{ value: 'normal', label: 'No, normal priority' }, { value: 'urgent', label: 'Yes, we can\'t issue or verify' }] },
      ],
      onSubmit: async v => { const r = await api('/support', { method: 'POST', body: v }); toast('Ticket sent. We\'ll reply here.'); go('/support/' + r.ticket.id); },
    });
  };

  V['/support/ticket'] = async (el, q, id) => {
    const d = await api('/support/' + encodeURIComponent(id));
    const t = d.ticket, closed = t.status === 'closed';
    el.innerHTML = `
      <div class="page-head"><div><h1>#${esc(t.ticket_no)}: ${esc(t.subject)}</h1>
        <div class="sub">${esc(CAT_LABEL[t.category] || t.category)} · opened by ${esc(t.created_by_name || '')} on ${esc(fmtTime(t.created_at))} · ${badge(TICKET_BADGE[t.status], TICKET_LABEL[t.status])}</div></div>
        <div class="actions"><a class="btn ghost" href="#/support">All tickets</a>${closed ? '' : '<button class="btn secondary" id="t-close">Close ticket</button>'}</div></div>
      <div class="panel thread">${d.messages.map(m => `<div class="msg ${m.author_kind === 'support' ? 'from-support' : 'from-school'}">
          <div class="msg-head"><strong>${esc(m.author_name)}</strong> <span class="muted">${esc(fmtTime(m.created_at))}</span></div>
          <div class="msg-body">${esc(m.body)}</div></div>`).join('')}</div>
      ${closed ? '<div class="notice">This ticket is closed. Open a new one if you need more help.</div>' : `<div class="panel"><form id="t-reply">
        <div class="field"><label for="t-msg">Reply</label><textarea id="t-msg" name="message" rows="4" required></textarea></div>
        ${t.status === 'resolved' ? '<p class="muted">We marked this resolved. Replying reopens it.</p>' : ''}
        <button class="btn" type="submit">Send reply</button></form></div>`}`;
    if ($('t-close')) $('t-close').onclick = () => modal({
      title: 'Close ticket', submit: 'Close ticket', lead: 'Close it once it\'s sorted. You can\'t reply to a closed ticket.',
      onSubmit: async () => { await api('/support/' + t.id + '/close', { method: 'POST', body: {} }); toast('Ticket closed.'); render(); },
    });
    if ($('t-reply')) $('t-reply').onsubmit = async e => {
      e.preventDefault();
      try { await api('/support/' + t.id + '/reply', { method: 'POST', body: { message: e.target.message.value } }); toast('Reply sent.'); render(); }
      catch (err) { toast(err.message); }
    };
  };

  // ── Router ──────────────────────────────────────────────────────────────
  async function render() {
    const { path, q } = routeParams();
    const el = $('view');
    let view, arg;
    if (path.startsWith('/doc/')) { view = V['/doc']; arg = decodeURIComponent(path.slice(5)); }
    else if (path.startsWith('/batch/')) { view = V['/batch']; arg = decodeURIComponent(path.slice(7)); }
    else if (path.startsWith('/support/')) { view = V['/support/ticket']; arg = decodeURIComponent(path.slice(9)); }
    else view = V[path];
    if (!view) { go(vendorOnly() ? '/print' : '/dashboard'); return; }
    if (vendorOnly() && path !== '/print') { go('/print'); return; }
    renderNav(path.startsWith('/doc/') ? '/documents' : path.startsWith('/batch/') ? '/batches' : path.startsWith('/support/') ? '/support' : path);
    $('side').classList.remove('open');
    el.innerHTML = '<div class="empty">Loading...</div>';
    try { await view(el, q, arg); }
    catch (err) { el.innerHTML = `<div class="panel"><div class="alert show err">${esc(err.message)}</div></div>`; }
  }

  // Row clicks open the document
  document.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-doc]');
    if (tr && !e.target.closest('a,button')) go('/doc/' + tr.dataset.doc);
  });

  // ── Boot ────────────────────────────────────────────────────────────────
  (async function boot() {
    try {
      const me = await api('/auth/me');
      S.user = me.user; S.tenant = me.tenant;
      S.meta = await api('/meta');
    } catch (e) { return; }
    const root = document.documentElement.style;
    if (S.tenant.primary_colour) root.setProperty('--brand', S.tenant.primary_colour);
    if (S.tenant.accent_colour) root.setProperty('--accent', S.tenant.accent_colour);
    document.title = S.tenant.name + ' · Records workspace';
    $('brand-name').textContent = S.tenant.name;
    setSideLogo(S.tenant.logo_version);
    $('acct-name').textContent = S.user.full_name || S.user.email;
    $('acct-roles').textContent = S.user.roles.map(r => ROLE_LABEL[r] || r).join(', ');
    $('shell').style.display = '';

    $('acct-btn').onclick = () => $('acct-menu').classList.toggle('open');
    document.addEventListener('click', e => { if (!e.target.closest('.acct')) $('acct-menu').classList.remove('open'); });
    $('menu-btn').onclick = () => $('side').classList.toggle('open');
    $('m-signout').onclick = async () => {
      await fetch('/app-api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      location.href = '/app/login.html';
    };
    $('m-password').onclick = () => modal({
      title: 'Change password', submit: 'Change password',
      fields: [
        { name: 'current_password', label: 'Current password', type: 'password' },
        { name: 'new_password', label: 'New password', type: 'password', hint: 'At least 10 characters, with letters and numbers.' },
      ],
      onSubmit: async v => { await api('/auth/password', { method: 'POST', body: v }); toast('Password changed.'); },
    });
    if (vendorOnly()) $('top-search').style.visibility = 'hidden';
    $('top-search').onsubmit = e => { e.preventDefault(); go('/search', { q: $('top-q').value.trim() }); };

    window.addEventListener('hashchange', render);
    render();
  })();
})();
