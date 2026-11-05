// A patient's past records in one place: every visit with its bill, USG report, lab report and
// PC-PNDT Form F, each one click away. Opened from the dashboard and the registration banner.
import { useMemo, useState } from 'react';
import { History, Receipt, ScanLine, Microscope, ClipboardList, UserPlus, Phone, MapPin, CalendarDays, Ticket, Trash2, XCircle } from 'lucide-react';
import { useColl, navigate } from '../core/hooks';
import { can } from '../core/auth';
import { fullName, ageSex, guardianLine, fmtDate, fmtTime, inr } from '../core/utils';
import { Drawer, Badge, Button, Empty } from './ui';
import { DeletePatientDialog } from './DeletePatientDialog';
import { CancelEntryDialog } from './CancelEntryDialog';
import { canDeskDelete, canCancelEntries } from '../core/patientRecords';

const REPORT_TONE = { SIGNED_FINAL: 'emerald', DRAFT: 'amber', AMENDING: 'violet', SUBMITTED: 'brand', PENDING: 'slate', SAMPLE_COLLECTED: 'cyan' };
const statusText = (s) => ({ SIGNED_FINAL: 'Signed', DRAFT: 'Draft', AMENDING: 'Amending', SUBMITTED: 'To verify', PENDING: 'Sample due', SAMPLE_COLLECTED: 'Collected', FINAL: 'Final' }[s] || s || '');

