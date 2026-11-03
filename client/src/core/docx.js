// HTML → .docx (Office Open XML) converter. Produces genuine WordprocessingML (not altChunk), so the
// file opens natively in MS Word, Google Docs (upload / Drive) and LibreOffice.
// Supports: paragraphs, headings, bold/italic/underline/strike/sub/sup, colours, highlights, fonts,
// sizes, alignment, line spacing, indents, bullet & numbered lists (nested), tables (colspan,
// rowspan, shading, header rows), images (data: URLs), hyperlinks, page breaks, horizontal rules,
// header & footer parts, A4 portrait/landscape page setup with margins in mm.
import JSZip from 'jszip';

const TW_PER_MM = 1440 / 25.4;
const EMU_PER_PX = 9525;
const NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'blockquote', 'pre', 'hr', 'section', 'article', 'header', 'footer', 'figure', 'figcaption', 'center', 'address', 'main', 'nav', 'aside', 'dl', 'dt', 'dd', 'tbody', 'thead', 'tfoot', 'form', 'fieldset']);
const SKIP_TAGS = new Set(['script', 'style', 'head', 'meta', 'title', 'link', 'noscript', 'template', 'button', 'input', 'select', 'textarea', 'iframe', 'object', 'svg', 'canvas', 'video', 'audio']);
const NAMED = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', orange: 'FFA500', navy: '000080', maroon: '800000', purple: '800080', teal: '008080', silver: 'C0C0C0', darkblue: '00008B', darkred: '8B0000', darkgreen: '006400' };
const FONT_SIZES = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 18, 6: 24, 7: 36 };
const HEADING_PT = { h1: 16, h2: 14, h3: 12.5, h4: 12, h5: 11, h6: 10 };

const esc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function hex(c) {
  if (!c) return null;
  c = String(c).trim().toLowerCase();
  if (!c || c === 'transparent' || c === 'inherit' || c === 'initial' || c === 'currentcolor') return null;
  if (NAMED[c]) return NAMED[c];
  let m = c.match(/^#([0-9a-f]{3})$/);
  if (m) return m[1].split('').map((x) => x + x).join('').toUpperCase();
  m = c.match(/^#([0-9a-f]{6})/);
  if (m) return m[1].toUpperCase();
  m = c.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?/);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
    return [m[1], m[2], m[3]].map((x) => Math.min(255, +x).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return null;
}

/** CSS length → points */
function pt(v, basePt) {
  if (v === undefined || v === null || v === '') return null;
  const m = String(v).trim().match(/^(-?[\d.]+)(px|pt|em|rem|%|mm|cm|in)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case 'pt': return n;
    case 'em': return n * (basePt || 11);
    case 'rem': return n * 12;
    case '%': return (n / 100) * (basePt || 11);
    case 'mm': return n * 2.83465;
    case 'cm': return n * 28.3465;
    case 'in': return n * 72;
    default: return n * 0.75;
  }
}
const ptToTw = (p) => Math.round(p * 20);

function imageSize(bytes, mime) {
  try {
    if (/png/.test(mime) && bytes[0] === 0x89) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset);
      return { w: dv.getUint32(16), h: dv.getUint32(20) };
    }
    if (/jpe?g/.test(mime)) {
      let i = 2;
      while (i < bytes.length) {
        if (bytes[i] !== 0xFF) { i++; continue; }
        const marker = bytes[i + 1];
        const len = (bytes[i + 2] << 8) + bytes[i + 3];
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          return { h: (bytes[i + 5] << 8) + bytes[i + 6], w: (bytes[i + 7] << 8) + bytes[i + 8] };
        }
        i += 2 + len;
      }
    }
    if (/gif/.test(mime)) return { w: bytes[6] + (bytes[7] << 8), h: bytes[8] + (bytes[9] << 8) };
  } catch (e) { /* ignore */ }
  return { w: 400, h: 300 };
}

