// src/routes/staffSettings.js
// Phase 2: tenant branding and signatories. Owner only; every change is
// written to the activity log. Mounted at /app-api/settings, which is the
// only path with a 1 MB JSON limit (images arrive as base64).
//
// Signatories are never edited in place. To change who signs, add a new one
// with a later start date (it takes over from that date) or retire the old
// one. Old documents regenerated later keep the signature valid on their
// issue date.

const express     = require('express');
const router      = express.Router();
const PDFDocument = require('pdfkit');
const pool        = require('../db/pool');
const { requireStaff } = require('../middleware/staffAuth');
const { logActivity }  = require('../utils/activity');
const { clearTenantCache } = require('../middleware/tenantResolver');
const { sniffImage, isoDate } = require('../utils/branding');
const { generatePDF } = require('../utils/pdfGenerator');
const { DOC_TYPES }   = require('./staffApp');
const { listKeys, rotateKey, activeKey, currentMasterRef } = require('../utils/signing');
const { FIELDS, disclosure } = require('../utils/disclosure');

const OWNER = requireStaff('owner');
const LOGO_MAX = 300 * 1024;
const SIG_MAX  = 200 * 1024;
const SLOT_LABEL = { 1: 'Left (usually Registrar)', 2: 'Middle (usually Vice-Chancellor)' };

const { cleanText } = require('../utils/text');
const clean  = (v, max = 200) => cleanText(v, max);
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !isNaN(new Date(v));
const today  = () => isoDate();

function bad(status, message) { const e = new Error(message); e.status = status; return e; }
function sendErr(res, e, fallback) {
  if (e && e.status) return res.status(e.status).json({ error: e.message });
  console.error(fallback, e);
  return res.status(500).json({ error: fallback });
}

// base64 (optionally a data: URL) to a checked PNG or JPEG buffer
function decodeImage(input, max, what) {
  const raw = String(input || '').replace(/^data:[^;,]+;base64,/, '');
  if (!raw) throw bad(400, `Choose a ${what} image.`);
  const buf = Buffer.from(raw, 'base64');
  if (buf.length > max) throw bad(413, `The ${what} image must be ${Math.round(max / 1024)} KB or smaller.`);
  const mime = sniffImage(buf);
  if (!mime) throw bad(415, `The ${what} image must be a PNG or JPEG file.`);
  // Make sure PDFKit can actually draw it before we store it
  try { new PDFDocument({ autoFirstPage: false }).openImage(buf); }
  catch (e) { throw bad(415, `That ${what} file looks damaged. Export it again as PNG or JPEG.`); }
  return { buf, mime };
}

// WCAG contrast against white: the sidebar and buttons put white text on the brand colour
function contrastWithWhite(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return 1.05 / (L + 0.05);
}

function signatoryStatus(s, on = today()) {
  const from = isoDate(s.effective_from), to = s.effective_to ? isoDate(s.effective_to) : null;
  if (from > on) return 'scheduled';
  if (to && to < on) return 'retired';
  return 'current';
}

function publicSignatory(s) {
  return {
    id: s.id, slot: s.slot, full_name: s.full_name, title: s.title, doc_types: s.doc_types || [],
    effective_from: isoDate(s.effective_from), effective_to: s.effective_to ? isoDate(s.effective_to) : null,
    created_by: s.created_by, created_at: s.created_at, status: signatoryStatus(s),
  };
}

