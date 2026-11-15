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
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const fmtTime = d => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const ROLE_LABEL = { owner: 'Owner', officer: 'Records Officer', approver: 'Approver', auditor: 'Auditor' };
  const STATUS_LABEL = { active: 'Active', revoked: 'Revoked', superseded: 'Superseded', expired: 'Expired' };
  const RESULT_LABEL = { found: 'Verified', revoked: 'Revoked', superseded: 'Superseded', not_found: 'Not found', tampered: 'Tampered link' };
  const PAY_LABEL = { none: 'None', student_token: 'Graduate credit', employer_payment: 'Verifier paid', replacement_pdf: 'Graduate download' };
  const ACTION_LABEL = {
    sign_in: 'Signed in', sign_in_recovery_code: 'Signed in with a recovery code', sign_out: 'Signed out',
    password_changed: 'Changed password', account_setup_completed: 'Finished account setup',
    document_issued: 'Issued document', document_revoked: 'Revoked document', document_restored: 'Restored document',
    document_superseded: 'Replaced by reissue', document_reissued: 'Reissued document', pdf_downloaded: 'Downloaded PDF',
    search: 'Searched records', user_invited: 'Invited user', user_roles_changed: 'Changed roles',
    user_enabled: 'Enabled user', user_disabled: 'Disabled user', user_access_reset: 'Reset user access',
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
    $('m-form').onsubmit = async e => {
      e.preventDefault();
      if (!onSubmit) return close();
      const fd = new FormData($('m-form'));
      const values = {};
      fields.forEach(f => { values[f.name] = f.type === 'checks' ? fd.getAll(f.name) : (fd.get(f.name) || '').toString().trim(); });
      const btn = $('m-ok'); btn.disabled = true;
      try { const keep = await onSubmit(values); if (keep !== true) close(); }
      catch (err) { const a = $('m-msg'); a.textContent = err.message; a.className = 'alert show err'; }
      finally { btn.disabled = false; }
    };
    return { close };
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
  const go = (path, params) => { location.hash = '#' + path + (params ? '?' + qs(params) : ''); };

  // ── Navigation ──────────────────────────────────────────────────────────
  const NAV = [
    { group: 'Work' },
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/documents', label: 'Documents' },
    { path: '/issue',     label: 'Issue document', show: canIssue },
    { path: '/search',    label: 'Search' },
    { group: 'Oversight' },
    { path: '/scans',     label: 'Verification log' },
    { path: '/activity',  label: 'Activity log', show: () => has('owner', 'auditor') },
    { group: 'Administration', show: () => has('owner') },
    { path: '/users',     label: 'Users and roles', show: () => has('owner') },
  ];
  function renderNav(active) {
    $('nav').innerHTML = NAV.filter(i => !i.show || i.show()).map(i => i.group
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
    if (doc.superseded_by) rows.push(['Replaced by', `<a href="#/doc/${encodeURIComponent(doc.superseded_by)}" class="mono">${esc(doc.superseded_by)}</a>`]);

    const base = '/app-api/documents/' + encodeURIComponent(doc.doc_id);
    const actions = [];
    if (canIssue()) {
      actions.push(`<a class="btn" href="${base}/pdf">Download PDF</a>`);
      actions.push(`<a class="btn secondary" href="${base}/qr">QR PNG</a>`);
      actions.push(`<a class="btn secondary" href="${base}/qr?size=print">QR PNG (print)</a>`);
    }
    actions.push(`<button class="btn secondary" id="copy-verify">Copy verify link</button>`);
    if (canIssue() && ['active', 'revoked'].includes(doc.status)) actions.push(`<a class="btn secondary" href="#/issue?reissue=${encodeURIComponent(doc.doc_id)}">Reissue / correct</a>`);
    if (canIssue() && doc.status === 'active') actions.push(`<button class="btn danger" id="revoke">Revoke</button>`);
    if (has('owner') && d.can_restore) actions.push(`<button class="btn secondary" id="restore">Restore</button>`);

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
      <form id="issue-form"><div class="form-grid">
        <div class="field"><label for="i-doc_type">Document type *</label><select id="i-doc_type" name="doc_type">
          ${S.meta.doc_types.map(t => `<option value="${esc(t)}"${(pre.doc_type || 'Certificate') === t ? ' selected' : ''}>${esc(typeLabel(t))}</option>`).join('')}</select></div>
        ${input('title', 'Document title', pre.title, { req: true, attrs: 'placeholder="e.g. Bachelor of Science in Computer Science"' })}
        ${input('issued_to', 'Graduate full name', pre.issued_to, { req: true })}
        ${input('matric_number', 'Matric number', m.matric_number, { req: true, attrs: 'style="text-transform:uppercase"' })}
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

  // ── Router ──────────────────────────────────────────────────────────────
  async function render() {
    const { path, q } = routeParams();
    const el = $('view');
    let view, arg;
    if (path.startsWith('/doc/')) { view = V['/doc']; arg = decodeURIComponent(path.slice(5)); }
    else view = V[path];
    if (!view) { go('/dashboard'); return; }
    renderNav(path.startsWith('/doc/') ? '/documents' : path);
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
    // Logo upload arrives in Phase 2; external logo URLs are blocked by the CSP
    $('brand-logo').innerHTML = `<div class="mono">${esc(S.tenant.short_code || '')}</div>`;
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
    $('top-search').onsubmit = e => { e.preventDefault(); go('/search', { q: $('top-q').value.trim() }); };

    window.addEventListener('hashchange', render);
    render();
  })();
})();
