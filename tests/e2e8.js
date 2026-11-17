// Account protection: holder PIN lockout, staff TOTP secrets encrypted at rest and bound to the user, TOTP codes single use
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DOC_SECRET = process.env.DOC_SECRET || 'testsecret';
const fs = require('fs');
const http = require('http');
const { execSync } = require('child_process');
const A = require('../src/utils/staffAuth');
const pool = require('../src/db/pool');

function client(host) {
  let cookie = '';
  return (method, path, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: 'localhost', port: 3000, method, path,
      headers: { Host: host, Accept: 'application/json', 'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
        const sc = res.headers['set-cookie']; if (sc) cookie = sc[0].split(';')[0];
        const buf = Buffer.concat(chunks); const ct = res.headers['content-type'] || '';
        let b = buf; if (ct.includes('json')) { try { b = JSON.parse(buf.toString()); } catch (e) {} } else if (/text|html|svg/.test(ct)) b = buf.toString();
        resolve({ status: res.statusCode, body: b, ct, location: res.headers.location });
      });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const code = s => A.hotp(s, Math.floor(Date.now() / 30000));
async function setup(c, link, pw, name) {
  const token = new URL(link).searchParams.get('token');
  let r = await c('POST', '/app-api/auth/invite/start', { token, password: pw, full_name: name });
  r = await c('POST', '/app-api/auth/invite/confirm', { token, code: code(r.body.secret) });
  return r.status === 200;
}
const path = u => { const x = new URL(u); return x.pathname + x.search; };

(async () => {
  const admin = client('demo.localhost:3000');
  await admin('POST', '/admin-api/login', { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS });
  const lasu = (await admin('GET', '/admin-api/tenants')).body.tenants.find(t => t.subdomain === 'lasu');

  // ── Staff TOTP secret encrypted at rest ──
  let r = await admin('POST', `/admin-api/tenants/${lasu.id}/owner-invite`, { email: 'registrar@lasu.edu.ng', full_name: 'Dr Registrar' });
  const owner = client('lasu.localhost:3000');
  const token = new URL(r.body.link).searchParams.get('token');
  r = await owner('POST', '/app-api/auth/invite/start', { token, password: 'Registrar2026', full_name: 'Dr Registrar' });
  const secret = r.body.secret;
  let row = (await pool.query("SELECT id, totp_secret FROM tenant_users WHERE LOWER(email) = 'registrar@lasu.edu.ng'")).rows[0];
  ok(row.totp_secret.startsWith('v1:') && !row.totp_secret.includes(secret), 'TOTP secret stored encrypted, never in plain');
  r = await owner('POST', '/app-api/auth/invite/confirm', { token, code: code(secret) });
  ok(r.status === 200, 'setup confirmed with a code from the encrypted secret');

  const signIn = async (c, email, pw, totp) => {
    await c('POST', '/app-api/auth/logout');
    const a = await c('POST', '/app-api/auth/login', { email, password: pw });
    if (a.status !== 200) return a;
    return c('POST', '/app-api/auth/verify', { code: totp });
  };
  const owner2 = client('lasu.localhost:3000');
  const c1 = code(secret);
  r = await signIn(owner2, 'registrar@lasu.edu.ng', 'Registrar2026', c1);
  ok(r.status === 200, 'owner signs in with password and code');
  const owner3 = client('lasu.localhost:3000');
  r = await signIn(owner3, 'registrar@lasu.edu.ng', 'Registrar2026', c1);
  ok(r.status === 401, 'the same code used a second time is refused');
  const last = (await pool.query('SELECT totp_last_step FROM tenant_users WHERE id = $1', [row.id])).rows[0].totp_last_step;
  ok(Math.abs(Number(last) - Math.floor(Date.now() / 30000)) <= 1, 'last used time step recorded');
  // Next window's code works (the window allows one step either side)
  r = await signIn(owner3, 'registrar@lasu.edu.ng', 'Registrar2026', A.hotp(secret, Number(last) + 1));
  ok(r.status === 200, 'a newer code still works');
  await pool.query('UPDATE tenant_users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [row.id]);

  // Rows saved before encryption hold the plain secret: still work, sealed on sign-in
  const off = await owner2('POST', '/app-api/users', { email: 'officer@lasu.edu.ng', full_name: 'Officer', roles: ['officer'] });
  const offC = client('lasu.localhost:3000');
  const offToken = new URL(off.body.link).searchParams.get('token');
  r = await offC('POST', '/app-api/auth/invite/start', { token: offToken, password: 'Password2026x', full_name: 'Officer' });
  const offSecret = r.body.secret;
  await offC('POST', '/app-api/auth/invite/confirm', { token: offToken, code: code(offSecret) });
  const offId = (await pool.query("SELECT id FROM tenant_users WHERE LOWER(email) = 'officer@lasu.edu.ng'")).rows[0].id;
  await pool.query('UPDATE tenant_users SET totp_secret = $2, totp_last_step = NULL WHERE id = $1', [offId, offSecret]);
  r = await signIn(client('lasu.localhost:3000'), 'officer@lasu.edu.ng', 'Password2026x', code(offSecret));
  ok(r.status === 200, 'account with an old plain secret still signs in');
  const sealed = (await pool.query('SELECT totp_secret FROM tenant_users WHERE id = $1', [offId])).rows[0].totp_secret;
  ok(sealed.startsWith('v1:') && !sealed.includes(offSecret), 'old plain secret sealed on that sign-in');

  // A sealed secret copied onto another user's row doesn't open there
  const ownerSealed = (await pool.query('SELECT totp_secret FROM tenant_users WHERE id = $1', [row.id])).rows[0].totp_secret;
  await pool.query('UPDATE tenant_users SET totp_secret = $2, totp_last_step = NULL WHERE id = $1', [offId, ownerSealed]);
  r = await signIn(client('lasu.localhost:3000'), 'officer@lasu.edu.ng', 'Password2026x', A.hotp(secret, Math.floor(Date.now() / 30000) + 1));
  ok(r.status === 401 || r.status === 500, "another user's sealed secret copied onto this row doesn't work (fails closed)");
  await pool.query('UPDATE tenant_users SET totp_secret = $2 WHERE id = $1', [offId, sealed]);

  // ── Holder PIN lockout ──
  const MATRIC = 'LOCK/2020/0001';
  await pool.query(`INSERT INTO student_tokens (matric_number, institution, full_name, tenant_id, pin_hash, verified_at)
                    VALUES ($1, $2, 'Locked Holder', $3, $4, NOW())`, [MATRIC, lasu.name, lasu.id, A.hashPassword('482913')]);
  const holder = client('lasu.localhost:3000');
  const login = pin => holder('POST', '/api/tokens/login', { matric_number: MATRIC, institution: lasu.name, pin });
  r = await login('482913');
  ok(r.status === 200, 'holder signs in with the right PIN');
  for (let i = 0; i < 4; i++) await login('000000');
  let st = (await pool.query('SELECT failed_logins, locked_until FROM student_tokens WHERE matric_number = $1', [MATRIC])).rows[0];
  ok(st.failed_logins === 4 && !st.locked_until, 'four wrong PINs counted, not locked yet');
  r = await login('000000');
  ok(r.status === 401, 'fifth wrong PIN refused');
  st = (await pool.query('SELECT failed_logins, locked_until FROM student_tokens WHERE matric_number = $1', [MATRIC])).rows[0];
  ok(st.locked_until && new Date(st.locked_until) > new Date(Date.now() + 14 * 60000), 'account locked for 15 minutes');
  r = await login('482913');
  ok(r.status === 429 && /15 minutes/.test(r.body.error), 'right PIN refused while locked');
  await pool.query("UPDATE student_tokens SET locked_until = NOW() - interval '1 second' WHERE matric_number = $1", [MATRIC]);
  r = await login('000000');
  st = (await pool.query('SELECT failed_logins, locked_until FROM student_tokens WHERE matric_number = $1', [MATRIC])).rows[0];
  ok(r.status === 401 && new Date(st.locked_until) < new Date(), 'after the lock ends, one wrong PIN does not lock again');
  r = await login('482913');
  st = (await pool.query('SELECT failed_logins FROM student_tokens WHERE matric_number = $1', [MATRIC])).rows[0];
  ok(r.status === 200 && st.failed_logins === 0, 'right PIN after the lock signs in and clears the count');

  await pool.end();
})().catch(e => { console.error(e); process.exitCode = 1; });
