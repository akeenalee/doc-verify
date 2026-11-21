// scripts/init-sectors-db.js
// Builds the database for the sectors deployment (DEPLOYMENT=sectors) from
// empty: the base schema, every numbered migration, and the Innovation Lens
// root tenant (demo) so /admin works. Safe to run again: it skips what exists.
//
// Refuses a database that already holds school issuers, so it can't be run
// against the tertiary database by mistake. It never reads DATABASE_URL from
// .env (that is the school database): it asks for the connection string, or
// takes it from SECTORS_DATABASE_URL.
//
//   node scripts/init-sectors-db.js
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const readline = require('readline');
const rootSub = (process.env.ROOT_TENANT_SUBDOMAIN || 'demo').toLowerCase();

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(q, a => { rl.close(); r(a.trim()); }));
}

async function run() {
  let url = (process.env.SECTORS_DATABASE_URL || '').trim();
  if (!url) url = await ask('Paste the connection string of the NEW sectors database, then press Enter:\n> ');
  if (!/^postgres(ql)?:\/\//.test(url)) throw new Error('That is not a postgres:// connection string. Nothing was changed.');
  url = url.replace(/^['"]|['"]$/g, '');
  process.env.DATABASE_URL = url;   // for the pool and the migrations below
  const pool = require('../src/db/pool');
  const c = await pool.connect();
  try {
    const host = new URL(url).hostname;
    console.log(`Database host: ${host}`);
    const has = (await c.query("SELECT to_regclass('public.tenants') AS t")).rows[0].t;
    if (has) {
      const cols = (await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'sector'`)).rows.length;
      const schools = (await c.query(
        cols ? `SELECT subdomain FROM tenants WHERE LOWER(subdomain) <> $1 AND sector = 'tertiary'`
             : `SELECT subdomain FROM tenants WHERE LOWER(subdomain) <> $1`, [rootSub])).rows;
      if (schools.length)
        throw new Error(`This database holds school issuers (${schools.slice(0, 5).map(r => r.subdomain).join(', ')}). ` +
          'It is the tertiary database, not a new sectors one. Nothing was changed.');
      console.log('✓ schema already there');
    } else {
      await c.query(fs.readFileSync(path.join(ROOT, 'tests', 'schema.sql'), 'utf8'));
      await c.query("SELECT pg_catalog.set_config('search_path', 'public', false)");
      console.log('✓ base schema created');
    }
  } finally { c.release(); }

  const files = fs.readdirSync(path.join(ROOT, 'migrations')).filter(f => /^\d{3}_.*\.js$/.test(f)).sort();
  for (const f of files) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'migrations', f)], { cwd: ROOT, env: process.env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`Migration ${f} failed:\n${r.stderr || r.stdout}`);
    console.log(`✓ ${f}`);
  }

  const c2 = await pool.connect();
  try {
    const r = await c2.query(
      `INSERT INTO tenants (name, subdomain, short_code, institution_type, active)
       VALUES ('Innovation Lens Resources Ltd', $1, 'IL', 'academic', TRUE)
       ON CONFLICT DO NOTHING RETURNING id`, [rootSub]);
    await c2.query('UPDATE tenants SET student_claim_required = FALSE WHERE LOWER(subdomain) = $1', [rootSub]);
    console.log(r.rows.length ? `✓ root tenant "${rootSub}" created` : `✓ root tenant "${rootSub}" already there`);
    const n = (await c2.query('SELECT COUNT(*)::int AS n FROM tenants')).rows[0].n;
    console.log(`Sectors database ready (${n} tenant${n === 1 ? '' : 's'}).`);
  } finally { c2.release(); await pool.end(); }
}

run().catch(e => { console.error('✗ ' + e.message); process.exitCode = 1; });
