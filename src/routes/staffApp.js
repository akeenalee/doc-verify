// /app-api: the staff app API. Every route is tenant-scoped and role-checked.
//   owner     everything
//   officer   issue, revoke, reissue, search, logs, documents
//   approver  same as officer for now (approval queue arrives in Phase 3)
//   auditor   read only: dashboard, documents, search, scans, activity

const express = require('express');
const router  = express.Router();
const QRCode  = require('qrcode');
const pool    = require('../db/pool');
const { requireStaff, ROLES } = require('../middleware/staffAuth');
const { logActivity } = require('../utils/activity');
const { createInvite, refreshInvite } = require('../utils/staffInvite');
const { generateDocId, buildVerifyUrl, generateQRBuffer, tenantBaseUrl } = require('../utils/docUtils');
const { issueClaimCode, CLAIM_DAYS } = require('../utils/claims');
const { activeKey } = require('../utils/signing');
const { registrationCheck, markIssued } = require('../utils/studentRecords');
const { generatePDF } = require('../utils/pdfGenerator');

const ANY     = requireStaff();
const ISSUERS = requireStaff('owner', 'officer', 'approver');
const OWNER   = requireStaff('owner');
const OVERSIGHT = requireStaff('owner', 'auditor');

const DOC_TYPES = [
  'Certificate', 'Transcript', 'Statement of Results', 'Diploma', 'Completion',
  'Admission', 'Attestation', 'Clearance Certificate', 'Professional Licence',
];
const REVOKE_REASONS = {
  issued_in_error:          'Issued in error',
  fraud:                    'Fraud or misrepresentation',
  withdrawn_by_institution: 'Withdrawn by the institution',
  other:                    'Other',
};
const RESTORE_DAYS = 7;
const STATUSES = ['active', 'revoked', 'superseded', 'expired'];

const clean = (v, max = 255) => (v === undefined || v === null) ? '' : String(v).trim().slice(0, max);
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');

// ── Helpers ─────────────────────────────────────────────────────────────────
function documentInput(body, tenant) {
  const doc_type = clean(body.doc_type, 100);
  const title    = clean(body.title);
  const issued_to = clean(body.issued_to);
  const matric   = clean(body.matric_number, 50).toUpperCase();
  const errors = [];
  if (!DOC_TYPES.includes(doc_type)) errors.push('Pick a document type.');
  if (!title)     errors.push('Document title is required.');
  if (!issued_to) errors.push('Graduate name is required.');
  if (!matric)    errors.push('Matric number is required.');
  if (body.expiry_date && !isDate(body.expiry_date)) errors.push('Expiry date must be YYYY-MM-DD.');
  if (errors.length) return { errors };

  const meta = {
    matric_number:   matric,
    institution_type: tenant.institution_type === 'government' ? 'government' : 'academic',
    programme:       clean(body.programme, 200),
    course:          clean(body.programme, 200),
    faculty:         clean(body.faculty, 200),
    department:      clean(body.department, 200),
    degree_class:    clean(body.degree_class, 100),
    class:           clean(body.degree_class, 100),
    graduation_year: clean(body.graduation_year, 4),
    entry_year:      clean(body.entry_year, 4),
  };
  for (const k of Object.keys(meta)) if (!meta[k]) delete meta[k];

  return {
    values: {
      doc_type, title, issued_to,
      issued_by:   tenant.name,
      expiry_date: body.expiry_date || null,
      metadata:    meta,
    },
  };
}

async function insertDocument(client, tenant, staff, v, replacesDocId = null, batchId = null) {
  await activeKey(tenant.id); // the school's signing key exists before its first document
  const docId = generateDocId(tenant.short_code || 'DOC');
  const cols = ['doc_id', 'title', 'issued_to', 'issued_by', 'doc_type', 'expiry_date', 'metadata', 'tenant_id', 'issued_by_user', 'replaces_doc_id'];
  const vals = [docId, v.title, v.issued_to, v.issued_by, v.doc_type, v.expiry_date,
     JSON.stringify(v.metadata), tenant.id, staff.id, replacesDocId];
  // batch_id arrives with migration 006; single issues never touch it
  if (batchId) { cols.push('batch_id'); vals.push(batchId); }
  const r = await client.query(
    `INSERT INTO documents (${cols.join(', ')})
     VALUES (${vals.map((_, i) => '$' + (i + 1)).join(',')})
     RETURNING *`, vals);
  return r.rows[0];
}

