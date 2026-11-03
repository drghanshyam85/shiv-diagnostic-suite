// Dispatch Center: live dispatch dashboard (channel status badges, 1-click resend, search & filters),
// documents (upload · convert · download centre with bulk ZIP), e-mail report importer with smart
// patient matching, auto-send rules (incl. the evening batch), message templates and integrations.
import { useMemo, useState } from 'react';
import {
  Send, RefreshCw, Search, LayoutDashboard, FolderOpen, Inbox, Zap, MessageSquareText, PlugZap, MessageCircle, Smartphone, Mail, MoreHorizontal,
  ExternalLink, Copy, TriangleAlert, Clock, PlayCircle, Trash2, FileText, CheckCheck, Download
} from 'lucide-react';
import { useColl, useEvent, useRoute, navigate } from '../../core/hooks';
import { useNet } from '../../core/sync';
import { dispatchMode } from '../../core/dispatch';
import { can } from '../../core/auth';
import { Card, Button, Badge, Input, Select, Segmented, Tabs, Kpi, Empty, Menu, toast } from '../../components/ui';
import { copyText, dateKey, fmtDate, fmtTime, timeAgo, addDays, toCSV, downloadBlob } from '../../core/utils';
import { logAudit } from '../../core/auth';
import { STATUS_LABEL } from '../../core/share';
import { CH_LABEL, CHANNELS, RESULT_TONE, DELIVERY_LABEL, DELIVERY_TONE, failedChannels, logChannels, logDoc, resendLog, summarize, unsentToday, pendingList, clearPending, runBatch, silentChannels, openSend, lastBatch } from './engine';
import { invoiceFor, docTitle, KIND_LABEL } from './outputs';
import { DocumentsTab } from './DocumentsTab';
import { InboxTab } from './InboxTab';
import { RulesTab } from './RulesTab';
import { TemplatesTab } from './TemplatesTab';

const CH_ICON = { whatsapp: MessageCircle, sms: Smartphone, email: Mail };
const RESULT_LABEL = { sent: 'Sent', opened: 'Opened', blocked: 'Blocked', failed: 'Failed', skipped: 'No number', pending: 'Pending' };
const INV_LABEL = { PAID: ['Paid', 'emerald'], PARTIAL: ['Pending', 'amber'], DUE: ['Pending', 'amber'], CASHLESS: ['Cashless', 'violet'] };
const TABS = [
  { id: 'dashboard', label: 'Live dashboard', icon: LayoutDashboard },
  { id: 'documents', label: 'Documents & downloads', icon: FolderOpen },
  { id: 'inbox', label: 'E-mail importer', icon: Inbox },
  { id: 'rules', label: 'Auto-send rules', icon: Zap },
  { id: 'templates', label: 'Message templates', icon: MessageSquareText },
  { id: 'integrations', label: 'Integrations', icon: PlugZap }
];

export function DispatchCenter() {
  const route = useRoute();
  const tab = TABS.some((t) => t.id === route.query.tab) ? route.query.tab : 'dashboard';
  const setTab = (id) => navigate('/dispatch', { tab: id });
  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-xl font-extrabold tracking-tight sm:text-2xl">Dispatch Center</h1>
          <p className="text-[13px] text-muted">USG · Pathology · Biochemistry reports and invoices to patients over WhatsApp, SMS and e-mail — PDF / Word, secure links, auto-send</p>
        </div>
        <ModeBadges />
      </div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-4" />
      {tab === 'dashboard' && <Dashboard />}
      {tab === 'documents' && <DocumentsTab />}
      {tab === 'inbox' && <InboxTab />}
      {(tab === 'rules' || tab === 'integrations') && <RulesTab section={tab} />}
      {tab === 'templates' && <TemplatesTab />}
    </div>
  );
}

function ModeBadges() {
  const net = useNet();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {CHANNELS.map((c) => {
        const I = CH_ICON[c];
        const api = dispatchMode(c) === 'api';
        return <Badge key={c} tone={api ? 'emerald' : 'slate'} icon={I}>{CH_LABEL[c]}: {api ? 'API (silent)' : 'deep link'}</Badge>;
      })}
      <Badge tone={net.mode === 'server' ? 'brand' : 'amber'}>{net.mode === 'server' ? 'LAN server' : 'Standalone'}</Badge>
    </div>
  );
}

