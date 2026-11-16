// Print vendor workflow (Phase 4b). Mounted at /app-api/print.
//
// Many schools send certificates to an outside printer. Instead of finished
// PDFs, the vendor gets a print pack per issued batch: one QR per document as
// SVG (vector, best for print) and 600 dpi PNG, a manifest CSV, and the
// placement spec the school set for that document type.
//
// The Print vendor role sees print jobs and nothing else: no search, no
// verification log, no documents list. Every pack download is logged.

const express  = require('express');
const router   = express.Router();
const QRCode   = require('qrcode');
const PDFDocument = require('pdfkit');
const pool     = require('../db/pool');
const { requireStaff } = require('../middleware/staffAuth');
const { logActivity } = require('../utils/activity');
const { toCsv } = require('../utils/csv');
const { createZip } = require('../utils/zip');
const { buildVerifyUrl } = require('../utils/docUtils');
const { DOC_TYPES } = require('./staffApp');

const PRINTERS = requireStaff('owner', 'officer', 'approver', 'vendor');
const OWNER    = requireStaff('owner');

const DPI = 600;
const QR_OPTS = { errorCorrectionLevel: 'H', margin: 4 }; // 4-module quiet zone inside the image
const MIN_MODULE_MM = 0.4;
const ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const PAPERS = { A4: [210, 297], A3: [297, 420], Letter: [215.9, 279.4] };
const DEFAULT_SPEC = { anchor: 'bottom-right', x_mm: 15, y_mm: 15, size_mm: 30, paper: 'A4', notes: '' };

function bad(status, message) { const e = new Error(message); e.status = status; return e; }
function sendErr(res, e, fallback) {
  if (e.status) return res.status(e.status).json({ error: e.message });
  console.error(fallback, e);
  res.status(500).json({ error: fallback });
}

async function loadSpecs(tenantId) {
  const r = await pool.query('SELECT * FROM print_specs WHERE tenant_id = $1', [tenantId]);
  const out = {};
  for (const t of DOC_TYPES) {
    const row = r.rows.find(x => x.doc_type === t);
    out[t] = row ? { anchor: row.anchor, x_mm: Number(row.x_mm), y_mm: Number(row.y_mm), size_mm: Number(row.size_mm),
                     paper: row.paper, notes: row.notes || '', updated_at: row.updated_at, custom: true }
                 : { ...DEFAULT_SPEC, custom: false };
  }
  return out;
}

// Module size for a typical link from this school, so the spec can warn
// before a vendor prints codes too small to scan
function moduleMm(sizeMm, sampleUrl) {
  const n = QRCode.create(sampleUrl, QR_OPTS).modules.size + 8;
  return Math.round((sizeMm / n) * 100) / 100;
}
const sampleUrl = t => `https://${t.subdomain}.univerify.ng/verify?doc=${t.short_code || 'DOC'}-20260101-XXXXXXXXXXXXXXXX&sig=2.99.${'0'.repeat(32)}`;

// ── Placement specs ──────────────────────────────────────────────────────────
router.get('/specs', PRINTERS, async (req, res) => {
  try {
    const specs = await loadSpecs(req.tenant.id);
    for (const t of Object.keys(specs)) specs[t].module_mm = moduleMm(specs[t].size_mm, sampleUrl(req.tenant));
    res.json({ specs, doc_types: DOC_TYPES, anchors: ANCHORS, papers: Object.keys(PAPERS), min_module_mm: MIN_MODULE_MM, dpi: DPI });
  } catch (e) { sendErr(res, e, 'Failed to load print specs.'); }
});

router.put('/specs/:docType', OWNER, async (req, res) => {
  try {
    const t = req.params.docType;
    if (!DOC_TYPES.includes(t)) throw bad(400, 'Unknown document type.');
    const b = req.body || {};
    const paper = PAPERS[b.paper] ? b.paper : 'A4';
    const [pw, ph] = PAPERS[paper];
    const num = (v, lo, hi, what) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < lo || n > hi) throw bad(400, `${what} must be between ${lo} and ${hi} mm.`);
      return Math.round(n * 10) / 10;
    };
    const size = num(b.size_mm, 20, 60, 'QR size');
    const x = num(b.x_mm, 0, pw - size, 'Distance from the side');
    const y = num(b.y_mm, 0, ph - size, 'Distance from the edge');
    const anchor = ANCHORS.includes(b.anchor) ? b.anchor : null;
    if (!anchor) throw bad(400, 'Pick a corner.');
    const mm = moduleMm(size, sampleUrl(req.tenant));
    if (mm < MIN_MODULE_MM) throw bad(400, `At ${size} mm each QR dot would be ${mm} mm, below the ${MIN_MODULE_MM} mm phones need. Make it bigger.`);
    const notes = String(b.notes || '').slice(0, 500);
    await pool.query(
      `INSERT INTO print_specs (tenant_id, doc_type, anchor, x_mm, y_mm, size_mm, paper, notes, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (tenant_id, doc_type) DO UPDATE SET anchor = $3, x_mm = $4, y_mm = $5, size_mm = $6, paper = $7,
         notes = $8, updated_by = $9, updated_at = NOW()`,
      [req.tenant.id, t, anchor, x, y, size, paper, notes, req.staff.id]);
    await logActivity(req, { action: 'print_spec_updated', targetType: 'print_spec', targetId: t,
      detail: { anchor, x_mm: x, y_mm: y, size_mm: size, paper } });
    res.json({ spec: (await loadSpecs(req.tenant.id))[t] });
  } catch (e) { sendErr(res, e, 'Failed to save the print spec.'); }
});

