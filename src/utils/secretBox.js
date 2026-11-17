// Secrets encrypted at rest: AES-256-GCM under a key derived (HKDF-SHA256)
// from the platform master secret, per issuer and per purpose, so a key for
// one issuer's SIS token can't open another issuer's, or a staff TOTP secret.
// Stored as v1:<master ref>:<iv>:<tag>:<ciphertext>, base64 parts. The
// master ref is kept so a new master can be introduced without breaking old
// values. Optional associated data binds a value to its row (a user id), so
// a ciphertext copied onto another row fails to open.

const crypto = require('crypto');

function masterRef() { return process.env.SIGNING_MASTER_KEY ? 'SIGNING_MASTER_KEY' : 'DOC_SECRET'; }

function key(ref, purpose, tenantId) {
  if (!['SIGNING_MASTER_KEY', 'DOC_SECRET'].includes(ref)) throw new Error('Unknown master: ' + ref);
  const master = process.env[ref] || (ref === 'DOC_SECRET' ? 'dev-secret' : '');
  if (!master) throw new Error(`${ref} is not set.`);
  return Buffer.from(crypto.hkdfSync('sha256', master, purpose, String(tenantId), 32));
}

const isSealed = v => typeof v === 'string' && v.startsWith('v1:');

function seal(purpose, tenantId, plain, aad) {
  if (!plain) return null;
  const ref = masterRef(), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(ref, purpose, tenantId), iv);
  if (aad) c.setAAD(Buffer.from(String(aad)));
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', ref, iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

function open(purpose, tenantId, stored, aad) {
  if (!stored) return '';
  const [v, ref, iv, tag, ct] = String(stored).split(':');
  if (v !== 'v1') throw new Error('Unknown secret format.');
  const d = crypto.createDecipheriv('aes-256-gcm', key(ref, purpose, tenantId), Buffer.from(iv, 'base64'));
  if (aad) d.setAAD(Buffer.from(String(aad)));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

// Staff TOTP secrets: sealed per issuer, bound to the user's id. Rows written
// before this existed hold the plain base32 secret; those still open, and are
// sealed on the user's next sign-in.
const TOTP = 'univerify-totp';
const sealTotp = (tenantId, userId, secret) => seal(TOTP, tenantId, secret, userId);
const openTotp = (tenantId, userId, stored) => (isSealed(stored) ? open(TOTP, tenantId, stored, userId) : String(stored || ''));

module.exports = { seal, open, isSealed, sealTotp, openTotp };
