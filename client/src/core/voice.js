// System-wide voice dictation. One dictation session for the whole application (not per screen), so it
// keeps listening while the user moves between Dashboard, Registration, Billing, Pathology, Reporting …
//   • F8 (or Ctrl+Shift+Space) starts / stops it anywhere; the top-bar mic shows its state
//   • words go to the field that has the cursor (inputs, text areas, the report editor)
//   • spoken commands: "go to billing", "open pathology", "next field", "previous field", "clear field",
//     "save", "print", "search patient Ramesh", "scroll down", "stop dictation"
//   • voice form filling: "set mobile to 98290 12345", "age 45", "gender female", "haemoglobin 12.5"
//     (the field is found by its label on the screen; in long text fields say "set … to …")
//   • it stays on across page reloads when it was on (microphone already allowed), and stops when the
//     workstation locks or the user signs out
import { useSyncExternalStore } from 'react';
import { Dictation, activeTarget, targetLabel, speechSupported, addVoiceHandler, setActiveTarget } from './speech';
import { events } from './store';
import { lsGet, lsSet } from './utils';

const PREF = 'ssdc-voice';
const prefs = () => Object.assign({ lang: lsGet('ssdc-hud-lang', 'en-IN'), engine: lsGet('ssdc-hud-engine', 'browser'), resume: true, commands: true, formFill: true }, lsGet(PREF, {}));
export const voicePrefs = prefs;
export function setVoicePrefs(patch) { lsSet(PREF, Object.assign(prefs(), patch)); if (patch.lang) lsSet('ssdc-hud-lang', patch.lang); if (patch.engine) lsSet('ssdc-hud-engine', patch.engine); emit({}); }

let snap = { on: false, status: 'idle', interim: '', last: '', lastKind: '', target: '', error: '', level: 0 };
const subs = new Set();
let lastReport = 0;
function emit(patch) { if (patch.lastKind === 'command' || patch.lastKind === 'fill') lastReport = Date.now(); snap = Object.assign({}, snap, patch); subs.forEach((f) => f()); }
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
export const voiceState = () => snap;
/** React hook: { on, status, interim, last, target, error, level } */
export const useVoice = () => useSyncExternalStore(subscribe, voiceState, voiceState);

let dict = null;
let targetTimer = null;
const levelListeners = new Set();
export const onVoiceLevel = (fn) => { levelListeners.add(fn); return () => levelListeners.delete(fn); };

export async function startVoice() {
  if (dict) return true;
  const p = prefs();
  if (p.engine === 'browser' && !speechSupported()) {
    emit({ error: 'Live dictation needs Google Chrome or Microsoft Edge (or choose the Gemini engine in the dictation panel).' });
    events.emit('notify', { text: 'Voice dictation needs Chrome / Edge here — or switch the engine to Gemini in the dictation panel', type: 'warning' });
    return false;
  }
  dict = new Dictation({
    lang: p.lang,
    engine: p.engine,
    onInterim: (t) => emit({ interim: t }),
    onFinal: (t, ok) => {
      const txt = String(t || '').trim();
      // a command / form fill already reported itself a moment ago
      if (txt.startsWith('✓ ') && Date.now() - lastReport < 250) { emit({ interim: '' }); return; }
      emit({ interim: '', last: txt, lastKind: ok === false ? 'nofield' : txt.startsWith('✓ ') ? 'command' : 'text' });
    },
    onState: (s) => {
      if (s === 'idle' && dict && !dict.active) { dict = null; lsSet(PREF, Object.assign(prefs(), { wasOn: false })); emit({ on: false, status: 'idle', interim: '' }); clearInterval(targetTimer); return; }
      emit({ status: s });
    },
    onLevel: (buf) => { let m = 0; for (let i = 0; i < buf.length; i += 4) m = Math.max(m, Math.abs(buf[i] - 128)); snap.level = m / 128; levelListeners.forEach((f) => f(buf)); },
    onError: (m) => { emit({ error: m }); events.emit('notify', { text: m, type: 'error' }); if (/permission|not supported|unavailable/i.test(m)) stopVoice(); }
  });
  emit({ on: true, status: 'listening', error: '', interim: '', target: targetLabel(activeTarget()) });
  lsSet(PREF, Object.assign(prefs(), { wasOn: true }));
  clearInterval(targetTimer);
  targetTimer = setInterval(() => { const t = targetLabel(activeTarget()); if (t !== snap.target) emit({ target: t }); }, 700);
  await dict.start();
  return true;
}

