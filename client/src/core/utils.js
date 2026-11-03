// General-purpose helpers: ids, dates (IST-friendly DD/MM/YYYY), Indian currency, CSV, files, text.

export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const pad = (n, w = 2) => String(n).padStart(w, '0');
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- dates
export function dateKey(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
}
export const monthKey = (d = new Date()) => dateKey(d).slice(0, 7);
export const parseKey = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const daysBetween = (a, b) => Math.round((parseKey(dateKey(b)) - parseKey(dateKey(a))) / 86400000);
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export function fmtDate(v) {
  if (v === undefined || v === null || v === '') return '';
  const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? parseKey(v) : new Date(v);
  if (isNaN(d)) return '';
  return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
}
export function fmtTime(v) {
  const d = new Date(v);
  if (isNaN(d)) return '';
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return pad(h) + ':' + pad(d.getMinutes()) + ' ' + ap;
}
export const fmtDateTime = (v) => (v ? fmtDate(v) + ' ' + fmtTime(v) : '');
export function toLocalInput(ts) {
  const d = new Date(ts || Date.now());
  return dateKey(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
export const fromLocalInput = (s) => (s ? new Date(s).getTime() : Date.now());
export function monthLabel(mk) {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}
export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return fmtDate(ts);
}

// ---------------------------------------------------------------- money
export function inr(n, opts = {}) {
  const v = Number(n) || 0;
  const d = opts.decimals === undefined ? (Number.isInteger(v) ? 0 : 2) : opts.decimals;
  const s = Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  return (v < 0 ? '-' : '') + (opts.symbol === false ? '' : '₹') + s;
}
export const inr2 = (n) => inr(n, { decimals: 2 });

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function two(n) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''); }
function three(n) { const h = Math.floor(n / 100); const r = n % 100; return (h ? ONES[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? two(r) : ''); }
/** Indian numbering system: Crore, Lakh, Thousand */
export function amountInWords(amount) {
  const v = Math.round((Number(amount) || 0) * 100) / 100;
  let rupees = Math.floor(Math.abs(v));
  const paise = Math.round((Math.abs(v) - rupees) * 100);
  if (rupees === 0 && paise === 0) return 'Rupees Zero Only';
  const parts = [];
  const crore = Math.floor(rupees / 10000000); rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000); rupees %= 100000;
  const thousand = Math.floor(rupees / 1000); rupees %= 1000;
  if (crore) parts.push(three(crore) + ' Crore');
  if (lakh) parts.push(two(lakh) + ' Lakh');
  if (thousand) parts.push(two(thousand) + ' Thousand');
  if (rupees) parts.push(three(rupees));
  let s = 'Rupees ' + (parts.join(' ') || 'Zero');
  if (paise) s += ' and ' + two(paise) + ' Paise';
  return (v < 0 ? 'Minus ' : '') + s + ' Only';
}

// ---------------------------------------------------------------- people
export const TITLES = ['Mrs.', 'Mr.', 'Ms.', 'Master', 'Baby', 'Smt.', 'Dr.'];
export const TITLE_GENDER = { 'Mrs.': 'Female', 'Ms.': 'Female', 'Smt.': 'Female', 'Baby': 'Female', 'Mr.': 'Male', 'Master': 'Male' };
export const RELATIONS = ['W/O', 'S/O', 'D/O', 'C/O'];
/** Gender as the full word everywhere (Male / Female / Other) — single letters are no longer shown. */
export const genderLabel = (g) => {
  const s = String(g || '').trim();
  const u = s.toUpperCase();
  return u === 'F' || u === 'FEMALE' ? 'Female' : u === 'M' || u === 'MALE' ? 'Male' : u === 'O' || u === 'OTHER' || u === 'T' ? 'Other' : s;
};
export const genderShort = genderLabel; // kept for older callers: now returns the full word
// months read "Mo" so an age never looks like the old "M" for male
export const ageShort = (age, unit) => (age === '' || age === undefined || age === null ? '' : age + ' ' + ({ Years: 'Y', Months: 'Mo', Days: 'D' }[unit] || 'Y'));
export const ageSex = (p) => [ageShort(p.age, p.ageUnit), genderShort(p.gender)].filter(Boolean).join(' / ');
export const fullName = (p) => (p ? [p.title, p.name].filter(Boolean).join(' ') : '');
export const guardianLine = (p) => (p && p.guardianName ? (p.relation || 'C/O') + ' ' + p.guardianName : '');
export const validMobile = (m) => /^[6-9]\d{9}$/.test(String(m || ''));
export const digits = (s) => String(s || '').replace(/\D/g, '');
export function formatAadhaar(a) { const d = digits(a).slice(0, 12); return d.replace(/(\d{4})(?=\d)/g, '$1-'); }
export function maskAadhaar(a) { const d = digits(a); return d.length >= 4 ? 'XXXX-XXXX-' + d.slice(-4) : ''; }
export const titleCase = (s) => String(s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

// ---------------------------------------------------------------- text / html
export function escapeHtml(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function stripHtml(html) {
  if (!html) return '';
  const withBreaks = String(html)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|table|ul|ol|blockquote)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t');
  if (typeof document !== 'undefined') {
    const d = document.createElement('div');
    d.innerHTML = withBreaks;
    return (d.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }
  return withBreaks.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}
export const textToHtml = (t) => String(t || '').split(/\n{2,}/).map((p) => '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>').join('');
export const slug = (s) => String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_').slice(0, 60);
export const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

export function levenshtein(a, b, max = 3) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[lb];
}

/** Lightweight fuzzy match score (0 = no match). Subsequence with bonuses for prefix / word starts. */
export function fuzzyScore(q, text) {
  q = String(q || '').toLowerCase();
  text = String(text || '').toLowerCase();
  if (!q) return 1;
  const idx = text.indexOf(q);
  if (idx === 0) return 100 - Math.min(40, text.length - q.length);
  if (idx > 0) return 60 - Math.min(30, idx) + (/\W/.test(text[idx - 1]) ? 15 : 0);
  let ti = 0, score = 0, streak = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    const found = text.indexOf(c, ti);
    if (found < 0) return 0;
    streak = found === ti ? streak + 1 : 0;
    score += 1 + streak;
    ti = found + 1;
  }
  return Math.max(1, Math.min(40, score));
}

