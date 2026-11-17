const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { cleanText } = require('../utils/text');
const { hashPin, requireStudentAuth } = require('../middleware/studentAuth');
const { loginLimiter } = require('../middleware/rateLimiter');
const { initializeTransaction } = require('../utils/paystack');
const { settleTokenPurchase } = require('../utils/payments');
const { tenantBaseUrl, buildVerifyUrl } = require('../utils/docUtils');

const BUNDLES = [
  { id:1, label:'1 verification',   tokens:1,  amountKobo:100000 },
  { id:2, label:'3 verifications',  tokens:3,  amountKobo:250000 },
  { id:3, label:'5 verifications',  tokens:5,  amountKobo:400000 },
  { id:4, label:'10 verifications', tokens:10, amountKobo:700000 },
];

router.get('/bundles', (req, res) => res.json({ bundles: BUNDLES }));

// What the sign-up form needs to know about this school
router.get('/config', async (req, res) => {
  try { res.json({ claim_required: await claimRequired(pool, req.tenant.id) }); }
  catch (e) { res.status(500).json({ error: 'Failed to load.' }); }
});

const { hashPassword, verifyPassword } = require('../utils/staffAuth');
const { redeemClaimCode, claimRequired } = require('../utils/claims');

const PIN_RE = /^\d{4,8}$/;
const PIN_MAX_FAILED = 5, PIN_LOCK_MINUTES = 15;
const publicStudent = (s, extra = {}) => ({
  id: s.id, matric_number: s.matric_number, institution: s.institution, full_name: s.full_name,
  email: s.email, token_balance: s.token_balance, verified: !!s.verified_at, ...extra,
});

function startSession(req, student) {
  req.session.studentId  = student.id;
  req.session.matric     = student.matric_number;
  req.session.tenantId   = req.tenant.id;
  req.session.studentVer = student.session_version || 0;
}

// The signed-in graduate, or null if the account changed hands (a claim by
// the real graduate bumps session_version and ends every older session)
async function currentStudent(req) {
  const r = await pool.query(
    `SELECT id, matric_number, institution, full_name, email, phone, token_balance,
            notify_email, notify_sms, created_at, verified_at, session_version
     FROM student_tokens WHERE id = $1 AND tenant_id = $2`,
    [req.session.studentId, req.tenant.id]);
  const s = r.rows[0];
  if (!s || (s.session_version || 0) !== (req.session.studentVer || 0)) return null;
  return s;
}

// Documents and their scan history are only shown once the account has
// proved it belongs to the graduate (claim code), where the school asks for it
async function requireClaimed(req, res) {
  const s = await currentStudent(req);
  if (!s) { req.session.destroy(() => {}); res.status(401).json({ error: 'Please log in again.' }); return null; }
  if (!s.verified_at && await claimRequired(pool, req.tenant.id)) {
    res.status(403).json({ error: 'Enter the claim code from your institution to see your documents.', claim_required: true });
    return null;
  }
  return s;
}

router.post('/register', loginLimiter, async (req, res) => {
  const { matric_number, pin, claim_code } = req.body;
  const institution = cleanText(req.body.institution, 200);
  const full_name = cleanText(req.body.full_name, 200), email = cleanText(req.body.email, 200), phone = cleanText(req.body.phone, 30);
  const tenantId = req.tenant.id;

  if (!matric_number || !institution || !pin)
    return res.status(400).json({ error: 'matric_number, institution, and pin are required.' });
  if (!PIN_RE.test(String(pin)))
    return res.status(400).json({ error: 'PIN must be 4-8 digits.' });

  const matric = String(matric_number).trim().toUpperCase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const required = await claimRequired(client, tenantId);
    if (required && !claim_code) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Enter the claim code your institution gave you with your document.', claim_required: true });
    }
    const existing = (await client.query(
      `SELECT id, verified_at FROM student_tokens
       WHERE UPPER(matric_number) = $1 AND LOWER(institution) = LOWER($2) AND tenant_id = $3 FOR UPDATE`,
      [matric, institution, tenantId])).rows[0];

    if (existing && (existing.verified_at || !required)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Student already registered. Please log in.' });
    }
    const claimId = required ? await redeemClaimCode(client, tenantId, matric, claim_code, existing?.id) : null;
    if (required && !claimId) {
      await client.query('ROLLBACK');
      // Counts as a failed attempt for the rate limiter
      return res.status(400).json({ error: 'That claim code is not valid for this matric number, or it has expired or been used. Ask your institution for a new one.' });
    }

    const pin_hash = hashPassword(String(pin));
    let row;
    if (existing) {
      // An unclaimed account for this matric number was opened by someone
      // without a code. The real graduate takes it over; older sessions end.
      row = (await client.query(
        `UPDATE student_tokens SET pin_hash = $1, pin_salt = '', full_name = COALESCE($2, full_name),
                email = COALESCE($3, email), phone = COALESCE($4, phone),
                verified_at = NOW(), session_version = session_version + 1, updated_at = NOW()
         WHERE id = $5 RETURNING *`,
        [pin_hash, full_name || null, email || null, phone || null, existing.id])).rows[0];
    } else {
      row = (await client.query(
        `INSERT INTO student_tokens
           (matric_number, institution, full_name, email, phone, pin_hash, pin_salt, tenant_id, verified_at)
         VALUES ($1,$2,$3,$4,$5,$6,'',$7,${required ? 'NOW()' : 'NULL'})
         RETURNING *`,
        [matric, institution, full_name || null, email || null, phone || null, pin_hash, tenantId])).rows[0];
      if (claimId) await client.query('UPDATE student_claim_codes SET used_by = $1 WHERE id = $2', [row.id, claimId]);
    }
    await client.query('COMMIT');
    startSession(req, row);
    res.status(201).json({ student: publicStudent(row, { claim_required: required }) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed.' });
  } finally { client.release(); }
});

