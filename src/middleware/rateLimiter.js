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

// Login routes — 10 failed attempts per 15 minutes per IP (H-01)
// Only counts failed attempts. Successful logins do not count toward the limit.
const loginLimiter = rateLimit({
  windowMs:               15 * 60 * 1000,
  max:                    10,
  standardHeaders:        true,
  legacyHeaders:          false,
  skipSuccessfulRequests: true,
  message:                { error: 'Too many login attempts. Please try again in 15 minutes.' },
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