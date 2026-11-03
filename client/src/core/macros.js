// Unlimited Clinical Macro & Template Engine
//  • IndexedDB persistence (no size limit per macro), metadata kept in memory for 60 fps virtual lists
//  • background Web Worker with an inverted index + sorted vocabulary for prefix search across
//    trigger / title / tags / category / modality / full text — scales to 1,00,000+ macros
//  • O(1) trigger lookup for inline expansion (Space / Enter / Tab)
import { idbIterate, idbPut, idbPutMany, idbGet, idbDeleteMany, idbCount } from './idb';
import { stripHtml, uid, sleep } from './utils';
import { queueMacro, setMacroBridge } from './sync';
import { DEFAULT_MACROS } from '../data/templates';

export const MODALITIES = ['Ultrasound (USG)', 'Color Doppler', 'Obstetric / Fetal Medicine', 'Small Parts (TI-RADS / BI-RADS)', 'Digital X-Ray', 'CT Scan', 'MRI', 'Pathology', 'Biochemistry', 'General Clinical'];
export const DEFAULT_CATEGORIES = ['Abdomen', 'KUB', 'Pelvis', 'Obstetric', 'Thyroid', 'Breast', 'Scrotal', 'Vascular', 'Musculoskeletal', 'Neuro', 'Chest', 'Spine', 'Haematology', 'Biochemistry', 'Impression', 'General'];

