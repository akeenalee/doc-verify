// Free text from forms, CSV uploads and the SIS, cleaned once on the way in
// (finding M-03). Every page also escapes on output; this is the second layer.
//
// Removed: < and >, control characters, zero-width characters, and the
// bidirectional overrides that can make "ADE" display as "EDA" on a verify
// page. Kept: every letter, including Yoruba, Igbo and Hausa tone marks,
// apostrophes ("O'Brien") and ampersands ("Science & Technology").
// Never use this on passwords, secrets, file contents or base64.

const STRIP = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁩﻿<>]/g;

const cut = (s, max) => (s.length <= max ? s : Array.from(s).slice(0, max).join(''));

// One line: tabs and line breaks become spaces, runs of spaces collapse
function cleanText(v, max = 255) {
  if (v === undefined || v === null) return '';
  const s = String(v).normalize('NFC').replace(STRIP, '').replace(/\s+/g, ' ').trim();
  return cut(s, max).trim();
}

// Notes: line breaks kept (at most two in a row), everything else as above
function cleanNote(v, max = 500) {
  if (v === undefined || v === null) return '';
  const s = String(v).normalize('NFC').replace(/\r\n?/g, '\n').replace(STRIP, '')
    .replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return cut(s, max).trim();
}

module.exports = { cleanText, cleanNote };