export function stopVoice() {
  const d = dict;
  dict = null;
  clearInterval(targetTimer);
  if (d) d.stop();
  lsSet(PREF, Object.assign(prefs(), { wasOn: false }));
  emit({ on: false, status: 'idle', interim: '' });
}
export const toggleVoice = () => (dict ? (stopVoice(), false) : startVoice());

/** After sign-in: switch dictation back on if it was on before a reload and the microphone is already allowed. */
export async function resumeVoiceIfWanted() {
  const p = prefs();
  if (!p.wasOn || !p.resume || dict) return;
  try {
    const perm = navigator.permissions && (await navigator.permissions.query({ name: 'microphone' }));
    if (perm && perm.state !== 'granted') return;
  } catch (e) { return; }
  startVoice();
}

events.on('session:locked', () => { if (dict) stopVoice(); });

// ------------------------------------------------------------------------------------------------ commands
const ROUTES = [
  [/^(dashboard|home|main screen)$/, '/dashboard'],
  [/^(registration|patient registration|register|new patient|reception)$/, '/register'],
  [/^(queue|tokens?|live queue|token display)$/, '/queue'],
  [/^(billing|bills?|billing desk|invoice|invoices)$/, '/billing'],
  [/^(form f|pc ?pndt|pcpndt|form f register)$/, '/formf'],
  [/^(reporting|report|usg reporting|ultrasound|usg|sonography|report editor)$/, '/report'],
  [/^(lab|laboratory|pathology|pathology lab)$/, '/lab'],
  [/^(templates?|macros?|templates and macros)$/, '/macros'],
  [/^(dictionary|medical dictionary)$/, '/dictionary'],
  [/^(dispatch|dispatch center)$/, '/dispatch'],
  [/^(tariff|tariff directory|rates?|price list)$/, '/tariff'],
  [/^(cash ?book|daily cash book|cash)$/, '/cashbook'],
  [/^(accounts|doctor sharing|accounts and doctor sharing|payouts?)$/, '/accounts'],
  [/^(cloud|cloud sync|backup)$/, '/cloud'],
  [/^(admin|admin console)$/, '/admin'],
  [/^(settings)$/, '/settings']
];

const clean = (t) => String(t || '').toLowerCase().replace(/[.,!?;:]+$/g, '').replace(/[“”"']/g, '').replace(/\s+/g, ' ').trim();
const FOCUSABLE = 'input:not([type=hidden]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), select:not([disabled]), [contenteditable="true"]';
const visible = (el) => !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');

/** The screen the user is working on: the top-most open dialog, else the page. */
function scope() {
  const dialogs = Array.from(document.querySelectorAll('[role=dialog][aria-modal="true"], [role=dialog]')).filter(visible);
  return dialogs.length ? dialogs[dialogs.length - 1] : (document.getElementById('main') || document.body);
}

function moveFocus(dir) {
  const list = Array.from(scope().querySelectorAll(FOCUSABLE)).filter((el) => visible(el) && !el.closest('[data-no-dictation]'));
  if (!list.length) return false;
  const cur = activeTarget() || document.activeElement;
  let i = list.indexOf(cur);
  if (i < 0) i = dir > 0 ? -1 : list.length;
  const next = list[Math.max(0, Math.min(list.length - 1, i + dir))];
  next.focus();
  setActiveTarget(next);
  return true;
}

const nativeSet = (el, v) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

function key(combo) {
  const [mod, k] = combo.split('+');
  const opts = { key: k, bubbles: true, cancelable: true, ctrlKey: mod === 'ctrl' };
  (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', opts));
}

// --- voice form filling -------------------------------------------------------------------------------
const STOP = new Set(['the', 'of', 'a', 'an', 'no', 'number', 'item', 'name', 'field']);
const words = (s) => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9\s/]/g, ' ').split(/\s+/).filter(Boolean);
const SYN = { haemoglobin: 'hemoglobin', hb: 'hemoglobin', phone: 'mobile', contact: 'mobile', sex: 'gender', 'father': 'guardian', husband: 'guardian', doctor: 'referring', referred: 'referring' };
const canon = (w) => SYN[w] || w;

function labelsOf(el) {
  const out = [el.getAttribute('aria-label'), el.getAttribute('data-label'), el.getAttribute('placeholder'), el.name];
  if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) out.push(l.textContent); }
  const lab = el.closest('label');
  if (lab) out.push(lab.textContent);
  const field = el.closest('[data-field], .field, div');
  if (field) { const l = field.querySelector(':scope > label, :scope > .label, :scope > span.label'); if (l) out.push(l.textContent); }
  return out.filter(Boolean).map((s) => String(s).trim()).filter((s) => s.length < 60);
}

