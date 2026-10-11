// src/routes/tenants.js
// Institution onboarding API. Mounted under /admin-api/tenants behind
// requireAdminAuth, and further restricted to the Innovation Lens root
// tenant so an admin session on an institution subdomain can't provision
// other institutions. Mirrors scripts/onboard-institution.js.

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const pool    = require('../db/pool');
const { clearTenantCache } = require('../middleware/tenantResolver');

const ROOT_TENANT = (process.env.ROOT_TENANT_SUBDOMAIN || 'demo').toLowerCase();
const ROOT_DOMAIN = process.env.TENANT_ROOT_DOMAIN || 'univerify.ng';

const INSTITUTION_TYPES = ['academic', 'government', 'hospital', 'court', 'demo'];
const PLANS             = ['standard', 'premium', 'enterprise'];
const RESERVED_SUBDOMAINS = [
  'www', 'demo', 'admin', 'api', 'app', 'mail', 'smtp', 'ftp', 'staging',
  'dev', 'test', 'verify', 'portal', 'help', 'support', 'status', 'static',
  'cdn', 'assets', 'webhook', 'webhooks', 'pay', 'billing', 'root',
];

const SUBDOMAIN_RE  = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const SHORT_CODE_RE = /^[A-Z0-9]{2,8}$/;
const HEX_RE        = /^#[0-9A-Fa-f]{6}$/;
const EMAIL_RE      = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Only an admin session opened on the IL root tenant can onboard institutions
function isRootAdmin(req) {
  return !!(req.tenant && req.tenant.subdomain === ROOT_TENANT &&
            req.session && req.session.adminAuth &&
            req.session.tenantId === req.tenant.id);
}

function requireRootTenant(req, res, next) {
  if (!isRootAdmin(req)) {
    return res.status(403).json({ error: 'Institution onboarding is only available on the Innovation Lens admin panel.' });
  }
  next();
}

router.use(requireRootTenant);

// Public URL for a tenant. On *.univerify.ng (or the legacy host) this is
// https://<sub>.univerify.ng; on localhost it's http://<sub>.localhost:<port>
// so the whole flow can be tested locally.
function tenantUrl(req, subdomain) {
  const hostname = req.hostname || '';
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    const port = (req.headers.host || '').split(':')[1];
    return `http://${subdomain}.localhost${port ? ':' + port : ''}`;
  }
  return `https://${subdomain}.${ROOT_DOMAIN}`;
}

function clean(val, max) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  return s ? s.slice(0, max) : null;
}

