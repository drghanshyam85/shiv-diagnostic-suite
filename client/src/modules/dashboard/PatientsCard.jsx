// Dashboard → Patients: a search bar that can be switched on and off (remembered on this workstation),
// over four lists — today's registrations, the last 7 days, returning patients and the archive (not seen
// for more than 7 days). Click a patient for the full history. Each row has the usual shortcuts plus
// Cancel entry (an open visit of the last 7 days, when the patient does not go ahead with the tests) and
// Delete record (front desk: only while nothing has been done for the patient; administrators: any record).
import { useEffect, useMemo, useRef, useState } from 'react';
import { History, Search, X, XCircle, Trash2, Receipt, ScanLine, Microscope, UserPlus, Users } from 'lucide-react';
import { useColl, useLocalPref, navigate } from '../../core/hooks';
import { can } from '../../core/auth';
import { fullName, ageSex, fmtDate, fmtTime } from '../../core/utils';
import { searchPatients } from '../../layout/PatientSearch';
import { canCancelEntries, canDeskDelete, canDeletePatients, cancellableVisit, patientsWithHistory, paidVisitIds, canRefund, REFUND_HINT } from '../../core/patientRecords';
import { Card, Button, Badge, IconBtn, Segmented, Toggle, Empty, Input } from '../../components/ui';
import { PatientHistory } from '../../components/PatientHistory';
import { CancelEntryDialog } from '../../components/CancelEntryDialog';
import { DeletePatientDialog } from '../../components/DeletePatientDialog';

