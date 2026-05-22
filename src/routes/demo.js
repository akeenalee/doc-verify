const express    = require('express');
const router     = express.Router();
const pool       = require('../db/pool');
const nodemailer = require('nodemailer');

const DEMO_USER = process.env.DEMO_USER || 'univerify';
const DEMO_PASS = process.env.DEMO_PASS || 'Demo@2026!';

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.zoho.com',
  port:   parseInt(process.env.SMTP_PORT) || 465,
  secure: parseInt(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendVisitorNotification(visitor) {
  const to      = process.env.NOTIFY_EMAIL || process.env.SMTP_USER;
  const time    = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos' });
  const ua      = visitor.user_agent || '';
  const device  = ua.includes('Mobile') ? '📱 Mobile' : ua.includes('iPad') ? '📱 Tablet' : '💻 Desktop';

  try {
    await transporter.sendMail({
      from:    `"UniVerify Demo" <${process.env.SMTP_USER}>`,
      to,
      subject: `🔔 New Demo Access — ${visitor.full_name || 'Unknown'} (${visitor.company || 'No company'})`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#f5f6f8;padding:24px;border-radius:12px">
          <div style="background:#1A3A5C;padding:20px 24px;border-radius:8px 8px 0 0">
            <h2 style="color:#fff;margin:0;font-size:18px">UniVerify Demo Access</h2>
            <p style="color:#8AADCC;margin:4px 0 0;font-size:13px">Someone just logged into the demo platform</p>
          </div>
          <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e0e4ea;border-top:none">

            <table style="width:100%;border-collapse:collapse">
              <tr style="background:#f5f6f8">
                <td style="padding:10px 14px;font-size:12px;color:#888;width:130px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Name</td>
                <td style="padding:10px 14px;font-size:14px;color:#1A3A5C;font-weight:600">${visitor.full_name || '—'}</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;font-size:12px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Email</td>
                <td style="padding:10px 14px;font-size:14px;color:#333">${visitor.email || '—'}</td>
              </tr>
              <tr style="background:#f5f6f8">
                <td style="padding:10px 14px;font-size:12px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Institution</td>
                <td style="padding:10px 14px;font-size:14px;color:#333">${visitor.company || '—'}</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;font-size:12px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Role</td>
                <td style="padding:10px 14px;font-size:14px;color:#333">${visitor.role || '—'}</td>
              </tr>
              <tr style="background:#f5f6f8">
                <td style="padding:10px 14px;font-size:12px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">IP Address</td>
                <td style="padding:10px 14px;font-size:14px;color:#333;font-family:monospace">${visitor.ip_address || '—'}</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;font-size:12px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Device</td>
                <td style="padding:10px 14px;font-size:14px;color:#333">${device}</td>
              </tr>
              <tr style="background:#f5f6f8">
                <td style="padding:10px 14px;font-size:12px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Time (WAT)</td>
                <td style="padding:10px 14px;font-size:14px;color:#333">${time}</td>
              </tr>
            </table>

            <div style="margin-top:20px;padding:14px 16px;background:#e1f5ee;border-radius:8px;border-left:4px solid #0A6B45">
              <p style="margin:0;font-size:13px;color:#0A6B45;font-weight:600">Follow-up recommended within 24 hours</p>
              <p style="margin:4px 0 0;font-size:12px;color:#555">Log into your dashboard to see the full visitor list: <a href="https://verify.akeenalee.com" style="color:#1A3A5C">verify.akeenalee.com</a></p>
            </div>
          </div>
          <p style="text-align:center;font-size:11px;color:#aaa;margin-top:16px">
            UniVerify · Innovation Lens Resources Ltd · verify.akeenalee.com
          </p>
        </div>
      `,
    });
    console.log('Demo visitor notification sent to', to);
  } catch (e) {
    console.error('Email notification failed:', e.message);
  }
}

// POST /demo/login
router.post('/login', async (req, res) => {
  const { username, password, full_name, email, company, role } = req.body;

  if (username !== DEMO_USER || password !== DEMO_PASS) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const ip        = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';

  const visitor = { full_name, email, company, role, ip_address: ip, user_agent: userAgent };

  try {
    await pool.query(
      `INSERT INTO demo_visitors (full_name, email, company, role, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [full_name || null, email || null, company || null, role || null, ip, userAgent]
    );
  } catch (e) {
    console.error('Demo visitor log error:', e.message);
  }

  // Send email notification (non-blocking)
  sendVisitorNotification(visitor);

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