const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { initializeTransaction, verifyTransaction, BASE_URL } = require('../utils/paystack');

const VERIFY_FEE_KOBO = parseInt(process.env.VERIFY_FEE_KOBO) || 100000;

// GET /verify?doc=DOC-XXXX
router.get('/', async (req, res) => {
  const { doc, paid } = req.query;
  if (!doc) return res.status(400).send(renderPage('Invalid Request', 'No document ID provided.', 'error', null));

  const ip        = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';

  try {
    const result = await pool.query(
      `SELECT id, doc_id, title, issued_to, issued_by, doc_type,
              issue_date, expiry_date, status, metadata
       FROM documents WHERE doc_id = $1`,
      [doc]
    );

    if (!result.rows.length) {
      await logScan(doc, ip, userAgent, 'not_found', 'none');
      return res.send(renderPage('Document Not Found',
        `No record found for ID: <strong>${escHtml(doc)}</strong>.`, 'error', null));
    }

    const docData   = result.rows[0];
    const isExpired = docData.expiry_date && new Date(docData.expiry_date) < new Date();
    const matric    = docData.metadata?.matric_number;

    // 1. Check student token balance
    if (matric) {
      const tokenRow = await pool.query(
        `SELECT id, token_balance FROM student_tokens
         WHERE matric_number = $1 AND institution = $2`,
        [matric, docData.issued_by]
      );
      if (tokenRow.rows.length && tokenRow.rows[0].token_balance > 0) {
        await pool.query(
          `UPDATE student_tokens SET token_balance = token_balance - 1, updated_at = NOW()
           WHERE id = $1`,
          [tokenRow.rows[0].id]
        );
        await logScan(doc, ip, userAgent, docData.status === 'revoked' ? 'revoked' : 'found', 'student_token');
        return res.send(renderResult(docData, isExpired));
      }
    }

    // 2. Check if employer just paid
    if (paid) {
      try {
        const txn = await verifyTransaction(paid);
        if (txn.status === 'success' && txn.metadata?.doc_id === doc) {
          await pool.query(
            `UPDATE verification_payments
             SET result_shown = true, paystack_status = 'success', completed_at = NOW()
             WHERE paystack_ref = $1`,
            [paid]
          );
          await logScan(doc, ip, userAgent, docData.status === 'revoked' ? 'revoked' : 'found', 'employer_payment');
          return res.send(renderResult(docData, isExpired));
        }
      } catch (e) {
        console.error('Payment verify error:', e.message);
      }
      return res.redirect(`/pay.html?doc=${encodeURIComponent(doc)}&error=payment_invalid`);
    }

    // 3. No token, no payment - redirect to payment page
    return res.redirect(
      `/pay.html?doc=${encodeURIComponent(doc)}&title=${encodeURIComponent(docData.title)}&issued_to=${encodeURIComponent(docData.issued_to)}`
    );

  } catch (err) {
    console.error('Verification error:', err);
    res.status(500).send(renderPage('Server Error', 'An error occurred. Please try again later.', 'error', null));
  }
});

