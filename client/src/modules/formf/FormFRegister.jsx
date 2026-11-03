// Form F register: search by patient name / date / Reg. SNo, reopen-edit-reprint in one click,
// JSON / CSV backup, JSON restore and a landscape monthly register sheet for PC-PNDT submission.
import { useMemo, useState } from 'react';
import { BookOpen, Search, Printer, FileJson, FileSpreadsheet, Upload, Trash2, Lock, PencilLine, CalendarRange } from 'lucide-react';
import { useColl, useSettings } from '../../core/hooks';
import { store } from '../../core/store';
import { can, currentUser } from '../../core/auth';
import { fmtDate, monthKey, monthLabel, download, pickFiles, readAsText, escapeHtml as e } from '../../core/utils';
import { formFCsv, gaText, normalizeFormF, logFormF } from '../../core/formf';
import { printHtml } from '../../core/print';
import { cx, Drawer, Input, Segmented, Badge, Button, IconBtn, Empty, toast, confirmDialog } from '../../components/ui';

export function exportFormFJson(records) {
  download('FormF_Register_' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ app: 'ssdc-suite', kind: 'formf-register', exportedAt: new Date().toISOString(), count: records.length, records }, null, 2), 'application/json');
  logFormF('formf:exported', { id: '*', data: {} }, { format: 'json', count: records.length });
}
export function exportFormFCsv(records) {
  download('FormF_Register_' + new Date().toISOString().slice(0, 10) + '.csv', '﻿' + formFCsv(records), 'text/csv;charset=utf-8');
  logFormF('formf:exported', { id: '*', data: {} }, { format: 'csv', count: records.length });
}

function printMonthly(records, mk, settings) {
  const c = settings.clinic;
  const rows = records.filter((r) => (r.data.procedureDate || r.date || '').startsWith(mk)).sort((a, b) => (a.sno || 0) - (b.sno || 0) || String(a.date).localeCompare(String(b.date)));
  if (!rows.length) return toast('No Form F records in ' + monthLabel(mk), 'warning');
  const th = ['Reg. SNo', 'Date', 'Patient (Age) · Regn No', "Husband's / Father's Name", 'Address · Mobile', 'Living children (S / D)', 'Referred by', 'LMP / GA', 'Indications', 'Result (brief)', 'MTP', 'Status'];
  const perPage = 14;
  const pages = [];
  for (let i = 0; i < rows.length; i += perPage) pages.push(rows.slice(i, i + perPage));
  const html = pages.map((chunk, pi) => `<div class="print-page" style="width:297mm;height:210mm;padding:8mm 9mm;font-family:'Times New Roman',Times,serif;font-size:8.6pt;color:#000">
    <div style="text-align:center;line-height:1.25"><div style="font-size:13pt;font-weight:700">${e(c.name.toUpperCase())}</div><div>${e(c.address)}</div>
    <div style="font-weight:700;margin-top:2px">MONTHLY REGISTER OF FORM F (PC &amp; PNDT ACT, 1994) — ${e(monthLabel(mk).toUpperCase())}</div>
    <div>PC-PNDT Reg. No.: ${e(settings.formF.regNoText)} · Sonologist: ${e(settings.formF.doctorText)} · Page ${pi + 1} of ${pages.length}</div></div>
    <table style="width:100%;border-collapse:collapse;margin-top:5px"><tr style="background:#e5e7eb">${th.map((h) => `<th style="border:1px solid #000;padding:2px 3px;text-align:left">${h}</th>`).join('')}</tr>
    ${chunk.map((r) => { const d = r.data; return `<tr>${[
      e(r.snoLabel || '—'), fmtDate(d.procedureDate || r.date), e([d.patientTitle, d.patientName].filter(Boolean).join(' ')) + ' (' + e(d.age) + ' Y)', e(d.husbandName),
      e(d.address) + (d.mobile ? '<br>' + e(d.mobile) : ''), d.livingSons + ' / ' + d.livingDaughters + ' (Total ' + d.totalChildren + ')', e(d.refDoctorName || (d.selfReferral === 'YES' ? 'Self referral' : '—')),
      (d.lmpMode === 'lmp' ? fmtDate(d.lmp) : 'Not known') + '<br>' + e(gaText(d)), e((d.indications || []).slice().sort((a, b) => a - b).join(', ')), e(d.result), e(d.mtp), r.status === 'FINAL' ? 'Final' : 'Draft'
    ].map((v) => `<td style="border:1px solid #000;padding:2px 3px;vertical-align:top">${v}</td>`).join('')}</tr>`; }).join('')}
    </table>
    ${pi === pages.length - 1 ? `<div style="display:flex;justify-content:space-between;margin-top:14mm"><div>Total records: <b>${rows.length}</b> (Final: ${rows.filter((r) => r.status === 'FINAL').length})<br>Date: ${fmtDate(Date.now())}</div><div style="text-align:center">______________________________<br><b>${e(settings.formF.doctorCaps)}</b><br>Signature &amp; Seal</div></div>` : ''}
  </div>`).join('');
  printHtml({ html, widthMm: 297, heightMm: 210, title: 'Form F register ' + mk, audit: { action: 'formf:register_printed', target: 'formf', meta: { month: mk, rows: rows.length } } });
}

