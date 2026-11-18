const express  = require('express');
const router   = express.Router();
const pool     = require('../db/pool');
const crypto   = require('crypto');
const { loginLimiter } = require('../middleware/rateLimiter');
const { requireAdminAuth } = require('../middleware/adminAuth');
const tenantsRouter = require('./tenants');

const { credential, safeEqual, adminTotpSecret, verifyAdminTotp } = require('../utils/sharedCreds');

// Defaults work in development only; production needs ADMIN_USER and ADMIN_PASS set
const ADMIN_USER = credential('ADMIN_USER', 'iladmin') || 'iladmin';
const ADMIN_PASS = credential('ADMIN_PASS', 'IL@Admin2026!');
if (!ADMIN_PASS) console.error('ADMIN_PASS is not set: IL admin sign-in is disabled until it is.');
if (process.env.NODE_ENV === 'production' && !adminTotpSecret())
  console.warn('ADMIN_TOTP_SECRET is not set: IL admin sign-in has no second factor. Run node scripts/admin-totp-setup.js.');

// POST /admin-api/login — IL super admin only, not tenant-scoped.
// Password, then (when ADMIN_TOTP_SECRET is set) a 6-digit authenticator code.
router.post('/login', loginLimiter, (req, res) => {
  const { username, password, code } = req.body || {};
  if (!ADMIN_PASS) return res.status(503).json({ error: 'Admin sign-in is not configured on this server.' });
  if (!safeEqual(username, ADMIN_USER) || !safeEqual(password, ADMIN_PASS))
    return res.status(401).json({ error:'Invalid credentials.' });
  if (adminTotpSecret()) {
    if (!code) return res.status(401).json({ totp_required: true, error: 'Enter the 6-digit code from your authenticator app.' });
    if (!verifyAdminTotp(code)) return res.status(401).json({ totp_required: true, error: 'That code is wrong or already used. Wait for the next one.' });
  }
  // New session id on sign-in (fixation defence); keep a demo session if one is open
  const keep = {};
  for (const k of ['demoAuth', 'demoName', 'lastDemoActivity', 'staffUserId', 'staffTenantId', 'staffLastActivity'])
    if (req.session[k] !== undefined) keep[k] = req.session[k];
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not start a session.' });
    Object.assign(req.session, keep);
    req.session.adminAuth = true;
    req.session.tenantId  = req.tenant?.id; // scope admin to current tenant
    req.session.lastAdminActivity = Date.now();
    res.json({ success:true });
  });
});

router.post('/logout', (req, res) => {
  req.session.adminAuth = false;
  res.json({ success:true });
});

router.get('/status', (req, res) => {
  res.json({ authenticated:!!req.session.adminAuth });
});

// All routes below require admin auth
router.use(requireAdminAuth);

// Institution onboarding (IL root tenant only, enforced inside the router)
router.use('/tenants', tenantsRouter);
router.use('/support', require('./adminSupport'));

// Helper — get tenantId from session or current request
function getTenantId(req) {
  return req.session.tenantId || req.tenant?.id;
}

// GET /admin-api/tokens
router.get('/tokens', async (req, res) => {
  const tenantId = getTenantId(req);
  try {
    const result = await pool.query(
      `SELECT id, token, label, name, email, company, role,
              created_at, expires_at, max_uses, use_count,
              last_used_at, is_active, notes
       FROM demo_tokens WHERE tenant_id=$1
       ORDER BY created_at DESC`,
      [tenantId]
    );
    res.json({ tokens:result.rows });
  } catch (e) {
    res.status(500).json({ error:'Failed to fetch tokens.' });
  }
});

// POST /admin-api/tokens
router.post('/tokens', async (req, res) => {
  const tenantId = getTenantId(req);
  const { label, name, email, company, role, expires_days, max_uses, notes } = req.body;
  const token     = crypto.randomBytes(24).toString('hex');
  const expiresAt = expires_days
    ? new Date(Date.now() + parseInt(expires_days) * 24 * 60 * 60 * 1000)
    : null;

  try {
    const result = await pool.query(
      `INSERT INTO demo_tokens
         (token, label, name, email, company, role, expires_at, max_uses, notes, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [token, label||null, name||null, email||null, company||null,
       role||null, expiresAt, parseInt(max_uses)||0, notes||null, tenantId]
    );
    res.json({ token:result.rows[0] });
  } catch (e) {
    res.status(500).json({ error:'Failed to create token.' });
  }
});

// PATCH /admin-api/tokens/:id/revoke
router.patch('/tokens/:id/revoke', async (req, res) => {
  const tenantId = getTenantId(req);
  try {
    await pool.query(
      'UPDATE demo_tokens SET is_active=FALSE WHERE id=$1 AND tenant_id=$2',
      [req.params.id, tenantId]
    );
    res.json({ success:true });
  } catch (e) {
    res.status(500).json({ error:'Failed to revoke token.' });
  }
});

// PATCH /admin-api/tokens/:id/activate
router.patch('/tokens/:id/activate', async (req, res) => {
  const tenantId = getTenantId(req);
  try {
    await pool.query(
      'UPDATE demo_tokens SET is_active=TRUE WHERE id=$1 AND tenant_id=$2',
      [req.params.id, tenantId]
    );
    res.json({ success:true });
  } catch (e) {
    res.status(500).json({ error:'Failed to activate token.' });
  }
});

// DELETE /admin-api/tokens/:id
router.delete('/tokens/:id', async (req, res) => {
  const tenantId = getTenantId(req);
  try {
    await pool.query(
      'DELETE FROM demo_tokens WHERE id=$1 AND tenant_id=$2',
      [req.params.id, tenantId]
    );
    res.json({ success:true });
  } catch (e) {
    res.status(500).json({ error:'Failed to delete token.' });
  }
});

// GET /admin-api/visitors
router.get('/visitors', async (req, res) => {
  const tenantId = getTenantId(req);
  try {
    const result = await pool.query(
      `SELECT id, full_name, email, company, role, ip_address,
              user_agent, first_seen_at, last_seen_at, page_views
       FROM demo_visitors WHERE tenant_id=$1
       ORDER BY first_seen_at DESC LIMIT 500`,
      [tenantId]
    );
    res.json({ visitors:result.rows, total:result.rows.length });
  } catch (e) {
    res.status(500).json({ error:'Failed to fetch visitors.' });
  }
});

// GET /admin-api/stats
router.get('/stats', async (req, res) => {
  const tenantId = getTenantId(req);
  try {
    const [visitors, tokens, scans, docs] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM demo_visitors    WHERE tenant_id=$1', [tenantId]),
      pool.query('SELECT COUNT(*) FROM demo_tokens      WHERE is_active=TRUE AND tenant_id=$1', [tenantId]),
      pool.query('SELECT COUNT(*) FROM verification_log WHERE tenant_id=$1', [tenantId]),
      pool.query('SELECT COUNT(*) FROM documents        WHERE tenant_id=$1', [tenantId]),
    ]);
    res.json({
      total_visitors:   parseInt(visitors.rows[0].count),
      active_tokens:    parseInt(tokens.rows[0].count),
      total_scans:      parseInt(scans.rows[0].count),
      total_documents:  parseInt(docs.rows[0].count),
    });
  } catch (e) {
    res.status(500).json({ error:'Failed to fetch stats.' });
  }
});

// GET /admin-api/tenant — current tenant info
router.get('/tenant', (req, res) => {
  res.json({ tenant: req.tenant, can_onboard: tenantsRouter.isRootAdmin(req) });
});

module.exports = router;