// ---------------------------------------------------------------- live dashboard
const RANGES = { today: 0, d7: 7, d30: 30, all: null };
const isFailed = (e) => e.status === 'failed' || e.status === 'partial' || failedChannels(e).length > 0;
const templateNames = (e) => Object.values(e.templates || {}).filter(Boolean);
const STATUS_FILTERS = [
  { value: 'sent', label: 'Sent' }, { value: 'delivered', label: 'Delivered' }, { value: 'read', label: 'Read by patient' },
  { value: 'awaiting', label: 'Awaiting receipt' }, { value: 'failed', label: 'Failed / partial' }
];
function statusMatch(e, status) {
  if (!status) return true;
  if (status === 'failed') return isFailed(e);
  if (status === 'delivered') return e.deliveryStatus === 'delivered' || e.deliveryStatus === 'read';
  if (status === 'read') return e.deliveryStatus === 'read';
  if (status === 'awaiting') return e.deliveryStatus === 'sent';
  return e.status === status;
}

function Dashboard() {
  const log = useColl('dispatchLog');
  useColl('reports');
  useColl('labReports');
  useColl('invoices');
  const [q, setQ] = useState('');
  const [range, setRange] = useState('d7');
  const [status, setStatus] = useState('');
  const [dept, setDept] = useState('');
  const [chan, setChan] = useState('');
  const [tpl, setTpl] = useState('');
  const [limit, setLimit] = useState(150);
  const [busy, setBusy] = useState('');
  const [, bump] = useState(0);
  useEvent('dispatch:pending', () => bump((x) => x + 1));

  const today = dateKey();
  const since = RANGES[range] === null ? 0 : addDays(new Date(today + 'T00:00:00'), -RANGES[range]).getTime();
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return log.filter((e) => {
      if ((e.at || 0) < since) return false;
      if (!statusMatch(e, status)) return false;
      if (dept && e.department !== dept) return false;
      if (chan && !(chan in logChannels(e))) return false;
      if (tpl && !templateNames(e).includes(tpl)) return false;
      if (s && ![e.patientName, e.patientRegId, e.mobile, e.email, e.title, e.department, e.byName, templateNames(e).join(' ')].join(' ').toLowerCase().includes(s)) return false;
      return true;
    }).sort((a, b) => (b.at || 0) - (a.at || 0));
  }, [log, q, since, status, dept, chan, tpl]);

  const todayRows = log.filter((e) => dateKey(e.at || 0) === today);
  const failedToday = todayRows.filter(isFailed).length;
  const tracked = todayRows.filter((e) => e.deliveryStatus);
  const deliveredToday = tracked.filter((e) => e.deliveryStatus === 'delivered' || e.deliveryStatus === 'read').length;
  const readToday = tracked.filter((e) => e.deliveryStatus === 'read').length;
  const templates = Array.from(new Set(log.flatMap(templateNames))).sort();
  const exportLog = () => {
    const csv = toCSV(rows, [
      { label: 'Date', get: (e) => fmtDate(e.at) }, { label: 'Time', get: (e) => fmtTime(e.at) }, { key: 'patientName', label: 'Patient' }, { key: 'patientRegId', label: 'Patient ID' },
      { key: 'mobile', label: 'Mobile' }, { key: 'email', label: 'E-mail' }, { key: 'department', label: 'Department' }, { key: 'docType', label: 'Document' },
      { label: 'Template(s)', get: (e) => Object.entries(e.templates || {}).map(([c, t]) => CH_LABEL[c] + ': ' + t).join(' | ') },
      { label: 'Send result', get: (e) => summarize(logChannels(e)) },
      { label: 'Delivery', get: (e) => Object.entries(e.delivery || {}).map(([c, d]) => CH_LABEL[c] + ': ' + (DELIVERY_LABEL[d.status] || d.status) + (d.at ? ' ' + fmtTime(d.at) : '') + (d.error ? ' (' + d.error + ')' : '')).join(' | ') },
      { label: 'Errors', get: (e) => Object.entries(e.errors || {}).map(([c, m]) => CH_LABEL[c] + ': ' + m).join(' | ') },
      { key: 'trigger', label: 'Trigger' }, { key: 'byName', label: 'Sent by' }, { label: 'Resent', get: (e) => (e.resentAt ? fmtDate(e.resentAt) + ' ' + fmtTime(e.resentAt) : '') }
    ]);
    downloadBlob('dispatch-log-' + today + (tpl ? '-' + tpl.replace(/[^a-z0-9]+/gi, '-').toLowerCase() : '') + '.csv', new Blob([csv], { type: 'text/csv' }));
    logAudit('dispatch:log_exported', 'dispatchLog', { rows: rows.length, template: tpl || 'all' });
  };
  const ready = unsentToday();
  const pending = pendingList();
  const depts = Array.from(new Set(log.map((e) => e.department).filter(Boolean))).sort();
  const silent = silentChannels();

  const resend = async (e, channels) => {
    setBusy(e.id);
    try { const r = await resendLog(e, channels); toast('Resent · ' + summarize(r.results), r.entry.status === 'failed' ? 'error' : 'success'); } catch (err) { toast('Resend failed: ' + err.message, 'error'); } finally { setBusy(''); }
  };
  const batch = async () => {
    setBusy('batch');
    try { const r = await runBatch({ manual: true }); toast(`Batch: ${r.total} report(s) · ${r.sent} sent silently · ${r.queued} waiting for 1-click send`, 'success', 7000); } catch (err) { toast(err.message, 'error'); } finally { setBusy(''); }
  };
  const lb = lastBatch();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Dispatched today" value={todayRows.length} sub={todayRows.filter((e) => e.status === 'sent').length + ' fully sent'} icon={Send} tone="brand" />
        <Kpi label="Delivered today" value={tracked.length ? deliveredToday + ' / ' + tracked.length : '—'} sub={tracked.length ? readToday + ' read · ' + tracked.filter((e) => e.deliveryStatus === 'sent').length + ' awaiting receipt' : 'Receipts need the WhatsApp API webhook'} icon={CheckCheck} tone="emerald" onClick={() => { setStatus('delivered'); setRange('today'); }} />
        <Kpi label="Failed / partial today" value={failedToday} sub={failedToday ? 'Use 1-click resend below' : 'All good'} icon={TriangleAlert} tone={failedToday ? 'rose' : 'emerald'} onClick={() => { setStatus('failed'); setRange('today'); }} />
        <Kpi label="Signed, not sent (today)" value={ready.length} sub={lb ? 'Last batch ' + fmtTime(lb.at) + ' · ' + lb.sent + ' sent' : 'Evening batch not run yet'} icon={Clock} tone="amber" />
        <Kpi label="Waiting for 1-click send" value={pending.length} sub="Queued by auto-send rules" icon={Zap} tone="violet" />
      </div>

      {(ready.length > 0 || pending.length > 0) && (
        <Card title="Ready to send" subtitle={silent.length ? 'API channels configured — the batch sends silently' : 'Deep-link mode — each send opens WhatsApp / SMS / e-mail for one click'} icon={Clock}
          actions={can('print:dispatch_signed_reports', 'DRAFT') ? <Button size="sm" icon={PlayCircle} loading={busy === 'batch'} onClick={batch}>Run batch now</Button> : null} padded={false}>
          <div className="divide-y divide-line">
            {pending.map((x) => {
              const { doc } = logDoc({ kind: x.kind, ref: x.ref });
              return (
                <ReadyRow key={'p' + x.kind + x.ref} kind={x.kind} doc={doc} title={x.title} note={'Queued by ' + x.trigger + (x.reason ? ' — ' + x.reason : '') + ' · ' + timeAgo(x.at)}
                  onDismiss={() => clearPending(x.kind, x.ref)} />
              );
            })}
            {ready.filter((r) => !pending.some((x) => x.kind === r.kind && x.ref === r.doc.id)).map((r) => (
              <ReadyRow key={'r' + r.kind + r.doc.id} kind={r.kind} doc={r.doc} title={docTitle(r.kind, r.doc)} note={'Signed ' + fmtTime(r.kind === 'lab' ? r.doc.verifiedAt : r.doc.signedAt)} />
            ))}
          </div>
        </Card>
      )}

      <Card padded={false} title="Dispatch log" subtitle={rows.length + ' message(s) · delivery receipts update live'} icon={Send}
        actions={<Button size="sm" icon={Download} onClick={exportLog} disabled={!rows.length}>Export CSV</Button>}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input className="pl-8" size="sm" placeholder="Search name, Patient ID, mobile, e-mail, document…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search dispatch log" />
          </div>
          <Segmented size="sm" value={range} onChange={setRange} options={[{ value: 'today', label: 'Today' }, { value: 'd7', label: '7 days' }, { value: 'd30', label: '30 days' }, { value: 'all', label: 'All' }]} />
          <Select size="sm" className="w-[150px]" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Any status" options={STATUS_FILTERS} aria-label="Status filter" />
          <Select size="sm" className="w-[150px]" value={dept} onChange={(e) => setDept(e.target.value)} placeholder="All departments" options={depts} aria-label="Department filter" />
          <Select size="sm" className="w-[130px]" value={chan} onChange={(e) => setChan(e.target.value)} placeholder="All channels" options={CHANNELS.map((c) => ({ value: c, label: CH_LABEL[c] }))} aria-label="Channel filter" />
          {templates.length > 0 && <Select size="sm" className="w-[210px]" value={tpl} onChange={(e) => setTpl(e.target.value)} placeholder="All templates" options={templates} aria-label="Template filter" />}
        </div>
        {!rows.length ? <Empty icon={Send} title="No dispatches in this view" text="Reports and invoices sent from the workstation, lab, billing desk or this center appear here in real time on every workstation." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface2/60 text-left text-[10.5px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 font-semibold">When</th><th className="px-2 py-2 font-semibold">Patient</th><th className="px-2 py-2 font-semibold">Mobile / e-mail</th>
                  <th className="px-2 py-2 font-semibold">Department</th><th className="px-2 py-2 font-semibold">Document</th><th className="px-2 py-2 font-semibold">Invoice</th>
                  <th className="px-2 py-2 font-semibold">Channels</th><th className="px-2 py-2 font-semibold">By</th><th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((e) => <LogRow key={e.id} e={e} busy={busy === e.id} onResend={resend} />)}
              </tbody>
            </table>
            {rows.length > limit && <div className="p-3 text-center"><Button size="sm" onClick={() => setLimit(limit + 300)}>Show more ({rows.length - limit})</Button></div>}
          </div>
        )}
      </Card>
    </div>
  );
}

