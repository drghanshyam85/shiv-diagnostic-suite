// Billing Desk: invoice metadata, patient, investigations & rates, discounts, multi-mode payments,
// generate & save, auto-send, print preview, share, patient web link and dues.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Receipt, Save, Printer, Share2, Link2, Eraser, Wallet, UserRound, Pencil, FileText, RotateCcw, Trash2, Hash, CalendarClock, ListChecks, MoreHorizontal, MonitorSmartphone, Banknote, QrCode, Clock, Ticket, Siren, Building2, Zap } from 'lucide-react';
import { useColl, useSettings, getSettings, useHotkeys, navigate, useMedia, saveSettings, useLocalPref } from '../../core/hooks';
import { store } from '../../core/store';
import { can, currentUser, logAudit } from '../../core/auth';
import { TITLES, TITLE_GENDER, RELATIONS, validMobile, digits, fullName, fmtDateTime, toLocalInput, fromLocalInput, maskAadhaar, formatAadhaar, uid, dateKey, inr, lsGet, lsSet } from '../../core/utils';
import { invoiceTotals, finalizeInvoice, MODE_LABEL, DIGITAL_MODES, autoTier } from '../../core/finance';
import { previewInvoiceNo, allocateInvoiceNo, newShareId, patientSnapshot, registerVisit } from '../../core/clinic';
import { patientInvoiceLink } from '../../core/share';
import seed from '../../../../shared/seed-data';
import { cx, Card, Field, Input, Select, Segmented, Toggle, Button, Badge, PageHeader, Menu, Drawer, Kpi, toast, confirmDialog, promptDialog } from '../../components/ui';
import { TestPicker, TotalsBlock } from '../../components/TestPicker';
import { DoctorPicker } from '../../components/DoctorPicker';
import { SendToWorkstation } from '../../components/SendToWorkstation';
import { PaymentPanel, paymentFromPanel } from './PaymentPanel';
import { PrintPreview } from './PrintPreview';
import { ShareDialog } from './ShareDialog';
import { BillsSidebar, CollectPaymentModal, collectPayment } from './DuesLedger';

const blankPatient = () => ({ title: 'Mrs.', name: '', relation: 'W/O', guardianName: '', age: '', ageUnit: 'Years', gender: 'Female', mobile: '', email: '', address: '', aadhaar: '', regId: '' });
const blankUmid = () => ({ cardNo: '', beneficiaryName: '', employeeName: '', relation: 'Self', designation: '', unit: seed.UMID_UNITS[0], referralNo: '', referralDate: dateKey(), referringUnit: 'Railway Health Unit – Phulera', verified: false });
const blankDraft = () => ({
  id: null, invoiceNo: '', manualNo: false, date: Date.now(), editDate: false, patientId: null, visitId: null, patient: blankPatient(),
  referredBy: '', items: [], discountType: 'flat', discountValue: 0, discountReason: '', billingType: 'standard', tier: 'standardRate', tierReason: '', tierManual: false, umid: blankUmid(), notes: '', showAadhaar: false
});
/** Re-price lines at `tier` from the rate list (lines without a rate-list test keep their price). */
function priceAt(items, tier, tests) {
  const tm = Object.fromEntries(tests.map((t) => [t.id, t]));
  return items.map((it) => { const t = tm[it.testId]; const rate = t ? Number(t.tariff[tier] || t.tariff.standardRate) : it.rate; return Object.assign({}, it, { rate, amount: rate }); });
}
/** A new draft starts at the automatic tier (doctor partner rate / night emergency rate). */
function withAutoTier(d, tests, settings) {
  if (d.billingType === 'umid' || d.tierManual) return d;
  const a = autoTier({ doctor: store.get('doctors', d.referredBy), settings: settings || getSettings() });
  if (a.tier === (d.tier || 'standardRate') && !a.reason) return Object.assign({}, d, { tierReason: '' });
  return Object.assign({}, d, { tier: a.tier, tierReason: a.reason, items: priceAt(d.items, a.tier, tests) });
}
const TIERS = [{ value: 'standardRate', label: 'Standard' }, { value: 'emergencyRate', label: 'Emergency / STAT', icon: Siren }, { value: 'b2bRate', label: 'B2B / Referral', icon: Building2 }];

