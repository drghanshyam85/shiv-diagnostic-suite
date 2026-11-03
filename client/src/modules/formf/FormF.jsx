// PC-PNDT Form F: auto-filled from registration, LMP / EDD / GA calculator, GA-based indications,
// visibility manager, "Edit Anything" inline editing on the A4 preview, front / back / duplex printing,
// finalise & lock with audited amendments, and the searchable Form F register.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Printer, FileDown, Save, Lock, BookOpen, Settings2, PenLine, Eraser, FileJson, FileSpreadsheet, Search, CheckCircle2, AlertTriangle, ShieldCheck, Undo2, ZoomIn, ZoomOut, Maximize2, Baby, UserRound, PencilLine, RefreshCw, MonitorSmartphone, Info, Download } from 'lucide-react';
import { useColl, useDoc, useSettings, useLocalPref, useHotkeys, navigate } from '../../core/hooks';
import { store } from '../../core/store';
import { can, currentUser } from '../../core/auth';
import { isServer, useNet, acquireLock, lockHolder } from '../../core/sync';
import { dateKey, fmtDate, fmtTime, deepMerge, fullName, escapeHtml } from '../../core/utils';
import { MM, printHtml } from '../../core/print';
import { htmlToPdf } from '../../core/pdf';
import { newFormFRecord, normalizeFormF, deriveFormF, formFFromVisit, formFForVisit, isObstetricVisit, pendingFormFVisits, previewFormFSno, allocateFormFSno, validateFormF, gaText, logFormF, impressionFromReport, previousFormFDefaults, applyDefaults } from '../../core/formf';
import { formFHtml, fitFormF, cleanEdit, FF_TEXT } from './formfHtml';
import { SectionA, SectionB, SectionC, SectionD } from './FormFEntry';
import { FormFRegister, exportFormFJson, exportFormFCsv } from './FormFRegister';
import { FormFCustomize } from './FormFCustomize';
import { cx, PageHeader, Card, Button, IconBtn, Badge, Toggle, Checkbox, Segmented, Combobox, Menu, toast, confirmDialog, promptDialog } from '../../components/ui';

const pagesFor = (v) => (v === 'front' ? ['front'] : v === 'back' ? ['back'] : ['front', 'back']);

