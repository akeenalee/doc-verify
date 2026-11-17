// migrations/011_payouts.js
// Run once: node migrations/011_payouts.js
// Paystack split: each school gets a Paystack subaccount for its bank
// account, and every payment for that school (holder token bundles and
// verifier fees) is split at Paystack: the school's share settles straight
// to its bank, Innovation Lens keeps platform_fee_bps (1000 = 10%).
// Each payment row records the subaccount and fee it was split with.
// Safe to run more than once.

require('dotenv').config();
const pool = require('../src/db/pool');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenant_payouts (
        tenant_id        UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        subaccount_code  VARCHAR(50) NOT NULL,
        business_name    VARCHAR(200) NOT NULL,
        bank_code        VARCHAR(20) NOT NULL,
        bank_name        VARCHAR(200),
        account_last4    VARCHAR(4) NOT NULL,
        account_name     VARCHAR(200),
        platform_fee_bps INTEGER NOT NULL DEFAULT 1000 CHECK (platform_fee_bps BETWEEN 0 AND 10000),
        fee_bearer       VARCHAR(20) NOT NULL DEFAULT 'account' CHECK (fee_bearer IN ('account', 'subaccount')),
        active           BOOLEAN NOT NULL DEFAULT TRUE,
        updated_by       VARCHAR(100),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );`);
    console.log('✓ tenant_payouts');
    for (const t of ['token_purchases', 'verification_payments']) {
      await client.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS subaccount_code VARCHAR(50);`);
      await client.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS platform_fee_kobo INTEGER;`);
      console.log(`✓ ${t}: subaccount_code, platform_fee_kobo`);
    }
    // Token purchases had no tenant column; verifier fees reach theirs through the document
    await client.query(`ALTER TABLE token_purchases ADD COLUMN IF NOT EXISTS tenant_id UUID;`);
    console.log('✓ token_purchases: tenant_id');
    await client.query('COMMIT');
    console.log('Done.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
