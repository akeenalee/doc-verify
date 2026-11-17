const { chromium } = require('playwright');
const A = require('../src/utils/staffAuth');
const http = require('http');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
function post(host, path, body, cookie) { return new Promise(res => { const d = JSON.stringify(body);
  const r = http.request({ host: 'localhost', port: 3000, method: 'POST', path, headers: { Host: host, 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(d), ...(cookie ? { cookie } : {}) } },
    x => { let b = ''; x.on('data', c => b += c); x.on('end', () => res({ cookie: (x.headers['set-cookie'] || [''])[0].split(';')[0], body: JSON.parse(b || '{}') })); });
  r.write(d); r.end(); }); }
function get(host, path, cookie) { return new Promise(res => http.get({ host: 'localhost', port: 3000, path, headers: { Host: host, Accept: 'application/json', cookie } },
  x => { let b = ''; x.on('data', c => b += c); x.on('end', () => res(JSON.parse(b))); })); }
async function onboard(browser, link, out, errors) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(link);
  await page.fill('#pw1', 'Folake2026pass'); await page.fill('#pw2', 'Folake2026pass');
  await page.click('#btn-1');
  await page.waitForSelector('#step-2', { state: 'visible' });
  const secret = (await page.textContent('#secret')).replace(/\s/g, '');
  await page.fill('#code', A.hotp(secret, Math.floor(Date.now() / 30000)));
  await page.click('#btn-2');
  await page.waitForSelector('#step-3', { state: 'visible' });
  await page.click('#go');
  return page;
}
(async () => {
  const a = await post('demo.localhost:3000', '/admin-api/login', { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS });
  const t = await get('demo.localhost:3000', '/admin-api/tenants', a.cookie);
  const dsu = t.tenants.find(x => x.subdomain === 'dsu');
  const inv = await post('demo.localhost:3000', `/admin-api/tenants/${dsu.id}/owner-invite`, { email: 'ui.owner7@dsu.example', full_name: 'Folake Adeyemi' }, a.cookie);
  const browser = await chromium.launch();
  const out = require('./out');
  const errors = [];
  const page = await onboard(browser, inv.body.link, out, errors);
  await page.waitForSelector('.cards');
  const B = 'http://dsu.localhost:3000/app/';
  const shot = async n => page.screenshot({ path: out + 'p4c-' + n + '.png', fullPage: true });
  // Student records page: connect the test SIS
  await page.goto(B + '#/students'); await page.waitForSelector('#sis-f');
  await shot('students-empty');
  await page.fill('#sis-url', 'http://localhost:3000/mock-sis');
  await page.fill('#sis-secret', 'test-sis-token');
  await page.click('#sis-f button[type=submit]');
  await page.waitForSelector('#sis-test');
  await page.click('#sis-test');
  await page.fill('#mf-matric', 'MEE/2023/0045');
  await page.click('#m-ok');
  await page.waitForSelector('#m-msg.show');
  console.log('test result:', await page.textContent('#m-msg'));
  await page.screenshot({ path: out + 'p4c-sis-test.png' });
  await page.click('#m-cancel');
  // Upload a list
  await page.click('#st-up');
  await page.setInputFiles('#mf-csv', { name: 'transcript-requests-nov.csv', mimeType: 'text/csv',
    buffer: Buffer.from('matric_number,full_name,programme,status\nLST/2022/001,Ifeanyi Okeke,B.Sc. Geology,enrolled\nLST/2019/002,Halima Sani,B.Sc. Zoology,graduated\n') });
  await page.click('#m-ok');
  await page.waitForSelector('[data-del-list]');
  await shot('students-connected');
  // Issue: look up a graduate
  await page.goto(B + '#/issue'); await page.waitForSelector('#i-look');
  await page.fill('#i-matric_number', 'csc/2019/0012');
  await page.click('#i-look');
  await page.waitForSelector('#i-rec.ok');
  console.log('lookup:', await page.textContent('#i-rec'), '| name:', await page.inputValue('#i-issued_to'), '| title:', await page.inputValue('#i-title'));
  await shot('issue-found');
  console.log('locked:', await page.evaluate(() => ['issued_to','programme','degree_class','faculty','department','entry_year','graduation_year','title'].map(f => f + '=' + document.getElementById('i-' + f).readOnly).join(' ')));
  // Enrolled student, certificate: blocked; switch to transcript
  await page.fill('#i-title', '');
  await page.fill('#i-matric_number', 'MEE/2023/0045');
  await page.press('#i-matric_number', 'Enter');
  await page.waitForSelector('#i-rec.err');
  console.log('enrolled cert:', await page.textContent('#i-rec'));
  await shot('issue-enrolled-cert');
  await page.selectOption('#i-doc_type', 'Transcript');
  await page.waitForSelector('#i-rec.ok');
  await page.fill('#i-title', 'Academic Transcript');
  await shot('issue-enrolled-transcript');
  await page.click('#i-save');
  await page.waitForURL(/#\/doc\//);
  console.log('issued transcript:', page.url());
  await page.waitForTimeout(800);
  // Not found
  await page.goto(B + '#/issue'); await page.reload(); await page.waitForSelector('#i-matric_number');
  await page.fill('#i-matric_number', 'ABC/0000/0000'); await page.click('#i-look');
  await page.waitForSelector('#i-rec.warn');
  console.log('not found:', await page.textContent('#i-rec'));
  await shot('issue-not-found');
  // Mobile view of the page
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(B + '#/students'); await page.waitForSelector('#sis-f');
  await page.screenshot({ path: out + 'p4c-students-mobile.png', fullPage: true });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  console.log('mobile scrollWidth', sw);
  console.log('errors:', errors);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
