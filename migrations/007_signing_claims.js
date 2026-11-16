// migrations/007_signing_claims.js
// Run once: node migrations/007_signing_claims.js
// Phase 4a: QR signature v2 (a signing key per school, strict mode) and
// graduate claim codes, so only the real graduate can link a matric number
// to a portal account. Safe to run more than once.

require('dotenv').config();
const pool = require('../src/db/pool');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Key metadata only. The key is derived from the env variable named in
    // master_ref, so nothing secret is stored here.
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenant_sign_keys (
        tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        kid        INTEGER NOT NULL,
        master_ref VARCHAR(40) NOT NULL CHECK (master_ref IN ('SIGNING_MASTER_KEY', 'DOC_SECRET')),
        status     VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired', 'revoked')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        retired_at TIMESTAMPTZ,
        PRIMARY KEY (tenant_id, kid)
      );
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_sign_keys_active
                          ON tenant_sign_keys(tenant_id) WHERE status = 'active';`);
    console.log('✓ tenant_sign_keys');

    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sig_strict BOOLEAN NOT NULL DEFAULT FALSE;`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS student_claim_required BOOLEAN NOT NULL DEFAULT TRUE;`);
    // The demo tenant is a public showcase: visitors register without a code
    await client.query(`UPDATE tenants SET student_claim_required = FALSE WHERE subdomain = 'demo';`);
    console.log('✓ tenants: sig_strict, student_claim_required');

    await client.query(`ALTER TABLE verification_log DROP CONSTRAINT IF EXISTS verification_log_result_check;`);
    await client.query(`
      ALTER TABLE verification_log ADD CONSTRAINT verification_log_result_check
        CHECK (result IN ('found', 'not_found', 'revoked', 'superseded', 'tampered', 'old_link'));
    `);
    console.log('✓ verification_log: old_link result');

    await client.query(`
      CREATE TABLE IF NOT EXISTS student_claim_codes (
        id            BIGSERIAL PRIMARY KEY,
        tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        matric_number VARCHAR(100) NOT NULL,
        code_hash     CHAR(64) NOT NULL,
        created_by    UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at    TIMESTAMPTZ NOT NULL,
        used_at       TIMESTAMPTZ,
        used_by       INTEGER,
        voided_at     TIMESTAMPTZ
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_claim_codes_lookup
                          ON student_claim_codes(tenant_id, UPPER(matric_number)) WHERE used_at IS NULL AND voided_at IS NULL;`);
    console.log('✓ student_claim_codes');

    await client.query(`ALTER TABLE student_tokens ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;`);
    await client.query(`ALTER TABLE student_tokens ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;`);
    console.log('✓ student_tokens: verified_at, session_version');

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
