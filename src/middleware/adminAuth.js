// Idle timeout: 4 hours for admin sessions (IL team)
const ADMIN_IDLE_MS = 4 * 60 * 60 * 1000;

function requireAdminAuth(req, res, next) {
  if (!req.session || !req.session.adminAuth) {
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(401).json({ error: 'Admin login required.' });
    }
    return res.redirect('/admin-login.html?redirect=' + encodeURIComponent(req.originalUrl));
  }

  // Idle timeout check
  const now = Date.now();
  if (req.session.lastAdminActivity && (now - req.session.lastAdminActivity) > ADMIN_IDLE_MS) {
    req.session.destroy(() => {});
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    return res.redirect('/admin-login.html?error=session_expired');
  }

  // Refresh last activity timestamp
  req.session.lastAdminActivity = now;
  next();
}

module.exports = { requireAdminAuth };