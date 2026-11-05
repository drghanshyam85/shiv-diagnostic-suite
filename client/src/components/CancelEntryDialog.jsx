// Cancel an entry when the patient does not go ahead with the tests: the visit with its bill, lab worklist
// entry, report drafts and Form F draft (or a bill made without a visit) leaves the queue, the TV, the
// worklists and the cash book in one step, with a reason, an Undo in the message and the audit trail.
// The patient record stays; for a patient with nothing else on file it can be removed at the same time.
import { useEffect, useState } from 'react';
import { XCircle, ShieldAlert, TriangleAlert, Ticket, Receipt, Microscope, ScanLine, ClipboardList, Paperclip, Send, UserRound } from 'lucide-react';
import { fullName, fmtDate, inr } from '../core/utils';
import { entryImpact, cancelEntry, restoreEntry, deletePatient, restorePatient, canDeskDelete } from '../core/patientRecords';
import { CANCEL_REASONS, MIN_REASON } from '../../../shared/patient-records';
import { cx, Modal, Button, Badge, Input, Field, Checkbox, toast } from './ui';

const ROWS = [
  { coll: 'visits', icon: Ticket, one: 'visit & tokens', many: 'visits' },
  { coll: 'invoices', icon: Receipt, one: 'bill', many: 'bills' },
  { coll: 'labReports', icon: Microscope, one: 'lab worklist entry', many: 'lab worklist entries' },
  { coll: 'reports', icon: ScanLine, one: 'report draft', many: 'report drafts' },
  { coll: 'formf', icon: ClipboardList, one: 'Form F draft', many: 'Form F drafts' },
  { coll: 'files', icon: Paperclip, one: 'file / image', many: 'files & images' },
  { coll: 'dispatchLog', icon: Send, one: 'message log entry', many: 'message log entries' }
];

