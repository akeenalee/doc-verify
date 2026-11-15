// migrations/005_branding_signatories.js
// Run once: node migrations/005_branding_signatories.js
// Phase 2 of the tenant interface redesign: tenant logo stored in the DB
// (Render's disk is ephemeral) and per-tenant signatories with document
// types and effective dates. Safe to run more than once.

require('dotenv').config();
const pool = require('../src/db/pool');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS logo_data       BYTEA,
        ADD COLUMN IF NOT EXISTS logo_mime       VARCHAR(20),
        ADD COLUMN IF NOT EXISTS logo_updated_at TIMESTAMPTZ;
    `);
    console.log('✓ tenants: logo columns');

    await client.query(`
      CREATE TABLE IF NOT EXISTS signatories (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        slot           SMALLINT NOT NULL CHECK (slot IN (1, 2)),
        full_name      VARCHAR(200) NOT NULL,
        title          VARCHAR(200) NOT NULL,
        doc_types      TEXT[] NOT NULL DEFAULT '{}',
        image_data     BYTEA NOT NULL,
        image_mime     VARCHAR(20) NOT NULL,
        effective_from DATE NOT NULL,
        effective_to   DATE,
        created_by     VARCHAR(200),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (effective_to IS NULL OR effective_to >= effective_from)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_signatories_tenant ON signatories(tenant_id, slot, effective_from DESC);`);
    console.log('✓ signatories');

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
