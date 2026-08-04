const crypto = require('crypto');

// Idle timeout: 24 hours for student sessions (graduates)
const STUDENT_IDLE_MS = 24 * 60 * 60 * 1000;

function hashPin(pin) {
  return crypto.createHash('sha256').update(pin + process.env.DOC_SECRET).digest('hex');
}

function requireStudentAuth(req, res, next) {
  if (!req.session || !req.session.studentId) {
    return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  }

  // Idle timeout check
  const now = Date.now();
  if (req.session.lastStudentActivity && (now - req.session.lastStudentActivity) > STUDENT_IDLE_MS) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }

  // Refresh last activity timestamp
  req.session.lastStudentActivity = now;
  next();
}

module.exports = { hashPin, requireStudentAuth };