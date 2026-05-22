const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');

const DEMO_USER = process.env.DEMO_USER || 'univerify';
const DEMO_PASS = process.env.DEMO_PASS || 'Demo@2026!';

// POST /demo/login
router.post('/login', async (req, res) => {
  const { username, password, full_name, email, company, role } = req.body;

  if (username !== DEMO_USER || password !== DEMO_PASS) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const ip        = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';

  try {
    await pool.query(
      `INSERT INTO demo_visitors (full_name, email, company, role, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [full_name || null, email || null, company || null, role || null, ip, userAgent]
    );
  } catch (e) {
    console.error('Demo visitor log error:', e.message);
  }

  req.session.demoAuth = true;
  req.session.demoName = full_name || 'Guest';
  res.json({ success: true });
});

// POST /demo/logout
router.post('/logout', (req, res) => {
  req.session.demoAuth = false;
  res.json({ success: true });
});

// GET /demo/visitors
router.get('/visitors', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, email, company, role, ip_address, user_agent,
              first_seen_at, last_seen_at, page_views
       FROM demo_visitors
       ORDER BY first_seen_at DESC
       LIMIT 200`
    );
    res.json({ visitors: result.rows, total: result.rows.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch visitors.' });
  }
});

// GET /demo/status
router.get('/status', (req, res) => {
  res.json({ authenticated: !!req.session.demoAuth, name: req.session.demoName || null });
});

module.exports = router;