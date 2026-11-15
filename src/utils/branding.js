// Per-tenant PDF branding: logo and the signatories valid on a document's
// issue date. Shared by the certificate, government and transcript PDFs.
//
// Rules
// - Each tenant has two signature slots (1 = left, usually Registrar;
//   2 = middle, usually Vice-Chancellor).
// - For a slot, the signatory used is the one whose effective dates cover the
//   document's issue date; one limited to this document type beats one for
//   all types; then the most recent start date wins. So a document issued in
//   2025 keeps the 2025 Registrar's signature when it's regenerated later.
// - The legacy signature files in /signatures are used only by the root demo
//   tenant while it has no signatories of its own. A real institution with no
//   signatory for a slot gets an empty signature line, never someone else's.

const fs   = require('fs');
const path = require('path');
const pool = require('../db/pool');

const ROOT_TENANT = (process.env.ROOT_TENANT_SUBDOMAIN || 'demo').toLowerCase();
const SIG_DIR = path.join(__dirname, '..', '..', 'signatures');
const LEGACY = {
  1: path.join(SIG_DIR, 'registrar.png'),
  2: path.join(SIG_DIR, 'vc.png'),
};

const MIME = { png: 'image/png', jpeg: 'image/jpeg' };

// PDFKit draws PNG and JPEG only, so those are the only formats accepted
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return MIME.png;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return MIME.jpeg;
  return null;
}

function isoDate(d) {
  const x = d ? new Date(d) : new Date();
  return isNaN(x) ? new Date().toISOString().slice(0, 10) : x.toISOString().slice(0, 10);
}

async function loadBrand(docData) {
  const brand = { logo: null, slots: { 1: null, 2: null }, legacy: false };
  if (!docData || !docData.tenant_id) { brand.legacy = true; return brand; }
  try {
    const t = await pool.query('SELECT subdomain, logo_data FROM tenants WHERE id = $1', [docData.tenant_id]);
    const tenant = t.rows[0];
    if (!tenant) { brand.legacy = true; return brand; }
    brand.logo = tenant.logo_data || null;

    const s = await pool.query(
      `SELECT DISTINCT ON (slot) slot, full_name, title, image_data
       FROM signatories
       WHERE tenant_id = $1
         AND effective_from <= $2::date
         AND (effective_to IS NULL OR effective_to >= $2::date)
         AND (cardinality(doc_types) = 0 OR $3 = ANY(doc_types))
       ORDER BY slot, (cardinality(doc_types) > 0) DESC, effective_from DESC, created_at DESC`,
      [docData.tenant_id, isoDate(docData.issue_date), docData.doc_type || '']
    );
    for (const r of s.rows) brand.slots[r.slot] = { name: r.full_name, title: r.title, image: r.image_data };

    if (tenant.subdomain === ROOT_TENANT && !s.rows.length) {
      const any = await pool.query('SELECT 1 FROM signatories WHERE tenant_id = $1 LIMIT 1', [docData.tenant_id]);
      brand.legacy = !any.rows.length;
    }
  } catch (e) {
    // Before migration 005 runs, behave exactly as before
    console.error('Brand load error:', e.message);
    brand.legacy = true;
  }
  return brand;
}

// Draws one signature block: image above the line, then name and title (or
// the default label when the slot is empty), all centred in `width`.
function drawSignature(doc, brand, slot, { x, y, width = 120, defaultLabel, navy = '#1A3A5C', gray = '#888888', dark = '#333333' }) {
  const s = brand && brand.slots ? brand.slots[slot] : null;
  let img = null;
  if (s && s.image) img = s.image;
  else if (brand && brand.legacy && LEGACY[slot] && fs.existsSync(LEGACY[slot])) img = LEGACY[slot];
  if (img) {
    try { doc.image(img, x + (width - 110) / 2, y + 4, { fit: [110, 36], align: 'center', valign: 'bottom' }); }
    catch (e) { console.error('Signature image error:', e.message); }
  }
  doc.moveTo(x, y + 44).lineTo(x + width, y + 44).strokeColor(navy).lineWidth(0.6).stroke();
  if (s) {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(dark)
       .text(s.name, x, y + 48, { width, align: 'center', lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(7).fillColor(gray)
       .text(s.title.toUpperCase(), x, y + 58, { width, align: 'center', characterSpacing: 0.5, lineBreak: false, ellipsis: true });
  } else {
    doc.font('Helvetica').fontSize(7.5).fillColor(gray)
       .text(String(defaultLabel || '').toUpperCase(), x, y + 50, { width, align: 'center', characterSpacing: 0.8 });
  }
}

// Logo inside a box; returns true when drawn
function drawLogo(doc, brand, x, y, w, h) {
  if (!brand || !brand.logo) return false;
  try { doc.image(brand.logo, x, y, { fit: [w, h], align: 'center', valign: 'center' }); return true; }
  catch (e) { console.error('Logo draw error:', e.message); return false; }
}

// Settings preview only: a diagonal SPECIMEN mark across every page, so a
// preview can never pass as a real document
function stampSpecimen(doc, docData) {
  if (!docData || !docData._specimen) return;
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const { width: W, height: H } = doc.page;
    doc.save();
    doc.rotate(-35, { origin: [W / 2, H / 2] });
    doc.font('Helvetica-Bold').fontSize(90).fillColor('#C0392B').fillOpacity(0.18)
       .text('SPECIMEN', 0, H / 2 - 45, { width: W, align: 'center', lineBreak: false });
    doc.restore();
    doc.fillOpacity(1);
  }
}

// Cache-busting token for /brand/logo, or null when the tenant has no logo
async function logoVersion(tenantId) {
  try {
    const r = await pool.query('SELECT logo_updated_at FROM tenants WHERE id = $1 AND logo_data IS NOT NULL', [tenantId]);
    return r.rows[0] ? new Date(r.rows[0].logo_updated_at || 0).getTime() : null;
  } catch (e) { return null; }
}

module.exports = { logoVersion, loadBrand, drawSignature, drawLogo, sniffImage, isoDate, stampSpecimen };
