// Student records for issuing: who is a registered student, and the details
// printed on their documents. Two sources, checked in this order:
//
//  1. The school's SIS, live, through the UniVerify SIS API (docs/sis-api.md):
//     GET <base_url>/students/<matric>  ->  200 JSON record, or 404.
//  2. A student list the registry uploads: anyone it is issuing for, such as
//     the convocation list or this month's transcript requests (students
//     transferring abroad ask for transcripts mid-programme). Only the fields
//     printed on documents, plus status, are kept, and the retention job
//     deletes each record 30 days after its first document is issued (180 days
//     at most).
//
// Nothing here is shown to verifiers or graduates; it's for staff issuing.

const box = require('./secretBox');
const dns    = require('dns').promises;
const net    = require('net');
const pool   = require('../db/pool');

const FIELDS = ['full_name', 'programme', 'faculty', 'department', 'degree_class', 'entry_year', 'graduation_year'];
const normMatric = m => String(m || '').trim().toUpperCase().slice(0, 50);

// Names match when they hold the same words in any order ("ADE Tunde" = "Tunde Ade")
function nameKey(n) {
  return String(n || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
}
const sameName = (a, b) => nameKey(a) === nameKey(b);

// ── SIS secret, encrypted at rest ───────────────────────────────────────────
// Same format and key derivation as before the code moved to secretBox
const SIS = 'univerify-sis';
const encryptSecret = (tenantId, plain) => box.seal(SIS, tenantId, plain);
const decryptSecret = (tenantId, stored) => box.open(SIS, tenantId, stored);

// ── SIS endpoint safety: https only in production, no internal addresses ────
function privateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') ||
    (x.startsWith('::ffff:') && privateAddress(x.slice(7)));
}

async function checkSisUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (_) { return { error: 'Enter a full address starting with https://.' }; }
  const prod = process.env.NODE_ENV === 'production';
  if (u.protocol !== 'https:' && (prod || u.protocol !== 'http:')) return { error: 'The SIS address must use https://.' };
  if (u.username || u.password) return { error: 'Put credentials in the secret field, not in the address.' };
  if (prod) {
    let addrs;
    try { addrs = await dns.lookup(u.hostname, { all: true }); } catch (_) { return { error: `Couldn't find ${u.hostname}.` }; }
    if (!addrs.length || addrs.some(a => privateAddress(a.address))) return { error: 'The SIS address must be reachable on the public internet.' };
  }
  return { url: u.toString().replace(/\/+$/, '') };
}

async function loadSis(tenantId) {
  const r = await pool.query('SELECT * FROM tenant_sis WHERE tenant_id = $1', [tenantId]);
  return r.rows[0] || null;
}

function cleanRecord(o, matric) {
  const rec = { matric_number: normMatric(o.matric_number || matric) };
  for (const f of FIELDS) {
    const v = o[f] ?? (f === 'degree_class' ? o.class_of_degree : undefined);
    if (v !== undefined && v !== null && String(v).trim()) rec[f] = String(v).trim().slice(0, f.endsWith('year') ? 4 : 200);
  }
  if (o.status) rec.status = String(o.status).toLowerCase().slice(0, 30);
  return rec;
}

// Returns { found: true, record } | { found: false } ; throws on SIS failure
async function sisLookup(sis, tenantId, matric) {
  const { url, error } = await checkSisUrl(sis.base_url);
  if (error) throw new Error(error);
  const headers = { Accept: 'application/json', 'User-Agent': 'UniVerify-SIS-Client/1' };
  const secret = decryptSecret(tenantId, sis.secret_enc);
  if (sis.auth_type === 'bearer' && secret) headers.Authorization = 'Bearer ' + secret;
  if (sis.auth_type === 'basic' && secret) headers.Authorization = 'Basic ' + Buffer.from(secret).toString('base64');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), sis.timeout_ms || 5000);
  try {
    const r = await fetch(`${url}/students/${encodeURIComponent(matric)}`, { headers, redirect: 'error', signal: ctl.signal });
    if (r.status === 404) return { found: false };
    if (!r.ok) throw new Error(`SIS answered ${r.status}.`);
    const text = await r.text();
    if (text.length > 20000) throw new Error('SIS answer too large.');
    const body = JSON.parse(text);
    if (!body || !body.full_name) throw new Error('SIS answer has no full_name.');
    if (normMatric(body.matric_number || matric) !== matric) throw new Error('SIS returned a different matric number.');
    return { found: true, record: cleanRecord(body, matric) };
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'SIS did not answer in time.' : e.message);
  } finally { clearTimeout(t); }
}

// The one lookup issuing uses. source: 'sis' | 'list' | null
async function lookupStudent(tenantId, matricIn) {
  const matric = normMatric(matricIn);
  if (!matric) return { found: false, source: null };
  const sis = await loadSis(tenantId);
  let sisError = null;
  if (sis && sis.enabled) {
    try {
      const r = await sisLookup(sis, tenantId, matric);
      pool.query('UPDATE tenant_sis SET last_ok_at = NOW(), last_error = NULL WHERE tenant_id = $1', [tenantId]).catch(() => {});
      if (r.found) return { found: true, source: 'sis', record: r.record };
    } catch (e) {
      sisError = e.message;
      pool.query('UPDATE tenant_sis SET last_error = $2 WHERE tenant_id = $1', [tenantId, e.message.slice(0, 300)]).catch(() => {});
    }
  }
  const l = await pool.query(
    `SELECT matric_number, status, ${FIELDS.join(', ')} FROM student_records WHERE tenant_id = $1 AND UPPER(matric_number) = $2`,
    [tenantId, matric]);
  if (l.rows.length) return { found: true, source: 'list', record: cleanRecord(l.rows[0], matric), sis_error: sisError };
  return { found: false, source: null, sis_error: sisError };
}

