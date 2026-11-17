// School payouts through Paystack subaccounts.
//
// A school with an active payout gets every payment for it split at Paystack:
// Innovation Lens keeps platform_fee_bps of the amount (1000 = 10%, so N500 of
// a N5,000 verification), the rest settles straight to the school's bank.
// A school with no payout (the demo tenant, or one not set up yet) is paid
// into the Innovation Lens account as before.
//
// Only the IL admin sets payouts up. The account number is checked with
// Paystack first, and only its last four digits are stored here.

const pool = require('../db/pool');
const P = require('./paystack');

const DEFAULT_FEE_BPS = 1000;

async function getPayout(tenantId, db = pool) {
  const r = await db.query('SELECT * FROM tenant_payouts WHERE tenant_id = $1', [tenantId]);
  return r.rows[0] || null;
}

const feeFor = (amountKobo, bps) => Math.round(amountKobo * bps / 10000);

// What to send Paystack for one payment, or null when the school has no payout
async function splitFor(tenantId, amountKobo) {
  const p = await getPayout(tenantId);
  if (!p || !p.active) return null;
  return { subaccount: p.subaccount_code, transaction_charge: feeFor(amountKobo, p.platform_fee_bps), bearer: p.fee_bearer };
}

const bad = (status, msg) => Object.assign(new Error(msg), { status });

// Creates the school's subaccount, or updates it when one exists
async function setupPayout(tenant, input, actor) {
  const bank_code = String(input.bank_code || '').trim();
  const account_number = String(input.account_number || '').replace(/\s/g, '');
  const fee_bps = input.platform_fee_bps === undefined || input.platform_fee_bps === '' ? DEFAULT_FEE_BPS : Number(input.platform_fee_bps);
  // The school pays Paystack's charge unless the IL admin picks otherwise (Alli, 2026-11-17)
  const fee_bearer = input.fee_bearer === 'account' ? 'account' : 'subaccount';
  if (!/^\d{1,10}$/.test(bank_code)) throw bad(400, 'Pick the bank.');
  if (!/^\d{10}$/.test(account_number)) throw bad(400, 'Account numbers (NUBAN) are 10 digits.');
  if (!Number.isInteger(fee_bps) || fee_bps < 0 || fee_bps > 5000) throw bad(400, 'The platform fee must be between 0% and 50%.');

  let banks;
  try { banks = await P.listBanks(); } catch (e) { throw bad(502, 'Paystack could not be reached: ' + e.message); }
  const bank = banks.find(b => b.code === bank_code);
  if (!bank) throw bad(400, 'Paystack does not list that bank.');

  let resolved;
  try { resolved = await P.resolveAccount(account_number, bank_code); }
  catch (e) { throw bad(400, `Paystack could not confirm that account: ${e.message}`); }

  const existing = await getPayout(tenant.id);
  const fields = { business_name: tenant.name, bank_code, account_number, percentage_charge: fee_bps / 100 };
  let sub;
  try {
    sub = existing
      ? await P.updateSubaccount(existing.subaccount_code, { ...fields, active: true })
      : await P.createSubaccount({ ...fields, email: tenant.contact_email || undefined });
  } catch (e) { throw bad(502, 'Paystack refused the subaccount: ' + e.message); }
  const code = sub.subaccount_code || (existing && existing.subaccount_code);
  if (!code) throw bad(502, 'Paystack did not return a subaccount code.');

  const r = await pool.query(
    `INSERT INTO tenant_payouts (tenant_id, subaccount_code, business_name, bank_code, bank_name, account_last4,
                                 account_name, platform_fee_bps, fee_bearer, active, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10,NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET subaccount_code = $2, business_name = $3, bank_code = $4, bank_name = $5,
       account_last4 = $6, account_name = $7, platform_fee_bps = $8, fee_bearer = $9, active = TRUE,
       updated_by = $10, updated_at = NOW()
     RETURNING *`,
    [tenant.id, code, tenant.name, bank_code, bank.name, account_number.slice(-4),
     resolved.account_name || null, fee_bps, fee_bearer, actor || null]);
  return r.rows[0];
}

// Stops splitting (payments go to Innovation Lens again); keeps the record
async function pausePayout(tenantId, actor) {
  const p = await getPayout(tenantId);
  if (!p) return null;
  try { await P.updateSubaccount(p.subaccount_code, { active: false }); } catch (_) { /* local switch is what matters */ }
  const r = await pool.query('UPDATE tenant_payouts SET active = FALSE, updated_by = $2, updated_at = NOW() WHERE tenant_id = $1 RETURNING *', [tenantId, actor || null]);
  return r.rows[0];
}

// Safe to show: no full account number, nothing secret
const publicView = p => p && ({
  active: p.active, bank_name: p.bank_name, account_last4: p.account_last4, account_name: p.account_name,
  platform_fee_percent: p.platform_fee_bps / 100, fee_bearer: p.fee_bearer, subaccount_code: p.subaccount_code,
  updated_at: p.updated_at,
});

module.exports = { getPayout, splitFor, setupPayout, pausePayout, publicView, feeFor, DEFAULT_FEE_BPS };
