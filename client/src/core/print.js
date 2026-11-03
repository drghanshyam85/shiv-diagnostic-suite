// Print engine: renders exact-size pages into #print-root, sets a matching @page rule and calls
// window.print(). Browser headers/footers disappear because the page margin is 0.
import { logAudit } from './auth';

function ensureRoot() {
  let root = document.getElementById('print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-root';
    document.body.appendChild(root);
  }
  return root;
}

function waitImages(root) {
  const imgs = Array.from(root.querySelectorAll('img'));
  return Promise.all(imgs.map((img) => (img.complete && img.naturalWidth ? null : new Promise((r) => { img.onload = r; img.onerror = r; setTimeout(r, 3000); }))));
}

/**
 * printHtml({ html, widthMm, heightMm, title, audit })
 *   html: markup containing one or more .print-page elements (each exactly widthMm × heightMm)
 *   heightMm may be 'auto' for continuous thermal rolls (height measured from content).
 *   prepare(root) runs after layout, before printing (e.g. auto-fit font sizes to the page).
 */
export async function printHtml({ html, widthMm = 210, heightMm = 297, title, audit, prepare }) {
  const root = ensureRoot();
  root.innerHTML = html;
  root.style.display = 'block';
  root.style.position = 'fixed';
  root.style.left = '-10000px';
  root.style.top = '0';
  await waitImages(root);
  // web fonts (Devanagari labels, display faces) must be ready before measuring / fitting pages
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* ignore */ } }
  if (prepare) prepare(root);
  let h = heightMm;
  if (heightMm === 'auto') {
    const first = root.firstElementChild;
    const px = first ? first.getBoundingClientRect().height : 600;
    h = Math.ceil(px / 3.7795275591) + 2;
  }
  root.style.cssText = '';
  let style = document.getElementById('print-page-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'print-page-style';
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${widthMm}mm ${h}mm; margin: 0; }`;
  const oldTitle = document.title;
  if (title) document.title = title;
  document.body.classList.add('is-printing');
  const cleanup = () => {
    document.body.classList.remove('is-printing');
    document.title = oldTitle;
    root.innerHTML = '';
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  if (audit) logAudit(audit.action || 'print:document', audit.target || '', audit.meta || {});
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.print();
  setTimeout(() => { if (document.body.classList.contains('is-printing')) cleanup(); }, 1500);
}

/** Clone live preview pages (already rendered in the DOM) and print them. */
export function printElements(elements, opts) {
  const html = Array.from(elements).map((el) => {
    const clone = el.cloneNode(true);
    clone.style.transform = '';
    clone.style.margin = '0';
    clone.style.boxShadow = 'none';
    return clone.outerHTML;
  }).join('');
  return printHtml(Object.assign({ html }, opts));
}

export const MM = 3.7795275591; // px per mm at 96 dpi
export const PAPER = {
  a4: { w: 210, h: 297, label: 'A4 (210 × 297 mm)' },
  a4l: { w: 297, h: 210, label: 'A4 Landscape' },
  a5: { w: 148, h: 210, label: 'A5' },
  third: { w: 210, h: 99, label: '1/3 A4 slip (210 × 99 mm)' },
  quarter: { w: 105, h: 148.5, label: '1/4 A4 slip (105 × 148.5 mm)' },
  thermal: { w: 80, h: 'auto', label: '80 mm thermal roll' }
};
