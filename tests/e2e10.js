// Payouts: each school's Paystack subaccount, and every payment for that school
// split at Paystack (school share to its bank, platform fee to Innovation Lens).
// Paystack is a fake on localhost:3999 (the runner points PAYSTACK_API_BASE there).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DOC_SECRET = process.env.DOC_SECRET || 'testsecret';
const crypto = require('crypto');
const http = require('http');
const A = require('../src/utils/staffAuth');
const pool = require('../src/db/pool');

const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const code = s => A.hotp(s, Math.floor(Date.now() / 30000));

// ── Fake Paystack ──
const calls = [];
const subs = new Map();
const BANKS = [{ code: '058', name: 'Guaranty Trust Bank', active: true }, { code: '044', name: 'Access Bank', active: true },
  { code: '999', name: 'Closed Bank', active: false }];
const fake = http.createServer((req, res) => {
  let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, auth: req.headers.authorization });
    const send = (status, data, message) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status, message, data })); };
    if (req.method === 'GET' && u.pathname === '/bank') return send(true, BANKS);
    if (req.method === 'GET' && u.pathname === '/bank/resolve') {
      const n = u.searchParams.get('account_number');
      return n === '0000000000' ? send(false, null, 'Could not resolve account name. Check parameters or try again.')
        : send(true, { account_number: n, account_name: 'LAGOS STATE UNIVERSITY IGR' });
    }
    if (req.method === 'POST' && u.pathname === '/subaccount') {
      const c = 'ACCT_' + crypto.randomBytes(5).toString('hex'); subs.set(c, body);
      return send(true, { subaccount_code: c, ...body });
    }
    let m;
    if (req.method === 'PUT' && (m = /^\/subaccount\/(.+)$/.exec(u.pathname))) {
      if (!subs.has(m[1])) return send(false, null, 'Subaccount not found');
      subs.set(m[1], { ...subs.get(m[1]), ...body }); return send(true, { subaccount_code: m[1] });
    }
    if (req.method === 'POST' && u.pathname === '/transaction/initialize')
      return send(true, { authorization_url: 'https://checkout.paystack.com/fake', reference: body.reference });
    return send(false, null, 'Not found');
  });
});

function client(host) {
  let cookie = '';
  return (method, path, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: 'localhost', port: 3000, method, path,
      headers: { Host: host, Accept: 'application/json', 'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
        const sc = res.headers['set-cookie']; if (sc) cookie = sc[0].split(';')[0];
        let b = Buffer.concat(chunks).toString(); try { b = JSON.parse(b); } catch (e) {}
        resolve({ status: res.statusCode, body: b });
      });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
function webhook(event) {
  const body = Buffer.from(JSON.stringify(event));
  const sig = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(body).digest('hex');
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: 3000, method: 'POST', path: '/api/webhook/paystack',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, 'x-paystack-signature': sig } },
      res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end(body);
  });
}
async function setup(c, link, pw, name) {
  const token = new URL(link).searchParams.get('token');
  let r = await c('POST', '/app-api/auth/invite/start', { token, password: pw, full_name: name });
  r = await c('POST', '/app-api/auth/invite/confirm', { token, code: code(r.body.secret) });
  return r.status === 200;
}
const lastInit = () => [...calls].reverse().find(c => c.path === '/transaction/initialize');

