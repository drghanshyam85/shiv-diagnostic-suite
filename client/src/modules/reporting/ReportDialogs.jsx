// Workstation dialogs: exact print-layout page view, report archive, version history, header / footer
// (master letterhead) and margins, find & replace bar, and "Send to patient" (the shared dispatch dialog).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Archive, Search, FolderOpen, Eye, FileDown, Printer, History, RotateCcw, PanelTop, Ruler, X, ChevronUp, ChevronDown, Replace, Lock, PencilLine } from 'lucide-react';
import { useColl, useSettings } from '../../core/hooks';
import { fmtDate, fmtDateTime, stripHtml, timeAgo } from '../../core/utils';
import { MM } from '../../core/print';
import { cx, Modal, Drawer, Button, Input, Textarea, Select, Field, Segmented, Toggle, Badge, Empty, Spinner, toast } from '../../components/ui';
import { STATUS_META, listSnapshots, impressionOf } from './reportDoc';
import { renderPages, exportReport, printReport } from './reportOut';
import { MARGIN_PRESETS, letterheadHtml, resolveTemplate, imageHeaderHtml } from './reportPrint';
import { findRanges, replaceRanges, setHighlight } from './editorUtils';
import { SendDialog } from '../dispatch/SendDialog';

/** Exact A4 pages (as printed) scaled to the available width. */
export function PagesView({ report, settings, zoom = 'fit', onRendered }) {
  const outer = useRef(null);
  const [res, setRes] = useState(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    let alive = true;
    setRes(null);
    renderPages(report, settings).then((r) => { if (alive) { setRes(r); onRendered && onRendered(r); } }).catch((e) => toast('Preview failed: ' + e.message, 'error'));
    return () => { alive = false; };
  }, [report, settings]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!outer.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(outer.current);
    return () => ro.disconnect();
  }, []);
  const pageW = (res ? res.widthMm : 210) * MM;
  const pageH = (res ? res.heightMm : 297) * MM;
  const k = zoom === 'fit' ? Math.min(1.5, Math.max(0.3, (w - 24) / pageW)) : zoom;
  const n = res ? res.pageCount : 1;
  return (
    <div ref={outer} className="ff-preview w-full">
      {!res ? <div className="flex h-60 items-center justify-center gap-2 text-sm text-muted"><Spinner />Laying out A4 pages…</div> : (
        <div style={{ width: pageW * k, height: (pageH + 18) * n * k, margin: '0 auto', position: 'relative' }}>
          <div style={{ width: pageW, transform: `scale(${k})`, transformOrigin: 'top left', position: 'absolute', left: 0, top: 0 }} dangerouslySetInnerHTML={{ __html: res.html }} />
        </div>
      )}
    </div>
  );
}

export function PreviewModal({ open, onClose, report, settings }) {
  const [pages, setPages] = useState(0);
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} size="xl" title="Print preview" subtitle={`${report.demographics.name || 'Report'} · ${pages || '…'} A4 page(s) · running header, footer & signature`} icon={Eye}
      footer={<>
        <Button icon={FileDown} onClick={() => exportReport(report, settings, 'pdf')}>Download PDF</Button>
        <Button variant="primary" icon={Printer} onClick={() => printReport(report, settings)}>Print</Button>
      </>}>
      <div className="max-h-[72vh] overflow-y-auto rounded-xl bg-slate-200/70 p-3 dark:bg-slate-950/60"><PagesView report={report} settings={settings} onRendered={(r) => setPages(r.pageCount)} /></div>
    </Modal>
  );
}

// ---------------------------------------------------------------- archive
const textCache = new Map();
function searchText(r) {
  const key = r.id + ':' + (r.updatedAt || 0);
  let t = textCache.get(key);
  if (!t) {
    const d = r.demographics || {};
    t = [d.name, d.patientId, d.refBy, d.modality, d.indication, d.date, d.date ? fmtDate(d.date) : '', impressionOf(r)].join(' ').toLowerCase();
    textCache.set(key, t);
  }
  return t;
}

