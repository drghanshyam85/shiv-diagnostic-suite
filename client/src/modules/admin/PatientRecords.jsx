// Admin Console → Patient records: find a patient and delete the record (with everything linked to it),
// and the recycle bin, where deleted patients can be restored or deleted permanently.
// Permission patient:delete_records — Read: see the recycle bin · Draft: delete & restore · Full: also delete permanently.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Trash2, ArchiveRestore, History, UserX, ShieldAlert, Info, ScrollText, RefreshCw, UserRound, Phone, XCircle } from 'lucide-react';
import { useColl, navigate } from '../../core/hooks';
import { store } from '../../core/store';
import { isServer } from '../../core/sync';
import { fullName, ageSex, fmtDate, fmtDateTime, inr } from '../../core/utils';
import { recycleBin, restorePatient, restoreEntry, purgeEntry, canDeletePatients, canPurgePatients } from '../../core/patientRecords';
import { describeCounts } from '../../../../shared/patient-records';
import { searchPatients } from '../../layout/PatientSearch';
import { cx, Card, Button, Badge, Input, Empty, toast, confirmDialog } from '../../components/ui';
import { DeletePatientDialog, PurgePatientDialog } from '../../components/DeletePatientDialog';
import { PatientHistory } from '../../components/PatientHistory';