const WORKER_SRC = `
let N = 0;
const ids = [], trig = [], title = [], meta = [], alive = [];
const idIdx = new Map(), trigMap = new Map();
const hIndex = new Map(), cIndex = new Map();
let hVocab = null, cVocab = null, byUpdated = null, trigSorted = null, rankU = null, warmTimer = 0;
const MAXTEXT = 200000;
function tok(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\\u0900-\\u097f]+/g, ' ').split(' ').filter(Boolean); }
function addTo(index, t, i) { let a = index.get(t); if (!a) { a = []; index.set(t, a); } if (a[a.length - 1] !== i) a.push(i); }
function invalidate() { hVocab = cVocab = null; byUpdated = null; trigSorted = null; clearTimeout(warmTimer); warmTimer = setTimeout(warm, 40); }
// rebuild the sorted structures while idle so the first search after an import stays fast
function warm() {
  if (!hVocab) hVocab = Array.from(hIndex.keys()).sort();
  if (!cVocab) cVocab = Array.from(cIndex.keys()).sort();
  if (!byUpdated) {
    byUpdated = []; for (let i = 0; i < N; i++) if (alive[i]) byUpdated.push(i);
    byUpdated.sort((a, b) => meta[b].u - meta[a].u);
    rankU = new Float64Array(N); for (let k = 0; k < byUpdated.length; k++) rankU[byUpdated[k]] = byUpdated.length - k;
  }
  if (!trigSorted) { trigSorted = []; for (let i = 0; i < N; i++) if (alive[i] && trig[i]) trigSorted.push(i); trigSorted.sort((a, b) => (trig[a] < trig[b] ? -1 : trig[a] > trig[b] ? 1 : 0)); }
}
function kill(id) {
  const old = idIdx.get(id);
  if (old === undefined) return;
  alive[old] = false;
  if (trig[old] && trigMap.get(trig[old]) === old) trigMap.delete(trig[old]);
  idIdx.delete(id);
}
function add(d) {
  kill(d.id);
  if (d._deleted) return;
  const i = N++;
  ids[i] = d.id; alive[i] = true; idIdx.set(d.id, i);
  const tl = String(d.trigger || '').toLowerCase();
  trig[i] = tl; if (tl) trigMap.set(tl, i);
  title[i] = String(d.title || '').toLowerCase();
  meta[i] = { c: d.category || '', m: d.modality || '', k: d.kind || '', u: d.updatedAt || 0 };
  const hs = new Set(tok(d.trigger + ' ' + d.title + ' ' + (d.tags || '') + ' ' + d.category + ' ' + d.modality));
  for (const t of hs) addTo(hIndex, t, i);
  const cs = new Set(tok(String(d.text || '').slice(0, MAXTEXT)));
  for (const t of cs) if (!hs.has(t)) addTo(cIndex, t, i);
}
function lower(arr, p) { let lo = 0, hi = arr.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < p) lo = mid + 1; else hi = mid; } return lo; }
function pass(i, f) { return (!f.modality || meta[i].m === f.modality) && (!f.category || meta[i].c === f.category) && (!f.kind || meta[i].k === f.kind); }
function bits(x) { let c = 0; while (x) { c += x & 1; x >>= 1; } return c; }
function search(q, f, limit) {
  const t0 = performance.now();
  warm();
  const ql = String(q || '').trim().toLowerCase();
  const terms = tok(ql).slice(0, 8);
  let res = [];
  if (!terms.length && !ql) {
    const out = [];
    for (let k = 0; k < byUpdated.length && out.length < limit; k++) { const i = byUpdated[k]; if (pass(i, f)) out.push(ids[i]); }
    let total = out.length;
    if (out.length >= limit) { total = 0; for (let k = 0; k < byUpdated.length; k++) if (pass(byUpdated[k], f)) total++; }
    return { ids: out, total, ms: performance.now() - t0 };
  }
  const H = new Uint8Array(N), C = new Uint8Array(N), seen = new Uint8Array(N);
  const touched = [];
  const mark = (index, vocab, p, M, bit, exact) => {
    const hit = (a) => { for (let j = 0; j < a.length; j++) { const x = a[j]; if (!seen[x]) { seen[x] = 1; touched.push(x); } M[x] |= bit; } };
    if (exact) { const a = index.get(p); if (a) hit(a); return; }
    for (let k = lower(vocab, p); k < vocab.length && vocab[k].startsWith(p); k++) hit(index.get(vocab[k]));
  };
  terms.forEach((t, k) => {
    const bit = 1 << k;
    const exactOnly = t.length === 1 && terms.length === 1;
    mark(hIndex, hVocab, t, H, bit, false);
    mark(cIndex, cVocab, t, C, bit, exactOnly);
  });
  const full = (1 << terms.length) - 1;
  const cap = touched.length + (/^[^a-z0-9]/.test(ql) ? 4096 : 0);
  let rIdx = new Int32Array(cap), rKey = new Float64Array(cap), R = 0;
  const M1 = N + 1;
  const push = (i, sc) => {
    if (R === rIdx.length) { const ni = new Int32Array(R * 2 + 16), nk = new Float64Array(R * 2 + 16); ni.set(rIdx); nk.set(rKey); rIdx = ni; rKey = nk; }
    rIdx[R] = i; rKey[R] = sc * M1 + rankU[i]; R++;
  };
  for (let k = 0; k < touched.length; k++) {
    const i = touched[k];
    if (!alive[i] || ((H[i] | C[i]) & full) !== full || !pass(i, f)) continue;
    let sc = bits(H[i]) * 10 + bits(C[i]);
    if (trig[i] === ql) sc += 1000; else if (trig[i] && trig[i].startsWith(ql)) sc += 300;
    if (title[i].startsWith(ql)) sc += 80; else if (title[i].includes(ql)) sc += 40;
    push(i, sc);
    seen[i] = 2;
  }
  if (/^[^a-z0-9]/.test(ql)) {
    let lo = 0, hi = trigSorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (trig[trigSorted[mid]] < ql) lo = mid + 1; else hi = mid; }
    for (let k = lo; k < trigSorted.length; k++) {
      const i = trigSorted[k];
      if (!trig[i].startsWith(ql)) break;
      if (alive[i] && seen[i] !== 2 && pass(i, f)) { push(i, trig[i] === ql ? 1500 : 500); seen[i] = 2; }
    }
  }
  const total = R;
  // top-k by integer key (score, then most recently updated): quickselect when only a few are needed
  let keep = R;
  if (R > limit * 2 && limit < 20000) {
    const tmp = rKey.slice(0, R);
    const kth = select(tmp, limit - 1);
    let w = 0;
    for (let r = 0; r < R; r++) if (rKey[r] >= kth) { rIdx[w] = rIdx[r]; rKey[w] = rKey[r]; w++; }
    keep = w;
  }
  const order = new Int32Array(keep);
  for (let r = 0; r < keep; r++) order[r] = r;
  order.sort((a, b) => rKey[b] - rKey[a]);
  const n = Math.min(limit, keep);
  const out = new Array(n);
  for (let r = 0; r < n; r++) out[r] = ids[rIdx[order[r]]];
  return { ids: out, total, ms: performance.now() - t0 };
}
// k-th largest value (0-based) of a Float64Array, average O(n) — Hoare quickselect, in place
function select(a, k) {
  let lo = 0, hi = a.length - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) {
      while (a[i] > pivot) i++;
      while (a[j] < pivot) j--;
      if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
    }
    if (k <= j) hi = j; else if (k >= i) lo = i; else return a[k];
  }
  return a[k];
}
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'add') { for (const d of m.docs) add(d); invalidate(); if (m.qid) postMessage({ type: 'ack', qid: m.qid }); }
  else if (m.type === 'remove') { for (const id of m.ids) kill(id); invalidate(); if (m.qid) postMessage({ type: 'ack', qid: m.qid }); }
  else if (m.type === 'search') postMessage(Object.assign({ type: 'result', qid: m.qid }, search(m.query, m.filters || {}, m.limit || 200)));
  else if (m.type === 'stats') { warm(); let c = 0; for (let i = 0; i < N; i++) if (alive[i]) c++; postMessage({ type: 'stats', qid: m.qid, count: c, tokens: hIndex.size + cIndex.size }); }
};
`;

