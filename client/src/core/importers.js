// Import helpers: .docx (mammoth), .pdf (pdf.js text extraction), .html/.htm (sanitised), .rtf,
// .txt/.md, legacy .doc (server LibreOffice when available, else best-effort text extraction).
import { getMammoth, getPdfjs } from './vendor';
import { escapeHtml, fileExt, readAsArrayBuffer, readAsText, textToHtml } from './utils';
import { api, isServer } from './sync';

export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form,input,button,select,textarea,noscript').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || n === 'contenteditable' || (n === 'href' && /^\s*javascript:/i.test(a.value)) || (n === 'src' && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
      if (n === 'class' && /^Mso|^xl\d|^WordSection/.test(a.value)) el.removeAttribute('class');
    }
  });
  return doc.body.innerHTML;
}

export function rtfToText(rtf) {
  let s = String(rtf || '');
  s = s.replace(/\\par[d]?/g, '\n').replace(/\\line/g, '\n').replace(/\\tab/g, '\t');
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\u(-?\d+)\??/g, (m, n) => { let c = parseInt(n, 10); if (c < 0) c += 65536; return String.fromCharCode(c); });
  s = s.replace(/\{\\\*[^{}]*\}/g, '').replace(/\{\\(fonttbl|colortbl|stylesheet|info)[^]*?\}\}?/g, '');
  s = s.replace(/\\[a-zA-Z]+-?\d* ?/g, '').replace(/[{}]/g, '');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

function docBinaryToText(buf) {
  const bytes = new Uint8Array(buf);
  let out = '';
  let run = '';
  for (let i = 0; i < bytes.length - 1; i += 2) {
    const c = bytes[i] | (bytes[i + 1] << 8);
    if ((c >= 32 && c < 0xD800) || c === 13 || c === 10 || c === 9) run += c === 13 ? '\n' : String.fromCharCode(c);
    else { if (run.length > 20) out += run + '\n'; run = ''; }
  }
  if (run.length > 20) out += run;
  if (out.trim().length < 40) {
    out = '';
    run = '';
    for (const b of bytes) {
      if ((b >= 32 && b < 127) || b === 13 || b === 10 || b === 9) run += b === 13 ? '\n' : String.fromCharCode(b);
      else { if (run.length > 20) out += run + '\n'; run = ''; }
    }
  }
  return out.replace(/[^\S\n]{3,}/g, ' ').trim();
}

export async function pdfToText(arrayBuffer, onProgress) {
  const pdfjs = await getPdfjs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    let lastY = null;
    let line = '';
    const lines = [];
    for (const item of tc.items) {
      const y = item.transform ? Math.round(item.transform[5]) : 0;
      if (lastY !== null && Math.abs(y - lastY) > 4) { lines.push(line); line = ''; }
      line += (line && !line.endsWith(' ') && item.str && !item.str.startsWith(' ') ? ' ' : '') + item.str;
      lastY = y;
    }
    if (line) lines.push(line);
    pages.push(lines.join('\n'));
    if (onProgress) onProgress(i / pdf.numPages);
  }
  return pages;
}

/** File → { html, text, title } */
export async function fileToHtml(file, { onProgress } = {}) {
  const ext = fileExt(file.name);
  const title = file.name.replace(/\.[^.]+$/, '');
  if (ext === 'docx') {
    const mammoth = await getMammoth();
    const r = await mammoth.convertToHtml({ arrayBuffer: await readAsArrayBuffer(file) }, { convertImage: mammoth.images.imgElement((img) => img.read('base64').then((b) => ({ src: 'data:' + img.contentType + ';base64,' + b }))) });
    return { html: sanitizeHtml(r.value), title, warnings: r.messages };
  }
  if (ext === 'pdf') {
    const pages = await pdfToText(await readAsArrayBuffer(file), onProgress);
    const html = pages.map((p, i) => (i ? '<div class="page-break"></div>' : '') + textToHtml(p)).join('');
    return { html, title, pages: pages.length };
  }
  if (ext === 'html' || ext === 'htm') {
    const raw = await readAsText(file);
    const body = (raw.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, raw])[1];
    return { html: sanitizeHtml(body), title };
  }
  if (ext === 'rtf') return { html: textToHtml(rtfToText(await readAsText(file))), title };
  if (ext === 'doc' || ext === 'odt') {
    if (isServer()) {
      try {
        const fd = new FormData();
        fd.append('files', file);
        fd.append('meta', JSON.stringify({ source: 'import-temp', category: 'Other' }));
        const up = await api('files', { method: 'POST', form: fd });
        const conv = await api('files/' + up.files[0].id + '/convert', { method: 'POST', body: { to: 'docx' } });
        const r = await api('files/' + conv.file.id + '/raw', { raw: true });
        const mammoth = await getMammoth();
        const out = await mammoth.convertToHtml({ arrayBuffer: await r.arrayBuffer() });
        return { html: sanitizeHtml(out.value), title };
      } catch (e) { /* fall back to text */ }
    }
    return { html: textToHtml(docBinaryToText(await readAsArrayBuffer(file))), title, warnings: [{ message: 'Legacy .doc imported as plain text (install LibreOffice on the server for full fidelity)' }] };
  }
  const text = await readAsText(file);
  return { html: ext === 'md' ? textToHtml(text) : '<p>' + escapeHtml(text).replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>') + '</p>', title };
}
