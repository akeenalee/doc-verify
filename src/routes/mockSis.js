// Test SIS: a stand-in for a school's student information system, speaking
// the UniVerify SIS API (docs/sis-api.md) with dummy students from
// src/mock/sis-students.json. Mounted at /mock-sis only when MOCK_SIS_ENABLED=1.
//
//   GET /mock-sis/health                 -> 200 { ok, students }
//   GET /mock-sis/students/<matric>      -> 200 record | 404 | 401
//
// Bearer token: MOCK_SIS_TOKEN (required in production; "test-sis-token"
// elsewhere). Matric numbers that start with TEST/ trigger failure cases so
// the error handling can be tried: TEST/SLOW (answers after 20 s), TEST/ERROR
// (500), TEST/MISMATCH (returns another student), TEST/NONAME (no full_name),
// TEST/DIRTY (markup and control characters in the record), TEST/REDIRECT
// (302 to a real student) and TEST/BIG (an answer over 20 KB).
//
// Every record here is invented. None of it is a real student.

const crypto  = require('crypto');
const express = require('express');
const STUDENTS = require('../mock/sis-students.json');

const key = m => String(m || '').trim().toUpperCase();
const BY_MATRIC = new Map(STUDENTS.map(s => [key(s.matric_number), s]));

function mockSisRouter(token) {
  const router = express.Router();
  const want = crypto.createHash('sha256').update(token).digest();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
    const m = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
    const got = crypto.createHash('sha256').update(m ? m[1].trim() : '').digest();
    if (!m || !crypto.timingSafeEqual(got, want)) return res.status(401).json({ error: 'Missing or wrong bearer token.' });
    next();
  });

  router.get('/health', (req, res) => res.json({ ok: true, students: STUDENTS.length }));

  router.get('/students/:matric', async (req, res) => {
    const matric = key(req.params.matric);
    switch (matric) {
      case 'TEST/SLOW':     await new Promise(r => setTimeout(r, 20000)); return res.status(404).json({ error: 'Not found.' });
      case 'TEST/ERROR':    return res.status(500).json({ error: 'Simulated SIS failure.' });
      case 'TEST/MISMATCH': return res.json(STUDENTS[0]);
      case 'TEST/NONAME':   return res.json({ matric_number: matric, status: 'enrolled' });
      case 'TEST/DIRTY':    return res.json({ matric_number: matric, full_name: 'Ade<script>alert(1)</script> \u202EOla\u202C', programme: 'B.Sc.\u0000 Physics', status: 'GRADUATED' });
      case 'TEST/REDIRECT': return res.redirect(302, '/mock-sis/students/CSC%2F2019%2F0012');
      case 'TEST/BIG':      return res.json({ matric_number: matric, full_name: 'Big Answer', padding: 'x'.repeat(30000) });
    }
    const s = BY_MATRIC.get(matric);
    if (!s) return res.status(404).json({ error: 'No student with that matric number.' });
    res.json(s);
  });

  router.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  return router;
}

// Returns the router to mount, or null when the test SIS is off
function mockSis() {
  if (process.env.MOCK_SIS_ENABLED !== '1') return null;
  const prod = process.env.NODE_ENV === 'production';
  const token = process.env.MOCK_SIS_TOKEN || (prod ? '' : 'test-sis-token');
  if (token.length < (prod ? 24 : 1)) {
    console.warn('MOCK_SIS_ENABLED is set but MOCK_SIS_TOKEN is missing or shorter than 24 characters; test SIS not mounted.');
    return null;
  }
  console.log(`Test SIS mounted at /mock-sis with ${STUDENTS.length} dummy students.`);
  return mockSisRouter(token);
}

module.exports = { mockSis, STUDENTS };
