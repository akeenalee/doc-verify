// migrations/008_print_disclosure_alerts.js
// Run once: node migrations/008_print_disclosure_alerts.js
// Phase 4b: QR placement specs for print vendors, the Print vendor role,
// what the public verify page may show (per school), and scan alerts.
// Safe to run more than once.

require('dotenv').config();
const pool = require('../src/db/pool');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Where the vendor prints the QR on each document type
    await client.query(`
      CREATE TABLE IF NOT EXISTS print_specs (
        tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        doc_type   VARCHAR(100) NOT NULL,
        anchor     VARCHAR(12) NOT NULL DEFAULT 'bottom-right'
                     CHECK (anchor IN ('top-left', 'top-right', 'bottom-left', 'bottom-right')),
        x_mm       NUMERIC(5,1) NOT NULL DEFAULT 15 CHECK (x_mm >= 0 AND x_mm <= 200),
        y_mm       NUMERIC(5,1) NOT NULL DEFAULT 15 CHECK (y_mm >= 0 AND y_mm <= 280),
        size_mm    NUMERIC(4,1) NOT NULL DEFAULT 30 CHECK (size_mm >= 20 AND size_mm <= 60),
        paper      VARCHAR(10) NOT NULL DEFAULT 'A4' CHECK (paper IN ('A4', 'A3', 'Letter')),
        notes      TEXT,
        updated_by UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (tenant_id, doc_type)
      );
    `);
    console.log('✓ print_specs');

    // Fields the public verify page shows. Missing keys use the defaults in code.
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS disclosure JSONB NOT NULL DEFAULT '{}';`);
    console.log('✓ tenants: disclosure');

    await client.query(`
      CREATE TABLE IF NOT EXISTS scan_alerts (
        id              BIGSERIAL PRIMARY KEY,
        tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        doc_id          VARCHAR(100) NOT NULL,
        kind            VARCHAR(20) NOT NULL CHECK (kind IN ('many_scans', 'many_places', 'tampered')),
        detail          JSONB NOT NULL DEFAULT '{}',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        acknowledged_by UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
        acknowledged_at TIMESTAMPTZ,
        note            TEXT
      );
    `);
    // One open alert per document and kind
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_scan_alerts_open
                          ON scan_alerts(tenant_id, doc_id, kind) WHERE acknowledged_at IS NULL;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_scan_alerts_tenant ON scan_alerts(tenant_id, created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_verification_log_doc_time ON verification_log(doc_id, verified_at DESC);`);
    console.log('✓ scan_alerts');

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
