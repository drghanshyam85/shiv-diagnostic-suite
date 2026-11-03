// Payment capture: Cash / UPI / QR / Card / Due (credit) / Split & Mixed, live balance, change, UPI QR.
import { Banknote, Smartphone, QrCode, CreditCard, Clock, Split, Train } from 'lucide-react';
import { useSettings } from '../../core/hooks';
import { useQr, upiLink } from '../../core/qr';
import { inr, round2 } from '../../core/utils';
import { cx, Input, Badge, Button } from '../../components/ui';

export const PAY_MODES = [
  { id: 'cash', label: 'Cash', icon: Banknote }, { id: 'upi', label: 'UPI', icon: Smartphone }, { id: 'qr', label: 'QR Code', icon: QrCode },
  { id: 'card', label: 'Debit / Credit Card', icon: CreditCard }, { id: 'due', label: 'Due / Credit', icon: Clock }, { id: 'split', label: 'Split / Mix', icon: Split }
];

/** Derive the amount actually received and the payment entries from the panel state. */
export function paymentFromPanel(p, net) {
  if (p.mode === 'umid') return { received: 0, change: 0, entries: [] };
  if (p.mode === 'split') {
    const parts = [['cash', p.split.cash], ['upi', p.split.upi], ['card', p.split.card]].map(([m, v]) => [m, round2(Number(v) || 0)]).filter(([, v]) => v > 0);
    const total = round2(parts.reduce((s, [, v]) => s + v, 0));
    return { received: Math.min(total, net), change: 0, over: Math.max(0, total - net), entries: parts.map(([mode, amount]) => ({ mode, amount })) };
  }
  if (p.mode === 'due') {
    const adv = round2(Number(p.advance) || 0);
    return { received: Math.min(adv, net), change: 0, entries: adv > 0 ? [{ mode: p.advanceMode || 'cash', amount: Math.min(adv, net) }] : [] };
  }
  const tendered = p.touched ? round2(Number(p.received) || 0) : net;
  const rec = Math.min(tendered, net);
  return { received: rec, change: p.mode === 'cash' ? Math.max(0, round2(tendered - net)) : 0, entries: rec > 0 ? [{ mode: p.mode, amount: rec }] : [] };
}

/** Exact amount plus the next round notes a patient is likely to hand over. */
export function tenderOptions(net) {
  const out = [net];
  [100, 500, 1000, 2000].forEach((step) => { const v = Math.ceil(net / step) * step; if (v > net && !out.includes(v) && v - net < 2000) out.push(v); });
  return out.slice(0, 4);
}

/** Split payment: one row per mode, "Rest" fills what is still unallocated, with a live allocation bar. */
function SplitRows({ split, net, onChange }) {
  const ROWS = [['cash', 'Cash', Banknote], ['upi', 'UPI / QR', Smartphone], ['card', 'Card', CreditCard]];
  const val = (k) => round2(Number(split[k]) || 0);
  const total = round2(ROWS.reduce((s, [k]) => s + val(k), 0));
  const remaining = round2(net - total);
  const setK = (k, v) => onChange(Object.assign({}, split, { [k]: v }));
  const rest = (k) => setK(k, String(Math.max(0, round2(net - (total - val(k))))));
  const pct = (k) => (net > 0 ? Math.min(100, (val(k) / net) * 100) : 0);
  return (
    <div className="space-y-2">
      {ROWS.map(([k, label, Icon]) => (
        <div key={k} className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-2">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold"><Icon className="h-4 w-4 text-muted" />{label}</span>
          <input type="number" min="0" className="input tnum" value={split[k]} placeholder="0" onChange={(e) => setK(k, e.target.value)} aria-label={label + ' amount'} />
          <Button size="sm" disabled={remaining <= 0 && val(k) === 0} onClick={() => rest(k)} title={'Put the remaining amount on ' + label}>Rest</Button>
        </div>
      ))}
      <div className="rounded-lg border border-line p-2">
        <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-surface2" aria-hidden="true">
          <span className="bg-emerald-500" style={{ width: pct('cash') + '%' }} />
          <span className="bg-sky-500" style={{ width: pct('upi') + '%' }} />
          <span className="bg-violet-500" style={{ width: pct('card') + '%' }} />
        </div>
        <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-[12px]">
          <span className="tnum">Allocated {inr(total, { decimals: 2 })} of {inr(net, { decimals: 2 })}</span>
          {remaining > 0.009 ? <b className="text-amber-700 tnum dark:text-amber-300">Remaining {inr(remaining, { decimals: 2 })} (stays as due)</b>
            : remaining < -0.009 ? <b className="text-rose-600 tnum">Over by {inr(-remaining, { decimals: 2 })}</b>
              : <b className="text-emerald-700 dark:text-emerald-300">Fully allocated</b>}
        </div>
      </div>
    </div>
  );
}

