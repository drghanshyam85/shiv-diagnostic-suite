// Resizable, collapsible side panes (worklist on the left, tools on the right) around a centre area.
//   • drag the divider to resize; drag it most of the way in (or double-click it) to collapse
//   • keyboard: focus the divider, ←/→ resize (Shift = bigger steps), Home / End = min / max, Enter = collapse
//   • a collapsed pane leaves a slim rail, so every pane stays one click away
// While dragging, the pane's width is written straight to the DOM (no React re-render per frame);
// the final width is committed once, on release.
import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from './ui';

const valueOf = (v) => (typeof v === 'function' ? v() : v);

export function PaneSplitter({ side = 'left', paneRef, width, min = 180, max = 600, onResize, onCollapse, label = 'panel' }) {
  const drag = useRef(null);
  const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
  const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
  const maxNow = () => Math.max(min, valueOf(max));

  const onPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const w = paneRef.current ? paneRef.current.getBoundingClientRect().width : width;
    drag.current = { x: e.clientX, w, cur: w, max: maxNow(), collapse: false, moved: false };
    document.body.classList.add('is-col-resizing');
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) * (side === 'left' ? 1 : -1);
    if (Math.abs(dx) > 2) d.moved = true;
    const raw = d.w + dx;
    d.collapse = raw < min - 56;
    d.cur = Math.round(Math.max(min, Math.min(d.max, raw)));
    const el = paneRef.current;
    if (el) { el.style.width = d.cur + 'px'; el.style.opacity = d.collapse ? '0.4' : ''; }
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    document.body.classList.remove('is-col-resizing');
    if (paneRef.current) paneRef.current.style.opacity = '';
    if (!d.moved) return;
    if (d.collapse) onCollapse(); else onResize(d.cur);
  };
  const onKeyDown = (e) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === grow) { e.preventDefault(); onResize(Math.min(maxNow(), width + step)); }
    else if (e.key === shrink) { e.preventDefault(); if (width <= min) onCollapse(); else onResize(Math.max(min, width - step)); }
    else if (e.key === 'Home') { e.preventDefault(); onResize(min); }
    else if (e.key === 'End') { e.preventDefault(); onResize(maxNow()); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCollapse(); }
  };
  const Chev = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <div role="separator" aria-orientation="vertical" aria-label={'Resize ' + label} aria-valuemin={min} aria-valuemax={Math.round(maxNow())} aria-valuenow={Math.round(width)} tabIndex={0}
      title={'Drag to resize the ' + label + ' · double-click or Enter to collapse'}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
      onDoubleClick={(e) => { if (!e.target.closest('button')) onCollapse(); }} onKeyDown={onKeyDown}
      className="pane-splitter group relative z-[3] w-[7px] shrink-0 cursor-col-resize touch-none select-none bg-surface2/70 outline-none transition-colors hover:bg-brand-500/25 focus-visible:bg-brand-500/30">
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line group-hover:bg-brand-500/60" />
      <button type="button" tabIndex={-1} onClick={onCollapse} aria-label={'Collapse the ' + label} title={'Collapse the ' + label}
        className="absolute left-1/2 top-1/2 grid h-9 w-[15px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-md border border-line bg-surface text-muted shadow-sm opacity-60 transition hover:text-ink group-hover:opacity-100 group-focus-visible:opacity-100">
        <Chev className="h-3 w-3" />
      </button>
    </div>
  );
}

/**
 * The slim strip a collapsed pane leaves behind. items: [{ id, label, icon }] give one-click access to a
 * particular tab of the pane (e.g. Macros, Copilot, Images).
 */
export function PaneRail({ side = 'left', label, icon: Icon, items, activeId, open = false, onOpen }) {
  const Chev = side === 'left' ? ChevronRight : ChevronLeft;
  return (
    <div className={cx('pane-rail flex w-[30px] shrink-0 flex-col items-center gap-1 bg-surface2/70 py-1.5', side === 'left' ? 'border-r border-line' : 'border-l border-line')}>
      <button type="button" onClick={() => onOpen()} aria-label={(open ? 'Hide ' : 'Show ') + label} aria-expanded={open} title={(open ? 'Hide ' : 'Show ') + label}
        className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface hover:text-ink">
        <Chev className={cx('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      {(items || []).map((it) => (
        <button key={it.id} type="button" onClick={() => onOpen(it.id)} aria-label={it.label} title={it.label}
          className={cx('grid h-7 w-7 place-items-center rounded-md hover:bg-surface hover:text-ink', open && activeId === it.id ? 'bg-surface text-brand-600 ring-1 ring-line' : 'text-muted')}>
          <it.icon className="h-4 w-4" />
        </button>
      ))}
      <button type="button" onClick={() => onOpen()} tabIndex={-1} aria-hidden="true"
        className={cx('mt-1 flex items-center gap-1.5 rounded-md px-0.5 py-1.5 text-[11px] font-semibold tracking-wide text-muted [writing-mode:vertical-rl] hover:bg-surface hover:text-ink', side === 'left' && 'rotate-180')}>
        {Icon && <Icon className="h-3.5 w-3.5 rotate-90" />}{label}
      </button>
    </div>
  );
}
