// Delete a patient record (administrators): shows exactly what goes with the patient, blocks the deletion
// while a finalised PC-PNDT Form F must be preserved, warns about signed reports / collected money /
// messages already sent, and asks for a reason and the Reg. ID before moving everything to the recycle
// bin. PurgePatientDialog deletes a recycle-bin entry permanently.
import { useEffect, useState } from 'react';
import { Trash2, ShieldAlert, TriangleAlert, Info, CalendarDays, Receipt, ScanLine, Microscope, ClipboardList, Paperclip, Send, UserRound, ClipboardX } from 'lucide-react';
import { navigate } from '../core/hooks';
import { can } from '../core/auth';
import { fullName, ageSex, guardianLine, fmtDate, fmtDateTime, inr } from '../core/utils';
import { deletionImpact, deletePatient, restorePatient, purgePatient } from '../core/patientRecords';
import { DELETE_REASONS, MIN_REASON, confirmMatches, describeCounts } from '../../../shared/patient-records';
import { cx, Modal, Button, Badge, Input, Field, toast } from './ui';

const ROWS = [
  { coll: 'visits', icon: CalendarDays, one: 'visit', many: 'visits' },
  { coll: 'invoices', icon: Receipt, one: 'bill', many: 'bills' },
  { coll: 'reports', icon: ScanLine, one: 'USG / X-ray report', many: 'USG / X-ray reports' },
  { coll: 'labReports', icon: Microscope, one: 'lab report', many: 'lab reports' },
  { coll: 'formf', icon: ClipboardList, one: 'Form F draft', many: 'Form F drafts' },
  { coll: 'files', icon: Paperclip, one: 'file / image', many: 'files & images' },
  { coll: 'dispatchLog', icon: Send, one: 'dispatch log entry', many: 'dispatch log entries' }
];

function PatientCard({ p }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-surface2/50 p-3">
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"><UserRound className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1 text-[12.5px]">
        <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold">{fullName(p)}</span>{p.regId && <Badge tone="brand">{p.regId}</Badge>}<span className="text-muted">{ageSex(p)}</span></div>
        {guardianLine(p) && <div className="text-muted">{guardianLine(p)}</div>}
        <div className="text-muted">{[p.mobile, p.address].filter(Boolean).join(' · ') || '—'}</div>
        <div className="text-muted">{p.visitCount || 0} visit(s){p.createdAt ? ' · registered ' + fmtDate(p.createdAt) : ''}{p.lastVisitAt ? ' · last visit ' + fmtDate(p.lastVisitAt) : ''}</div>
      </div>
    </div>
  );
}

/** Type-to-confirm box: the Reg. ID (or the name for a record without one). */
function ConfirmBox({ p, value, onChange, onEnter }) {
  const word = p.confirmWord || p.regId || p.name;
  const ok = confirmMatches(p, value);
  return (
    <Field label={<span>Type <code className="rounded bg-surface2 px-1 py-0.5 font-mono text-[12px] normal-case text-ink">{word}</code> to confirm</span>}>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={word} autoComplete="off" spellCheck={false} aria-label="Type the Reg. ID to confirm"
        onKeyDown={(e) => { if (e.key === 'Enter' && ok && onEnter) onEnter(); }} className={cx('font-mono', ok && 'border-emerald-400 focus:border-emerald-500')} />
    </Field>
  );
}