async function loadDoc(tenantId, docId) {
  const r = await pool.query('SELECT * FROM documents WHERE doc_id = $1 AND tenant_id = $2', [docId, tenantId]);
  return r.rows[0] || null;
}

// The tenant's own origin as the browser reached it (correct locally and on Render)
const origin = req => `${req.protocol}://${req.get('host')}`;

function sendErr(res, e, fallback) {
  if (e && e.status) return res.status(e.status).json({ error: e.message });
  console.error(fallback, e);
  return res.status(500).json({ error: fallback });
}

// ── Reference data ──────────────────────────────────────────────────────────
router.get('/meta', requireStaff(...ROLES), (req, res) => {
  res.json({ doc_types: DOC_TYPES, revoke_reasons: REVOKE_REASONS, roles: ROLES, restore_days: RESTORE_DAYS, claim_days: CLAIM_DAYS });
});

// ── Dashboard ───────────────────────────────────────────────────────────────
router.get('/dashboard', ANY, async (req, res) => {
  const t = req.tenant.id;
  try {
    const [docs, scans, recent] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'active')                                         AS active,
           COUNT(*) FILTER (WHERE status = 'revoked')                                        AS revoked,
           COUNT(*) FILTER (WHERE status = 'superseded')                                     AS superseded,
           COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW()))                  AS issued_month,
           COUNT(*)                                                                          AS total
         FROM documents WHERE tenant_id = $1`, [t]),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE verified_at >= date_trunc('month', NOW()))                 AS month,
           COUNT(*) FILTER (WHERE verified_at >= date_trunc('day', NOW()))                   AS today,
           COUNT(*) FILTER (WHERE result = 'tampered' AND verified_at >= NOW() - INTERVAL '30 days') AS tampered_30d,
           COUNT(*) FILTER (WHERE payment_method = 'employer_payment' AND verified_at >= date_trunc('month', NOW())) AS paid_month,
           COUNT(*) FILTER (WHERE payment_method = 'student_token' AND verified_at >= date_trunc('month', NOW()))    AS token_month
         FROM verification_log WHERE tenant_id = $1`, [t]),
      pool.query(
        `SELECT vl.doc_id, vl.verified_at, vl.result, vl.payment_method,
                COALESCE(vl.geo_location, 'Unknown') AS location, d.issued_to, d.doc_type
         FROM verification_log vl
         LEFT JOIN documents d ON d.doc_id = vl.doc_id AND d.tenant_id = vl.tenant_id
         WHERE vl.tenant_id = $1 ORDER BY vl.verified_at DESC LIMIT 8`, [t]),
    ]);
    const alerts = await pool.query(
      'SELECT COUNT(*)::int AS n FROM scan_alerts WHERE tenant_id = $1 AND acknowledged_at IS NULL', [t]);
    res.json({ documents: docs.rows[0], scans: scans.rows[0], recent_scans: recent.rows, open_alerts: alerts.rows[0].n });
  } catch (e) { sendErr(res, e, 'Failed to load dashboard.'); }
});

// ── Scan alerts ─────────────────────────────────────────────────────────────
router.get('/alerts', ANY, async (req, res) => {
  try {
    const open = req.query.status !== 'all';
    const r = await pool.query(
      `SELECT a.id, a.doc_id, a.kind, a.detail, a.created_at, a.acknowledged_at, a.note,
              u.email AS acknowledged_by, d.issued_to, d.doc_type, d.status AS doc_status,
              (SELECT COUNT(*)::int FROM verification_log v WHERE v.doc_id = a.doc_id
                 AND v.verified_at > NOW() - interval '24 hours') AS scans_24h
       FROM scan_alerts a
       LEFT JOIN tenant_users u ON u.id = a.acknowledged_by
       LEFT JOIN documents d ON d.doc_id = a.doc_id AND d.tenant_id = a.tenant_id
       WHERE a.tenant_id = $1 ${open ? 'AND a.acknowledged_at IS NULL' : ''}
       ORDER BY a.created_at DESC LIMIT 200`, [req.tenant.id]);
    res.json({ alerts: r.rows });
  } catch (e) { sendErr(res, e, 'Failed to load alerts.'); }
});

