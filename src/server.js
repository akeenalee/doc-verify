require('dotenv').config();
// Must load before express, pg and http so they can be traced (off without OTEL_EXPORTER_OTLP_ENDPOINT)
require('./telemetry');
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const path    = require('path');
const session = require('express-session');
const pool    = require('./db/pool');
const { logoVersion } = require('./utils/branding');

const documentsRouter = require('./routes/documents');
const verifyRouter    = require('./routes/verify');
const tokensRouter    = require('./routes/tokens');
const webhookRouter   = require('./routes/webhook');
const demoRouter      = require('./routes/demo');
const adminRouter     = require('./routes/admin');
const staffAuthRouter = require('./routes/staffAuth');
const staffAppRouter  = require('./routes/staffApp');
const { verifyLimiter, createLimiter, loginLimiter, tokensLimiter } = require('./middleware/rateLimiter');
const { requireDemoAuth }    = require('./middleware/demoAuth');
const { requireAdminAuth }   = require('./middleware/adminAuth');
const { tenantResolver }     = require('./middleware/tenantResolver');
const { isRootAdmin }        = require('./routes/tenants');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      // Scripts only from files on this site: no inline <script>, no onclick=""
      scriptSrc:     ["'self'"],
      scriptSrcAttr: ["'none'"],
      // Inline styles stay allowed for now (style="" is used throughout and
      // can't run code); moving them to classes is a separate clean-up
      styleSrc:      ["'self'", "'unsafe-inline'"],
      objectSrc:     ["'none'"],
      baseUri:       ["'self'"],
      formAction:    ["'self'"],
      frameAncestors: ["'self'"],
      connectSrc:    ["'self'", "https://ipinfo.io"],
      imgSrc:        ["'self'", "data:"],
      frameSrc:      ["'self'", "https://checkout.paystack.com"],
    },
  },
}));

// CORS — allow all univerify.ng subdomains plus localhost for dev
const allowedOrigins = [
  process.env.BASE_URL || 'http://localhost:3000',
  /^https:\/\/[a-z0-9-]+\.univerify\.ng$/,
  /^http:\/\/[a-z0-9-]+\.localhost(:\d+)?$/,
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow non-browser requests
    const allowed = allowedOrigins.some(o =>
      typeof o === 'string' ? o === origin : o.test(origin)
    );
    callback(allowed ? null : new Error('Not allowed by CORS'), allowed);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}));

app.set('trust proxy', 1);

// Webhook MUST be before express.json()
app.use('/api/webhook', webhookRouter);

// Test SIS with dummy students, only when MOCK_SIS_ENABLED=1 (see src/routes/mockSis.js)
const testSis = require('./routes/mockSis').mockSis();
if (testSis) app.use('/mock-sis', testSis);

// Logo and signature uploads (base64) and bulk CSV uploads get a larger body
// limit; everything else keeps the 100 kB default
const jsonSmall = express.json();
const jsonLarge = express.json({ limit: '2mb' });
const largeBody = req => req.path.startsWith('/app-api/settings/') || req.path === '/app-api/batches' || req.path === '/app-api/batches/' ||
  req.path === '/app-api/students/lists';
app.use((req, res, next) => (largeBody(req) ? jsonLarge : jsonSmall)(req, res, next));
app.use(express.urlencoded({ extended: false }));

// Session store
const sessionStore = process.env.NODE_ENV === 'production'
  ? new (require('connect-pg-simple')(session))({
      pool,
      tableName:            'session',
      createTableIfMissing: true,
      pruneSessionInterval:  60 * 60,
    })
  : undefined;

app.use(session({
  store:             sessionStore,
  secret:            process.env.SESSION_SECRET || process.env.DOC_SECRET || 'change-this-secret',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    // lax: cookies still go on top-level navigations (Paystack returning the
    // payer), but not on cross-site POSTs, which closes CSRF on bodyless actions
    sameSite: 'lax',
    maxAge:   8 * 60 * 60 * 1000,
  },
}));

// ── TENANT RESOLVER ────────────────────────────────────────────────────────
// Runs after session, before all routes.
// Attaches req.tenant to every request based on subdomain.
// Health check and webhook are exempt — they don't need tenant context.
app.use((req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/api/webhook')) return next();
  tenantResolver(req, res, next);
});
// ──────────────────────────────────────────────────────────────────────────

// Demo auth routes
app.use('/demo', demoRouter);

// Admin API routes
app.use('/admin-api', adminRouter);

// Staff app API (per-tenant staff accounts, roles and TOTP)
// Staff writes must come from the workspace's own origin
app.use('/app-api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const o = req.headers.origin;
  if (o) {
    let host = null;
    try { host = new URL(o).host; } catch (_) { /* bad Origin */ }
    if (host !== req.get('host')) return res.status(403).json({ error: 'Cross-site request refused.' });
  }
  next();
});
app.use('/app-api/auth', staffAuthRouter);
app.use('/app-api/settings', require('./routes/staffSettings'));
app.use('/app-api/batches', require('./routes/staffBatches'));
app.use('/app-api/print', require('./routes/staffPrint'));
app.use('/app-api/students', require('./routes/staffStudents'));
app.use('/app-api/support', require('./routes/staffSupport'));
app.use('/app-api', staffAppRouter);

