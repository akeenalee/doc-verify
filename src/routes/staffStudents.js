// Student records for issuing (matric lookup). Mounted at /app-api/students.
// See src/utils/studentRecords.js for the sources and docs/sis-api.md for the
// API a school's SIS exposes.

const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { requireStaff } = require('../middleware/staffAuth');
const { logActivity } = require('../utils/activity');
const { parseCsv, toCsv } = require('../utils/csv');
const R = require('../utils/studentRecords');

const ANY     = requireStaff();
const ISSUERS = requireStaff('owner', 'officer', 'approver');
const OWNER   = requireStaff('owner');
const MAX_ROWS = 5000;

const { cleanText } = require('../utils/text');
const clean = (v, max = 200) => cleanText(v, max);
function bad(status, message) { const e = new Error(message); e.status = status; return e; }
function sendErr(res, e, fallback) {
  if (e.status) return res.status(e.status).json({ error: e.message });
  console.error(fallback, e);
  res.status(500).json({ error: fallback });
}

// ── Lookup while issuing ─────────────────────────────────────────────────────
router.get('/lookup', ISSUERS, async (req, res) => {
  try {
    const matric = R.normMatric(req.query.matric);
    if (!matric) throw bad(400, 'Enter a matric number.');
    const [r, required, has] = await Promise.all([
      R.lookupStudent(req.tenant.id, matric), R.requireRegistered(req.tenant.id), R.hasRecords(req.tenant.id)]);
    const check = r.found ? R.statusCheck(String(req.query.doc_type || ''), r.record.status) : {};
    res.json({ ...r, check, require_registered: required, has_records: has });
  } catch (e) { sendErr(res, e, 'Lookup failed.'); }
});