// GET /verify/api/payment-callback - Paystack redirects here after employer payment
router.get('/api/payment-callback', async (req, res) => {
  const { reference } = req.query;
  if (!reference) return res.redirect('/pay.html?error=missing_reference');

  try {
    const txn = await verifyTransaction(reference);
    if (txn.status !== 'success') return res.redirect('/pay.html?error=payment_failed');

    const doc_id = txn.metadata?.doc_id;
    if (!doc_id) return res.redirect('/pay.html?error=invalid_metadata');

    await pool.query(
      `UPDATE verification_payments SET paystack_status='success', completed_at=NOW()
       WHERE paystack_ref=$1`,
      [reference]
    );

    res.redirect(`/verify?doc=${encodeURIComponent(doc_id)}&paid=${encodeURIComponent(reference)}`);
  } catch (err) {
    console.error('Payment callback error:', err);
    res.redirect('/pay.html?error=verification_failed');
  }
});
// GET /verify/api/logs - admin audit log
router.get('/api/logs', async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 50);
  const offset = (page - 1) * limit;
  try {
    const result = await pool.query(
      `SELECT vl.id, vl.doc_id, vl.verified_at, vl.ip_address,
              vl.user_agent, vl.result, vl.payment_method,
              d.title, d.issued_to, d.issued_by, d.doc_type
       FROM verification_log vl
       LEFT JOIN documents d ON d.doc_id = vl.doc_id
       ORDER BY vl.verified_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const countResult = await pool.query('SELECT COUNT(*) FROM verification_log');
    res.json({
      logs:  result.rows,
      total: parseInt(countResult.rows[0].count),
      page,
      limit,
    });
  } catch (err) {
    console.error('Logs error:', err);
    res.status(500).json({ error: 'Failed to fetch logs.' });
  }
});
// GET /verify/api/:docId - JSON result
router.get('/api/:docId', async (req, res) => {
  const { docId } = req.params;
  try {
    const result = await pool.query(
      `SELECT doc_id, title, issued_to, issued_by, doc_type,
              issue_date, expiry_date, status
       FROM documents WHERE doc_id = $1`,
      [docId]
    );
    if (!result.rows.length) return res.status(404).json({ valid: false, reason: 'not_found' });
    const doc       = result.rows[0];
    const isExpired = doc.expiry_date && new Date(doc.expiry_date) < new Date();
    res.json({
      valid:    doc.status === 'active' && !isExpired,
      status:   isExpired ? 'expired' : doc.status,
      document: doc,
    });
  } catch (err) {
    res.status(500).json({ valid: false, reason: 'server_error' });
  }
});



// POST /verify/api/initiate-payment - employer starts payment
router.post('/api/initiate-payment', async (req, res) => {
  const { doc_id, email } = req.body;
  if (!doc_id || !email) return res.status(400).json({ error: 'doc_id and email required.' });

  try {
    const docResult = await pool.query(
      'SELECT doc_id, title, issued_to FROM documents WHERE doc_id = $1',
      [doc_id]
    );
    if (!docResult.rows.length) return res.status(404).json({ error: 'Document not found.' });

    const doc = docResult.rows[0];
    const { url, reference } = await initializeTransaction({
      email,
      amountKobo: VERIFY_FEE_KOBO,
      metadata: {
        type:      'employer_verification',
        doc_id,
        title:     doc.title,
        issued_to: doc.issued_to,
      },
      callbackUrl: `${BASE_URL()}/verify/api/payment-callback`,
    });

    await pool.query(
      `INSERT INTO verification_payments (doc_id, payer_email, amount_kobo, paystack_ref)
       VALUES ($1, $2, $3, $4)`,
      [doc_id, email, VERIFY_FEE_KOBO, reference]
    );

    res.json({ payment_url: url, reference, fee: VERIFY_FEE_KOBO / 100 });
  } catch (err) {
    console.error('Initiate payment error:', err);
    res.status(500).json({ error: 'Failed to initiate payment.' });
  }
});

// ── HELPERS ───────────────────────────────────────────────────────────────────

async function logScan(docId, ip, userAgent, result, paymentMethod = 'none') {
  try {
    await pool.query(
      `INSERT INTO verification_log (doc_id, ip_address, user_agent, result, payment_method)
       VALUES ($1, $2, $3, $4, $5)`,
      [docId, ip, userAgent, result, paymentMethod]
    );
  } catch (e) {
    console.error('Log scan error:', e.message);
  }
}

function renderResult(docData, isExpired) {
  if (docData.status === 'revoked') return renderPage('Document Revoked', null, 'revoked', docData);
  if (isExpired) return renderPage('Document Expired', null, 'expired', docData);
  return renderPage('Document Verified', null, 'verified', docData);
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(d) {
  if (!d) return 'N/A';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

function renderPage(pageTitle, message, state, docData) {
  const states = {
    verified: { icon: '&#10003;', color: '#0f6e56', bg: '#e1f5ee', label: 'Verified Authentic', border: '#9FE1CB' },
    expired:  { icon: '&#8987;',  color: '#854F0B', bg: '#faeeda', label: 'Document Expired',   border: '#FAC775' },
    revoked:  { icon: '&#10007;', color: '#A32D2D', bg: '#fcebeb', label: 'Document Revoked',   border: '#F7C1C1' },
    error:    { icon: '&#33;',    color: '#666666', bg: '#f5f5f5', label: 'Not Found',           border: '#dddddd' },
  };
  const s = states[state] || states.error;

  const docFields = docData ? `
    <table style="width:100%;border-collapse:collapse;margin-top:24px;">
      ${row('Document ID', escHtml(docData.doc_id), true)}
      ${row('Title', escHtml(docData.title))}
      ${row('Issued To', escHtml(docData.issued_to))}
      ${row('Issued By', escHtml(docData.issued_by))}
      ${docData.doc_type ? row('Document Type', escHtml(docData.doc_type)) : ''}
      ${row('Issue Date', formatDate(docData.issue_date))}
      ${docData.expiry_date ? row('Valid Until', formatDate(docData.expiry_date)) : ''}
    </table>
  ` : `<p style="color:#666;margin:16px 0 0;">${message || ''}</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escHtml(pageTitle)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f5;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#fff;border-radius:16px;max-width:520px;width:100%;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
    .badge{display:inline-flex;align-items:center;gap:8px;background:${s.bg};color:${s.color};border:1px solid ${s.border};border-radius:32px;padding:8px 20px;font-size:15px;font-weight:600;margin-bottom:20px}
    .icon{width:32px;height:32px;border-radius:50%;background:${s.color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
    h1{font-size:22px;color:#111;margin-bottom:4px}
    .sub{font-size:14px;color:#888}
    table td{padding:10px 0;font-size:14px;border-bottom:1px solid #f0f0f0;vertical-align:top}
    table td:first-child{color:#888;width:130px;padding-right:12px}
    table td:last-child{color:#111;font-weight:500}
    .mono{font-family:monospace;font-size:13px;letter-spacing:0.5px}
    .footer{margin-top:28px;padding-top:20px;border-top:1px solid #eee;font-size:12px;color:#aaa;text-align:center}
  </style>
</head>
<body>
  <div class="card">
    <div class="badge"><span class="icon">${s.icon}</span>${s.label}</div>
    <h1>${escHtml(pageTitle)}</h1>
    <p class="sub">Document verification result</p>
    ${docFields}
    <div class="footer">
      Verified on ${new Date().toLocaleString('en-GB')} &middot; Powered by UniVerify
    </div>
  </div>
</body>
</html>`;
}

function row(label, value, mono = false) {
  return `<tr><td>${label}</td><td class="${mono ? 'mono' : ''}">${value}</td></tr>`;
}

module.exports = router;