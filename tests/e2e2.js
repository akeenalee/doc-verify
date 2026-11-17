// Phase 2 API test: branding, signatories, preview, PDF selection
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const fs = require('fs');
const http = require('http');
const A = require('../src/utils/staffAuth');
const IMG = require('path').join(__dirname, 'fixtures') + '/';
const OUT = require('./out');
fs.mkdirSync(OUT, { recursive: true });
const b64 = f => 'data:image/png;base64,' + fs.readFileSync(IMG + f).toString('base64');

function client(host) {
  let cookie = '';
  const fn = (method, path, body, raw) => new Promise((resolve, reject) => {
    const data = raw != null ? raw : (body ? JSON.stringify(body) : null);
    const req = http.request({ host: 'localhost', port: 3000, method, path,
      headers: { Host: host, Accept: 'application/json', 'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
        const sc = res.headers['set-cookie']; if (sc) cookie = sc[0].split(';')[0];
        const buf = Buffer.concat(chunks); const ct = res.headers['content-type'] || '';
        let b = buf; if (ct.includes('json')) { try { b = JSON.parse(buf.toString()); } catch (e) {} }
        resolve({ status: res.statusCode, body: b, ct, headers: res.headers });
      });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
  return fn;
}
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const code = s => A.hotp(s, Math.floor(Date.now() / 30000));

async function setup(c, token, pw, name) {
  let r = await c('POST', '/app-api/auth/invite/start', { token, password: pw, full_name: name });
  const secret = r.body.secret;
  r = await c('POST', '/app-api/auth/invite/confirm', { token, code: code(secret) });
  return r.status === 200;
}

(async () => {
  const admin = client('demo.localhost:3000');
  let r = await admin('POST', '/admin-api/login', { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS });
  r = await admin('GET', '/admin-api/tenants');
  const dsu = r.body.tenants.find(t => t.subdomain === 'dsu');
  r = await admin('POST', `/admin-api/tenants/${dsu.id}/owner-invite`, { email: 'registrar@dsu.example', full_name: 'Dr Registrar' });
  const owner = client('dsu.localhost:3000');
  ok(await setup(owner, new URL(r.body.link).searchParams.get('token'), 'Registrar2026', 'Dr Registrar'), 'owner set up');
  r = await owner('POST', '/app-api/users', { email: 'officer@dsu.example', full_name: 'Records Officer', roles: ['officer'] });
  const officer = client('dsu.localhost:3000');
  ok(await setup(officer, new URL(r.body.link).searchParams.get('token'), 'Officer2026x', 'Records Officer'), 'officer set up');

  // Role guard
  for (const p of ['/settings/branding', '/settings/signatories', '/settings/preview.pdf'])
    { r = await officer('GET', '/app-api' + p); ok(r.status === 403, 'officer blocked from ' + p); }
  r = await officer('POST', '/app-api/settings/logo', { image: b64('logo.png') });
  ok(r.status === 403, 'officer cannot upload logo');

  // Logo
  r = await owner('GET', '/app-api/settings/branding');
  ok(r.status === 200 && r.body.logo === null, 'branding: no logo yet');
  r = await owner('POST', '/app-api/settings/logo', { image: b64('fake.gif') });
  ok(r.status === 415, 'GIF rejected: ' + r.body.error);
  r = await owner('POST', '/app-api/settings/logo', { image: b64('broken.png') });
  ok(r.status === 415, 'damaged PNG rejected: ' + r.body.error);
  r = await owner('POST', '/app-api/settings/logo', { image: b64('big.png') });
  ok(r.status === 413, 'oversize logo rejected: ' + r.body.error);
  r = await owner('POST', '/app-api/settings/logo', { image: b64('logo.jpg') });
  ok(r.status === 200, 'JPEG logo accepted');
  r = await owner('POST', '/app-api/settings/logo', { image: b64('logo.png') });
  ok(r.status === 200, 'PNG logo replaces it');
  const anon = client('dsu.localhost:3000');
  r = await anon('GET', '/brand/logo');
  ok(r.status === 200 && r.ct === 'image/png' && r.body.length === fs.statSync(IMG + 'logo.png').size, 'public /brand/logo serves it');
  r = await client('demo.localhost:3000')('GET', '/brand/logo');
  ok(r.status === 404, 'demo tenant has no logo (no cross-tenant leak)');
  r = await anon('GET', '/api/tenant-info');
  ok(typeof r.body.logo_version === 'number', 'tenant-info logo_version ' + r.body.logo_version);
  r = await owner('GET', '/app-api/auth/me');
  ok(typeof r.body.tenant.logo_version === 'number', '/me logo_version');

  // Body limit only widened on settings
  r = await owner('POST', '/app-api/documents', null, JSON.stringify({ doc_type: 'Certificate', title: 'x'.repeat(200 * 1024) }));
  ok(r.status === 413, 'large body still rejected outside settings (' + r.status + ')');

  // Colours
  r = await owner('PATCH', '/app-api/settings/colours', { primary_colour: '#FFEE88', accent_colour: '#C9A84C' });
  ok(r.status === 400, 'too-light main colour rejected: ' + r.body.error);
  r = await owner('PATCH', '/app-api/settings/colours', { primary_colour: 'red', accent_colour: '#C9A84C' });
  ok(r.status === 400, 'non-hex colour rejected');
  r = await owner('PATCH', '/app-api/settings/colours', { primary_colour: '#5a1e2b', accent_colour: '#d4a017' });
  ok(r.status === 200, 'colours saved');
  r = await anon('GET', '/api/tenant-info');
  ok(r.body.primary_colour === '#5A1E2B', 'tenant cache cleared, new colour live');

  // Signatories: validation
  const base = { slot: 1, full_name: 'Mrs Old Registrar', title: 'Registrar', effective_from: '2020-01-01', image: b64('sig_old.png') };
  for (const [patch, label] of [[{ slot: 3 }, 'bad slot'], [{ full_name: '' }, 'no name'], [{ doc_types: ['Bogus'] }, 'bad doc type'],
       [{ effective_from: '' }, 'no start'], [{ effective_to: '2019-01-01' }, 'end before start'], [{ image: '' }, 'no image'],
       [{ image: b64('fake.gif') }, 'gif signature']]) {
    r = await owner('POST', '/app-api/settings/signatories', { ...base, ...patch });
    ok(r.status >= 400 && r.status < 500, 'signatory rejected: ' + label + ' (' + r.body.error + ')');
  }
  const add = async (o, label) => { const x = await owner('POST', '/app-api/settings/signatories', o); ok(x.status === 201, 'added ' + label); return x.body.signatory; };
  const sOld  = await add({ ...base, effective_to: '2024-12-31' }, 'old Registrar 2020-2024');
  const sNew  = await add({ ...base, full_name: 'Dr New Registrar', effective_from: '2025-01-01', image: b64('sig_new.png') }, 'new Registrar from 2025');
  const sCert = await add({ ...base, full_name: 'Prof Cert Signer', title: 'Registrar (Certificates)', effective_from: '2025-06-01', doc_types: ['Certificate'], image: b64('sig_cert.png') }, 'certificate-only Registrar from 2025-06');
  const sVc   = await add({ ...base, slot: 2, full_name: 'Prof VC', title: 'Vice-Chancellor', effective_from: '2020-01-01', image: b64('sig_vc.png') }, 'VC');
  const sFut  = await add({ ...base, slot: 2, full_name: 'Prof Future VC', title: 'Vice-Chancellor', effective_from: '2030-01-01', image: b64('sig_vc.png') }, 'future VC');

  r = await owner('GET', '/app-api/settings/signatories');
  const st = Object.fromEntries(r.body.signatories.map(s => [s.full_name, s.status]));
  ok(st['Mrs Old Registrar'] === 'retired' && st['Dr New Registrar'] === 'current' && st['Prof Future VC'] === 'scheduled', 'statuses ' + JSON.stringify(st));
  ok(!JSON.stringify(r.body).includes('image_data'), 'list has no image bytes');
  r = await owner('GET', `/app-api/settings/signatories/${sOld.id}/image`);
  ok(r.status === 200 && r.ct === 'image/png' && /no-store/.test(r.headers['cache-control']), 'owner can view signature image, no-store');
  r = await officer('GET', `/app-api/settings/signatories/${sOld.id}/image`);
  ok(r.status === 403, 'officer cannot fetch signature image');
  r = await client('demo.localhost:3000')('GET', `/app-api/settings/signatories/${sOld.id}/image`);
  ok(r.status === 401, 'other tenant, no session: 401');

  // PDF signatory selection (straight through loadBrand)
  const { loadBrand } = require('../src/utils/branding');
  const pick = async (type, date) => { const b = await loadBrand({ tenant_id: dsu.id, doc_type: type, issue_date: date }); return [b.slots[1] && b.slots[1].name, b.slots[2] && b.slots[2].name, b.legacy]; };
  let p = await pick('Transcript', '2023-05-01');
  ok(p[0] === 'Mrs Old Registrar' && p[1] === 'Prof VC' && !p[2], '2023 transcript -> old Registrar + VC');
  p = await pick('Certificate', '2025-03-01');
  ok(p[0] === 'Dr New Registrar', 'Mar 2025 certificate -> new Registrar');
  p = await pick('Certificate', '2025-07-01');
  ok(p[0] === 'Prof Cert Signer', 'Jul 2025 certificate -> type-specific beats all-types');
  p = await pick('Transcript', '2025-07-01');
  ok(p[0] === 'Dr New Registrar', 'Jul 2025 transcript -> all-types Registrar');
  p = await pick('Certificate', '2019-01-01');
  ok(p[0] === null && p[1] === null && p[2] === false, '2019: empty lines, never legacy for a real tenant');
  p = await pick('Certificate', '2031-01-01');
  ok(p[1] === 'Prof Future VC', '2031 -> future VC takes over');
  const demoT = (await admin('GET', '/admin-api/tenants')).body.tenants.find(t => t.subdomain === 'demo');
  const db = await loadBrand({ tenant_id: demoT.id, doc_type: 'Certificate', issue_date: '2025-01-01' });
  ok(db.legacy === true, 'demo tenant with no signatories keeps legacy signature files');

  // Retire and delete
  r = await owner('POST', `/app-api/settings/signatories/${sCert.id}/retire`, { effective_to: '2025-01-01' });
  ok(r.status === 400, 'retire before start rejected');
  r = await owner('POST', `/app-api/settings/signatories/${sCert.id}/retire`, { effective_to: '2025-12-31' });
  ok(r.status === 200 && r.body.signatory.effective_to === '2025-12-31', 'retire certificate-only signer');
  p = await pick('Certificate', '2026-02-01');
  ok(p[0] === 'Dr New Registrar', 'after retirement, 2026 certificate -> all-types Registrar');
  p = await pick('Certificate', '2025-07-01');
  ok(p[0] === 'Prof Cert Signer', 'old certificate still keeps the retired signer');
  r = await owner('DELETE', `/app-api/settings/signatories/${sVc.id}`);
  ok(r.status === 409, 'cannot delete a signature already in use');
  r = await owner('DELETE', `/app-api/settings/signatories/${sFut.id}`);
  ok(r.status === 200, 'delete a scheduled signature');

  // Preview and real PDFs
  for (const t of ['Certificate', 'Transcript', 'Attestation']) {
    r = await owner('GET', `/app-api/settings/preview.pdf?type=${t}&date=2025-07-01`);
    ok(r.status === 200 && r.ct === 'application/pdf' && r.body.slice(0, 4).toString() === '%PDF', 'specimen ' + t);
    fs.writeFileSync(OUT + `specimen-${t}.pdf`, r.body);
  }
  r = await owner('POST', '/app-api/documents', { doc_type: 'Certificate', title: 'Bachelor of Science (B.Sc.) Economics', issued_to: 'Chiamaka Obi', matric_number: 'ECO/2021/014', programme: 'Economics', faculty: 'Social Sciences', degree_class: 'Second Class Upper', graduation_year: '2025' });
  const docId = r.body.document.doc_id;
  r = await owner('GET', `/app-api/documents/${docId}/pdf`);
  ok(r.status === 200, 'real certificate PDF with branding');
  fs.writeFileSync(OUT + 'real-cert.pdf', r.body);
  r = await owner('POST', '/app-api/documents', { doc_type: 'Transcript', title: 'Academic Transcript', issued_to: 'Chiamaka Obi', matric_number: 'ECO/2021/014', programme: 'Economics' });
  r = await owner('GET', `/app-api/documents/${r.body.document.doc_id}/pdf`);
  fs.writeFileSync(OUT + 'real-transcript.pdf', r.body);
  ok(r.status === 200, 'real transcript PDF with branding');

  // Audit trail
  r = await owner('GET', '/app-api/activity?limit=100');
  const acts = new Set((r.body.data || []).map(a => a.action));
  for (const a of ['logo_updated', 'colours_updated', 'signatory_added', 'signatory_retired', 'signatory_deleted'])
    ok(acts.has(a), 'activity logged: ' + a);

  // Logo removal
  r = await owner('DELETE', '/app-api/settings/logo');
  r = await anon('GET', '/brand/logo');
  ok(r.status === 404, 'logo removed');
  r = await owner('POST', '/app-api/settings/logo', { image: b64('logo.png') });
  process.exit();
})().catch(e => { console.error(e); process.exit(1); });
