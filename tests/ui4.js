const { chromium } = require('playwright');
const A = require('../src/utils/staffAuth');
const http = require('http');
function post(host, path, body, cookie) { return new Promise(res => { const d = JSON.stringify(body);
  const r = http.request({ host: 'localhost', port: 3000, method: 'POST', path, headers: { Host: host, 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(d), ...(cookie ? { cookie } : {}) } },
    x => { let b = ''; x.on('data', c => b += c); x.on('end', () => res({ cookie: (x.headers['set-cookie'] || [''])[0].split(';')[0], body: JSON.parse(b || '{}') })); });
  r.write(d); r.end(); }); }
function get(host, path, cookie) { return new Promise(res => http.get({ host: 'localhost', port: 3000, path, headers: { Host: host, Accept: 'application/json', cookie } },
  x => { let b = ''; x.on('data', c => b += c); x.on('end', () => res(JSON.parse(b))); })); }
(async () => {
  const a = await post('demo.localhost:3000', '/admin-api/login', { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS });
  const t = await get('demo.localhost:3000', '/admin-api/tenants', a.cookie);
  const lasu = t.tenants.find(x => x.subdomain === 'lasu');
  const inv = await post('demo.localhost:3000', `/admin-api/tenants/${lasu.id}/owner-invite`, { email: 'ui.owner5@lasu.edu.ng', full_name: 'Folake Adeyemi' }, a.cookie);
  const browser = await chromium.launch();
  const out = '/tmp/claude-0/-home-user/37513211-470b-500d-b235-312ece92b61a/scratchpad/';
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(inv.body.link);
  await page.fill('#pw1', 'Folake2026pass'); await page.fill('#pw2', 'Folake2026pass');
  await page.click('#btn-1');
  await page.waitForSelector('#step-2', { state: 'visible' });
  const secret = (await page.textContent('#secret')).replace(/\s/g, '');
  await page.fill('#code', A.hotp(secret, Math.floor(Date.now() / 30000)));
  await page.click('#btn-2');
  await page.waitForSelector('#step-3', { state: 'visible' });
  await page.click('#go');
  await page.waitForSelector('.cards');
  const B = 'http://lasu.localhost:3000/app/';

  // Issue one document through the API with the browser's session
  const doc = await page.evaluate(async () => {
    const r = await fetch('/app-api/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc_type: 'Certificate', title: 'Bachelor of Science (B.Sc.) Physics', issued_to: 'Ngozi Okafor', matric_number: 'PHY/2021/044', programme: 'Physics', degree_class: 'First Class' }) });
    return (await r.json()).document;
  });
  await page.goto(B + '#/doc/' + doc.doc_id);
  await page.waitForSelector('#claim');
  await page.screenshot({ path: out + 'p4-doc.png', fullPage: true });
  await page.click('#claim');
  await page.waitForSelector('#m-ok');
  await page.click('#m-ok');
  await page.waitForSelector('.claim-code');
  const claim = (await page.textContent('.claim-code')).trim();
  await page.screenshot({ path: out + 'p4-claim-code.png' });
  await page.click('#m-cancel');

  await page.goto(B + '#/security');
  await page.waitForSelector('#rotate');
  await page.screenshot({ path: out + 'p4-security.png', fullPage: true });
  await page.click('#strict'); await page.waitForSelector('#m-ok'); await page.click('#m-ok');
  await page.waitForFunction(() => document.querySelector('#strict') && /off/.test(document.querySelector('#strict').textContent));
  await page.click('#rotate'); await page.waitForSelector('#m-ok'); await page.click('#m-ok');
  await page.waitForFunction(() => document.body.textContent.includes('Key 2'));
  await page.screenshot({ path: out + 'p4-security-after.png', fullPage: true });

  // Graduate portal
  const sp = await browser.newPage({ viewport: { width: 390, height: 844 } });
  sp.on('pageerror', e => errors.push('portal: ' + e.message));
  await sp.goto('http://lasu.localhost:3000/student.html');
  await sp.click('#show-register');
  await sp.fill('#reg-name', 'Ngozi Okafor'); await sp.fill('#reg-matric', 'PHY/2021/044');
  await sp.fill('#reg-institution', lasu.name); await sp.fill('#reg-pin', '4821');
  await sp.screenshot({ path: out + 'p4-portal-register.png', fullPage: true });
  await sp.click('#register-btn');
  await sp.waitForSelector('#reg-err.show');
  const err1 = await sp.textContent('#reg-err');
  await sp.fill('#reg-claim', claim);
  await sp.click('#register-btn');
  await sp.waitForSelector('#portal-section', { state: 'visible' });
  await sp.click('[data-tab="docs"]');
  await sp.waitForFunction(() => document.querySelector('#my-docs-list').textContent.includes('Physics'));
  await sp.screenshot({ path: out + 'p4-portal-docs.png', fullPage: true });
  const href = await sp.getAttribute('#my-docs-list a', 'href');

  // Legacy account in the portal sees the claim card
  const { hashPin } = require('../src/middleware/studentAuth');
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const pool = require('../src/db/pool');
  await pool.query(`INSERT INTO student_tokens (matric_number, institution, pin_hash, pin_salt, tenant_id) VALUES ('OLD/1', $1, $2, 'x', $3)`,
    [lasu.name, hashPin('3333', 'x'), lasu.id]);
  const lp = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await lp.goto('http://lasu.localhost:3000/student.html');
  await lp.fill('#login-matric', 'OLD/1'); await lp.fill('#login-institution', lasu.name); await lp.fill('#login-pin', '3333');
  await lp.click('#login-btn');
  await lp.waitForSelector('#claim-card', { state: 'visible' });
  await lp.screenshot({ path: out + 'p4-portal-claim.png', fullPage: true });
  await pool.end();

  console.log(JSON.stringify({ claim, err1, href, errors }, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
