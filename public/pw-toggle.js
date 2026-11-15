// Show/Hide toggle for every password field, including ones added later
// (modals). Self-contained so any page can include it with one script tag.
(function () {
  'use strict';
  function enhance(input) {
    if (input.dataset.pwToggle) return;
    input.dataset.pwToggle = '1';
    const wrap = document.createElement('span');
    wrap.style.cssText = 'position:relative;display:block;width:100%';
    // Move the field's outer margin to the wrapper so the button centres on the field itself
    const cs = getComputedStyle(input);
    wrap.style.margin = cs.marginTop + ' ' + cs.marginRight + ' ' + cs.marginBottom + ' ' + cs.marginLeft;
    input.style.margin = '0';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    input.style.paddingRight = '64px';
    input.style.width = '100%';
    input.style.boxSizing = 'border-box';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Show';
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('aria-pressed', 'false');
    btn.style.cssText = 'position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:transparent;' +
      'color:#1A3A5C;font-family:inherit;font-weight:600;font-size:12px;line-height:1;padding:6px 8px;cursor:pointer;border-radius:4px;margin:0;width:auto;';
    btn.addEventListener('click', function () {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.setAttribute('aria-pressed', String(show));
      input.focus();
    });
    // Never submit a form with the password left visible in the field
    if (input.form) input.form.addEventListener('submit', function () {
      if (input.type === 'text') { input.type = 'password'; btn.textContent = 'Show'; btn.setAttribute('aria-pressed', 'false'); }
    });
    wrap.appendChild(btn);
  }
  function scan(root) {
    (root.querySelectorAll ? root : document).querySelectorAll('input[type=password]').forEach(enhance);
  }
  function start() {
    scan(document);
    new MutationObserver(function (muts) {
      muts.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) { if (n.matches && n.matches('input[type=password]')) enhance(n); else scan(n); } }); });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
