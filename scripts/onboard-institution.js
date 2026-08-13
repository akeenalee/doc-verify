// scripts/onboard-institution.js
// Usage: node scripts/onboard-institution.js
// Interactive script to onboard a new institution onto the UniVerify platform

require('dotenv').config();
const pool     = require('../src/db/pool');
const readline = require('readline');

const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
}

function validateHex(val, def) {
  return /^#[0-9A-Fa-f]{6}$/.test(val) ? val : def;
}

async function run() {
  console.log('\n=== UniVerify — Institution Onboarding ===\n');

  const name         = (await ask('Institution full name (e.g. Lagos State University): ')).trim();
  const defaultSlug  = slugify(name);
  const subdomainRaw = (await ask(`Subdomain (e.g. lasu) [default: ${defaultSlug}]: `)).trim();
  const subdomain    = (subdomainRaw || defaultSlug).toLowerCase().replace(/[^a-z0-9-]/g, '');
  const shortCode    = (await ask('Short code for document IDs (e.g. LASU, max 8 chars): ')).trim().toUpperCase().slice(0, 8);
  const type         = (await ask('Institution type [academic/government/hospital/court] (default: academic): ')).trim() || 'academic';
  const email        = (await ask('Institution contact email: ')).trim();
  const phone        = (await ask('Contact phone (optional, Enter to skip): ')).trim() || null;
  const website      = (await ask('Website (optional, Enter to skip): ')).trim() || null;
  const address      = (await ask('Address (optional, Enter to skip): ')).trim() || null;

  const pcRaw        = (await ask('Primary colour hex (default: #1A3A5C): ')).trim();
  const acRaw        = (await ask('Accent colour hex  (default: #B8860B): ')).trim();
  const primaryCol   = validateHex(pcRaw, '#1A3A5C');
  const accentCol    = validateHex(acRaw, '#B8860B');

  const plan         = (await ask('Plan [standard/premium/enterprise] (default: standard): ')).trim() || 'standard';

  console.log('\n--- Review ---');
  console.log(`Name:       ${name}`);
  console.log(`Subdomain:  ${subdomain}.univerify.ng`);
  console.log(`Short code: ${shortCode}`);
  console.log(`Type:       ${type}`);
  console.log(`Email:      ${email}`);
  console.log(`Colours:    ${primaryCol} / ${accentCol}`);
  console.log(`Plan:       ${plan}`);

  const confirm = (await ask('\nProceed? (yes/no): ')).trim().toLowerCase();
  if (confirm !== 'yes') {
    console.log('Aborted.');
    rl.close();
    await pool.end();
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO tenants (
        name, subdomain, short_code, institution_type, contact_email,
        contact_phone, website, address, primary_colour, accent_colour, plan, active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE)
      RETURNING id, subdomain`,
      [name, subdomain, shortCode, type, email,
       phone, website, address, primaryCol, accentCol, plan]
    );

    const tenant = result.rows[0];
    console.log('\n✓ Institution created successfully');
    console.log(`  Tenant ID:  ${tenant.id}`);
    console.log(`  URL:        https://${tenant.subdomain}.univerify.ng`);
    console.log('\nNext steps:');
    console.log('  1. DNS wildcard record already covers this subdomain automatically');
    console.log('  2. Test by visiting https://' + tenant.subdomain + '.univerify.ng');
    console.log('  3. Upload institution logo via the admin panel');
    console.log('  4. Share demo credentials with institution contact\n');
  } catch (e) {
    if (e.code === '23505') {
      console.error(`\nError: subdomain "${subdomain}" or short code "${shortCode}" already exists.`);
    } else {
      console.error('\nError:', e.message);
    }
  }

  rl.close();
  await pool.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });