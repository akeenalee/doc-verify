// /app-api/auth: staff sign-in (password, then TOTP), invite acceptance
// with TOTP enrolment, sign-out and password change.

const express = require('express');
const router  = express.Router();
const QRCode  = require('qrcode');
const pool    = require('../db/pool');
const { loginLimiter } = require('../middleware/rateLimiter');
const { requireStaff, clearStaff } = require('../middleware/staffAuth');
const { logActivity } = require('../utils/activity');
const A = require('../utils/staffAuth');

const MAX_FAILED   = 5;
const LOCK_MINUTES = 15;
const PENDING_MS   = 5 * 60 * 1000;
const GENERIC_FAIL = 'Email, password or code is incorrect.';

async function recordFailure(userId) {
  await pool.query(
    `UPDATE tenant_users
     SET failed_logins = failed_logins + 1,
         locked_until  = CASE WHEN failed_logins + 1 >= $2
                              THEN NOW() + ($3 || ' minutes')::interval ELSE locked_until END,
         updated_at = NOW()
     WHERE id = $1`,
    [userId, MAX_FAILED, String(LOCK_MINUTES)]
  );
}

// Regenerate the session on sign-in (fixation defence) but keep any other
// sessions already open on this host, e.g. the demo dashboard.
function regenerateKeeping(req) {
  const keep = {};
  for (const k of ['demoAuth', 'demoName', 'adminAuth', 'tenantId', 'lastDemoActivity', 'lastAdminActivity']) {
    if (req.session[k] !== undefined) keep[k] = req.session[k];
  }
  return new Promise((resolve, reject) => req.session.regenerate(err => {
    if (err) return reject(err);
    Object.assign(req.session, keep);
    resolve();
  }));
}

async function startStaffSession(req, user) {
  await regenerateKeeping(req);
  req.session.staffUserId       = user.id;
  req.session.staffTenantId     = req.tenant.id;
  req.session.staffLastActivity = Date.now();
  await pool.query(
    `UPDATE tenant_users SET failed_logins = 0, locked_until = NULL, last_login_at = NOW(), updated_at = NOW()
     WHERE id = $1`, [user.id]);
  req.staff = user;
}

// ── Sign in, step 1: email + password ───────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  const email    = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  try {
    const r = await pool.query(
      `SELECT id, email, password_hash, status, totp_enabled, locked_until
       FROM tenant_users WHERE tenant_id = $1 AND LOWER(email) = $2`,
      [req.tenant.id, email]
    );
    const user = r.rows[0];
    if (!user) return res.status(401).json({ error: GENERIC_FAIL });
    if (user.locked_until && new Date(user.locked_until) > new Date())
      return res.status(429).json({ error: `Too many attempts. Try again in ${LOCK_MINUTES} minutes.` });
    if (!A.verifyPassword(password, user.password_hash)) {
      await recordFailure(user.id);
      return res.status(401).json({ error: GENERIC_FAIL });
    }
    if (user.status === 'disabled') return res.status(403).json({ error: 'This account is disabled. Contact your institution\'s UniVerify owner.' });
    if (!user.totp_enabled) return res.status(403).json({ error: 'Your account setup isn\'t finished. Use the setup link you were sent, or ask your owner for a new one.' });

    req.session.staffPendingUserId = user.id;
    req.session.staffPendingTenant = req.tenant.id;
    req.session.staffPendingAt     = Date.now();
    res.json({ next: 'totp' });
  } catch (e) {
    console.error('Staff login error:', e);
    res.status(500).json({ error: 'Sign-in failed.' });
  }
});

// ── Sign in, step 2: TOTP code or recovery code ─────────────────────────────
router.post('/verify', loginLimiter, async (req, res) => {
  const s = req.session;
  if (!s.staffPendingUserId || s.staffPendingTenant !== req.tenant.id ||
      Date.now() - (s.staffPendingAt || 0) > PENDING_MS) {
    return res.status(401).json({ error: 'Sign-in timed out. Enter your password again.', restart: true });
  }

  try {
    const r = await pool.query(
      `SELECT id, email, full_name, roles, status, totp_secret, recovery_codes, locked_until
       FROM tenant_users WHERE id = $1 AND tenant_id = $2`,
      [s.staffPendingUserId, req.tenant.id]
    );
    const user = r.rows[0];
    if (!user || user.status !== 'active') return res.status(401).json({ error: GENERIC_FAIL, restart: true });
    if (user.locked_until && new Date(user.locked_until) > new Date())
      return res.status(429).json({ error: `Too many attempts. Try again in ${LOCK_MINUTES} minutes.`, restart: true });

    let ok = false, usedRecovery = false;
    if (req.body.code) {
      ok = A.verifyTotp(user.totp_secret, String(req.body.code).replace(/\s/g, ''));
    } else if (req.body.recovery_code) {
      const norm = A.normaliseRecoveryCode(req.body.recovery_code);
      const hash = norm && A.sha256(norm);
      if (hash && user.recovery_codes.includes(hash)) {
        ok = true; usedRecovery = true;
        await pool.query(`UPDATE tenant_users SET recovery_codes = array_remove(recovery_codes, $2) WHERE id = $1`, [user.id, hash]);
      }
    }
    if (!ok) {
      await recordFailure(user.id);
      return res.status(401).json({ error: GENERIC_FAIL });
    }

    delete s.staffPendingUserId; delete s.staffPendingTenant; delete s.staffPendingAt;
    await startStaffSession(req, user);
    await logActivity(req, { action: usedRecovery ? 'sign_in_recovery_code' : 'sign_in' });
    res.json({ success: true, recovery_codes_left: usedRecovery ? user.recovery_codes.length - 1 : undefined });
  } catch (e) {
    console.error('Staff verify error:', e);
    res.status(500).json({ error: 'Sign-in failed.' });
  }
});

