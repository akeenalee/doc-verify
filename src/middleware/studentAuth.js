const crypto = require('crypto');

// Idle timeout: 24 hours for student sessions
const STUDENT_IDLE_MS = 24 * 60 * 60 * 1000;

/**
 * Hash a PIN with a per-user salt and the global server secret.
 * Format: SHA-256(pin + DOC_SECRET + salt)
 * @param {string} pin - The PIN to hash
 * @param {string} salt - Per-user salt (hex string). Generated at registration.
 */
function hashPin(pin, salt) {
  return crypto
    .createHash('sha256')
    .update(pin + (process.env.DOC_SECRET || '') + (salt || ''))
    .digest('hex');
}

/**
 * Generate a new per-user salt for PIN hashing.
 * Call this at registration and store alongside the hash.
 */
function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
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

  req.session.lastStudentActivity = now;
  next();
}

module.exports = { hashPin, generateSalt, requireStudentAuth };