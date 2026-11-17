// Settling Paystack payments. A payment can be reported to us twice (the
// webhook and the payer's browser coming back), possibly at the same moment.
// Each settle runs as one conditional UPDATE on our own record of the
// purchase, so only the first report changes anything, and what gets
// credited comes from that record, never from the transaction's metadata.

const pool = require('../db/pool');

// The transaction must be a success, in naira, for at least what we asked for
function paidEnough(txn, amountKobo) {
  return !!txn && txn.status === 'success' &&
    String(txn.currency || 'NGN').toUpperCase() === 'NGN' &&
    Number(txn.amount) >= Number(amountKobo);
}

async function findRow(table, ref) {
  const r = await pool.query(`SELECT * FROM ${table} WHERE paystack_ref = $1`, [ref]);
  return r.rows[0] || null;
}

// Holder token bundle. Returns:
//   { ok: true, credited: n }       tokens added now
//   { ok: true, already: true, tokens: n }  settled earlier, nothing added
//   { ok: false, reason }           unknown reference, failed or short payment
async function settleTokenPurchase(txn) {
  const ref = txn && txn.reference;
  if (!ref) return { ok: false, reason: 'no_reference' };
  const row = await findRow('token_purchases', ref);
  if (!row) return { ok: false, reason: 'unknown_reference' };
  if (row.paystack_status === 'success') return { ok: true, already: true, tokens: row.bundle_size };
  if (!paidEnough(txn, row.amount_kobo)) return { ok: false, reason: 'not_paid' };

  const tenantId = txn.metadata && txn.metadata.tenant_id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const won = await client.query(
      `UPDATE token_purchases SET paystack_status = 'success', completed_at = NOW()
       WHERE paystack_ref = $1 AND paystack_status <> 'success'
       RETURNING matric_number, institution, bundle_size`, [ref]);
    if (!won.rows.length) {
      await client.query('ROLLBACK');
      return { ok: true, already: true, tokens: row.bundle_size };
    }
    const p = won.rows[0];
    const credit = await client.query(
      `UPDATE student_tokens SET token_balance = token_balance + $1, updated_at = NOW()
       WHERE matric_number = $2 AND institution = $3 AND tenant_id = $4`,
      [p.bundle_size, p.matric_number, p.institution, tenantId]);
    if (credit.rowCount !== 1) {
      await client.query('ROLLBACK');
      console.error(`Token purchase ${ref}: holder account not found, nothing credited`);
      return { ok: false, reason: 'holder_not_found' };
    }
    await client.query('COMMIT');
    return { ok: true, credited: p.bundle_size };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}

// Verifier payment for one document. Returns { ok: true, doc_id } when the
// reference is ours and paid in full, so callers check the document against
// our record rather than the transaction's metadata.
async function settleVerificationPayment(txn) {
  const ref = txn && txn.reference;
  if (!ref) return { ok: false, reason: 'no_reference' };
  const row = await findRow('verification_payments', ref);
  if (!row) return { ok: false, reason: 'unknown_reference' };
  if (!paidEnough(txn, row.amount_kobo)) return { ok: false, reason: 'not_paid' };
  await pool.query(
    `UPDATE verification_payments SET paystack_status = 'success', completed_at = NOW()
     WHERE paystack_ref = $1 AND paystack_status <> 'success'`, [ref]);
  return { ok: true, doc_id: row.doc_id };
}

module.exports = { settleTokenPurchase, settleVerificationPayment, paidEnough };
