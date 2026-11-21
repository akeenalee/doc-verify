// What the public verify page may show about a document, set per school.
// Document ID, issuing institution, type, issue date and status are always
// shown: without them a verifier can't tell what was checked.

const FIELDS = {
  holder_name:     { label: "Holder's full name", default: true },
  title:           { label: 'Qualification title', default: true },
  programme:       { label: 'Programme / course', default: false },
  class_of_degree: { label: 'Class of degree', default: false },
  graduation_year: { label: 'Graduation year', default: false },
  document_pdf:    { label: 'Full document (PDF preview and download)', default: true },
};

function disclosure(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const out = {};
  for (const [k, f] of Object.entries(FIELDS)) out[k] = typeof s[k] === 'boolean' ? s[k] : f.default;
  return out;
}

// The same switches in the issuer's sector words; slots the sector doesn't
// use are left out (their switch stays off). Tertiary gets FIELDS unchanged.
const SLOT = { programme: 'programme', class_of_degree: 'degree_class', graduation_year: 'graduation_year' };
function fieldsFor(kit) {
  if (!kit || kit.sector === 'tertiary') return FIELDS;
  const out = {};
  for (const [k, f] of Object.entries(FIELDS)) {
    if (SLOT[k]) { const label = kit.pack.fields[SLOT[k]]; if (label) out[k] = { ...f, label }; }
    else out[k] = k === 'title' ? { ...f, label: 'Document title' } : f;
  }
  return out;
}

module.exports = { FIELDS, disclosure, fieldsFor };
