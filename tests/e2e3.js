// Phase 3 API test: bulk CSV issuing and approvals
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const fs = require('fs');
const http = require('http');
const { execSync } = require('child_process');
const A = require('../src/utils/staffAuth');
const pool = require('../src/db/pool');

function client(host) {
  let cookie = '';
  return (method, path, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: 'localhost', port: 3000, method, path,
      headers: { Host: host, Accept: 'application/json', 'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
        const sc = res.headers['set-cookie']; if (sc) cookie = sc[0].split(';')[0];
        const buf = Buffer.concat(chunks); const ct = res.headers['content-type'] || '';
        let b = buf; if (ct.includes('json')) { try { b = JSON.parse(buf.toString()); } catch (e) {} }
        resolve({ status: res.statusCode, body: b, ct });
      });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const code = s => A.hotp(s, Math.floor(Date.now() / 30000));
async function setup(c, link, pw, name) {
  const token = new URL(link).searchParams.get('token');
  let r = await c('POST', '/app-api/auth/invite/start', { token, password: pw, full_name: name });
  r = await c('POST', '/app-api/auth/invite/confirm', { token, code: code(r.body.secret) });
  return r.status === 200;
}

(async () => {
  const admin = client('demo.localhost:3000');
  await admin('POST', '/admin-api/login', { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS });
  const lasu = (await admin('GET', '/admin-api/tenants')).body.tenants.find(t => t.subdomain === 'lasu');
  let r = await admin('POST', `/admin-api/tenants/${lasu.id}/owner-invite`, { email: 'registrar@lasu.edu.ng', full_name: 'Dr Registrar' });
  const owner = client('lasu.localhost:3000');
  ok(await setup(owner, r.body.link, 'Registrar2026', 'Dr Registrar'), 'owner set up');
  const mk = async (email, name, roles) => {
    const x = await owner('POST', '/app-api/users', { email, full_name: name, roles });
    const c = client('lasu.localhost:3000'); await setup(c, x.body.link, 'Password2026x', name); return c;
  };

  // Approval needs two active users: try with the owner alone first
  r = await owner('PATCH', '/app-api/settings/approval', { approval_required: true });
  ok(r.status === 409, 'approval refused with a single user: ' + r.body.error);

  const officer  = await mk('officer@lasu.edu.ng', 'Records Officer', ['officer']);
  const approver = await mk('approver@lasu.edu.ng', 'Deputy Registrar', ['approver']);
  const auditor  = await mk('audit@lasu.edu.ng', 'Internal Audit', ['auditor']);

  // A single-issue certificate so the bulk upload raises a duplicate warning
  r = await owner('POST', '/app-api/documents', { doc_type: 'Certificate', title: 'BSc Economics', issued_to: 'Existing Holder', matric_number: 'ECO/2020/001' });
  const existingId = r.body.document.doc_id;

  // Template
  r = await officer('GET', '/app-api/batches/template.csv');
  ok(r.status === 200 && r.body.toString().includes('full_name,matric_number,title'), 'template CSV');

  // Bad uploads
  r = await officer('POST', '/app-api/batches', { doc_type: 'Nope', csv: 'a\n1' });
  ok(r.status === 400, 'bad doc type rejected');
  r = await officer('POST', '/app-api/batches', { doc_type: 'Certificate', csv: 'name,programme\nA,B' });
  ok(r.status === 400 && /matric_number/.test(r.body.error), 'missing columns: ' + r.body.error);
  r = await officer('POST', '/app-api/batches', { doc_type: 'Certificate', csv: 'full_name,matric_number,title\n"A,1,2' });
  ok(r.status === 400 && /quote/.test(r.body.error), 'unclosed quote: ' + r.body.error);
  r = await officer('POST', '/app-api/batches', { doc_type: 'Certificate', csv: 'full_name,matric_number,title\n' });
  ok(r.status === 400, 'header only rejected');
  const big = ['full_name,matric_number,title'].concat(Array.from({ length: 1001 }, (_, i) => `P ${i},M/${i},T`)).join('\n');
  r = await officer('POST', '/app-api/batches', { doc_type: 'Certificate', csv: big });
  ok(r.status === 413, 'over 1,000 rows rejected: ' + r.body.error);
  r = await auditor('POST', '/app-api/batches', { doc_type: 'Certificate', csv: 'full_name,matric_number,title\nA,B,C' });
  ok(r.status === 403, 'auditor cannot upload');

  // A realistic Excel export: BOM, CRLF, aliases, quoted comma, an unknown column
  const csv = '﻿Name,Matric No,Degree,Programme,Class of Degree,Graduation Year,Entry Year,Nickname\r\n' +
    'Amina Bello,csc/2021/001,"Bachelor of Science (B.Sc.) Computer Science, Hons",Computer Science,First Class,2025,2021,Mina\r\n' +
    'Tunde Ade,CSC/2021/002,Bachelor of Science (B.Sc.) Computer Science,Computer Science,Second Class Upper,2025,2021,\r\n' +
    'No Title,CSC/2021/003,,Computer Science,,2025,2021,\r\n' +
    'Bad Year,CSC/2021/004,BSc CS,Computer Science,,25,2021,\r\n' +
    'Dup Matric,csc/2021/001,BSc CS,Computer Science,,2025,2021,\r\n' +
    '=HYPERLINK("http://x"),,BSc,,,,,\r\n' +
    'Existing Holder,ECO/2020/001,BSc Economics,Economics,,2024,2020,\r\n' +
    'Back Wards,CSC/2021/005,BSc CS,Computer Science,,2019,2021,\r\n\r\n';
  r = await officer('POST', '/app-api/batches', { doc_type: 'Certificate', csv, file_name: 'class-2025.csv' });
  ok(r.status === 201 && r.body.batch.row_count === 8 && r.body.batch.valid_count === 3 && r.body.batch.error_count === 5,
     `upload: 8 rows, 3 ready, 5 errors (${r.body.batch && [r.body.batch.row_count, r.body.batch.valid_count, r.body.batch.error_count]})`);
  ok(JSON.stringify(r.body.ignored_columns) === '["Nickname"]', 'unknown column reported: ' + JSON.stringify(r.body.ignored_columns));
  const b1 = r.body.batch.id;
  r = await officer('GET', `/app-api/batches/${b1}`);
  const byRow = Object.fromEntries(r.body.rows.map(x => [x.row_no, x]));
  ok(byRow[2].data.title.includes(', Hons') && byRow[2].data.matric_number === 'csc/2021/001', 'quoted comma kept, row numbers match the spreadsheet');
  ok(byRow[4].errors.some(e => /title/i.test(e)), 'missing title flagged on row 4');
  ok(byRow[5].errors.some(e => /Graduation year/.test(e)), 'bad year flagged on row 5');
  ok(byRow[6].errors.some(e => /row 2/.test(e)), 'duplicate matric (case-insensitive) flagged on row 6');
  ok(byRow[7].errors.length >= 2, 'row 7 missing matric and name formula: ' + byRow[7].errors.join(' | '));
  ok(byRow[8].errors.length === 0 && byRow[8].warnings.some(w => w.includes(existingId)), 'existing certificate is a warning, not an error');
  ok(byRow[9].errors.some(e => /before entry/.test(e)), 'graduation before entry flagged');
  r = await auditor('GET', `/app-api/batches/${b1}`);
  ok(r.status === 200, 'auditor can view a batch');
  r = await officer('GET', `/app-api/batches/${b1}/errors.csv`);
  const ecsv = r.body.toString();
  ok(r.status === 200 && ecsv.includes("'=HYPERLINK") && ecsv.includes('problems'), 'rows-to-fix CSV, formulas neutralised');

  // Approval off: submit issues straight away
  r = await officer('POST', `/app-api/batches/${b1}/submit`);
  ok(r.status === 200 && r.body.status === 'issued' && r.body.issued === 3, 'submit with approval off issues 3');
  r = await officer('POST', `/app-api/batches/${b1}/submit`);
  ok(r.status === 409, 'cannot submit twice');
  const docs = await pool.query('SELECT doc_id, issued_by_user, metadata FROM documents WHERE batch_id = $1', [b1]);
  ok(docs.rows.length === 3 && docs.rows.every(d => d.doc_id.startsWith('LASU-')), '3 documents with batch_id');
  ok(docs.rows.some(d => d.metadata.matric_number === 'CSC/2021/001'), 'matric upper-cased like single issue');
  const acts = await pool.query(`SELECT COUNT(*) FROM activity_log WHERE action = 'document_issued' AND detail->>'batch_id' = $1`, [b1]);
  ok(parseInt(acts.rows[0].count) === 3, 'one document_issued log per document');
  r = await officer('GET', `/app-api/documents/${docs.rows[0].doc_id}`);
  ok(r.body.document.batch_id === b1 && r.body.history.some(h => h.action === 'document_issued'), 'document detail links back to batch with history');
  const full = (await pool.query('SELECT * FROM documents WHERE doc_id = $1', [docs.rows[0].doc_id])).rows[0];
  const vu = new URL(await require('../src/utils/docUtils').buildVerifyUrl(full, 'lasu'));
  r = await client('lasu.localhost:3000')('GET', vu.pathname + vu.search);
  ok(r.status !== 404, 'bulk-issued document resolves on /verify (' + r.status + ')');

  r = await officer('GET', `/app-api/batches/${b1}/pdfs.zip`);
  fs.writeFileSync(require('./out') + 'batch.zip', r.body);
  const list = execSync(`cd "${require('./out')}" && unzip -t batch.zip`).toString();
  ok(r.status === 200 && /No errors/.test(list) && (list.match(/\.pdf/g) || []).length === 3 && list.includes('manifest.csv'), 'zip: 3 valid PDFs + manifest');
  r = await auditor('GET', `/app-api/batches/${b1}/pdfs.zip`);
  ok(r.status === 403, 'auditor cannot download PDFs');

  // Approval on
  r = await officer('PATCH', '/app-api/settings/approval', { approval_required: true });
  ok(r.status === 403, 'officer cannot change approval');
  r = await owner('PATCH', '/app-api/settings/approval', { approval_required: true });
  ok(r.status === 200, 'owner turns approval on');
  const two = 'full_name,matric_number,title\nKemi Lawal,LAW/2021/010,LLB Law\nSeun Ojo,LAW/2021/011,LLB Law\n';
  r = await officer('POST', '/app-api/batches', { doc_type: 'Certificate', csv: two, file_name: 'law.csv' });
  const b2 = r.body.batch.id;
  r = await officer('POST', `/app-api/batches/${b2}/submit`);
  ok(r.body.status === 'pending_approval', 'submit goes to approval');
  ok((await pool.query('SELECT COUNT(*) FROM documents WHERE batch_id = $1', [b2])).rows[0].count === '0', 'nothing issued while pending');
  r = await owner('GET', '/app-api/batches');
  ok(r.body.pending_count === 1 && r.body.approval_required === true, 'pending count for dashboard');
  r = await officer('POST', `/app-api/batches/${b2}/approve`);
  ok(r.status === 403, 'officer cannot approve');
  r = await auditor('POST', `/app-api/batches/${b2}/approve`);
  ok(r.status === 403, 'auditor cannot approve');

  // Approver can't approve their own batch
  r = await approver('POST', '/app-api/batches', { doc_type: 'Transcript', csv: 'full_name,matric_number,title\nAda Obi,MED/2019/1,Academic Transcript\n', file_name: 'med.csv' });
  const b3 = r.body.batch.id;
  await approver('POST', `/app-api/batches/${b3}/submit`);
  r = await approver('POST', `/app-api/batches/${b3}/approve`);
  ok(r.status === 403, 'cannot approve own batch: ' + r.body.error);
  r = await owner('POST', `/app-api/batches/${b3}/reject`, {});
  ok(r.status === 400, 'reject needs a reason');
  r = await owner('POST', `/app-api/batches/${b3}/reject`, { note: 'Wrong session year' });
  ok(r.status === 200, 'owner rejects');
  r = await owner('POST', `/app-api/batches/${b3}/approve`);
  ok(r.status === 409, 'rejected batch cannot be approved');

  r = await approver('POST', `/app-api/batches/${b2}/approve`, { note: 'Checked against senate list' });
  ok(r.status === 200 && r.body.issued === 2, 'approver approves officer batch, 2 issued');
  r = await owner('GET', `/app-api/batches/${b2}`);
  ok(r.body.batch.decided_by && r.body.batch.status === 'issued', 'decision recorded');

  // Cancel rules
  r = await officer('POST', '/app-api/batches', { doc_type: 'Certificate', csv: two.replace(/LAW/g, 'ACC'), file_name: 'acc.csv' });
  const b4 = r.body.batch.id;
  r = await approver('POST', `/app-api/batches/${b4}/cancel`);
  ok(r.status === 403, 'non-owner cannot cancel someone else\'s batch');
  r = await officer('POST', `/app-api/batches/${b4}/cancel`);
  ok(r.status === 200, 'uploader cancels draft');
  r = await officer('POST', `/app-api/batches/${b4}/cancel`);
  ok(r.status === 409, 'cannot cancel twice');
  r = await officer('POST', `/app-api/batches/${b4}/submit`);
  ok(r.status === 409, 'cancelled batch cannot be submitted');

  // Isolation and odd ids
  r = await client('demo.localhost:3000')('GET', `/app-api/batches/${b1}`);
  ok(r.status === 401, 'other tenant without session: 401');
  r = await officer('GET', '/app-api/batches/not-a-uuid');
  ok(r.status === 404, 'malformed id: 404');

  // Scale: 1,000 rows end to end, approval off
  await owner('PATCH', '/app-api/settings/approval', { approval_required: false });
  const rows = ['full_name,matric_number,title,programme,degree_class,graduation_year'].concat(
    Array.from({ length: 1000 }, (_, i) => `Graduate ${i},BIG/2021/${String(i).padStart(4, '0')},BSc Accounting,Accounting,Second Class Upper,2025`)).join('\n');
  let t = Date.now();
  r = await officer('POST', '/app-api/batches', { doc_type: 'Certificate', csv: rows, file_name: 'big.csv' });
  ok(r.status === 201 && r.body.batch.valid_count === 1000, `1,000-row upload in ${Date.now() - t} ms`);
  const b5 = r.body.batch.id;
  t = Date.now();
  r = await officer('POST', `/app-api/batches/${b5}/submit`);
  ok(r.body.issued === 1000, `1,000 issued in ${Date.now() - t} ms`);
  const ids = await pool.query('SELECT COUNT(DISTINCT doc_id) FROM documents WHERE batch_id = $1', [b5]);
  ok(ids.rows[0].count === '1000', '1,000 distinct document IDs');

  const seen = new Set((await pool.query(`SELECT DISTINCT action FROM activity_log WHERE tenant_id = $1`, [lasu.id])).rows.map(a => a.action));
  for (const a of ['batch_uploaded', 'batch_issued', 'batch_submitted', 'batch_approved', 'batch_rejected', 'batch_cancelled', 'approval_enabled', 'approval_disabled'])
    ok(seen.has(a), 'activity: ' + a);
  process.exit();
})().catch(e => { console.error(e); process.exit(1); });
