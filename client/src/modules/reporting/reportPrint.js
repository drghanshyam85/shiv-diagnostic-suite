// Report print engine: clinic letterhead (full colour header or blank spacer for pre-printed letterhead),
// demographics table, body paginated onto exact A4 pages by measuring rendered blocks (tables split by
// rows with the header row repeated, lists split by items), running header, signature block, footer with
// "Page n of N", DRAFT watermark and 2 / 4 / 6-up image sheets. Shared by preview, print, PDF & dispatch.
import { escapeHtml as e, fmtDate, fmtDateTime, genderLabel } from '../../core/utils';
import { brandSvg } from '../../components/dept';

export const FONT_STACKS = {
  Arial: 'Arial, Helvetica, "Liberation Sans", sans-serif',
  Calibri: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif',
  Cambria: 'Cambria, Caladea, Georgia, serif',
  'Times New Roman': '"Times New Roman", Times, "Liberation Serif", serif',
  Georgia: 'Georgia, "DejaVu Serif", serif',
  Verdana: 'Verdana, "DejaVu Sans", sans-serif',
  Tahoma: 'Tahoma, Verdana, sans-serif',
  'Segoe UI': '"Segoe UI", Inter, Arial, sans-serif',
  Inter: 'Inter, Arial, sans-serif'
};
export const cssFont = (f) => FONT_STACKS[f] || `"${f}", Arial, sans-serif`;
export const MARGIN_PRESETS = {
  normal: { label: 'Normal', m: { top: 10, right: 14, bottom: 12, left: 14 } },
  narrow: { label: 'Narrow', m: { top: 7, right: 8, bottom: 8, left: 8 } },
  moderate: { label: 'Moderate', m: { top: 12, right: 18, bottom: 12, left: 18 } },
  wide: { label: 'Wide', m: { top: 16, right: 25, bottom: 16, left: 25 } }
};

/** A saved letterhead template (Settings → Print & reports → Letterhead templates). */
export const letterheadTemplate = (settings, id) => (id ? (settings.letterheads || []).find((t) => t.id === id) || null : null);

/**
 * headerMode 'template' + letterheadId → the template's header: 'image' (scanned / designed letterhead
 * with optional footer image) or 'full' with the template's HTML. A missing template falls back to the
 * built-in colour header.
 */
export function resolveTemplate(L, settings) {
  if (L.headerMode !== 'template') return L;
  const t = letterheadTemplate(settings, L.letterheadId);
  if (!t) return Object.assign({}, L, { headerMode: 'full' });
  if (t.kind === 'html') return Object.assign({}, L, { headerMode: 'full', headerHtml: t.headerHtml || '', footerText: t.footerText || L.footerText, templateName: t.name, fromTemplate: true });
  return Object.assign({}, L, { fromTemplate: true,
    headerMode: 'image', headerImage: t.headerImage || '', footerImage: t.footerImage || '', headerHeight: Number(t.headerHeight) || 35, footerHeight: Number(t.footerHeight) || 0,
    footerText: t.footerText !== undefined && t.footerText !== '' ? t.footerText : L.footerText, templateName: t.name
  });
}

/** Effective layout = clinic defaults (Settings → Report) overridden by this report's own layout. */
export function reportLayout(report, settings) {
  const r = settings.report || {};
  return resolveTemplate(Object.assign({
    headerMode: r.headerMode || 'full', showHeader: r.showHeader !== false, showFooter: r.showFooter !== false,
    margins: r.margins || MARGIN_PRESETS.normal.m, orientation: r.orientation || 'portrait', fontFamily: r.fontFamily || 'Arial',
    fontSize: r.fontSize || 11, lineHeight: r.lineHeight || 1.45, letterheadTop: r.letterheadTop || 45, letterheadBottom: r.letterheadBottom || 25,
    imagesPerPage: r.imagesPerPage || 4, watermarkDrafts: r.watermarkDrafts !== false, footerText: r.footerText || '', headerHtml: r.headerHtml || '',
    letterheadId: r.letterheadId || '', showSignature: true, showDemographics: true
  }, (report && report.layout) || {}), settings);
}

