const PDFDocument = require('pdfkit');
const { generateQRBuffer, buildVerifyUrl } = require('./docUtils');

/**
 * Generate a sample authenticated PDF document.
 *
 * @param {Object} docData - Document metadata from DB
 * @param {Stream} outputStream - Writable stream to pipe PDF into
 *
 * Usage:
 *   const res = ...; // Express response
 *   res.setHeader('Content-Type', 'application/pdf');
 *   await generatePDF(docData, res);
 */
async function generatePDF(docData, outputStream) {
  const { buffer: qrBuffer, url: verifyUrl } = await generateQRBuffer(docData.doc_id);

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 60, bottom: 60, left: 72, right: 72 },
    info: {
      Title: docData.title,
      Author: docData.issued_by,
      Subject: 'Authenticated Document',
      Keywords: 'verified, authenticated',
      CreationDate: new Date(docData.issue_date),
    },
  });

  doc.pipe(outputStream);

  // Header bar
  doc.rect(0, 0, doc.page.width, 8).fill('#1a3a5c');

  // Logo / company name area
  doc.moveDown(1);
  doc.fontSize(10).fillColor('#888888').text(docData.issued_by.toUpperCase(), {
    align: 'center',
    characterSpacing: 2,
  });

  doc.moveDown(0.5);
  doc.fontSize(22).fillColor('#1a3a5c').font('Helvetica-Bold').text(docData.title, {
    align: 'center',
  });

  // Divider
  doc.moveDown(0.8);
  doc.moveTo(72, doc.y).lineTo(doc.page.width - 72, doc.y).strokeColor('#1a3a5c').lineWidth(1).stroke();
  doc.moveDown(1);

  // Main body fields
  const fieldY = doc.y;
  doc.font('Helvetica').fontSize(11).fillColor('#333333');

  const fields = [
    ['Issued To', docData.issued_to],
    ['Document ID', docData.doc_id],
    ['Issue Date', new Date(docData.issue_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })],
    ['Document Type', docData.doc_type || 'Official Document'],
    ...(docData.expiry_date ? [['Valid Until', new Date(docData.expiry_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })]] : []),
    ...Object.entries(docData.metadata || {}).filter(([, v]) => typeof v === 'string'),
  ];

  fields.forEach(([label, value]) => {
    doc.font('Helvetica-Bold').text(`${label}:  `, { continued: true });
    doc.font('Helvetica').text(value);
    doc.moveDown(0.3);
  });

  // QR code section - bottom right
  const qrSize = 100;
  const qrX = doc.page.width - 72 - qrSize;
  const qrY = fieldY;

  doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });

  doc.fontSize(7).fillColor('#888888').text('Scan to verify', qrX, qrY + qrSize + 4, {
    width: qrSize,
    align: 'center',
  });

  // Authenticity notice
  const noticeY = Math.max(doc.y + 40, qrY + qrSize + 40);
  doc.moveTo(72, noticeY).lineTo(doc.page.width - 72, noticeY).strokeColor('#dddddd').lineWidth(0.5).stroke();

  doc.y = noticeY + 16;
  doc.fontSize(9).fillColor('#888888').text(
    `This document is digitally registered and can be verified by scanning the QR code or visiting: ${verifyUrl}`,
    { align: 'center', width: doc.page.width - 144 }
  );

  // Footer bar
  doc.rect(0, doc.page.height - 8, doc.page.width, 8).fill('#1a3a5c');

  doc.end();
}

module.exports = { generatePDF };
