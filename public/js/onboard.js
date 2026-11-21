  const $ = id => document.getElementById(id);
  const HEX = /^#[0-9A-Fa-f]{6}$/;
  let ROOT = 'demo';
  let suffix = '.univerify.ng';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function toast(msg, isError) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = 'toast'; }, 3000);
  }

  async function api(url, opts) {
    const res = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } }, opts));
    if (res.status === 401) { window.location.href = '/admin-login.html?redirect=/admin/onboard'; throw new Error('auth'); }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  // Local dev shows .localhost, production shows .univerify.ng
  if (location.hostname === 'localhost' || location.hostname.endsWith('.localhost')) {
    suffix = '.localhost' + (location.port ? ':' + location.port : '');
    $('domain-suffix').textContent = suffix;
  }

  // ── AUTO-FILL FROM NAME ─────────────────────────────────────────────────
  let subTouched = false, codeTouched = false;
  const STOP = ['of','the','and','for','in','at'];

  function suggestSub(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
  }
  function suggestCode(name) {
    const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && !STOP.includes(w.toLowerCase()));
    const initials = words.map(w => w[0]).join('').toUpperCase();
    return (initials.length >= 2 ? initials : name.replace(/[^A-Za-z0-9]/g, '')).toUpperCase().slice(0, 8);
  }

  $('f-name').addEventListener('input', () => {
    const name = $('f-name').value.trim();
    if (!codeTouched) $('f-short').value = suggestCode(name);
    if (!subTouched)  $('f-subdomain').value = suggestCode(name).toLowerCase() || suggestSub(name);
    updatePreview(); scheduleAvail();
  });
  $('f-subdomain').addEventListener('input', () => {
    subTouched = true;
    $('f-subdomain').value = $('f-subdomain').value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    updatePreview(); scheduleAvail();
  });
  $('f-short').addEventListener('input', () => {
    codeTouched = true;
    $('f-short').value = $('f-short').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    updatePreview(); scheduleAvail();
  });

  // ── COLOURS ─────────────────────────────────────────────────────────────
  [['f-primary-pick','f-primary'],['f-accent-pick','f-accent']].forEach(([pick, text]) => {
    $(pick).addEventListener('input', () => { $(text).value = $(pick).value.toUpperCase(); updatePreview(); });
    $(text).addEventListener('input', () => { if (HEX.test($(text).value)) $(pick).value = $(text).value; updatePreview(); });
  });

  function updatePreview() {
    const p = $('f-primary').value, a = $('f-accent').value;
    if (HEX.test(p)) $('pv-bar').style.background = p;
    if (HEX.test(a)) $('pv-btn').style.background = a;
    $('pv-name').textContent  = $('f-name').value.trim() || 'Institution name';
    $('pv-url').textContent   = ($('f-subdomain').value || 'subdomain') + suffix;
    $('pv-docid').textContent = ($('f-short').value || 'CODE') + '-XXXXXXXX-XXXXXXXX';
  }

  // ── AVAILABILITY ────────────────────────────────────────────────────────
  let availTimer;
  function scheduleAvail() { clearTimeout(availTimer); availTimer = setTimeout(checkAvail, 350); }
  async function checkAvail() {
    const sub = $('f-subdomain').value, code = $('f-short').value;
    if (!sub && !code) { $('sub-avail').textContent = ''; $('code-avail').textContent = ''; return; }
    try {
      const q = new URLSearchParams({ subdomain: sub, short_code: code });
      const { ok, data } = await api('/admin-api/tenants/availability?' + q);
      if (!ok) return;
      setAvail('sub-avail', data.subdomain, 'Available', 'Taken, reserved or invalid');
      setAvail('code-avail', data.short_code, 'Available', 'Taken or invalid');
    } catch (e) {}
  }
  function setAvail(id, val, okText, badText) {
    const el = $(id);
    if (val === null) { el.textContent = ''; el.className = 'avail'; return; }
    el.textContent = val ? okText : badText;
    el.className = 'avail ' + (val ? 'ok' : 'bad');
  }

  // ── SUBMIT ──────────────────────────────────────────────────────────────
  function clearErrors() {
    document.querySelectorAll('.form-group.invalid').forEach(g => g.classList.remove('invalid'));
    $('form-err').className = 'form-err';
  }
  function showErrors(fields) {
    Object.entries(fields || {}).forEach(([k, msg]) => {
      const g = document.querySelector('.form-group[data-field="' + k + '"]');
      if (!g) return;
      g.classList.add('invalid');
      g.querySelector('.field-err').textContent = msg;
    });
    const first = document.querySelector('.form-group.invalid input, .form-group.invalid select');
    if (first) first.focus();
  }

  $('onboard-form').addEventListener('submit', async e => {
    e.preventDefault();
    clearErrors();
    const f = e.target;
    const body = {};
    ['name','subdomain','short_code','institution_type','plan','primary_colour','accent_colour',
     'logo_url','contact_email','contact_phone','website','address'].forEach(k => { body[k] = f.elements[k].value.trim(); });
    if ($('sector-row').style.display !== 'none') body.sector = f.elements.sector.value;
    body.presenter_link = $('f-presenter').checked;

    const btn = $('create-btn');
    btn.disabled = true; btn.textContent = 'Creating...';
    try {
      const { ok, data } = await api('/admin-api/tenants', { method: 'POST', body: JSON.stringify(body) });
      if (!ok) {
        showErrors(data.fields);
        $('form-err').textContent = data.error || 'Could not create the institution.';
        $('form-err').className = 'form-err show';
        return;
      }
      showResult(data);
      f.reset();
      subTouched = codeTouched = false;
      $('f-primary-pick').value = '#1A3A5C'; $('f-accent-pick').value = '#B8860B';
      $('sub-avail').textContent = ''; $('code-avail').textContent = '';
      updatePreview();
      loadTenants();
      toast(data.tenant.name + ' is live.');
    } catch (err) {
      if (err.message !== 'auth') {
        $('form-err').textContent = 'Network error. Check your connection and try again.';
        $('form-err').className = 'form-err show';
      }
    } finally {
      btn.disabled = false; btn.textContent = 'Create institution';
    }
  });

  function showResult(data) {
    $('result-title').textContent = data.tenant.name + ' is live';
    $('r-url').textContent = data.tenant.url;
    $('r-url-open').href   = data.tenant.url;
    if (data.presenter_link) {
      $('r-link').textContent = data.presenter_link;
      $('r-link-open').href   = data.presenter_link;
      $('r-link-row').style.display = '';
    } else {
      $('r-link-row').style.display = 'none';
    }
    $('result').className = 'result show';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($(b.dataset.copy).textContent); toast('Copied.'); }
    catch (e) { toast('Copy failed. Select the text instead.', true); }
  }));

  // ── SECTORS ─────────────────────────────────────────────────────────────
  // The school service has one sector, so the picker stays hidden there.
  // The sectors service lists its sectors and the documents each starts with.
  let SECTOR_LABEL = {};
  function showSectors(list) {
    SECTOR_LABEL = Object.fromEntries(list.map(s => [s.key, s.label]));
    const row = $('sector-row'), sel = $('f-sector');
    if (list.length < 2) { row.style.display = 'none'; return; }
    if (!sel.options.length) {
      sel.innerHTML = '<option value="">Choose a sector</option>' +
        list.map(s => '<option value="' + esc(s.key) + '">' + esc(s.label) + '</option>').join('');
      sel.addEventListener('change', () => {
        const s = list.find(x => x.key === sel.value);
        $('sector-hint').textContent = s
          ? 'Starts with: ' + s.doc_types.join(', ') + '. Holder number: ' + s.id_label + '. All editable later.'
          : 'Sets the starting document types, wording and holder number label. All editable later.';
      });
    }
    row.style.display = '';
  }

  // ── LIST ────────────────────────────────────────────────────────────────
  async function loadTenants() {
    const body = $('tenants-body');
    try {
      const { ok, data } = await api('/admin-api/tenants');
      if (!ok) { body.innerHTML = '<tr><td colspan="7" class="empty">' + esc(data.error || 'Failed to load.') + '</td></tr>'; return; }
      ROOT = data.root_subdomain || ROOT;
      showSectors(data.sectors || []);
      if (!data.tenants.length) { body.innerHTML = '<tr><td colspan="7" class="empty">No institutions yet.</td></tr>'; return; }
      body.innerHTML = data.tenants.map(t => {
        const isRoot = t.subdomain === ROOT;
        const status = isRoot ? '<span class="status-badge root">ROOT</span>'
          : t.active ? '<span class="status-badge active">ACTIVE</span>' : '<span class="status-badge inactive">SUSPENDED</span>';
        const action = isRoot ? '' : t.active
          ? '<button class="action-btn suspend" data-toggle="' + esc(t.id) + '" data-active="false" data-name="' + esc(t.name) + '">Suspend</button>'
          : '<button class="action-btn restore" data-toggle="' + esc(t.id) + '" data-active="true" data-name="' + esc(t.name) + '">Restore</button>';
        return '<tr>' +
          '<td><span class="swatch" style="background:' + esc(t.primary_colour || '#1A3A5C') + '"></span><span class="swatch" style="background:' + esc(t.accent_colour || '#B8860B') + '"></span> ' +
            '<strong style="color:#fff">' + esc(t.name) + '</strong><div class="muted">' + esc(t.contact_email || '') + '</div></td>' +
          '<td><a href="' + esc(t.url) + '" target="_blank" rel="noopener">' + esc(t.subdomain) + '</a></td>' +
          '<td>' + esc(t.short_code) + '</td>' +
          '<td>' + esc(SECTOR_LABEL[t.sector] && Object.keys(SECTOR_LABEL).length > 1 ? SECTOR_LABEL[t.sector] : t.institution_type) + '</td>' +
          '<td>' + esc(t.documents) + '</td>' +
          '<td>' + status + '</td>' +
          '<td>' + action + '</td></tr>';
      }).join('');
    } catch (e) {
      if (e.message !== 'auth') body.innerHTML = '<tr><td colspan="7" class="empty">Failed to load.</td></tr>';
    }
  }

  $('tenants-body').addEventListener('click', async e => {
    const b = e.target.closest('[data-toggle]');
    if (!b) return;
    const active = b.dataset.active === 'true';
    if (!active && !confirm('Suspend ' + b.dataset.name + '? Its subdomain will stop working and QR scans will show "No institution found" until you restore it.')) return;
    b.disabled = true;
    const { ok, data } = await api('/admin-api/tenants/' + b.dataset.toggle + '/active', { method: 'PATCH', body: JSON.stringify({ active }) });
    if (!ok) { toast(data.error || 'Update failed.', true); b.disabled = false; return; }
    toast(active ? 'Restored.' : 'Suspended.');
    loadTenants();
  });

  $('refresh-btn').addEventListener('click', loadTenants);
  $('logout-btn').addEventListener('click', async () => {
    await fetch('/admin-api/logout', { method: 'POST' });
    window.location.href = '/admin-login.html';
  });

  updatePreview();
  loadTenants();
