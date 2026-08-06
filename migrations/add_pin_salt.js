const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.query(`
  ALTER TABLE student_tokens
  ADD COLUMN IF NOT EXISTS pin_salt VARCHAR(32);
`)
.then(() => {
  console.log('pin_salt column added.');
  // Existing accounts have no salt - they keep working with empty salt
  // New accounts will get a proper salt at registration
  console.log('Existing accounts: PIN verified with empty salt (backwards compatible).');
  pool.end();
})
.catch(e => { console.error('Migration failed:', e.message); pool.end(); });