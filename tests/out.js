// Scratch folder for files the tests download (PDFs, ZIPs, screenshots)
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = process.env.TEST_OUT || path.join(os.tmpdir(), 'univerify-tests');
fs.mkdirSync(dir, { recursive: true });
module.exports = dir + path.sep;