export function DeletePatientDialog({ open, patientId, onClose, onDeleted }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !patientId) return undefined;
    let live = true;
    setInfo(null); setError(''); setReason(''); setTyped(''); setBusy(false);
    deletionImpact(patientId).then((r) => { if (live) setInfo(r); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [open, patientId]);

  const p = info && info.patient;
  const plan = info && info.plan;
  const blocked = !!(plan && plan.holds.length);
  const reasonOk = reason.trim().length >= MIN_REASON;
  const ready = !!p && !blocked && reasonOk && confirmMatches(p, typed) && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const r = await deletePatient(patientId, { reason: reason.trim(), confirm: typed });
      const who = fullName(p) + (p.regId ? ' (' + p.regId + ')' : '');
      toast(who + ' moved to the recycle bin', 'success', 10000, {
        label: 'Undo',
        onClick: () => restorePatient(patientId).then(() => toast(who + ' restored', 'success')).catch((e) => toast('Could not restore: ' + e.message, 'error'))
      });
      onClose();
      if (onDeleted) onDeleted(r);
    } catch (e) {
      if (e.data && e.data.holds) setInfo((x) => (x ? Object.assign({}, x, { plan: Object.assign({}, x.plan, { holds: e.data.holds }) }) : x));
      toast(e.message, /cancelled/i.test(e.message) ? 'info' : 'error');
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title="Delete patient record" subtitle="Moves the patient and every linked record to the recycle bin" icon={Trash2}
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="danger" icon={Trash2} loading={busy} disabled={!ready} onClick={submit}>Move to recycle bin</Button>
      </>}>
      {error ? <p className="text-sm text-rose-600">{error}</p> : !info ? <p className="text-sm text-muted">Checking the patient’s records…</p> : (
        <div className="space-y-3">
          <PatientCard p={p} />

          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">Removed together with the patient</div>
            {plan.total <= 1 ? <p className="text-[12.5px] text-muted">Only the patient record — no visits, bills or reports.</p> : (
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {ROWS.filter((r) => plan.counts[r.coll]).map((r) => {
                  const n = plan.counts[r.coll];
                  const extra = r.coll === 'invoices' ? inr(plan.money.billed) + ' billed' + (plan.money.collected ? ' · ' + inr(plan.money.collected) + ' collected' : '')
                    : r.coll === 'reports' && plan.signed.reports ? plan.signed.reports + ' signed'
                      : r.coll === 'labReports' && plan.signed.labReports ? plan.signed.labReports + ' signed' : '';
                  return (
                    <li key={r.coll} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]">
                      <r.icon className="h-4 w-4 shrink-0 text-muted" /><b className="tnum">{n}</b><span>{n === 1 ? r.one : r.many}</span>
                      {extra && <span className="ml-auto truncate text-[11px] text-muted">{extra}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {blocked && (
            <div role="alert" className="space-y-1.5 rounded-xl border border-rose-300 bg-rose-50 p-3 text-[12.5px] text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
              <div className="flex items-center gap-1.5 font-bold"><ShieldAlert className="h-4 w-4" />Cannot be deleted — legal hold</div>
              {plan.holds.map((h) => (
                <div key={h.code + (h.id || '')} className="flex flex-wrap items-start gap-2">
                  <span className="min-w-0 flex-1">{h.text}</span>
                  {h.code === 'formf_final' && h.id && can('pcpndt:manage_form_f_register', 'READ') && <Button size="xs" icon={ClipboardX} onClick={() => { onClose(); navigate('/formf', { id: h.id }); }}>Open Form F</Button>}
                </div>
              ))}
            </div>
          )}

          {!blocked && plan.warnings.length > 0 && (
            <div className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              <div className="flex items-center gap-1.5 font-bold"><TriangleAlert className="h-4 w-4" />Check before deleting</div>
              <ul className="list-disc space-y-0.5 pl-5">{plan.warnings.map((w) => <li key={w.code}>{w.text}</li>)}</ul>
            </div>
          )}

          {!blocked && (
            <>
              <div className="flex items-start gap-2 rounded-xl bg-surface2/60 p-3 text-[12px] text-muted">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>The records disappear from every screen and workstation and wait in the recycle bin (Admin Console → Patient records), where they can be restored. Deleting them permanently is a separate step. The deletion is written to the audit trail.</span>
              </div>
              <Field label="Reason for deleting" required hint={'Kept in the audit trail · at least ' + MIN_REASON + ' characters'}>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate registration of P-…" aria-label="Reason for deleting" maxLength={500} />
              </Field>
              <div className="-mt-1 flex flex-wrap gap-1">
                {DELETE_REASONS.map((r) => <button key={r} type="button" className={cx('chip px-2 py-0.5 text-[11px]', reason === r && 'border-brand-400 bg-brand-50 dark:bg-brand-950/40')} onClick={() => setReason(r)}>{r}</button>)}
              </div>
              <ConfirmBox p={p} value={typed} onChange={setTyped} onEnter={submit} />
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Permanently delete a recycle-bin entry (Full access). entry: from recycleBin(). */
export function PurgePatientDialog({ entry, onClose, onDone }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTyped(''); setBusy(false); }, [entry]);
  if (!entry) return null;
  const p = Object.assign({ confirmWord: entry.regId || entry.name }, entry);
  const ready = confirmMatches(p, typed) && !busy;
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const r = await purgePatient(entry.id, { confirm: typed });
      toast((entry.regId || fullName(entry)) + ' deleted permanently' + (r.filesRemoved ? ' · ' + r.filesRemoved + ' stored file(s) removed' : ''), 'success');
      onClose();
      if (onDone) onDone(r);
    } catch (e) { toast(e.message, /cancelled/i.test(e.message) ? 'info' : 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={busy ? undefined : onClose} size="sm" title="Delete permanently?" icon={TriangleAlert} subtitle="This cannot be undone"
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="danger" icon={Trash2} loading={busy} disabled={!ready} onClick={submit}>Delete permanently</Button></>}>
      <div className="space-y-3 text-[12.5px]">
        <PatientCard p={Object.assign({}, entry, { visitCount: (entry.counts && entry.counts.visits) || 0 })} />
        <p>
          <b>{describeCounts(entry.counts, { skipPatient: false }) || '1 patient record'}</b> will be erased from the clinic database{entry.counts && entry.counts.files ? ' and the stored files removed from the server' : ''}.
          Nothing can be restored afterwards. Only the audit trail keeps who deleted Reg. ID {entry.regId || '—'} and why.
        </p>
        <p className="text-muted">Deleted on {fmtDateTime(entry.deletedAt)}{entry.deletedByName ? ' by ' + entry.deletedByName : ''}{entry.reason ? ' · “' + entry.reason + '”' : ''}. Backups made earlier and reports already sent to the patient are not affected.</p>
        <ConfirmBox p={p} value={typed} onChange={setTyped} onEnter={submit} />
      </div>
    </Modal>
  );
}
