// Central live queue: today's tokens with per-modality status (Waiting → In Scan/Sample → Completed),
// billed flag and quick hand-off buttons.
import { useMemo, useState } from 'react';
import { Receipt, ScanLine, Microscope, Ticket, Megaphone, ClipboardList, XCircle } from 'lucide-react';
import { useColl, navigate, useNow, useSettings } from '../../core/hooks';
import { dateKey, fmtTime } from '../../core/utils';
import { setQueueStatus, QUEUE_STATUS, MODALITY_LABEL, visitOverall, waitInfo, waitTone, fmtWait, callToken, DEPT_NAME, showWaitTimes } from '../../core/clinic';
import { can } from '../../core/auth';
import { cx, Badge, IconBtn, Empty, Menu, toast } from '../../components/ui';
import { CancelEntryDialog } from '../../components/CancelEntryDialog';
import { canCancelEntries, paidVisitIds, canRefund, REFUND_HINT } from '../../core/patientRecords';

const ST_TONE = { Waiting: 'amber', 'In Scan/Sample': 'brand', Completed: 'emerald', Billed: 'violet' };
const MODS = ['ALL', 'USG', 'LAB', 'XRAY', 'ECG', 'ECHO'];

export function useTodayQueue(date = dateKey()) {
  const visits = useColl('visits');
  return useMemo(() => visits.filter((v) => v.dateKey === date).sort((a, b) => a.createdAt - b.createdAt), [visits, date]);
}

