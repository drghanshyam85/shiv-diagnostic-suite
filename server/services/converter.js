/*
 * Optional server-side document conversion via LibreOffice (soffice --headless --convert-to).
 * Used for .docx/.doc/.rtf/.html → .pdf when LibreOffice is installed; otherwise the browser
 * converts with mammoth + html2canvas/jsPDF.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CANDIDATES = [
  process.env.SOFFICE_PATH,
  '/usr/bin/soffice', '/usr/local/bin/soffice', '/usr/bin/libreoffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
].filter(Boolean);

let found;
function sofficePath() {
  if (found !== undefined) return found;
  found = CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;
  return found;
}

function convert(buffer, inputName, toExt) {
  const bin = sofficePath();
  if (!bin) return Promise.reject(new Error('LibreOffice not installed on the server'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssdc-conv-'));
  const safe = inputName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'input.docx';
  const inFile = path.join(dir, safe);
  fs.writeFileSync(inFile, buffer);
  return new Promise((resolve, reject) => {
    execFile(bin, ['--headless', '--norestore', '--convert-to', toExt, '--outdir', dir, inFile], { timeout: 90000 }, (err) => {
      try {
        if (err) throw err;
        const outName = safe.replace(/\.[^.]+$/, '') + '.' + toExt.split(':')[0];
        const outFile = path.join(dir, outName);
        if (!fs.existsSync(outFile)) throw new Error('Conversion produced no output');
        const data = fs.readFileSync(outFile);
        resolve({ buffer: data, filename: outName });
      } catch (e) { reject(e); } finally { fs.rm(dir, { recursive: true, force: true }, () => {}); }
    });
  });
}

module.exports = { convert, sofficePath };
