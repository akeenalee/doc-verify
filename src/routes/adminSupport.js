// /admin-api/support: Innovation Lens answers support tickets from every
// school. Root admin only (an admin session on the root tenant).

const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { isRootAdmin } = require('./tenants');
const { cleanNote } = require('../utils/text');
const { sendSupportNotice } = require('../utils/mailer');
const { tenantBaseUrl } = require('../utils/docUtils');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['open', 'answered', 'resolved', 'closed'];
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

router.use((req, res, next) => isRootAdmin(req) ? next() : bad(res, 'Support tickets are only available on the Innovation Lens admin panel.', 403));

async function loadTicket(id) {
  if (!UUID.test(id)) return null;
  const r = await pool.query(
    `SELECT t.*, n.name AS tenant_name, n.subdomain, u.full_name AS created_by_name, u.email AS created_by_email
       FROM support_tickets t JOIN tenants n ON n.id = t.tenant_id
       LEFT JOIN tenant_users u ON u.id = t.created_by
      WHERE t.id = $1`, [id]);
  return r.rows[0] || null;
}

router.get('/', async (req, res, next) => {
  try {
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const r = await pool.query(
      `SELECT t.id, t.ticket_no, t.category, t.priority, t.subject, t.status, t.created_at, t.updated_at,
              n.name AS tenant_name, n.subdomain, u.full_name AS created_by_name,
              (SELECT author_kind FROM support_messages m WHERE m.ticket_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_from
         FROM support_tickets t JOIN tenants n ON n.id = t.tenant_id
         LEFT JOIN tenant_users u ON u.id = t.created_by
        WHERE ($1::text IS NULL AND t.status IN ('open', 'answered')) OR t.status = $1
        ORDER BY (t.priority = 'urgent') DESC, t.updated_at DESC
        LIMIT 300`, [status]);
    const c = await pool.query(`SELECT status, COUNT(*)::int AS n FROM support_tickets GROUP BY status`);
    res.json({ tickets: r.rows, counts: Object.fromEntries(c.rows.map(x => [x.status, x.n])) });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const t = await loadTicket(req.params.id);
    if (!t) return bad(res, 'Ticket not found.', 404);
    const m = await pool.query(
      `SELECT id, author_kind, author_name, body, created_at FROM support_messages WHERE ticket_id = $1 ORDER BY created_at`, [t.id]);
    res.json({ ticket: t, messages: m.rows });
  } catch (e) { next(e); }
});

// Reply, and optionally resolve in the same step
router.post('/:id/reply', async (req, res, next) => {
  try {
    const t = await loadTicket(req.params.id);
    if (!t) return bad(res, 'Ticket not found.', 404);
    if (t.status === 'closed') return bad(res, 'The school closed this ticket.', 409);
    const body = cleanNote((req.body || {}).message, 5000);
    if (body.length < 2) return bad(res, 'Write a reply.');
    const resolve = (req.body || {}).resolve === true;
    await pool.query(
      `INSERT INTO support_messages (ticket_id, author_kind, author_name, body) VALUES ($1,'support','UniVerify Support',$2)`, [t.id, body]);
    await pool.query(
      `UPDATE support_tickets SET status = $2::varchar, resolved_at = CASE WHEN $2::varchar = 'resolved' THEN NOW() ELSE NULL END, updated_at = NOW() WHERE id = $1`,
      [t.id, resolve ? 'resolved' : 'answered']);
    sendSupportNotice({
      to: t.created_by_email,
      subject: `[UniVerify #${t.ticket_no}] ${resolve ? 'Resolved' : 'New reply'}: ${t.subject}`,
      heading: `Ticket #${t.ticket_no}: ${t.subject}`,
      lines: [resolve ? 'UniVerify Support replied and marked your ticket resolved. Reply in UniVerify if it still needs work.' : 'UniVerify Support replied to your ticket.'],
      link: `${tenantBaseUrl(t.subdomain)}/app/#/support/${t.id}`, linkText: 'Read the reply',
    }).catch(() => {});
    res.json({ ok: true, status: resolve ? 'resolved' : 'answered' });
  } catch (e) { next(e); }
});

router.post('/:id/resolve', async (req, res, next) => {
  try {
    const t = await loadTicket(req.params.id);
    if (!t) return bad(res, 'Ticket not found.', 404);
    if (!['open', 'answered'].includes(t.status)) return bad(res, `The ticket is already ${t.status}.`, 409);
    await pool.query(`UPDATE support_tickets SET status = 'resolved', resolved_at = NOW(), updated_at = NOW() WHERE id = $1`, [t.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
