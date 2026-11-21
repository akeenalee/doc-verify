#!/usr/bin/env node
// Runs the end-to-end suites against a throwaway database.
//
//   TEST_DATABASE_URL=postgres://postgres@localhost:5433/uv npm test
//   npm test -- e2e4            (one suite)
//   npm test -- --setup         (create the schema and test issuers first)
//
// Every suite starts from a reset database and a fresh server on :3000, so
// rate limits and caches never carry over. The server gets test-only secrets
// on its command line, which win over anything in .env (dotenv never
// overrides a variable that is already set), so no email is sent, no real
// key is used and Paystack is never called.
//
// SAFETY: reset.sql deletes the dsu issuer's data. The runner refuses any
// database that isn't on this machine, unless ALLOW_REMOTE_TEST_DB=1 (for a
// throwaway Neon branch), and always refuses the DATABASE_URL in .env.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const SUITES = ['e2e', 'e2e2', 'e2e3', 'e2e4', 'e2e5', 'e2e6', 'e2e7', 'e2e8', 'e2e9', 'e2e10', 'e2e11', 'e2e12', 'e2e13'];
// Suites for the sectors deployment (DEPLOYMENT=sectors). Its start-up guard
// refuses a database holding school tenants, so they get their own database,
// rebuilt from scratch on every run.
const SECTOR_SUITES = ['e2e13'];

function fail(msg) { console.error('\n' + msg + '\n'); process.exit(2); }

const url = process.env.TEST_DATABASE_URL;
if (!url) fail('Set TEST_DATABASE_URL to a throwaway database. Never the production one.');

let host;
try { host = new URL(url).hostname; } catch (_) { fail('TEST_DATABASE_URL is not a valid URL.'); }
if (!['localhost', '127.0.0.1', '::1'].includes(host) && process.env.ALLOW_REMOTE_TEST_DB !== '1')
  fail(`Refusing ${host}: the suites delete data. Use a local database, or a throwaway Neon branch with ALLOW_REMOTE_TEST_DB=1.`);
try {
  const env = require('dotenv').parse(fs.readFileSync(path.join(ROOT, '.env')));
  if (env.DATABASE_URL && env.DATABASE_URL.trim() === url.trim()) fail('TEST_DATABASE_URL is the DATABASE_URL in .env. Refusing.');
} catch (e) { if (e.code !== 'ENOENT') throw e; }

// The sectors database: SECTORS_TEST_DATABASE_URL, or the test database's name plus _sectors
const sectorsUrl = process.env.SECTORS_TEST_DATABASE_URL || (() => { const u = new URL(url); u.pathname += '_sectors'; return u.toString(); })();
if (sectorsUrl.trim() === url.trim()) fail('SECTORS_TEST_DATABASE_URL must differ from TEST_DATABASE_URL.');

const ADMIN_USER = 'iladmin-test';
const ADMIN_PASS = 'T3st-' + crypto.randomBytes(9).toString('hex');

const serverEnv = {
  ...process.env,
  NODE_ENV: 'test', PORT: '3000', BASE_URL: 'http://localhost:3000',
  DATABASE_URL: url, DOC_SECRET: 'testsecret', SESSION_SECRET: crypto.randomBytes(16).toString('hex'),
  SIGNING_MASTER_KEY: '', ADMIN_USER, ADMIN_PASS, ADMIN_TOTP_SECRET: '',
  MOCK_SIS_ENABLED: '1', MOCK_SIS_TOKEN: '',
  PAYSTACK_SECRET_KEY: 'sk_test_local_only', PAYSTACK_PUBLIC_KEY: '',
  // A fake Paystack on localhost (e2e10 runs one); other suites get a refused connection
  PAYSTACK_API_BASE: 'http://localhost:3999',
  SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', IPINFO_TOKEN: '', RETENTION_DISABLED: '1',
  // Telemetry off (a key set here wins over .env), except for e2e11 below
  OTEL_EXPORTER_OTLP_ENDPOINT: '', OTEL_EXPORTER_OTLP_HEADERS: '',
};
// e2e11 runs a fake OTLP collector on :4318 and checks what reaches it
const SUITE_SERVER_ENV = {
  e2e13: { DATABASE_URL: sectorsUrl, DEPLOYMENT: 'sectors' },
  e2e11: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318', OTEL_METRIC_EXPORT_INTERVAL: '1000', OTEL_BSP_SCHEDULE_DELAY: '200' },
};
const suiteEnv = { ...process.env, TEST_DATABASE_URL: url, ADMIN_USER, ADMIN_PASS,
  PAYSTACK_SECRET_KEY: serverEnv.PAYSTACK_SECRET_KEY, DOC_SECRET: 'testsecret', SIGNING_MASTER_KEY: '' };
