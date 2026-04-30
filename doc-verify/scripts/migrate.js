require('dotenv').config();
const pool = require('../src/db/pool');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        doc_id      VARCHAR(64) UNIQUE NOT NULL,
        title       VARCHAR(255) NOT NULL,
        issued_to   VARCHAR(255) NOT NULL,
        issued_by   VARCHAR(255) NOT NULL,
        doc_type    VARCHAR(100),
        issue_date  DATE NOT NULL DEFAULT CURRENT_DATE,
        expiry_date DATE,
        status      VARCHAR(20) NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'revoked', 'expired')),
        metadata    JSONB DEFAULT '{}',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_doc_id ON documents(doc_id);
      CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
    `);

    // Audit log: track every scan
    await client.query(`
      CREATE TABLE IF NOT EXISTS verification_log (
        id          SERIAL PRIMARY KEY,
        doc_id      VARCHAR(64) NOT NULL,
        verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ip_address  INET,
        user_agent  TEXT,
        result      VARCHAR(20) NOT NULL CHECK (result IN ('found', 'not_found', 'revoked'))
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_vlog_doc_id ON verification_log(doc_id);
    `);

    await client.query('COMMIT');
    console.log('Migration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