/** Image letterhead header / footer blocks (exact height in mm). */
export const imageHeaderHtml = (L) => `<div class="rp-imghead" style="height:${Number(L.headerHeight) || 35}mm;flex:0 0 auto;margin-bottom:2mm"><img src="${e(L.headerImage || '')}" alt="" style="width:100%;height:100%;object-fit:contain;object-position:center top;display:block"></div>`;
export const imageFooterHtml = (L) => (L.footerImage ? `<div class="rp-imgfoot" style="height:${Number(L.footerHeight) || 15}mm;flex:0 0 auto;margin-top:1mm"><img src="${e(L.footerImage)}" alt="" style="width:100%;height:100%;object-fit:contain;object-position:center bottom;display:block"></div>` : '');

export function letterheadHtml(settings, L, doctor) {
  if (L && L.headerHtml) return `<div class="rp-head rp-custom">${L.headerHtml}</div>`;
  const c = settings.clinic;
  const rd = doctor || c.radiologist || {};
  const logo = c.logo ? `<img src="${e(c.logo)}" alt="" style="width:100%;height:100%;object-fit:contain">` : brandSvg(64);
  return `<div class="rp-head">
    <div class="rp-logo">${logo}</div>
    <div class="rp-clinic">
      <div class="rp-name">${e(String(c.name || '').toUpperCase())}</div>
      ${c.tagline ? `<div class="rp-tag">${e(c.tagline)}</div>` : ''}
      <div class="rp-addr">${e(c.address || '')}</div>
      <div class="rp-addr">☎ ${e([c.phone, c.phone2].filter(Boolean).join(', '))}${c.email ? ' &nbsp;·&nbsp; ✉ ' + e(c.email) : ''}</div>
    </div>
    <div class="rp-doc"><b>${e(rd.name || '')}</b><br>${e(rd.qualification || '')}<br>${e(rd.designation || '')}${rd.rmc ? '<br>RMC Reg. No. ' + e(rd.rmc) : ''}</div>
  </div>
  <div class="rp-strip"><span>PC-PNDT Reg. No.: ${e(c.pcpndtRegNo || '')}</span><span>${e(c.workingHours || '')}</span></div>`;
}

export function demographicsHtml(d) {
  const row = (k1, v1, k2, v2) => `<tr><td class="k">${k1}</td><td class="v">${v1}</td><td class="k">${k2}</td><td class="v">${v2}</td></tr>`;
  return `<table class="rp-demog"><colgroup><col style="width:19%"><col style="width:36%"><col style="width:15%"><col style="width:30%"></colgroup>
    ${row('Patient Name', '<b>' + e(d.name || '') + '</b>', 'Age / Sex', e([d.age, genderLabel(d.sex)].filter(Boolean).join(' / ')))}
    ${row('Patient ID / UHID', e(d.patientId || ''), 'Date', e(d.date ? fmtDate(d.date) : ''))}
    ${row('Referred By', e(d.refBy || ''), 'Examination', e(d.modality || ''))}
    ${d.indication ? `<tr><td class="k">Clinical Indication</td><td class="v" colspan="3">${e(d.indication)}</td></tr>` : ''}
  </table>`;
}

const continuation = (d, n, N) => `<div class="rp-cont"><span><b>${e(d.name || '')}</b>${d.patientId ? ' · ' + e(d.patientId) : ''}${d.date ? ' · ' + e(fmtDate(d.date)) : ''}</span><span>Page ${n} of ${N} (continued)</span></div>`;

