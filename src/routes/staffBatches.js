// src/routes/staffBatches.js
// Phase 3: bulk issuing from a CSV class list, with an optional approval
// step (tenants.approval_required, off by default). Mounted at
// /app-api/batches. Statements are batched so a 1,000-row upload is a few
// round trips to the database, not thousands.
//
// Flow: upload (validated, stored as a draft) -> submit
//   approval off: submit issues at once
//   approval on:  submit -> pending_approval -> approve (issues) | reject
// A draft or pending batch can be cancelled. Rejected and cancelled batches
// are kept for the record; corrections are a new upload.

const express = require('express');
const router  = express.Router();
const { Writable } = require('stream');
const pool    = require('../db/pool');
const { requireStaff } = require('../middleware/staffAuth');
const { logActivity, clientIp } = require('../utils/activity');
const { parseCsv, toCsv } = require('../utils/csv');
const { createZip } = require('../utils/zip');
const { generateDocId, buildVerifyUrl, tenantBaseUrl } = require('../utils/docUtils');
const { issueClaimCode } = require('../utils/claims');
const { activeKey } = require('../utils/signing');
const { generatePDF } = require('../utils/pdfGenerator');
const { loadBrand } = require('../utils/branding');
const { DOC_TYPES, documentInput } = require('./staffApp');
const SR = require('../utils/studentRecords');

const ANY      = requireStaff();
const ISSUERS  = requireStaff('owner', 'officer', 'approver');
const DECIDERS = requireStaff('owner', 'approver');

const MAX_ROWS = 1000;
const CHUNK    = 500;

// Header aliases, matched after lower-casing and turning anything that isn't
// a letter or digit into _
const COLUMNS = {
  full_name:       ['full_name', 'name', 'graduate_name', 'student_name', 'issued_to', 'holder'],
  matric_number:   ['matric_number', 'matric', 'matric_no', 'matriculation_number', 'reg_no', 'registration_number'],
  title:           ['title', 'document_title', 'degree', 'award'],
  programme:       ['programme', 'program', 'course', 'course_of_study'],
  faculty:         ['faculty', 'school', 'college'],
  department:      ['department', 'dept'],
  degree_class:    ['degree_class', 'class', 'class_of_degree', 'classification'],
  graduation_year: ['graduation_year', 'year_of_graduation', 'grad_year'],
  entry_year:      ['entry_year', 'year_of_entry', 'admission_year'],
  expiry_date:     ['expiry_date', 'expires', 'expiry'],
};
const REQUIRED = ['full_name', 'matric_number', 'title'];
const TEMPLATE_HEADERS = ['full_name', 'matric_number', 'title', 'programme', 'faculty', 'department',
                          'degree_class', 'graduation_year', 'entry_year', 'expiry_date'];

const STATUS_LABEL = { draft: 'Draft', pending_approval: 'Awaiting approval', issued: 'Issued', rejected: 'Rejected', cancelled: 'Cancelled' };
const clean = (v, max = 255) => (v === undefined || v === null) ? '' : String(v).trim().slice(0, max);
const norm  = h => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function bad(status, message) { const e = new Error(message); e.status = status; return e; }
function sendErr(res, e, fallback) {
  if (e && e.status) return res.status(e.status).json({ error: e.message });
  console.error(fallback, e);
  return res.status(500).json({ error: fallback });
}

async function approvalRequired(tenantId) {
  try {
    const r = await pool.query('SELECT approval_required FROM tenants WHERE id = $1', [tenantId]);
    return !!(r.rows[0] && r.rows[0].approval_required);
  } catch (e) { return false; }
}

async function loadBatch(tenantId, id, client = pool, lock = false) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const r = await client.query(`SELECT * FROM batches WHERE id = $1 AND tenant_id = $2${lock ? ' FOR UPDATE' : ''}`, [id, tenantId]);
  return r.rows[0] || null;
}

// ── Parsing and validation ──────────────────────────────────────────────────
function mapHeaders(header) {
  const index = {}, unknown = [];
  header.forEach((h, i) => {
    const n = norm(h);
    const key = Object.keys(COLUMNS).find(k => COLUMNS[k].includes(n));
    if (key && index[key] === undefined) index[key] = i;
    else if (n) unknown.push(String(h).trim());
  });
  return { index, unknown };
}

