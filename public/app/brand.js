// Shared by the sign-in and setup pages: applies the tenant's name and colours.
(function () {
  window.uvBrand = async function () {
    try {
      const r = await fetch('/api/tenant-info');
      const t = await r.json();
      if (t.primary_colour) document.documentElement.style.setProperty('--brand', t.primary_colour);
      if (t.accent_colour)  document.documentElement.style.setProperty('--accent', t.accent_colour);
      document.querySelectorAll('[data-tenant-name]').forEach(el => {
        el.textContent = t.name || 'UniVerify';
        if (t.logo_version && el.parentNode && !el.parentNode.querySelector('img')) {
          const img = document.createElement('img');
          img.src = '/brand/logo?v=' + encodeURIComponent(t.logo_version);
          img.alt = '';
          el.parentNode.insertBefore(img, el);
        }
      });
      document.title = (t.name ? t.name + ' · ' : '') + document.title;
      return t;
    } catch (e) { return {}; }
  };
  window.uvPost = async function (url, body) {
    const r = await fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || 'Something went wrong.'); e.data = d; e.status = r.status; throw e; }
    return d;
  };
  window.uvShow = function (el, msg, kind) {
    el.textContent = msg; el.className = 'alert show ' + (kind || 'err');
  };
})();
