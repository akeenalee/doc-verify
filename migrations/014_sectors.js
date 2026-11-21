// migrations/014_sectors.js
// Run once: node migrations/014_sectors.js
// Beyond tertiary, phase 1. Every issuer gets a sector (tertiary,
// professional_body, training, secondary, employer, government) that decides
// its wording, document types and record labels. Existing issuers all become
// tertiary, so schools see no change. doc_templates holds an issuer's own
// document types; with no rows the sector's defaults apply.
// Run it on EVERY production database (school and sectors) before release.
// Safe to run more than once.

require('dotenv').config();
const pool = require('../src/db/pool');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sector VARCHAR(30) NOT NULL DEFAULT 'tertiary';`);
    console.log('✓ tenants.sector (existing issuers: tertiary)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS doc_templates (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name            VARCHAR(100) NOT NULL,
        award           BOOLEAN NOT NULL DEFAULT FALSE,
        validity_months INTEGER CHECK (validity_months IS NULL OR validity_months BETWEEN 1 AND 120),
        sort            INTEGER NOT NULL DEFAULT 0,
        active          BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tenant_id, name)
      );
    `);
    console.log('✓ doc_templates');

    await client.query('COMMIT');
    console.log('Migration 014 complete.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Migration 014 failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
run();