async function validateRows(tenant, docType, records) {
  // records: [{ row_no, data }]
  const seen = new Map();
  const out = records.map(({ row_no, data }) => {
    const errors = [], warnings = [];
    const input = documentInput({ ...data, doc_type: docType, issued_to: data.full_name }, tenant);
    if (input.errors) errors.push(...input.errors.map(e => e.replace('Graduate name', 'Full name')));
    // A cell starting with a formula character is a spreadsheet artefact, not a name or title
    for (const [k, label] of [['full_name', 'Full name'], ['title', 'Title'], ['programme', 'Programme']])
      if (/^[=+@]/.test(data[k] || '')) errors.push(`${label} starts with "${data[k][0]}", which looks like a spreadsheet formula.`);
    for (const k of ['graduation_year', 'entry_year'])
      if (data[k] && !/^\d{4}$/.test(data[k])) errors.push(`${k === 'graduation_year' ? 'Graduation' : 'Entry'} year must be four digits.`);
    if (data.graduation_year && data.entry_year && /^\d{4}$/.test(data.graduation_year) && /^\d{4}$/.test(data.entry_year)
        && Number(data.graduation_year) < Number(data.entry_year)) errors.push('Graduation year is before entry year.');
    const matric = clean(data.matric_number, 50).toUpperCase();
    if (matric) {
      if (seen.has(matric)) errors.push(`Same matric number as row ${seen.get(matric)}.`);
      else seen.set(matric, row_no);
    }
    return { row_no, data, errors, warnings, matric };
  });

  // Holders who already have an active document of this type: a warning, not
  // a block (a second transcript copy is normal; a second certificate usually isn't)
  const matrics = [...seen.keys()];
  if (matrics.length) {
    const r = await pool.query(
      `SELECT doc_id, UPPER(metadata->>'matric_number') AS m FROM documents
       WHERE tenant_id = $1 AND doc_type = $2 AND status = 'active' AND UPPER(metadata->>'matric_number') = ANY($3)`,
      [tenant.id, docType, matrics]);
    const existing = new Map(r.rows.map(x => [x.m, x.doc_id]));
    for (const row of out) if (existing.has(row.matric) && !row.errors.length)
      row.warnings.push(`Already has an active ${docType}: ${existing.get(row.matric)}. Use Reissue if this one replaces it.`);
  }

  // Student records (SIS or uploaded list): is each one a registered student,
  // and does the name and status fit? The printed details then come from the record.
  const required = await SR.requireRegistered(tenant.id);
  if (matrics.length && (required || await SR.hasRecords(tenant.id))) {
    const found = await SR.lookupMany(tenant.id, matrics);
    for (const row of out) {
      if (!row.matric || row.errors.length) continue;
      const lk = found.get(SR.normMatric(row.matric));
      const v = SR.assess(lk, docType, row.data.full_name, required);
      row.errors.push(...v.errors);
      row.warnings.push(...v.warnings);
      if (lk && lk.found && !v.errors.length) {
        // The record is the authority: its details replace the file's
        const replaced = SR.lockRecord(row.data, lk.record);
        if (replaced.length) row.warnings.push(`Taken from student records instead of the file: ${replaced.map(f => f.replace(/_/g, ' ')).join(', ')}.`);
        row.data.record_source = lk.source;
      }
    }
  }
  return out;
}