// ---------------------------------------------------------------- arrays
export const sumBy = (arr, f) => arr.reduce((s, x) => s + (Number(typeof f === 'function' ? f(x) : x[f]) || 0), 0);
export function groupBy(arr, f) {
  const m = new Map();
  for (const x of arr) { const k = typeof f === 'function' ? f(x) : x[f]; if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}
export const uniq = (arr) => Array.from(new Set(arr));
export function sortBy(arr, f, dir = 1) {
  return arr.slice().sort((a, b) => { const x = f(a), y = f(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
}

// ---------------------------------------------------------------- functions
export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}
export function throttle(fn, ms) {
  let last = 0, t;
  return (...a) => {
    const now = Date.now();
    clearTimeout(t);
    if (now - last >= ms) { last = now; fn(...a); } else t = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (now - last));
  };
}

// ---------------------------------------------------------------- files
export function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  downloadBlob(filename, content instanceof Blob ? content : new Blob([content], { type: mime }));
}
export const readAsText = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });
export const readAsArrayBuffer = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(file); });
export const readAsDataURL = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
export function blobToBase64(blob) {
  return readAsDataURL(blob).then((u) => String(u).split(',')[1]);
}
export function dataUrlToBlob(url) {
  const [head, data] = String(url).split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.multiple = multiple;
    i.onchange = () => resolve(Array.from(i.files || []));
    i.click();
  });
}
export const fileExt = (name) => String(name || '').split('.').pop().toLowerCase();
export const fmtBytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

// ---------------------------------------------------------------- CSV
export function csvCell(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCSV(rows, columns) {
  const cols = columns || Object.keys(rows[0] || {}).map((k) => ({ key: k, label: k }));
  const head = cols.map((c) => csvCell(c.label || c.key)).join(',');
  const body = rows.map((r) => cols.map((c) => csvCell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','));
  return '﻿' + [head].concat(body).join('\r\n');
}
/** RFC-4180 parser; delimiter auto-detected (comma / tab / semicolon) */
export function parseCSV(text, delimiter) {
  text = String(text || '').replace(/^﻿/, '');
  if (!delimiter) {
    const first = text.split(/\r?\n/, 1)[0] || '';
    const counts = { ',': (first.match(/,/g) || []).length, '\t': (first.match(/\t/g) || []).length, ';': (first.match(/;/g) || []).length };
    delimiter = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ',';
  }
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
export function csvToObjects(text, delimiter) {
  const rows = parseCSV(text, delimiter);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => { const o = {}; head.forEach((h, i) => { o[h] = r[i] !== undefined ? r[i] : ''; }); return o; });
}

// ---------------------------------------------------------------- clipboard & misc
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    const t = document.createElement('textarea');
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  }
}
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const deviceId = (() => {
  try {
    let id = localStorage.getItem('ssdc-device-id');
    if (!id) { id = 'dev_' + Math.random().toString(36).slice(2, 10); localStorage.setItem('ssdc-device-id', id); }
    return id;
  } catch (e) { return 'dev_volatile'; }
})();
export function lsGet(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }
export function lsSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full / private mode */ } }

export function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over === undefined ? base : over;
  if (base && typeof base === 'object' && over && typeof over === 'object') {
    const out = Object.assign({}, base);
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
    return out;
  }
  return over === undefined ? base : over;
}
