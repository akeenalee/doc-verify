function requireAdminAuth(req, res, next) {
    if (req.session && req.session.adminAuth) return next();
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(401).json({ error: 'Admin login required.' });
    }
    res.redirect('/admin-login.html?redirect=' + encodeURIComponent(req.originalUrl));
  }
  
  module.exports = { requireAdminAuth };