// migrations/010_lockout_totp.js
// Run once: node migrations/010_lockout_totp.js
// Holder portal: lock an account for 15 minutes after 5 wrong PINs, as staff
// accounts already are. PINs are only 4 to 8 digits, so the per-IP rate limit
// alone isn't enough against guessing spread across many addresses.
// Staff: remember the last TOTP time step used, so a code can't be replayed
// within its validity window.
// Safe to run more than once.

require('dotenv').config();
const pool = require('../src/db/pool');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE student_tokens ADD COLUMN IF NOT EXISTS failed_logins INTEGER NOT NULL DEFAULT 0;`);
    await client.query(`ALTER TABLE student_tokens ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;`);
    console.log('✓ student_tokens: failed_logins, locked_until');
    await client.query(`ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS totp_last_step BIGINT;`);
    console.log('✓ tenant_users: totp_last_step');
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