const toIndex = (m) => ({
  id: m.id, trigger: m.trigger || '', title: m.title || '', tags: (m.tags || []).join(' '), category: m.category || '',
  modality: m.modality || '', kind: m.kind || '', updatedAt: m.updatedAt || 0, text: m.text || stripHtml(m.content || ''), _deleted: m._deleted
});

class MacroStore {
  constructor() {
    this.meta = new Map();
    this.trig = new Map();
    this.cats = new Set(DEFAULT_CATEGORIES);
    this.version = 0;
    this.subs = new Set();
    this.ready = false;
    this.pending = new Map();
    this.qid = 0;
    this.stats = { loadMs: 0, count: 0 };
    this.listCache = null;
    this.contentCache = new Map();
  }

  _worker() {
    if (this.worker || this.noWorker) return this.worker;
    try {
      this.worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
      this.worker.onmessage = (e) => {
        const m = e.data;
        const p = this.pending.get(m.qid);
        if (p) { this.pending.delete(m.qid); p.resolve(m); }
      };
      // refused after construction (a page policy) or crashed: answer everything on the main thread
      this.worker.onerror = (e) => {
        console.warn('Macro worker stopped — macro search continues on the main thread', e && e.message);
        this.worker = null;
        this.noWorker = true;
        const waiting = Array.from(this.pending.values());
        this.pending.clear();
        waiting.forEach((p) => p.resolve(this._fallback(p.msg)));
      };
    } catch (e) {
      console.warn('Worker unavailable — macro search will run on the main thread', e);
      this.worker = null;
      this.noWorker = true;
    }
    return this.worker;
  }

  _post(msg) {
    const w = this._worker();
    if (!w) return Promise.resolve(this._fallback(msg));
    return new Promise((resolve) => {
      const qid = ++this.qid;
      this.pending.set(qid, { resolve, msg });
      w.postMessage(Object.assign({ qid }, msg));
    });
  }

  _fallback(msg) {
    if (msg.type !== 'search') return {};
    const q = String(msg.query || '').toLowerCase();
    const t0 = performance.now();
    const f = msg.filters || {};
    const ids = [];
    for (const m of this.meta.values()) {
      if (f.modality && m.modality !== f.modality) continue;
      if (f.category && m.category !== f.category) continue;
      if (!q || (m.trigger + ' ' + m.title + ' ' + (m.tags || []).join(' ')).toLowerCase().includes(q)) ids.push(m.id);
    }
    return { ids: ids.slice(0, msg.limit || 200), total: ids.length, ms: performance.now() - t0 };
  }