(async () => {
  await new Promise(r => fake.listen(3999, r));
  const admin = client('demo.localhost:3000');
  await admin('POST', '/admin-api/login', { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS });
  const tenants = (await admin('GET', '/admin-api/tenants')).body.tenants;
  const lasu = tenants.find(t => t.subdomain === 'lasu'), demo = tenants.find(t => t.subdomain === 'demo');
  ok(lasu && !lasu.payout_active, 'lasu starts with no payout');

  // ── Admin sets up the payout ──
  let r = await admin('GET', '/admin-api/tenants/banks');
  ok(r.status === 200 && r.body.banks.length === 2 && r.body.banks[0].code === '058', 'bank list from Paystack, closed banks left out');
  ok(calls.every(c => c.auth === 'Bearer ' + process.env.PAYSTACK_SECRET_KEY), 'Paystack called with the secret key');
  r = await admin('PUT', `/admin-api/tenants/${lasu.id}/payout`, { bank_code: '058', account_number: '012345678' });
  ok(r.status === 400 && /10 digits/.test(r.body.error), 'account number must be 10 digits');
  r = await admin('PUT', `/admin-api/tenants/${lasu.id}/payout`, { bank_code: '123', account_number: '0123456789' });
  ok(r.status === 400 && /bank/.test(r.body.error), 'unknown bank refused');
  r = await admin('PUT', `/admin-api/tenants/${lasu.id}/payout`, { bank_code: '058', account_number: '0000000000' });
  ok(r.status === 400 && /could not confirm/.test(r.body.error), 'account Paystack cannot resolve is refused');
  r = await admin('PUT', `/admin-api/tenants/${lasu.id}/payout`, { bank_code: '058', account_number: '0123456789', platform_fee_bps: 9000 });
  ok(r.status === 400 && /50%/.test(r.body.error), 'platform fee over 50% refused');
  ok(subs.size === 0, 'nothing created at Paystack while input is wrong');
  r = await admin('PUT', `/admin-api/tenants/${demo.id}/payout`, { bank_code: '058', account_number: '0123456789' });
  ok(r.status === 404, 'the demo tenant cannot get a payout');

  r = await admin('PUT', `/admin-api/tenants/${lasu.id}/payout`, { bank_code: '058', account_number: '0123456789' });
  ok(r.status === 200 && r.body.payout.active && r.body.payout.account_last4 === '6789' && r.body.payout.account_name === 'LAGOS STATE UNIVERSITY IGR',
    'payout set up after Paystack confirms the account name');
  ok(r.body.payout.platform_fee_percent === 10 && r.body.payout.fee_bearer === 'account', 'default fee 10%, Innovation Lens pays the Paystack charge');
  const created = calls.find(c => c.method === 'POST' && c.path === '/subaccount');
  ok(created && created.body.settlement_bank === '058' && created.body.account_number === '0123456789' && created.body.percentage_charge === 10 && created.body.business_name === lasu.name,
    'subaccount created with bank, account, fee and school name');
  const subCode = r.body.payout.subaccount_code;
  const row = (await pool.query('SELECT * FROM tenant_payouts WHERE tenant_id = $1', [lasu.id])).rows[0];
  ok(!JSON.stringify(row).includes('0123456789'), 'full account number never stored');
  const log = (await pool.query("SELECT detail FROM activity_log WHERE tenant_id = $1 AND action = 'payout_set_up'", [lasu.id])).rows[0];
  ok(log && log.detail.account === '****6789', "school's activity log records the change, masked");
  ok((await admin('GET', '/admin-api/tenants')).body.tenants.find(t => t.id === lasu.id).payout_active === true, 'institutions list shows the payout');

  // ── Holder buys credits: split sent ──
  const owner = client('lasu.localhost:3000');
  r = await admin('POST', `/admin-api/tenants/${lasu.id}/owner-invite`, { email: 'registrar@lasu.edu.ng', full_name: 'Dr Registrar' });
  ok(await setup(owner, r.body.link, 'Registrar2026', 'Dr Registrar'), 'owner set up');
  r = await owner('POST', '/app-api/documents', { doc_type: 'Certificate', title: 'B.Sc. Physics', issued_to: 'Ngozi Okafor', matric_number: 'PAYO/2021/001' });
  const doc = r.body.document;
  const claim = (await owner('POST', `/app-api/documents/${encodeURIComponent(doc.doc_id)}/claim-code`)).body.code;
  const holder = client('lasu.localhost:3000');
  r = await holder('POST', '/api/tokens/register', { matric_number: 'PAYO/2021/001', institution: lasu.name, full_name: 'Ngozi Okafor', pin: '482913', claim_code: claim });
  r = await holder('POST', '/api/tokens/login', { matric_number: 'PAYO/2021/001', institution: lasu.name, pin: '482913' });
  ok(r.status === 200, 'holder signed in');
  r = await holder('POST', '/api/tokens/buy', { bundle_id: 2 });
  ok(r.status === 200 && /checkout/.test(r.body.payment_url), 'holder bundle purchase starts');
  let init = lastInit();
  ok(init.body.subaccount === subCode && init.body.transaction_charge === 25000 && init.body.bearer === 'account' && init.body.amount === 250000,
    'holder payment split: N2,500 bundle, N250 platform fee, rest to lasu');
  const tp = (await pool.query('SELECT * FROM token_purchases WHERE paystack_ref = $1', [r.body.reference])).rows[0];
  ok(tp.subaccount_code === subCode && tp.platform_fee_kobo === 25000 && tp.tenant_id === lasu.id, 'purchase row records split, fee and school');

  // Settling still credits once from our own row
  ok(await webhook({ event: 'charge.success', data: { reference: tp.paystack_ref, status: 'success', amount: 250000, currency: 'NGN',
    subaccount: { subaccount_code: subCode }, metadata: { type: 'token_purchase', tenant_id: lasu.id } } }) === 200, 'webhook for a split payment accepted');
  // The webhook answers 200 straight away and settles after
  let bal = 0;
  for (let i = 0; i < 20 && bal !== 3; i++) {
    await new Promise(r => setTimeout(r, 100));
    bal = (await pool.query("SELECT token_balance FROM student_tokens WHERE matric_number = 'PAYO/2021/001'")).rows[0].token_balance;
  }
  ok(bal === 3, 'split payment credits the bundle once');

  // ── Verifier fee: split goes to the issuing school ──
  const verifier = client('demo.localhost:3000');
  r = await verifier('POST', '/verify/api/initiate-payment', { doc_id: doc.doc_id, email: 'hr@company.ng' });
  ok(r.status === 200, 'verifier payment starts (from any subdomain)');
  init = lastInit();
  const fee = Number(process.env.VERIFY_FEE_KOBO || 100000);
  ok(init.body.subaccount === subCode && init.body.transaction_charge === Math.round(fee / 10), 'verifier fee split to the issuing school, 10% kept');
  const vp = (await pool.query('SELECT * FROM verification_payments WHERE paystack_ref = $1', [r.body.reference])).rows[0];
  ok(vp.subaccount_code === subCode && vp.platform_fee_kobo === Math.round(fee / 10), 'verifier payment row records the split');

  // Demo tenant document: no split
  const demoDoc = (await pool.query("SELECT doc_id FROM documents WHERE tenant_id = $1 AND status = 'active' LIMIT 1", [demo.id])).rows[0];
  if (demoDoc) {
    r = await verifier('POST', '/verify/api/initiate-payment', { doc_id: demoDoc.doc_id, email: 'hr@company.ng' });
    init = lastInit();
    ok(r.status === 200 && !init.body.subaccount && !('transaction_charge' in init.body), 'school with no payout: no split sent');
  }

  // ── Change fee and bearer: same subaccount updated, not a new one ──
  const before = subs.size;
  r = await admin('PUT', `/admin-api/tenants/${lasu.id}/payout`, { bank_code: '044', account_number: '9876543210', platform_fee_bps: 1500, fee_bearer: 'subaccount' });
  ok(r.status === 200 && r.body.payout.subaccount_code === subCode && subs.size === before, 'changing the account updates the same subaccount');
  ok(subs.get(subCode).settlement_bank === '044' && subs.get(subCode).percentage_charge === 15, 'Paystack subaccount updated with the new bank and fee');
  r = await holder('POST', '/api/tokens/buy', { bundle_id: 1 });
  init = lastInit();
  ok(init.body.transaction_charge === 15000 && init.body.bearer === 'subaccount', 'new fee and bearer used on the next payment');

  // ── Owner sees it read-only ──
  r = await owner('GET', '/app-api/settings/payout');
  ok(r.status === 200 && r.body.payout.bank_name === 'Access Bank' && r.body.payout.account_last4 === '3210' && r.body.payout.platform_fee_percent === 15,
    'owner sees the payout account, masked');
  ok(r.body.last_30_days.payments === 1 && r.body.last_30_days.gross_kobo === 250000 && r.body.last_30_days.school_share_kobo === 225000 && r.body.last_30_days.platform_fee_kobo === 25000,
    'owner sees last 30 days: paid, school share, platform fee');
  ok(!JSON.stringify(r.body).includes('9876543210'), 'owner view never has the full account number');
  r = await owner('PUT', '/app-api/settings/payout', { bank_code: '058', account_number: '1111111111' });
  ok(r.status === 404 || r.status === 405, 'owner cannot change the payout account');
  r = await client('lasu.localhost:3000')('GET', '/app-api/settings/payout');
  ok(r.status === 401 || r.status === 403, 'signed-out user cannot see payouts');

  // ── Pause ──
  r = await admin('DELETE', `/admin-api/tenants/${lasu.id}/payout`);
  ok(r.status === 200 && r.body.payout.active === false, 'payouts paused');
  ok(subs.get(subCode).active === false, 'subaccount switched off at Paystack');
  r = await holder('POST', '/api/tokens/buy', { bundle_id: 1 });
  init = lastInit();
  ok(r.status === 200 && !init.body.subaccount, 'paused school: payments collected by Innovation Lens');
  r = await client('demo.localhost:3000')('GET', `/admin-api/tenants/${lasu.id}/payout`);
  ok(r.status === 401 || r.status === 403 || r.status === 302, 'payout API needs the IL admin');

  fake.close(); await pool.end();
})().catch(e => { console.log('FAIL crashed: ' + e.stack); process.exitCode = 1; fake.close(); pool.end(); });