/** Today's billing totals for the summary cards: bills, collections by mode, dues and unbilled visits. */
function useTodayBilling(invoices) {
  const visits = useColl('visits');
  return useMemo(() => {
    const today = dateKey();
    const inv = invoices.filter((i) => i.dateKey === today);
    let cash = 0;
    let upi = 0;
    invoices.forEach((i) => (i.payments || []).forEach((p) => {
      if (dateKey(p.at) !== today) return;
      if (p.mode === 'cash') cash += Number(p.amount) || 0; else if (DIGITAL_MODES.has(p.mode)) upi += Number(p.amount) || 0;
    }));
    const unbilled = visits.filter((v) => v.dateKey === today && !v.billed).sort((a, b) => a.createdAt - b.createdAt);
    return {
      bills: inv.length, net: inv.reduce((s, i) => s + (Number(i.net) || 0), 0), cash, upi,
      due: inv.filter((i) => i.billingType !== 'umid').reduce((s, i) => s + (Number(i.balance) || 0), 0), unbilled
    };
  }, [invoices, visits]);
}
const blankPay = () => ({ mode: 'cash', received: '', touched: false, split: { cash: '', upi: '', card: '' }, advance: '', advanceMode: 'cash', ref: '' });

function draftFromVisit(v) {
  const p = store.get('patients', v.patientId) || {};
  const d = blankDraft();
  Object.assign(d, {
    patientId: p.id, visitId: v.id, patient: patientSnapshot(p), referredBy: v.referredBy || 'SELF',
    items: (v.tests || []).map((t) => ({ testId: t.testId, code: t.code, name: t.name, department: t.department, rate: t.rate, amount: t.rate })),
    discountType: v.discountType || 'flat', discountValue: v.discountValue || 0, discountReason: v.discountReason || ''
  });
  return d;
}
function draftFromInvoice(inv) {
  return Object.assign(blankDraft(), inv, { patient: Object.assign(blankPatient(), inv.patient), umid: Object.assign(blankUmid(), inv.umid || {}), manualNo: false, editDate: false, taxRate: Number(inv.taxRate) || 0, tier: inv.tier || 'standardRate' });
}