// ── Issuing ─────────────────────────────────────────────────────────────────
// Inside the caller's transaction. Returns the number issued.
async function issueBatch(client, req, batch) {
  const rows = (await client.query(
    `SELECT row_no, data FROM batch_rows WHERE batch_id = $1 AND jsonb_array_length(errors) = 0 ORDER BY row_no`,
    [batch.id])).rows;
  const tenant = req.tenant;
  const prepared = [];
  for (const r of rows) {
    const input = documentInput({ ...r.data, doc_type: batch.doc_type, issued_to: r.data.full_name }, tenant);
    if (input.errors) throw bad(409, `Row ${r.row_no} no longer passes validation. Upload the file again.`);
    prepared.push({ row_no: r.row_no, ...input.values });
  }

  await activeKey(tenant.id); // the school's signing key exists before its first document
  const issued = [];
  for (let i = 0; i < prepared.length; i += CHUNK) {
    let pending = prepared.slice(i, i + CHUNK);
    // A clash on the random part of a document ID is rare; retry just those rows
    for (let attempt = 0; pending.length && attempt < 5; attempt++) {
      const withIds = pending.map(p => ({ ...p, doc_id: generateDocId(tenant.short_code || 'DOC') }));
      const r = await client.query(
        `INSERT INTO documents (doc_id, title, issued_to, issued_by, doc_type, expiry_date, metadata,
                                tenant_id, issued_by_user, batch_id)
         SELECT x.doc_id, x.title, x.issued_to, x.issued_by, x.doc_type, x.expiry_date, x.metadata, $2, $3, $4
         FROM jsonb_to_recordset($1::jsonb) AS x(doc_id text, title text, issued_to text, issued_by text,
                                                 doc_type text, expiry_date date, metadata jsonb)
         ON CONFLICT (doc_id) DO NOTHING
         RETURNING doc_id`,
        [JSON.stringify(withIds), tenant.id, batch.submitted_by || req.staff.id, batch.id]);
      const ok = new Set(r.rows.map(x => x.doc_id));
      issued.push(...withIds.filter(w => ok.has(w.doc_id)));
      pending = withIds.filter(w => !ok.has(w.doc_id)).map(({ doc_id, ...rest }) => rest);
    }
    if (pending.length) throw new Error('Could not allocate unique document IDs.');
  }

  for (let i = 0; i < issued.length; i += CHUNK) {
    const part = issued.slice(i, i + CHUNK);
    await client.query(
      `UPDATE batch_rows b SET doc_id = x.doc_id
       FROM jsonb_to_recordset($1::jsonb) AS x(row_no int, doc_id text)
       WHERE b.batch_id = $2 AND b.row_no = x.row_no`,
      [JSON.stringify(part.map(p => ({ row_no: p.row_no, doc_id: p.doc_id }))), batch.id]);
    // One activity row per document, so each document's history shows how it was issued
    await client.query(
      `INSERT INTO activity_log (tenant_id, user_id, actor, action, target_type, target_id, detail, ip_address)
       SELECT $2, $3, $4, 'document_issued', 'document', x.doc_id,
              jsonb_build_object('doc_type', x.doc_type, 'matric_number', x.matric, 'batch_id', $5::text, 'row', x.row_no), $6
       FROM jsonb_to_recordset($1::jsonb) AS x(doc_id text, doc_type text, matric text, row_no int)`,
      [JSON.stringify(part.map(p => ({ doc_id: p.doc_id, doc_type: p.doc_type, matric: p.metadata.matric_number, row_no: p.row_no }))),
       tenant.id, req.staff.id, req.staff.email, batch.id, clientIp(req)]);
  }

  await SR.markIssued(client, tenant.id, issued.map(p => p.metadata.matric_number));
  await client.query(
    `UPDATE batches SET status = 'issued', issued_count = $2, issued_at = NOW() WHERE id = $1`,
    [batch.id, issued.length]);
  return issued.length;
}

// ── Routes ──────────────────────────────────────────────────────────────────
router.get('/template.csv', ANY, (req, res) => {
  const sample = ['Amina Bello', 'CSC/2021/001', 'Bachelor of Science (B.Sc.) Computer Science', 'Computer Science',
                  'Science', 'Computer Science', 'Second Class Upper', '2025', '2021', ''];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="univerify-bulk-template.csv"');
  res.send('﻿' + toCsv([TEMPLATE_HEADERS, sample]));
});

