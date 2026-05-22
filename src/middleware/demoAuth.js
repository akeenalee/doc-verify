function requireDemoAuth(req, res, next) {
    if (req.session && req.session.demoAuth) {
      return next();
    }
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(401).json({ error: 'Demo login required.' });
    }
    res.redirect('/demo-login.html?redirect=' + encodeURIComponent(req.originalUrl));
  }
  
  module.exports = { requireDemoAuth };