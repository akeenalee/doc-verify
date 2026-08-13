// migrations/add_tenant_id_to_all_tables.js
// Run AFTER create_tenants_table.js
// Adds tenant_id to every table and backfills existing rows
// with the default demo tenant ID

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// The default demo tenant ID seeded in create_tenants_table.js
const DEMO_TENANT_ID = '00000000-0000-0000-0000-000000000001';

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── documents ──────────────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE documents
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
    `);
    await client.query(`
      UPDATE documents SET tenant_id = $1 WHERE tenant_id IS NULL;
    `, [DEMO_TENANT_ID]);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_tenant_id ON documents(tenant_id);
    `);
    console.log('✓ documents.tenant_id added and backfilled');

    // ── student_tokens ─────────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE student_tokens
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
    `);
    await client.query(`
      UPDATE student_tokens SET tenant_id = $1 WHERE tenant_id IS NULL;
    `, [DEMO_TENANT_ID]);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_student_tokens_tenant_id ON student_tokens(tenant_id);
    `);
    console.log('✓ student_tokens.tenant_id added and backfilled');

    // ── verification_log ───────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE verification_log
      ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
    `);
    await client.query(`
      UPDATE verification_log SET tenant_id = $1 WHERE tenant_id IS NULL;
    `, [DEMO_TENANT_ID]);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_log_tenant_id ON verification_log(tenant_id);
    `);
    console.log('✓ verification_log.tenant_id added and backfilled');

    // ── demo_tokens ────────────────────────────────────────────────────────
    // Check if demo_tokens table exists first
    const demoTokensExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'demo_tokens'
      );
    `);
    if (demoTokensExists.rows[0].exists) {
      await client.query(`
        ALTER TABLE demo_tokens
        ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
      `);
      await client.query(`
        UPDATE demo_tokens SET tenant_id = $1 WHERE tenant_id IS NULL;
      `, [DEMO_TENANT_ID]);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_demo_tokens_tenant_id ON demo_tokens(tenant_id);
      `);
      console.log('✓ demo_tokens.tenant_id added and backfilled');
    } else {
      console.log('  demo_tokens table not found — skipped');
    }

    // ── demo_visitors ──────────────────────────────────────────────────────
    const demoVisitorsExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'demo_visitors'
      );
    `);
    if (demoVisitorsExists.rows[0].exists) {
      await client.query(`
        ALTER TABLE demo_visitors
        ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
      `);
      await client.query(`
        UPDATE demo_visitors SET tenant_id = $1 WHERE tenant_id IS NULL;
      `, [DEMO_TENANT_ID]);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_demo_visitors_tenant_id ON demo_visitors(tenant_id);
      `);
      console.log('✓ demo_visitors.tenant_id added and backfilled');
    } else {
      console.log('  demo_visitors table not found — skipped');
    }

    // ── NOT adding tenant_id to sessions ──────────────────────────────────
    // Sessions are scoped by the session data itself (req.session.tenantId)
    // Adding tenant_id to the sessions table is not needed and would
    // complicate the pg-session-store setup unnecessarily.
    console.log('  sessions table — tenant scoped via session data, no column needed');

    await client.query('COMMIT');

    // Verify the backfill
    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM documents        WHERE tenant_id IS NULL) AS docs_null,
        (SELECT COUNT(*) FROM student_tokens   WHERE tenant_id IS NULL) AS tokens_null,
        (SELECT COUNT(*) FROM verification_log WHERE tenant_id IS NULL) AS logs_null
    `);
    const row = counts.rows[0];
    if (Number(row.docs_null) + Number(row.tokens_null) + Number(row.logs_null) === 0) {
      console.log('\n✓ All rows backfilled — no NULL tenant_ids remaining');
    } else {
      console.warn('\n⚠ Some rows still have NULL tenant_id:');
      console.warn('  documents:', row.docs_null);
      console.warn('  student_tokens:', row.tokens_null);
      console.warn('  verification_log:', row.logs_null);
    }

    console.log('\nadd_tenant_id_to_all_tables migration complete.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Migration failed, rolled back:', e.message);
    throw e;
  } finally {
    client.release();
    pool.end();
  }
}

run().catch(e => {
  console.error(e.message);
  process.exit(1);
});