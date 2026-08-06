const { rateLimit } = require('express-rate-limit');

// Verification endpoints — 100 requests per 15 minutes
const verifyLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             100,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests. Please try again later.' },
});

// Document creation — 50 requests per 15 minutes
const createLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             50,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests. Please try again later.' },
});

// Login routes — 5 attempts per 15 minutes per IP (H-01)
// Applies to /demo/login, /api/tokens/login, /admin-api/login
const loginLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  skipSuccessfulRequests: true,  // only count failed attempts
  message:         { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

// Token routes — 30 requests per 15 minutes (M-01)
const tokensLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             30,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests. Please try again later.' },
});

module.exports = { verifyLimiter, createLimiter, loginLimiter, tokensLimiter };