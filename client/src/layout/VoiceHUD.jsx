// Voice dictation panel (movable, resizable) and the always-available dictation controls: the top-bar
// mic button and the floating "listening" pill. All of them drive the one system-wide dictation
// session in core/voice.js, so dictation keeps running while the user moves between modules.
import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Square, X, GripHorizontal, AudioWaveform, Sparkles, ChevronUp, Keyboard } from 'lucide-react';
import { useVoice, startVoice, stopVoice, toggleVoice, voicePrefs, setVoicePrefs, onVoiceLevel } from '../core/voice';
import { lsGet, lsSet } from '../core/utils';
import { cx, Select, Toggle } from '../components/ui';

const LANGS = [{ value: 'en-IN', label: 'English (India)' }, { value: 'en-US', label: 'English (US)' }, { value: 'en-GB', label: 'English (UK)' }, { value: 'hi-IN', label: 'हिन्दी (Hindi)' }];
export const VOICE_HOTKEY = 'F8';

const COMMAND_HELP = [
  ['“go to billing” · “open pathology” · “open reporting”', 'switch module (dictation keeps running)'],
  ['“next field” · “previous field” · “clear field”', 'move between boxes'],
  ['“set mobile to 98290 12345” · “age 45” · “gender female”', 'fill a box by its label'],
  ['“haemoglobin 12.5” (lab) · “search patient Ramesh”', 'results & patient search'],
  ['“save” · “print” · “scroll down”', 'actions on the current screen'],
  ['“full stop” · “comma” · “new line” · “delete that” · “stop dictation”', 'punctuation & control']
];

function Waveform({ className }) {
  const canvas = useRef(null);
  useEffect(() => onVoiceLevel((buf) => {
    const c = canvas.current;
    if (!c) return;
    const g = c.getContext('2d');
    const w = c.width;
    const h = c.height;
    g.clearRect(0, 0, w, h);
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#0ea5e9'); grad.addColorStop(1, '#14b8a6');
    g.strokeStyle = grad;
    g.lineWidth = 2;
    g.beginPath();
    const step = w / buf.length;
    for (let i = 0; i < buf.length; i++) { const y = (buf[i] / 255) * h; if (i === 0) g.moveTo(0, y); else g.lineTo(i * step, y); }
    g.stroke();
  }), []);
  return <canvas ref={canvas} width={600} height={60} className={className} aria-hidden="true" />;
}

