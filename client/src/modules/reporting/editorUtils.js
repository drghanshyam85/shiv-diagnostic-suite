/* global Highlight */
// Rich-text helpers for the report canvas (a single contenteditable): selection & range memory,
// insertion that keeps the browser's Ctrl+Z history, trigger-token and [__] placeholder search,
// pt font sizes, case changes, line / paragraph spacing, borders, clinical tables, find & replace
// and spell-check ranges for the CSS Custom Highlight API.
import { escapeHtml } from '../../core/utils';

export const exec = (cmd, val = null) => { try { return document.execCommand(cmd, false, val); } catch (e) { return false; } };
export const query = (cmd) => { try { return document.queryCommandState(cmd); } catch (e) { return false; } };
export const queryValue = (cmd) => { try { return document.queryCommandValue(cmd); } catch (e) { return ''; } };

export function rangeIn(root) {
  const sel = window.getSelection();
  if (!root || !sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  return root.contains(r.commonAncestorContainer) ? r : null;
}

export function restoreRange(root, range) {
  if (!root) return;
  root.focus({ preventScroll: true });
  const sel = window.getSelection();
  sel.removeAllRanges();
  if (range && root.contains(range.startContainer) && root.contains(range.endContainer)) sel.addRange(range);
  else { const r = document.createRange(); r.selectNodeContents(root); r.collapse(false); sel.addRange(r); }
}

const fire = (root) => root.dispatchEvent(new Event('input', { bubbles: true }));

/** Insert HTML at the (remembered) cursor; undoable. */
export function insertHtml(root, html, range) {
  restoreRange(root, range);
  if (!exec('insertHTML', html)) {
    const sel = window.getSelection();
    const r = sel.getRangeAt(0);
    r.deleteContents();
    const frag = r.createContextualFragment(html);
    const last = frag.lastChild;
    r.insertNode(frag);
    if (last) { r.setStartAfter(last); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
    fire(root);
  }
}

export function insertText(root, text, range) {
  restoreRange(root, range);
  if (!exec('insertText', text)) insertHtml(root, escapeHtml(text), range);
}

/** Replace the whole working page. Set directly (execCommand would carry the first block's heading
 *  style into every inserted paragraph); callers snapshot the previous version first. */
export function replaceAll(root, html) {
  root.innerHTML = html || '<p><br></p>';
  root.focus({ preventScroll: true });
  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(root);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  const sc = root.closest('.rw-scroll');
  if (sc) sc.scrollTop = 0;
  fire(root);
}

/** The shortcut token just typed before a collapsed caret, e.g. ".abd", ";norm", "/tirads3", "usg_kub". */
export function tokenBeforeCaret(root) {
  const r = rangeIn(root);
  if (!r || !r.collapsed) return null;
  let node = r.startContainer;
  let offset = r.startOffset;
  if (node.nodeType !== 3) {
    const prev = node.childNodes[offset - 1];
    if (!prev || prev.nodeType !== 3) return null;
    node = prev;
    offset = prev.data.length;
  }
  const before = node.data.slice(0, offset);
  const m = before.match(/(?:^|[\s (>"'])([.;/]?[A-Za-z0-9_][A-Za-z0-9_\-]*)$/);
  if (!m) return null;
  return { node, start: offset - m[1].length, end: offset, token: m[1] };
}

export function selectTextRange(node, start, end) {
  const r = document.createRange();
  r.setStart(node, start);
  r.setEnd(node, end);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  return r;
}

/** Text immediately before the caret inside the current text node (for autocorrect). */
export function textBeforeCaret(root) {
  const r = rangeIn(root);
  if (!r || !r.collapsed || r.startContainer.nodeType !== 3) return null;
  return { node: r.startContainer, offset: r.startOffset, text: r.startContainer.data.slice(0, r.startOffset) };
}

// ---------------------------------------------------------------- placeholders [__]
export const PH_RE = /\[(?:__+|X|x)\]/g;
export function placeholderRanges(root) {
  const out = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    PH_RE.lastIndex = 0;
    let m;
    while ((m = PH_RE.exec(n.data))) { const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); out.push(r); }
  }
  return out;
}
/** Select the next (or previous) [__] after the caret; wraps around. Returns true when one was found. */
export function jumpPlaceholder(root, back = false) {
  const all = placeholderRanges(root);
  if (!all.length) return false;
  const cur = rangeIn(root);
  let target = null;
  if (cur) {
    const c = cur.cloneRange();
    c.collapse(back);
    if (!back) target = all.find((r) => c.comparePoint(r.startContainer, r.startOffset) >= 0);
    else target = all.slice().reverse().find((r) => c.comparePoint(r.endContainer, r.endOffset) <= 0 && !(cur.startContainer === r.startContainer && cur.startOffset === r.startOffset));
  }
  target = target || (back ? all[all.length - 1] : all[0]);
  root.focus({ preventScroll: true });
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(target);
  const rect = target.getBoundingClientRect();
  const sc = root.closest('.rw-scroll');
  if (sc && rect) { const box = sc.getBoundingClientRect(); if (rect.top < box.top + 40 || rect.bottom > box.bottom - 40) sc.scrollTop += rect.top - box.top - box.height / 3; }
  return true;
}

// ---------------------------------------------------------------- fonts
export function setFontSizePt(root, pt, range) {
  restoreRange(root, range);
  exec('styleWithCSS', false);
  exec('fontSize', '7');
  root.querySelectorAll('font[size="7"]').forEach((f) => {
    const s = document.createElement('span');
    s.style.fontSize = pt + 'pt';
    while (f.firstChild) s.appendChild(f.firstChild);
    f.replaceWith(s);
  });
  root.querySelectorAll('span[style*="xxx-large"]').forEach((s) => { s.style.fontSize = pt + 'pt'; });
  fire(root);
}
export function currentFontPt(root) {
  const r = rangeIn(root);
  const el = r ? (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement) : root;
  const px = parseFloat(getComputedStyle(el || root).fontSize) || 14.67;
  return Math.round((px * 72) / 96 * 2) / 2;
}
export function setFontFamily(root, family, range) { restoreRange(root, range); exec('styleWithCSS', true); exec('fontName', family); exec('styleWithCSS', false); fire(root); }
export function setColor(root, kind, color, range) {
  restoreRange(root, range);
  exec('styleWithCSS', true);
  if (kind === 'fore') exec('foreColor', color);
  else if (!exec('hiliteColor', color)) exec('backColor', color);
  exec('styleWithCSS', false);
  fire(root);
}

// ---------------------------------------------------------------- case changes (formatting preserved)
const CASE = {
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  title: (s) => s.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (m, a, b) => a + b.toUpperCase()),
  sentence: (s) => s.toLowerCase().replace(/(^\s*[a-z]|[.!?:]\s+[a-z])/g, (m) => m.toUpperCase()),
  toggle: (s) => s.replace(/[a-zA-Z]/g, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))
};
export function changeCase(root, mode) {
  const r = rangeIn(root);
  if (!r || r.collapsed) return false;
  const f = CASE[mode] || CASE.upper;
  const w = document.createTreeWalker(r.commonAncestorContainer.nodeType === 3 ? r.commonAncestorContainer.parentNode : r.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = w.nextNode())) if (r.intersectsNode(n)) nodes.push(n);
  nodes.forEach((t) => {
    const a = t === r.startContainer ? r.startOffset : 0;
    const b = t === r.endContainer ? r.endOffset : t.data.length;
    t.data = t.data.slice(0, a) + f(t.data.slice(a, b)) + t.data.slice(b);
  });
  fire(root);
  return true;
}

// ---------------------------------------------------------------- block-level formatting
const BLOCK_RE = /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE|TD|TH)$/;
export function selectedBlocks(root) {
  const r = rangeIn(root);
  if (!r) return [];
  const blockOf = (node) => { let x = node.nodeType === 1 ? node : node.parentElement; while (x && x !== root && !BLOCK_RE.test(x.tagName)) x = x.parentElement; return x && x !== root ? x : null; };
  const set = new Set();
  const a = blockOf(r.startContainer);
  if (a) set.add(a);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, { acceptNode: (el) => (BLOCK_RE.test(el.tagName) && !/^(TD|TH)$/.test(el.tagName) && r.intersectsNode(el) ? 1 : 3) });
  let el;
  while ((el = w.nextNode())) if (!el.querySelector('p,div,h1,h2,h3,h4,li')) set.add(el);
  const b = blockOf(r.endContainer);
  if (b) set.add(b);
  if (!set.size) { exec('formatBlock', 'p'); const c = blockOf(rangeIn(root) ? rangeIn(root).startContainer : root); if (c) set.add(c); }
  return Array.from(set);
}
export function styleBlocks(root, style, range) {
  if (range) restoreRange(root, range);
  const blocks = selectedBlocks(root);
  blocks.forEach((b) => Object.assign(b.style, style));
  fire(root);
  return blocks.length;
}
export function toggleBorder(root, range) {
  if (range) restoreRange(root, range);
  const blocks = selectedBlocks(root);
  const on = !(blocks[0] && blocks[0].style.border);
  blocks.forEach((b) => { b.style.border = on ? '1px solid #475569' : ''; b.style.padding = on ? '4px 8px' : ''; });
  fire(root);
}

