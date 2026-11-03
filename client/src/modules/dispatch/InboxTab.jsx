// E-mail report importer: pulls report attachments (PDF / Word / RTF / HTML) from the clinic inbox
// over IMAP through the LAN server (Gmail: imap.gmail.com + App Password), or from dropped .eml files
// in standalone mode. The smart parser links each attachment to a patient (mobile, Reg. ID, name),
// detects the department & tests, and the report is forwarded in one click (auto-send rule 3).
import { useMemo, useState } from 'react';
import { Inbox, RefreshCw, Mail, Paperclip, Eye, Send, Link2, UploadCloud, Settings as SettingsIcon, Loader2, CircleCheck, TriangleAlert, Search } from 'lucide-react';
import { useColl, useSettings, navigate } from '../../core/hooks';
import { store, events } from '../../core/store';
import { api, isServer, useNet } from '../../core/sync';
import { can, logAudit } from '../../core/auth';
import { cx, Card, Button, Badge, Input, Select, Empty, toast } from '../../components/ui';
import { fmtDateTime, timeAgo, fullName, uid, pickFiles, readAsText } from '../../core/utils';
import { storeFile } from './outputs';
import { autoDispatch } from './engine';
import { parseFile } from './smartParser';
import { DocPreview, LinkPatientModal, linkFields } from './DocumentsTab';

const STATUS_TONE = { new: 'amber', linked: 'brand', forwarded: 'emerald', ignored: 'slate' };

// ---------------------------------------------------------------- minimal .eml (RFC 822 / MIME) reader
function decodeWords(s) {
  return String(s || '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, cs, enc, txt) => {
    try {
      const bytes = enc.toUpperCase() === 'B' ? Uint8Array.from(atob(txt), (c) => c.charCodeAt(0))
        : Uint8Array.from(txt.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))), (c) => c.charCodeAt(0));
      return new TextDecoder(/utf-?8/i.test(cs) ? 'utf-8' : 'latin1').decode(bytes);
    } catch (e) { return txt; }
  });
}
function splitHeaders(raw) {
  const idx = raw.search(/\r?\n\r?\n/);
  const head = idx < 0 ? raw : raw.slice(0, idx);
  const body = idx < 0 ? '' : raw.slice(idx).replace(/^\r?\n\r?\n/, '');
  const headers = {};
  head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).forEach((line) => {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  });
  return { headers, body };
}
const param = (h, name) => { const m = String(h || '').match(new RegExp(name + '\\*?=\\s*"?([^";]+)"?', 'i')); return m ? decodeWords(decodeURIComponent(m[1].replace(/^utf-8''/i, ''))) : ''; };
function decodeBody(body, enc) {
  enc = String(enc || '').toLowerCase();
  if (enc === 'base64') { const bin = atob(body.replace(/[^A-Za-z0-9+/=]/g, '')); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); }
  if (enc === 'quoted-printable') return Uint8Array.from(body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))), (c) => c.charCodeAt(0) & 255);
  return new TextEncoder().encode(body);
}
function walk(part, out) {
  const { headers, body } = splitHeaders(part);
  const ct = headers['content-type'] || 'text/plain';
  const boundary = param(ct, 'boundary');
  if (/^multipart\//i.test(ct) && boundary) {
    body.split('--' + boundary).slice(1).forEach((p) => { if (!/^--/.test(p)) walk(p.replace(/^\r?\n/, ''), out); });
    return;
  }
  const disp = headers['content-disposition'] || '';
  const filename = param(disp, 'filename') || param(ct, 'name');
  const bytes = decodeBody(body, headers['content-transfer-encoding']);
  if (filename) out.attachments.push({ filename, contentType: ct.split(';')[0].trim(), bytes });
  else if (/^text\/plain/i.test(ct) && !out.text) out.text = new TextDecoder().decode(bytes);
  else if (/^text\/html/i.test(ct) && !out.text) out.text = new TextDecoder().decode(bytes).replace(/<[^>]+>/g, ' ');
}
export function parseEml(raw) {
  const { headers } = splitHeaders(raw);
  const out = { from: decodeWords(headers.from), to: decodeWords(headers.to), subject: decodeWords(headers.subject), date: Date.parse(headers.date) || Date.now(), messageId: headers['message-id'] || '', text: '', attachments: [] };
  walk(raw, out);
  out.attachments = out.attachments.filter((a) => /\.(pdf|docx?|rtf|html?|odt|txt|png|jpe?g)$/i.test(a.filename));
  return out;
}