// One-page spec sheet the vendor keeps with the job
function specSheet(tenant, docType, spec, out) {
  const mm = v => v * 72 / 25.4;
  const doc = new PDFDocument({ size: 'A4', margin: mm(18), info: { Title: `QR placement: ${tenant.name}, ${docType}` } });
  doc.pipe(out);
  doc.fillColor('#1A3A5C').font('Helvetica-Bold').fontSize(16).text('QR code placement specification');
  doc.moveDown(0.2).font('Helvetica').fontSize(10).fillColor('#444')
    .text(`${tenant.name}  ·  ${docType}  ·  generated ${new Date().toISOString().slice(0, 10)}`);
  doc.moveDown(1);

  // Diagram: the paper scaled into a box, with the QR square in place
  const [pw, ph] = PAPERS[spec.paper] || PAPERS.A4;
  const boxH = mm(110), scale = boxH / mm(ph), boxW = mm(pw) * scale;
  const ox = doc.page.margins.left, oy = doc.y;
  doc.lineWidth(1).strokeColor('#1A3A5C').rect(ox, oy, boxW, boxH).stroke();
  const s = mm(spec.size_mm) * scale;
  const left = spec.anchor.endsWith('left') ? mm(spec.x_mm) * scale : boxW - mm(spec.x_mm) * scale - s;
  const top  = spec.anchor.startsWith('top') ? mm(spec.y_mm) * scale : boxH - mm(spec.y_mm) * scale - s;
  doc.rect(ox + left, oy + top, s, s).fillAndStroke('#C9A84C', '#1A3A5C');
  doc.fillColor('#1A3A5C').fontSize(8).text('QR', ox + left, oy + top + s / 2 - 4, { width: s, align: 'center' });
  doc.fillColor('#666').fontSize(8).text(`${spec.paper} ${pw} x ${ph} mm`, ox, oy + boxH + 4, { width: boxW, align: 'center' });

  const tx = ox + boxW + mm(10), tw = doc.page.width - doc.page.margins.right - tx;
  const corner = spec.anchor.replace('-', ' ');
  const rows = [
    ['Paper', `${spec.paper} (${pw} x ${ph} mm), portrait`],
    ['Corner', corner],
    ['From the side edge', `${spec.x_mm} mm`],
    [spec.anchor.startsWith('top') ? 'From the top edge' : 'From the bottom edge', `${spec.y_mm} mm`],
    ['QR size', `${spec.size_mm} x ${spec.size_mm} mm, including the white border`],
    ['Smallest dot', `about ${spec.module_mm} mm`],
    ['Files', 'One SVG (preferred) and one 600 dpi PNG per document'],
  ];
  let y = oy;
  for (const [k, v] of rows) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1A3A5C').text(k, tx, y, { width: tw });
    doc.font('Helvetica').fontSize(10).fillColor('#222').text(v, tx, doc.y, { width: tw });
    y = doc.y + 6;
  }

  doc.x = ox; doc.y = Math.max(oy + boxH + 24, y + 10);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#1A3A5C').text('Printing rules', ox, doc.y, { width: doc.page.width - ox * 2 });
  doc.moveDown(0.3).font('Helvetica').fontSize(10).fillColor('#222');
  const rules = [
    'Each QR belongs to one document. Match it to the right graduate using manifest.csv (doc_id and matric number). Never reuse a code on another sheet.',
    'Print the SVG where your workflow allows it. Otherwise print the PNG at 600 dpi (300 dpi minimum). Don\'t resample, sharpen or compress it.',
    'Print in solid black (K only) on a white or very light, uncoated area. No foil, varnish, lamination, embossing or guilloche over the code.',
    'Keep the white border that is part of the image. Don\'t crop it, stretch it or place anything inside it.',
    `Size tolerance is plus or minus 1 mm. Never print it smaller than ${spec.size_mm} mm.`,
    'Before dispatch, scan a sample from every sheet run with a phone camera. Each scan must open the institution\'s verification page.',
    'The pack contains personal data. Keep it on the job machine only and delete it when the job is delivered.',
  ];
  rules.forEach((r, i) => doc.text(`${i + 1}. ${r}`, { paragraphGap: 4 }));
  if (spec.notes) { doc.moveDown(0.5).font('Helvetica-Bold').text('Notes from the institution'); doc.font('Helvetica').text(spec.notes); }
  doc.end();
}

