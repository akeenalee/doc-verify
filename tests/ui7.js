// Beyond tertiary: the staff workspace as a professional body sees it.
// Needs a sectors server on :3000 (DEPLOYMENT=sectors) against the database
// e2e13 leaves behind (it holds the "dip" institute). Saves screenshots to the
// temp folder and fails if a school word leaks onto a page.
const { chromium } = require('playwright');
const A = require('../src/utils/staffAuth');
const http = require('http');
function req(method, host, path, body, cookie) { return new Promise(res => { const d = body ? JSON.stringify(body) : '';
  const r = http.request({ host: 'localhost', port: 3000, method, path, headers: { Host: host, 'Content-Type': 'application/json', Accept: 'application/json',
    Origin: 'http://' + host, 'Content-Length': Buffer.byteLength(d), ...(cookie ? { cookie } : {}) } },
    x => { let b = ''; x.on('data', c => b += c); x.on('end', () => { let j = {}; try { j = JSON.parse(b); } catch (e) {} res({ cookie: (x.headers['set-cookie'] || [''])[0].split(';')[0], body: j }); }); });
  r.write(d); r.end(); }); }

// Words that mean the page is still talking to a school
// (a /students/ URL path is the records API itself, so it stays)
const SCHOOL = /(?<!\/)\b(matric|class list|convocation|students?|graduates?|graduation|faculty|registrar's office|SIS)\b/i;

(async () => {
  const a = await req('POST', 'demo.localhost:3000', '/admin-api/login', { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS });
  const t = await req('GET', 'demo.localhost:3000', '/admin-api/tenants', null, a.cookie);
  const dip = t.body.tenants.find(x => x.subdomain === 'dip');
  if (!dip) { console.log('FAIL run e2e13 first: no dip institute'); process.exit(1); }
  const inv = await req('POST', 'demo.localhost:3000', `/admin-api/tenants/${dip.id}/owner-invite`,
    { email: 'ui.owner' + Date.now() + '@dip.example', full_name: 'Tola Registrar' }, a.cookie);

  const browser = await chromium.launch();
  const out = require('./out');
  const errors = [], leaks = [];
  const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(inv.body.link);
  await page.fill('#pw1', 'Tola2026passwd'); await page.fill('#pw2', 'Tola2026passwd');
  await page.click('#btn-1');
  await page.waitForSelector('#step-2', { state: 'visible' });
  const secret = (await page.textContent('#secret')).replace(/\s/g, '');
  await page.fill('#code', A.hotp(secret, Math.floor(Date.now() / 30000)));
  await page.click('#btn-2');
  await page.waitForSelector('#step-3', { state: 'visible' });
  await page.click('#go');
  await page.waitForSelector('.cards');

  const B = 'http://dip.localhost:3000/app/';
  const visit = async (hash, name, wait) => {
    await page.goto(B + hash);
    await page.waitForSelector(wait || 'main h1, main h2', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(600);
    const text = await page.evaluate(() => document.body.innerText);
    const m = text.match(SCHOOL);
    if (m) leaks.push(`${name}: "${m[0]}" in "${text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ')}"`);
    await page.screenshot({ path: out + 'sector-' + name + '.png', fullPage: true });
  };
  await visit('#/dashboard', 'dashboard');
  await visit('#/issue', 'issue', 'form');
  await page.fill('input[name=matric_number]', 'DIP/0001').catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out + 'sector-issue-lookup.png', fullPage: true });
  await visit('#/documents', 'documents');
  await visit('#/students', 'records');
  await visit('#/batches', 'batches');
  await visit('#/print', 'print');
  await visit('#/signatories', 'signatories');
  await visit('#/security', 'security');
  await visit('#/support', 'support');
  await visit('#/activity', 'activity');
  await visit('#/users', 'users');
  await visit('#/alerts', 'alerts');
  await visit('#/payouts', 'payouts');
  await visit('#/branding', 'branding');
  await browser.close();

  for (const l of leaks) console.log('FAIL school word: ' + l);
  for (const e of errors) console.log('FAIL browser error: ' + e);
  if (!leaks.length && !errors.length) console.log('PASS no school words and no errors on 14 pages');
  console.log('Screenshots: ' + out + 'sector-*.png');
  process.exitCode = leaks.length || errors.length ? 1 : 0;
})();