// ── Branding ────────────────────────────────────────────────────────────────
router.get('/branding', OWNER, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT name, short_code, primary_colour, accent_colour, logo_mime, logo_updated_at,
              (logo_data IS NOT NULL) AS has_logo, octet_length(logo_data) AS logo_bytes
       FROM tenants WHERE id = $1`, [req.tenant.id]);
    const t = r.rows[0];
    res.json({
      name: t.name, short_code: t.short_code,
      primary_colour: t.primary_colour, accent_colour: t.accent_colour,
      logo: t.has_logo ? { mime: t.logo_mime, bytes: t.logo_bytes, updated_at: t.logo_updated_at,
                           version: new Date(t.logo_updated_at || 0).getTime() } : null,
      limits: { logo_kb: LOGO_MAX / 1024, signature_kb: SIG_MAX / 1024 },
    });
  } catch (e) { sendErr(res, e, 'Failed to load branding. Has migration 005 been run?'); }
});

router.post('/logo', OWNER, async (req, res) => {
  try {
    const { buf, mime } = decodeImage(req.body.image, LOGO_MAX, 'logo');
    await pool.query('UPDATE tenants SET logo_data = $2, logo_mime = $3, logo_updated_at = NOW() WHERE id = $1',
      [req.tenant.id, buf, mime]);
    await logActivity(req, { action: 'logo_updated', targetType: 'tenant', targetId: req.tenant.subdomain,
      detail: { mime, bytes: buf.length } });
    res.json({ success: true });
  } catch (e) { sendErr(res, e, 'Failed to save logo.'); }
});

router.delete('/logo', OWNER, async (req, res) => {
  try {
    await pool.query('UPDATE tenants SET logo_data = NULL, logo_mime = NULL, logo_updated_at = NOW() WHERE id = $1', [req.tenant.id]);
    await logActivity(req, { action: 'logo_removed', targetType: 'tenant', targetId: req.tenant.subdomain });
    res.json({ success: true });
  } catch (e) { sendErr(res, e, 'Failed to remove logo.'); }
});

router.patch('/colours', OWNER, async (req, res) => {
  try {
    const hex = v => /^#[0-9a-fA-F]{6}$/.test(v || '');
    const primary = clean(req.body.primary_colour, 7), accent = clean(req.body.accent_colour, 7);
    if (!hex(primary) || !hex(accent)) throw bad(400, 'Colours must be 6-digit hex values, like #1A3A5C.');
    if (contrastWithWhite(primary) < 4.5)
      throw bad(400, 'The main colour is too light for white text on top of it. Pick a darker shade.');
    const before = { primary_colour: req.tenant.primary_colour, accent_colour: req.tenant.accent_colour };
    await pool.query('UPDATE tenants SET primary_colour = $2, accent_colour = $3 WHERE id = $1',
      [req.tenant.id, primary.toUpperCase(), accent.toUpperCase()]);
    clearTenantCache(req.tenant.subdomain);
    await logActivity(req, { action: 'colours_updated', targetType: 'tenant', targetId: req.tenant.subdomain,
      detail: { before, after: { primary_colour: primary.toUpperCase(), accent_colour: accent.toUpperCase() } } });
    res.json({ success: true });
  } catch (e) { sendErr(res, e, 'Failed to save colours.'); }
});

// ── Workflow ────────────────────────────────────────────────────────────────
// Approval before a bulk batch is issued. Off by default.
router.get('/approval', OWNER, async (req, res) => {
  try {
    const r = await pool.query('SELECT approval_required FROM tenants WHERE id = $1', [req.tenant.id]);
    res.json({ approval_required: !!r.rows[0].approval_required });
  } catch (e) { sendErr(res, e, 'Failed to load setting. Has migration 006 been run?'); }
});

router.patch('/approval', OWNER, async (req, res) => {
  try {
    if (typeof req.body.approval_required !== 'boolean') throw bad(400, 'approval_required must be true or false.');
    const on = req.body.approval_required;
    if (on) {
      // Nobody approves their own batch, so it takes two active people, one of whom can approve
      const r = await pool.query(
        `SELECT COUNT(*) AS users,
                COUNT(*) FILTER (WHERE roles && ARRAY['owner','approver']::text[]) AS deciders
         FROM tenant_users WHERE tenant_id = $1 AND status = 'active' AND NOT ('vendor' = ANY(roles))`, [req.tenant.id]);
      if (parseInt(r.rows[0].users) < 2 || parseInt(r.rows[0].deciders) < 1)
        throw bad(409, 'Approval needs at least two active users, one of them an Owner or Approver, because nobody can approve their own batch. Invite someone first.');
    }
    await pool.query('UPDATE tenants SET approval_required = $2 WHERE id = $1', [req.tenant.id, on]);
    await logActivity(req, { action: on ? 'approval_enabled' : 'approval_disabled', targetType: 'tenant', targetId: req.tenant.subdomain });
    res.json({ approval_required: on });
  } catch (e) { sendErr(res, e, 'Failed to save setting.'); }
});

// ── Signatories ─────────────────────────────────────────────────────────────
router.get('/signatories', OWNER, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, slot, full_name, title, doc_types, effective_from, effective_to, created_by, created_at
       FROM signatories WHERE tenant_id = $1
       ORDER BY slot, effective_from DESC, created_at DESC`, [req.tenant.id]);
    res.json({ signatories: r.rows.map(publicSignatory), slots: SLOT_LABEL, doc_types: DOC_TYPES,
               limits: { signature_kb: SIG_MAX / 1024 } });
  } catch (e) { sendErr(res, e, 'Failed to load signatories. Has migration 005 been run?'); }
});

