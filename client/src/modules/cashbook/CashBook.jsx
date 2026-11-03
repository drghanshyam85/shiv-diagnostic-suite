// Daily Cash Book: per-staff shift view and the manager's consolidated view for any date — revenue &
// payment-mode KPIs, the live drawer formula (opening float + cash received − cash expenses = cash in
// drawer) with a denomination counter, quick patient collection entry, the daily collection register
// with settle-due, department summary, expenses tracker, balance sheet, staff handover table, A4 print,
// CSV export and a WhatsApp summary for the owner.
import { useMemo, useState } from 'react';
import {
  Wallet, ChevronLeft, ChevronRight, Printer, Download, MessageCircle, Users, Plus, Trash2, Pencil, Coins, Calculator, Receipt, HandCoins, Search,
  TrendingUp, BadgePercent, IndianRupee, Clock, CircleCheck, TriangleAlert, ArrowDownLeft, ArrowUpRight, Lock, Settings as SettingsIcon, ExternalLink,
  FileArchive, Landmark, ShieldAlert, Info, CreditCard
} from 'lucide-react';
import { useColl, useSettings, useMaps, navigate, useLocalPref } from '../../core/hooks';
import { store } from '../../core/store';
import { can, currentUser, logAudit, useAuth } from '../../core/auth';
import { printHtml } from '../../core/print';
import { emitEvent } from '../../core/sync';
import { waLink, openExternal } from '../../core/share';
import { cashbookDay, cashbookDept, CASHBOOK_DEPTS, finalizeInvoice, DIGITAL_MODES, MODE_LABEL } from '../../core/finance';
import { allocateInvoiceNo, newShareId } from '../../core/clinic';
import { cx, Card, Button, Badge, Input, Select, Field, Segmented, Toggle, Modal, Empty, Combobox, Kpi, toast, confirmDialog } from '../../components/ui';
import { DoctorPicker } from '../../components/DoctorPicker';
import { CollectPaymentModal } from '../billing/DuesLedger';
import { dateKey, addDays, parseKey, fmtDate, fmtTime, inr, uid, round2, num, download, downloadBlob, toCSV, fullName, sumBy, TITLES, TITLE_GENDER } from '../../core/utils';
import seed from '../../../../shared/seed-data';
import { cashbookPages, csvRows, whatsappSummary, itemsText } from './cashPrint';
import { paymentsOn, systemTotals, reconcileLines, findExceptions, buildAuditPack } from './reconcile';

const DENOMS = [500, 200, 100, 50, 20, 10];
const QUICK_DEPTS = [
  { value: 'USG (Sonography)', dept: 'Ultrasound' }, { value: 'Color Doppler', dept: 'Ultrasound', doppler: true }, { value: 'Pathology / Lab', dept: 'Pathology' },
  { value: 'X-Ray', dept: 'X-Ray' }, { value: 'ECG', dept: 'ECG' }, { value: 'Other', dept: 'Other' }
];
const EXP_HINTS = ['Ultrasound Gel & Thermal Rolls', 'Staff Tea / Refreshments', 'PRO / Referral Payout', 'Electricity / Generator Diesel', 'Courier', 'Printer Paper & Toner', 'Cleaning & Housekeeping'];

/** Paid today on this bill, by cash / digital (only payments dated on `date`). */
function paidOn(inv, date, staffId) {
  let cash = 0;
  let upi = 0;
  (inv.payments || []).forEach((p) => {
    if (dateKey(p.at) !== date || (staffId !== 'ALL' && p.staffId !== staffId)) return;
    if (p.mode === 'cash') cash += Number(p.amount) || 0; else if (DIGITAL_MODES.has(p.mode)) upi += Number(p.amount) || 0;
  });
  return { cash: round2(cash), upi: round2(upi) };
}

