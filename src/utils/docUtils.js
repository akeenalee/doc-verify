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

const ROOT_DOMAIN = process.env.TENANT_ROOT_DOMAIN || 'univerify.ng';
const ROOT_TENANT = process.env.ROOT_TENANT_SUBDOMAIN || 'demo';

/**
 * Base URL for a tenant's public pages.
 * - No subdomain, or the root tenant (demo): BASE_URL, unchanged behaviour.
 * - BASE_URL on localhost: http://<sub>.localhost:<port> for local testing.
 * - Otherwise: https://<sub>.<TENANT_ROOT_DOMAIN>.
 */
function tenantBaseUrl(subdomain) {
  const base = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  if (!subdomain || subdomain === ROOT_TENANT) return base;
  try {
    const u = new URL(base);
    if (u.hostname === 'localhost' || u.hostname.endsWith('.localhost')) {
      return `${u.protocol}//${subdomain}.localhost${u.port ? ':' + u.port : ''}`;
    }
  } catch (_) { /* fall through */ }
  return `https://${subdomain}.${ROOT_DOMAIN}`;
}

/**
 * Build the public verification URL for a document ID.
 * Includes an HMAC signature so the URL cannot be tampered with.
 * The signature covers the doc ID only, so the host change doesn't affect it.
 * Format: https://<tenant>.univerify.ng/verify?doc=DOCID&sig=HMAC16
 */
function buildVerifyUrl(docId, subdomain) {
  const sig = signDocId(docId);
  return `${tenantBaseUrl(subdomain)}/verify?doc=${encodeURIComponent(docId)}&sig=${sig}`;
}

// tenant_id -> subdomain, so PDF generators can resolve the issuing tenant
// from the document row regardless of which host the request came in on.
const subdomainCache = new Map();
async function tenantSubdomain(tenantId) {
  if (!tenantId) return null;
  if (subdomainCache.has(tenantId)) return subdomainCache.get(tenantId);
  const pool = require('../db/pool');
  const r = await pool.query('SELECT subdomain FROM tenants WHERE id = $1', [tenantId]);
  const sub = r.rows[0]?.subdomain || null;
  subdomainCache.set(tenantId, sub);
  return sub;
}

// Accepts a subdomain string, a tenant object ({ subdomain }), or a document
// row ({ tenant_id }).
async function resolveSubdomain(tenantRef) {
  if (!tenantRef) return null;
  if (typeof tenantRef === 'string') return tenantRef;
  if (tenantRef.subdomain) return tenantRef.subdomain;
  if (tenantRef.tenant_id) return tenantSubdomain(tenantRef.tenant_id);
  return null;
}

/**
 * Generate a QR code as a PNG Buffer.
 * Safe to embed directly into a PDF or return as an image.
 */
async function generateQRBuffer(docId, tenantRef) {
  const url = buildVerifyUrl(docId, await resolveSubdomain(tenantRef));
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
async function generateQRDataUrl(docId, tenantRef) {
  const url = buildVerifyUrl(docId, await resolveSubdomain(tenantRef));
  const dataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 300,
  });
  return { dataUrl, url };
}

/**
 * Short-lived access token for the full-document preview
 * (/verify/doc-preview/:docId). Issued only after the verify page has
 * granted access (student token or confirmed employer payment).
 * Format: <expiryUnixSeconds>.<hmac32>. The "preview:" prefix keeps it
 * distinct from the QR signature, which covers the doc ID alone.
 */
const PREVIEW_TTL_SECONDS = 30 * 60;

function previewMac(docId, exp) {
  const secret = process.env.DOC_SECRET || 'dev-secret';
  return crypto.createHmac('sha256', secret)
    .update(`preview:${docId}:${exp}`).digest('hex').slice(0, 32);
}

function signPreviewToken(docId, ttlSeconds = PREVIEW_TTL_SECONDS) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${exp}.${previewMac(docId, exp)}`;
}

function verifyPreviewToken(docId, token) {
  if (!token || typeof token !== 'string') return false;
  const [expStr, mac] = token.split('.');
  const exp = parseInt(expStr, 10);
  if (!exp || !mac || mac.length !== 32) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false;
  const expected = previewMac(docId, exp);
  return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

module.exports = { signPreviewToken, verifyPreviewToken, generateDocId, buildVerifyUrl, tenantBaseUrl, tenantSubdomain, signDocId, verifyDocSignature, generateQRBuffer, generateQRDataUrl };