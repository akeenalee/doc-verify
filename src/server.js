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
const { verifyLimiter, createLimiter } = require('./middleware/rateLimiter');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "https://ip-api.com"],
      imgSrc:     ["'self'", "data:"],
      frameSrc:   ["'self'", "https://checkout.paystack.com"],
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

app.use(express.static(path.join(__dirname, '../public')));
app.get('/',        (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/student', (req, res) => res.sendFile(path.join(__dirname, '../public/student.html')));
app.get('/pay',     (req, res) => res.sendFile(path.join(__dirname, '../public/pay.html')));

app.use('/verify',        verifyLimiter, verifyRouter);
app.use('/api/documents', createLimiter, documentsRouter);
app.use('/api/tokens',    tokensRouter);

app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));
app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});
app.use('/screenshots', express.static(path.join(__dirname, '../public/screenshots')));

app.listen(PORT, () => {
  console.log(`UniVerify running on http://localhost:${PORT}`);
});

module.exports = app;