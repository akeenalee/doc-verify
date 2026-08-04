const PDFDocument = require('pdfkit');
const { generateQRBuffer, buildVerifyUrl } = require('./docUtils');
const { generateTranscript } = require('./transcriptGenerator');

// Government/MDA document type configurations
const GOVT_DOC_CONFIG = {
  'operating permit': {
    officeLabel: 'OFFICE OF THE DIRECTOR GENERAL',
    subLabel:    'OFFICIAL REGULATORY DOCUMENT',
    preamble:    'THIS IS TO CERTIFY THAT THE FOLLOWING ORGANISATION HAS BEEN DULY GRANTED',
    award:       'AN OPERATING PERMIT TO CARRY OUT THE FOLLOWING ACTIVITY',
    sigLine1:    'Director General',
    sigLine2:    'Authorised Officer',
    subject:     'Official Regulatory Document',
  },
  'professional licence': {
    officeLabel: 'OFFICE OF THE REGISTRAR-GENERAL',
    subLabel:    'OFFICIAL PROFESSIONAL LICENCE',
    preamble:    'THIS IS TO CERTIFY THAT THE FOLLOWING INDIVIDUAL HAS FULFILLED ALL REQUIREMENTS AND IS HEREBY LICENSED',
    award:       'TO PRACTISE THE FOLLOWING PROFESSION IN ACCORDANCE WITH APPLICABLE LAW',
    sigLine1:    'Registrar-General',
    sigLine2:    'Authorised Officer',
    subject:     'Official Professional Licence',
  },
  'compliance certificate': {
    officeLabel: 'OFFICE OF THE DIRECTOR GENERAL',
    subLabel:    'OFFICIAL COMPLIANCE CERTIFICATE',
    preamble:    'THIS IS TO CERTIFY THAT THE FOLLOWING ORGANISATION HAS BEEN INSPECTED AND FOUND TO BE IN COMPLIANCE WITH',
    award:       'ALL APPLICABLE REGULATORY REQUIREMENTS AND STANDARDS AS SPECIFIED HEREIN',
    sigLine1:    'Director General',
    sigLine2:    'Chief Inspector',
    subject:     'Official Compliance Certificate',
  },
  'court order': {
    officeLabel: 'OFFICE OF THE CHIEF REGISTRAR',
    subLabel:    'OFFICIAL COURT DOCUMENT',
    preamble:    'BY THE ORDER OF THE HONOURABLE COURT, IT IS HEREBY ORDERED AND DIRECTED THAT',
    award:       'THE FOLLOWING ORDER SHALL TAKE IMMEDIATE EFFECT UPON SERVICE ON ALL PARTIES',
    sigLine1:    'Chief Registrar',
    sigLine2:    'Presiding Judge',
    subject:     'Official Court Order',
  },
  'medical certificate': {
    officeLabel: 'OFFICE OF THE MEDICAL DIRECTOR',
    subLabel:    'OFFICIAL MEDICAL DOCUMENT',
    preamble:    'THIS IS TO CERTIFY THAT THE FOLLOWING INDIVIDUAL HAS BEEN EXAMINED AND',
    award:       'THE FOLLOWING MEDICAL FINDINGS ARE HEREBY CERTIFIED AS ACCURATE AND COMPLETE',
    sigLine1:    'Medical Director',
    sigLine2:    'Examining Physician',
    subject:     'Official Medical Certificate',
  },
  'certificate of occupancy': {
    officeLabel: "OFFICE OF THE GOVERNOR",
    subLabel:    'LAND REGISTRY — OFFICIAL DOCUMENT',
    preamble:    'THIS IS TO CERTIFY THAT STATUTORY RIGHT OF OCCUPANCY IS HEREBY GRANTED TO',
    award:       'IN RESPECT OF THE LAND AND PROPERTY DESCRIBED HEREIN, PURSUANT TO THE LAND USE ACT CAP L5 LFN 2004',
    sigLine1:    'Registrar of Titles',
    sigLine2:    'Permanent Secretary',
    subject:     'Certificate of Occupancy',
  },
  'approval letter': {
    officeLabel: 'OFFICE OF THE PERMANENT SECRETARY',
    subLabel:    'OFFICIAL MINISTERIAL APPROVAL',
    preamble:    'THIS IS TO NOTIFY THAT THE APPLICATION SUBMITTED BY THE FOLLOWING HAS BEEN REVIEWED AND',
    award:       'APPROVAL IS HEREBY GRANTED FOR THE PURPOSE AND ACTIVITY DESCRIBED HEREIN',
    sigLine1:    'Permanent Secretary',
    sigLine2:    'Authorised Officer',
    subject:     'Official Approval Letter',
  },
  'clearance certificate': {
    officeLabel: 'OFFICE OF THE DIRECTOR GENERAL',
    subLabel:    'OFFICIAL CLEARANCE CERTIFICATE',
    preamble:    'THIS IS TO CERTIFY THAT THE FOLLOWING INDIVIDUAL OR ORGANISATION HAS SATISFIED ALL OUTSTANDING REQUIREMENTS AND',
    award:       'IS HEREBY CLEARED OF ALL OBLIGATIONS TO THIS INSTITUTION AS OF THE DATE STATED HEREIN',
    sigLine1:    'Director General',
    sigLine2:    'Head of Compliance',
    subject:     'Official Clearance Certificate',
  },
  'award of contract': {
    officeLabel: 'OFFICE OF THE PERMANENT SECRETARY',
    subLabel:    'OFFICIAL CONTRACT AWARD NOTICE',
    preamble:    'FOLLOWING A COMPETITIVE PROCUREMENT PROCESS CONDUCTED IN ACCORDANCE WITH THE PUBLIC PROCUREMENT ACT 2007,',
    award:       'THE CONTRACT DESCRIBED HEREIN IS HEREBY FORMALLY AWARDED TO THE FOLLOWING ORGANISATION',
    sigLine1:    'Permanent Secretary',
    sigLine2:    'Director of Procurement',
    subject:     'Official Award of Contract',
  },
};