// ── Overview ─────────────────────────────────────────────────────────────────
router.get('/', ANY, async (req, res) => {
  try {
    const [sis, lists, counts, flag] = await Promise.all([
      R.loadSis(req.tenant.id),
      pool.query(
        `SELECT l.id, l.file_name, l.row_count, l.created_at, u.email AS uploaded_by,
                (SELECT COUNT(*)::int FROM student_records s WHERE s.list_id = l.id) AS remaining,
                (SELECT COUNT(*)::int FROM student_records s WHERE s.list_id = l.id AND s.issued_at IS NOT NULL) AS issued
         FROM student_lists l LEFT JOIN tenant_users u ON u.id = l.uploaded_by
         WHERE l.tenant_id = $1 ORDER BY l.created_at DESC LIMIT 50`, [req.tenant.id]),
      pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE issued_at IS NULL)::int AS waiting
                  FROM student_records WHERE tenant_id = $1`, [req.tenant.id]),
      R.requireRegistered(req.tenant.id),
    ]);
    const owner = req.staff.roles.includes('owner');
    res.json({
      require_registered: flag,
      sis: sis ? { configured: true, enabled: sis.enabled, auth_type: sis.auth_type, has_secret: !!sis.secret_enc,
                   base_url: owner ? sis.base_url : undefined, timeout_ms: sis.timeout_ms,
                   last_ok_at: sis.last_ok_at, last_error: sis.last_error, updated_at: sis.updated_at }
               : { configured: false },
      lists: lists.rows, records: counts.rows[0],
    });
  } catch (e) { sendErr(res, e, 'Failed to load student records.'); }
});

router.patch('/settings', OWNER, async (req, res) => {
  try {
    if (typeof req.body.require_registered !== 'boolean') throw bad(400, 'Nothing to change.');
    await pool.query('UPDATE tenants SET require_registered = $2 WHERE id = $1', [req.tenant.id, req.body.require_registered]);
    await logActivity(req, { action: req.body.require_registered ? 'registered_check_on' : 'registered_check_off',
      targetType: 'tenant', targetId: req.tenant.id });
    res.json({ require_registered: req.body.require_registered });
  } catch (e) { sendErr(res, e, 'Failed to save.'); }
});

// ── Student lists (upload fallback) ──────────────────────────────────────────
const COLUMNS = {
  matric_number:   ['matric_number', 'matric', 'matric_no', 'matriculation_number', 'reg_no', 'registration_number', 'student_id'],
  full_name:       ['full_name', 'name', 'student_name', 'graduate_name', 'fullname'],
  programme:       ['programme', 'program', 'course', 'course_of_study', 'degree_programme'],
  faculty:         ['faculty', 'college', 'school'],
  department:      ['department', 'dept'],
  degree_class:    ['degree_class', 'class', 'class_of_degree', 'classification'],
  entry_year:      ['entry_year', 'year_of_entry', 'admission_year'],
  graduation_year: ['graduation_year', 'year_of_graduation', 'grad_year'],
  status:          ['status', 'student_status', 'academic_status'],
};
const norm = h => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

router.get('/template.csv', ISSUERS, (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="student-list-template.csv"');
  res.send('﻿' + toCsv([Object.keys(COLUMNS),
    ['CSC/2021/001', 'Amina Bello', 'Computer Science', 'Science', 'Computer Science', 'First Class', '2021', '2025', 'graduated'],
    ['ECO/2023/014', 'Tunde Ade', 'Economics', 'Social Sciences', 'Economics', '', '2023', '', 'enrolled']]));
});

router.post('/lists', ISSUERS, async (req, res) => {
  const client = await pool.connect();
  try {
    const fileName = clean(req.body.file_name, 255) || 'students.csv';
    let table;
    try { table = parseCsv(req.body.csv); } catch (e) { throw bad(400, e.message); }
    if (table.length < 2) throw bad(400, 'The file has no data rows. Row 1 must be the column headings.');
    const index = {};
    table[0].forEach((h, i) => { const k = Object.keys(COLUMNS).find(c => COLUMNS[c].includes(norm(h))); if (k && index[k] === undefined) index[k] = i; });
    for (const k of ['matric_number', 'full_name'])
      if (index[k] === undefined) throw bad(400, `Missing column: ${k}. Download the template to see the expected headings.`);
    const body = table.slice(1).filter(r => r.some(c => String(c || '').trim()));
    if (body.length > MAX_ROWS) throw bad(413, `This file has ${body.length} rows. The limit is ${MAX_ROWS}; split it.`);

    const rows = [], problems = [], seen = new Set();
    body.forEach((cells, i) => {
      const row_no = i + 2, d = {};
      for (const [k, col] of Object.entries(index)) { const v = clean(cells[col], k.endsWith('year') ? 4 : 200); if (v) d[k] = v; }
      d.matric_number = R.normMatric(d.matric_number);
      const errs = [];
      if (!d.matric_number) errs.push('no matric number');
      if (!d.full_name) errs.push('no name');
      for (const k of ['full_name', 'programme']) if (/^[=+@]/.test(d[k] || '')) errs.push(`${k} looks like a spreadsheet formula`);
      for (const k of ['entry_year', 'graduation_year']) if (d[k] && !/^\d{4}$/.test(d[k])) errs.push(`${k} must be four digits`);
      if (d.status) d.status = d.status.toLowerCase().slice(0, 30);
      if (d.matric_number && seen.has(d.matric_number)) errs.push('matric number repeated in this file');
      if (errs.length) { problems.push({ row: row_no, error: errs.join('; ') }); return; }
      seen.add(d.matric_number); rows.push(d);
    });
    if (!rows.length) throw bad(400, `No usable rows. First problem: row ${problems[0]?.row}: ${problems[0]?.error}.`);

    await client.query('BEGIN');
    const l = await client.query(
      'INSERT INTO student_lists (tenant_id, file_name, row_count, uploaded_by) VALUES ($1,$2,$3,$4) RETURNING id',
      [req.tenant.id, fileName, rows.length, req.staff.id]);
    for (let i = 0; i < rows.length; i += 500) {
      // A newer upload replaces the earlier entry for the same student
      await client.query(
        `INSERT INTO student_records (tenant_id, list_id, matric_number, full_name, programme, faculty, department,
                                      degree_class, entry_year, graduation_year, status)
         SELECT $2, $3, x.matric_number, x.full_name, x.programme, x.faculty, x.department,
                x.degree_class, x.entry_year, x.graduation_year, x.status
         FROM jsonb_to_recordset($1::jsonb) AS x(matric_number text, full_name text, programme text, faculty text,
              department text, degree_class text, entry_year text, graduation_year text, status text)
         ON CONFLICT (tenant_id, (UPPER(matric_number))) DO UPDATE SET
           list_id = EXCLUDED.list_id, full_name = EXCLUDED.full_name, programme = EXCLUDED.programme,
           faculty = EXCLUDED.faculty, department = EXCLUDED.department, degree_class = EXCLUDED.degree_class,
           entry_year = EXCLUDED.entry_year, graduation_year = EXCLUDED.graduation_year, status = EXCLUDED.status,
           created_at = NOW(), issued_at = NULL`,
        [JSON.stringify(rows.slice(i, i + 500)), req.tenant.id, l.rows[0].id]);
    }
    await client.query('COMMIT');
    await logActivity(req, { action: 'student_list_uploaded', targetType: 'student_list', targetId: l.rows[0].id,
      detail: { file_name: fileName, rows: rows.length, skipped: problems.length } });
    res.status(201).json({ id: l.rows[0].id, added: rows.length, skipped: problems.slice(0, 50), skipped_count: problems.length });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    sendErr(res, e, 'Failed to read the file.');
  } finally { client.release(); }
});

router.delete('/lists/:id', OWNER, async (req, res) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw bad(404, 'List not found.');
    const r = await pool.query('DELETE FROM student_lists WHERE id = $1 AND tenant_id = $2 RETURNING file_name', [req.params.id, req.tenant.id]);
    if (!r.rows.length) throw bad(404, 'List not found.');
    await logActivity(req, { action: 'student_list_deleted', targetType: 'student_list', targetId: req.params.id,
      detail: { file_name: r.rows[0].file_name } });
    res.json({ ok: true });
  } catch (e) { sendErr(res, e, 'Failed to delete the list.'); }
});

// ── SIS connection ───────────────────────────────────────────────────────────
router.put('/sis', OWNER, async (req, res) => {
  try {
    const b = req.body || {};
    const { url, error } = await R.checkSisUrl(b.base_url);
    if (error) throw bad(400, error);
    const auth = ['bearer', 'basic', 'none'].includes(b.auth_type) ? b.auth_type : 'bearer';
    const timeout = Math.min(15000, Math.max(1000, parseInt(b.timeout_ms) || 5000));
    const cur = await R.loadSis(req.tenant.id);
    // An empty secret field keeps the stored one; "none" auth clears it
    const secret = auth === 'none' ? null
      : b.secret ? R.encryptSecret(req.tenant.id, String(b.secret).slice(0, 2000)) : cur?.secret_enc || null;
    if (auth !== 'none' && !secret) throw bad(400, auth === 'basic' ? 'Enter the username:password the SIS gave you.' : 'Enter the API token the SIS gave you.');
    await pool.query(
      `INSERT INTO tenant_sis (tenant_id, enabled, base_url, auth_type, secret_enc, timeout_ms, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET enabled = $2, base_url = $3, auth_type = $4, secret_enc = $5,
         timeout_ms = $6, updated_by = $7, updated_at = NOW(), last_error = NULL`,
      [req.tenant.id, b.enabled === true, url, auth, secret, timeout, req.staff.id]);
    await logActivity(req, { action: 'sis_connection_saved', targetType: 'tenant', targetId: req.tenant.id,
      detail: { base_url: url, auth_type: auth, enabled: b.enabled === true, secret_changed: !!b.secret } });
    res.json({ ok: true });
  } catch (e) { sendErr(res, e, 'Failed to save the SIS connection.'); }
});

router.delete('/sis', OWNER, async (req, res) => {
  try {
    await pool.query('DELETE FROM tenant_sis WHERE tenant_id = $1', [req.tenant.id]);
    await logActivity(req, { action: 'sis_connection_removed', targetType: 'tenant', targetId: req.tenant.id });
    res.json({ ok: true });
  } catch (e) { sendErr(res, e, 'Failed to remove the SIS connection.'); }
});

// Try one matric number against the SIS, even while it's switched off
router.post('/sis/test', OWNER, async (req, res) => {
  try {
    const sis = await R.loadSis(req.tenant.id);
    if (!sis) throw bad(400, 'Save the SIS connection first.');
    const matric = R.normMatric(req.body.matric);
    if (!matric) throw bad(400, 'Enter a matric number to test with.');
    let out;
    try {
      const r = await R.sisLookup(sis, req.tenant.id, matric);
      await pool.query('UPDATE tenant_sis SET last_ok_at = NOW(), last_error = NULL WHERE tenant_id = $1', [req.tenant.id]);
      out = { ok: true, ...r };
    } catch (e) {
      await pool.query('UPDATE tenant_sis SET last_error = $2 WHERE tenant_id = $1', [req.tenant.id, e.message.slice(0, 300)]);
      out = { ok: false, error: e.message };
    }
    await logActivity(req, { action: 'sis_connection_tested', targetType: 'tenant', targetId: req.tenant.id,
      detail: { ok: out.ok, found: !!out.found } });
    res.json(out);
  } catch (e) { sendErr(res, e, 'SIS test failed.'); }
});

module.exports = router;
