// migrations/create_tenants_table.js
// Run once: node migrations/create_tenants_table.js
// Creates the tenants table — the foundation of the multi-tenant architecture

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create tenants table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name            VARCHAR(200) NOT NULL,
        subdomain       VARCHAR(100) NOT NULL UNIQUE,
        short_code      VARCHAR(20)  NOT NULL UNIQUE,
        logo_url        TEXT,
        primary_colour  VARCHAR(7)   DEFAULT '#1A3A5C',
        accent_colour   VARCHAR(7)   DEFAULT '#B8860B',
        institution_type VARCHAR(50) DEFAULT 'academic',
        address         TEXT,
        website         VARCHAR(200),
        paystack_split_code VARCHAR(100),
        contact_email   VARCHAR(200),
        contact_phone   VARCHAR(50),
        active          BOOLEAN      DEFAULT TRUE,
        plan            VARCHAR(20)  DEFAULT 'standard',
        max_documents   INTEGER      DEFAULT 50000,
        created_at      TIMESTAMPTZ  DEFAULT NOW(),
        updated_at      TIMESTAMPTZ  DEFAULT NOW()
      );
    `);
    console.log('✓ tenants table created');

    // Index on subdomain — looked up on every request
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tenants_subdomain ON tenants(subdomain);
    `);
    console.log('✓ index on tenants.subdomain created');

    // Index on short_code — used for document ID prefix
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tenants_short_code ON tenants(short_code);
    `);
    console.log('✓ index on tenants.short_code created');

    // Seed the default Innovation Lens demo tenant
    // This keeps the existing demo working without any changes
    await client.query(`
      INSERT INTO tenants (
        id, name, subdomain, short_code, primary_colour, accent_colour,
        institution_type, contact_email, active, plan
      ) VALUES (
        '00000000-0000-0000-0000-000000000001',
        'Innovation Lens Resources Ltd',
        'demo',
        'IL',
        '#1A3A5C',
        '#B8860B',
        'academic',
        'info@akeenalee.com',
        TRUE,
        'standard'
      )
      ON CONFLICT (subdomain) DO NOTHING;
    `);
    console.log('✓ default demo tenant seeded (subdomain: demo)');

    await client.query('COMMIT');
    console.log('\nTenants table migration complete.');
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