export function signatureHtml(report, settings, signer) {
  const signed = report.status === 'SIGNED_FINAL';
  const rd = settings.clinic.radiologist || {};
  const name = (signed && report.signedByName) || (signer && signer.name) || rd.name || '';
  const qual = (signer && signer.qualification) || rd.qualification || '';
  const desig = (signer && signer.designation) || rd.designation || '';
  const reg = (signer && signer.registrationNumber) || (rd.rmc ? 'RMC Reg. No. ' + rd.rmc : '');
  const img = signed && signer && signer.digitalSignatureUrl ? `<img src="${e(signer.digitalSignatureUrl)}" alt="" class="rp-sigimg">` : '<div class="rp-sigspace"></div>';
  return `<div class="rp-sign">
    <div class="rp-signl">${signed ? `Electronically signed on ${e(fmtDateTime(report.signedAt))}${report.version > 1 ? ' · version ' + report.version : ''}` : '<b>DRAFT</b> — not valid until signed by the reporting doctor'}<br><span class="rp-mute">Report ID: ${e(report.id || '')}</span></div>
    <div class="rp-signr">${img}<div class="rp-signname">${e(name)}</div><div class="rp-signsub">${e([qual, desig].filter(Boolean).join(' · '))}${reg ? '<br>' + e(reg) : ''}</div></div>
  </div>`;
}

function footerHtml(L, n, N, settings) {
  if (L.showFooter === false && L.headerMode !== 'letterhead') return `<div class="rp-foot rp-foot-min"><span></span><span>Page ${n} of ${N}</span></div>`;
  if (L.headerMode === 'letterhead') return `<div class="rp-foot rp-foot-min"><span></span><span>Page ${n} of ${N}</span></div><div style="height:${Number(L.letterheadBottom) || 0}mm;flex:0 0 auto"></div>`;
  if (L.headerMode === 'image') return `<div class="rp-foot${L.footerImage ? ' rp-foot-min' : ''}"><span>${L.footerImage ? '' : e(L.footerText || '')}</span><span>Page ${n} of ${N}</span></div>${imageFooterHtml(L)}`;
  return `<div class="rp-foot"><span>${e(L.footerText || '')}</span><span>${e(settings.clinic.phone ? '☎ ' + settings.clinic.phone : '')} · Page ${n} of ${N}</span></div>`;
}

function headerFor(L, settings, doctor) {
  if (L.showHeader === false || L.headerMode === 'none') return '';
  if (L.headerMode === 'letterhead') return `<div style="height:${Number(L.letterheadTop) || 0}mm;flex:0 0 auto"></div>`;
  if (L.headerMode === 'image') return L.headerImage ? imageHeaderHtml(L) : letterheadHtml(settings, Object.assign({}, L, { headerHtml: '' }), doctor);
  return letterheadHtml(settings, L, doctor);
}

const pcpndtNeeded = (report) => report.obstetric && !/neither detected nor disclosed/i.test(report.html || '');

// ---------------------------------------------------------------- measuring & pagination
const INLINE = /^(#text|B|STRONG|I|EM|U|S|SPAN|A|BR|IMG|SUB|SUP|FONT|MARK|SMALL|BIG|CODE|LABEL|ABBR)$/;

/** Wrap stray inline runs into <div>s and unwrap plain container <div>s so every child is a block. */
function normalizeBlocks(root) {
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 4) {
    changed = false;
    Array.from(root.childNodes).forEach((n) => {
      if (n.nodeType === 1 && (n.tagName === 'DIV' || n.tagName === 'SECTION' || n.tagName === 'ARTICLE') && !n.className && !n.getAttribute('style') && Array.from(n.childNodes).some((c) => c.nodeType === 1 && !INLINE.test(c.tagName))) {
        while (n.firstChild) root.insertBefore(n.firstChild, n);
        n.remove();
        changed = true;
      }
    });
  }
  let run = null;
  Array.from(root.childNodes).forEach((n) => {
    const inline = n.nodeType === 3 ? !!n.data.trim() || (run && true) : n.nodeType === 1 && INLINE.test(n.tagName);
    if (n.nodeType === 8) { n.remove(); return; }
    if (inline && !(n.nodeType === 3 && !n.data.trim() && !run)) {
      if (!run) { run = document.createElement('div'); root.insertBefore(run, n); }
      run.appendChild(n);
    } else {
      if (n.nodeType === 3) n.remove();
      run = null;
    }
  });
}

