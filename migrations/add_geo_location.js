const { Pool } = require('pg');
require('dotenv').config();
 
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
 
pool.query(`
  ALTER TABLE verification_log
  ADD COLUMN IF NOT EXISTS geo_location VARCHAR(100);
`).then(() => {
  console.log('geo_location column added successfully.');
  pool.end();
}).catch(e => {
  console.error('Migration failed:', e.message);
  pool.end();
});
 