const crypto = require('crypto');
const QRCode = require('qrcode');

/**
 * Generate a human-readable document ID.
 * Format: DOC-YYYYMMDD-XXXXXXXX
 * e.g.  DOC-20241215-A3F9K2M1
 */
function generateDocId(prefix = 'DOC') {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${date}-${rand}`;
}

/**
 * Build the public verification URL for a document ID.
 */
function buildVerifyUrl(docId) {
  const base = process.env.BASE_URL || 'http://localhost:3000';
  return `${base}/verify?doc=${encodeURIComponent(docId)}`;
}

/**
 * Generate a QR code as a PNG Buffer.
 * Safe to embed directly into a PDF or return as an image.
 */
async function generateQRBuffer(docId) {
  const url = buildVerifyUrl(docId);
  const buffer = await QRCode.toBuffer(url, {
    type: 'png',
    errorCorrectionLevel: 'H', // High - survives up to 30% damage
    margin: 2,
    width: 300,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });
  return { buffer, url };
}

/**
 * Generate a QR code as a base64 data URL (useful for HTML embedding).
 */
async function generateQRDataUrl(docId) {
  const url = buildVerifyUrl(docId);
  const dataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 300,
  });
  return { dataUrl, url };
}

module.exports = { generateDocId, buildVerifyUrl, generateQRBuffer, generateQRDataUrl };
