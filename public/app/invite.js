(function () {
  uvBrand();
  const token = new URLSearchParams(location.search).get('token') || '';
  const msg = document.getElementById('msg');
  let codes = [];
  function step(n) {
    ['step-1', 'step-2', 'step-3', 'bad'].forEach(id => { document.getElementById(id).style.display = 'none'; });
    document.getElementById(n === 0 ? 'bad' : 'step-' + n).style.display = 'block';
    [1, 2, 3].forEach(i => document.getElementById('s' + i).className = i <= n ? 'on' : '');
    msg.className = 'alert';
  }
  (async function init() {
    try {
      const r = await fetch('/app-api/auth/invite?token=' + encodeURIComponent(token), { headers: { Accept: 'application/json' } });
      const d = await r.json();
      if (!r.ok) { document.getElementById('bad-msg').textContent = d.error || 'This setup link is invalid.'; return step(0); }
      document.getElementById('who').textContent = 'Signing in as ' + d.email + ' (' + d.roles.join(', ') + ') at ' + d.tenant + '.';
      document.getElementById('full_name').value = d.full_name || '';
      step(1);
    } catch (e) { step(0); }
  })();

  document.getElementById('step-1').addEventListener('submit', async ev => {
    ev.preventDefault();
    const pw1 = document.getElementById('pw1').value, pw2 = document.getElementById('pw2').value;
    if (pw1 !== pw2) return uvShow(msg, 'The two passwords don\'t match.');
    const btn = document.getElementById('btn-1'); btn.disabled = true;
    try {
      const d = await uvPost('/app-api/auth/invite/start', { token, password: pw1, full_name: document.getElementById('full_name').value });
      document.getElementById('qr').src = d.qr;
      document.getElementById('secret').textContent = d.secret.replace(/(.{4})/g, '$1 ').trim();
      step(2);
      document.getElementById('code').focus();
    } catch (e) { uvShow(msg, e.message); }
    finally { btn.disabled = false; }
  });

  document.getElementById('step-2').addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn = document.getElementById('btn-2'); btn.disabled = true;
    try {
      const d = await uvPost('/app-api/auth/invite/confirm', { token, code: document.getElementById('code').value.replace(/\s/g, '') });
      codes = d.recovery_codes || [];
      const box = document.getElementById('codes');
      box.innerHTML = '';
      codes.forEach(c => { const s = document.createElement('div'); s.textContent = c; box.appendChild(s); });
      step(3);
    } catch (e) { uvShow(msg, e.message); }
    finally { btn.disabled = false; }
  });

  document.getElementById('dl').addEventListener('click', () => {
    const name = document.querySelector('[data-tenant-name]').textContent;
    const blob = new Blob(['UniVerify recovery codes for ' + name + '\nEach code works once.\n\n' + codes.join('\n') + '\n'], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'univerify-recovery-codes.txt'; a.click();
  });
  document.getElementById('go').addEventListener('click', () => { location.href = '/app/'; });
})();