router.post('/alerts/:id/acknowledge', ANY, async (req, res) => {
  try {
    const note = clean(req.body.note, 500);
    if (!note) return res.status(400).json({ error: 'Say what you checked or did.' });
    const r = await pool.query(
      `UPDATE scan_alerts SET acknowledged_at = NOW(), acknowledged_by = $3, note = $4
       WHERE id = $1 AND tenant_id = $2 AND acknowledged_at IS NULL RETURNING doc_id, kind`,
      [String(req.params.id).replace(/\D/g, '') || 0, req.tenant.id, req.staff.id, note]);
    if (!r.rows.length) return res.status(404).json({ error: 'Alert not found or already handled.' });
    await logActivity(req, { action: 'scan_alert_acknowledged', targetType: 'document', targetId: r.rows[0].doc_id,
      detail: { kind: r.rows[0].kind, note } });
    res.json({ ok: true });
  } catch (e) { sendErr(res, e, 'Failed to update the alert.'); }
});

// ── Documents ───────────────────────────────────────────────────────────────
router.get('/documents', ANY, async (req, res) => {
  const t      = req.tenant.id;
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 25);
  const where  = ['d.tenant_id = $1'];
  const params = [t];
  if (STATUSES.includes(req.query.status)) { params.push(req.query.status); where.push(`d.status = $${params.length}`); }
  if (DOC_TYPES.includes(req.query.type))  { params.push(req.query.type);   where.push(`d.doc_type = $${params.length}`); }
  if (isDate(req.query.from)) { params.push(req.query.from); where.push(`d.issue_date >= $${params.length}`); }
  if (isDate(req.query.to))   { params.push(req.query.to);   where.push(`d.issue_date <= $${params.length}`); }
  const w = where.join(' AND ');
  try {
    const list = await pool.query(
      `SELECT d.doc_id, d.title, d.issued_to, d.doc_type, d.issue_date, d.expiry_date, d.status,
              d.metadata->>'matric_number' AS matric_number, d.created_at,
              (SELECT COUNT(*) FROM verification_log vl WHERE vl.doc_id = d.doc_id AND vl.tenant_id = d.tenant_id) AS scans
       FROM documents d WHERE ${w}
       ORDER BY d.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]
    );
    const count = await pool.query(`SELECT COUNT(*) FROM documents d WHERE ${w}`, params);
    res.json({ data: list.rows, page, limit, total: parseInt(count.rows[0].count) });
  } catch (e) { sendErr(res, e, 'Failed to load documents.'); }
});

router.get('/documents/:docId', ANY, async (req, res) => {
  const t = req.tenant.id;
  try {
    const doc = await loadDoc(t, req.params.docId);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });
    const [scans, history, people] = await Promise.all([
      pool.query(
        `SELECT verified_at, result, payment_method, COALESCE(geo_location, 'Unknown') AS location
         FROM verification_log WHERE tenant_id = $1 AND doc_id = $2
         ORDER BY verified_at DESC LIMIT 50`, [t, doc.doc_id]),
      pool.query(
        `SELECT created_at, actor, action, detail FROM activity_log
         WHERE tenant_id = $1 AND target_type = 'document' AND target_id = $2
         ORDER BY created_at DESC LIMIT 50`, [t, doc.doc_id]),
      pool.query(
        `SELECT id, email, full_name FROM tenant_users WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [t, [doc.issued_by_user, doc.revoked_by].filter(Boolean)]),
    ]);
    const who = id => people.rows.find(p => p.id === id) || null;
    const revokedAt = doc.revoked_at ? new Date(doc.revoked_at) : null;
    res.json({
      document: doc,
      issued_by_user: who(doc.issued_by_user),
      revoked_by_user: who(doc.revoked_by),
      verify_url: await buildVerifyUrl(doc, req.tenant.subdomain),
      can_restore: doc.status === 'revoked' && !doc.superseded_by && revokedAt &&
                   (Date.now() - revokedAt.getTime()) < RESTORE_DAYS * 864e5,
      scans: scans.rows,
      history: history.rows,
    });
  } catch (e) { sendErr(res, e, 'Failed to load document.'); }
});

