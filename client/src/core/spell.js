// Real-time spell checker tuned for sonography: English (SCOWL-60, ~79k words) + medical lexicon
// + editable custom dictionary (instantly whitelisted). Auto-corrects common dictation errors.
import { MEDICAL_WORDS, AUTOCORRECT, AMBIGUOUS } from '../data/lexicon';
import { getWordlist } from './vendor';
import { levenshtein } from './utils';
import { store } from './store';
import { dictionaryEntries } from './dictionary';

const state = {
  english: null,
  medical: new Set(MEDICAL_WORDS.map((w) => w.toLowerCase())),
  custom: new Set(),
  ignored: new Set(),
  loaded: false,
  loading: null
};

function rebuildCustom() {
  const s = new Set();
  for (const e of dictionaryEntries()) {
    String(e.term || '').toLowerCase().split(/[^a-z0-9À-ɏ'-]+/).filter(Boolean).forEach((w) => s.add(w));
  }
  state.custom = s;
}
store.subscribe('dictionary', rebuildCustom);

export function loadSpell() {
  if (state.loaded) return Promise.resolve();
  if (!state.loading) {
    state.loading = getWordlist().then((set) => { state.english = set; }).catch(() => { state.english = null; }).then(() => { rebuildCustom(); state.loaded = true; });
  }
  return state.loading;
}
export const spellReady = () => state.loaded;

const norm = (w) => String(w || '').toLowerCase().replace(/^['-]+|['-]+$/g, '').replace(/'s$/, '');

function knownPart(w) {
  if (!w || w.length <= 2) return true;
  if (state.medical.has(w) || state.custom.has(w) || state.ignored.has(w)) return true;
  if (state.english && state.english.has(w)) return true;
  return false;
}

export function isKnown(word) {
  if (!word || word.length <= 2) return true;
  if (/\d/.test(word)) return true;
  if (/^[A-Z][A-Z0-9/-]{1,7}$/.test(word)) return true;
  const w = norm(word);
  if (knownPart(w)) return true;
  if (!state.english) return true;
  if (w.includes('-')) return w.split('-').every((p) => knownPart(p) || /^\d+$/.test(p));
  for (const suf of ['s', 'es', 'ed', 'd', 'ing', 'ly', 'al', 'ally', 'ic', 'ity']) {
    if (w.length > suf.length + 3 && w.endsWith(suf) && knownPart(w.slice(0, -suf.length))) return true;
  }
  if (w.endsWith('ies') && knownPart(w.slice(0, -3) + 'y')) return true;
  return false;
}

function matchCase(src, s) {
  if (src === src.toUpperCase() && src.length > 1) return s.toUpperCase();
  if (src[0] === src[0].toUpperCase()) return s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

export function suggest(word, max = 6) {
  const w = norm(word);
  const out = [];
  const seen = new Set();
  const push = (s, d) => { if (!seen.has(s)) { seen.add(s); out.push({ s, d }); } };
  if (AUTOCORRECT[w]) push(AUTOCORRECT[w], -1);
  if (AMBIGUOUS[w]) AMBIGUOUS[w].forEach((s) => push(s, -0.5));
  const scan = (set, bonus) => {
    if (!set) return;
    for (const c of set) {
      if (Math.abs(c.length - w.length) > 2) continue;
      if (c[0] !== w[0] && c[1] !== w[1]) continue;
      const d = levenshtein(w, c, 2);
      if (d <= 2) push(c, d - bonus);
    }
  };
  scan(state.medical, 0.6);
  scan(state.custom, 0.7);
  scan(state.english, 0);
  out.sort((a, b) => a.d - b.d || Math.abs(a.s.length - w.length) - Math.abs(b.s.length - w.length));
  return out.slice(0, max).map((x) => matchCase(word, x.s));
}

const WORD_RE = /[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'-]*[A-Za-zÀ-ɏ]|[A-Za-z]/g;

/** Returns [{ start, end, word, type: 'spell'|'ambiguous' }] */
export function checkText(text) {
  const out = [];
  if (!state.loaded) return out;
  WORD_RE.lastIndex = 0;
  let m;
  while ((m = WORD_RE.exec(text))) {
    const word = m[0];
    const lw = norm(word);
    if (AMBIGUOUS[lw] && !state.custom.has(lw) && !state.ignored.has(lw)) out.push({ start: m.index, end: m.index + word.length, word, type: 'ambiguous' });
    else if (AUTOCORRECT[lw] || !isKnown(word)) out.push({ start: m.index, end: m.index + word.length, word, type: 'spell' });
  }
  return out;
}

/** Auto-correction for the word (or two-word phrase) just typed; returns { from, to } or null. */
export function autocorrectTail(textBefore) {
  const m2 = textBefore.match(/([A-Za-z]+)\s([A-Za-z]+)$/);
  if (m2) {
    const phrase = (m2[1] + ' ' + m2[2]).toLowerCase();
    if (AUTOCORRECT[phrase]) return { from: m2[0], to: matchCase(m2[1], AUTOCORRECT[phrase]) };
  }
  const m1 = textBefore.match(/([A-Za-z]+)$/);
  if (m1) {
    const lw = m1[1].toLowerCase();
    if (AUTOCORRECT[lw] && AUTOCORRECT[lw].indexOf(' ') < 0 && !state.custom.has(lw)) return { from: m1[1], to: matchCase(m1[1], AUTOCORRECT[lw]) };
  }
  return null;
}

export function ignoreWord(w) { state.ignored.add(norm(w)); }
export function addCustomWord(word, extra = {}) {
  const id = 'dict_' + norm(word).replace(/[^a-z0-9]+/g, '_') + '_' + Date.now().toString(36);
  store.put('dictionary', Object.assign({ id, term: word, category: 'Custom', definition: '', normal: '', trigger: '', custom: true }, extra));
  state.custom.add(norm(word));
}
export const spellStats = () => ({ english: state.english ? state.english.size : 0, medical: state.medical.size, custom: state.custom.size });
