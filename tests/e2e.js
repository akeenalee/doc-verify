// End-to-end API test against a local server on :3000
const A = require('../src/utils/staffAuth');
const BASE = 'http://localhost:3000';
const http = require('http');
function client(host) {
  let cookie = '';
  const fn = (method, path, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: 'localhost', port: 3000, method, path,
      headers: { Host: host, Accept: 'application/json', 'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => {
        const sc = res.headers['set-cookie']; if (sc) cookie = sc[0].split(';')[0];
        const raw = Buffer.concat(chunks); const ct = res.headers['content-type'] || '';
        let b = raw.toString(); if (ct.includes('json')) { try { b = JSON.parse(b); } catch (e) {} }
        resolve({ status: res.statusCode, body: b, headers: { get: k => res.headers[k.toLowerCase()] } });
      });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
  fn.cookieOf = () => cookie;
  return fn;
}
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const admin = client('demo.localhost:3000');
  let r = await admin('POST', '/admin-api/login', { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS });
  ok(r.status === 200, 'IL admin login on demo');
  r = await admin('GET', '/admin-api/tenants');
  const dsu = r.body.tenants.find(t => t.subdomain === 'dsu');
  r = await admin('POST', `/admin-api/tenants/${dsu.id}/owner-invite`, { email: 'Registrar@dsu.example', full_name: 'Dr Registrar' });
  ok(r.status === 201 && r.body.link.startsWith('http://dsu.localhost:3000/app/invite.html?token='), 'owner invite link ' + r.body.link);
  const token = new URL(r.body.link).searchParams.get('token');
  r = await admin('POST', `/admin-api/tenants/${dsu.id}/owner-invite`, { email: 'registrar@dsu.example' });
  ok(r.status === 409, 'duplicate owner invite rejected');

  const owner = client('dsu.localhost:3000');
  r = await owner('GET', '/app-api/auth/invite?token=' + token);
  ok(r.status === 200 && r.body.roles[0] === 'owner', 'invite lookup ' + r.status + JSON.stringify(r.body).slice(0,200));
  const other = client('demo.localhost:3000');
  r = await other('GET', '/app-api/auth/invite?token=' + token);
  ok(r.status === 404, 'invite token not valid on another tenant');
  r = await owner('POST', '/app-api/auth/invite/start', { token, password: 'short', full_name: 'Dr Registrar' });
  ok(r.status === 400, 'weak password rejected');
  r = await owner('POST', '/app-api/auth/invite/start', { token, password: 'Registrar2026', full_name: 'Dr Registrar' });
  ok(r.status === 200 && r.body.secret && r.body.qr.startsWith('data:image/png'), 'TOTP enrolment started');
  const secret = r.body.secret;
  r = await owner('POST', '/app-api/auth/invite/confirm', { token, code: '000000' });
  ok(r.status === 401, 'wrong TOTP rejected at setup');
  r = await owner('POST', '/app-api/auth/invite/confirm', { token, code: A.hotp(secret, Math.floor(Date.now() / 30000)) });
  ok(r.status === 200 && r.body.recovery_codes.length === 10, 'setup confirmed, 10 recovery codes');
  const recovery = r.body.recovery_codes;
  r = await owner('GET', '/app-api/auth/invite?token=' + token);
  ok(r.status === 404, 'invite link single-use');
  r = await owner('GET', '/app-api/auth/me');
  ok(r.status === 200 && r.body.user.roles.includes('owner'), 'signed in after setup');

  // Issue, revoke, restore, reissue
  r = await owner('POST', '/app-api/documents', { doc_type: 'Certificate', title: 'BSc Computer Science', issued_to: 'Amina Ibrahim', matric_number: 'cs/2020/001', programme: 'Computer Science', degree_class: 'First Class' });
  ok(r.status === 201 && r.body.document.doc_id.startsWith('DSU-') && r.body.document.issued_by === 'Demo State University', 'issue document ' + (r.body.document && r.body.document.doc_id));
  const docId = r.body.document.doc_id;
  r = await owner('POST', '/app-api/documents', { doc_type: 'Nonsense', title: 'x', issued_to: 'y' });
  ok(r.status === 400, 'invalid issue rejected: ' + r.body.error);
  r = await owner('GET', '/app-api/documents');
  ok(r.status === 200 && r.body.total === 1, 'documents list');
  r = await owner('GET', `/app-api/documents/${docId}/pdf`);
  ok(r.status === 200 && r.headers.get('content-type') === 'application/pdf', 'PDF download');
  r = await owner('GET', `/app-api/documents/${docId}/qr?size=print`);
  ok(r.status === 200 && r.headers.get('content-type') === 'image/png', 'print QR');
  r = await owner('POST', `/app-api/documents/${docId}/revoke`, { reason: 'other' });
  ok(r.status === 400, 'revoke Other without note rejected');
  r = await owner('POST', `/app-api/documents/${docId}/revoke`, { reason: 'issued_in_error' });
  ok(r.status === 200 && r.body.document.status === 'revoked', 'revoke');
  r = await owner('GET', `/app-api/documents/${docId}`);
  ok(r.body.can_restore === true, 'can restore within 7 days');
  r = await owner('POST', `/app-api/documents/${docId}/restore`, { note: 'Revoked by mistake' });
  ok(r.status === 200 && r.body.document.status === 'active', 'restore');
  r = await owner('POST', `/app-api/documents/${docId}/reissue`, { doc_type: 'Certificate', title: 'BSc Computer Science', issued_to: 'Amina B. Ibrahim', matric_number: 'CS/2020/001', note: 'Middle initial added' });
  ok(r.status === 201 && r.body.document.replaces_doc_id === docId, 'reissue');
  const newId = r.body.document.doc_id;
  r = await owner('GET', `/app-api/documents/${docId}`);
  ok(r.body.document.status === 'superseded' && r.body.document.superseded_by === newId, 'old doc superseded');
  r = await owner('POST', `/app-api/documents/${docId}/reissue`, { doc_type: 'Certificate', title: 't', issued_to: 'x', matric_number: 'Y', note: 'n' });
  ok(r.status === 409, 'cannot reissue twice');

  // Verify page for superseded doc: no holder data, no payment
  const pub = client('dsu.localhost:3000');
  r = await pub('GET', `/verify?doc=${docId}`);
  ok(r.status === 200 && r.body.includes('Superseded') && !r.body.includes('Amina'), 'verify: superseded page hides holder');
  r = await pub('GET', `/verify?doc=${newId}&sig=deadbeefdeadbeef`);
  ok(r.status === 400, 'verify: tampered sig');
  r = await pub('GET', `/verify?doc=${newId}`);
  ok(r.status === 302 && !r.headers.get('location').includes('Amina') && r.headers.get('location').includes('issued_by='), 'verify: pay redirect without holder name');
  r = await pub('GET', `/verify/api/${newId}`);
  ok(r.status === 200 && !r.body.document.issued_to, 'verify api: no holder data for public');
  r = await owner('GET', `/verify/api/${newId}`);
  ok(r.status === 200 && r.body.document.issued_to === 'Amina B. Ibrahim', 'verify api: holder data for staff');

  // Search, scans, activity
  r = await owner('GET', '/app-api/search?q=amina');
  ok(r.status === 200 && r.body.results.length === 2, 'search');
  r = await owner('GET', '/app-api/scans');
  ok(r.status === 200 && r.body.data.some(s => s.result === 'tampered') && r.body.data.some(s => s.result === 'superseded'), 'scan log has tampered + superseded');
  r = await owner('GET', '/app-api/activity');
  const actions = r.body.data.map(a => a.action);
  ok(['document_issued', 'document_revoked', 'document_restored', 'document_reissued', 'document_superseded', 'search', 'pdf_downloaded', 'account_setup_completed'].every(a => actions.includes(a)), 'activity log covers actions');
  r = await owner('GET', '/app-api/dashboard');
  ok(r.status === 200 && r.body.documents.active === '1', 'dashboard');

  // Users: invite an auditor, check role limits
  r = await owner('POST', '/app-api/users', { email: 'audit@dsu.example', full_name: 'Audit Person', roles: ['auditor'] });
  ok(r.status === 201, 'invite auditor');
  const aTok = new URL(r.body.link).searchParams.get('token'); const auditorId = r.body.user.id;
  const aud = client('dsu.localhost:3000');
  r = await aud('POST', '/app-api/auth/invite/start', { token: aTok, password: 'Auditor2026x', full_name: 'Audit Person' });
  const aSecret = r.body.secret;
  r = await aud('POST', '/app-api/auth/invite/confirm', { token: aTok, code: A.hotp(aSecret, Math.floor(Date.now() / 30000)) });
  ok(r.status === 200, 'auditor setup');
  r = await aud('POST', '/app-api/documents', { doc_type: 'Certificate', title: 't', issued_to: 'x', matric_number: 'Y' });
  ok(r.status === 403, 'auditor cannot issue');
  r = await aud('GET', '/app-api/activity');
  ok(r.status === 200, 'auditor can read activity');
  r = await aud('GET', '/app-api/users');
  ok(r.status === 403, 'auditor cannot manage users');
  const ownerList = await owner('GET', '/app-api/users');
  const ownerId = ownerList.body.users.find(u => u.roles.includes('owner')).id;
  r = await owner('PATCH', `/app-api/users/${ownerId}/roles`, { roles: ['officer'] });
  ok(r.status === 409, 'last owner protected');
  r = await owner('POST', `/app-api/users/${auditorId}/status`, { enabled: false });
  ok(r.status === 200 && r.body.user.status === 'disabled', 'disable auditor');
  r = await aud('GET', '/app-api/dashboard');
  ok(r.status === 401, 'disabled user kicked out immediately');

  // Sign in again with password + TOTP, then recovery code; lockout
  const fresh = client('dsu.localhost:3000');
  r = await fresh('POST', '/app-api/auth/verify', { code: '123456' });
  ok(r.status === 401 && r.body.restart, 'verify without password step rejected');
  r = await fresh('POST', '/app-api/auth/login', { email: 'registrar@dsu.example', password: 'Registrar2026' });
  ok(r.status === 200 && r.body.next === 'totp', 'password step');
  r = await fresh('POST', '/app-api/auth/verify', { recovery_code: recovery[0].toLowerCase().replace('-', '') });
  ok(r.status === 200 && r.body.recovery_codes_left === 9, 'recovery code sign-in');
  const again = client('dsu.localhost:3000');
  await again('POST', '/app-api/auth/login', { email: 'registrar@dsu.example', password: 'Registrar2026' });
  r = await again('POST', '/app-api/auth/verify', { recovery_code: recovery[0] });
  ok(r.status === 401, 'used recovery code rejected');

  // Cross-tenant session use
  r = await fresh('GET', '/app-api/dashboard');
  ok(r.status === 200, 'owner session works on dsu');
  const sid = await new Promise(res => { const c = client('demo.localhost:3000'); res(c); });
  // reuse the owner's cookie on another tenant's host
  r = await new Promise(resolve => http.get({ host: 'localhost', port: 3000, path: '/app-api/dashboard',
    headers: { Host: 'demo.localhost:3000', Accept: 'application/json', cookie: fresh.cookieOf() } }, x => resolve({ status: x.statusCode })));
  ok(r.status === 401 || r.status === 403, 'session not usable on another tenant');
  console.log('done');
})().catch(e => { console.error(e); process.exitCode = 1; });
