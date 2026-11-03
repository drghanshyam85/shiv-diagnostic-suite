// Inline macro / template search inside the report text. Type // where you are writing (or press
// Ctrl+Space / Ctrl+/ on a word), keep typing to filter, ↑/↓ to choose, Enter or Tab to insert at
// that spot, Shift+Enter to replace the whole report with a template, Esc to close.
// The popup never takes the keyboard focus: the editor forwards ↑ ↓ Enter Tab Esc to it, so the
// doctor keeps typing in the report. The typed "//query" is removed when the macro goes in.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, CornerDownLeft, Star, FileText } from 'lucide-react';
import { macros } from '../../core/macros';
import { lsGet, stripHtml } from '../../core/utils';
import { cx } from '../../components/ui';
import { useMacroSearch, MacroRow, useMacrosVersion } from '../macros/macroUi';

const KINDS = [{ v: '', l: 'All' }, { v: 'macro', l: 'Macros' }, { v: 'template', l: 'Templates' }];
const W = 420;

export const InlineMacroSearch = forwardRef(function InlineMacroSearch({ state, suggestedKeys = [], onPick, onClose }, ref) {
  const open = !!state;
  const q = open ? state.query.trim() : '';
  const [kind, setKind] = useState('');
  const [hi, setHi] = useState(0);
  const [preview, setPreview] = useState('');
  const list = useRef(null);
  const version = useMacrosVersion();
  const res = useMacroSearch(open && q ? q : '', kind ? { kind } : {}, 10, 15);

  // nothing typed yet: this visit's templates, then the doctor's recent macros, then the library
  const rows = useMemo(() => {
    if (!open) return [];
    if (q) return res.ids.map((id) => ({ id }));
    const out = [];
    const seen = new Set();
    const add = (id, tag) => { const m = macros.getMeta(id); if (m && !seen.has(id) && (!kind || m.kind === kind)) { seen.add(id); out.push({ id, tag }); } };
    if (suggestedKeys.length) {
      macros.list({ kind: 'template' }).filter((m) => m.key && suggestedKeys.includes(m.key))
        .sort((a, b) => suggestedKeys.indexOf(a.key) - suggestedKeys.indexOf(b.key)).slice(0, 3).forEach((m) => add(m.id, 'visit'));
    }
    lsGet('ssdc-pref:macro-recent', []).slice(0, 6).forEach((id) => add(id, 'recent'));
    res.ids.forEach((id) => { if (out.length < 10) add(id); });
    return out;
  }, [open, q, res.ids, kind, suggestedKeys, version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setHi(0); }, [q, kind, open]);
  useEffect(() => { if (!open) setKind(''); }, [open]);
  const cur = rows[Math.min(hi, rows.length - 1)];
  const curId = cur ? cur.id : null;
  useEffect(() => {
    let alive = true;
    if (!curId) { setPreview(''); return undefined; }
    macros.get(curId).then((d) => { if (alive) setPreview(d ? stripHtml(d.content || '').replace(/\s+/g, ' ').trim().slice(0, 220) : ''); });
    return () => { alive = false; };
  }, [curId]);
  useEffect(() => { const el = list.current && list.current.querySelector('[aria-selected="true"]'); if (el) el.scrollIntoView({ block: 'nearest' }); }, [hi]);

  useImperativeHandle(ref, () => ({
    nav: (d) => setHi((h) => (rows.length ? Math.max(0, Math.min(rows.length - 1, h + d)) : 0)),
    current: () => curId,
    cycleKind: () => setKind((k) => KINDS[(KINDS.findIndex((x) => x.v === k) + 1) % KINDS.length].v)
  }), [rows, curId]);

  if (!open || typeof document === 'undefined') return null;
  const r = state.rect || { top: 120, left: 120, bottom: 140 };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(W, vw - 16);
  const left = Math.max(8, Math.min(r.left, vw - w - 8));
  const below = vh - r.bottom > 300 || r.top < 300;
  const pos = below ? { top: Math.min(r.bottom + 6, vh - 120), left } : { bottom: vh - r.top + 6, left };
  const keep = (e) => e.preventDefault(); // keep the caret in the report

  return createPortal(
    <div role="dialog" aria-label="Insert a macro or template" onMouseDown={keep}
      className="fixed z-[80] flex max-h-[min(380px,70vh)] flex-col overflow-hidden rounded-xl border border-line bg-surface text-ink shadow-pop" style={Object.assign({ width: w }, pos)}>
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-brand-600" />
        <span className="min-w-0 flex-1 truncate text-[12px]">{q ? <>Macros &amp; templates matching <b>“{q}”</b></> : <span className="text-muted">Type to search macros &amp; templates…</span>}</span>
        <span className="flex shrink-0 gap-0.5" role="radiogroup" aria-label="Show">
          {KINDS.map((k) => (
            <button key={k.v || 'all'} type="button" role="radio" aria-checked={kind === k.v} tabIndex={-1} onClick={() => setKind(k.v)}
              className={cx('rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold', kind === k.v ? 'bg-brand-600 text-white' : 'text-muted hover:bg-surface2')}>{k.l}</button>
          ))}
        </span>
      </div>
      <div ref={list} role="listbox" aria-label="Matches" className="min-h-0 flex-1 overflow-y-auto p-1">
        {rows.map((row, i) => (
          <div key={row.id} className="relative">
            <MacroRow compact meta={macros.getMeta(row.id)} active={i === hi} onClick={() => onPick(row.id, 'cursor')}
              right={row.tag ? <span className="mt-1 inline-flex shrink-0 items-center gap-0.5 text-[10px] text-muted">{row.tag === 'visit' ? <><FileText className="h-3 w-3 text-violet-500" />this visit</> : <><Star className="h-3 w-3 text-amber-500" />recent</>}</span> : null} />
          </div>
        ))}
        {!rows.length && !res.busy && <div className="px-3 py-4 text-center text-[12px] text-muted">No macro or template matches “{q}”. Keep typing, or press Esc.</div>}
        {!rows.length && res.busy && <div className="px-3 py-4 text-center text-[12px] text-muted">Searching…</div>}
      </div>
      {preview && <div className="line-clamp-2 border-t border-line bg-surface2/60 px-3 py-1.5 text-[11px] leading-snug text-muted">{preview}</div>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-line px-2.5 py-1 text-[10.5px] text-muted">
        <span><span className="kbd">↑↓</span> choose</span>
        <span><span className="kbd">Enter</span> / <span className="kbd">Tab</span> insert</span>
        <span><span className="kbd">Shift+Enter</span> replace report</span>
        <span><span className="kbd">Esc</span> close</span>
        {curId && <button type="button" tabIndex={-1} className="ml-auto inline-flex items-center gap-1 rounded-md bg-brand-600 px-1.5 py-0.5 font-semibold text-white" onClick={() => onPick(curId, 'cursor')}><CornerDownLeft className="h-3 w-3" />Insert</button>}
        {onClose && <button type="button" tabIndex={-1} className={cx('rounded-md px-1.5 py-0.5 hover:bg-surface2', !curId && 'ml-auto')} onClick={onClose}>Close</button>}
      </div>
    </div>,
    document.body
  );
});