/** Every visit of a patient (newest first) with the records that belong to it. */
export function usePatientHistory(patientId) {
  const visits = useColl('visits');
  const invoices = useColl('invoices');
  const reports = useColl('reports');
  const labs = useColl('labReports');
  const formf = useColl('formf');
  return useMemo(() => {
    if (!patientId) return [];
    const mine = visits.filter((v) => v.patientId === patientId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const used = new Set();
    const rows = mine.map((v) => {
      const inv = invoices.find((i) => i.visitId === v.id || (v.invoiceId && i.id === v.invoiceId));
      if (inv) used.add(inv.id);
      return {
        v, inv,
        reps: reports.filter((r) => r.visitId === v.id && !r._deleted),
        lab: labs.find((l) => l.visitId === v.id || (v.labReportId && l.id === v.labReportId)),
        ff: formf.find((f) => f.visitId === v.id)
      };
    });
    // bills made without a registered visit (cash-book quick entry) still belong to the history
    invoices.filter((i) => i.patientId === patientId && !used.has(i.id)).forEach((inv) => rows.push({ v: null, inv, reps: [], lab: null, ff: null, at: inv.date }));
    return rows.sort((a, b) => ((b.v && b.v.createdAt) || b.at || 0) - ((a.v && a.v.createdAt) || a.at || 0));
  }, [patientId, visits, invoices, reports, labs, formf]);
}

export function PatientHistory({ patientId, open, onClose, onDeleted }) {
  const patients = useColl('patients');
  const p = patients.find((x) => x.id === patientId) || null;
  const rows = usePatientHistory(open ? patientId : null);
  const go = (path, query) => { onClose(); navigate(path, query); };
  const perm = { bill: can('billing:create_invoice', 'READ'), usg: can('usg:create_and_edit_report', 'READ'), lab: can('lab:enter_sample_values', 'READ') || can('lab:verify_and_sign_report', 'READ'), formf: can('pcpndt:manage_form_f_register', 'READ'), reg: can('patient:register_and_edit'), del: canDeskDelete(), cancel: canCancelEntries() };
  const [delOpen, setDelOpen] = useState(false);
  const [cancelFor, setCancelFor] = useState(null);
  const weekAgo = Date.now() - 7 * 86400000;
  return (
    <>
    <Drawer open={open} onClose={onClose} title={p ? fullName(p) : 'Patient history'} subtitle={p ? [p.regId, ageSex(p)].filter(Boolean).join(' · ') : ''} icon={History} width="sm:w-[560px]"
      footer={p ? <div className="flex w-full flex-wrap justify-end gap-2">
        {perm.del && <Button variant="danger-ghost" icon={Trash2} className="mr-auto" onClick={() => setDelOpen(true)}>Delete patient…</Button>}
        {perm.reg && <Button variant="primary" icon={UserPlus} onClick={() => go('/register', { patient: p.id })}>Register new visit</Button>}
        {perm.bill && <Button icon={Receipt} onClick={() => go('/billing', { patient: p.id })}>New bill</Button>}
      </div> : null}>
      {!p ? <div className="p-4"><Empty icon={History} title="Patient not found" /></div> : (
        <div className="space-y-3 p-4">
          <div className="grid gap-1 rounded-xl bg-surface2/60 p-3 text-[12.5px]">
            {guardianLine(p) && <div>{guardianLine(p)}</div>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted">
              {p.mobile && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{p.mobile}</span>}
              {p.address && <span className="inline-flex min-w-0 items-center gap-1"><MapPin className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{p.address}</span></span>}
            </div>
            <div className="text-muted">{p.visitCount || rows.length} visit(s){p.createdAt ? ' · first ' + fmtDate(p.createdAt) : ''}{p.lastVisitAt ? ' · last ' + fmtDate(p.lastVisitAt) : ''}</div>
          </div>
          {!rows.length && <Empty icon={CalendarDays} title="No past visits" text="Visits, bills and reports appear here once registered." />}
          <ol className="space-y-2">
            {rows.map((r) => {
              const v = r.v;
              const key = v ? v.id : r.inv.id;
              return (
                <li key={key} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[13px] font-semibold"><CalendarDays className="h-4 w-4 text-brand-600" />{fmtDate(v ? v.createdAt : r.inv.date)} <span className="font-normal text-muted">{fmtTime(v ? v.createdAt : r.inv.date)}</span></span>
                    {v && v.tokens && v.tokens.combined && <Badge tone="slate" icon={Ticket}>{v.tokens.combined}</Badge>}
                    <span className="ml-auto text-[11.5px] text-muted">{v ? 'Ref: ' + (v.referredByName || 'Self') : 'Bill without a registered visit'}</span>
                  </div>
                  <div className="mt-1 text-[12.5px]">{((v ? v.tests : r.inv.items) || []).map((t) => t.name).join(', ') || '—'}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.inv && perm.bill && <Button size="xs" icon={Receipt} onClick={() => go('/billing', { invoice: r.inv.id })}>Bill {r.inv.invoiceNo} · {inr(r.inv.net)}{r.inv.balance > 0 && r.inv.billingType !== 'umid' ? ' · due ' + inr(r.inv.balance) : ''}</Button>}
                    {r.reps.map((rep) => perm.usg && <Button key={rep.id} size="xs" icon={ScanLine} onClick={() => go('/report', { id: rep.id })}>USG report <Badge tone={REPORT_TONE[rep.status] || 'slate'}>{statusText(rep.status)}</Badge></Button>)}
                    {r.lab && perm.lab && <Button size="xs" icon={Microscope} onClick={() => go('/lab', { id: r.lab.id })}>Lab report <Badge tone={REPORT_TONE[r.lab.status] || 'slate'}>{statusText(r.lab.status)}</Badge></Button>}
                    {r.ff && perm.formf && <Button size="xs" icon={ClipboardList} onClick={() => go('/formf', { id: r.ff.id })}>Form F {r.ff.sno ? '#' + r.ff.sno : ''} <Badge tone={r.ff.status === 'FINAL' ? 'emerald' : 'amber'}>{statusText(r.ff.status) || 'Draft'}</Badge></Button>}
                    {v && !r.inv && perm.bill && <Button size="xs" variant="ghost" icon={Receipt} onClick={() => go('/billing', { visit: v.id })}>Make bill</Button>}
                    {perm.cancel && (v ? (v.createdAt || 0) >= weekAgo && !v.closedAt && !Object.values(v.status || {}).includes('Completed') : r.inv && (r.inv.date || 0) >= weekAgo) && (
                      <Button size="xs" variant="danger-ghost" icon={XCircle} title="The patient is not going ahead with the tests" onClick={() => setCancelFor(v ? { coll: 'visits', id: v.id } : { coll: 'invoices', id: r.inv.id })}>Cancel entry</Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Drawer>
    {perm.del && <DeletePatientDialog open={delOpen} patientId={p ? p.id : null} onClose={() => setDelOpen(false)} onDeleted={(r) => { onClose(); if (onDeleted) onDeleted(r); }} />}
    {perm.cancel && <CancelEntryDialog entry={cancelFor} onClose={() => setCancelFor(null)} />}
    </>
  );
}