export function FormFRegister({ open, onClose, onOpen, onPrint, currentId }) {
  const settings = useSettings();
  const all = useColl('formf');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ALL');
  const [mk, setMk] = useState(monthKey());
  const [monthOnly, setMonthOnly] = useState(false);
  const records = useMemo(() => all.map(normalizeFormF).sort((a, b) => String(b.data.procedureDate || b.date).localeCompare(String(a.data.procedureDate || a.date)) || (b.sno || 0) - (a.sno || 0)), [all]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const sDate = /^\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$/.test(s) ? s.replace(/-/g, '/') : '';
    return records.filter((r) => {
      if (status !== 'ALL' && r.status !== status) return false;
      if (monthOnly && !(r.data.procedureDate || r.date || '').startsWith(mk)) return false;
      if (!s) return true;
      const d = r.data;
      return [d.patientName, d.husbandName, d.mobile, r.snoLabel, r.regnNo, String(r.sno || '')].some((x) => String(x || '').toLowerCase().includes(s))
        || (sDate && fmtDate(d.procedureDate || r.date).startsWith(sDate)) || (d.procedureDate || '').includes(s);
    });
  }, [records, q, status, monthOnly, mk]);
  const canFull = can('pcpndt:manage_form_f_register');
  const isAdmin = (currentUser() || {}).role === 'SUPER_ADMIN_RADIOLOGIST';

  const importJson = async () => {
    const files = await pickFiles({ accept: '.json,application/json' });
    if (!files.length) return;
    try {
      const j = JSON.parse(await readAsText(files[0]));
      const recs = Array.isArray(j) ? j : j.records || [];
      let added = 0;
      let skipped = 0;
      recs.forEach((r) => {
        if (!r || !r.id || !r.data) { skipped++; return; }
        if (store.get('formf', r.id)) { skipped++; return; }
        store.put('formf', normalizeFormF(r));
        added++;
      });
      toast(`Restored ${added} Form F record(s)${skipped ? ' · ' + skipped + ' already present / invalid' : ''}`, added ? 'success' : 'info');
      logFormF('formf:imported', { id: '*', data: {} }, { added, skipped });
    } catch (err) { toast('Not a valid Form F backup: ' + err.message, 'error'); }
  };
  const remove = async (r) => {
    if (!(await confirmDialog({ title: 'Delete Form F ' + (r.snoLabel || ''), message: 'Statutory records should normally be retained for 2 years (Rule 9(6)). Delete this record permanently?', confirmText: 'Delete', danger: true }))) return;
    store.remove('formf', r.id);
    if (r.visitId) { const v = store.get('visits', r.visitId); if (v && v.formFId === r.id) store.patch('visits', v.id, { formFId: null }); }
    toast('Form F record deleted', 'info');
  };

  return (
    <Drawer open={open} onClose={onClose} title="Form F register" subtitle={`${records.length} record(s) · ${records.filter((r) => r.status === 'FINAL').length} final`} icon={BookOpen} width="sm:w-[560px]"
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={FileJson} onClick={() => exportFormFJson(records)} disabled={!records.length}>Backup JSON</Button>
          <Button size="sm" icon={FileSpreadsheet} onClick={() => exportFormFCsv(list)} disabled={!list.length}>Export CSV ({list.length})</Button>
          {canFull && <Button size="sm" icon={Upload} onClick={importJson}>Restore JSON</Button>}
          <Button size="sm" variant="primary" icon={Printer} className="ml-auto" onClick={() => printMonthly(records, mk, settings)}>Monthly register</Button>
        </div>
      }>
      <div className="sticky top-0 z-10 space-y-2 border-b border-line bg-surface p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input autoFocus className="pl-8" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search name, Reg. SNo, Regn No, mobile or date (dd/mm/yyyy)…" aria-label="Search Form F register" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented size="sm" value={status} onChange={setStatus} options={[{ value: 'ALL', label: 'All' }, { value: 'DRAFT', label: 'Drafts' }, { value: 'FINAL', label: 'Final' }]} />
          <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" className="accent-brand-600" checked={monthOnly} onChange={(ev) => setMonthOnly(ev.target.checked)} /><CalendarRange className="h-3.5 w-3.5" />Month</label>
          <Input type="month" size="sm" className="input-sm w-36" value={mk} onChange={(ev) => setMk(ev.target.value)} aria-label="Register month" />
        </div>
      </div>
      <div className="p-2">
        {!list.length && <Empty icon={BookOpen} title="No matching records" text="Saved and finalised Form F records appear here." />}
        {list.slice(0, 400).map((r) => {
          const d = r.data;
          return (
            <div key={r.id} className={cx('mb-1.5 rounded-xl border border-line p-2.5 transition hover:border-brand-300', r.id === currentId && 'border-brand-400 bg-brand-50/50 dark:bg-brand-950/30')}>
              <div className="flex items-start gap-2">
                <div className="min-w-[70px] rounded-lg bg-surface2 px-1.5 py-1 text-center">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-muted">Reg. SNo</div>
                  <div className="font-mono text-[12px] font-bold">{r.snoLabel || '—'}</div>
                </div>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(r)}>
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{[d.patientTitle, d.patientName].filter(Boolean).join(' ') || 'Unnamed'}</span>
                    <Badge tone={r.status === 'FINAL' ? 'emerald' : 'amber'} icon={r.status === 'FINAL' ? Lock : PencilLine}>{r.status === 'FINAL' ? 'Final' : 'Draft'}</Badge>
                  </div>
                  <div className="truncate text-[11.5px] text-muted">{fmtDate(d.procedureDate || r.date)} · {d.age ? d.age + ' Y · ' : ''}{gaText(d) || 'GA —'} · {r.regnNo || 'no Regn No'}</div>
                  <div className="truncate text-[11px] text-muted">W/O {d.husbandName || '—'} · Ref: {d.refDoctorName || (d.selfReferral === 'YES' ? 'Self' : '—')}</div>
                </button>
                <div className="flex shrink-0">
                  <IconBtn icon={Printer} size="sm" title="Print duplex (front + back)" onClick={() => onPrint(r, 'duplex')} />
                  {isAdmin && <IconBtn icon={Trash2} size="sm" tone="danger" title="Delete record" onClick={() => remove(r)} />}
                </div>
              </div>
            </div>
          );
        })}
        {list.length > 400 && <p className="py-2 text-center text-xs text-muted">Showing the first 400 of {list.length} — refine the search.</p>}
      </div>
    </Drawer>
  );
}
