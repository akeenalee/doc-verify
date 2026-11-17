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
  const inv = await post('demo.localhost:3000', `/admin-api/tenants/${dsu.id}/owner-invite`, { email: 'ui.owner6@dsu.example', full_name: 'Folake Adeyemi' }, a.cookie);
  const browser = await chromium.launch();
  const out = '/tmp/claude-0/-home-user/37513211-470b-500d-b235-312ece92b61a/scratchpad/';
  const errors = [];
  const page = await onboard(browser, inv.body.link, out, errors);
  await page.waitForSelector('.cards');
  const B = 'http://dsu.localhost:3000/app/';
  const ids = await page.evaluate(async () => {
    const r = await fetch('/app-api/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc_type: 'Certificate', file_name: 'class-of-2025.csv',
      csv: 'full_name,matric_number,title\nAmina Bello,CSC/1,BSc Computer Science\nTunde Ade,CSC/2,BSc Computer Science\n' }) });
    const b = (await r.json()).batch;
    await fetch('/app-api/batches/' + b.id + '/submit', { method: 'POST' });
    const v = await fetch('/app-api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'jobs@printco.ng', full_name: 'PrintCo Ltd', roles: ['vendor'] }) });
    return { batch: b.id, vendorLink: (await v.json()).link };
  });
  const pool = require('../src/db/pool');
  const doc = (await pool.query('SELECT doc_id FROM documents WHERE batch_id = $1 LIMIT 1', [ids.batch])).rows[0].doc_id;
  await pool.query(`INSERT INTO scan_alerts (tenant_id, doc_id, kind, detail) VALUES ($1,$2,'many_scans','{"scans_24h":23}'), ($1,$2,'many_places','{"places":["Lagos, NG","Abuja, NG","London, GB"]}')`, [dsu.id, doc]);
  await pool.end();
  await page.goto(B + '#/dashboard'); await page.waitForSelector('.cards');
  await page.screenshot({ path: out + 'p4b-dashboard.png' });
  // Vendor signs up first so staff can pick them
  const vpage = await onboard(await chromium.launch(), ids.vendorLink, out, errors);
  await vpage.waitForSelector('[data-spec], .empty, table');
  await page.goto(B + '#/print'); await page.waitForSelector('[data-send]');
  await page.screenshot({ path: out + 'p4b-print-ready.png', fullPage: true });
  await page.click('[data-send]'); await page.waitForSelector('#m-ok');
  await page.fill('#m-form [name="note"]', 'Security stock from our store. Deliver to the Registry by 5 December.');
  await page.screenshot({ path: out + 'p4b-send-job.png' });
  await page.click('#m-ok'); await page.waitForSelector('[data-move="cancel"]');
  await page.click('[data-spec="Certificate"]'); await page.waitForSelector('#m-ok');
  await page.screenshot({ path: out + 'p4b-print-spec.png' });
  await page.click('#m-cancel');
  await page.goto(B + '#/doc/' + doc); await page.waitForSelector('#send-print');
  await page.click('#send-print'); await page.waitForSelector('#m-ok');
  await page.screenshot({ path: out + 'p4b-send-doc.png' });
  await page.click('#m-ok'); await page.waitForSelector('[data-move="cancel"]');
  await page.goto(B + '#/alerts'); await page.waitForSelector('[data-ack]');
  await page.screenshot({ path: out + 'p4b-alerts.png', fullPage: true });
  await page.goto(B + '#/security'); await page.waitForSelector('#dis-f');
  await (await page.$('#dis-f')).screenshot({ path: out + 'p4b-disclosure.png' });

  // Vendor sees only its jobs, downloads one pack and marks it printed
  await vpage.goto(B + '#/print'); await vpage.reload(); await vpage.waitForSelector('a[href*="pack.zip"]');
  await vpage.screenshot({ path: out + 'p4b-vendor.png', fullPage: true });
  const nav = await vpage.textContent('#nav');
  const jobs = await vpage.evaluate(async () => (await (await fetch('/app-api/print/jobs', { headers: { Accept: 'application/json' } })).json()).jobs);
  const batchJob = jobs.find(x => x.documents === 2) || jobs[0];
  await vpage.evaluate(async id => { await fetch('/app-api/print/jobs/' + id + '/pack.zip'); }, batchJob.id);
  await vpage.reload(); await vpage.waitForSelector('[data-move="printed"]');
  await vpage.screenshot({ path: out + 'p4b-vendor-downloaded.png', fullPage: true });
  await vpage.click('[data-move="printed"]'); await vpage.waitForSelector('#m-ok'); await vpage.click('#m-ok');
  await vpage.waitForTimeout(800);
  await vpage.goto(B + '#/documents'); await vpage.waitForTimeout(800);
  const redirected = vpage.url();
  await page.goto(B + '#/print'); await page.reload(); await page.waitForSelector('[data-move="delivered"]');
  await page.screenshot({ path: out + 'p4b-print.png', fullPage: true });
  console.log(JSON.stringify({ nav, redirected, errors }, null, 1));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