function isGovtDoc(docTypeLower) {
  return Object.keys(GOVT_DOC_CONFIG).some(k => docTypeLower.includes(k));
}

function getGovtConfig(docTypeLower) {
  const key = Object.keys(GOVT_DOC_CONFIG).find(k => docTypeLower.includes(k));
  return key ? GOVT_DOC_CONFIG[key] : null;
}

async function generatePDF(docData, outputStream) {
  const docTypeLower = (docData.doc_type || '').toLowerCase();

  // Route transcripts
  if (docTypeLower.includes('transcript')) {
    return generateTranscript(docData, outputStream);
  }

  // Route government/MDA documents
  if (isGovtDoc(docTypeLower) ||
      (docData.metadata && docData.metadata.institution_type === 'government')) {
    return generateGovtPDF(docData, outputStream, docTypeLower);
  }

  return generateAcademicPDF(docData, outputStream, docTypeLower);
}

// ── ACADEMIC PDF (original logic unchanged) ─────────────────────────────────
async function generateAcademicPDF(docData, outputStream, docTypeLower) {
  const { buffer: qrBuffer, url: verifyUrl } = await generateQRBuffer(docData.doc_id);

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    info: {
      Title:        docData.title,
      Author:       docData.issued_by,
      Subject:      'Official Academic Document',
      Keywords:     'verified, authenticated, UniVerify',
      CreationDate: new Date(docData.issue_date),
    },
  });

  doc.pipe(outputStream);

  const W = doc.page.width;
  const H = doc.page.height;

  const NAVY  = '#1A3A5C';
  const GOLD  = '#B8860B';
  const GOLD2 = '#D4A017';
  const LGRAY = '#F5F6F8';
  const MGRAY = '#888888';
  const DGRAY = '#333333';
  const WHITE = '#FFFFFF';

  doc.rect(0, 0, W, H).fill(LGRAY);
  doc.rect(18, 18, W - 36, H - 36).fill(WHITE);
  doc.rect(18, 18, W - 36, H - 36).lineWidth(2.5).strokeColor(NAVY).stroke();
  doc.rect(26, 26, W - 52, H - 52).lineWidth(0.8).strokeColor(GOLD).stroke();

  function corner(x, y, rx, ry) {
    doc.save();
    doc.translate(x, y).rotate(0);
    doc.moveTo(rx * 0, ry * 8).lineTo(rx * 5, ry * 0).lineTo(rx * 10, ry * 8).lineTo(rx * 5, ry * 16)
       .closePath().fillColor(GOLD).fill();
    doc.restore();
  }
  [[28, 28, 1, 1], [W - 48, 28, 1, 1], [28, H - 50, 1, 1], [W - 48, H - 50, 1, 1]]
    .forEach(([x, y, rx, ry]) => corner(x, y, rx, ry));

  doc.rect(30, 30, W - 60, 90).fill(NAVY);
  doc.rect(30, 30, W - 60, 3).fill(GOLD);
  doc.rect(30, 117, W - 60, 3).fill(GOLD);

  doc.font('Helvetica-Bold').fontSize(11).fillColor(GOLD)
     .text(docData.issued_by.toUpperCase(), 30, 48, { width: W - 60, align: 'center', characterSpacing: 3 });

  doc.font('Helvetica').fontSize(8.5).fillColor('#8AADCC')
     .text('OFFICE OF THE REGISTRAR  ·  OFFICIAL ACADEMIC RECORD', 30, 72, {
       width: W - 60, align: 'center', characterSpacing: 1.5
     });

  doc.roundedRect(W - 130, 36, 96, 22, 4).fill('#0D2D4A');
  doc.circle(W - 120, 47, 5).fill(GOLD2);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GOLD2)
     .text('UNIVERIFY SECURED', W - 112, 41, { width: 76, align: 'center', characterSpacing: 0.8 });

  doc.moveTo(W / 2 - 6, 128).lineTo(W / 2, 122).lineTo(W / 2 + 6, 128)
     .lineTo(W / 2, 134).closePath().fill(GOLD);
  doc.moveTo(50, 128).lineTo(W / 2 - 14, 128).strokeColor(GOLD).lineWidth(0.7).stroke();
  doc.moveTo(W / 2 + 14, 128).lineTo(W - 50, 128).strokeColor(GOLD).lineWidth(0.7).stroke();

  let preamble  = 'THIS IS TO CERTIFY THAT';
  let awardLine = 'HAS BEEN DULY AWARDED THE DEGREE OF';

  if (docTypeLower.includes('attestation')) {
    preamble  = 'THIS IS TO ATTEST THAT';
    awardLine = 'HAS SATISFACTORILY COMPLETED ALL REQUIREMENTS FOR';
  } else if (docTypeLower.includes('letter')) {
    preamble  = 'THIS LETTER CERTIFIES THAT';
    awardLine = 'IS KNOWN TO THIS INSTITUTION IN THE FOLLOWING CAPACITY';
  } else if (docTypeLower.includes('diploma')) {
    preamble  = 'THIS IS TO CERTIFY THAT';
    awardLine = 'HAS BEEN DULY AWARDED THE DIPLOMA OF';
  } else if (docTypeLower.includes('result') || docTypeLower.includes('statement')) {
    preamble  = 'THIS IS TO CERTIFY THAT THE RESULTS BELOW';
    awardLine = 'ARE THE OFFICIAL ACADEMIC RESULTS OF';
  } else if (docTypeLower.includes('admission')) {
    preamble  = 'THIS IS TO CONFIRM THAT';
    awardLine = 'HAS BEEN DULY ADMITTED INTO THIS INSTITUTION FOR';
  } else if (docTypeLower.includes('completion') || docTypeLower.includes('course')) {
    preamble  = 'THIS IS TO CERTIFY THAT';
    awardLine = 'HAS SUCCESSFULLY COMPLETED THE PROGRAMME OF';
  } else if (docTypeLower.includes('nysc') || docTypeLower.includes('clearance')) {
    preamble  = 'THIS IS TO CERTIFY THAT';
    awardLine = 'HAS BEEN DULY CLEARED AND ISSUED THE FOLLOWING';
  }

  doc.font('Helvetica').fontSize(10).fillColor(MGRAY)
     .text(preamble, 0, 148, { width: W, align: 'center', characterSpacing: 2 });

  const isResultStyle = docTypeLower.includes('result') || docTypeLower.includes('statement');

  if (isResultStyle) {
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(10).fillColor(MGRAY)
       .text(awardLine, 0, doc.y, { width: W, align: 'center', characterSpacing: 1.5 });
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(28).fillColor(NAVY)
       .text(docData.issued_to, 60, doc.y, { width: W - 120, align: 'center' });
    const nameBottom = doc.y + 4;
    doc.moveTo(W / 2 - 100, nameBottom).lineTo(W / 2 + 100, nameBottom)
       .strokeColor(GOLD).lineWidth(1).stroke();
  } else {
    doc.font('Helvetica-Bold').fontSize(28).fillColor(NAVY)
       .text(docData.issued_to, 60, 170, { width: W - 120, align: 'center' });
    const nameBottom = doc.y + 4;
    doc.moveTo(W / 2 - 100, nameBottom).lineTo(W / 2 + 100, nameBottom)
       .strokeColor(GOLD).lineWidth(1).stroke();
    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(10).fillColor(MGRAY)
       .text(awardLine, 0, doc.y, { width: W, align: 'center', characterSpacing: 1.5 });
  }

  doc.moveDown(0.5);
  const titleFontSize = docData.title.length > 40 ? 18 : 22;
  doc.font('Helvetica-Bold').fontSize(titleFontSize).fillColor(NAVY)
     .text(docData.title, 60, doc.y, { width: W - 120, align: 'center' });

  doc.moveDown(0.4);
  const degY = doc.y;
  doc.moveTo(W / 2 - 80, degY).lineTo(W / 2 + 80, degY).strokeColor(GOLD2).lineWidth(1.5).stroke();

  if (docData.doc_type) {
    doc.moveDown(0.6);
    const badgeW = 200;
    const badgeX = (W - badgeW) / 2;
    doc.roundedRect(badgeX, doc.y, badgeW, 22, 11).fill(LGRAY);
    doc.roundedRect(badgeX, doc.y, badgeW, 22, 11).lineWidth(0.8).strokeColor(GOLD).stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY)
       .text(docData.doc_type.toUpperCase(), badgeX, doc.y + 6, {
         width: badgeW, align: 'center', characterSpacing: 2
       });
    doc.moveDown(0.2);
  }

  doc.moveDown(0.9);
  const sepY = doc.y;
  doc.moveTo(60, sepY).lineTo(W - 60, sepY).strokeColor('#E0E4EA').lineWidth(0.5).stroke();

  const detailY = sepY + 16;
  const col1X   = 70;
  const col2X   = W / 2 + 20;
  const qrSize  = 88;
  const qrX     = W - 72 - qrSize;
  const qrY     = detailY;

  const issueDate  = new Date(docData.issue_date).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric'
  });
  const expiryDate = docData.expiry_date
    ? new Date(docData.expiry_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    : null;

  function detailField(label, value, x, y) {
    doc.font('Helvetica').fontSize(7.5).fillColor(MGRAY).text(label.toUpperCase(), x, y, { characterSpacing: 1 });
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(DGRAY).text(value, x, y + 12, { width: 180 });
  }

  detailField('Document ID',         docData.doc_id,   col1X, detailY);
  detailField('Date of Issue',       issueDate,         col1X, detailY + 56);
  if (expiryDate) detailField('Valid Until', expiryDate, col1X, detailY + 112);
  detailField('Issuing Institution', docData.issued_by, col2X, detailY);

  const extraFields = Object.entries(docData.metadata || {})
    .filter(([k, v]) => typeof v === 'string' && k !== 'matric_number' && k !== 'institution_type')
    .slice(0, 2);

  if (extraFields.length > 0) {
    extraFields.forEach(([k, v], i) => {
      detailField(k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), v, col2X, detailY + 56 + i * 56);
    });
  } else if (docData.doc_type) {
    detailField('Document Type', docData.doc_type, col2X, detailY + 56);
  }

  doc.roundedRect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 32, 6)
     .lineWidth(0.8).strokeColor(GOLD).fill(WHITE).stroke();
  doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(NAVY)
     .text('SCAN TO VERIFY', qrX - 8, qrY + qrSize + 6, { width: qrSize + 16, align: 'center', characterSpacing: 1 });

  const sigY = detailY + 175;
  doc.moveTo(60, sigY).lineTo(W - 60, sigY).strokeColor('#E0E4EA').lineWidth(0.5).stroke();

  const sig1X = 80;
  const sig2X = W / 2 - 60;
  const sig3X = W - 200;

  const fs   = require('fs');
  const path = require('path');
  const sigDir       = path.join(__dirname, '..', '..', 'signatures');
  const registrarSig = path.join(sigDir, 'registrar.png');
  const vcSig        = path.join(sigDir, 'vc.png');

  if (fs.existsSync(registrarSig)) doc.image(registrarSig, sig1X, sigY + 4, { width: 110, height: 36 });
  if (fs.existsSync(vcSig))        doc.image(vcSig, sig2X, sigY + 4, { width: 110, height: 36 });

  function sigLine(x, label) {
    doc.moveTo(x, sigY + 44).lineTo(x + 120, sigY + 44).strokeColor(NAVY).lineWidth(0.6).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(MGRAY)
       .text(label.toUpperCase(), x, sigY + 50, { width: 120, align: 'center', characterSpacing: 0.8 });
  }

  sigLine(sig1X, 'Registrar');
  sigLine(sig2X, 'Vice Chancellor');
  sigLine(sig3X, 'Date');
  doc.font('Helvetica').fontSize(9).fillColor(DGRAY).text(issueDate, sig3X, sigY + 30, { width: 120, align: 'center' });

  const authY = sigY + 80;
  doc.rect(30, authY, W - 60, 44).fill(LGRAY);
  doc.rect(30, authY, W - 60, 44).lineWidth(0.5).strokeColor('#D0D5DD').stroke();
  doc.circle(48, authY + 22, 8).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(WHITE).text('✓', 40, authY + 16, { width: 16, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY)
     .text('DIGITALLY AUTHENTICATED DOCUMENT', 62, authY + 8, { characterSpacing: 1 });
  doc.font('Helvetica').fontSize(7.5).fillColor(MGRAY)
     .text(`This document is digitally registered and authenticated. Verify at: ${verifyUrl}  ·  Document ID: ${docData.doc_id}`,
       62, authY + 22, { width: W - 110, lineGap: 1 });

  doc.rect(30, H - 46, W - 60, 16).fill(NAVY);
  doc.font('Helvetica').fontSize(7).fillColor('#6699BB')
     .text(`Powered by UniVerify  ·  verify.akeenalee.com  ·  Innovation Lens Resources Ltd  ·  ${new Date().getFullYear()}`,
       30, H - 42, { width: W - 60, align: 'center', characterSpacing: 0.5 });

  doc.rect(30, H - 30, W - 60, 3).fill(GOLD);
  doc.end();
}

