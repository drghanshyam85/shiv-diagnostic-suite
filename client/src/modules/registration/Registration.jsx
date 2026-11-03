// Patient Registration & Multi-Modality Test Intake (Reception).
// Layout for fast keyboard entry: find / scan a returning patient first (auto-fills everything), then
// identity → contact & family → address → referral, one Tab stop per field; * marks required fields.
import { useEffect, useMemo, useRef, useState } from 'react';
import { UserPlus, Save, MonitorSmartphone, Receipt, Eraser, IdCard, Baby, FlaskConical, UserRound, Pencil, Ticket, Printer, ListOrdered, Eye, EyeOff, CircleCheck, MapPin, ClipboardList, ScanLine, Search, Camera, Phone, Sparkles, History } from 'lucide-react';
import { useColl, useSettings, useHotkeys, navigate, useMedia } from '../../core/hooks';
import { store } from '../../core/store';
import { can } from '../../core/auth';
import { TITLES, TITLE_GENDER, RELATIONS, validMobile, formatAadhaar, maskAadhaar, digits, fullName, ageSex, fmtDate, guardianLine } from '../../core/utils';
import { registerVisit, isObstetricTest, modalitiesOf, tokenModality, DEPT_NAME } from '../../core/clinic';
import { parseScan } from '../../core/idscan';
import seed from '../../../../shared/seed-data';
import { cx, Card, Field, Input, Select, Segmented, Toggle, Checkbox, Button, Badge, PageHeader, MicButton, Drawer, toast, confirmDialog } from '../../components/ui';
import { TestPicker, TotalsBlock } from '../../components/TestPicker';
import { DoctorPicker, QuickDoctors, useReferralStats, suggestDoctor } from '../../components/DoctorPicker';
import { CameraScan, cameraScanSupported } from '../../components/CameraScan';
import { PatientHistory } from '../../components/PatientHistory';
import { searchPatients } from '../../layout/PatientSearch';
import { SendToWorkstation } from '../../components/SendToWorkstation';
import { ObstetricPanel, emptyObstetric } from './ObstetricPanel';
import { QueueList } from './QueueList';
import { printTokenSlip } from './tokenSlip';

const emptyForm = () => ({
  patientId: null, title: 'Mrs.', name: '', nameHindi: '', age: '', ageUnit: 'Years', gender: 'Female', mobile: '', email: '',
  relation: 'W/O', guardianName: '', address: '', referredBy: '', idEnabled: false, idType: 'Aadhaar Card', aadhaar: '', aadhaarLast4: '', dob: '', idVerified: false,
  obstetric: emptyObstetric(), tests: [], discountType: 'flat', discountValue: 0, discountReason: ''
});
const GENDERS = [{ value: 'Female', label: 'Female' }, { value: 'Male', label: 'Male' }, { value: 'Other', label: 'Other' }];
const sameName = (a, b) => String(a || '').trim().toLowerCase().replace(/\s+/g, ' ') === String(b || '').trim().toLowerCase().replace(/\s+/g, ' ');
const inEditable = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

function formFromPatient(p, visits) {
  const f = emptyForm();
  Object.assign(f, {
    patientId: p.id, title: p.title || 'Mrs.', name: p.name || '', nameHindi: p.nameHindi || '', age: p.age === undefined ? '' : p.age, ageUnit: p.ageUnit || 'Years',
    gender: p.gender || 'Female', mobile: p.mobile || '', email: p.email || '', relation: p.relation || 'W/O', guardianName: p.guardianName || '',
    address: p.address || '', referredBy: p.referredBy || '', idEnabled: !!(p.aadhaar || p.aadhaarLast4), idType: p.idType || 'Aadhaar Card', aadhaar: p.aadhaar || '',
    aadhaarLast4: p.aadhaarLast4 || '', dob: p.dob || '', idVerified: !!p.idVerified
  });
  const lastObs = visits.filter((v) => v.patientId === p.id && v.obstetric && v.obstetric.lmp).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (lastObs && Date.now() - lastObs.createdAt < 280 * 86400000) f.obstetric = Object.assign(emptyObstetric(), lastObs.obstetric, { enabled: false, formFConsent: false });
  return f;
}

