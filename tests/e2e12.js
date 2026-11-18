// Support tickets: school staff open and follow tickets in /app; Innovation
// Lens answers from /admin. Schools only ever see their own tickets.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DOC_SECRET = process.env.DOC_SECRET || 'testsecret';
const http = require('http');
const A = require('../src/utils/staffAuth');
const pool = require('../src/db/pool');

const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const code = s => A.hotp(s, Math.floor(Date.now() / 30000));

function client(host) {
  let cookie = '';
  return (method, path, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const origin = 'http://' + host;
    const req = http.request({ host: 'localhost', port: 3000, method, path,
      headers: { Host: host, Origin: origin, Accept: 'application/json', 'Content-Type': 'application/json',
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
async function setup(c, link, pw, name) {
  const token = new URL(link).searchParams.get('token');
  let r = await c('POST', '/app-api/auth/invite/start', { token, password: pw, full_name: name });
  r = await c('POST', '/app-api/auth/invite/confirm', { token, code: code(r.body.secret) });
  return r.status === 200;
}

(async () => {
  const admin = client('demo.localhost:3000');
  let r = await admin('POST', '/admin-api/login', { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS });
  const tenants = (await admin('GET', '/admin-api/tenants')).body.tenants;
  const dsu = tenants.find(t => t.subdomain === 'dsu');

  // A second school, to prove isolation
  r = await admin('POST', '/admin-api/tenants', { name: 'Demo College of Support', subdomain: 'dcs', short_code: 'DCS' });
  const other = r.body.tenant || (await admin('GET', '/admin-api/tenants')).body.tenants.find(t => t.subdomain === 'dcs');
  ok(!!other, 'second school ready');

  const inv = await admin('POST', `/admin-api/tenants/${dsu.id}/owner-invite`, { email: 'support.owner@dsu.example', full_name: 'Funke Registrar' });
  const owner = client('dsu.localhost:3000');
  ok(await setup(owner, inv.body.link, 'Support-pass-01', 'Funke Registrar'), 'dsu owner signed in');
  r = await owner('POST', '/app-api/users', { email: 'auditor.s@dsu.example', full_name: 'Audit Person', roles: ['auditor'] });
  const auditor = client('dsu.localhost:3000');
  ok(await setup(auditor, r.body.link, 'Support-pass-02', 'Audit Person'), 'dsu auditor signed in');
  r = await owner('POST', '/app-api/users', { email: 'print.s@printco.example', full_name: 'PrintCo', roles: ['vendor'] });
  const vendor = client('dsu.localhost:3000');
  ok(await setup(vendor, r.body.link, 'Support-pass-03', 'PrintCo'), 'print vendor signed in');

  const inv2 = await admin('POST', `/admin-api/tenants/${other.id}/owner-invite`, { email: 'owner@dcs.example', full_name: 'Other Owner' });
  const otherOwner = client('dcs.localhost:3000');
  ok(await setup(otherOwner, inv2.body.link, 'Support-pass-04', 'Other Owner'), 'second school owner signed in');

  // ── Opening tickets ──
  r = await owner('POST', '/app-api/support', { category: 'nope', subject: 'Help', message: 'Something is wrong here.' });
  ok(r.status === 400 && /category/.test(r.body.error), 'unknown category refused');
  r = await owner('POST', '/app-api/support', { category: 'technical', subject: 'Hi', message: 'Something is wrong here.' });
  ok(r.status === 400, 'too-short subject refused');
  r = await owner('POST', '/app-api/support', { category: 'technical', subject: 'Bulk upload stops', message: 'short' });
  ok(r.status === 400, 'too-short message refused');
  r = await owner('POST', '/app-api/support', { category: 'documents', subject: 'Bulk upload stops at row 40 <script>', priority: 'urgent',
    message: 'We upload class-2025.csv and it stops at row 40.\n\nNo error shows.', page: '#/batches' });
  ok(r.status === 201 && r.body.ticket.ticket_no >= 1001 && r.body.ticket.priority === 'urgent' && r.body.ticket.status === 'open', `ticket #${r.body.ticket && r.body.ticket.ticket_no} opened, urgent`);
  ok(!/[<>]/.test(r.body.ticket.subject), 'angle brackets cleaned from the subject');
  const tid = r.body.ticket.id;
  r = await vendor('POST', '/app-api/support', { category: 'technical', subject: 'Pack will not open', message: 'The zip will not open on our PC.' });
  ok(r.status === 403, 'print vendor cannot open tickets (goes through the school)');
  r = await vendor('GET', '/app-api/support');
  ok(r.status === 403, 'print vendor cannot list tickets');

  // ── School side ──
  r = await auditor('GET', '/app-api/support');
  ok(r.status === 200 && r.body.tickets.length === 1 && r.body.tickets[0].created_by_name === 'Funke Registrar', 'a colleague sees the school\'s ticket');
  r = await auditor('GET', '/app-api/support/' + tid);
  ok(r.status === 200 && r.body.messages.length === 1 && /row 40\.\n\nNo error/.test(r.body.messages[0].body), 'thread keeps line breaks');
  r = await otherOwner('GET', '/app-api/support');
  ok(r.status === 200 && r.body.tickets.length === 0, 'another school sees none of dsu\'s tickets');
  r = await otherOwner('GET', '/app-api/support/' + tid);
  ok(r.status === 404, 'another school cannot open the ticket');
  r = await otherOwner('POST', '/app-api/support/' + tid + '/reply', { message: 'Hijack' });
  ok(r.status === 404, 'another school cannot reply');
  r = await owner('GET', '/app-api/support/not-a-uuid');
  ok(r.status === 404, 'bad ticket id is a 404');

  // ── IL side ──
  r = await owner('GET', '/admin-api/support');
  ok(r.status === 401 || r.status === 403, 'school staff cannot reach the IL support API');
  const dsuAdmin = client('dsu.localhost:3000');
  r = await admin('GET', '/admin-api/support');
  ok(r.status === 200 && r.body.tickets.some(t => t.id === tid && t.tenant_name === dsu.name), 'IL sees the ticket with its school');
  ok(r.body.counts.open >= 1, 'open count for the tab badge');
  r = await admin('GET', '/admin-api/support/' + tid);
  ok(r.status === 200 && r.body.ticket.created_by_email === 'support.owner@dsu.example' && r.body.ticket.page === '#/batches', 'IL sees who opened it and from which page');
  r = await admin('POST', '/admin-api/support/' + tid + '/reply', { message: 'Row 41 has a comma in the name. Wrap it in quotes and upload again.' });
  ok(r.status === 200 && r.body.status === 'answered', 'IL reply marks it answered');
  r = await owner('GET', '/app-api/support/' + tid);
  ok(r.body.ticket.status === 'answered' && r.body.messages.at(-1).author_kind === 'support' && r.body.messages.at(-1).author_name === 'UniVerify Support', 'school sees the reply from UniVerify Support');
  r = await owner('POST', '/app-api/support/' + tid + '/reply', { message: 'That fixed it, thanks.' });
  ok(r.status === 200, 'school replies');
  r = await owner('GET', '/app-api/support/' + tid);
  ok(r.body.ticket.status === 'open', 'school reply puts it back to waiting on UniVerify');
  r = await admin('POST', '/admin-api/support/' + tid + '/reply', { message: 'Great. Closing this one.', resolve: true });
  ok(r.status === 200 && r.body.status === 'resolved', 'reply and resolve in one step');
  r = await admin('POST', '/admin-api/support/' + tid + '/resolve', {});
  ok(r.status === 409, 'cannot resolve twice');
  r = await admin('GET', '/admin-api/support');
  ok(!r.body.tickets.some(t => t.id === tid), 'resolved ticket leaves the needs-attention list');
  r = await admin('GET', '/admin-api/support?status=resolved');
  ok(r.body.tickets.some(t => t.id === tid), 'and shows under Resolved');
  r = await owner('POST', '/app-api/support/' + tid + '/reply', { message: 'One more thing, sorry.' });
  r = await owner('GET', '/app-api/support/' + tid);
  ok(r.body.ticket.status === 'open' && !r.body.ticket.resolved_at, 'a reply reopens a resolved ticket');
  r = await owner('POST', '/app-api/support/' + tid + '/close', {});
  ok(r.status === 200, 'school closes the ticket');
  r = await owner('POST', '/app-api/support/' + tid + '/reply', { message: 'Again' });
  ok(r.status === 409, 'no replies on a closed ticket');
  r = await admin('POST', '/admin-api/support/' + tid + '/reply', { message: 'Again' });
  ok(r.status === 409, 'IL cannot reply to a closed ticket either');

  // ── Activity and flood limit ──
  r = await owner('GET', '/app-api/activity');
  const acts = (r.body.data || r.body.activity || r.body.rows || []).map(a => a.action);
  ok(['support_ticket_opened', 'support_ticket_replied', 'support_ticket_closed'].every(a => acts.includes(a)), 'ticket steps in the activity log');
  for (let i = 0; i < 20; i++) await owner('POST', '/app-api/support', { category: 'other', subject: 'Question ' + i, message: 'A question for the team.' });
  r = await owner('POST', '/app-api/support', { category: 'other', subject: 'One too many', message: 'A question for the team.' });
  ok(r.status === 429, 'at most 20 open tickets per school');

  await pool.query(`DELETE FROM tenants WHERE subdomain = 'dcs'`);
  await pool.end();
  process.exit();
})().catch(e => { console.log('FAIL crashed: ' + e.stack); process.exit(1); });
