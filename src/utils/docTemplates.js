// src/utils/docTemplates.js
// An issuer's "kit": its sector pack plus the document types it issues.
// Document types come from doc_templates when the issuer has its own rows,
// otherwise from the sector's defaults (so every school keeps today's list).

const pool = require('../db/pool');
const { pack, PACKS } = require('../sectors');

function makeKit(sector, types) {
  const s = PACKS[sector] ? sector : 'tertiary';
  const p = pack(s);
  const list = (types && types.length ? types : p.doc_types).map(t => ({
    name: t.name, award: !!t.award, validity_months: t.validity_months || null,
  }));
  return {
    sector: s, pack: p, terms: p.terms, types: list,
    names: list.map(t => t.name),
    awards: list.filter(t => t.award).map(t => t.name),
    type: name => list.find(t => t.name === name) || null,
  };
}

const TERTIARY = makeKit('tertiary');

async function kitFor(tenant, db = pool) {
  if (!tenant) return TERTIARY;
  const r = await db.query(
    `SELECT name, award, validity_months FROM doc_templates
     WHERE tenant_id = $1 AND active ORDER BY sort, name`, [tenant.id]);
  return makeKit(tenant.sector, r.rows);
}

// Give a new issuer its sector's starting document types (editable later)
async function seedTemplates(db, tenantId, sector) {
  const p = pack(sector);
  let i = 0;
  for (const t of p.doc_types) {
    await db.query(
      `INSERT INTO doc_templates (tenant_id, name, award, validity_months, sort)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, name) DO NOTHING`,
      [tenantId, t.name, !!t.award, t.validity_months || null, i++]);
  }
}

// CSV headings: a sector also accepts its own names for each slot, e.g.
// membership_number and grade for a professional body
const normHeader = h => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
function sectorColumns(kit) {
  if (!kit || kit.sector === 'tertiary') return {};
  const extra = { matric_number: [normHeader(kit.terms.id_label)] };
  for (const [slot, label] of Object.entries(kit.pack.fields)) if (label) extra[slot] = [normHeader(label)];
  return extra;
}

module.exports = { kitFor, makeKit, seedTemplates, sectorColumns, normHeader, TERTIARY };