router.get('/specs/:docType/sheet.pdf', PRINTERS, async (req, res) => {
  try {
    const t = req.params.docType;
    if (!DOC_TYPES.includes(t)) throw bad(404, 'Unknown document type.');
    const spec = (await loadSpecs(req.tenant.id))[t];
    spec.module_mm = moduleMm(spec.size_mm, sampleUrl(req.tenant));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="qr-spec-${t.toLowerCase()}.pdf"`);
    specSheet(req.tenant, t, spec, res);
  } catch (e) { sendErr(res, e, 'Failed to build the spec sheet.'); }
});

// ── Print jobs ───────────────────────────────────────────────────────────────
router.get('/jobs', PRINTERS, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT b.id, b.file_name, b.doc_type, b.issued_count, b.issued_at,
              (SELECT MAX(created_at) FROM activity_log a
                WHERE a.tenant_id = b.tenant_id AND a.action = 'print_pack_downloaded' AND a.target_id = b.id::text) AS last_pack_at
       FROM batches b WHERE b.tenant_id = $1 AND b.status = 'issued'
       ORDER BY b.issued_at DESC LIMIT 100`, [req.tenant.id]);
    res.json({ jobs: r.rows });
  } catch (e) { sendErr(res, e, 'Failed to load print jobs.'); }
});

router.get('/jobs/:id/pack.zip', PRINTERS, async (req, res) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw bad(404, 'Print job not found.');
    const b = (await pool.query(`SELECT * FROM batches WHERE id = $1 AND tenant_id = $2 AND status = 'issued'`,
      [req.params.id, req.tenant.id])).rows[0];
    if (!b) throw bad(404, 'Print job not found.');
    // Revoked or replaced documents are left out: nothing should be printed for them
    const docs = (await pool.query(
      `SELECT d.*, br.row_no FROM documents d JOIN batch_rows br ON br.doc_id = d.doc_id AND br.batch_id = $2
       WHERE d.tenant_id = $1 AND d.status = 'active' ORDER BY br.row_no`, [req.tenant.id, b.id])).rows;
    const spec = (await loadSpecs(req.tenant.id))[b.doc_type] || { ...DEFAULT_SPEC };
    spec.module_mm = moduleMm(spec.size_mm, sampleUrl(req.tenant));
    const px = Math.round(spec.size_mm / 25.4 * DPI);
    await logActivity(req, { action: 'print_pack_downloaded', targetType: 'batch', targetId: b.id, detail: { count: docs.length } });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="print-pack-${req.tenant.short_code || 'job'}-${b.id.slice(0, 8)}.zip"`);
    res.setHeader('Cache-Control', 'no-store');
    const zip = createZip(res);
    const manifest = [['row', 'doc_id', 'full_name', 'matric_number', 'doc_type', 'title', 'qr_svg', 'qr_png',
      'paper', 'corner', 'x_mm', 'y_mm', 'size_mm', 'verify_url']];
    for (const d of docs) {
      const url = await buildVerifyUrl(d, req.tenant.subdomain);
      const base = `qr/${String(d.row_no).padStart(4, '0')}-${d.doc_id}`;
      zip.add(base + '.svg', await QRCode.toString(url, { ...QR_OPTS, type: 'svg' }));
      zip.add(base + '.png', await QRCode.toBuffer(url, { ...QR_OPTS, type: 'png', width: px }));
      manifest.push([d.row_no, d.doc_id, d.issued_to, d.metadata?.matric_number || '', d.doc_type, d.title,
        base + '.svg', base + '.png', spec.paper, spec.anchor, spec.x_mm, spec.y_mm, spec.size_mm, url]);
    }
    zip.add('manifest.csv', '﻿' + toCsv(manifest));
    const chunks = [];
    await new Promise((resolve, reject) => {
      const { Writable } = require('stream');
      const sink = new Writable({ write(c, _e, cb) { chunks.push(c); cb(); } });
      sink.on('finish', resolve); sink.on('error', reject);
      specSheet(req.tenant, b.doc_type, spec, sink);
    });
    zip.add('placement-spec.pdf', Buffer.concat(chunks));
    zip.add('README.txt', [
      `Print pack for ${req.tenant.name}, ${b.doc_type}, ${docs.length} document(s).`,
      '',
      'qr/            one SVG and one 600 dpi PNG per document, named <row>-<doc_id>',
      'manifest.csv   which QR goes on which graduate\'s document, and where',
      'placement-spec.pdf  position, size and printing rules',
      '',
      'Revoked or replaced documents are not included. Delete this pack once the job is delivered.',
    ].join('\r\n'));
    zip.end();
  } catch (e) {
    if (!res.headersSent) sendErr(res, e, 'Failed to build the print pack.');
    else { console.error('Print pack error:', e); res.destroy(e); }
  }
});

module.exports = router;
module.exports.loadSpecs = loadSpecs;