  _addMeta(m) {
    if (!m || !m.id) return;
    const prev = this.meta.get(m.id);
    if (prev && prev.trigger && this.trig.get(prev.trigger.toLowerCase()) === m.id) this.trig.delete(prev.trigger.toLowerCase());
    if (m._deleted) { this.meta.delete(m.id); return; }
    this.meta.set(m.id, {
      id: m.id, trigger: m.trigger || '', title: m.title || '', category: m.category || '', modality: m.modality || '',
      tags: m.tags || [], kind: m.kind || 'macro', updatedAt: m.updatedAt || 0, size: (m.content || '').length, bench: !!m.bench, isDefault: !!m.isDefault, key: m.key || ''
    });
    if (m.trigger) this.trig.set(m.trigger.toLowerCase(), m.id);
    if (m.category) this.cats.add(m.category);
  }

  async init() {
    if (this.ready) return;
    const t0 = performance.now();
    let count = 0;
    this._worker();
    await idbIterate('macros', async (batch) => {
      batch.forEach((m) => this._addMeta(m));
      this._post({ type: 'add', docs: batch.map(toIndex) });
      count += batch.length;
      await sleep(0);
    }, 2500);
    if (!count) await this.restoreDefaults('merge', { silent: true });
    const savedCats = JSON.parse(localStorage.getItem('ssdc-macro-categories') || '[]');
    savedCats.forEach((c) => this.cats.add(c));
    this.stats.loadMs = Math.round(performance.now() - t0);
    this.ready = true;
    setMacroBridge({ getRaw: (id) => idbGet('macros', id), applyRemote: (doc, force) => this.applyRemote(doc, force) });
    this._bump();
  }

  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  _bump() { this.version++; this.listCache = null; this.subs.forEach((f) => f(this.version)); }

  get count() { return this.meta.size; }
  getMeta(id) { return this.meta.get(id) || null; }
  idForTrigger(t) { return t ? this.trig.get(String(t).toLowerCase()) || null : null; }
  hasTrigger(t) { return !!this.idForTrigger(t); }

  async get(id) {
    if (this.contentCache.has(id)) return this.contentCache.get(id);
    const d = await idbGet('macros', id);
    if (d && !d._deleted) {
      if (this.contentCache.size > 300) this.contentCache.clear();
      this.contentCache.set(id, d);
      return d;
    }
    return null;
  }

  async getByKey(key) {
    for (const m of this.meta.values()) if (m.key === key) return this.get(m.id);
    return null;
  }

  async save(input, opts = {}) {
    const doc = Object.assign({ kind: 'macro', tags: [], category: 'General', modality: 'Ultrasound (USG)' }, input);
    doc.id = doc.id || uid('m_');
    doc.trigger = String(doc.trigger || '').trim();
    doc.triggerLower = doc.trigger.toLowerCase();
    doc.tags = Array.isArray(doc.tags) ? doc.tags : String(doc.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
    doc.text = stripHtml(doc.content || '');
    doc.updatedAt = Date.now();
    if (!doc.createdAt) doc.createdAt = doc.updatedAt;
    delete doc._deleted;
    await idbPut('macros', doc);
    this.contentCache.set(doc.id, doc);
    this._addMeta(doc);
    this._post({ type: 'add', docs: [toIndex(doc)] });
    if (!doc.bench && !opts.local) queueMacro(doc.id);
    if (!opts.silent) this._bump();
    return doc;
  }

  async remove(ids) {
    const list = Array.isArray(ids) ? ids : [ids];
    const bench = [];
    const soft = [];
    for (const id of list) {
      const m = this.meta.get(id);
      if (!m) continue;
      if (m.bench) bench.push(id);
      else {
        const cur = await idbGet('macros', id);
        if (cur) soft.push(Object.assign({}, cur, { _deleted: true, updatedAt: Date.now() }));
      }
      this._addMeta({ id, _deleted: true });
      this.contentCache.delete(id);
    }
    if (bench.length) await idbDeleteMany('macros', bench);
    if (soft.length) { await idbPutMany('macros', soft); soft.forEach((d) => queueMacro(d.id)); }
    this._post({ type: 'remove', ids: list });
    this._bump();
  }

  async applyRemote(doc, force) {
    if (!doc || !doc.id) return;
    const cur = await idbGet('macros', doc.id);
    if (!force && cur && Number(cur.updatedAt || 0) > Number(doc.updatedAt || 0)) return;
    const d = Object.assign({}, doc, { triggerLower: String(doc.trigger || '').toLowerCase(), text: doc.text || stripHtml(doc.content || '') });
    await idbPut('macros', d);
    this.contentCache.delete(d.id);
    this._addMeta(d);
    this._post({ type: 'add', docs: [toIndex(d)] });
    this._bump();
  }

  search(query, filters = {}, limit = 200) { return this._post({ type: 'search', query, filters, limit }); }
  workerStats() { return this._post({ type: 'stats' }); }

  /** Sorted metadata list for browsing (cached per version). */
  list({ modality, category, kind, sort = 'updated' } = {}) {
    const key = [modality, category, kind, sort].join('|');
    if (this.listCache && this.listCache.key === key) return this.listCache.arr;
    let arr = [];
    for (const m of this.meta.values()) {
      if (modality && m.modality !== modality) continue;
      if (category && m.category !== category) continue;
      if (kind && m.kind !== kind) continue;
      arr.push(m);
    }
    if (sort === 'title') arr.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'trigger') arr.sort((a, b) => a.trigger.localeCompare(b.trigger));
    else arr.sort((a, b) => b.updatedAt - a.updatedAt);
    this.listCache = { key, arr };
    return arr;
  }

