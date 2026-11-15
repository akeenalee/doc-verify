// Staff (tenant user) session guard for the /app staff app and /app-api.
// A staff session is bound to one tenant and re-checked against the DB on
// every request, so disabling a user or removing a role takes effect at once.

const pool = require('../db/pool');

const STAFF_IDLE_MS = 8 * 60 * 60 * 1000; // 8 hours
const ROLES = ['owner', 'officer', 'approver', 'auditor'];

function wantsJson(req) {
  return req.xhr || req.path.startsWith('/app-api') || req.originalUrl.startsWith('/app-api') ||
    (req.headers.accept && req.headers.accept.includes('application/json'));
}

function clearStaff(session) {
  delete session.staffUserId;
  delete session.staffTenantId;
  delete session.staffLastActivity;
}

// requireStaff()                 any active staff user of this tenant
// requireStaff('owner', 'auditor') at least one of these roles
function requireStaff(...allowed) {
  return async (req, res, next) => {
    const s = req.session;
    const deny = (status, error) => wantsJson(req)
      ? res.status(status).json({ error })
      : res.redirect('/app/login.html');

    if (!s || !s.staffUserId || !req.tenant) return deny(401, 'Please sign in.');
    if (s.staffTenantId !== req.tenant.id) return deny(403, 'This session belongs to another institution.');

    const now = Date.now();
    if (s.staffLastActivity && now - s.staffLastActivity > STAFF_IDLE_MS) {
      clearStaff(s);
      return deny(401, 'Session expired. Please sign in again.');
    }

    try {
      const r = await pool.query(
        `SELECT id, email, full_name, roles, status, totp_enabled FROM tenant_users
         WHERE id = $1 AND tenant_id = $2`,
        [s.staffUserId, req.tenant.id]
      );
      const user = r.rows[0];
      if (!user || user.status !== 'active' || !user.totp_enabled) {
        clearStaff(s);
        return deny(401, 'Your account is not active.');
      }
      if (allowed.length && !user.roles.some(role => allowed.includes(role))) {
        return res.status(403).json({ error: 'Your role does not allow this action.' });
      }
      s.staffLastActivity = now;
      req.staff = user;
      next();
    } catch (e) {
      next(e);
    }
  };
}

module.exports = { requireStaff, clearStaff, ROLES, STAFF_IDLE_MS };