// Institutions use the staff workspace; only the root demo tenant keeps the
// old single-login dashboard (used for presentations)
const ROOT_TENANT = (process.env.ROOT_TENANT_SUBDOMAIN || 'demo').toLowerCase();
const toWorkspace = (req, res, next) =>
  (req.tenant && req.tenant.subdomain !== ROOT_TENANT) ? res.redirect(302, '/app/') : next();
app.get(['/', '/index.html', '/help.html', '/demo-login.html'], toWorkspace);

// Static files - skip protected files so they hit auth middleware below
app.use((req, res, next) => {
  const blocked = ['/', '/index.html', '/help.html', '/admin', '/admin.html', '/onboard.html'];
  if (blocked.includes(req.path)) return next();
  express.static(path.join(__dirname, '../public'))(req, res, next);
});
app.use('/screenshots', express.static(path.join(__dirname, '../public/screenshots')));

// Protected pages - require demo login
app.get('/', requireDemoAuth, (req, res) =>
  res.sendFile(path.join(__dirname, '../public/index.html'))
);
app.get('/index.html', requireDemoAuth, (req, res) =>
  res.sendFile(path.join(__dirname, '../public/index.html'))
);
app.get('/help.html', requireDemoAuth, (req, res) =>
  res.sendFile(path.join(__dirname, '../public/help.html'))
);

// Admin pages
app.get('/admin', requireAdminAuth, (req, res) =>
  res.sendFile(path.join(__dirname, '../public/admin.html'))
);
app.get('/admin.html', requireAdminAuth, (req, res) =>
  res.sendFile(path.join(__dirname, '../public/admin.html'))
);
// Institution onboarding: IL admin on the root tenant only
const sendOnboard = (req, res) => res.sendFile(path.join(__dirname, '../public/onboard.html'));
const onboardGuard = (req, res, next) => isRootAdmin(req) ? next() : res.redirect('/admin');
app.get('/admin/onboard', requireAdminAuth, onboardGuard, sendOnboard);
app.get('/onboard.html',  requireAdminAuth, onboardGuard, sendOnboard);
app.get('/admin-login.html', (req, res) =>
  res.sendFile(path.join(__dirname, '../public/admin-login.html'))
);

// Staff app shell: the page itself is public, every API call it makes is guarded
const sendApp = (req, res) => res.sendFile(path.join(__dirname, '../public/app/index.html'));
app.get(['/app', '/app/'], sendApp);

// Public pages
app.get('/student',      (req, res) => res.sendFile(path.join(__dirname, '../public/student.html')));
app.get('/student.html', (req, res) => res.sendFile(path.join(__dirname, '../public/student.html')));
app.get('/pay',          (req, res) => res.sendFile(path.join(__dirname, '../public/pay.html')));
app.get('/pay.html',     (req, res) => res.sendFile(path.join(__dirname, '../public/pay.html')));

// API routes
app.use('/verify',        verifyLimiter, verifyRouter);
// Staff only: create, list, PDF, QR and revoke all need a dashboard session
app.use('/api/documents', requireDemoAuth, createLimiter, documentsRouter);
app.use('/api/tokens',    tokensLimiter, tokensRouter);

// Tenant logo, served same-origin because the CSP blocks external images.
// Public: it's printed on every document anyway.
app.get('/brand/logo', async (req, res) => {
  try {
    if (!req.tenant) return res.status(404).end();
    const r = await pool.query('SELECT logo_data, logo_mime, logo_updated_at FROM tenants WHERE id = $1', [req.tenant.id]);
    const t = r.rows[0];
    if (!t || !t.logo_data) return res.status(404).end();
    res.setHeader('Content-Type', t.logo_mime || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(t.logo_data);
  } catch (e) { res.status(404).end(); }
});

// Public tenant info — used by the dashboard to configure the UI
// Returns only safe public fields, no sensitive config
app.get('/api/tenant-info', async (req, res) => {
  if (!req.tenant) return res.json({ institution_type: 'academic', name: 'UniVerify' });
  res.json({
    logo_version:     await logoVersion(req.tenant.id),
    name:             req.tenant.name,
    institution_type: req.tenant.institution_type,
    primary_colour:   req.tenant.primary_colour,
    accent_colour:    req.tenant.accent_colour,
    subdomain:        req.tenant.subdomain,
    short_code:       req.tenant.short_code,
  });
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  // Body parser errors (too large, malformed JSON) are the client's, not ours
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Upload too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request.' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`UniVerify running on http://localhost:${PORT}`);
  require('./utils/retention').scheduleRetention();
});

module.exports = app;