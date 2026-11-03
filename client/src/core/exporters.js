// Export helpers: MS Word (.docx genuine OOXML + legacy .doc HTML), PDF, HTML, Markdown, TXT,
// rich clipboard copy for Word / Google Docs (ClipboardItem text/html + text/plain), Google Docs launch.
import { htmlToDocxBlob } from './docx';
import { download, downloadBlob, escapeHtml, stripHtml } from './utils';

export async function exportDocx(filename, html, opts = {}) {
  const blob = await htmlToDocxBlob(html, opts);
  downloadBlob(filename.endsWith('.docx') ? filename : filename + '.docx', blob);
  return blob;
}

export function wordHtmlDocument(html, { title = 'Document', margins = { top: 15, right: 15, bottom: 15, left: 15 }, landscape = false, css = '' } = {}) {
  const size = landscape ? '297mm 210mm' : '210mm 297mm';
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>@page Section1{size:${size};margin:${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;mso-page-orientation:${landscape ? 'landscape' : 'portrait'}}div.Section1{page:Section1}
body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.35}table{border-collapse:collapse}td,th{border:1px solid #999;padding:3pt 5pt;vertical-align:top}th{background:#f1f5f9}${css}</style></head>
<body><div class="Section1">${html}</div></body></html>`;
}

export function exportDoc(filename, html, opts) {
  download(filename.endsWith('.doc') ? filename : filename + '.doc', '﻿' + wordHtmlDocument(html, opts), 'application/msword');
}

export function standaloneHtml(html, { title = 'Document', css = '' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.45;max-width:190mm;margin:12mm auto;color:#0f172a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #94a3b8;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f1f5f9}img{max-width:100%}${css}</style></head><body>${html}</body></html>`;
}
export const exportHtml = (filename, html, opts) => download(filename.endsWith('.html') ? filename : filename + '.html', standaloneHtml(html, opts), 'text/html;charset=utf-8');
export const exportTxt = (filename, html) => download(filename.endsWith('.txt') ? filename : filename + '.txt', stripHtml(html), 'text/plain;charset=utf-8');

/** Lightweight HTML → Markdown */
export function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
  const walk = (node, ctx = { list: null, depth: 0 }) => {
    let out = '';
    for (const n of Array.from(node.childNodes)) {
      if (n.nodeType === 3) { out += n.nodeValue.replace(/\s+/g, ' '); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.tagName.toLowerCase();
      const inner = () => walk(n, ctx);
      if (/^h[1-6]$/.test(t)) out += '\n\n' + '#'.repeat(+t[1]) + ' ' + inner().trim() + '\n\n';
      else if (t === 'p' || t === 'div') out += '\n\n' + inner().trim() + '\n\n';
      else if (t === 'br') out += '  \n';
      else if (t === 'strong' || t === 'b') out += '**' + inner().trim() + '**';
      else if (t === 'em' || t === 'i') out += '*' + inner().trim() + '*';
      else if (t === 'u') out += '<u>' + inner() + '</u>';
      else if (t === 'a') out += '[' + inner() + '](' + (n.getAttribute('href') || '') + ')';
      else if (t === 'hr') out += '\n\n---\n\n';
      else if (t === 'ul' || t === 'ol') {
        let i = 1;
        out += '\n';
        for (const li of Array.from(n.children)) {
          out += '  '.repeat(ctx.depth) + (t === 'ol' ? (i++) + '. ' : '- ') + walk(li, { list: t, depth: ctx.depth + 1 }).trim() + '\n';
        }
        out += '\n';
      } else if (t === 'table') {
        const rows = Array.from(n.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((c) => walk(c, ctx).trim().replace(/\|/g, '\\|')));
        if (rows.length) {
          const w = Math.max(...rows.map((r) => r.length));
          const norm = rows.map((r) => r.concat(new Array(w - r.length).fill('')));
          out += '\n\n| ' + norm[0].join(' | ') + ' |\n|' + ' --- |'.repeat(w) + '\n' + norm.slice(1).map((r) => '| ' + r.join(' | ') + ' |').join('\n') + '\n\n';
        }
      } else if (t === 'img') out += '![' + (n.getAttribute('alt') || 'image') + '](embedded-image)';
      else out += inner();
    }
    return out;
  };
  return walk(doc.body).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
export const exportMarkdown = (filename, html) => download(filename.endsWith('.md') ? filename : filename + '.md', htmlToMarkdown(html), 'text/markdown;charset=utf-8');

/** Copy formatted HTML + plain text so Ctrl+V in MS Word / Google Docs keeps fonts, tables and bold headers. */
export async function copyRich(html, text) {
  const plain = text || stripHtml(html);
  const wrapped = '<meta charset="utf-8"><div style="font-family:Arial,Helvetica,sans-serif;font-size:11pt">' + html + '</div>';
  try {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([wrapped], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]);
      return true;
    }
  } catch (e) { /* fall back to execCommand */ }
  const holder = document.createElement('div');
  holder.contentEditable = 'true';
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
  holder.innerHTML = wrapped;
  document.body.appendChild(holder);
  const range = document.createRange();
  range.selectNodeContents(holder);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const ok = document.execCommand('copy');
  sel.removeAllRanges();
  holder.remove();
  return ok;
}

/** Google Docs bridge: copies rich content then opens a new Google Doc (paste with Ctrl+V). */
export async function openInGoogleDocs(html) {
  await copyRich(html);
  window.open('https://docs.new', '_blank', 'noopener');
}
