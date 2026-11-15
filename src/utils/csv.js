// Minimal RFC 4180 CSV reader and writer: quoted fields, escaped quotes,
// CRLF or LF, a UTF-8 BOM from Excel. No dependency needed for class lists.

function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', i = 0, quoted = false;
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r' || c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
      if (c === '\r' && s[i + 1] === '\n') i++;
      i++; continue;
    }
    field += c; i++;
  }
  if (quoted) throw new Error('The file has an unclosed quote. Check the row with a stray " character.');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  // Drop fully empty lines (Excel adds them at the end)
  return rows.filter(r => r.some(v => String(v).trim() !== ''));
}

// Neutralise spreadsheet formulas in exported cells (CSV injection)
function cell(v) {
  let x = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(x)) x = "'" + x;
  return /[",\r\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
}
const toCsv = rows => rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';

module.exports = { parseCsv, toCsv };
