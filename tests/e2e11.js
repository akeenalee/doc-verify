// Monitoring: OpenTelemetry traces and metrics reach an OTLP collector, and
// no personal data goes with them. The runner starts the server for this
// suite with OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318; the
// collector below is a fake that keeps every payload it receives.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DOC_SECRET = process.env.DOC_SECRET || 'testsecret';
const http = require('http');
const A = require('../src/utils/staffAuth');
const T = require('../src/telemetry');

const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const code = s => A.hotp(s, Math.floor(Date.now() / 30000));
const wait = ms => new Promise(r => setTimeout(r, ms));

// ── Fake OTLP collector ──
const got = { traces: [], metrics: [] };
const collector = http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (req.url === '/v1/traces') got.traces.push(body);
    else if (req.url === '/v1/metrics') got.metrics.push(body);
    res.writeHead(200, { 'Content-Type': 'application/x-protobuf' }); res.end();
  });
});
// Protobuf keeps strings as plain UTF-8, so a text search is enough here
const text = list => Buffer.concat(list).toString('latin1');

function client(host) {
  let cookie = '';
  return (method, path, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: 'localhost', port: 3000, method, path,
      headers: { Host: host, Accept: 'application/json', 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.77',
        ...(cookie ? { cookie } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
        const sc = res.headers['set-cookie']; if (sc) cookie = sc[0].split(';')[0];
        let b = Buffer.concat(chunks).toString(); try { b = JSON.parse(b); } catch (e) {}
        resolve({ status: res.statusCode, body: b });
      });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

(async () => {
  // ── Privacy filter, unit level ──
  ok(T.scrubUrl('/verify/DSU-20261117-09BQ1DYJAZ2KW4WV?sig=2.1.abcdef') === '/verify/:id?[redacted]', 'doc ID and query string removed from URLs');
  ok(T.scrubUrl('/app-api/print/jobs/3f2b9c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b/pack.zip') === '/app-api/print/jobs/:id/pack.zip', 'UUIDs in paths become :id');
  ok(T.scrubUrl('/bank/resolve?account_number=0123456789&bank_code=058') === '/bank/resolve?[redacted]', 'bank account numbers never leave in Paystack call URLs');
  ok(T.scrubUrl('/app/#/documents') === '/app/#/documents', 'ordinary paths kept');
  const msg = T.scrubText('duplicate key: (email)=(f.adeyemi@dsu.example) matric CSC/2021/001 doc DSU-20261117-09BQ1DYJAZ2KW4WV acct 0123456789');
  ok(!/adeyemi|CSC\/2021|09BQ1D|0123456789/.test(msg), `error messages scrubbed: ${msg}`);

  await new Promise(r => collector.listen(4318, r));

  // ── Real traffic ──
  const admin = client('demo.localhost:3000');
  await admin('POST', '/admin-api/login', { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS });
  const dsu = (await admin('GET', '/admin-api/tenants')).body.tenants.find(t => t.subdomain === 'dsu');
  const inv = await admin('POST', `/admin-api/tenants/${dsu.id}/owner-invite`, { email: 'otel.owner@dsu.example', full_name: 'Telemetry Owner' });
  const owner = client('dsu.localhost:3000');
  const token = new URL(inv.body.link).searchParams.get('token');
  let r = await owner('POST', '/app-api/auth/invite/start', { token, password: 'Otel-test-pass1', full_name: 'Telemetry Owner' });
  r = await owner('POST', '/app-api/auth/invite/confirm', { token, code: code(r.body.secret) });
  ok(r.status === 200, 'owner signed in');
  r = await owner('POST', '/app-api/documents', { doc_type: 'Certificate', title: 'Bachelor of Science in Accounting', issued_to: 'Chinedu Okafor',
    matric_number: 'ACC/2019/044', programme: 'Accounting', class_of_degree: 'Second Class Upper', graduation_year: '2025' });
  ok(r.status === 201 || r.status === 200, 'document issued');
  const docId = r.body.document.doc_id;
  const vu = new URL(r.body.verify_url);
  const scan = client('dsu.localhost:3000');
  await scan('GET', vu.pathname + vu.search);
  await scan('GET', vu.pathname + vu.search);
  const bad = client('dsu.localhost:3000');
  r = await bad('POST', '/app-api/auth/login', { email: 'otel.owner@dsu.example', password: 'wrong-password-1' });
  ok(r.status === 401, 'failed login recorded');

  // Batch span delay is 200 ms and metrics go every second in this suite
  for (let i = 0; i < 20 && (!got.traces.length || got.metrics.length < 2); i++) await wait(500);
  await wait(1500);
  const tr = text(got.traces), me = text(got.metrics);

  ok(got.traces.length > 0, `traces reach the collector (${got.traces.length} batches)`);
  ok(got.metrics.length > 0, `metrics reach the collector (${got.metrics.length} batches)`);
  ok(tr.includes('univerify'), 'service name is univerify');
  ok(tr.includes('univerify.tenant') && tr.includes('dsu'), 'request traces carry the school (dsu)');
  ok(/SELECT|INSERT/.test(tr), 'database queries traced');
  ok(tr.includes('GET /verify'), 'verify page traced (route only, no query string)');
  ok(me.includes('univerify.verifications'), 'verification counter exported');
  ok(me.includes('univerify.staff_actions'), 'staff action counter exported');
  ok(me.includes('http.server.request.duration') || me.includes('http.server.duration'), 'HTTP latency histogram exported');

  // ── Nothing personal leaves ──
  const all = tr + me;
  ok(!all.includes(docId), 'no document ID in telemetry');
  ok(!all.includes('Chinedu') && !all.includes('Okafor'), 'no names in telemetry');
  ok(!all.includes('ACC/2019/044'), 'no matric number in telemetry');
  ok(!all.includes('otel.owner@dsu.example'), 'no email in telemetry');
  ok(!all.includes('203.0.113.77'), 'no client IP in telemetry');
  ok(!all.includes('Otel-test-pass1') && !all.includes('wrong-password-1'), 'no passwords in telemetry');
  ok(!all.includes(vu.searchParams.get('sig') || 'nosig'), 'no QR signature in telemetry');
  ok(!all.includes(token), 'no invite token in telemetry');

  collector.close();
  process.exit();
})().catch(e => { console.log('FAIL crashed: ' + e.stack); process.exit(1); });