// Sector suites read the sectors database, and get the school one plus the
// server settings so they can check the start-up guard against both
const SUITE_ENV = {
  e2e13: { TEST_DATABASE_URL: sectorsUrl, TERTIARY_TEST_DATABASE_URL: url, SERVER_ENV: JSON.stringify(serverEnv) },
};

async function sql(file, db = url) {
  const c = new Client({ connectionString: db });
  await c.connect();
  try { await c.query(fs.readFileSync(path.join(__dirname, file), 'utf8')); } finally { await c.end(); }
}

async function setup(db = url, seed = 'seed.sql') {
  const c = new Client({ connectionString: db });
  await c.connect();
  const has = (await c.query("SELECT to_regclass('public.tenants') AS t")).rows[0].t;
  await c.end();
  if (!has) { console.log('Creating schema'); await sql('schema.sql', db); }
  // Numbered migrations are idempotent; this picks up any newer than schema.sql
  for (const f of fs.readdirSync(path.join(ROOT, 'migrations')).filter(f => /^\d{3}_.*\.js$/.test(f)).sort()) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'migrations', f)], { env: { ...process.env, DATABASE_URL: db }, encoding: 'utf8' });
    if (r.status !== 0) fail(`Migration ${f} failed:\n${r.stderr || r.stdout}`);
  }
  await sql(seed, db);
  console.log('Test database ready.');
}

// A fresh sectors database: dropped, created, schema, migrations, demo only
async function freshSectorsDb() {
  const target = new URL(sectorsUrl), name = decodeURIComponent(target.pathname.slice(1));
  if (!/^[a-z0-9_]+$/i.test(name)) fail(`Unexpected sectors database name "${name}".`);
  const adminUrl = new URL(sectorsUrl); adminUrl.pathname = '/postgres';
  const c = new Client({ connectionString: adminUrl.toString() });
  await c.connect();
  try {
    await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await c.query(`CREATE DATABASE "${name}"`);
  } finally { await c.end(); }
  await setup(sectorsUrl, 'seed-sectors.sql');
}

function health() {
  return new Promise(resolve => {
    const req = http.get({ host: 'localhost', port: 3000, path: '/health', timeout: 1000 }, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function startServer(logFile, extraEnv = {}) {
  if (await health()) fail('Something is already listening on port 3000. Stop it first.');
  const log = fs.openSync(logFile, 'w');
  const srv = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], { cwd: ROOT, env: { ...serverEnv, ...extraEnv }, stdio: ['ignore', log, log] });
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 250));
    if (await health()) return srv;
  }
  srv.kill();
  fail(`The server didn't start. See ${logFile}`);
}

function runSuite(name) {
  return new Promise(resolve => {
    const out = [];
    const p = spawn(process.execPath, [path.join(__dirname, name + '.js')], { cwd: __dirname, env: { ...suiteEnv, ...SUITE_ENV[name] } });
    p.stdout.on('data', d => { out.push(d); process.stdout.write(d); });
    p.stderr.on('data', d => process.stderr.write(d));
    p.on('close', code => {
      const text = Buffer.concat(out).toString();
      resolve({ name, code, pass: (text.match(/^PASS /gm) || []).length, fail: (text.match(/^FAIL /gm) || []).length });
    });
  });
}

(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--setup')) await setup();
  const pick = args.filter(a => !a.startsWith('--'));
  const suites = pick.length ? SUITES.filter(s => pick.includes(s)) : SUITES;
  if (!suites.length) fail(`No such suite. Choose from: ${SUITES.join(', ')}`);

  const outDir = require('./out');
  const results = [];
  for (const s of suites) {
    console.log(`\n=== ${s} ===`);
    if (SECTOR_SUITES.includes(s)) await freshSectorsDb();
    else await sql('reset.sql');
    const srv = await startServer(path.join(outDir, `server-${s}.log`), SUITE_SERVER_ENV[s]);
    try { results.push(await runSuite(s)); } finally { srv.kill(); await new Promise(r => { if (srv.exitCode !== null) return r(); srv.once('exit', r); setTimeout(r, 5000); }); await new Promise(r => setTimeout(r, 300)); }
  }

  console.log('\n=== Summary ===');
  let pass = 0, failed = 0;
  for (const r of results) {
    pass += r.pass; failed += r.fail;
    console.log(`${r.name.padEnd(5)}  ${String(r.pass).padStart(3)} passed  ${String(r.fail).padStart(3)} failed${r.code && !r.fail ? '  (exited with an error)' : ''}`);
  }
  console.log(`Total  ${pass} passed, ${failed} failed`);
  process.exit(failed || results.some(r => r.code) ? 1 : 0);
})().catch(e => fail(e.stack || e.message));
