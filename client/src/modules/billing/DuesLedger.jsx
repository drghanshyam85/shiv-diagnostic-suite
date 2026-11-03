// Pending dues ledger + Collect Payment / Clear Due workflow + recent bills list.
import { useMemo, useState } from 'react';
import { Wallet, Search, Receipt } from 'lucide-react';
import { useColl } from '../../core/hooks';
import { store } from '../../core/store';
import { currentUser, logAudit } from '../../core/auth';
import { finalizeInvoice, MODE_LABEL } from '../../core/finance';
import { inr, fmtDate, fmtTime, fullName, uid, dateKey, round2 } from '../../core/utils';
import { cx, Modal, Button, Input, Select, Empty, Badge, Tabs, toast } from '../../components/ui';

export function collectPayment(invoiceId, amount, mode, note) {
  const inv = store.get('invoices', invoiceId);
  if (!inv) throw new Error('Invoice not found');
  const amt = round2(Number(amount) || 0);
  if (!amt) throw new Error('Enter an amount');
  const payments = (inv.payments || []).concat([{ id: uid('pay_'), at: Date.now(), mode, amount: amt, staffId: (currentUser() || {}).id, note: note || (amt < 0 ? 'Refund' : 'Balance due collected') }]);
  const next = finalizeInvoice(Object.assign({}, inv, { payments }));
  store.put('invoices', next);
  logAudit(amt < 0 ? 'invoice:refund' : 'invoice:payment_collected', 'invoices/' + inv.id, { invoiceNo: inv.invoiceNo, amount: amt, mode });
  return next;
}

export function CollectPaymentModal({ invoice, onClose, onDone }) {
  const [amount, setAmount] = useState(invoice ? invoice.balance : 0);
  const [mode, setMode] = useState('cash');
  const [note, setNote] = useState('');
  if (!invoice) return null;
  const save = () => {
    try {
      if (Number(amount) > invoice.balance + 0.001) { toast('Amount exceeds balance due', 'warning'); return; }
      const next = collectPayment(invoice.id, amount, mode, note);
      toast(`Collected ${inr(amount)} — ${next.status === 'PAID' ? 'PAID IN FULL' : 'balance ' + inr(next.balance)}`, 'success');
      onDone && onDone(next);
      onClose();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={'Collect payment · ' + invoice.invoiceNo} subtitle={fullName(invoice.patient) + ' · billed ' + fmtDate(invoice.date)} icon={Wallet}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="success" onClick={save}>Collect & update receipt</Button></>}>
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-surface2 p-2"><div className="text-[10px] uppercase text-muted">Net</div><div className="font-bold tnum">{inr(invoice.net)}</div></div>
        <div className="rounded-lg bg-surface2 p-2"><div className="text-[10px] uppercase text-muted">Paid</div><div className="font-bold text-emerald-600 tnum">{inr(invoice.paid)}</div></div>
        <div className="rounded-lg bg-rose-50 p-2 dark:bg-rose-950/40"><div className="text-[10px] uppercase text-muted">Due</div><div className="font-bold text-rose-600 tnum">{inr(invoice.balance)}</div></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className="label">Amount received</span><Input type="number" min="0" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} className="tnum" /></label>
        <label><span className="label">Mode</span><Select value={mode} onChange={(e) => setMode(e.target.value)} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'qr', label: 'QR Code' }, { value: 'card', label: 'Card' }]} /></label>
      </div>
      <label className="mt-3 block"><span className="label">Note / UTR (optional)</span><Input value={note} onChange={(e) => setNote(e.target.value)} /></label>
    </Modal>
  );
}

export function BillsSidebar({ onOpen, activeId }) {
  const invoices = useColl('invoices');
  const [tab, setTab] = useState('dues');
  const [q, setQ] = useState('');
  const [collect, setCollect] = useState(null);
  const today = dateKey();
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    let arr = tab === 'dues' ? invoices.filter((i) => i.balance > 0.009 && i.billingType !== 'umid') : invoices.filter((i) => i.dateKey === today);
    if (s) arr = arr.filter((i) => (i.invoiceNo + ' ' + i.patient.name + ' ' + i.patient.mobile).toLowerCase().includes(s));
    return arr.sort((a, b) => b.date - a.date);
  }, [invoices, tab, q, today]);
  const totalDue = invoices.filter((i) => i.balance > 0.009 && i.billingType !== 'umid').reduce((s, i) => s + i.balance, 0);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs value={tab} onChange={setTab} className="px-2" tabs={[{ id: 'dues', label: 'Pending dues', count: invoices.filter((i) => i.balance > 0.009 && i.billingType !== 'umid').length }, { id: 'today', label: "Today's bills", count: invoices.filter((i) => i.dateKey === today).length }]} />
      <div className="relative px-3 py-2">
        <Search className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <Input className="pl-8" size="sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Bill no / name / mobile" />
      </div>
      {tab === 'dues' && <div className="mx-3 mb-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">Total outstanding: {inr(totalDue)}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!list.length && <Empty icon={Receipt} title={tab === 'dues' ? 'No pending dues' : 'No bills today'} />}
        {list.map((i) => (
          <div key={i.id} className={cx('mb-1.5 rounded-xl border p-2.5 text-sm', activeId === i.id ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/30' : 'border-line bg-surface')}>
            <button className="w-full text-left" onClick={() => onOpen(i)}>
              <div className="flex items-center justify-between gap-2"><span className="truncate font-semibold">{fullName(i.patient)}</span><span className="text-[11px] font-semibold tnum">{inr(i.net)}</span></div>
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted"><span>{i.invoiceNo} · {fmtDate(i.date)} {fmtTime(i.date)}</span>
                {i.billingType === 'umid' ? <Badge tone="indigo">Cashless</Badge> : i.balance > 0 ? <span className="font-bold text-rose-600 tnum">Due {inr(i.balance)}</span> : <Badge tone="emerald">Paid · {MODE_LABEL[i.paymentMode] || i.paymentMode}</Badge>}
              </div>
            </button>
            {i.balance > 0 && i.billingType !== 'umid' && <Button size="xs" variant="success" className="mt-1.5 w-full" onClick={() => setCollect(i)}>Collect payment / clear due</Button>}
          </div>
        ))}
      </div>
      {collect && <CollectPaymentModal invoice={collect} onClose={() => setCollect(null)} onDone={(inv) => onOpen(inv)} />}
    </div>
  );
}
