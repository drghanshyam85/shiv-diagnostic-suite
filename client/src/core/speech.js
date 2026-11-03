// Voice dictation engine + active-cursor tracker.
// Dictated text is inserted at the last focused editable position anywhere in the app (report editor,
// impression box, demographics, header/footer, template editor, WhatsApp/Email composer, search bars).
import { gemini } from './ai';
import { blobToBase64 } from './utils';

const tracker = { el: null, range: null };

function isEditable(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.closest && el.closest('[data-no-dictation]')) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return !el.readOnly && !el.disabled;
  if (el.tagName === 'INPUT') return /^(text|search|email|tel|url|)$/i.test(el.type || 'text') && !el.readOnly && !el.disabled;
  return false;
}

if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!isEditable(t)) return;
    tracker.el = t.isContentEditable ? (t.closest('[contenteditable="true"]') || t) : t;
    tracker.range = null;
  }, true);
  document.addEventListener('selectionchange', () => {
    const s = window.getSelection();
    if (!s || !s.rangeCount || !tracker.el || !tracker.el.isContentEditable) return;
    const r = s.getRangeAt(0);
    if (tracker.el.contains(r.startContainer)) tracker.range = r.cloneRange();
  });
}

export const activeTarget = () => (tracker.el && document.contains(tracker.el) ? tracker.el : null);
export function setActiveTarget(el) { tracker.el = el; tracker.range = null; }
export function targetLabel(el = activeTarget()) {
  if (!el) return 'No field selected';
  return el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('data-label') || (el.isContentEditable ? 'Report editor' : el.name || 'Text field');
}

/** Insert text at the remembered cursor of `el` (contenteditable / input / textarea). */
export function insertAtCursor(text, el = activeTarget()) {
  if (!el || !text) return false;
  if (el.isContentEditable) {
    el.focus({ preventScroll: true });
    const sel = window.getSelection();
    let range = tracker.range && el.contains(tracker.range.startContainer) ? tracker.range : null;
    if (!range) { range = document.createRange(); range.selectNodeContents(el); range.collapse(false); }
    sel.removeAllRanges();
    sel.addRange(range);
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok) {
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (sel.rangeCount) tracker.range = sel.getRangeAt(0).cloneRange();
    return true;
  }
  const start = el.selectionStart !== null && el.selectionStart !== undefined ? el.selectionStart : el.value.length;
  const end = el.selectionEnd !== null && el.selectionEnd !== undefined ? el.selectionEnd : start;
  el.focus({ preventScroll: true });
  try { el.setSelectionRange(start, end); } catch (e) { /* number inputs */ }
  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
  if (!ok) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, el.value.slice(0, start) + text + el.value.slice(end));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    try { el.setSelectionRange(start + text.length, start + text.length); } catch (e) { /* ignore */ }
  }
  return true;
}

export function deleteLastWord(el = activeTarget()) {
  if (!el) return;
  el.focus();
  try { document.execCommand('delete', false); } catch (e) { /* ignore */ }
  for (let i = 0; i < 30; i++) {
    const before = el.isContentEditable ? (window.getSelection().anchorNode || {}).textContent || '' : el.value.slice(0, el.selectionStart);
    const off = el.isContentEditable ? window.getSelection().anchorOffset : before.length;
    const ch = before[off - 1];
    if (ch === undefined || /\s/.test(ch)) break;
    document.execCommand('delete', false);
  }
}

// Spoken punctuation & commands
const COMMANDS = [
  [/\b(new paragraph|next paragraph)\b/gi, '\n\n'],
  [/\b(new line|next line)\b/gi, '\n'],
  [/\b(full stop|period)\b/gi, '.'],
  [/\bcomma\b/gi, ','],
  [/\bcolon\b/gi, ':'],
  [/\bsemi ?colon\b/gi, ';'],
  [/\bquestion mark\b/gi, '?'],
  [/\b(open bracket|open parenthesis)\b/gi, '('],
  [/\b(close bracket|close parenthesis)\b/gi, ')'],
  [/\b(hyphen|dash)\b/gi, '-'],
  [/\bslash\b/gi, '/'],
  [/\bpercent\b/gi, '%'],
  [/\bplus minus\b/gi, '±'],
  [/\bdegree(s)?\b/gi, '°']
];