// A signed-in graduate whose account isn't claimed yet enters the code here
router.post('/claim', requireStudentAuth, loginLimiter, async (req, res) => {
  const client = await pool.connect();
  try {
    const s = await currentStudent(req);
    if (!s) return res.status(401).json({ error: 'Please log in again.' });
    if (s.verified_at) return res.json({ student: publicStudent(s) });
    await client.query('BEGIN');
    if (!(await redeemClaimCode(client, req.tenant.id, s.matric_number, req.body.claim_code, s.id))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'That claim code is not valid for this matric number, or it has expired or been used.' });
    }
    const row = (await client.query(
      'UPDATE student_tokens SET verified_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *', [s.id])).rows[0];
    await client.query('COMMIT');
    res.json({ student: publicStudent(row) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Claim error:', err);
    res.status(500).json({ error: 'Could not check the claim code.' });
  } finally { client.release(); }
});

router.post('/login', loginLimiter, async (req, res) => {
  const { matric_number, pin } = req.body;
  const institution = cleanText(req.body.institution, 200);
  const tenantId = req.tenant.id;

  if (!matric_number || !institution || !pin)
    return res.status(400).json({ error: 'matric_number, institution, and pin are required.' });

  try {
    const r = await pool.query(
      `SELECT *, COALESCE(pin_salt,'') AS pin_salt FROM student_tokens
       WHERE LOWER(matric_number)=LOWER($1) AND LOWER(institution)=LOWER($2) AND tenant_id=$3`,
      [matric_number, institution, tenantId]
    );
    const student = r.rows[0];
    if (student && student.locked_until && new Date(student.locked_until) > new Date())
      return res.status(429).json({ error: `Too many wrong PINs. Try again in ${PIN_LOCK_MINUTES} minutes.` });
    let ok = false;
    if (student && String(student.pin_hash || '').startsWith('scrypt$')) {
      ok = verifyPassword(String(pin), student.pin_hash);
    } else if (student) {
      // Older accounts: SHA-256 PIN hash. Check it, then move it to scrypt.
      const a = Buffer.from(hashPin(String(pin), student.pin_salt));
      const b = Buffer.from(String(student.pin_hash || ''));
      ok = a.length === b.length && require('crypto').timingSafeEqual(a, b);
      if (ok) await pool.query(`UPDATE student_tokens SET pin_hash = $1, pin_salt = '' WHERE id = $2`,
        [hashPassword(String(pin)), student.id]);
    }
    if (!ok) {
      // Count the miss against the account; the 5th in a row locks it
      if (student) await pool.query(
        `UPDATE student_tokens
            SET failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END,
                locked_until  = CASE WHEN failed_logins + 1 >= $2 THEN NOW() + make_interval(mins => $3) ELSE locked_until END
         WHERE id = $1`, [student.id, PIN_MAX_FAILED, PIN_LOCK_MINUTES]);
      return res.status(401).json({ error: 'Invalid matric number, institution, or PIN.' });
    }
    await pool.query('UPDATE student_tokens SET failed_logins = 0, locked_until = NULL WHERE id = $1', [student.id]);

    startSession(req, student);
    res.json({ student: publicStudent(student, { claim_required: await claimRequired(pool, tenantId) }) });
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
    const s = await currentStudent(req);
    if (!s) { req.session.destroy(() => {}); return res.status(401).json({ error: 'Please log in again.' }); }
    const { session_version, verified_at, ...rest } = s;
    res.json({ student: { ...rest, verified: !!verified_at, claim_required: await claimRequired(pool, req.tenant.id) } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile.' });
  }
});

// The graduate's own documents, once the account is claimed
router.get('/my-documents', requireStudentAuth, async (req, res) => {
  try {
    const student = await requireClaimed(req, res);
    if (!student) return;
    const r = await pool.query(
      `SELECT doc_id, title, doc_type, issued_by, issue_date, expiry_date, status, tenant_id, issued_to
       FROM documents
       WHERE LOWER(metadata->>'matric_number') = LOWER($1) AND tenant_id = $2 AND status <> 'superseded'
       ORDER BY issue_date DESC, created_at DESC LIMIT 100`,
      [student.matric_number, req.tenant.id]);
    const documents = [];
    for (const d of r.rows) {
      const { tenant_id, issued_to, ...rest } = d;
      documents.push({ ...rest, verify_url: await buildVerifyUrl(d, req.tenant.subdomain) });
    }
    res.json({ documents, matric_number: student.matric_number });
  } catch (err) {
    console.error('My documents error:', err);
    res.status(500).json({ error: 'Failed to load documents.' });
  }
});

router.get('/log', requireStudentAuth, async (req, res) => {
  const tenantId = req.tenant.id;
  try {
    const student = await requireClaimed(req, res);
    if (!student) return;

    const docs = await pool.query(
      `SELECT doc_id FROM documents
       WHERE LOWER(metadata->>'matric_number')=LOWER($1) AND tenant_id=$2`,
      [student.matric_number, tenantId]
    );
    const docIds = docs.rows.map(d => d.doc_id);
    if (!docIds.length) return res.json({ logs:[], total:0 });

    const logs = await pool.query(
      // Verifiers' IP addresses and browsers are their personal data: the
      // graduate sees when and roughly where (city), never the IP itself
      `SELECT vl.id, vl.doc_id, vl.verified_at, vl.geo_location AS location,
              vl.result, vl.payment_method,
              d.title, d.doc_type
       FROM verification_log vl
       LEFT JOIN documents d ON d.doc_id=vl.doc_id
       WHERE vl.doc_id=ANY($1) AND vl.tenant_id=$2
       ORDER BY vl.verified_at DESC LIMIT 100`,
      [docIds, tenantId]
    );
    res.json({ logs:logs.rows, total:logs.rows.length });
  } catch (err) {
    console.error('Log error:', err);
    res.status(500).json({ error: 'Failed to fetch log.' });
  }
});

router.post('/buy', requireStudentAuth, async (req, res) => {
  const tenantId = req.tenant.id;
  const bundle   = BUNDLES.find(b => b.id === parseInt(req.body.bundle_id));
  if (!bundle) return res.status(400).json({ error: 'Invalid bundle.' });

  try {
    const student = await pool.query(
      'SELECT matric_number, institution, email FROM student_tokens WHERE id=$1 AND tenant_id=$2',
      [req.session.studentId, tenantId]
    );
    if (!student.rows.length) return res.status(404).json({ error: 'Student not found.' });

    const { matric_number, institution, email } = student.rows[0];
    const { url, reference } = await initializeTransaction({
      email: email || `${matric_number.toLowerCase()}@verify.placeholder`,
      amountKobo: bundle.amountKobo,
      metadata: {
        type: 'token_purchase', matric_number, institution,
        bundle_id: bundle.id, tokens: bundle.tokens,
        student_id: req.session.studentId, tenant_id: tenantId,
      },
      callbackUrl: `${tenantBaseUrl(req.tenant.subdomain)}/api/tokens/verify-payment`,
    });

    await pool.query(
      `INSERT INTO token_purchases
         (matric_number, institution, bundle_size, amount_kobo, paystack_ref, email)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [matric_number, institution, bundle.tokens, bundle.amountKobo, reference, email]
    );
    res.json({ payment_url:url, reference });
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
    const txn = await verifyTransaction(reference);
    if (txn.status !== 'success') return res.redirect('/student.html?error=payment_failed');

    const r = await settleTokenPurchase(txn);
    if (!r.ok) return res.redirect('/student.html?error=verification_failed');
    res.redirect(`/student.html?success=tokens_added&tokens=${r.credited || r.tokens}`);
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
           email=COALESCE($3,email), phone=COALESCE($4,phone), updated_at=NOW()
       WHERE id=$5 AND tenant_id=$6`,
      [!!notify_email, !!notify_sms, email||null, phone||null,
       req.session.studentId, req.tenant.id]
    );
    res.json({ message:'Notification preferences updated.' });
  } catch (err) {
    res.status(500).json({ error:'Update failed.' });
  }
});

router.get('/replacement-pdf/:docId', requireStudentAuth, async (req, res) => {
  const { docId } = req.params;
  const tenantId  = req.tenant.id;

  try {
    const student = await requireClaimed(req, res);
    if (!student) return;

    const { matric_number, institution } = student;
    const docResult = await pool.query(
      `SELECT * FROM documents
       WHERE doc_id=$1 AND tenant_id=$2
       AND issued_by ILIKE $3
       AND LOWER(metadata->>'matric_number')=LOWER($4)`,
      [docId, tenantId, `%${institution}%`, matric_number]
    );
    if (!docResult.rows.length)
      return res.status(403).json({ error:'Document not found or does not belong to your record.' });

    await pool.query(
      `INSERT INTO verification_log (doc_id, ip_address, user_agent, result, payment_method, tenant_id)
       VALUES ($1,$2,$3,'found','replacement_pdf',$4)`,
      [docId,
       req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress,
       req.headers['user-agent'] || '', tenantId]
    );

    const { generatePDF } = require('../utils/pdfGenerator');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${docId}-official.pdf"`);
    await generatePDF(docResult.rows[0], res);
  } catch (err) {
    console.error('Replacement PDF error:', err);
    res.status(500).json({ error:'Failed to generate replacement PDF.' });
  }
});

module.exports = router;
module.exports.BUNDLES = BUNDLES;