function marginsOf(el) { const cs = getComputedStyle(el); return { mt: parseFloat(cs.marginTop) || 0, mb: parseFloat(cs.marginBottom) || 0 }; }

function measureBlocks(root) {
  const kids = Array.from(root.children);
  return kids.map((el, i) => {
    const next = kids[i + 1];
    const { mb } = marginsOf(el);
    const h = el.offsetHeight;
    const adv = next ? next.offsetTop - el.offsetTop : h + mb;
    const blk = { el, html: el.outerHTML, h, adv: Math.max(adv, h), mb, keepNext: /^H[1-4]$/.test(el.tagName) || el.classList.contains('rp-keep') };
    if (el.classList.contains('page-break')) blk.pageBreak = true;
    if (el.tagName === 'TABLE' && el.rows.length > 1) blk.split = tableSplitter(el, mb);
    else if ((el.tagName === 'UL' || el.tagName === 'OL') && el.children.length > 1) blk.split = listSplitter(el, mb);
    return blk;
  });
}

function tableSplitter(table, mb) {
  const rows = Array.from(table.rows);
  const hs = rows.map((r) => r.getBoundingClientRect().height);
  const sum = hs.reduce((a, b) => a + b, 0);
  const overhead = Math.max(0, table.offsetHeight - sum);
  const head = rows[0] && (rows[0].parentElement.tagName === 'THEAD' || Array.from(rows[0].cells).every((c) => c.tagName === 'TH')) ? 0 : -1;
  const open = table.cloneNode(false).outerHTML.replace(/<\/table>$/i, '');
  const make = (from) => (room) => {
    const idx = [];
    let used = overhead + (from > 0 && head === 0 ? hs[0] : 0);
    for (let i = from; i < rows.length; i++) {
      if (used + hs[i] > room && idx.length) break;
      idx.push(i);
      used += hs[i];
    }
    if (idx.length === rows.length - from || !idx.length) return null;
    const pre = from > 0 && head === 0 ? rows[0].outerHTML : '';
    const first = { html: open + '<tbody>' + pre + idx.map((i) => rows[i].outerHTML).join('') + '</tbody></table>', h: used, adv: used };
    const restFrom = idx[idx.length - 1] + 1;
    const restH = overhead + (head === 0 ? hs[0] : 0) + hs.slice(restFrom).reduce((a, b) => a + b, 0);
    const rest = { html: open + '<tbody>' + (head === 0 ? rows[0].outerHTML : '') + rows.slice(restFrom).map((r) => r.outerHTML).join('') + '</tbody></table>', h: restH, adv: restH + mb, split: make(restFrom) };
    return [first, rest];
  };
  return make(0);
}

function listSplitter(list, mb) {
  const items = Array.from(list.children);
  const hs = items.map((li) => li.getBoundingClientRect().height);
  const overhead = Math.max(0, list.offsetHeight - hs.reduce((a, b) => a + b, 0));
  const start = Number(list.getAttribute('start') || 1);
  const isOl = list.tagName === 'OL';
  const tag = list.tagName.toLowerCase();
  const attrs = Array.from(list.attributes).filter((a) => a.name !== 'start').map((a) => ` ${a.name}="${e(a.value)}"`).join('');
  const make = (from) => (room) => {
    let used = overhead;
    let n = 0;
    for (let i = from; i < items.length; i++) { if (used + hs[i] > room && n) break; used += hs[i]; n++; }
    if (!n || from + n >= items.length) return null;
    const html = (a, b) => `<${tag}${attrs}${isOl ? ` start="${start + a}"` : ''}>` + items.slice(a, b).map((x) => x.outerHTML).join('') + `</${tag}>`;
    const restH = overhead + hs.slice(from + n).reduce((x, y) => x + y, 0);
    return [{ html: html(from, from + n), h: used, adv: used }, { html: html(from + n, items.length), h: restH, adv: restH + mb, split: make(from + n) }];
  };
  return make(0);
}

