const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { generateDocId, generateQRBuffer, generateQRDataUrl } = require('../utils/docUtils');
const { generatePDF } = require('../utils/pdfGenerator');

// POST /api/documents
router.post('/', async (req, res) => {
  const { title, issued_to, issued_by, doc_type, expiry_date, metadata, prefix } = req.body;
  const tenantId = req.tenant.id;

  if (!title || !issued_to || !issued_by)
    return res.status(400).json({ error: 'title, issued_to, and issued_by are required.' });

  const docId = generateDocId(prefix || req.tenant.short_code || 'DOC');

  try {
    const result = await pool.query(
      `INSERT INTO documents
         (doc_id, title, issued_to, issued_by, doc_type, expiry_date, metadata, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [docId, title, issued_to, issued_by, doc_type||null,
       expiry_date||null, metadata ? JSON.stringify(metadata) : '{}', tenantId]
    );

    const { dataUrl, url } = await generateQRDataUrl(docId);
    res.status(201).json({ document: result.rows[0], qr: { dataUrl, url } });
  } catch (err) {
    console.error('Error creating document:', err);
    res.status(500).json({ error: 'Failed to register document.' });
  }
});

// GET /api/documents
router.get('/', async (req, res) => {
  const tenantId = req.tenant.id;
  const page     = Math.max(1, parseInt(req.query.page)  || 1);
  const limit    = Math.min(100, parseInt(req.query.limit) || 20);
  const offset   = (page - 1) * limit;
  const status   = req.query.status || null;

  try {
    const params = status
      ? [tenantId, status, limit, offset]
      : [tenantId, limit, offset];
    const where = status
      ? 'WHERE tenant_id=$1 AND status=$2'
      : 'WHERE tenant_id=$1';
    const shift = status ? 2 : 1;

    const result = await pool.query(
      `SELECT * FROM documents ${where}
       ORDER BY created_at DESC LIMIT $${shift+1} OFFSET $${shift+2}`,
      params
    );
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM documents ${where}`,
      status ? [tenantId, status] : [tenantId]
    );

    res.json({
      data: result.rows,
      pagination: { page, limit, total: parseInt(countResult.rows[0].count) },
    });
  } catch (err) {
    console.error('Error listing documents:', err);
    res.status(500).json({ error: 'Failed to fetch documents.' });
  }
});

// GET /api/documents/:docId/qr
router.get('/:docId/qr', async (req, res) => {
  const { docId } = req.params;
  const tenantId  = req.tenant.id;

  try {
    const result = await pool.query(
      'SELECT status FROM documents WHERE doc_id=$1 AND tenant_id=$2',
      [docId, tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Document not found.' });

    const { buffer } = await generateQRBuffer(docId);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="qr-${docId}.png"`);
    res.send(buffer);
  } catch (err) {
    console.error('QR generation error:', err);
    res.status(500).json({ error: 'Failed to generate QR code.' });
  }
});

// GET /api/documents/:docId/pdf
router.get('/:docId/pdf', async (req, res) => {
  const { docId } = req.params;
  const tenantId  = req.tenant.id;

  try {
    const result = await pool.query(
      'SELECT * FROM documents WHERE doc_id=$1 AND tenant_id=$2',
      [docId, tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Document not found.' });

    const docData = result.rows[0];
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${docId}.pdf"`);
    await generatePDF(docData, res);
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ error: 'Failed to generate PDF.' });
  }
});

// PATCH /api/documents/:docId/revoke
router.patch('/:docId/revoke', async (req, res) => {
  const { docId } = req.params;
  const tenantId  = req.tenant.id;

  try {
    const result = await pool.query(
      `UPDATE documents SET status='revoked', updated_at=NOW()
       WHERE doc_id=$1 AND tenant_id=$2 RETURNING *`,
      [docId, tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Document not found.' });
    res.json({ message: 'Document revoked.', document: result.rows[0] });
  } catch (err) {
    console.error('Revoke error:', err);
    res.status(500).json({ error: 'Failed to revoke document.' });
  }
});

module.exports = router;