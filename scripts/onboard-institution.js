// scripts/onboard-institution.js
// Usage: node scripts/onboard-institution.js
// Interactive script to onboard a new institution onto the UniVerify platform

const { Pool } = require('pg');
const readline = require('readline');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
}

async function run() {
  console.log('\n=== UniVerify — Institution Onboarding ===\n');

  const name         = await ask('Institution full name (e.g. Lagos State University): ');
  const subdomainRaw = await ask(`Subdomain (e.g. lasu) [default: ${slugify(name)}]: `);
  const subdomain    = subdomainRaw.trim() || slugify(name);
  const shortCode    = (await ask(`Short code for document IDs (e.g. LASU, max 8 chars): `)).trim().toUpperCase().slice(0, 8);
  const type         = (await ask('Institution type [academic/government/hospital/court] (default: academic): ')).trim() || 'academic';
  const email        = await ask('Institution contact email: ');
  const phone        = await ask('Institution contact phone (optional, press Enter to skip): ');
  const website      = await ask('Institution website (optional, press Enter to skip): ');
  const address      = await ask('Institution address (optional, press Enter to skip): ');
  const primaryCol   = (await ask('Primary colour hex (default: #1A3A5C): ')).trim() || '#1A3A5C';
  const accentCol    = (await ask('Accent colour hex (default: #B8860B): ')).trim() || '#B8860B';
  const plan         = (await ask('Plan [standard/premium/enterprise] (default: standard): ')).trim() || 'standard';

  console.log('\n--- Review ---');
  console.log(`Name:       ${name}`);
  console.log(`Subdomain:  ${subdomain}.univerify.ng`);
  console.log(`Short code: ${shortCode}`);
  console.log(`Type:       ${type}`);
  console.log(`Email:      ${email}`);
  console.log(`Plan:       ${plan}`);

  const confirm = await ask('\nProceed? (yes/no): ');
  if (confirm.trim().toLowerCase() !== 'yes') {
    console.log('Aborted.');
    rl.close();
    pool.end();
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO tenants (
        name, subdomain, short_code, institution_type, contact_email,
        contact_phone, website, address, primary_colour, accent_colour, plan, active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE)
      RETURNING id, subdomain`,
      [
        name, subdomain, shortCode, type, email,
        phone || null, website || null, address || null,
        primaryCol, accentCol, plan
      ]
    );

    const tenant = result.rows[0];
    console.log('\n✓ Institution created successfully');
    console.log(`  Tenant ID:  ${tenant.id}`);
    console.log(`  URL:        https://${tenant.subdomain}.univerify.ng`);
    console.log('\nNext steps:');
    console.log('  1. Add DNS CNAME record: ' + subdomain + '.univerify.ng → your Render/Azure server');
    console.log('  2. Upload institution logo via the admin panel');
    console.log('  3. Share admin credentials with the institution\'s Registrar');
    console.log('  4. Test document generation on the new subdomain\n');
  } catch (e) {
    if (e.code === '23505') {
      console.error(`\nError: subdomain "${subdomain}" or short code "${shortCode}" already exists.`);
    } else {
      console.error('\nError:', e.message);
    }
  }

  rl.close();
  pool.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });