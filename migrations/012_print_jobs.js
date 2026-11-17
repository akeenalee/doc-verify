// migrations/012_print_jobs.js
// Run once: node migrations/012_print_jobs.js
// Print jobs: staff send an issued batch, or single documents, to one named
// print vendor. That vendor sees only its own jobs. A job moves from
// assigned to downloaded, printed (vendor) and delivered (school); the pack
// locks on delivery, after max_downloads vendor downloads, or at expires_at.
// The documents in a job are fixed when it is created.
// Also: schools pay Paystack's charge by default from now on.
// Safe to run more than once.

require('dotenv').config();
const pool = require('../src/db/pool');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS print_jobs (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        vendor_id           UUID NOT NULL REFERENCES tenant_users(id),
        batch_id            UUID REFERENCES batches(id) ON DELETE SET NULL,
        title               VARCHAR(255) NOT NULL,
        doc_type            VARCHAR(100) NOT NULL,
        status              VARCHAR(20) NOT NULL DEFAULT 'assigned'
                              CHECK (status IN ('assigned', 'downloaded', 'printed', 'delivered', 'cancelled')),
        note                TEXT,
        download_count      INTEGER NOT NULL DEFAULT 0,
        max_downloads       INTEGER NOT NULL DEFAULT 3 CHECK (max_downloads BETWEEN 1 AND 20),
        expires_at          TIMESTAMPTZ NOT NULL,
        created_by          UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_downloaded_at  TIMESTAMPTZ,
        printed_at          TIMESTAMPTZ,
        delivered_at        TIMESTAMPTZ,
        delivered_by        UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
        cancelled_at        TIMESTAMPTZ,
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS print_jobs_vendor ON print_jobs (tenant_id, vendor_id, created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS print_jobs_batch ON print_jobs (batch_id) WHERE batch_id IS NOT NULL;`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS print_job_docs (
        job_id  UUID NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
        doc_id  VARCHAR(64) NOT NULL,
        row_no  INTEGER NOT NULL,
        PRIMARY KEY (job_id, doc_id)
      );
    `);
    console.log('✓ print_jobs, print_job_docs');

    await client.query(`ALTER TABLE tenant_payouts ALTER COLUMN fee_bearer SET DEFAULT 'subaccount';`);
    console.log('✓ tenant_payouts: school pays the Paystack charge by default');

    await client.query('COMMIT');
    console.log('Migration 012 complete.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Migration 012 failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
run();
