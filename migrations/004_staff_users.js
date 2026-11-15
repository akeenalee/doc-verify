// migrations/004_staff_users.js
// Run once: node migrations/004_staff_users.js
// Phase 1 of the tenant interface redesign: per-tenant staff accounts with
// roles and TOTP, a staff activity log, and the document columns needed for
// revoke with reason, restore and reissue. Safe to run more than once.

require('dotenv').config();
const pool = require('../src/db/pool');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS tenant_users (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        email             VARCHAR(200) NOT NULL,
        full_name         VARCHAR(200),
        roles             TEXT[] NOT NULL DEFAULT '{}',
        status            VARCHAR(20) NOT NULL DEFAULT 'invited'
                            CHECK (status IN ('invited', 'active', 'disabled')),
        password_hash     TEXT,
        totp_secret       TEXT,
        totp_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
        recovery_codes    TEXT[] NOT NULL DEFAULT '{}',
        invite_token_hash VARCHAR(64),
        invite_expires_at TIMESTAMPTZ,
        failed_logins     INTEGER NOT NULL DEFAULT 0,
        locked_until      TIMESTAMPTZ,
        last_login_at     TIMESTAMPTZ,
        invited_by        VARCHAR(200),
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_users_email ON tenant_users(tenant_id, LOWER(email));`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tenant_users_invite ON tenant_users(invite_token_hash);`);
    console.log('✓ tenant_users');

    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id          BIGSERIAL PRIMARY KEY,
        tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id     UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
        actor       VARCHAR(200) NOT NULL,
        action      VARCHAR(50)  NOT NULL,
        target_type VARCHAR(30),
        target_id   VARCHAR(100),
        detail      JSONB NOT NULL DEFAULT '{}',
        ip_address  VARCHAR(64),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_tenant_time ON activity_log(tenant_id, created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_target ON activity_log(tenant_id, target_id);`);
    console.log('✓ activity_log');

    await client.query(`
      ALTER TABLE documents
        ADD COLUMN IF NOT EXISTS replaces_doc_id VARCHAR(64),
        ADD COLUMN IF NOT EXISTS superseded_by   VARCHAR(64),
        ADD COLUMN IF NOT EXISTS revoked_at      TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS revoked_reason  VARCHAR(100),
        ADD COLUMN IF NOT EXISTS revoked_by      UUID,
        ADD COLUMN IF NOT EXISTS issued_by_user  UUID;
    `);
    await client.query(`ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_status_check;`);
    await client.query(`
      ALTER TABLE documents ADD CONSTRAINT documents_status_check
        CHECK (status IN ('active', 'revoked', 'expired', 'superseded'));
    `);
    await client.query(`ALTER TABLE verification_log DROP CONSTRAINT IF EXISTS verification_log_result_check;`);
    await client.query(`
      ALTER TABLE verification_log ADD CONSTRAINT verification_log_result_check
        CHECK (result IN ('found', 'not_found', 'revoked', 'superseded', 'tampered'));
    `);
    console.log('✓ documents: reissue and revoke columns, superseded status');

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
