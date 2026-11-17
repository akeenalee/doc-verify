// Payments: Paystack webhook signature, settling each payment exactly once,
// and crediting from our own purchase record rather than transaction metadata.
// Paystack itself is never called: the webhook is signed here with the
// test-only secret the runner gives the server.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const crypto = require('crypto');
const http = require('http');
const pool = require('../src/db/pool');
const { settleTokenPurchase, settleVerificationPayment } = require('../src/utils/payments');

const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const SECRET = process.env.PAYSTACK_SECRET_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function webhook(event, signature) {
  const body = Buffer.from(JSON.stringify(event));
  const sig = signature === undefined ? crypto.createHmac('sha512', SECRET).update(body).digest('hex') : signature;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port: 3000, method: 'POST', path: '/api/webhook/paystack',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, ...(sig ? { 'x-paystack-signature': sig } : {}) } },
      res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end(body);
  });
}

(async () => {
  const dsu = (await pool.query("SELECT id, name FROM tenants WHERE subdomain = 'dsu'")).rows[0];
  const MATRIC = 'PAY/2020/0001';
  await pool.query('DELETE FROM student_tokens WHERE matric_number = $1', [MATRIC]);
  await pool.query("DELETE FROM token_purchases WHERE paystack_ref LIKE 'UV-TEST-%'");
  await pool.query("DELETE FROM verification_payments WHERE paystack_ref LIKE 'UV-TEST-%'");
  await pool.query(`INSERT INTO student_tokens (matric_number, institution, full_name, tenant_id, token_balance)
                    VALUES ($1, $2, 'Test Holder', $3, 0)`, [MATRIC, dsu.name, dsu.id]);
  const balance = async () => (await pool.query('SELECT token_balance FROM student_tokens WHERE matric_number = $1', [MATRIC])).rows[0].token_balance;
  const purchase = (ref, tokens = 3, kobo = 250000) => pool.query(
    `INSERT INTO token_purchases (matric_number, institution, bundle_size, amount_kobo, paystack_ref)
     VALUES ($1, $2, $3, $4, $5)`, [MATRIC, dsu.name, tokens, kobo, ref]);
  // What Paystack would send; metadata deliberately claims far more tokens than were bought
  const charge = (ref, amount = 250000, currency = 'NGN') => ({ event: 'charge.success', data: {
    reference: ref, status: 'success', amount, currency,
    metadata: { type: 'token_purchase', matric_number: MATRIC, institution: dsu.name, tokens: 1000, tenant_id: dsu.id } } });

  // ── Webhook signature ──
  await purchase('UV-TEST-1');
  ok(await webhook(charge('UV-TEST-1'), '') === 400, 'webhook without a signature: 400');
  ok(await webhook(charge('UV-TEST-1'), 'a'.repeat(128)) === 400, 'webhook with a wrong signature: 400');
  ok(await webhook(charge('UV-TEST-1'), 'not-hex') === 400, 'webhook with a malformed signature: 400');
  ok(await balance() === 0, 'nothing credited by unsigned calls');

  // ── Credit once, from our record ──
  ok(await webhook(charge('UV-TEST-1')) === 200, 'signed webhook accepted');
  await sleep(300);
  ok(await balance() === 3, 'credited the 3 tokens bought, not the 1000 in metadata');
  ok(await webhook(charge('UV-TEST-1')) === 200, 'same webhook again accepted');
  await sleep(300);
  ok(await balance() === 3, 'replayed webhook credits nothing');
  let r = await settleTokenPurchase(charge('UV-TEST-1').data);
  ok(r.ok && r.already && !r.credited, 'return URL after the webhook: already settled, nothing added');
  ok(await balance() === 3, 'still 3 tokens');

  // ── The race: webhook and return URL at the same moment ──
  await purchase('UV-TEST-2');
  const tx = charge('UV-TEST-2').data;
  const results = await Promise.all([
    webhook(charge('UV-TEST-2')),
    ...Array.from({ length: 8 }, () => settleTokenPurchase(tx)),
  ]);
  await sleep(300);
  ok(await balance() === 6, 'nine simultaneous reports credit the bundle exactly once');
  ok(results.slice(1).filter(x => x.credited).length <= 1, 'at most one settle reports a credit');
  ok((await pool.query("SELECT paystack_status FROM token_purchases WHERE paystack_ref = 'UV-TEST-2'")).rows[0].paystack_status === 'success', 'purchase marked successful');

  // ── Refusals ──
  await purchase('UV-TEST-3');
  r = await settleTokenPurchase(charge('UV-TEST-3', 100).data);
  ok(!r.ok && r.reason === 'not_paid', 'short payment refused');
  r = await settleTokenPurchase(charge('UV-TEST-3', 250000, 'USD').data);
  ok(!r.ok && r.reason === 'not_paid', 'payment in another currency refused');
  r = await settleTokenPurchase({ ...charge('UV-TEST-3').data, status: 'failed' });
  ok(!r.ok, 'failed transaction refused');
  ok((await pool.query("SELECT paystack_status FROM token_purchases WHERE paystack_ref = 'UV-TEST-3'")).rows[0].paystack_status === 'pending', 'refused purchase stays pending');
  r = await settleTokenPurchase(charge('UV-TEST-NOPE').data);
  ok(!r.ok && r.reason === 'unknown_reference', 'reference we never created: nothing credited');
  ok(await webhook(charge('UV-TEST-NOPE')) === 200, 'webhook for an unknown reference acknowledged');
  await sleep(300);
  ok(await balance() === 6, 'balance unchanged by refused payments');

  await pool.query("INSERT INTO token_purchases (matric_number, institution, bundle_size, amount_kobo, paystack_ref) VALUES ('NOBODY/1', $1, 3, 250000, 'UV-TEST-4')", [dsu.name]);
  r = await settleTokenPurchase({ ...charge('UV-TEST-4').data });
  ok(!r.ok && r.reason === 'holder_not_found', 'purchase for a missing holder: not credited');
  ok((await pool.query("SELECT paystack_status FROM token_purchases WHERE paystack_ref = 'UV-TEST-4'")).rows[0].paystack_status === 'pending', 'and not marked paid, so it can be put right');

  // ── Verifier payments ──
  await pool.query("INSERT INTO verification_payments (doc_id, amount_kobo, paystack_ref) VALUES ('DOC-PAID', 100000, 'UV-TEST-V1')");
  const vtx = (ref, amount = 100000) => ({ reference: ref, status: 'success', amount, currency: 'NGN',
    metadata: { type: 'employer_verification', doc_id: 'SOME-OTHER-DOC' } });
  r = await settleVerificationPayment(vtx('UV-TEST-V1'));
  ok(r.ok && r.doc_id === 'DOC-PAID', 'verifier payment names the document from our record, not metadata');
  ok((await pool.query("SELECT paystack_status FROM verification_payments WHERE paystack_ref = 'UV-TEST-V1'")).rows[0].paystack_status === 'success', 'verifier payment marked successful');
  r = await settleVerificationPayment(vtx('UV-TEST-V1'));
  ok(r.ok && r.doc_id === 'DOC-PAID', 'settling again is harmless');
  await pool.query("INSERT INTO verification_payments (doc_id, amount_kobo, paystack_ref) VALUES ('DOC-PAID', 100000, 'UV-TEST-V2')");
  r = await settleVerificationPayment(vtx('UV-TEST-V2', 5000));
  ok(!r.ok, 'short verifier payment refused');
  r = await settleVerificationPayment(vtx('UV-TEST-V-NOPE'));
  ok(!r.ok && r.reason === 'unknown_reference', 'verifier reference we never created refused');

  await pool.end();
})().catch(e => { console.error(e); process.exitCode = 1; });