function scoreLabel(spoken, label) {
  const a = words(spoken).map(canon).filter((w) => !STOP.has(w));
  const b = words(label).map(canon).filter((w) => !STOP.has(w));
  if (!a.length || !b.length) return 0;
  const hit = a.filter((w) => b.some((x) => x === w || (w.length > 3 && x.startsWith(w)) || (x.length > 3 && w.startsWith(x)))).length;
  return hit / Math.max(a.length, Math.min(b.length, a.length + 1));
}

/** Find the control whose label best matches `spoken` on the current screen. */
function findControl(spoken) {
  const root = scope();
  let best = null;
  let second = 0;
  const consider = (el, labels, kind) => {
    const sc = Math.max(0, ...labels.map((l) => scoreLabel(spoken, l)));
    if (!best || sc > best.sc) { second = best ? best.sc : 0; best = { el, sc, kind }; } else if (sc > second) second = sc;
  };
  root.querySelectorAll('input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])').forEach((el) => {
    if (!visible(el) || el.readOnly || el.closest('[data-no-dictation]') || /^(file|password|button|submit|range|color)$/i.test(el.type || '')) return;
    consider(el, labelsOf(el), el.type === 'checkbox' ? 'check' : el.tagName === 'SELECT' ? 'select' : 'text');
  });
  root.querySelectorAll('[role=radiogroup]').forEach((g) => { if (visible(g)) consider(g, [g.getAttribute('aria-label') || ''], 'radio'); });
  if (!best || best.sc < 0.75 || best.sc - second < 0.15) return null;
  return best;
}

function setControl(c, raw) {
  const v = String(raw || '').trim().replace(/[.]$/, '');
  if (c.kind === 'radio') {
    const opts = Array.from(c.el.querySelectorAll('[role=radio]'));
    const o = opts.find((x) => clean(x.textContent) === clean(v)) || opts.find((x) => clean(x.textContent).startsWith(clean(v).slice(0, 3)));
    if (!o) return false;
    o.click();
    return true;
  }
  if (c.kind === 'select') {
    const opts = Array.from(c.el.options);
    const o = opts.find((x) => clean(x.textContent) === clean(v)) || opts.find((x) => clean(x.textContent).includes(clean(v)) && clean(v).length > 1) || opts.find((x) => clean(x.value) === clean(v));
    if (!o) return false;
    nativeSet(c.el, o.value);
    return true;
  }
  if (c.kind === 'check') {
    const want = !/^(no|off|false|uncheck|untick)$/i.test(v);
    if (c.el.checked !== want) c.el.click();
    return true;
  }
  let val = v;
  if (c.el.type === 'number') { const n = parseFloat(v.replace(/[^0-9.\-]/g, '')); if (!Number.isFinite(n)) return false; val = String(n); }
  if (c.el.type === 'tel' || /mobile|phone/i.test(labelsOf(c.el).join(' '))) val = v.replace(/[^\d+]/g, '');
  c.el.focus();
  setActiveTarget(c.el);
  nativeSet(c.el, val);
  return true;
}

