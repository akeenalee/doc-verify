// QR signature v2: HMAC-SHA256 over the document's key fields, with a
// separate key for each school and a key id so keys can be rotated.
//
//   payload  2|<tenant_id>|<doc_id>|<doc_type>|<issue_date>|sha256(<name>)
//   key      HKDF-SHA256(master, salt = tenant_id, info = "univerify-qr-v2:<kid>")
//   tag      first 128 bits of the HMAC, as 32 hex characters
//   in URL   sig=2.<kid>.<tag>
//
// Only key metadata is stored (tenant_sign_keys). The key itself is derived
// from a master secret held in the server environment, so nothing secret is
// in the database. Each key row records which env variable it was derived
// from, so setting SIGNING_MASTER_KEY later and rotating moves a school onto
// it without breaking QRs signed under the old key.
//
// v1 links (sig = 16 hex HMAC of the doc ID under DOC_SECRET) still verify
// unless the school has turned on strict mode.

const crypto = require('crypto');
const pool   = require('../db/pool');

const MASTERS = ['SIGNING_MASTER_KEY', 'DOC_SECRET'];
const TAG_HEX = 32;

function currentMasterRef() {
  return process.env.SIGNING_MASTER_KEY ? 'SIGNING_MASTER_KEY' : 'DOC_SECRET';
}

function masterSecret(ref) {
  if (!MASTERS.includes(ref)) throw new Error('Unknown signing master: ' + ref);
  const v = process.env[ref] || (ref === 'DOC_SECRET' ? 'dev-secret' : '');
  if (!v) throw new Error(`${ref} is not set, so QR codes signed with it can't be checked.`);
  return v;
}

const derived = new Map(); // `${tenant}:${kid}` -> Buffer
function tenantKey(tenantId, kid, ref) {
  const id = `${tenantId}:${kid}:${ref}`;
  if (!derived.has(id)) {
    derived.set(id, Buffer.from(crypto.hkdfSync('sha256', masterSecret(ref), String(tenantId),
      `univerify-qr-v2:${kid}`, 32)));
  }
  return derived.get(id);
}

// pg returns DATE columns as a Date at local midnight, so read local parts
function canonicalDate(d) {
  if (!d) return '';
  if (d instanceof Date) {
    if (isNaN(d)) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return String(d).slice(0, 10);
}

function normaliseName(n) {
  return String(n || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase();
}

function payload(doc) {
  const nameHash = crypto.createHash('sha256').update(normaliseName(doc.issued_to)).digest('hex');
  return ['2', doc.tenant_id, doc.doc_id, doc.doc_type || '', canonicalDate(doc.issue_date), nameHash].join('|');
}

function tag(key, doc) {
  return crypto.createHmac('sha256', key).update(payload(doc)).digest('hex').slice(0, TAG_HEX);
}

// ── Keys ──────────────────────────────────────────────────────────────────
const activeCache = new Map(); // tenant_id -> { kid, ref }

async function activeKey(tenantId) {
  if (activeCache.has(tenantId)) return activeCache.get(tenantId);
  let r = await pool.query(
    `SELECT kid, master_ref FROM tenant_sign_keys WHERE tenant_id = $1 AND status = 'active'
     ORDER BY kid DESC LIMIT 1`, [tenantId]);
  if (!r.rows.length) {
    // First signature for this school: create key 1. ON CONFLICT covers two
    // requests racing to do the same.
    await pool.query(
      `INSERT INTO tenant_sign_keys (tenant_id, kid, master_ref) VALUES ($1, 1, $2)
       ON CONFLICT (tenant_id, kid) DO NOTHING`, [tenantId, currentMasterRef()]);
    r = await pool.query(
      `SELECT kid, master_ref FROM tenant_sign_keys WHERE tenant_id = $1 AND status = 'active'
       ORDER BY kid DESC LIMIT 1`, [tenantId]);
    if (!r.rows.length) throw new Error('No active signing key for this institution.');
  }
  const k = { kid: r.rows[0].kid, ref: r.rows[0].master_ref };
  activeCache.set(tenantId, k);
  return k;
}

// New key for new QRs. The old one stays valid for documents already printed.
async function rotateKey(tenantId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['sign-key:' + tenantId]);
    const m = await client.query('SELECT COALESCE(MAX(kid), 0) AS kid FROM tenant_sign_keys WHERE tenant_id = $1', [tenantId]);
    const kid = Number(m.rows[0].kid) + 1;
    await client.query(`UPDATE tenant_sign_keys SET status = 'retired', retired_at = NOW()
                        WHERE tenant_id = $1 AND status = 'active'`, [tenantId]);
    await client.query('INSERT INTO tenant_sign_keys (tenant_id, kid, master_ref) VALUES ($1, $2, $3)',
      [tenantId, kid, currentMasterRef()]);
    await client.query('COMMIT');
    activeCache.delete(tenantId);
    return kid;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}

async function listKeys(tenantId) {
  const r = await pool.query(
    `SELECT kid, master_ref, status, created_at, retired_at FROM tenant_sign_keys
     WHERE tenant_id = $1 ORDER BY kid DESC`, [tenantId]);
  return r.rows;
}

// ── Sign and check ────────────────────────────────────────────────────────
// doc needs tenant_id, doc_id, doc_type, issue_date, issued_to
async function signDocument(doc) {
  const k = await activeKey(doc.tenant_id);
  return `2.${k.kid}.${tag(tenantKey(doc.tenant_id, k.kid, k.ref), doc)}`;
}

function parseSig(sig) {
  if (!sig || typeof sig !== 'string') return { version: 0 };
  const m = /^2\.(\d{1,6})\.([0-9a-f]{32})$/.exec(sig);
  if (m) return { version: 2, kid: Number(m[1]), tag: m[2] };
  if (/^[0-9a-f]{16}$/.test(sig)) return { version: 1, tag: sig };
  return { version: -1 }; // present but malformed
}

// Returns 'valid' | 'invalid' | 'retired_key_revoked'
async function checkV2(doc, parsed) {
  const r = await pool.query(
    'SELECT master_ref, status FROM tenant_sign_keys WHERE tenant_id = $1 AND kid = $2',
    [doc.tenant_id, parsed.kid]);
  if (!r.rows.length || r.rows[0].status === 'revoked') return 'invalid';
  let expected;
  try { expected = tag(tenantKey(doc.tenant_id, parsed.kid, r.rows[0].master_ref), doc); }
  catch (e) { console.error('Signature check:', e.message); return 'invalid'; }
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parsed.tag)) ? 'valid' : 'invalid';
}

function clearSigningCache(tenantId) {
  if (tenantId) activeCache.delete(tenantId); else activeCache.clear();
}

module.exports = {
  signDocument, parseSig, checkV2, rotateKey, listKeys, activeKey, clearSigningCache,
  currentMasterRef, _payload: payload, canonicalDate,
};