export function processTranscript(raw, prevChar = '') {
  let t = ' ' + String(raw || '').trim() + ' ';
  for (const [re, rep] of COMMANDS) t = t.replace(re, rep);
  t = t.replace(/\s+([.,:;?)%])/g, '$1').replace(/\(\s+/g, '(').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
  t = t.replace(/(\d)\s*(mm|cm|ml|cc)\b/gi, '$1 $2');
  const sentenceStart = !prevChar || /[.?!\n]\s*$/.test(prevChar);
  if (sentenceStart) t = t.charAt(0).toUpperCase() + t.slice(1);
  t = t.replace(/([.?!]\s+|\n)([a-z])/g, (m, a, b) => a + b.toUpperCase());
  if (prevChar && !/[\s(\n]$/.test(prevChar) && !/^[.,:;?)]/.test(t)) t = ' ' + t;
  return t;
}

function charBeforeCursor(el) {
  if (!el) return '';
  if (el.isContentEditable) {
    const r = tracker.range;
    if (r && r.startContainer.nodeType === 3) return r.startContainer.textContent.slice(Math.max(0, r.startOffset - 2), r.startOffset);
    return '';
  }
  const s = el.selectionStart || 0;
  return el.value.slice(Math.max(0, s - 2), s);
}

// Context handlers (e.g. the reporting window turning "BPD 45 mm" into a filled measurement) get each
// final phrase first; a handler returns true when it used the phrase, so it is not typed as text.
const voiceHandlers = new Set();
export function addVoiceHandler(fn) { voiceHandlers.add(fn); return () => voiceHandlers.delete(fn); }
function runVoiceHandlers(text, el) {
  for (const h of voiceHandlers) {
    try { if (h(text, el)) return true; } catch (e) { console.warn('voice handler failed', e); }
  }
  return false;
}

// diagnostics hook (like window.__ssdcStore): feed a phrase as if it had been dictated into the focused field
if (typeof window !== 'undefined') window.__ssdcVoice = { say: (text) => runVoiceHandlers(String(text || ''), activeTarget()) };

export const speechSupported = () => typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

/**
 * Continuous dictation session.
 *   const d = new Dictation({ lang, engine: 'browser'|'gemini', onInterim, onFinal, onState, onLevel, onError })
 *   d.start(targetEl?)  d.stop()
 */
export class Dictation {
  constructor(opts = {}) {
    this.o = opts;
    this.active = false;
    this.rec = null;
    this.stream = null;
    this.audioCtx = null;
    this.raf = null;
    this.recorder = null;
    this.chunks = [];
    this.fixedTarget = null;
  }

