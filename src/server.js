require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');

const documentsRouter = require('./routes/documents');
const verifyRouter = require('./routes/verify');
const { verifyLimiter, createLimiter } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "https://ip-api.com"],
      imgSrc: ["'self'", "data:"],
    },
  },
}));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.set('trust proxy', 1);

app.use(express.static(path.join(__dirname, '../public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

app.use('/verify', verifyLimiter, verifyRouter);
app.use('/api/documents', createLimiter, documentsRouter);

app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`DocVerify running on http://localhost:${PORT}`);
  console.log(`Verify URL base: ${process.env.BASE_URL || 'http://localhost:' + PORT}`);
});

module.exports = app;