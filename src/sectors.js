// src/sectors.js
// Sector packs: what changes between a university and, say, a professional
// body. The signing, QR and verify engine never changes; only words, document
// types, record field labels and status rules do.
//
// Internal names stay as they are (matric_number, student_records,
// programme...) so nothing in the database is renamed. A pack only decides
// what people SEE: "Membership number" instead of "Matric number", which
// record fields show and what they're called, and which statuses allow an
// award. The tertiary pack reproduces today's behaviour exactly.

// Record field slots (columns of student_records and document metadata).
// A pack gives each a label, or null to hide it.
const FIELD_SLOTS = ['programme', 'faculty', 'department', 'degree_class', 'entry_year', 'graduation_year'];

const PACKS = {
  tertiary: {
    label: 'University, polytechnic or college',
    deployment: 'tertiary',
    layout: 'academic',
    terms: {
      org: 'school', holder: 'graduate', holders: 'graduates', subject: 'student', subjects: 'students',
      id_label: 'Matric number', id_short: 'Matric', records: 'student records', records_title: 'Student records',
      portal: 'graduate portal', system: 'student information system', system_short: 'SIS',
      list: 'student list', look_up: 'Look up student', name_label: 'Graduate full name',
    },
    fields: { programme: 'Programme / course', faculty: 'Faculty', department: 'Department',
              degree_class: 'Class of degree', entry_year: 'Entry year', graduation_year: 'Graduation year' },
    doc_types: [
      { name: 'Certificate', award: true }, { name: 'Transcript' }, { name: 'Statement of Results' },
      { name: 'Diploma', award: true }, { name: 'Completion', award: true }, { name: 'Admission' },
      { name: 'Attestation' }, { name: 'Clearance Certificate' }, { name: 'Professional Licence' },
    ],
    default_type: 'Certificate',
    finished: ['graduated', 'completed', 'alumni', 'alumnus'],
    finished_label: 'Graduated',
    unusual: ['withdrawn', 'expelled', 'rusticated', 'suspended', 'deceased', 'transferred'],
    signatories: ['Registrar', 'Vice-Chancellor'],
  },

  professional_body: {
    label: 'Professional body or association',
    deployment: 'sectors',
    layout: 'official',
    terms: {
      org: 'institute', holder: 'member', holders: 'members', subject: 'member', subjects: 'members',
      id_label: 'Membership number', id_short: 'Membership no.', records: 'member register', records_title: 'Member register',
      portal: 'member portal', system: 'membership system', system_short: 'membership system',
      list: 'member list', look_up: 'Look up member', name_label: 'Member full name',
    },
    fields: { programme: 'Grade', faculty: null, department: 'Branch or chapter',
              degree_class: 'Scope of practice', entry_year: 'Year admitted', graduation_year: null },
    doc_types: [
      { name: 'Practising Licence', award: true, validity_months: 12 },
      { name: 'Membership Certificate', award: true },
      { name: 'CPD Certificate' },
      { name: 'Letter of Good Standing', award: true, validity_months: 3 },
    ],
    default_type: 'Practising Licence',
    finished: ['active', 'financial', 'in good standing'],
    finished_label: 'Active',
    unusual: ['lapsed', 'suspended', 'struck off', 'deceased', 'resigned'],
    signatories: ['Registrar', 'President'],
  },

  training: {
    label: 'Training or certification provider',
    deployment: 'sectors',
    layout: 'official',
    terms: {
      org: 'provider', holder: 'learner', holders: 'learners', subject: 'learner', subjects: 'learners',
      id_label: 'Learner number', id_short: 'Learner no.', records: 'learner records', records_title: 'Learner records',
      portal: 'learner portal', system: 'learning management system', system_short: 'LMS',
      list: 'learner list', look_up: 'Look up learner', name_label: 'Learner full name',
    },
    fields: { programme: 'Course', faculty: null, department: 'Centre', degree_class: 'Result or grade',
              entry_year: 'Start year', graduation_year: 'Completion year' },
    doc_types: [
      { name: 'Course Completion Certificate', award: true },
      { name: 'Competency Certificate', award: true },
      { name: 'CPD Certificate' },
      { name: 'Statement of Results' },
    ],
    default_type: 'Course Completion Certificate',
    finished: ['completed', 'passed', 'certified'],
    finished_label: 'Completed',
    unusual: ['withdrawn', 'failed', 'suspended', 'deferred'],
    signatories: ['Head of Training', 'Director'],
  },

  secondary: {
    label: 'Secondary school',
    deployment: 'sectors',
    layout: 'official',
    terms: {
      org: 'school', holder: 'former student', holders: 'former students', subject: 'student', subjects: 'students',
      id_label: 'Admission number', id_short: 'Admission no.', records: 'student records', records_title: 'Student records',
      portal: 'student portal', system: 'school management system', system_short: 'school system',
      list: 'student list', look_up: 'Look up student', name_label: 'Student full name',
    },
    fields: { programme: 'Class or arm', faculty: null, department: 'House', degree_class: null,
              entry_year: 'Year admitted', graduation_year: 'Year left' },
    doc_types: [
      { name: 'Testimonial', award: true }, { name: 'School Transcript' },
      { name: 'Leaving Certificate', award: true }, { name: 'Admission Letter' },
    ],
    default_type: 'Testimonial',
    finished: ['graduated', 'completed', 'left'],
    finished_label: 'Graduated',
    unusual: ['withdrawn', 'expelled', 'suspended', 'transferred'],
    signatories: ['Principal', 'Proprietor'],
  },

  employer: {
    label: 'Employer',
    deployment: 'sectors',
    layout: 'official',
    terms: {
      org: 'organisation', holder: 'employee', holders: 'employees', subject: 'staff member', subjects: 'staff members',
      id_label: 'Staff number', id_short: 'Staff no.', records: 'staff records', records_title: 'Staff records',
      portal: 'staff portal', system: 'HR system', system_short: 'HR system',
      list: 'staff list', look_up: 'Look up staff member', name_label: 'Employee full name',
    },
    fields: { programme: 'Job title', faculty: null, department: 'Department', degree_class: null,
              entry_year: 'Year joined', graduation_year: 'Year left' },
    doc_types: [
      { name: 'Employment Letter' }, { name: 'Reference Letter' },
      { name: 'Experience Letter' }, { name: 'Training Certificate', award: true },
    ],
    default_type: 'Employment Letter',
    finished: ['employed', 'active', 'exited'],
    finished_label: 'Employed',
    unusual: ['dismissed', 'suspended', 'deceased'],
    signatories: ['Head of HR', 'Managing Director'],
  },

  government: {
    label: 'Government agency',
    deployment: 'sectors',
    layout: 'official',
    terms: {
      org: 'agency', holder: 'holder', holders: 'holders', subject: 'holder', subjects: 'holders',
      id_label: 'Permit or file number', id_short: 'File no.', records: 'holder register', records_title: 'Holder register',
      portal: 'holder portal', system: 'agency records system', system_short: 'records system',
      list: 'holder list', look_up: 'Look up holder', name_label: 'Holder full name',
    },
    fields: { programme: 'Activity or purpose', faculty: null, department: 'Location', degree_class: 'Category',
              entry_year: 'Year first issued', graduation_year: null },
    doc_types: [
      { name: 'Operating Permit', award: true, validity_months: 12 }, { name: 'Trade Licence', award: true, validity_months: 12 },
      { name: 'Clearance Certificate' }, { name: 'Approval Letter' },
    ],
    default_type: 'Operating Permit',
    finished: ['active', 'approved', 'in good standing'],
    finished_label: 'Active',
    unusual: ['suspended', 'revoked', 'lapsed'],
    signatories: ['Director', 'Director General'],
  },
};

const SECTORS = Object.keys(PACKS);
const pack = sector => PACKS[sector] || PACKS.tertiary;

// What the browser needs to label the staff app for this tenant
function publicPack(sector, docTypes) {
  const p = pack(sector);
  return {
    sector: PACKS[sector] ? sector : 'tertiary',
    sector_label: p.label,
    terms: p.terms,
    fields: p.fields,
    finished_label: p.finished_label,
    signatories: p.signatories,
    doc_types: (docTypes || p.doc_types).map(t => t.name),
    default_type: p.default_type,
  };
}

module.exports = { PACKS, SECTORS, FIELD_SLOTS, pack, publicPack };
