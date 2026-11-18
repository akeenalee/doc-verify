const http   = require('http');
const https  = require('https');
const crypto = require('crypto');

const SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY;
const BASE_URL   = process.env.BASE_URL || 'http://localhost:3000';

// The tests point this at a fake Paystack on localhost. Production always
// talks to the real API over https.
function apiBase() {
  const raw = process.env.PAYSTACK_API_BASE;
  if (!raw || process.env.NODE_ENV === 'production') return new URL('https://api.paystack.co');
  return new URL(raw);
}

// Constant-time check of x-paystack-signature (HMAC-SHA512 of the raw body)
function verifyWebhookSignature(payload, signature) {
  if (!SECRET_KEY || typeof signature !== 'string' || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const want = crypto.createHmac('sha512', SECRET_KEY).update(payload).digest();
  return crypto.timingSafeEqual(want, Buffer.from(signature, 'hex'));
}

function paystackRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const base = apiBase();
    const body = data ? JSON.stringify(data) : null;
    const lib = base.protocol === 'http:' ? http : https;
    const req = lib.request({
      hostname: base.hostname,
      port: base.port || (base.protocol === 'http:' ? 80 : 443),
      path,
      method,
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${SECRET_KEY}`,
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('Invalid Paystack response')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Paystack did not answer in time')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const must = (data, what) => { if (!data || !data.status) throw new Error((data && data.message) || `Paystack ${what} failed`); return data.data; };

// split: { subaccount, transaction_charge, bearer } from payouts.splitFor, or null
async function initializeTransaction({ email, amountKobo, metadata, callbackUrl, split }) {
  const ref  = `UV-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const d = must(await paystackRequest('POST', '/transaction/initialize', {
    email,
    amount:       amountKobo,
    currency:     'NGN',
    reference:    ref,
    metadata,
    callback_url: callbackUrl,
    ...(split ? { subaccount: split.subaccount, transaction_charge: split.transaction_charge, bearer: split.bearer } : {}),
  }), 'init');
  return { url: d.authorization_url, reference: d.reference };
}

async function verifyTransaction(reference) {
  return must(await paystackRequest('GET', `/transaction/verify/${encodeURIComponent(reference)}`), 'verify');
}

// ── Subaccounts (school payouts) ──────────────────────────────────────────
async function listBanks() {
  // Paystack lists 200+ Nigerian banks; one page of 100 cut off banks late in
  // the alphabet (Wema, Zenith...), so follow the cursor to the end.
  const d = [];
  let next = '';
  for (let page = 0; page < 10; page++) {
    const raw = await paystackRequest('GET', '/bank?country=nigeria&currency=NGN&perPage=100&use_cursor=true' + (next ? '&next=' + encodeURIComponent(next) : ''));
    d.push(...must(raw, 'bank list'));
    next = raw.meta && raw.meta.next;
    if (!next) break;
  }
  return d.filter(b => b.active !== false && !b.is_deleted).map(b => ({ code: b.code, name: b.name }));
}

// Returns { account_name, account_number } or throws with Paystack's message
async function resolveAccount(accountNumber, bankCode) {
  return must(await paystackRequest('GET',
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`), 'account check');
}

// percentage_charge is Paystack's default share for the main account; we
// also send an exact transaction_charge on every payment, which wins over it.
async function createSubaccount({ business_name, bank_code, account_number, percentage_charge, email }) {
  return must(await paystackRequest('POST', '/subaccount', {
    business_name, settlement_bank: bank_code, account_number, percentage_charge,
    ...(email ? { primary_contact_email: email } : {}),
  }), 'subaccount');
}

async function updateSubaccount(code, { business_name, bank_code, account_number, percentage_charge, active }) {
  return must(await paystackRequest('PUT', `/subaccount/${encodeURIComponent(code)}`, {
    business_name, settlement_bank: bank_code, account_number, percentage_charge,
    ...(active === undefined ? {} : { active }),
  }), 'subaccount update');
}

module.exports = {
  verifyWebhookSignature,
  initializeTransaction,
  verifyTransaction,
  listBanks,
  resolveAccount,
  createSubaccount,
  updateSubaccount,
  PUBLIC_KEY: () => PUBLIC_KEY,
  BASE_URL:   () => BASE_URL,
};