const DAY = 86400000;
const PAGE = 12;
const SUBTITLE = {
  today: 'Registered today · click a patient for the full history',
  recent: 'Registered or seen in the last 7 days',
  returning: 'Seen before and back within 60 days',
  archive: 'Not seen for more than 7 days'
};
const EMPTY = { today: 'No registrations yet today', recent: 'No patients in the last 7 days', returning: 'No returning patients in the last 60 days', archive: 'No older patients' };
const activity = (p) => Math.max(Number(p.lastVisitAt) || 0, Number(p.createdAt) || 0);
const initials = (p) => String(p.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export function PatientsCard({ today, now, visits, invoices, reports, labs, dispatchLog }) {
  const patients = useColl('patients');
  const [searchOn, setSearchOn] = useLocalPref('dash.patientSearch', true);
  const [view, setView] = useLocalPref('dash.patientView', 'recent');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [hist, setHist] = useState(null);
  const [cancelFor, setCancelFor] = useState(null);
  const [deleteFor, setDeleteFor] = useState(null);
  const inputRef = useRef(null);
  useEffect(() => { setLimit(PAGE); }, [view, q, searchOn]);

  const perm = {
    bill: can('billing:create_invoice', 'READ'), usg: can('usg:create_and_edit_report', 'READ'), lab: can('lab:enter_sample_values', 'READ') || can('lab:verify_and_sign_report', 'READ'),
    reg: can('patient:register_and_edit'), cancel: canCancelEntries(), del: canDeskDelete(), admin: canDeletePatients()
  };
  const latest = useMemo(() => {
    const pick = (list, key, at) => { const m = {}; list.forEach((x) => { const k = x[key]; if (!k) return; if (!m[k] || (x[at] || 0) > (m[k][at] || 0)) m[k] = x; }); return m; };
    return { inv: pick(invoices, 'patientId', 'date'), rep: pick(reports, 'patientId', 'createdAt'), lab: pick(labs, 'patientId', 'createdAt'), visit: pick(visits, 'patientId', 'createdAt') };
  }, [invoices, reports, labs, visits]);
  // front desk may delete only records where nothing has been done yet
  const withHistory = useMemo(() => patientsWithHistory({ visits, invoices, reports, labs, dispatchLog }), [visits, invoices, reports, labs, dispatchLog]);
  const paid = useMemo(() => paidVisitIds(invoices), [invoices]);
  const refund = canRefund();

  const lists = useMemo(() => {
    const byId = Object.fromEntries(patients.map((p) => [p.id, p]));
    const seen = new Set();
    const todays = visits.filter((v) => v.dateKey === today).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .filter((v) => { if (seen.has(v.patientId)) return false; seen.add(v.patientId); return true; })
      .map((v) => byId[v.patientId]).filter(Boolean);
    const since = now - 7 * DAY;
    const sorted = patients.slice().sort((a, b) => activity(b) - activity(a));
    return {
      today: todays,
      recent: sorted.filter((p) => activity(p) >= since),
      returning: sorted.filter((p) => (p.visitCount || 0) >= 2 && (p.lastVisitAt || 0) >= now - 60 * DAY),
      archive: sorted.filter((p) => activity(p) < since)
    };
  }, [patients, visits, today, now]);

  const searching = searchOn && q.trim().length >= 2;
  const results = useMemo(() => (searching ? searchPatients(patients, visits, q, 60).map((r) => r.p) : []), [searching, patients, visits, q]);
  const cur = lists[view] ? view : 'recent';
  const rows = searching ? results : lists[cur];
  const options = [['today', 'Today'], ['recent', 'Last 7 days'], ['returning', 'Returning'], ['archive', 'Archive']].map(([value, label]) => ({ value, label: label + ' · ' + lists[value].length }));

  const toggleSearch = (on) => {
    setSearchOn(on);
    if (on) { setView('recent'); setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 60); } else setQ('');
  };

  return (
    <Card title="Patients" icon={Users} padded={false} subtitle={searching ? 'Search results across all ' + patients.length + ' patients' : SUBTITLE[cur]}
      actions={<Toggle size="sm" checked={!!searchOn} onChange={toggleSearch} label="Patient search" />}>
      <div className="space-y-2 border-b border-line px-4 py-2.5">
        <div className="-mx-1 overflow-x-auto px-1"><Segmented size="sm" value={cur} onChange={(v) => { setView(v); setQ(''); }} options={options} ariaLabel="Patient list" /></div>
        {searchOn && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }}
              placeholder="Search patients — name, mobile, Reg. ID, husband / father or today’s token" aria-label="Search patients" className="pl-9 pr-9" autoComplete="off" />
            {q && <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink" onClick={() => { setQ(''); if (inputRef.current) inputRef.current.focus(); }} aria-label="Clear search"><X className="h-4 w-4" /></button>}
          </div>
        )}
      </div>
      {!rows.length ? <div className="p-4"><Empty icon={Users} title={searching ? 'No patient matches “' + q.trim() + '”' : EMPTY[cur]} /></div> : (
        <ul className="divide-y divide-line" aria-label="Patients">
          {rows.slice(0, limit).map((p) => {
            const n = p.visitCount || 0;
            const v = cur === 'today' && !searching ? visits.filter((x) => x.patientId === p.id && x.dateKey === today).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] : latest.visit[p.id];
            const inv = latest.inv[p.id];
            const rep = latest.rep[p.id];
            const lab = latest.lab[p.id];
            const open = perm.cancel ? cancellableVisit(visits, p.id, now) : null;
            const locked = !perm.admin && withHistory.has(p.id);
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 hover:bg-surface2/50">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setHist(p.id)} title="Open past records">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[12px] font-bold text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">{initials(p)}</span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[13px] font-semibold">{fullName(p)}</span>
                      {n >= 2 ? <Badge tone="violet">Returning · {n} visits</Badge> : n === 0 ? <Badge tone="slate">No visit</Badge> : <Badge tone="emerald">New</Badge>}
                      {open && open.tokens && open.tokens.combined && <Badge tone="amber">{open.tokens.combined}{open.dateKey === today ? '' : ' · ' + fmtDate(open.createdAt)}</Badge>}
                    </span>
                    <span className="block truncate text-[11.5px] text-muted">{[p.regId, ageSex(p), p.mobile].filter(Boolean).join(' · ')}{v ? ' · ' + (v.dateKey === today ? fmtTime(v.createdAt) : fmtDate(v.createdAt)) + ' · ' + (v.tests || []).map((t) => t.name).join(', ') : p.createdAt ? ' · registered ' + fmtDate(p.createdAt) : ''}</span>
                  </span>
                </button>
                <span className="flex shrink-0 flex-wrap items-center gap-1">
                  {inv && perm.bill && <Button size="xs" variant="ghost" icon={Receipt} title={'Bill ' + inv.invoiceNo} onClick={() => navigate('/billing', { invoice: inv.id })}>Bill</Button>}
                  {rep && perm.usg && <Button size="xs" variant="ghost" icon={ScanLine} title="Latest USG report" onClick={() => navigate('/report', { id: rep.id })}>USG</Button>}
                  {lab && perm.lab && <Button size="xs" variant="ghost" icon={Microscope} title="Latest lab report" onClick={() => navigate('/lab', { id: lab.id })}>Lab</Button>}
                  <Button size="xs" icon={History} onClick={() => setHist(p.id)}>History</Button>
                  {perm.reg && (!v || v.dateKey !== today) && <Button size="xs" variant="ghost" icon={UserPlus} title="Register a new visit" onClick={() => navigate('/register', { patient: p.id })}>Visit</Button>}
                  {open && <Button size="xs" variant="danger-ghost" icon={XCircle} disabled={!refund && paid.has(open.id)}
                    title={!refund && paid.has(open.id) ? REFUND_HINT : 'Cancel entry ' + ((open.tokens && open.tokens.combined) || '') + ' — the patient is not going ahead with the tests'} onClick={() => setCancelFor({ coll: 'visits', id: open.id })}>Cancel entry</Button>}
                  {perm.del && <IconBtn icon={Trash2} size="sm" tone="danger" disabled={locked} aria-label={'Delete record of ' + fullName(p)}
                    title={locked ? 'Tests, payments or reports exist — only an administrator can delete this record' : 'Delete record'} onClick={() => setDeleteFor(p.id)} />}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > limit && (
        <div className="border-t border-line px-4 py-2 text-center">
          <Button size="sm" variant="ghost" onClick={() => setLimit((x) => x + PAGE * 2)}>Show more · {rows.length - limit} left</Button>
        </div>
      )}
      <PatientHistory open={!!hist} patientId={hist} onClose={() => setHist(null)} />
      <CancelEntryDialog entry={cancelFor} onClose={() => setCancelFor(null)} />
      <DeletePatientDialog open={!!deleteFor} patientId={deleteFor} onClose={() => setDeleteFor(null)} />
    </Card>
  );
}

