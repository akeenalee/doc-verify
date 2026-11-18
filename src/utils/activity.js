// Staff activity log: every staff action, who did it, on what, and why.
// Failures here never break the action itself; they are logged to stderr.

const pool = require('../db/pool');
const { count } = require('../telemetry');

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || null;
}

async function logActivity(req, { action, targetType = null, targetId = null, detail = {}, actor = null, userId = null }) {
  const tenantId = req.tenant?.id;
  if (!tenantId) return;
  const staff = req.staff || null;
  count('activity', { tenant: req.tenant?.subdomain, action });
  try {
    await pool.query(
      `INSERT INTO activity_log (tenant_id, user_id, actor, action, target_type, target_id, detail, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tenantId, userId || staff?.id || null,
       actor || staff?.email || 'system', action, targetType, targetId,
       JSON.stringify(detail || {}), clientIp(req)]
    );
  } catch (e) {
    console.error('Activity log error:', e.message);
  }
}

module.exports = { logActivity, clientIp };
