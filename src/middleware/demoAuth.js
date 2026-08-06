const DEMO_IDLE_MS = 8 * 60 * 60 * 1000; // 8 hours

function requireDemoAuth(req, res, next) {
  if (!req.session || !req.session.demoAuth) {
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(401).json({ error: 'Demo login required.' });
    }
    return res.redirect('/demo-login.html?redirect=' + encodeURIComponent(req.originalUrl));
  }

  // Idle timeout check
  const now = Date.now();
  if (req.session.lastDemoActivity && (now - req.session.lastDemoActivity) > DEMO_IDLE_MS) {
    req.session.destroy(() => {});
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    return res.redirect('/demo-login.html?error=session_expired');
  }

  req.session.lastDemoActivity = now;
  next();
}

module.exports = { requireDemoAuth };