router.post('/documents', ISSUERS, async (req, res) => {
  const input = documentInput(req.body, req.tenant);
  if (input.errors) return res.status(400).json({ error: input.errors.join(' ') });
  const client = await pool.connect();
  try {
    const v = input.values;
    const check = await registrationCheck(req.tenant.id, v.doc_type, v.metadata.matric_number, v.issued_to);
    if (check.errors.length) return res.status(422).json({ error: check.errors.join(' '), warnings: check.warnings });
    const doc = await insertDocument(client, req.tenant, req.staff, v);
    await markIssued(pool, req.tenant.id, [v.metadata.matric_number]);
    await logActivity(req, { action: 'document_issued', targetType: 'document', targetId: doc.doc_id,
      detail: { doc_type: doc.doc_type, matric_number: v.metadata.matric_number, record_source: check.source,
                warnings: check.warnings.length ? check.warnings : undefined } });
    res.status(201).json({ document: doc, verify_url: await buildVerifyUrl(doc, req.tenant.subdomain),
                           record_source: check.source, warnings: check.warnings });
  } catch (e) { sendErr(res, e, 'Failed to issue document.'); }
  finally { client.release(); }
});

router.post('/documents/:docId/revoke', ISSUERS, async (req, res) => {
  const reason = String(req.body.reason || '');
  const note   = clean(req.body.note, 500);
  if (!REVOKE_REASONS[reason]) return res.status(400).json({ error: 'Pick a reason for revoking.' });
  if (reason === 'other' && !note) return res.status(400).json({ error: 'Add a note when the reason is Other.' });
  try {
    const r = await pool.query(
      `UPDATE documents SET status = 'revoked', revoked_at = NOW(), revoked_reason = $3,
              revoked_by = $4, updated_at = NOW()
       WHERE doc_id = $1 AND tenant_id = $2 AND status = 'active'
       RETURNING *`,
      [req.params.docId, req.tenant.id, reason, req.staff.id]
    );
    if (!r.rows.length) return res.status(409).json({ error: 'Only an active document can be revoked.' });
    await logActivity(req, { action: 'document_revoked', targetType: 'document', targetId: req.params.docId,
      detail: { reason, note } });
    res.json({ document: r.rows[0] });
  } catch (e) { sendErr(res, e, 'Failed to revoke document.'); }
});

router.post('/documents/:docId/restore', OWNER, async (req, res) => {
  const note = clean(req.body.note, 500);
  if (!note) return res.status(400).json({ error: 'Say why the document is being restored.' });
  try {
    const r = await pool.query(
      `UPDATE documents SET status = 'active', revoked_at = NULL, revoked_reason = NULL,
              revoked_by = NULL, updated_at = NOW()
       WHERE doc_id = $1 AND tenant_id = $2 AND status = 'revoked' AND superseded_by IS NULL
         AND revoked_at > NOW() - ($3 || ' days')::interval
       RETURNING *`,
      [req.params.docId, req.tenant.id, String(RESTORE_DAYS)]
    );
    if (!r.rows.length) return res.status(409).json({ error: `Only a document revoked in the last ${RESTORE_DAYS} days can be restored.` });
    await logActivity(req, { action: 'document_restored', targetType: 'document', targetId: req.params.docId, detail: { note } });
    res.json({ document: r.rows[0] });
  } catch (e) { sendErr(res, e, 'Failed to restore document.'); }
});

