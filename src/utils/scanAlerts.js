// Scan anomaly alerts (Phase 4b). A printed QR can be photocopied onto a
// fake, so instead of single-use codes (a certificate must verify for
// decades) we watch how each document is scanned and tell the school when
// the pattern looks wrong:
//   many_scans   SCAN_ALERT_COUNT or more scans in 24 hours (default 20)
//   many_places  scans from SCAN_ALERT_PLACES or more cities in 24 hours (default 3)
//   tampered     a link for a real document whose signature didn't check out
// One open alert per document and kind. Once a school acknowledges an
// alert, the same kind stays quiet for that document for 24 hours.

const pool = require('../db/pool');
const { sendScanAlert } = require('./mailer');

const COUNT  = () => parseInt(process.env.SCAN_ALERT_COUNT) || 20;
const PLACES = () => parseInt(process.env.SCAN_ALERT_PLACES) || 3;
const IGNORED_PLACES = ['Unknown', 'Local'];

async function checkScanAlerts(docId, result) {
  if (!['found', 'revoked', 'tampered', 'old_link'].includes(result)) return [];
  const d = (await pool.query(
    `SELECT d.tenant_id, d.doc_id, d.issued_to, t.name AS tenant_name, t.subdomain
     FROM documents d JOIN tenants t ON t.id = d.tenant_id WHERE d.doc_id = $1`, [docId])).rows[0];
  if (!d) return [];
  const s = (await pool.query(
    `SELECT COUNT(*)::int AS n,
            COALESCE(array_agg(DISTINCT geo_location) FILTER (WHERE geo_location IS NOT NULL AND geo_location <> ALL($2)), '{}') AS places
     FROM verification_log WHERE doc_id = $1 AND verified_at > NOW() - interval '24 hours'`,
    [docId, IGNORED_PLACES])).rows[0];

  const want = [];
  if (result === 'tampered') want.push(['tampered', {}]);
  if (s.n >= COUNT()) want.push(['many_scans', { scans_24h: s.n }]);
  if (s.places.length >= PLACES()) want.push(['many_places', { places: s.places.slice(0, 10) }]);

  const raised = [];
  for (const [kind, detail] of want) {
    const r = await pool.query(
      `INSERT INTO scan_alerts (tenant_id, doc_id, kind, detail)
       SELECT $1::uuid, $2::varchar, $3::varchar, $4::jsonb
       WHERE NOT EXISTS (SELECT 1 FROM scan_alerts WHERE tenant_id = $1 AND doc_id = $2 AND kind = $3
                           AND acknowledged_at > NOW() - interval '24 hours')
       ON CONFLICT (tenant_id, doc_id, kind) WHERE acknowledged_at IS NULL DO NOTHING
       RETURNING id`, [d.tenant_id, docId, kind, JSON.stringify(detail)]);
    if (r.rows.length) raised.push(kind);
  }
  if (raised.length) {
    const owners = (await pool.query(
      `SELECT email FROM tenant_users WHERE tenant_id = $1 AND status = 'active'
         AND roles && ARRAY['owner','auditor']::text[]`, [d.tenant_id])).rows.map(r => r.email);
    if (owners.length) sendScanAlert({ to: owners, tenantName: d.tenant_name, subdomain: d.subdomain, docId, kinds: raised })
      .catch(() => {});
  }
  return raised;
}

module.exports = { checkScanAlerts };
