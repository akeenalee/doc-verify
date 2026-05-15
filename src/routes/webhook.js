const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { verifyWebhookSignature } = require('../utils/paystack');

router.post('/paystack', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  if (!verifyWebhookSignature(req.body, signature)) {
    console.warn('Invalid Paystack webhook signature');
    return res.status(400).send('Invalid signature');
  }

  let event;
  try { event = JSON.parse(req.body.toString()); }
  catch (e) { return res.status(400).send('Invalid JSON'); }

  res.sendStatus(200);

  if (event.event !== 'charge.success') return;

  const txn  = event.data;
  const meta = txn.metadata || {};
  const ref  = txn.reference;

  try {
    if (meta.type === 'token_purchase') {
      const existing = await pool.query(
        `SELECT id FROM token_purchases WHERE paystack_ref=$1 AND paystack_status='success'`,
        [ref]
      );
      if (existing.rows.length) return;

      await pool.query(
        `UPDATE token_purchases SET paystack_status='success', completed_at=NOW() WHERE paystack_ref=$1`,
        [ref]
      );
      await pool.query(
        `UPDATE student_tokens SET token_balance=token_balance+$1, updated_at=NOW()
         WHERE matric_number=$2 AND institution=$3`,
        [meta.tokens, meta.matric_number, meta.institution]
      );
      console.log(`Tokens credited: ${meta.tokens} to ${meta.matric_number}`);

    } else if (meta.type === 'employer_verification') {
      const existing = await pool.query(
        `SELECT id FROM verification_payments WHERE paystack_ref=$1 AND paystack_status='success'`,
        [ref]
      );
      if (existing.rows.length) return;

      await pool.query(
        `UPDATE verification_payments SET paystack_status='success', completed_at=NOW() WHERE paystack_ref=$1`,
        [ref]
      );
      console.log(`Employer payment confirmed: ${ref} for doc ${meta.doc_id}`);
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }
});

module.exports = router;