export function Billing({ route }) {
  const settings = useSettings();
  const invoices = useColl('invoices');
  const tests = useColl('tests');
  const [draft, setDraft] = useState(() => withAutoTier(blankDraft(), store.list('tests'), getSettings()));
  const [pay, setPay] = useState(blankPay);
  const [savedId, setSavedId] = useState(null);
  const [editing, setEditing] = useState(true);
  const [nextNo, setNextNo] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [share, setShare] = useState(null);
  const [collect, setCollect] = useState(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [sendWs, setSendWs] = useState(false);
  const [link, setLink] = useState('');
  const xl = useMedia('(min-width: 1280px)');
  const nameRef = useRef(null);
  const saved = savedId ? invoices.find((i) => i.id === savedId) : null;
  const canBill = can('billing:create_invoice');
  const isUmid = draft.billingType === 'umid';
  const rateLock = isUmid && settings.compliance.umidRateLock && currentUser() && currentUser().role !== 'SUPER_ADMIN_RADIOLOGIST';
  const today = useTodayBilling(invoices);
  const [printAfter, setPrintAfter] = useLocalPref('bill-print-after', !!(settings.billing.receipt || {}).autoPrint);
  const [sendAfter, setSendAfter] = useLocalPref('bill-send-after', !!settings.billing.autoSend);
  const [autoPrint, setAutoPrint] = useState(false);
  const pendingShare = useRef(null);
  const taxRate = draft.taxRate !== undefined ? draft.taxRate : Number(settings.billing.taxRate) || 0;

  useEffect(() => { if (!savedId) previewInvoiceNo(draft.date).then(setNextNo); }, [savedId, invoices.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // live clock until saved
    if (savedId || draft.editDate) return undefined;
    const t = setInterval(() => setDraft((d) => (d.editDate || d.id ? d : Object.assign({}, d, { date: Date.now() }))), 30000);
    return () => clearInterval(t);
  }, [savedId, draft.editDate]);

  // route loading
  useEffect(() => {
    const q = route.query;
    if (q.invoice) {
      const inv = store.get('invoices', q.invoice);
      if (inv) { setDraft(draftFromInvoice(inv)); setSavedId(inv.id); setEditing(false); }
    } else if (q.visit) {
      const v = store.get('visits', q.visit);
      if (v && v.invoiceId && store.get('invoices', v.invoiceId)) { navigate('/billing', { invoice: v.invoiceId }); return; }
      if (v) { setDraft(withAutoTier(draftFromVisit(v), tests, settings)); setSavedId(null); setEditing(true); setPay(blankPay()); }
    } else if (q.patient) {
      const p = store.get('patients', q.patient);
      if (p) { const d = blankDraft(); Object.assign(d, { patientId: p.id, patient: patientSnapshot(p), referredBy: p.referredBy || '' }); setDraft(withAutoTier(d, tests, settings)); setSavedId(null); setEditing(true); setPay(blankPay()); }
    } else if (q.estimate) {
      // Tariff Directory → "Create bill" from a patient estimate
      const est = lsGet('ssdc-pref:billing-estimate', null);
      if (est && Array.isArray(est.items)) {
        const d = blankDraft();
        Object.assign(d, { items: est.items, discountType: 'flat', discountValue: Number(est.discount) || 0, patient: Object.assign(blankPatient(), { name: est.patientName || '' }) });
        setDraft(d); setSavedId(null); setEditing(true); setPay(blankPay());
        lsSet('ssdc-pref:billing-estimate', null);
      }
    }
  }, [route.query.invoice, route.query.visit, route.query.patient, route.query.estimate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (saved) patientInvoiceLink(saved, settings, Object.fromEntries(tests.map((t) => [t.id, t]))).then(setLink); else setLink(''); }, [saved && saved.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => setDraft((d) => Object.assign({}, d, patch));
  const setP = (patch) => setDraft((d) => Object.assign({}, d, { patient: Object.assign({}, d.patient, patch) }));
  const totals = invoiceTotals(Object.assign({}, draft, { taxRate }));

  /** Price tier: re-price every line from the rate list (Standard, Emergency / STAT or B2B). A manual choice sticks. */
  const switchTier = (tier) => set({ tier, items: priceAt(draft.items, tier, tests), tierManual: true, tierReason: '' });
  /** Referring doctor changed on a new bill: follow the doctor's partner tier unless the desk chose one. */
  const setReferrer = (referredBy) => setDraft((d) => (saved ? Object.assign({}, d, { referredBy }) : withAutoTier(Object.assign({}, d, { referredBy }), tests, settings)));

  const validate = () => {
    const e = {};
    if (!draft.patient.name.trim()) e.name = 'Patient name is required';
    if (!draft.items.length) e.items = 'Add at least one investigation';
    if (settings.billing.requireReferringDoctor && !draft.referredBy) e.referredBy = 'Select referring doctor (or Self)';
    if (draft.patient.mobile && !validMobile(draft.patient.mobile)) e.mobile = 'Invalid mobile number';
    if (isUmid && (!draft.umid.cardNo || !draft.umid.referralNo)) e.umid = 'UMID card no. and railway referral no. are mandatory';
    if (draft.manualNo && !draft.invoiceNo.trim()) e.invoiceNo = 'Enter the invoice number or switch back to auto';
    if (draft.manualNo && invoices.some((i) => i.invoiceNo === draft.invoiceNo.trim() && i.id !== draft.id)) e.invoiceNo = 'This invoice number already exists';
    const pr = paymentFromPanel(pay, totals.net);
    if (pay.mode === 'split' && pr.over > 0) e.pay = 'Split amounts exceed the net payable';
    setErrors(e);
    if (Object.keys(e).length) toast(Object.values(e)[0], 'warning');
    return !Object.keys(e).length;
  };

  const generate = async () => {
    if (!canBill) { toast('Your role cannot create invoices', 'error'); return; }
    if (saved && !editing) return;
    if (!validate()) return;
    setBusy(true);
    try {
      const user = currentUser();
      let patientId = draft.patientId;
      let visitId = draft.visitId;
      let regId = draft.patient.regId;
      if (!saved) {
        if (!visitId) {
          const r = await registerVisit({
            patientId, title: draft.patient.title, name: draft.patient.name, age: draft.patient.age, ageUnit: draft.patient.ageUnit, gender: draft.patient.gender,
            mobile: draft.patient.mobile, email: draft.patient.email, relation: draft.patient.relation, guardianName: draft.patient.guardianName, address: draft.patient.address,
            referredBy: draft.referredBy, idEnabled: !!draft.patient.aadhaar, aadhaar: draft.patient.aadhaar, tests: draft.items, obstetric: { enabled: false },
            discountType: draft.discountType, discountValue: draft.discountValue, discountReason: draft.discountReason
          });
          patientId = r.patient.id; visitId = r.visit.id; regId = r.patient.regId;
        }
        const no = draft.manualNo ? draft.invoiceNo.trim() : await allocateInvoiceNo(draft.date);
        const pr = paymentFromPanel(isUmid ? { mode: 'umid' } : pay, totals.net);
        const doctor = store.get('doctors', draft.referredBy);
        const inv = finalizeInvoice({
          id: uid('inv_'), invoiceNo: no, date: draft.date, dateKey: dateKey(draft.date), patientId, visitId,
          patient: Object.assign({}, draft.patient, { regId }), referredBy: draft.referredBy, referredByName: draft.referredBy === 'SELF' ? 'Self' : doctor ? doctor.name : '',
          items: draft.items.map((x) => Object.assign({}, x, { amount: Number(x.rate) || 0 })), billingType: draft.billingType,
          umid: isUmid ? Object.assign({}, draft.umid, { beneficiaryName: draft.patient.name }) : null,
          discountType: draft.discountType, discountValue: Number(draft.discountValue) || 0, discountReason: draft.discountReason,
          taxRate: isUmid ? 0 : taxRate, taxLabel: settings.billing.taxLabel || 'GST', tier: isUmid ? 'cghsRate' : draft.tier || 'standardRate',
          paymentMode: isUmid ? 'umid' : pr.entries.length > 1 ? 'split' : pay.mode, paymentRef: pay.ref || '',
          payments: pr.entries.map((e) => ({ id: uid('pay_'), at: Date.now(), mode: e.mode, amount: e.amount, staffId: user.id, note: pay.ref || '' })),
          staffId: user.id, createdBy: user.id, shareId: newShareId(), notes: draft.notes, sent: {}
        });
        store.put('invoices', inv);
        const v = store.get('visits', visitId);
        if (v) store.put('visits', Object.assign({}, v, { billed: true, invoiceId: inv.id }));
        setSavedId(inv.id); setEditing(false); setDraft(draftFromInvoice(inv));
        toast(`Bill ${inv.invoiceNo} saved — ${inv.status === 'PAID' ? 'PAID IN FULL' : inv.status === 'CASHLESS' ? 'cashless' : 'balance ' + inr(inv.balance)}`, 'success');
        // checkout toggles: print the receipt and / or send it, in that order
        const shareNext = sendAfter ? (validMobile(inv.patient.mobile) || inv.patient.email ? { invoice: inv, autoFire: settings.billing.autoSendChannels } : null) : null;
        if (sendAfter && !shareNext) toast('Receipt not sent: no valid mobile number or e-mail on the bill', 'warning');
        if (printAfter) { pendingShare.current = shareNext; setAutoPrint(true); setPreview(true); } else if (shareNext) setShare(shareNext);
        navigate('/billing', { invoice: inv.id });
      } else {
        const doctor = store.get('doctors', draft.referredBy);
        const next = finalizeInvoice(Object.assign({}, saved, {
          patient: draft.patient, referredBy: draft.referredBy, referredByName: draft.referredBy === 'SELF' ? 'Self' : doctor ? doctor.name : saved.referredByName,
          items: draft.items.map((x) => Object.assign({}, x, { amount: Number(x.rate) || 0 })), discountType: draft.discountType, discountValue: Number(draft.discountValue) || 0,
          discountReason: draft.discountReason, umid: isUmid ? draft.umid : null, notes: draft.notes, date: draft.date, dateKey: dateKey(draft.date)
        }));
        store.put('invoices', next);
        logAudit('invoice:updated', 'invoices/' + next.id, { invoiceNo: next.invoiceNo, net: next.net });
        setEditing(false); setDraft(draftFromInvoice(next));
        toast('Bill updated', 'success');
      }
    } catch (e) { toast('Could not save bill: ' + e.message, 'error'); }
    setBusy(false);
  };

  const newBill = () => { setDraft(withAutoTier(blankDraft(), tests, settings)); setPay(blankPay()); setSavedId(null); setEditing(true); setErrors({}); navigate('/billing'); setTimeout(() => nameRef.current && nameRef.current.focus(), 60); };
  const refund = async () => {
    const amt = await promptDialog({ title: 'Refund / cancellation', label: 'Refund amount (₹)', defaultValue: String(saved.paid), type: 'number', required: true });
    if (!amt) return;
    try { collectPayment(saved.id, -Math.abs(Number(amt)), saved.paymentMode === 'split' ? 'cash' : saved.paymentMode, 'Refund'); toast('Refund recorded', 'success'); } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: 'Cancel & delete invoice?', message: `Invoice ${saved.invoiceNo} will be cancelled. This is recorded in the audit trail.`, danger: true, confirmText: 'Delete invoice' }))) return;
    store.remove('invoices', saved.id);
    const v = store.get('visits', saved.visitId);
    if (v) store.put('visits', Object.assign({}, v, { billed: false, invoiceId: null }));
    logAudit('invoice:deleted', 'invoices/' + saved.id, { invoiceNo: saved.invoiceNo });
    toast('Invoice cancelled', 'success');
    newBill();
  };

  useHotkeys({ 'ctrl+s': () => { generate(); }, 'alt+n': () => { newBill(); }, 'ctrl+p': () => { if (saved) setPreview(true); else toast('Save the bill first', 'info'); } }, [draft, pay, saved, editing]);

  const ro = !!saved && !editing;
  const p = draft.patient;
  const autoSend = settings.billing.autoSend;
  const closePreview = () => {
    setPreview(false);
    setAutoPrint(false);
    if (pendingShare.current) { setShare(pendingShare.current); pendingShare.current = null; }
  };

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader title="Billing Desk" subtitle="Diagnostic & ultrasound billing · split payments · UPI QR · patient web link · WhatsApp / SMS / Email" icon={Receipt}
        actions={<>
          <Toggle checked={autoSend} disabled={!can('settings:manage_clinic_and_integrations')} onChange={(v) => saveSettings({ billing: { autoSend: v } })} label="Auto-send invoice on bill generation" hint={autoSend ? Object.keys(settings.billing.autoSendChannels).filter((k) => settings.billing.autoSendChannels[k]).join(' + ') : 'off'} />
          {!xl && <Button icon={Wallet} onClick={() => setSideOpen(true)}>Dues & bills</Button>}
          <Button icon={Eraser} onClick={newBill}>New bill <span className="kbd ml-1">Alt+N</span></Button>
        </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Bills today" value={today.bills} sub={'Billed ' + inr(today.net)} icon={Receipt} tone="violet" />
        <Kpi label="Cash today" value={inr(today.cash)} sub="Collected at the desk" icon={Banknote} tone="emerald" />
        <Kpi label="UPI / card today" value={inr(today.upi)} sub="Digital collections" icon={QrCode} tone="brand" />
        <Kpi label="Dues today" value={inr(today.due)} sub={today.due > 0 ? 'Collect before reports go out' : 'Nothing pending'} icon={Clock} tone={today.due > 0 ? 'rose' : 'emerald'} onClick={!xl ? () => setSideOpen(true) : undefined} />
        <Kpi label="Not billed yet" value={today.unbilled.length} sub={today.unbilled.length ? 'Registered today' : 'All visits billed'} icon={Ticket} tone={today.unbilled.length ? 'amber' : 'emerald'} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {!saved && !draft.visitId && !draft.items.length && today.unbilled.length > 0 && (
            <Card title="Registered today, not billed" subtitle="Tap a patient to fill the bill from their registration" icon={Ticket}>
              <div className="flex flex-wrap gap-1.5">
                {today.unbilled.slice(0, 12).map((v) => (
                  <button key={v.id} type="button" className="chip" onClick={() => navigate('/billing', { visit: v.id })} title={(v.tests || []).map((t) => t.name).join(', ')}>
                    <b className="tnum">{(v.tokens || {}).combined || ''}</b>{v.patientName}<span className="text-[10px] text-muted">{(v.tests || []).length} test{(v.tests || []).length === 1 ? '' : 's'}</span>
                  </button>
                ))}
              </div>
            </Card>
          )}
          {saved && (
            <div className={cx('flex flex-wrap items-center gap-3 rounded-2xl border p-3.5', saved.status === 'PAID' ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30' : saved.status === 'CASHLESS' ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/30' : 'border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30')}>
              <FileText className="h-7 w-7 text-brand-600" />
              <div className="min-w-0 flex-1">
                <div className="font-display text-lg font-extrabold">{saved.invoiceNo} <Badge tone={saved.status === 'PAID' ? 'emerald' : saved.status === 'CASHLESS' ? 'indigo' : 'rose'}>{saved.status === 'PAID' ? 'PAID IN FULL' : saved.status}</Badge></div>
                <div className="text-sm text-muted">{fullName(saved.patient)} · {fmtDateTime(saved.date)} · Net {inr(saved.net, { decimals: 2 })} · Paid {inr(saved.paid, { decimals: 2 })}{saved.balance > 0 ? ' · Due ' + inr(saved.balance, { decimals: 2 }) : ''}</div>
                <div className="mt-0.5 text-[11px] text-muted">Payments: {(saved.payments || []).map((x) => (MODE_LABEL[x.mode] || x.mode) + ' ' + inr(x.amount)).join(' + ') || '—'} {saved.sent && Object.keys(saved.sent).length ? '· Sent via ' + Object.keys(saved.sent).join(', ') : ''}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" icon={Printer} onClick={() => setPreview(true)}>Print preview</Button>
                <Button variant="whatsapp" icon={Share2} onClick={() => setShare({ invoice: saved })}>Share</Button>
                <Button icon={Link2} onClick={() => window.open(link, '_blank')} disabled={!link}>Patient web link</Button>
                {saved.balance > 0 && saved.billingType !== 'umid' && <Button variant="success" icon={Wallet} onClick={() => setCollect(saved)}>Collect payment</Button>}
                <Menu trigger={<Button icon={MoreHorizontal}>More</Button>} items={[
                  { label: 'Edit bill', icon: Pencil, onClick: () => setEditing(true) },
                  { label: 'Open in other workstation', icon: MonitorSmartphone, onClick: () => setSendWs(true) },
                  { label: 'Refund / cancellation', icon: RotateCcw, onClick: refund, disabled: !can('billing:modify_discounts_refunds') || !saved.paid },
                  { label: 'Delete invoice', icon: Trash2, danger: true, onClick: remove, disabled: !can('billing:modify_discounts_refunds') }
                ]} />
              </div>
            </div>
          )}

          <Card title="Bill details" icon={Hash} actions={<div className="flex flex-wrap justify-end gap-2">
            {!isUmid && draft.tierReason && !saved && <span className="inline-flex items-center gap-1 self-center rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800 dark:bg-violet-950/40 dark:text-violet-200" title="Chosen automatically — pick another tier to override"><Zap className="h-3 w-3" />Auto: {draft.tierReason}</span>}
            {!isUmid && <Segmented size="sm" value={draft.tier || 'standardRate'} onChange={(t) => { if (!ro) switchTier(t); }} options={TIERS} />}
          </div>}>
            <fieldset disabled={ro} className="grid gap-3 md:grid-cols-12">
              <Field label="Bill / invoice number" error={errors.invoiceNo} className="md:col-span-4" extra={<Toggle size="sm" checked={draft.manualNo} disabled={!!saved} onChange={(manualNo) => set({ manualNo, invoiceNo: manualNo ? nextNo : '' })} label={<span className="text-[10px] normal-case">manual</span>} />}>
                <Input value={saved ? saved.invoiceNo : draft.manualNo ? draft.invoiceNo : nextNo} disabled={!draft.manualNo || !!saved} onChange={(e) => set({ invoiceNo: e.target.value })} className="font-mono font-semibold" />
              </Field>
              <Field label="Date & time" className="md:col-span-4" extra={<Toggle size="sm" checked={draft.editDate} onChange={(editDate) => set({ editDate })} label={<span className="text-[10px] normal-case">edit</span>} />}>
                <Input type="datetime-local" value={toLocalInput(draft.date)} disabled={!draft.editDate} onChange={(e) => set({ date: fromLocalInput(e.target.value) })} />
              </Field>
              <Field label="Referred by doctor" required error={errors.referredBy} className="md:col-span-4"><DoctorPicker value={draft.referredBy} onChange={setReferrer} invalid={!!errors.referredBy} /></Field>
            </fieldset>
          </Card>

          <Card title="Patient" icon={UserRound} subtitle={draft.patientId ? 'Linked: ' + (p.regId || '') + (draft.visitId ? ' · visit token ' + ((store.get('visits', draft.visitId) || {}).tokens || {}).combined : '') : 'New walk-in patient (registered automatically on save)'}>
            <fieldset disabled={ro} className="grid gap-3 md:grid-cols-12">
              <Field label="Title" className="md:col-span-2"><Select value={p.title} onChange={(e) => setP({ title: e.target.value, gender: TITLE_GENDER[e.target.value] || p.gender })} options={TITLES} /></Field>
              <Field label="Patient name" required error={errors.name} className="md:col-span-4"><Input ref={nameRef} value={p.name} invalid={!!errors.name} onChange={(e) => setP({ name: e.target.value })} aria-label="Billing patient name" /></Field>
              <Field label="Father's / husband's name" className="md:col-span-4"><div className="flex gap-1.5"><Select className="w-[92px] shrink-0" value={p.relation} onChange={(e) => setP({ relation: e.target.value })} options={RELATIONS} /><Input value={p.guardianName} onChange={(e) => setP({ guardianName: e.target.value })} /></div></Field>
              <Field label="Gender" className="md:col-span-2"><Select value={p.gender} onChange={(e) => setP({ gender: e.target.value })} options={['Female', 'Male', 'Other']} /></Field>
              <Field label="Age" className="md:col-span-3"><div className="flex gap-1.5"><Input type="number" min="0" value={p.age} onChange={(e) => setP({ age: e.target.value })} /><Select className="w-28" value={p.ageUnit} onChange={(e) => setP({ ageUnit: e.target.value })} options={['Years', 'Months', 'Days']} /></div></Field>
              <Field label="Mobile (WhatsApp / SMS)" error={errors.mobile} className="md:col-span-3"><Input inputMode="numeric" value={p.mobile} invalid={!!errors.mobile} onChange={(e) => setP({ mobile: digits(e.target.value).slice(0, 10) })} /></Field>
              <Field label="Address" className="md:col-span-4"><Input value={p.address} list="addr-tags" onChange={(e) => setP({ address: e.target.value })} placeholder="Phulera / Jaipur" /></Field>
              <Field label="Email" className="md:col-span-2"><Input type="email" value={p.email} onChange={(e) => setP({ email: e.target.value })} /></Field>
              <Field label="ID reference (Aadhaar)" className="md:col-span-6" hint="Printed masked by default — toggle in print preview" extra={<button type="button" className="text-[10px] font-semibold normal-case text-brand-600" onClick={() => set({ showAadhaar: !draft.showAadhaar })}>{draft.showAadhaar ? 'mask' : 'show'}</button>}>
                <Input value={draft.showAadhaar ? formatAadhaar(p.aadhaar) : p.aadhaar ? maskAadhaar(p.aadhaar) : ''} placeholder="[Aadhaar Redacted]" onFocus={() => set({ showAadhaar: true })} onChange={(e) => setP({ aadhaar: digits(e.target.value).slice(0, 12) })} className="font-mono" />
              </Field>
              <Field label="Bill notes (internal)" className="md:col-span-6"><Input value={draft.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
            </fieldset>
            <datalist id="addr-tags">{seed.ADDRESS_TAGS.map((t) => <option key={t} value={t + ', Jaipur'} />)}</datalist>
          </Card>

          {isUmid && <div className="rounded-xl border border-line bg-surface2/60 px-4 py-2.5 text-[12.5px] text-muted">Older cashless bill — kept for the record. Cashless billing is no longer offered; new bills are standard cash / UPI / card bills.</div>}

          <Card title="Investigations" icon={ListChecks} subtitle={isUmid ? 'Older cashless bill (CGHS rates)' : 'Rates editable for this bill — master rates in Tariff Directory'} actions={errors.items ? <Badge tone="rose">{errors.items}</Badge> : null}>
            <fieldset disabled={ro} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <TestPicker items={draft.items} onChange={(items) => set({ items })} rateField={isUmid ? 'cghsRate' : draft.tier || 'standardRate'} lockRates={rateLock} />
              <TotalsBlock items={draft.items} discountType={draft.discountType} discountValue={isUmid ? 0 : draft.discountValue} discountReason={draft.discountReason} onChange={set}
                taxRate={isUmid ? 0 : taxRate} taxLabel={settings.billing.taxLabel || 'GST'} billingType={draft.billingType} />
            </fieldset>
          </Card>

          {!saved || editing ? (
            <Card title="Payment" icon={Wallet} subtitle="Total received auto-fills with net payable — edit for partial / split payments">
              {saved ? (
                <div className="text-sm text-muted">Payments already recorded: {(saved.payments || []).map((x) => (MODE_LABEL[x.mode] || x.mode) + ' ' + inr(x.amount)).join(' + ') || 'none'}. Use “Collect payment” for further amounts.</div>
              ) : <PaymentPanel value={pay} onChange={setPay} net={totals.net} invoiceNo={nextNo} umid={isUmid} />}
            </Card>
          ) : null}
        </div>
        {xl && (
          <aside className="sticky top-0 h-[calc(100vh-7rem)] min-h-0 overflow-hidden rounded-xl border border-line bg-surface">
            <BillsSidebar activeId={savedId} onOpen={(i) => navigate('/billing', { invoice: i.id })} />
          </aside>
        )}
      </div>

      <div className="sticky bottom-14 z-30 -mx-3 mt-4 border-t border-line bg-surface/95 px-3 py-2 backdrop-blur sm:-mx-5 sm:px-5 lg:bottom-0">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-sm"><span className="text-muted">Net payable</span> <b className="font-display text-lg tnum">{inr(totals.net, { decimals: 2 })}</b>{totals.taxAmount > 0 && <span className="text-muted"> incl. {settings.billing.taxLabel || 'GST'} {inr(totals.taxAmount, { decimals: 2 })}</span>}</span>
          {(!saved || editing) && !saved && (
            <span className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-2.5 py-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">After saving</span>
              <Toggle size="sm" checked={printAfter} onChange={setPrintAfter} label="Print receipt" />
              <Toggle size="sm" checked={sendAfter} onChange={setSendAfter} label="Send receipt" />
            </span>
          )}
          {(!saved || editing) && <Button variant="primary" size="lg" icon={Save} loading={busy} onClick={generate}>{saved ? 'Update bill' : 'Generate & Save Bill'} <span className="kbd ml-1 border-white/30 bg-white/15 text-white">Ctrl+S</span></Button>}
          {saved && editing && <Button onClick={() => { setDraft(draftFromInvoice(saved)); setEditing(false); }}>Cancel edit</Button>}
          {saved && !editing && <Button variant="primary" icon={Printer} onClick={() => setPreview(true)}>Print <span className="kbd ml-1 border-white/30 bg-white/15 text-white">Ctrl+P</span></Button>}
          <Button icon={CalendarClock} onClick={newBill}>New bill</Button>
        </div>
      </div>

      {saved && <PrintPreview open={preview} onClose={closePreview} invoice={saved} webLink={link} autoPrint={autoPrint} />}
      {share && <ShareDialog open onClose={() => setShare(null)} invoice={store.get('invoices', share.invoice.id) || share.invoice} autoFire={share.autoFire} />}
      {collect && <CollectPaymentModal invoice={collect} onClose={() => setCollect(null)} />}
      <SendToWorkstation open={sendWs} onClose={() => setSendWs(false)} visit={saved ? store.get('visits', saved.visitId) : null} patientName={saved ? fullName(saved.patient) : ''} />
      <Drawer open={sideOpen} onClose={() => setSideOpen(false)} title="Pending dues & bills" icon={Wallet}><BillsSidebar activeId={savedId} onOpen={(i) => { setSideOpen(false); navigate('/billing', { invoice: i.id }); }} /></Drawer>
    </div>
  );
}
