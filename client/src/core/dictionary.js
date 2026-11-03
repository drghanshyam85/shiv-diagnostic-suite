// Medical & sonography dictionary: shipped seed terms (stable ids "dseed_*") + the editable 'dictionary'
// collection (custom terms and overrides / hidden seeds). Every term is whitelisted by the spell checker
// and any entry with a trigger expands in the report editor — all live, without a reload.
import { store } from './store';
import { useColl } from './hooks';
import { uid, fuzzyScore } from './utils';
import { DICTIONARY_SEED } from '../data/lexicon';

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48);
export const SEED_ENTRIES = DICTIONARY_SEED.map((e) => Object.assign({ id: 'dseed_' + slug(e.term), seed: true, updatedAt: 0 }, e));
export const DICT_CATEGORIES = ['Abdominal', 'Renal / KUB', 'Pelvis / Gynae', 'Obstetrics', 'Fetal Medicine', 'Thyroid', 'Breast', 'Scrotal', 'Vascular Doppler', 'MSK', 'Neuro', 'Chest', 'Paediatric', 'Pathology', 'Biochemistry', 'Physics / Artifacts', 'Abbreviations', 'Custom'];

let cache = { v: -1, list: [], triggers: new Map() };
export function dictionaryEntries() {
  const v = store.version.dictionary;
  if (cache.v === v) return cache.list;
  const docs = store.list('dictionary');
  const byId = new Map(docs.map((d) => [d.id, d]));
  const out = [];
  SEED_ENTRIES.forEach((s) => { const o = byId.get(s.id); if (!o) out.push(s); else if (!o.hidden) out.push(Object.assign({}, s, o, { seed: true, edited: true })); });
  docs.forEach((d) => { if (!String(d.id).startsWith('dseed_') && !d.hidden && d.term) out.push(d); });
  out.sort((a, b) => String(a.term).localeCompare(String(b.term)));
  const triggers = new Map();
  out.forEach((e) => { if (e.trigger) triggers.set(String(e.trigger).toLowerCase(), e); });
  cache = { v, list: out, triggers };
  return out;
}
export function dictionaryTrigger(token) { dictionaryEntries(); return cache.triggers.get(String(token || '').toLowerCase()) || null; }

export function useDictionary() {
  useColl('dictionary');
  return dictionaryEntries();
}

/** "Adult female: 12–15.5 g/dL" from the structured reference range fields. */
export function formatRange(e) {
  const lo = e.rangeLow === undefined || e.rangeLow === null ? '' : String(e.rangeLow).trim();
  const hi = e.rangeHigh === undefined || e.rangeHigh === null ? '' : String(e.rangeHigh).trim();
  if (!lo && !hi) return '';
  const span = lo && hi ? lo + '–' + hi : lo ? '≥ ' + lo : '≤ ' + hi;
  return (e.population ? e.population + ': ' : '') + span + (e.unit ? ' ' + e.unit : '');
}

export function saveEntry(entry) {
  const id = entry.id || uid('dict_');
  const num = (v) => (v === '' || v === undefined || v === null || isNaN(Number(v)) ? '' : Number(v));
  const doc = {
    id, term: String(entry.term || '').trim(), category: entry.category || 'Custom', definition: entry.definition || '',
    trigger: String(entry.trigger || '').trim(), autoText: String(entry.autoText || '').trim(),
    rangeLow: num(entry.rangeLow), rangeHigh: num(entry.rangeHigh), unit: String(entry.unit || '').trim(), population: String(entry.population || '').trim(),
    custom: !id.startsWith('dseed_')
  };
  doc.normal = String(entry.normal || '').trim() || formatRange(doc);
  return store.put('dictionary', doc);
}
export function deleteEntry(entry) {
  if (String(entry.id).startsWith('dseed_')) return store.put('dictionary', { id: entry.id, term: entry.term, hidden: true });
  return store.remove('dictionary', entry.id);
}
export function restoreSeedEntries() {
  let n = 0;
  store.list('dictionary').forEach((d) => { if (String(d.id).startsWith('dseed_')) { store.remove('dictionary', d.id); n++; } });
  return n;
}

/** Fuzzy search over term, trigger, category, definition and normal range. */
export function searchDictionary(list, q, category) {
  const s = String(q || '').trim().toLowerCase();
  const base = category ? list.filter((e) => e.category === category) : list;
  if (!s) return base;
  const scored = [];
  for (const e of base) {
    const t = Math.max(fuzzyScore(s, e.term) * 2, e.trigger && String(e.trigger).toLowerCase().startsWith(s) ? 180 : 0);
    const rest = String(e.definition || '').toLowerCase().includes(s) || String(e.normal || '').toLowerCase().includes(s) || String(e.category || '').toLowerCase().includes(s) || String(e.autoText || '').toLowerCase().includes(s) ? 30 : 0;
    const sc = Math.max(t, rest);
    if (sc > 2) scored.push([sc, e]);
  }
  return scored.sort((a, b) => b[0] - a[0] || String(a[1].term).localeCompare(String(b[1].term))).map((x) => x[1]);
}
