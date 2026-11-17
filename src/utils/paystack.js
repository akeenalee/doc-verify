const https  = require('https');
const crypto = require('crypto');

const SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY;
const BASE_URL   = process.env.BASE_URL || 'http://localhost:3000';

// Constant-time check of x-paystack-signature (HMAC-SHA512 of the raw body)
function verifyWebhookSignature(payload, signature) {
  if (!SECRET_KEY || typeof signature !== 'string' || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const want = crypto.createHmac('sha512', SECRET_KEY).update(payload).digest();
  return crypto.timingSafeEqual(want, Buffer.from(signature, 'hex'));
}

function paystackRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path,
      method,
      headers: {
        Authorization: `Bearer ${SECRET_KEY}`,
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('Invalid Paystack response')); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function initializeTransaction({ email, amountKobo, metadata, callbackUrl }) {
  const ref  = `UV-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const data = await paystackRequest('POST', '/transaction/initialize', {
    email,
    amount:       amountKobo,
    reference:    ref,
    metadata,
    callback_url: callbackUrl,
  });
  if (!data.status) throw new Error(data.message || 'Paystack init failed');
  return { url: data.data.authorization_url, reference: data.data.reference };
}

async function verifyTransaction(reference) {
  const data = await paystackRequest('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  if (!data.status) throw new Error(data.message || 'Paystack verify failed');
  return data.data;
}

module.exports = {
  verifyWebhookSignature,
  initializeTransaction,
  verifyTransaction,
  PUBLIC_KEY: () => PUBLIC_KEY,
  BASE_URL:   () => BASE_URL,
};