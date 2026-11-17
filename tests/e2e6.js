// Phase 4b API test: print vendor role, print packs, placement specs, disclosure, scan alerts
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DOC_SECRET = process.env.DOC_SECRET || 'testsecret';
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
        let b = buf; if (ct.includes('json')) { try { b = JSON.parse(buf.toString()); } catch (e) {} } else if (/text|html|svg/.test(ct)) b = buf.toString();
        resolve({ status: res.statusCode, body: b, ct, location: res.headers.location });
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
const path = u => { const x = new URL(u); return x.pathname + x.search; };

const SIS = 'http://localhost:3000/mock-sis';

(async () => {
  const admin = client('demo.localhost:3000');
  await admin('POST', '/admin-api/login', { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS });
  const dsu = (await admin('GET', '/admin-api/tenants')).body.tenants.find(t => t.subdomain === 'dsu');
  let r = await admin('POST', `/admin-api/tenants/${dsu.id}/owner-invite`, { email: 'registrar@dsu.example', full_name: 'Dr Registrar' });
  const owner = client('dsu.localhost:3000');
  ok(await setup(owner, r.body.link, 'Registrar2026', 'Dr Registrar'), 'owner set up');
  const mk = async (email, name, roles) => {
    const x = await owner('POST', '/app-api/users', { email, full_name: name, roles });
    const c = client('dsu.localhost:3000'); await setup(c, x.body.link, 'Password2026x', name); return c;
  };
  const officer = await mk('officer@dsu.example', 'Officer', ['officer']);
  const auditor = await mk('audit@dsu.example', 'Auditor', ['auditor']);
  const vendor  = await mk('jobs@printco.ng', 'PrintCo', ['vendor']);
  const issue = (c, o) => c('POST', '/app-api/documents', { doc_type: 'Certificate', title: 'B.Sc. Test', ...o });

  // ── Test SIS itself ──────────────────────────────────────────────────────
  const raw = (p, tok) => new Promise(res => http.get({ host: 'localhost', port: 3000, path: '/mock-sis' + p,
    headers: tok ? { Authorization: 'Bearer ' + tok } : {} }, x => { let b = ''; x.on('data', d => b += d); x.on('end', () => res({ status: x.statusCode, body: b })); }));
  ok((await raw('/health')).status === 401, 'test SIS refuses a call without the token');
  ok((await raw('/health', 'wrong')).status === 401, 'test SIS refuses a wrong token');
  r = await raw('/students/' + encodeURIComponent('csc/2019/0012'), 'test-sis-token');
  ok(r.status === 200 && JSON.parse(r.body).full_name === 'Adebayo Oluwaseun Tunde', 'test SIS returns a student (slashes encoded, any case)');
  ok((await raw('/students/NOPE', 'test-sis-token')).status === 404, 'test SIS: unknown matric is 404');

  // ── Nothing configured ───────────────────────────────────────────────────
  r = await owner('GET', '/app-api/students');
  ok(r.status === 200 && r.body.sis.configured === false && r.body.require_registered === false, 'overview: no SIS, not required');
  r = await officer('GET', '/app-api/students/lookup?matric=CSC/2019/0012');
  ok(r.status === 200 && r.body.found === false && r.body.has_records === false, 'lookup with no records: not found, has_records false');
  r = await issue(officer, { issued_to: 'Anyone', matric_number: 'ANY/001' });
  ok(r.status === 201 && r.body.warnings.length === 0, 'no records and not required: issues with no warnings');
  ok((await vendor('GET', '/app-api/students')).status === 403, 'vendor cannot see student records');
  ok((await auditor('GET', '/app-api/students/lookup?matric=X')).status === 403, 'auditor cannot look up');

  // ── SIS connection ───────────────────────────────────────────────────────
  ok((await officer('PUT', '/app-api/students/sis', { base_url: SIS, auth_type: 'bearer', secret: 'x', enabled: true })).status === 403, 'officer cannot set SIS');
  r = await owner('PUT', '/app-api/students/sis', { base_url: SIS, auth_type: 'bearer', enabled: true });
  ok(r.status === 400, 'bearer without a token refused');
  r = await owner('PUT', '/app-api/students/sis', { base_url: 'ftp://x', auth_type: 'none', enabled: true });
  ok(r.status === 400, 'non-http address refused');
  r = await owner('PUT', '/app-api/students/sis', { base_url: SIS + '/', auth_type: 'bearer', secret: 'test-sis-token', enabled: true, timeout_ms: 3000 });
  ok(r.status === 200, 'owner saves SIS connection');
  r = await owner('GET', '/app-api/students');
  ok(r.body.sis.enabled && r.body.sis.has_secret && r.body.sis.base_url === SIS && !JSON.stringify(r.body).includes('test-sis-token'), 'overview shows connection, never the token');
  const enc = (await pool.query('SELECT secret_enc FROM tenant_sis WHERE tenant_id = $1', [dsu.id])).rows[0].secret_enc;
  ok(enc.startsWith('v1:') && !enc.includes('test-sis-token'), 'token stored encrypted');
  r = await owner('PUT', '/app-api/students/sis', { base_url: SIS, auth_type: 'bearer', secret: '', enabled: true, timeout_ms: 3000 });
  ok(r.status === 200, 'saving with an empty token keeps the stored one');
  r = await owner('POST', '/app-api/students/sis/test', { matric: 'CSC/2019/0012' });
  ok(r.body.ok && r.body.found && r.body.record.status === 'graduated', 'SIS test finds a student');
  r = await owner('POST', '/app-api/students/sis/test', { matric: 'TEST/ERROR' });
  ok(r.body.ok === false && /500/.test(r.body.error), 'SIS test reports a 500');
  r = await owner('POST', '/app-api/students/sis/test', { matric: 'TEST/MISMATCH' });
  ok(r.body.ok === false && /different matric/.test(r.body.error), 'SIS answer for another student refused');
  r = await owner('POST', '/app-api/students/sis/test', { matric: 'TEST/NONAME' });
  ok(r.body.ok === false && /full_name/.test(r.body.error), 'SIS answer without a name refused');
  r = await owner('GET', '/app-api/students');
  ok(/full_name/.test(r.body.sis.last_error || ''), 'last SIS error recorded');

  // ── Lookup ───────────────────────────────────────────────────────────────
  r = await officer('GET', '/app-api/students/lookup?matric=csc/2019/0012&doc_type=Certificate');
  ok(r.body.found && r.body.source === 'sis' && r.body.record.programme.includes('Computer Science') && !r.body.check.error, 'lookup fills from SIS, graduate can get a certificate');
  r = await officer('GET', '/app-api/students/lookup?matric=ARC/2017/0012&doc_type=Certificate');
  ok(r.body.record.degree_class === 'Second Class Upper' && !r.body.check.error, 'class_of_degree alias and status completed accepted');
  r = await officer('GET', '/app-api/students/lookup?matric=MEE/2023/0045&doc_type=Certificate');
  ok(r.body.found && /needs status Graduated/.test(r.body.check.error || ''), 'enrolled student: certificate blocked');
  r = await officer('GET', '/app-api/students/lookup?matric=MEE/2023/0045&doc_type=Transcript');
  ok(r.body.found && !r.body.check.error && !r.body.check.warning, 'enrolled student transferring abroad: transcript fine');
  r = await officer('GET', '/app-api/students/lookup?matric=GEO/2019/0055&doc_type=Transcript');
  ok(/Withdrawn/.test(r.body.check.warning || ''), 'withdrawn student: transcript warns');
  r = await officer('GET', '/app-api/students/lookup?matric=CVE/2019/0021&doc_type=Certificate');
  ok(r.body.found && !r.body.check.error, 'record without a status does not block');

  // ── Issuing, not required ────────────────────────────────────────────────
  r = await issue(officer, { issued_to: 'Tunde Adebayo Oluwaseun', matric_number: 'CSC/2019/0012' });
  ok(r.status === 201 && r.body.record_source === 'sis' && r.body.warnings.length === 0, 'issue with name in another order: no warning');
  const act = (await pool.query(`SELECT detail FROM activity_log WHERE target_id = $1 AND action = 'document_issued'`, [r.body.document.doc_id])).rows[0];
  ok(act && act.detail.record_source === 'sis', 'activity records where the student came from');
  r = await issue(officer, { issued_to: 'Somebody Else', matric_number: 'CSC/2019/0047' });
  ok(r.status === 422 && /doesn't match/.test(r.body.error), 'found student, wrong name: refused even when not required');
  r = await issue(officer, { issued_to: 'okafor ngozi chiamaka', matric_number: 'CSC/2019/0047', programme: 'Doctor of Medicine',
                             degree_class: 'First Class', graduation_year: '2020', faculty: '' });
  const lockedDoc = r.body.document;
  ok(r.status === 201 && lockedDoc.issued_to === 'Ngozi Chiamaka Okafor' && lockedDoc.metadata.programme.includes('Computer Science')
     && lockedDoc.metadata.degree_class === 'Second Class Upper' && lockedDoc.metadata.graduation_year === '2023' && lockedDoc.metadata.faculty === 'Science',
     'tampered details ignored: name spelling, programme, class, year and faculty come from the SIS record');
  const lact = (await pool.query(`SELECT detail FROM activity_log WHERE target_id = $1 AND action = 'document_issued'`, [lockedDoc.doc_id])).rows[0];
  ok(lact.detail.replaced_from_record && lact.detail.replaced_from_record.includes('programme') && !lact.detail.replaced_from_record.includes('full_name'),
     'activity notes which submitted fields were replaced');
  r = await officer('POST', '/app-api/documents', { doc_type: 'Transcript', title: 'Academic Transcript', issued_to: 'Hadiza Fatima Usman', matric_number: 'CVE/2019/0021', degree_class: 'First Class' });
  ok(r.status === 201 && r.body.document.metadata.degree_class === 'First Class' && r.body.document.metadata.department === 'Civil Engineering',
     'a field the record leaves empty keeps the typed value');
  r = await issue(officer, { issued_to: 'Zainab Halima Suleiman', matric_number: 'MEE/2023/0045' });
  ok(r.status === 422 && /Graduated/.test(r.body.error), 'certificate for an enrolled student refused even when not required');
  r = await officer('POST', '/app-api/documents', { doc_type: 'Transcript', title: 'Academic Transcript', issued_to: 'Zainab Halima Suleiman', matric_number: 'MEE/2023/0045' });
  ok(r.status === 201, 'transcript for the enrolled student issued');
  r = await issue(officer, { issued_to: 'Nobody', matric_number: 'ZZZ/0000' });
  ok(r.status === 201 && /not found/.test(r.body.warnings.join(' ')), 'unknown matric, not required: issued with a warning');

  // ── Required ─────────────────────────────────────────────────────────────
  ok((await officer('PATCH', '/app-api/students/settings', { require_registered: true })).status === 403, 'officer cannot turn on the requirement');
  r = await owner('PATCH', '/app-api/students/settings', { require_registered: true });
  ok(r.status === 200 && r.body.require_registered === true, 'owner requires registered students');
  r = await issue(officer, { issued_to: 'Nobody', matric_number: 'ZZZ/0000' });
  ok(r.status === 422 && /not found/.test(r.body.error), 'required: unknown matric refused');
  r = await issue(officer, { issued_to: 'Somebody Else', matric_number: 'CSC/2019/0047' });
  ok(r.status === 422 && /doesn't match/.test(r.body.error), 'required: wrong name refused');
  r = await issue(officer, { issued_to: 'Adebayo Olabisi Ajayi', matric_number: 'NUR/2018/0062' });
  ok(r.status === 201, 'required: name without accents matches the accented record');
  r = await issue(officer, { issued_to: 'Chinedu Paul Okafor', matric_number: 'MIC/2020/0067' });
  ok(r.status === 201, 'required: "OKAFOR, Chinedu Paul" matches "Chinedu Paul Okafor"');
  const doc = r.body.document;
  r = await officer('POST', `/app-api/documents/${doc.doc_id}/reissue`, { note: 'typo', doc_type: 'Certificate', title: 'B.Sc. Test', issued_to: 'Wrong Person', matric_number: 'MIC/2020/0067' });
  ok(r.status === 422, 'required: reissue with a wrong name refused');
  r = await officer('POST', `/app-api/documents/${doc.doc_id}/reissue`, { note: 'title', doc_type: 'Certificate', title: 'B.Sc. Microbiology', issued_to: 'Okafor Chinedu Paul', matric_number: 'MIC/2020/0067' });
  ok(r.status === 201 && r.body.record_source === 'sis', 'required: reissue with the right name works');

  // SIS too slow: falls through, and with no list, refused
  await owner('PUT', '/app-api/students/sis', { base_url: SIS, auth_type: 'bearer', enabled: true, timeout_ms: 1000 });
  r = await officer('GET', '/app-api/students/lookup?matric=TEST/SLOW');
  ok(r.body.found === false && /in time/.test(r.body.sis_error || ''), 'slow SIS: lookup reports a timeout');
  r = await issue(officer, { issued_to: 'X', matric_number: 'TEST/SLOW' });
  ok(r.status === 422 && /couldn't be reached/.test(r.body.error), 'slow SIS and required: refused, saying the SIS was not reached');
  await owner('PUT', '/app-api/students/sis', { base_url: SIS, auth_type: 'bearer', enabled: true, timeout_ms: 3000 });

  // ── Uploaded list ────────────────────────────────────────────────────────
  const csv = 'Matric No,Student Name,Course,Status,Entry Year\nlist/001,Kunle Afolayan,B.A. Theatre Arts,graduated,2019\nLIST/002,Bisi Ade,B.Sc. Botany,enrolled,2022\nLIST/003,,x,,\nLIST/004,=cmd,x,graduated,2019\nLIST/005,Ok Name,x,graduated,19\n';
  r = await officer('POST', '/app-api/students/lists', { csv, file_name: 'convocation.csv' });
  ok(r.status === 201 && r.body.added === 2 && r.body.skipped_count === 3, 'officer uploads a list; bad rows skipped');
  const listId = r.body.id;
  r = await officer('GET', '/app-api/students/lookup?matric=LIST/001&doc_type=Certificate');
  ok(r.body.found && r.body.source === 'list' && r.body.record.programme === 'B.A. Theatre Arts', 'SIS on, student only in the list: found in the list');
  r = await issue(officer, { issued_to: 'Afolayan Kunle', matric_number: 'LIST/001' });
  ok(r.status === 201 && r.body.record_source === 'list', 'issued from the list');
  const iss = (await pool.query(`SELECT issued_at FROM student_records WHERE tenant_id = $1 AND matric_number = 'LIST/001'`, [dsu.id])).rows[0];
  ok(iss && iss.issued_at, 'list record marked issued (starts the 30-day deletion clock)');
  r = await owner('GET', '/app-api/students');
  ok(r.body.records.total === 2 && r.body.records.waiting === 1 && r.body.lists[0].issued === 1, 'overview counts records and issued');
  r = await officer('POST', '/app-api/students/lists', { csv: 'name,course\nA,B\n' });
  ok(r.status === 400 && /matric_number/.test(r.body.error), 'list without a matric column refused');

  // ── Bulk issue checks against records ────────────────────────────────────
  const bcsv = 'full_name,matric_number,title,programme\nNgozi Chiamaka Okafor,CSC/2019/0047,B.Sc. Computer Science,Fake Programme\nUchenna Peter Obi,CHM/2020/0098,B.Sc. Chemistry\nGhost,ZZZ/9999,B.Sc. Nothing\nBisi Ade,LIST/002,B.Sc. Botany\n';
  r = await officer('POST', '/app-api/batches', { doc_type: 'Certificate', csv: bcsv, file_name: 'b.csv' });
  ok(r.status === 201 && r.body.batch.valid_count === 1 && r.body.batch.error_count === 3, 'batch: 1 valid, suspended + unknown + enrolled rows rejected');
  const bid = r.body.batch.id;
  r = await officer('GET', '/app-api/batches/' + bid);
  const row = n => r.body.rows.find(x => x.row_no === n);
  ok(row(2).data.programme.includes('Computer Science') && row(2).data.department === 'Computer Science' && row(2).data.record_source === 'sis', 'batch: details come from the SIS record, file value replaced');
  ok(/Taken from student records instead of the file: programme/.test(row(2).warnings.join(' ')), 'batch: replaced file value is flagged');
  ok(/Graduated/.test(row(3).errors.join(' ')) && /not found/.test(row(4).errors.join(' ')) && /Graduated/.test(row(5).errors.join(' ')), 'batch: row errors say why');
  r = await officer('POST', `/app-api/batches/${bid}/submit`);
  ok(r.status === 200, 'batch issued');
  const bd = (await pool.query(`SELECT metadata FROM documents WHERE batch_id = $1`, [bid])).rows;
  ok(bd.length === 1 && bd[0].metadata.department === 'Computer Science', 'batch document carries the filled-in record details');

  // Not required: batch rows warn instead
  await owner('PATCH', '/app-api/students/settings', { require_registered: false });
  r = await officer('POST', '/app-api/batches', { doc_type: 'Transcript', csv: 'full_name,matric_number,title\nGhost,ZZZ/9999,Transcript\nSegun Olawale Afolabi,GEO/2019/0055,Transcript\n' });
  ok(r.status === 201 && r.body.batch.valid_count === 2, 'not required: unknown and withdrawn rows are valid');
  r = await officer('GET', '/app-api/batches/' + r.body.batch.id);
  ok(/not found/.test(r.body.rows[0].warnings.join(' ')) && /Withdrawn/.test(r.body.rows[1].warnings.join(' ')), 'not required: they carry warnings');

  // SIS off: list only
  await owner('PUT', '/app-api/students/sis', { base_url: SIS, auth_type: 'bearer', enabled: false });
  r = await officer('GET', '/app-api/students/lookup?matric=CSC/2019/0012');
  ok(r.body.found === false, 'SIS switched off: SIS students no longer found');
  r = await owner('POST', '/app-api/students/sis/test', { matric: 'CSC/2019/0012' });
  ok(r.body.ok && r.body.found, 'test still works while switched off');

  // Cleanup
  ok((await officer('DELETE', '/app-api/students/lists/' + listId)).status === 403, 'officer cannot delete a list');
  r = await owner('DELETE', '/app-api/students/lists/' + listId);
  const left = (await pool.query('SELECT COUNT(*)::int AS n FROM student_records WHERE tenant_id = $1', [dsu.id])).rows[0].n;
  ok(r.status === 200 && left === 0, 'deleting a list deletes its records');
  r = await owner('DELETE', '/app-api/students/sis');
  ok(r.status === 200 && (await owner('GET', '/app-api/students')).body.sis.configured === false, 'SIS connection removed');
  const acts = (await pool.query(`SELECT DISTINCT action FROM activity_log WHERE tenant_id = $1 AND (action LIKE 'sis_%' OR action LIKE 'student_list%' OR action LIKE 'registered_%')`, [dsu.id])).rows.map(x => x.action).sort();
  ok(acts.length === 7, 'all seven student-record actions logged: ' + acts.join(','));

  // Retention rule
  const ret = require('../src/utils/retention.js');
  ok(typeof ret === 'object', 'retention module loads');

  await pool.end();
})().catch(e => { console.error(e); process.exitCode = 1; pool.end(); });
