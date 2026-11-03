// Accounts & Doctor Sharing: executive dashboard (daily / monthly / custom range) with KPI tiles,
// daily collection & volume charts, department-wise collection, doctor sharing & centre retention,
// referral statements with audit / owner approval sign-off, A4 print, PDF (single & bulk) and
// WhatsApp; doctor master with department-wise share %; expense ledger feeding net savings.
import { useEffect, useMemo, useState } from 'react';
import {
  PieChart, Users, IndianRupee, BadgePercent, Wallet, HandCoins, TrendingUp, Search, Printer, FileDown, MessageCircle, ShieldCheck, BadgeCheck, Stethoscope,
  Plus, Pencil, Trash2, Receipt, FileStack, Loader2, Phone, Activity
} from 'lucide-react';
import { useColl, useSettings, saveSettings, useRoute, navigate, useLocalPref } from '../../core/hooks';
import { store } from '../../core/store';
import { can, currentUser, logAudit } from '../../core/auth';
import { printHtml } from '../../core/print';
import { htmlToPdf } from '../../core/pdf';
import { fillTemplate, pickTemplate } from '../../core/share';
import { send, dispatchMode, logDispatch } from '../../core/dispatch';
import { DISCOUNT_RULES } from '../../core/finance';
import { cx, Card, Button, Badge, Input, Select, Field, Segmented, Toggle, Modal, Empty, Kpi, Tabs, toast, confirmDialog } from '../../components/ui';
import { ChartFrame, ColumnChart, StackedBarH, BarListH, DataTable, compactInr } from '../../components/charts';
import { dateKey, monthKey, fmtDate, inr, uid, num, round2, addDays, validMobile } from '../../core/utils';
import seed from '../../../../shared/seed-data';
import { periodOf, analytics, statementRows, statementId, statementStatus, statementPages, summaryPages, statementVars, SHARE_KEYS, ACCOUNTS_DEPTS, DEPT_SHORT, shareBadges, monthlyTrend } from './accountsData';

const TABS = [
  { id: 'dashboard', label: 'Financial dashboard', icon: TrendingUp },
  { id: 'statements', label: 'Doctor statements', icon: FileStack },
  { id: 'doctors', label: 'Doctor master & sharing', icon: Stethoscope },
  { id: 'expenses', label: 'Expenses', icon: Wallet }
];

export function Accounts() {
  const route = useRoute();
  const settings = useSettings();
  const invoices = useColl('invoices');
  const expenses = useColl('expenses');
  const doctors = useColl('doctors');
  const statements = useColl('statements');
  const tab = TABS.some((t) => t.id === route.query.tab) ? route.query.tab : 'dashboard';
  const [mode, setMode] = useLocalPref('acc-mode', 'month');
  const [month, setMonth] = useState(monthKey());
  const [day, setDay] = useState(dateKey());
  const [from, setFrom] = useState(dateKey(addDays(new Date(), -29)));
  const [to, setTo] = useState(dateKey());
  const [dept, setDept] = useState('');
  const [q, setQ] = useState('');
  const [audit, setAudit] = useState('');
  const rule = settings.accounts.discountRule || 'share_minus_discount';
  const period = periodOf({ mode, month, day, from, to });
  const data = useMemo(() => analytics({ from: period.from, to: period.to, dept, invoices, expenses, doctors, rule }), [period.from, period.to, dept, invoices, expenses, doctors, rule]);
  const stmOf = (docId) => statements.find((s) => s.id === statementId(docId, period.key)) || null;
  const docMatch = (d) => {
    const s = q.trim().toLowerCase();
    const okQ = !s || [d.name, d.phone, d.speciality, d.clinic].join(' ').toLowerCase().includes(s);
    const okA = !audit || statementStatus(stmOf(d.id)).label === audit;
    return okQ && okA;
  };
  const setTab = (id) => navigate('/accounts', { tab: id, doctor: route.query.doctor });

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-xl font-extrabold tracking-tight sm:text-2xl">Accounts & Doctor Sharing</h1>
          <p className="text-[13px] text-muted">Collections, referral sharing, centre retention, expenses and net savings — {period.label}{dept ? ' · ' + dept : ''}</p>
        </div>
      </div>
      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-end gap-2 bg-canvas/95 px-1 py-2 backdrop-blur">
        <Field label="Period"><Segmented value={mode} onChange={setMode} options={[{ value: 'day', label: 'Day' }, { value: 'month', label: 'Month' }, { value: 'range', label: 'Range' }]} /></Field>
        {mode === 'month' && <Field label="Month"><Input type="month" className="w-[160px]" value={month} max={monthKey()} onChange={(e) => setMonth(e.target.value || monthKey())} /></Field>}
        {mode === 'day' && <Field label="Date"><Input type="date" className="w-[160px]" value={day} max={dateKey()} onChange={(e) => setDay(e.target.value || dateKey())} /></Field>}
        {mode === 'range' && <><Field label="From"><Input type="date" className="w-[150px]" value={from} max={to} onChange={(e) => setFrom(e.target.value || from)} /></Field><Field label="To"><Input type="date" className="w-[150px]" value={to} min={from} max={dateKey()} onChange={(e) => setTo(e.target.value || to)} /></Field></>}
        <Field label="Department"><Select className="w-[180px]" value={dept} onChange={(e) => setDept(e.target.value)} placeholder="All departments" options={ACCOUNTS_DEPTS} /></Field>
        <Field label="Doctor / phone" className="min-w-[200px] flex-1"><div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search consultant, clinician or phone…" /></div></Field>
        <Field label="Audit status"><Select className="w-[170px]" value={audit} onChange={(e) => setAudit(e.target.value)} placeholder="Any status" options={['Draft', 'Audit Verified', 'Approved by Owner']} /></Field>
      </div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'dashboard' && <Dashboard data={data} period={period} dept={dept} settings={settings} doctors={doctors.filter(docMatch)} allDoctors={doctors} stmOf={stmOf} invoices={invoices} expenses={expenses} rule={rule} mode={mode} />}
      {tab === 'statements' && <Statements period={period} dept={dept} settings={settings} doctors={doctors.filter(docMatch)} data={data} stmOf={stmOf} invoices={invoices} rule={rule} selected={route.query.doctor} />}
      {tab === 'doctors' && <DoctorMaster doctors={doctors.filter((d) => { const s = q.trim().toLowerCase(); return !s || [d.name, d.phone, d.speciality, d.clinic].join(' ').toLowerCase().includes(s); })} data={data} />}
      {tab === 'expenses' && <Expenses period={period} expenses={expenses} />}
    </div>
  );
}