function validate(body) {
  const errors = {};
  const data = {
    name:           clean(body.name, 200),
    subdomain:      (clean(body.subdomain, 40) || '').toLowerCase(),
    short_code:     (clean(body.short_code, 8) || '').toUpperCase(),
    institution_type: clean(body.institution_type, 50) || 'academic',
    contact_email:  clean(body.contact_email, 200),
    contact_phone:  clean(body.contact_phone, 50),
    website:        clean(body.website, 200),
    address:        clean(body.address, 1000),
    logo_url:       clean(body.logo_url, 1000),
    primary_colour: clean(body.primary_colour, 7) || '#1A3A5C',
    accent_colour:  clean(body.accent_colour, 7) || '#B8860B',
    plan:           clean(body.plan, 20) || 'standard',
  };

  if (!data.name || data.name.length < 3) errors.name = 'Enter the institution\'s full name.';
  if (!SUBDOMAIN_RE.test(data.subdomain))
    errors.subdomain = 'Use 1 to 40 lowercase letters, digits or hyphens, not starting or ending with a hyphen.';
  else if (RESERVED_SUBDOMAINS.includes(data.subdomain))
    errors.subdomain = `"${data.subdomain}" is reserved.`;
  if (!SHORT_CODE_RE.test(data.short_code))
    errors.short_code = 'Use 2 to 8 uppercase letters or digits.';
  if (!INSTITUTION_TYPES.includes(data.institution_type))
    errors.institution_type = 'Pick a valid institution type.';
  if (data.contact_email && !EMAIL_RE.test(data.contact_email))
    errors.contact_email = 'Enter a valid email address.';
  if (data.website && !/^https?:\/\//i.test(data.website))
    errors.website = 'Website must start with http:// or https://';
  if (data.logo_url && !/^https:\/\//i.test(data.logo_url))
    errors.logo_url = 'Logo URL must start with https://';
  if (!HEX_RE.test(data.primary_colour)) errors.primary_colour = 'Use a hex colour like #1A3A5C.';
  if (!HEX_RE.test(data.accent_colour))  errors.accent_colour  = 'Use a hex colour like #B8860B.';
  if (!PLANS.includes(data.plan)) errors.plan = 'Pick a valid plan.';

  return { data, errors };
}

// GET /admin-api/tenants: every institution, newest first
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.name, t.subdomain, t.short_code, t.institution_type,
              t.contact_email, t.primary_colour, t.accent_colour, t.logo_url,
              t.plan, t.active, t.created_at,
              (SELECT COUNT(*) FROM documents d WHERE d.tenant_id = t.id)::int AS documents
       FROM tenants t
       ORDER BY t.created_at DESC`
    );
    res.json({
      tenants: result.rows.map(t => ({ ...t, url: tenantUrl(req, t.subdomain) })),
      root_subdomain: ROOT_TENANT,
    });
  } catch (e) {
    console.error('List tenants error:', e.message);
    res.status(500).json({ error: 'Failed to fetch institutions.' });
  }
});

// GET /admin-api/tenants/availability?subdomain=x&short_code=Y
router.get('/availability', async (req, res) => {
  const subdomain  = (clean(req.query.subdomain, 40) || '').toLowerCase();
  const short_code = (clean(req.query.short_code, 8) || '').toUpperCase();
  try {
    const [sub, code] = await Promise.all([
      subdomain  ? pool.query('SELECT 1 FROM tenants WHERE subdomain=$1',  [subdomain])  : null,
      short_code ? pool.query('SELECT 1 FROM tenants WHERE short_code=$1', [short_code]) : null,
    ]);
    res.json({
      subdomain:  subdomain  ? (!RESERVED_SUBDOMAINS.includes(subdomain) && SUBDOMAIN_RE.test(subdomain) && !sub.rows.length) : null,
      short_code: short_code ? (SHORT_CODE_RE.test(short_code) && !code.rows.length) : null,
    });
  } catch (e) {
    res.status(500).json({ error: 'Availability check failed.' });
  }
});

// POST /admin-api/tenants: provision a new institution
// Optional body.presenter_link (default true) also issues a 30-day demo
// access token on the new tenant so the admin can open it straight away.
router.post('/', async (req, res) => {
  const { data, errors } = validate(req.body || {});
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });

  const wantLink = req.body.presenter_link !== false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO tenants (
         name, subdomain, short_code, institution_type, contact_email,
         contact_phone, website, address, logo_url, primary_colour,
         accent_colour, plan, active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE)
       RETURNING id, name, subdomain, short_code, institution_type, plan, created_at`,
      [data.name, data.subdomain, data.short_code, data.institution_type,
       data.contact_email, data.contact_phone, data.website, data.address,
       data.logo_url, data.primary_colour, data.accent_colour, data.plan]
    );
    const tenant = result.rows[0];
    const url    = tenantUrl(req, tenant.subdomain);

    let presenterLink = null;
    if (wantLink) {
      const token = crypto.randomBytes(24).toString('hex');
      await client.query(
        `INSERT INTO demo_tokens (token, label, name, company, expires_at, max_uses, notes, tenant_id)
         VALUES ($1,$2,$3,$4,NOW() + INTERVAL '30 days',0,$5,$6)`,
        [token, 'Presenter link', 'Innovation Lens presenter', tenant.name,
         'Created automatically when the institution was onboarded', tenant.id]
      );
      presenterLink = `${url}/demo/access?token=${token}`;
    }

    await client.query('COMMIT');

    // A visit to the subdomain before it existed caches "no tenant" for
    // 5 minutes. Drop that entry so the new tenant resolves immediately.
    clearTenantCache(tenant.subdomain);

    res.status(201).json({ tenant: { ...tenant, url }, presenter_link: presenterLink });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') {
      const field = /short_code/.test(e.constraint || e.detail || '') ? 'short_code' : 'subdomain';
      return res.status(409).json({
        error: field === 'short_code' ? 'That short code is already in use.' : 'That subdomain is already taken.',
        fields: { [field]: 'Already in use.' },
      });
    }
    console.error('Create tenant error:', e.message);
    res.status(500).json({ error: 'Failed to create institution.' });
  } finally {
    client.release();
  }
});

// PATCH /admin-api/tenants/:id/active  { active: true|false }
// Suspend or restore an institution. The root tenant can't be suspended.
router.patch('/:id/active', async (req, res) => {
  const active = req.body && req.body.active === true;
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'Institution not found.' });
  try {
    const result = await pool.query(
      `UPDATE tenants SET active=$1, updated_at=NOW()
       WHERE id=$2 AND subdomain <> $3
       RETURNING subdomain, active`,
      [active, req.params.id, ROOT_TENANT]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Institution not found.' });
    clearTenantCache(result.rows[0].subdomain);
    res.json({ success: true, active: result.rows[0].active });
  } catch (e) {
    console.error('Toggle tenant error:', e.message);
    res.status(500).json({ error: 'Failed to update institution.' });
  }
});

module.exports = router;
module.exports.isRootAdmin = isRootAdmin;
