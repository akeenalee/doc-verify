// One-off: create the IL admin's two-factor secret.
// Run: node scripts/admin-totp-setup.js
// Scan the QR with an authenticator app, then put the secret in Render as
// ADMIN_TOTP_SECRET. From the next deploy, /admin sign-in asks for the code.

const QRCode = require('qrcode');
const A = require('../src/utils/staffAuth');

const secret = A.generateTotpSecret();
const uri = A.totpUri(secret, process.env.ADMIN_USER || 'iladmin', 'UniVerify IL Admin');

QRCode.toString(uri, { type: 'terminal', small: true }, (err, qr) => {
  if (err) throw err;
  console.log(qr);
  console.log('Scan the QR above with Google Authenticator, Microsoft Authenticator or 1Password.');
  console.log('If the QR does not scan, add this key by hand:\n');
  console.log('  ' + secret.match(/.{1,4}/g).join(' '));
  console.log('\nThen in Render, Environment, add:\n');
  console.log('  ADMIN_TOTP_SECRET=' + secret);
  console.log('\nKeep a copy of the key in your password manager. It is the only way to re-add the account.');
});
