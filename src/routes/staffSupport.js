// /app-api/support: school staff open and follow support tickets.
// Every staff role can open a ticket and see all of its school's tickets
// (a colleague can pick up a thread). Print vendors can't: they go through
// the school. Innovation Lens answers from /admin-api/support.

const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { requireStaff } = require('../middleware/staffAuth');
const { logActivity } = require('../utils/activity');
const { cleanText, cleanNote } = require('../utils/text');
const { sendSupportNotice } = require('../utils/mailer');
const { tenantBaseUrl } = require('../utils/docUtils');

const STAFF = requireStaff('owner', 'officer', 'approver', 'auditor');
const CATEGORIES = ['technical', 'documents', 'account', 'billing', 'other'];
const MAX_BODY = 5000;
const OPEN_LIMIT = 20; // open tickets per school at once, against floods
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

const supportInbox = () => process.env.SUPPORT_EMAIL || process.env.SMTP_USER || null;
const ROOT = (process.env.ROOT_TENANT_SUBDOMAIN || 'demo').toLowerCase();

function notifySupport(req, ticket, what) {
  sendSupportNotice({
    to: supportInbox(),
    subject: `[UniVerify #${ticket.ticket_no}] ${what}: ${req.tenant.name}`,
    heading: `${req.tenant.name}: ticket #${ticket.ticket_no}`,
    lines: [`${what}. Category: ${ticket.category}${ticket.priority === 'urgent' ? ', marked urgent' : ''}.`, `Subject: ${ticket.subject}`],
    link: `${tenantBaseUrl(ROOT)}/admin`, linkText: 'Open the Support tab',
  }).catch(() => {});
}

async function loadTicket(req, id) {
  if (!UUID.test(id)) return null;
  const r = await pool.query(
    `SELECT t.*, u.full_name AS created_by_name, u.email AS created_by_email
       FROM support_tickets t LEFT JOIN tenant_users u ON u.id = t.created_by
      WHERE t.id = $1 AND t.tenant_id = $2`, [id, req.tenant.id]);
  return r.rows[0] || null;
}

router.get('/', STAFF, async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT t.id, t.ticket_no, t.category, t.priority, t.subject, t.status, t.created_at, t.updated_at,
              u.full_name AS created_by_name,
              (SELECT author_kind FROM support_messages m WHERE m.ticket_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_from
         FROM support_tickets t LEFT JOIN tenant_users u ON u.id = t.created_by
        WHERE t.tenant_id = $1
        ORDER BY (t.status IN ('resolved', 'closed')), t.updated_at DESC
        LIMIT 200`, [req.tenant.id]);
    res.json({ tickets: r.rows, categories: CATEGORIES });
  } catch (e) { next(e); }
});

router.post('/', STAFF, async (req, res, next) => {
  const b = req.body || {};
  const category = CATEGORIES.includes(b.category) ? b.category : null;
  const subject = cleanText(b.subject, 150);
  const body = cleanNote(b.message, MAX_BODY);
  const page = cleanText(b.page, 200) || null;
  const priority = b.priority === 'urgent' ? 'urgent' : 'normal';
  if (!category) return bad(res, 'Pick a category.');
  if (subject.length < 4) return bad(res, 'Give the ticket a short subject.');
  if (body.length < 10) return bad(res, 'Describe the problem in a sentence or two.');
  const client = await pool.connect();
  try {
    const open = await client.query(`SELECT COUNT(*)::int AS n FROM support_tickets WHERE tenant_id = $1 AND status IN ('open', 'answered')`, [req.tenant.id]);
    if (open.rows[0].n >= OPEN_LIMIT) return bad(res, `Your school already has ${OPEN_LIMIT} open tickets. Close the ones that are sorted first.`, 429);
    await client.query('BEGIN');
    const t = (await client.query(
      `INSERT INTO support_tickets (tenant_id, created_by, category, priority, subject, page)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.tenant.id, req.staff.id, category, priority, subject, page])).rows[0];
    await client.query(
      `INSERT INTO support_messages (ticket_id, author_kind, author_id, author_name, body) VALUES ($1,'school',$2,$3,$4)`,
      [t.id, req.staff.id, req.staff.full_name || req.staff.email, body]);
    await client.query('COMMIT');
    await logActivity(req, { action: 'support_ticket_opened', targetType: 'support_ticket', targetId: t.id,
      detail: { ticket_no: t.ticket_no, category, priority, subject } });
    notifySupport(req, t, 'New ticket');
    res.status(201).json({ ticket: t });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally { client.release(); }
});

router.get('/:id', STAFF, async (req, res, next) => {
  try {
    const t = await loadTicket(req, req.params.id);
    if (!t) return bad(res, 'Ticket not found.', 404);
    const m = await pool.query(
      `SELECT id, author_kind, author_name, body, created_at FROM support_messages WHERE ticket_id = $1 ORDER BY created_at`, [t.id]);
    res.json({ ticket: t, messages: m.rows });
  } catch (e) { next(e); }
});

router.post('/:id/reply', STAFF, async (req, res, next) => {
  try {
    const t = await loadTicket(req, req.params.id);
    if (!t) return bad(res, 'Ticket not found.', 404);
    if (t.status === 'closed') return bad(res, 'This ticket is closed. Open a new one.', 409);
    const body = cleanNote((req.body || {}).message, MAX_BODY);
    if (body.length < 2) return bad(res, 'Write a message.');
    await pool.query(
      `INSERT INTO support_messages (ticket_id, author_kind, author_id, author_name, body) VALUES ($1,'school',$2,$3,$4)`,
      [t.id, req.staff.id, req.staff.full_name || req.staff.email, body]);
    // A reply from the school reopens a resolved ticket
    await pool.query(`UPDATE support_tickets SET status = 'open', resolved_at = NULL, updated_at = NOW() WHERE id = $1`, [t.id]);
    await logActivity(req, { action: 'support_ticket_replied', targetType: 'support_ticket', targetId: t.id, detail: { ticket_no: t.ticket_no } });
    notifySupport(req, t, t.status === 'resolved' ? 'Reopened by the school' : 'New reply from the school');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/:id/close', STAFF, async (req, res, next) => {
  try {
    const t = await loadTicket(req, req.params.id);
    if (!t) return bad(res, 'Ticket not found.', 404);
    if (t.status === 'closed') return bad(res, 'Already closed.', 409);
    await pool.query(`UPDATE support_tickets SET status = 'closed', updated_at = NOW() WHERE id = $1`, [t.id]);
    await logActivity(req, { action: 'support_ticket_closed', targetType: 'support_ticket', targetId: t.id, detail: { ticket_no: t.ticket_no } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.CATEGORIES = CATEGORIES;