export function CashBook() {
  const settings = useSettings();
  const { principal: me } = useAuth();
  const invoices = useColl('invoices');
  const expenses = useColl('expenses');
  const floats = useColl('floats');
  const denoms = useColl('denoms');
  const users = useColl('users');
  const maps = useMaps();
  const manager = can('finance:doctor_sharing_and_analytics', 'READ') || me.role === 'SUPER_ADMIN_RADIOLOGIST';
  const canWrite = can('cashbook:manage_daily_register');
  const canBill = can('billing:create_invoice');
  const [date, setDate] = useState(dateKey());
  const [staff, setStaff] = useState(manager ? 'ALL' : me.id);
  const [q, setQ] = useState('');
  const [deptF, setDeptF] = useState('');
  const [entryOpen, setEntryOpen] = useLocalPref('cb-entry-open', true);
  const [denomOpen, setDenomOpen] = useState(false);
  const [settle, setSettle] = useState(null);
  const [expEdit, setExpEdit] = useState(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [packBusy, setPackBusy] = useState(false);

  const names = useMemo(() => { const m = {}; users.forEach((u) => { m[u.id] = u.name; }); return m; }, [users]);
  // staff tabs: billing desk users + anyone who billed / spent / opened a float that day
  const staffIds = useMemo(() => {
    const set = new Set(users.filter((u) => u.role === 'RECEPTION_BILLING' && u.isActive !== false).map((u) => u.id));
    invoices.forEach((i) => { if (i.dateKey === date && i.staffId) set.add(i.staffId); (i.payments || []).forEach((p) => { if (dateKey(p.at) === date && p.staffId) set.add(p.staffId); }); });
    expenses.forEach((x) => { if (x.date === date && x.staffId) set.add(x.staffId); });
    floats.forEach((f) => { if (f.date === date && f.staffId) set.add(f.staffId); });
    return Array.from(set).filter((id) => names[id]).sort((a, b) => String(names[a]).localeCompare(String(names[b])));
  }, [users, invoices, expenses, floats, date, names]);
  const view = manager ? staff : me.id;
  const day = useMemo(() => cashbookDay({ date, staffId: view, invoices, expenses, floats, testsMap: maps.tests }), [date, view, invoices, expenses, floats, maps.tests]);
  const k = day.kpi;
  const rows = useMemo(() => day.invoices.slice().sort((a, b) => a.date - b.date).map((inv) => {
    const p = paidOn(inv, date, 'ALL');
    const depts = Array.from(new Set((inv.items || []).map((it) => cashbookDept(it, maps.tests)))).join(', ');
    return { inv, cash: p.cash, upi: p.upi, depts };
  }), [day.invoices, date, maps.tests]);
  const shown = rows.filter((r) => (!deptF || r.depts.includes(deptF)) && (!q.trim() || [r.inv.invoiceNo, fullName(r.inv.patient), itemsText(r.inv), names[r.inv.staffId]].join(' ').toLowerCase().includes(q.trim().toLowerCase())));
  const staffRows = useMemo(() => {
    const list = staffIds.map((id) => { const d = cashbookDay({ date, staffId: id, invoices, expenses, floats, testsMap: maps.tests }).kpi; return Object.assign({ id, name: names[id] }, d); });
    const tot = { id: 'ALL', name: 'Consolidated total', total: true };
    ['opening', 'bills', 'gross', 'discount', 'cash', 'upi', 'due', 'cashExp', 'drawer'].forEach((f) => { tot[f] = round2(sumBy(list, f)); });
    return list.concat([tot]);
  }, [staffIds, date, invoices, expenses, floats, maps.tests, names]);
  const scope = view === 'ALL' ? 'All staff consolidated' : names[view] || 'Staff';
  const denomDoc = denoms.find((d) => d.id === 'den_' + date + '_' + view) || null;
  // reconciliation: system receipts vs physical count / bank statement, and automatic exceptions
  const pays = useMemo(() => paymentsOn({ date, staffId: view, invoices }), [date, view, invoices]);
  const sys = useMemo(() => systemTotals(pays), [pays]);
  const recon = reconcileLines({ kpi: k, sys, denomDoc });
  const exceptions = useMemo(() => findExceptions({ day, pays, denomDoc, kpi: k }), [day, pays, denomDoc, k]);
  const excByInv = useMemo(() => { const m = {}; exceptions.forEach((x) => { if (x.invId) (m[x.invId] = m[x.invId] || []).push(x); }); return m; }, [exceptions]);

  const shiftDay = (n) => setDate(dateKey(addDays(parseKey(date), n)));
  const setFloat = (staffId, amount) => {
    if (!canWrite) return toast('Your role cannot change the opening float', 'error');
    const id = 'flt_' + date + '_' + staffId;
    store.put('floats', Object.assign({}, store.get('floats', id) || { id, date, staffId }, { amount: Math.max(0, num(amount)) }));
    logAudit('cashbook:float_set', 'floats/' + id, { amount: num(amount), staff: names[staffId] });
  };
  const exportCsv = () => {
    const data = csvRows({ rows, settlements: day.settlements, expenses: day.expenses, names });
    download('CashBook_' + date + '_' + (view === 'ALL' ? 'All' : String(names[view] || view).replace(/\W+/g, '_')) + '.csv', toCSV(data), 'text/csv;charset=utf-8');
    logAudit('cashbook:exported', 'cashbook/' + date, { scope });
  };
  const auditPack = async () => {
    setPackBusy(true);
    try {
      const res = await buildAuditPack({ date, scope, view, day, rows, staffRows: view === 'ALL' ? staffRows : staffRows.filter((s) => s.id === view), names, settings, denomDoc, pays, preparedBy: view === 'ALL' ? me.name : names[view], user: me });
      downloadBlob(res.filename, res.blob);
      logAudit('cashbook:audit_pack_exported', 'cashbook/' + date, { scope, files: res.files.length, exceptions: res.exceptions.length });
      toast('Audit pack downloaded · ' + res.files.length + ' files with SHA-256 manifest' + (res.exceptions.length ? ' · ' + res.exceptions.length + ' exception(s) listed' : ''), 'success', 6000);
    } catch (e) { toast('Could not build the audit pack: ' + e.message, 'error'); } finally { setPackBusy(false); }
  };
  const shareWa = () => {
    const to = String(settings.clinic.phone || '').replace(/\D/g, '');
    openExternal(waLink(to, whatsappSummary({ day, scope, staffRows, settings })));
  };
  const delExpense = async (x) => {
    if (!(await confirmDialog({ title: 'Delete expense?', message: x.description + ' · ' + inr(x.amount), danger: true, confirmText: 'Delete' }))) return;
    store.remove('expenses', x.id);
    logAudit('cashbook:expense_deleted', 'expenses/' + x.id, { amount: x.amount, description: x.description });
  };
  const cancelBill = async (inv) => {
    if (!can('billing:modify_discounts_refunds')) return toast('Cancelling a bill requires the administrator (refund permission)', 'error');
    if (!(await confirmDialog({ title: 'Delete / cancel bill ' + inv.invoiceNo + '?', message: fullName(inv.patient) + ' · ' + inr(inv.net) + '\nThe bill is removed from the register and the audit trail records who cancelled it.', danger: true, confirmText: 'Cancel bill' }))) return;
    store.remove('invoices', inv.id);
    logAudit('invoice:deleted', 'invoices/' + inv.id, { invoiceNo: inv.invoiceNo, net: inv.net });
  };

  const tally = denomDoc ? round2(denomDoc.total - k.drawer) : null;
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-extrabold tracking-tight sm:text-2xl">Daily Cash Book</h1>
          <p className="text-[13px] text-muted">Collection register · department summary · expenses · cash drawer reconciliation — {scope}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-line bg-surface">
            <button className="px-2 py-1.5 text-muted hover:text-ink" title="Previous day" onClick={() => shiftDay(-1)}><ChevronLeft className="h-4 w-4" /></button>
            <Input type="date" size="sm" className="w-[150px] border-0" value={date} max={dateKey()} onChange={(e) => setDate(e.target.value || dateKey())} aria-label="Cash book date" />
            <button className="px-2 py-1.5 text-muted hover:text-ink disabled:opacity-30" title="Next day" disabled={date >= dateKey()} onClick={() => shiftDay(1)}><ChevronRight className="h-4 w-4" /></button>
          </div>
          {date !== dateKey() && <Button size="sm" onClick={() => setDate(dateKey())}>Today</Button>}
          <Button icon={Printer} onClick={() => setPrintOpen(true)}>Print A4 summary</Button>
          <Button icon={Download} onClick={exportCsv}>CSV</Button>
          <Button icon={FileArchive} loading={packBusy} onClick={auditPack} title="Day book PDF, registers, payments, reconciliation, audit trail and a SHA-256 manifest in one ZIP">Audit pack</Button>
          <Button variant="whatsapp" icon={MessageCircle} onClick={shareWa}>WhatsApp</Button>
        </div>
      </div>

      {manager && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Users className="h-4 w-4 text-muted" />
          <button onClick={() => setStaff('ALL')} className={cx('chip', staff === 'ALL' && 'chip-on')}>Manager – all staff consolidated</button>
          {staffIds.map((id) => <button key={id} onClick={() => setStaff(id)} className={cx('chip', staff === id && 'chip-on')}>{names[id]}</button>)}
          {can('admin:manage_roles_and_matrix') && <button className="chip" onClick={() => navigate('/admin', { tab: 'staff' })}><SettingsIcon className="h-3.5 w-3.5" />Manage staff</button>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Total gross billed" value={inr(k.gross)} sub={k.bills + ' bill(s)'} icon={Receipt} tone="brand" />
        <Kpi label="Total discount" value={inr(k.discount)} sub={k.gross ? ((k.discount / k.gross) * 100).toFixed(1) + '% of gross' : '—'} icon={BadgePercent} tone="amber" />
        <Kpi label="Net billed" value={inr(k.net)} sub={k.cashless ? 'incl. cashless ' + inr(k.cashless) : 'gross − discount'} icon={TrendingUp} tone="indigo" />
        <Kpi label="Total collected" value={inr(k.collected)} icon={IndianRupee} tone="emerald">
          <div className="flex flex-wrap gap-1"><Badge tone="emerald">Cash {inr(k.cash)}</Badge><Badge tone="violet">UPI {inr(k.upi)}</Badge></div>
        </Kpi>
        <Kpi label="Total due / pending" value={inr(k.due)} sub={day.settlements.length ? day.settlements.length + ' old due(s) collected today' : 'today’s unpaid balances'} icon={Clock} tone={k.due ? 'rose' : 'slate'} />
        <Kpi label="Total daily expenses" value={inr(k.expenses)} icon={ArrowUpRight} tone="rose">
          <div className="flex flex-wrap gap-1"><Badge tone="amber">Cash {inr(k.cashExp)}</Badge><Badge tone="slate">UPI {inr(k.upiExp)}</Badge></div>
        </Kpi>
      </div>

      <div className="rounded-2xl border-2 border-brand-300 bg-gradient-to-r from-brand-50 to-teal-50 p-4 dark:border-brand-800 dark:from-brand-950/40 dark:to-teal-950/30">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center">
          <FormulaBox label="Opening float" value={k.opening}>
            {view !== 'ALL' && canWrite ? <Input size="sm" inputMode="decimal" className="mt-1 w-28 text-center tnum" value={(floats.find((f) => f.id === 'flt_' + date + '_' + view) || {}).amount ?? ''} placeholder="0"
              onChange={(e) => setFloat(view, e.target.value.replace(/[^\d.]/g, ''))} aria-label="Opening float" /> : view === 'ALL' ? <div className="mt-1 text-[10.5px] text-muted">sum of staff floats</div> : null}
          </FormulaBox>
          <Op>+</Op><FormulaBox label="Cash received" value={k.cash} />
          <Op>−</Op><FormulaBox label="Cash expenses" value={k.cashExp} />
          <Op>=</Op><FormulaBox label="Net physical cash in drawer" value={k.drawer} big />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[12.5px]">
          {denomDoc ? <Badge tone={Math.abs(tally) < 0.5 ? 'emerald' : tally < 0 ? 'rose' : 'amber'} icon={Math.abs(tally) < 0.5 ? CircleCheck : TriangleAlert}>{Math.abs(tally) < 0.5 ? 'Tallied' : tally < 0 ? 'Shortage ' + inr(-tally) : 'Excess ' + inr(tally)} · counted {inr(denomDoc.total)} at {fmtTime(denomDoc.savedAt)}</Badge> : <span className="text-muted">Count the physical cash to reconcile the drawer</span>}
          <Button size="sm" icon={Coins} onClick={() => setDenomOpen(!denomOpen)}>{denomOpen ? 'Hide' : 'Physical cash'} denomination counter</Button>
        </div>
        {denomOpen && <DenomCounter key={date + view} date={date} staffId={view} expected={k.drawer} doc={denomDoc} canWrite={canWrite} scope={scope} />}
      </div>

      <ReconcileCard date={date} view={view} lines={recon} sys={sys} exceptions={exceptions} denomDoc={denomDoc} canWrite={canWrite} scope={scope} onCount={() => setDenomOpen(true)} />

      {canBill && date === dateKey() && (
        <Card title="Quick patient collection entry" subtitle={'Prepared by ' + me.name + ' · creates a regular bill in the billing desk'} icon={Plus}
          actions={<><Button size="sm" variant="ghost" onClick={() => navigate('/billing')} icon={ExternalLink}>Full billing desk</Button><Button size="sm" onClick={() => setEntryOpen(!entryOpen)}>{entryOpen ? 'Hide' : 'Show'}</Button></>}>
          {entryOpen && <QuickEntry settings={settings} />}
        </Card>
      )}

      <Card padded={false} title="Daily collection register" subtitle={`${shown.length} bill(s) · ${scope}`} icon={Receipt}
        actions={<>
          <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input size="sm" className="w-[220px] pl-8" placeholder="Search bill, patient, test…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search register" /></div>
          <Select size="sm" className="w-[170px]" value={deptF} onChange={(e) => setDeptF(e.target.value)} placeholder="All departments" options={CASHBOOK_DEPTS} aria-label="Department filter" />
        </>}>
        {!shown.length ? <Empty icon={Receipt} title="No bills" text={date === dateKey() ? 'Bills created at the billing desk or with quick entry appear here instantly.' : 'No bills on this date.'} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface2/60 text-left text-[10.5px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2">S.No</th><th className="px-2">Time</th><th className="px-2">Bill no.</th><th className="px-2">Patient</th><th className="px-2">Department</th><th className="px-2">Investigation</th>
                  <th className="px-2 text-right">Gross</th><th className="px-2 text-right">Disc.</th><th className="px-2 text-right">Net</th><th className="px-2 text-right">Cash</th><th className="px-2 text-right">UPI</th><th className="px-2 text-right">Due</th><th className="px-2">Staff</th><th className="px-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => {
                  const ex = (excByInv[r.inv.id] || []).filter((x) => x.severity !== 'info');
                  return (
                  <tr key={r.inv.id} className={cx('border-b border-line/70', ex.length ? 'bg-amber-50/80 hover:bg-amber-100/70 dark:bg-amber-950/25 dark:hover:bg-amber-950/40' : 'hover:bg-surface2/40')}>
                    <td className="whitespace-nowrap px-3 py-1.5">{i + 1}{ex.length > 0 && <span title={ex.map((x) => x.text).join('\n')}><TriangleAlert className="ml-1 inline h-3.5 w-3.5 text-amber-600" aria-label="Discrepancy" /></span>}</td><td className="px-2 whitespace-nowrap">{fmtTime(r.inv.date)}</td>
                    <td className="px-2"><button className="font-mono text-[11.5px] text-brand-700 hover:underline dark:text-brand-300" onClick={() => navigate('/billing', { invoice: r.inv.id })}>{r.inv.invoiceNo}</button></td>
                    <td className="px-2"><div className="max-w-[170px] truncate font-semibold">{fullName(r.inv.patient)}</div><div className="text-[10.5px] text-muted">{r.inv.referredByName || 'Self'}</div></td>
                    <td className="px-2 text-[11.5px]">{r.depts}</td>
                    <td className="px-2"><div className="max-w-[220px] truncate">{itemsText(r.inv)}</div></td>
                    <td className="px-2 text-right tnum">{inr(r.inv.gross)}</td><td className="px-2 text-right tnum">{r.inv.discountAmount ? inr(r.inv.discountAmount) : '—'}</td>
                    <td className="px-2 text-right font-semibold tnum">{inr(r.inv.net)}</td><td className="px-2 text-right tnum">{r.cash ? inr(r.cash) : '—'}</td><td className="px-2 text-right tnum">{r.upi ? inr(r.upi) : '—'}</td>
                    <td className="px-2 text-right tnum">{r.inv.billingType === 'umid' ? <Badge tone="violet">Cashless</Badge> : r.inv.balance ? <span className="font-semibold text-rose-600">{inr(r.inv.balance)}</span> : '—'}</td>
                    <td className="px-2 text-[11.5px] text-muted"><div className="max-w-[120px] truncate">{names[r.inv.staffId] || '—'}</div></td>
                    <td className="whitespace-nowrap px-2 text-right">
                      {r.inv.balance > 0 && r.inv.billingType !== 'umid' && canBill && <Button size="xs" variant="success" icon={HandCoins} onClick={() => setSettle(r.inv)}>Settle</Button>}
                      {canBill && <button className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface2" title="Edit in billing desk" onClick={() => navigate('/billing', { invoice: r.inv.id })}><Pencil className="h-3.5 w-3.5" /></button>}
                      {can('billing:modify_discounts_refunds') && <button className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40" title="Cancel bill" onClick={() => cancelBill(r.inv)}><Trash2 className="h-3.5 w-3.5" /></button>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-surface2/60 font-bold">
                  <td className="px-3 py-2" colSpan={6}>Total ({shown.length})</td>
                  <td className="px-2 text-right tnum">{inr(sumBy(shown, (r) => r.inv.gross))}</td><td className="px-2 text-right tnum">{inr(sumBy(shown, (r) => r.inv.discountAmount))}</td>
                  <td className="px-2 text-right tnum">{inr(sumBy(shown, (r) => r.inv.net))}</td><td className="px-2 text-right tnum">{inr(sumBy(shown, 'cash'))}</td><td className="px-2 text-right tnum">{inr(sumBy(shown, 'upi'))}</td>
                  <td className="px-2 text-right tnum">{inr(sumBy(shown.filter((r) => r.inv.billingType !== 'umid'), (r) => r.inv.balance))}</td><td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {day.settlements.length > 0 && (
          <div className="border-t border-line px-4 py-2 text-[12px]">
            <div className="mb-1 font-semibold">Old dues collected on {fmtDate(date)}</div>
            {day.settlements.map((s) => <div key={s.p.id} className="flex flex-wrap gap-x-3 text-muted"><span className="font-mono">{s.inv.invoiceNo}</span><span>{fullName(s.inv.patient)}</span><span>billed {fmtDate(s.inv.date)}</span><span className="font-semibold text-ink">{MODE_LABEL[s.p.mode] || s.p.mode} {inr(s.p.amount)}</span><span>{fmtTime(s.p.at)} · {names[s.p.staffId] || ''}</span></div>)}
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card padded={false} title="Department-wise investigations & revenue" icon={TrendingUp}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12.5px]">
              <thead><tr className="border-b border-line bg-surface2/60 text-left text-[10.5px] uppercase text-muted"><th className="px-3 py-2">Department</th><th className="px-2 text-right">Count</th><th className="px-2 text-right">Gross</th><th className="px-2 text-right">Disc.</th><th className="px-2 text-right">Net</th><th className="px-2 text-right">Cash</th><th className="px-2 text-right">UPI</th><th className="px-2 text-right">Due</th></tr></thead>
              <tbody>
                {day.depts.map((d) => <tr key={d.dept} className="border-b border-line/70"><td className="px-3 py-1.5 font-semibold">{d.dept}</td><td className="px-2 text-right tnum">{d.count}</td><td className="px-2 text-right tnum">{inr(round2(d.gross))}</td><td className="px-2 text-right tnum">{inr(round2(d.discount))}</td><td className="px-2 text-right font-semibold tnum">{inr(round2(d.net))}</td><td className="px-2 text-right tnum">{inr(round2(d.cash))}</td><td className="px-2 text-right tnum">{inr(round2(d.upi))}</td><td className="px-2 text-right tnum">{inr(round2(d.due))}</td></tr>)}
                {!day.depts.length && <tr><td colSpan={8} className="px-3 py-4 text-center text-muted">No investigations billed.</td></tr>}
              </tbody>
              {day.depts.length > 0 && <tfoot><tr className="border-t-2 border-line bg-surface2/60 font-bold"><td className="px-3 py-2">Total</td>{['count', 'gross', 'discount', 'net', 'cash', 'upi', 'due'].map((f) => <td key={f} className="px-2 text-right tnum">{f === 'count' ? sumBy(day.depts, f) : inr(round2(sumBy(day.depts, f)))}</td>)}</tr></tfoot>}
            </table>
          </div>
        </Card>
        <BalanceSheet k={k} />
      </div>

      <ExpensesCard date={date} view={view} day={day} names={names} canWrite={canWrite} onEdit={setExpEdit} onDelete={delExpense} me={me} />

      {view === 'ALL' && (
        <Card padded={false} title="Staff-wise collection & handover summary" subtitle="Each billing desk’s cash to hand over to the manager" icon={Users}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-[12.5px]">
              <thead><tr className="border-b border-line bg-surface2/60 text-left text-[10.5px] uppercase text-muted"><th className="px-3 py-2">Staff</th><th className="px-2 text-right">Opening float</th><th className="px-2 text-right">Bills</th><th className="px-2 text-right">Gross</th><th className="px-2 text-right">Disc.</th><th className="px-2 text-right">Cash</th><th className="px-2 text-right">UPI</th><th className="px-2 text-right">Due</th><th className="px-2 text-right">Cash exp.</th><th className="px-2 text-right">Cash to hand over</th></tr></thead>
              <tbody>
                {staffRows.map((s) => (
                  <tr key={s.id} className={cx('border-b border-line/70', s.total && 'bg-surface2/60 font-bold')}>
                    <td className="px-3 py-1.5">{s.total ? s.name : <button className="font-semibold text-brand-700 hover:underline dark:text-brand-300" onClick={() => setStaff(s.id)}>{s.name}</button>}</td>
                    <td className="px-2 text-right tnum">{s.total || !canWrite ? inr(s.opening) : <Input size="sm" inputMode="decimal" className="ml-auto w-24 text-right tnum" value={(floats.find((f) => f.id === 'flt_' + date + '_' + s.id) || {}).amount ?? ''} placeholder="0" onChange={(e) => setFloat(s.id, e.target.value.replace(/[^\d.]/g, ''))} aria-label={'Opening float ' + s.name} />}</td>
                    <td className="px-2 text-right tnum">{s.bills}</td><td className="px-2 text-right tnum">{inr(s.gross)}</td><td className="px-2 text-right tnum">{inr(s.discount)}</td><td className="px-2 text-right tnum">{inr(s.cash)}</td><td className="px-2 text-right tnum">{inr(s.upi)}</td><td className="px-2 text-right tnum">{inr(s.due)}</td><td className="px-2 text-right tnum">{inr(s.cashExp)}</td>
                    <td className="px-2 text-right font-display text-[14px] font-extrabold tnum">{inr(s.drawer)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {settle && <CollectPaymentModal invoice={settle} onClose={() => setSettle(null)} />}
      {expEdit && <ExpenseModal initial={expEdit} date={date} staffId={view === 'ALL' ? me.id : view} onClose={() => setExpEdit(null)} />}
      {printOpen && <PrintModal day={day} rows={rows} staffRows={view === 'ALL' ? staffRows : staffRows.filter((s) => s.id === view)} scope={scope} settings={settings} names={names} preparedBy={view === 'ALL' ? me.name : names[view]} onClose={() => setPrintOpen(false)} />}
    </div>
  );
}

function FormulaBox({ label, value, big, children }) {
  return (
    <div className={cx('min-w-[140px] rounded-xl border bg-surface px-4 py-2', big ? 'border-brand-500 shadow-sm' : 'border-line')}>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={cx('font-display font-extrabold tnum', big ? 'text-2xl text-brand-700 dark:text-brand-300' : 'text-lg')}>{inr(value)}</div>
      {children}
    </div>
  );
}
const Op = ({ children }) => <span className="font-display text-2xl font-extrabold text-muted">{children}</span>;

function DenomCounter({ date, staffId, expected, doc, canWrite, scope }) {
  const [counts, setCounts] = useState(() => Object.assign({}, (doc && doc.counts) || {}));
  const [coins, setCoins] = useState(doc ? doc.coins || '' : '');
  const total = round2(DENOMS.reduce((s, d) => s + d * (Number(counts[d]) || 0), 0) + num(coins));
  const diff = round2(total - expected);
  const status = Math.abs(diff) < 0.5 ? 'Tallied' : diff < 0 ? 'Shortage' : 'Excess';
  const save = () => {
    const id = 'den_' + date + '_' + staffId;
    const u = currentUser();
    // keep the bank / UPI statement totals already entered on this record
    store.put('denoms', Object.assign({}, store.get('denoms', id) || {}, { id, date, staffId, counts, coins: num(coins), total, expected, diff, status, savedAt: Date.now(), savedBy: u ? u.id : null }));
    logAudit('cashbook:cash_counted', 'denoms/' + id, { total, expected, status });
    toast('Cash count saved · ' + status + (status === 'Tallied' ? '' : ' ' + inr(Math.abs(diff))), status === 'Tallied' ? 'success' : 'warning');
    // a shortage / excess alerts the manager's and every other workstation at once
    if (status !== 'Tallied') emitEvent('notify', { type: 'warning', text: 'Cash drawer ' + status.toLowerCase() + ' ' + inr(Math.abs(diff)) + ' — ' + (scope || 'billing desk') + ' counted ' + inr(total) + ' vs ' + inr(expected) + ' expected (' + fmtDate(date) + ')' });
  };
  return (
    <div className="mx-auto mt-3 max-w-3xl rounded-xl border border-line bg-surface p-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
        {DENOMS.map((d) => (
          <Field key={d} label={'₹' + d + ' ×'}>
            <Input size="sm" inputMode="numeric" className="text-center tnum" value={counts[d] || ''} onChange={(e) => setCounts(Object.assign({}, counts, { [d]: e.target.value.replace(/\D/g, '') }))} aria-label={'Notes of ₹' + d} />
            <div className="mt-0.5 text-center text-[10.5px] text-muted tnum">{inr(d * (Number(counts[d]) || 0))}</div>
          </Field>
        ))}
        <Field label="Coins ₹"><Input size="sm" inputMode="decimal" className="text-center tnum" value={coins} onChange={(e) => setCoins(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Coins amount" /></Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-2 text-[13px]">
        <span>Counted <b className="tnum">{inr(total)}</b></span><span className="text-muted">vs drawer {inr(expected)}</span>
        <Badge tone={status === 'Tallied' ? 'emerald' : status === 'Shortage' ? 'rose' : 'amber'} icon={status === 'Tallied' ? CircleCheck : TriangleAlert}>{status}{status === 'Tallied' ? '' : ' ' + inr(Math.abs(diff))}</Badge>
        {canWrite && <Button size="sm" variant="primary" icon={Lock} className="ml-auto" onClick={save}>Save count</Button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- reconciliation
const REC_TONE = { Matched: 'emerald', Short: 'rose', Excess: 'amber', 'Not entered': 'slate' };
const REC_ICON = { cash: Coins, upi: Landmark, card: CreditCard };
const SEV = { error: { icon: ShieldAlert, cls: 'text-rose-600 dark:text-rose-400' }, warning: { icon: TriangleAlert, cls: 'text-amber-600 dark:text-amber-400' }, info: { icon: Info, cls: 'text-sky-600 dark:text-sky-400' } };

function ReconcileCard({ date, view, lines, sys, exceptions, denomDoc, canWrite, scope, onCount }) {
  const visible = lines.filter((l) => l.key !== 'card' || sys.card || (denomDoc && denomDoc.digital && denomDoc.digital.card !== undefined && denomDoc.digital.card !== ''));
  const mismatches = lines.filter((l) => l.diff !== null && Math.abs(l.diff) >= 0.5);
  const saveStatement = (key, raw) => {
    const id = 'den_' + date + '_' + view;
    const cur = store.get('denoms', id) || { id, date, staffId: view };
    const val = raw === '' ? '' : round2(num(raw));
    if (String((cur.digital || {})[key] ?? '') === String(val)) return;
    const u = currentUser();
    store.put('denoms', Object.assign({}, cur, { digital: Object.assign({}, cur.digital || {}, { [key]: val, at: Date.now(), by: u ? u.id : null }) }));
    logAudit('cashbook:statement_entered', 'denoms/' + id, { channel: key, amount: val, system: sys[key] });
    if (val !== '' && Math.abs(val - sys[key]) >= 0.5) {
      const diff = round2(val - sys[key]);
      const what = key === 'upi' ? 'UPI / QR' : 'Card';
      toast(what + ' statement ' + (diff < 0 ? 'short ' : 'excess ') + inr(Math.abs(diff)) + ' against the system', 'warning');
      emitEvent('notify', { type: 'warning', text: what + ' receipts do not match the bank statement: ' + inr(val) + ' vs ' + inr(sys[key]) + ' in the system — ' + scope + ', ' + fmtDate(date) });
    }
  };
  return (
    <Card padded={false} title="Cash vs digital reconciliation" icon={Landmark}
      subtitle={mismatches.length ? mismatches.length + ' mismatch(es) — highlighted below' : exceptions.length ? exceptions.length + ' item(s) to review' : 'System totals against the physical count and the bank / UPI statement'}
      actions={mismatches.length ? <Badge tone="rose" icon={TriangleAlert}>Not reconciled</Badge> : lines.every((l) => l.key === 'card' || l.status === 'Matched') ? <Badge tone="emerald" icon={CircleCheck}>Reconciled</Badge> : <Badge>Pending</Badge>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[12.5px]">
          <thead><tr className="border-b border-line bg-surface2/60 text-left text-[10.5px] uppercase tracking-wide text-muted"><th className="px-3 py-2">Channel</th><th className="px-2 text-right">As per system</th><th className="px-2 text-right">Counted / statement</th><th className="px-2 text-right">Difference</th><th className="px-2">Status</th></tr></thead>
          <tbody>
            {visible.map((l) => {
              const I = REC_ICON[l.key];
              const bad = l.diff !== null && Math.abs(l.diff) >= 0.5;
              return (
                <tr key={l.key} className={cx('border-b border-line/70', bad && (l.diff < 0 ? 'bg-rose-50/80 dark:bg-rose-950/25' : 'bg-amber-50/80 dark:bg-amber-950/25'))}>
                  <td className="px-3 py-2"><div className="flex items-center gap-2 font-semibold"><I className="h-4 w-4 text-muted" />{l.label}</div><div className="pl-6 text-[11px] text-muted">{l.sub}</div></td>
                  <td className="px-2 text-right font-semibold tnum">{inr(l.system)}</td>
                  <td className="px-2 text-right">
                    {l.key === 'cash'
                      ? (l.actual === null ? <Button size="xs" icon={Coins} onClick={onCount}>Count cash</Button> : <span className="tnum">{inr(l.actual)}<span className="ml-1 text-[10.5px] text-muted">{fmtTime(denomDoc.savedAt)}</span></span>)
                      : canWrite
                        ? <Input key={date + view + l.key + String(l.actual)} size="sm" inputMode="decimal" className="ml-auto w-32 text-right tnum" defaultValue={l.actual === null ? '' : l.actual} placeholder={l.actualLabel}
                            onBlur={(e) => saveStatement(l.key, e.target.value.replace(/[^\d.]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} aria-label={l.label + ' ' + l.actualLabel} />
                        : <span className="tnum">{l.actual === null ? '—' : inr(l.actual)}</span>}
                  </td>
                  <td className={cx('px-2 text-right font-bold tnum', bad ? (l.diff < 0 ? 'text-rose-600' : 'text-amber-600') : 'text-muted')}>{l.diff === null ? '—' : (l.diff > 0 ? '+' : l.diff < 0 ? '−' : '') + inr(Math.abs(l.diff))}</td>
                  <td className="px-2"><Badge tone={REC_TONE[l.status]}>{l.status}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {exceptions.length > 0 && (
        <div className="border-t border-line px-3 py-2">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">Detected automatically</div>
          <ul className="space-y-1">
            {exceptions.map((x) => {
              const S = SEV[x.severity] || SEV.info;
              return (
                <li key={x.key} className="flex items-start gap-2 text-[12.5px]">
                  <S.icon className={cx('mt-0.5 h-4 w-4 shrink-0', S.cls)} />
                  <span className="min-w-0 flex-1">{x.text}</span>
                  {x.invId && <button className="shrink-0 text-[11.5px] font-semibold text-brand-700 hover:underline dark:text-brand-300" onClick={() => navigate('/billing', { invoice: x.invId })}>Open bill</button>}
                  {x.key === 'stale' && <button className="shrink-0 text-[11.5px] font-semibold text-brand-700 hover:underline dark:text-brand-300" onClick={onCount}>Recount</button>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

function BalanceSheet({ k }) {
  const Row = ({ label, v, strong }) => <div className={cx('flex justify-between gap-2 py-1', strong && 'border-t border-line pt-1.5 font-bold')}><span>{label}</span><span className="tnum">{inr(v)}</span></div>;
  return (
    <Card title="Daily balance sheet" subtitle="Inflows · outflows · closing balances" icon={Calculator}>
      <div className="grid gap-4 text-[13px] sm:grid-cols-3">
        <div><div className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"><ArrowDownLeft className="h-3.5 w-3.5" />Inflows (receipts)</div>
          <Row label="Opening float" v={k.opening} /><Row label="Cash collected" v={k.cash} /><Row label="UPI collected" v={k.upi} /><Row label="Total" v={round2(k.opening + k.cash + k.upi)} strong /></div>
        <div><div className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-rose-700 dark:text-rose-300"><ArrowUpRight className="h-3.5 w-3.5" />Outflows (payments)</div>
          <Row label="Cash expenses" v={k.cashExp} /><Row label="UPI / bank expenses" v={k.upiExp} /><Row label="Total" v={k.expenses} strong /></div>
        <div><div className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300"><Wallet className="h-3.5 w-3.5" />Closing balances</div>
          <Row label="Net cash in hand (drawer)" v={k.drawer} /><Row label="Net UPI / bank receivable" v={k.bank} /><Row label="Pending patient dues" v={k.due} />{k.cashless ? <Row label="Cashless claimable" v={k.cashless} /> : null}</div>
      </div>
    </Card>
  );
}

function ExpensesCard({ date, view, day, names, canWrite, onEdit, onDelete, me }) {
  const blank = { description: '', category: seed.EXPENSE_CATEGORIES[0], mode: 'cash', amount: '', paidTo: '' };
  const [f, setF] = useState(blank);
  const add = () => {
    if (!canWrite) return toast('Your role cannot record expenses', 'error');
    if (!String(f.description).trim()) return toast('Enter what the money was spent on', 'warning');
    if (!(num(f.amount) > 0)) return toast('Enter the amount', 'warning');
    const staffId = view === 'ALL' ? me.id : view;
    const doc = store.put('expenses', { id: uid('exp_'), date, description: f.description.trim(), category: f.category, mode: f.mode, amount: round2(num(f.amount)), paidTo: f.paidTo.trim(), staffId, createdAt: Date.now() });
    logAudit('cashbook:expense_added', 'expenses/' + doc.id, { amount: doc.amount, mode: doc.mode, category: doc.category });
    setF(blank);
    toast('Expense recorded', 'success');
  };
  const canChange = (x) => canWrite && (x.staffId === me.id || me.role === 'SUPER_ADMIN_RADIOLOGIST');
  return (
    <Card padded={false} title="Daily expenses (cash book outflow)" subtitle="Only cash expenses reduce the drawer; UPI / bank expenses reduce the digital balance" icon={ArrowUpRight}>
      {canWrite && (
        <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-12">
          <Field label="Description" className="sm:col-span-4"><Input list="exp-hints" value={f.description} onChange={(e) => setF(Object.assign({}, f, { description: e.target.value }))} placeholder="e.g. Ultrasound gel & thermal rolls" /><datalist id="exp-hints">{EXP_HINTS.map((x) => <option key={x} value={x} />)}</datalist></Field>
          <Field label="Category" className="sm:col-span-3"><Select value={f.category} onChange={(e) => setF(Object.assign({}, f, { category: e.target.value }))} options={seed.EXPENSE_CATEGORIES} /></Field>
          <Field label="Mode" className="sm:col-span-2"><Segmented value={f.mode} onChange={(v) => setF(Object.assign({}, f, { mode: v }))} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI / Bank' }]} /></Field>
          <Field label="Amount (₹)" className="sm:col-span-1"><Input inputMode="decimal" value={f.amount} onChange={(e) => setF(Object.assign({}, f, { amount: e.target.value.replace(/[^\d.]/g, '') }))} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} /></Field>
          <Field label="Paid to" className="sm:col-span-1"><Input value={f.paidTo} onChange={(e) => setF(Object.assign({}, f, { paidTo: e.target.value }))} /></Field>
          <div className="flex items-end sm:col-span-1"><Button variant="primary" icon={Plus} className="w-full" onClick={add}>Add</Button></div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[12.5px]">
          <thead><tr className="border-b border-line bg-surface2/60 text-left text-[10.5px] uppercase text-muted"><th className="px-3 py-2">S.No</th><th className="px-2">Description</th><th className="px-2">Category</th><th className="px-2">Mode</th><th className="px-2 text-right">Amount</th><th className="px-2">Logged by</th><th className="px-2" /></tr></thead>
          <tbody>
            {day.expenses.map((x, i) => (
              <tr key={x.id} className="border-b border-line/70">
                <td className="px-3 py-1.5">{i + 1}</td><td className="px-2"><div className="font-medium">{x.description}</div>{x.paidTo && <div className="text-[11px] text-muted">{x.paidTo}</div>}</td>
                <td className="px-2">{x.category}</td><td className="px-2"><Badge tone={x.mode === 'cash' ? 'amber' : 'slate'}>{x.mode === 'cash' ? 'Cash' : 'UPI / Bank'}</Badge></td>
                <td className="px-2 text-right font-semibold tnum">{inr(x.amount)}</td><td className="px-2 text-muted">{names[x.staffId] || '—'}</td>
                <td className="whitespace-nowrap px-2 text-right">{canChange(x) && <><button className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface2" title="Edit" onClick={() => onEdit(x)}><Pencil className="h-3.5 w-3.5" /></button><button className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40" title="Delete" onClick={() => onDelete(x)}><Trash2 className="h-3.5 w-3.5" /></button></>}</td>
              </tr>
            ))}
            {!day.expenses.length && <tr><td colSpan={7} className="px-3 py-4 text-center text-muted">No expenses recorded for this day.</td></tr>}
          </tbody>
          {day.expenses.length > 0 && <tfoot><tr className="border-t-2 border-line bg-surface2/60 font-bold"><td className="px-3 py-2" colSpan={4}>Total · cash {inr(day.kpi.cashExp)} · UPI / bank {inr(day.kpi.upiExp)}</td><td className="px-2 text-right tnum">{inr(day.kpi.expenses)}</td><td colSpan={2} /></tr></tfoot>}
        </table>
      </div>
    </Card>
  );
}

function ExpenseModal({ initial, onClose }) {
  const [f, setF] = useState(Object.assign({}, initial));
  const save = () => {
    if (!(num(f.amount) > 0) || !String(f.description).trim()) return toast('Description and amount are required', 'warning');
    store.put('expenses', Object.assign({}, f, { amount: round2(num(f.amount)), description: f.description.trim() }));
    logAudit('cashbook:expense_edited', 'expenses/' + f.id, { amount: num(f.amount), from: initial.amount });
    onClose();
  };
  return (
    <Modal open size="sm" onClose={onClose} title="Edit expense" icon={Pencil} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Description"><Input value={f.description} onChange={(e) => setF(Object.assign({}, f, { description: e.target.value }))} /></Field>
        <Field label="Category"><Select value={f.category} onChange={(e) => setF(Object.assign({}, f, { category: e.target.value }))} options={seed.EXPENSE_CATEGORIES} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mode"><Segmented value={f.mode} onChange={(v) => setF(Object.assign({}, f, { mode: v }))} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI / Bank' }]} /></Field>
          <Field label="Amount (₹)"><Input inputMode="decimal" value={f.amount} onChange={(e) => setF(Object.assign({}, f, { amount: e.target.value.replace(/[^\d.]/g, '') }))} /></Field>
        </div>
        <Field label="Paid to"><Input value={f.paidTo || ''} onChange={(e) => setF(Object.assign({}, f, { paidTo: e.target.value }))} /></Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- quick entry (creates a real bill)
function QuickEntry({ settings }) {
  const tests = useColl('tests');
  const blank = () => ({ title: 'Mrs.', name: '', age: '', gender: 'Female', mobile: '', referredBy: 'SELF', dept: 'USG (Sonography)', testId: '', testName: '', gross: '', discount: '', mode: 'cash', cash: '', upi: '', utr: '' });
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((x) => Object.assign({}, x, patch));
  const canDisc = can('billing:modify_discounts_refunds');
  const qd = QUICK_DEPTS.find((d) => d.value === f.dept) || QUICK_DEPTS[0];
  const options = tests.filter((t) => t.isActive !== false && (qd.dept === 'Other' ? !['Ultrasound', 'Pathology', 'Biochemistry', 'X-Ray', 'ECG'].includes(t.department) : qd.dept === 'Pathology' ? ['Pathology', 'Biochemistry'].includes(t.department) : t.department === qd.dept) && (!qd.doppler || t.isDoppler));
  const gross = num(f.gross);
  const disc = Math.min(gross, canDisc ? num(f.discount) : 0);
  const net = round2(gross - disc);
  const pickTest = (id, t) => set({ testId: id, testName: t ? t.name : '', gross: t ? String(t.tariff.standardRate) : f.gross });
  const save = async () => {
    if (!String(f.name).trim()) return toast('Enter the patient name', 'warning');
    if (!(gross > 0)) return toast('Enter the gross amount', 'warning');
    if (!f.testName.trim()) return toast('Enter the investigation', 'warning');
    let pays = [];
    if (f.mode === 'cash') pays = [['cash', net]];
    else if (f.mode === 'upi') pays = [['upi', net]];
    else if (f.mode === 'split') pays = [['cash', num(f.cash)], ['upi', num(f.upi)]].filter((x) => x[1] > 0);
    if (round2(pays.reduce((s, x) => s + x[1], 0)) > net + 0.001) return toast('Payments exceed the net amount', 'warning');
    setBusy(true);
    try {
      const u = currentUser();
      const t = f.testId ? store.get('tests', f.testId) : null;
      const now = Date.now();
      const no = await allocateInvoiceNo(now);
      const doc = store.get('doctors', f.referredBy);
      const item = { testId: t ? t.id : '', code: t ? t.code : '', name: f.testName.trim(), department: t ? t.department : qd.dept === 'Other' ? 'Other' : qd.dept, rate: gross, amount: gross };
      const inv = finalizeInvoice({
        id: uid('inv_'), invoiceNo: no, date: now, dateKey: dateKey(now), patientId: null, visitId: null,
        patient: { title: f.title, name: f.name.trim(), relation: '', guardianName: '', age: f.age === '' ? '' : Number(f.age), ageUnit: 'Years', gender: f.gender, mobile: f.mobile.replace(/\D/g, '').slice(-10), email: '', address: '', aadhaar: '', regId: '' },
        referredBy: f.referredBy || 'SELF', referredByName: !f.referredBy || f.referredBy === 'SELF' ? 'Self' : doc ? doc.name : '',
        items: [item], billingType: 'standard', umid: null, discountType: 'flat', discountValue: disc, discountReason: disc ? 'Quick entry' : '',
        paymentMode: f.mode === 'split' ? 'split' : f.mode, paymentRef: f.utr.trim(),
        payments: pays.map(([mode, amount]) => ({ id: uid('pay_'), at: now, mode, amount: round2(amount), staffId: u.id, note: mode !== 'cash' && f.utr.trim() ? f.utr.trim() : 'Quick entry', ref: mode !== 'cash' ? f.utr.trim() : '' })),
        staffId: u.id, createdBy: u.id, shareId: newShareId(), notes: 'Cash book quick entry', sent: {}, source: 'cashbook'
      });
      store.put('invoices', inv);
      toast(`Bill ${inv.invoiceNo} saved · ${inv.status === 'PAID' ? 'paid in full' : 'due ' + inr(inv.balance)}`, 'success');
      setF(blank());
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-2 sm:grid-cols-12">
      <Field label="Patient" className="sm:col-span-4"><div className="flex gap-1"><Select className="w-[86px]" value={f.title} onChange={(e) => set({ title: e.target.value, gender: TITLE_GENDER[e.target.value] || f.gender })} options={TITLES} /><Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Full name" /></div></Field>
      <Field label="Age / gender" className="sm:col-span-2"><div className="flex gap-1"><Input inputMode="numeric" className="w-16" value={f.age} onChange={(e) => set({ age: e.target.value.replace(/\D/g, '').slice(0, 3) })} placeholder="Y" /><Select value={f.gender} onChange={(e) => set({ gender: e.target.value })} options={['Female', 'Male', 'Other']} /></div></Field>
      <Field label="Mobile" className="sm:col-span-2"><Input inputMode="numeric" value={f.mobile} onChange={(e) => set({ mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })} /></Field>
      <Field label="Referring doctor" className="sm:col-span-4"><DoctorPicker value={f.referredBy} onChange={(v) => set({ referredBy: v })} /></Field>
      <Field label="Department / modality" className="sm:col-span-3"><Select value={f.dept} onChange={(e) => set({ dept: e.target.value, testId: '', testName: '' })} options={QUICK_DEPTS.map((d) => d.value)} /></Field>
      <Field label="Investigation" className="sm:col-span-4">
        <Combobox value={f.testId} onChange={pickTest} items={options} getLabel={(x) => x.name} getSub={(x) => x.code + ' · ' + inr(x.tariff.standardRate)} placeholder="Search tariff or type a name…"
          onCreate={(name) => set({ testId: '', testName: name })} createLabel="Use as typed" />
        {!f.testId && f.testName && <div className="mt-0.5 text-[11px] text-muted">Custom: {f.testName}</div>}
      </Field>
      <Field label="Gross ₹" className="sm:col-span-1"><Input inputMode="decimal" className="tnum" value={f.gross} onChange={(e) => set({ gross: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
      <Field label="Discount ₹" className="sm:col-span-1" hint={canDisc ? '' : 'admin only'}><Input inputMode="decimal" className="tnum" disabled={!canDisc} value={f.discount} onChange={(e) => set({ discount: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
      <Field label="Net ₹" className="sm:col-span-1"><div className="flex h-9 items-center rounded-lg bg-surface2 px-2 font-bold tnum">{inr(net)}</div></Field>
      <Field label="Payment" className="sm:col-span-2"><Select value={f.mode} onChange={(e) => set({ mode: e.target.value })} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'split', label: 'Split (cash + UPI + due)' }, { value: 'due', label: 'Due (credit)' }]} /></Field>
      {f.mode === 'split' && <>
        <Field label="Cash ₹" className="sm:col-span-2"><Input inputMode="decimal" value={f.cash} onChange={(e) => set({ cash: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <Field label="UPI ₹" className="sm:col-span-2"><Input inputMode="decimal" value={f.upi} onChange={(e) => set({ upi: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <div className="flex items-end text-[12px] text-muted sm:col-span-3">Due: <b className="ml-1 text-rose-600">{inr(Math.max(0, round2(net - num(f.cash) - num(f.upi))))}</b></div>
      </>}
      {(f.mode === 'upi' || f.mode === 'split') && <Field label="UPI ref. (UTR)" className="sm:col-span-2" hint="optional · helps the bank match"><Input inputMode="numeric" value={f.utr} onChange={(e) => set({ utr: e.target.value.replace(/[^\w-]/g, '').slice(0, 24) })} placeholder="12-digit UTR" /></Field>}
      <div className={cx('flex items-end', f.mode === 'split' ? 'sm:col-span-3' : f.mode === 'upi' ? 'sm:col-span-10' : 'sm:col-span-12')}><Button variant="primary" icon={Receipt} loading={busy} className="ml-auto" onClick={save}>Save bill to register</Button></div>
    </div>
  );
}

// ---------------------------------------------------------------- A4 print
function PrintModal({ day, rows, staffRows, scope, settings, names, preparedBy, onClose }) {
  const [list, setList] = useState(false);
  const res = useMemo(() => cashbookPages({ day, rows, settlements: day.settlements, staffRows, scope, includeList: list, settings, names, preparedBy }), [day, rows, staffRows, scope, list, settings, names, preparedBy]);
  const print = () => printHtml({ html: res.html, widthMm: 210, heightMm: 297, title: 'CashBook_' + day.date, audit: { action: 'cashbook:printed', target: 'cashbook/' + day.date, meta: { scope, pages: res.pageCount } } });
  return (
    <Modal open size="xl" onClose={onClose} title="Print A4 daily summary & cash book" subtitle={`${fmtDate(day.date)} · ${scope} · ${res.pageCount} page(s)`} icon={Printer}
      footer={<><Toggle checked={list} onChange={setList} label="Include itemised patient list" className="mr-auto" /><Button onClick={onClose}>Close</Button><Button variant="primary" icon={Printer} onClick={print}>Print</Button></>}>
      <div className="ff-preview max-h-[70vh] overflow-y-auto rounded-xl bg-slate-200/70 p-3 dark:bg-slate-950/60">
        <div className="mx-auto w-fit origin-top" style={{ zoom: 0.8 }} dangerouslySetInnerHTML={{ __html: res.html }} />
      </div>
    </Modal>
  );
}