// Many matric numbers at once (bulk upload). Map matric -> result.
async function lookupMany(tenantId, matrics) {
  const out = new Map();
  const list = [...new Set(matrics.map(normMatric).filter(Boolean))];
  const sis = await loadSis(tenantId);
  if (sis && sis.enabled) {
    // A few at a time so a slow SIS isn't flooded
    for (let i = 0; i < list.length; i += 8) {
      await Promise.all(list.slice(i, i + 8).map(async m => out.set(m, await lookupStudent(tenantId, m))));
    }
    return out;
  }
  const r = await pool.query(
    `SELECT matric_number, status, ${FIELDS.join(', ')} FROM student_records WHERE tenant_id = $1 AND UPPER(matric_number) = ANY($2)`,
    [tenantId, list]);
  const byM = new Map(r.rows.map(x => [normMatric(x.matric_number), x]));
  for (const m of list) out.set(m, byM.has(m) ? { found: true, source: 'list', record: cleanRecord(byM.get(m), m) } : { found: false, source: null });
  return out;
}

async function markIssued(db, tenantId, matrics) {
  const list = [...new Set(matrics.map(normMatric).filter(Boolean))];
  if (!list.length) return;
  await db.query(`UPDATE student_records SET issued_at = NOW()
                  WHERE tenant_id = $1 AND UPPER(matric_number) = ANY($2) AND issued_at IS NULL`, [tenantId, list]);
}

async function requireRegistered(tenantId) {
  const r = await pool.query('SELECT require_registered FROM tenants WHERE id = $1', [tenantId]);
  return r.rows[0]?.require_registered === true;
}

// Awards need a finished programme; records of study (transcripts, results,
// attestation) can be issued at any stage, e.g. a student transferring abroad.
const AWARD_TYPES = ['Certificate', 'Diploma', 'Completion'];
const FINISHED = ['graduated', 'completed', 'alumni', 'alumnus'];
const UNUSUAL = ['withdrawn', 'expelled', 'rusticated', 'suspended', 'deceased', 'transferred'];
const STATUS_LABEL = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : 'not given';

// { error } blocks issue, { warning } is shown, {} is fine. No status: fine.
function statusCheck(docType, status) {
  const st = String(status || '').toLowerCase();
  if (!st) return {};
  if (AWARD_TYPES.includes(docType) && !FINISHED.includes(st))
    return { error: `Student records show status "${STATUS_LABEL(st)}". A ${docType === 'Completion' ? 'completion certificate' : docType.toLowerCase()} needs status Graduated.` };
  if (UNUSUAL.includes(st)) return { warning: `Student records show status "${STATUS_LABEL(st)}". Check before issuing.` };
  return {};
}

// Does the school have anything to check against? (SIS on, or a list uploaded)
async function hasRecords(tenantId) {
  const r = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM tenant_sis WHERE tenant_id = $1 AND enabled) OR
            EXISTS (SELECT 1 FROM student_records WHERE tenant_id = $1) AS has`, [tenantId]);
  return r.rows[0].has === true;
}

// Issue-time verdict for one document from a lookup result.
// required: the school only issues to students found in its records.
// Once a student is found, the record is the authority: a different name
// always blocks, and the details printed come from the record (lockRecord).
// Returns { errors: [], warnings: [], source, record }
function assess(lookup, docType, name, required) {
  const errors = [], warnings = [];
  const flag = msg => (required ? errors : warnings).push(msg);
  if (!lookup || !lookup.found) {
    const why = lookup && lookup.sis_error ? ` The SIS couldn't be reached: ${lookup.sis_error}` : '';
    flag(`Matric number not found in student records.${why}`);
    return { errors, warnings, source: null };
  }
  const rec = lookup.record;
  if (name && !sameName(rec.full_name, name)) errors.push(`Name doesn't match student records, which say "${rec.full_name}".`);
  const s = statusCheck(docType, rec.status);
  if (s.error) errors.push(s.error);   // the school's own records say not finished: always blocks an award
  if (s.warning) warnings.push(s.warning);
  return { errors, warnings, source: lookup.source, record: rec };
}

// Fields a found record fixes, as the issue form / CSV names them
const LOCKED = { full_name: 'full_name', programme: 'programme', faculty: 'faculty', department: 'department',
                 degree_class: 'degree_class', entry_year: 'entry_year', graduation_year: 'graduation_year' };

// Overwrite form/CSV data with the record's values where the record has them.
// Returns the names of fields whose submitted value was replaced.
function lockRecord(data, record) {
  const replaced = [];
  if (!record) return replaced;
  for (const [field, key] of Object.entries(LOCKED)) {
    const v = record[key];
    if (!v) continue;
    const given = String(data[field] ?? '').trim();
    if (given && given !== v && !(field === 'full_name' && sameName(given, v))) replaced.push(field);
    data[field] = v;
  }
  return replaced;
}

// One document: look up, then judge. Skips everything when the school has no
// SIS or list and doesn't require registration.
async function registrationCheck(tenantId, docType, matric, name) {
  const required = await requireRegistered(tenantId);
  if (!required && !(await hasRecords(tenantId))) return { errors: [], warnings: [], source: null };
  return assess(await lookupStudent(tenantId, matric), docType, name, required);
}

module.exports = {
  hasRecords, assess, registrationCheck, lockRecord, LOCKED,
  FIELDS, normMatric, sameName, nameKey, lookupStudent, lookupMany, markIssued, requireRegistered,
  encryptSecret, decryptSecret, checkSisUrl, loadSis, sisLookup, statusCheck, AWARD_TYPES,
};
