// Multi-modality investigation picker + selected-tests rate editor + discount/total block.
import { useMemo, useRef, useState } from 'react';
import { Search, Plus, Trash2, Star, Lock, Check, Package, Repeat } from 'lucide-react';
import { useColl, useSettings } from '../core/hooks';
import { can } from '../core/auth';
import { inr, round2 } from '../core/utils';
import { invoiceTotals } from '../core/finance';
import { cx, Input, Select, MicButton, IconBtn, Badge } from './ui';
import { DeptBadge, DeptIcon, deptOf } from './dept';

export const MOD_TABS = [
  { id: 'all', label: 'All' }, { id: 'Ultrasound', label: 'USG / Sonography' }, { id: 'Pathology', label: 'Pathology' },
  { id: 'Biochemistry', label: 'Biochemistry' }, { id: 'lab', label: 'Lab' }, { id: 'X-Ray', label: 'X-Ray' }, { id: 'ECG', label: 'ECG' },
  { id: 'Echo', label: 'Echo' }, { id: 'frequent', label: '★ Frequent' }
];

export function rateOf(t, field) { return Number((t.tariff || {})[field || 'standardRate'] || (t.tariff || {}).standardRate || 0); }
export function testMatches(t, s) {
  if (!s) return true;
  const hay = [t.code, t.name, t.shortName, t.department, t.description, String((t.tariff || {}).standardRate)].join(' ').toLowerCase();
  return s.split(/\s+/).every((w) => hay.includes(w));
}
/** Relevance: short code / code exact > prefix > word start in name > substring > description */
export function testScore(t, s) {
  if (!s) return 0;
  const sn = String(t.shortName || '').toLowerCase();
  const code = String(t.code || '').toLowerCase();
  const name = String(t.name || '').toLowerCase();
  let sc = 0;
  if (sn === s || code === s) sc += 100;
  else if (sn.startsWith(s) || sn.split(/[\s/]+/).some((w) => w === s)) sc += 80;
  if (name.startsWith(s)) sc += 70;
  else if (name.split(/[^a-z0-9]+/).some((w) => w.startsWith(s))) sc += 55;
  else if (name.includes(s)) sc += 35;
  if (code.startsWith(s)) sc += 20;
  if (t.isFrequent) sc += 3;
  return sc;
}

/** Packages from Settings resolved to active tests (by rate-list code). */
export function usePackages(active) {
  const settings = useSettings();
  return useMemo(() => {
    const byCode = {};
    active.forEach((t) => { byCode[t.code] = t; });
    return (settings.packages || []).map((p) => Object.assign({}, p, { tests: (p.codes || []).map((c) => byCode[c]).filter(Boolean) })).filter((p) => p.tests.length > 1);
  }, [settings.packages, active]);
}

/** Test combinations ordered together at least twice in the last 120 days, most common first. */
function useCombos(active) {
  const visits = useColl('visits');
  return useMemo(() => {
    const since = Date.now() - 120 * 86400000;
    const count = new Map();
    visits.forEach((v) => {
      if ((v.createdAt || 0) < since) return;
      const ids = Array.from(new Set((v.tests || []).map((t) => t.testId))).sort();
      if (ids.length < 2 || ids.length > 6) return;
      const k = ids.join('|');
      count.set(k, (count.get(k) || 0) + 1);
    });
    const byId = {};
    active.forEach((t) => { byId[t.id] = t; });
    return Array.from(count.entries()).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])
      .map(([k, n]) => ({ key: k, n, tests: k.split('|').map((id) => byId[id]).filter(Boolean) })).filter((c) => c.tests.length > 1).slice(0, 4);
  }, [visits, active]);
}

