const crypto = require('crypto');

function hashPin(pin) {
  return crypto.createHash('sha256').update(pin + process.env.DOC_SECRET).digest('hex');
}

function requireStudentAuth(req, res, next) {
  if (!req.session || !req.session.studentId) {
    return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  }
  next();
}

module.exports = { hashPin, requireStudentAuth };