// ---------------------------------------------------------------- tables
export function tableHtml(rows, cols, { header = true, labels } = {}) {
  let h = '<table style="width:100%;border-collapse:collapse">';
  for (let r = 0; r < rows; r++) {
    h += '<tr>';
    for (let c = 0; c < cols; c++) {
      const tag = header && r === 0 ? 'th' : 'td';
      const txt = labels && labels[r] && labels[r][c] !== undefined ? escapeHtml(labels[r][c]) : header && r === 0 ? 'Header ' + (c + 1) : '<br>';
      h += `<${tag}>${txt}</${tag}>`;
    }
    h += '</tr>';
  }
  return h + '</table><p><br></p>';
}

export const CLINICAL_TABLES = {
  kidneys: { label: 'Kidney measurements', rows: [['Kidney', 'Length (cm)', 'Parenchyma (mm)', 'CMD', 'Calculus / HDN'], ['Right', '[__]', '[__]', 'Maintained', 'Nil'], ['Left', '[__]', '[__]', 'Maintained', 'Nil']] },
  biometry: { label: 'Foetal biometry', rows: [['Parameter', 'Measurement', 'Corresponding GA'], ['BPD', '[__] mm', '[__] w [__] d'], ['HC', '[__] mm', '[__] w [__] d'], ['AC', '[__] mm', '[__] w [__] d'], ['FL', '[__] mm', '[__] w [__] d'], ['EFW (Hadlock)', '[__] g', '—']] },
  obsDoppler: { label: 'Obstetric Doppler', rows: [['Vessel', 'PI', 'RI', 'S/D', 'Interpretation'], ['Umbilical artery', '[__]', '[__]', '[__]', 'Normal'], ['Middle cerebral artery', '[__]', '[__]', '—', 'Normal'], ['Uterine arteries (mean)', '[__]', '[__]', '—', 'No notch'], ['CPR (MCA PI / UA PI)', '[__]', '—', '—', '> 1.08']] },
  carotid: { label: 'Carotid Doppler', rows: [['Segment', 'Right PSV (cm/s)', 'Right EDV', 'Left PSV (cm/s)', 'Left EDV'], ['CCA', '[__]', '[__]', '[__]', '[__]'], ['ICA', '[__]', '[__]', '[__]', '[__]'], ['ECA', '[__]', '—', '[__]', '—'], ['ICA/CCA ratio', '[__]', '', '[__]', ''], ['CIMT (mm)', '[__]', '', '[__]', '']] },
  thyroid: { label: 'Thyroid nodule (ACR TI-RADS)', rows: [['Nodule', 'Size (mm)', 'Composition', 'Echogenicity', 'Shape', 'Margin', 'Foci', 'Points', 'TR'], ['1', '[__]', '[__]', '[__]', '[__]', '[__]', '[__]', '[__]', 'TR[__]']] },
  follicles: { label: 'Follicular monitoring', rows: [['Day', 'Date', 'Right ovary (mm)', 'Left ovary (mm)', 'Endometrium (mm)'], ['D[__]', '[__]', '[__]', '[__]', '[__]']] },
  venous: { label: 'Lower-limb venous Doppler', rows: [['Vein', 'Compressibility', 'Flow / phasicity', 'Thrombus'], ['CFV', 'Compressible', 'Phasic', 'Nil'], ['SFV', 'Compressible', 'Phasic', 'Nil'], ['Popliteal', 'Compressible', 'Phasic', 'Nil'], ['SFJ / SPJ reflux', '—', '[__] s', '—']] }
};
export const clinicalTableHtml = (key) => { const t = CLINICAL_TABLES[key]; return t ? tableHtml(t.rows.length, t.rows[0].length, { header: true, labels: t.rows }) : ''; };

