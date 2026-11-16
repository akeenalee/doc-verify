// Graduate claim codes: the registry hands a one-off code to the graduate
// with their document, and the portal won't link a matric number to an
// account without it. This replaces "anyone who knows a matric number can
// register it". When a school's SIS is connected, a one-time code sent to the
// contact on the SIS record takes over the same role.

const crypto = require('crypto');

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CLAIM_DAYS = 90;

// 12 characters, 60 random bits, shown as XXXX-XXXX-XXXX
function generateClaimCode() {
  let out = '';
  for (const b of crypto.randomBytes(12)) out += CROCKFORD[b & 31];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

// Accepts lower case, spaces, missing dashes, and the usual misreads
function normaliseClaimCode(code) {
  return String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1');
}

const normMatric = m => String(m || '').trim().toUpperCase();

function claimHash(tenantId, matric, code) {
  return crypto.createHmac('sha256', process.env.DOC_SECRET || 'dev-secret')
    .update(`claim:${tenantId}:${normMatric(matric)}:${normaliseClaimCode(code)}`).digest('hex');
}

// A new code voids any earlier unused one for the same graduate
async function issueClaimCode(db, tenantId, matric, staffId) {
  const code = generateClaimCode();
  await db.query(
    `UPDATE student_claim_codes SET voided_at = NOW()
     WHERE tenant_id = $1 AND UPPER(matric_number) = $2 AND used_at IS NULL AND voided_at IS NULL`,
    [tenantId, normMatric(matric)]);
  const r = await db.query(
    `INSERT INTO student_claim_codes (tenant_id, matric_number, code_hash, created_by, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' days')::interval) RETURNING expires_at`,
    [tenantId, normMatric(matric), claimHash(tenantId, matric, code), staffId || null, String(CLAIM_DAYS)]);
  return { code, expires_at: r.rows[0].expires_at };
}

// Marks the code used and returns its id, or returns null. Run inside the
// caller's transaction so a failed registration doesn't burn the code.
async function redeemClaimCode(db, tenantId, matric, code, studentId) {
  if (normaliseClaimCode(code).length !== 12) return null;
  const r = await db.query(
    `UPDATE student_claim_codes SET used_at = NOW(), used_by = $4
     WHERE id = (SELECT id FROM student_claim_codes
                 WHERE tenant_id = $1 AND UPPER(matric_number) = $2 AND code_hash = $3
                   AND used_at IS NULL AND voided_at IS NULL AND expires_at > NOW()
                 LIMIT 1 FOR UPDATE)
     RETURNING id`,
    [tenantId, normMatric(matric), claimHash(tenantId, matric, code), studentId || null]);
  return r.rows[0]?.id || null;
}

async function claimRequired(db, tenantId) {
  const r = await db.query('SELECT student_claim_required FROM tenants WHERE id = $1', [tenantId]);
  return r.rows[0] ? r.rows[0].student_claim_required !== false : true;
}

module.exports = { generateClaimCode, normaliseClaimCode, issueClaimCode, redeemClaimCode, claimRequired, CLAIM_DAYS };
