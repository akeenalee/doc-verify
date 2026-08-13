// src/middleware/tenantResolver.js
// Reads the subdomain from every incoming request, looks up the tenant
// in the database, and attaches req.tenant to the request object.
// Every route handler can then use req.tenant.id for all DB queries.

const pool = require('../db/pool');

// Cache tenants in memory for 5 minutes to avoid a DB lookup on every request
const tenantCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getTenant(subdomain) {
  const cached = tenantCache.get(subdomain);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.tenant;
  }

  const result = await pool.query(
    `SELECT id, name, subdomain, short_code, logo_url, primary_colour,
            accent_colour, institution_type, contact_email, active, plan,
            max_documents, paystack_split_code, website
     FROM tenants
     WHERE subdomain = $1 AND active = TRUE`,
    [subdomain]
  );

  const tenant = result.rows[0] || null;
  tenantCache.set(subdomain, { tenant, ts: Date.now() });
  return tenant;
}

// Call this whenever a tenant's config changes to force a fresh DB read
function clearTenantCache(subdomain) {
  if (subdomain) {
    tenantCache.delete(subdomain);
  } else {
    tenantCache.clear();
  }
}

function resolveSubdomain(req) {
  const host = req.hostname || req.headers.host || '';

  // Strip port if present
  const hostname = host.split(':')[0];

  // Legacy domain: verify.akeenalee.com → treat as demo tenant
  // during transition period. Remove this once DNS has fully migrated
  // to demo.univerify.ng and verify.akeenalee.com is retired.
  if (hostname === 'verify.akeenalee.com') return 'demo';

  // Production: lasu.univerify.ng → 'lasu'
  // Local dev:  lasu.localhost    → 'lasu'
  // Local dev:  localhost         → 'demo' (default)

  const parts = hostname.split('.');

  // If only one part (e.g. localhost) or IP address, use default
  if (parts.length < 2) return 'demo';

  // If the host is an IP address, use default
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return 'demo';

  // Return the first part as the subdomain
  return parts[0];
}

async function tenantResolver(req, res, next) {
  try {
    const subdomain = resolveSubdomain(req);
    const tenant    = await getTenant(subdomain);

    if (!tenant) {
      // Unknown subdomain — return a clean 404
      return res.status(404).send(`
        <html>
          <head><title>Not Found — UniVerify</title></head>
          <body style="font-family:Arial;text-align:center;padding:80px;color:#333">
            <h1 style="color:#1A3A5C">UniVerify</h1>
            <p>No institution found for <strong>${subdomain}.univerify.ng</strong></p>
            <p style="color:#888">If you are an institution looking to get started, contact
              <a href="mailto:info@akeenalee.com">info@akeenalee.com</a></p>
          </body>
        </html>
      `);
    }

    // Attach tenant to request — available in all downstream route handlers
    req.tenant = tenant;
    next();
  } catch (err) {
    console.error('Tenant resolver error:', err.message);
    next(err);
  }
}

// Middleware that skips tenant resolution for health check and internal routes
function tenantResolverOptional(req, res, next) {
  const subdomain = resolveSubdomain(req);
  getTenant(subdomain)
    .then(tenant => {
      req.tenant = tenant; // may be null — routes handle this gracefully
      next();
    })
    .catch(err => {
      console.error('Tenant resolver error:', err.message);
      req.tenant = null;
      next();
    });
}

module.exports = { tenantResolver, tenantResolverOptional, clearTenantCache };