/** A4 pages scaled to the preview column; re-fits fonts whenever the markup changes. */
function FormFPreview({ html, fontPt, zoom, onClick, onInput, onKeyDown }) {
  const outer = useRef(null);
  const inner = useRef(null);
  const [w, setW] = useState(760);
  const [h, setH] = useState(1123);
  useLayoutEffect(() => {
    if (!inner.current) return;
    fitFormF(inner.current, fontPt);
    setH(inner.current.offsetHeight);
  }, [html, fontPt]);
  // the Devanagari / serif web fonts may finish loading after the first fit: fit again so the preview
  // matches the printed page exactly
  useEffect(() => {
    let alive = true;
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (alive && inner.current) { fitFormF(inner.current, fontPt); setH(inner.current.offsetHeight); } });
    return () => { alive = false; };
  }, [html, fontPt]);
  useEffect(() => {
    if (!outer.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(outer.current);
    return () => ro.disconnect();
  }, []);
  const pageW = 210 * MM;
  const k = zoom === 'fit' ? Math.min(1.6, Math.max(0.3, w / pageW)) : zoom;
  return (
    <div ref={outer} className="ff-preview w-full">
      <div style={{ width: pageW * k, height: h * k, margin: '0 auto', position: 'relative' }}>
        <div ref={inner} style={{ width: pageW, transform: `scale(${k})`, transformOrigin: 'top left', position: 'absolute', left: 0, top: 0 }}
          onClick={onClick} onInput={onInput} onKeyDown={onKeyDown} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

/** A page whose text still does not fit at the smallest size would lose its last lines in print. */
function warnOverflow(pages) {
  if (pages) toast('Form F: some text is too long to fit on ' + (pages > 1 ? pages + ' pages' : 'one page') + ' even at the smallest size — shorten the address, result or notes so nothing is cut off', 'warning', 8000);
}

export function FormF({ route }) {
  const settings = useSettings();
  const [localPrefs, setLocalPrefs] = useLocalPref('formf-prefs', {});
  const [localEdits, setLocalEdits] = useLocalPref('formf-edits', {});
  const prefs = useMemo(() => deepMerge(settings.formF, localPrefs || {}), [settings.formF, localPrefs]);
  const setPrefs = useCallback((patch) => setLocalPrefs((old) => deepMerge(old || {}, patch)), [setLocalPrefs]);
  const defaultEdits = useMemo(() => Object.assign({}, settings.formF.customEdits || {}, localEdits || {}), [settings.formF.customEdits, localEdits]);

  const [rec, setRec] = useState(() => normalizeFormF(newFormFRecord()));
  const recRef = useRef(rec);
  recRef.current = rec;
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const [editMode, setEditMode] = useState(false);
  const pending = useRef({});
  const [pendingN, setPendingN] = useState(0);
  const [amend, setAmend] = useState(null);
  const [view, setView] = useLocalPref('formf-view', 'both');
  const [zoom, setZoom] = useLocalPref('formf-zoom', 'fit');
  const [pane, setPane] = useState('form');
  const [regOpen, setRegOpen] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [nextSno, setNextSno] = useState('');
  const [saving, setSaving] = useState(false);
  useNet();
  const stored = useDoc('formf', rec.id);
  const visits = useColl('visits');
  const formfs = useColl('formf');
  const reports = useColl('reports');
  const users = useColl('users');
  const patients = useColl('patients');

  const canDraft = can('pcpndt:manage_form_f_register', 'DRAFT');
  const canFull = can('pcpndt:manage_form_f_register');
  const isFinal = rec.status === 'FINAL';
  const readOnly = !canDraft || (isFinal && !amend);
  const d = rec.data;

  // ---------------------------------------------------------------- loading
  const load = useCallback((r) => {
    pending.current = {};
    setPendingN(0);
    setEditMode(false);
    setAmend(null);
    const n = normalizeFormF(r);
    recRef.current = n;
    setRec(n);
    setDirty(false);
  }, []);
  const fromVisit = useCallback((visit, patient) => {
    const r = normalizeFormF(newFormFRecord(visit ? visit.dateKey : dateKey()));
    Object.assign(r, { visitId: visit ? visit.id : '', patientId: patient.id, regnNo: patient.regId || '' });
    if (prefs.autoFill !== false) r.data = deriveFormF(Object.assign(r.data, formFFromVisit(visit, patient, prefs.autoFillSections || {})), { autoIndications: prefs.autoIndications !== false });
    // repeatable details (husband, address, ID, children, referral) from this patient's previous Form F
    const prev = previousFormFDefaults(patient.id, r.id);
    if (prev) {
      const res = applyDefaults(r.data, prev.values);
      if (res.used.length) {
        r.data = deriveFormF(res.data, { autoIndications: prefs.autoIndications !== false });
        r.prefilledFrom = { id: prev.from.id, sno: prev.from.snoLabel || '', date: prev.from.data.procedureDate || '', fields: res.used };
      }
    }
    return r;
  }, [prefs]);
  const guard = async () => !dirtyRef.current || readOnly || confirmDialog({ title: 'Discard unsaved changes?', message: 'The Form F on screen has unsaved changes.', confirmText: 'Discard' });
  const openVisit = async (visitId, { skipGuard } = {}) => {
    if (!skipGuard && !(await guard())) return;
    const ex = formFForVisit(visitId);
    if (ex) { load(ex); return; }
    const v = store.get('visits', visitId);
    const p = v && store.get('patients', v.patientId);
    if (!v || !p) { toast('Visit not found on this workstation', 'warning'); return; }
    load(fromVisit(v, p));
    setDirty(true);
    toast(prefs.autoFill !== false ? `Form F auto-filled for ${fullName(p)}` : `${fullName(p)} bound — auto-fill is off`, 'info');
  };
  const openPatient = async (patientId) => {
    if (!(await guard())) return;
    const p = store.get('patients', patientId);
    if (!p) return;
    const v = store.list('visits').filter((x) => x.patientId === p.id && isObstetricVisit(x)).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (v) { openVisit(v.id, { skipGuard: true }); return; }
    load(fromVisit(null, p));
    setDirty(true);
  };
  const openRecord = async (r) => { if (r.id !== recRef.current.id && !(await guard())) return; load(r); setRegOpen(false); setPane('form'); };

  const q = route.query;
  useEffect(() => {
    if (q.id) { const r = store.get('formf', q.id); if (r) load(r); else toast('Form F record not found', 'warning'); }
    else if (q.visit) openVisit(q.visit, { skipGuard: true });
    else if (q.patient) openPatient(q.patient);
  }, [q.id, q.visit, q.patient]); // eslint-disable-line react-hooks/exhaustive-deps

  // another workstation saved this record while we are not editing → refresh
  useEffect(() => {
    if (stored && !dirtyRef.current && !editMode && stored.updatedAt !== recRef.current.updatedAt) { const n = normalizeFormF(stored); recRef.current = n; setRec(n); }
  }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    if (!rec.snoLabel) previewFormFSno(d.procedureDate || dateKey()).then((s) => { if (alive) setNextSno(s + ' (auto)'); }).catch(() => {});
    return () => { alive = false; };
  }, [rec.snoLabel, d.procedureDate, formfs.length]);

  useEffect(() => {
    if (!stored || readOnly) return undefined;
    return acquireLock('formf:' + rec.id, (h) => toast(`${(h && h.userName) || 'Another user'} is editing this Form F on ${(h && h.workstation) || 'another workstation'}`, 'warning'));
  }, [rec.id, !!stored, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  const holder = stored ? lockHolder('formf:' + rec.id) : null;

  // ---------------------------------------------------------------- editing
  const upd = useCallback((patch) => {
    setRec((r) => { const n = Object.assign({}, r, { data: deriveFormF(Object.assign({}, r.data, patch), { autoIndications: prefs.autoIndications !== false }) }); recRef.current = n; return n; });
    setDirty(true);
  }, [prefs.autoIndications]);
  const updTop = useCallback((patch) => { setRec((r) => { const n = Object.assign({}, r, patch); recRef.current = n; return n; }); setDirty(true); }, []);

  const commitEdits = useCallback(() => {
    const p = pending.current;
    pending.current = {};
    setPendingN(0);
    const base = recRef.current.customEdits || {};
    if (!Object.keys(p).length) return base;
    const merged = Object.assign({}, base);
    Object.entries(p).forEach(([k, v]) => {
      const c = cleanEdit(v);
      const def = defaultEdits[k] !== undefined ? defaultEdits[k] : FF_TEXT[k] !== undefined ? escapeHtml(FF_TEXT[k]) : null;
      if (def !== null && c === def) delete merged[k]; else merged[k] = c;
    });
    const n = Object.assign({}, recRef.current, { customEdits: merged });
    recRef.current = n;
    setRec(n);
    setDirty(true);
    return merged;
  }, [defaultEdits]);
  const toggleEdit = () => {
    if (!editMode && readOnly) { toast(isFinal ? 'Form F is final — click Amend first' : 'Your role cannot edit Form F', 'warning'); return; }
    if (editMode) commitEdits();
    setEditMode(!editMode);
  };
  const clearEdits = async () => {
    if (!(await confirmDialog({ title: 'Remove wording edits?', message: 'All direct edits made on this record’s A4 form are removed (saved workstation / clinic defaults stay).', confirmText: 'Remove edits' }))) return;
    pending.current = {};
    setPendingN(0);
    updTop({ customEdits: {} });
  };

  // ---------------------------------------------------------------- save / finalise / amend
  const save = async ({ finalize = false, quiet = false, auto = false } = {}) => {
    if (!canDraft) { if (!auto) toast('Your role cannot edit Form F', 'error'); return null; }
    const edits = auto ? recRef.current.customEdits || {} : commitEdits();
    const r = Object.assign({}, recRef.current, { customEdits: edits });
    if (r.status === 'FINAL' && !amend) return null;
    if (finalize) {
      if (!canFull) { toast('Only the radiologist (FULL access) can finalise Form F', 'error'); return null; }
      const { errors, warnings } = validateFormF(r);
      if (errors.length) { toast('Complete before finalising: ' + errors.join(' · '), 'warning', 8000); return null; }
      if (!(await confirmDialog({ title: 'Finalise & lock Form F?', message: (warnings.length ? 'Please review:\n• ' + warnings.join('\n• ') + '\n\n' : '') + 'Once final, only the radiologist can amend it and every amendment is audit-logged.', confirmText: 'Finalise & lock' }))) return null;
    }
    if (!auto) setSaving(true);
    try {
      if (!r.snoLabel && !auto) Object.assign(r, await allocateFormFSno(r.data.procedureDate || dateKey()));
      else if (r.snoLabel && !auto) {
        const dup = store.list('formf').find((x) => x.id !== r.id && x.snoLabel === r.snoLabel);
        if (dup) toast(`Reg. SNo ${r.snoLabel} is also used by ${dup.data && dup.data.patientName} — please check`, 'warning', 6000);
      }
      r.date = r.data.procedureDate || r.date;
      if (!r.createdAt) Object.assign(r, { createdAt: Date.now(), createdBy: (currentUser() || {}).id });
      if (finalize) Object.assign(r, { status: 'FINAL', finalizedAt: Date.now(), finalizedBy: (currentUser() || {}).id });
      if (amend && r.status === 'FINAL') r.amendLog = (r.amendLog || []).concat([{ at: Date.now(), by: (currentUser() || {}).id, reason: amend.reason }]);
      const saved = store.put('formf', r);
      if (r.visitId) { const v = store.get('visits', r.visitId); if (v && v.formFId !== r.id) store.patch('visits', v.id, { formFId: r.id }); }
      const n = normalizeFormF(saved);
      recRef.current = n;
      setRec(n);
      setDirty(false);
      if (amend) setAmend(null);
      if (!isServer() && (finalize || amend)) logFormF(finalize ? 'formf:finalized' : 'formf:amended', saved, amend ? { reason: amend.reason } : {});
      if (!auto && !quiet) toast(finalize ? `Form F ${saved.snoLabel} finalised & locked` : amend ? `Amendment saved to Form F ${saved.snoLabel}` : `Form F ${saved.snoLabel} saved`, 'success');
      return saved;
    } catch (e) {
      toast('Could not save Form F: ' + e.message, 'error');
      return null;
    } finally { if (!auto) setSaving(false); }
  };
  useEffect(() => {
    if (!dirty || !stored || readOnly || editMode || rec.status === 'FINAL') return undefined;
    const t = setTimeout(() => { save({ auto: true }); }, 2500);
    return () => clearTimeout(t);
  }, [rec, dirty, !!stored, readOnly, editMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const startAmend = async () => {
    const reason = await promptDialog({ title: 'Amend final Form F', message: 'Amendments to a statutory record are audit-logged with your name and time.', label: 'Reason for amendment', required: true, placeholder: 'e.g. LMP corrected after patient produced ANC card' });
    if (reason === null || reason === undefined) return;
    if (String(reason).trim().length < 5) { toast('Please state a clear reason (at least 5 characters)', 'warning'); return; }
    setAmend({ reason: String(reason).trim() });
  };
  const cancelAmend = () => { const s = store.get('formf', rec.id); if (s) load(s); else setAmend(null); };
  const reset = async () => {
    if (!(await guard())) return;
    load(newFormFRecord());
    if (q.id || q.visit || q.patient) navigate('/formf');
  };

  // ---------------------------------------------------------------- print / PDF
  const radiologist = users.find((u) => u.role === 'SUPER_ADMIN_RADIOLOGIST' && u.digitalSignatureUrl);
  const sigUrl = radiologist ? radiologist.digitalSignatureUrl : '';
  const outputFor = async (target) => {
    if (target) return normalizeFormF(target);
    const edits = commitEdits();
    let r = Object.assign({}, recRef.current, { customEdits: edits });
    if (canDraft && !readOnly && (dirtyRef.current || !stored || !r.snoLabel)) { const s = await save({ quiet: true }); if (!s) return null; r = s; }
    return normalizeFormF(r);
  };
  const markPrinted = (r, which) => {
    if (!store.get('formf', r.id)) return;
    store.patch('formf', r.id, { printedAt: Date.now(), printLog: (r.printLog || []).concat([{ at: Date.now(), by: (currentUser() || {}).id, pages: which }]).slice(-20) });
  };
  const doPrint = async (which = 'duplex', target) => {
    const r = await outputFor(target);
    if (!r) return;
    const html = formFHtml(r, { settings, prefs, edits: Object.assign({}, defaultEdits, r.customEdits), pages: pagesFor(which), signatureUrl: sigUrl });
    await printHtml({ html, widthMm: 210, heightMm: 297, title: `Form F ${r.snoLabel || ''} ${r.data.patientName || ''}`.trim(), audit: { action: 'formf:printed', target: 'formf/' + r.id, meta: { pages: which, sno: r.snoLabel } }, prepare: (root) => warnOverflow(fitFormF(root, prefs.fontPt)) });
    markPrinted(r, which);
  };
  const doPdf = async (which = 'duplex') => {
    const r = await outputFor();
    if (!r) return;
    const html = formFHtml(r, { settings, prefs, edits: Object.assign({}, defaultEdits, r.customEdits), pages: pagesFor(which), signatureUrl: sigUrl });
    try {
      await htmlToPdf(html, { widthMm: 210, heightMm: 297, filename: `FormF_${(r.snoLabel || 'draft').replace(/\//g, '-')}_${(r.data.patientName || 'patient').replace(/\s+/g, '_')}.pdf`, prepare: (root) => warnOverflow(fitFormF(root, prefs.fontPt)) });
      logFormF('formf:pdf_exported', r, { pages: which });
    } catch (e) { toast('PDF export failed: ' + e.message, 'error'); }
  };

  useHotkeys({
    'ctrl+s': () => { save(); },
    'ctrl+p': () => { doPrint('duplex'); },
    'alt+n': () => { reset(); },
    'alt+e': () => { toggleEdit(); }
  }, [rec, amend, editMode, readOnly, prefs, defaultEdits]);

  // ---------------------------------------------------------------- preview
  const editsAll = useMemo(() => Object.assign({}, defaultEdits, rec.customEdits), [defaultEdits, rec.customEdits]);
  const html = useMemo(() => formFHtml(rec, { settings, prefs, edits: Object.assign({}, editsAll, pending.current), editMode, interactive: !readOnly, pages: pagesFor(view), signatureUrl: sigUrl }),
    [rec, settings, prefs, editsAll, editMode, readOnly, view, sigUrl]);
  const onPreviewClick = (e) => {
    if (editMode || readOnly) return;
    const t = e.target.closest('[data-ind],[data-proc],[data-toggle]');
    if (!t) return;
    if (t.dataset.ind) {
      const n = Number(t.dataset.ind);
      const ind = d.indications || [];
      upd({ indicationsManual: true, indications: ind.includes(n) ? ind.filter((x) => x !== n) : ind.concat([n]).sort((a, b) => a - b) });
    } else if (t.dataset.proc === 'us') upd({ procUltrasound: !d.procUltrasound });
    else if (t.dataset.proc === 'other') upd({ procOther: !d.procOther });
    else if (t.dataset.toggle) upd({ [t.dataset.toggle]: d[t.dataset.toggle] === 'YES' ? 'NO' : 'YES' });
  };
  const onPreviewInput = (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[data-edit]') : null;
    if (!el) return;
    pending.current[el.dataset.edit] = el.innerHTML;
    setPendingN(Object.keys(pending.current).length);
  };
  const onPreviewKey = (e) => {
    if (!editMode) return;
    if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); }
  };
  const nEdits = Object.keys(rec.customEdits || {}).length + pendingN;
  const check = useMemo(() => validateFormF(rec), [rec]);
  const missingSet = useMemo(() => new Set(check.missing), [check]);
  const total = 10;
  const done = total - check.errors.length;
  const nextMissing = () => {
    const el = document.querySelector('.ff-entry .ff-miss');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // prefer an empty text box (e.g. the name after an already-chosen Mrs./Mr. title), then any field
    const fields = Array.from(el.querySelectorAll('input:not([type=checkbox]):not([disabled]):not([readonly]), textarea'));
    const f = fields.find((x) => !x.value) || fields[0] || el.querySelector('select') || el.querySelector('[role=checkbox], button');
    if (f) setTimeout(() => f.focus(), 250);
  };

  // ---------------------------------------------------------------- source pickers
  const pendingList = useMemo(() => pendingFormFVisits(7), [visits, formfs]); // eslint-disable-line react-hooks/exhaustive-deps
  const femalePatients = useMemo(() => patients.filter((p) => p.gender !== 'Male').sort((a, b) => (b.lastVisitAt || 0) - (a.lastVisitAt || 0)), [patients]);
  const report = rec.visitId ? reports.find((x) => x.visitId === rec.visitId) : null;
  const useReport = () => {
    const imp = report && impressionFromReport(report.html);
    if (!imp) { toast('No IMPRESSION section found in the USG report yet', 'info'); return; }
    upd({ result: imp });
    toast('Item 14 filled from the report impression', 'success');
  };
  const reapply = () => {
    const p = store.get('patients', rec.patientId);
    if (!p) { toast('Select a registered patient first', 'info'); return; }
    upd(formFFromVisit(rec.visitId ? store.get('visits', rec.visitId) : null, p, prefs.autoFillSections || {}));
    updTop({ regnNo: p.regId || rec.regnNo });
    toast('Auto-fill re-applied from registration', 'success');
  };
  const finalBy = rec.finalizedBy ? users.find((u) => u.id === rec.finalizedBy) : null;
  const statusLine = isFinal ? 'Final & locked' : dirty ? (stored ? 'Unsaved changes · autosaving…' : 'Not saved yet') : stored ? 'Draft saved ' + fmtTime(rec.updatedAt) : 'New form';

  return (
    <div className="mx-auto max-w-[1700px]">
      <PageHeader title="PC-PNDT Form F" icon={ClipboardList}
        subtitle={`Rule 9(4) record · ${rec.snoLabel ? 'Reg. SNo ' + rec.snoLabel : 'new record'}${d.patientName ? ' · ' + [d.patientTitle, d.patientName].join(' ') : ''}`}
        actions={<>
          <Button icon={BookOpen} onClick={() => setRegOpen(true)}>Form F register <Badge tone="slate">{formfs.length}</Badge></Button>
          <Button icon={Settings2} onClick={() => setCustOpen(true)}>Customise</Button>
          <Menu trigger={<Button icon={Download}>Export / Backup Records</Button>} items={[
            { label: 'Backup all records (JSON)', icon: FileJson, onClick: () => exportFormFJson(formfs.map(normalizeFormF)) },
            { label: 'Export register (CSV / Excel)', icon: FileSpreadsheet, onClick: () => exportFormFCsv(formfs.map(normalizeFormF)) },
            { label: 'Download this form as PDF', icon: FileDown, onClick: () => doPdf('duplex') }
          ]} />
          <Button icon={Eraser} onClick={reset}>Reset Form for New Patient <span className="kbd ml-1">Alt+N</span></Button>
        </>} />

      <div className="mb-3 xl:hidden"><Segmented value={pane} onChange={setPane} options={[{ value: 'form', label: 'Form entry', icon: PenLine }, { value: 'preview', label: 'A4 preview', icon: ClipboardList }]} /></div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,600px)_minmax(0,1fr)]">
        <div className={cx('ff-entry min-w-0 space-y-4', pane !== 'form' && 'hidden xl:block')}>
          {isFinal && !amend && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
              <Lock className="h-5 w-5" />
              <div className="min-w-0 flex-1 text-sm"><b>Final & locked</b>{rec.finalizedAt ? ` · ${fmtDate(rec.finalizedAt)} ${fmtTime(rec.finalizedAt)}` : ''}{finalBy ? ' by ' + finalBy.name : ''}{(rec.amendLog || []).length ? ` · amended ${rec.amendLog.length}×` : ''}</div>
              {canFull && <Button size="sm" icon={PencilLine} onClick={startAmend}>Amend</Button>}
            </div>
          )}
          {amend && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <PencilLine className="h-5 w-5" />
              <div className="min-w-0 flex-1 text-sm"><b>Amending final record</b> · reason: {amend.reason}</div>
              <Button size="sm" icon={Undo2} onClick={cancelAmend}>Cancel</Button>
            </div>
          )}
          {holder && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
              <MonitorSmartphone className="h-4 w-4" />Being edited by <b>{holder.userName || 'another user'}</b> on {holder.workstation || 'another workstation'} — changes merge by last save.
            </div>
          )}
          {!canDraft && <div className="flex items-center gap-2 rounded-xl border border-line bg-surface2 px-4 py-2 text-sm"><Info className="h-4 w-4 text-brand-600" />Read-only access — you can view and print Form F records.</div>}

          <Card title="Patient & auto-fill" icon={UserRound}
            actions={rec.patientId ? <Button size="sm" variant="ghost" icon={RefreshCw} onClick={reapply} disabled={readOnly}>Re-apply</Button> : null}>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Toggle checked={prefs.autoFill !== false} onChange={(v) => setPrefs({ autoFill: v })} label="Auto-Fill Form F from Registration" />
                <span className="flex flex-wrap gap-3">
                  {['A', 'B', 'C', 'D'].map((s) => <Checkbox key={s} disabled={prefs.autoFill === false} checked={(prefs.autoFillSections || {})[s] !== false} onChange={(v) => setPrefs({ autoFillSections: { [s]: v } })} label={'Sec ' + s} />)}
                </span>
              </div>
              <Combobox value={null} onChange={(id) => openPatient(id)} items={femalePatients} getLabel={(p) => fullName(p)} getSub={(p) => [p.regId, p.mobile, p.guardianName ? (p.relation || '') + ' ' + p.guardianName : ''].filter(Boolean).join(' · ')}
                filter={(p, s) => [p.name, p.mobile, p.regId, p.guardianName].some((x) => String(x || '').toLowerCase().includes(s))} placeholder="Select registered patient — name / mobile / Regn No…" icon={Search} disabled={!canDraft} />
              <div>
                <div className="mb-1 flex items-center justify-between"><span className="label mb-0">Obstetric visits awaiting Form F (7 days)</span><Badge tone={pendingList.length ? 'amber' : 'emerald'}>{pendingList.length}</Badge></div>
                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                  {pendingList.map(({ visit: v, formf: f }) => (
                    <button key={v.id} type="button" onClick={() => (f ? openRecord(f) : openVisit(v.id))}
                      className={cx('chip', rec.visitId === v.id && 'chip-on')} title={(v.tests || []).map((t) => t.name).join(', ')}>
                      <Baby className="h-3 w-3 text-violet-600" />{v.patientName}
                      <span className="text-[10px] text-muted">{v.dateKey === dateKey() ? (v.tokens && v.tokens.combined) || 'today' : fmtDate(v.dateKey).slice(0, 5)}{f ? ' · draft' : ''}</span>
                    </button>
                  ))}
                  {!pendingList.length && <span className="text-xs text-muted">All obstetric scans have a final Form F. ✓</span>}
                </div>
              </div>
            </div>
          </Card>

          {rec.prefilledFrom && rec.prefilledFrom.fields && rec.prefilledFrom.fields.length > 0 && !readOnly && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[12.5px] text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
              Filled from this patient’s previous Form F{rec.prefilledFrom.sno ? ' ' + rec.prefilledFrom.sno : ''}{rec.prefilledFrom.date ? ' of ' + fmtDate(rec.prefilledFrom.date) : ''}: {rec.prefilledFrom.fields.length} repeatable detail{rec.prefilledFrom.fields.length === 1 ? '' : 's'} (husband / guardian, address, ID, children, referral). Check them before finalising.
            </div>
          )}
          <SectionA rec={rec} upd={upd} updTop={updTop} readOnly={readOnly} nextSno={nextSno} missing={missingSet} />
          <SectionB rec={rec} upd={upd} readOnly={readOnly} prefs={prefs} report={report} onUseReport={useReport} missing={missingSet} />
          <SectionC key={rec.id + (prefs.visibility || {}).collapseSectionC} rec={rec} upd={upd} readOnly={readOnly} collapsed={(prefs.visibility || {}).collapseSectionC !== false} />
          <SectionD rec={rec} upd={upd} readOnly={readOnly} />
        </div>

        <div className={cx('min-w-0 xl:sticky xl:top-0 xl:self-start', pane !== 'preview' && 'hidden xl:block')}>
          <Card padded={false} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
              <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'both', label: 'Both pages' }, { value: 'front', label: 'Front · A & B' }, { value: 'back', label: 'Back · C & D' }]} />
              <span className="flex items-center">
                <IconBtn icon={ZoomOut} size="sm" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.4, Math.round(((z === 'fit' ? 0.8 : z) - 0.1) * 10) / 10))} />
                <button type="button" className="min-w-[44px] text-center text-xs font-semibold text-muted tnum" onClick={() => setZoom('fit')} title="Fit width">{zoom === 'fit' ? 'Fit' : Math.round(zoom * 100) + '%'}</button>
                <IconBtn icon={ZoomIn} size="sm" title="Zoom in" onClick={() => setZoom((z) => Math.min(2, Math.round(((z === 'fit' ? 0.8 : z) + 0.1) * 10) / 10))} />
                <IconBtn icon={Maximize2} size="sm" title="Fit width" onClick={() => setZoom('fit')} />
              </span>
              <span className="ml-auto flex items-center gap-2">
                <Toggle size="sm" checked={editMode} onChange={toggleEdit} label="Enable Direct Form Editing" />
                {nEdits > 0 && <button type="button" className="link text-xs" onClick={clearEdits} title="Remove this record's wording edits">{nEdits} edit{nEdits > 1 ? 's' : ''} · clear</button>}
              </span>
            </div>
            <div className={cx('flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5 text-xs', check.errors.length ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200')}>
              {check.errors.length ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              <b>Statutory completeness {done}/{total}</b>
              <span className="min-w-0 flex-1 truncate" title={check.errors.concat(check.warnings).join(' · ')}>{check.errors.length ? 'Missing: ' + check.errors.join(' · ') : check.warnings.length ? 'Check: ' + check.warnings.join(' · ') : 'All mandatory items complete'}</span>
              {check.errors.length > 0 && !readOnly && <button type="button" className="rounded-md border border-amber-300 bg-white/70 px-2 py-0.5 font-semibold text-amber-900 hover:bg-white dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100" onClick={nextMissing}>Go to next missing field</button>}
              {gaText(d) && <Badge tone="violet" icon={Baby}>{gaText(d)}</Badge>}
            </div>
            {editMode && (
              <div className="flex flex-wrap items-center gap-2 border-b border-brand-200 bg-brand-50 px-3 py-1.5 text-xs text-brand-900 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-100">
                <PenLine className="h-3.5 w-3.5" />Click any label, clause or value on the form to edit it. Edits stay with this record; save them as a default from <button type="button" className="link" onClick={() => { commitEdits(); setCustOpen(true); }}>Customise</button>.
                <Button size="sm" variant="primary" className="ml-auto" onClick={toggleEdit}>Done editing <span className="kbd ml-1 border-white/30 bg-white/15 text-white">Alt+E</span></Button>
              </div>
            )}
            <div className="max-h-[calc(100vh-15.5rem)] min-h-[420px] overflow-auto bg-slate-200/70 p-3 dark:bg-slate-950/60">
              <FormFPreview html={html} fontPt={prefs.fontPt} zoom={zoom} onClick={onPreviewClick} onInput={onPreviewInput} onKeyDown={onPreviewKey} />
            </div>
          </Card>
        </div>
      </div>

      <div className="sticky bottom-14 z-30 -mx-3 mt-4 border-t border-line bg-surface/95 px-3 py-2 backdrop-blur sm:-mx-5 sm:px-5 lg:bottom-0">
        <div className="mx-auto flex max-w-[1700px] flex-wrap items-center justify-end gap-2">
          <span className="mr-auto flex items-center gap-2 text-xs text-muted">
            <Badge tone={isFinal ? 'emerald' : 'amber'} icon={isFinal ? Lock : PencilLine}>{isFinal ? 'FINAL' : 'DRAFT'}</Badge>
            <span className="hidden sm:inline">{statusLine}</span>
          </span>
          {!readOnly && <Button icon={Save} loading={saving} onClick={() => save()}>{amend ? 'Save amendment' : 'Save draft'} <span className="kbd ml-1">Ctrl+S</span></Button>}
          {canFull && !isFinal && <Button variant="success" icon={ShieldCheck} onClick={() => save({ finalize: true })}>Finalise & lock</Button>}
          <Button icon={Printer} onClick={() => doPrint('front')} title="Print page 1 only (Section A & B)">Front</Button>
          <Button icon={Printer} onClick={() => doPrint('back')} title="Print page 2 only (Section C & D)">Back</Button>
          <Button variant="primary" icon={Printer} onClick={() => doPrint('duplex')}>Print duplex <span className="kbd ml-1 border-white/30 bg-white/15 text-white">Ctrl+P</span></Button>
          <Button icon={FileDown} onClick={() => doPdf('duplex')}>PDF</Button>
        </div>
      </div>

      <FormFRegister open={regOpen} onClose={() => setRegOpen(false)} onOpen={openRecord} onPrint={(r, which) => doPrint(which, r)} currentId={rec.id} />
      <FormFCustomize open={custOpen} onClose={() => setCustOpen(false)} prefs={prefs} setPrefs={setPrefs} resetPrefs={() => setLocalPrefs({})} settings={settings} rec={rec} localEdits={localEdits || {}} setLocalEdits={setLocalEdits} />
    </div>
  );
}
