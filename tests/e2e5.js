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

  // ── Vendor role ──────────────────────────────────────────────────────────
  r = await owner('POST', '/app-api/users', { email: 'mix@printco.ng', full_name: 'Mixed', roles: ['vendor', 'officer'] });
  ok(r.status === 400, 'print vendor cannot be combined with staff roles');
  const vendor = await mk('jobs@printco.ng', 'PrintCo Ltd', ['vendor']);
  r = await vendor('GET', '/app-api/auth/me');
  ok(r.status === 200 && r.body.user.roles[0] === 'vendor', 'vendor signs in');
  r = await vendor('GET', '/app-api/meta');
  ok(r.status === 200, 'vendor can load app metadata');
  for (const [m, p] of [['GET', '/app-api/dashboard'], ['GET', '/app-api/documents'], ['GET', '/app-api/search?q=abc'],
    ['GET', '/app-api/scans'], ['GET', '/app-api/batches'], ['GET', '/app-api/alerts'], ['GET', '/app-api/activity'],
    ['GET', '/app-api/settings/security'], ['POST', '/app-api/documents'], ['PUT', '/app-api/print/specs/Certificate']]) {
    r = await vendor(m, p, m === 'GET' ? undefined : {});
    ok(r.status === 403, `vendor refused: ${m} ${p.split('?')[0]}`);
  }
  r = await vendor('GET', '/app-api/print/jobs');
  ok(r.status === 200 && Array.isArray(r.body.jobs), 'vendor sees print jobs');

  // Approval still needs two internal users: owner + vendor isn't enough
  const solo = await pool.query("SELECT COUNT(*)::int n FROM tenant_users WHERE tenant_id=$1 AND status='active' AND NOT ('vendor' = ANY(roles))", [dsu.id]);
  ok(solo.rows[0].n === 2, 'vendor not counted as staff for approval rules');

  // ── Placement specs ──────────────────────────────────────────────────────
  r = await owner('GET', '/app-api/print/specs');
  ok(r.status === 200 && r.body.specs.Certificate.size_mm === 30 && r.body.specs.Certificate.custom === false && r.body.specs.Certificate.module_mm >= 0.4,
     `default spec 30 mm, dot ${r.body.specs.Certificate.module_mm} mm`);
  r = await owner('PUT', '/app-api/print/specs/Certificate', { paper: 'A4', anchor: 'bottom-left', x_mm: 20, y_mm: 18, size_mm: 21 });
  ok(r.status === 400 && /dot/.test(r.body.error), 'too-small QR refused: ' + r.body.error);
  r = await owner('PUT', '/app-api/print/specs/Certificate', { paper: 'A4', anchor: 'bottom-left', x_mm: 200, y_mm: 18, size_mm: 30 });
  ok(r.status === 400, 'QR off the page refused');
  r = await owner('PUT', '/app-api/print/specs/Nope', { paper: 'A4', anchor: 'bottom-left', x_mm: 20, y_mm: 18, size_mm: 30 });
  ok(r.status === 400, 'unknown doc type refused');
  r = await officer('PUT', '/app-api/print/specs/Certificate', { paper: 'A4', anchor: 'bottom-left', x_mm: 20, y_mm: 18, size_mm: 30 });
  ok(r.status === 403, 'officer cannot change placement');
  r = await owner('PUT', '/app-api/print/specs/Certificate', { paper: 'A4', anchor: 'bottom-left', x_mm: 20, y_mm: 18, size_mm: 32, notes: 'Gold seal sits top right.' });
  ok(r.status === 200 && r.body.spec.size_mm === 32 && r.body.spec.custom, 'owner saves placement');
  r = await vendor('GET', '/app-api/print/specs/Certificate/sheet.pdf');
  ok(r.status === 200 && /pdf/.test(r.ct) && r.body.slice(0, 4).toString() === '%PDF', 'vendor gets spec sheet PDF');

  // ── Print pack ───────────────────────────────────────────────────────────
  r = await officer('POST', '/app-api/batches', { doc_type: 'Certificate', file_name: 'grads.csv',
    csv: 'full_name,matric_number,title,degree_class,programme,graduation_year\nAmina Bello,CSC/1,BSc Computer Science,First Class,Computer Science,2025\n' +
         'Tunde Ade,CSC/2,BSc Computer Science,Second Class Upper,Computer Science,2025\nChi Eze,CSC/3,BSc Computer Science,Third Class,Computer Science,2025\n' });
  const bid = r.body.batch.id;
  r = await officer('GET', '/app-api/print/jobs');
  ok(r.status === 200 && !r.body.unsent.some(u => u.id === bid), 'draft batch not offered to printers');
  r = await officer('POST', '/app-api/print/jobs', { vendor_id: '00000000-0000-0000-0000-000000000000', batch_id: bid });
  ok(r.status === 400, 'unknown vendor refused');
  r = await officer('GET', '/app-api/print/vendors');
  const vid = (r.body.vendors || []).find(v => v.email === 'jobs@printco.ng')?.id;
  ok(r.status === 200 && vid && r.body.vendors.length === 1, 'staff list active print vendors');
  r = await vendor('GET', '/app-api/print/vendors');
  ok(r.status === 403, 'vendor cannot list vendors');
  r = await officer('POST', '/app-api/print/jobs', { vendor_id: vid, batch_id: bid });
  ok(r.status === 400, 'batch must be issued before it goes to a printer');
  await officer('POST', `/app-api/batches/${bid}/submit`);
  const docs = (await pool.query(`SELECT doc_id, metadata FROM documents WHERE batch_id = $1 ORDER BY doc_id`, [bid])).rows;
  const revoked = docs.find(d => d.metadata.matric_number === 'CSC/3').doc_id;
  await officer('POST', `/app-api/documents/${revoked}/revoke`, { reason: 'issued_in_error' });

  r = await officer('GET', '/app-api/print/jobs');
  ok(r.body.unsent.some(u => u.id === bid && u.issued_count === 3), 'issued batch waits under Ready to send');
  r = await vendor('GET', '/app-api/print/jobs');
  ok(r.body.jobs.length === 0 && !('unsent' in r.body), 'vendor sees nothing until a job is sent to them');
  r = await vendor('POST', '/app-api/print/jobs', { vendor_id: vid, batch_id: bid });
  ok(r.status === 403, 'vendor cannot create jobs');
  r = await officer('POST', '/app-api/print/jobs', { vendor_id: vid, batch_id: bid, note: 'Cream stock. Collect Friday.' });
  ok(r.status === 201 && r.body.job.status === 'assigned' && r.body.job.documents === 2, 'batch sent to the vendor (revoked one left out)');
  const jid = r.body.job.id;
  r = await officer('GET', '/app-api/print/jobs');
  ok(!r.body.unsent.some(u => u.id === bid), 'sent batch leaves Ready to send');

  // A second printer must never see the first one's job
  const vendor2 = await mk('ops@otherprint.ng', 'OtherPrint', ['vendor']);
  r = await vendor2('GET', '/app-api/print/jobs');
  ok(r.body.jobs.length === 0, 'other vendor does not see the job');
  r = await vendor2('GET', `/app-api/print/jobs/${jid}/pack.zip`);
  ok(r.status === 404, 'other vendor cannot download the pack');
  r = await vendor2('POST', `/app-api/print/jobs/${jid}/printed`);
  ok(r.status === 404, 'other vendor cannot touch the job');

  r = await vendor('GET', '/app-api/print/jobs');
  ok(r.body.jobs.length === 1 && r.body.jobs[0].note === 'Cream stock. Collect Friday.' && !('vendor_email' in r.body.jobs[0]), 'vendor sees its job and the note');
  r = await vendor('POST', `/app-api/print/jobs/${jid}/printed`);
  ok(r.status === 409, 'cannot mark printed before downloading');
  r = await vendor('GET', `/app-api/print/jobs/${jid}/pack.zip`);
  ok(r.status === 200 && /zip/.test(r.ct), 'vendor downloads print pack');
  const dir = require('./out') + 'pack'; execSync(`rm -rf ${dir} && mkdir -p ${dir}`);
  fs.writeFileSync(dir + '.zip', r.body);
  execSync(`cd ${dir} && unzip -q ../pack.zip`);
  const files = execSync(`cd ${dir} && find . -type f | sort`).toString().trim().split('\n');
  ok(files.length === 7 && files.filter(f => f.endsWith('.svg')).length === 2 && files.filter(f => f.endsWith('.png')).length === 2,
     `pack has 2 SVG, 2 PNG, manifest, spec, readme (revoked one left out): ${files.length} files`);
  const manifest = fs.readFileSync(dir + '/manifest.csv', 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
  ok(manifest.length === 3 && manifest[0].startsWith('row,doc_id,full_name') && manifest.slice(1).every(l => /bottom-left,20,18,32,/.test(l)),
     'manifest rows carry the placement');
  ok(!manifest.join('\n').includes(revoked), 'revoked document not in manifest');
  const png = fs.readFileSync(dir + '/' + files.find(f => f.endsWith('.png')));
  const w = png.readUInt32BE(16);
  ok(w === Math.round(32 / 25.4 * 600), `PNG is 600 dpi at 32 mm (${w} px)`);
  const svg = fs.readFileSync(dir + '/' + files.find(f => f.endsWith('.svg')), 'utf8');
  ok(svg.startsWith('<svg') && svg.includes('viewBox'), 'SVG is a vector QR');
  const url = manifest[1].split(',').pop();
  r = await client('dsu.localhost:3000')('GET', path(url));
  ok(r.status === 302, 'manifest link verifies (v2 signature)');
  ok(fs.readFileSync(dir + '/placement-spec.pdf').slice(0, 4).toString() === '%PDF', 'spec sheet in pack');
  const readme = fs.readFileSync(dir + '/README.txt', 'utf8');
  ok(/Download 1 of 3/.test(readme) && /holograms/i.test(readme), 'readme states the download count and the keep-clear rule');
  const acts = await pool.query(`SELECT actor, detail FROM activity_log WHERE action = 'print_pack_downloaded' AND target_id = $1`, [jid]);
  ok(acts.rows.some(a => a.actor === 'jobs@printco.ng' && a.detail.download === '1 of 3'), 'pack download logged against the vendor, with the count');

  // Download cap
  r = await vendor('GET', `/app-api/print/jobs/${jid}/pack.zip`); ok(r.status === 200, 'second download allowed');
  r = await officer('GET', `/app-api/print/jobs/${jid}/pack.zip`); ok(r.status === 200, 'staff download does not count');
  r = await vendor('GET', `/app-api/print/jobs/${jid}/pack.zip`); ok(r.status === 200, 'third download allowed');
  r = await vendor('GET', `/app-api/print/jobs/${jid}/pack.zip`);
  ok(r.status === 410 && /3 times/.test(r.body.error), 'fourth download refused');
  r = await vendor('GET', '/app-api/print/jobs');
  ok(r.body.jobs[0].download_count === 3 && r.body.jobs[0].locked && r.body.jobs[0].status === 'downloaded', 'job shows 3 of 3, locked');

  // Status flow
  r = await officer('POST', `/app-api/print/jobs/${jid}/printed`);
  ok(r.status === 403, 'only the vendor marks a job printed');
  r = await vendor('POST', `/app-api/print/jobs/${jid}/delivered`);
  ok(r.status === 403, 'vendor cannot confirm delivery');
  r = await vendor('POST', `/app-api/print/jobs/${jid}/printed`);
  ok(r.status === 200 && r.body.job.status === 'printed', 'vendor marks printed');
  r = await officer('POST', `/app-api/print/jobs/${jid}/delivered`);
  ok(r.status === 200 && r.body.job.status === 'delivered' && r.body.job.locked, 'school confirms delivery, pack locked');
  r = await officer('POST', `/app-api/print/jobs/${jid}/reissue`, { reason: 'Two sheets misprinted' });
  ok(r.status === 200 && r.body.job.status === 'assigned' && r.body.job.download_count === 0 && !r.body.job.locked, 'reissue resets the count');
  r = await vendor('GET', `/app-api/print/jobs/${jid}/pack.zip`); ok(r.status === 200, 'vendor downloads the reissued pack');
  await pool.query(`UPDATE print_jobs SET expires_at = NOW() - interval '1 minute' WHERE id = $1`, [jid]);
  r = await vendor('GET', `/app-api/print/jobs/${jid}/pack.zip`);
  ok(r.status === 410 && /expired/.test(r.body.error), 'expired pack refused');
  r = await officer('POST', `/app-api/print/jobs/${jid}/cancel`, { reason: 'Wrong printer' });
  ok(r.status === 200 && r.body.job.status === 'cancelled', 'staff cancel a job');
  r = await vendor('GET', '/app-api/print/jobs');
  ok(r.body.jobs.length === 0, 'cancelled job disappears for the vendor');
  r = await officer('GET', '/app-api/print/jobs');
  ok(r.body.unsent.some(u => u.id === bid), 'batch of a cancelled job can be sent again');
  r = await officer('POST', `/app-api/print/jobs/${jid}/delivered`);
  ok(r.status === 409, 'cancelled job cannot move on');
  const logged = (await pool.query(`SELECT action FROM activity_log WHERE target_id = $1 ORDER BY id`, [jid])).rows.map(x => x.action);
  ok(['print_job_created', 'print_job_printed', 'print_job_delivered', 'print_job_reissued', 'print_job_cancelled'].every(a => logged.includes(a)), 'every step logged');

  // Single documents
  r = await officer('POST', '/app-api/print/jobs', { vendor_id: vid, doc_ids: [docs.find(d => d.doc_id !== revoked).doc_id] });
  ok(r.status === 201 && r.body.job.documents === 1, 'single document sent to the printer');
  r = await officer('POST', '/app-api/print/jobs', { vendor_id: vid, doc_ids: [revoked] });
  ok(r.status === 400, 'revoked document cannot be printed');
  r = await officer('POST', '/app-api/documents', { doc_type: 'Transcript', title: 'Transcript', issued_to: 'Amina Bello', matric_number: 'CSC/1T' });
  const tdoc = r.body.document.doc_id;
  r = await officer('POST', '/app-api/print/jobs', { vendor_id: vid, doc_ids: [docs[0].doc_id === revoked ? docs[1].doc_id : docs[0].doc_id, tdoc] });
  ok(r.status === 400 && /one document type/.test(r.body.error), 'mixed document types refused');
  await owner('POST', `/app-api/users/${vid}/status`, { enabled: false });
  r = await officer('POST', '/app-api/print/jobs', { vendor_id: vid, doc_ids: [tdoc] });
  ok(r.status === 400, 'disabled vendor cannot be sent jobs');
  await owner('POST', `/app-api/users/${vid}/status`, { enabled: true });

  r = await owner('GET', '/app-api/print/specs/Certificate/sheet.pdf');
  ok(r.status === 200, 'spec sheet still builds with the keep-clear rule');

  r = await officer('GET', `/app-api/documents/${docs[0].doc_id}/qr?format=svg`);
  ok(r.status === 200 && /svg/.test(r.ct), 'single document QR as SVG');
  r = await vendor('GET', `/app-api/documents/${docs[0].doc_id}/qr?format=svg`);
  ok(r.status === 403, 'vendor cannot pull single documents');

  // ── Disclosure ───────────────────────────────────────────────────────────
  const docA = docs.find(d => d.metadata.matric_number === 'CSC/1').doc_id;
  const full = (await pool.query('SELECT * FROM documents WHERE doc_id = $1', [docA])).rows[0];
  const vurl = await require('../src/utils/docUtils').buildVerifyUrl(full, 'dsu');
  await pool.query(`INSERT INTO student_tokens (matric_number, institution, pin_hash, pin_salt, tenant_id, token_balance)
                    VALUES ('CSC/1', $1, 'x', '', $2, 50)`, [dsu.name, dsu.id]);
  const pub = client('dsu.localhost:3000');
  r = await pub('GET', path(vurl));
  ok(r.status === 200 && r.body.includes('Amina Bello') && r.body.includes('docFrame') && !r.body.includes('First Class'),
     'default: name and PDF shown, class of degree hidden');
  const preview = (r.body.match(/\/verify\/doc-preview\/[^"]+/) || [''])[0].replace(/&amp;/g, '&');
  r = await owner('GET', '/app-api/settings/disclosure');
  ok(r.status === 200 && r.body.disclosure.holder_name === true && r.body.disclosure.class_of_degree === false, 'owner reads disclosure');
  r = await officer('PATCH', '/app-api/settings/disclosure', { holder_name: false });
  ok(r.status === 403, 'officer cannot change disclosure');
  r = await owner('PATCH', '/app-api/settings/disclosure', { holder_name: false, class_of_degree: true, graduation_year: true, document_pdf: false });
  ok(r.status === 200 && r.body.disclosure.holder_name === false, 'owner hides name and PDF, shows class and year');
  r = await pub('GET', path(vurl));
  ok(r.status === 200 && !r.body.includes('Amina Bello') && r.body.includes('First Class') && r.body.includes('2025') && !r.body.includes('docFrame'),
     'verify page follows the new disclosure');
  r = await pub('GET', preview);
  ok(r.status === 403, 'full PDF preview refused when the school hides it');
  await owner('PATCH', '/app-api/settings/disclosure', { holder_name: true, document_pdf: true });
  const dact = await pool.query(`SELECT detail FROM activity_log WHERE action = 'disclosure_updated' ORDER BY id DESC LIMIT 1`);
  ok(dact.rows.length && dact.rows[0].detail.changes.length === 2, 'disclosure change logged with what changed');

  // ── Scan alerts ──────────────────────────────────────────────────────────
  await pool.query('DELETE FROM verification_log WHERE doc_id = $1', [docA]);
  await pool.query(`INSERT INTO verification_log (doc_id, result, payment_method, tenant_id, geo_location)
                    SELECT $1, 'found', 'none', $2, 'Lagos, NG' FROM generate_series(1, 18)`, [docA, dsu.id]);
  r = await pub('GET', path(vurl));
  let al = (await owner('GET', '/app-api/alerts')).body.alerts;
  ok(!al.some(a => a.kind === 'many_scans'), '19 scans: no alert yet');
  r = await pub('GET', path(vurl));
  al = (await owner('GET', '/app-api/alerts')).body.alerts;
  ok(al.some(a => a.kind === 'many_scans' && a.doc_id === docA && a.detail.scans_24h === 20), '20th scan raises a many-scans alert');
  r = await pub('GET', path(vurl));
  al = (await owner('GET', '/app-api/alerts')).body.alerts;
  ok(al.filter(a => a.kind === 'many_scans').length === 1, 'one open alert per document, not one per scan');

  await pool.query(`INSERT INTO verification_log (doc_id, result, payment_method, tenant_id, geo_location)
                    VALUES ($1,'found','none',$2,'Abuja, NG'), ($1,'found','none',$2,'London, GB')`, [docA, dsu.id]);
  r = await pub('GET', path(vurl));
  al = (await owner('GET', '/app-api/alerts')).body.alerts;
  const places = al.find(a => a.kind === 'many_places');
  ok(places && places.detail.places.length === 3, 'three cities in 24 hours raise a many-places alert');

  r = await pub('GET', path(vurl).slice(0, -1) + (vurl.endsWith('0') ? '1' : '0'));
  al = (await owner('GET', '/app-api/alerts')).body.alerts;
  ok(al.some(a => a.kind === 'tampered' && a.doc_id === docA), 'tampered link raises an alert');

  r = await owner('GET', '/app-api/dashboard');
  ok(r.body.open_alerts === 3, 'dashboard counts 3 open alerts');
  const many = al.find(a => a.kind === 'many_scans');
  r = await officer('POST', `/app-api/alerts/${many.id}/acknowledge`, {});
  ok(r.status === 400, 'handling an alert needs a note');
  r = await officer('POST', `/app-api/alerts/${many.id}/acknowledge`, { note: 'Called the graduate: applying to many employers this week.' });
  ok(r.status === 200, 'officer marks alert handled');
  r = await officer('POST', `/app-api/alerts/${many.id}/acknowledge`, { note: 'again' });
  ok(r.status === 404, 'cannot handle twice');
  r = await pub('GET', path(vurl));
  al = (await owner('GET', '/app-api/alerts')).body.alerts;
  ok(!al.some(a => a.kind === 'many_scans'), 'handled alert stays quiet for 24 hours');
  r = await owner('GET', '/app-api/alerts?status=all');
  ok(r.body.alerts.some(a => a.kind === 'many_scans' && a.acknowledged_by === 'officer@dsu.example' && /employers/.test(a.note)), 'handled alert shows who and why');
  const ack = await pool.query(`SELECT COUNT(*)::int n FROM activity_log WHERE action = 'scan_alert_acknowledged'`);
  ok(ack.rows[0].n === 1, 'handling logged in activity');

  await pool.end();
  console.log('done');
})().catch(e => { console.error(e); process.exitCode = 1; });