router.get('/', ANY, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25;
    const r = await pool.query(
      `SELECT b.id, b.file_name, b.doc_type, b.status, b.row_count, b.valid_count, b.error_count, b.issued_count,
              b.created_at, b.submitted_at, b.decided_at, b.issued_at,
              cu.full_name AS created_by_name, cu.email AS created_by_email
       FROM batches b LEFT JOIN tenant_users cu ON cu.id = b.created_by
       WHERE b.tenant_id = $1 ORDER BY b.created_at DESC LIMIT $2 OFFSET $3`,
      [req.tenant.id, limit, (page - 1) * limit]);
    const c = await pool.query(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'pending_approval') AS pending
       FROM batches WHERE tenant_id = $1`, [req.tenant.id]);
    res.json({ data: r.rows, page, limit, total: parseInt(c.rows[0].total), pending_count: parseInt(c.rows[0].pending),
               approval_required: await approvalRequired(req.tenant.id), max_rows: MAX_ROWS,
               doc_types: DOC_TYPES, status_labels: STATUS_LABEL });
  } catch (e) { sendErr(res, e, 'Failed to load batches. Has migration 006 been run?'); }
});

router.post('/', ISSUERS, async (req, res) => {
  const client = await pool.connect();
  try {
    const docType  = clean(req.body.doc_type, 100);
    const fileName = clean(req.body.file_name, 255) || 'upload.csv';
    if (!DOC_TYPES.includes(docType)) throw bad(400, 'Pick a document type for this batch.');
    let table;
    try { table = parseCsv(req.body.csv); } catch (e) { throw bad(400, e.message); }
    if (table.length < 2) throw bad(400, 'The file has no data rows. Row 1 must be the column headings.');
    const { index, unknown } = mapHeaders(table[0]);
    const missing = REQUIRED.filter(k => index[k] === undefined);
    if (missing.length) throw bad(400, `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Download the template to see the expected headings.`);
    const body = table.slice(1);
    if (body.length > MAX_ROWS) throw bad(413, `This file has ${body.length} rows. The limit is ${MAX_ROWS} per batch; split it into smaller files.`);

    const records = body.map((cells, i) => {
      const data = {};
      for (const [k, col] of Object.entries(index)) {
        const v = clean(cells[col], k === 'title' ? 255 : 200);
        if (v) data[k] = v;
      }
      return { row_no: i + 2, data };   // row numbers as the spreadsheet shows them
    });
    const rows = await validateRows(req.tenant, docType, records);
    const errorCount = rows.filter(r => r.errors.length).length;

    await client.query('BEGIN');
    const b = await client.query(
      `INSERT INTO batches (tenant_id, file_name, doc_type, row_count, valid_count, error_count, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.tenant.id, fileName, docType, rows.length, rows.length - errorCount, errorCount, req.staff.id]);
    const batch = b.rows[0];
    for (let i = 0; i < rows.length; i += CHUNK) {
      await client.query(
        `INSERT INTO batch_rows (batch_id, tenant_id, row_no, data, errors, warnings)
         SELECT $2, $3, x.row_no, x.data, x.errors, x.warnings
         FROM jsonb_to_recordset($1::jsonb) AS x(row_no int, data jsonb, errors jsonb, warnings jsonb)`,
        [JSON.stringify(rows.slice(i, i + CHUNK).map(r => ({ row_no: r.row_no, data: r.data, errors: r.errors, warnings: r.warnings }))),
         batch.id, req.tenant.id]);
    }
    await client.query('COMMIT');
    await logActivity(req, { action: 'batch_uploaded', targetType: 'batch', targetId: batch.id,
      detail: { file_name: fileName, doc_type: docType, rows: rows.length, errors: errorCount } });
    res.status(201).json({ batch, ignored_columns: unknown });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    sendErr(res, e, 'Failed to read the file.');
  } finally { client.release(); }
});

router.get('/:id', ANY, async (req, res) => {
  try {
    const batch = await loadBatch(req.tenant.id, req.params.id);
    if (!batch) return res.status(404).json({ error: 'Batch not found.' });
    const rows = await pool.query(
      `SELECT row_no, data, errors, warnings, doc_id FROM batch_rows WHERE batch_id = $1 ORDER BY row_no`, [batch.id]);
    const users = await pool.query(
      `SELECT id, full_name, email FROM tenant_users WHERE tenant_id = $1 AND id = ANY($2)`,
      [req.tenant.id, [batch.created_by, batch.submitted_by, batch.decided_by].filter(Boolean)]);
    res.json({ batch, rows: rows.rows, users: users.rows, approval_required: await approvalRequired(req.tenant.id),
               status_labels: STATUS_LABEL });
  } catch (e) { sendErr(res, e, 'Failed to load batch.'); }
});

