const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { generateDocId, generateQRBuffer, generateQRDataUrl } = require('../utils/docUtils');
const { generatePDF } = require('../utils/pdfGenerator');

// POST /api/documents
// Create a new registered document and get back its QR code
router.post('/', async (req, res) => {
  const { title, issued_to, issued_by, doc_type, expiry_date, metadata, prefix } = req.body;

  if (!title || !issued_to || !issued_by) {
    return res.status(400).json({ error: 'title, issued_to, and issued_by are required.' });
  }

  const docId = generateDocId(prefix || 'DOC');

  try {
    const result = await pool.query(
      `INSERT INTO documents (doc_id, title, issued_to, issued_by, doc_type, expiry_date, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [docId, title, issued_to, issued_by, doc_type || null, expiry_date || null, metadata ? JSON.stringify(metadata) : '{}']
    );

    const { dataUrl, url } = await generateQRDataUrl(docId);

    res.status(201).json({
      document: result.rows[0],
      qr: { dataUrl, url },
    });
  } catch (err) {
    console.error('Error creating document:', err);
    res.status(500).json({ error: 'Failed to register document.' });
  }
});

// GET /api/documents
// List all documents (paginated)
router.get('/', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const status = req.query.status || null;

  try {
    const params = status ? [status, limit, offset] : [limit, offset];
    const where = status ? 'WHERE status = $1' : '';
    const shift = status ? 1 : 0;

    const result = await pool.query(
      `SELECT * FROM documents ${where} ORDER BY created_at DESC LIMIT $${1 + shift} OFFSET $${2 + shift}`,
      params
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM documents ${where}`,
      status ? [status] : []
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
// Returns QR code as PNG image for a specific document
router.get('/:docId/qr', async (req, res) => {
  const { docId } = req.params;

  try {
    const result = await pool.query('SELECT status FROM documents WHERE doc_id = $1', [docId]);
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
// Download a generated PDF with embedded QR code
router.get('/:docId/pdf', async (req, res) => {
  const { docId } = req.params;

  try {
    const result = await pool.query('SELECT * FROM documents WHERE doc_id = $1', [docId]);
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
// Revoke a document (makes it show as invalid on the verify page)
router.patch('/:docId/revoke', async (req, res) => {
  const { docId } = req.params;

  try {
    const result = await pool.query(
      `UPDATE documents SET status = 'revoked', updated_at = NOW() WHERE doc_id = $1 RETURNING *`,
      [docId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Document not found.' });
    res.json({ message: 'Document revoked.', document: result.rows[0] });
  } catch (err) {
    console.error('Revoke error:', err);
    res.status(500).json({ error: 'Failed to revoke document.' });
  }
});

module.exports = router;