export function cellAtCaret(root) {
  const r = rangeIn(root);
  if (!r) return null;
  const n = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
  const c = n && n.closest('td,th');
  return c && root.contains(c) ? c : null;
}
export function tableOp(root, op, value) {
  const cell = cellAtCaret(root);
  if (!cell) return false;
  const tr = cell.parentElement;
  const table = cell.closest('table');
  const idx = cell.cellIndex;
  const blankRow = (like) => { const n = document.createElement('tr'); Array.from(like.cells).forEach((c) => { const x = document.createElement('td'); x.innerHTML = '<br>'; if (c.colSpan > 1) x.colSpan = c.colSpan; n.appendChild(x); }); return n; };
  switch (op) {
    case 'rowAbove': tr.parentElement.insertBefore(blankRow(tr), tr); break;
    case 'rowBelow': tr.parentElement.insertBefore(blankRow(tr), tr.nextSibling); break;
    case 'colLeft': case 'colRight': Array.from(table.rows).forEach((row) => { const ref = row.cells[Math.min(idx, row.cells.length - 1)]; const x = document.createElement(ref && ref.tagName === 'TH' ? 'th' : 'td'); x.innerHTML = '<br>'; if (op === 'colLeft') row.insertBefore(x, ref); else row.insertBefore(x, ref ? ref.nextSibling : null); }); break;
    case 'delRow': if (table.rows.length <= 1) table.remove(); else tr.remove(); break;
    case 'delCol': Array.from(table.rows).forEach((row) => { if (row.cells[idx]) row.cells[idx].remove(); }); if (!table.rows[0] || !table.rows[0].cells.length) table.remove(); break;
    case 'delTable': table.remove(); break;
    case 'header': { const first = table.rows[0]; Array.from(first.cells).forEach((c) => { const x = document.createElement(c.tagName === 'TH' ? 'td' : 'th'); x.innerHTML = c.innerHTML; x.colSpan = c.colSpan; c.replaceWith(x); }); break; }
    case 'shade': cell.style.background = value || ''; break;
    case 'mergeRight': { const nx = cell.nextElementSibling; if (nx) { cell.colSpan = (cell.colSpan || 1) + (nx.colSpan || 1); if (nx.textContent.trim()) cell.innerHTML += ' ' + nx.innerHTML; nx.remove(); } break; }
    case 'borders': { const off = table.dataset.noborder !== '1'; table.dataset.noborder = off ? '1' : ''; Array.from(table.querySelectorAll('td,th')).forEach((c) => { c.style.border = off ? '0' : ''; }); break; }
    case 'fit': table.style.width = '100%'; break;
    default: return false;
  }
  fire(root);
  return true;
}
/** Tab / Shift+Tab inside a table moves between cells (adds a row at the end like MS Word). */
export function moveCell(root, back) {
  const cell = cellAtCaret(root);
  if (!cell) return false;
  const table = cell.closest('table');
  const cells = Array.from(table.querySelectorAll('td,th'));
  let i = cells.indexOf(cell) + (back ? -1 : 1);
  if (i >= cells.length) { tableOp(root, 'rowBelow'); i = cells.length; }
  const next = Array.from(table.querySelectorAll('td,th'))[Math.max(0, i)];
  if (!next) return true;
  const r = document.createRange();
  r.selectNodeContents(next);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  return true;
}

