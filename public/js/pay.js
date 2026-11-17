const params   = new URLSearchParams(window.location.search);
const docId    = params.get('doc');
// Holder details stay hidden until payment; only the type and issuer show here
const title    = params.get('type');
const issuedTo = params.get('issued_by');
const error    = params.get('error');

if (error) {
  const banner = document.getElementById('error-banner');
  const msgs   = {
    payment_failed:      'Payment was not completed. Please try again.',
    payment_invalid:     'Payment could not be verified. Please try again.',
    missing_reference:   'Payment reference missing. Please scan the QR code again.',
    verification_failed: 'An error occurred. Please try again.',
  };
  banner.textContent = msgs[error] || 'An error occurred.';
  banner.classList.add('show');
}

if (title || issuedTo || docId) {
  document.getElementById('doc-box').style.display    = 'block';
  document.getElementById('doc-title').textContent    = title || 'N/A';
  document.getElementById('doc-issued').textContent   = issuedTo || 'N/A';
  document.getElementById('doc-id').textContent       = docId || 'N/A';
}

// On page load, verify document is still payable
// Catches stale pages where document was revoked or expired after the page was opened
if (docId) {
  (async function checkDocStatus() {
    try {
      const res  = await fetch('/verify/api/' + encodeURIComponent(docId));
      const data = await res.json();

      if (!res.ok || !data.valid) {
        const banner = document.getElementById('error-banner');
        const btn    = document.getElementById('pay-btn');
        const msgs   = {
          revoked: 'This document has been revoked by the issuing institution and cannot be verified.',
          expired: 'This document has expired and cannot be verified.',
          not_found: 'This document could not be found. Please check the QR code and try again.',
        };
        const reason = data.status || 'not_found';
        banner.textContent = msgs[reason] || 'This document is no longer available for verification.';
        banner.classList.add('show');

        // Hide payment form, show friendly block state
        btn.disabled = true;
        btn.textContent = 'Payment Unavailable';
        btn.style.background = '#aaa';
        document.getElementById('email').disabled = true;
        document.getElementById('email').style.background = '#f5f5f5';
      }
    } catch (e) {
      // Network error - allow payment to proceed, server will validate
      console.warn('Pre-check failed:', e.message);
    }
  })();
}

document.getElementById('pay-btn').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const errEl = document.getElementById('err');
  const btn   = document.getElementById('pay-btn');
  errEl.classList.remove('show');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEl.textContent = 'Please enter a valid email address.';
    errEl.classList.add('show');
    return;
  }
  if (!docId) {
    errEl.textContent = 'Document ID missing. Please scan the QR code again.';
    errEl.classList.add('show');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Initiating payment...';

  try {
    const res  = await fetch('/verify/api/initiate-payment', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ doc_id: docId, email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Payment initiation failed.');
    window.location.href = data.payment_url;
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.add('show');
    btn.disabled    = false;
    btn.textContent = 'Pay and Verify';
  }
});
