// src/deployment.js
// One codebase, two deployments. Each Render service says which one it is:
//
//   DEPLOYMENT=tertiary  universities, polytechnics, colleges (univerify.ng)
//   DEPLOYMENT=sectors   every other issuer, on its own database and domain
//
// Unset means tertiary, so the existing service keeps working if the variable
// is never added. The sectors service MUST set it.

const { PACKS } = require('./sectors');

const MODES = ['tertiary', 'sectors'];
const raw = String(process.env.DEPLOYMENT || 'tertiary').trim().toLowerCase();
if (!MODES.includes(raw)) {
  console.error(`DEPLOYMENT must be one of: ${MODES.join(', ')}. Got "${process.env.DEPLOYMENT}".`);
  process.exit(1);
}
const MODE = raw;

const ROOT_TENANT = (process.env.ROOT_TENANT_SUBDOMAIN || 'demo').toLowerCase();
const ROOT_DOMAIN = process.env.TENANT_ROOT_DOMAIN || 'univerify.ng';

// Sectors this deployment may hold, in the order onboarding lists them
const ALLOWED = Object.keys(PACKS).filter(s => PACKS[s].deployment === MODE);
const allows = sector => ALLOWED.includes(sector);

// Start-up guard: refuse to run against a database holding issuers from the
// other deployment. That catches a DATABASE_URL pasted into the wrong service.
// The Innovation Lens root tenant (demo) is allowed in both.
async function checkDatabase(pool) {
  let rows;
  try {
    rows = (await pool.query(
      `SELECT subdomain, sector FROM tenants WHERE LOWER(subdomain) <> $1`, [ROOT_TENANT])).rows;
  } catch (e) {
    // Column "sector" missing: migration 014 not run yet. Every tenant lookup
    // would fail, so refuse to start; Render then keeps the previous deploy live.
    if (e.code === '42703') throw new Error('Run migration 014 (node migrations/014_sectors.js) on this database first.');
    throw e;
  }
  const wrong = rows.filter(r => !allows(r.sector));
  if (wrong.length) {
    const list = wrong.slice(0, 5).map(r => `${r.subdomain} (${r.sector})`).join(', ');
    throw new Error(`DEPLOYMENT=${MODE} but this database holds issuers from another deployment: ${list}. ` +
      'Check DATABASE_URL and DEPLOYMENT on this service.');
  }
}

module.exports = { MODE, ALLOWED, allows, ROOT_TENANT, ROOT_DOMAIN, checkDatabase };
