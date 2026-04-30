require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const documentsRouter = require('./routes/documents');
const verifyRouter = require('./routes/verify');
const { verifyLimiter, createLimiter } = require('./middleware/rateLimiter');

const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'unsafe-inline'"],
    },
  },
}));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Trust proxy for correct IP behind nginx/load balancer
app.set('trust proxy', 1);

// Serve admin UI
app.use(express.static(path.join(__dirname, '../public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

// Routes
app.use('/verify', verifyLimiter, verifyRouter);
app.use('/api/documents', createLimiter, documentsRouter);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`DocVerify running on http://localhost:${PORT}`);
  console.log(`Verify URL base: ${process.env.BASE_URL || 'http://localhost:' + PORT}`);
});

module.exports = app;