router.post('/logout', async (req, res) => {
  if (req.session.staffUserId) await logActivity(req, { action: 'sign_out', userId: req.session.staffUserId, actor: 'staff' });
  clearStaff(req.session);
  res.json({ success: true });
});

router.get('/me', requireStaff(), (req, res) => {
  const t = req.tenant;
  res.json({
    user: req.staff,
    tenant: { name: t.name, subdomain: t.subdomain, short_code: t.short_code,
              primary_colour: t.primary_colour, accent_colour: t.accent_colour,
              logo_url: t.logo_url, institution_type: t.institution_type },
  });
});

router.post('/password', requireStaff(), async (req, res) => {
  const { current_password, new_password } = req.body;
  const problem = A.passwordProblem(new_password);
  if (problem) return res.status(400).json({ error: problem });
  const r = await pool.query('SELECT password_hash FROM tenant_users WHERE id = $1', [req.staff.id]);
  if (!A.verifyPassword(String(current_password || ''), r.rows[0]?.password_hash))
    return res.status(401).json({ error: 'Current password is incorrect.' });
  await pool.query('UPDATE tenant_users SET password_hash = $2, updated_at = NOW() WHERE id = $1',
    [req.staff.id, A.hashPassword(new_password)]);
  await logActivity(req, { action: 'password_changed', targetType: 'user', targetId: req.staff.email });
  res.json({ success: true });
});

// ── Invite acceptance and TOTP enrolment ────────────────────────────────────
async function findInvite(req, token) {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const r = await pool.query(
    `SELECT id, email, full_name, roles, status, totp_secret, invite_expires_at
     FROM tenant_users
     WHERE tenant_id = $1 AND invite_token_hash = $2 AND status <> 'disabled'`,
    [req.tenant.id, A.sha256(token)]
  );
  const u = r.rows[0];
  if (!u || !u.invite_expires_at || new Date(u.invite_expires_at) < new Date()) return null;
  return u;
}

router.get('/invite', async (req, res) => {
  const u = await findInvite(req, String(req.query.token || ''));
  if (!u) return res.status(404).json({ error: 'This setup link is invalid or has expired. Ask your owner for a new one.' });
  res.json({ email: u.email, full_name: u.full_name, roles: u.roles, tenant: req.tenant.name });
});

router.post('/invite/start', loginLimiter, async (req, res) => {
  const token = String(req.body.token || '');
  const u = await findInvite(req, token);
  if (!u) return res.status(404).json({ error: 'This setup link is invalid or has expired.' });
  const problem = A.passwordProblem(req.body.password);
  if (problem) return res.status(400).json({ error: problem });
  const fullName = String(req.body.full_name || u.full_name || '').trim().slice(0, 200);
  if (!fullName) return res.status(400).json({ error: 'Your full name is required.' });

  const secret = A.generateTotpSecret();
  await pool.query(
    `UPDATE tenant_users SET full_name = $2, password_hash = $3, totp_secret = $4,
            totp_enabled = FALSE, updated_at = NOW() WHERE id = $1`,
    [u.id, fullName, A.hashPassword(req.body.password), secret]
  );
  const uri = A.totpUri(secret, u.email, `UniVerify ${req.tenant.short_code}`);
  res.json({ qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }), secret });
});

router.post('/invite/confirm', loginLimiter, async (req, res) => {
  const u = await findInvite(req, String(req.body.token || ''));
  if (!u || !u.totp_secret) return res.status(404).json({ error: 'This setup link is invalid or has expired.' });
  if (!A.verifyTotp(u.totp_secret, String(req.body.code || '').replace(/\s/g, '')))
    return res.status(401).json({ error: 'That code doesn\'t match. Check the time on your phone and try the newest code.' });

  const codes = A.generateRecoveryCodes();
  const r = await pool.query(
    `UPDATE tenant_users
     SET totp_enabled = TRUE, status = 'active', recovery_codes = $2,
         invite_token_hash = NULL, invite_expires_at = NULL,
         failed_logins = 0, locked_until = NULL, updated_at = NOW()
     WHERE id = $1
     RETURNING id, email, full_name, roles, status`,
    [u.id, codes.hashed]
  );
  await startStaffSession(req, r.rows[0]);
  await logActivity(req, { action: 'account_setup_completed', targetType: 'user', targetId: u.email });
  res.json({ success: true, recovery_codes: codes.plain });
});

module.exports = router;
