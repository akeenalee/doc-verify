require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const path    = require('path');
const session = require('express-session');
const pool    = require('./db/pool');

const documentsRouter = require('./routes/documents');
const verifyRouter    = require('./routes/verify');
const tokensRouter    = require('./routes/tokens');
const webhookRouter   = require('./routes/webhook');
const demoRouter      = require('./routes/demo');
const adminRouter     = require('./routes/admin');
const { verifyLimiter, createLimiter, loginLimiter, tokensLimiter } = require('./middleware/rateLimiter');
const { requireDemoAuth }    = require('./middleware/demoAuth');
const { requireAdminAuth }   = require('./middleware/adminAuth');
const { tenantResolver }     = require('./middleware/tenantResolver');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'"],
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

app.use(express.json());
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
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
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

// Static files - skip protected files so they hit auth middleware below
app.use((req, res, next) => {
  const blocked = ['/', '/index.html', '/help.html', '/admin', '/admin.html'];
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
app.get('/admin-login.html', (req, res) =>
  res.sendFile(path.join(__dirname, '../public/admin-login.html'))
);

// Public pages
app.get('/student',      (req, res) => res.sendFile(path.join(__dirname, '../public/student.html')));
app.get('/student.html', (req, res) => res.sendFile(path.join(__dirname, '../public/student.html')));
app.get('/pay',          (req, res) => res.sendFile(path.join(__dirname, '../public/pay.html')));
app.get('/pay.html',     (req, res) => res.sendFile(path.join(__dirname, '../public/pay.html')));

// API routes
app.use('/verify',        verifyLimiter, verifyRouter);
app.use('/api/documents', createLimiter, documentsRouter);
app.use('/api/tokens',    tokensLimiter, tokensRouter);

// Public tenant info — used by the dashboard to configure the UI
// Returns only safe public fields, no sensitive config
app.get('/api/tenant-info', (req, res) => {
  if (!req.tenant) return res.json({ institution_type: 'academic', name: 'UniVerify' });
  res.json({
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
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`UniVerify running on http://localhost:${PORT}`);
});

module.exports = app;