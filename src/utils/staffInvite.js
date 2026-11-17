// Create a staff invite (or refresh one) and return its single-use setup link.
// Used by an Owner inviting staff and by the IL admin inviting a first Owner.

const pool = require('../db/pool');
const { cleanText } = require('./text');
const { generateInviteToken } = require('./staffAuth');
const { sendStaffInvite } = require('./mailer');

const INVITE_HOURS = 72;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// baseUrl = the tenant's own origin, e.g. https://dsu.univerify.ng or
// http://dsu.localhost:3000 when testing locally
function inviteLink(baseUrl, token) {
  return `${String(baseUrl).replace(/\/+$/, '')}/app/invite.html?token=${token}`;
}

// New user. Throws { status, message } on bad input or a duplicate email.
async function createInvite(tenant, baseUrl, { email, full_name, roles, invitedBy }) {
  email = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) throw { status: 400, message: 'A valid email is required.' };
  const exists = await pool.query(
    'SELECT id FROM tenant_users WHERE tenant_id = $1 AND LOWER(email) = $2', [tenant.id, email]);
  if (exists.rows.length) throw { status: 409, message: 'That email already has an account here.' };

  const { token, hash } = generateInviteToken();
  const r = await pool.query(
    `INSERT INTO tenant_users (tenant_id, email, full_name, roles, status, invite_token_hash, invite_expires_at, invited_by)
     VALUES ($1, $2, $3, $4, 'invited', $5, NOW() + ($6 || ' hours')::interval, $7)
     RETURNING id, email, full_name, roles, status, created_at`,
    [tenant.id, email, cleanText(full_name, 200) || null, roles, hash, String(INVITE_HOURS), invitedBy || null]
  );
  const user = r.rows[0];
  const link = inviteLink(baseUrl, token);
  const emailed = await sendStaffInvite({ to: email, name: user.full_name, tenantName: tenant.name, link, roles });
  return { user, link, emailed };
}

// Existing user: new setup link, TOTP switched off until they finish setup again.
async function refreshInvite(tenant, baseUrl, userId) {
  const { token, hash } = generateInviteToken();
  const r = await pool.query(
    `UPDATE tenant_users
     SET invite_token_hash = $3, invite_expires_at = NOW() + ($4 || ' hours')::interval,
         totp_enabled = FALSE, totp_secret = NULL, recovery_codes = '{}',
         failed_logins = 0, locked_until = NULL, updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND status <> 'disabled'
     RETURNING id, email, full_name, roles, status`,
    [userId, tenant.id, hash, String(INVITE_HOURS)]
  );
  if (!r.rows.length) throw { status: 404, message: 'User not found or disabled.' };
  const user = r.rows[0];
  const link = inviteLink(baseUrl, token);
  const emailed = await sendStaffInvite({ to: user.email, name: user.full_name, tenantName: tenant.name, link, roles: user.roles });
  return { user, link, emailed };
}

module.exports = { createInvite, refreshInvite, INVITE_HOURS };
