// SonoReport Ultra Pro — USG / X-ray / ECG reporting workstation: worklist, two-way demographics bar,
// MS Word-style ribbon, A4 canvas with inline shortcut expansion, focus macro bar, selection popover,
// Ctrl+K palette, Copilot (Gemini), images, print layout, archive, versions, sign & lock with the
// PC-PNDT Strict Form-F lock, send to patient, and window management (min / max / full screen / pop-out).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ScanLine, Search, Plus, Archive, Lock, ShieldCheck, Baby, ClipboardList, CheckCircle2, CircleAlert, Minimize2, Maximize2, Fullscreen, AppWindow, X, Bold, Underline, Heading3, Save, FileText, Sparkles, BookMarked, MonitorSmartphone, Keyboard, Info, ChevronLeft, ChevronRight, Users, Layers } from 'lucide-react';
import { useColl, useDoc, useSettings, getSettings, useLocalPref, useHotkeys, useEvent, useOutside, navigate, saveSettings, useMedia } from '../../core/hooks';
import { store, events } from '../../core/store';
import { can, logAudit, useAuth } from '../../core/auth';
import { api, isServer, useNet, acquireLock, lockHolder, emitEvent } from '../../core/sync';
import { macros } from '../../core/macros';
import { dictionaryTrigger } from '../../core/dictionary';
import { addCustomWord, ignoreWord, suggest, loadSpell } from '../../core/spell';
import { formFForVisit } from '../../core/formf';
import { setQueueStatus } from '../../core/clinic';
import { fileToHtml, sanitizeHtml } from '../../core/importers';
import { dateKey, fmtDate, fmtTime, escapeHtml, stripHtml, pickFiles, deepMerge, uid, lsSet, lsGet } from '../../core/utils';
import { cx, Button, IconBtn, Badge, Input, Modal, toast, confirmDialog, promptDialog, Empty } from '../../components/ui';
import { DocEditor } from './DocEditor';
import { Ribbon } from './Ribbon';
import { SidePanel, SIDE_TABS, recordMacroUse } from './SidePanel';
import { PaneSplitter, PaneRail } from '../../components/PaneSplitter';
import { InlineMacroSearch } from './InlineMacroSearch';
import { DicomViewer } from './DicomViewer';
import { sniffDicom, openDicom, dicomFrameFile, dicomSummary, dicomPatientCheck, frameTime, exifDate } from '../../core/dicomImage';
import { detectOrgan, autoCaption, sortImages } from '../../core/usgImages';
import { mirrorNow, cloudTargets } from '../cloud/cloudMirror';
import { openGoogle } from './CopilotPanel';
import { PagesView, PreviewModal, ArchiveDrawer, VersionsDrawer, HeaderFooterDialog, MarginsDialog, FindBar, SendReportDialog } from './ReportDialogs';
import { autoDispatch } from '../dispatch/engine';
import { folderWatchSupported, watchState, resumeFolder, takePending } from './folderWatch';
import { addVoiceHandler } from '../../core/speech';
import { parseMeasurement, fillMeasurement, draftImpression, setImpression, parseReportCommand, recalcFields, computeCalc } from '../../core/biometry';
import { expandTemplateContent, demographicValues, hasDynamicTokens } from '../../core/templateTokens';
import { MacroPalette, MacroEditorModal, useMacroSearch, MacroRow } from '../macros/macroUi';
import { reportLayout } from './reportPrint';
import { printReport, exportReport, copyReportRich, reportToGoogleDocs, signerFor, renderPages } from './reportOut';
import { REF_TABLES } from './refTables';
import { clinicalTableHtml, exec, inlineInner, rangeIn, setFontSizePt, setFontFamily, query, stats, cleanPastedHtml, jumpPlaceholder } from './editorUtils';
import {
  newReportFor, reportForVisit, templateKeysFor, emptyDemographics, signCheck, saveSnapshot, addReportImage, uploadReportOriginal, compressImage,
  REPORT_TOKENS, STATUS_META, wordCount, placeholderCount, antenatalChecklist
} from './reportDoc';

function AntenatalChecklist({ report, settings }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useOutside(ref, close, open);
  const items = antenatalChecklist(report, settings);
  const done = items.filter((x) => x.ok).length;
  return (
    <span ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} title="PC-PNDT antenatal checklist" aria-expanded={open}>
        <Badge tone={done === items.length ? 'emerald' : 'amber'} icon={Baby}>Antenatal {done}/{items.length}</Badge>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-[70] mt-1.5 w-[300px] rounded-xl border border-line bg-surface p-3 text-ink shadow-pop">
          <div className="mb-1.5 text-[12.5px] font-bold">PC-PNDT antenatal checklist</div>
          <ul className="space-y-1.5">
            {items.map((x) => (
              <li key={x.key} className="flex items-start gap-2 text-[12.5px]">
                {x.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                <span className="min-w-0"><span className={x.ok ? 'text-muted' : 'font-semibold'}>{x.label}</span>{!x.ok && <span className="block text-[11px] text-muted">{x.hint}</span>}</span>
              </li>
            ))}
          </ul>
          {report.visitId && <Button size="xs" className="mt-2.5" icon={ClipboardList} onClick={() => navigate('/formf', { visit: report.visitId })}>Open Form F</Button>}
        </div>
      )}
    </span>
  );
}

// pane geometry (px): min / max widths, the divider, the folded rail and the narrowest page area kept
const PANE = { leftMin: 190, leftMax: 520, rightMin: 290, rightMax: 720, split: 7, rail: 30, minCenter: 480 };

const blankReport = () => ({ id: uid('rep_'), visitId: '', patientId: '', invoiceId: '', templateKey: '', obstetric: false, formFId: '', demographics: emptyDemographics(), html: '', images: [], status: 'DRAFT', version: 1 });