// ── GOVERNMENT / MDA PDF ─────────────────────────────────────────────────────
async function generateGovtPDF(docData, outputStream, docTypeLower) {
  const { buffer: qrBuffer, url: verifyUrl } = await generateQRBuffer(docData.doc_id);

  const cfg = getGovtConfig(docTypeLower) || {
    officeLabel: 'OFFICE OF THE DIRECTOR GENERAL',
    subLabel:    'OFFICIAL DOCUMENT',
    preamble:    'THIS IS TO CERTIFY THAT',
    award:       'THE FOLLOWING HAS BEEN DULY ISSUED',
    sigLine1:    'Director General',
    sigLine2:    'Authorised Officer',
    subject:     'Official Document',
  };

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    info: {
      Title:        docData.title,
      Author:       docData.issued_by,
      Subject:      cfg.subject,
      Keywords:     'verified, authenticated, UniVerify, official',
      CreationDate: new Date(docData.issue_date),
    },
  });

  doc.pipe(outputStream);

  const W = doc.page.width;
  const H = doc.page.height;

  const NAVY  = '#0D1B2A';
  const TEAL  = '#006D77';
  const GOLD  = '#C9A84C';
  const LGRAY = '#F4F6F9';
  const MGRAY = '#666666';
  const DGRAY = '#2C3E50';
  const WHITE = '#FFFFFF';
  const GREEN = '#0A6B45';

  // Background
  doc.rect(0, 0, W, H).fill(LGRAY);
  doc.rect(18, 18, W - 36, H - 36).fill(WHITE);
  doc.rect(18, 18, W - 36, H - 36).lineWidth(2.5).strokeColor(NAVY).stroke();
  doc.rect(26, 26, W - 52, H - 52).lineWidth(0.8).strokeColor(TEAL).stroke();

  // Corner marks — square government style
  [[28, 28], [W - 38, 28], [28, H - 38], [W - 38, H - 38]].forEach(([x, y]) => {
    doc.rect(x, y, 10, 2).fill(GOLD);
    doc.rect(x, y, 2, 10).fill(GOLD);
  });

  // HEADER BAND
  doc.rect(30, 30, W - 60, 95).fill(NAVY);
  doc.rect(30, 30, W - 60, 3).fill(GOLD);
  doc.rect(30, 122, W - 60, 3).fill(GOLD);

  // Nigerian coat of arms placeholder — green circle with eagle icon
  doc.circle(W / 2, 65, 22).fill(WHITE);
  doc.circle(W / 2, 65, 20).fill('#1A6B3A');
  doc.font('Helvetica-Bold').fontSize(18).fillColor(WHITE)
     .text('🦅', W / 2 - 10, 57, { width: 20, align: 'center' });

  // Institution name
  doc.font('Helvetica-Bold').fontSize(10).fillColor(GOLD)
     .text(docData.issued_by.toUpperCase(), 30, 92, {
       width: W - 60, align: 'center', characterSpacing: 2
     });

  // Office label
  doc.font('Helvetica').fontSize(8).fillColor('#8AADCC')
     .text(cfg.officeLabel + '  ·  ' + cfg.subLabel, 30, 108, {
       width: W - 60, align: 'center', characterSpacing: 1
     });

  // UniVerify badge
  doc.roundedRect(W - 132, 36, 98, 22, 4).fill('#0A1929');
  doc.circle(W - 122, 47, 5).fill(GOLD);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GOLD)
     .text('UNIVERIFY SECURED', W - 114, 41, { width: 78, align: 'center', characterSpacing: 0.8 });

  // Decorative rule
  doc.moveTo(50, 132).lineTo(W / 2 - 20, 132).strokeColor(TEAL).lineWidth(0.7).stroke();
  doc.circle(W / 2, 132, 4).fill(GOLD);
  doc.moveTo(W / 2 + 20, 132).lineTo(W - 50, 132).strokeColor(TEAL).lineWidth(0.7).stroke();

  // PREAMBLE
  doc.font('Helvetica').fontSize(9.5).fillColor(MGRAY)
     .text(cfg.preamble, 0, 148, { width: W, align: 'center', characterSpacing: 1.5 });

  // ISSUED TO NAME
  doc.font('Helvetica-Bold').fontSize(26).fillColor(NAVY)
     .text(docData.issued_to, 60, 172, { width: W - 120, align: 'center' });
  const nameBottom = doc.y + 4;
  doc.moveTo(W / 2 - 110, nameBottom).lineTo(W / 2 + 110, nameBottom)
     .strokeColor(GOLD).lineWidth(1.2).stroke();

  // AWARD LINE
  doc.moveDown(0.7);
  doc.font('Helvetica').fontSize(9.5).fillColor(MGRAY)
     .text(cfg.award, 0, doc.y, { width: W, align: 'center', characterSpacing: 1.2 });

  // DOCUMENT TITLE
  doc.moveDown(0.5);
  const titleFS = docData.title.length > 45 ? 16 : 20;
  doc.font('Helvetica-Bold').fontSize(titleFS).fillColor(NAVY)
     .text(docData.title, 60, doc.y, { width: W - 120, align: 'center' });

  doc.moveDown(0.4);
  const lineY = doc.y;
  doc.moveTo(W / 2 - 90, lineY).lineTo(W / 2 + 90, lineY).strokeColor(TEAL).lineWidth(1.5).stroke();

  // DOC TYPE BADGE
  if (docData.doc_type) {
    doc.moveDown(0.6);
    const badgeW = 220;
    const badgeX = (W - badgeW) / 2;
    doc.roundedRect(badgeX, doc.y, badgeW, 22, 4).fill('#EBF4F3');
    doc.roundedRect(badgeX, doc.y, badgeW, 22, 4).lineWidth(0.8).strokeColor(TEAL).stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(TEAL)
       .text(docData.doc_type.toUpperCase(), badgeX, doc.y + 6, {
         width: badgeW, align: 'center', characterSpacing: 2
       });
    doc.moveDown(0.2);
  }

  // SEPARATOR
  doc.moveDown(0.8);
  const sepY = doc.y;
  doc.moveTo(60, sepY).lineTo(W - 60, sepY).strokeColor('#E0E4EA').lineWidth(0.5).stroke();

  // DETAILS GRID
  const detailY = sepY + 16;
  const col1X   = 70;
  const col2X   = W / 2 + 10;
  const qrSize  = 90;
  const qrX     = W - 72 - qrSize;
  const qrY     = detailY;

  const issueDate  = new Date(docData.issue_date).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric'
  });
  const expiryDate = docData.expiry_date
    ? new Date(docData.expiry_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    : null;

  function detailField(label, value, x, y, maxW = 180) {
    doc.font('Helvetica').fontSize(7.5).fillColor(MGRAY).text(label.toUpperCase(), x, y, { characterSpacing: 1 });
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(DGRAY).text(value, x, y + 12, { width: maxW });
  }

  detailField('Document ID',     docData.doc_id,   col1X, detailY);
  detailField('Date of Issue',   issueDate,         col1X, detailY + 56);
  if (expiryDate) detailField('Valid Until', expiryDate, col1X, detailY + 112);
  detailField('Issuing Authority', docData.issued_by, col2X, detailY, 160);

  // Reference number from metadata
  const refNum = docData.metadata?.matric_number || docData.metadata?.reference_number;
  if (refNum) detailField('Reference Number', refNum, col2X, detailY + 56, 160);
  else if (docData.doc_type) detailField('Document Type', docData.doc_type, col2X, detailY + 56, 160);

  // QR CODE
  doc.roundedRect(qrX - 8, qrY - 8, qrSize + 16, qrSize + 34, 6)
     .lineWidth(0.8).strokeColor(TEAL).fill(WHITE).stroke();
  doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(NAVY)
     .text('SCAN TO VERIFY', qrX - 8, qrY + qrSize + 6, {
       width: qrSize + 16, align: 'center', characterSpacing: 1
     });

  // SIGNATURE AREA
  const sigY = detailY + 178;
  doc.moveTo(60, sigY).lineTo(W - 60, sigY).strokeColor('#E0E4EA').lineWidth(0.5).stroke();

  const sig1X = 80;
  const sig2X = W / 2 - 60;
  const sig3X = W - 200;

  const fs   = require('fs');
  const path = require('path');
  const sigDir    = path.join(__dirname, '..', '..', 'signatures');
  const sig1File  = path.join(sigDir, 'registrar.png');
  const sig2File  = path.join(sigDir, 'vc.png');

  if (fs.existsSync(sig1File)) doc.image(sig1File, sig1X, sigY + 4, { width: 110, height: 36 });
  if (fs.existsSync(sig2File)) doc.image(sig2File, sig2X, sigY + 4, { width: 110, height: 36 });

  function sigLine(x, label) {
    doc.moveTo(x, sigY + 44).lineTo(x + 130, sigY + 44).strokeColor(NAVY).lineWidth(0.6).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(MGRAY)
       .text(label.toUpperCase(), x, sigY + 50, { width: 130, align: 'center', characterSpacing: 0.8 });
  }

  sigLine(sig1X, cfg.sigLine1);
  sigLine(sig2X, cfg.sigLine2);
  sigLine(sig3X, 'Date of Issue');
  doc.font('Helvetica').fontSize(9).fillColor(DGRAY)
     .text(issueDate, sig3X, sigY + 30, { width: 130, align: 'center' });

  // OFFICIAL SEAL AREA
  const sealX = W / 2 - 28;
  const sealY = sigY + 8;
  doc.circle(sealX + 28, sealY + 28, 28).lineWidth(1.5).strokeColor(TEAL).stroke();
  doc.circle(sealX + 28, sealY + 28, 22).lineWidth(0.5).strokeColor(TEAL).stroke();
  doc.font('Helvetica-Bold').fontSize(6).fillColor(TEAL)
     .text('OFFICIAL', sealX, sealY + 22, { width: 56, align: 'center', characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(6).fillColor(TEAL)
     .text('SEAL', sealX, sealY + 32, { width: 56, align: 'center', characterSpacing: 2 });

  // AUTHENTICITY FOOTER
  const authY = sigY + 82;
  doc.rect(30, authY, W - 60, 44).fill(LGRAY);
  doc.rect(30, authY, W - 60, 44).lineWidth(0.5).strokeColor('#D0D5DD').stroke();
  doc.rect(30, authY, 3, 44).fill(TEAL);
  doc.circle(50, authY + 22, 8).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(WHITE).text('✓', 42, authY + 16, { width: 16, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY)
     .text('DIGITALLY AUTHENTICATED OFFICIAL DOCUMENT', 64, authY + 8, { characterSpacing: 1 });
  doc.font('Helvetica').fontSize(7.5).fillColor(MGRAY)
     .text(`This document is digitally registered and authenticated by UniVerify. Verify at: ${verifyUrl}  ·  ID: ${docData.doc_id}`,
       64, authY + 22, { width: W - 110, lineGap: 1 });

  // FOOTER BAND
  doc.rect(30, H - 46, W - 60, 16).fill(NAVY);
  doc.font('Helvetica').fontSize(7).fillColor('#6699BB')
     .text(`Powered by UniVerify  ·  verify.akeenalee.com  ·  Innovation Lens Resources Ltd  ·  ${new Date().getFullYear()}`,
       30, H - 42, { width: W - 60, align: 'center', characterSpacing: 0.5 });
  doc.rect(30, H - 30, W - 60, 3).fill(GOLD);

  doc.end();
}

module.exports = { generatePDF };