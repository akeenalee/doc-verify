function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 2000); });
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-copy]');
  if (b) copyText(b.dataset.copy, b);
});