export function VoiceHUD({ onClose }) {
  const v = useVoice();
  const [pos, setPos] = useState(() => lsGet('ssdc-hud-pos', { x: Math.max(16, window.innerWidth - 380), y: Math.max(70, window.innerHeight - 410), w: 360, h: 340 }));
  const [p, setP] = useState(voicePrefs);
  const [help, setHelp] = useState(false);
  const drag = useRef(null);
  useEffect(() => { lsSet('ssdc-hud-pos', pos); }, [pos]);
  const upd = (patch) => { setVoicePrefs(patch); setP(voicePrefs()); };

  const onDown = (e) => {
    drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    const mv = (ev) => {
      const d = drag.current;
      setPos((q) => Object.assign({}, q, { x: Math.min(window.innerWidth - 120, Math.max(0, d.ox + ev.clientX - d.sx)), y: Math.min(window.innerHeight - 60, Math.max(0, d.oy + ev.clientY - d.sy)) }));
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  const onResize = (e) => {
    e.stopPropagation();
    const s = { sx: e.clientX, sy: e.clientY, w: pos.w, h: pos.h };
    const mv = (ev) => setPos((q) => Object.assign({}, q, { w: Math.max(290, Math.min(680, s.w + ev.clientX - s.sx)), h: Math.max(230, Math.min(600, s.h + ev.clientY - s.sy)) }));
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const listening = v.on;
  return (
    <div data-no-dictation role="region" aria-label="Voice dictation panel" className="fixed z-[95] flex select-none flex-col overflow-hidden rounded-2xl border border-brand-200 bg-surface/95 shadow-pop backdrop-blur dark:border-brand-900"
      style={{ left: pos.x, top: pos.y, width: pos.w, height: pos.h }} onMouseDown={(e) => { if (!/select|option|input|label/i.test(e.target.tagName)) e.preventDefault(); }}>
      <div onPointerDown={onDown} className="flex cursor-move items-center gap-2 bg-gradient-to-r from-navy-900 to-brand-800 px-3 py-2 text-white">
        <GripHorizontal className="h-4 w-4 opacity-70" />
        <AudioWaveform className="h-4 w-4" />
        <span className="flex-1 truncate text-[13px] font-bold">Voice dictation · all modules</span>
        <span className={cx('rounded-full px-2 py-0.5 text-[10px] font-bold', listening ? 'bg-rose-500' : 'bg-white/15')}>{v.status === 'transcribing' ? 'TRANSCRIBING' : listening ? 'LIVE' : 'OFF'}</span>
        <button type="button" className="rounded p-0.5 hover:bg-white/15" onClick={onClose} title="Hide the panel (dictation keeps running)" aria-label="Hide dictation panel"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <div className="flex gap-2">
          <Select size="sm" aria-label="Dictation engine" value={p.engine} onChange={(e) => upd({ engine: e.target.value })} options={[{ value: 'browser', label: 'Live (Web Speech)' }, { value: 'gemini', label: 'Gemini AI transcription' }]} disabled={listening} />
          <Select size="sm" aria-label="Dictation language" value={p.lang} onChange={(e) => upd({ lang: e.target.value })} options={LANGS} disabled={listening} />
        </div>
        <Waveform className="h-11 w-full shrink-0 rounded-lg bg-surface2" />
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-surface2/60 px-2.5 py-1.5 text-[12.5px] leading-5" aria-live="polite">
          {help ? (
            <ul className="space-y-1">{COMMAND_HELP.map(([a, b]) => <li key={a}><b className="font-semibold">{a}</b><span className="text-muted"> — {b}</span></li>)}</ul>
          ) : v.interim ? <span className="text-muted">{v.interim}…</span> : v.last ? <span><span className={v.lastKind === 'nofield' ? 'text-amber-600' : 'text-emerald-600'}>{v.lastKind === 'command' ? '⚡ ' : v.lastKind === 'nofield' ? '⚠ ' : '✓ '}</span>{v.last}{v.lastKind === 'nofield' && <span className="text-muted"> — click the box the words should go into</span>}</span>
            : <span className="text-muted">Press {VOICE_HOTKEY} anywhere to start or stop. Words go to the box with the cursor; say “go to billing”, “next field” or “set age to 45”.</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <Toggle size="sm" checked={p.commands !== false} onChange={(x) => upd({ commands: x })} label={<span className="text-[11px]">Voice commands</span>} />
          <Toggle size="sm" checked={p.formFill !== false} onChange={(x) => upd({ formFill: x })} label={<span className="text-[11px]">Form filling</span>} />
          <Toggle size="sm" checked={p.resume !== false} onChange={(x) => upd({ resume: x })} label={<span className="text-[11px]">Stay on after reload</span>} />
          <button type="button" className="link ml-auto" onClick={() => setHelp(!help)}>{help ? 'Back' : 'What can I say?'}</button>
        </div>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted" title={v.target}>➜ {v.target || 'No box selected'}</span>
          {p.engine === 'gemini' && <Sparkles className="h-4 w-4 text-violet-500" />}
          {listening
            ? <button type="button" onClick={stopVoice} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-rose-600 px-4 text-sm font-bold text-white shadow"><Square className="h-3.5 w-3.5" />Stop</button>
            : <button type="button" onClick={startVoice} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-600 px-4 text-sm font-bold text-white shadow"><Mic className="h-4 w-4" />Dictate</button>}
        </div>
      </div>
      <div onPointerDown={onResize} className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize" style={{ background: 'linear-gradient(135deg, transparent 50%, rgb(14 165 233 / .6) 50%)' }} />
    </div>
  );
}

/** Top-bar mic: click = start / stop dictation (F8), the small arrow = the dictation panel. */
export function VoiceButton({ panelOpen, onPanel }) {
  const v = useVoice();
  return (
    <span className="inline-flex items-center rounded-lg" data-no-dictation>
      <button type="button" onClick={() => toggleVoice()} aria-pressed={v.on} aria-label={v.on ? 'Stop dictation (' + VOICE_HOTKEY + ')' : 'Start dictation (' + VOICE_HOTKEY + ')'}
        title={(v.on ? 'Stop' : 'Start') + ' voice dictation — works in every module (' + VOICE_HOTKEY + ')'}
        className={cx('relative inline-flex h-9 w-9 items-center justify-center rounded-l-lg transition', v.on ? 'bg-rose-600 text-white' : 'text-muted hover:bg-surface2 hover:text-ink')}>
        {v.on ? <Mic className="h-[18px] w-[18px]" /> : <MicOff className="h-[18px] w-[18px]" />}
        {v.on && <span className="absolute right-1 top-1 h-2 w-2 animate-ping rounded-full bg-white" />}
      </button>
      <button type="button" onClick={onPanel} aria-expanded={panelOpen} aria-label="Dictation panel" title="Dictation panel: engine, language, commands"
        className={cx('inline-flex h-9 w-5 items-center justify-center rounded-r-lg', panelOpen ? 'bg-surface2 text-ink' : 'text-muted hover:bg-surface2')}>
        <ChevronUp className={cx('h-3.5 w-3.5 transition-transform', !panelOpen && 'rotate-180')} />
      </button>
    </span>
  );
}

/** Floating strip shown while dictation runs and the panel is hidden — on every screen. */
export function VoicePill({ onPanel }) {
  const v = useVoice();
  if (!v.on) return null;
  return (
    <div data-no-dictation role="status" aria-live="polite" className="fixed bottom-4 left-1/2 z-[94] flex max-w-[min(640px,calc(100vw-24px))] -translate-x-1/2 items-center gap-2 rounded-full border border-rose-200 bg-surface/95 py-1.5 pl-2 pr-1.5 shadow-pop backdrop-blur dark:border-rose-900 print:hidden"
      onMouseDown={(e) => e.preventDefault()}>
      <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-600 text-white"><Mic className="h-3.5 w-3.5" /><span className="absolute inset-0 animate-ping rounded-full bg-rose-500/40" /></span>
      <span className="min-w-0 flex-1 truncate text-[12.5px]">
        {v.interim ? <span className="text-muted">{v.interim}…</span> : v.last ? <span>{v.lastKind === 'command' ? '⚡ ' : v.lastKind === 'nofield' ? '⚠ ' : ''}{v.last}</span> : <span className="text-muted">Listening — speak, or say “go to …”</span>}
      </span>
      <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted sm:inline-flex" title={v.target}>➜ <span className="max-w-[150px] truncate">{v.target || 'no box selected'}</span></span>
      <span className="hidden shrink-0 items-center gap-0.5 rounded border border-line px-1 text-[10px] text-muted md:inline-flex"><Keyboard className="h-3 w-3" />{VOICE_HOTKEY}</span>
      <button type="button" onClick={onPanel} className="shrink-0 rounded-full px-2 py-1 text-[11.5px] font-semibold hover:bg-surface2">Panel</button>
      <button type="button" onClick={stopVoice} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-600 px-3 py-1 text-[12px] font-bold text-white"><Square className="h-3 w-3" />Stop</button>
    </div>
  );
}
