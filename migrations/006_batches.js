// migrations/006_batches.js
// Run once: node migrations/006_batches.js
// Phase 3 of the tenant interface redesign: bulk issuing from CSV, with an
// optional approval step (off by default). Safe to run more than once.

require('dotenv').config();
const pool = require('../src/db/pool');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT FALSE;
    `);
    console.log('✓ tenants: approval_required');

    await client.query(`
      CREATE TABLE IF NOT EXISTS batches (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        file_name      VARCHAR(255),
        doc_type       VARCHAR(100) NOT NULL,
        status         VARCHAR(20) NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'pending_approval', 'issued', 'rejected', 'cancelled')),
        row_count      INTEGER NOT NULL DEFAULT 0,
        valid_count    INTEGER NOT NULL DEFAULT 0,
        error_count    INTEGER NOT NULL DEFAULT 0,
        issued_count   INTEGER NOT NULL DEFAULT 0,
        created_by     UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        submitted_by   UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
        submitted_at   TIMESTAMPTZ,
        decided_by     UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
        decided_at     TIMESTAMPTZ,
        decision_note  TEXT,
        issued_at      TIMESTAMPTZ
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_batches_tenant ON batches(tenant_id, created_at DESC);`);
    console.log('✓ batches');

    await client.query(`
      CREATE TABLE IF NOT EXISTS batch_rows (
        id        BIGSERIAL PRIMARY KEY,
        batch_id  UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        row_no    INTEGER NOT NULL,
        data      JSONB NOT NULL,
        errors    JSONB NOT NULL DEFAULT '[]',
        warnings  JSONB NOT NULL DEFAULT '[]',
        doc_id    VARCHAR(100),
        UNIQUE (batch_id, row_no)
      );
    `);
    console.log('✓ batch_rows');

    await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS batch_id UUID;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_documents_batch ON documents(batch_id) WHERE batch_id IS NOT NULL;`);
    console.log('✓ documents: batch_id');

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
