// Drives every page in Chromium under the real Content-Security-Policy and
// fails on any blocked script, inline handler or page error. Expects a server
// on :3000 started the way tests/run.js starts one (same env), on a fresh
// database (npm test resets it).
const { chromium, devices } = require('playwright');
const A = require('../src/utils/staffAuth');
const http = require('http');
function post(host, path, body, cookie) { return new Promise(res => { const d = JSON.stringify(body);
  const r = http.request({ host: 'localhost', port: 3000, method: 'POST', path, headers: { Host: host, 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(d), ...(cookie ? { cookie } : {}) } },
    x => { let b = ''; x.on('data', c => b += c); x.on('end', () => res({ cookie: (x.headers['set-cookie'] || [''])[0].split(';')[0], body: JSON.parse(b || '{}') })); });
  r.write(d); r.end(); }); }
function get(host, path, cookie) { return new Promise(res => http.get({ host: 'localhost', port: 3000, path, headers: { Host: host, Accept: 'application/json', cookie } },
  x => { let b = ''; x.on('data', c => b += c); x.on('end', () => res(JSON.parse(b))); })); }
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

(async () => {
  const browser = await chromium.launch();
  const T = 10000;
  const problems = [];
  const watch = (page, label) => {
    page.on('pageerror', e => problems.push(`${label}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`${label}: ${m.text()}`); });
  };
  const check = (label, before) => { const mine = problems.slice(before); ok(!mine.length, label + (mine.length ? ' :: ' + mine.join(' | ') : '')); };
  const D = 'http://demo.localhost:3000', L = 'http://lasu.localhost:3000';

  const hdr = await new Promise(res => http.get({ host: 'localhost', port: 3000, path: '/help.html', headers: { Host: 'demo.localhost:3000' } }, x => { x.resume(); res(x.headers['content-security-policy'] || ''); }));
  ok(/script-src 'self'(;|$)/.test(hdr) && /script-src-attr 'none'/.test(hdr), 'CSP has no unsafe-inline for scripts');

  // ── Demo dashboard ──
  let ctx = await browser.newContext(); let page = await ctx.newPage(); page.setDefaultTimeout(T); watch(page, 'demo');
  let n = problems.length;
  await page.goto(D + '/demo-login.html');
  await page.fill('#full_name', 'Csp Tester'); await page.fill('#company', 'QA'); await page.fill('#role', 'Tester');
  await page.fill('#username', 'univerify'); await page.fill('#password', 'Demo@2026!');
  await page.click('#login-btn');
  await page.waitForURL(u => !/demo-login/.test(u.toString()), { timeout: 8000 });
  await page.waitForSelector('#loader-screen', { state: 'hidden', timeout: 20000 });
  if (await page.isVisible('#tab-other')) { await page.click('#tab-other'); await page.click('#tab-academic'); }
  await page.fill('#g-title', 'B.Sc. Test'); await page.fill('#g-issuedTo', 'Ade Ola'); await page.fill('#g-matric', 'CSP/2026/001');
  await page.click('#g-btn');
  await page.waitForSelector('#g-result.show', { timeout: 8000 });
  ok(!!(await page.getAttribute('#g-qr', 'src')), 'demo dashboard generates a document');
  check('demo login and dashboard run with no blocked scripts', n);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: D });
  await page.goto(D + '/help.html'); n = problems.length;
  await page.click('.copy-btn'); await page.waitForTimeout(300);
  ok((await page.textContent('.copy-btn')) === 'Copied!', 'help page copy button works');
  check('help page', n);
  await ctx.close();

  // ── IL admin ──
  ctx = await browser.newContext(); page = await ctx.newPage(); watch(page, 'admin'); n = problems.length;
  await page.goto(D + '/admin-login.html');
  await page.fill('#username', process.env.ADMIN_USER); await page.fill('#password', process.env.ADMIN_PASS);
  await page.click('#login-btn');
  await page.waitForURL(/\/admin/, { timeout: 8000 });
  await page.waitForSelector('#tokens-body', { timeout: 8000 });
  await page.evaluate(() => fetch('/admin-api/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'CSP check', name: 'Prospect', expires_days: 7, max_uses: 5 }) }));
  await page.reload(); await page.waitForSelector('#tokens-body [data-revoke]');
  page.once('dialog', d => d.accept());
  await page.click('#tokens-body [data-revoke]');
  await page.waitForSelector('#tokens-body [data-activate]');
  ok(true, 'admin token Revoke button works without inline onclick');
  check('admin console', n);
  n = problems.length; await page.goto(D + '/onboard.html'); await page.waitForTimeout(1000); check('onboard page', n);
  await ctx.close();

  // ── Holder portal and pay page ──
  ctx = await browser.newContext(); page = await ctx.newPage(); watch(page, 'holder'); n = problems.length;
  await page.goto(L + '/student.html'); await page.waitForTimeout(800);
  await page.goto(L + '/pay.html?doc=NOPE-1&type=Certificate&issued_by=LASU'); await page.waitForTimeout(800);
  ok((await page.textContent('#doc-title')) === 'Certificate', 'pay page script runs');
  check('holder portal and pay page', n);
  await ctx.close();

  // ── Staff workspace ──
  const a = await post('demo.localhost:3000', '/admin-api/login', { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS });
  const t = await get('demo.localhost:3000', '/admin-api/tenants', a.cookie);
  const lasu = t.tenants.find(x => x.subdomain === 'lasu');
  const inv = await post('demo.localhost:3000', `/admin-api/tenants/${lasu.id}/owner-invite`, { email: 'csp.owner@lasu.edu.ng', full_name: 'Csp Owner' }, a.cookie);
  ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); page = await ctx.newPage(); watch(page, 'staff'); n = problems.length;
  await page.goto(inv.body.link);
  await page.fill('#pw1', 'CspOwner2026pass'); await page.fill('#pw2', 'CspOwner2026pass');
  await page.click('#btn-1');
  await page.waitForSelector('#step-2', { state: 'visible' });
  const secret = (await page.textContent('#secret')).replace(/\s/g, '');
  await page.fill('#code', A.hotp(secret, Math.floor(Date.now() / 30000)));
  await page.click('#btn-2');
  await page.waitForSelector('#step-3', { state: 'visible' });
  await page.click('#go');
  await page.waitForSelector('.cards');
  const doc = await page.evaluate(async () => {
    const r = await fetch('/app-api/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc_type: 'Certificate', title: 'B.Sc. Physics', issued_to: 'Ngozi Okafor', matric_number: 'CSP/2021/044' }) });
    return (await r.json()).document;
  });
  for (const v of ['#/documents', '#/doc/' + doc.doc_id, '#/issue', '#/scans', '#/activity', '#/users', '#/settings', '#/security', '#/students']) {
    await page.goto(L + '/app/' + v); await page.waitForTimeout(500);
  }
  check('staff invite, sign-in and workspace pages', n);
  const verifyUrl = await page.evaluate(async id => (await (await fetch('/app-api/documents/' + encodeURIComponent(id))).json()), doc.doc_id);
  n = problems.length;
  await page.goto(L + '/app/login.html'); await page.waitForTimeout(500);
  check('staff login page', n);
  await ctx.close();

  // ── Verify page on a phone: the holder has a token, so the full result and PDF show ──
  const link = verifyUrl.verify_url || (verifyUrl.document && verifyUrl.document.verify_url);
  const { Client } = require('pg');
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await db.connect();
  await db.query(`INSERT INTO student_tokens (matric_number, institution, pin_hash, pin_salt, tenant_id, token_balance)
                  SELECT metadata->>'matric_number', issued_by, 'x', '', tenant_id, 5 FROM documents WHERE doc_id = $1`, [doc.doc_id]);
  await db.end();
  ctx = await browser.newContext({ ...devices['iPhone 13'] }); page = await ctx.newPage(); watch(page, 'verify'); n = problems.length;
  await page.goto(link ? link.replace(/^https?:\/\/[^/]+/, L) : L + '/verify?doc=' + encodeURIComponent(doc.doc_id));
  await page.waitForSelector('#docPages canvas', { state: 'attached', timeout: 15000 }).catch(() => {});
  ok((await page.$$('#docPages canvas')).length > 0, 'phone verify page draws the PDF with PDF.js from its own file');
  check('verify page', n);
  await ctx.close();

  await browser.close();
})().catch(e => { console.log('FAIL crashed: ' + e.stack); process.exitCode = 1; });
