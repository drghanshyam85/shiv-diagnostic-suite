// Documents & downloads: every USG report, lab report, invoice and uploaded / e-mailed file in one
// list. Drag-and-drop bulk upload (PDF, Word, RTF, HTML, images) with smart patient matching (auto-send
// rule 1), .docx → PDF conversion, preview, PDF / Word / Google Docs export, send, and bulk ZIP
// download filtered by date range, department and referring doctor.
import { useEffect, useMemo, useRef, useState } from 'react';
import { UploadCloud, Download, FileArchive, Search, Send, Eye, FileDown, FileType2, MoreHorizontal, Trash2, Link2, RefreshCw, FileText, Loader2, X, UserRound, Printer } from 'lucide-react';
import { useColl, useSettings, useRoute } from '../../core/hooks';
import { store } from '../../core/store';
import { can, currentUser, logAudit } from '../../core/auth';
import { isServer } from '../../core/sync';
import { cx, Card, Button, Badge, Input, Select, Segmented, Modal, Empty, Menu, Combobox, Checkbox, Progress, Field, toast, confirmDialog } from '../../components/ui';
import { dateKey, fmtDate, fmtTime, fmtBytes, fullName, addDays, downloadBlob, pickFiles, fileExt, slug } from '../../core/utils';
import { openInGoogleDocs } from '../../core/exporters';
import { fileToHtml } from '../../core/importers';
import { reportToGoogleDocs, printReport } from '../reporting/reportOut';
import { PagesView } from '../reporting/ReportDialogs';
import { labDocumentHtml, renderLabPages, printLab } from '../lab/labPrint';
import { InvoicePages } from '../billing/InvoiceDoc';
import { makeFile, makeZip, storeFile, fileBlob, deleteFile, convertFileToPdf, categoryOf, docTitle, guessMime, CATEGORIES } from './outputs';
import { openSend, autoDispatch } from './engine';
import { parseFile, detectCategory, patientLabel } from './smartParser';

const ACCEPT = '.pdf,.docx,.doc,.rtf,.html,.htm,.txt,.odt,.png,.jpg,.jpeg,.webp';
const DEPT_TONE = { USG: 'cyan', Pathology: 'rose', Biochemistry: 'amber', 'X-Ray': 'indigo', ECG: 'emerald', Invoice: 'violet', Other: 'slate' };
const SOURCE_LABEL = { generated: 'Generated', upload: 'Uploaded', email: 'E-mail', converted: 'Converted' };

function rowsFrom({ reports, labs, invoices, files, doctors }) {
  const docName = (id) => (doctors.find((d) => d.id === id) || {}).name || '';
  const out = [];
  reports.forEach((r) => {
    const d = r.demographics || {};
    out.push({ key: 'usg:' + r.id, kind: 'usg', doc: r, at: r.signedAt || r.updatedAt || r.createdAt || 0, patientName: d.name || '', regId: d.patientId || '', category: categoryOf('usg', r), title: d.modality || 'USG report', doctor: d.refBy || '', status: r.status === 'SIGNED_FINAL' ? 'Signed' : 'Draft', signed: r.status === 'SIGNED_FINAL', source: 'generated', format: 'PDF · DOCX', mobile: '' });
  });
  labs.forEach((r) => {
    if (r.status === 'PENDING') return;
    const p = r.patient || {};
    out.push({ key: 'lab:' + r.id, kind: 'lab', doc: r, at: r.verifiedAt || r.submittedAt || r.updatedAt || r.createdAt || 0, patientName: fullName(p), regId: p.regId || '', category: categoryOf('lab', r), title: (r.tests || []).map((t) => t.name).join(', '), doctor: r.refBy || '', status: r.status === 'SIGNED_FINAL' ? 'Signed' : 'Provisional', signed: r.status === 'SIGNED_FINAL', source: 'generated', format: 'PDF · DOCX' });
  });
  invoices.forEach((i) => {
    if (i.status === 'CANCELLED') return;
    out.push({ key: 'invoice:' + i.id, kind: 'invoice', doc: i, at: i.date || i.createdAt || 0, patientName: fullName(i.patient), regId: (i.patient && i.patient.regId) || '', category: 'Invoice', title: i.invoiceNo + ' · ' + (i.items || []).map((x) => x.name).join(', '), doctor: i.referredByName || docName(i.referredBy), status: i.status, signed: true, source: 'generated', format: 'PDF' });
  });
  const byId = new Map(files.map((f) => [f.id, f]));
  files.forEach((f) => {
    // generated report PDFs, report key-images and temporary import conversions are not patient documents
    if (f.source === 'generated' || f.source === 'import-temp' || f.kind === 'report-image') return;
    const parent = f.parentId && byId.get(f.parentId);
    if (parent && parent.source === 'import-temp') return;
    out.push({ key: 'file:' + f.id, kind: 'file', doc: f, at: f.createdAt || 0, patientName: f.patientName || '', regId: f.patientRegId || '', category: f.category || 'Other', title: f.name, doctor: f.doctorName || '', status: f.patientId ? 'Linked' : 'Unlinked', signed: true, source: f.source === 'email' ? 'email' : f.source === 'converted' ? 'converted' : 'upload', format: fileExt(f.name).toUpperCase(), size: f.size, linked: !!f.patientId });
  });
  return out;
}