router.post('/signatories', OWNER, async (req, res) => {
  try {
    const b = req.body || {};
    const slot = Number(b.slot);
    const full_name = clean(b.full_name), title = clean(b.title);
    const doc_types = Array.isArray(b.doc_types) ? [...new Set(b.doc_types.map(String))] : [];
    const from = clean(b.effective_from, 10), to = clean(b.effective_to, 10) || null;
    if (![1, 2].includes(slot)) throw bad(400, 'Pick a signature position.');
    if (!full_name) throw bad(400, 'Full name is required.');
    if (!title) throw bad(400, 'Title is required, for example Registrar.');
    if (doc_types.some(t => !DOC_TYPES.includes(t))) throw bad(400, 'Unknown document type.');
    if (!isDate(from)) throw bad(400, 'Start date is required.');
    if (to && !isDate(to)) throw bad(400, 'End date must be a date.');
    if (to && to < from) throw bad(400, 'End date can\'t be before the start date.');
    const { buf, mime } = decodeImage(b.image, SIG_MAX, 'signature');

    const r = await pool.query(
      `INSERT INTO signatories (tenant_id, slot, full_name, title, doc_types, image_data, image_mime,
                                effective_from, effective_to, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, slot, full_name, title, doc_types, effective_from, effective_to, created_by, created_at`,
      [req.tenant.id, slot, full_name, title, doc_types, buf, mime, from, to, req.staff.email]);
    const s = publicSignatory(r.rows[0]);
    await logActivity(req, { action: 'signatory_added', targetType: 'signatory', targetId: s.id,
      detail: { slot, full_name, title, doc_types, effective_from: from, effective_to: to } });
    res.status(201).json({ signatory: s });
  } catch (e) { sendErr(res, e, 'Failed to add signatory.'); }
});

// The signature image itself: Owner only, never cached
router.get('/signatories/:id/image', OWNER, async (req, res) => {
  try {
    const r = await pool.query('SELECT image_data, image_mime FROM signatories WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenant.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Signatory not found.' });
    res.setHeader('Content-Type', r.rows[0].image_mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(r.rows[0].image_data);
  } catch (e) { res.status(404).json({ error: 'Signatory not found.' }); }
});