// ---------------------------------------------------------------- smart link + rule 3
async function smartLink(fileDoc, mail) {
  const parsed = await parseFile(fileDoc, { subject: mail.subject, at: mail.date });
  const best = parsed.candidates[0];
  const sure = best && (best.score >= 100 || (best.score >= 70 && (parsed.candidates.length === 1 || parsed.candidates[1].score < best.score - 30)));
  const cur = store.get('files', fileDoc.id) || fileDoc;
  const next = store.put('files', Object.assign({}, cur, {
    category: parsed.category !== 'Other' ? parsed.category : cur.category || 'Other', testName: parsed.tests.map((t) => t.name).join(', '),
    detected: { mobiles: parsed.contacts.mobiles.slice(0, 3), emails: parsed.contacts.emails.slice(0, 3), candidates: parsed.candidates.map((c) => ({ id: c.patient.id, score: c.score, reasons: c.reasons })) }
  }, sure ? linkFields(best.patient) : {}));
  if (sure) autoDispatch('file', next, 'onEmailImport', { interactive: false });
  return { file: next, sure };
}

export function InboxTab() {
  const settings = useSettings();
  const net = useNet();
  const inbox = useColl('inbox');
  const files = useColl('files');
  const [busy, setBusy] = useState('');
  const [days, setDays] = useState('7');
  const [selId, setSelId] = useState(null);
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState(null);
  const [linking, setLinking] = useState(null);
  const canUse = can('print:dispatch_signed_reports', 'DRAFT');
  const imapReady = !!(net.integrations && net.integrations.imap);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return inbox.filter((m) => !s || [m.from, m.subject, m.text].join(' ').toLowerCase().includes(s)).sort((a, b) => (b.date || 0) - (a.date || 0));
  }, [inbox, q]);
  const sel = selId ? inbox.find((m) => m.id === selId) : list[0];
  const attachmentsOf = (m) => (m ? (m.fileIds || []).map((id) => files.find((f) => f.id === id)).filter(Boolean) : []);

  const afterImport = async (items) => {
    let linked = 0;
    for (const m of items) {
      let any = false;
      for (const f of attachmentsOf(m).length ? attachmentsOf(m) : (m.fileIds || []).map((id) => store.get('files', id)).filter(Boolean)) {
        const r = await smartLink(f, m);
        if (r.sure) { linked++; any = true; }
      }
      if (any) { const cur = store.get('inbox', m.id); if (cur && cur.status === 'new') store.put('inbox', Object.assign({}, cur, { status: 'linked' })); }
    }
    return linked;
  };

  const sync = async () => {
    setBusy('sync');
    try {
      const r = await api('inbox/sync', { method: 'POST', body: { sinceDays: Number(days), max: 60 }, timeout: 180000 });
      (r.items || []).forEach((d) => store.applyRemote('inbox', d));
      await new Promise((res) => setTimeout(res, 600));
      const linked = await afterImport(r.items || []);
      toast(`Inbox synced: ${r.fetched} e-mail(s) with reports · ${r.imported} new · ${linked} attachment(s) matched to patients`, 'success', 7000);
    } catch (e) { toast('Inbox sync failed: ' + e.message, 'error', 8000); } finally { setBusy(''); }
  };

  const importEml = async () => {
    const picked = await pickFiles({ accept: '.eml,message/rfc822', multiple: true });
    if (!picked.length) return;
    setBusy('eml');
    let count = 0;
    let linked = 0;
    try {
      for (const f of picked) {
        const mail = parseEml(await readAsText(f));
        if (!mail.attachments.length) continue;
        const id = 'mail_' + (mail.messageId ? mail.messageId.replace(/[^\w]/g, '').slice(-24) : uid());
        if (store.get('inbox', id)) continue;
        const fileIds = [];
        for (const a of mail.attachments) {
          const doc = await storeFile(new Blob([a.bytes], { type: a.contentType }), a.filename, { source: 'email', category: 'Other', emailFrom: mail.from, emailSubject: mail.subject, inboxId: id });
          fileIds.push(doc.id);
        }
        const m = store.put('inbox', { id, messageId: mail.messageId, from: mail.from, to: mail.to, subject: mail.subject, date: mail.date, text: mail.text.slice(0, 4000), fileIds, status: 'new', source: 'eml' });
        count++;
        linked += await afterImport([m]);
      }
      logAudit('inbox:eml_imported', 'inbox', { count });
      toast(`${count} e-mail(s) imported · ${linked} attachment(s) matched`, 'success');
    } catch (e) { toast('Import failed: ' + e.message, 'error'); } finally { setBusy(''); }
  };

  const forward = (f, m) => events.emit('dispatch:open', {
    kind: 'file', doc: store.get('files', f.id) || f, sel: 'report', trigger: 'inbox',
    onSent: (out) => { if (out.entry.status !== 'failed' && m) { const cur = store.get('inbox', m.id); if (cur) store.put('inbox', Object.assign({}, cur, { status: 'forwarded', forwardedAt: Date.now() })); } }
  });

  return (
    <div className="space-y-4">
      <Card icon={Mail} title="E-mail report importer" subtitle={isServer() ? (imapReady ? 'Connected inbox · reports from reference labs, external pathologists & equipment' : 'Inbox not configured yet') : 'Standalone mode — drop .eml files exported from Gmail / Outlook'}
        actions={<>
          {isServer() && <Select size="sm" className="w-[130px]" value={days} onChange={(e) => setDays(e.target.value)} options={[{ value: '1', label: 'Last 24 h' }, { value: '3', label: 'Last 3 days' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }]} aria-label="Sync window" />}
          {isServer() && <Button size="sm" variant="primary" icon={RefreshCw} loading={busy === 'sync'} disabled={!canUse || !imapReady} onClick={sync}>Sync inbox</Button>}
          <Button size="sm" icon={UploadCloud} loading={busy === 'eml'} disabled={!canUse} onClick={importEml}>Import .eml files</Button>
        </>}>
        <div className="grid gap-3 text-[12.5px] md:grid-cols-3">
          <div className="rounded-xl bg-surface2/70 p-3"><b>1 · Connect</b><p className="mt-1 text-muted">Settings → Integrations → E-mail inbox (IMAP). For <b>{settings.clinic.email || 'Gmail'}</b>: turn on 2-Step Verification, create an <b>App Password</b>, host <span className="font-mono">imap.gmail.com</span> port 993.</p>
            {isServer() && can('settings:manage_clinic_and_integrations') && <Button size="xs" className="mt-2" icon={SettingsIcon} onClick={() => navigate('/settings', { tab: 'integrations' })}>Open settings</Button>}</div>
          <div className="rounded-xl bg-surface2/70 p-3"><b>2 · Smart parser</b><p className="mt-1 text-muted">Each PDF / Word attachment is read; the patient is matched by mobile, Reg. ID or name (subject, file name, text) and the department & tests are detected.</p></div>
          <div className="rounded-xl bg-surface2/70 p-3"><b>3 · Forward</b><p className="mt-1 text-muted">Check the match, then forward in one click over WhatsApp / SMS / e-mail. Rule 3 forwards matched reports automatically{settings.dispatch.rules && settings.dispatch.rules.onEmailImport ? ' (ON)' : ' (off)'}.</p></div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card padded={false} title="Imported e-mails" subtitle={list.length + ' message(s)'} icon={Inbox} className="lg:max-h-[calc(100vh-260px)]" bodyClass="flex min-h-0 flex-col">
          <div className="border-b border-line p-2">
            <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input size="sm" className="pl-8" placeholder="Search sender, subject…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search imported e-mails" /></div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {!list.length && <Empty icon={Inbox} title="No imported e-mails" text={isServer() ? 'Sync the inbox to pull report attachments.' : 'Import .eml files to start.'} />}
            {list.map((m) => (
              <button key={m.id} onClick={() => setSelId(m.id)} className={cx('mb-1.5 w-full rounded-xl border p-2.5 text-left', sel && sel.id === m.id ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/30' : 'border-line hover:border-brand-300')}>
                <div className="flex items-center justify-between gap-2"><span className="truncate text-[12.5px] font-semibold">{m.from || '—'}</span><Badge tone={STATUS_TONE[m.status] || 'slate'}>{m.status || 'new'}</Badge></div>
                <div className="truncate text-[12px]">{m.subject || '(no subject)'}</div>
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted"><Paperclip className="h-3 w-3" />{(m.fileIds || []).length} · {timeAgo(m.date || 0)}</div>
              </button>
            ))}
          </div>
        </Card>
        {!sel ? <Card><Empty icon={Mail} title="Select an e-mail" text="Attachments, the detected patient and forwarding options appear here." /></Card> : (
          <Card title={sel.subject || '(no subject)'} subtitle={'From ' + (sel.from || '—') + ' · ' + fmtDateTime(sel.date)} icon={Mail}
            actions={<Select size="sm" className="w-[130px]" value={sel.status || 'new'} onChange={(e) => store.put('inbox', Object.assign({}, sel, { status: e.target.value }))} options={['new', 'linked', 'forwarded', 'ignored']} aria-label="E-mail status" />}>
            {sel.text && <pre className="mb-3 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-surface2 p-2 font-sans text-[12px] text-muted">{sel.text.trim().slice(0, 1500)}</pre>}
            <div className="space-y-2">
              {attachmentsOf(sel).map((f) => <AttachmentRow key={f.id} f={f} onPreview={() => setPreview({ kind: 'file', doc: f, title: f.name })} onLink={() => setLinking(f)} onForward={() => forward(f, sel)} canUse={canUse} />)}
              {!attachmentsOf(sel).length && <p className="text-[12px] text-muted">Attachments are still syncing from the server…</p>}
            </div>
          </Card>
        )}
      </div>
      {preview && <DocPreview r={preview} settings={settings} onClose={() => setPreview(null)} />}
      {linking && <LinkPatientModal file={linking} onClose={() => setLinking(null)} />}
    </div>
  );
}

function AttachmentRow({ f, onPreview, onLink, onForward, canUse }) {
  const cands = (f.detected && f.detected.candidates) || [];
  const linked = f.patientId ? store.get('patients', f.patientId) : null;
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Paperclip className="h-4 w-4 text-muted" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{f.name}</span>
        <Badge tone="slate">{f.category || 'Other'}</Badge>
        {f.testName && <Badge tone="brand">{f.testName.length > 40 ? f.testName.slice(0, 40) + '…' : f.testName}</Badge>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
        {linked ? <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><CircleCheck className="h-4 w-4" />Linked: <b>{fullName(linked)}</b> · {linked.regId} · {f.mobile || linked.mobile || 'no mobile'}</span>
          : cands.length ? <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"><TriangleAlert className="h-4 w-4" />Possible: {cands.slice(0, 2).map((c) => (store.get('patients', c.id) ? fullName(store.get('patients', c.id)) : c.id) + ' (' + Math.min(99, c.score) + '%)').join(', ')} — confirm</span>
            : <span className="inline-flex items-center gap-1 text-muted"><Loader2 className={cx('h-4 w-4', f.detected ? 'hidden' : 'animate-spin')} />{f.detected ? 'No patient match — link manually' : 'Reading…'}</span>}
        <span className="ml-auto flex gap-1.5">
          <Button size="xs" icon={Eye} onClick={onPreview}>Preview</Button>
          <Button size="xs" icon={Link2} disabled={!canUse} onClick={onLink}>{linked ? 'Change' : 'Link patient'}</Button>
          <Button size="xs" variant="primary" icon={Send} disabled={!canUse} onClick={onForward}>Forward</Button>
        </span>
      </div>
    </div>
  );
}