// ---------------------------------------------------------------- find & replace
function textIndex(root) {
  const nodes = [];
  let text = '';
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) { nodes.push({ n, at: text.length }); text += n.data; }
  return { nodes, text };
}
function locate(nodes, pos) {
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nodes[mid].at <= pos) lo = mid; else hi = mid - 1; }
  return nodes[lo];
}
export function findRanges(root, q, { matchCase = false, wholeWord = false, regex = false } = {}) {
  if (!q) return [];
  const { nodes, text } = textIndex(root);
  if (!nodes.length) return [];
  let re;
  try {
    const src = regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(wholeWord ? '\\b' + src + '\\b' : src, matchCase ? 'g' : 'gi');
  } catch (e) { return []; }
  const out = [];
  let m;
  while ((m = re.exec(text)) && out.length < 5000) {
    if (!m[0]) { re.lastIndex++; continue; }
    const a = locate(nodes, m.index);
    const b = locate(nodes, m.index + m[0].length - 1);
    const r = document.createRange();
    r.setStart(a.n, m.index - a.at);
    r.setEnd(b.n, m.index + m[0].length - b.at);
    out.push(r);
  }
  return out;
}
export function replaceRanges(root, ranges, replacement) {
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i];
    r.deleteContents();
    r.insertNode(document.createTextNode(replacement));
  }
  root.normalize();
  fire(root);
  return ranges.length;
}