class Part {
  constructor(docx, name) { this.docx = docx; this.name = name; this.rels = []; }
  addRel(type, target, external) {
    const id = 'rId' + (100 + this.rels.length);
    this.rels.push({ id, type, target, external });
    return id;
  }
  relsXml(base) {
    const all = (base || []).concat(this.rels);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      all.map((r) => `<Relationship Id="${r.id}" Type="${REL}/${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('') + '</Relationships>';
  }
}

class Converter {
  constructor(opts) {
    this.o = opts;
    this.media = [];
    this.docPrId = 1;
    this.numInstances = [];
    this.contentWidthTw = opts.contentWidthTw;
  }

  styleOf(el) { return el && el.style ? el.style : {}; }

  // ------------------------------------------------------------------ run properties
  runProps(el, inherited) {
    const r = Object.assign({}, inherited);
    const tag = el.tagName.toLowerCase();
    const st = this.styleOf(el);
    if (tag === 'b' || tag === 'strong' || tag === 'th') r.b = true;
    if (tag === 'i' || tag === 'em' || tag === 'cite' || tag === 'var') r.i = true;
    if (tag === 'u' || tag === 'ins') r.u = true;
    if (tag === 's' || tag === 'strike' || tag === 'del') r.strike = true;
    if (tag === 'sup') r.vert = 'superscript';
    if (tag === 'sub') r.vert = 'subscript';
    if (tag === 'mark') r.highlight = 'yellow';
    if (tag === 'code' || tag === 'kbd' || tag === 'samp' || tag === 'tt') r.font = 'Consolas';
    if (tag === 'small') r.size = (r.size || this.o.fontSize) * 0.85;
    if (tag === 'big') r.size = (r.size || this.o.fontSize) * 1.2;
    if (/^h[1-6]$/.test(tag)) { r.b = true; r.size = HEADING_PT[tag]; }
    if (tag === 'font') {
      if (el.getAttribute('color')) r.color = hex(el.getAttribute('color')) || r.color;
      if (el.getAttribute('face')) r.font = el.getAttribute('face').split(',')[0].replace(/['"]/g, '').trim();
      if (el.getAttribute('size')) r.size = FONT_SIZES[el.getAttribute('size')] || r.size;
    }
    if (tag === 'a') { r.color = r.color || '0563C1'; r.u = true; }
    if (st.fontWeight && (st.fontWeight === 'bold' || st.fontWeight === 'bolder' || parseInt(st.fontWeight, 10) >= 600)) r.b = true;
    if (st.fontWeight && (st.fontWeight === 'normal' || parseInt(st.fontWeight, 10) <= 400)) r.b = false;
    if (st.fontStyle === 'italic' || st.fontStyle === 'oblique') r.i = true;
    if (st.fontStyle === 'normal') r.i = false;
    const td = (st.textDecoration || st.textDecorationLine || '');
    if (td.includes('underline')) r.u = true;
    if (td.includes('line-through')) r.strike = true;
    if (st.color) r.color = hex(st.color) || r.color;
    if (st.backgroundColor && hex(st.backgroundColor) && hex(st.backgroundColor) !== 'FFFFFF') r.shd = hex(st.backgroundColor);
    if (st.fontSize) { const p = pt(st.fontSize, r.size || this.o.fontSize); if (p) r.size = p; }
    if (st.fontFamily) r.font = st.fontFamily.split(',')[0].replace(/['"]/g, '').trim() || r.font;
    if (st.textTransform === 'uppercase') r.caps = true;
    if (st.verticalAlign === 'super') r.vert = 'superscript';
    if (st.verticalAlign === 'sub') r.vert = 'subscript';
    return r;
  }

  rPrXml(r) {
    let x = '';
    if (r.font) x += `<w:rFonts w:ascii="${esc(r.font)}" w:hAnsi="${esc(r.font)}" w:cs="${esc(r.font)}"/>`;
    if (r.b) x += '<w:b/><w:bCs/>';
    if (r.i) x += '<w:i/><w:iCs/>';
    if (r.caps) x += '<w:caps/>';
    if (r.strike) x += '<w:strike/>';
    if (r.color) x += `<w:color w:val="${r.color}"/>`;
    if (r.size) x += `<w:sz w:val="${Math.round(r.size * 2)}"/><w:szCs w:val="${Math.round(r.size * 2)}"/>`;
    if (r.highlight) x += `<w:highlight w:val="${r.highlight}"/>`;
    if (r.u) x += '<w:u w:val="single"/>';
    if (r.shd) x += `<w:shd w:val="clear" w:color="auto" w:fill="${r.shd}"/>`;
    if (r.vert) x += `<w:vertAlign w:val="${r.vert}"/>`;
    return x ? '<w:rPr>' + x + '</w:rPr>' : '';
  }

  textRun(text, r) {
    if (!text) return '';
    return `<w:r>${this.rPrXml(r)}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  }

  // ------------------------------------------------------------------ inline → runs
  runs(nodes, part, rIn, state) {
    let out = '';
    for (const n of nodes) {
      if (n.nodeType === 3) {
        let t = n.nodeValue;
        if (!state.pre) t = t.replace(/[\s ]+/g, (m) => (m.includes(' ') ? m.replace(/[^ ]/g, '').replace(/ /g, ' ') || ' ' : ' '));
        if (!state.pre && state.atStart) t = t.replace(/^ +/, '');
        if (!t) continue;
        state.atStart = /\n$/.test(t);
        if (state.pre && t.includes('\n')) {
          t.split('\n').forEach((line, i) => { if (i) out += '<w:r><w:br/></w:r>'; out += this.textRun(line, rIn); });
        } else out += this.textRun(t, rIn);
        state.lastText = t;
        continue;
      }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      if (tag === 'br') { out += '<w:r><w:br/></w:r>'; state.atStart = true; continue; }
      if (tag === 'img') { out += this.image(n, part); state.atStart = false; continue; }
      if (n.classList && (n.classList.contains('page-break') || n.classList.contains('pagebreak'))) { out += '<w:r><w:br w:type="page"/></w:r>'; continue; }
      const r = this.runProps(n, rIn);
      if (tag === 'a' && n.getAttribute('href') && /^(https?:|mailto:)/i.test(n.getAttribute('href'))) {
        const id = part.addRel('hyperlink', n.getAttribute('href'), true);
        out += `<w:hyperlink r:id="${id}" w:history="1">` + this.runs(Array.from(n.childNodes), part, r, state) + '</w:hyperlink>';
        continue;
      }
      out += this.runs(Array.from(n.childNodes), part, r, state);
    }
    return out;
  }

  image(img, part) {
    const src = img.getAttribute('src') || '';
    const m = src.match(/^data:(image\/(png|jpe?g|gif));base64,(.+)$/i);
    if (!m) return img.getAttribute('alt') ? this.textRun('[' + img.getAttribute('alt') + ']', {}) : '';
    const mime = m[1].toLowerCase();
    const ext = m[2].toLowerCase().replace('jpg', 'jpeg');
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const nat = imageSize(bytes, mime);
    const st = this.styleOf(img);
    const maxPx = (this.contentWidthTw / 15);
    let wPx = pt(st.width || img.getAttribute('width'), 11);
    wPx = wPx ? wPx / 0.75 : null;
    if (st.width && /%$/.test(st.width)) wPx = maxPx * parseFloat(st.width) / 100;
    let hPx = pt(st.height || img.getAttribute('height'), 11);
    hPx = hPx && !/%$/.test(st.height || '') ? hPx / 0.75 : null;
    if (!wPx && !hPx) { wPx = nat.w; hPx = nat.h; }
    else if (wPx && !hPx) hPx = wPx * (nat.h / nat.w);
    else if (hPx && !wPx) wPx = hPx * (nat.w / nat.h);
    if (wPx > maxPx) { hPx = hPx * (maxPx / wPx); wPx = maxPx; }
    const name = `image${this.media.length + 1}.${ext}`;
    this.media.push({ name, bytes });
    const rid = part.addRel('image', 'media/' + name);
    const id = this.docPrId++;
    const cx = Math.round(wPx * EMU_PER_PX);
    const cy = Math.round(hPx * EMU_PER_PX);
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="Picture ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  // ------------------------------------------------------------------ paragraph properties
  paraProps(el, inherited) {
    const p = Object.assign({}, inherited);
    delete p.pageBreakBefore;
    if (!el || el.nodeType !== 1) return p;
    const tag = el.tagName.toLowerCase();
    const st = this.styleOf(el);
    if (/^h[1-6]$/.test(tag)) { p.style = 'Heading' + tag[1]; p.keepNext = true; }
    if (tag === 'center') p.jc = 'center';
    const align = st.textAlign || el.getAttribute('align');
    if (align) p.jc = { left: 'left', start: 'left', right: 'right', end: 'right', center: 'center', justify: 'both' }[align] || p.jc;
    const ml = pt(st.marginLeft, 11) || 0;
    const pl = pt(st.paddingLeft, 11) || 0;
    if (ml + pl > 0) p.indLeft = (p.indLeft || 0) + ptToTw(ml + pl);
    if (tag === 'blockquote') p.indLeft = (p.indLeft || 0) + 567;
    if (st.textIndent) { const ti = pt(st.textIndent, 11); if (ti) p.firstLine = ptToTw(ti); }
    if (st.lineHeight) {
      const lh = String(st.lineHeight);
      if (/^[\d.]+$/.test(lh)) p.line = { v: Math.round(240 * parseFloat(lh)), rule: 'auto' };
      else if (/%$/.test(lh)) p.line = { v: Math.round(2.4 * parseFloat(lh)), rule: 'auto' };
      else { const l = pt(lh, 11); if (l) p.line = { v: ptToTw(l), rule: 'atLeast' }; }
    }
    if (st.marginTop) { const v = pt(st.marginTop, 11); if (v !== null) p.before = ptToTw(Math.max(0, v)); }
    if (st.marginBottom) { const v = pt(st.marginBottom, 11); if (v !== null) p.after = ptToTw(Math.max(0, v)); }
    if (st.backgroundColor && hex(st.backgroundColor) && hex(st.backgroundColor) !== 'FFFFFF') p.shd = hex(st.backgroundColor);
    if (st.pageBreakBefore === 'always' || st.breakBefore === 'page') p.pageBreakBefore = true;
    if (st.borderBottom && !/none|0px/.test(st.borderBottom)) p.borderBottom = hex(st.borderBottomColor) || '999999';
    if (st.borderTop && !/none|0px/.test(st.borderTop)) p.borderTop = hex(st.borderTopColor) || '999999';
    return p;
  }

  pPrXml(p, num) {
    let x = '';
    if (p.style) x += `<w:pStyle w:val="${p.style}"/>`;
    if (p.keepNext) x += '<w:keepNext/>';
    if (p.pageBreakBefore) x += '<w:pageBreakBefore/>';
    if (num) x += `<w:numPr><w:ilvl w:val="${num.level}"/><w:numId w:val="${num.numId}"/></w:numPr>`;
    if (p.borderTop || p.borderBottom) {
      x += '<w:pBdr>' + (p.borderTop ? `<w:top w:val="single" w:sz="6" w:space="1" w:color="${p.borderTop}"/>` : '') + (p.borderBottom ? `<w:bottom w:val="single" w:sz="6" w:space="1" w:color="${p.borderBottom}"/>` : '') + '</w:pBdr>';
    }
    if (p.shd) x += `<w:shd w:val="clear" w:color="auto" w:fill="${p.shd}"/>`;
    if (p.before !== undefined || p.after !== undefined || p.line) {
      x += '<w:spacing' + (p.before !== undefined ? ` w:before="${p.before}"` : '') + (p.after !== undefined ? ` w:after="${p.after}"` : '') + (p.line ? ` w:line="${p.line.v}" w:lineRule="${p.line.rule}"` : '') + '/>';
    }
    if ((p.indLeft || p.firstLine) && !num) x += '<w:ind' + (p.indLeft ? ` w:left="${p.indLeft}"` : '') + (p.firstLine ? ` w:firstLine="${p.firstLine}"` : '') + '/>';
    else if (num && p.listIndentExtra) x += `<w:ind w:left="${720 + num.level * 360 + p.listIndentExtra}" w:hanging="360"/>`;
    if (p.jc) x += `<w:jc w:val="${p.jc}"/>`;
    return x ? '<w:pPr>' + x + '</w:pPr>' : '';
  }

  paragraph(nodes, part, pProps, rProps, num, pre) {
    const state = { atStart: true, pre: !!pre };
    let runs = this.runs(nodes, part, rProps, state);
    runs = runs.replace(/(<w:t xml:space="preserve">[^<]*?) +(<\/w:t><\/w:r>)$/, '$1$2');
    return `<w:p>${this.pPrXml(pProps, num)}${runs}</w:p>`;
  }

  // ------------------------------------------------------------------ blocks
  blocks(container, part, ctx) {
    const out = [];
    let inline = [];
    const flush = () => {
      if (!inline.length) return;
      const hasContent = inline.some((n) => (n.nodeType === 3 && /\S/.test(n.nodeValue)) || (n.nodeType === 1 && !SKIP_TAGS.has(n.tagName.toLowerCase())));
      if (hasContent) {
        out.push(this.paragraph(inline, part, ctx.p, ctx.r, ctx.list && !ctx.listUsed ? ctx.list : null, ctx.pre));
        if (ctx.list) ctx.listUsed = true;
      }
      inline = [];
    };
    for (const n of Array.from(container.childNodes)) {
      if (n.nodeType === 3) { if (/\S/.test(n.nodeValue) || inline.length) inline.push(n); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      const st = this.styleOf(n);
      if (st.display === 'none') continue;
      const isBlock = BLOCK_TAGS.has(tag) || st.display === 'block' || (n.classList && (n.classList.contains('page-break') || n.classList.contains('pagebreak')));
      if (!isBlock) { inline.push(n); continue; }
      flush();
      out.push(...this.block(n, part, ctx));
    }
    flush();
    return out;
  }

  block(el, part, ctx) {
    const tag = el.tagName.toLowerCase();
    if (el.classList && (el.classList.contains('page-break') || el.classList.contains('pagebreak'))) return ['<w:p><w:r><w:br w:type="page"/></w:r></w:p>'];
    if (tag === 'hr') return ['<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr><w:spacing w:before="60" w:after="60"/></w:pPr></w:p>'];
    if (tag === 'table') return [this.table(el, part, ctx)];
    if (tag === 'ul' || tag === 'ol') return this.list(el, part, ctx, tag === 'ol');
    const p = this.paraProps(el, ctx.p);
    const r = this.runProps(el, ctx.r);
    const childCtx = Object.assign({}, ctx, { p, r, pre: ctx.pre || tag === 'pre' });
    if (tag === 'li') return this.blocks(el, part, childCtx);
    const out = this.blocks(el, part, childCtx);
    if (ctx.list) ctx.listUsed = childCtx.listUsed;
    if (!out.length && (tag === 'p' || /^h[1-6]$/.test(tag))) out.push(`<w:p>${this.pPrXml(p)}</w:p>`);
    if (p.pageBreakBefore && out.length && !out[0].includes('pageBreakBefore')) out[0] = out[0].replace('<w:p>', '<w:p><w:pPr><w:pageBreakBefore/></w:pPr>').replace('</w:pPr><w:pPr>', '');
    return out;
  }

  list(el, part, ctx, ordered) {
    const level = ctx.list ? Math.min(8, ctx.list.level + 1) : 0;
    let numId;
    if (ctx.list && ctx.list.ordered === ordered) numId = ctx.list.numId;
    else { this.numInstances.push(ordered ? 2 : 1); numId = 10 + this.numInstances.length; }
    const out = [];
    for (const li of Array.from(el.children)) {
      if (li.tagName.toLowerCase() !== 'li') { out.push(...this.block(li, part, ctx)); continue; }
      const liCtx = Object.assign({}, ctx, { list: { numId, level, ordered }, listUsed: false, p: Object.assign({}, this.paraProps(li, ctx.p)), r: this.runProps(li, ctx.r) });
      out.push(...this.blocks(li, part, liCtx));
    }
    return out;
  }

  table(el, part, ctx) {
    const rows = [];
    const collect = (node, isHead) => {
      for (const c of Array.from(node.children)) {
        const t = c.tagName.toLowerCase();
        if (t === 'tr') rows.push({ tr: c, head: isHead || Array.from(c.children).every((x) => x.tagName.toLowerCase() === 'th') });
        else if (t === 'thead') collect(c, true);
        else if (t === 'tbody' || t === 'tfoot') collect(c, false);
      }
    };
    collect(el, false);
    if (!rows.length) return '';
    // grid
    let cols = 0;
    const occupancy = [];
    const layout = rows.map((row, ri) => {
      const cells = [];
      let ci = 0;
      for (const td of Array.from(row.tr.children)) {
        if (!/^t[dh]$/i.test(td.tagName)) continue;
        while (occupancy[ri] && occupancy[ri][ci]) ci++;
        const cs = Math.max(1, parseInt(td.getAttribute('colspan') || '1', 10) || 1);
        const rs = Math.max(1, parseInt(td.getAttribute('rowspan') || '1', 10) || 1);
        for (let r = 0; r < rs; r++) {
          occupancy[ri + r] = occupancy[ri + r] || [];
          for (let k = 0; k < cs; k++) occupancy[ri + r][ci + k] = r === 0 ? 'cell' : 'merge';
        }
        cells.push({ td, ci, cs, rs });
        ci += cs;
      }
      cols = Math.max(cols, ci, occupancy[ri] ? occupancy[ri].length : 0);
      return cells;
    });
    const tblStyle = this.styleOf(el);
    let widthTw = this.contentWidthTw;
    if (tblStyle.width && /%$/.test(tblStyle.width)) widthTw = Math.round(this.contentWidthTw * parseFloat(tblStyle.width) / 100);
    else if (tblStyle.width) { const p = pt(tblStyle.width, 11); if (p) widthTw = Math.min(this.contentWidthTw, ptToTw(p)); }
    // column widths from first row hints
    const colW = new Array(cols).fill(null);
    layout.forEach((cells) => cells.forEach((c) => {
      if (c.cs !== 1 || colW[c.ci]) return;
      const w = this.styleOf(c.td).width || c.td.getAttribute('width');
      if (!w) return;
      colW[c.ci] = /%$/.test(w) ? Math.round(widthTw * parseFloat(w) / 100) : (pt(/^\d+$/.test(w) ? w + 'px' : w, 11) ? ptToTw(pt(/^\d+$/.test(w) ? w + 'px' : w, 11)) : null);
    }));
    const known = colW.reduce((s, w) => s + (w || 0), 0);
    const unknownCount = colW.filter((w) => !w).length;
    const rest = unknownCount ? Math.max(400, Math.round((widthTw - known) / unknownCount)) : 0;
    for (let i = 0; i < cols; i++) if (!colW[i]) colW[i] = rest;
    const total = colW.reduce((s, w) => s + w, 0);
    if (total > this.contentWidthTw) for (let i = 0; i < cols; i++) colW[i] = Math.round(colW[i] * this.contentWidthTw / total);

    const borderAttr = el.getAttribute('border');
    const noBorder = borderAttr === '0' || /none/.test(tblStyle.borderStyle || '') || (tblStyle.border && /none|^0/.test(tblStyle.border)) || (el.classList && el.classList.contains('no-border'));
    const b = noBorder ? 'none' : 'single';
    const bc = hex(tblStyle.borderColor) || '8C8C8C';
    let x = '<w:tbl><w:tblPr><w:tblW w:w="' + colW.reduce((s, w) => s + w, 0) + '" w:type="dxa"/>';
    if (tblStyle.marginLeft === 'auto' && tblStyle.marginRight === 'auto') x += '<w:jc w:val="center"/>';
    x += `<w:tblBorders><w:top w:val="${b}" w:sz="4" w:space="0" w:color="${bc}"/><w:left w:val="${b}" w:sz="4" w:space="0" w:color="${bc}"/><w:bottom w:val="${b}" w:sz="4" w:space="0" w:color="${bc}"/><w:right w:val="${b}" w:sz="4" w:space="0" w:color="${bc}"/><w:insideH w:val="${b}" w:sz="4" w:space="0" w:color="${bc}"/><w:insideV w:val="${b}" w:sz="4" w:space="0" w:color="${bc}"/></w:tblBorders>`;
    x += '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr>';
    x += '<w:tblGrid>' + colW.map((w) => `<w:gridCol w:w="${w}"/>`).join('') + '</w:tblGrid>';
    rows.forEach((row, ri) => {
      x += '<w:tr>' + (row.head ? '<w:trPr><w:tblHeader/></w:trPr>' : '');
      const cells = layout[ri];
      let ci = 0;
      const occ = occupancy[ri] || [];
      const emit = (c) => {
        const td = c.td;
        const st = this.styleOf(td);
        const w = colW.slice(c.ci, c.ci + c.cs).reduce((s, v) => s + v, 0);
        let tc = `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>`;
        if (c.cs > 1) tc += `<w:gridSpan w:val="${c.cs}"/>`;
        if (c.rs > 1) tc += '<w:vMerge w:val="restart"/>';
        const fill = hex(st.backgroundColor || td.getAttribute('bgcolor') || this.styleOf(row.tr).backgroundColor) || (td.tagName.toLowerCase() === 'th' ? 'F1F5F9' : null);
        if (fill && fill !== 'FFFFFF') tc += `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`;
        const va = st.verticalAlign || td.getAttribute('valign');
        if (va && /middle|center/.test(va)) tc += '<w:vAlign w:val="center"/>';
        else if (va && /bottom/.test(va)) tc += '<w:vAlign w:val="bottom"/>';
        tc += '</w:tcPr>';
        const cellCtx = Object.assign({}, ctx, { p: Object.assign(this.paraProps(td, {}), { after: 0, before: 0 }), r: this.runProps(td, ctx.r), list: null, listUsed: false });
        const inner = this.blocks(td, part, cellCtx);
        tc += inner.length ? inner.join('') : '<w:p/>';
        tc += '</w:tc>';
        return tc;
      };
      let k = 0;
      while (ci < cols) {
        if (occ[ci] === 'merge') {
          // find span width of the merged cell from row above
          let span = 1;
          for (let rr = ri - 1; rr >= 0; rr--) { const above = layout[rr].find((c) => c.ci === ci); if (above) { span = above.cs; break; } }
          const w = colW.slice(ci, ci + span).reduce((s, v) => s + v, 0);
          x += `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}<w:vMerge/></w:tcPr><w:p/></w:tc>`;
          ci += span;
          continue;
        }
        const c = cells[k];
        if (c && c.ci === ci) { x += emit(c); ci += c.cs; k++; continue; }
        x += `<w:tc><w:tcPr><w:tcW w:w="${colW[ci]}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`;
        ci++;
      }
      x += '</w:tr>';
    });
    x += '</w:tbl>';
    // Word requires a paragraph between adjacent tables / at cell end
    return x + '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>';
  }

  convert(html, part) {
    const doc = new DOMParser().parseFromString('<!doctype html><html><body>' + (html || '') + '</body></html>', 'text/html');
    const ctx = { p: {}, r: {}, list: null, listUsed: false, pre: false };
    return this.blocks(doc.body, part, ctx).join('');
  }
}

function stylesXml(o) {
  const sz = Math.round(o.fontSize * 2);
  const font = esc(o.fontFamily);
  const heading = (n, size, spaceBefore) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${spaceBefore}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="en-IN" w:eastAsia="en-IN" w:bidi="hi-IN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="${Math.round(o.paraAfterPt * 20)}" w:line="${Math.round(240 * o.lineHeight)}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    heading(1, 32, 240) + heading(2, 28, 200) + heading(3, 25, 160) + heading(4, 24, 120) + heading(5, 22, 100) + heading(6, 20, 100) +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>' +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '</w:styles>';
}

function numberingXml(instances) {
  const bullets = ['•', '◦', '▪', '•', '◦', '▪', '•', '◦', '▪'];
  const fmts = ['decimal', 'lowerLetter', 'lowerRoman', 'decimal', 'lowerLetter', 'lowerRoman', 'decimal', 'lowerLetter', 'lowerRoman'];
  const lvl = (i, bullet) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${bullet ? 'bullet' : fmts[i]}"/><w:lvlText w:val="${bullet ? bullets[i] : '%' + (i + 1) + '.'}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + i * 360}" w:hanging="360"/></w:pPr>${bullet ? '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/></w:rPr>' : ''}</w:lvl>`;
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">';
  x += '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' + Array.from({ length: 9 }, (_, i) => lvl(i, true)).join('') + '</w:abstractNum>';
  x += '<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>' + Array.from({ length: 9 }, (_, i) => lvl(i, false)).join('') + '</w:abstractNum>';
  instances.forEach((abs, i) => {
    x += `<w:num w:numId="${11 + i}"><w:abstractNumId w:val="${abs}"/>${abs === 2 ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>' : ''}</w:num>`;
  });
  if (!instances.length) x += '<w:num w:numId="11"><w:abstractNumId w:val="1"/></w:num>';
  return x + '</w:numbering>';
}

/**
 * htmlToDocxBlob(html, { title, headerHtml, footerHtml, margins:{top,right,bottom,left} (mm),
 *   orientation:'portrait'|'landscape', fontFamily, fontSize (pt), lineHeight, author })
 */
export async function htmlToDocxBlob(html, opts = {}) {
  const o = Object.assign({ title: 'Document', fontFamily: 'Arial', fontSize: 11, lineHeight: 1.15, paraAfterPt: 4, orientation: 'portrait', margins: { top: 15, right: 15, bottom: 15, left: 15 }, author: 'Shiv Sonography and Diagnostic Center' }, opts);
  const landscape = o.orientation === 'landscape';
  const pgW = landscape ? 16838 : 11906;
  const pgH = landscape ? 11906 : 16838;
  const m = o.margins;
  const contentWidthTw = pgW - Math.round((m.left + m.right) * TW_PER_MM);
  const conv = new Converter(Object.assign({}, o, { contentWidthTw }));
  const docPart = new Part(conv, 'document');
  const body = conv.convert(html, docPart);
  let headerXml = null;
  let footerXml = null;
  const hdrPart = new Part(conv, 'header1');
  const ftrPart = new Part(conv, 'footer1');
  if (o.headerHtml) headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}>${conv.convert(o.headerHtml, hdrPart) || '<w:p/>'}</w:hdr>`;
  if (o.footerHtml) footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}>${conv.convert(o.footerHtml, ftrPart) || '<w:p/>'}</w:ftr>`;
  const baseRels = [
    { id: 'rId1', type: 'styles', target: 'styles.xml' },
    { id: 'rId2', type: 'numbering', target: 'numbering.xml' },
    { id: 'rId3', type: 'settings', target: 'settings.xml' }
  ];
  if (headerXml) baseRels.push({ id: 'rId4', type: 'header', target: 'header1.xml' });
  if (footerXml) baseRels.push({ id: 'rId5', type: 'footer', target: 'footer1.xml' });
  const sect = '<w:sectPr>' + (headerXml ? '<w:headerReference w:type="default" r:id="rId4"/>' : '') + (footerXml ? '<w:footerReference w:type="default" r:id="rId5"/>' : '') +
    `<w:pgSz w:w="${pgW}" w:h="${pgH}"${landscape ? ' w:orient="landscape"' : ''}/>` +
    `<w:pgMar w:top="${Math.round(m.top * TW_PER_MM)}" w:right="${Math.round(m.right * TW_PER_MM)}" w:bottom="${Math.round(m.bottom * TW_PER_MM)}" w:left="${Math.round(m.left * TW_PER_MM)}" w:header="340" w:footer="340" w:gutter="0"/></w:sectPr>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;

  const zip = new JSZip();
  const exts = new Set(conv.media.map((x) => x.name.split('.').pop()));
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    Array.from(exts).map((e) => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('') +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    (headerXml ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : '') +
    (footerXml ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : '') +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', docPart.relsXml(baseRels));
  zip.file('word/styles.xml', stylesXml(o));
  zip.file('word/numbering.xml', numberingXml(conv.numInstances));
  zip.file('word/settings.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>');
  if (headerXml) { zip.file('word/header1.xml', headerXml); if (hdrPart.rels.length) zip.file('word/_rels/header1.xml.rels', hdrPart.relsXml([])); }
  if (footerXml) { zip.file('word/footer1.xml', footerXml); if (ftrPart.rels.length) zip.file('word/_rels/footer1.xml.rels', ftrPart.relsXml([])); }
  conv.media.forEach((md) => zip.file('word/media/' + md.name, md.bytes));
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(o.title)}</dc:title><dc:creator>${esc(o.author)}</dc:creator><cp:lastModifiedBy>${esc(o.author)}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  zip.file('docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>SSDC Clinic Suite</Application></Properties>');
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}