// ---------------------------------------------------------------- worklist
function Worklist({ date, setDate, currentVisit, onOpen, onNew, onArchive }) {
  const visits = useColl('visits');
  const reports = useColl('reports');
  const formfs = useColl('formf');
  const rows = useMemo(() => {
    const byVisit = {};
    reports.forEach((r) => { if (r.visitId) byVisit[r.visitId] = r; });
    const ffBy = {};
    formfs.forEach((f) => { if (f.visitId) ffBy[f.visitId] = f; });
    return visits.filter((v) => v.dateKey === date && Object.keys(v.tokens || {}).some((k) => REPORT_TOKENS.includes(k)))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((v) => ({ v, r: byVisit[v.id] || null, ff: ffBy[v.id] || null }));
  }, [visits, reports, formfs, date]);
  const pending = rows.filter((x) => !x.r || x.r.status !== 'SIGNED_FINAL').length;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-line p-2.5">
        <div className="flex items-center gap-1.5">
          <IconBtn icon={ChevronLeft} size="sm" title="Previous day" onClick={() => { const d = new Date(date); d.setDate(d.getDate() - 1); setDate(dateKey(d)); }} />
          <Input type="date" size="sm" value={date} onChange={(e) => setDate(e.target.value || dateKey())} aria-label="Worklist date" />
          <IconBtn icon={ChevronRight} size="sm" title="Next day" onClick={() => { const d = new Date(date); d.setDate(d.getDate() + 1); setDate(dateKey(d)); }} />
        </div>
        <div className="flex items-center justify-between text-[11.5px]"><span className="font-semibold">{rows.length} scan(s)</span><Badge tone={pending ? 'amber' : 'emerald'}>{pending} pending</Badge></div>
        <div className="flex gap-1.5"><Button size="sm" className="flex-1" icon={Plus} onClick={onNew}>Blank</Button><Button size="sm" className="flex-1" icon={Archive} onClick={onArchive}>Archive</Button></div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {!rows.length && <Empty icon={ScanLine} title="No scans" text="Registered USG / X-ray / ECG patients appear here." />}
        {rows.map(({ v, r, ff }) => {
          const st = STATUS_META[r ? r.status : 'NONE'];
          const toks = Object.entries(v.tokens || {}).filter(([k]) => REPORT_TOKENS.includes(k)).map(([, t]) => t);
          return (
            <button key={v.id} type="button" onClick={() => onOpen(v)} className={cx('mb-1 w-full rounded-lg border p-2 text-left transition', currentVisit === v.id ? 'border-brand-400 bg-brand-50 dark:bg-brand-950/40' : 'border-line hover:border-brand-300')}>
              <div className="flex items-center gap-1.5"><span className="font-mono text-[11px] font-bold text-brand-700 dark:text-brand-300">{toks.join(' ')}</span><span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{v.patientName}</span></div>
              <div className="truncate text-[10.5px] text-muted">{(v.tests || []).filter((t) => ['Ultrasound', 'X-Ray', 'ECG', 'Echo'].includes(t.department)).map((t) => t.name).join(', ')}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <Badge tone={st.tone}>{st.label}</Badge>
                {v.obstetric && <Badge tone={ff && ff.status === 'FINAL' ? 'emerald' : 'rose'} icon={Baby}>Form F {ff ? (ff.status === 'FINAL' ? '✓' : 'draft') : 'missing'}</Badge>}
                <span className="ml-auto text-[10px] text-muted">{fmtTime(v.createdAt)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- focus macro bar
function MacroBar({ api, onPick, onPalette, onFocusChange, readOnly }) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [open, setOpen] = useState(false);
  const res = useMacroSearch(q, {}, 8, 30);
  const go = async (id, mode = 'cursor') => { const d = await macros.get(id); if (d) { onPick(d, mode); recordMacroUse(id); setQ(''); setOpen(false); } };
  return (
    <div className="relative flex items-center gap-2 border-b border-brand-200 bg-brand-50/80 px-3 py-1 dark:border-brand-900 dark:bg-brand-950/30" onMouseDown={(e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); }}>
      <Keyboard className="h-4 w-4 text-brand-600" />
      <input value={q} disabled={readOnly} onChange={(e) => { setQ(e.target.value); setHi(0); setOpen(true); }} onFocus={() => { setOpen(true); onFocusChange(true); }} onBlur={() => setTimeout(() => { setOpen(false); onFocusChange(false); }, 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(res.ids.length - 1, h + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          else if ((e.key === 'Enter' || e.key === 'Tab') && res.ids[hi] && q) { e.preventDefault(); go(res.ids[hi], e.shiftKey ? 'replace' : 'cursor'); }
          else if (e.key === 'Escape') { setQ(''); setOpen(false); api.current && api.current.focus(); }
        }}
        className="h-7 w-56 shrink-0 rounded-md border border-brand-200 bg-surface px-2 xl:w-72 text-[12.5px] outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-brand-800" placeholder="Quick macro search — inserts at your cursor…" aria-label="Quick macro search" />
      <span className="hidden min-w-0 truncate whitespace-nowrap text-[11px] text-muted md:inline" title="Type a trigger such as .abd then Space · type // (or press Ctrl+Space) in the report to search macros & templates where you are typing · F2 jumps to the next [__] · Ctrl+K opens the palette">Trigger + <span className="kbd">Space</span> · <span className="kbd">//</span> search in text · <span className="kbd">F2</span> next [__] · <button type="button" className="link" onClick={() => onPalette()}>Ctrl+K</button></span>
      {open && q && (
        <div className="absolute left-9 top-full z-40 mt-1 w-[420px] rounded-xl border border-line bg-surface p-1 shadow-pop">
          {res.ids.map((id, i) => <MacroRow key={id} meta={macros.getMeta(id)} active={i === hi} compact onClick={() => go(id)} right={<span className="text-[10px] text-muted">{i === hi ? 'Enter' : ''}</span>} />)}
          {!res.ids.length && <div className="px-3 py-2 text-xs text-muted">No match</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- selection popover
function SelectionPopover({ sel, onAction }) {
  if (!sel || sel.collapsed || !sel.text.trim()) return null;
  const top = Math.max(8, sel.rect.top - 46);
  const left = Math.min(window.innerWidth - 470, Math.max(8, sel.rect.left + sel.rect.width / 2 - 230));
  const B = ({ icon: Icon, label, a, title }) => <button type="button" title={title || label} onMouseDown={(e) => e.preventDefault()} onClick={() => onAction(a)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-white hover:bg-white/15"><Icon className="h-3.5 w-3.5" />{label}</button>;
  return (
    <div className="fixed z-[75] flex items-center gap-0.5 rounded-xl bg-slate-900/95 px-1 py-0.5 shadow-pop ring-1 ring-white/10" style={{ top, left }} role="toolbar" aria-label="Selection actions">
      <B icon={Search} label="Replace with macro" a="search" title="Search & replace the selection with a macro" />
      <B icon={Save} label="Save as macro" a="save" />
      <span className="mx-0.5 h-4 w-px bg-white/20" />
      <B icon={Bold} label="" a="bold" title="Bold" />
      <B icon={Underline} label="" a="underline" title="Underline" />
      <B icon={Heading3} label="" a="heading" title="Heading" />
      <B icon={FileText} label="Template" a="template" title="Convert to template" />
      <span className="mx-0.5 h-4 w-px bg-white/20" />
      <B icon={Sparkles} label="AI" a="ai" title="Expand / rewrite with Gemini" />
      <B icon={BookMarked} label="" a="dict" title="Add to dictionary" />
    </div>
  );
}

function SpellMenu({ ctx, onClose, onReplace, onAdd, onIgnore }) {
  const [list, setList] = useState([]);
  useEffect(() => { loadSpell().then(() => setList(suggest(ctx.word, 6))); }, [ctx.word]);
  useEffect(() => { const h = () => onClose(); window.addEventListener('mousedown', h); window.addEventListener('scroll', h, true); return () => { window.removeEventListener('mousedown', h); window.removeEventListener('scroll', h, true); }; }, [onClose]);
  return (
    <div className="fixed z-[80] w-56 rounded-xl border border-line bg-surface p-1 shadow-pop" style={{ top: Math.min(ctx.y, window.innerHeight - 260), left: Math.min(ctx.x, window.innerWidth - 240) }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-muted">{ctx.ambiguous ? 'Check usage' : 'Spelling'} · “{ctx.word}”</div>
      {list.map((s) => <button key={s} type="button" className="block w-full rounded-lg px-2 py-1 text-left text-[13px] font-semibold hover:bg-surface2" onClick={() => onReplace(s)}>{s}</button>)}
      {!list.length && <div className="px-2 py-1 text-xs text-muted">No suggestions</div>}
      <div className="my-1 border-t border-line" />
      <button type="button" className="block w-full rounded-lg px-2 py-1 text-left text-[12.5px] hover:bg-surface2" onClick={onAdd}>Add “{ctx.word}” to dictionary</button>
      <button type="button" className="block w-full rounded-lg px-2 py-1 text-left text-[12.5px] hover:bg-surface2" onClick={onIgnore}>Ignore</button>
    </div>
  );
}

// ---------------------------------------------------------------- main
export function ReportWorkstation({ route }) {
  const settings = useSettings();
  const auth = useAuth();
  useNet();
  const user = auth.principal || {};
  const canEdit = can('usg:create_and_edit_report');
  const canSign = can('usg:sign_and_lock_report');
  const isAdmin = user.role === 'SUPER_ADMIN_RADIOLOGIST';
  const lg = useMedia('(min-width: 1024px)');

  const [report, setReport] = useState(blankReport);
  const reportRef = useRef(report);
  reportRef.current = report;
  const [docKey, setDocKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const [saveState, setSaveState] = useState('unsaved');
  const editor = useRef(null);
  const insertRef = useRef(null);
  const wrap = useRef(null);
  const stored = useDoc('reports', report.id);

  const [zoomPref, setZoomPref] = useLocalPref('rw-zoom', null);
  const zoom = zoomPref || 1;
  const [view, setView] = useState('edit');
  const [guides, setGuides] = useLocalPref('rw-guides', true);
  const [showLeftPref, setShowLeft] = useLocalPref('rw-left', true);
  const [showRightPref, setShowRight] = useLocalPref('rw-right', true);
  const [leftW, setLeftW] = useLocalPref('rw-left-w', 238);
  const [rightW, setRightW] = useLocalPref('rw-right-w', 352);
  const [zoomFit, setZoomFit] = useLocalPref('rw-zoom-fit', zoomPref === null);
  const [peek, setPeek] = useState(null);
  const [rowW, setRowW] = useState(0);
  const rowRef = useRef(null);
  const mainRef = useRef(null);
  const leftPane = useRef(null);
  const rightPane = useRef(null);
  const leftPeek = useRef(null);
  const rightPeek = useRef(null);
  const fitRef = useRef(null);
  const [inline, setInline] = useState(null);
  const inlineBox = useRef(null);
  const [dicomQueue, setDicomQueue] = useState([]); // cine loops waiting for the doctor to pick frames
  const dicomOriginals = useRef(new Map());
  const [sideTab, setSideTab] = useLocalPref('rw-side', 'macros');
  const [aiTool, setAiTool] = useState('expand');
  const [macroBarOn, setMacroBarOn] = useLocalPref('rw-macrobar', true);
  const [autosave, setAutosave] = useLocalPref('rw-autosave', true);
  const [spellOn, setSpellOn] = useLocalPref('rw-spell', settings.report.spellcheck !== false);
  const [autocorrectOn, setAutocorrectOn] = useLocalPref('rw-autocorrect', settings.report.autocorrect !== false);
  const [maximized, setMaximized] = useState(!!route.query.popout);
  const [minimized, setMinimized] = useState(false);
  const [edFocus, setEdFocus] = useState(false);
  const [barFocus, setBarFocus] = useState(false);
  const [macroQuery, setMacroQuery] = useState('');
  const [sel, setSel] = useState(null);
  const [ctxWord, setCtxWord] = useState(null);
  const [painter, setPainter] = useState(null);
  const [palette, setPalette] = useState(null);
  const [macroEdit, setMacroEdit] = useState(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [hfOpen, setHfOpen] = useState(false);
  const [marginsOpen, setMarginsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [find, setFind] = useState(null);
  const [wc, setWc] = useState(null);
  const [imgBusy, setImgBusy] = useState(false);
  const [wlDate, setWlDate] = useState(dateKey());
  const [height, setHeight] = useState(760);
  // Panes dock beside the page while the page keeps at least MIN_CENTER px; otherwise they fold to a rail
  // and open over the page on demand. The tools pane (right) keeps its place first; the worklist folds first.
  const roomFor = (w, other) => !rowW || rowW - w - PANE.split - other >= PANE.minCenter;
  const rightDock = showRightPref && roomFor(rightW, PANE.rail);
  const leftDock = showLeftPref && roomFor(leftW, rightDock ? rightW + PANE.split : PANE.rail);
  const showLeft = leftDock || peek === 'left';
  const showRight = rightDock || peek === 'right';
  const leftMax = () => Math.min(PANE.leftMax, rowW - PANE.split - (rightDock ? rightW + PANE.split : PANE.rail) - PANE.minCenter);
  const rightMax = () => Math.min(PANE.rightMax, rowW - PANE.split - (leftDock ? leftW + PANE.split : PANE.rail) - PANE.minCenter);
  const openLeft = () => { if (roomFor(leftW, rightDock ? rightW + PANE.split : PANE.rail)) { setShowLeft(true); setPeek(null); } else setPeek('left'); };
  const openRight = (tab) => {
    if (tab) setSideTab(tab);
    if (roomFor(rightW, PANE.rail)) { setShowRight(true); setPeek((x) => (x === 'right' ? null : x)); } else setPeek('right');
  };
  const closePeek = useCallback(() => setPeek(null), []);
  useOutside(leftPeek, closePeek, peek === 'left');
  useOutside(rightPeek, closePeek, peek === 'right');

  const locked = report.status === 'SIGNED_FINAL';
  const readOnly = !canEdit || locked;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const layout = useMemo(() => reportLayout(report, settings), [report.layout, settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const signer = signerFor(report);
  const visit = report.visitId ? store.get('visits', report.visitId) : null;
  const ff = report.obstetric && report.visitId ? formFForVisit(report.visitId) : null;
  const holder = stored ? lockHolder('report:' + report.id) : null;
  const suggestedKeys = useMemo(() => templateKeysFor(visit), [report.visitId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- sizing (fills the viewport; maximise covers the app chrome)
  useLayoutEffect(() => {
    const f = () => {
      if (!wrap.current) return;
      if (maximized) { setHeight(window.innerHeight); return; }
      const top = wrap.current.getBoundingClientRect().top;
      setHeight(Math.max(480, window.innerHeight - top - (lg ? 10 : 70)));
    };
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, [maximized, lg, minimized]);

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((ents) => { const w = Math.round(ents[0].contentRect.width); setRowW((o) => (Math.abs(o - w) > 1 ? w : o)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [minimized]);
  // "Page width" zoom follows the centre as panes are resized, folded or the window changes
  useEffect(() => {
    const el = mainRef.current;
    if (!el || !zoomFit || typeof ResizeObserver === 'undefined') return undefined;
    let t = 0;
    let last = 0;
    const ro = new ResizeObserver((ents) => {
      const w = Math.round(ents[0].contentRect.width);
      if (Math.abs(w - last) < 4) return;
      last = w;
      clearTimeout(t);
      t = setTimeout(() => fitRef.current && fitRef.current(), 140);
    });
    ro.observe(el);
    return () => { ro.disconnect(); clearTimeout(t); };
  }, [zoomFit, minimized, view]);

  // ---------------------------------------------------------------- load / save
  const currentDoc = useCallback(() => Object.assign({}, reportRef.current, { html: editor.current ? editor.current.html() : reportRef.current.html }), []);
  const load = useCallback((doc) => {
    reportRef.current = doc;
    setReport(doc);
    setDocKey((k) => k + 1);
    setDirty(false);
    setSaveState(doc.status === 'SIGNED_FINAL' ? 'locked' : store.get('reports', doc.id) ? 'saved' : 'unsaved');
    setView('edit');
    setFind(null);
    setSel(null);
  }, []);

  const persist = useCallback((opts = {}) => {
    if (!canEdit) return null;
    const r = Object.assign({}, reportRef.current, { html: editor.current ? editor.current.html() : reportRef.current.html });
    if (r.status === 'SIGNED_FINAL' && !opts.allowLocked) return null;
    if (!r.createdAt) Object.assign(r, { createdAt: Date.now(), createdBy: user.id });
    setSaveState('saving');
    const saved = store.put('reports', r);
    if (r.visitId) { const v = store.get('visits', r.visitId); if (v && v.reportId !== r.id) store.patch('visits', v.id, { reportId: r.id }); }
    reportRef.current = saved;
    setReport(saved);
    setDirty(false);
    setSaveState(saved.status === 'SIGNED_FINAL' ? 'locked' : 'saved');
    lsSet('ssdc-pref:rw-backup', { id: saved.id, at: Date.now(), html: saved.html.length < 400000 ? saved.html : '' });
    return saved;
  }, [canEdit, user.id]);

  const flushBeforeLeave = useCallback(async () => {
    if (!dirtyRef.current || readOnly) return true;
    if (autosave) { persist(); return true; }
    return confirmDialog({ title: 'Discard unsaved changes?', message: 'This report has unsaved changes and Auto-Save is off.', confirmText: 'Discard' });
  }, [autosave, persist, readOnly]);

  const q = route.query;
  useEffect(() => {
    (async () => {
      if (!(await flushBeforeLeave())) return;
      if (q.id) { const r = store.get('reports', q.id); if (r) { load(r); if (r.visitId) { const v = store.get('visits', r.visitId); if (v) setWlDate(v.dateKey); } } else toast('Report not found on this workstation', 'warning'); return; }
      if (q.visit) {
        const ex = reportForVisit(q.visit);
        const v = store.get('visits', q.visit);
        if (v) setWlDate(v.dateKey);
        if (ex) { load(ex); return; }
        if (!v) { toast('Visit not found', 'warning'); return; }
        const fresh = newReportFor(v, store.get('patients', v.patientId));
        if (hasDynamicTokens(fresh.html)) fresh.html = await resolveTemplate(fresh.html, fresh);
        load(fresh);
        return;
      }
      if (q.new) { load(blankReport()); return; }
      const last = lsGet('ssdc-pref:rw-last', null);
      const lr = last && last.id && store.get('reports', last.id);
      if (lr) load(lr);
      else if (last && last.visitId && store.get('visits', last.visitId)) { const v = store.get('visits', last.visitId); load(reportForVisit(v.id) || newReportFor(v, store.get('patients', v.patientId))); }
    })().then(() => setTimeout(applyPending, 350));
  }, [q.id, q.visit, q.new]); // eslint-disable-line react-hooks/exhaustive-deps

  // remember the open report; apply "Paste into live report" requests coming from Macro Studio
  useEffect(() => { if (report.visitId || store.get('reports', report.id)) lsSet('ssdc-pref:rw-last', { id: report.id, visitId: report.visitId }); }, [report.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const applyPending = async () => {
    const pend = lsGet('ssdc-pref:rw-pending', null);
    if (!pend || Date.now() - pend.at > 5 * 60000) return;
    lsSet('ssdc-pref:rw-pending', null);
    const doc = pend.html ? { title: pend.title || 'content', content: pend.html } : await macros.get(pend.id);
    if (doc && insertRef.current) insertRef.current(doc, pend.mode || 'cursor');
  };

  // another workstation saved / signed / unlocked this report
  useEffect(() => {
    if (!stored || dirtyRef.current) return;
    const cur = reportRef.current;
    if (stored.updatedAt === cur.updatedAt) return;
    const htmlChanged = stored.html !== (editor.current ? editor.current.html() : cur.html);
    reportRef.current = stored;
    setReport(stored);
    setSaveState(stored.status === 'SIGNED_FINAL' ? 'locked' : 'saved');
    if (htmlChanged) setDocKey((k) => k + 1);
  }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dirty || !autosave || readOnly) return undefined;
    const t = setTimeout(() => persist(), Math.max(1, Number(settings.report.autosaveSeconds) || 2) * 1000);
    return () => clearTimeout(t);
  }, [dirty, report, autosave, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!stored || readOnly) return undefined;
    return acquireLock('report:' + report.id, (h) => toast(`${(h && h.userName) || 'Another user'} is editing this report on ${(h && h.workstation) || 'another workstation'}`, 'warning'));
  }, [report.id, !!stored, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e) => { if (dirtyRef.current && !autosave) { e.preventDefault(); e.returnValue = ''; } else if (dirtyRef.current) persist(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [autosave, persist]);

  const markDirty = () => { setDirty(true); setSaveState('unsaved'); };
  const onHtml = useCallback((html) => { setReport((r) => { const n = Object.assign({}, r, { html }); reportRef.current = n; return n; }); setDirty(true); setSaveState('unsaved'); }, []);

  // ---------------------------------------------------------------- biometry, calculations & impression
  const calcCtx = () => {
    const r = reportRef.current;
    const v = r.visitId ? store.get('visits', r.visitId) : null;
    const d = (r.demographics && r.demographics.date) || dateKey();
    return { lmp: (v && v.obstetric && v.obstetric.lmp) || '', onDate: new Date(d + 'T12:00:00'), obstetric: !!r.obstetric };
  };
  const bodyEl = () => (editor.current && editor.current.el ? editor.current.el() : null);
  const recalcAll = (announce) => {
    const root = bodyEl();
    if (!root || readOnlyRef.current) return 0;
    const n = recalcFields(root, calcCtx());
    if (n) onHtml(root.innerHTML);
    if (announce) toast(n ? n + ' calculated field' + (n === 1 ? '' : 's') + ' updated (GA, EDD, EFW)' : 'Nothing to recalculate — enter BPD, HC, AC, FL or CRL first', n ? 'success' : 'info');
    return n;
  };
  /** Placeholders, nested macros and calculated fields in a template / macro, for this report. */
  const resolveTemplate = async (html, forReport) => {
    const r = forReport || reportRef.current;
    const visit = r.visitId ? store.get('visits', r.visitId) : null;
    const root = !forReport ? bodyEl() : null;
    const calc = root ? computeCalc(root, calcCtx()) : {};
    return expandTemplateContent(html, {
      values: demographicValues({ report: r, visit, settings: getSettings() }), calc,
      getByTrigger: async (t) => { const id = macros.idForTrigger(t); return id ? macros.get(id) : null; }
    });
  };
  const autoImpression = () => {
    const root = bodyEl();
    if (!root) return;
    if (readOnlyRef.current) { toast('Report is signed & locked', 'warning'); return; }
    recalcFields(root, calcCtx());
    const r = draftImpression(root, calcCtx());
    saveSnapshot(currentDoc(), 'Before automatic impression');
    setImpression(root, r.lines);
    onHtml(root.innerHTML);
    toast('Impression drafted from the ' + (r.obstetric ? 'biometry' : 'findings') + ' — review it before signing', 'success');
  };
  const voiceRef = useRef(null);
  voiceRef.current = (text, el) => {
    const root = bodyEl();
    if (!root || !el || !(el === root || root.contains(el)) || readOnlyRef.current) return false;
    const cmd = parseReportCommand(text);
    if (cmd === 'impression') { autoImpression(); return true; }
    if (cmd === 'recalc') { recalcAll(true); return true; }
    if (cmd === 'next') { jumpPlaceholder(root, false); return true; }
    const m = parseMeasurement(text);
    if (!m) return false;
    const done = fillMeasurement(root, m, calcCtx().onDate);
    if (!done) return false;
    recalcFields(root, calcCtx());
    onHtml(root.innerHTML);
    toast('Filled ' + done, 'success', 1600);
    return true;
  };
  useEffect(() => addVoiceHandler((t, el) => voiceRef.current(t, el)), []);
  const updDemog = (patch) => { if (readOnly) return; setReport((r) => { const n = Object.assign({}, r, { demographics: Object.assign({}, r.demographics, patch) }); reportRef.current = n; return n; }); markDirty(); };
  const setLayout = (patch) => {
    setReport((r) => { const n = Object.assign({}, r, { layout: deepMerge(r.layout || {}, patch) }); reportRef.current = n; return n; });
    if (!locked) markDirty();
  };

  // ---------------------------------------------------------------- inserting
  const insertMacro = useCallback(async (doc, mode = 'cursor') => {
    if (readOnly) { toast(locked ? 'Report is signed & locked' : 'Read-only access', 'warning'); return; }
    if (!editor.current) return;
    const content = hasDynamicTokens(doc.content) ? await resolveTemplate(doc.content) : doc.content;
    if (mode === 'replace') {
      if (stripHtml(editor.current.html()).trim()) await saveSnapshot(currentDoc(), 'Before replacing with “' + doc.title + '”');
      editor.current.insert(content, 'replace');
      if (doc.key) setReport((r) => Object.assign({}, r, { templateKey: doc.key }));
    } else {
      const inner = inlineInner(content);
      const r = editor.current.range();
      const midLine = r && r.startContainer.nodeType === 3 && r.startContainer.data.trim();
      editor.current.insert(inner !== null && midLine ? inner : content);
    }
    if (/data-calc=/.test(content)) setTimeout(() => recalcAll(false), 60);
    toast((mode === 'replace' ? 'Report replaced with ' : 'Inserted ') + '“' + doc.title + '”', 'success', 1800);
  }, [readOnly, locked, currentDoc]);

  insertRef.current = insertMacro;

  // inline "//" search in the report text: the editor reports the query and forwards ↑ ↓ Enter Tab Esc
  const pickInline = useCallback(async (id, mode = 'cursor') => {
    if (!editor.current || !editor.current.takeInline()) return;
    const d = await macros.get(id);
    if (!d) return;
    recordMacroUse(id);
    await insertRef.current(d, mode);
  }, []);
  const onInline = useCallback((ev) => {
    if (ev.type === 'update') { setInline({ query: ev.query, rect: ev.rect, how: ev.how }); return true; }
    if (ev.type === 'close') { setInline(null); return true; }
    const box = inlineBox.current;
    if (!box) return false;
    if (ev.type === 'nav') { box.nav(ev.dir); return true; }
    if (ev.type === 'kind') { box.cycleKind(); return true; }
    if (ev.type === 'accept') { const id = box.current(); if (!id) return false; pickInline(id, ev.mode); return true; }
    return false;
  }, [pickInline]);

  const expandTrigger = useCallback((tok, how) => {
    const id = macros.idForTrigger(tok.token);
    const dict = !id ? dictionaryTrigger(tok.token) : null;
    if (!id && !dict) return false;
    const range = document.createRange();
    range.setStart(tok.node, tok.start);
    range.setEnd(tok.node, tok.end);
    (async () => {
      let html = '';
      if (id) { const m = await macros.get(id); html = m ? m.content : ''; recordMacroUse(id); if (hasDynamicTokens(html)) html = await resolveTemplate(html); } else html = dict.autoText ? escapeHtml(dict.autoText) : escapeHtml(dict.term);
      if (!html) return;
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(range);
      const inner = dict ? html : inlineInner(html);
      if (inner !== null) { exec('insertHTML', inner); if (how === 'space') exec('insertText', ' '); else if (how === 'enter') exec('insertParagraph'); }
      else exec('insertHTML', html);
      editor.current && editor.current.respell();
    })();
    return true;
  }, []);

  // ---------------------------------------------------------------- images: files, DICOM, auto sort
  const imageFromFile = async (f) => {
    const organ = detectOrgan(f.name);
    const acquiredAt = (await exifDate(f)) || f.lastModified || Date.now();
    const img = await addReportImage(report.id, f, { source: 'file', organ, acquiredAt });
    img.caption = autoCaption(img.caption, { organ });
    return img;
  };
  const imageFromDicom = async (dc, f, i) => {
    const sum = dicomSummary(dc);
    const organ = detectOrgan(sum.series, sum.bodyPart, sum.protocol, sum.comments, sum.study, f.name);
    const chk = dicomPatientCheck(sum, reportRef.current.demographics);
    const png = await dicomFrameFile(dc, i, f.name);
    let fileId = dicomOriginals.current.get(f);
    if (fileId === undefined) { fileId = await uploadReportOriginal(report.id, f, { originalName: f.name, patientId: report.patientId || '' }); dicomOriginals.current.set(f, fileId); }
    const img = await addReportImage(report.id, png, {
      source: 'dicom', organ, acquiredAt: frameTime(dc, i) || f.lastModified || Date.now(), frame: i + 1, frames: dc.frameCount,
      dicom: sum, dicomFileId: fileId || null, dicomName: f.name, warn: chk.ok === false ? chk.reason : ''
    });
    img.caption = autoCaption(img.caption, { organ, series: sum.series, frame: i + 1, frames: dc.frameCount });
    return img;
  };
  const commitImages = (imgs) => {
    if (!imgs.length) return;
    const html = editor.current ? editor.current.html() : reportRef.current.html;
    setReport((r) => {
      const mode = r.imageSort || settings.images.sortMode || 'auto';
      const n = Object.assign({}, r, { images: sortImages((r.images || []).concat(imgs), mode, html) });
      reportRef.current = n;
      return n;
    });
    markDirty();
    openRight('images');
    const mode = reportRef.current.imageSort || settings.images.sortMode || 'auto';
    const warn = imgs.filter((x) => x.warn).length;
    toast(imgs.length + ' image(s) attached' + (mode === 'manual' ? '' : mode === 'time' ? ', in capture order' : ', sorted by organ') + (warn ? ' — ' + warn + ' carry another patient’s name: check them' : ''), warn ? 'warning' : 'success');
  };
  const addImages = async (files) => {
    if (readOnly) return;
    setImgBusy(true);
    const out = [];
    const cine = [];
    try {
      for (const f of files) {
        try {
          if (await sniffDicom(f)) {
            const dc = await openDicom(f);
            if (dc.frameCount > 1) cine.push({ file: f, dc }); else out.push(await imageFromDicom(dc, f, 0));
          } else if (/^image\//.test(f.type || '') || /\.(jpe?g|png|bmp|gif|webp)$/i.test(f.name || '')) out.push(await imageFromFile(f));
          else toast((f.name || 'File') + ' is not an image or DICOM file', 'warning');
        } catch (e) { toast((f.name || 'Image') + ': ' + e.message, 'error'); }
      }
      commitImages(out);
      if (cine.length) { setDicomQueue((q) => q.concat(cine)); toast(cine.length + ' cine loop(s): pick the frames to attach', 'info'); }
    } finally { setImgBusy(false); }
  };
  const attachDicomFrames = async (frames) => {
    const it = dicomQueue[0];
    if (!it) return;
    const out = [];
    for (const i of frames) { try { out.push(await imageFromDicom(it.dc, it.file, i)); } catch (e) { toast('Frame ' + (i + 1) + ': ' + e.message, 'error'); } }
    commitImages(out);
    setDicomQueue((q) => q.slice(1));
  };
  const setImageSort = (mode) => {
    const html = editor.current ? editor.current.html() : reportRef.current.html;
    setReport((r) => { const n = Object.assign({}, r, { imageSort: mode, images: sortImages(r.images || [], mode, html) }); reportRef.current = n; return n; });
    markDirty();
  };
  const cloudSyncImages = async () => {
    if (!cloudTargets().length) { toast('No cloud is connected yet — set it up in Cloud Sync & Backup', 'warning'); return; }
    try {
      if (!readOnly && dirtyRef.current) persist();
      await mirrorNow('reports', report.id);
      toast('Report and images copied to the patient’s cloud folder', 'success');
    } catch (e) { toast('Cloud copy failed: ' + e.message, 'error'); }
  };
  // an image the server's inbox (cloud-synced folder) received → into this report
  const attachInboxFile = async (fd) => {
    if (readOnly) return;
    try {
      const blob = await (await fetch('api/files/' + encodeURIComponent(fd.id) + '/raw', { credentials: 'same-origin' })).blob();
      const file = new File([blob], fd.name || 'image', { type: fd.mime || blob.type, lastModified: fd.acquiredAt || fd.mtime || Date.now() });
      await addImages([file]);
      await api('images/inbox/' + encodeURIComponent(fd.id) + '/attach', { method: 'POST', body: { reportId: report.id } });
    } catch (e) { toast('Could not attach ' + (fd.name || 'image') + ': ' + e.message, 'error'); }
  };
  // captures exported by the USG console into the watched folder attach to the open patient's draft
  useEvent('usg:folder-images', (files) => {
    const d = report.demographics || {};
    if (readOnly || (!report.visitId && !String(d.name || '').trim())) { toast(files.length + ' new scan image(s) in the watched folder — open the patient’s draft report and click “Attach” in Images', 'info'); return; }
    takePending();
    addImages(files);
  });
  useEffect(() => { if (folderWatchSupported() && !watchState().active) resumeFolder(false).catch(() => {}); }, []);
  const inlineImage = async (url) => {
    if (readOnly || !url) return;
    let src = url;
    if (!/^data:/.test(url)) { const b = await (await fetch(url, { credentials: 'same-origin' })).blob(); src = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); }
    editor.current.insert(`<p style="text-align:center"><img src="${src}" style="max-width:100%;max-height:90mm"></p>`);
  };

  // ---------------------------------------------------------------- sign / unlock / compliance
  const sign = async () => {
    if (!canSign) return toast('Your role cannot sign reports', 'error');
    const r = currentDoc();
    const { blockers, warnings } = signCheck(r, settings);
    if (blockers.length) {
      const formF = blockers.some((b) => /Form-F/.test(b));
      if (formF && r.visitId && (await confirmDialog({ title: 'Cannot sign yet', message: blockers.join('\n\n'), confirmText: 'Open Form F', danger: true }))) { persist(); navigate('/formf', { visit: r.visitId }); return; }
      if (!formF) toast(blockers.join(' '), 'error', 8000);
      return;
    }
    if (!(await confirmDialog({ title: 'Sign & lock this report?', message: (warnings.length ? '⚠ ' + warnings.join('\n⚠ ') + '\n\n' : '') + `Signing as ${user.name}. Signed reports are locked; only the Super Admin can unlock them with an audit reason.`, confirmText: 'Sign & lock' }))) return;
    await saveSnapshot(r, 'Signed v' + (r.status === 'AMENDING' ? (r.version || 1) + 1 : r.version || 1));
    reportRef.current = Object.assign(r, { status: 'SIGNED_FINAL', signedBy: user.id, signedByName: user.name, signedAt: Date.now(), version: r.status === 'AMENDING' ? (r.version || 1) + 1 : r.version || 1 });
    const saved = persist({ allowLocked: true });
    if (!saved) return;
    if (saved.visitId) { const v = store.get('visits', saved.visitId); if (v) Object.keys(v.tokens || {}).filter((k) => REPORT_TOKENS.includes(k)).forEach((m) => setQueueStatus(v.id, m, 'Completed')); }
    emitEvent('report:completed', { kind: 'usg', patientName: saved.demographics.name, reportId: saved.id });
    if (!isServer()) logAudit('report:signed', 'reports/' + saved.id, { patient: saved.demographics.name, version: saved.version });
    toast('Report signed & locked (v' + saved.version + ')', 'success');
    autoDispatch('usg', saved, 'onSigned');
  };
  const unlock = async () => {
    if (!isAdmin) return toast('Only the Super Admin can unlock a signed report', 'error');
    const reason = await promptDialog({ title: 'Unlock signed report', message: 'The reason is written permanently to the audit trail.', label: 'Reason for amendment', required: true, multiline: true, rows: 3 });
    if (reason === null || reason === undefined) return;
    if (String(reason).trim().length < 5) return toast('Please give a clear reason (min 5 characters)', 'warning');
    try {
      if (isServer()) {
        const res = await api('reports/reports/' + encodeURIComponent(report.id) + '/unlock', { method: 'POST', body: { reason: String(reason).trim() } });
        store.applyRemote('reports', res.doc, true);
        load(res.doc);
      } else {
        const doc = store.put('reports', Object.assign({}, reportRef.current, { status: 'AMENDING', unlockLog: (reportRef.current.unlockLog || []).concat([{ at: Date.now(), by: user.id, byName: user.name, reason: String(reason).trim() }]) }));
        logAudit('report:unlocked', 'reports/' + doc.id, { reason });
        load(doc);
      }
      toast('Report unlocked for amendment — re-sign when done', 'info');
    } catch (e) { toast('Unlock failed: ' + e.message, 'error'); }
  };

  // ---------------------------------------------------------------- selection popover & painter
  useEffect(() => {
    if (!painter) return undefined;
    const h = () => setTimeout(() => {
      const root = editor.current && editor.current.el();
      const r = root && rangeIn(root);
      if (!r || r.collapsed) return;
      exec('styleWithCSS', true);
      if (painter.bold !== query('bold')) exec('bold');
      if (painter.italic !== query('italic')) exec('italic');
      if (painter.underline !== query('underline')) exec('underline');
      exec('foreColor', painter.color);
      if (painter.bg) exec('hiliteColor', painter.bg);
      exec('styleWithCSS', false);
      setFontSizePt(root, painter.size, r);
      if (painter.font) setFontFamily(root, painter.font);
      setPainter(null);
      toast('Formatting applied', 'success', 1200);
    }, 10);
    document.addEventListener('mouseup', h);
    return () => document.removeEventListener('mouseup', h);
  }, [painter]);
  const togglePainter = () => {
    if (painter) { setPainter(null); return; }
    const root = editor.current && editor.current.el();
    const r = root && editor.current.range();
    if (!r) return toast('Place the cursor in formatted text first', 'info');
    const el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    const cs = getComputedStyle(el);
    let bgEl = el;
    let bg = '';
    while (bgEl && bgEl !== root) { const b = getComputedStyle(bgEl).backgroundColor; if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) { bg = b; break; } bgEl = bgEl.parentElement; }
    setPainter({ bold: Number(cs.fontWeight) >= 600, italic: cs.fontStyle === 'italic', underline: /underline/.test(cs.textDecorationLine || cs.textDecoration), color: cs.color, bg, size: Math.round((parseFloat(cs.fontSize) * 72 / 96) * 2) / 2, font: el.closest('[style*="font-family"]') ? cs.fontFamily.split(',')[0].replace(/["']/g, '') : '' });
    toast('Format painter: select the text to format', 'info', 2500);
  };

  const selAction = async (a) => {
    const text = editor.current ? editor.current.selectionText() : '';
    const html = editor.current ? editor.current.selectionHtml() : '';
    if (a === 'search') setPalette({ query: text.slice(0, 60) });
    else if (a === 'save') setMacroEdit({ content: html || escapeHtml(text), title: text.trim().split(/\s+/).slice(0, 6).join(' '), kind: 'macro' });
    else if (a === 'template') setMacroEdit({ content: html, title: text.trim().split(/\s+/).slice(0, 6).join(' '), kind: 'template' });
    else if (a === 'bold' || a === 'underline') { editor.current.restore(); exec(a); }
    else if (a === 'heading') { editor.current.restore(); exec('formatBlock', 'h3'); }
    else if (a === 'ai') { openRight('copilot'); setAiTool('rewrite'); }
    else if (a === 'dict') { const w = text.trim(); if (w && w.length < 80) { addCustomWord(w); editor.current.respell(); toast('“' + w + '” added to the medical dictionary', 'success'); } }
    setSel(null);
  };

  // ---------------------------------------------------------------- actions for ribbon
  const doExport = async (fmt) => {
    try { await exportReport(currentDoc(), settings, fmt); logAudit('report:exported', 'reports/' + report.id, { format: fmt }); } catch (e) { toast('Export failed: ' + e.message, 'error'); }
  };
  const fitWidth = () => {
    const sc = wrap.current && wrap.current.querySelector('.rw-scroll');
    if (!sc) return;
    const pageW = (layout.orientation === 'landscape' ? 297 : 210) * 3.7795;
    setZoomPref(Math.max(0.5, Math.min(4, Math.floor(((sc.clientWidth - 48) / pageW) * 100) / 100)));
  };
  fitRef.current = fitWidth;
  const act = {
    autoImpression: () => autoImpression(),
    recalc: () => recalcAll(true),
    newDoc: () => navigate('/report', { new: Date.now() }),
    openArchive: () => setArchiveOpen(true),
    importFile: async () => {
      const files = await pickFiles({ accept: '.docx,.doc,.odt,.pdf,.html,.htm,.txt,.md,.rtf', multiple: true });
      for (const f of files) {
        try { const r = await fileToHtml(f); editor.current.insert(r.html); toast('Imported ' + f.name, 'success'); } catch (e) { toast(f.name + ': ' + e.message, 'error'); }
      }
    },
    save: () => { if (readOnly) return; const s = persist(); if (s) toast('Report saved', 'success', 1500); },
    saveAsTemplate: () => setMacroEdit({ content: editor.current ? editor.current.html() : report.html, title: (report.demographics.modality || 'Report') + ' – template', kind: 'template' }),
    printPreview: () => { if (editor.current) editor.current.flush(); setPreviewOpen(true); },
    print: () => printReport(currentDoc(), settings),
    quickPrint: () => printReport(currentDoc(), settings),
    exportAs: doExport,
    copyRich: async () => { await copyReportRich(currentDoc(), settings); toast('Copied — paste into MS Word or Google Docs (Ctrl+V)', 'success'); },
    googleDocs: async () => { await reportToGoogleDocs(currentDoc(), settings); toast('Report copied — press Ctrl+V in the new Google Doc', 'info', 5000); },
    email: () => setSendOpen('email'),
    send: () => setSendOpen(true),
    versions: () => setVersionsOpen(true),
    sign,
    unlock,
    paste: async () => {
      try {
        const items = await navigator.clipboard.read();
        for (const it of items) {
          if (it.types.includes('text/html')) { editor.current.insert(cleanPastedHtml(await (await it.getType('text/html')).text(), sanitizeHtml)); return; }
          if (it.types.includes('text/plain')) { editor.current.insertText(await (await it.getType('text/plain')).text()); return; }
        }
      } catch (e) { toast('Browser blocked clipboard access — use Ctrl+V', 'info'); }
    },
    painter: togglePainter,
    find: (rep) => setFind({ replace: !!rep }),
    palette: (kind) => setPalette({ kind: typeof kind === 'string' ? kind : '' }),
    clinicalTable: (k) => editor.current.insert(clinicalTableHtml(k)),
    images: () => openRight('images'),
    inlineImage: async () => { const files = await pickFiles({ accept: 'image/*' }); if (files[0]) { const r = await compressImage(files[0], 1400); inlineImage(r.dataUrl); } },
    link: async () => { const url = await promptDialog({ title: 'Insert link', label: 'URL', defaultValue: 'https://' }); if (url) { editor.current.restore(); exec('createLink', url); } },
    pcpndt: () => editor.current.insert(`<p style="font-size:10pt"><em>${escapeHtml(settings.report.pcpndtDeclaration || '')}</em></p>`),
    newMacro: () => setMacroEdit({ content: '', kind: 'template' }),
    setLayout,
    headerFooter: () => setHfOpen(true),
    layoutDefault: async () => {
      if (!(await confirmDialog({ title: 'Make this the clinic default?', message: 'Header mode, margins, font, orientation, footer and image layout of this report become the default for all new reports.', confirmText: 'Save default' }))) return;
      const L = layout;
      const tpl = !!L.fromTemplate; // keep the link to a letterhead template instead of copying its content
      saveSettings({ report: { headerMode: tpl ? 'template' : L.headerMode, letterheadId: tpl ? L.letterheadId : '', showHeader: L.showHeader, showFooter: L.showFooter, margins: L.margins, orientation: L.orientation, fontFamily: L.fontFamily, fontSize: L.fontSize, lineHeight: L.lineHeight, letterheadTop: L.letterheadTop, letterheadBottom: L.letterheadBottom, imagesPerPage: L.imagesPerPage, watermarkDrafts: L.watermarkDrafts, footerText: tpl ? settings.report.footerText : L.footerText, headerHtml: tpl ? (settings.report.headerHtml || '') : L.headerHtml || '' } });
      toast('Saved as clinic default layout', 'success');
    },
    layoutReset: () => { setReport((r) => { const n = Object.assign({}, r); delete n.layout; reportRef.current = n; return n; }); if (!locked) markDirty(); },
    margins: () => setMarginsOpen(true),
    normals: () => openRight('dictionary'),
    reference: (k) => editor.current.insert(REF_TABLES[k]),
    footnote: () => {
      const root = editor.current.el();
      const n = root.querySelectorAll('sup.fn').length + 1;
      editor.current.insert(`<sup class="fn">${n}</sup>`);
      root.insertAdjacentHTML('beforeend', `<p class="fn-note" style="font-size:9pt"><sup>${n}</sup> [__]</p>`);
      root.dispatchEvent(new Event('input', { bubbles: true }));
    },
    spellReview: () => { openRight('copilot'); setAiTool('proofread'); },
    ai: (tool) => { openRight('copilot'); setAiTool(tool); },
    addToDictionary: () => selAction('dict'),
    wordCount: async () => {
      const el = editor.current.el();
      const s = stats(el);
      let pages = '…';
      setWc({ words: s.words, chars: s.chars, paras: el.querySelectorAll('p,li,h1,h2,h3,h4').length, placeholders: placeholderCount(el.innerHTML), pages });
      try { pages = (await renderPages(currentDoc(), settings, { includeImages: false })).pageCount; setWc((w) => w && Object.assign({}, w, { pages })); } catch (e) { /* ignore */ }
    },
    toggleSpell: () => { setSpellOn(!spellOn); },
    toggleAutocorrect: () => setAutocorrectOn(!autocorrectOn),
    dictionary: () => navigate('/dictionary'),
    snapshot: async () => { await saveSnapshot(currentDoc(), 'Manual version'); toast('Version saved on this workstation', 'success'); },
    setView: (v) => { if (v === 'print') { if (editor.current) editor.current.flush(); setSel(null); setEdFocus(false); } setView(v); },
    toggleGuides: () => setGuides(!guides),
    setZoom: (z) => { setZoomFit(false); setZoomPref(Math.max(0.5, Math.min(4, Math.round(z * 100) / 100))); },
    fitWidth: () => { setZoomFit(true); fitWidth(); },
    toggleLeft: () => { if (leftDock) setShowLeft(false); else if (peek === 'left') setPeek(null); else openLeft(); },
    toggleRight: () => { if (rightDock) setShowRight(false); else if (peek === 'right') setPeek(null); else openRight(); },
    toggleMacroBar: () => setMacroBarOn(!macroBarOn),
    minimize: () => setMinimized(true),
    maximize: () => setMaximized((m) => !m),
    fullscreen: async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else { setMaximized(true); await (wrap.current || document.documentElement).requestFullscreen(); } } catch (e) { toast('Full screen is not available here', 'info'); } },
    newWindow: () => {
      if (dirtyRef.current && !readOnly) persist();
      const qs = store.get('reports', report.id) ? 'id=' + encodeURIComponent(report.id) : report.visitId ? 'visit=' + encodeURIComponent(report.visitId) : 'new=1';
      const w = window.open(location.pathname + '#/report?' + qs + '&popout=1', 'ssdc-report-' + report.id, 'popup=yes,width=1400,height=900');
      if (!w) toast('Pop-up blocked — allow pop-ups for this site', 'warning');
    },
    voice: () => events.emit('voice:toggle'),
    external: (k) => openGoogle(k),
    toggleAutosave: () => setAutosave(!autosave)
  };

  useEffect(() => { if (zoomPref === null) { const t = setTimeout(fitWidth, 120); return () => clearTimeout(t); } return undefined; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useHotkeys({
    'ctrl+s': () => { act.save(); },
    'ctrl+p': () => { act.print(); },
    'ctrl+k': () => { if (!readOnly) setPalette({}); },
    'alt+m': () => { openRight('macros'); setTimeout(() => { const el = document.getElementById('rw-macro-search'); if (el) el.focus(); }, 60); },
    'ctrl+f': () => { setFind({ replace: false }); },
    'ctrl+h': () => { if (!readOnly) setFind({ replace: true }); },
    'alt+e': () => act.ai('expand'),
    escape: () => { if (peek) { setPeek(null); return; } if (sel) { setSel(null); return; } if (painter) { setPainter(null); return; } if (find) { setFind(null); return; } if (maximized && !document.fullscreenElement) { setMaximized(false); return; } return false; }
  }, [report, readOnly, sel, painter, find, maximized, settings, layout, peek, leftDock, rightDock, rowW, rightW, leftW]);

  const showBar = macroBarOn && !readOnly && view === 'edit' && (edFocus || barFocus);
  const st = {
    readOnly, autosave, zoom, view, guides, spellOn, autocorrectOn, layout, status: report.status, canSign: canSign && !locked, canUnlock: isAdmin && locked,
    saveState: locked ? 'locked' : saveState, painter: !!painter, isAdmin: can('settings:manage_clinic_and_integrations'), showLeft, showRight, macroBar: macroBarOn, maximized, zoomFit
  };
  const d = report.demographics;
  const words = useMemo(() => wordCount(stripHtml(report.html || '')), [report.html]);
  const phs = useMemo(() => placeholderCount(report.html), [report.html]);
  const DI = (k, label, cls, type) => <input type={type || 'text'} value={d[k] || ''} onChange={(e) => updDemog({ [k]: e.target.value })} readOnly={readOnly} aria-label={label} placeholder={label} data-label={label} className={cx('input input-sm h-7 py-0', cls)} />;

  const worklist = <Worklist date={wlDate} setDate={setWlDate} currentVisit={report.visitId} onOpen={(v) => { setPeek(null); navigate('/report', { visit: v.id }); }} onNew={() => { setPeek(null); act.newDoc(); }} onArchive={() => { setPeek(null); setArchiveOpen(true); }} />;
  const sidePanel = (
    <SidePanel tab={sideTab} setTab={setSideTab} readOnly={readOnly} api={editor} report={report}
      macroQuery={macroQuery} setMacroQuery={setMacroQuery} onPick={insertMacro} onEditMacro={async (id) => setMacroEdit(await macros.get(id))} onNewMacro={(qq) => setMacroEdit({ title: qq || '', content: editor.current ? editor.current.selectionHtml() : '', kind: 'macro' })}
      suggestedKeys={suggestedKeys} aiTool={aiTool} setAiTool={setAiTool} onReplaceAll={async (html) => { await saveSnapshot(currentDoc(), 'Before Copilot replace'); editor.current.insert(html, 'replace'); }}
      onImages={(imgs) => { setReport((r) => { const n = Object.assign({}, r, { images: imgs }); reportRef.current = n; return n; }); markDirty(); }} onAddImages={addImages} imgBusy={imgBusy}
      perPage={layout.imagesPerPage} setPerPage={(n) => setLayout({ imagesPerPage: n })} onInlineImage={inlineImage}
      sortMode={report.imageSort || settings.images.sortMode || 'auto'} onSort={setImageSort} onCloudSync={cloudSyncImages} onAttachInbox={attachInboxFile} />
  );

  if (!canEdit && !can('usg:create_and_edit_report', 'READ')) return <Empty icon={Lock} title="No access" text="USG reporting requires the usg:create_and_edit_report permission." />;

  return (
    <div ref={wrap} style={{ height: minimized ? 'auto' : height }}
      className={cx('flex min-h-0 flex-col overflow-hidden border border-line bg-surface', maximized ? 'fixed inset-0 z-[65] rounded-none' : 'rounded-xl shadow-card')}>
      {/* title bar */}
      <div className="flex items-center gap-2 border-b border-line bg-gradient-to-r from-slate-900 to-sky-900 px-3 py-1.5 text-white">
        <ScanLine className="h-4 w-4 text-sky-300" />
        <span className="font-display text-[13px] font-extrabold tracking-tight">SonoReport Ultra Pro</span>
        <span className="hidden truncate text-[12px] text-sky-100 sm:inline">· {d.name || 'New report'}{d.patientId ? ' · ' + d.patientId : ''}{d.modality ? ' · ' + d.modality : ''}</span>
        <span className="ml-2 flex items-center gap-1">
          <Badge tone={(STATUS_META[report.status] || STATUS_META.DRAFT).tone} icon={locked ? Lock : undefined}>{(STATUS_META[report.status] || STATUS_META.DRAFT).label}{report.version > 1 ? ' v' + report.version : ''}</Badge>
          {report.obstetric && <button type="button" onClick={() => report.visitId && navigate('/formf', { visit: report.visitId })} title="PC-PNDT Form F for this visit"><Badge tone={ff && ff.status === 'FINAL' ? 'emerald' : 'rose'} icon={ClipboardList}>Form F {ff ? (ff.status === 'FINAL' ? 'final ✓' : 'draft') : 'missing'}</Badge></button>}
          {report.obstetric && <AntenatalChecklist report={report} settings={settings} />}
          {holder && <Badge tone="rose" icon={MonitorSmartphone}>Also open: {holder.userName || 'user'} @ {holder.workstation || 'another PC'}</Badge>}
          {painter && <Badge tone="amber">Format painter active (Esc)</Badge>}
        </span>
        <span className="ml-auto flex items-center gap-0.5">
          <button type="button" className="rounded p-1 hover:bg-white/10" title="Minimize" onClick={() => setMinimized(!minimized)}><Minimize2 className="h-3.5 w-3.5" /></button>
          <button type="button" className="rounded p-1 hover:bg-white/10" title={maximized ? 'Restore' : 'Maximize'} onClick={act.maximize}>{maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}</button>
          <button type="button" className="rounded p-1 hover:bg-white/10" title="Full screen" onClick={act.fullscreen}><Fullscreen className="h-3.5 w-3.5" /></button>
          <button type="button" className="rounded p-1 hover:bg-white/10" title="Open in a separate window" onClick={act.newWindow}><AppWindow className="h-3.5 w-3.5" /></button>
          {maximized && <button type="button" className="rounded p-1 hover:bg-white/10" title="Close full window" onClick={() => setMaximized(false)}><X className="h-3.5 w-3.5" /></button>}
        </span>
      </div>

      {minimized ? (
        <div className="flex items-center gap-3 px-4 py-3 text-sm"><Info className="h-4 w-4 text-brand-600" />Reporting window minimized{dirty ? ' (unsaved changes kept)' : ''}.<Button size="sm" variant="primary" onClick={() => setMinimized(false)}>Restore</Button></div>
      ) : (
        <>
          {/* demographics bar (two-way bound to the sheet) */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface2/70 px-3 py-1.5">
            {DI('name', 'Patient name', 'w-44 font-semibold')}
            {DI('patientId', 'Patient ID / UHID', 'w-32 font-mono')}
            {DI('age', 'Age', 'w-16')}
            <select value={d.sex || ''} disabled={readOnly} onChange={(e) => updDemog({ sex: e.target.value })} className="input input-sm h-7 w-24 py-0" aria-label="Sex"><option value="">Sex</option><option>Female</option><option>Male</option><option>Other</option></select>
            {DI('date', 'Scan date', 'w-36', 'date')}
            {DI('refBy', 'Referring doctor', 'w-44')}
            {DI('modality', 'Examination / modality', 'w-56')}
            {DI('indication', 'Clinical indication', 'min-w-[160px] flex-1')}
          </div>

          <Ribbon api={editor} st={st} act={act} />
          {find && <FindBar api={editor} replaceMode={find.replace} readOnly={readOnly} onClose={() => setFind(null)} />}
          {locked && <div className="flex flex-wrap items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12.5px] text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"><ShieldCheck className="h-4 w-4" />Signed by <b>{report.signedByName}</b> on {fmtDate(report.signedAt)} {fmtTime(report.signedAt)} — locked.{isAdmin && <Button size="sm" className="ml-auto" onClick={unlock}>Unlock for amendment</Button>}<Button size="sm" variant="primary" className={isAdmin ? '' : 'ml-auto'} onClick={() => setSendOpen(true)}>Send to patient</Button></div>}
          {report.status === 'AMENDING' && <div className="border-b border-violet-200 bg-violet-50 px-3 py-1.5 text-[12.5px] text-violet-900 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200">Amending a previously signed report (v{report.version}) — sign again to issue v{(report.version || 1) + 1}. Reason: {((report.unlockLog || []).slice(-1)[0] || {}).reason || '—'}</div>}

          <div ref={rowRef} className="relative flex min-h-0 flex-1">
            {leftDock ? (
              <>
                <aside ref={leftPane} style={{ width: leftW }} className="min-w-0 shrink-0 overflow-hidden" aria-label="Worklist">{worklist}</aside>
                <PaneSplitter side="left" paneRef={leftPane} width={leftW} min={PANE.leftMin} max={leftMax} onResize={setLeftW} onCollapse={() => setShowLeft(false)} label="worklist" />
              </>
            ) : (
              <div ref={leftPeek} className="relative z-[25] flex shrink-0">
                <PaneRail side="left" label="Worklist" icon={Users} open={peek === 'left'} onOpen={() => (peek === 'left' ? setPeek(null) : openLeft())} />
                {peek === 'left' && <aside className="absolute inset-y-0 left-full border-r border-line bg-surface shadow-pop" style={{ width: Math.max(220, Math.min(leftW, rowW - 90)) }} aria-label="Worklist">{worklist}</aside>}
              </div>
            )}
            <main ref={mainRef} className="flex min-w-0 flex-1 flex-col">
              {showBar && <MacroBar api={editor} onPick={insertMacro} onPalette={() => setPalette({})} onFocusChange={setBarFocus} readOnly={readOnly} />}
              <div className="min-h-0 flex-1">
                {view === 'print' ? (
                  <div className="h-full overflow-auto bg-slate-200/70 p-4 dark:bg-slate-950/70"><PagesView report={report} settings={settings} zoom={zoom === 1 ? 'fit' : zoom} /></div>
                ) : (
                  <DocEditor ref={editor} docKey={report.id + ':' + docKey} initialHtml={report.html} readOnly={readOnly} zoom={zoom} layout={layout} settings={settings} report={report} signer={signer} guides={guides}
                    spellOn={spellOn} autocorrectOn={autocorrectOn} onDemographics={updDemog} onChange={onHtml} expandTrigger={expandTrigger} onImagePaste={addImages} onInline={onInline}
                    onFocusChange={(f) => { if (f) setEdFocus(true); else setTimeout(() => setEdFocus(false), 180); }}
                    onSelect={(s) => setSel(s.collapsed ? null : s)} onContextWord={setCtxWord} />
                )}
              </div>
            </main>
            {rightDock ? (
              <>
                <PaneSplitter side="right" paneRef={rightPane} width={rightW} min={PANE.rightMin} max={rightMax} onResize={setRightW} onCollapse={() => setShowRight(false)} label="tools panel" />
                <aside ref={rightPane} style={{ width: rightW }} className="min-w-0 shrink-0 overflow-hidden" aria-label="Tools panel">{sidePanel}</aside>
              </>
            ) : (
              <div ref={rightPeek} className="relative z-[25] flex shrink-0">
                {peek === 'right' && <aside className="absolute inset-y-0 right-full border-l border-line bg-surface shadow-pop" style={{ width: Math.max(280, Math.min(rightW, rowW - 90)) }} aria-label="Tools panel">{sidePanel}</aside>}
                <PaneRail side="right" label="Tools" icon={Layers} items={SIDE_TABS} activeId={sideTab} open={peek === 'right'}
                  onOpen={(tab) => { if (peek === 'right' && (!tab || tab === sideTab)) setPeek(null); else openRight(tab); }} />
              </div>
            )}
          </div>

          {/* status bar */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-line bg-surface2/80 px-3 py-1 text-[11px] text-muted">
            <span className="tnum">{words.toLocaleString('en-IN')} words</span>
            {phs > 0 && <button type="button" className="font-semibold text-amber-700 dark:text-amber-300" onClick={() => { editor.current && editor.current.focus(); }} title="Press F2 to jump">{phs} [__] to fill (F2)</button>}
            <span>{(report.images || []).length} image(s)</span>
            <span>{layout.orientation === 'landscape' ? 'A4 landscape' : 'A4 portrait'} · {layout.fromTemplate ? 'letterhead: ' + (layout.templateName || 'template') : layout.headerMode === 'letterhead' ? 'pre-printed letterhead' : layout.headerMode === 'none' ? 'no header' : 'colour letterhead'}</span>
            <span>Spell {spellOn ? 'on' : 'off'} · Autocorrect {autocorrectOn ? 'on' : 'off'}</span>
            <span className="ml-auto flex items-center gap-2">
              <span>{saveState === 'saved' && report.updatedAt ? 'Saved ' + fmtTime(report.updatedAt) : saveState === 'saving' ? 'Saving…' : locked ? 'Signed & locked' : autosave ? 'Auto-save on' : 'Auto-save off'}</span>
              <button type="button" className="rounded px-1 hover:bg-surface" onClick={() => act.setZoom(zoom - 0.1)}>−</button>
              <input type="range" min="50" max="400" step="5" value={Math.round(zoom * 100)} onChange={(e) => act.setZoom(Number(e.target.value) / 100)} className="w-24 accent-brand-600" aria-label="Zoom level" />
              <button type="button" className="rounded px-1 hover:bg-surface" onClick={() => act.setZoom(zoom + 0.1)}>+</button>
              <span className="w-10 text-right tnum">{Math.round(zoom * 100)}%</span>
            </span>
          </div>
        </>
      )}

      <SelectionPopover sel={edFocus && !readOnly && view === 'edit' && !minimized ? sel : null} onAction={selAction} />
      {ctxWord && (
        <SpellMenu ctx={ctxWord} onClose={() => setCtxWord(null)}
          onReplace={(s) => { const r = ctxWord.range; const se = window.getSelection(); se.removeAllRanges(); se.addRange(r); exec('insertText', s); setCtxWord(null); editor.current.respell(); }}
          onAdd={() => { addCustomWord(ctxWord.word); setCtxWord(null); setTimeout(() => editor.current.respell(), 50); toast('“' + ctxWord.word + '” added to the dictionary', 'success'); }}
          onIgnore={() => { ignoreWord(ctxWord.word); setCtxWord(null); editor.current.respell(); }} />
      )}
      {dicomQueue.length > 0 && (
        <DicomViewer item={dicomQueue[0]} position={1} total={dicomQueue.length} demographics={report.demographics} readOnly={readOnly}
          onAttach={attachDicomFrames} onSkip={() => setDicomQueue((q) => q.slice(1))} onClose={() => setDicomQueue([])} />
      )}
      <InlineMacroSearch ref={inlineBox} state={!readOnly && view === 'edit' && !minimized ? inline : null} suggestedKeys={suggestedKeys}
        onPick={(id, mode) => pickInline(id, mode)} onClose={() => editor.current && editor.current.closeInline()} />
      <MacroPalette open={!!palette} onClose={() => { setPalette(null); setTimeout(() => editor.current && editor.current.focus(), 30); }} initialQuery={(palette && palette.query) || ''} kind={(palette && palette.kind) || ''} onPick={insertMacro} onNew={(qq) => setMacroEdit({ title: qq, content: '', kind: 'macro' })} />
      <MacroEditorModal open={!!macroEdit} initial={macroEdit} onClose={() => setMacroEdit(null)} onInject={readOnly ? null : (doc) => insertMacro(doc, 'cursor')} />
      <ArchiveDrawer open={archiveOpen} onClose={() => setArchiveOpen(false)} currentId={report.id} onOpen={(r) => { setArchiveOpen(false); navigate('/report', { id: r.id }); }} />
      <VersionsDrawer open={versionsOpen} onClose={() => setVersionsOpen(false)} report={report} readOnly={readOnly} onRestore={async (s) => { await saveSnapshot(currentDoc(), 'Before restoring ' + s.label); editor.current.setHtml(s.html); toast('Version restored', 'success'); }} />
      <HeaderFooterDialog open={hfOpen} onClose={() => setHfOpen(false)} layout={layout} settings={settings} isAdmin={can('settings:manage_clinic_and_integrations')}
        onApply={(l) => setLayout({ headerMode: l.headerMode, letterheadId: l.letterheadId || '', showHeader: l.showHeader, showFooter: l.showFooter, showDemographics: l.showDemographics, letterheadTop: l.letterheadTop, letterheadBottom: l.letterheadBottom, footerText: l.footerText, headerHtml: l.headerHtml || '' })}
        onSaveDefault={(l) => { saveSettings({ report: { headerMode: l.headerMode, letterheadId: l.letterheadId || '', showHeader: l.showHeader, showFooter: l.showFooter, letterheadTop: l.letterheadTop, letterheadBottom: l.letterheadBottom, footerText: l.footerText, headerHtml: l.headerHtml || '' } }); toast('Header & footer saved as clinic default', 'success'); }} />
      <MarginsDialog open={marginsOpen} onClose={() => setMarginsOpen(false)} margins={layout.margins} onApply={(m) => setLayout({ margins: m })} />
      {previewOpen && <PreviewModal open onClose={() => setPreviewOpen(false)} report={report} settings={settings} />}
      <SendReportDialog open={!!sendOpen} onClose={() => setSendOpen(false)} report={sendOpen ? currentDoc() : null} />
      {wc && (
        <Modal open onClose={() => setWc(null)} size="sm" title="Word count" icon={FileText} footer={<Button onClick={() => setWc(null)}>Close</Button>}>
          <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
            <dt className="text-muted">Words</dt><dd className="text-right font-semibold tnum">{wc.words.toLocaleString('en-IN')}</dd>
            <dt className="text-muted">Characters (no spaces)</dt><dd className="text-right font-semibold tnum">{wc.chars.toLocaleString('en-IN')}</dd>
            <dt className="text-muted">Paragraphs</dt><dd className="text-right font-semibold tnum">{wc.paras}</dd>
            <dt className="text-muted">Unfilled placeholders</dt><dd className="text-right font-semibold tnum">{wc.placeholders}</dd>
            <dt className="text-muted">Printed A4 pages</dt><dd className="text-right font-semibold tnum">{wc.pages}</dd>
          </dl>
        </Modal>
      )}
    </div>
  );
}