// ---------------------------------------------------------------- highlights (CSS Custom Highlight API)
export const highlightsSupported = () => typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight !== 'undefined';
export function setHighlight(name, ranges) {
  if (!highlightsSupported()) return;
  if (!ranges || !ranges.length) CSS.highlights.delete(name);
  else CSS.highlights.set(name, new Highlight(...ranges));
}

/** Spell / ambiguity ranges for every text node (skips placeholders, code-like tokens). */
export function spellRanges(root, checkText, maxChars = 300000) {
  const spell = [];
  const ambig = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && n.parentElement.closest('[data-nospell]') ? 2 : 1) });
  let n;
  let seen = 0;
  while ((n = w.nextNode()) && seen < maxChars) {
    seen += n.data.length;
    if (!/[A-Za-z]{3}/.test(n.data)) continue;
    for (const err of checkText(n.data)) {
      const r = document.createRange();
      r.setStart(n, err.start);
      r.setEnd(n, err.end);
      (err.type === 'ambiguous' ? ambig : spell).push(r);
    }
  }
  return { spell, ambig };
}

/** The word under a screen point (for the right-click spelling menu). */
export function wordAtPoint(root, x, y) {
  let node;
  let offset;
  if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); if (!r) return null; node = r.startContainer; offset = r.startOffset; }
  else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (!p) return null; node = p.offsetNode; offset = p.offset; }
  if (!node || node.nodeType !== 3 || !root.contains(node)) return null;
  const s = node.data;
  let a = offset;
  let b = offset;
  while (a > 0 && /[A-Za-zÀ-ɏ'-]/.test(s[a - 1])) a--;
  while (b < s.length && /[A-Za-zÀ-ɏ'-]/.test(s[b])) b++;
  while (a < b && /['-]/.test(s[a])) a++;
  while (b > a && /['-]/.test(s[b - 1])) b--;
  if (b <= a) return null;
  const r = document.createRange();
  r.setStart(node, a);
  r.setEnd(node, b);
  return { word: s.slice(a, b), range: r };
}

export function stats(root) {
  const t = (root && root.innerText) || '';
  const words = (t.match(/[A-Za-z0-9ऀ-ॿ]+(?:['’.-][A-Za-z0-9]+)*/g) || []).length;
  return { words, chars: t.replace(/\s/g, '').length };
}

// ---------------------------------------------------------------- paste cleaning (MS Word / Google Docs / web)
const KEEP_STYLE = ['font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'text-align', 'color', 'background-color', 'vertical-align', 'width', 'border', 'border-collapse'];
export function cleanPastedHtml(html, sanitize) {
  const safe = sanitize(String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?o:p[^>]*>/gi, '').replace(/<\/?(?:w|m|v):[^>]*>/gi, ''));
  const doc = new DOMParser().parseFromString('<body>' + safe + '</body>', 'text/html');
  doc.body.querySelectorAll('*').forEach((el) => {
    el.removeAttribute('class');
    el.removeAttribute('id');
    el.removeAttribute('lang');
    if (el.hasAttribute('style')) {
      const kept = [];
      KEEP_STYLE.forEach((p) => { const v = el.style.getPropertyValue(p); if (v && !/windowtext|auto/.test(v)) kept.push(p + ':' + v); });
      if (kept.length) el.setAttribute('style', kept.join(';')); else el.removeAttribute('style');
    }
  });
  doc.body.querySelectorAll('span,font').forEach((el) => { if (!el.attributes.length) el.replaceWith(...el.childNodes); });
  doc.body.querySelectorAll('p,div').forEach((el) => { if (!el.textContent.trim() && !el.querySelector('img,br,table')) el.remove(); });
  return doc.body.innerHTML;
}
export const plainToHtml = (text) => String(text || '').replace(/\r/g, '').split(/\n{2,}/).map((p) => '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>').join('');
/** True when the content is a single paragraph of inline text (insert inline instead of as a new block). */
export function inlineInner(html) {
  const m = String(html || '').trim().match(/^<p(?:\s[^>]*)?>([\s\S]*)<\/p>$/i);
  if (!m || /<\/?(p|div|h\d|ul|ol|li|table|blockquote|hr)[\s>]/i.test(m[1])) return null;
  return m[1];
}