/** The most common full addresses of recent patients, for one-tap fill. */
function useRecentAddresses(limit = 5) {
  const patients = useColl('patients');
  return useMemo(() => {
    const since = Date.now() - 180 * 86400000;
    const count = new Map();
    patients.forEach((p) => {
      const a = String(p.address || '').trim();
      if (a.length < 6 || (p.lastVisitAt || p.updatedAt || 0) < since) return;
      const k = a.toLowerCase();
      const cur = count.get(k) || { a, n: 0 };
      cur.n += 1;
      count.set(k, cur);
    });
    return Array.from(count.values()).sort((x, y) => y.n - x.n).slice(0, limit).map((x) => x.a);
  }, [patients, limit]);
}

export function Registration({ route }) {
  const settings = useSettings();
  const visits = useColl('visits');
  const patients = useColl('patients');
  const stats = useReferralStats();
  const recentAddresses = useRecentAddresses();
  const [form, setForm] = useState(emptyForm);
  const [docHint, setDocHint] = useState(null);
  const [scanNote, setScanNote] = useState('');
  const [camOpen, setCamOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [editDetails, setEditDetails] = useState(true);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [showAadhaar, setShowAadhaar] = useState(false);
  const xl = useMedia('(min-width: 1280px)');
  const nameRef = useRef(null);
  const nameInput = useRef(null);
  const addrRef = useRef(null);
  const canEdit = can('patient:register_and_edit');
  const existing = form.patientId ? store.get('patients', form.patientId) : null;
  const locked = !!existing && !editDetails;

  /** Returning patient: fill every field from the master record, and the referring doctor from past visits. */
  const loadPatient = (p, how) => {
    const f = formFromPatient(p, visits);
    const sug = suggestDoctor(stats, { patientId: p.id, address: p.address });
    if (sug) f.referredBy = sug.id;
    setForm(f); setSaved(null); setEditDetails(false); setErrors({}); setScanNote('');
    setDocHint(sug ? { id: sug.id, text: 'Auto-filled: ' + sug.reason + ' — change if this visit is different' } : null);
    toast((how || 'Returning patient loaded') + ': ' + fullName(p), 'info');
  };

  /** Patient card, token slip, Aadhaar QR (old XML or secure QR), Aadhaar / mobile number. */
  const handleScan = async (raw) => {
    const r = await parseScan(raw);
    if (r.kind === 'regId') {
      const p = patients.find((x) => String(x.regId || '').toUpperCase() === r.value);
      if (p) loadPatient(p, 'Patient card scanned'); else toast('No patient with ID ' + r.value, 'warning');
      return true;
    }
    if (r.kind === 'aadhaarNumber') {
      const p = patients.find((x) => x.aadhaar === r.value);
      if (p) { loadPatient(p, 'Aadhaar matches returning patient'); return true; }
      set({ idEnabled: true, idType: 'Aadhaar Card', aadhaar: r.value, aadhaarLast4: r.value.slice(-4) });
      toast('Aadhaar number added — new patient', 'info');
      return true;
    }
    if (r.kind === 'aadhaarXml' || r.kind === 'aadhaarSecure') {
      const f = r.fields;
      const p = patients.find((x) => (f.aadhaar && x.aadhaar === f.aadhaar) || (f.aadhaarLast4 && (String(x.aadhaar || '').endsWith(f.aadhaarLast4) || x.aadhaarLast4 === f.aadhaarLast4) && sameName(x.name, f.name)));
      if (p) { loadPatient(p, 'Aadhaar matches returning patient'); return true; }
      setForm((fm) => Object.assign(emptyForm(), {
        title: f.title || fm.title, name: f.name || '', age: f.age === '' ? '' : f.age, ageUnit: f.ageUnit || 'Years', gender: f.gender || fm.gender,
        relation: f.relation || fm.relation, guardianName: f.guardianName || '', address: f.address || '', dob: f.dob || '',
        idEnabled: true, idType: 'Aadhaar Card', aadhaar: f.aadhaar || '', aadhaarLast4: f.aadhaarLast4 || '', idVerified: true,
        tests: fm.tests, obstetric: fm.obstetric, referredBy: fm.referredBy
      }));
      setSaved(null); setEditDetails(true); setErrors({}); setDocHint(null);
      setScanNote('Filled from ' + r.label + (f.aadhaarLast4 && !f.aadhaar ? ' · Aadhaar ending ' + f.aadhaarLast4 + ' (the secure QR does not carry the full number)' : '') + (f.mobileLast4 ? ' · mobile ends ' + f.mobileLast4 : '') + '. Check the details, add the mobile number and save.');
      toast('Aadhaar details filled from the QR code', 'success');
      setTimeout(() => { const m = document.querySelector('input[aria-label="Mobile number"]'); if (m) m.focus(); }, 60);
      return true;
    }
    if (r.kind === 'token' || r.kind === 'mobile') {
      const hits = searchPatients(patients, visits, r.value, 5);
      if (hits.length === 1 || (hits[0] && hits[0].score >= 150 && (!hits[1] || hits[1].score < hits[0].score))) { loadPatient(hits[0].p, r.label + ' matched'); return true; }
    }
    return false;
  };

  // keyboard-wedge scanner anywhere on the page (fast burst ending in Enter while no field has focus)
  const scanRef = useRef(handleScan);
  scanRef.current = handleScan;
  useEffect(() => {
    let buf = '';
    let last = 0;
    const onKey = (e) => {
      if (inEditable(document.activeElement)) { buf = ''; return; }
      const now = Date.now();
      if (now - last > 60) buf = '';
      last = now;
      if (e.key === 'Enter') { if (buf.length >= 6) { e.preventDefault(); scanRef.current(buf); } buf = ''; return; }
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) buf += e.key;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // load ?patient= / ?visit=
  useEffect(() => {
    const pid = route.query.patient;
    const vid = route.query.visit;
    if (vid) {
      const v = store.get('visits', vid);
      const p = v && store.get('patients', v.patientId);
      if (p) {
        const f = formFromPatient(p, visits);
        f.tests = (v.tests || []).map((t) => Object.assign({}, t, { amount: t.rate }));
        f.referredBy = v.referredBy;
        if (v.obstetric) f.obstetric = Object.assign(emptyObstetric(), v.obstetric);
        setForm(f); setSaved({ visit: v, patient: p }); setEditDetails(false);
      }
    } else if (pid) {
      const p = store.get('patients', pid);
      if (p) loadPatient(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.query.patient, route.query.visit]);

  const set = (patch) => { setForm((f) => Object.assign({}, f, patch)); setSaved(null); };
  const setDoctor = (referredBy) => { set({ referredBy }); setDocHint(null); };
  // a new patient's address points to the doctors who usually refer from that village / town (suggested, not filled)
  const placeSug = useMemo(() => (!form.patientId && form.address ? suggestDoctor(stats, { address: form.address }) : null), [stats, form.patientId, form.address]);
  const docSuggestion = form.patientId ? (docHint ? { id: docHint.id, reason: docHint.text } : suggestDoctor(stats, { patientId: form.patientId, address: form.address })) : placeSug;
  // a typed mobile / Aadhaar that already belongs to someone → offer to load that patient
  const dupes = useMemo(() => {
    if (form.patientId) return [];
    const m = validMobile(form.mobile) ? form.mobile : '';
    const a = digits(form.aadhaar).length === 12 ? digits(form.aadhaar) : '';
    if (!m && !a) return [];
    return patients.filter((p) => (m && p.mobile === m) || (a && p.aadhaar === a)).slice(0, 4);
  }, [patients, form.patientId, form.mobile, form.aadhaar]);
  const setTitle = (title) => set({ title, gender: TITLE_GENDER[title] || form.gender, relation: title === 'Mrs.' || title === 'Smt.' ? 'W/O' : title === 'Master' || title === 'Mr.' ? 'S/O' : title === 'Baby' || title === 'Ms.' ? 'D/O' : form.relation });

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Patient name is required';
    if (settings.billing.requireReferringDoctor && !form.referredBy) e.referredBy = 'Referring doctor is required (choose “Self” if walk-in)';
    if (form.mobile && !validMobile(form.mobile)) e.mobile = 'Enter a valid 10-digit Indian mobile number';
    if (form.idEnabled && form.aadhaar && digits(form.aadhaar).length !== 12) e.aadhaar = 'Aadhaar must have 12 digits';
    if (form.obstetric.enabled && !form.age) e.age = 'Age is mandatory for PC-PNDT Form F';
    if (form.obstetric.enabled && !form.guardianName.trim()) e.guardianName = 'Husband / father name is mandatory for PC-PNDT Form F';
    setErrors(e);
    if (Object.keys(e).length) { toast(Object.values(e)[0], 'warning'); if (e.name && nameInput.current) nameInput.current.focus(); }
    return !Object.keys(e).length;
  };

  const doSave = async () => {
    if (saved) return saved;
    if (!canEdit) { toast('Your role cannot register patients', 'error'); return null; }
    if (!validate()) return null;
    setSaving(true);
    try {
      const r = await registerVisit(form, { allowEdit: !existing || editDetails });
      setSaved(r);
      setForm((f) => Object.assign({}, f, { patientId: r.patient.id }));
      setEditDetails(false);
      const toks = Object.entries(r.visit.tokens).filter(([k]) => k !== 'combined').map(([, t]) => t).join(', ');
      toast(`Registered ${fullName(r.patient)} — Token ${r.visit.tokens.combined}${toks ? ' (' + toks + ')' : ''}`, 'success');
      return r;
    } catch (e) { toast('Could not register: ' + e.message, 'error'); return null; } finally { setSaving(false); }
  };

  const toBilling = async () => { const r = saved || (await doSave()); if (r) navigate('/billing', { visit: r.visit.id }); };
  const toWorkstation = async () => { const r = saved || (await doSave()); if (r) setSendOpen(true); };
  const clear = async () => {
    if (!saved && (form.name || form.tests.length) && !(await confirmDialog({ title: 'Clear form?', message: 'Unsaved details will be lost. Continue?', confirmText: 'Clear' }))) return;
    setForm(emptyForm()); setSaved(null); setErrors({}); setEditDetails(true); setDocHint(null); setScanNote('');
    if (route.query.patient || route.query.visit) navigate('/register');
    setTimeout(() => { const f = document.querySelector('input[aria-label="Find or scan patient"]'); if (f) f.focus(); }, 50);
  };

  useHotkeys({ 'ctrl+s': () => { doSave(); }, 'ctrl+b': () => { toBilling(); }, 'alt+n': () => { clear(); } }, [form, saved, editDetails]);

  const onTestsChange = (tests) => {
    const hadObs = form.tests.some(isObstetricTest);
    const hasObs = tests.some(isObstetricTest);
    const patch = { tests };
    if (hasObs && !hadObs && !form.obstetric.enabled) {
      patch.obstetric = Object.assign({}, form.obstetric, { enabled: true });
      toast('Obstetric / ANC scan added — PC-PNDT Form F panel activated', 'info');
    }
    set(patch);
  };

  const mods = modalitiesOf(form.tests);
  const visitTokens = saved && saved.visit.tokens;

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader title="Patient Registration & Test Intake" subtitle="Returning patient search · demographics · PC-PNDT · multi-modality investigations · live token" icon={UserPlus}
        actions={<>
          {!xl && <Button icon={ListOrdered} onClick={() => setQueueOpen(true)}>Live queue</Button>}
          <Button icon={Eraser} onClick={clear}>Add New Patient Entry <span className="kbd ml-1">Alt+N</span></Button>
        </>} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          {existing && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-2.5 dark:border-brand-900 dark:bg-brand-950/30">
              <UserRound className="h-5 w-5 text-brand-600" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Returning patient: {fullName(existing)} <span className="font-normal text-muted">· {existing.regId} · {ageSex(existing)}</span></div>
                <div className="text-[11.5px] text-muted">{existing.visitCount || 0} previous visit(s){existing.lastVisitAt ? ' · last on ' + fmtDate(existing.lastVisitAt) : ''}</div>
              </div>
              <Button size="sm" icon={History} onClick={() => setHistOpen(true)}>Past records</Button>
              <Toggle checked={editDetails} onChange={setEditDetails} label="Edit Registration Details" />
            </div>
          )}

          <FindPatient patients={patients} visits={visits} onPick={(p) => loadPatient(p)} onScan={handleScan} onCamera={cameraScanSupported() ? () => setCamOpen(true) : null}
            onNew={(q) => { const d = digits(q); if (d.length >= 10) set({ mobile: d.slice(-10) }); else set({ name: q.replace(/\b\w/g, (c) => c.toUpperCase()) }); setTimeout(() => nameInput.current && nameInput.current.focus(), 30); }} />
          {scanNote && <div className="flex items-start gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"><ScanLine className="mt-0.5 h-4 w-4 shrink-0" /><span>{scanNote}</span></div>}

          <Card title="Patient details" icon={UserRound} subtitle="Fields marked * are required · Tab moves to the next field · ←/→ change the gender"
            actions={existing ? <Badge tone="brand">Returning · {existing.regId}</Badge> : <Badge tone="emerald">New patient</Badge>}>
            <fieldset disabled={locked} className="space-y-4">
              <FormGroup label="Identity">
                <div className="grid gap-3 md:grid-cols-12">
                  <Field label="Title" className="md:col-span-2"><Select value={form.title} onChange={(e) => setTitle(e.target.value)} options={TITLES} aria-label="Title" /></Field>
                  <Field label="Patient full name" required error={errors.name} className="md:col-span-4" extra={<span className="normal-case"><MicButton target={nameInput} size="sm" tabIndex={-1} /></span>}>
                    <Input ref={nameInput} value={form.name} invalid={!!errors.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Sunita Devi" aria-label="Patient full name" aria-required="true" />
                  </Field>
                  <Field label="Age" required={form.obstetric.enabled} error={errors.age} className="md:col-span-3" hint={form.dob ? 'DOB ' + form.dob : ''}>
                    <div className="flex gap-1.5"><Input type="number" min="0" max="120" value={form.age} invalid={!!errors.age} onChange={(e) => set({ age: e.target.value })} aria-label="Age" /><Select value={form.ageUnit} onChange={(e) => set({ ageUnit: e.target.value })} options={['Years', 'Months', 'Days']} className="w-28" aria-label="Age unit" /></div>
                  </Field>
                  <Field label="Gender" className="md:col-span-3"><Segmented size="sm" value={form.gender} onChange={(gender) => set({ gender })} options={GENDERS} ariaLabel="Gender" /></Field>
                </div>
              </FormGroup>
              <FormGroup label="Contact & family">
                <div className="grid gap-3 md:grid-cols-12">
                  <Field label="Mobile number" error={errors.mobile} className="md:col-span-3" hint={form.mobile && validMobile(form.mobile) ? '✓ valid — used for WhatsApp / SMS' : '10 digits, for WhatsApp & SMS'}>
                    <Input inputMode="numeric" maxLength={10} value={form.mobile} invalid={!!errors.mobile} onChange={(e) => set({ mobile: digits(e.target.value).slice(0, 10) })} placeholder="98XXXXXXXX" aria-label="Mobile number" />
                  </Field>
                  <Field label="Relation & husband / father name" required={form.obstetric.enabled} error={errors.guardianName} className="md:col-span-5">
                    <div className="flex gap-1.5"><Select className="w-24" value={form.relation} onChange={(e) => set({ relation: e.target.value })} options={RELATIONS} aria-label="Relation" /><Input value={form.guardianName} invalid={!!errors.guardianName} onChange={(e) => set({ guardianName: e.target.value })} placeholder="Husband / father / spouse name" aria-label="Guardian name" /></div>
                  </Field>
                  <Field label="Email (optional)" className="md:col-span-4"><Input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="for e-mailed reports & invoices" aria-label="Email" /></Field>
                </div>
                {dupes.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    <UserRound className="h-4 w-4" />Already registered with this {dupes.some((p) => p.mobile === form.mobile) ? 'mobile' : 'Aadhaar'}:
                    {dupes.map((p) => <button key={p.id} type="button" className="chip px-2 py-0.5 text-[11.5px]" onClick={() => loadPatient(p, 'Returning patient loaded')}>{fullName(p)} · {p.regId}</button>)}
                  </div>
                )}
              </FormGroup>
              <FormGroup label="Address">
                <Field label="Full postal address" extra={<span className="normal-case"><MicButton target={addrRef} size="sm" tabIndex={-1} /></span>}>
                  <Input ref={addrRef} value={form.address} onChange={(e) => set({ address: e.target.value })} placeholder="House / Ward, Village / Town, District" aria-label="Postal address" />
                </Field>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {seed.ADDRESS_TAGS.map((t) => <button type="button" tabIndex={-1} key={t} className="chip px-2 py-0.5 text-[11px]" onClick={() => set({ address: form.address && !form.address.includes(t) ? form.address.replace(/,?\s*$/, '') + ', ' + t : t + ', Jaipur' })}><MapPin className="h-3 w-3" />{t}</button>)}
                </div>
                {recentAddresses.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">Recent</span>
                    {recentAddresses.map((a) => <button type="button" tabIndex={-1} key={a} className="chip max-w-[260px] px-2 py-0.5 text-[11px]" title={a} onClick={() => set({ address: a })}><MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{a}</span></button>)}
                  </div>
                )}
              </FormGroup>
            </fieldset>
            <div className="mt-4">
              <FormGroup label="Referral">
                <Field label="Referring doctor" required={!!settings.billing.requireReferringDoctor} error={errors.referredBy}>
                  <DoctorPicker value={form.referredBy} onChange={setDoctor} invalid={!!errors.referredBy} inputRef={nameRef} patientId={form.patientId} address={form.address} />
                </Field>
                {docHint && form.referredBy === docHint.id && <div className="mt-1 flex items-center gap-1 text-[11.5px] font-medium text-amber-700 dark:text-amber-300"><Sparkles className="h-3.5 w-3.5" />{docHint.text}</div>}
                <QuickDoctors value={form.referredBy} onChange={setDoctor} suggestion={docSuggestion} />
              </FormGroup>
            </div>
          </Card>

          <Card title="ID proof (Aadhaar)" icon={IdCard} actions={<Toggle checked={form.idEnabled} onChange={(idEnabled) => set({ idEnabled })} label="Enable / Show ID Section" />} padded={form.idEnabled}>
            {form.idEnabled && (
              <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-end">
                <Field label="ID type"><Select value={form.idType} onChange={(e) => set({ idType: e.target.value })} options={['Aadhaar Card', 'Voter ID', 'Ration Card', 'PAN Card', 'Driving Licence', 'Passport']} /></Field>
                <Field label="ID number (masked)" error={errors.aadhaar}>
                  <div className="relative">
                    <Input value={showAadhaar ? formatAadhaar(form.aadhaar) : form.aadhaar ? maskAadhaar(form.aadhaar) : ''} onChange={(e) => { if (showAadhaar) set({ aadhaar: digits(e.target.value).slice(0, 12) }); }}
                      onFocus={() => setShowAadhaar(true)} placeholder={form.aadhaarLast4 ? 'XXXX-XXXX-' + form.aadhaarLast4 + ' (from secure QR)' : 'XXXX-XXXX-XXXX'} className="pr-9 font-mono tracking-wider" aria-label="Aadhaar number" />
                    <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted" onClick={() => setShowAadhaar(!showAadhaar)} title={showAadhaar ? 'Mask' : 'Show'}>{showAadhaar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                  </div>
                </Field>
                <Checkbox checked={form.idVerified} onChange={(idVerified) => set({ idVerified })} label="Verified (original seen)" className="pb-2" />
              </fieldset>
            )}
          </Card>

          <Card title="Pregnancy / Obstetric Case (PC-PNDT Form F)" icon={Baby} padded={form.obstetric.enabled}
            actions={<Toggle checked={form.obstetric.enabled} onChange={(enabled) => set({ obstetric: Object.assign({}, form.obstetric, { enabled }) })} label={form.obstetric.enabled ? 'Active' : 'Hidden'} />}>
            {form.obstetric.enabled && <ObstetricPanel value={form.obstetric} onChange={(obstetric) => set({ obstetric })} />}
          </Card>

          <Card title="Investigations" icon={FlaskConical} subtitle="Pick tests from any department in one go: frequent tests, packages and common combinations are one tap" actions={mods.map((m) => <Badge key={m} tone="brand">{m}</Badge>)}>
            {mods.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2" aria-label="Departments and tokens for this visit">
                {mods.map((m) => {
                  const n = form.tests.filter((t) => tokenModality(t.department) === m).length;
                  return <span key={m} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2.5 py-1 text-[12px]"><Ticket className="h-3.5 w-3.5 text-brand-600" /><b>{m}</b> token · {DEPT_NAME[m]} · {n} test{n === 1 ? '' : 's'}</span>;
                })}
              </div>
            )}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              <TestPicker items={form.tests} onChange={onTestsChange} />
              <TotalsBlock items={form.tests} discountType={form.discountType} discountValue={form.discountValue} discountReason={form.discountReason} onChange={set} title="Estimate (finalised at Bill Desk)" />
            </div>
          </Card>

          {saved && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
              <CircleCheck className="h-7 w-7 text-emerald-600" />
              <div className="min-w-0 flex-1">
                <div className="font-display text-lg font-bold">Registered · Token {visitTokens.combined}</div>
                <div className="text-sm text-muted">{fullName(saved.patient)} · {saved.patient.regId} · {Object.entries(visitTokens).filter(([k]) => k !== 'combined').map(([, t]) => t).join(' · ')}</div>
              </div>
              <Button icon={Printer} onClick={() => printTokenSlip(saved.visit, saved.patient)}>Print token slip</Button>
              {saved.visit.obstetric && can('pcpndt:manage_form_f_register', 'DRAFT') && <Button variant="primary" icon={ClipboardList} onClick={() => navigate('/formf', { visit: saved.visit.id })}>Open Form F</Button>}
              <Button icon={Ticket} onClick={() => navigate('/queue')}>View queue</Button>
            </div>
          )}
        </div>
        {xl && (
          <aside className="sticky top-0 h-[calc(100vh-7rem)] min-h-0 overflow-hidden rounded-xl border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-3 py-2.5"><span className="font-display text-sm font-bold">Central Live Queue</span><Badge tone="emerald" dot>Live</Badge></div>
            <div className="h-[calc(100%-44px)]"><QueueList compact /></div>
          </aside>
        )}
      </div>

      <div className="sticky bottom-14 z-30 -mx-3 mt-4 border-t border-line bg-surface/95 px-3 py-2 backdrop-blur sm:-mx-5 sm:px-5 lg:bottom-0">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-end gap-2">
          <span className="mr-auto hidden text-xs text-muted md:block">{form.tests.length} test(s) · {mods.join(', ') || 'no modality'} {saved ? '· saved' : ''}</span>
          <Button variant="primary" icon={Save} loading={saving} onClick={doSave} disabled={!!saved}>Save & Register <span className="kbd ml-1 border-white/30 bg-white/15 text-white">Ctrl+S</span></Button>
          <Button icon={MonitorSmartphone} onClick={toWorkstation}>Save & Open in Other Workstation</Button>
          <Button variant="dark" icon={Receipt} onClick={toBilling}>Proceed to Bill Desk <span className="kbd ml-1 border-white/30 bg-white/10 text-white">Ctrl+B</span></Button>
          <Button icon={Pencil} onClick={clear}>New / Clear <span className="kbd ml-1">Alt+N</span></Button>
        </div>
      </div>
      <SendToWorkstation open={sendOpen} onClose={() => setSendOpen(false)} visit={saved && saved.visit} patientName={saved ? fullName(saved.patient) : ''} />
      <PatientHistory open={histOpen} patientId={form.patientId} onClose={() => setHistOpen(false)} />
      <CameraScan open={camOpen} onClose={() => setCamOpen(false)} title="Scan patient card or Aadhaar QR" hint="Hold the token slip / patient card QR or the QR on the Aadhaar card inside the frame."
        onCode={async (code) => { setCamOpen(false); if (!(await handleScan(code))) toast('Scanned: ' + String(code).slice(0, 40) + ' — no matching patient', 'info'); }} />
      <Drawer open={queueOpen} onClose={() => setQueueOpen(false)} title="Central Live Queue" icon={ListOrdered}><div className="h-full"><QueueList /></div></Drawer>
    </div>
  );
}

