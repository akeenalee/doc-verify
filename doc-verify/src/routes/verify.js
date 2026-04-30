const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET /verify?doc=DOC-20241215-A3F9K2M1
// This is the public page that QR codes link to.
// Logs every scan for audit trail.
router.get('/', async (req, res) => {
  const { doc } = req.query;

  if (!doc) {
    return res.status(400).send(renderPage('Invalid Request', 'No document ID provided.', 'error', null));
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';

  try {
    const result = await pool.query(
      `SELECT id, doc_id, title, issued_to, issued_by, doc_type,
              issue_date, expiry_date, status, metadata
       FROM documents WHERE doc_id = $1`,
      [doc]
    );

    let logResult = 'not_found';
    let html = '';

    if (!result.rows.length) {
      logResult = 'not_found';
      html = renderPage(
        'Document Not Found',
        `No record found for ID: <strong>${escHtml(doc)}</strong>. This document was not issued by us or the ID is incorrect.`,
        'error',
        null
      );
    } else {
      const docData = result.rows[0];
      const isExpired = docData.expiry_date && new Date(docData.expiry_date) < new Date();

      if (docData.status === 'revoked') {
        logResult = 'revoked';
        html = renderPage(
          'Document Revoked',
          `This document (${escHtml(docData.doc_id)}) has been revoked and is no longer valid.`,
          'revoked',
          docData
        );
      } else if (isExpired) {
        logResult = 'found';
        html = renderPage('Document Expired', null, 'expired', docData);
      } else {
        logResult = 'found';
        html = renderPage('Document Verified', null, 'verified', docData);
      }
    }

    // Fire-and-forget audit log
    pool.query(
      `INSERT INTO verification_log (doc_id, ip_address, user_agent, result)
       VALUES ($1, $2, $3, $4)`,
      [doc, ip, userAgent, logResult]
    ).catch(err => console.error('Audit log error:', err));

    res.send(html);
  } catch (err) {
    console.error('Verification error:', err);
    res.status(500).send(renderPage('Server Error', 'An error occurred. Please try again later.', 'error', null));
  }
});

// GET /api/verify/:docId - JSON version for programmatic checks
router.get('/api/:docId', async (req, res) => {
  const { docId } = req.params;

  try {
    const result = await pool.query(
      `SELECT doc_id, title, issued_to, issued_by, doc_type,
              issue_date, expiry_date, status
       FROM documents WHERE doc_id = $1`,
      [docId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ valid: false, reason: 'not_found' });
    }

    const doc = result.rows[0];
    const isExpired = doc.expiry_date && new Date(doc.expiry_date) < new Date();

    res.json({
      valid: doc.status === 'active' && !isExpired,
      status: isExpired ? 'expired' : doc.status,
      document: doc,
    });
  } catch (err) {
    res.status(500).json({ valid: false, reason: 'server_error' });
  }
});

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(d) {
  if (!d) return 'N/A';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

function renderPage(pageTitle, message, state, docData) {
  const states = {
    verified: { icon: '&#10003;', color: '#0f6e56', bg: '#e1f5ee', label: 'Verified Authentic', border: '#9FE1CB' },
    expired:  { icon: '&#8987;', color: '#854F0B', bg: '#faeeda', label: 'Document Expired',   border: '#FAC775' },
    revoked:  { icon: '&#10007;', color: '#A32D2D', bg: '#fcebeb', label: 'Document Revoked',   border: '#F7C1C1' },
    error:    { icon: '&#33;',   color: '#666666', bg: '#f5f5f5', label: 'Not Found',           border: '#dddddd' },
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
      ${Object.entries(docData.metadata || {})
          .filter(([, v]) => typeof v === 'string')
          .map(([k, v]) => row(escHtml(k), escHtml(v)))
          .join('')}
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
    .sub{font-size:14px;color:#888;margin-bottom:0}
    table td{padding:10px 0;font-size:14px;border-bottom:1px solid #f0f0f0;vertical-align:top}
    table td:first-child{color:#888;width:130px;padding-right:12px}
    table td:last-child{color:#111;font-weight:500}
    .mono{font-family:monospace;font-size:13px;letter-spacing:0.5px}
    .footer{margin-top:28px;padding-top:20px;border-top:1px solid #eee;font-size:12px;color:#aaa;text-align:center}
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">
      <span class="icon">${s.icon}</span>
      ${s.label}
    </div>
    <h1>${escHtml(pageTitle)}</h1>
    <p class="sub">Document verification result</p>
    ${docFields}
    <div class="footer">
      Verified on ${new Date().toLocaleString('en-GB')} &middot; Powered by DocVerify
    </div>
  </div>
</body>
</html>`;
}

function row(label, value, mono = false) {
  return `<tr><td>${label}</td><td class="${mono ? 'mono' : ''}">${value}</td></tr>`;
}

module.exports = router;
