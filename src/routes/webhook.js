const express = require('express');
const router  = express.Router();
const { settleTokenPurchase, settleVerificationPayment } = require('../utils/payments');
const { verifyWebhookSignature } = require('../utils/paystack');
const { count } = require('../telemetry');

router.post('/paystack', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  if (!verifyWebhookSignature(req.body, signature)) {
    console.warn('Invalid Paystack webhook signature');
    count('webhooks', { outcome: 'bad_signature' });
    return res.status(400).send('Invalid signature');
  }

  let event;
  try { event = JSON.parse(req.body.toString()); }
  catch (e) { return res.status(400).send('Invalid JSON'); }

  res.sendStatus(200);

  count('webhooks', { outcome: 'ok', event: event.event });
  if (event.event !== 'charge.success') return;

  const txn  = event.data || {};
  const meta = txn.metadata || {};

  try {
    if (meta.type === 'token_purchase') {
      const r = await settleTokenPurchase(txn);
      count('payments', { kind: 'token_purchase', outcome: r.ok === false ? 'rejected' : 'settled' });
      if (r.credited) console.log(`Tokens credited: ${r.credited} for ${txn.reference}`);
      else if (!r.ok) console.warn(`Token purchase ${txn.reference} not credited: ${r.reason}`);
    } else if (meta.type === 'employer_verification') {
      const r = await settleVerificationPayment(txn);
      count('payments', { kind: 'employer_verification', outcome: r.ok ? 'settled' : 'rejected' });
      if (!r.ok) console.warn(`Verifier payment ${txn.reference} not accepted: ${r.reason}`);
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
    count('payments', { kind: meta.type || 'unknown', outcome: 'error' });
  }
});

module.exports = router;