export function ArchiveDrawer({ open, onClose, onOpen, currentId }) {
  const settings = useSettings();
  const reports = useColl('reports');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [preview, setPreview] = useState(null);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return reports.filter((r) => {
      if (status === 'SIGNED' && r.status !== 'SIGNED_FINAL') return false;
      if (status === 'DRAFT' && r.status === 'SIGNED_FINAL') return false;
      const dt = (r.demographics && r.demographics.date) || '';
      if (from && dt < from) return false;
      if (to && dt > to) return false;
      if (!s.length) return true;
      const t = searchText(r);
      return s.every((w) => t.includes(w));
    }).sort((a, b) => String((b.demographics || {}).date).localeCompare(String((a.demographics || {}).date)) || (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [reports, q, status, from, to]);
  return (
    <>
      <Drawer open={open} onClose={onClose} title="Report archive" subtitle={`${reports.length} report(s) · searchable by name, ID, date, doctor or diagnosis`} icon={Archive} width="sm:w-[600px]">
        <div className="sticky top-0 z-10 space-y-2 border-b border-line bg-surface p-3">
          <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input autoFocus className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Sunita · SSDC-P-000001 · 28/10/2026 · Dr. Sharma · fatty liver" aria-label="Search reports" /></div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented size="sm" value={status} onChange={setStatus} options={[{ value: 'ALL', label: 'All' }, { value: 'DRAFT', label: 'Drafts' }, { value: 'SIGNED', label: 'Signed' }]} />
            <span className="ml-auto flex items-center gap-1 text-xs text-muted">From<Input type="date" size="sm" className="w-36" value={from} onChange={(e) => setFrom(e.target.value)} />to<Input type="date" size="sm" className="w-36" value={to} onChange={(e) => setTo(e.target.value)} /></span>
          </div>
        </div>
        <div className="p-2">
          {!list.length && <Empty icon={Archive} title="No reports found" />}
          {list.slice(0, 300).map((r) => {
            const d = r.demographics || {};
            const st = STATUS_META[r.status] || STATUS_META.DRAFT;
            const imp = impressionOf(r);
            return (
              <div key={r.id} className={cx('mb-1.5 rounded-xl border border-line p-2.5 hover:border-brand-300', r.id === currentId && 'border-brand-400 bg-brand-50/50 dark:bg-brand-950/30')}>
                <div className="flex items-start gap-2">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(r)}>
                    <div className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold">{d.name || 'Unnamed'}</span><Badge tone={st.tone} icon={r.status === 'SIGNED_FINAL' ? Lock : PencilLine}>{st.label}</Badge>{r.version > 1 && <Badge tone="slate">v{r.version}</Badge>}</div>
                    <div className="truncate text-[11.5px] text-muted">{d.date ? fmtDate(d.date) : '—'} · {d.patientId || 'no ID'} · {d.modality || 'Report'} · Ref: {d.refBy || '—'}</div>
                    {imp && <div className="mt-0.5 line-clamp-2 text-[11.5px]"><b className="text-[10px] uppercase tracking-wide text-muted">Impression</b> {imp}</div>}
                  </button>
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button size="sm" icon={FolderOpen} onClick={() => onOpen(r)}>Open</Button>
                    <span className="flex gap-1">
                      <button type="button" title="Preview" className="rounded-md border border-line p-1 hover:bg-surface2" onClick={() => setPreview(r)}><Eye className="h-3.5 w-3.5" /></button>
                      <button type="button" title="Word (.docx)" className="rounded-md border border-line p-1 hover:bg-surface2" onClick={() => exportReport(r, settings, 'docx')}><FileDown className="h-3.5 w-3.5" /></button>
                      <button type="button" title="Print" className="rounded-md border border-line p-1 hover:bg-surface2" onClick={() => printReport(r, settings)}><Printer className="h-3.5 w-3.5" /></button>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          {list.length > 300 && <p className="py-2 text-center text-xs text-muted">Showing 300 of {list.length} — refine the search.</p>}
        </div>
      </Drawer>
      {preview && <PreviewModal open onClose={() => setPreview(null)} report={preview} settings={settings} />}
    </>
  );
}

// ---------------------------------------------------------------- versions
export function VersionsDrawer({ open, onClose, report, onRestore, readOnly }) {
  const [snaps, setSnaps] = useState(null);
  const [view, setView] = useState(null);
  useEffect(() => { if (open) listSnapshots(report.id).then(setSnaps); else setSnaps(null); }, [open, report.id, report.updatedAt]);
  const log = [].concat((report.unlockLog || []).map((x) => ({ at: x.at, text: 'Unlocked by ' + (x.byName || x.by) + ' — ' + x.reason })), (report.amendLog || []).map((x) => ({ at: x.at, text: 'Amended — ' + x.reason })), report.signedAt ? [{ at: report.signedAt, text: 'Signed by ' + (report.signedByName || '') + ' (v' + (report.version || 1) + ')' }] : []).sort((a, b) => b.at - a.at);
  return (
    <>
      <Drawer open={open} onClose={onClose} title="Version history" subtitle="Snapshots on this workstation · sign / unlock audit trail" icon={History} width="sm:w-[480px]">
        <div className="space-y-3 p-3">
          {log.length > 0 && <div className="rounded-xl border border-line p-2.5 text-[12.5px]"><div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted">Audit trail</div>{log.map((l, i) => <div key={i} className="flex gap-2 py-0.5"><span className="shrink-0 text-muted tnum">{fmtDateTime(l.at)}</span><span>{l.text}</span></div>)}</div>}
          {!snaps && <Spinner />}
          {snaps && !snaps.length && <Empty icon={History} title="No snapshots yet" text="Snapshots are taken automatically before signing, template replacement and AI rewrites, or via Review → Save version." />}
          {snaps && snaps.map((s) => (
            <div key={s.id} className="rounded-xl border border-line p-2.5">
              <div className="flex items-center gap-2"><b className="text-[13px]">{s.label}</b><Badge tone="slate">v{s.version}</Badge><span className="ml-auto text-[11px] text-muted">{timeAgo(s.at)}</span></div>
              <div className="text-[11.5px] text-muted">{fmtDateTime(s.at)} · {s.by || '—'} · {stripHtml(s.html).split(/\s+/).filter(Boolean).length} words</div>
              <div className="mt-1.5 flex gap-1.5"><Button size="sm" icon={Eye} onClick={() => setView(s)}>View</Button><Button size="sm" icon={RotateCcw} disabled={readOnly} onClick={() => { onRestore(s); onClose(); }}>Restore</Button></div>
            </div>
          ))}
        </div>
      </Drawer>
      {view && (
        <Modal open onClose={() => setView(null)} size="lg" title={view.label} subtitle={fmtDateTime(view.at)} icon={History} footer={<Button variant="primary" icon={RotateCcw} disabled={readOnly} onClick={() => { onRestore(view); setView(null); onClose(); }}>Restore this version</Button>}>
          <div className="doc-body max-h-[60vh] overflow-y-auto rounded-lg border border-line bg-white p-4 text-slate-900" dangerouslySetInnerHTML={{ __html: view.html }} />
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- header / footer & margins
const letterheadPreviewHtml = (settings, l) => {
  const r = resolveTemplate(Object.assign({}, l, { headerMode: 'template' }), settings);
  return r.headerMode === 'image' ? imageHeaderHtml(r) : letterheadHtml(settings, r);
};
// a layout resolved from a letterhead template is edited as "template" (keeps the link to the template)
const unresolved = (layout) => (layout.fromTemplate ? Object.assign({}, layout, { headerMode: 'template', headerHtml: '', headerImage: '', footerImage: '' }) : layout);

export function HeaderFooterDialog({ open, onClose, layout, settings, onApply, onSaveDefault, isAdmin }) {
  const [l, setL] = useState(() => unresolved(layout));
  useEffect(() => { if (open) setL(unresolved(layout)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const set = (p) => setL((x) => Object.assign({}, x, p));
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Header & footer — master letterhead control" icon={PanelTop}
      footer={<>{isAdmin && <Button className="mr-auto" onClick={() => { onSaveDefault(l); onClose(); }}>Save as clinic default</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => { onApply(l); onClose(); }}>Apply to this report</Button></>}>
      <div className="space-y-3">
        <Field label="Header mode">
          <Segmented value={l.headerMode} onChange={(v) => set({ headerMode: v, showHeader: v !== 'none', letterheadId: v === 'template' ? (l.letterheadId || ((settings.letterheads || [])[0] || {}).id || '') : l.letterheadId })}
            options={[{ value: 'full', label: 'Full colour letterhead' }].concat((settings.letterheads || []).length ? [{ value: 'template', label: 'Letterhead template' }] : []).concat([{ value: 'letterhead', label: 'Pre-printed letterhead paper' }, { value: 'none', label: 'No header' }])} />
        </Field>
        {l.headerMode === 'template' && (
          <>
            <Field label="Template"><Select value={l.letterheadId || ''} onChange={(e) => set({ headerMode: 'template', letterheadId: e.target.value })} options={(settings.letterheads || []).map((t) => ({ value: t.id, label: t.name + (t.kind === 'html' ? ' (HTML)' : ' (image)') }))} /></Field>
            <div className="rounded-xl border border-line bg-white p-3 text-slate-900"><div style={{ fontFamily: 'Arial', fontSize: '11pt' }} dangerouslySetInnerHTML={{ __html: letterheadPreviewHtml(settings, l) }} /></div>
          </>
        )}
        {l.headerMode === 'letterhead' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Top blank space (mm)" hint="height of the pre-printed header"><Input type="number" min="0" max="120" value={l.letterheadTop} onChange={(e) => set({ letterheadTop: Number(e.target.value) || 0 })} /></Field>
            <Field label="Bottom blank space (mm)" hint="height of the pre-printed footer"><Input type="number" min="0" max="80" value={l.letterheadBottom} onChange={(e) => set({ letterheadBottom: Number(e.target.value) || 0 })} /></Field>
          </div>
        )}
        {l.headerMode === 'full' && (
          <>
            <Toggle checked={!!l.headerHtml} onChange={(v) => set({ headerHtml: v ? letterheadHtml(settings, Object.assign({}, l, { headerHtml: '' })) : '' })} label="Use a custom header (HTML)" hint="Start from the standard letterhead and edit freely" />
            {l.headerHtml && <Textarea rows={6} className="font-mono text-[11px]" value={l.headerHtml} onChange={(e) => set({ headerHtml: e.target.value })} />}
            <div className="rounded-xl border border-line bg-white p-3 text-slate-900"><div style={{ fontFamily: 'Arial', fontSize: '11pt' }} dangerouslySetInnerHTML={{ __html: letterheadHtml(settings, l) }} /></div>
          </>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle checked={l.showFooter !== false} onChange={(v) => set({ showFooter: v })} label="Show footer" />
          <Toggle checked={l.showDemographics !== false} onChange={(v) => set({ showDemographics: v })} label="Patient demographics table" />
        </div>
        <Field label="Footer text"><Input value={l.footerText || ''} onChange={(e) => set({ footerText: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function MarginsDialog({ open, onClose, margins, onApply }) {
  const [m, setM] = useState(margins);
  useEffect(() => { if (open) setM(margins); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Custom margins (mm)" icon={Ruler} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => { onApply(m); onClose(); }}>Apply</Button></>}>
      <div className="mb-3 flex flex-wrap gap-1.5">{Object.entries(MARGIN_PRESETS).map(([k, p]) => <button key={k} type="button" className="chip" onClick={() => setM(p.m)}>{p.label}</button>)}</div>
      <div className="grid grid-cols-2 gap-3">{['top', 'right', 'bottom', 'left'].map((k) => <Field key={k} label={k}><Input type="number" min="0" max="60" step="0.5" value={m[k]} onChange={(e) => setM(Object.assign({}, m, { [k]: Number(e.target.value) || 0 }))} /></Field>)}</div>
    </Modal>
  );
}

// ---------------------------------------------------------------- find & replace
export function FindBar({ api, replaceMode, onClose, readOnly }) {
  const [q, setQ] = useState(() => (api.current ? api.current.selectionText().slice(0, 80) : ''));
  const [rep, setRep] = useState('');
  const [opts, setOpts] = useState({ matchCase: false, wholeWord: false });
  const [idx, setIdx] = useState(0);
  const [ranges, setRanges] = useState([]);
  const input = useRef(null);
  const recompute = () => {
    const root = api.current && api.current.el();
    if (!root) return [];
    const r = findRanges(root, q, opts);
    setRanges(r);
    setHighlight('ssdc-find', r);
    return r;
  };
  useEffect(() => { recompute(); setIdx(0); }, [q, opts.matchCase, opts.wholeWord]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { input.current && input.current.focus(); return () => { setHighlight('ssdc-find', []); setHighlight('ssdc-find-cur', []); }; }, []);
  useEffect(() => {
    const r = ranges[idx];
    setHighlight('ssdc-find-cur', r ? [r] : []);
    if (r) { const rect = r.getBoundingClientRect(); const sc = api.current.el().closest('.rw-scroll'); if (sc) { const b = sc.getBoundingClientRect(); if (rect.top < b.top + 30 || rect.bottom > b.bottom - 30) sc.scrollTop += rect.top - b.top - b.height / 3; } }
  }, [idx, ranges]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (d) => { if (ranges.length) setIdx((i) => (i + d + ranges.length) % ranges.length); };
  const replaceOne = () => {
    const r = ranges[idx];
    if (!r || readOnly) return;
    replaceRanges(api.current.el(), [r], rep);
    const nr = recompute();
    setIdx((i) => Math.min(i, Math.max(0, nr.length - 1)));
  };
  const replaceAll = () => { if (readOnly || !ranges.length) return; const n = replaceRanges(api.current.el(), ranges, rep); toast(n + ' replacement(s)', 'success'); recompute(); };
  const sel = () => { const r = ranges[idx]; if (!r) return; const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); api.current.setRange(r.cloneRange()); onClose(); };
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-amber-50/70 px-3 py-1.5 dark:bg-amber-950/20">
      <Search className="h-4 w-4 text-muted" />
      <input ref={input} className="input input-sm h-7 w-52" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find in report" aria-label="Find text"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') onClose(); }} />
      <span className="min-w-[64px] text-center text-[11.5px] text-muted tnum">{ranges.length ? idx + 1 + ' of ' + ranges.length : q ? 'no match' : ''}</span>
      <button type="button" className="rounded p-1 hover:bg-surface2" onClick={() => go(-1)} title="Previous (Shift+Enter)"><ChevronUp className="h-4 w-4" /></button>
      <button type="button" className="rounded p-1 hover:bg-surface2" onClick={() => go(1)} title="Next (Enter)"><ChevronDown className="h-4 w-4" /></button>
      <label className="flex items-center gap-1 text-[11.5px]"><input type="checkbox" className="accent-brand-600" checked={opts.matchCase} onChange={(e) => setOpts(Object.assign({}, opts, { matchCase: e.target.checked }))} />Aa</label>
      <label className="flex items-center gap-1 text-[11.5px]"><input type="checkbox" className="accent-brand-600" checked={opts.wholeWord} onChange={(e) => setOpts(Object.assign({}, opts, { wholeWord: e.target.checked }))} />Whole word</label>
      {replaceMode && !readOnly && (
        <>
          <Replace className="ml-2 h-4 w-4 text-muted" />
          <input className="input input-sm h-7 w-44" value={rep} onChange={(e) => setRep(e.target.value)} placeholder="Replace with" aria-label="Replace with" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } }} />
          <Button size="sm" onClick={replaceOne} disabled={!ranges.length}>Replace</Button>
          <Button size="sm" onClick={replaceAll} disabled={!ranges.length}>Replace all</Button>
        </>
      )}
      <Button size="sm" variant="ghost" onClick={sel} disabled={!ranges.length}>Select</Button>
      <button type="button" className="ml-auto rounded p-1 hover:bg-surface2" onClick={onClose} title="Close (Esc)"><X className="h-4 w-4" /></button>
    </div>
  );
}

// ---------------------------------------------------------------- send to patient
/** "Send to patient" for USG reports — the shared dispatch dialog (report / invoice / combined). */
export function SendReportDialog({ open, onClose, report, onSent }) {
  return <SendDialog open={open} onClose={onClose} kind="usg" doc={report} onSent={onSent} />;
}
