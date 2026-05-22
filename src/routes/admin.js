const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const crypto  = require('crypto');

const ADMIN_USER = process.env.ADMIN_USER || 'iladmin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'IL@Admin2026!';

// POST /admin/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }
  req.session.adminAuth = true;
  res.json({ success: true });
});

// POST /admin/logout
router.post('/logout', (req, res) => {
  req.session.adminAuth = false;
  res.json({ success: true });
});

// GET /admin/status
router.get('/status', (req, res) => {
  res.json({ authenticated: !!req.session.adminAuth });
});

// GET /admin/tokens - list all tokens
router.get('/tokens', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, token, label, name, email, company, role,
              created_at, expires_at, max_uses, use_count,
              last_used_at, is_active, notes
       FROM demo_tokens
       ORDER BY created_at DESC`
    );
    res.json({ tokens: result.rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch tokens.' });
  }
});

// POST /admin/tokens - create a new token
router.post('/tokens', async (req, res) => {
  const { label, name, email, company, role, expires_days, max_uses, notes } = req.body;
  const token    = crypto.randomBytes(24).toString('hex');
  const expiresAt = expires_days
    ? new Date(Date.now() + parseInt(expires_days) * 24 * 60 * 60 * 1000)
    : null;

  try {
    const result = await pool.query(
      `INSERT INTO demo_tokens (token, label, name, email, company, role, expires_at, max_uses, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [token, label || null, name || null, email || null, company || null,
       role || null, expiresAt, parseInt(max_uses) || 0, notes || null]
    );
    res.json({ token: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create token.' });
  }
});

// PATCH /admin/tokens/:id/revoke
router.patch('/tokens/:id/revoke', async (req, res) => {
  try {
    await pool.query(
      'UPDATE demo_tokens SET is_active = FALSE WHERE id = $1',
      [req.params.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to revoke token.' });
  }
});

// PATCH /admin/tokens/:id/activate
router.patch('/tokens/:id/activate', async (req, res) => {
  try {
    await pool.query(
      'UPDATE demo_tokens SET is_active = TRUE WHERE id = $1',
      [req.params.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to activate token.' });
  }
});

// DELETE /admin/tokens/:id
router.delete('/tokens/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM demo_tokens WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete token.' });
  }
});

// GET /admin/visitors - all demo visitors
router.get('/visitors', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, email, company, role, ip_address,
              user_agent, first_seen_at, last_seen_at, page_views
       FROM demo_visitors
       ORDER BY first_seen_at DESC
       LIMIT 500`
    );
    res.json({ visitors: result.rows, total: result.rows.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch visitors.' });
  }
});

// GET /admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [visitors, tokens, scans] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM demo_visitors'),
      pool.query('SELECT COUNT(*) FROM demo_tokens WHERE is_active = TRUE'),
      pool.query('SELECT COUNT(*) FROM verification_log'),
    ]);
    res.json({
      total_visitors: parseInt(visitors.rows[0].count),
      active_tokens:  parseInt(tokens.rows[0].count),
      total_scans:    parseInt(scans.rows[0].count),
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

module.exports = router;