router.post('/documents/:docId/reissue', ISSUERS, async (req, res) => {
  const note = clean(req.body.note, 500);
  if (!note) return res.status(400).json({ error: 'Say what was corrected.' });
  const input = documentInput(req.body, req.tenant);
  if (input.errors) return res.status(400).json({ error: input.errors.join(' ') });
  let check;
  try {
    const v = input.values;
    check = await registrationCheck(req.tenant.id, v.doc_type, v.metadata.matric_number, v.issued_to);
  } catch (e) { return sendErr(res, e, 'Failed to check student records.'); }
  if (check.errors.length) return res.status(422).json({ error: check.errors.join(' '), warnings: check.warnings });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const old = await client.query(
      `SELECT doc_id, status FROM documents WHERE doc_id = $1 AND tenant_id = $2 FOR UPDATE`,
      [req.params.docId, req.tenant.id]);
    if (!old.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Document not found.' }); }
    if (!['active', 'revoked'].includes(old.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This document has already been replaced.' });
    }
    const doc = await insertDocument(client, req.tenant, req.staff, input.values, req.params.docId);
    await client.query(
      `UPDATE documents SET status = 'superseded', superseded_by = $3, updated_at = NOW()
       WHERE doc_id = $1 AND tenant_id = $2`,
      [req.params.docId, req.tenant.id, doc.doc_id]);
    await client.query('COMMIT');
    await logActivity(req, { action: 'document_superseded', targetType: 'document', targetId: req.params.docId,
      detail: { replaced_by: doc.doc_id, note } });
    await markIssued(pool, req.tenant.id, [input.values.metadata.matric_number]);
    await logActivity(req, { action: 'document_reissued', targetType: 'document', targetId: doc.doc_id,
      detail: { replaces: req.params.docId, note, record_source: check.source } });
    res.status(201).json({ document: doc, verify_url: await buildVerifyUrl(doc, req.tenant.subdomain),
                           record_source: check.source, warnings: check.warnings });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    sendErr(res, e, 'Failed to reissue document.');
  } finally { client.release(); }
});

router.get('/documents/:docId/pdf', ISSUERS, async (req, res) => {
  try {
    const doc = await loadDoc(req.tenant.id, req.params.docId);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });
    await logActivity(req, { action: 'pdf_downloaded', targetType: 'document', targetId: doc.doc_id });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${doc.doc_id}.pdf"`);
    await generatePDF(doc, res);
  } catch (e) { if (!res.headersSent) sendErr(res, e, 'Failed to generate PDF.'); }
});