// The rows with problems, with an extra column saying what to fix
router.get('/:id/errors.csv', ANY, async (req, res) => {
  try {
    const batch = await loadBatch(req.tenant.id, req.params.id);
    if (!batch) return res.status(404).json({ error: 'Batch not found.' });
    const rows = await pool.query(
      `SELECT row_no, data, errors FROM batch_rows WHERE batch_id = $1 AND jsonb_array_length(errors) > 0 ORDER BY row_no`, [batch.id]);
    const table = [['original_row', ...TEMPLATE_HEADERS, 'problems']];
    for (const r of rows.rows) table.push([r.row_no, ...TEMPLATE_HEADERS.map(h => r.data[h] || ''), r.errors.join(' ')]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rows-to-fix-${batch.id.slice(0, 8)}.csv"`);
    res.send('﻿' + toCsv(table));
  } catch (e) { sendErr(res, e, 'Failed to export rows.'); }
});

router.post('/:id/submit', ISSUERS, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const batch = await loadBatch(req.tenant.id, req.params.id, client, true);
    if (!batch) throw bad(404, 'Batch not found.');
    if (batch.status !== 'draft') throw bad(409, `This batch is ${STATUS_LABEL[batch.status].toLowerCase()}, so it can't be submitted.`);
    if (!batch.valid_count) throw bad(409, 'No row in this batch is ready to issue. Fix the file and upload it again.');
    await client.query(`UPDATE batches SET submitted_by = $2, submitted_at = NOW() WHERE id = $1`, [batch.id, req.staff.id]);
    batch.submitted_by = req.staff.id;

    if (await approvalRequired(req.tenant.id)) {
      await client.query(`UPDATE batches SET status = 'pending_approval' WHERE id = $1`, [batch.id]);
      await client.query('COMMIT');
      await logActivity(req, { action: 'batch_submitted', targetType: 'batch', targetId: batch.id,
        detail: { doc_type: batch.doc_type, rows: batch.valid_count } });
      return res.json({ status: 'pending_approval' });
    }
    const n = await issueBatch(client, req, batch);
    await client.query('COMMIT');
    await logActivity(req, { action: 'batch_issued', targetType: 'batch', targetId: batch.id,
      detail: { doc_type: batch.doc_type, issued: n, skipped: batch.error_count } });
    res.json({ status: 'issued', issued: n });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    sendErr(res, e, 'Failed to submit batch.');
  } finally { client.release(); }
});

router.post('/:id/approve', DECIDERS, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const batch = await loadBatch(req.tenant.id, req.params.id, client, true);
    if (!batch) throw bad(404, 'Batch not found.');
    if (batch.status !== 'pending_approval') throw bad(409, 'Only a batch awaiting approval can be approved.');
    if (batch.submitted_by === req.staff.id || batch.created_by === req.staff.id)
      throw bad(403, 'Someone other than the person who prepared this batch has to approve it.');
    await client.query(`UPDATE batches SET decided_by = $2, decided_at = NOW(), decision_note = $3 WHERE id = $1`,
      [batch.id, req.staff.id, clean(req.body.note, 500) || null]);
    const n = await issueBatch(client, req, batch);
    await client.query('COMMIT');
    await logActivity(req, { action: 'batch_approved', targetType: 'batch', targetId: batch.id,
      detail: { doc_type: batch.doc_type, issued: n } });
    res.json({ status: 'issued', issued: n });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    sendErr(res, e, 'Failed to approve batch.');
  } finally { client.release(); }
});

router.post('/:id/reject', DECIDERS, async (req, res) => {
  try {
    const note = clean(req.body.note, 500);
    if (!note) throw bad(400, 'Say why, so the person who prepared it knows what to fix.');
    const batch = await loadBatch(req.tenant.id, req.params.id);
    if (!batch) throw bad(404, 'Batch not found.');
    if (batch.submitted_by === req.staff.id || batch.created_by === req.staff.id)
      throw bad(403, 'Use Cancel for your own batch.');
    const r = await pool.query(
      `UPDATE batches SET status = 'rejected', decided_by = $3, decided_at = NOW(), decision_note = $4
       WHERE id = $1 AND tenant_id = $2 AND status = 'pending_approval' RETURNING id`,
      [batch.id, req.tenant.id, req.staff.id, note]);
    if (!r.rows.length) throw bad(409, 'Only a batch awaiting approval can be rejected.');
    await logActivity(req, { action: 'batch_rejected', targetType: 'batch', targetId: batch.id, detail: { note } });
    res.json({ status: 'rejected' });
  } catch (e) { sendErr(res, e, 'Failed to reject batch.'); }
});

router.post('/:id/cancel', ISSUERS, async (req, res) => {
  try {
    const batch = await loadBatch(req.tenant.id, req.params.id);
    if (!batch) throw bad(404, 'Batch not found.');
    if (batch.created_by !== req.staff.id && !req.staff.roles.includes('owner'))
      throw bad(403, 'Only the person who uploaded it, or an Owner, can cancel this batch.');
    const r = await pool.query(
      `UPDATE batches SET status = 'cancelled', decided_by = $3, decided_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status IN ('draft', 'pending_approval') RETURNING id`,
      [batch.id, req.tenant.id, req.staff.id]);
    if (!r.rows.length) throw bad(409, 'Only a draft or a batch awaiting approval can be cancelled.');
    await logActivity(req, { action: 'batch_cancelled', targetType: 'batch', targetId: batch.id });
    res.json({ status: 'cancelled' });
  } catch (e) { sendErr(res, e, 'Failed to cancel batch.'); }
});