  async start(target) {
    this.fixedTarget = target || null;
    this.active = true;
    this.state('listening');
    await this.startMeter().catch(() => {});
    if ((this.o.engine || 'browser') === 'gemini') return this.startGemini();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { this.error('Speech recognition is not supported in this browser — use Google Chrome / Edge, or switch to the Gemini engine.'); this.stop(); return; }
    const rec = new SR();
    rec.lang = this.o.lang || 'en-IN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.commit(r[0].transcript);
        else interim += r[0].transcript;
      }
      if (this.o.onInterim) this.o.onInterim(interim);
    };
    rec.onerror = (e) => { if (e.error === 'no-speech' || e.error === 'aborted') return; this.error(e.error === 'not-allowed' ? 'Microphone permission denied' : 'Speech error: ' + e.error); };
    rec.onend = () => { if (this.active) { try { rec.start(); } catch (err) { /* already started */ } } };
    this.rec = rec;
    try { rec.start(); } catch (e) { this.error(e.message); }
  }

  commit(raw) {
    // dictation counts as activity for the idle lock (the doctor may not touch the keyboard)
    try { window.dispatchEvent(new Event('ssdc-activity')); } catch (e) { /* ignore */ }
    const text = String(raw || '').trim();
    if (!text) return;
    const el = this.fixedTarget && document.contains(this.fixedTarget) ? this.fixedTarget : activeTarget();
    if (/^(delete|scratch|undo) (that|last word)$/i.test(text)) { deleteLastWord(el); return; }
    if (/^stop (dictation|listening)$/i.test(text)) { this.stop(); return; }
    if (runVoiceHandlers(text, el)) { if (this.o.onFinal) this.o.onFinal('✓ ' + text, true, el); return; }
    let out = processTranscript(text, charBeforeCursor(el));
    // names are dictated in lower case by the recogniser: "kavita sharma" → "Kavita Sharma"
    if (el && el.tagName === 'INPUT' && /name/i.test([el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.name].join(' ')) && !/user ?name|email/i.test(el.getAttribute('aria-label') || '')) {
      out = out.replace(/(^|[\s.'-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/[.]$/, '');
    }
    const ok = insertAtCursor(out, el);
    if (this.o.onFinal) this.o.onFinal(out, ok, el);
  }

  async startGemini() {
    try {
      if (!this.stream) this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      this.recorder = new MediaRecorder(this.stream, { mimeType: mime });
      this.chunks = [];
      this.recorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
      this.recorder.onstop = async () => {
        if (!this.chunks.length) return;
        const blob = new Blob(this.chunks, { type: 'audio/webm' });
        this.state('transcribing');
        try {
          const data = await blobToBase64(blob);
          const text = await gemini({
            parts: [{ inline_data: { mime_type: 'audio/webm', data } }],
            prompt: 'Transcribe this radiology / sonography dictation verbatim in English. Use correct medical spelling, keep all numbers and units exactly, apply spoken punctuation commands. Output only the transcription.',
            temperature: 0
          });
          this.commit(text);
        } catch (e) { this.error(e.message); }
        this.state(this.active ? 'listening' : 'idle');
      };
      this.recorder.start();
      // segment every 12 s so long dictations stream in
      this.segTimer = setInterval(() => { if (this.recorder && this.recorder.state === 'recording') { this.recorder.stop(); this.recorder.start(); } }, 12000);
    } catch (e) { this.error('Microphone unavailable: ' + e.message); this.stop(); }
  }

  async startMeter() {
    if (!navigator.mediaDevices || !this.o.onLevel) return;
    this.stream = this.stream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = this.audioCtx.createMediaStreamSource(this.stream);
    const an = this.audioCtx.createAnalyser();
    an.fftSize = 256;
    src.connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    const loop = () => {
      an.getByteTimeDomainData(buf);
      if (this.o.onLevel) this.o.onLevel(buf);
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.active = false;
    clearInterval(this.segTimer);
    if (this.rec) { try { this.rec.onend = null; this.rec.stop(); } catch (e) { /* ignore */ } this.rec = null; }
    if (this.recorder && this.recorder.state === 'recording') { try { this.recorder.stop(); } catch (e) { /* ignore */ } }
    cancelAnimationFrame(this.raf);
    if (this.audioCtx) { this.audioCtx.close().catch(() => {}); this.audioCtx = null; }
    setTimeout(() => { if (!this.active && this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; } }, 400);
    this.state('idle');
  }

  state(s) { if (this.o.onState) this.o.onState(s); }
  error(m) { if (this.o.onError) this.o.onError(m); }
}

/** One-shot field dictation (mic buttons next to inputs). Resolves when speech ends. */
export function dictateOnce(el, { lang = 'en-IN', onState } = {}) {
  return new Promise((resolve, reject) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { reject(new Error('Speech recognition requires Google Chrome or Microsoft Edge')); return; }
    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const t = processTranscript(e.results[0][0].transcript, '');
      if (el) { setActiveTarget(el); insertAtCursor((el.value ? ' ' : '') + t.replace(/\.$/, ''), el); }
      resolve(t);
    };
    rec.onerror = (e) => reject(new Error(e.error));
    rec.onend = () => { if (onState) onState('idle'); resolve(''); };
    if (onState) onState('listening');
    rec.start();
  });
}
