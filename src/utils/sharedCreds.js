// Shared logins (IL admin, demo) configured through environment variables.
// In production the built-in fallback values are refused, so a missing
// variable on Render locks the login instead of opening it with a password
// that sits in the source code.

const crypto = require('crypto');
const A = require('./staffAuth');

const isProd = () => process.env.NODE_ENV === 'production';

function credential(envName, fallback) {
  const v = process.env[envName];
  if (v) return v;
  if (isProd()) return null;
  return fallback;
}

// Compares in constant time regardless of input length
function safeEqual(a, b) {
  const h = s => crypto.createHash('sha256').update(String(s || '')).digest();
  return crypto.timingSafeEqual(h(a), h(b)) && String(a || '') === String(b || '');
}

// TOTP for the IL admin. A code is accepted once: the last step used is kept
// in memory, which is enough for a single Render instance.
let lastAdminStep = 0;
function adminTotpSecret() { return (process.env.ADMIN_TOTP_SECRET || '').replace(/\s+/g, '').toUpperCase() || null; }
function verifyAdminTotp(code, now = Date.now()) {
  const secret = adminTotpSecret();
  if (!secret || !/^\d{6}$/.test(String(code || ''))) return false;
  const step = Math.floor(now / 1000 / 30);
  for (const s of [step - 1, step, step + 1]) {
    if (s <= lastAdminStep) continue;
    if (crypto.timingSafeEqual(Buffer.from(A.hotp(secret, s)), Buffer.from(String(code)))) { lastAdminStep = s; return true; }
  }
  return false;
}

module.exports = { credential, safeEqual, adminTotpSecret, verifyAdminTotp, isProd };