const WAIT_CLS = { emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200', amber: 'bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100', rose: 'bg-rose-600 text-white' };

export function QueueList({ date, compact, onPick }) {
  const queue = useTodayQueue(date);
  const now = useNow(30000);
  const showWaits = showWaitTimes(useSettings()); // off by default: token, name and status only
  const [mod, setMod] = useState('ALL');
  const [cancelFor, setCancelFor] = useState(null);
  const mayCancel = canCancelEntries();
  const invoices = useColl('invoices');
  const paid = useMemo(() => (mayCancel && !canRefund() ? paidVisitIds(invoices) : new Set()), [invoices, mayCancel]);
  const list = queue.filter((v) => mod === 'ALL' || (v.tokens && v.tokens[mod]));
  const counts = { ALL: queue.length };
  queue.forEach((v) => Object.keys(v.tokens || {}).forEach((k) => { if (k !== 'combined') counts[k] = (counts[k] || 0) + 1; }));
  const waiting = queue.filter((v) => visitOverall(v) === 'Waiting').length;
  const cycle = (v, m) => {
    const cur = (v.status || {})[m] || 'Waiting';
    const next = QUEUE_STATUS[(QUEUE_STATUS.indexOf(cur) + 1) % QUEUE_STATUS.length];
    setQueueStatus(v.id, m, next);
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap gap-1 border-b border-line px-3 py-2">
        {MODS.filter((m) => m === 'ALL' || counts[m]).map((m) => (
          <button key={m} onClick={() => setMod(m)} className={cx('chip', mod === m && 'chip-on')}>{m === 'ALL' ? 'All' : MODALITY_LABEL[m]}<span className="text-[10px] tnum text-muted">{counts[m] || 0}</span></button>
        ))}
        <span className="ml-auto self-center text-[11px] text-muted">{waiting} waiting</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!list.length && <Empty icon={Ticket} title="Queue is empty" text="Registered patients appear here instantly on every workstation." />}
        {list.map((v) => (
          <div key={v.id} className={cx('mb-2 rounded-xl border border-line bg-surface p-2.5 transition hover:border-brand-300', onPick && 'cursor-pointer')} onClick={() => onPick && onPick(v)}>
            <div className="flex items-start gap-2">
              <span className="inline-flex min-w-[52px] flex-col items-center rounded-lg bg-navy-900 px-1.5 py-1 text-white dark:bg-brand-900">
                <span className="text-[9px] uppercase tracking-wider text-slate-300">Token</span>
                <span className="font-display text-[15px] font-extrabold leading-4 tnum">{(v.tokens && v.tokens.combined) || '—'}</span>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13.5px] font-semibold">{v.patientName || 'Patient'}</span>
                  {v.billed && <Badge tone="violet">Billed</Badge>}
                  {v.priority === 'Emergency' && <Badge tone="rose">STAT</Badge>}
                </div>
                <div className="truncate text-[11px] text-muted">{fmtTime(v.createdAt)} · Ref: {v.referredByName || 'Self'}</div>
                {!compact && <div className="mt-0.5 truncate text-[11px] text-muted">{(v.tests || []).map((t) => t.name).join(', ')}</div>}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {Object.entries(v.tokens || {}).filter(([k]) => k !== 'combined').map(([m, tok]) => {
                const w = waitInfo(v, m, now);
                const st = w.status;
                return (
                  <button key={m} title={'Click to advance status · ' + st + (!showWaits ? '' : w.live ? ' · waiting ' + fmtWait(w.minutes) : ' · waited ' + fmtWait(w.minutes))} onClick={(e) => { e.stopPropagation(); cycle(v, m); }}
                    className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold', st === 'Completed' ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : st === 'Waiting' ? 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' : 'border-brand-300 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300')}>
                    {tok}<span className="font-medium opacity-80">· {st}</span>
                    {showWaits && w.live && <span className={cx('ml-0.5 rounded-full px-1.5 tnum', WAIT_CLS[waitTone(w.minutes)])}>{fmtWait(w.minutes)}</span>}
                  </button>
                );
              })}
              <span className="ml-auto flex">
                <span onClick={(e) => e.stopPropagation()}>
                  <Menu align="right" width="w-64" trigger={<IconBtn icon={Megaphone} size="sm" title="Call token on the waiting-hall display" />}
                    items={Object.entries(v.tokens || {}).map(([m, tok]) => ({ label: 'Call ' + tok + ' · ' + DEPT_NAME[m], icon: Megaphone, onClick: () => { if (callToken(v.id, m)) toast('Calling ' + tok + ' to ' + DEPT_NAME[m], 'success', 2000); } }))} />
                </span>
                {can('billing:create_invoice') && <IconBtn icon={Receipt} size="sm" title="Open in Bill Desk" onClick={(e) => { e.stopPropagation(); navigate('/billing', { visit: v.id }); }} />}
                {v.tokens && v.tokens.USG && can('usg:create_and_edit_report', 'READ') && <IconBtn icon={ScanLine} size="sm" title="Open USG report" onClick={(e) => { e.stopPropagation(); navigate('/report', { visit: v.id }); }} />}
                {v.obstetric && can('pcpndt:manage_form_f_register', 'DRAFT') && <IconBtn icon={ClipboardList} size="sm" title="PC-PNDT Form F" onClick={(e) => { e.stopPropagation(); navigate('/formf', { visit: v.id }); }} />}
                {v.tokens && v.tokens.LAB && (can('lab:enter_sample_values', 'DRAFT') || can('lab:verify_and_sign_report', 'READ')) && <IconBtn icon={Microscope} size="sm" title="Open in Lab" onClick={(e) => { e.stopPropagation(); navigate('/lab', { visit: v.id }); }} />}
                {mayCancel && !Object.values(v.status || {}).includes('Completed') && <IconBtn icon={XCircle} size="sm" tone="danger" disabled={paid.has(v.id)} title={paid.has(v.id) ? REFUND_HINT : 'Cancel entry ' + ((v.tokens && v.tokens.combined) || '') + ' — the patient is not going ahead with the tests'} onClick={(e) => { e.stopPropagation(); setCancelFor({ coll: 'visits', id: v.id }); }} />}
              </span>
            </div>
          </div>
        ))}
      </div>
      <CancelEntryDialog entry={cancelFor} onClose={() => setCancelFor(null)} />
    </div>
  );
}

export { ST_TONE };