/** Greedy packing; oversized splittable blocks are cut to fill the remaining room of the current page. */
function paginate(blocks, cap1, capN) {
  const pages = [[]];
  let cap = cap1;
  let used = 0;
  const q = blocks.slice();
  const MIN_ROOM = 40;
  while (q.length) {
    const b = q.shift();
    if (b.pageBreak) { if (pages[pages.length - 1].length) { pages.push([]); cap = capN; used = 0; } continue; }
    const room = cap - used;
    // keep a heading with (the start of) the block that follows it
    if (b.keepNext && used > 0 && q.length && !q[0].pageBreak && b.adv + Math.min(q[0].h, 48) > room) { pages.push([]); cap = capN; used = 0; q.unshift(b); continue; }
    if (b.h <= room) { pages[pages.length - 1].push(b.html); used += b.adv; continue; }
    if (b.split && room >= MIN_ROOM) {
      const parts = b.split(room);
      if (parts) { q.unshift(...parts); continue; }
    }
    if (used === 0) { pages[pages.length - 1].push(b.html); used += b.adv; continue; } // taller than a page: let it clip rather than loop
    pages.push([]);
    cap = capN;
    used = 0;
    q.unshift(b);
  }
  return pages;
}

/**
 * renderReportPages(report, settings, { signer, imageUrls }) → { html, pageCount }
 * Must run in the browser (measures real layout). Pages are .print-page elements of the exact paper size.
 */
export function renderReportPages(report, settings, opts = {}) {
  const L = reportLayout(report, settings);
  const land = L.orientation === 'landscape';
  const W = land ? 297 : 210;
  const H = land ? 210 : 297;
  const m = L.margins;
  const font = `font-family:${cssFont(L.fontFamily)};font-size:${L.fontSize}pt;line-height:${L.lineHeight}`;
  const d = report.demographics || {};
  const signed = report.status === 'SIGNED_FINAL';
  const wm = !signed && L.watermarkDrafts && !opts.noWatermark ? `<div class="rp-wm"><span>${e(opts.watermarkText || 'DRAFT')}</span></div>` : '';
  const head = headerFor(L, settings, opts.headerDoctor);
  const sig = opts.endHtml !== undefined ? opts.endHtml : (pcpndtNeeded(report) ? `<p class="rp-pcpndt">${e(settings.report.pcpndtDeclaration || '')}</p>` : '') + (L.showSignature !== false ? signatureHtml(report, settings, opts.signer) : '');
  const demogBlock = opts.demogHtml || demographicsHtml(d);
  const shell = (inner, n, N, first) => `<div class="print-page rp-page" style="width:${W}mm;height:${H}mm;padding:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;${font}">
    <div class="rp-inner">${head}${first && L.showDemographics !== false ? demogBlock : opts.bare ? '' : continuation(d, n, N)}<div class="rp-body report-content">${inner}</div>${footerHtml(L, n, N, settings)}${wm}</div></div>`;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-30000px;top:0;visibility:hidden;pointer-events:none;';
  document.body.appendChild(host);
  let bodyPages;
  try {
    host.innerHTML = shell('', 1, 1, true) + shell('', 2, 2, false) +
      `<div class="print-page" style="width:${W}mm;${font}"><div class="report-content rp-measure" style="position:relative;width:${W - m.left - m.right}mm">${report.html || ''}<div class="rp-endblock">${sig}</div></div></div>`;
    const bodies = host.querySelectorAll('.rp-body');
    const cap1 = bodies[0].clientHeight;
    const capN = bodies[1].clientHeight;
    const meas = host.querySelector('.rp-measure');
    const endBlock = meas.querySelector('.rp-endblock');
    endBlock.remove();
    normalizeBlocks(meas);
    meas.appendChild(endBlock);
    bodyPages = paginate(measureBlocks(meas), cap1, capN);
  } finally { host.remove(); }

  const imgs = (report.images || []).filter((im) => opts.imageUrls && opts.imageUrls[im.id]);
  const per = [2, 4, 6].includes(Number(L.imagesPerPage)) ? Number(L.imagesPerPage) : 4;
  const imgPages = [];
  if (opts.includeImages !== false) for (let i = 0; i < imgs.length; i += per) imgPages.push(imgs.slice(i, i + per));
  const N = bodyPages.length + imgPages.length;
  const out = bodyPages.map((blocks, i) => shell(blocks.join(''), i + 1, N, i === 0));
  imgPages.forEach((chunk, j) => {
    const n = bodyPages.length + j + 1;
    const grid = `<div class="rp-imgs rp-imgs-${per}">${chunk.map((im) => `<figure><div class="rp-imgbox"><img src="${e(opts.imageUrls[im.id])}" alt=""></div><figcaption>${e(im.caption || '')}</figcaption></figure>`).join('')}</div>`;
    out.push(`<div class="print-page rp-page" style="width:${W}mm;height:${H}mm;padding:${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;${font}">
      <div class="rp-inner">${head}${continuation(d, n, N).replace('(continued)', '· Images')}<div class="rp-body">${grid}</div>${footerHtml(L, n, N, settings)}${wm}</div></div>`);
  });
  return { html: out.join(''), pageCount: N, widthMm: W, heightMm: H };
}

