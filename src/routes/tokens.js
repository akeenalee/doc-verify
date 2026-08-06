const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { hashPin, generateSalt, requireStudentAuth } = require('../middleware/studentAuth');
const { initializeTransaction, BASE_URL } = require('../utils/paystack');

const BUNDLES = [
  { id: 1, label: '1 verification',   tokens: 1,  amountKobo: 100000 },
  { id: 2, label: '3 verifications',  tokens: 3,  amountKobo: 250000 },
  { id: 3, label: '5 verifications',  tokens: 5,  amountKobo: 400000 },
  { id: 4, label: '10 verifications', tokens: 10, amountKobo: 700000 },
];

router.get('/bundles', (req, res) => {
  res.json({ bundles: BUNDLES });
});

router.post('/register', async (req, res) => {
  const { matric_number, institution, full_name, email, phone, pin } = req.body;
  if (!matric_number || !institution || !pin)
    return res.status(400).json({ error: 'matric_number, institution, and pin are required.' });
  if (pin.length < 4 || pin.length > 8)
    return res.status(400).json({ error: 'PIN must be 4-8 digits.' });

  try {
    const existing = await pool.query(
      'SELECT id FROM student_tokens WHERE matric_number = $1 AND institution = $2',
      [matric_number.toUpperCase(), institution]
    );
    if (existing.rows.length)
      return res.status(409).json({ error: 'Student already registered. Please log in.' });

    const result = await pool.query(
      `INSERT INTO student_tokens
        (matric_number, institution, full_name, email, phone, pin_hash)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, matric_number, institution, full_name, email, token_balance`,
      [matric_number.toUpperCase(), institution, full_name||null, email||null, phone||null, hashPin(pin, salt), salt]
    );
    req.session.studentId = result.rows[0].id;
    req.session.matric    = result.rows[0].matric_number;
    res.status(201).json({ student: result.rows[0] });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  const { matric_number, institution, pin } = req.body;
  if (!matric_number || !institution || !pin)
    return res.status(400).json({ error: 'matric_number, institution, and pin are required.' });

  try {
    const result = await pool.query(
      `SELECT id, matric_number, institution, full_name, email, token_balance
       FROM student_tokens
       WHERE matric_number=$1 AND institution=$2 AND pin_hash=$3`,
      [matric_number.toUpperCase(), institution, hashPin(pin)]
    );
    if (!result.rows.length)
      return res.status(401).json({ error: 'Invalid matric number, institution, or PIN.' });

    req.session.studentId = result.rows[0].id;
    req.session.matric    = result.rows[0].matric_number;
    res.json({ student: result.rows[0] });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out.' });
});

router.get('/me', requireStudentAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, matric_number, institution, full_name, email, phone,
              token_balance, notify_email, notify_sms, created_at
       FROM student_tokens WHERE id=$1`,
      [req.session.studentId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Student not found.' });
    res.json({ student: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile.' });
  }
});

router.get('/log', requireStudentAuth, async (req, res) => {
  try {
    const student = await pool.query(
      'SELECT matric_number FROM student_tokens WHERE id=$1',
      [req.session.studentId]
    );
    if (!student.rows.length) return res.status(404).json({ error: 'Student not found.' });

    const docs = await pool.query(
      `SELECT doc_id FROM documents
       WHERE LOWER(metadata->>'matric_number') = LOWER($1)`,
      [student.rows[0].matric_number]
    );
    const docIds = docs.rows.map(d => d.doc_id);
    if (!docIds.length) return res.json({ logs: [], total: 0 });

    const logs = await pool.query(
      `SELECT vl.id, vl.doc_id, vl.verified_at, vl.ip_address,
              vl.user_agent, vl.result, vl.payment_method,
              d.title, d.doc_type
       FROM verification_log vl
       LEFT JOIN documents d ON d.doc_id=vl.doc_id
       WHERE vl.doc_id=ANY($1)
       ORDER BY vl.verified_at DESC LIMIT 100`,
      [docIds]
    );
    res.json({ logs: logs.rows, total: logs.rows.length });
  } catch (err) {
    console.error('Log error:', err);
    res.status(500).json({ error: 'Failed to fetch log.' });
  }
});

router.post('/buy', requireStudentAuth, async (req, res) => {
  const bundle = BUNDLES.find(b => b.id === parseInt(req.body.bundle_id));
  if (!bundle) return res.status(400).json({ error: 'Invalid bundle.' });

  try {
    const student = await pool.query(
      'SELECT matric_number, institution, email FROM student_tokens WHERE id=$1',
      [req.session.studentId]
    );
    if (!student.rows.length) return res.status(404).json({ error: 'Student not found.' });

    const { matric_number, institution, email } = student.rows[0];
    const { url, reference } = await initializeTransaction({
      email: email || `${matric_number.toLowerCase()}@verify.placeholder`,
      amountKobo: bundle.amountKobo,
      metadata: {
        type: 'token_purchase',
        matric_number,
        institution,
        bundle_id: bundle.id,
        tokens:    bundle.tokens,
        student_id: req.session.studentId,
      },
      callbackUrl: `${BASE_URL()}/api/tokens/verify-payment`,
    });

    await pool.query(
      `INSERT INTO token_purchases
        (matric_number, institution, bundle_size, amount_kobo, paystack_ref, email)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [matric_number, institution, bundle.tokens, bundle.amountKobo, reference, email]
    );

    res.json({ payment_url: url, reference });
  } catch (err) {
    console.error('Buy tokens error:', err);
    res.status(500).json({ error: 'Failed to initiate payment.' });
  }
});