function formFill(text, el) {
  const t = clean(text);
  const longText = el && (el.isContentEditable || el.tagName === 'TEXTAREA');
  let m = /^(?:set|fill|enter|put|select|choose|mark)\s+(.+?)\s+(?:to|as|is|=)\s+(.+)$/.exec(t);
  if (!m && /^(?:set|fill|enter)\s+/.test(t)) m = /^(?:set|fill|enter)\s+(\D+?)\s+(\d[\d.\s/:-]*.*)$/.exec(t);
  if (!m) {
    if (longText) return false; // free text keeps flowing into notes and reports
    m = /^([a-z][a-z /]{1,40}?)\s+(\d[\d.\s/:-]*(?:\s*[a-z%]+)?|male|female|other|yes|no|self)$/.exec(t);
  }
  if (!m) return false;
  const c = findControl(m[1]);
  if (!c) return false;
  return setControl(c, m[2]);
}

function command(text, el) {
  const p = prefs();
  const t = clean(text);
  if (!t) return false;
  if (p.commands !== false) {
    let m = /^(?:go to|open|show|switch to)\s+(?:the\s+)?(.+?)(?:\s+(?:page|module|screen|desk|window|tab))?$/.exec(t);
    if (m) {
      const r = ROUTES.find(([re]) => re.test(m[1]));
      if (r) { location.hash = '#' + r[1]; emit({ last: '→ ' + m[1], lastKind: 'command' }); return true; }
    }
    if (/^(next field|next box|tab)$/.test(t)) { if (!moveFocus(1)) return false; emit({ last: 'Next field', lastKind: 'command' }); return true; }
    if (/^(previous field|previous box|back field|last field)$/.test(t)) { if (!moveFocus(-1)) return false; emit({ last: 'Previous field', lastKind: 'command' }); return true; }
    if (/^(clear field|clear this field|clear box|erase field)$/.test(t) && el && !el.isContentEditable) { nativeSet(el, ''); emit({ last: 'Field cleared', lastKind: 'command' }); return true; }
    if (/^(save|save it|save now|save report|save bill|save form)$/.test(t)) { key('ctrl+s'); emit({ last: 'Save', lastKind: 'command' }); return true; }
    if (/^(print|print it|print now|print report|print bill)$/.test(t)) { key('ctrl+p'); emit({ last: 'Print', lastKind: 'command' }); return true; }
    if (/^(scroll down|page down)$/.test(t)) { (document.getElementById('main') || document.scrollingElement).scrollBy({ top: 420, behavior: 'smooth' }); return true; }
    if (/^(scroll up|page up)$/.test(t)) { (document.getElementById('main') || document.scrollingElement).scrollBy({ top: -420, behavior: 'smooth' }); return true; }
    m = /^(?:search|find|look up)\s+(?:for\s+)?(?:patient\s+)?(.+)$/.exec(t);
    if (m && !(el && el.isContentEditable)) {
      const box = document.querySelector('header input[aria-label="Returning patient quick search"], header input');
      if (box) { box.focus(); setActiveTarget(box); nativeSet(box, m[1]); emit({ last: 'Search: ' + m[1], lastKind: 'command' }); return true; }
    }
    if (/^(pause dictation|mute|stop listening)$/.test(t)) { stopVoice(); return true; }
  }
  if (p.formFill !== false && formFill(text, el)) { emit({ last: '✓ ' + text, lastKind: 'fill' }); return true; }
  return false;
}

// registered once, before any screen's own handler (the report's biometry handler runs after this one)
addVoiceHandler((text, el) => command(text, el));

/** For tests and the dictation panel's "try a phrase" box. */
export const runVoiceCommand = (text) => command(text, activeTarget());