// Retire: last day this signature appears on new documents. Old documents keep it.
router.post('/signatories/:id/retire', OWNER, async (req, res) => {
  try {
    const on = clean(req.body.effective_to, 10) || today();
    if (!isDate(on)) throw bad(400, 'Last day must be a date.');
    const cur = await pool.query('SELECT * FROM signatories WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    const s = cur.rows[0];
    if (!s) throw bad(404, 'Signatory not found.');
    if (on < isoDate(s.effective_from))
      throw bad(400, 'The last day can\'t be before the start date. If this signature was never used, delete it instead.');
    const r = await pool.query(
      `UPDATE signatories SET effective_to = $3 WHERE id = $1 AND tenant_id = $2
       RETURNING id, slot, full_name, title, doc_types, effective_from, effective_to, created_by, created_at`,
      [s.id, req.tenant.id, on]);
    await logActivity(req, { action: 'signatory_retired', targetType: 'signatory', targetId: s.id,
      detail: { full_name: s.full_name, title: s.title, slot: s.slot,
                effective_to_before: s.effective_to ? isoDate(s.effective_to) : null, effective_to: on } });
    res.json({ signatory: publicSignatory(r.rows[0]) });
  } catch (e) { sendErr(res, e, 'Failed to retire signatory.'); }
});

// Delete only one that hasn't started, so no issued document can depend on it
router.delete('/signatories/:id', OWNER, async (req, res) => {
  try {
    const cur = await pool.query('SELECT * FROM signatories WHERE id = $1 AND tenant_id = $2', [req.params.id, req.tenant.id]);
    const s = cur.rows[0];
    if (!s) throw bad(404, 'Signatory not found.');
    if (isoDate(s.effective_from) <= today())
      throw bad(409, 'This signature is already in use on documents, so it can only be retired.');
    await pool.query('DELETE FROM signatories WHERE id = $1 AND tenant_id = $2', [s.id, req.tenant.id]);
    await logActivity(req, { action: 'signatory_deleted', targetType: 'signatory', targetId: s.id,
      detail: { full_name: s.full_name, title: s.title, slot: s.slot, effective_from: isoDate(s.effective_from) } });
    res.json({ success: true });
  } catch (e) { sendErr(res, e, 'Failed to delete signatory.'); }
});

// ── Preview ─────────────────────────────────────────────────────────────────
// A SPECIMEN document through the real generator, as of a chosen issue date.
// Nothing is stored; the QR points at an ID that doesn't exist.
// ── QR signing and graduate claims ──────────────────────────────────────────
async function securityState(t) {
  const [keys, flags, legacy] = await Promise.all([
    listKeys(t.id),
    pool.query('SELECT sig_strict, student_claim_required FROM tenants WHERE id = $1', [t.id]),
    // Documents issued before this school's first v2 key may have printed
    // copies with the older QR, which strict mode stops verifying
    pool.query(
      `SELECT COUNT(*)::int AS n FROM documents
       WHERE tenant_id = $1 AND status = 'active'
         AND created_at < COALESCE((SELECT MIN(created_at) FROM tenant_sign_keys WHERE tenant_id = $1), NOW())`,
      [t.id]),
  ]);
  return {
    keys: keys.map(k => ({ kid: k.kid, status: k.status, created_at: k.created_at, retired_at: k.retired_at,
                           protected_by: k.master_ref === 'SIGNING_MASTER_KEY' ? 'dedicated' : 'shared' })),
    sig_strict: flags.rows[0]?.sig_strict === true,
    student_claim_required: flags.rows[0]?.student_claim_required !== false,
    older_documents: legacy.rows[0].n,
    master: currentMasterRef() === 'SIGNING_MASTER_KEY' ? 'dedicated' : 'shared',
  };
}

// ── Payouts (read-only here; Innovation Lens sets them up) ──────────────────
router.get('/payout', OWNER, async (req, res) => {
  try {
    const { getPayout, publicView } = require('../utils/payouts');
    const t = req.tenant.id;
    // Last 30 days of successful payments for this school
    const r = await pool.query(
      `SELECT kind, COUNT(*)::int AS n, COALESCE(SUM(amount_kobo), 0)::bigint AS gross,
              COALESCE(SUM(platform_fee_kobo) FILTER (WHERE subaccount_code IS NOT NULL), 0)::bigint AS fee,
              COALESCE(SUM(amount_kobo) FILTER (WHERE subaccount_code IS NOT NULL), 0)::bigint AS split_gross
       FROM (
         SELECT 'holder' AS kind, amount_kobo, platform_fee_kobo, subaccount_code FROM token_purchases
          WHERE tenant_id = $1 AND paystack_status = 'success' AND created_at > NOW() - INTERVAL '30 days'
         UNION ALL
         SELECT 'verifier', v.amount_kobo, v.platform_fee_kobo, v.subaccount_code FROM verification_payments v
           JOIN documents d ON d.doc_id = v.doc_id
          WHERE d.tenant_id = $1 AND v.paystack_status = 'success' AND v.created_at > NOW() - INTERVAL '30 days'
       ) x GROUP BY kind`, [t]);
    const sum = { payments: 0, gross_kobo: 0, school_share_kobo: 0, platform_fee_kobo: 0, unsplit_kobo: 0, by_kind: {} };
    for (const row of r.rows) {
      const gross = Number(row.gross), fee = Number(row.fee), split = Number(row.split_gross);
      sum.payments += row.n; sum.gross_kobo += gross; sum.platform_fee_kobo += fee;
      sum.school_share_kobo += split - fee; sum.unsplit_kobo += gross - split;
      sum.by_kind[row.kind] = { payments: row.n, gross_kobo: gross };
    }
    res.json({ payout: publicView(await getPayout(t)), last_30_days: sum });
  } catch (e) { sendErr(res, e, 'Failed to load payouts.'); }
});

router.get('/security', OWNER, async (req, res) => {
  try {
    await activeKey(req.tenant.id); // makes key 1 on first visit
    res.json(await securityState(req.tenant));
  } catch (e) { sendErr(res, e, 'Failed to load security settings.'); }
});

router.post('/security/rotate-key', OWNER, async (req, res) => {
  try {
    const kid = await rotateKey(req.tenant.id);
    await logActivity(req, { action: 'signing_key_rotated', targetType: 'tenant', targetId: req.tenant.id, detail: { kid } });
    res.json(await securityState(req.tenant));
  } catch (e) { sendErr(res, e, 'Failed to rotate the key.'); }
});

router.patch('/security', OWNER, async (req, res) => {
  try {
    const sets = [], vals = [], log = [];
    if (typeof req.body.sig_strict === 'boolean') {
      vals.push(req.body.sig_strict); sets.push(`sig_strict = $${vals.length}`);
      log.push(req.body.sig_strict ? 'strict_mode_enabled' : 'strict_mode_disabled');
    }
    if (typeof req.body.student_claim_required === 'boolean') {
      vals.push(req.body.student_claim_required); sets.push(`student_claim_required = $${vals.length}`);
      log.push(req.body.student_claim_required ? 'claim_codes_required' : 'claim_codes_not_required');
    }
    if (!sets.length) throw bad(400, 'Nothing to change.');
    vals.push(req.tenant.id);
    await pool.query(`UPDATE tenants SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    for (const action of log) await logActivity(req, { action, targetType: 'tenant', targetId: req.tenant.id });
    res.json(await securityState(req.tenant));
  } catch (e) { sendErr(res, e, 'Failed to save.'); }
});

// ── What the public verify page shows ───────────────────────────────────────
router.get('/disclosure', OWNER, async (req, res) => {
  try {
    const r = await pool.query('SELECT disclosure FROM tenants WHERE id = $1', [req.tenant.id]);
    res.json({ disclosure: disclosure(r.rows[0]?.disclosure), fields: FIELDS });
  } catch (e) { sendErr(res, e, 'Failed to load.'); }
});

router.patch('/disclosure', OWNER, async (req, res) => {
  try {
    const body = req.body || {};
    const cur = disclosure((await pool.query('SELECT disclosure FROM tenants WHERE id = $1', [req.tenant.id])).rows[0]?.disclosure);
    const next = { ...cur };
    for (const k of Object.keys(FIELDS)) if (typeof body[k] === 'boolean') next[k] = body[k];
    const changed = Object.keys(FIELDS).filter(k => next[k] !== cur[k]);
    if (!changed.length) return res.json({ disclosure: cur, fields: FIELDS });
    await pool.query('UPDATE tenants SET disclosure = $2 WHERE id = $1', [req.tenant.id, JSON.stringify(next)]);
    await logActivity(req, { action: 'disclosure_updated', targetType: 'tenant', targetId: req.tenant.id,
      detail: { changes: changed.map(k => `${FIELDS[k].label}: ${next[k] ? 'shown' : 'hidden'}`) } });
    res.json({ disclosure: next, fields: FIELDS });
  } catch (e) { sendErr(res, e, 'Failed to save.'); }
});

router.get('/preview.pdf', OWNER, async (req, res) => {
  try {
    const type = DOC_TYPES.includes(req.query.type) ? req.query.type : 'Certificate';
    const date = isDate(req.query.date) ? req.query.date : today();
    const t = req.tenant;
    const doc = {
      doc_id: `${t.short_code || 'DOC'}-SPECIMEN`,
      title: type === 'Transcript' ? 'Academic Transcript' : 'Bachelor of Science (B.Sc.) Computer Science',
      issued_to: 'Specimen Graduate', issued_by: t.name, doc_type: type,
      issue_date: new Date(date + 'T12:00:00Z'), expiry_date: null, status: 'active', tenant_id: t.id,
      metadata: {
        matric_number: 'SPEC/0001', institution_type: t.institution_type === 'government' ? 'government' : 'academic',
        programme: 'Computer Science', course: 'Computer Science', faculty: 'Science', department: 'Computer Science',
        degree_class: 'Second Class Upper', class: 'Second Class Upper', graduation_year: date.slice(0, 4),
        entry_year: String(Number(date.slice(0, 4)) - 4),
      },
      _specimen: true,
    };
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="specimen-${type.toLowerCase().replace(/\s+/g, '-')}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    await generatePDF(doc, res);
  } catch (e) { if (!res.headersSent) sendErr(res, e, 'Failed to render preview.'); }
});

module.exports = router;