export function TestPicker({ items, onChange, rateField = 'standardRate', lockRates, compact, onAdded, autoFocus, hideSelected }) {
  const tests = useColl('tests');
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const qRef = useRef(null);
  const active = useMemo(() => tests.filter((t) => t.isActive !== false), [tests]);
  const selectedIds = new Set(items.map((i) => i.testId));
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return active.filter((t) => {
      if (tab === 'frequent' && !t.isFrequent) return false;
      if (tab === 'lab' && !(t.department === 'Pathology' || t.department === 'Biochemistry')) return false;
      if (!['all', 'frequent', 'lab'].includes(tab) && t.department !== tab) return false;
      return testMatches(t, s);
    }).sort((a, b) => (s ? testScore(b, s) - testScore(a, s) : 0) || a.code.localeCompare(b.code));
  }, [active, tab, q]);
  const frequent = useMemo(() => active.filter((t) => t.isFrequent).slice(0, 18), [active]);
  const packages = usePackages(active);
  const combos = useCombos(active);

  const lineOf = (t) => { const rate = rateOf(t, rateField); return { testId: t.id, code: t.code, name: t.name, department: t.department, rate, amount: rate, isObstetric: !!t.isObstetric }; };
  const add = (t) => {
    if (selectedIds.has(t.id)) { onChange(items.filter((i) => i.testId !== t.id)); return; }
    onChange(items.concat([lineOf(t)]));
    if (onAdded) onAdded(t);
  };
  /** One tap adds a whole package / combination; tapping again when all are in removes them. */
  const addMany = (list) => {
    const missing = list.filter((t) => !selectedIds.has(t.id));
    if (!missing.length) { const ids = new Set(list.map((t) => t.id)); onChange(items.filter((i) => !ids.has(i.testId))); return; }
    onChange(items.concat(missing.map(lineOf)));
    if (onAdded) missing.forEach((t) => onAdded(t));
  };
  const allIn = (list) => list.every((t) => selectedIds.has(t.id));
  const sumOf = (list) => list.reduce((s, t) => s + rateOf(t, rateField), 0);
  const counts = useMemo(() => {
    const c = { all: active.length, frequent: active.filter((t) => t.isFrequent).length, lab: active.filter((t) => t.department === 'Pathology' || t.department === 'Biochemistry').length };
    active.forEach((t) => { c[t.department] = (c[t.department] || 0) + 1; });
    return c;
  }, [active]);

  return (
    <div className="space-y-3">
      <div className="flex gap-1 overflow-x-auto pb-1">
        {MOD_TABS.map((m) => (
          <button key={m.id} type="button" onClick={() => setTab(m.id)} className={cx('chip shrink-0', tab === m.id && 'chip-on')}>
            {deptOf(m.id).hex !== '#64748b' && <DeptIcon dept={m.id} className="h-3.5 w-3.5" />}
            {m.label}<span className="text-[10px] text-muted tnum">{counts[m.id] || 0}</span>
          </button>
        ))}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <Input ref={qRef} autoFocus={autoFocus} aria-label="Investigation search" className="pl-9 pr-10" placeholder="Search test name, short code (W/A, CBC, LFT…), modality — ↑↓ Enter to add"
          value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(list.length - 1, h + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
            else if (e.key === 'Enter' && q && list[hi]) { e.preventDefault(); add(list[hi]); setQ(''); }
          }} />
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2"><MicButton target={qRef} size="sm" title="Voice test search" /></span>
        {q && (
          <div className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-pop">
            {list.slice(0, 40).map((t, i) => (
              <button key={t.id} type="button" onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); add(t); setQ(''); }}
                className={cx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm', i === hi && 'bg-brand-50 dark:bg-brand-950/50')}>
                <DeptBadge dept={t.department} />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{t.name}</span><span className="block truncate text-[11px] text-muted">{t.code} · {t.shortName} · {t.tat}</span></span>
                <span className="font-semibold tnum">{inr(rateOf(t, rateField))}</span>
                {selectedIds.has(t.id) ? <Check className="h-4 w-4 text-emerald-600" /> : <Plus className="h-4 w-4 text-brand-600" />}
              </button>
            ))}
            {!list.length && <div className="px-3 py-3 text-center text-xs text-muted">No investigation found</div>}
          </div>
        )}
      </div>
      {!compact && (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted"><Star className="h-3.5 w-3.5 text-amber-500" />Quick-add frequent tests</div>
          <div className="flex flex-wrap gap-1.5">
            {frequent.map((t) => (
              <button key={t.id} type="button" onClick={() => add(t)} className={cx('chip', selectedIds.has(t.id) && 'chip-on')} title={t.name + ' · ' + inr(rateOf(t, rateField))}>
                <DeptIcon dept={t.department} className="h-3.5 w-3.5" style={{ color: deptOf(t.department).hex }} />{t.shortName || t.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {!compact && (packages.length > 0 || combos.length > 0) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {packages.length > 0 && (
            <div className="min-w-0">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted"><Package className="h-3.5 w-3.5 text-brand-600" />Packages · one tap adds every test</div>
              <div className="flex flex-wrap gap-1.5">
                {packages.map((p) => (
                  <button key={p.id} type="button" onClick={() => addMany(p.tests)} className={cx('chip', allIn(p.tests) && 'chip-on')}
                    title={p.tests.map((t) => t.shortName || t.name).join(' + ') + ' · ' + inr(sumOf(p.tests))}>
                    {p.name}<span className="text-[10px] text-muted tnum">{p.tests.length}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {combos.length > 0 && (
            <div className="min-w-0">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted"><Repeat className="h-3.5 w-3.5 text-teal-600" />Often ordered together</div>
              <div className="flex flex-wrap gap-1.5">
                {combos.map((c) => (
                  <button key={c.key} type="button" onClick={() => addMany(c.tests)} className={cx('chip max-w-full', allIn(c.tests) && 'chip-on')} title={c.n + ' times in the last 4 months · ' + inr(sumOf(c.tests))}>
                    <span className="truncate">{c.tests.map((t) => t.shortName || t.name).join(' + ')}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {!q && tab !== 'all' && !compact && (
        <div className="grid max-h-56 gap-1 overflow-y-auto rounded-xl border border-line p-1.5 sm:grid-cols-2">
          {list.map((t) => (
            <button key={t.id} type="button" onClick={() => add(t)} className={cx('flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-surface2', selectedIds.has(t.id) && 'bg-brand-50 dark:bg-brand-950/40')}>
              <DeptIcon dept={t.department} className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              <span className="text-[12px] font-semibold tnum">{inr(rateOf(t, rateField))}</span>
            </button>
          ))}
        </div>
      )}
      {!hideSelected && <SelectedTests items={items} onChange={onChange} lockRates={lockRates} />}
    </div>
  );
}

export function SelectedTests({ items, onChange, lockRates, empty = 'No investigation added yet — search above or tap a frequent test.' }) {
  const setRate = (i, v) => onChange(items.map((x, k) => (k === i ? Object.assign({}, x, { rate: v === '' ? '' : Number(v), amount: v === '' ? 0 : Number(v) }) : x)));
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <table className="tbl">
        <thead><tr><th className="w-8">#</th><th>Investigation</th><th className="w-28 text-right">Rate (₹)</th><th className="w-10" /></tr></thead>
        <tbody>
          {items.map((x, i) => (
            <tr key={x.testId + i}>
              <td className="text-muted tnum">{i + 1}</td>
              <td>
                <div className="flex items-center gap-2"><DeptBadge dept={x.department} /><span className="font-medium">{x.name}</span></div>
                <div className="mt-0.5 text-[11px] text-muted">{x.code}</div>
              </td>
              <td className="text-right">
                {lockRates
                  ? <span className="inline-flex items-center gap-1 font-semibold tnum" title="Rate locked (CGHS rate)"><Lock className="h-3 w-3 text-amber-600" />{inr(x.rate)}</span>
                  : <input type="number" min="0" aria-label={'Rate for ' + x.name} className="input input-sm w-24 text-right tnum" value={x.rate} onChange={(e) => setRate(i, e.target.value)} />}
              </td>
              <td><IconBtn icon={Trash2} size="sm" tone="danger" title="Remove" onClick={() => onChange(items.filter((_, k) => k !== i))} /></td>
            </tr>
          ))}
          {!items.length && <tr><td colSpan={4} className="py-6 text-center text-xs text-muted">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function TotalsBlock({ items, discountType, discountValue, discountReason, onChange, children, title = 'Bill summary', taxRate, taxLabel = 'GST', billingType }) {
  const canDiscount = can('billing:modify_discounts_refunds');
  const t = invoiceTotals({ items, discountType, discountValue, taxRate, billingType });
  return (
    <div className="rounded-xl border border-line bg-surface2/50 p-3">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">{title}</div>
      <div className="flex items-center justify-between py-1 text-sm"><span>Gross total ({items.length} test{items.length === 1 ? '' : 's'})</span><span className="font-semibold tnum">{inr(t.gross, { decimals: 2 })}</span></div>
      <div className="flex flex-wrap items-center gap-2 py-1.5">
        <span className="text-sm">Concession</span>
        {!canDiscount && <Badge tone="amber" icon={Lock}>needs billing:modify_discounts_refunds</Badge>}
        <div className="ml-auto flex items-center gap-1.5">
          <Select size="sm" className="w-[4.5rem]" disabled={!canDiscount} value={discountType} onChange={(e) => onChange({ discountType: e.target.value })} options={[{ value: 'flat', label: '₹' }, { value: 'percent', label: '%' }]} />
          <input type="number" min="0" aria-label="Discount value" className="input input-sm w-24 text-right tnum" disabled={!canDiscount} value={discountValue} onChange={(e) => onChange({ discountValue: e.target.value })} />
          <span className="w-24 text-right text-sm font-semibold text-rose-600 tnum">− {inr(t.discountAmount, { decimals: 2 })}</span>
        </div>
      </div>
      {Number(discountValue) > 0 && (
        <input className="input input-sm mb-1.5" placeholder="Discount reason / remarks (e.g. Senior citizen, staff, doctor reference)" disabled={!canDiscount} value={discountReason || ''} onChange={(e) => onChange({ discountReason: e.target.value })} />
      )}
      {taxRate !== undefined && (
        <div className="flex items-center justify-between py-1 text-sm">
          <span>{t.taxRate > 0 ? taxLabel + ' @ ' + t.taxRate + '% on ' + inr(t.taxable, { decimals: 2 }) : <span className="text-muted">{taxLabel}: nil · diagnostic services exempt</span>}</span>
          <span className="font-semibold tnum">{t.taxRate > 0 ? '+ ' + inr(t.taxAmount, { decimals: 2 }) : '—'}</span>
        </div>
      )}
      <div className="mt-1 flex items-center justify-between border-t border-line pt-2">
        <span className="font-display text-sm font-bold">Net payable</span>
        <span className="font-display text-xl font-extrabold text-brand-700 tnum dark:text-brand-300">{inr(round2(t.net), { decimals: 2 })}</span>
      </div>
      {children}
    </div>
  );
}
