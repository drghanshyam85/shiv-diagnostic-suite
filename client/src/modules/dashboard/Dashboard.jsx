// Front-desk dashboard: today at a glance for the signed-in role — patients, collections, report
// progress and PC-PNDT compliance, the live queue by modality, a 14-day trend, a "needs attention"
// work list (drafts to sign, results to verify, samples to collect, Form F pending, unbilled visits,
// signed-but-unsent reports, dues) and system health (LAN, sync, cloud, messaging channels).
import { useMemo, useState } from 'react';
import {
  UserPlus, Receipt, ListOrdered, ScanLine, Microscope, ClipboardList, Users, Banknote, QrCode, IndianRupee, FileSignature, FlaskConical, Send,
  AlertTriangle, ChevronRight, Server, Cloud, MessageCircle, Mail, Smartphone, Wifi, WifiOff, RefreshCw, TestTube2, CircleDollarSign, Stethoscope, Coins, MailWarning, History
} from 'lucide-react';
import { useColl, useNow, useSettings, navigate } from '../../core/hooks';
import { useAuth, can } from '../../core/auth';
import { useNet } from '../../core/sync';
import { dateKey, addDays, fmtDate, fmtTime, timeAgo, inr, sumBy, round2, fullName, monthLabel, ageSex } from '../../core/utils';
import { store } from '../../core/store';
import { MODALITY_LABEL, waitStats, waitInfo, waitTone, fmtWait, showWaitTimes } from '../../core/clinic';
import { DIGITAL_MODES, eachDay, cashbookDay } from '../../core/finance';
import { paymentsOn, systemTotals, drawerAlert } from '../../modules/cashbook/reconcile';
import { pendingFormFVisits } from '../../core/formf';
import { unsentToday, openSend, failedChannels, CH_LABEL } from '../../modules/dispatch/engine';
import { Card, Button, Badge, Kpi, Segmented, Empty } from '../../components/ui';
import { ChartFrame, ColumnChart, DataTable, compactInr } from '../../components/charts';
import { PatientHistory } from '../../components/PatientHistory';

const MOD_ORDER = ['USG', 'LAB', 'XRAY', 'ECG', 'ECHO'];
const WAIT_TEXT = { emerald: 'text-emerald-700 dark:text-emerald-300', amber: 'text-amber-700 dark:text-amber-300', rose: 'text-rose-600 dark:text-rose-400' };
const STATUS_TONE = { PAID: 'emerald', PARTIAL: 'amber', DUE: 'rose', CASHLESS: 'violet' };

