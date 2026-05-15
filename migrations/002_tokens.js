require('dotenv').config();
const pool = require('../src/db/pool');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS student_tokens (
        id            SERIAL PRIMARY KEY,
        matric_number VARCHAR(50) NOT NULL,
        institution   VARCHAR(100) NOT NULL,
        pin_hash      VARCHAR(255),
        token_balance INTEGER NOT NULL DEFAULT 0,
        email         VARCHAR(255),
        phone         VARCHAR(30),
        full_name     VARCHAR(255),
        notify_email  BOOLEAN DEFAULT false,
        notify_sms    BOOLEAN DEFAULT false,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(matric_number, institution)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_student_tokens_matric
        ON student_tokens(matric_number);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS token_purchases (
        id                SERIAL PRIMARY KEY,
        matric_number     VARCHAR(50) NOT NULL,
        institution       VARCHAR(100) NOT NULL,
        bundle_size       INTEGER NOT NULL,
        amount_kobo       INTEGER NOT NULL,
        paystack_ref      VARCHAR(100) UNIQUE NOT NULL,
        paystack_status   VARCHAR(20) NOT NULL DEFAULT 'pending',
        email             VARCHAR(255),
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at      TIMESTAMPTZ
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS verification_payments (
        id              SERIAL PRIMARY KEY,
        doc_id          VARCHAR(64) NOT NULL,
        payer_email     VARCHAR(255),
        amount_kobo     INTEGER NOT NULL,
        paystack_ref    VARCHAR(100) UNIQUE NOT NULL,
        paystack_status VARCHAR(20) NOT NULL DEFAULT 'pending',
        result_shown    BOOLEAN DEFAULT false,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at    TIMESTAMPTZ
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_vp_doc_id ON verification_payments(doc_id);
      CREATE INDEX IF NOT EXISTS idx_vp_ref ON verification_payments(paystack_ref);
      CREATE INDEX IF NOT EXISTS idx_tp_ref ON token_purchases(paystack_ref);
    `);

    await client.query('COMMIT');
    console.log('Token migration complete.');
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