  categories() { return Array.from(this.cats).sort(); }
  addCategory(c) { if (!c) return; this.cats.add(c); this._saveCats(); this._bump(); }
  async renameCategory(from, to) {
    if (!from || !to || from === to) return 0;
    let n = 0;
    for (const m of Array.from(this.meta.values())) {
      if (m.category === from) { const d = await this.get(m.id); if (d) { await this.save(Object.assign({}, d, { category: to }), { silent: true }); n++; } }
    }
    this.cats.delete(from); this.cats.add(to); this._saveCats(); this._bump();
    return n;
  }
  async deleteCategory(c, moveTo = 'General') {
    const n = await this.renameCategory(c, moveTo);
    this.cats.delete(c); this._saveCats(); this._bump();
    return n;
  }
  _saveCats() { try { localStorage.setItem('ssdc-macro-categories', JSON.stringify(Array.from(this.cats))); } catch (e) { /* ignore */ } }

  /** mode: 'merge' (add missing defaults, keep custom) | 'reset' (factory reset: delete everything, restore defaults) */
  async restoreDefaults(mode = 'merge', opts = {}) {
    if (mode === 'reset') {
      const all = Array.from(this.meta.keys());
      if (all.length) await this.remove(all);
    }
    const now = Date.now();
    const docs = [];
    for (const d of DEFAULT_MACROS) {
      if (mode === 'merge' && this.meta.has(d.id)) continue;
      docs.push(Object.assign({}, d, { triggerLower: (d.trigger || '').toLowerCase(), text: stripHtml(d.content), updatedAt: mode === 'reset' ? now : d.updatedAt, createdAt: d.updatedAt }));
    }
    if (docs.length) {
      await idbPutMany('macros', docs);
      docs.forEach((d) => this._addMeta(d));
      await this._post({ type: 'add', docs: docs.map(toIndex) });
      if (mode === 'reset') docs.forEach((d) => queueMacro(d.id));
    }
    if (!opts.silent) this._bump();
    return docs.length;
  }

