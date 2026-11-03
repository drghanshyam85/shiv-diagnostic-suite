// Client-side PDF generation: each rendered page element → html2canvas → jsPDF page (exact mm size).
import { getHtml2canvas, getJsPDF } from './vendor';
import { downloadBlob } from './utils';

export async function pagesToPdf(pageEls, { widthMm = 210, heightMm = 297, filename = 'document.pdf', scale = 2, quality = 0.92, download = true } = {}) {
  const [html2canvas, JsPDF] = await Promise.all([getHtml2canvas(), getJsPDF()]);
  const els = Array.from(pageEls);
  if (!els.length) throw new Error('Nothing to export');
  const orientation = widthMm > heightMm ? 'landscape' : 'portrait';
  const pdf = new JsPDF({ unit: 'mm', format: [widthMm, heightMm], orientation, compress: true });
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    const canvas = await html2canvas(el, { scale, useCORS: true, backgroundColor: '#ffffff', logging: false, windowWidth: el.scrollWidth, windowHeight: el.scrollHeight });
    const img = canvas.toDataURL('image/jpeg', quality);
    if (i > 0) pdf.addPage([widthMm, heightMm], orientation);
    const h = heightMm === 'auto' ? (canvas.height / canvas.width) * widthMm : heightMm;
    pdf.addImage(img, 'JPEG', 0, 0, widthMm, h, undefined, 'FAST');
  }
  const blob = pdf.output('blob');
  if (download) downloadBlob(filename, blob);
  return blob;
}

/** Render HTML (string containing .print-page elements) off-screen and convert to PDF. */
export async function htmlToPdf(html, opts = {}) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-12000px;top:0;z-index:-1;background:#fff';
  host.innerHTML = html;
  document.body.appendChild(host);
  try {
    await Promise.all(Array.from(host.querySelectorAll('img')).map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* ignore */ } }
    if (opts.prepare) opts.prepare(host);
    let pages = host.querySelectorAll('.print-page');
    if (!pages.length) pages = [host.firstElementChild];
    let heightMm = opts.heightMm;
    if (heightMm === 'auto') heightMm = Math.ceil(pages[0].getBoundingClientRect().height / 3.7795275591);
    return await pagesToPdf(pages, Object.assign({}, opts, { heightMm }));
  } finally {
    host.remove();
  }
}
