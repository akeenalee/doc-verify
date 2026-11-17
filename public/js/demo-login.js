  // Only same-site paths: never another origin or a javascript: URL
  const safePath = (p, d) => (typeof p === 'string' && /^\/(?![\/\\])/.test(p)) ? p : d;
  const redirect = safePath(new URLSearchParams(window.location.search).get('redirect'), '/');

  // Check for error param and show appropriate screen
  (function() {
    const params = new URLSearchParams(window.location.search);
    const error  = params.get('error');
    if (!error) return;

    const screen   = document.getElementById('error-screen');
    const form     = document.getElementById('login-form');
    const icon     = document.getElementById('error-icon');
    const title    = document.getElementById('error-title');
    const body     = document.getElementById('error-body');

    const messages = {
      expired_token:   { icon:'⏰', title:'This Link Has Expired', body:'The demo access link you used has expired. Please contact Innovation Lens to receive a fresh access link.' },
      invalid_token:   { icon:'🔗', title:'Invalid Access Link',   body:'This access link is not recognised or has been revoked. Please contact Innovation Lens to receive a valid access link.' },
      token_exhausted: { icon:'🔒', title:'Link No Longer Active', body:'This access link has reached its maximum number of uses. Please contact Innovation Lens for a new link.' },
      server_error:    { icon:'⚠️', title:'Something Went Wrong',   body:'There was a problem processing your access link. Please try again or contact Innovation Lens for assistance.' },
      session_expired:  { icon:'⏱️', title:'Session Expired', body:'Your session has been inactive for more than 8 hours and has been ended for security. Please log in again.' },
    };

    const msg = messages[error] || { icon:'❌', title:'Access Denied', body:'This link could not be processed. Please contact Innovation Lens for assistance.' };

    icon.textContent  = msg.icon;
    title.textContent = msg.title;
    body.textContent  = msg.body;

    screen.classList.add('show');
    form.classList.add('hide');
  })();

  async function doLogin() {
    const btn = document.getElementById('login-btn');
    const err = document.getElementById('err-msg');
    err.classList.remove('show');

    const body = {
      full_name: document.getElementById('full_name').value.trim(),
      email:     document.getElementById('email').value.trim(),
      company:   document.getElementById('company').value.trim(),
      role:      document.getElementById('role').value.trim(),
      username:  document.getElementById('username').value.trim(),
      password:  document.getElementById('password').value,
    };

    if (!body.username || !body.password) {
      err.textContent = 'Please enter your username and password.';
      err.classList.add('show');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Verifying...';

    try {
      const res  = await fetch('/demo/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        window.location.href = redirect;
      } else {
        err.textContent = data.error || 'Invalid credentials. Please try again.';
        err.classList.add('show');
        btn.disabled = false;
        btn.textContent = 'Access Demo Platform';
      }
    } catch (e) {
      err.textContent = 'Network error. Please try again.';
      err.classList.add('show');
      btn.disabled = false;
      btn.textContent = 'Access Demo Platform';
    }
  }

  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.getElementById('password').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doLogin();
  });
