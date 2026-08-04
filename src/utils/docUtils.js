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
 * Generate an HMAC signature for a document ID.
 * Uses HMAC-SHA256 with DOC_SECRET, truncated to 16 hex chars.
 * Short enough for URLs, cryptographically strong enough to prevent forgery.
 */
function signDocId(docId) {
  const secret = process.env.DOC_SECRET || 'dev-secret';
  return crypto
    .createHmac('sha256', secret)
    .update(docId)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Verify that a signature matches a document ID.
 * Uses timing-safe comparison to prevent timing attacks.
 */
function verifyDocSignature(docId, sig) {
  if (!sig || typeof sig !== 'string') return false;
  const expected = signDocId(docId);
  // Pad to same length for timingSafeEqual
  const a = Buffer.from(sig.padEnd(64, '0').slice(0, 64));
  const b = Buffer.from(expected.padEnd(64, '0').slice(0, 64));
  return crypto.timingSafeEqual(a, b) && sig === expected;
}

/**
 * Build the public verification URL for a document ID.
 * Includes an HMAC signature so the URL cannot be tampered with.
 * Format: /verify?doc=DOCID&sig=HMAC16
 */
function buildVerifyUrl(docId) {
  const base = process.env.BASE_URL || 'http://localhost:3000';
  const sig  = signDocId(docId);
  return `${base}/verify?doc=${encodeURIComponent(docId)}&sig=${sig}`;
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

module.exports = { generateDocId, buildVerifyUrl, signDocId, verifyDocSignature, generateQRBuffer, generateQRDataUrl };