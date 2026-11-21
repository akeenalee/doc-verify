// Beyond tertiary, phase 1: the sectors deployment (DEPLOYMENT=sectors).
// Runs against its own database, which starts with demo only. Checks the
// start-up guard both ways, onboarding a professional body, its document
// types and wording, member register checks, bulk upload with its own
// headings, the PDF and the public verify page.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DOC_SECRET = process.env.DOC_SECRET || 'testsecret';
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const A = require('../src/utils/staffAuth');
const pool = require('../src/db/pool');

const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const code = s => A.hotp(s, Math.floor(Date.now() / 30000));
const ROOT = path.join(__dirname, '..');
const SERVER_ENV = JSON.parse(process.env.SERVER_ENV || '{}');
const urlPath = u => { const x = new URL(u); return x.pathname + x.search; };

function client(host) {
  let cookie = '';
  return (method, p, body, raw) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: 'localhost', port: 3000, method, path: p,
      headers: { Host: host, Origin: 'http://' + host, Accept: raw ? '*/*' : 'application/json', 'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
        const sc = res.headers['set-cookie']; if (sc) cookie = sc[0].split(';')[0];
        const buf = Buffer.concat(chunks);
        let b = buf.toString(); try { b = JSON.parse(b); } catch (e) {}
        resolve({ status: res.statusCode, body: b, buf, ct: res.headers['content-type'] || '' });
      });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
async function setup(c, link, pw, name) {
  const token = new URL(link).searchParams.get('token');
  let r = await c('POST', '/app-api/auth/invite/start', { token, password: pw, full_name: name });
  r = await c('POST', '/app-api/auth/invite/confirm', { token, code: code(r.body.secret) });
  return r.status === 200;
}

// Start a server that should refuse to run; resolve with its exit code and output
function refusedStart(env) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], { cwd: ROOT,
      env: { ...SERVER_ENV, PORT: '3001', BASE_URL: 'http://localhost:3001', ...env } });
    let out = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    const t = setTimeout(() => { p.kill(); resolve({ code: 'still running', out }); }, 15000);
    p.on('exit', c => { clearTimeout(t); resolve({ code: c, out }); });
  });
}