export function PatientRecords() {
  const patients = useColl('patients');
  const visits = useColl('visits');
  const [q, setQ] = useState('');
  const [bin, setBin] = useState(null);
  const [loading, setLoading] = useState(false);
  const [del, setDel] = useState(null);
  const [purge, setPurge] = useState(null);
  const [hist, setHist] = useState(null);
  const [restoring, setRestoring] = useState('');
  const mayDelete = canDeletePatients();
  const mayPurge = canPurgePatients();
  const results = useMemo(() => (q.trim().length >= 2 ? searchPatients(patients, visits, q, 8) : []), [patients, visits, q]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setBin(await recycleBin()); } catch (e) { setBin({ entries: [], error: e.message }); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // a deletion or restore on any workstation changes the patient list: refresh the bin (debounced)
  const timer = useRef(null);
  useEffect(() => store.subscribe('patients', () => { clearTimeout(timer.current); timer.current = setTimeout(load, 400); }), [load]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const entryName = (e) => (e.token ? 'entry ' + e.token : e.invoiceNos && e.invoiceNos[0] ? 'bill ' + e.invoiceNos[0] : 'entry') + (e.name ? ' for ' + e.name : '');
  const restore = async (e) => {
    const what = describeCounts(e.counts);
    const isEntry = e.kind === 'entry';
    if (!(await confirmDialog({
      title: 'Restore ' + (isEntry ? entryName(e) : fullName(e) || e.regId) + '?', confirmText: 'Restore',
      message: isEntry ? 'The cancelled ' + (what || 'entry') + ' come back on every screen, the queue and the cash book exactly as they were.' : 'The patient record' + (what ? ' and ' + what : '') + ' come back on every screen and workstation exactly as they were before the deletion.'
    }))) return;
    setRestoring(e.id);
    try {
      if (isEntry) await restoreEntry(e.coll, e.id); else await restorePatient(e.id);
      toast((isEntry ? entryName(e) : fullName(e) + (e.regId ? ' (' + e.regId + ')' : '')) + ' restored', 'success');
      load();
    } catch (err) { toast(err.message, /cancelled/i.test(err.message) ? 'info' : 'error'); } finally { setRestoring(''); }
  };
  const purgeCancelled = async (e) => {
    if (!(await confirmDialog({ title: 'Delete the cancelled ' + entryName(e) + ' permanently?', danger: true, confirmText: 'Delete permanently', message: (describeCounts(e.counts) || 'The entry') + ' will be erased from the clinic database. This cannot be undone. The patient record itself is not affected.' }))) return;
    try { await purgeEntry(e.coll, e.id); toast('Cancelled ' + entryName(e) + ' deleted permanently', 'success'); load(); } catch (err) { toast(err.message, /cancelled/i.test(err.message) ? 'info' : 'error'); }
  };

  const entries = (bin && bin.entries) || [];
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        {mayDelete && (
          <Card title="Delete a patient record" subtitle="Find the patient by name, mobile, Reg. ID or token" icon={UserX}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type at least 2 letters or digits…" className="pl-9" aria-label="Find patient to delete" />
            </div>
            {q.trim().length >= 2 && (
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                {!results.length && <li className="px-3 py-3 text-[12.5px] text-muted">No patient matches “{q.trim()}”.</li>}
                {results.map(({ p }) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface2 text-muted"><UserRound className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><span className="truncate text-[13px] font-semibold">{fullName(p)}</span><span className="text-[11px] text-muted">{ageSex(p)}</span>{p.regId && <Badge tone="brand">{p.regId}</Badge>}</div>
                      <div className="truncate text-[11.5px] text-muted">
                        {p.mobile && <span className="mr-2 inline-flex items-center gap-1"><Phone className="h-3 w-3" />{p.mobile}</span>}
                        {p.visitCount || 0} visit(s){p.lastVisitAt ? ' · last ' + fmtDate(p.lastVisitAt) : ''}{p.address ? ' · ' + p.address : ''}
                      </div>
                    </div>
                    <Button size="sm" icon={History} onClick={() => setHist(p.id)}>Past records</Button>
                    <Button size="sm" variant="danger-ghost" icon={Trash2} onClick={() => setDel(p.id)}>Delete…</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card padded={false} title={'Recycle bin' + (entries.length ? ' · ' + entries.length : '')} subtitle="Deleted patients and cancelled entries, hidden from every screen until restored or deleted permanently" icon={Trash2}
          actions={<Button size="sm" icon={RefreshCw} loading={loading} onClick={load}>Refresh</Button>}>
          {bin && bin.error ? <p className="p-4 text-[13px] text-rose-600">{bin.error}</p>
            : !bin ? <p className="p-4 text-[13px] text-muted">Loading…</p>
              : !entries.length ? <div className="p-4"><Empty icon={Trash2} title="The recycle bin is empty" text="Patients deleted from Registration, the patient history or this page wait here until they are restored or deleted permanently." /></div>
                : (
                  <ul className="divide-y divide-line" aria-label="Recycle bin">
                    {entries.map((e) => (
                      <li key={e.coll + '/' + e.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1 text-[12.5px]">
                          <div className="flex flex-wrap items-center gap-2">
                            {e.kind === 'entry' ? <Badge tone="amber" icon={XCircle}>Entry cancelled</Badge> : <Badge tone="rose" icon={UserX}>Patient deleted</Badge>}
                            <span className="text-[13px] font-semibold">{fullName(e) || '—'}</span>{e.regId && <Badge tone="slate">{e.regId}</Badge>}
                            {e.kind === 'entry' ? e.token && <Badge tone="slate">{e.token}</Badge> : <span className="text-muted">{ageSex(e)}</span>}
                          </div>
                          {e.kind === 'entry' && <div className="text-muted">{[e.tests && e.tests.join(', '), e.invoiceNos && e.invoiceNos.length ? 'bill ' + e.invoiceNos.join(', ') + ' · ' + inr(e.net) : 'not billed'].filter(Boolean).join(' · ')}</div>}
                          <div className="text-muted">{e.kind === 'entry' ? 'Cancelled' : 'Deleted'} {fmtDateTime(e.deletedAt)}{e.deletedByName ? ' by ' + e.deletedByName : ''}{e.kind === 'patient' && e.mode === 'desk' ? ' (front desk — nothing had been done yet)' : ''}</div>
                          {e.reason && <div className="mt-0.5"><span className="text-muted">Reason:</span> {e.reason}</div>}
                          <div className="mt-0.5 text-muted">{describeCounts(e.counts) || 'Patient record only'}{e.money && e.money.collected ? ' · ' + inr(e.money.collected) + (e.kind === 'entry' ? ' returned to the patient' : ' collected') : ''}{e.signed && (e.signed.reports + e.signed.labReports) ? ' · ' + (e.signed.reports + e.signed.labReports) + ' signed report(s)' : ''}</div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-1.5">
                          {(bin.canDelete !== undefined ? bin.canDelete : mayDelete) && <Button size="sm" icon={ArchiveRestore} loading={restoring === e.id} onClick={() => restore(e)}>Restore</Button>}
                          {(bin.canPurge !== undefined ? bin.canPurge : mayPurge) && <Button size="sm" variant="danger-ghost" icon={Trash2} onClick={() => (e.kind === 'entry' ? purgeCancelled(e) : setPurge(e))}>Delete permanently</Button>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
        </Card>
      </div>

      <aside className="space-y-4">
        <Card title="How deletion works" icon={Info}>
          <ul className="space-y-2 text-[12.5px]">
            <li className="flex gap-2"><XCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted" /><span><b>Cancel entry</b> (Registration, Dashboard, Billing Desk, live queue): when a patient does not go ahead with the tests, the visit with its bill, lab entry and drafts is cancelled. The patient record stays. Not possible once a test was done; money collected needs the refund permission.</span></li>
            <li className="flex gap-2"><Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-muted" /><span><b>Delete record</b> moves the patient with every visit, bill, report, lab report, Form F draft, file and dispatch entry to the recycle bin. They disappear from every screen{isServer() ? ' and workstation' : ''} at once. The front desk can do this only while nothing has been done for the patient (no test, no money kept, nothing sent).</span></li>
            <li className="flex gap-2"><ArchiveRestore className="mt-0.5 h-4 w-4 shrink-0 text-muted" /><span><b>Restore</b> brings all of them back exactly as they were.</span></li>
            <li className="flex gap-2"><UserX className="mt-0.5 h-4 w-4 shrink-0 text-muted" /><span><b>Delete permanently</b> erases the patient’s data{isServer() ? ' and stored files from the clinic server' : ' and images from this computer'}. Backups made earlier and reports already sent to the patient are not affected.</span></li>
            <li className="flex gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" /><span>A patient with a <b>finalised PC-PNDT Form F</b> cannot be deleted: Form F records must be kept for at least two years. Unlock a Form F made by mistake (with an audit reason) first.</span></li>
            <li className="flex gap-2"><ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-muted" /><span>Every cancellation, deletion and restore needs a reason{isServer() ? '; deleting a record with history and deleting permanently also ask for your password' : ''}. All of it is written to the <button type="button" className="font-semibold text-brand-700 underline dark:text-brand-300" onClick={() => navigate('/admin', { tab: 'audit' })}>audit trail</button>.</span></li>
          </ul>
          <p className={cx('mt-3 rounded-lg bg-surface2/60 px-2.5 py-2 text-[11.5px] text-muted')}>Who may do this is set in the permission matrix: <span className="font-mono">patient:delete_records</span> — Read: see the recycle bin · Draft: delete records with history & restore · Full: also delete permanently. Cancelling entries follows the front-desk and billing permissions.</p>
        </Card>
      </aside>

      <DeletePatientDialog open={!!del} patientId={del} onClose={() => setDel(null)} onDeleted={() => { setQ(''); load(); }} />
      <PurgePatientDialog entry={purge} onClose={() => setPurge(null)} onDone={load} />
      <PatientHistory open={!!hist} patientId={hist} onClose={() => setHist(null)} />
    </div>
  );
}
