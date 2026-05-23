const PDFDocument = require('pdfkit');
const { generateQRBuffer } = require('./docUtils');

async function generateTranscript(docData, outputStream) {
  const { buffer: qrBuffer, url: verifyUrl } = await generateQRBuffer(docData.doc_id);

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    bufferPages: true,
    info: {
      Title: 'Official Academic Transcript',
      Author: docData.issued_by,
      Subject: 'Academic Transcript',
      Keywords: 'transcript, verified, authenticated, UniVerify',
      CreationDate: new Date(docData.issue_date),
    },
  });

  doc.pipe(outputStream);

  const W     = doc.page.width;
  const H     = doc.page.height;
  const ML    = 50;   // margin left
  const MR    = 50;   // margin right
  const CW    = W - ML - MR;  // content width

  const NAVY  = '#1A3A5C';
  const GOLD  = '#B8860B';
  const LGRAY = '#F5F6F8';
  const MGRAY = '#777777';
  const DGRAY = '#222222';
  const WHITE = '#FFFFFF';
  const GREEN = '#0A6B45';
  const RED   = '#8B0000';

  const issueDate = new Date(docData.issue_date).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric'
  });

  // Pull metadata for student details
  const meta      = docData.metadata || {};
  const matric    = meta.matric_number || meta.matric || 'N/A';
  const programme = meta.programme || meta.course || docData.title || 'Not Specified';
  const faculty   = meta.faculty || meta.department || 'Not Specified';
  const entryYear = meta.entry_year || meta.year || '—';
  const gradYear  = meta.graduation_year || meta.grad_year || '—';
  const degree    = meta.degree || 'Bachelor of Science';
  const classAward = meta.class || meta.degree_class || 'Second Class Upper Division';

  // ── SAMPLE TRANSCRIPT DATA ─────────────────────────────────────────────────
  // In production this would come from the SIS database
  // For demo purposes we generate realistic sample data
  const semesters = [
    {
      label: '100 Level - First Semester',
      year: entryYear !== '—' ? `${entryYear}/${parseInt(entryYear)+1}` : '2018/2019',
      courses: [
        { code: 'GST 111', title: 'Communication in English', units: 2, score: 68, grade: 'B' },
        { code: 'GST 112', title: 'Nigerian Peoples and Culture', units: 2, score: 72, grade: 'B' },
        { code: 'MTH 101', title: 'Elementary Mathematics I', units: 3, score: 75, grade: 'B' },
        { code: 'PHY 101', title: 'General Physics I', units: 3, score: 63, grade: 'C' },
        { code: 'CHM 101', title: 'General Chemistry I', units: 3, score: 70, grade: 'B' },
        { code: 'CSC 101', title: 'Introduction to Computing', units: 3, score: 82, grade: 'A' },
      ]
    },
    {
      label: '100 Level - Second Semester',
      year: entryYear !== '—' ? `${entryYear}/${parseInt(entryYear)+1}` : '2018/2019',
      courses: [
        { code: 'GST 121', title: 'Use of Library, Study Skills & ICT', units: 2, score: 74, grade: 'B' },
        { code: 'MTH 102', title: 'Elementary Mathematics II', units: 3, score: 71, grade: 'B' },
        { code: 'PHY 102', title: 'General Physics II', units: 3, score: 65, grade: 'C' },
        { code: 'CHM 102', title: 'General Chemistry II', units: 3, score: 68, grade: 'B' },
        { code: 'CSC 102', title: 'Problem Solving', units: 3, score: 78, grade: 'B' },
        { code: 'STA 101', title: 'Introduction to Statistics', units: 3, score: 80, grade: 'A' },
      ]
    },
    {
      label: '200 Level - First Semester',
      year: entryYear !== '—' ? `${parseInt(entryYear)+1}/${parseInt(entryYear)+2}` : '2019/2020',
      courses: [
        { code: 'CSC 201', title: 'Computer Programming I', units: 3, score: 85, grade: 'A' },
        { code: 'CSC 203', title: 'Data Structures', units: 3, score: 79, grade: 'B' },
        { code: 'MTH 201', title: 'Mathematical Methods', units: 3, score: 72, grade: 'B' },
        { code: 'CSC 205', title: 'Digital Logic Design', units: 3, score: 74, grade: 'B' },
        { code: 'GST 211', title: 'Entrepreneurship', units: 2, score: 76, grade: 'B' },
      ]
    },
    {
      label: '200 Level - Second Semester',
      year: entryYear !== '—' ? `${parseInt(entryYear)+1}/${parseInt(entryYear)+2}` : '2019/2020',
      courses: [
        { code: 'CSC 202', title: 'Computer Programming II', units: 3, score: 88, grade: 'A' },
        { code: 'CSC 204', title: 'Computer Organisation', units: 3, score: 75, grade: 'B' },
        { code: 'CSC 206', title: 'Discrete Mathematics', units: 3, score: 70, grade: 'B' },
        { code: 'MTH 202', title: 'Linear Algebra', units: 3, score: 68, grade: 'B' },
        { code: 'CSC 208', title: 'Systems Analysis & Design', units: 3, score: 82, grade: 'A' },
      ]
    },
    {
      label: '300 Level - First Semester',
      year: entryYear !== '—' ? `${parseInt(entryYear)+2}/${parseInt(entryYear)+3}` : '2020/2021',
      courses: [
        { code: 'CSC 301', title: 'Operating Systems', units: 3, score: 80, grade: 'A' },
        { code: 'CSC 303', title: 'Database Management Systems', units: 3, score: 83, grade: 'A' },
        { code: 'CSC 305', title: 'Computer Networks', units: 3, score: 76, grade: 'B' },
        { code: 'CSC 307', title: 'Software Engineering', units: 3, score: 78, grade: 'B' },
        { code: 'CSC 309', title: 'Artificial Intelligence', units: 3, score: 75, grade: 'B' },
      ]
    },
    {
      label: '300 Level - Second Semester',
      year: entryYear !== '—' ? `${parseInt(entryYear)+2}/${parseInt(entryYear)+3}` : '2020/2021',
      courses: [
        { code: 'CSC 302', title: 'Algorithm Analysis & Design', units: 3, score: 82, grade: 'A' },
        { code: 'CSC 304', title: 'Web Technologies', units: 3, score: 87, grade: 'A' },
        { code: 'CSC 306', title: 'Computer Graphics', units: 3, score: 72, grade: 'B' },
        { code: 'CSC 308', title: 'Information Security', units: 3, score: 79, grade: 'B' },
        { code: 'SIWES', title: 'Students Industrial Work Experience Scheme', units: 6, score: 85, grade: 'A' },
      ]
    },
    {
      label: '400 Level - First Semester',
      year: entryYear !== '—' ? `${parseInt(entryYear)+3}/${parseInt(entryYear)+4}` : '2021/2022',
      courses: [
        { code: 'CSC 401', title: 'Compiler Construction', units: 3, score: 76, grade: 'B' },
        { code: 'CSC 403', title: 'Machine Learning', units: 3, score: 84, grade: 'A' },
        { code: 'CSC 405', title: 'Mobile Application Development', units: 3, score: 88, grade: 'A' },
        { code: 'CSC 407', title: 'Cloud Computing', units: 3, score: 81, grade: 'A' },
        { code: 'CSC 409', title: 'Research Methodology', units: 3, score: 77, grade: 'B' },
      ]
    },
    {
      label: '400 Level - Second Semester',
      year: entryYear !== '—' ? `${parseInt(entryYear)+3}/${parseInt(entryYear)+4}` : '2021/2022',
      courses: [
        { code: 'CSC 402', title: 'Project (Final Year)', units: 6, score: 85, grade: 'A' },
        { code: 'CSC 404', title: 'Distributed Systems', units: 3, score: 78, grade: 'B' },
        { code: 'CSC 406', title: 'Blockchain Technology', units: 3, score: 80, grade: 'A' },
        { code: 'CSC 408', title: 'IT Ethics & Professionalism', units: 2, score: 82, grade: 'A' },
      ]
    },
  ];

  // Calculate CGPA
  let totalPoints = 0, totalUnits = 0;
  semesters.forEach(sem => {
    sem.courses.forEach(c => {
      const gp = c.grade === 'A' ? 5 : c.grade === 'B' ? 4 : c.grade === 'C' ? 3 : c.grade === 'D' ? 2 : 1;
      totalPoints += gp * c.units;
      totalUnits  += c.units;
    });
  });
  const cgpa = (totalPoints / totalUnits).toFixed(2);

  // ── HEADER (drawn on every page) ──────────────────────────────────────────
  function drawHeader(pageNum, totalPages) {
    // Top navy band
    doc.rect(0, 0, W, 100).fill(NAVY);
    doc.rect(0, 0, W, 3).fill(GOLD);
    doc.rect(0, 97, W, 3).fill(GOLD);

    // Institution name
    doc.font('Helvetica-Bold').fontSize(13).fillColor(GOLD)
       .text(docData.issued_by.toUpperCase(), ML, 18, {
         width: CW - 120, characterSpacing: 2
       });

    doc.font('Helvetica').fontSize(8).fillColor('#8AADCC')
       .text('OFFICE OF THE REGISTRAR  ·  OFFICIAL ACADEMIC RECORD', ML, 38, {
         width: CW - 120, characterSpacing: 1
       });

    // Transcript title
    doc.font('Helvetica-Bold').fontSize(16).fillColor(WHITE)
       .text('OFFICIAL ACADEMIC TRANSCRIPT', ML, 60, {
         width: CW - 120
       });

    // QR code on every page - top right of header
    const hqrSize = 72;
    const hqrX   = W - ML - hqrSize;
    const hqrY   = 10;

    // White background for QR
    doc.rect(hqrX - 4, hqrY - 4, hqrSize + 8, hqrSize + 14).fill(WHITE);
    doc.image(qrBuffer, hqrX, hqrY, { width: hqrSize, height: hqrSize });
    doc.font('Helvetica-Bold').fontSize(5.5).fillColor(NAVY)
       .text('SCAN TO VERIFY', hqrX - 4, hqrY + hqrSize + 2, {
         width: hqrSize + 8, align: 'center', characterSpacing: 0.8
       });

    // UniVerify badge just below QR
    doc.roundedRect(hqrX - 4, hqrY + hqrSize + 10, hqrSize + 8, 14, 3).fill('#0D2D4A');
    doc.font('Helvetica-Bold').fontSize(6).fillColor(GOLD)
       .text('UNIVERIFY SECURED', hqrX - 4, hqrY + hqrSize + 14, {
         width: hqrSize + 8, align: 'center', characterSpacing: 0.5
       });

    // Page number
    doc.font('Helvetica').fontSize(8).fillColor('#8AADCC')
       .text(`Page ${pageNum} of ${totalPages}`, ML, 82, {
         width: CW - 120
       });
  }

  // ── STUDENT INFO BLOCK ────────────────────────────────────────────────────
  function drawStudentInfo() {
    const y = 110;
    doc.rect(ML, y, CW, 80).fill(LGRAY);
    doc.rect(ML, y, CW, 80).lineWidth(0.5).strokeColor('#D0D5DD').stroke();

    function infoField(label, value, x, fy) {
      doc.font('Helvetica').fontSize(7).fillColor(MGRAY)
         .text(label.toUpperCase(), x, fy, { characterSpacing: 0.8 });
      doc.font('Helvetica-Bold').fontSize(10).fillColor(DGRAY)
         .text(value, x, fy + 11);
    }

    const col1 = ML + 14;
    const col2 = ML + CW / 2;

    infoField('Student Name',    docData.issued_to, col1, y + 10);
    infoField('Matriculation No', matric,           col2, y + 10);
    infoField('Programme',       programme,          col1, y + 44);
    infoField('Faculty / Dept',  faculty,            col2, y + 44);

    // Right side: years
    const col3 = ML + CW * 0.72;
    infoField('Entry Year',      entryYear,          col3, y + 10);
    infoField('Graduation Year', gradYear,           col3, y + 44);
  }

  // ── SEMESTER TABLE ────────────────────────────────────────────────────────
  function drawSemesterTable(sem, startY) {
    let y = startY;

    // Semester header
    doc.rect(ML, y, CW, 20).fill(NAVY);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(GOLD)
       .text(sem.label.toUpperCase(), ML + 10, y + 6, {
         width: CW * 0.6, characterSpacing: 1
       });
    doc.font('Helvetica').fontSize(8).fillColor('#8AADCC')
       .text('Academic Year: ' + sem.year, ML + CW * 0.62, y + 7, {
         width: CW * 0.35, align: 'right'
       });
    y += 20;

    // Column headers
    doc.rect(ML, y, CW, 16).fill('#E8ECF2');
    const cols = [
      { label: 'Course Code', x: ML + 8,          w: 80  },
      { label: 'Course Title', x: ML + 90,         w: 220 },
      { label: 'Units',        x: ML + 314,         w: 40  },
      { label: 'Score',        x: ML + 356,         w: 50  },
      { label: 'Grade',        x: ML + 408,         w: 40  },
      { label: 'Points',       x: ML + CW - 50,     w: 45  },
    ];
    cols.forEach(col => {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(NAVY)
         .text(col.label.toUpperCase(), col.x, y + 5, {
           width: col.w, align: col.label === 'Units' || col.label === 'Score' || col.label === 'Grade' || col.label === 'Points' ? 'center' : 'left',
           characterSpacing: 0.5
         });
    });
    y += 16;

    // Course rows
    let semUnits = 0, semPoints = 0;
    sem.courses.forEach((c, i) => {
      const bg = i % 2 === 0 ? WHITE : '#F8F9FB';
      doc.rect(ML, y, CW, 15).fill(bg);

      const gp    = c.grade === 'A' ? 5 : c.grade === 'B' ? 4 : c.grade === 'C' ? 3 : c.grade === 'D' ? 2 : 1;
      const pts   = gp * c.units;
      semUnits   += c.units;
      semPoints  += pts;

      const gradeColor = c.grade === 'A' ? GREEN : c.grade === 'F' ? RED : DGRAY;

      doc.font('Helvetica').fontSize(8.5).fillColor('#333')
         .text(c.code, ML + 8, y + 4, { width: 80 });
      doc.font('Helvetica').fontSize(8.5).fillColor('#333')
         .text(c.title, ML + 90, y + 4, { width: 218 });
      doc.font('Helvetica').fontSize(8.5).fillColor(DGRAY)
         .text(String(c.units), ML + 314, y + 4, { width: 40, align: 'center' });
      doc.font('Helvetica').fontSize(8.5).fillColor(DGRAY)
         .text(String(c.score), ML + 356, y + 4, { width: 50, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(gradeColor)
         .text(c.grade, ML + 408, y + 4, { width: 40, align: 'center' });
      doc.font('Helvetica').fontSize(8.5).fillColor(DGRAY)
         .text(String(pts), ML + CW - 50, y + 4, { width: 45, align: 'center' });

      // Bottom border
      doc.moveTo(ML, y + 15).lineTo(ML + CW, y + 15)
         .strokeColor('#E8ECF2').lineWidth(0.3).stroke();
      y += 15;
    });

    // Semester summary row
    const semGPA = (semPoints / semUnits).toFixed(2);
    doc.rect(ML, y, CW, 18).fill('#E8ECF2');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY)
       .text('SEMESTER SUMMARY', ML + 8, y + 5, { width: 200 });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY)
       .text('Total Units: ' + semUnits, ML + 240, y + 5, { width: 100 });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY)
       .text('Total Points: ' + semPoints, ML + 340, y + 5, { width: 100 });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GREEN)
       .text('GPA: ' + semGPA, ML + CW - 70, y + 5, { width: 65, align: 'right' });
    y += 18;

    return y + 10; // return next Y position with gap
  }

  // ── PAGE FOOTER ───────────────────────────────────────────────────────────
  function drawFooter() {
    doc.rect(ML, H - 30, CW, 0.5).fill('#D0D5DD');
    doc.font('Helvetica').fontSize(7).fillColor(MGRAY)
       .text(
         `Powered by UniVerify  ·  verify.akeenalee.com  ·  ${docData.doc_id}`,
         ML, H - 22, { width: CW, align: 'center' }
       );
  }

  // ── BUILD PAGES ───────────────────────────────────────────────────────────
  // Estimate pages needed (rough: ~6 courses per 90px, header 200px, footer 40px)
  // We'll let PDFKit handle page breaks dynamically

  let currentY = 0;
  let pageNum  = 1;

  // Page 1: header + student info + first few semesters
  drawHeader(pageNum, '?');
  drawStudentInfo();
  currentY = 210;

  for (let i = 0; i < semesters.length; i++) {
    const sem       = semesters[i];
    const rowHeight = 20 + 16 + (sem.courses.length * 15) + 18 + 10;

    if (currentY + rowHeight > H - 60 && i > 0) {
      // Need new page
      drawFooter();
      doc.addPage();
      pageNum++;
      drawHeader(pageNum, '?');
      currentY = 110;
    }

    currentY = drawSemesterTable(sem, currentY);
  }

  // ── SUMMARY PAGE SECTION ──────────────────────────────────────────────────
  const summaryHeight = 200;
  if (currentY + summaryHeight > H - 60) {
    drawFooter();
    doc.addPage();
    pageNum++;
    drawHeader(pageNum, '?');
    currentY = 110;
  }

  // Overall summary box
  currentY += 10;
  doc.rect(ML, currentY, CW, 110).fill(LGRAY);
  doc.rect(ML, currentY, CW, 110).lineWidth(0.8).strokeColor(NAVY).stroke();

  doc.rect(ML, currentY, CW, 22).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(GOLD)
     .text('CUMULATIVE ACADEMIC SUMMARY', ML + 10, currentY + 7, {
       characterSpacing: 1
     });
  currentY += 22;

  // Summary fields
  function summaryField(label, value, x, y, highlight = false) {
    doc.font('Helvetica').fontSize(7.5).fillColor(MGRAY)
       .text(label.toUpperCase(), x, y, { characterSpacing: 0.8 });
    doc.font('Helvetica-Bold').fontSize(highlight ? 14 : 11)
       .fillColor(highlight ? GREEN : NAVY)
       .text(value, x, y + 12);
  }

  const sc1 = ML + 16;
  const sc2 = ML + CW * 0.28;
  const sc3 = ML + CW * 0.55;
  const sc4 = ML + CW * 0.76;

  summaryField('Programme', programme,   sc1, currentY + 8);
  summaryField('Total Units Earned', String(totalUnits), sc2, currentY + 8);
  summaryField('Cumulative GPA', cgpa,   sc3, currentY + 8, true);
  summaryField('Degree Class', classAward, sc4, currentY + 8);

  currentY += 88;

  // Graduation status
  doc.rect(ML, currentY, CW, 22).fill('#E1F5EE');
  doc.font('Helvetica-Bold').fontSize(9).fillColor(GREEN)
     .text('✓  This student has FULFILLED all academic requirements for the award of the degree stated above.', ML + 10, currentY + 7, { width: CW - 20 });
  currentY += 22;

  // ── SIGNATURE AND AUTHENTICATION ──────────────────────────────────────────
  currentY += 20;

  const fs   = require('fs');
  const path = require('path');
  const sigDir       = path.join(__dirname, '..', '..', 'signatures');
  const registrarSig = path.join(sigDir, 'registrar.png');
  const vcSig        = path.join(sigDir, 'vc.png');

  const sig1X = ML;
  const sig2X = ML + CW / 3;
  const sig3X = ML + (CW * 2 / 3);

  if (fs.existsSync(registrarSig)) {
    doc.image(registrarSig, sig1X, currentY, { width: 110, height: 36 });
  }
  if (fs.existsSync(vcSig)) {
    doc.image(vcSig, sig2X, currentY, { width: 110, height: 36 });
  }

  [
    [sig1X, 'Registrar'],
    [sig2X, 'Deputy Registrar (Academics)'],
    [sig3X, 'Date of Issue'],
  ].forEach(([x, label]) => {
    doc.moveTo(x, currentY + 44).lineTo(x + 130, currentY + 44)
       .strokeColor(NAVY).lineWidth(0.6).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(MGRAY)
       .text(label.toUpperCase(), x, currentY + 49, {
         width: 130, align: 'center', characterSpacing: 0.5
       });
  });

  doc.font('Helvetica').fontSize(9).fillColor(DGRAY)
     .text(issueDate, sig3X, currentY + 30, { width: 130, align: 'center' });

  currentY += 70;

  // QR + Authentication footer box
  doc.rect(ML, currentY, CW, 56).fill(LGRAY);
  doc.rect(ML, currentY, CW, 56).lineWidth(0.5).strokeColor('#D0D5DD').stroke();

  // QR code small
  doc.image(qrBuffer, ML + 8, currentY + 6, { width: 44, height: 44 });

  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY)
     .text('DIGITALLY AUTHENTICATED DOCUMENT', ML + 60, currentY + 8, {
       characterSpacing: 0.8
     });
  doc.font('Helvetica').fontSize(7.5).fillColor(MGRAY)
     .text(
       `This transcript is an official document issued by ${docData.issued_by} and is digitally registered in the UniVerify credential system.`,
       ML + 60, currentY + 22, { width: CW - 70 }
     );
  doc.font('Helvetica').fontSize(7.5).fillColor(MGRAY)
     .text(
       `Verify at: ${verifyUrl}  ·  Document ID: ${docData.doc_id}  ·  Scan the QR code to confirm authenticity.`,
       ML + 60, currentY + 36, { width: CW - 70 }
     );

  drawFooter();

  // ── FIX PAGE NUMBERS ─────────────────────────────────────────────────────
  const totalPages = doc.bufferedPageRange().count;
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    // Overwrite page number with correct total
    doc.rect(ML, 79, 120, 14).fill(NAVY);
    doc.font('Helvetica').fontSize(8).fillColor('#8AADCC')
       .text(`Page ${i + 1} of ${totalPages}`, ML, 82, {
         width: 120
       });
  }

  doc.flushPages();
  doc.end();
}

module.exports = { generateTranscript };