(async () => {
  // ── The deployment switch ────────────────────────────────────────────────
  let r = spawnSync(process.execPath, ['-e', "console.log(JSON.stringify(require('./src/deployment').ALLOWED))"],
    { cwd: ROOT, env: { ...process.env, DEPLOYMENT: '' }, encoding: 'utf8' });
  ok(r.stdout.trim() === '["tertiary"]', 'DEPLOYMENT unset means tertiary only');
  r = spawnSync(process.execPath, ['-e', "console.log(JSON.stringify(require('./src/deployment').ALLOWED))"],
    { cwd: ROOT, env: { ...process.env, DEPLOYMENT: 'sectors' }, encoding: 'utf8' });
  const allowed = JSON.parse(r.stdout.trim() || '[]');
  ok(!allowed.includes('tertiary') && allowed.includes('professional_body') && allowed.length === 5, 'DEPLOYMENT=sectors allows the five other sectors');
  r = spawnSync(process.execPath, ['-e', "require('./src/deployment')"], { cwd: ROOT, env: { ...process.env, DEPLOYMENT: 'school' }, encoding: 'utf8' });
  ok(r.status === 1 && /DEPLOYMENT must be one of/.test(r.stderr), 'an unknown DEPLOYMENT value stops the server');

  // ── Guard: a sectors service pointed at the school database ──────────────
  if (process.env.TERTIARY_TEST_DATABASE_URL) {
    const g = await refusedStart({ DATABASE_URL: process.env.TERTIARY_TEST_DATABASE_URL, DEPLOYMENT: 'sectors' });
    ok(g.code === 1 && /holds issuers from another deployment/.test(g.out) && /dsu \(tertiary\)/.test(g.out),
       'sectors service refuses the school database');
  }

  // ── Onboarding ───────────────────────────────────────────────────────────
  const admin = client('demo.localhost:3000');
  r = await admin('POST', '/admin-api/login', { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS });
  r = await admin('GET', '/admin-api/tenants');
  ok(r.status === 200 && r.body.deployment === 'sectors', 'admin list says this is the sectors deployment');
  ok(r.body.sectors && r.body.sectors.some(s => s.key === 'professional_body' && s.id_label === 'Membership number')
     && !r.body.sectors.some(s => s.key === 'tertiary'), 'onboarding offers the sector packs, not tertiary');

  r = await admin('POST', '/admin-api/tenants', { name: 'Demo Institute Without Sector', subdomain: 'dnx', short_code: 'DNX' });
  ok(r.status === 400 && r.body.fields && r.body.fields.sector, 'a sector is required here');
  r = await admin('POST', '/admin-api/tenants', { name: 'Demo University Here', subdomain: 'dux', short_code: 'DUX', sector: 'tertiary' });
  ok(r.status === 400 && r.body.fields && r.body.fields.sector, 'a school cannot be onboarded on the sectors deployment');
  r = await admin('POST', '/admin-api/tenants', { name: 'Demo Institute of Practitioners', subdomain: 'dip', short_code: 'DIP', sector: 'professional_body' });
  ok(r.status === 201 && r.body.tenant.sector === 'professional_body', 'professional body onboarded');
  const dip = r.body.tenant;
  const tpl = await pool.query('SELECT name, award, validity_months FROM doc_templates WHERE tenant_id = $1 ORDER BY sort', [dip.id]);
  ok(tpl.rows.length === 4 && tpl.rows[0].name === 'Practising Licence' && tpl.rows[0].validity_months === 12,
     'its document types are seeded from the pack');

  // ── Guard: a school service pointed at the sectors database ──────────────
  const g2 = await refusedStart({ DATABASE_URL: process.env.TEST_DATABASE_URL, DEPLOYMENT: 'tertiary' });
  ok(g2.code === 1 && /dip \(professional_body\)/.test(g2.out), 'school service refuses the sectors database');

  // ── Staff app wording ────────────────────────────────────────────────────
  const inv = await admin('POST', `/admin-api/tenants/${dip.id}/owner-invite`, { email: 'registrar@dip.example', full_name: 'Kemi Registrar' });
  const owner = client('dip.localhost:3000');
  ok(await setup(owner, inv.body.link, 'Sector-pass-01', 'Kemi Registrar'), 'institute owner signed in');

  r = await owner('GET', '/app-api/meta');
  const m = r.body;
  ok(r.status === 200 && m.sector === 'professional_body' && m.terms.id_label === 'Membership number' && m.terms.holder === 'member',
     'meta carries the professional body words');
  ok(m.doc_types.includes('Practising Licence') && !m.doc_types.includes('Certificate') && m.default_type === 'Practising Licence',
     'meta lists the institute document types');
  ok(m.fields.programme === 'Grade' && m.fields.faculty === null && m.signatories[0] === 'Registrar', 'record fields relabelled, faculty hidden');

  r = await owner('GET', '/api/tenant-info');
  ok(r.body.sector === 'professional_body' && r.body.terms.portal === 'member portal', 'tenant info tells the member portal its words');

  // ── Issuing ──────────────────────────────────────────────────────────────
  r = await owner('POST', '/app-api/documents', { doc_type: 'Certificate', title: 'x', issued_to: 'Ada Member', matric_number: 'DIP/1' });
  ok(r.status === 400, 'a school document type is refused');
  r = await owner('POST', '/app-api/documents', { doc_type: 'Practising Licence', title: 'Practising Licence 2027', issued_to: 'Ada Member' });
  ok(r.status === 400 && /Membership number is required/.test(r.body.error), 'missing membership number named in sector words');

  const csv = 'membership_number,name,grade,scope_of_practice,year_admitted,status\n' +
              'DIP/0001,Ada Member,Fellow,Structural design,2015,active\n' +
              'DIP/0002,Bayo Lapsed,Member,Building services,2018,lapsed\n' +
              'DIP/0003,Chika Struck,Associate,Site supervision,2020,struck off\n';
  r = await owner('POST', '/app-api/students/lists', { csv, file_name: 'register.csv' });
  ok(r.status === 201 && r.body.added === 3, 'member register uploaded with the institute headings');
  r = await owner('POST', '/app-api/students/lists', { csv: 'name,grade\nA,B\n' });
  ok(r.status === 400 && /Missing column: membership_number/.test(r.body.error), 'missing column named the institute way');

  r = await owner('GET', '/app-api/students/lookup?matric=DIP/0001&doc_type=' + encodeURIComponent('Practising Licence'));
  ok(r.body.found && r.body.record.programme === 'Fellow' && !r.body.check.error, 'active member can get a practising licence');
  r = await owner('GET', '/app-api/students/lookup?matric=DIP/0002&doc_type=' + encodeURIComponent('Practising Licence'));
  ok(r.body.check.error === 'Member register shows status "Lapsed". A practising licence needs status Active.',
     'lapsed member blocked, in institute words');
  r = await owner('GET', '/app-api/students/lookup?matric=DIP/0003&doc_type=' + encodeURIComponent('CPD Certificate'));
  ok(r.body.check.warning && /struck off/i.test(r.body.check.warning), 'struck-off member warns on a non-award document');
  r = await owner('GET', '/app-api/students/lookup?matric=DIP/0404&doc_type=' + encodeURIComponent('Practising Licence'));
  ok(!r.body.found, 'unknown membership number not found');

  r = await owner('POST', '/app-api/documents', { doc_type: 'Practising Licence', title: 'Practising Licence 2027', issued_to: 'Ada Member',
    matric_number: 'DIP/0001', programme: 'Fellow', degree_class: 'Structural design', expiry_date: '2027-12-31' });
  ok(r.status === 201 && r.body.document.doc_type === 'Practising Licence', 'practising licence issued');
  const doc = r.body.document;
  ok(doc.metadata.institution_type === 'government', 'official layout chosen for the institute');
  r = await owner('POST', '/app-api/documents', { doc_type: 'Practising Licence', title: 'Practising Licence 2027', issued_to: 'Bayo Lapsed', matric_number: 'DIP/0002' });
  ok(r.status >= 400 && r.status < 500 && /Member register shows status "Lapsed"/.test(r.body.error), 'issuing to a lapsed member refused');

  r = await owner('GET', `/app-api/documents/${doc.doc_id}/pdf`, null, true);
  ok(r.status === 200 && /pdf/.test(r.ct) && r.buf.slice(0, 4).toString() === '%PDF', 'licence PDF renders');

  // ── Bulk upload ──────────────────────────────────────────────────────────
  r = await owner('GET', '/app-api/batches/template.csv', null, true);
  const head = r.buf.toString().replace(/^﻿/, '').split(/\r?\n/)[0];
  ok(r.status === 200 && /membership_number/.test(head) && !/matric_number/.test(head) && !/faculty/.test(head),
     'batch template uses institute headings: ' + head);
  r = await owner('GET', '/app-api/students/template.csv', null, true);
  const shead = r.buf.toString().replace(/^﻿/, '').split(/\r?\n/)[0];
  ok(/membership_number/.test(shead) && /grade/.test(shead) && !/faculty/.test(shead) && !/graduation_year/.test(shead),
     'register template drops hidden fields: ' + shead);
  r = await owner('POST', '/app-api/batches', { doc_type: 'Membership Certificate', file_name: 'members.csv',
    csv: 'membership_number,full_name,title,grade\nDIP/0001,Ada Member,Certificate of Membership,Fellow\nDIP/0002,Bayo Lapsed,Certificate of Membership,Member\n' });
  ok(r.status === 201 && r.body.batch.valid_count === 1 && r.body.batch.error_count === 1, 'batch: active member valid, lapsed member rejected');
  r = await owner('POST', '/app-api/batches', { doc_type: 'Transcript', csv: 'membership_number,full_name,title\nDIP/0001,Ada Member,x\n' });
  ok(r.status === 400, 'batch refuses a school document type');

  // ── Disclosure and the public verify page ────────────────────────────────
  r = await owner('GET', '/app-api/settings/disclosure');
  ok(r.status === 200 && r.body.fields.programme.label === 'Grade' && r.body.fields.class_of_degree.label === 'Scope of practice'
     && !r.body.fields.graduation_year, 'disclosure switches in institute words');
  r = await owner('PATCH', '/app-api/settings/disclosure', { programme: true, class_of_degree: true });
  ok(r.status === 200 && r.body.fields.programme.label === 'Grade', 'disclosure saved');

  const full = (await pool.query('SELECT * FROM documents WHERE doc_id = $1', [doc.doc_id])).rows[0];
  const vurl = await require('../src/utils/docUtils').buildVerifyUrl(full, 'dip');
  await pool.query(`INSERT INTO student_tokens (matric_number, institution, pin_hash, pin_salt, tenant_id, token_balance)
                    VALUES ('DIP/0001', $1, 'x', '', $2, 5)`, [dip.name, dip.id]);
  const pub = client('dip.localhost:3000');
  r = await pub('GET', urlPath(vurl), null, true);
  const page = r.buf.toString();
  ok(r.status === 200 && page.includes('Ada Member') && page.includes('Grade') && page.includes('Fellow')
     && page.includes('Scope of practice') && !page.includes('Class of Degree'), 'verify page shows institute labels');
  ok(page.includes('2027'), 'verify page shows the licence expiry');

  await pool.end();
})().catch(e => { console.log('FAIL crashed: ' + (e.stack || e)); process.exitCode = 1; pool.end().catch(() => {}); });