// ---------------------------------------------------------------- dashboard
const SHARE_LABEL = Object.fromEntries(SHARE_KEYS);

function Dashboard({ data, period, dept, settings, doctors, allDoctors, stmOf, invoices, expenses, rule, mode }) {
  const k = data.kpi;
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(null);
  const ids = new Set(doctors.map((d) => d.id));
  const docRows = data.docRows.filter((x) => ids.has(x.doctor.id));
  const dayCol = data.days.map((d) => ({ key: d.date, label: String(Number(d.date.slice(8))), title: fmtDate(d.date), value: d.net, rows: [{ label: 'net collection', value: inr(d.net), color: 'var(--series-1)' }, { label: 'gross', value: inr(d.gross) }, { label: 'discount', value: inr(d.discount) }] }));
  const volCol = data.days.map((d) => ({ key: d.date, label: String(Number(d.date.slice(8))), title: fmtDate(d.date), value: d.patients, rows: [{ label: 'patients', value: String(d.patients), color: 'var(--series-1)' }, { label: 'tests', value: String(d.tests) }] }));
  const multiDay = data.days.length > 1;
  // last six months: what the centre keeps vs what goes out as referral payouts
  const trend = useMemo(() => monthlyTrend({ endMonth: period.to.slice(0, 7), months: 6, dept, invoices, expenses, doctors: allDoctors, rule }), [period.to, dept, invoices, expenses, allDoctors, rule]);
  const trendTot = trend.reduce((t, r) => ({ net: t.net + r.net, share: t.share + r.share, retention: t.retention + r.retention }), { net: 0, share: 0, retention: 0 });
  const periodExpenses = expenses.filter((x) => x.date >= period.from && x.date <= period.to);
  const summaryPdf = async () => {
    setBusy('summary');
    try {
      const r = summaryPages({ period, data, deptFilter: dept, expenses: periodExpenses, settings });
      await htmlToPdf(r.html, { widthMm: 210, heightMm: 297, filename: 'Monthly_Summary_' + period.key + '.pdf', scale: 1.6, quality: 0.82 });
      logAudit('accounts:summary_pdf', 'accounts/' + period.key, {});
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  const printSummary = () => { const r = summaryPages({ period, data, deptFilter: dept, expenses: periodExpenses, settings }); printHtml({ html: r.html, widthMm: 210, heightMm: 297, title: 'Summary ' + period.label, audit: { action: 'accounts:summary_printed', target: 'accounts/' + period.key } }); };
  const bulk = async () => {
    const list = docRows.filter((x) => x.tests > 0);
    if (!list.length) return toast('No referrals in this period', 'info');
    setBusy('bulk');
    try {
      const htmls = [];
      list.forEach((x, i) => {
        setProgress({ i: i + 1, n: list.length, name: x.doctor.name });
        const st = statementRows({ from: period.from, to: period.to, dept, invoices, doctor: x.doctor, rule });
        htmls.push(statementPages({ doctor: x.doctor, period, rows: st.rows, totals: st.totals, stm: stmOf(x.doctor.id), settings, ruleLabel: DISCOUNT_RULES[rule].label }).html);
      });
      htmls.push(summaryPages({ period, data, deptFilter: dept, expenses: periodExpenses, settings }).html);
      setProgress({ i: list.length, n: list.length, name: 'Rendering PDF pages…' });
      await htmlToPdf(htmls.join(''), { widthMm: 210, heightMm: 297, filename: 'All_Doctor_Statements_' + period.key + '.pdf', scale: 1.5, quality: 0.8 });
      logAudit('accounts:bulk_statements_pdf', 'accounts/' + period.key, { doctors: list.length });
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); setProgress(null); }
  };
  const waOwner = () => {
    const lines = [`*${settings.clinic.name}*`, `Financial summary · ${period.label}${dept ? ' · ' + dept : ''}`, '', `👥 Patients ${k.patients} · Tests ${k.tests}`, `🧾 Gross ${inr(k.gross)} · Discount ${inr(k.discount)}`, `💰 Net collection *${inr(k.net)}*`, `🤝 Doctor sharing payable ${inr(k.share)}`, `📤 Expenses ${inr(k.expenses)}`, `✅ Net savings *${inr(k.savings)}*`, '', '*Departments*'].concat(data.deptRows.filter((d) => d.tests).map((d) => `• ${d.dept}: ${d.tests} tests · net ${inr(d.net)} · retention ${inr(d.retention)}`));
    window.open('https://wa.me/91' + String(settings.clinic.phone || '').replace(/\D/g, '').slice(-10) + '?text=' + encodeURIComponent(lines.join('\n')), '_blank', 'noopener');
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {progress && <span className="mr-auto inline-flex items-center gap-2 text-[12px] text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Statement {progress.i} of {progress.n}: {progress.name}</span>}
        <Button icon={Printer} onClick={printSummary}>Print summary</Button>
        <Button icon={FileDown} loading={busy === 'summary'} onClick={summaryPdf}>Summary PDF</Button>
        <Button icon={FileStack} loading={busy === 'bulk'} onClick={bulk}>Bulk export all statements (PDF)</Button>
        <Button variant="whatsapp" icon={MessageCircle} onClick={waOwner}>WhatsApp summary</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
        <Kpi label="Diagnostic volume" value={k.patients + ' patients'} sub={k.tests + ' tests conducted'} icon={Users} tone="brand" />
        <Kpi label="Gross bill" value={inr(k.gross)} sub="total revenue billed" icon={Receipt} tone="indigo" />
        <Kpi label="Discounts given" value={inr(k.discount)} sub={k.gross ? ((k.discount / k.gross) * 100).toFixed(1) + '% of gross' : '—'} icon={BadgePercent} tone="amber" />
        <Kpi label="Net collection" value={inr(k.net)} sub="gross − discount" icon={IndianRupee} tone="emerald" />
        <Kpi label="Doctor sharing payable" value={inr(k.share)} sub={DISCOUNT_RULES[rule].label} icon={HandCoins} tone="violet" />
        <Kpi label="Centre expenses" value={inr(k.expenses)} sub={dept ? 'centre-wide (not split by department)' : 'rent, salaries, consumables…'} icon={Wallet} tone="rose" />
        <Kpi label="Net savings" value={inr(k.savings)} sub="net − sharing − expenses" icon={TrendingUp} tone={k.savings >= 0 ? 'teal' : 'rose'} className="border-teal-300 dark:border-teal-800" />
      </div>
      {multiDay ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartFrame title="Daily net collection" subtitle={period.label + ' · hover a day for gross & discount'}
            table={<DataTable columns={[{ label: 'Date', get: (r) => fmtDate(r.date) }, { label: 'Gross', num: true, get: (r) => inr(r.gross) }, { label: 'Discount', num: true, get: (r) => inr(r.discount) }, { label: 'Net', num: true, get: (r) => inr(r.net) }]} rows={data.days} />}>
            <ColumnChart data={dayCol} height={220} format={(v) => compactInr(v)} ariaLabel={'Daily net collection, ' + period.label} />
          </ChartFrame>
          <ChartFrame title="Daily patient volume" subtitle={period.label + ' · patients per day (tests in the tooltip)'}
            table={<DataTable columns={[{ label: 'Date', get: (r) => fmtDate(r.date) }, { label: 'Patients', num: true, get: (r) => r.patients }, { label: 'Tests', num: true, get: (r) => r.tests }]} rows={data.days} />}>
            <ColumnChart data={volCol} height={220} integer format={(v) => String(v)} ariaLabel={'Daily patients, ' + period.label} />
          </ChartFrame>
        </div>
      ) : <Card><p className="text-[13px] text-muted">Daily charts appear for a month or a date range. Switch the period to <b>Month</b> to see trends{mode === 'day' ? '' : ''}.</p></Card>}
      <ChartFrame title="Centre retention vs referral payouts — last 6 months"
        subtitle={trendTot.net ? 'Centre kept ' + inr(round2(trendTot.retention)) + ' (' + Math.round((trendTot.retention / trendTot.net) * 100) + '%) · paid out ' + inr(round2(trendTot.share)) + ' (' + Math.round((trendTot.share / trendTot.net) * 100) + '%) of ' + inr(round2(trendTot.net)) + ' net' : 'No collections in the last six months'}
        legend={[{ label: 'Centre retention', color: 'var(--series-1)' }, { label: 'Doctor payouts', color: 'var(--series-2)' }]}
        table={<DataTable columns={[{ label: 'Month', get: (r) => r.label }, { label: 'Net', num: true, get: (r) => inr(r.net) }, { label: 'Retention', num: true, get: (r) => inr(r.retention) }, { label: 'Payouts', num: true, get: (r) => inr(r.share) }, { label: 'Retention %', num: true, get: (r) => r.retentionPct + '%' }, { label: 'Net savings', num: true, get: (r) => inr(r.savings) }]} rows={trend} />}>
        {trend.some((r) => r.net > 0)
          ? <StackedBarH rows={trend.map((r) => ({ key: r.month, label: r.label, parts: [Math.max(0, r.retention), r.share], total: r.net, sub: r.net ? 'keeps ' + r.retentionPct + '%' : 'no billing' }))} series={[{ name: 'Centre retention', color: 'var(--series-1)' }, { name: 'Doctor payouts', color: 'var(--series-2)' }]} format={(v) => compactInr(v)} ariaLabel="Monthly net collection split into centre retention and doctor payouts" />
          : <Empty icon={TrendingUp} title="No collections yet" />}
      </ChartFrame>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card padded={false} title="Department-wise collection" subtitle="Net collection = doctor share + centre retention" icon={PieChart}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[12.5px]">
              <thead><tr className="border-b border-line bg-surface2/60 text-left text-[10.5px] uppercase text-muted"><th className="px-3 py-2">Department</th><th className="px-2 text-right">Patients</th><th className="px-2 text-right">Tests</th><th className="px-2 text-right">Gross</th><th className="px-2 text-right">Discount</th><th className="px-2 text-right">Net</th><th className="px-2 text-right">Doctor share</th><th className="px-2 text-right">Retention</th></tr></thead>
              <tbody>{data.deptRows.map((d) => <tr key={d.dept} className="border-b border-line/70"><td className="px-3 py-1.5 font-semibold">{d.dept}</td><td className="px-2 text-right tnum">{d.patients}</td><td className="px-2 text-right tnum">{d.tests}</td><td className="px-2 text-right tnum">{inr(d.gross)}</td><td className="px-2 text-right tnum">{inr(d.discount)}</td><td className="px-2 text-right font-semibold tnum">{inr(d.net)}</td><td className="px-2 text-right tnum">{inr(d.share)}</td><td className="px-2 text-right font-semibold tnum">{inr(d.retention)}</td></tr>)}</tbody>
              <tfoot><tr className="border-t-2 border-line bg-surface2/60 font-bold"><td className="px-3 py-2">Total</td>{['patients', 'tests'].map((f) => <td key={f} className="px-2 text-right tnum">{data.deptRows.reduce((s, d) => s + d[f], 0)}</td>)}{['gross', 'discount', 'net', 'share', 'retention'].map((f) => <td key={f} className="px-2 text-right tnum">{inr(round2(data.deptRows.reduce((s, d) => s + d[f], 0)))}</td>)}</tr></tfoot>
            </table>
          </div>
        </Card>
        <ChartFrame title="Where the net collection goes" subtitle="By department — centre retention vs doctor sharing payable"
          legend={[{ label: 'Centre retention', color: 'var(--series-1)' }, { label: 'Doctor share', color: 'var(--series-2)' }]}
          table={<DataTable columns={[{ label: 'Department', get: (r) => r.dept }, { label: 'Retention', num: true, get: (r) => inr(r.retention) }, { label: 'Doctor share', num: true, get: (r) => inr(r.share) }, { label: 'Net', num: true, get: (r) => inr(r.net) }]} rows={data.deptRows} />}>
          {data.deptRows.some((d) => d.net > 0) ? <StackedBarH rows={data.deptRows.filter((d) => d.net > 0).map((d) => ({ key: d.dept, label: d.dept, parts: [Math.max(0, d.retention), d.share], total: d.net, sub: d.tests + ' tests' }))} series={[{ name: 'Centre retention', color: 'var(--series-1)' }, { name: 'Doctor share', color: 'var(--series-2)' }]} format={(v) => compactInr(v)} ariaLabel="Net collection by department split into retention and doctor share" /> : <Empty icon={PieChart} title="No collections in this period" />}
        </ChartFrame>
      </div>
      <Card padded={false} title="Referring doctors" subtitle={docRows.length + ' doctor(s) with referrals · click a row for the statement'} icon={Stethoscope}>
        {!docRows.length ? <Empty icon={Stethoscope} title="No referrals" text="Doctor-referred bills in this period appear here." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[12.5px]">
              <thead><tr className="border-b border-line bg-surface2/60 text-left text-[10.5px] uppercase text-muted"><th className="px-3 py-2">Doctor</th><th className="px-2">Speciality</th><th className="px-2">Share %</th><th className="px-2 text-right">Patients</th><th className="px-2 text-right">Bill</th><th className="px-2 text-right">Discount</th><th className="px-2 text-right">Payable</th><th className="px-2">Status</th></tr></thead>
              <tbody>{docRows.map((x) => { const st = statementStatus(stmOf(x.doctor.id)); return (
                <tr key={x.doctor.id} className="cursor-pointer border-b border-line/70 hover:bg-surface2/40" onClick={() => navigate('/accounts', { tab: 'statements', doctor: x.doctor.id })}>
                  <td className="px-3 py-1.5 font-semibold">{x.doctor.name}</td><td className="px-2 text-muted">{x.doctor.speciality}</td><td className="px-2 text-[11px] text-muted">{shareBadges(x.doctor)}</td>
                  <td className="px-2 text-right tnum">{x.patients}</td><td className="px-2 text-right tnum">{inr(x.bill)}</td><td className="px-2 text-right tnum">{inr(x.discount)}</td><td className="px-2 text-right"><div className="font-bold tnum">{inr(x.payable)}</div><div className="text-[10.5px] text-muted tnum">{Object.entries(x.byKey || {}).filter(([, v]) => v).map(([k, v]) => (SHARE_LABEL[k] || k) + ' ' + inr(v)).join(' · ')}</div></td><td className="px-2"><Badge tone={st.tone}>{st.label}</Badge></td>
                </tr>); })}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- statements
function Statements({ period, dept, settings, doctors, data, stmOf, invoices, rule, selected }) {
  const [selId, setSelId] = useState(selected || null);
  useEffect(() => { if (selected) setSelId(selected); }, [selected]);
  const withRefs = new Set(data.docRows.map((x) => x.doctor.id));
  const list = doctors.slice().sort((a, b) => (withRefs.has(b.id) - withRefs.has(a.id)) || a.name.localeCompare(b.name));
  const doc = list.find((d) => d.id === selId) || list.find((d) => withRefs.has(d.id)) || list[0];
  const totalsOf = (id) => data.docRows.find((x) => x.doctor.id === id);
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Card padded={false} title="Referring doctors" subtitle={list.length + ' · ' + period.label} icon={Stethoscope} className="lg:max-h-[calc(100vh-240px)]" bodyClass="min-h-0 overflow-y-auto">
        <div className="p-2">
          {!list.length && <Empty icon={Search} title="No doctor matches" />}
          {list.map((d) => { const t = totalsOf(d.id); const st = statementStatus(stmOf(d.id)); return (
            <button key={d.id} onClick={() => setSelId(d.id)} className={cx('mb-1.5 w-full rounded-xl border p-2.5 text-left', doc && doc.id === d.id ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/30' : 'border-line hover:border-brand-300')}>
              <div className="flex items-center justify-between gap-2"><span className="truncate text-[13px] font-semibold">{d.name}</span><span className="font-display text-[13px] font-extrabold tnum">{t ? inr(t.payable) : '—'}</span></div>
              <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted"><span className="truncate">{d.speciality}{t ? ' · ' + t.patients + ' patients' : ' · no referrals'}</span><Badge tone={st.tone}>{st.label}</Badge></div>
            </button>); })}
        </div>
      </Card>
      {doc ? <StatementView key={doc.id + period.key + dept} doctor={doc} period={period} dept={dept} settings={settings} stm={stmOf(doc.id)} invoices={invoices} rule={rule} /> : <Card><Empty icon={Stethoscope} title="No doctors" /></Card>}
    </div>
  );
}

function StatementView({ doctor, period, dept, settings, stm, invoices, rule }) {
  const [busy, setBusy] = useState('');
  const admin = can('finance:doctor_sharing_and_analytics');
  const { rows, totals } = useMemo(() => statementRows({ from: period.from, to: period.to, dept, invoices, doctor, rule }), [period.from, period.to, dept, invoices, doctor, rule]);
  const st = statementStatus(stm);
  const pages = () => statementPages({ doctor, period, rows, totals, stm, settings, ruleLabel: DISCOUNT_RULES[rule].label });
  const fname = 'Statement_' + doctor.name.replace(/\W+/g, '_') + '_' + period.key + '.pdf';
  const setAudit = (patch, action) => {
    if (!admin) return toast('Only the administrator can sign off statements', 'error');
    const u = currentUser();
    const id = statementId(doctor.id, period.key);
    const cur = store.get('statements', id) || { id, doctorId: doctor.id, period: period.key, from: period.from, to: period.to };
    const next = Object.assign({}, cur, patch, { totals, updatedBy: u.id });
    if (patch.verified === false) Object.assign(next, { approved: false, approvedAt: null, approvedBy: null });
    store.put('statements', next);
    logAudit(action, 'statements/' + id, { doctor: doctor.name, period: period.label, payable: totals.payable });
  };
  const print = () => { const r = pages(); printHtml({ html: r.html, widthMm: 210, heightMm: 297, title: fname.replace(/\.pdf$/, ''), audit: { action: 'accounts:statement_printed', target: 'statements/' + statementId(doctor.id, period.key), meta: { doctor: doctor.name } } }); };
  const pdf = async (download = true) => { const r = pages(); return htmlToPdf(r.html, { widthMm: 210, heightMm: 297, filename: fname, download, scale: 1.6, quality: 0.82 }); };
  const wa = async () => {
    if (!validMobile(String(doctor.phone || '').replace(/\D/g, '').slice(-10))) return toast('Add the doctor’s 10-digit mobile in the doctor master', 'warning');
    setBusy('wa');
    try {
      const t = pickTemplate('whatsapp', 'statement', 'en');
      const msg = fillTemplate(t ? t.body : 'Dear {{Doctor_Name}}, sharing statement {{Period}}: {{Total_Patients}} patients, bill ₹{{Total_Bill}}, payable ₹{{Share_Payable}} ({{Audit_Status}}). – {{Center_Name}}', statementVars({ doctor, period, totals, stm, settings }));
      const api = dispatchMode('whatsapp') === 'api';
      const blob = await pdf(!api);
      const r = await send('whatsapp', { to: doctor.phone, message: msg, attachments: api ? [{ blob, filename: fname }] : [], ref: 'statements/' + statementId(doctor.id, period.key) });
      logDispatch({ kind: 'statement', refColl: 'statements', ref: statementId(doctor.id, period.key), title: 'Statement ' + period.label, patientName: doctor.name, mobile: doctor.phone, department: 'Accounts', docType: 'Doctor statement', format: 'PDF', channels: { whatsapp: r.mode === 'api' ? 'sent' : r.ok ? 'opened' : 'blocked' }, status: r.ok ? 'sent' : 'failed' });
      toast(api ? 'Statement sent on WhatsApp with the PDF' : 'WhatsApp opened — attach the downloaded PDF', 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  return (
    <div className="min-w-0 space-y-3">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Doctor referral & sharing statement · {settings.clinic.name}</div>
            <h2 className="mt-0.5 font-display text-xl font-extrabold">{doctor.name}</h2>
            <div className="text-[12.5px] text-muted">{[doctor.qualification, doctor.speciality, doctor.clinic].filter(Boolean).join(' · ')}{doctor.phone ? <> · <Phone className="inline h-3 w-3" /> {doctor.phone}</> : null}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">{SHARE_KEYS.map(([k, l]) => <Badge key={k} tone="slate">{l}: {Number((doctor.shares || {})[k] || 0)}%</Badge>)}<Badge tone="brand">{period.label}</Badge>{dept && <Badge tone="amber">{dept}</Badge>}</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button icon={Printer} onClick={print}>Print</Button>
            <Button icon={FileDown} loading={busy === 'pdf'} onClick={async () => { setBusy('pdf'); try { await pdf(true); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); } }}>PDF</Button>
            <Button variant="whatsapp" icon={MessageCircle} loading={busy === 'wa'} onClick={wa}>WhatsApp</Button>
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Total patients" value={totals.patients} sub={totals.tests + ' investigations'} icon={Users} tone="brand" />
        <Kpi label="Total bill" value={inr(totals.bill)} icon={Receipt} tone="indigo" />
        <Kpi label="Total discount" value={inr(totals.discount)} icon={BadgePercent} tone="amber" />
        <Kpi label="Total share" value={inr(totals.share)} icon={Activity} tone="slate" />
        <Kpi label="Sharing payable" value={inr(totals.payable)} sub={DISCOUNT_RULES[rule].label} icon={HandCoins} tone="emerald" className="border-emerald-300 dark:border-emerald-800" />
      </div>
      <Card padded={false}>
        {!rows.length ? <Empty icon={FileStack} title="No referrals in this period" text="Change the period or department filter." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[12.5px]">
              <thead><tr className="border-b border-line bg-surface2/60 text-left text-[10.5px] uppercase text-muted"><th className="px-3 py-2">S.No</th><th className="px-2">Date</th><th className="px-2">Patient</th><th className="px-2">Investigation</th><th className="px-2 text-right">Bill</th><th className="px-2 text-right">Discount</th><th className="px-2 text-right">Share</th><th className="px-2 text-right">Payable</th></tr></thead>
              <tbody>{rows.map((r, i) => <tr key={r.id + i} className="border-b border-line/70"><td className="px-3 py-1.5">{i + 1}</td><td className="px-2 whitespace-nowrap">{fmtDate(r.date)}</td><td className="px-2">{r.patient}</td><td className="px-2">{r.test} <Badge tone="slate">{DEPT_SHORT[r.dept] || r.dept} · {r.pct}%</Badge></td><td className="px-2 text-right tnum">{inr(r.bill)}</td><td className="px-2 text-right tnum">{r.discount ? inr(r.discount) : '—'}</td><td className="px-2 text-right tnum">{inr(r.share)}</td><td className="px-2 text-right font-bold tnum">{inr(r.payable)}</td></tr>)}</tbody>
              <tfoot><tr className="border-t-2 border-line bg-surface2/60 font-bold"><td className="px-3 py-2" colSpan={4}>Total · {totals.patients} patients</td><td className="px-2 text-right tnum">{inr(totals.bill)}</td><td className="px-2 text-right tnum">{inr(totals.discount)}</td><td className="px-2 text-right tnum">{inr(totals.share)}</td><td className="px-2 text-right tnum">{inr(totals.payable)}</td></tr></tfoot>
            </table>
          </div>
        )}
      </Card>
      <Card title="Audit & authorisation" subtitle="Printed as stamps in the statement footer" icon={ShieldCheck} actions={<Badge tone={st.tone} icon={st.label === 'Draft' ? null : BadgeCheck}>{st.label}</Badge>}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-line p-3 text-[12.5px]"><div className="text-[11px] font-bold uppercase text-muted">Accounts in-charge</div><div className="mt-1 font-semibold">{settings.accounts.accountsInCharge}</div><div className="text-muted">{settings.clinic.name}</div></div>
          <div className="rounded-xl border border-line p-3"><Toggle checked={!!(stm && stm.verified)} disabled={!admin} onChange={(v) => setAudit(v ? { verified: true, verifiedAt: Date.now(), verifiedBy: currentUser().id } : { verified: false, verifiedAt: null, verifiedBy: null }, v ? 'accounts:statement_audit_verified' : 'accounts:statement_audit_reopened')} label="Audit verified" hint={stm && stm.verifiedAt ? 'on ' + fmtDate(stm.verifiedAt) : 'Totals checked against bills'} /></div>
          <div className="rounded-xl border border-line p-3"><Toggle checked={!!(stm && stm.approved)} disabled={!admin || !(stm && stm.verified)} onChange={(v) => setAudit(v ? { approved: true, approvedAt: Date.now(), approvedBy: currentUser().id } : { approved: false, approvedAt: null, approvedBy: null }, v ? 'accounts:statement_owner_approved' : 'accounts:statement_approval_withdrawn')} label={'Approved by owner (' + (settings.accounts.ownerName || 'Owner') + ')'} hint={stm && stm.approvedAt ? 'on ' + fmtDate(stm.approvedAt) : 'Available after audit verification'} /></div>
        </div>
        {admin && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="text-muted">Discount deduction rule (all statements):</span>
            <Select size="sm" className="w-[320px]" value={rule} onChange={(e) => { saveSettings({ accounts: { discountRule: e.target.value } }); logAudit('settings:discount_rule_changed', 'settings/accounts', { rule: e.target.value }); }} options={Object.entries(DISCOUNT_RULES).map(([v, r]) => ({ value: v, label: r.label }))} />
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- doctor master
function DoctorMaster({ doctors, data }) {
  const [edit, setEdit] = useState(null);
  const canEdit = can('finance:doctor_sharing_and_analytics');
  const stat = (id) => data.docRows.find((x) => x.doctor.id === id);
  return (
    <Card padded={false} title="Referring doctors & agreed sharing" subtitle={doctors.length + ' doctor(s) · share % per department'} icon={Stethoscope}
      actions={canEdit ? <Button size="sm" variant="primary" icon={Plus} onClick={() => setEdit({})}>Add doctor</Button> : null}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-[12.5px]">
          <thead><tr className="border-b border-line bg-surface2/60 text-left text-[10.5px] uppercase text-muted"><th className="px-3 py-2">Consultant / clinician</th><th className="px-2">Speciality</th><th className="px-2">Phone</th>{SHARE_KEYS.map(([k, l]) => <th key={k} className="px-2 text-right">{l} %</th>)}<th className="px-2 text-right">Patients (period)</th><th className="px-2 text-right">Payable (period)</th><th className="px-2" /></tr></thead>
          <tbody>
            {doctors.map((d) => { const s = stat(d.id); return (
              <tr key={d.id} className={cx('border-b border-line/70', d.active === false && 'opacity-55')}>
                <td className="px-3 py-1.5"><div className="font-semibold">{d.name}</div><div className="text-[11px] text-muted">{[d.qualification, d.clinic].filter(Boolean).join(' · ')}</div></td>
                <td className="px-2">{d.speciality}</td><td className="px-2 tnum">{d.phone || '—'}</td>
                {SHARE_KEYS.map(([k]) => <td key={k} className="px-2 text-right tnum">{Number((d.shares || {})[k] || 0)}</td>)}
                <td className="px-2 text-right tnum">{s ? s.patients : 0}</td><td className="px-2 text-right font-semibold tnum">{s ? inr(s.payable) : '—'}</td>
                <td className="whitespace-nowrap px-2 text-right">
                  <Button size="xs" icon={FileStack} onClick={() => navigate('/accounts', { tab: 'statements', doctor: d.id })}>Statement</Button>
                  {canEdit && <button className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface2" title="Edit" onClick={() => setEdit(d)}><Pencil className="h-3.5 w-3.5" /></button>}
                </td>
              </tr>); })}
          </tbody>
        </table>
      </div>
      {edit && <DoctorEditor initial={edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function DoctorEditor({ initial, onClose }) {
  const isNew = !initial.id;
  const [f, setF] = useState(() => Object.assign({ name: '', qualification: '', speciality: '', clinic: '', address: '', phone: '', email: '', shares: { USG: 0, LAB: 0, XRAY: 0, ECG: 0 }, active: true }, JSON.parse(JSON.stringify(initial))));
  const set = (patch) => setF((x) => Object.assign({}, x, patch));
  const save = () => {
    if (!String(f.name).trim()) return toast('Doctor name is required', 'warning');
    const phone = String(f.phone || '').replace(/\D/g, '').slice(-10);
    if (phone && !validMobile(phone)) return toast('Enter a valid 10-digit mobile (used for WhatsApp)', 'warning');
    const shares = {};
    SHARE_KEYS.forEach(([k]) => { shares[k] = Math.max(0, Math.min(100, num(f.shares[k]))); });
    const doc = store.put('doctors', Object.assign({}, f, { id: f.id || uid('doc_'), name: f.name.trim(), phone, shares }));
    logAudit(isNew ? 'accounts:doctor_added' : 'accounts:doctor_updated', 'doctors/' + doc.id, { name: doc.name, shares });
    toast((isNew ? 'Added ' : 'Saved ') + doc.name, 'success');
    onClose();
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: 'Deactivate doctor?', message: f.name + '\nPast bills and statements are kept; the doctor no longer appears in pickers.', danger: true, confirmText: 'Deactivate' }))) return;
    store.put('doctors', Object.assign({}, initial, { active: false }));
    logAudit('accounts:doctor_deactivated', 'doctors/' + initial.id, { name: initial.name });
    onClose();
  };
  return (
    <Modal open size="md" onClose={onClose} title={isNew ? 'Add referring doctor' : 'Edit doctor'} icon={Stethoscope}
      footer={<>{!isNew && <Button variant="danger-ghost" icon={Trash2} className="mr-auto" onClick={remove}>Deactivate</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Consultant / clinician full name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Dr. …" autoFocus /></Field>
        <Field label="Qualification"><Input value={f.qualification} onChange={(e) => set({ qualification: e.target.value })} placeholder="MBBS, MD (Medicine)" /></Field>
        <Field label="Speciality"><Input list="spec-list" value={f.speciality} onChange={(e) => set({ speciality: e.target.value })} /><datalist id="spec-list">{['MD Medicine', 'OB-GYN', 'Orthopedics', 'Pediatrics', 'General Physician', 'Surgery', 'ENT', 'Dermatology'].map((x) => <option key={x} value={x} />)}</datalist></Field>
        <Field label="Clinic / hospital"><Input value={f.clinic} onChange={(e) => set({ clinic: e.target.value })} /></Field>
        <Field label="Mobile (WhatsApp, +91)"><Input inputMode="numeric" value={f.phone} onChange={(e) => set({ phone: e.target.value.replace(/\D/g, '').slice(-10) })} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={(e) => set({ address: e.target.value })} /></Field>
      </div>
      <div className="mt-4 rounded-xl bg-surface2/60 p-3">
        <div className="label">Agreed share % by department</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SHARE_KEYS.map(([k, l]) => <Field key={k} label={l}><Input inputMode="decimal" className="tnum" value={f.shares[k]} onChange={(e) => set({ shares: Object.assign({}, f.shares, { [k]: e.target.value.replace(/[^\d.]/g, '') }) })} /></Field>)}
        </div>
        <p className="mt-2 text-[11px] text-muted">Biochemistry follows the Lab %; Echo and other investigations follow ECG / Other.</p>
      </div>
      <Field className="mt-3" label="Price tier for this doctor’s patients" hint="New bills referred by this doctor start at this tier (the desk can still change it)">
        <Segmented value={f.rateTier || 'standardRate'} onChange={(v) => set({ rateTier: v === 'standardRate' ? '' : v })} options={[{ value: 'standardRate', label: 'Standard' }, { value: 'b2bRate', label: 'B2B / partner rate' }]} />
      </Field>
      <Toggle className="mt-3" checked={f.active !== false} onChange={(v) => set({ active: v })} label="Active (appears in registration & billing pickers)" />
    </Modal>
  );
}

// ---------------------------------------------------------------- expenses ledger
function Expenses({ period, expenses }) {
  const canWrite = can('cashbook:manage_daily_register');
  const blank = { date: period.to > dateKey() ? dateKey() : period.to, category: seed.EXPENSE_CATEGORIES[0], description: '', paidTo: '', mode: 'upi', amount: '' };
  const [f, setF] = useState(blank);
  const [edit, setEdit] = useState(null);
  const list = expenses.filter((x) => x.date >= period.from && x.date <= period.to).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const total = round2(list.reduce((s, x) => s + (Number(x.amount) || 0), 0));
  const cats = useMemo(() => {
    const m = new Map();
    list.forEach((x) => m.set(x.category, (m.get(x.category) || 0) + (Number(x.amount) || 0)));
    return Array.from(m.entries()).map(([label, value]) => ({ key: label, label, value: round2(value) })).sort((a, b) => b.value - a.value);
  }, [list]);
  const save = (doc, isNew) => {
    if (!String(doc.description).trim() || !(num(doc.amount) > 0)) return toast('Description and amount are required', 'warning');
    const u = currentUser();
    const out = store.put('expenses', Object.assign({}, doc, { id: doc.id || uid('exp_'), amount: round2(num(doc.amount)), description: doc.description.trim(), staffId: doc.staffId || u.id, createdAt: doc.createdAt || Date.now() }));
    logAudit(isNew ? 'accounts:expense_added' : 'accounts:expense_edited', 'expenses/' + out.id, { amount: out.amount, category: out.category });
    return out;
  };
  const del = async (x) => {
    if (!(await confirmDialog({ title: 'Delete expense?', message: x.description + ' · ' + inr(x.amount), danger: true, confirmText: 'Delete' }))) return;
    store.remove('expenses', x.id);
    logAudit('accounts:expense_deleted', 'expenses/' + x.id, { amount: x.amount });
  };
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card padded={false} title="Expense ledger" subtitle={list.length + ' entr(ies) · ' + inr(total) + ' · ' + period.label} icon={Wallet}>
        {canWrite && (
          <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-12">
            <Field label="Date" className="sm:col-span-2"><Input type="date" value={f.date} max={dateKey()} onChange={(e) => setF(Object.assign({}, f, { date: e.target.value || f.date }))} /></Field>
            <Field label="Category" className="sm:col-span-3"><Select value={f.category} onChange={(e) => setF(Object.assign({}, f, { category: e.target.value }))} options={seed.EXPENSE_CATEGORIES} /></Field>
            <Field label="Description" className="sm:col-span-3"><Input value={f.description} onChange={(e) => setF(Object.assign({}, f, { description: e.target.value }))} /></Field>
            <Field label="Paid to" className="sm:col-span-2"><Input value={f.paidTo} onChange={(e) => setF(Object.assign({}, f, { paidTo: e.target.value }))} /></Field>
            <Field label="Amount ₹" className="sm:col-span-2"><Input inputMode="decimal" value={f.amount} onChange={(e) => setF(Object.assign({}, f, { amount: e.target.value.replace(/[^\d.]/g, '') }))} /></Field>
            <Field label="Mode" className="sm:col-span-4"><Segmented value={f.mode} onChange={(v) => setF(Object.assign({}, f, { mode: v }))} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI / Bank' }]} /></Field>
            <div className="flex items-end sm:col-span-8"><Button variant="primary" icon={Plus} className="ml-auto" onClick={() => { if (save(f, true)) { setF(blank); toast('Expense added', 'success'); } }}>Add expense</Button></div>
          </div>
        )}
        {!list.length ? <Empty icon={Wallet} title="No expenses in this period" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[12.5px]">
              <thead><tr className="border-b border-line bg-surface2/60 text-left text-[10.5px] uppercase text-muted"><th className="px-3 py-2">Date</th><th className="px-2">Category</th><th className="px-2">Description</th><th className="px-2">Paid to</th><th className="px-2">Mode</th><th className="px-2 text-right">Amount</th><th className="px-2" /></tr></thead>
              <tbody>{list.map((x) => <tr key={x.id} className="border-b border-line/70"><td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(x.date)}</td><td className="px-2">{x.category}</td><td className="px-2">{x.description}</td><td className="px-2 text-muted">{x.paidTo || '—'}</td><td className="px-2"><Badge tone={x.mode === 'cash' ? 'amber' : 'slate'}>{x.mode === 'cash' ? 'Cash' : 'UPI / Bank'}</Badge></td><td className="px-2 text-right font-semibold tnum">{inr(x.amount)}</td>
                <td className="whitespace-nowrap px-2 text-right">{canWrite && <><button className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface2" title="Edit" onClick={() => setEdit(x)}><Pencil className="h-3.5 w-3.5" /></button><button className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40" title="Delete" onClick={() => del(x)}><Trash2 className="h-3.5 w-3.5" /></button></>}</td></tr>)}</tbody>
              <tfoot><tr className="border-t-2 border-line bg-surface2/60 font-bold"><td className="px-3 py-2" colSpan={5}>Total</td><td className="px-2 text-right tnum">{inr(total)}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
      </Card>
      <ChartFrame title="Expenses by category" subtitle={period.label} table={<DataTable columns={[{ label: 'Category', get: (r) => r.label }, { label: 'Amount', num: true, get: (r) => inr(r.value) }]} rows={cats} />}>
        {cats.length ? <BarListH rows={cats} format={(v) => compactInr(v)} ariaLabel={'Expenses by category, ' + period.label} /> : <Empty icon={Wallet} title="No expenses" />}
      </ChartFrame>
      {edit && (
        <Modal open size="sm" onClose={() => setEdit(null)} title="Edit expense" icon={Pencil} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" onClick={() => { if (save(edit, false)) setEdit(null); }}>Save</Button></>}>
          <div className="space-y-3">
            <Field label="Date"><Input type="date" value={edit.date} onChange={(e) => setEdit(Object.assign({}, edit, { date: e.target.value || edit.date }))} /></Field>
            <Field label="Category"><Select value={edit.category} onChange={(e) => setEdit(Object.assign({}, edit, { category: e.target.value }))} options={seed.EXPENSE_CATEGORIES} /></Field>
            <Field label="Description"><Input value={edit.description} onChange={(e) => setEdit(Object.assign({}, edit, { description: e.target.value }))} /></Field>
            <Field label="Paid to"><Input value={edit.paidTo || ''} onChange={(e) => setEdit(Object.assign({}, edit, { paidTo: e.target.value }))} /></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Mode"><Segmented value={edit.mode} onChange={(v) => setEdit(Object.assign({}, edit, { mode: v }))} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI / Bank' }]} /></Field><Field label="Amount ₹"><Input inputMode="decimal" value={edit.amount} onChange={(e) => setEdit(Object.assign({}, edit, { amount: e.target.value.replace(/[^\d.]/g, '') }))} /></Field></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