function ReadyRow({ kind, doc, title, note, onDismiss }) {
  if (!doc) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2">
      <Badge tone={kind === 'lab' ? 'rose' : kind === 'usg' ? 'cyan' : 'slate'}>{KIND_LABEL[kind]}</Badge>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold">{title}</div>
        <div className="truncate text-[11px] text-muted">{note}</div>
      </div>
      {onDismiss && <Button size="xs" variant="ghost" icon={Trash2} onClick={onDismiss}>Dismiss</Button>}
      <Button size="sm" variant="primary" icon={Send} onClick={() => openSend(kind, doc)}>Send</Button>
    </div>
  );
}

function LogRow({ e, busy, onResend }) {
  const res = logChannels(e);
  const { kind, doc } = logDoc(e);
  const inv = e.invoiceStatus || ((doc && invoiceFor(kind, doc)) || {}).status;
  const invMeta = INV_LABEL[inv];
  const del = e.delivery || {};
  const failed = Object.keys(res).filter((c) => (res[c] !== 'sent' && res[c] !== 'opened') || (del[c] && del[c].status === 'failed'));
  const tpls = Array.from(new Set(templateNames(e)));
  return (
    <tr className="border-b border-line/70 align-top hover:bg-surface2/40">
      <td className="whitespace-nowrap px-3 py-2"><div className="font-medium">{fmtDate(e.at)}</div><div className="text-[11px] text-muted">{fmtTime(e.at)}</div></td>
      <td className="px-2 py-2"><div className="max-w-[180px] truncate font-semibold">{e.patientName || '—'}</div><div className="text-[11px] text-muted">{e.patientRegId || (doc && doc.patient && doc.patient.regId) || ''}</div></td>
      <td className="px-2 py-2"><div className="tnum">{e.mobile || '—'}</div><div className="max-w-[170px] truncate text-[11px] text-muted">{e.email || ''}</div></td>
      <td className="px-2 py-2"><Badge tone={e.department === 'USG' ? 'cyan' : e.department === 'Pathology' ? 'rose' : e.department === 'Biochemistry' ? 'amber' : e.department === 'Invoice' || e.department === 'Billing' ? 'violet' : 'slate'}>{e.department || '—'}</Badge></td>
      <td className="px-2 py-2"><div className="max-w-[200px] truncate">{e.docType || e.kind}{e.sel === 'combined' ? ' + invoice' : ''}</div><div className="text-[11px] text-muted">{e.format || 'PDF'}{e.trigger && e.trigger !== 'manual' ? ' · ' + e.trigger : ''}{e.lang === 'hi' ? ' · हिन्दी' : ''}</div>{tpls.length > 0 && <div className="max-w-[220px] truncate text-[10.5px] text-muted" title={tpls.join(' · ')}><MessageSquareText className="mr-0.5 inline h-3 w-3" />{tpls.join(' · ')}</div>}</td>
      <td className="px-2 py-2">{invMeta ? <Badge tone={invMeta[1]}>{invMeta[0]}</Badge> : <span className="text-muted">—</span>}{inv && !invMeta && <span className="text-[11px]">{STATUS_LABEL[inv] || inv}</span>}</td>
      <td className="px-2 py-2">
        <div className="flex flex-wrap gap-1">
          {Object.entries(res).map(([c, r]) => {
            const I = CH_ICON[c] || Send;
            const d = r === 'sent' && del[c] ? del[c] : null;
            if (d && d.status !== 'sent') {
              return <Badge key={c} tone={DELIVERY_TONE[d.status] || 'slate'} icon={I}><span title={(d.error ? d.error + ' · ' : '') + (DELIVERY_LABEL[d.status] || d.status) + ' ' + fmtTime(d.at)}>{CH_LABEL[c] || c}: {DELIVERY_LABEL[d.status] || d.status}{d.status === 'read' ? ' ✓✓' : d.status === 'delivered' ? ' ✓✓' : ''}</span></Badge>;
            }
            return <Badge key={c} tone={RESULT_TONE[r] || 'slate'} icon={I}><span title={(e.errors && e.errors[c]) || (e.modes && e.modes[c] === 'api' ? 'Sent through the server API' + (e.providerIds && e.providerIds[c] ? ' · waiting for delivery receipt' : '') : 'Opened via deep link')}>{CH_LABEL[c] || c}: {RESULT_LABEL[r] || r}{d ? ' ✓' : ''}</span></Badge>;
          })}
        </div>
        {Object.entries(del).filter(([, d]) => d.status === 'failed' && d.error).map(([c, d]) => <div key={c} className="mt-0.5 max-w-[260px] text-[10.5px] text-rose-600 dark:text-rose-400">{CH_LABEL[c]}: {d.error}</div>)}
        {e.resentAt && <div className="mt-0.5 text-[10.5px] text-muted">resent {timeAgo(e.resentAt)}</div>}
      </td>
      <td className="px-2 py-2 text-[11.5px] text-muted"><div className="max-w-[120px] truncate">{e.byName || '—'}</div></td>
      <td className="whitespace-nowrap px-2 py-2 text-right">
        <Button size="xs" variant={failed.length ? 'primary' : 'secondary'} icon={RefreshCw} loading={busy} onClick={() => onResend(e, failed.length ? failed : Object.keys(res))} disabled={!doc}>{failed.length ? 'Resend' : 'Send again'}</Button>
        <Menu width="w-56" trigger={<button className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface2" title="More"><MoreHorizontal className="h-4 w-4" /></button>} items={[
          { header: 'Resend via' },
          ...CHANNELS.map((c) => ({ label: CH_LABEL[c], icon: CH_ICON[c], onClick: () => onResend(e, [c]), disabled: !doc || (c === 'email' ? !e.email : !e.mobile) })),
          { divider: true },
          { label: 'Open send dialog…', icon: Send, disabled: !doc, onClick: () => openSend(kind, doc, e.sel) },
          { label: 'Open document', icon: FileText, disabled: !doc, onClick: () => (kind === 'usg' ? navigate('/report', { id: doc.id }) : kind === 'lab' ? navigate('/lab', { id: doc.id }) : kind === 'invoice' ? navigate('/billing', { invoice: doc.id }) : navigate('/dispatch', { tab: 'documents', file: doc.id })) },
          { label: 'Copy secure link', icon: Copy, disabled: !e.link, onClick: () => copyText(e.link).then(() => toast('Link copied', 'success')) },
          { label: 'Open secure link', icon: ExternalLink, disabled: !e.link, onClick: () => window.open(e.link, '_blank', 'noopener') }
        ]} />
      </td>
    </tr>
  );
}