function FormGroup({ label, children }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2"><span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-brand-700 dark:text-brand-300">{label}</span><span className="h-px flex-1 bg-line" /></div>
      {children}
    </section>
  );
}

/**
 * Find a returning patient (mobile, name, husband / father, Reg. ID, token) or scan a card. Choosing a
 * result fills the whole form; a scan (patient card, token slip, Aadhaar QR) is handled the same way.
 */
function FindPatient({ patients, visits, onPick, onScan, onNew, onCamera }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef(null);
  const box = useRef(null);
  const results = useMemo(() => (q.trim().length >= 2 && q.trim().length < 120 ? searchPatients(patients, visits, q, 8) : []), [patients, visits, q]);
  useEffect(() => {
    const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => { const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 80); return () => clearTimeout(t); }, []);
  const pick = (r) => { onPick(r.p); setQ(''); setOpen(false); };
  const looksScanned = (v) => /^\d{200,}$/.test(v) || /PrintLetterBarcodeData/i.test(v) || /^[A-Z]{2,8}-P-\d{3,}$/i.test(v);
  const onKeyDown = async (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(results.length, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Enter') {
      e.preventDefault();
      const v = q.trim();
      if (!v) return;
      if (looksScanned(v) || /^\d{12}$/.test(v)) { if (await onScan(v)) { setQ(''); setOpen(false); } return; }
      if (results[hi]) { pick(results[hi]); return; }
      if (await onScan(v)) { setQ(''); setOpen(false); return; }
      onNew(v); setQ(''); setOpen(false);
    }
  };
  return (
    <div ref={box} className="relative">
      <div className="flex items-center gap-2 rounded-2xl border-2 border-brand-300 bg-surface px-3 py-2 shadow-sm focus-within:border-brand-500 dark:border-brand-800">
        <Search className="h-5 w-5 shrink-0 text-brand-600" />
        <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
          aria-label="Find or scan patient" placeholder="Returning patient? Type mobile, name, husband / father, Reg. ID or token — or scan the patient card / Aadhaar QR"
          className="h-9 min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-muted/80 focus:outline-none" autoComplete="off" />
        <span className="hidden items-center gap-1 text-[11px] text-muted lg:inline-flex"><ScanLine className="h-3.5 w-3.5" />scanner ready</span>
        {onCamera && <Button size="sm" icon={Camera} tabIndex={-1} onClick={onCamera}>Camera</Button>}
      </div>
      {open && q.trim().length >= 2 && !looksScanned(q.trim()) && (
        <div className="absolute left-0 right-0 z-50 mt-1.5 max-h-[60vh] overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-pop">
          {results.map((r, i) => (
            <button key={r.p.id} type="button" onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(r); }}
              className={cx('flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left', i === hi && 'bg-brand-50 dark:bg-brand-950/50')}>
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface2 text-muted"><UserRound className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{fullName(r.p)}</span><span className="text-[11px] text-muted">{ageSex(r.p)}</span></span>
                <span className="block truncate text-[11.5px] text-muted">{[guardianLine(r.p), r.p.address].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="hidden shrink-0 flex-col items-end gap-0.5 sm:flex">
                <span className="flex items-center gap-1 text-[11px] text-muted tnum"><Phone className="h-3 w-3" />{r.p.mobile || '—'}</span>
                <Badge tone="brand">{r.p.regId}</Badge>
                {r.p.lastVisitAt && <span className="text-[10px] text-muted">Last visit {fmtDate(r.p.lastVisitAt)} · {r.p.visitCount || 1} visit(s)</span>}
              </span>
            </button>
          ))}
          <button type="button" onMouseEnter={() => setHi(results.length)} onMouseDown={(e) => { e.preventDefault(); onNew(q.trim()); setQ(''); setOpen(false); }}
            className={cx('flex w-full items-center gap-2 rounded-xl border-t border-line px-2.5 py-2 text-left text-sm font-semibold text-brand-700 dark:text-brand-300', hi === results.length && 'bg-brand-50 dark:bg-brand-950/50')}>
            <UserPlus className="h-4 w-4" />New patient: use “{q.trim()}” as the {digits(q).length >= 10 ? 'mobile number' : 'name'}
          </button>
        </div>
      )}
    </div>
  );
}