// ?size=print gives a 1200 px PNG (about 4 inches at 300 dpi)
router.get('/documents/:docId/qr', ISSUERS, async (req, res) => {
  try {
    const doc = await loadDoc(req.tenant.id, req.params.docId);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });
    if (req.query.format === 'svg') {
      const svg = await QRCode.toString(await buildVerifyUrl(doc, req.tenant.subdomain), { type: 'svg', errorCorrectionLevel: 'H', margin: 4 });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Content-Disposition', `attachment; filename="qr-${doc.doc_id}.svg"`);
      return res.send(svg);
    }
    let buffer;
    if (req.query.size === 'print') {
      buffer = await QRCode.toBuffer(await buildVerifyUrl(doc, req.tenant.subdomain),
        { type: 'png', errorCorrectionLevel: 'H', margin: 4, width: 1200 });
    } else {
      ({ buffer } = await generateQRBuffer(doc, req.tenant));
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="qr-${doc.doc_id}${req.query.size === 'print' ? '-print' : ''}.png"`);
    res.send(buffer);
  } catch (e) { sendErr(res, e, 'Failed to generate QR code.'); }
});

// Graduate claim code: shown once, handed to the graduate with the document.
// The portal won't link this matric number to an account without it. A new
// code voids the previous unused one.
router.post('/documents/:docId/claim-code', ISSUERS, async (req, res) => {
  try {
    const doc = await loadDoc(req.tenant.id, req.params.docId);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });
    const matric = doc.metadata?.matric_number;
    if (!matric) return res.status(400).json({ error: 'This document has no matric number, so there is nothing for a graduate to claim.' });
    if (doc.status !== 'active') return res.status(409).json({ error: 'Claim codes are only for active documents.' });
    const { code, expires_at } = await issueClaimCode(pool, req.tenant.id, matric, req.staff.id);
    await logActivity(req, { action: 'claim_code_issued', targetType: 'document', targetId: doc.doc_id,
      detail: { matric_number: matric } });
    res.status(201).json({ code, expires_at, matric_number: matric, holder: doc.issued_to,
      portal_url: `${tenantBaseUrl(req.tenant.subdomain)}/student.html` });
  } catch (e) { sendErr(res, e, 'Failed to create a claim code.'); }
});

// ── Registrar search (staff only; never exposed publicly) ───────────────────
router.get('/search', ANY, async (req, res) => {
  const q = clean(req.query.q, 100);
  if (q.length < 3) return res.status(400).json({ error: 'Type at least 3 characters.' });
  try {
    const r = await pool.query(
      `SELECT doc_id, title, issued_to, doc_type, issue_date, status, metadata->>'matric_number' AS matric_number
       FROM documents
       WHERE tenant_id = $1 AND (doc_id ILIKE $2 OR issued_to ILIKE $2 OR metadata->>'matric_number' ILIKE $2)
       ORDER BY issue_date DESC, created_at DESC LIMIT 50`,
      [req.tenant.id, `%${q.replace(/[%_\\]/g, m => '\\' + m)}%`]
    );
    await logActivity(req, { action: 'search', detail: { q, results: r.rows.length } });
    res.json({ results: r.rows });
  } catch (e) { sendErr(res, e, 'Search failed.'); }
});

// ── Verification log ────────────────────────────────────────────────────────
router.get('/scans', ANY, async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 50);
  const where = ['vl.tenant_id = $1'];
  const params = [req.tenant.id];
  if (['found', 'not_found', 'revoked', 'superseded', 'tampered'].includes(req.query.result)) {
    params.push(req.query.result); where.push(`vl.result = $${params.length}`);
  }
  if (['none', 'student_token', 'employer_payment', 'replacement_pdf'].includes(req.query.payment)) {
    params.push(req.query.payment); where.push(`vl.payment_method = $${params.length}`);
  }
  if (isDate(req.query.from)) { params.push(req.query.from); where.push(`vl.verified_at >= $${params.length}::date`); }
  if (isDate(req.query.to))   { params.push(req.query.to);   where.push(`vl.verified_at < ($${params.length}::date + 1)`); }
  const w = where.join(' AND ');
  try {
    const r = await pool.query(
      `SELECT vl.id, vl.doc_id, vl.verified_at, vl.result, vl.payment_method, vl.user_agent,
              COALESCE(vl.geo_location, 'Unknown') AS location, d.issued_to, d.doc_type
       FROM verification_log vl
       LEFT JOIN documents d ON d.doc_id = vl.doc_id AND d.tenant_id = vl.tenant_id
       WHERE ${w} ORDER BY vl.verified_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]);
    const c = await pool.query(`SELECT COUNT(*) FROM verification_log vl WHERE ${w}`, params);
    res.json({ data: r.rows, page, limit, total: parseInt(c.rows[0].count) });
  } catch (e) { sendErr(res, e, 'Failed to load scans.'); }
});

// ── Staff activity log ──────────────────────────────────────────────────────
router.get('/activity', OVERSIGHT, async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 50);
  const where = ['tenant_id = $1'];
  const params = [req.tenant.id];
  if (req.query.action) { params.push(clean(req.query.action, 50)); where.push(`action = $${params.length}`); }
  if (req.query.actor)  { params.push(clean(req.query.actor, 200)); where.push(`actor = $${params.length}`); }
  const w = where.join(' AND ');
  try {
    const r = await pool.query(
      `SELECT id, created_at, actor, action, target_type, target_id, detail, ip_address
       FROM activity_log WHERE ${w} ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit]);
    const c = await pool.query(`SELECT COUNT(*) FROM activity_log WHERE ${w}`, params);
    res.json({ data: r.rows, page, limit, total: parseInt(c.rows[0].count) });
  } catch (e) { sendErr(res, e, 'Failed to load activity.'); }
});

// ── Users and roles (Owner) ─────────────────────────────────────────────────
function parseRoles(roles) {
  const list = Array.isArray(roles) ? [...new Set(roles.map(String))] : [];
  if (!list.length || !list.every(r => ROLES.includes(r))) return null;
  // A print vendor is an outside company: the role can't be mixed with staff roles
  if (list.includes('vendor') && list.length > 1) return null;
  return list;
}

async function activeOwnerCount(tenantId, excludingId) {
  const r = await pool.query(
    `SELECT COUNT(*) FROM tenant_users
     WHERE tenant_id = $1 AND status = 'active' AND 'owner' = ANY(roles) AND id <> $2`,
    [tenantId, excludingId]);
  return parseInt(r.rows[0].count);
}

router.get('/users', OWNER, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, email, full_name, roles, status, totp_enabled, last_login_at, invite_expires_at, created_at
       FROM tenant_users WHERE tenant_id = $1 ORDER BY created_at`, [req.tenant.id]);
    res.json({ users: r.rows });
  } catch (e) { sendErr(res, e, 'Failed to load users.'); }
});

