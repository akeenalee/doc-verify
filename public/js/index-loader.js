(function() {
  const MIN_MS  = 10000; // always show for at least 10 seconds
  const start   = Date.now();
  let phase     = 1;

  const statusEl = document.getElementById('ld-status');
  const subEl    = document.getElementById('ld-sub');
  const fillEl   = document.getElementById('ld-fill');

  const phases = [
    { status: 'Initialising secure connection',  sub: 'Setting up the verification platform...' },
    { status: 'Establishing secure session',     sub: 'Connecting to the database...' },
    { status: 'Loading verification records',    sub: 'Almost ready...' },
    { status: 'Platform ready',                  sub: 'Welcome to UniVerify' },
  ];

  function setStep(n) {
    for (let i = 1; i <= 4; i++) {
      const el = document.getElementById('ld-s' + i);
      el.classList.remove('active','done');
      if (i < n) el.classList.add('done');
      else if (i === n) el.classList.add('active');
    }
  }

  function setPhase(n) {
    if (n === phase) return;
    phase = n;
    const p = phases[n-1];
    statusEl.textContent = p.status;
    subEl.textContent    = p.sub;
    setStep(n);
  }

  function tick() {
    const elapsed = Date.now() - start;
    const pct     = Math.min(elapsed / MIN_MS, 1);

    // Progress ramp
    fillEl.style.width = Math.min(8 + pct * 87, 95) + '%';

    // Phase transitions
    if (pct > 0.28 && phase < 2) setPhase(2);
    if (pct > 0.58 && phase < 3) setPhase(3);

    if (elapsed < MIN_MS) {
      requestAnimationFrame(tick);
    } else {
      // 10 seconds done — dismiss loader
      setPhase(4);
      fillEl.style.width = '100%';
      setTimeout(function() {
        const loader = document.getElementById('loader-screen');
        loader.classList.add('fade-out');
        setTimeout(function() { loader.classList.add('hidden'); }, 650);
      }, 500);
    }
  }

  fillEl.style.width = '8%';
  setStep(1);
  requestAnimationFrame(tick);
})();
