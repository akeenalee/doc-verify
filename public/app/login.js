(function () {
  uvBrand();
  const msg = document.getElementById('msg');
  const steps = { password: 'step-password', code: 'step-code', recovery: 'step-recovery' };
  function show(step) {
    Object.values(steps).forEach(id => { document.getElementById(id).style.display = 'none'; });
    document.getElementById(steps[step]).style.display = 'block';
    const focus = { password: 'email', code: 'code', recovery: 'recovery' }[step];
    setTimeout(() => document.getElementById(focus).focus(), 30);
  }
  async function finish(body, btn) {
    msg.className = 'alert';
    if (btn) btn.disabled = true;
    try {
      const d = await uvPost('/app-api/auth/verify', body);
      if (d.recovery_codes_left !== undefined && d.recovery_codes_left <= 3) {
        sessionStorage.setItem('uv-recovery-low', String(d.recovery_codes_left));
      }
      location.href = '/app/';
    } catch (e) {
      uvShow(msg, e.message);
      if (e.data && e.data.restart) show('password');
    } finally { if (btn) btn.disabled = false; }
  }
  document.getElementById('step-password').addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn = document.getElementById('btn-password');
    msg.className = 'alert'; btn.disabled = true;
    try {
      await uvPost('/app-api/auth/login', {
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
      });
      show('code');
    } catch (e) { uvShow(msg, e.message); }
    finally { btn.disabled = false; }
  });
  document.getElementById('step-code').addEventListener('submit', ev => {
    ev.preventDefault();
    finish({ code: document.getElementById('code').value.replace(/\s/g, '') }, document.getElementById('btn-code'));
  });
  document.getElementById('step-recovery').addEventListener('submit', ev => {
    ev.preventDefault();
    finish({ recovery_code: document.getElementById('recovery').value });
  });
  document.getElementById('use-recovery').addEventListener('click', () => show('recovery'));
  document.getElementById('use-code').addEventListener('click', () => show('code'));
  const p = new URLSearchParams(location.search);
  if (p.get('expired')) uvShow(msg, 'Your session ended. Please sign in again.', 'info');
})();
