// Pathology Lab: worklist (sample pending → collected → in entry → awaiting verification → signed),
// sample collection with barcode tube labels, parameter-wise result entry with live H / L / abnormal
// flags, panic values, auto-calculated indices and delta check against the previous report, submit
// for verification, pathologist verify & sign (dual-signatory compliance), return to technician,
// Super Admin unlock with audit reason, A4 preview, print, PDF and send to patient.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Microscope, Search, Plus, TestTube, Barcode, Save, Send, ShieldCheck, Undo2, Printer, FileDown, Eye, PencilLine, Lock, Unlock,
  TriangleAlert, CircleCheck, Clock, ArrowLeft, Wand2, ChevronUp, ChevronDown, Minus, FlaskConical, ListPlus, UserRound, History, Camera, ScanBarcode
} from 'lucide-react';
import { useColl, useSettings, useHotkeys, useMedia, useLocalPref } from '../../core/hooks';
import { store, events } from '../../core/store';
import { can, currentUser, logAudit, useAuth } from '../../core/auth';
import { api, isServer, useNet, acquireLock, lockHolder, emitEvent, nextCounter } from '../../core/sync';
import { setQueueStatus, patientSnapshot } from '../../core/clinic';
import { cx, Card, Button, Badge, Input, Textarea, Field, Segmented, Modal, Empty, Combobox, Toggle, Checkbox, toast, confirmDialog, promptDialog } from '../../components/ui';
import { openExternal } from '../../core/share';
import { DoctorPicker } from '../../components/DoctorPicker';
import { CameraScan, cameraScanSupported } from '../../components/CameraScan';
import { MM } from '../../core/print';
import { dateKey, fmtDate, fmtTime, fmtDateTime, timeAgo, fullName, ageSex, pad, uid, debounce } from '../../core/utils';
import {
  LAB_STATUS, LAB_FLOW, panelsOf, freeTests, computedValues, flagFor, refText, previousResult, filledCount, flagCount, criticalFor, criticalList,
  renderLabPages, printLab, labPdfBlob
} from './labPrint';
import { printSampleLabels, containersFor } from './labLabels';
import { autoDispatch, openSend, notifySampleCollected } from '../dispatch/engine';

const STATUS_ORDER = ['PENDING', 'SAMPLE_COLLECTED', 'DRAFT', 'AMENDING', 'SUBMITTED', 'SIGNED_FINAL'];
const FLAG_TONE = { H: 'text-rose-600', L: 'text-sky-600', ABN: 'text-amber-600' };
const isLabTest = (t) => t && (t.department === 'Pathology' || t.department === 'Biochemistry');

function fromRep(rep) {
  return {
    values: JSON.parse(JSON.stringify(rep.values || {})), freeResults: Object.assign({}, rep.freeResults || {}), remarks: Object.assign({}, rep.remarks || {}),
    comment: rep.comment || '', criticalNote: rep.criticalNote || ''
  };
}

/** After a sample is collected: Rule 5 message (automatic with an API, else a one-click WhatsApp toast). */
function afterCollect(saved) {
  notifySampleCollected(saved).then((r) => {
    if (!r) return;
    if (r.link) events.emit('toast', { type: 'info', text: 'Tell ' + fullName(saved.patient) + ' the sample was collected?', ttl: 12000, action: { label: 'Send WhatsApp', onClick: () => openExternal(r.link) } });
    else if (r.results && Object.values(r.results).includes('sent')) toast('Patient told: sample collected', 'success');
  }).catch(() => {});
}

/** Mark a pending sample collected from the worklist (barcode scan) without opening the entry form. */
function markCollected(rep) {
  const u = currentUser();
  const cur = store.get('labReports', rep.id) || rep;
  const saved = store.put('labReports', Object.assign({}, cur, { status: 'SAMPLE_COLLECTED', sampleCollectedAt: Date.now(), collectedBy: u ? u.id : null }));
  if (saved.visitId) setQueueStatus(saved.visitId, 'LAB', 'In Scan/Sample');
  logAudit('lab:sample_collected', 'labReports/' + saved.id, { sampleId: saved.sampleId, via: 'scan' });
  afterCollect(saved);
  return saved;
}


function searchable(r) {
  const p = r.patient || {};
  return [p.name, p.regId, p.mobile, r.sampleId, r.refBy, (r.tests || []).map((t) => t.name).join(' ')].join(' ').toLowerCase();
}