router.get('/verify-payment', async (req, res) => {
  const { reference } = req.query;
  if (!reference) return res.redirect('/student.html?error=missing_reference');

  try {
    const { verifyTransaction } = require('../utils/paystack');
    const txn  = await verifyTransaction(reference);
    if (txn.status !== 'success') return res.redirect('/student.html?error=payment_failed');

    const meta = txn.metadata;
    const existing = await pool.query(
      `SELECT id FROM token_purchases WHERE paystack_ref=$1 AND paystack_status='success'`,
      [reference]
    );
    if (!existing.rows.length) {
      await pool.query(
        `UPDATE token_purchases SET paystack_status='success', completed_at=NOW() WHERE paystack_ref=$1`,
        [reference]
      );
      await pool.query(
        `UPDATE student_tokens SET token_balance=token_balance+$1, updated_at=NOW()
         WHERE matric_number=$2 AND institution=$3`,
        [meta.tokens, meta.matric_number, meta.institution]
      );
    }
    res.redirect(`/student.html?success=tokens_added&tokens=${meta.tokens}`);
  } catch (err) {
    console.error('Verify payment error:', err);
    res.redirect('/student.html?error=verification_failed');
  }
});

router.patch('/notifications', requireStudentAuth, async (req, res) => {
  const { notify_email, notify_sms, email, phone } = req.body;
  try {
    await pool.query(
      `UPDATE student_tokens
       SET notify_email=$1, notify_sms=$2,
           email=COALESCE($3, email), phone=COALESCE($4, phone), updated_at=NOW()
       WHERE id=$5`,
      [!!notify_email, !!notify_sms, email||null, phone||null, req.session.studentId]
    );
    res.json({ message: 'Notification preferences updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Update failed.' });
  }
});

// GET /api/tokens/replacement-pdf/:docId
router.get('/replacement-pdf/:docId', requireStudentAuth, async (req, res) => {
  const { docId } = req.params;

  try {
    const student = await pool.query(
      'SELECT matric_number, institution FROM student_tokens WHERE id = $1',
      [req.session.studentId]
    );
    if (!student.rows.length) return res.status(404).json({ error: 'Student not found.' });

    const { matric_number, institution } = student.rows[0];

    const docResult = await pool.query(
      `SELECT * FROM documents
       WHERE doc_id = $1
       AND issued_by ILIKE $2
       AND LOWER(metadata->>'matric_number') = LOWER($3)`,
      [docId, `%${institution}%`, matric_number]
    );

    if (!docResult.rows.length) {
      return res.status(403).json({ error: 'Document not found or does not belong to your record.' });
    }

    const docData = docResult.rows[0];

    await pool.query(
      `INSERT INTO verification_log (doc_id, ip_address, user_agent, result, payment_method)
       VALUES ($1, $2, $3, 'found', 'replacement_pdf')`,
      [docId, req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress, req.headers['user-agent'] || '']
    );

    const { generatePDF } = require('../utils/pdfGenerator');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${docId}-official.pdf"`);
    await generatePDF(docData, res);

  } catch (err) {
    console.error('Replacement PDF error:', err);
    res.status(500).json({ error: 'Failed to generate replacement PDF.' });
  }
});

module.exports = router;
module.exports.BUNDLES = BUNDLES;