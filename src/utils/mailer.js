// Best-effort transactional email over the existing Zoho SMTP settings.
// Returns true when sent, false when SMTP isn't configured or sending failed,
// so callers can fall back to showing a copyable link.

const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:       process.env.SMTP_HOST || 'smtp.zoho.com',
      port:       parseInt(process.env.SMTP_PORT) || 587,
      secure:     false,
      requireTLS: true,
      auth:       { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendStaffInvite({ to, name, tenantName, link, roles }) {
  const t = getTransporter();
  if (!t) return false;
  try {
    await t.sendMail({
      from:    `"UniVerify" <${process.env.SMTP_USER}>`,
      to,
      subject: `You've been invited to ${tenantName} on UniVerify`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
          <h2 style="color:#1A3A5C;margin-bottom:4px">${esc(tenantName)}</h2>
          <p>Hello ${esc(name || '')},</p>
          <p>You've been given access to the UniVerify records workspace as <strong>${esc(roles.join(', '))}</strong>.</p>
          <p>Set your password and two-factor sign-in here. The link works once and expires in 72 hours.</p>
          <p><a href="${esc(link)}" style="display:inline-block;background:#1A3A5C;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Set up my account</a></p>
          <p style="font-size:12px;color:#777">If you weren't expecting this, ignore this email.</p>
        </div>`,
    });
    return true;
  } catch (e) {
    console.error('Invite email failed:', e.message);
    return false;
  }
}

module.exports = { sendStaffInvite };