/** entry: { coll: 'visits' | 'invoices', id } or null. */
export function CancelEntryDialog({ entry, onClose, onCancelled }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const [alsoDelete, setAlsoDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = !!entry;

  useEffect(() => {
    if (!entry) return undefined;
    let live = true;
    setInfo(null); setError(''); setReason(CANCEL_REASONS[0]); setAlsoDelete(false); setBusy(false);
    entryImpact(entry.coll, entry.id).then((r) => { if (live) setInfo(r); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [entry && entry.coll, entry && entry.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = info && info.plan;
  const s = plan ? plan.summary : null;
  const access = info && info.access;
  const blocked = !!(plan && (plan.holds.length || !access.allowed));
  const patient = info && info.patient;
  // a patient with nothing else on file may be removed together with the entry
  const offerDelete = !!patient && patient.otherVisits === 0 && canDeskDelete();
  const ready = !!info && !blocked && reason.trim().length >= MIN_REASON && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const r = await cancelEntry(info.root.coll, info.root.id, { reason: reason.trim() });
      const label = (s.token ? 'Entry ' + s.token : s.invoiceNos[0] ? 'Bill ' + s.invoiceNos[0] : 'Entry') + (s.patientName ? ' for ' + s.patientName : '');
      let removed = null;
      if (alsoDelete && patient) {
        try { removed = await deletePatient(patient.id, { reason: reason.trim() }); } catch (e) { toast('Entry cancelled, but the patient record was kept: ' + e.message, 'warning', 8000); }
      }
      const undo = async () => {
        try {
          if (removed) await restorePatient(patient.id);
          await restoreEntry(r.root.coll, r.root.id);
          toast(label + ' restored', 'success');
        } catch (e) { toast('Could not undo: ' + e.message, 'error'); }
      };
      toast(label + ' cancelled' + (removed ? ' and the patient record removed' : '') + (r.money && r.money.collected > 0 ? ' · return ' + inr(r.money.collected) : ''), 'success', 10000, { label: 'Undo', onClick: undo });
      onClose();
      if (onCancelled) onCancelled(r, removed);
    } catch (e) {
      toast(e.message, /cancelled/i.test(e.message) && /password/i.test(e.message) ? 'info' : 'error');
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title="Cancel entry" subtitle="The patient is not going ahead with the tests" icon={XCircle}
      footer={<>
        <Button onClick={onClose} disabled={busy}>Keep entry</Button>
        <Button variant="danger" icon={XCircle} loading={busy} disabled={!ready} onClick={submit}>Cancel entry</Button>
      </>}>
      {error ? <p className="text-sm text-rose-600">{error}</p> : !info ? <p className="text-sm text-muted">Checking the entry…</p> : (
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-xl border border-line bg-surface2/50 p-3 text-[12.5px]">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200"><UserRound className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold">{s.patientName || (patient && fullName(patient)) || 'Patient'}</span>{(s.regId || (patient && patient.regId)) && <Badge tone="brand">{s.regId || patient.regId}</Badge>}{s.token && <Badge tone="slate" icon={Ticket}>{s.token}</Badge>}</div>
              <div className="text-muted">{s.tests.join(', ') || 'No tests'}</div>
              <div className="text-muted">{s.dateKey ? fmtDate(s.dateKey) : ''}{s.invoiceNos.length ? ' · bill ' + s.invoiceNos.join(', ') + ' · ' + inr(plan.money.billed) + (plan.money.collected ? ' · paid ' + inr(plan.money.collected) : ' · not paid') : ' · not billed yet'}</div>
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">Cancelled together</div>
            <ul className="flex flex-wrap gap-1.5">
              {ROWS.filter((r) => plan.counts[r.coll]).map((r) => (
                <li key={r.coll} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-[12px]"><r.icon className="h-3.5 w-3.5 text-muted" /><b className="tnum">{plan.counts[r.coll]}</b>{plan.counts[r.coll] === 1 ? r.one : r.many}</li>
              ))}
            </ul>
          </div>

          {plan.holds.length > 0 && (
            <div role="alert" className="space-y-1 rounded-xl border border-rose-300 bg-rose-50 p-3 text-[12.5px] text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
              <div className="flex items-center gap-1.5 font-bold"><ShieldAlert className="h-4 w-4" />This entry cannot be cancelled</div>
              {plan.holds.map((h) => <div key={h.code + (h.id || '')}>{h.text}</div>)}
            </div>
          )}
          {!plan.holds.length && !access.allowed && (
            <div role="alert" className="flex items-start gap-1.5 rounded-xl border border-rose-300 bg-rose-50 p-3 text-[12.5px] text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{access.why}</span></div>
          )}
          {!blocked && plan.warnings.length > 0 && (
            <div className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              <div className="flex items-center gap-1.5 font-bold"><TriangleAlert className="h-4 w-4" />Before cancelling</div>
              <ul className="list-disc space-y-0.5 pl-5">{plan.warnings.map((w) => <li key={w.code}>{w.text}</li>)}</ul>
            </div>
          )}

          {!blocked && (
            <>
              <Field label="Reason" required hint="Kept in the audit trail">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for cancelling" maxLength={300} />
              </Field>
              <div className="-mt-1 flex flex-wrap gap-1">
                {CANCEL_REASONS.map((r) => <button key={r} type="button" className={cx('chip px-2 py-0.5 text-[11px]', reason === r && 'border-brand-400 bg-brand-50 dark:bg-brand-950/40')} onClick={() => setReason(r)}>{r}</button>)}
              </div>
              {offerDelete && (
                <Checkbox checked={alsoDelete} onChange={setAlsoDelete} label={'Also remove the patient record (' + (patient.regId || 'new patient') + ') — nothing else is on file for this patient'} />
              )}
              <p className="text-[11.5px] text-muted">The patient record stays{offerDelete ? ' unless you tick the box above' : ''}. A cancelled entry can be restored with Undo, or by the administrator from the recycle bin.</p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