/** Body + demographics as one flowing document (for DOCX / DOC / HTML / e-mail exports). */
export function reportDocumentHtml(report, settings, { signer, includeHeader = false } = {}) {
  const L = reportLayout(report, settings);
  const d = report.demographics || {};
  const demog = `<table style="width:100%;border-collapse:collapse;margin-bottom:8pt"><tr><td style="background:#f1f5f9;width:22%"><b>Patient Name</b></td><td><b>${e(d.name || '')}</b></td><td style="background:#f1f5f9;width:16%"><b>Age / Sex</b></td><td>${e([d.age, genderLabel(d.sex)].filter(Boolean).join(' / '))}</td></tr>
    <tr><td style="background:#f1f5f9"><b>Patient ID / UHID</b></td><td>${e(d.patientId || '')}</td><td style="background:#f1f5f9"><b>Date</b></td><td>${e(d.date ? fmtDate(d.date) : '')}</td></tr>
    <tr><td style="background:#f1f5f9"><b>Referred By</b></td><td>${e(d.refBy || '')}</td><td style="background:#f1f5f9"><b>Examination</b></td><td>${e(d.modality || '')}</td></tr>
    ${d.indication ? `<tr><td style="background:#f1f5f9"><b>Clinical Indication</b></td><td colspan="3">${e(d.indication)}</td></tr>` : ''}</table>`;
  const rd = settings.clinic.radiologist || {};
  const sig = `<p style="text-align:right;margin-top:24pt"><b>${e((report.status === 'SIGNED_FINAL' && report.signedByName) || (signer && signer.name) || rd.name || '')}</b><br>${e(rd.qualification || '')} · ${e(rd.designation || '')}${rd.rmc ? '<br>RMC Reg. No. ' + e(rd.rmc) : ''}${report.status === 'SIGNED_FINAL' ? '<br><span style="font-size:9pt">Electronically signed on ' + e(fmtDateTime(report.signedAt)) + '</span>' : ''}</p>`;
  const pc = pcpndtNeeded(report) ? `<p style="font-size:9.5pt"><em>${e(settings.report.pcpndtDeclaration || '')}</em></p>` : '';
  const c = settings.clinic;
  const headerHtml = `<p style="text-align:center;margin:0"><b style="font-size:15pt;color:#0c4a6e">${e(String(c.name || '').toUpperCase())}</b><br><span style="font-size:8.5pt">${e(c.address || '')} · ☎ ${e([c.phone, c.phone2].filter(Boolean).join(', '))}</span><br><span style="font-size:8pt">PC-PNDT Reg. No.: ${e(c.pcpndtRegNo || '')}</span></p>`;
  const body = (includeHeader ? headerHtml + '<hr>' : '') + demog + (report.html || '') + pc + sig;
  return { body, headerHtml, footerHtml: `<p style="font-size:8pt;color:#475569">${e(L.footerText || '')}</p>`, layout: L };
}
