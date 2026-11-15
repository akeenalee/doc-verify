// Staff account helpers: password hashing (scrypt), TOTP (RFC 6238),
// recovery codes and invite tokens. Node crypto only, no extra deps.

const crypto = require('crypto');

// ── Passwords ────────────────────────────────────────────────────────────────
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key  = crypto.scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  const [algo, N, r, p, saltHex, keyHex] = stored.split('$');
  if (algo !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), keyHex.length / 2,
    { N: parseInt(N, 10), r: parseInt(r, 10), p: parseInt(p, 10) });
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
}

// 10+ characters with at least one letter and one digit
function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 10) return 'Password must be at least 10 characters.';
  if (password.length > 200) return 'Password is too long.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain letters and numbers.';
  return null;
}

// ── TOTP ─────────────────────────────────────────────────────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac  = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const off  = mac[mac.length - 1] & 0xf;
  const code = ((mac.readUInt32BE(off) & 0x7fffffff) % 1000000).toString();
  return code.padStart(6, '0');
}

// Accepts the current 30 s step plus one either side for clock drift
function verifyTotp(secret, code, now = Date.now()) {
  if (!secret || !/^\d{6}$/.test(String(code || ''))) return false;
  const step = Math.floor(now / 1000 / 30);
  let ok = false;
  for (const s of [step - 1, step, step + 1]) {
    if (crypto.timingSafeEqual(Buffer.from(hotp(secret, s)), Buffer.from(String(code)))) ok = true;
  }
  return ok;
}

function totpUri(secret, email, issuer) {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ── Recovery codes and invite tokens ─────────────────────────────────────────
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');

function generateRecoveryCodes(n = 10) {
  const plain = Array.from({ length: n }, () => {
    const h = crypto.randomBytes(5).toString('hex').toUpperCase();
    return `${h.slice(0, 5)}-${h.slice(5)}`;
  });
  return { plain, hashed: plain.map(sha256) };
}

function normaliseRecoveryCode(code) {
  const c = String(code || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  return c.length === 10 ? `${c.slice(0, 5)}-${c.slice(5)}` : null;
}

function generateInviteToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: sha256(token) };
}

module.exports = {
  hashPassword, verifyPassword, passwordProblem,
  generateTotpSecret, verifyTotp, totpUri, hotp, base32Encode,
  generateRecoveryCodes, normaliseRecoveryCode, generateInviteToken, sha256,
};
