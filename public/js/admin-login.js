  // Only same-site paths: never another origin or a javascript: URL
  const safePath = (p, d) => (typeof p === 'string' && /^\/(?![\/\\])/.test(p)) ? p : d;
  const redirect = safePath(new URLSearchParams(window.location.search).get('redirect'), '/admin');

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
      username:  document.getElementById('username').value.trim(),
      password:  document.getElementById('password').value,
      code:      document.getElementById('code').value.trim(),
    };

    if (!body.username || !body.password) {
      err.textContent = 'Please enter your username and password.';
      err.classList.add('show');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Verifying...';

    try {
      const res  = await fetch('/admin-api/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        window.location.href = redirect;
      } else if (data.totp_required) {
        document.getElementById('code-wrap').style.display = '';
        document.getElementById('code').focus();
        err.textContent = data.error;
        err.classList.add('show');
        btn.disabled = false;
        btn.textContent = 'Verify code';
      } else {
        err.textContent = data.error || 'Invalid credentials. Please try again.';
        err.classList.add('show');
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    } catch (e) {
      err.textContent = 'Network error. Please try again.';
      err.classList.add('show');
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  }

  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.getElementById('password').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('code').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doLogin();
  });
