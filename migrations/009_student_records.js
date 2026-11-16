// migrations/009_student_records.js
// Run once: node migrations/009_student_records.js
// Matric lookup when issuing: a school's SIS connection (our published REST
// spec) and, until that exists, an uploaded student list (any students the
// registry is issuing for: graduates, transcript requests, transfers). Only
// the fields printed on documents are kept, and list records are deleted
// after issue.
// Safe to run more than once.

require('dotenv').config();
const pool = require('../src/db/pool');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS tenant_sis (
        tenant_id    UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        enabled      BOOLEAN NOT NULL DEFAULT FALSE,
        base_url     VARCHAR(500) NOT NULL,
        auth_type    VARCHAR(10) NOT NULL DEFAULT 'bearer' CHECK (auth_type IN ('bearer', 'basic', 'none')),
        secret_enc   TEXT,
        timeout_ms   INTEGER NOT NULL DEFAULT 5000 CHECK (timeout_ms BETWEEN 1000 AND 15000),
        last_ok_at   TIMESTAMPTZ,
        last_error   TEXT,
        updated_by   UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✓ tenant_sis');

    await client.query(`
      CREATE TABLE IF NOT EXISTS student_lists (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        file_name   VARCHAR(255),
        row_count   INTEGER NOT NULL DEFAULT 0,
        uploaded_by UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS student_records (
        id              BIGSERIAL PRIMARY KEY,
        tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        list_id         UUID REFERENCES student_lists(id) ON DELETE CASCADE,
        matric_number   VARCHAR(50) NOT NULL,
        full_name       VARCHAR(200) NOT NULL,
        programme       VARCHAR(200),
        faculty         VARCHAR(200),
        department      VARCHAR(200),
        degree_class    VARCHAR(100),
        entry_year      VARCHAR(4),
        graduation_year VARCHAR(4),
        status          VARCHAR(30),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        issued_at       TIMESTAMPTZ
      );
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_student_records_matric
                          ON student_records(tenant_id, UPPER(matric_number));`);
    console.log('✓ student_lists, student_records');

    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS require_registered BOOLEAN NOT NULL DEFAULT FALSE;`);
    console.log('✓ tenants: require_registered');

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