  /** Bulk import (JSON / CSV / TSV / TXT rows already parsed into objects). Non-blocking with progress. */
  async bulkImport(records, onProgress, { bench = false } = {}) {
    const B = 2500;
    let done = 0;
    const t0 = performance.now();
    for (let i = 0; i < records.length; i += B) {
      const slice = records.slice(i, i + B).map((r, k) => {
        const content = r.content || r.html || r.text || r.body || '';
        const d = {
          id: r.id || uid('m_') + (i + k).toString(36),
          trigger: String(r.trigger || r.shortcut || r.code || '').trim(),
          title: String(r.title || r.name || r.trigger || 'Untitled').trim(),
          modality: r.modality || 'Ultrasound (USG)',
          category: r.category || 'General',
          tags: Array.isArray(r.tags) ? r.tags : String(r.tags || '').split(/[,;|]/).map((s) => s.trim()).filter(Boolean),
          kind: r.kind || (content.length > 600 ? 'template' : 'macro'),
          content: /<[a-z][\s\S]*>/i.test(content) ? content : String(content).split(/\n{2,}/).map((p) => '<p>' + p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</p>').join(''),
          updatedAt: Date.now(),
          bench
        };
        d.triggerLower = d.trigger.toLowerCase();
        d.text = r.text && !r.content ? r.text : stripHtml(d.content);
        return d;
      });
      await idbPutMany('macros', slice);
      slice.forEach((d) => this._addMeta(d));
      this._post({ type: 'add', docs: slice.map(toIndex) });
      if (!bench) slice.forEach((d) => queueMacro(d.id));
      done += slice.length;
      if (onProgress) onProgress(done, records.length);
      await sleep(0);
    }
    this._bump();
    return { count: done, ms: Math.round(performance.now() - t0) };
  }

  /** "Seed 1,00,000 Test Macros" benchmark */
  async seedBenchmark(n = 100000, onProgress) {
    const organs = ['Liver', 'Gall bladder', 'Pancreas', 'Spleen', 'Right kidney', 'Left kidney', 'Urinary bladder', 'Prostate', 'Uterus', 'Right ovary', 'Left ovary', 'Thyroid', 'Breast', 'Testis', 'Carotid', 'Appendix', 'Aorta', 'Placenta', 'Foetus', 'Knee'];
    const findings = ['normal study', 'calculus', 'cyst', 'diffuse fatty change', 'focal lesion', 'enlargement', 'wall thickening', 'hydronephrosis', 'nodule', 'collection', 'calcification', 'increased vascularity', 'reduced flow', 'oedema', 'post-operative status'];
    const sev = ['mild', 'moderate', 'severe', 'minimal', 'gross'];
    const mods = MODALITIES;
    const cats = ['Abdomen', 'KUB', 'Pelvis', 'Obstetric', 'Thyroid', 'Breast', 'Scrotal', 'Vascular', 'Musculoskeletal', 'General'];
    const B = 5000;
    const t0 = performance.now();
    let done = 0;
    for (let i = 0; i < n; i += B) {
      const docs = [];
      for (let j = i; j < Math.min(n, i + B); j++) {
        const o = organs[j % organs.length];
        const f = findings[(j * 7) % findings.length];
        const s = sev[(j * 3) % sev.length];
        const size = ((j % 97) / 10 + 0.5).toFixed(1);
        const content = `<p><strong>${o.toUpperCase()}:</strong> ${o} shows ${s} ${f} measuring ${size} cm (benchmark #${j}). Echotexture and vascularity are documented; no other abnormality is seen in the visualised region.</p>`;
        docs.push({
          id: 'bench_' + j, trigger: '.b' + j, triggerLower: '.b' + j, title: `${o} – ${s} ${f} (${j})`, modality: mods[j % mods.length], category: cats[j % cats.length],
          tags: [o.toLowerCase(), f.split(' ')[0], 'benchmark'], kind: 'macro', content, text: stripHtml(content), updatedAt: Date.now() - j, bench: true
        });
      }
      await idbPutMany('macros', docs);
      docs.forEach((d) => this._addMeta(d));
      this._post({ type: 'add', docs: docs.map(toIndex) });
      done += docs.length;
      if (onProgress) onProgress(done, n);
      await sleep(0);
    }
    await this.workerStats();
    const ms = Math.round(performance.now() - t0);
    this._bump();
    return { count: done, ms };
  }

  async clearBenchmark() {
    const ids = Array.from(this.meta.values()).filter((m) => m.bench).map((m) => m.id);
    for (let i = 0; i < ids.length; i += 5000) await idbDeleteMany('macros', ids.slice(i, i + 5000));
    ids.forEach((id) => this._addMeta({ id, _deleted: true }));
    await this._post({ type: 'remove', ids });
    this._bump();
    return ids.length;
  }

  async exportAll(filterIds) {
    const want = filterIds ? new Set(filterIds) : null;
    const out = [];
    await idbIterate('macros', async (batch) => {
      for (const d of batch) {
        if (d._deleted || (want && !want.has(d.id))) continue;
        out.push({ id: d.id, trigger: d.trigger, title: d.title, modality: d.modality, category: d.category, tags: d.tags, kind: d.kind, content: d.content, updatedAt: d.updatedAt });
      }
    }, 5000);
    return out;
  }

  async storedCount() { return idbCount('macros'); }
}

export const macros = new MacroStore();
if (typeof window !== 'undefined') window.__ssdcMacros = macros;
