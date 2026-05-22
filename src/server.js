require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const path    = require('path');
const session = require('express-session');

const documentsRouter = require('./routes/documents');
const verifyRouter    = require('./routes/verify');
const tokensRouter    = require('./routes/tokens');
const webhookRouter   = require('./routes/webhook');
const demoRouter      = require('./routes/demo');
const adminRouter     = require('./routes/admin');
const { verifyLimiter, createLimiter } = require('./middleware/rateLimiter');
const { requireDemoAuth }  = require('./middleware/demoAuth');
const { requireAdminAuth } = require('./middleware/adminAuth');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'"],
      connectSrc:    ["'self'", "https://ip-api.com"],
      imgSrc:        ["'self'", "data:"],
      frameSrc:      ["'self'", "https://checkout.paystack.com"],
    },
  },
}));

app.use(cors());
app.set('trust proxy', 1);

// Webhook MUST be before express.json()
app.use('/api/webhook', webhookRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret:            process.env.DOC_SECRET || 'change-this-secret',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge:   7 * 24 * 60 * 60 * 1000,
  },
}));

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

// Admin pages - protected by separate admin auth
app.get('/admin', requireAdminAuth, (req, res) =>
  res.sendFile(path.join(__dirname, '../public/admin.html'))
);
app.get('/admin.html', requireAdminAuth, (req, res) =>
  res.sendFile(path.join(__dirname, '../public/admin.html'))
);
app.get('/admin-login.html', (req, res) =>
  res.sendFile(path.join(__dirname, '../public/admin-login.html'))
);

// Public pages - no login needed
app.get('/student',      (req, res) => res.sendFile(path.join(__dirname, '../public/student.html')));
app.get('/student.html', (req, res) => res.sendFile(path.join(__dirname, '../public/student.html')));
app.get('/pay',          (req, res) => res.sendFile(path.join(__dirname, '../public/pay.html')));
app.get('/pay.html',     (req, res) => res.sendFile(path.join(__dirname, '../public/pay.html')));

// API routes
app.use('/verify',        verifyLimiter, verifyRouter);
app.use('/api/documents', createLimiter, documentsRouter);
app.use('/api/tokens',    tokensRouter);

// Health check - public, needed for UptimeRobot
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