export function DocumentsTab() {
  const settings = useSettings();
  const route = useRoute();
  const reports = useColl('reports');
  const labs = useColl('labReports');
  const invoices = useColl('invoices');
  const files = useColl('files');
  const doctors = useColl('doctors');
  const today = dateKey();
  const [from, setFrom] = useState(dateKey(addDays(new Date(), -6)));
  const [to, setTo] = useState(today);
  const [dept, setDept] = useState('');
  const [doctor, setDoctor] = useState('');
  const [source, setSource] = useState('all');
  const [signedOnly, setSignedOnly] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [limit, setLimit] = useState(120);
  const [zipFmt, setZipFmt] = useState('pdf');
  const [zip, setZip] = useState(null);
  const [preview, setPreview] = useState(null);
  const [linking, setLinking] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [drag, setDrag] = useState(false);
  const cancelZip = useRef(false);
  const canWrite = can('print:dispatch_signed_reports', 'DRAFT');

  const all = useMemo(() => rowsFrom({ reports, labs, invoices, files, doctors }), [reports, labs, invoices, files, doctors]);
  const doctorNames = useMemo(() => Array.from(new Set(all.map((r) => r.doctor).filter((d) => d && d !== 'Self'))).sort(), [all]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const a = new Date(from + 'T00:00:00').getTime();
    const b = new Date(to + 'T23:59:59').getTime();
    return all.filter((r) => r.at >= a && r.at <= b && (!dept || r.category === dept) && (!doctor || r.doctor === doctor)
      && (source === 'all' || (source === 'generated' ? r.source === 'generated' : r.source !== 'generated')) && (!signedOnly || r.signed)
      && (!s || [r.patientName, r.regId, r.title, r.doctor, r.category].join(' ').toLowerCase().includes(s)))
      .sort((x, y) => y.at - x.at);
  }, [all, q, from, to, dept, doctor, source, signedOnly]);

  // deep link from the dispatch log: #/dispatch?tab=documents&file=<id>
  useEffect(() => {
    const f = route.query.file && store.get('files', route.query.file);
    if (f) { setFrom(dateKey(f.createdAt || Date.now())); setPreview({ key: 'file:' + f.id, kind: 'file', doc: f, title: f.name }); }
  }, [route.query.file]);

  const toggle = (key) => setSel((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const allOn = rows.length > 0 && rows.every((r) => sel.has(r.key));
  const selected = rows.filter((r) => sel.has(r.key));

  // ---------------------------------------------------------------- upload with smart matching
  const upload = async (list) => {
    if (!canWrite) return toast('Your role cannot upload documents', 'error');
    const arr = Array.from(list || []).filter((f) => f && f.size);
    if (!arr.length) return;
    setUploads(arr.map((f) => ({ name: f.name, state: 'uploading' })));
    let matched = 0;
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      try {
        const cat = detectCategory(f.name).category;
        const u = currentUser();
        const doc = await storeFile(f, f.name, { source: 'upload', category: cat, uploadedBy: u ? u.id : null, uploadedByName: u ? u.name : '' });
        setUploads((x) => x.map((it, j) => (j === i ? Object.assign({}, it, { state: 'reading' }) : it)));
        const parsed = await parseFile(doc);
        const best = parsed.candidates[0];
        const sure = best && (best.score >= 100 || (best.score >= 70 && (parsed.candidates.length === 1 || parsed.candidates[1].score < best.score - 30)));
        let saved = store.get('files', doc.id) || doc;
        saved = store.put('files', Object.assign({}, saved, {
          category: parsed.category !== 'Other' ? parsed.category : saved.category, testName: parsed.tests.map((t) => t.name).join(', '),
          detected: { mobiles: parsed.contacts.mobiles.slice(0, 3), emails: parsed.contacts.emails.slice(0, 3), candidates: parsed.candidates.map((c) => ({ id: c.patient.id, score: c.score, reasons: c.reasons })) }
        }, sure ? linkFields(best.patient) : {}));
        if (sure) {
          matched++;
          autoDispatch('file', saved, 'onUpload', { interactive: false });
        }
        setUploads((x) => x.map((it, j) => (j === i ? Object.assign({}, it, { state: sure ? 'matched' : 'needs link', patient: sure ? fullName(best.patient) : '' }) : it)));
      } catch (e) {
        setUploads((x) => x.map((it, j) => (j === i ? Object.assign({}, it, { state: 'failed', error: e.message }) : it)));
      }
    }
    logAudit('files:uploaded', 'files', { count: arr.length, matched });
    toast(`${arr.length} file(s) uploaded · ${matched} matched to a patient${arr.length - matched ? ' · ' + (arr.length - matched) + ' need linking' : ''}`, 'success', 6000);
    setFrom((f) => (f > today ? today : f));
    setTo(today);
  };

  // ---------------------------------------------------------------- bulk ZIP
  const buildZip = async (list) => {
    if (!list.length) return toast('Nothing selected', 'warning');
    cancelZip.current = false;
    setZip({ done: 0, total: list.length, name: '' });
    const entries = [];
    const failed = [];
    for (let i = 0; i < list.length; i++) {
      if (cancelZip.current) break;
      const r = list[i];
      setZip({ done: i, total: list.length, name: r.patientName || r.title });
      try {
        const f = await makeFile({ kind: r.kind, doc: r.doc, part: r.kind === 'invoice' ? 'invoice' : 'report', format: r.kind === 'file' ? 'original' : zipFmt === 'docx' && r.kind !== 'invoice' ? 'docx' : 'pdf', settings });
        entries.push({ name: `${r.category}/${dateKey(r.at)}/${f.filename}`, blob: f.blob });
      } catch (e) { failed.push(r.title + ': ' + e.message); }
    }
    if (cancelZip.current) { setZip(null); return toast('ZIP cancelled', 'info'); }
    setZip({ done: list.length, total: list.length, name: 'Packing ZIP…' });
    try {
      const blob = await makeZip(entries);
      downloadBlob(`SSDC_Documents_${from}_to_${to}${dept ? '_' + slug(dept) : ''}${doctor ? '_' + slug(doctor) : ''}.zip`, blob);
      logAudit('files:bulk_zip', 'files', { count: entries.length, from, to, dept, doctor });
      toast(`ZIP ready: ${entries.length} file(s)${failed.length ? ' · ' + failed.length + ' skipped' : ''}`, failed.length ? 'warning' : 'success', 6000);
    } catch (e) { toast('ZIP failed: ' + e.message, 'error'); }
    setZip(null);
  };

  return (
    <div className="space-y-4">
      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
        className={cx('flex flex-wrap items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-4 transition', drag ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30' : 'border-line bg-surface')}>
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-950/50"><UploadCloud className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[15px] font-bold">Upload reports — drag & drop or choose files</div>
          <div className="text-[12px] text-muted">PDF, Word (.docx / .doc), RTF, HTML / Google Docs exports, images · bulk multi-file · patient & test detected automatically{settings.dispatch.rules && settings.dispatch.rules.onUpload ? ' · auto-send on match is ON' : ''}</div>
        </div>
        <Button variant="primary" icon={UploadCloud} disabled={!canWrite} onClick={async () => upload(await pickFiles({ accept: ACCEPT, multiple: true }))}>Choose files</Button>
      </div>
      {uploads.length > 0 && (
        <Card padded={false} title="Upload results" icon={UploadCloud} actions={<Button size="xs" variant="ghost" icon={X} onClick={() => setUploads([])}>Clear</Button>}>
          <div className="divide-y divide-line text-[12.5px]">
            {uploads.map((u, i) => (
              <div key={i} className="flex items-center gap-2 px-4 py-1.5">
                {['uploading', 'reading'].includes(u.state) ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" /> : <FileText className="h-3.5 w-3.5 text-muted" />}
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                <Badge tone={u.state === 'matched' ? 'emerald' : u.state === 'failed' ? 'rose' : u.state === 'needs link' ? 'amber' : 'slate'}>{u.state}{u.patient ? ' · ' + u.patient : ''}{u.error ? ' · ' + u.error : ''}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card padded={false} title="Download center" subtitle={`${rows.length} document(s) · ${selected.length} selected`} icon={FileArchive}
        actions={<>
          <Segmented size="sm" value={zipFmt} onChange={setZipFmt} options={[{ value: 'pdf', label: 'PDF' }, { value: 'docx', label: 'Word' }]} />
          <Button size="sm" icon={FileArchive} disabled={!!zip || !selected.length} onClick={() => buildZip(selected)}>ZIP selected ({selected.length})</Button>
          <Button size="sm" variant="primary" icon={Download} disabled={!!zip || !rows.length} onClick={() => buildZip(rows)}>ZIP all filtered ({rows.length})</Button>
        </>}>
        <div className="flex flex-wrap items-end gap-2 border-b border-line p-3">
          <Field label="From" className="w-[150px]"><Input type="date" size="sm" value={from} max={to} onChange={(e) => setFrom(e.target.value || from)} /></Field>
          <Field label="To" className="w-[150px]"><Input type="date" size="sm" value={to} min={from} onChange={(e) => setTo(e.target.value || to)} /></Field>
          <Field label="Department" className="w-[160px]"><Select size="sm" value={dept} onChange={(e) => setDept(e.target.value)} placeholder="All departments" options={CATEGORIES} /></Field>
          <Field label="Referring doctor" className="w-[200px]"><Select size="sm" value={doctor} onChange={(e) => setDoctor(e.target.value)} placeholder="All doctors" options={doctorNames} /></Field>
          <Field label="Source" className="w-auto"><Segmented size="sm" value={source} onChange={setSource} options={[{ value: 'all', label: 'All' }, { value: 'generated', label: 'Generated' }, { value: 'files', label: 'Uploaded / e-mail' }]} /></Field>
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input size="sm" className="pl-8" placeholder="Search patient, ID, test, doctor…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" />
          </div>
          <Checkbox checked={signedOnly} onChange={setSignedOnly} label="Signed / final only" />
        </div>
        {zip && (
          <div className="flex items-center gap-3 border-b border-line bg-brand-50/60 px-4 py-2 text-[12.5px] dark:bg-brand-950/30">
            <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
            <div className="min-w-0 flex-1"><div className="truncate">Preparing {zip.done + 1 > zip.total ? zip.total : zip.done + 1} of {zip.total}: {zip.name}</div><Progress value={zip.done} max={zip.total} className="mt-1" /></div>
            <Button size="xs" onClick={() => { cancelZip.current = true; }}>Cancel</Button>
          </div>
        )}
        {!rows.length ? <Empty icon={FileArchive} title="No documents in this range" text="Change the dates or filters, or upload reports above." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface2/60 text-left text-[10.5px] uppercase tracking-wide text-muted">
                  <th className="w-8 px-3 py-2"><Checkbox checked={allOn} onChange={(v) => setSel(v ? new Set(rows.map((r) => r.key)) : new Set())} /></th>
                  <th className="px-2 py-2 font-semibold">Date</th><th className="px-2 py-2 font-semibold">Patient</th><th className="px-2 py-2 font-semibold">Department</th>
                  <th className="px-2 py-2 font-semibold">Document</th><th className="px-2 py-2 font-semibold">Referred by</th><th className="px-2 py-2 font-semibold">Status</th><th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((r) => (
                  <tr key={r.key} className={cx('border-b border-line/70 hover:bg-surface2/40', sel.has(r.key) && 'bg-brand-50/50 dark:bg-brand-950/20')}>
                    <td className="px-3 py-1.5"><Checkbox checked={sel.has(r.key)} onChange={() => toggle(r.key)} /></td>
                    <td className="whitespace-nowrap px-2 py-1.5"><div>{fmtDate(r.at)}</div><div className="text-[11px] text-muted">{fmtTime(r.at)}</div></td>
                    <td className="px-2 py-1.5"><div className="max-w-[180px] truncate font-semibold">{r.patientName || <span className="font-normal text-amber-700 dark:text-amber-300">Not linked</span>}</div><div className="text-[11px] text-muted">{r.regId}</div></td>
                    <td className="px-2 py-1.5"><Badge tone={DEPT_TONE[r.category] || 'slate'}>{r.category}</Badge></td>
                    <td className="px-2 py-1.5"><div className="max-w-[260px] truncate">{r.title}</div><div className="text-[11px] text-muted">{SOURCE_LABEL[r.source]} · {r.format}{r.size ? ' · ' + fmtBytes(r.size) : ''}{r.doc.storage === 'local' ? ' · this PC' : ''}</div></td>
                    <td className="px-2 py-1.5"><div className="max-w-[150px] truncate text-muted">{r.doctor || '—'}</div></td>
                    <td className="px-2 py-1.5"><Badge tone={r.signed && r.status !== 'Unlinked' ? 'emerald' : 'amber'}>{r.status}</Badge>{r.doc.sent && <Badge tone="emerald" className="ml-1" icon={Send}>Sent</Badge>}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right"><RowActions r={r} settings={settings} canWrite={canWrite} onPreview={() => setPreview(r)} onLink={() => setLinking(r.doc)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > limit && <div className="p-3 text-center"><Button size="sm" onClick={() => setLimit(limit + 300)}>Show more ({rows.length - limit})</Button></div>}
          </div>
        )}
      </Card>
      {preview && <DocPreview r={preview} settings={settings} onClose={() => setPreview(null)} />}
      {linking && <LinkPatientModal file={linking} onClose={() => setLinking(null)} />}
    </div>
  );
}

export function linkFields(p) {
  return { patientId: p.id, patientName: fullName(p), patientRegId: p.regId || '', mobile: p.mobile || '', email: p.email || '' };
}

function RowActions({ r, settings, canWrite, onPreview, onLink }) {
  const [busy, setBusy] = useState(false);
  const dl = async (format) => {
    setBusy(true);
    try {
      const f = await makeFile({ kind: r.kind, doc: r.doc, part: r.kind === 'invoice' ? 'invoice' : 'report', format, settings });
      downloadBlob(f.filename, f.blob);
      logAudit('files:downloaded', (r.kind === 'file' ? 'files/' : r.kind + '/') + r.doc.id, { format });
    } catch (e) { toast('Download failed: ' + e.message, 'error'); } finally { setBusy(false); }
  };
  const toGoogle = async () => {
    try {
      if (r.kind === 'usg') await reportToGoogleDocs(r.doc, settings);
      else if (r.kind === 'lab') await openInGoogleDocs(labDocumentHtml(r.doc, settings).body);
      else if (r.kind === 'file') { const b = await fileBlob(r.doc); await openInGoogleDocs((await fileToHtml(new File([b], r.doc.name, { type: b.type }))).html); }
      toast('Copied — paste into the new Google Doc (Ctrl+V)', 'info', 6000);
    } catch (e) { toast(e.message, 'error'); }
  };
  const convert = async () => {
    setBusy(true);
    try {
      const out = await convertFileToPdf(r.doc, settings);
      if (!out.fileId) await storeFile(out.blob, out.filename, { source: 'converted', parentId: r.doc.id, category: r.doc.category, patientId: r.doc.patientId || '', patientName: r.doc.patientName || '', patientRegId: r.doc.patientRegId || '', mobile: r.doc.mobile || '', email: r.doc.email || '', testName: r.doc.testName || '' });
      toast('Converted to PDF: ' + out.filename, 'success');
    } catch (e) { toast('Conversion failed: ' + e.message, 'error'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: 'Delete this file?', message: r.doc.name + '\n\nThe file is removed from the download center on every workstation.', danger: true, confirmText: 'Delete' }))) return;
    try { await deleteFile(r.doc); toast('File deleted', 'success'); } catch (e) { toast(e.message, 'error'); }
  };
  const print = async () => {
    try {
      if (r.kind === 'usg') await printReport(r.doc, settings);
      else if (r.kind === 'lab') await printLab(r.doc, settings);
    } catch (e) { toast(e.message, 'error'); }
  };
  const isWord = r.kind === 'file' && /^(docx?|rtf|odt|html?|txt)$/.test(fileExt(r.doc.name));
  const items = r.kind === 'file' ? [
    { label: 'Download original', icon: Download, onClick: () => dl('original') },
    isWord && { label: 'Convert to PDF (keep copy)', icon: RefreshCw, onClick: convert, disabled: !canWrite },
    isWord && { label: 'Download as PDF', icon: FileDown, onClick: () => dl('pdf') },
    isWord && { label: 'Open in Google Docs', icon: FileType2, onClick: toGoogle },
    { divider: true },
    { label: r.doc.patientId ? 'Change patient link…' : 'Link to patient…', icon: Link2, onClick: onLink, disabled: !canWrite },
    { label: 'Delete', icon: Trash2, danger: true, onClick: remove, disabled: !canWrite }
  ] : [
    { label: 'Download PDF', icon: FileDown, onClick: () => dl('pdf') },
    r.kind !== 'invoice' && { label: 'Download Word (.docx)', icon: FileType2, onClick: () => dl('docx') },
    r.kind !== 'invoice' && { label: 'Open in Google Docs', icon: FileType2, onClick: toGoogle },
    r.kind !== 'invoice' && { label: 'Print', icon: Printer, onClick: print }
  ];
  return (
    <span className="inline-flex items-center gap-1">
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" />}
      <Button size="xs" icon={Eye} onClick={onPreview}>View</Button>
      <Button size="xs" variant="primary" icon={Send} onClick={() => openSend(r.kind, r.doc)}>Send</Button>
      <Menu width="w-56" trigger={<button className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface2" title="Export & more"><MoreHorizontal className="h-4 w-4" /></button>} items={items.filter(Boolean)} />
    </span>
  );
}

// ---------------------------------------------------------------- preview (side-by-side capable modal)
export function DocPreview({ r, settings, onClose }) {
  const [url, setUrl] = useState('');
  const [html, setHtml] = useState('');
  const [err, setErr] = useState('');
  const doc = r.doc;
  useEffect(() => {
    let alive = true;
    let objUrl = '';
    if (r.kind === 'file') {
      fileBlob(doc).then(async (b) => {
        if (!alive) return;
        const mime = doc.mime || b.type || guessMime(doc.name);
        if (/pdf|^image\//.test(mime)) { objUrl = URL.createObjectURL(new Blob([b], { type: mime })); setUrl(objUrl); }
        else setHtml((await fileToHtml(new File([b], doc.name, { type: b.type }))).html);
      }).catch((e) => alive && setErr(e.message));
    } else if (r.kind === 'lab') setHtml(renderLabPages(doc, settings).html);
    return () => { alive = false; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open size="xl" onClose={onClose} title={docTitle(r.kind, doc) || r.title} subtitle={r.kind === 'file' ? [doc.category, doc.patientName || 'not linked', doc.emailFrom ? 'from ' + doc.emailFrom : ''].filter(Boolean).join(' · ') : r.category} icon={Eye}
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" icon={Send} onClick={() => { onClose(); openSend(r.kind, doc); }}>Send to patient</Button></>}>
      <div className="max-h-[74vh] overflow-auto rounded-xl bg-slate-200/70 p-3 dark:bg-slate-950/60">
        {err && <Empty icon={X} title="Cannot preview" text={err} />}
        {r.kind === 'usg' && <PagesView report={doc} settings={settings} />}
        {r.kind === 'invoice' && <div className="ff-preview mx-auto w-fit origin-top scale-[0.8]"><InvoicePages inv={doc} settings={settings} opts={Object.assign({}, settings.print, { format: 'a4' })} /></div>}
        {r.kind === 'lab' && html && <div className="ff-preview mx-auto w-fit" dangerouslySetInnerHTML={{ __html: html }} />}
        {r.kind === 'file' && url && (/^image\//.test(doc.mime || '') ? <img src={url} alt="" className="mx-auto max-w-full bg-white" /> : <iframe title="PDF preview" src={url} className="h-[70vh] w-full rounded-lg bg-white" />)}
        {r.kind === 'file' && html && <div className="report-content mx-auto max-w-[210mm] bg-white p-8 text-[11pt] text-slate-900" dangerouslySetInnerHTML={{ __html: html }} />}
        {r.kind === 'file' && !url && !html && !err && <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- link a file to a patient
export function LinkPatientModal({ file, onClose, onLinked }) {
  const patients = useColl('patients');
  const [pid, setPid] = useState(file.patientId || '');
  const [cat, setCat] = useState(file.category || 'Other');
  const [test, setTest] = useState(file.testName || '');
  const [mobile, setMobile] = useState(file.mobile || '');
  const [email, setEmail] = useState(file.email || '');
  const [parsed, setParsed] = useState(null);
  useEffect(() => {
    let alive = true;
    parseFile(file, { subject: file.emailSubject }).then((p) => {
      if (!alive) return;
      setParsed(p);
      if (!file.patientId && p.candidates[0]) pickPatient(p.candidates[0].patient.id);
      if ((!file.category || file.category === 'Other') && p.category !== 'Other') setCat(p.category);
      if (!file.testName && p.tests.length) setTest(p.tests.map((t) => t.name).join(', '));
      if (!file.mobile && p.contacts.mobiles[0]) setMobile(p.contacts.mobiles[0]);
    }).catch(() => {});
    return () => { alive = false; };
  }, [file.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickPatient = (id) => {
    setPid(id);
    const p = store.get('patients', id);
    if (p) { if (p.mobile) setMobile(p.mobile); if (p.email) setEmail(p.email); }
  };
  const save = (andSend) => {
    const p = store.get('patients', pid);
    const cur = store.get('files', file.id) || file;
    const next = store.put('files', Object.assign({}, cur, p ? linkFields(p) : { patientId: '', patientName: '', patientRegId: '' }, { category: cat, testName: test, mobile: mobile.replace(/\D/g, '').slice(-10), email: email.trim() }));
    if (cur.inboxId) { const ib = store.get('inbox', cur.inboxId); if (ib) store.put('inbox', Object.assign({}, ib, { status: 'linked', patientId: p ? p.id : '' })); }
    logAudit('files:linked', 'files/' + file.id, { patient: p ? p.regId : '', category: cat });
    toast('Linked to ' + (p ? fullName(p) : 'no patient'), 'success');
    onLinked && onLinked(next);
    onClose();
    if (andSend) openSend('file', next);
  };
  return (
    <Modal open size="md" onClose={onClose} title="Link report to patient" subtitle={file.name} icon={UserRound}
      footer={<><Button onClick={onClose}>Cancel</Button><Button onClick={() => save(false)}>Save link</Button><Button variant="primary" icon={Send} onClick={() => save(true)} disabled={!mobile && !email}>Save & forward</Button></>}>
      {parsed && parsed.candidates.length > 0 && (
        <div className="mb-3">
          <div className="label">Suggested by the smart parser</div>
          <div className="space-y-1">
            {parsed.candidates.map((c) => (
              <button key={c.patient.id} onClick={() => pickPatient(c.patient.id)} className={cx('flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12.5px]', pid === c.patient.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40' : 'border-line hover:border-brand-300')}>
                <span className="min-w-0 flex-1 truncate"><b>{patientLabel(c.patient)}</b><span className="ml-1 text-muted">— {c.reasons.join(', ')}</span></span>
                <Badge tone={c.score >= 100 ? 'emerald' : c.score >= 60 ? 'brand' : 'amber'}>{Math.min(99, c.score)}%</Badge>
              </button>
            ))}
          </div>
        </div>
      )}
      {!parsed && <div className="mb-3 flex items-center gap-2 text-[12px] text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Reading the document…</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Patient" className="sm:col-span-2"><Combobox value={pid} onChange={pickPatient} items={patients} getLabel={(x) => fullName(x)} getSub={(x) => [x.regId, x.mobile].filter(Boolean).join(' · ')} placeholder="Search registered patient…" /></Field>
        <Field label="Department"><Select value={cat} onChange={(e) => setCat(e.target.value)} options={CATEGORIES} /></Field>
        <Field label="Test / investigation"><Input value={test} onChange={(e) => setTest(e.target.value)} /></Field>
        <Field label="Mobile (WhatsApp / SMS)"><Input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="numeric" /></Field>
        <Field label="E-mail"><Input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      </div>
      {parsed && (parsed.contacts.mobiles.length > 0 || parsed.contacts.emails.length > 0) && <p className="mt-2 text-[11.5px] text-muted">Found in document: {parsed.contacts.mobiles.concat(parsed.contacts.emails).join(', ')}</p>}
      {!isServer() && file.storage === 'local' && <p className="mt-2 text-[11px] text-muted">Stored on this workstation (standalone mode).</p>}
    </Modal>
  );
}
