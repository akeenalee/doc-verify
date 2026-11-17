// Input cleaning (M-03) and the SIS connection pinned to a checked address (DNS rebinding)
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DOC_SECRET = process.env.DOC_SECRET || 'testsecret';
const http = require('http');
const A = require('../src/utils/staffAuth');
const pool = require('../src/db/pool');
const { cleanText, cleanNote } = require('../src/utils/text');
const SR = require('../src/utils/studentRecords');

function client(host) {
  let cookie = '';
  return (method, path, body, extra = {}) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: 'localhost', port: 3000, method, path,
      headers: { Host: host, Accept: 'application/json', 'Content-Type': 'application/json', ...extra,
        ...(cookie ? { cookie } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
        const sc = res.headers['set-cookie']; if (sc) cookie = sc[0].split(';')[0];
        const buf = Buffer.concat(chunks); const ct = res.headers['content-type'] || '';
        let b = buf; if (ct.includes('json')) { try { b = JSON.parse(buf.toString()); } catch (e) {} } else if (/text|html|svg/.test(ct)) b = buf.toString();
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
const withEnv = async (k, v, fn) => { const old = process.env[k]; process.env[k] = v; try { return await fn(); } finally { if (old === undefined) delete process.env[k]; else process.env[k] = old; } };
const lookup = (host, opts) => new Promise(res => SR.safeLookup(host, opts, (err, a, f) => res({ err, a, f })));

(async () => {
  // ── Cleaning rules ──
  ok(cleanText('  Adé   Ọlá  ') === 'Adé Ọlá', 'spaces collapse, tone marks kept');
  ok(cleanText("O'Brien & Sons") === "O'Brien & Sons", 'apostrophe and ampersand kept');
  ok(cleanText('<b>Ade</b>') === 'bAde/b', 'angle brackets removed');
  ok(cleanText('Ade‮Ola‬​') === 'AdeOla', 'bidi overrides and zero-width characters removed');
  ok(cleanText('A\u0000B\u0007C') === 'ABC', 'control characters removed');
  ok(cleanText('Line one\nLine two') === 'Line one Line two', 'one-line fields lose line breaks');
  ok(cleanNote('First\r\n\r\n\r\n\r\nSecond <x>') === 'First\n\nSecond x', 'notes keep paragraphs, lose markup');
  ok(cleanText('é') === 'é', 'text normalised to NFC');
  ok(Array.from(cleanText('😀'.repeat(10), 3)).length === 3, 'length cut never splits a character');
  ok(cleanText(null) === '' && cleanText(undefined) === '', 'empty input gives empty text');

  // ── Address pinned at connect time ──
  await withEnv('NODE_ENV', 'production', async () => {
    let r = await lookup('localhost', {});
    ok(r.err && r.err.code === 'EPRIVATE', 'production: lookup refuses localhost');
    r = await lookup('127.0.0.1', { all: true });
    ok(r.err && r.err.code === 'EPRIVATE', 'production: lookup refuses a literal internal IP');
    let e = null;
    try { await SR.sisGet('http://localhost:3000/mock-sis/health', {}, 2000); } catch (x) { e = x; }
    ok(e && /public internet/.test(e.message), 'production: request to an internal address never connects');
    e = null;
    try { await SR.sisGet('http://169.254.169.254/latest/meta-data/', {}, 2000); } catch (x) { e = x; }
    ok(e && /public internet/.test(e.message), 'production: cloud metadata address refused');
  });
  let r0 = await lookup('localhost', {});
  ok(!r0.err && r0.a, 'outside production: localhost allowed for the test SIS');
  r0 = await lookup('localhost', { all: true });
  ok(!r0.err && Array.isArray(r0.a), 'lookup answers the all-addresses form too');

  // ── Staff set-up ──
  const admin = client('demo.localhost:3000');
  await admin('POST', '/admin-api/login', { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS });
  const lasu = (await admin('GET', '/admin-api/tenants')).body.tenants.find(t => t.subdomain === 'lasu');
  let r = await admin('POST', `/admin-api/tenants/${lasu.id}/owner-invite`, { email: 'registrar@lasu.edu.ng', full_name: 'Dr <i>Registrar</i>' });
  const owner = client('lasu.localhost:3000');
  ok(await setup(owner, r.body.link, 'Registrar2026', 'Dr <i>Registrar</i>‮'), 'owner set up');
  let u = (await pool.query("SELECT full_name FROM tenant_users WHERE LOWER(email) = 'registrar@lasu.edu.ng'")).rows[0];
  ok(u.full_name === 'Dr iRegistrar/i', 'staff name stored without markup');

  // ── Issuing ──
  r = await owner('POST', '/app-api/documents', { doc_type: 'Certificate', title: 'B.Sc. <script>x</script>',
    issued_to: 'Tunde‮ Bakare<img src=x onerror=alert(1)>', matric_number: 'XSS/2026/0001', programme: 'Physics\u0000' });
  ok(r.status === 201 || r.status === 200, 'document with markup in it still issues');
  const docId = r.body.document ? r.body.document.doc_id : r.body.doc_id;
  const d = (await pool.query('SELECT title, issued_to, metadata FROM documents WHERE doc_id = $1', [docId])).rows[0] || {};
  ok(d.title === 'B.Sc. scriptx/script', 'title stored without markup');
  ok(d.issued_to === 'Tunde Bakareimg src=x onerror=alert(1)', 'holder name stored without markup or bidi override');
  ok(d.metadata && d.metadata.programme === 'Physics', 'programme stored without control characters');

  r = await owner('POST', `/app-api/documents/${encodeURIComponent(docId)}/revoke`, { reason: 'issued_in_error', note: 'Wrong <b>name</b>\n\n\n\nReissue' });
  const act = (await pool.query("SELECT detail FROM activity_log WHERE target_id = $1 AND action LIKE '%revoke%' ORDER BY id DESC LIMIT 1", [docId])).rows[0];
  ok(act && act.detail && act.detail.note === 'Wrong bname/b\n\nReissue', 'revoke note stored without markup, paragraphs kept');

  // ── SIS answers ──
  r = await owner('PUT', '/app-api/students/sis', { base_url: 'http://localhost:3000/mock-sis', auth_type: 'bearer', secret: 'test-sis-token', enabled: true, timeout_ms: 3000 });
  ok(r.status === 200, 'test SIS connected');
  r = await owner('POST', '/app-api/students/sis/test', { matric: 'TEST/DIRTY' });
  ok(r.body.ok && r.body.record.full_name === 'Adescriptalert(1)/script Ola', 'SIS name cleaned before use');
  ok(r.body.ok && r.body.record.programme === 'B.Sc. Physics' && r.body.record.status === 'graduated', 'SIS fields cleaned, status lower case');
  r = await owner('POST', '/app-api/students/sis/test', { matric: 'TEST/REDIRECT' });
  ok(r.body.ok === false && /redirect/i.test(r.body.error), 'SIS redirect refused, not followed');
  r = await owner('POST', '/app-api/students/sis/test', { matric: 'TEST/BIG' });
  ok(r.body.ok === false && /too large/.test(r.body.error), 'oversized SIS answer refused');
  r = await owner('POST', '/app-api/students/sis/test', { matric: 'CSC/2019/0012' });
  ok(r.body.ok && r.body.found, 'normal SIS lookup still works over the pinned connection');
  r = await owner('PUT', '/app-api/students/sis', { base_url: 'http://localhost:1/sis', auth_type: 'none', enabled: true, timeout_ms: 2000 });
  r = await owner('POST', '/app-api/students/sis/test', { matric: 'CSC/2019/0012' });
  ok(r.body.ok === false && /refused/.test(r.body.error), 'closed port reported plainly');
  await owner('DELETE', '/app-api/students/sis');

  // ── Holder portal and legacy pages ──
  const holder = client('lasu.localhost:3000');
  r = await owner('POST', '/app-api/documents', { doc_type: 'Transcript', title: 'Transcript', issued_to: 'Tunde Bakare', matric_number: 'XSS/2026/0002' });
  const doc2 = r.body.document ? r.body.document.doc_id : r.body.doc_id;
  const claim = (await owner('POST', `/app-api/documents/${encodeURIComponent(doc2)}/claim-code`)).body.code;
  r = await holder('POST', '/api/tokens/register', { matric_number: 'XSS/2026/0002', institution: lasu.name, full_name: '<svg onload=alert(1)>Tunde', pin: '482913', claim_code: claim });
  const h = (await pool.query("SELECT full_name FROM student_tokens WHERE matric_number = 'XSS/2026/0002'")).rows[0];
  ok(r.status < 300 && h && h.full_name === 'svg onload=alert(1)Tunde', 'holder name stored without markup');
  if (r.status >= 300) console.log('  register said', r.status, JSON.stringify(r.body));

  // Legacy pages put user agents and names inside attributes, so their esc() must handle quotes
  for (const p of ['index.html', 'admin.html', 'student.html', 'onboard.html']) {
    const page = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', p), 'utf8');
    ok(/'"':'&quot;'/.test(page), `${p} escapes quotes in attributes`);
  }

  await pool.end();
})().catch(e => { console.log('FAIL crashed: ' + e.stack); process.exitCode = 1; pool.end(); });