router.post('/users', OWNER, async (req, res) => {
  const roles = parseRoles(req.body.roles);
  if (!roles) return res.status(400).json({ error: 'Pick at least one valid role. Print vendor can\'t be combined with other roles.' });
  try {
    const out = await createInvite(req.tenant, origin(req), { email: req.body.email, full_name: req.body.full_name,
      roles, invitedBy: req.staff.email });
    await logActivity(req, { action: 'user_invited', targetType: 'user', targetId: out.user.email, detail: { roles } });
    res.status(201).json(out);
  } catch (e) { sendErr(res, e, 'Failed to invite user.'); }
});

router.patch('/users/:id/roles', OWNER, async (req, res) => {
  const roles = parseRoles(req.body.roles);
  if (!roles) return res.status(400).json({ error: 'Pick at least one valid role. Print vendor can\'t be combined with other roles.' });
  try {
    if (!roles.includes('owner') && await activeOwnerCount(req.tenant.id, req.params.id) === 0)
      return res.status(409).json({ error: 'The institution must keep at least one active Owner.' });
    const r = await pool.query(
      `UPDATE tenant_users SET roles = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2
       RETURNING id, email, roles`, [req.params.id, req.tenant.id, roles]);
    if (!r.rows.length) return res.status(404).json({ error: 'User not found.' });
    await logActivity(req, { action: 'user_roles_changed', targetType: 'user', targetId: r.rows[0].email, detail: { roles } });
    res.json({ user: r.rows[0] });
  } catch (e) { sendErr(res, e, 'Failed to change roles.'); }
});

router.post('/users/:id/status', OWNER, async (req, res) => {
  const enable = req.body.enabled === true;
  if (!enable && req.params.id === req.staff.id) return res.status(409).json({ error: 'You can\'t disable your own account.' });
  try {
    if (!enable && await activeOwnerCount(req.tenant.id, req.params.id) === 0)
      return res.status(409).json({ error: 'The institution must keep at least one active Owner.' });
    const r = await pool.query(
      `UPDATE tenant_users
       SET status = CASE WHEN $3 THEN (CASE WHEN totp_enabled THEN 'active' ELSE 'invited' END) ELSE 'disabled' END,
           updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING id, email, status`,
      [req.params.id, req.tenant.id, enable]);
    if (!r.rows.length) return res.status(404).json({ error: 'User not found.' });
    await logActivity(req, { action: enable ? 'user_enabled' : 'user_disabled', targetType: 'user', targetId: r.rows[0].email });
    res.json({ user: r.rows[0] });
  } catch (e) { sendErr(res, e, 'Failed to update user.'); }
});

// New setup link: password and TOTP are set again. Covers a lost phone.
router.post('/users/:id/reset-access', OWNER, async (req, res) => {
  if (req.params.id === req.staff.id) return res.status(409).json({ error: 'Ask another Owner, or IL support, to reset your own access.' });
  try {
    const out = await refreshInvite(req.tenant, origin(req), req.params.id);
    await logActivity(req, { action: 'user_access_reset', targetType: 'user', targetId: out.user.email });
    res.json(out);
  } catch (e) { sendErr(res, e, 'Failed to reset access.'); }
});

module.exports = router;
module.exports.DOC_TYPES = DOC_TYPES;
module.exports.documentInput = documentInput;
module.exports.insertDocument = insertDocument;