// ---------------------------------------------------------------- page
export function LabModule({ route }) {
  const reports = useColl('labReports');
  const wide = useMedia('(min-width: 1024px)');
  const [view, setView] = useState('worklist');
  const [day, setDay] = useState(dateKey());
  const [status, setStatus] = useState('ALL');
  const [q, setQ] = useState('');
  const [selId, setSelId] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const searchRef = useRef(null);

  // deep links: #/lab?visit=<visitId> or #/lab?id=<labReportId>
  useEffect(() => {
    const { visit, id } = route.query || {};
    if (id && store.get('labReports', id)) setSelId(id);
    else if (visit) {
      const v = store.get('visits', visit);
      const r = (v && v.labReportId && store.get('labReports', v.labReportId)) || store.list('labReports').find((x) => x.visitId === visit);
      if (r) setSelId(r.id); else toast('No lab investigations on this visit', 'warning');
    }
  }, [route.query && route.query.visit, route.query && route.query.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = dateKey();
  const scoped = useMemo(() => reports.filter((r) => {
    const d = dateKey(r.createdAt || 0);
    if (view === 'worklist') return r.status !== 'SIGNED_FINAL' || dateKey(r.verifiedAt || 0) === today;
    if (view === 'date') return d === day;
    return true;
  }), [reports, view, day, today]);
  const counts = useMemo(() => {
    const c = { ALL: scoped.length };
    scoped.forEach((r) => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [scoped]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return scoped.filter((r) => (status === 'ALL' || r.status === status) && (!s || searchable(r).includes(s)))
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (b.createdAt || 0) - (a.createdAt || 0));
  }, [scoped, status, q]);

  const sel = selId ? reports.find((r) => r.id === selId) || null : null;
  useHotkeys({ 'ctrl+k': () => { searchRef.current && searchRef.current.focus(); } }, []);
  const [scanCollect, setScanCollect] = useLocalPref('lab-scan-collect', true);
  const [camOpen, setCamOpen] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const settings = useSettings();
  const canCollect = can('lab:enter_sample_values', 'DRAFT');
  const canSign = can('lab:verify_and_sign_report');
  /** A scanned tube label opens the sample; a pending sample is marked collected when that option is on. */
  const handleScan = (code) => {
    const s = String(code || '').trim().toLowerCase();
    if (!s) return false;
    const hit = reports.find((r) => String(r.sampleId || '').toLowerCase() === s);
    if (!hit) { toast('No sample with barcode ' + code + ' in the worklist', 'warning'); return false; }
    setSelId(hit.id);
    setQ('');
    if (hit.status === 'PENDING' && scanCollect && canCollect) { markCollected(hit); toast('Sample ' + hit.sampleId + ' collected · ' + fullName(hit.patient), 'success'); }
    return true;
  };
  const onScanEnter = () => {
    const s = q.trim().toLowerCase();
    const exact = reports.find((r) => String(r.sampleId || '').toLowerCase() === s);
    if (exact) { handleScan(exact.sampleId); return; }
    const hit = list.length === 1 ? list[0] : null;
    if (hit) { setSelId(hit.id); setQ(''); }
  };
  // USB / Bluetooth barcode scanners type fast and end with Enter: catch them anywhere on the page
  const scanRef = useRef(handleScan);
  scanRef.current = handleScan;
  useEffect(() => {
    let buf = '';
    let last = 0;
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const now = Date.now();
      if (now - last > 80) buf = '';
      last = now;
      if (e.key === 'Enter') { if (buf.length >= 4) { e.preventDefault(); scanRef.current(buf); } buf = ''; return; }
      if (e.key.length === 1) buf += e.key;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  /** Pathologist: verify & sign several submitted reports in one go (same checks as one by one). */
  const togglePick = (id) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const batchVerify = async () => {
    const u = currentUser();
    const rows = Array.from(picked).map((id) => store.get('labReports', id)).filter((r) => r && r.status === 'SUBMITTED');
    if (!rows.length) return;
    if (!(await confirmDialog({ title: 'Verify & sign ' + rows.length + ' lab report' + (rows.length === 1 ? '' : 's') + '?', message: rows.map((r) => '• ' + fullName(r.patient) + ' · ' + (r.tests || []).map((t) => t.name).join(', ')).join('\n') + '\n\nSigning as ' + u.name + '. Reports with critical values without a communication note, or entered by you, are skipped.', confirmText: 'Verify & sign all' }))) return;
    const dual = !settings.compliance || settings.compliance.dualSignatoryPathology !== false;
    const skipped = [];
    let signed = 0;
    for (const r of rows) {
      if (dual && (!r.enteredBy || r.enteredBy === u.id)) { skipped.push(fullName(r.patient) + ' (dual signature)'); continue; }
      if (criticalList(r).length && !String(r.criticalNote || '').trim()) { skipped.push(fullName(r.patient) + ' (critical value note)'); continue; }
      const version = r.version || 1;
      const saved = store.put('labReports', Object.assign({}, r, { status: 'SIGNED_FINAL', verifiedBy: u.id, verifiedAt: Date.now(), version, returnNote: '' }));
      if (saved.visitId) setQueueStatus(saved.visitId, 'LAB', 'Completed');
      if (!isServer()) logAudit('lab:verified_signed', 'labReports/' + saved.id, { patient: fullName(saved.patient), version, via: 'batch' });
      emitEvent('report:completed', { kind: 'lab', patientName: fullName(saved.patient), reportId: saved.id });
      autoDispatch('lab', saved, 'onSigned', { interactive: false });
      signed += 1;
    }
    setPicked(new Set());
    toast('Signed ' + signed + (skipped.length ? ' · skipped ' + skipped.length + ': ' + skipped.join(', ') : ''), skipped.length ? 'warning' : 'success', 8000);
  };
  const pickable = canSign ? list.filter((r) => r.status === 'SUBMITTED') : [];
  const canCreate = can('lab:enter_sample_values', 'DRAFT') || can('patient:register_and_edit');

  const worklist = (
    <Card padded={false} className="flex min-h-0 flex-col lg:h-[calc(100vh-150px)]" bodyClass="flex min-h-0 flex-1 flex-col"
      title="Lab worklist" subtitle={list.length + ' of ' + scoped.length + ' · scan a sample barcode to open'} icon={Microscope}
      actions={canCreate ? <Button size="sm" icon={Plus} onClick={() => setNewOpen(true)}>New</Button> : null}>
      <div className="space-y-2 border-b border-line p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input ref={searchRef} className="pl-8" placeholder="Patient, sample ID, Reg. ID, test…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onScanEnter(); }} aria-label="Search lab worklist" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'worklist', label: 'Open + today' }, { value: 'date', label: 'Date' }, { value: 'all', label: 'All' }]} />
          {view === 'date' && <Input type="date" size="sm" className="w-[150px]" value={day} onChange={(e) => setDay(e.target.value || today)} aria-label="Worklist date" />}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <ScanBarcode className="h-4 w-4 text-muted" />
          {canCollect ? <Toggle size="sm" checked={scanCollect} onChange={setScanCollect} label="Scanning a pending tube marks it collected" /> : <span className="text-muted">Scan a tube label to open the sample</span>}
          {cameraScanSupported() && <Button size="xs" icon={Camera} onClick={() => setCamOpen(true)}>Camera</Button>}
        </div>
        {pickable.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50/60 px-2 py-1.5 text-[12px] dark:border-emerald-900 dark:bg-emerald-950/20">
            <Checkbox checked={pickable.every((r) => picked.has(r.id))} onChange={(v) => setPicked(v ? new Set(pickable.map((r) => r.id)) : new Set())} label={'Select all ' + pickable.length + ' awaiting verification'} />
            <Button size="xs" variant="success" icon={ShieldCheck} className="ml-auto" disabled={!picked.size} onClick={batchVerify}>Sign selected{picked.size ? ' (' + picked.size + ')' : ''}</Button>
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {['ALL'].concat(STATUS_ORDER).filter((s) => s === 'ALL' || counts[s]).map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={cx('chip', status === s && 'chip-on')}>
              {s === 'ALL' ? 'All' : LAB_STATUS[s].label}<span className="text-[10px] tnum text-muted">{counts[s] || 0}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2" style={{ maxHeight: wide ? undefined : 420 }}>
        {!list.length && <Empty icon={TestTube} title="Nothing here" text={view === 'worklist' ? 'Pending samples and today’s reports appear here. Lab tests added at registration create worklist entries automatically.' : 'No lab reports match.'} />}
        {list.map((r) => <WorkRow key={r.id} r={r} on={r.id === selId} onClick={() => setSelId(r.id)} pick={canSign && r.status === 'SUBMITTED' ? picked.has(r.id) : undefined} onPick={() => togglePick(r.id)} />)}
      </div>
    </Card>
  );

  return (
    <div className="min-w-0">
      {(wide || !sel) && (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="font-display text-xl font-extrabold tracking-tight sm:text-2xl">Pathology Lab</h1>
            <p className="text-[13px] text-muted">Haematology · Biochemistry · Serology · Clinical pathology — technician entry, pathologist verification & dual signature</p>
          </div>
          <LabStats reports={reports} />
          <CameraScan open={camOpen} onClose={() => setCamOpen(false)} title="Scan a sample barcode" hint="Hold the tube label inside the frame. A USB / Bluetooth barcode scanner also works anywhere on the lab page without this window." onCode={(code) => { setCamOpen(false); handleScan(code); }} />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[330px_minmax(0,1fr)]">
        {(wide || !sel) && worklist}
        {sel ? (
          <div className="min-w-0">
            {!wide && <Button size="sm" icon={ArrowLeft} className="mb-2" onClick={() => setSelId(null)}>Worklist</Button>}
            <LabWorkspace key={sel.id} rep={sel} />
          </div>
        ) : wide && (
          <Card><Empty icon={FlaskConical} title="Select a sample" text="Choose a patient from the worklist (or scan the tube barcode) to collect the sample, enter results, verify and sign." /></Card>
        )}
      </div>
      <NewLabRequest open={newOpen} onClose={() => setNewOpen(false)} onCreated={(r) => { setNewOpen(false); setSelId(r.id); setView('worklist'); setStatus('ALL'); }} />
    </div>
  );
}

function LabStats({ reports }) {
  const today = dateKey();
  const pend = reports.filter((r) => r.status === 'PENDING').length;
  const entry = reports.filter((r) => ['SAMPLE_COLLECTED', 'DRAFT', 'AMENDING'].includes(r.status)).length;
  const verify = reports.filter((r) => r.status === 'SUBMITTED').length;
  const signed = reports.filter((r) => r.status === 'SIGNED_FINAL' && dateKey(r.verifiedAt || 0) === today).length;
  const Item = ({ label, n, tone }) => <div className="rounded-xl border border-line bg-surface px-3 py-1.5 text-center"><div className={cx('font-display text-lg font-extrabold leading-5 tnum', tone)}>{n}</div><div className="text-[10.5px] text-muted">{label}</div></div>;
  return (
    <div className="flex flex-wrap gap-2">
      <Item label="Sample pending" n={pend} tone="text-slate-600 dark:text-slate-300" />
      <Item label="In entry" n={entry} tone="text-amber-600" />
      <Item label="To verify" n={verify} tone="text-violet-600" />
      <Item label="Signed today" n={signed} tone="text-emerald-600" />
    </div>
  );
}

function WorkRow({ r, on, onClick, pick, onPick }) {
  const p = r.patient || {};
  const st = LAB_STATUS[r.status] || LAB_STATUS.PENDING;
  const fc = r.status === 'PENDING' ? null : filledCount(r);
  const flags = r.status === 'PENDING' ? 0 : flagCount(r);
  const crit = r.status === 'PENDING' ? [] : criticalList(r);
  return (
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={cx('mb-1.5 w-full cursor-pointer rounded-xl border p-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40', on ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/30' : 'border-line bg-surface hover:border-brand-300')}>
      <div className="flex items-start justify-between gap-2">
        {pick !== undefined && <span onClick={(e) => e.stopPropagation()} className="pt-0.5"><Checkbox checked={pick} onChange={onPick} label={<span className="sr-only">Select for batch verification</span>} /></span>}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold">{fullName(p) || 'Patient'}</div>
          <div className="truncate text-[11px] text-muted">{ageSex(p)} · {r.sampleId || '—'} · {fmtDate(r.createdAt)} {fmtTime(r.createdAt)}</div>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <div className="mt-1 truncate text-[11.5px] text-muted">{(r.tests || []).map((t) => t.name).join(', ')}</div>
      {(fc || flags || crit.length) ? (
        <div className="mt-1.5 flex items-center gap-2 text-[10.5px]">
          {fc && fc.total > 0 && <span className="flex items-center gap-1 text-muted"><span className="h-1.5 w-14 overflow-hidden rounded-full bg-surface2"><span className="block h-full bg-brand-500" style={{ width: Math.round((fc.filled / fc.total) * 100) + '%' }} /></span>{fc.filled}/{fc.total}</span>}
          {flags > 0 && <span className="font-semibold text-rose-600">{flags} abnormal</span>}
          {crit.length > 0 && <Badge tone="rose" icon={TriangleAlert}>Critical</Badge>}
          {r.sent && <Badge tone="emerald" icon={Send}>Sent</Badge>}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- workspace
function LabWorkspace({ rep }) {
  const settings = useSettings();
  const { principal: user } = useAuth();
  useNet();
  const [form, setForm] = useState(() => fromRep(rep));
  const [tab, setTab] = useState(rep.status === 'SIGNED_FINAL' ? 'preview' : 'entry');
  const [busy, setBusy] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const dirty = useRef(false);
  const rootRef = useRef(null);
  const formRef = useRef(form);
  formRef.current = form;

  const canEnter = can('lab:enter_sample_values', 'DRAFT');
  const canVerify = can('lab:verify_and_sign_report');
  const isAdmin = user.role === 'SUPER_ADMIN_RADIOLOGIST';
  const canPrint = can('print:dispatch_signed_reports', 'DRAFT') || canEnter || canVerify;
  const signed = rep.status === 'SIGNED_FINAL';
  const editable = !signed && rep.status !== 'PENDING' && ((canEnter && rep.status !== 'SUBMITTED') || canVerify);
  const holder = lockHolder('lab:' + rep.id);

  // take remote changes when nothing is pending locally
  useEffect(() => { if (!dirty.current) setForm(fromRep(rep)); }, [rep.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!editable) return undefined;
    return acquireLock('lab:' + rep.id, (h) => toast(`${(h && h.userName) || 'Another user'} is entering this report on ${(h && h.workstation) || 'another workstation'}`, 'warning'));
  }, [rep.id, editable]);

  const merged = useMemo(() => Object.assign({}, rep, form), [rep, form]);
  const vals = useMemo(() => computedValues(merged), [merged]);
  const crit = useMemo(() => criticalList(merged), [merged]);
  const fc = filledCount(merged);

  const persist = (patch = {}) => {
    const cur = store.get('labReports', rep.id);
    if (!cur) return null;
    const f = formRef.current;
    const next = Object.assign({}, cur, { values: f.values, freeResults: f.freeResults, remarks: f.remarks, comment: f.comment, criticalNote: f.criticalNote }, patch);
    if ((next.status === 'SAMPLE_COLLECTED') && dirty.current && !patch.status) next.status = 'DRAFT';
    if (dirty.current && canEnter && user.role !== 'CONSULTANT_PATHOLOGIST' && !next.enteredBy) { next.enteredBy = user.id; next.enteredAt = Date.now(); }
    if (dirty.current) { next.lastEditedBy = user.id; next.lastEditedAt = Date.now(); }
    dirty.current = false;
    return store.put('labReports', next);
  };
  const autosave = useMemo(() => debounce(() => { if (dirty.current) persist(); }, 1200), [rep.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => autosave.flush(), [autosave]);
  const change = (fn) => {
    if (!editable) return;
    dirty.current = true;
    setForm((f) => { const n = fn(JSON.parse(JSON.stringify(f))); formRef.current = n; return n; });
    autosave();
  };
  const setVal = (panelId, id, v) => change((f) => { f.values[panelId] = Object.assign({}, f.values[panelId] || {}, { [id]: v }); return f; });
  const fillDefaults = (panel) => change((f) => {
    const cur = Object.assign({}, f.values[panel.id] || {});
    panel.params.forEach((prm) => {
      if (prm.heading || prm.calc) return;
      const has = cur[prm.id] !== undefined && cur[prm.id] !== '';
      if (has) return;
      if (prm.def !== undefined && prm.def !== '') cur[prm.id] = prm.def;
      else if (prm.type === 'select' && prm.normal && prm.normal.length) cur[prm.id] = prm.normal[0];
    });
    f.values[panel.id] = cur;
    return f;
  });

  // Enter / Shift+Enter moves between result fields like a spreadsheet
  const onKeyNav = (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA' || !rootRef.current) return;
    const inputs = Array.from(rootRef.current.querySelectorAll('[data-lab-input]:not([disabled])'));
    const i = inputs.indexOf(e.target);
    if (i < 0) return;
    e.preventDefault();
    const nx = inputs[e.shiftKey ? i - 1 : i + 1];
    if (nx) { nx.focus(); if (nx.select) nx.select(); }
  };

  // ---------------------------------------------------------------- workflow actions
  const audit = (action, meta) => logAudit(action, 'labReports/' + rep.id, meta || {});
  const collect = () => {
    const saved = persist({ status: 'SAMPLE_COLLECTED', sampleCollectedAt: Date.now(), collectedBy: user.id });
    if (!saved) return;
    if (saved.visitId) setQueueStatus(saved.visitId, 'LAB', 'In Scan/Sample');
    audit('lab:sample_collected', { sampleId: saved.sampleId });
    setTab('entry');
    events.emit('toast', { type: 'success', text: 'Sample collected · ' + containersFor(saved).length + ' container(s)', action: { label: 'Print labels', onClick: () => printSampleLabels(store.get('labReports', saved.id)) } });
    afterCollect(saved);
  };
  const saveDraft = () => { dirty.current = true; const s = persist(); if (s) toast('Draft saved', 'success'); };
  const submit = async () => {
    const f = filledCount(merged);
    if (f.total && f.filled < f.total && !(await confirmDialog({ title: 'Submit with blank results?', message: `${f.total - f.filled} of ${f.total} result field(s) are blank. Blank parameters print as “—”.`, confirmText: 'Submit anyway' }))) return;
    dirty.current = true;
    const saved = persist({ status: 'SUBMITTED', submittedAt: Date.now(), submittedBy: user.id, enteredBy: rep.enteredBy || (user.role !== 'CONSULTANT_PATHOLOGIST' ? user.id : null), enteredAt: rep.enteredAt || Date.now(), returnNote: '' });
    if (!saved) return;
    audit('lab:submitted', { filled: f.filled, total: f.total });
    emitEvent('notify', { text: `Lab report ready for verification: ${fullName(saved.patient)} (${saved.sampleId})`, type: 'info' });
    toast('Submitted for pathologist verification', 'success');
  };
  const recall = () => { const s = persist({ status: 'DRAFT' }); if (s) { audit('lab:recalled', {}); toast('Recalled for editing', 'info'); } };
  const returnToTech = async () => {
    const reason = await promptDialog({ title: 'Return to technician', label: 'What needs to be checked / repeated?', required: true, multiline: true, rows: 3 });
    if (!reason) return;
    const s = persist({ status: 'DRAFT', returnNote: String(reason).trim(), returnedAt: Date.now(), returnedBy: user.id });
    if (s) { audit('lab:returned', { reason }); emitEvent('notify', { text: `Lab report returned by ${user.name}: ${fullName(s.patient)} — ${reason}`, type: 'warning' }); toast('Returned to the technician', 'info'); }
  };
  const verify = async () => {
    if (!canVerify) return toast('Only the pathologist can verify and sign', 'error');
    const cur = Object.assign({}, store.get('labReports', rep.id), formRef.current);
    const dual = !settings.compliance || settings.compliance.dualSignatoryPathology !== false;
    if (dual && (!cur.enteredBy || cur.enteredBy === user.id)) {
      return toast(!cur.enteredBy
        ? 'Dual-signatory compliance: results must be entered and submitted by a lab technician before verification.'
        : 'Dual-signatory compliance: the verifying pathologist must be a different person from the technician who entered the results.', 'error', 9000);
    }
    const crits = criticalList(cur);
    if (crits.length && !String(cur.criticalNote || '').trim()) {
      return toast('Critical value(s): ' + crits.map((c) => c.name + ' ' + c.value + ' ' + c.unit).join(', ') + ' — record whom it was communicated to before signing.', 'error', 9000);
    }
    const warn = [];
    if (user.role !== 'CONSULTANT_PATHOLOGIST') warn.push('You are signing as ' + user.roleLabel + '. Pathology reports are normally signed by the consultant pathologist.');
    const f = filledCount(cur);
    if (f.filled < f.total) warn.push(`${f.total - f.filled} result field(s) are blank.`);
    if (!(await confirmDialog({ title: 'Verify & sign this lab report?', message: (warn.length ? '⚠ ' + warn.join('\n⚠ ') + '\n\n' : '') + `Signing as ${user.name}. Entered by ${(store.get('users', cur.enteredBy) || {}).name || '—'}. Signed reports are locked; only the Super Admin can unlock them with an audit reason.`, confirmText: 'Verify & sign' }))) return;
    dirty.current = true;
    const version = rep.status === 'AMENDING' ? (rep.version || 1) + 1 : rep.version || 1;
    const saved = persist({ status: 'SIGNED_FINAL', verifiedBy: user.id, verifiedAt: Date.now(), version, returnNote: '' });
    if (!saved) return;
    if (saved.visitId) setQueueStatus(saved.visitId, 'LAB', 'Completed');
    emitEvent('report:completed', { kind: 'lab', patientName: fullName(saved.patient), reportId: saved.id });
    if (!isServer()) logAudit('lab:verified_signed', 'labReports/' + saved.id, { patient: fullName(saved.patient), version });
    toast('Lab report verified & signed (v' + version + ')', 'success');
    setTab('preview');
    autoDispatch('lab', saved, 'onSigned');
  };
  const unlock = async () => {
    if (!isAdmin) return toast('Only the Super Admin can unlock a signed report', 'error');
    const reason = await promptDialog({ title: 'Unlock signed lab report', message: 'The reason is written permanently to the audit trail.', label: 'Reason for amendment', required: true, multiline: true, rows: 3 });
    if (!reason) return;
    if (String(reason).trim().length < 5) return toast('Please give a clear reason (min 5 characters)', 'warning');
    try {
      if (isServer()) {
        const res = await api('reports/labReports/' + encodeURIComponent(rep.id) + '/unlock', { method: 'POST', body: { reason: String(reason).trim() } });
        store.applyRemote('labReports', res.doc, true);
      } else {
        store.put('labReports', Object.assign({}, store.get('labReports', rep.id), { status: 'AMENDING', unlockLog: (rep.unlockLog || []).concat([{ at: Date.now(), by: user.id, byName: user.name, reason: String(reason).trim() }]) }));
        logAudit('report:unlocked', 'labReports/' + rep.id, { reason });
      }
      setTab('entry');
      toast('Unlocked for amendment — verify & sign again to issue the next version', 'info');
    } catch (e) { toast('Unlock failed: ' + e.message, 'error'); }
  };
  const doPrint = async () => { dirty.current && persist(); await printLab(store.get('labReports', rep.id), settings); };
  const doPdf = async () => { setBusy('pdf'); try { dirty.current && persist(); await labPdfBlob(store.get('labReports', rep.id), settings, true); } catch (e) { toast('PDF failed: ' + e.message, 'error'); } finally { setBusy(''); } };
  const doSend = () => { dirty.current && persist(); openSend('lab', store.get('labReports', rep.id)); };
  useHotkeys({ 'ctrl+s': () => { if (editable) saveDraft(); }, 'ctrl+p': () => { if (canPrint) doPrint(); } }, [editable, canPrint]);

  const p = rep.patient || {};
  const st = LAB_STATUS[rep.status] || LAB_STATUS.PENDING;
  const enteredBy = rep.enteredBy && store.get('users', rep.enteredBy);
  const verifiedBy = rep.verifiedBy && store.get('users', rep.verifiedBy);
  const panels = panelsOf(merged);
  const free = freeTests(merged);

  return (
    <div ref={rootRef} className="min-w-0 space-y-3" onKeyDown={onKeyNav}>
      <Card padded={false}>
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-display text-lg font-extrabold">{fullName(p) || 'Patient'}</h2>
              <Badge tone={st.tone}>{st.label}</Badge>
              {rep.version > 1 && <Badge tone="violet">v{rep.version}</Badge>}
              {rep.sent && <Badge tone="emerald" icon={Send}>Sent</Badge>}
            </div>
            <div className="mt-0.5 text-[12.5px] text-muted">{ageSex(p)} · Reg. {p.regId || '—'} · Mob {p.mobile || '—'} · Ref: {rep.refBy || 'Self'}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px]"><Barcode className="h-3.5 w-3.5 text-muted" /><b className="tracking-wide">{rep.sampleId || '—'}</b><span className="text-muted">· {(rep.tests || []).map((t) => t.name).join(', ')}</span></div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {rep.status === 'PENDING' && canEnter && <Button variant="primary" icon={TestTube} onClick={collect}>Collect sample</Button>}
            {rep.status !== 'PENDING' && <Button size="sm" icon={Barcode} onClick={() => printSampleLabels(store.get('labReports', rep.id))}>Labels</Button>}
            {canPrint && rep.status !== 'PENDING' && <Button size="sm" icon={Printer} onClick={doPrint}>Print</Button>}
            {canPrint && rep.status !== 'PENDING' && <Button size="sm" icon={FileDown} loading={busy === 'pdf'} onClick={doPdf}>PDF</Button>}
            {rep.status !== 'PENDING' && <Button size="sm" icon={Send} onClick={doSend}>Send</Button>}
          </div>
        </div>
        <Timeline rep={rep} enteredBy={enteredBy} verifiedBy={verifiedBy} />
        {holder && <div className="flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-4 py-1.5 text-[12.5px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><Lock className="h-4 w-4" />{holder.userName || 'Another user'} is working on this report at {holder.workstation} ({timeAgo(holder.since)}).</div>}
        {rep.returnNote && rep.status === 'DRAFT' && <div className="border-t border-rose-200 bg-rose-50 px-4 py-1.5 text-[12.5px] text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"><b>Returned by {(store.get('users', rep.returnedBy) || {}).name || 'pathologist'}:</b> {rep.returnNote}</div>}
        {rep.status === 'AMENDING' && <div className="border-t border-violet-200 bg-violet-50 px-4 py-1.5 text-[12.5px] text-violet-900 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200">Amending a signed report (v{rep.version || 1}) — reason: {((rep.unlockLog || []).slice(-1)[0] || {}).reason || '—'}. Verify & sign again to issue v{(rep.version || 1) + 1}.</div>}
        {signed && <div className="flex flex-wrap items-center gap-2 border-t border-emerald-200 bg-emerald-50 px-4 py-1.5 text-[12.5px] text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"><ShieldCheck className="h-4 w-4" />Verified & signed by <b>{(verifiedBy && verifiedBy.name) || '—'}</b> on {fmtDateTime(rep.verifiedAt)} — locked.{isAdmin && <Button size="sm" className="ml-auto" icon={Unlock} onClick={unlock}>Unlock for amendment</Button>}</div>}
      </Card>

      {rep.status === 'PENDING' ? (
        <Card><Empty icon={TestTube} title="Sample not collected yet" text={'Containers needed: ' + (containersFor(rep).map((c) => c.tube.code + (c.tube.cap ? ' (' + c.tube.cap + ')' : '') + ' — ' + c.tests.join(', ')).join(' · ') || '—')}
          action={canEnter ? <div className="flex gap-2"><Button variant="primary" icon={TestTube} onClick={collect}>Collect sample</Button><Button icon={Barcode} onClick={() => printSampleLabels(rep)}>Print labels</Button></div> : <span className="text-xs text-muted">The lab technician collects the sample.</span>} /></Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented value={tab} onChange={setTab} options={[{ value: 'entry', label: signed ? 'Results' : 'Result entry', icon: PencilLine }, { value: 'preview', label: 'A4 preview', icon: Eye }]} />
            <div className="flex items-center gap-2 text-[12px] text-muted">
              <span className="tnum">{fc.filled}/{fc.total} filled</span>
              {flagCount(merged) > 0 && <span className="font-semibold text-rose-600">{flagCount(merged)} abnormal</span>}
              {editable && !signed && <Button size="sm" icon={ListPlus} onClick={() => setAddOpen(true)}>Add test</Button>}
            </div>
          </div>
          {crit.length > 0 && (
            <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
              <div className="flex items-center gap-1.5 font-bold"><TriangleAlert className="h-4 w-4" />Critical value{crit.length > 1 ? 's' : ''}: {crit.map((c) => `${c.name} ${c.value} ${c.unit}`).join(' · ')}</div>
              <div className="mt-1">Inform the referring doctor / patient immediately and record it:</div>
              <Input className="mt-1" size="sm" disabled={!editable} value={form.criticalNote} placeholder="e.g. Informed Dr. … by phone at 11:20 AM (read-back confirmed)" onChange={(e) => change((f) => { f.criticalNote = e.target.value; return f; })} aria-label="Critical value communication" />
            </div>
          )}
          {tab === 'entry' ? (
            <div className="space-y-3">
              {editable && panels.length > 1 && (
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                  <Button size="sm" icon={Wand2} onClick={() => panels.forEach((panel) => fillDefaults(panel))} title="Fill every empty field with its normal / default value; enter only the abnormal results">Fill normals in all {panels.length} panels</Button>
                  <span>Then type only the abnormal values · Enter moves to the next field</span>
                </div>
              )}
              {panels.map((panel) => (
                <PanelEntry key={panel.id} panel={panel} rep={merged} values={(form.values || {})[panel.id] || {}} computed={vals[panel.id] || {}} readOnly={!editable}
                  onChange={(id, v) => setVal(panel.id, id, v)} onDefaults={() => fillDefaults(panel)}
                  remark={(form.remarks || {})[panel.id] || ''} onRemark={(v) => change((f) => { f.remarks[panel.id] = v; return f; })} />
              ))}
              {free.length > 0 && (
                <Card title="Other investigations" subtitle="Tests without a parameter panel — free-text result" icon={FlaskConical}>
                  <div className="space-y-2">
                    {free.map((t) => (
                      <Field key={t.testId} label={t.name}>
                        <Textarea rows={2} data-lab-input disabled={!editable} value={(form.freeResults || {})[t.testId] || ''} onChange={(e) => change((f) => { f.freeResults[t.testId] = e.target.value; return f; })} />
                      </Field>
                    ))}
                  </div>
                </Card>
              )}
              <Card title="Pathologist’s comment" subtitle="Printed below the results — interpretation, advice, correlation" icon={UserRound}>
                <Textarea rows={3} disabled={!editable} value={form.comment} onChange={(e) => change((f) => { f.comment = e.target.value; return f; })} placeholder="e.g. Microcytic hypochromic picture — suggest serum ferritin & iron studies." />
              </Card>
              {!signed && (
                <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-line bg-surface/95 px-3 py-2 shadow-pop backdrop-blur">
                  <span className="mr-auto text-[11.5px] text-muted">{editable ? 'Auto-saves as you type · Enter = next field · Ctrl+S save' : rep.status === 'SUBMITTED' ? 'Awaiting pathologist verification' : 'Read-only for your role'}</span>
                  {editable && <Button icon={Save} onClick={saveDraft}>Save draft</Button>}
                  {canEnter && ['SAMPLE_COLLECTED', 'DRAFT', 'AMENDING'].includes(rep.status) && <Button variant="primary" icon={Send} onClick={submit}>Submit for verification</Button>}
                  {canEnter && !canVerify && rep.status === 'SUBMITTED' && <Button icon={Undo2} onClick={recall}>Recall to edit</Button>}
                  {canVerify && rep.status === 'SUBMITTED' && <Button variant="danger-ghost" icon={Undo2} onClick={returnToTech}>Return to technician</Button>}
                  {canVerify && ['SUBMITTED', 'AMENDING', 'DRAFT', 'SAMPLE_COLLECTED'].includes(rep.status) && <Button variant="success" icon={ShieldCheck} onClick={verify}>Verify & sign</Button>}
                </div>
              )}
            </div>
          ) : (
            <LabPreview rep={merged} settings={settings} />
          )}
        </>
      )}
      <AddTestModal open={addOpen} onClose={() => setAddOpen(false)} rep={rep} onAdd={(t) => {
        const cur = store.get('labReports', rep.id);
        store.put('labReports', Object.assign({}, cur, { tests: (cur.tests || []).concat([{ testId: t.id, name: t.name, panel: t.labPanel || null }]) }));
        logAudit('lab:test_added', 'labReports/' + rep.id, { test: t.name });
        setAddOpen(false);
      }} />
    </div>
  );
}

function Timeline({ rep, enteredBy, verifiedBy }) {
  const steps = [
    ['Registered', rep.createdAt, ''],
    ['Collected', rep.sampleCollectedAt, (store.get('users', rep.collectedBy) || {}).name],
    ['Entered', rep.enteredAt, enteredBy && enteredBy.name],
    ['Submitted', rep.submittedAt, (store.get('users', rep.submittedBy) || {}).name],
    ['Verified', rep.verifiedAt, verifiedBy && verifiedBy.name]
  ];
  const idx = Math.max(0, LAB_FLOW.indexOf(rep.status === 'AMENDING' ? 'DRAFT' : rep.status));
  return (
    <div className="flex overflow-x-auto border-t border-line px-2 py-2">
      {steps.map(([label, at, by], i) => {
        const done = !!at && (i <= idx || rep.status === 'SIGNED_FINAL');
        return (
          <div key={label} className="flex min-w-[110px] flex-1 items-start gap-1.5 px-2">
            {done ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
            <div className="min-w-0 text-[11px] leading-4">
              <div className={cx('font-semibold', done ? 'text-ink' : 'text-muted')}>{label}</div>
              <div className="truncate text-muted">{at ? fmtDate(at) + ' ' + fmtTime(at) : '—'}</div>
              {by && <div className="truncate text-muted">{by}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DeltaCell({ rep, panelId, prm, value }) {
  const prev = useMemo(() => (prm.type === 'num' ? previousResult(rep, panelId, prm.id) : null), [rep.patientId, panelId, prm.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!prev) return <span className="text-muted">—</span>;
  const a = Number(prev.value);
  const b = Number(value);
  let Icon = Minus;
  let pct = null;
  if (value !== '' && value !== undefined && !Number.isNaN(b) && !Number.isNaN(a) && a !== 0) { pct = ((b - a) / Math.abs(a)) * 100; Icon = pct > 0.5 ? ChevronUp : pct < -0.5 ? ChevronDown : Minus; }
  return (
    <span className={cx('inline-flex items-center gap-0.5 whitespace-nowrap', pct !== null && Math.abs(pct) >= 25 ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-muted')} title={'Previous verified result on ' + fmtDate(prev.at)}>
      <History className="h-3 w-3" />{prev.value}{pct !== null && <><Icon className="h-3 w-3" />{Math.abs(pct).toFixed(0)}%</>}
    </span>
  );
}

function PanelEntry({ panel, rep, values, computed, readOnly, onChange, onDefaults, remark, onRemark }) {
  const warn = panel.check ? panel.check(computed) : null;
  const patient = rep.patient;
  return (
    <Card padded={false} title={panel.title} subtitle={[panel.section, panel.sample, panel.method].filter(Boolean).join(' · ')} icon={FlaskConical}
      actions={!readOnly ? <Button size="xs" icon={Wand2} onClick={onDefaults} title="Fill blank fields with the normal default">Fill normals</Button> : null}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-[13px]">
          <thead>
            <tr className="border-b border-line bg-surface2/60 text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="px-3 py-1.5 font-semibold">Investigation</th><th className="w-[180px] px-2 py-1.5 font-semibold">Result</th>
              <th className="w-[46px] px-1 py-1.5 font-semibold">Flag</th><th className="w-[90px] px-2 py-1.5 font-semibold">Unit</th>
              <th className="w-[130px] px-2 py-1.5 font-semibold">Ref. interval</th><th className="w-[96px] px-2 py-1.5 font-semibold">Previous</th>
            </tr>
          </thead>
          <tbody>
            {panel.params.map((prm, i) => {
              if (prm.heading) return <tr key={'h' + i}><td colSpan={6} className="px-3 pb-0.5 pt-2 text-[11.5px] font-bold italic text-muted">{prm.heading}</td></tr>;
              const raw = values[prm.id];
              const shown = prm.calc ? computed[prm.id] : raw;
              const flag = flagFor(prm, computed[prm.id], patient);
              const critical = criticalFor(prm, computed[prm.id]);
              const ph = prm.def !== undefined && prm.def !== '' ? String(prm.def) : prm.type === 'select' ? '' : prm.type === 'num' ? '' : '';
              return (
                <tr key={prm.id} className={cx('border-b border-line/60', critical ? 'bg-rose-50 dark:bg-rose-950/30' : flag ? 'bg-amber-50/50 dark:bg-amber-950/20' : '')}>
                  <td className="px-3 py-1">
                    <div className="font-medium">{prm.name}</div>
                    {prm.method && <div className="text-[10.5px] text-muted">{prm.method}</div>}
                  </td>
                  <td className="px-2 py-1">
                    {prm.calc ? (
                      <div className="flex h-8 items-center gap-1.5 rounded-lg bg-surface2 px-2 font-semibold tnum">{shown === undefined || shown === '' ? <span className="font-normal text-muted">auto</span> : shown}<Badge tone="slate" className="ml-auto">calc</Badge></div>
                    ) : prm.type === 'select' ? (
                      <select data-lab-input disabled={readOnly} className={cx('input input-sm', flag && 'font-bold')} value={raw === undefined ? '' : raw} onChange={(e) => onChange(prm.id, e.target.value)} aria-label={prm.name}>
                        <option value="">—</option>
                        {prm.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : prm.multiline ? (
                      <textarea data-lab-input disabled={readOnly} rows={2} className="input min-h-[60px] text-[13px]" value={raw === undefined ? '' : raw} placeholder={ph} onChange={(e) => onChange(prm.id, e.target.value)} aria-label={prm.name} />
                    ) : (
                      <input data-lab-input disabled={readOnly} inputMode={prm.type === 'num' ? 'decimal' : undefined} className={cx('input input-sm tnum', flag && 'font-bold', critical && 'border-rose-500')} value={raw === undefined ? '' : raw}
                        placeholder={ph} onChange={(e) => onChange(prm.id, prm.type === 'num' ? e.target.value.replace(/[^\d.<>-]/g, '') : e.target.value)} aria-label={prm.name} />
                    )}
                  </td>
                  <td className="px-1 py-1 text-center text-[11px] font-extrabold">
                    {critical ? <span className="rounded bg-rose-600 px-1 py-0.5 text-white" title="Critical / panic value">{critical}</span> : flag ? <span className={FLAG_TONE[flag]}>{flag}</span> : null}
                  </td>
                  <td className="px-2 py-1 text-[12px] text-muted">{prm.unit}</td>
                  <td className="px-2 py-1 text-[12px] text-muted">{refText(prm, patient)}</td>
                  <td className="px-2 py-1 text-[11px]"><DeltaCell rep={rep} panelId={panel.id} prm={prm} value={computed[prm.id]} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 px-3 py-2">
        {warn && <div className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-700 dark:text-amber-300"><TriangleAlert className="h-3.5 w-3.5" />{warn}</div>}
        {panel.note && <p className="text-[11px] italic text-muted">{panel.note}</p>}
        <Input size="sm" disabled={readOnly} value={remark} onChange={(e) => onRemark(e.target.value)} placeholder="Remarks for this panel (printed)" aria-label={panel.title + ' remarks'} />
      </div>
    </Card>
  );
}

function LabPreview({ rep, settings }) {
  const outer = useRef(null);
  const [w, setW] = useState(800);
  const res = useMemo(() => renderLabPages(rep, settings), [rep, settings]);
  useLayoutEffect(() => {
    if (!outer.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(outer.current);
    return () => ro.disconnect();
  }, []);
  const pageW = res.widthMm * MM;
  const pageH = res.heightMm * MM;
  const k = Math.min(1.4, Math.max(0.3, (w - 24) / pageW));
  return (
    <div ref={outer} className="ff-preview w-full rounded-xl bg-slate-200/70 p-3 dark:bg-slate-950/60">
      <div className="mb-2 text-center text-[11.5px] text-muted">{res.pageCount} A4 page(s) · {rep.status === 'SIGNED_FINAL' ? 'final' : 'PROVISIONAL watermark until verified'}</div>
      <div style={{ width: pageW * k, height: (pageH + 18) * res.pageCount * k, margin: '0 auto', position: 'relative' }}>
        <div style={{ width: pageW, transform: `scale(${k})`, transformOrigin: 'top left', position: 'absolute', left: 0, top: 0 }} dangerouslySetInnerHTML={{ __html: res.html }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- add test / new request
function labTestsList() {
  return store.list('tests').filter(isLabTest).sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));
}

function AddTestModal({ open, onClose, rep, onAdd }) {
  const [id, setId] = useState('');
  if (!open) return null;
  const have = new Set((rep.tests || []).map((t) => t.testId));
  const items = labTestsList().filter((t) => !have.has(t.id));
  const t = items.find((x) => x.id === id);
  return (
    <Modal open size="sm" onClose={onClose} title="Add investigation" icon={ListPlus} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!t} onClick={() => t && onAdd(t)}>Add</Button></>}>
      <Combobox value={id} onChange={setId} items={items} getLabel={(x) => x.name} getSub={(x) => x.department + ' · ' + (x.code || '')} placeholder="Search lab tests…" />
      <p className="mt-2 text-[11.5px] text-muted">Billing is not changed — add the test on the invoice at the billing desk if it is chargeable.</p>
    </Modal>
  );
}

function NewLabRequest({ open, onClose, onCreated }) {
  const patients = useColl('patients');
  const [pid, setPid] = useState('');
  const [ref, setRef] = useState('SELF');
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPid(''); setRef('SELF'); setSel([]); } }, [open]);
  if (!open) return null;
  const tests = labTestsList();
  const toggle = (t) => setSel((s) => (s.includes(t.id) ? s.filter((x) => x !== t.id) : s.concat([t.id])));
  const create = async () => {
    const patient = store.get('patients', pid);
    if (!patient) return toast('Choose the patient', 'warning');
    if (!sel.length) return toast('Choose at least one investigation', 'warning');
    setBusy(true);
    try {
      const dk = dateKey();
      const n = await nextCounter('labsample-' + dk);
      const doc = store.get('doctors', ref);
      const r = store.put('labReports', {
        id: uid('lab_'), visitId: null, patientId: patient.id, patient: patientSnapshot(patient), refBy: ref === 'SELF' || !ref ? 'Self' : doc ? doc.name : '',
        tests: sel.map((id) => { const t = store.get('tests', id); return { testId: t.id, name: t.name, panel: t.labPanel || null }; }), values: {}, remarks: {}, comment: '',
        status: 'PENDING', sampleId: 'S' + dk.slice(2).replace(/-/g, '') + '-L' + pad(n, 2), createdAt: Date.now(), createdBy: (currentUser() || {}).id
      });
      logAudit('lab:request_created', 'labReports/' + r.id, { tests: r.tests.map((t) => t.name) });
      toast('Lab request created · ' + r.sampleId, 'success');
      onCreated(r);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const groups = ['Pathology', 'Biochemistry'];
  return (
    <Modal open size="lg" onClose={onClose} title="New lab request" subtitle="For walk-in samples or tests added later — registered visits create requests automatically" icon={TestTube}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={create}>Create request</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Patient" required><Combobox value={pid} onChange={setPid} items={patients} getLabel={(x) => fullName(x)} getSub={(x) => [x.regId, x.mobile, ageSex(x)].filter(Boolean).join(' · ')} placeholder="Search registered patient…" /></Field>
        <Field label="Referred by"><DoctorPicker value={ref} onChange={setRef} /></Field>
      </div>
      {groups.map((g) => (
        <div key={g} className="mt-3">
          <div className="label">{g}</div>
          <div className="flex flex-wrap gap-1.5">
            {tests.filter((t) => t.department === g).map((t) => (
              <button key={t.id} onClick={() => toggle(t)} className={cx('chip', sel.includes(t.id) && 'chip-on')}>{sel.includes(t.id) && <CircleCheck className="h-3.5 w-3.5" />}{t.shortName || t.name}</button>
            ))}
          </div>
        </div>
      ))}
      {sel.length > 0 && <p className="mt-3 text-[12px] text-muted">{sel.length} selected: {sel.map((id) => (store.get('tests', id) || {}).name).join(', ')}</p>}
    </Modal>
  );
}
