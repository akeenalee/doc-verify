// Phase 4a API test: QR signature v2, strict mode, key rotation, claim codes
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DOC_SECRET = process.env.DOC_SECRET || 'testsecret';
const http = require('http');
const A = require('../src/utils/staffAuth');
const pool = require('../src/db/pool');
const { signDocId } = require('../src/utils/docUtils');
const { hashPin } = require('../src/middleware/studentAuth');

function client(host, extra = {}) {
  let cookie = '';
  return (method, path, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: 'localhost', port: 3000, method, path,
      headers: { Host: host, Accept: 'application/json', 'Content-Type': 'application/json', ...extra,
        ...(cookie ? { cookie } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
        const sc = res.headers['set-cookie']; if (sc) cookie = sc[0].split(';')[0];
        const buf = Buffer.concat(chunks); const ct = res.headers['content-type'] || '';
        let b = buf; if (ct.includes('json')) { try { b = JSON.parse(buf.toString()); } catch (e) {} } else b = buf.toString();
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
const lastScan = async id => (await pool.query('SELECT result FROM verification_log WHERE doc_id = $1 ORDER BY id DESC LIMIT 1', [id])).rows[0]?.result;

(async () => {
  const admin = client('demo.localhost:3000');
  await admin('POST', '/admin-api/login', { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS });
  const lasu = (await admin('GET', '/admin-api/tenants')).body.tenants.find(t => t.subdomain === 'lasu');
  let r = await admin('POST', `/admin-api/tenants/${lasu.id}/owner-invite`, { email: 'registrar@lasu.edu.ng', full_name: 'Dr Registrar' });
  const owner = client('lasu.localhost:3000');
  ok(await setup(owner, r.body.link, 'Registrar2026', 'Dr Registrar'), 'owner set up');
  const x = await owner('POST', '/app-api/users', { email: 'officer@lasu.edu.ng', full_name: 'Officer', roles: ['officer'] });
  const officer = client('lasu.localhost:3000'); await setup(officer, x.body.link, 'Password2026x', 'Officer');
  const pub = client('lasu.localhost:3000');

  // ── Signature v2 ─────────────────────────────────────────────────────────
  r = await officer('POST', '/app-api/documents', { doc_type: 'Certificate', title: 'BSc Physics', issued_to: 'Ada Obi', matric_number: 'PHY/2020/001' });
  const doc = r.body.document;
  ok(/^LASU-\d{8}-[0-9A-HJKMNP-TV-Z]{16}$/.test(doc.doc_id), 'doc ID has 16 base32 characters: ' + doc.doc_id);
  const url1 = r.body.verify_url;
  ok(/[?&]sig=2\.1\.[0-9a-f]{32}$/.test(url1), 'verify URL carries v2 signature with key 1: ' + url1.split('sig=')[1]);
  r = await pub('GET', path(url1));
  ok(r.status === 302 && /pay\.html/.test(r.location), 'valid v2 link goes on to payment (' + r.status + ')');

  const flip = url1.slice(0, -1) + (url1.endsWith('0') ? '1' : '0');
  r = await pub('GET', path(flip));
  ok(r.status === 400 && /tampered/.test(r.body) && await lastScan(doc.doc_id) === 'tampered', 'one changed character: refused and logged as tampered');

  await pool.query('UPDATE documents SET issued_to = $1 WHERE doc_id = $2', ['Mallory Fake', doc.doc_id]);
  r = await pub('GET', path(url1));
  ok(r.status === 400, 'name edited in the database: original QR no longer verifies');
  await pool.query('UPDATE documents SET issued_to = $1 WHERE doc_id = $2', ['Ada Obi', doc.doc_id]);
  await pool.query("UPDATE documents SET issue_date = issue_date - 1 WHERE doc_id = $1", [doc.doc_id]);
  r = await pub('GET', path(url1));
  ok(r.status === 400, 'issue date edited in the database: refused');
  await pool.query("UPDATE documents SET issue_date = issue_date + 1 WHERE doc_id = $1", [doc.doc_id]);
  r = await pub('GET', path(url1));
  ok(r.status === 302, 'record restored: verifies again');

  r = await pub('GET', path(url1.replace('sig=2.1.', 'sig=2.9.')));
  ok(r.status === 400, 'unknown key id refused');
  r = await pub('GET', `/verify?doc=${doc.doc_id}&sig=garbage`);
  ok(r.status === 400, 'malformed signature refused');
  r = await pub('GET', `/verify?doc=${doc.doc_id}&sig=${signDocId(doc.doc_id)}`);
  ok(r.status === 302, 'v1 link still accepted while strict mode is off');
  r = await pub('GET', `/verify?doc=${doc.doc_id}`);
  ok(r.status === 302, 'unsigned link still accepted while strict mode is off');

  // A second school's key can't sign for this one
  const demoT = (await pool.query("SELECT id FROM tenants WHERE subdomain='demo'")).rows[0].id;
  const { signDocument } = require('../src/utils/signing');
  const foreign = await signDocument({ ...doc, tenant_id: demoT });
  r = await pub('GET', `/verify?doc=${doc.doc_id}&sig=${foreign}`);
  ok(r.status === 400, 'signature made with another school\'s key refused');

  // ── Security settings ────────────────────────────────────────────────────
  r = await officer('GET', '/app-api/settings/security');
  ok(r.status === 403, 'officer cannot open security settings');
  r = await owner('GET', '/app-api/settings/security');
  ok(r.status === 200 && r.body.keys.length === 1 && r.body.keys[0].status === 'active' && r.body.sig_strict === false && r.body.student_claim_required === true,
     'owner sees key 1 active, strict off, claim codes required');
  ok(r.body.master === 'shared', 'reports that no dedicated master key is set');

  r = await owner('PATCH', '/app-api/settings/security', { sig_strict: true });
  ok(r.status === 200 && r.body.sig_strict === true, 'strict mode on');
  r = await pub('GET', `/verify?doc=${doc.doc_id}&sig=${signDocId(doc.doc_id)}`);
  ok(r.status === 400 && /older format/.test(r.body) && await lastScan(doc.doc_id) === 'old_link', 'strict: v1 link refused and logged as old_link');
  r = await pub('GET', `/verify?doc=${doc.doc_id}`);
  ok(r.status === 400, 'strict: unsigned link refused');
  r = await pub('GET', path(url1));
  ok(r.status === 302, 'strict: v2 link still verifies');

  r = await owner('POST', '/app-api/settings/security/rotate-key');
  ok(r.status === 200 && r.body.keys.length === 2 && r.body.keys[0].kid === 2 && r.body.keys[0].status === 'active' && r.body.keys[1].status === 'retired',
     'rotate: key 2 active, key 1 retired');
  r = await officer('GET', `/app-api/documents/${doc.doc_id}`);
  ok(/sig=2\.2\./.test(r.body.verify_url), 'new links use key 2');
  r = await pub('GET', path(r.body.verify_url));
  ok(r.status === 302, 'key 2 link verifies');
  r = await pub('GET', path(url1));
  ok(r.status === 302, 'key 1 link printed earlier still verifies after rotation');
  r = await owner('PATCH', '/app-api/settings/security', { sig_strict: false });

  r = await officer('GET', `/app-api/documents/${doc.doc_id}/qr?size=print`);
  ok(r.status === 200 && /image\/png/.test(r.ct), 'print QR PNG still generated');
  r = await officer('GET', `/app-api/documents/${doc.doc_id}/pdf`);
  ok(r.status === 200 && /pdf/.test(r.ct), 'PDF still generated with v2 QR');
  r = await owner('GET', '/app-api/settings/preview.pdf?type=Certificate');
  ok(r.status === 200, 'specimen preview renders');

  // ── CSRF guard ───────────────────────────────────────────────────────────
  const evil = client('lasu.localhost:3000', { Origin: 'https://evil.example' });
  r = await evil('POST', `/app-api/documents/${doc.doc_id}/claim-code`);
  ok(r.status === 403 || r.status === 500, 'staff write from another origin refused (' + r.status + ')');
  const other = client('lasu.localhost:3000', { Origin: 'http://demo.localhost:3000' });
  r = await other('POST', `/app-api/documents/${doc.doc_id}/claim-code`);
  ok(r.status === 403, 'staff write from another tenant\'s origin refused');

  // ── Claim codes ──────────────────────────────────────────────────────────
  const inst = lasu.name;
  r = await officer('POST', `/app-api/documents/${doc.doc_id}/claim-code`);
  ok(r.status === 201 && /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(r.body.code) && r.body.matric_number === 'PHY/2020/001',
     'officer creates claim code ' + r.body.code);
  const code1 = r.body.code;
  r = await officer('POST', `/app-api/documents/${doc.doc_id}/claim-code`);
  const code2 = r.body.code;
  const stored = await pool.query("SELECT code_hash FROM student_claim_codes WHERE matric_number = 'PHY/2020/001'");
  ok(stored.rows.every(x => x.code_hash !== code2 && !x.code_hash.includes(code2.replace(/-/g, ''))), 'only a hash of the code is stored');

  const stu = client('lasu.localhost:3000');
  r = await stu('GET', '/api/tokens/config');
  ok(r.body.claim_required === true, 'lasu portal asks for a claim code');
  r = await stu('POST', '/api/tokens/register', { matric_number: 'PHY/2020/001', institution: inst, pin: '4821' });
  ok(r.status === 400 && r.body.claim_required, 'register without code refused');
  r = await stu('POST', '/api/tokens/register', { matric_number: 'PHY/2020/001', institution: inst, pin: '4821', claim_code: code1 });
  ok(r.status === 400, 'superseded (voided) code refused');
  r = await stu('POST', '/api/tokens/register', { matric_number: 'PHY/2020/002', institution: inst, pin: '4821', claim_code: code2 });
  ok(r.status === 400, 'code for another matric number refused');
  r = await stu('POST', '/api/tokens/register', { matric_number: 'phy/2020/001', institution: inst, pin: '4821', claim_code: code2.toLowerCase().replace(/-/g, ' ') });
  ok(r.status === 201 && r.body.student.verified === true, 'register with code (lower case, spaces) works and is verified');
  r = await stu('GET', '/api/tokens/my-documents');
  ok(r.status === 200 && r.body.documents.length === 1 && /sig=2\.2\./.test(r.body.documents[0].verify_url), 'graduate sees own document with a signed link');
  r = await stu('GET', `/api/tokens/replacement-pdf/${doc.doc_id}`);
  ok(r.status === 200 && /pdf/.test(r.ct), 'graduate downloads official PDF');
  const st = await pool.query("SELECT pin_hash FROM student_tokens WHERE matric_number = 'PHY/2020/001'");
  ok(st.rows[0].pin_hash.startsWith('scrypt$'), 'new PIN stored with scrypt');
  const stu2 = client('lasu.localhost:3000');
  r = await stu2('POST', '/api/tokens/register', { matric_number: 'PHY/2020/001', institution: inst, pin: '9999', claim_code: code2 });
  ok(r.status === 409, 'claimed account cannot be registered again, even with the used code');

  // Squatter: an account opened before claim codes, by someone else
  await officer('POST', '/app-api/documents', { doc_type: 'Certificate', title: 'BSc Chemistry', issued_to: 'Bola Ade', matric_number: 'CHM/2020/007' });
  const salt = 'abcd';
  await pool.query(`INSERT INTO student_tokens (matric_number, institution, pin_hash, pin_salt, tenant_id, token_balance)
                    VALUES ('CHM/2020/007', $1, $2, $3, $4, 2)`, [inst, hashPin('1111', salt), salt, lasu.id]);
  const squat = client('lasu.localhost:3000');
  r = await squat('POST', '/api/tokens/login', { matric_number: 'CHM/2020/007', institution: inst, pin: '1111' });
  ok(r.status === 200 && r.body.student.verified === false && r.body.student.claim_required === true, 'old account logs in, unverified');
  const rehashed = await pool.query("SELECT pin_hash FROM student_tokens WHERE matric_number = 'CHM/2020/007'");
  ok(rehashed.rows[0].pin_hash.startsWith('scrypt$'), 'old SHA-256 PIN upgraded to scrypt on login');
  r = await squat('GET', '/api/tokens/my-documents');
  ok(r.status === 403 && r.body.claim_required, 'unclaimed account: documents hidden');
  r = await squat('GET', '/api/tokens/log');
  ok(r.status === 403, 'unclaimed account: verification log hidden');
  r = await squat('POST', '/api/tokens/claim', { claim_code: 'AAAA-BBBB-CCCC' });
  ok(r.status === 400, 'guessed claim code refused');

  const docB = (await pool.query("SELECT doc_id FROM documents WHERE metadata->>'matric_number' = 'CHM/2020/007'")).rows[0].doc_id;
  r = await officer('POST', `/app-api/documents/${docB}/claim-code`);
  const realCode = r.body.code;
  const real = client('lasu.localhost:3000');
  r = await real('POST', '/api/tokens/register', { matric_number: 'CHM/2020/007', institution: inst, pin: '7777', claim_code: realCode });
  ok(r.status === 201 && r.body.student.verified === true, 'real graduate takes over the unclaimed account with the code');
  r = await squat('GET', '/api/tokens/me');
  ok(r.status === 401, 'squatter session ended');
  r = await client('lasu.localhost:3000')('POST', '/api/tokens/login', { matric_number: 'CHM/2020/007', institution: inst, pin: '1111' });
  ok(r.status === 401, 'squatter PIN no longer works');
  r = await real('GET', '/api/tokens/my-documents');
  ok(r.status === 200 && r.body.documents.length === 1, 'real graduate sees the document');

  // Claim from inside the portal (legacy account, real owner)
  await officer('POST', '/app-api/documents', { doc_type: 'Certificate', title: 'BSc Maths', issued_to: 'Chi Eze', matric_number: 'MTH/2020/003' });
  await pool.query(`INSERT INTO student_tokens (matric_number, institution, pin_hash, pin_salt, tenant_id)
                    VALUES ('MTH/2020/003', $1, $2, $3, $4)`, [inst, hashPin('2222', salt), salt, lasu.id]);
  const legacy = client('lasu.localhost:3000');
  await legacy('POST', '/api/tokens/login', { matric_number: 'MTH/2020/003', institution: inst, pin: '2222' });
  const docC = (await pool.query("SELECT doc_id FROM documents WHERE metadata->>'matric_number' = 'MTH/2020/003'")).rows[0].doc_id;
  r = await officer('POST', `/app-api/documents/${docC}/claim-code`);
  r = await legacy('POST', '/api/tokens/claim', { claim_code: r.body.code });
  ok(r.status === 200 && r.body.student.verified === true, 'existing account claims with code from the portal');
  r = await legacy('GET', '/api/tokens/my-documents');
  ok(r.status === 200 && r.body.documents.length === 1, 'documents shown after claiming');

  // Claim codes switched off (owner), then back on
  r = await owner('PATCH', '/app-api/settings/security', { student_claim_required: false });
  r = await client('lasu.localhost:3000')('POST', '/api/tokens/register', { matric_number: 'ZZZ/1', institution: inst, pin: '1234' });
  ok(r.status === 201, 'claim codes off: register without code works');
  r = await owner('PATCH', '/app-api/settings/security', { student_claim_required: true });

  // Demo stays open
  r = await client('demo.localhost:3000')('GET', '/api/tokens/config');
  ok(r.body.claim_required === false, 'demo portal does not ask for a code');

  // Batch claim codes
  r = await officer('POST', '/app-api/batches', { doc_type: 'Certificate', file_name: 'b.csv',
    csv: 'full_name,matric_number,title\nOne Person,BAT/1,BSc A\nTwo Person,BAT/2,BSc B\n' });
  const bid = r.body.batch.id;
  r = await officer('POST', `/app-api/batches/${bid}/claim-codes.csv`);
  ok(r.status === 409, 'claim codes need an issued batch');
  await officer('POST', `/app-api/batches/${bid}/submit`);
  r = await officer('POST', `/app-api/batches/${bid}/claim-codes.csv`);
  const lines = String(r.body).replace(/^﻿/, '').trim().split(/\r?\n/);
  ok(r.status === 200 && lines.length === 3 && /claim_code/.test(lines[0]) && lines.slice(1).every(l => /,[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4},/.test(l)),
     'batch claim-code CSV has a code per graduate');
  const csvCode = lines[1].split(',')[4];
  r = await client('lasu.localhost:3000')('POST', '/api/tokens/register', { matric_number: 'BAT/1', institution: inst, pin: '5555', claim_code: csvCode });
  ok(r.status === 201, 'code from the batch CSV works');

  // Activity log
  const acts = (await pool.query(`SELECT action FROM activity_log WHERE tenant_id = $1`, [lasu.id])).rows.map(a => a.action);
  for (const a of ['claim_code_issued', 'batch_claim_codes_issued', 'signing_key_rotated', 'strict_mode_enabled', 'strict_mode_disabled', 'claim_codes_not_required', 'claim_codes_required'])
    ok(acts.includes(a), 'activity logged: ' + a);
  const leaked = await pool.query(`SELECT COUNT(*) FROM activity_log WHERE detail::text LIKE $1`, ['%' + realCode + '%']);
  ok(leaked.rows[0].count === '0', 'claim codes never written to the activity log');

  await pool.end();
  console.log('done');
})().catch(e => { console.error(e); process.exitCode = 1; });