export function PaymentPanel({ value, onChange, net, invoiceNo, umid }) {
  const settings = useSettings();
  const p = value;
  const set = (patch) => onChange(Object.assign({}, p, patch));
  const res = paymentFromPanel(umid ? Object.assign({}, p, { mode: 'umid' }) : p, net);
  const balance = round2(Math.max(0, net - res.received));
  const upiAmount = p.mode === 'split' ? Number(p.split.upi) || 0 : p.mode === 'due' ? balance : res.received || net;
  const showQr = !umid && ['upi', 'qr', 'split', 'due'].includes(p.mode) && upiAmount > 0 && settings.billing.upiId;
  const qr = useQr(showQr ? upiLink({ pa: settings.billing.upiId, pn: settings.billing.upiPayeeName, am: upiAmount, tn: 'Invoice ' + invoiceNo, tr: invoiceNo }) : '', { size: 220 });
  if (umid) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">
        <Train className="h-6 w-6" /><div><b>Older cashless bill.</b> No payment is collected from the patient; the net CGHS amount ({inr(net, { decimals: 2 })}) goes into the monthly railway claim sheet.</div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {PAY_MODES.map((m) => (
          <button key={m.id} type="button" onClick={() => set({ mode: m.id, touched: false })}
            className={cx('flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-[11.5px] font-semibold transition', p.mode === m.id ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-200' : 'border-line hover:bg-surface2')}>
            <m.icon className="h-4 w-4" />{m.label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          {p.mode === 'split' ? (
            <SplitRows split={p.split} net={net} onChange={(split) => set({ split })} />
          ) : p.mode === 'due' ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="label">Advance received now (optional)</span><input type="number" min="0" className="input tnum" value={p.advance} onChange={(e) => set({ advance: e.target.value })} /></label>
              <label className="block"><span className="label">Advance mode</span><select className="input" value={p.advanceMode || 'cash'} onChange={(e) => set({ advanceMode: e.target.value })}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option></select></label>
            </div>
          ) : (
            <div>
              <label className="block">
                <span className="label">{p.mode === 'cash' ? 'Cash tendered / total received' : 'Total received (paid amount)'}</span>
                <input type="number" min="0" className="input text-lg font-bold tnum" value={p.touched ? p.received : net} onChange={(e) => set({ received: e.target.value, touched: true })} aria-label="Total received" />
              </label>
              {p.mode === 'cash' && net > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1" aria-label="Cash tendered shortcuts">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">Patient gave</span>
                  {tenderOptions(net).map((v) => (
                    <button key={v} type="button" onClick={() => set({ received: String(v), touched: v !== net })}
                      className={cx('chip px-2 py-0.5 text-[11.5px] tnum', ((p.touched ? Number(p.received) : net) === v) && 'chip-on')}>{v === net ? 'Exact ' + inr(v) : inr(v)}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {['upi', 'qr', 'card'].includes(p.mode) && <Input placeholder={p.mode === 'card' ? 'Card last 4 digits / approval code' : 'UPI transaction ref (UTR) — optional'} value={p.ref || ''} onChange={(e) => set({ ref: e.target.value })} />}
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-line p-2.5 text-center">
            <div><div className="text-[10.5px] font-semibold uppercase text-muted">Net payable</div><div className="font-display text-lg font-extrabold tnum">{inr(net, { decimals: 2 })}</div></div>
            <div><div className="text-[10.5px] font-semibold uppercase text-muted">Total received</div><div className="font-display text-lg font-extrabold text-emerald-600 tnum">{inr(res.received, { decimals: 2 })}</div></div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase text-muted">Balance due</div>
              {balance > 0
                ? <div className="font-display text-lg font-extrabold text-rose-600 tnum">{inr(balance, { decimals: 2 })}</div>
                : <Badge tone="emerald" className="mt-1">PAID IN FULL</Badge>}
            </div>
          </div>
          {res.change > 0 && <div className="rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Return change to patient: {inr(res.change, { decimals: 2 })}</div>}
          {res.over > 0 && <div className="rounded-lg bg-rose-50 px-3 py-1.5 text-sm font-semibold text-rose-700 dark:bg-rose-950/40">Split total exceeds net payable by {inr(res.over, { decimals: 2 })}</div>}
        </div>
        {showQr && (
          <div className="flex flex-col items-center rounded-xl border border-line bg-white p-2 text-center text-slate-800">
            {qr ? <img src={qr} alt="UPI QR" className="h-36 w-36" /> : <div className="h-36 w-36" />}
            <div className="text-[11px] font-bold">Scan to pay {inr(upiAmount, { decimals: 2 })}</div>
            <div className="text-[10px] text-slate-500">{settings.billing.upiId}</div>
          </div>
        )}
        {!settings.billing.upiId && ['upi', 'qr'].includes(p.mode) && <div className="max-w-[180px] rounded-xl border border-dashed border-amber-300 p-2 text-[11px] text-amber-800">Set your UPI ID in Settings → Billing to show a scan-to-pay QR with the exact amount.</div>}
      </div>
    </div>
  );
}