// Claim codes for every graduate in an issued batch, as a CSV for the
// registry to send out. Each run makes fresh codes and voids earlier unused ones.
router.post('/:id/claim-codes.csv', ISSUERS, async (req, res) => {
  const client = await pool.connect();
  try {
    const batch = await loadBatch(req.tenant.id, req.params.id);
    if (!batch) return res.status(404).json({ error: 'Batch not found.' });
    if (batch.status !== 'issued') return res.status(409).json({ error: 'Claim codes are available once the batch is issued.' });
    const docs = (await client.query(
      `SELECT d.doc_id, d.issued_to, d.metadata->>'matric_number' AS matric, br.row_no
       FROM documents d JOIN batch_rows br ON br.doc_id = d.doc_id AND br.batch_id = $2
       WHERE d.tenant_id = $1 AND d.status = 'active' AND COALESCE(d.metadata->>'matric_number', '') <> ''
       ORDER BY br.row_no`, [req.tenant.id, batch.id])).rows;
    await client.query('BEGIN');
    const out = [['row', 'full_name', 'matric_number', 'doc_id', 'claim_code', 'expires', 'portal']];
    const portal = `${tenantBaseUrl(req.tenant.subdomain)}/student.html`;
    const seen = new Map();
    for (const d of docs) {
      const key = d.matric.trim().toUpperCase();
      if (!seen.has(key)) seen.set(key, await issueClaimCode(client, req.tenant.id, d.matric, req.staff.id));
      const c = seen.get(key);
      out.push([d.row_no, d.issued_to, d.matric, d.doc_id, c.code, new Date(c.expires_at).toISOString().slice(0, 10), portal]);
    }
    await client.query('COMMIT');
    await logActivity(req, { action: 'batch_claim_codes_issued', targetType: 'batch', targetId: batch.id, detail: { count: seen.size } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="claim-codes-${batch.id.slice(0, 8)}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send('\ufeff' + toCsv(out));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    sendErr(res, e, 'Failed to create claim codes.');
  } finally { client.release(); }
});

// Every PDF in an issued batch, plus a manifest CSV. Streams as it goes.
router.get('/:id/pdfs.zip', ISSUERS, async (req, res) => {
  try {
    const batch = await loadBatch(req.tenant.id, req.params.id);
    if (!batch) return res.status(404).json({ error: 'Batch not found.' });
    if (batch.status !== 'issued') return res.status(409).json({ error: 'PDFs are available once the batch is issued.' });
    const docs = (await pool.query(
      `SELECT d.*, br.row_no FROM documents d JOIN batch_rows br ON br.doc_id = d.doc_id AND br.batch_id = $2
       WHERE d.tenant_id = $1 ORDER BY br.row_no`, [req.tenant.id, batch.id])).rows;
    await logActivity(req, { action: 'batch_pdfs_downloaded', targetType: 'batch', targetId: batch.id, detail: { count: docs.length } });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${req.tenant.short_code || 'batch'}-${batch.doc_type.replace(/\W+/g, '-')}-${batch.id.slice(0, 8)}.zip"`);
    const zip = createZip(res);
    // Same tenant, type and issue date throughout, so load branding once
    const brandCache = new Map();
    const manifest = [['row', 'doc_id', 'full_name', 'matric_number', 'status', 'verify_url']];
    for (const d of docs) {
      const key = `${d.doc_type}|${new Date(d.issue_date).toISOString().slice(0, 10)}`;
      if (!brandCache.has(key)) brandCache.set(key, await loadBrand(d));
      const chunks = [];
      const sink = new Writable({ write(c, _e, cb) { chunks.push(c); cb(); } });
      const done = new Promise((resolve, reject) => { sink.on('finish', resolve); sink.on('error', reject); });
      await generatePDF({ ...d, _brand: brandCache.get(key) }, sink);
      await done;
      const safe = String(d.metadata?.matric_number || d.doc_id).replace(/[^A-Za-z0-9_-]+/g, '-');
      zip.add(`${String(d.row_no).padStart(4, '0')}-${safe}-${d.doc_id}.pdf`, Buffer.concat(chunks));
      manifest.push([d.row_no, d.doc_id, d.issued_to, d.metadata?.matric_number || '', d.status, await buildVerifyUrl(d, req.tenant.subdomain)]);
    }
    zip.add('manifest.csv', '﻿' + toCsv(manifest));
    zip.end();
  } catch (e) {
    console.error('Batch zip error:', e);
    if (!res.headersSent) sendErr(res, e, 'Failed to build the zip.');
    else res.destroy(e);
  }
});

module.exports = router;