function greeting(h) { return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

export function Dashboard() {
  const { principal } = useAuth();
  const settings = useSettings();
  const now = useNow(60000);
  const today = dateKey(now);
  const visits = useColl('visits');
  const invoices = useColl('invoices');
  const reports = useColl('reports');
  const labs = useColl('labReports');
  const formf = useColl('formf');
  const statements = useColl('statements');
  const dispatchLog = useColl('dispatchLog');
  const denoms = useColl('denoms');
  const expenses = useColl('expenses');
  const floats = useColl('floats');

  const perm = {
    register: can('patient:register_and_edit'),
    bill: can('billing:create_invoice', 'READ'),
    money: can('billing:create_invoice', 'READ') || can('cashbook:manage_daily_register', 'READ') || can('finance:doctor_sharing_and_analytics', 'READ'),
    usg: can('usg:create_and_edit_report', 'READ'),
    sign: can('usg:sign_and_lock_report'),
    lab: can('lab:enter_sample_values', 'DRAFT') || can('lab:verify_and_sign_report', 'READ'),
    verify: can('lab:verify_and_sign_report'),
    formf: can('pcpndt:manage_form_f_register', 'DRAFT'),
    dispatch: can('print:dispatch_signed_reports', 'DRAFT'),
    cash: can('cashbook:manage_daily_register', 'READ'),
    finance: can('finance:doctor_sharing_and_analytics')
  };

  const day = useMemo(() => {
    const vToday = visits.filter((v) => v.dateKey === today);
    const mods = {};
    vToday.forEach((v) => Object.keys(v.tokens || {}).forEach((m) => {
      if (m === 'combined') return;
      const st = (v.status || {})[m] || 'Waiting';
      const row = mods[m] || (mods[m] = { m, waiting: 0, progress: 0, done: 0, next: [] });
      if (st === 'Completed') row.done += 1;
      else if (st === 'In Scan/Sample') row.progress += 1;
      else { row.waiting += 1; if (row.next.length < 4) row.next.push({ token: v.tokens[m], name: v.patientName, visitId: v.id, priority: v.priority }); }
    }));
    const invToday = invoices.filter((i) => i.dateKey === today);
    let cash = 0;
    let upi = 0;
    let card = 0;
    let cashN = 0;
    let upiN = 0;
    invoices.forEach((inv) => (inv.payments || []).forEach((p) => {
      if (dateKey(p.at) !== today) return;
      const a = Number(p.amount) || 0;
      if (p.mode === 'cash') { cash += a; cashN += 1; } else if (p.mode === 'card') card += a;
      else if (DIGITAL_MODES.has(p.mode)) { upi += a; upiN += 1; }
    }));
    const repToday = reports.filter((r) => r.visitId && vToday.some((v) => v.id === r.visitId));
    const usgVisits = vToday.filter((v) => v.tokens && v.tokens.USG);
    const labToday = labs.filter((l) => vToday.some((v) => v.id === l.visitId));
    return {
      visits: vToday,
      waiting: Object.values(mods).reduce((s, r) => s + r.waiting, 0),
      progress: Object.values(mods).reduce((s, r) => s + r.progress, 0),
      mods: MOD_ORDER.map((m) => mods[m]).filter(Boolean).concat(Object.values(mods).filter((r) => !MOD_ORDER.includes(r.m))),
      bills: invToday.length,
      net: round2(sumBy(invToday, 'net')),
      due: round2(sumBy(invToday.filter((i) => i.billingType !== 'umid'), 'balance')),
      cash: round2(cash),
      upi: round2(upi),
      card: round2(card),
      cashN,
      upiN,
      discount: round2(sumBy(invToday, 'discountAmount')),
      unbilled: vToday.filter((v) => !v.billed).sort((a, b) => a.createdAt - b.createdAt),
      usgTotal: usgVisits.length,
      usgSigned: repToday.filter((r) => r.status === 'SIGNED_FINAL').length,
      labTotal: labToday.length,
      labSigned: labToday.filter((l) => l.status === 'SIGNED_FINAL').length,
      recentBills: invToday.slice().sort((a, b) => (b.createdAt || b.date || 0) - (a.createdAt || a.date || 0)).slice(0, 6)
    };
  }, [visits, invoices, reports, labs, today]);

  const work = useMemo(() => {
    const since = dateKey(addDays(now, -30));
    const drafts = reports.filter((r) => (r.status === 'DRAFT' || r.status === 'AMENDING') && String(r.html || '').trim() && (r.demographics || {}).date >= since)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const toVerify = labs.filter((l) => l.status === 'SUBMITTED').sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
    const toCollect = labs.filter((l) => l.status === 'PENDING' && dateKey(l.createdAt || 0) >= dateKey(addDays(now, -2))).sort((a, b) => a.createdAt - b.createdAt);
    const entry = labs.filter((l) => l.status === 'SAMPLE_COLLECTED').sort((a, b) => a.createdAt - b.createdAt);
    const dues = invoices.filter((i) => i.billingType !== 'umid' && i.balance > 0 && i.dateKey >= since).sort((a, b) => b.balance - a.balance);
    // doctor statements audited but not yet approved by the owner (or still unaudited) for past months
    const curMonth = today.slice(0, 7);
    const stmPending = statements.filter((st) => !st.approved && /^M\d{4}-\d{2}$/.test(String(st.period || '')) && st.period.slice(1) < curMonth)
      .map((st) => Object.assign({}, st, { doctorName: (store.get('doctors', st.doctorId) || {}).name || 'Doctor', monthLabel: monthLabel(st.period.slice(1)) }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    // could not be sent, or sent but the delivery receipt came back failed (WhatsApp / SMS webhooks)
    const failed = dispatchLog.filter((e) => dateKey(e.at || e.createdAt || 0) === today && !e.resentAt && (e.status === 'failed' || e.status === 'partial' || failedChannels(e).length > 0))
      .sort((a, b) => (b.at || 0) - (a.at || 0));
    // today's cash counts / bank statements that do not match the system, or counts gone stale since
    const drawer = denoms.filter((d) => d.date === today).map((d) => {
      const kpi = cashbookDay({ date: today, staffId: d.staffId, invoices, expenses, floats, testsMap: {} }).kpi;
      const alert = drawerAlert({ kpi, sys: systemTotals(paymentsOn({ date: today, staffId: d.staffId, invoices })), denomDoc: d });
      return alert ? Object.assign({}, d, { alert }) : null;
    }).filter(Boolean);
    return { drafts, toVerify, toCollect, entry, dues, formF: pendingFormFVisits(7), unsent: unsentToday(today), stmPending, failed, drawer };
  }, [reports, labs, invoices, formf, statements, dispatchLog, denoms, expenses, floats, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const hour = new Date(now).getHours();
  const firstName = String(principal.name || '').replace(/^Dr\.?\s+/i, 'Dr. ').split(' ').slice(0, 2).join(' ');
  const actions = [
    perm.register && { label: 'Register patient', icon: UserPlus, to: '/register', primary: true },
    perm.bill && can('billing:create_invoice') && { label: 'New bill', icon: Receipt, to: '/billing' },
    { label: 'Live queue', icon: ListOrdered, to: '/queue' },
    perm.usg && { label: 'USG reporting', icon: ScanLine, to: '/report' },
    perm.lab && { label: 'Pathology lab', icon: Microscope, to: '/lab' },
    perm.formf && { label: 'Form F', icon: ClipboardList, to: '/formf' }
  ].filter(Boolean);

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-extrabold tracking-tight sm:text-2xl">{greeting(hour)}, {firstName}</h1>
          <p className="text-[13px] text-muted">{new Date(now).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {settings.clinic.name} · {principal.roleLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => <Button key={a.label} size="sm" variant={a.primary ? 'primary' : 'secondary'} icon={a.icon} onClick={() => navigate(a.to)}>{a.label}</Button>)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Patients today" value={day.visits.length} sub={day.waiting + ' waiting · ' + day.progress + ' in scan / sample'} icon={Users} onClick={() => navigate('/queue')} />
        {perm.money && <Kpi label="Cash collected" tone="emerald" value={inr(day.cash)} sub={day.cashN + ' cash payment' + (day.cashN === 1 ? '' : 's') + ' today'} icon={Banknote} onClick={can('cashbook:manage_daily_register', 'READ') ? () => navigate('/cashbook') : undefined} />}
        {perm.money && <Kpi label="UPI collected" tone="brand" value={inr(day.upi)} sub={day.upiN + ' UPI payment' + (day.upiN === 1 ? '' : 's') + (day.card ? ' · card ' + inr(day.card) : '')} icon={QrCode} onClick={can('cashbook:manage_daily_register', 'READ') ? () => navigate('/cashbook') : undefined} />}
        {perm.money && <Kpi label="Billed today" tone="violet" value={inr(day.net)} sub={day.bills + ' bills' + (day.due > 0 ? ' · due ' + inr(day.due) : ' · no dues') + (day.discount ? ' · disc. ' + inr(day.discount) : '')} icon={IndianRupee} onClick={perm.bill ? () => navigate('/billing') : undefined} />}
        {perm.usg && <Kpi label="USG reports" tone="brand" value={day.usgSigned + ' / ' + day.usgTotal} sub={'signed today · ' + work.drafts.length + ' draft' + (work.drafts.length === 1 ? '' : 's') + ' open'} icon={FileSignature} onClick={() => navigate('/report')} />}
        {perm.lab && <Kpi label="Lab reports" tone="rose" value={day.labSigned + ' / ' + day.labTotal} sub={work.toVerify.length + ' to verify · ' + (work.toCollect.length + work.entry.length) + ' in progress'} icon={FlaskConical} onClick={() => navigate('/lab')} />}
        {perm.formf && <Kpi label="Form F pending" tone={work.formF.length ? 'amber' : 'emerald'} value={work.formF.length} sub={work.formF.length ? 'obstetric scans, last 7 days' : 'all finalised'} icon={ClipboardList} onClick={() => navigate('/formf')} />}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <QueueCard mods={day.mods} total={day.visits.length} visits={day.visits} />
          <RecentPatients today={today} visits={visits} invoices={invoices} reports={reports} labs={labs} />
          <TrendCard visits={visits} invoices={invoices} now={now} money={perm.money} />
          {perm.bill && <RecentBills bills={day.recentBills} />}
        </div>
        <div className="min-w-0 space-y-4">
          <WorkCard work={work} day={day} perm={perm} />
          <SystemCard />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- live queue
function QueueCard({ mods, total, visits }) {
  const now = useNow(30000);
  const settings = useSettings();
  const showWaits = showWaitTimes(settings); // off by default: each line shows the token and the patient's name
  const waits = useMemo(() => (showWaits ? waitStats(visits, now) : {}), [visits, now, showWaits]);
  const byId = useMemo(() => Object.fromEntries(visits.map((v) => [v.id, v])), [visits]);
  return (
    <Card title="Live queue" subtitle={total ? total + ' patient' + (total === 1 ? '' : 's') + ' registered today' : 'No registrations yet today'} icon={ListOrdered}
      actions={<Button size="sm" variant="ghost" iconRight={ChevronRight} onClick={() => navigate('/queue')}>Open queue</Button>}>
      {!mods.length ? <Empty icon={ListOrdered} title="Queue is empty" text="Registered patients appear here instantly on every workstation." /> : (
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {mods.map((r) => (
            <div key={r.m} className="rounded-xl border border-line p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-[15px] font-bold">{MODALITY_LABEL[r.m] || r.m}</span>
                <span className="text-[11.5px] text-muted">{r.done} of {r.waiting + r.progress + r.done} done</span>
              </div>
              {waits[r.m] && waits[r.m].waiting > 0 && <div className="mt-1 text-[11.5px] text-muted">Average wait <b className={WAIT_TEXT[waitTone(waits[r.m].avg)]}>{fmtWait(waits[r.m].avg)}</b> · longest <b className={WAIT_TEXT[waitTone(waits[r.m].longest)]}>{fmtWait(waits[r.m].longest)}</b></div>}
              <div className="mt-2 flex gap-2 text-[12px]">
                <span className="rounded-lg bg-amber-50 px-2 py-1 font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{r.waiting} waiting</span>
                <span className="rounded-lg bg-emerald-50 px-2 py-1 font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">{r.progress} in progress</span>
              </div>
              {r.next.length > 0 && (
                <div className="mt-2 space-y-1">
                  {r.next.map((n) => (
                    <div key={n.visitId} className="flex items-center gap-2 text-[12.5px]">
                      <span className="w-14 shrink-0 font-mono text-[12px] font-bold">{n.token}</span>
                      <span className="min-w-0 flex-1 truncate">{n.name}</span>
                      {n.priority === 'Emergency' && <Badge tone="rose">STAT</Badge>}
                      {showWaits && byId[n.visitId] && (() => { const w = waitInfo(byId[n.visitId], r.m, now); return <span className={'shrink-0 text-[11.5px] font-semibold tnum ' + WAIT_TEXT[waitTone(w.minutes)]}>{fmtWait(w.minutes)}</span>; })()}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- 14-day trend
function TrendCard({ visits, invoices, now, money }) {
  const [metric, setMetric] = useState('patients');
  const days = useMemo(() => eachDay(dateKey(addDays(now, -13)), dateKey(now)), [now]);
  const data = useMemo(() => {
    const cnt = {};
    const rev = {};
    visits.forEach((v) => { cnt[v.dateKey] = (cnt[v.dateKey] || 0) + 1; });
    invoices.forEach((i) => { rev[i.dateKey] = (rev[i.dateKey] || 0) + (Number(i.net) || 0); });
    return days.map((k) => {
      const d = new Date(k + 'T00:00:00');
      const value = metric === 'patients' ? cnt[k] || 0 : round2(rev[k] || 0);
      return { key: k, label: String(d.getDate()), title: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }), value, rows: [{ label: metric === 'patients' ? 'patients' : 'billed', value: metric === 'patients' ? String(value) : inr(value) }] };
    });
  }, [visits, invoices, days, metric]);
  const total = sumBy(data, 'value');
  const fmt = metric === 'patients' ? (v) => String(v) : (v) => compactInr(v);
  return (
    <ChartFrame
      title={metric === 'patients' ? 'Patients per day' : 'Billing per day'}
      subtitle={'Last 14 days · ' + (metric === 'patients' ? total + ' patients' : inr(total) + ' billed') + ' · ' + fmtDate(days[0]) + ' – ' + fmtDate(days[days.length - 1])}
      actions={money ? <Segmented size="sm" value={metric} onChange={setMetric} options={[{ value: 'patients', label: 'Patients' }, { value: 'revenue', label: 'Billing' }]} /> : null}
      table={<DataTable columns={[{ label: 'Date', get: (r) => r.title }, { label: metric === 'patients' ? 'Patients' : 'Billed (₹)', num: true, get: (r) => (metric === 'patients' ? r.value : inr(r.value)) }]} rows={data.slice().reverse()} />}>
      <ColumnChart data={data} height={190} format={fmt} integer={metric === 'patients'} ariaLabel={(metric === 'patients' ? 'Patients' : 'Billing') + ' per day, last 14 days'} />
    </ChartFrame>
  );
}

// ---------------------------------------------------------------- recent bills
// ---------------------------------------------------------------- recent & returning patients
const PT_VIEWS = [{ value: 'today', label: 'Today' }, { value: 'returning', label: 'Returning' }, { value: 'recent', label: 'All recent' }];

function RecentPatients({ today, visits, invoices, reports, labs }) {
  const patients = useColl('patients');
  const [view, setView] = useState('today');
  const [hist, setHist] = useState(null);
  const latest = useMemo(() => {
    const pick = (list, key, at) => { const m = {}; list.forEach((x) => { const k = x[key]; if (!k) return; if (!m[k] || (x[at] || 0) > (m[k][at] || 0)) m[k] = x; }); return m; };
    return { inv: pick(invoices, 'patientId', 'date'), rep: pick(reports.filter((r) => !r._deleted), 'patientId', 'createdAt'), lab: pick(labs, 'patientId', 'createdAt'), visit: pick(visits, 'patientId', 'createdAt') };
  }, [invoices, reports, labs, visits]);
  const rows = useMemo(() => {
    const byId = Object.fromEntries(patients.map((p) => [p.id, p]));
    if (view === 'today') {
      const seen = new Set();
      return visits.filter((v) => v.dateKey === today).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .filter((v) => { if (seen.has(v.patientId)) return false; seen.add(v.patientId); return true; })
        .map((v) => ({ p: byId[v.patientId], v })).filter((r) => r.p).slice(0, 12);
    }
    const since = Date.now() - (view === 'returning' ? 60 : 30) * 86400000;
    return patients.filter((p) => (p.lastVisitAt || 0) >= since && (view !== 'returning' || (p.visitCount || 0) >= 2))
      .sort((a, b) => (b.lastVisitAt || 0) - (a.lastVisitAt || 0)).slice(0, 12).map((p) => ({ p, v: latest.visit[p.id] }));
  }, [view, visits, patients, today, latest]);
  const perm = { bill: can('billing:create_invoice', 'READ'), usg: can('usg:create_and_edit_report', 'READ'), lab: can('lab:enter_sample_values', 'READ') || can('lab:verify_and_sign_report', 'READ'), reg: can('patient:register_and_edit') };
  const returningToday = useMemo(() => {
    const byId = Object.fromEntries(patients.map((p) => [p.id, p]));
    return new Set(visits.filter((v) => v.dateKey === today && byId[v.patientId] && (byId[v.patientId].visitCount || 0) >= 2).map((v) => v.patientId)).size;
  }, [visits, patients, today]);
  return (
    <Card title="Recent & returning patients" icon={History} padded={false}
      subtitle={view === 'today' ? returningToday + ' returning today · click a patient for the full history' : view === 'returning' ? 'Seen before and back within 60 days' : 'Last 30 days'}
      actions={<Segmented size="sm" value={view} onChange={setView} options={PT_VIEWS} ariaLabel="Patient list" />}>
      {!rows.length ? <div className="p-4"><Empty icon={Users} title={view === 'today' ? 'No registrations yet today' : 'No patients in this view'} /></div> : (
        <ul className="divide-y divide-line">
          {rows.map(({ p, v }) => {
            const n = p.visitCount || 0;
            const inv = latest.inv[p.id];
            const rep = latest.rep[p.id];
            const lab = latest.lab[p.id];
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 hover:bg-surface2/50">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setHist(p.id)} title="Open past records">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[12px] font-bold text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">{String(p.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5"><span className="truncate text-[13px] font-semibold">{fullName(p)}</span>{n >= 2 ? <Badge tone="violet">Returning · {n} visits</Badge> : <Badge tone="emerald">New</Badge>}</span>
                    <span className="block truncate text-[11.5px] text-muted">{[p.regId, ageSex(p), p.mobile].filter(Boolean).join(' · ')}{v ? ' · ' + (v.dateKey === today ? fmtTime(v.createdAt) : fmtDate(v.createdAt)) + ' · ' + (v.tests || []).map((t) => t.name).join(', ') : ''}</span>
                  </span>
                </button>
                <span className="flex shrink-0 flex-wrap items-center gap-1">
                  {inv && perm.bill && <Button size="xs" variant="ghost" icon={Receipt} title={'Bill ' + inv.invoiceNo} onClick={() => navigate('/billing', { invoice: inv.id })}>Bill</Button>}
                  {rep && perm.usg && <Button size="xs" variant="ghost" icon={ScanLine} title="Latest USG report" onClick={() => navigate('/report', { id: rep.id })}>USG</Button>}
                  {lab && perm.lab && <Button size="xs" variant="ghost" icon={Microscope} title="Latest lab report" onClick={() => navigate('/lab', { id: lab.id })}>Lab</Button>}
                  <Button size="xs" icon={History} onClick={() => setHist(p.id)}>History</Button>
                  {perm.reg && v && v.dateKey !== today && <Button size="xs" variant="ghost" icon={UserPlus} title="Register a new visit" onClick={() => navigate('/register', { patient: p.id })}>Visit</Button>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <PatientHistory open={!!hist} patientId={hist} onClose={() => setHist(null)} />
    </Card>
  );
}

function RecentBills({ bills }) {
  return (
    <Card title="Today’s latest bills" icon={Receipt} padded={false}
      actions={<Button size="sm" variant="ghost" iconRight={ChevronRight} onClick={() => navigate('/billing')}>Billing desk</Button>}>
      {!bills.length ? <div className="p-4"><Empty icon={Receipt} title="No bills yet today" text="Bills generated at any counter appear here." /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12.5px]">
            <thead><tr className="text-left text-[10.5px] uppercase tracking-wide text-muted"><th className="px-4 py-2 font-semibold">Bill</th><th className="px-2 py-2 font-semibold">Patient</th><th className="px-2 py-2 font-semibold">Tests</th><th className="px-2 py-2 text-right font-semibold">Net</th><th className="px-4 py-2 text-right font-semibold">Status</th></tr></thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id} className="cursor-pointer border-t border-line/70 hover:bg-surface2" onClick={() => navigate('/billing', { invoice: b.id })}>
                  <td className="px-4 py-2 font-mono text-[12px]">{b.invoiceNo}</td>
                  <td className="max-w-[180px] truncate px-2 py-2 font-semibold">{fullName(b.patient)}</td>
                  <td className="max-w-[220px] truncate px-2 py-2 text-muted">{(b.items || []).map((x) => x.name).join(', ')}</td>
                  <td className="px-2 py-2 text-right tnum">{inr(b.net)}</td>
                  <td className="px-4 py-2 text-right"><Badge tone={STATUS_TONE[b.status] || 'slate'}>{b.status === 'PARTIAL' ? 'Due ' + inr(b.balance) : b.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- needs attention
function WorkGroup({ icon: Icon, title, count, tone = 'amber', items, render, onAll }) {
  if (!count) return null;
  return (
    <div className="border-t border-line pt-3 first:border-t-0 first:pt-0">
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted" />
        <span className="text-[13px] font-semibold">{title}</span>
        <Badge tone={tone}>{count}</Badge>
        {onAll && <button type="button" onClick={onAll} className="ml-auto text-[11.5px] font-semibold text-brand-700 hover:underline dark:text-brand-300">View all</button>}
      </div>
      <ul className="space-y-0.5">
        {items.slice(0, 4).map((x, i) => {
          const r = render(x);
          return (
            <li key={r.key || i}>
              <button type="button" onClick={r.onClick} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-surface2">
                <span className="min-w-0 flex-1 truncate"><span className="font-semibold">{r.title}</span>{r.sub && <span className="text-muted"> · {r.sub}</span>}</span>
                {r.right && <span className="shrink-0 text-[11.5px] text-muted">{r.right}</span>}
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WorkCard({ work, day, perm }) {
  const groups = [
    perm.usg && <WorkGroup key="drafts" icon={FileSignature} title={perm.sign ? 'USG reports to sign' : 'USG drafts open'} count={work.drafts.length} tone="brand" items={work.drafts} onAll={() => navigate('/report')}
      render={(r) => ({ key: r.id, title: (r.demographics || {}).name || 'Patient', sub: (r.demographics || {}).modality || 'Ultrasound', right: r.status === 'AMENDING' ? 'amending' : timeAgo(r.updatedAt), onClick: () => navigate('/report', { id: r.id }) })} />,
    perm.verify && <WorkGroup key="verify" icon={FlaskConical} title="Lab results to verify & sign" count={work.toVerify.length} tone="rose" items={work.toVerify} onAll={() => navigate('/lab')}
      render={(l) => ({ key: l.id, title: fullName(l.patient), sub: (l.tests || []).map((t) => t.name).join(', '), right: l.sampleId, onClick: () => navigate('/lab', { id: l.id }) })} />,
    perm.lab && <WorkGroup key="collect" icon={TestTube2} title="Samples to collect" count={work.toCollect.length} items={work.toCollect} onAll={() => navigate('/lab')}
      render={(l) => ({ key: l.id, title: fullName(l.patient), sub: (l.tests || []).map((t) => t.name).join(', '), right: fmtTime(l.createdAt), onClick: () => navigate('/lab', { id: l.id }) })} />,
    perm.lab && <WorkGroup key="entry" icon={Microscope} title="Results to enter" count={work.entry.length} tone="violet" items={work.entry} onAll={() => navigate('/lab')}
      render={(l) => ({ key: l.id, title: fullName(l.patient), sub: (l.tests || []).map((t) => t.name).join(', '), right: l.sampleId, onClick: () => navigate('/lab', { id: l.id }) })} />,
    perm.formf && <WorkGroup key="formf" icon={ClipboardList} title="Form F to complete (PC-PNDT)" count={work.formF.length} tone="amber" items={work.formF} onAll={() => navigate('/formf')}
      render={(x) => ({ key: x.visit.id, title: x.visit.patientName, sub: x.formf ? 'draft ' + (x.formf.snoLabel || '') : 'not started', right: fmtDate(x.visit.createdAt), onClick: () => navigate('/formf', { visit: x.visit.id }) })} />,
    perm.bill && <WorkGroup key="unbilled" icon={Receipt} title="Registered but not billed" count={day.unbilled.length} items={day.unbilled} onAll={() => navigate('/queue')}
      render={(v) => ({ key: v.id, title: v.patientName, sub: (v.tests || []).map((t) => t.name).join(', '), right: fmtTime(v.createdAt), onClick: () => navigate('/billing', { visit: v.id }) })} />,
    perm.dispatch && <WorkGroup key="unsent" icon={Send} title="Signed today, not yet sent" count={work.unsent.length} tone="emerald" items={work.unsent} onAll={() => navigate('/dispatch')}
      render={(x) => ({ key: x.doc.id, title: x.kind === 'usg' ? (x.doc.demographics || {}).name : fullName(x.doc.patient), sub: x.kind === 'usg' ? 'USG report' : 'Lab report', right: 'Send', onClick: () => openSend(x.kind, x.doc) })} />,
    perm.dispatch && <WorkGroup key="failed" icon={MailWarning} title="Messages that failed today" count={work.failed.length} tone="rose" items={work.failed} onAll={() => navigate('/dispatch', { tab: 'dashboard' })}
      render={(e) => {
        const bad = Array.from(new Set(Object.entries(e.channels || {}).filter(([, r]) => r !== 'sent' && r !== 'opened').map(([c]) => c).concat(failedChannels(e))));
        const undelivered = bad.filter((c) => e.delivery && e.delivery[c] && e.delivery[c].status === 'failed' && (e.channels || {})[c] === 'sent');
        return { key: e.id, title: e.patientName || e.title, sub: bad.map((c) => CH_LABEL[c] || c).join(', ') + (undelivered.length === bad.length && bad.length ? ' not delivered' : ' failed'), right: fmtTime(e.at), onClick: () => navigate('/dispatch', { tab: 'dashboard' }) };
      }} />,
    perm.cash && <WorkGroup key="drawer" icon={Coins} title="Cash / UPI not reconciled" count={work.drawer.length} tone="rose" items={work.drawer} onAll={() => navigate('/cashbook')}
      render={(d) => ({ key: d.id, title: d.alert.title, sub: (d.staffId === 'ALL' ? 'All staff · ' : '') + d.alert.sub, right: fmtTime(d.savedAt || (d.digital && d.digital.at)), onClick: () => navigate('/cashbook') })} />,
    perm.finance && <WorkGroup key="stm" icon={Stethoscope} title="Doctor statements awaiting approval" count={work.stmPending.length} tone="violet" items={work.stmPending} onAll={() => navigate('/accounts', { tab: 'statements' })}
      render={(st) => ({ key: st.id, title: st.doctorName, sub: st.monthLabel + (st.verified ? ' · audited' : ' · not audited'), right: st.totals ? inr(st.totals.payable) : '', onClick: () => navigate('/accounts', { tab: 'statements', doctor: st.doctorId }) })} />,
    perm.bill && <WorkGroup key="dues" icon={CircleDollarSign} title="Outstanding dues (30 days)" count={work.dues.length} tone="rose" items={work.dues} onAll={() => navigate('/billing')}
      render={(i) => ({ key: i.id, title: fullName(i.patient), sub: i.invoiceNo, right: inr(i.balance), onClick: () => navigate('/billing', { invoice: i.id }) })} />
  ].filter(Boolean);
  const any = groups.some((g) => g.props.count > 0);
  return (
    <Card title="Needs attention" icon={AlertTriangle}>
      {any ? <div className="space-y-3">{groups}</div> : <Empty icon={AlertTriangle} title="All clear" text="Nothing is waiting on you right now." />}
    </Card>
  );
}

// ---------------------------------------------------------------- system health
function SystemCard() {
  const net = useNet();
  const server = net.mode === 'server';
  const ch = net.integrations || {};
  const providers = (net.cloud && net.cloud.providers) || {};
  const connected = Object.entries(providers).filter(([, p]) => p.connected).map(([k]) => ({ gdrive: 'Google Drive', onedrive: 'OneDrive', gcp: 'Google Cloud' }[k] || k));
  const Row = ({ icon: I, label, children }) => (
    <div className="flex items-center gap-2 py-1 text-[12.5px]"><I className="h-4 w-4 shrink-0 text-muted" /><span className="w-24 shrink-0 text-muted">{label}</span><span className="min-w-0 flex-1 truncate">{children}</span></div>
  );
  return (
    <Card title="System" icon={Server} actions={can('settings:manage_clinic_and_integrations') ? <Button size="sm" variant="ghost" onClick={() => navigate('/settings', { tab: 'integrations' })}>Settings</Button> : null}>
      <Row icon={server ? Wifi : WifiOff} label="Network">{server ? <>Clinic LAN server · {(net.devices || []).length} device{(net.devices || []).length === 1 ? '' : 's'} online</> : 'Standalone — this browser only'}</Row>
      <Row icon={RefreshCw} label="Sync">{server ? (net.pending ? net.pending + ' change(s) waiting to sync' : 'Up to date') + (net.lastSyncAt ? ' · ' + timeAgo(net.lastSyncAt) : '') : 'Saved locally (IndexedDB)'}</Row>
      <Row icon={Cloud} label="Cloud backup">{connected.length ? connected.join(', ') : <span className="text-muted">Not connected</span>}</Row>
      <Row icon={MessageCircle} label="WhatsApp">{ch.whatsapp ? <Badge tone="emerald">API · {ch.whatsapp}</Badge> : <span className="text-muted">wa.me deep links</span>}</Row>
      <Row icon={Smartphone} label="SMS">{ch.sms ? <Badge tone="emerald">API · {ch.sms}</Badge> : <span className="text-muted">sms: links</span>}</Row>
      <Row icon={Mail} label="E-mail">{ch.email ? <Badge tone="emerald">SMTP</Badge> : <span className="text-muted">mail app / Gmail compose</span>}</Row>
    </Card>
  );
}
