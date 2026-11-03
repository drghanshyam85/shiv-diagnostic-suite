// One "Send to patient" dialog for every document: USG report, lab report, invoice or an uploaded /
// imported file. Report only / Invoice only / Combined (one merged PDF or two attachments), PDF or MS
// Word, WhatsApp · SMS · E-mail with silent API sending or deep links, English / Hindi templates,
// secure expiring links and attachments.
import { useEffect, useRef, useState } from 'react';
import { Send, MessageCircle, Smartphone, Mail, Link2, FileDown, Copy, ExternalLink, Loader2, FileText, Receipt, Layers, TriangleAlert, Paperclip } from 'lucide-react';
import { useSettings, useEvent } from '../../core/hooks';
import { isServer, useNet } from '../../core/sync';
import { dispatchMode } from '../../core/dispatch';
import { copyText, downloadBlob, fmtDateTime, fileExt } from '../../core/utils';
import { Modal, Button, Input, Textarea, Field, Segmented, Checkbox, Badge, Tabs, toast } from '../../components/ui';
import { invoiceFor, docTitle, isSigned } from './outputs';
import { CHANNELS, CH_LABEL, attachmentPlan, prepareFiles, prepareLinks, buildMessages, dispatchDocument, summarize, recipientsFor, canDispatch, canSendUnsigned, maybeRunScheduled, clearPending } from './engine';

const CH_ICON = { whatsapp: MessageCircle, sms: Smartphone, email: Mail };
const EMPTY_LINKS = { report: '', invoice: '', files: null, expiresAt: 0 };

export function SendDialog({ open, onClose, kind, doc, sel: initialSel, trigger, onSent }) {
  const settings = useSettings();
  useNet();
  const [sel, setSel] = useState('report');
  const [combine, setCombine] = useState('merged');
  const [format, setFormat] = useState('pdf');
  const [lang, setLang] = useState('en');
  const [to, setTo] = useState({ mobile: '', email: '' });
  const [ch, setCh] = useState({ whatsapp: true, sms: false, email: false });
  const [links, setLinks] = useState(EMPTY_LINKS);
  const [msgs, setMsgs] = useState({});
  const [tab, setTab] = useState('whatsapp');
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState('');
  const fileCache = useRef({});
  const inv = open && doc ? invoiceFor(kind, doc) : null;
  const isWord = kind === 'file' && /^(docx?|rtf|odt|html?)$/.test(fileExt(doc && doc.name));
  const plan = attachmentPlan({ kind, sel, combine, format });
  const key = JSON.stringify(plan);

  useEffect(() => {
    if (!open || !doc) return;
    fileCache.current = {};
    const r = recipientsFor(kind, doc);
    setTo(r);
    const want = settings.dispatch.channels || {};
    const next = { whatsapp: !!r.mobile && want.whatsapp !== false, sms: !!r.mobile && !!want.sms, email: !!r.email && !!want.email };
    if (!next.whatsapp && !next.sms && !next.email) next.whatsapp = true;
    setCh(next);
    setTab(next.whatsapp ? 'whatsapp' : next.email ? 'email' : 'sms');
    setSel(kind === 'invoice' ? 'invoice' : kind === 'file' ? 'report' : initialSel || 'report');
    setCombine('merged');
    setFormat(kind === 'file' ? (isWord && settings.dispatch.convertDocxToPdf !== false ? 'pdf' : 'original') : 'pdf');
    setLang(settings.dispatch.defaultLanguage || 'en');
    setLinks(EMPTY_LINKS);
    setAttach(true);
  }, [open, doc && doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // secure links: the LAN server stores the file(s); the invoice part gets the patient web receipt link
  useEffect(() => {
    if (!open || !doc) return undefined;
    let alive = true;
    setBusy('link');
    prepareLinks({ kind, doc, sel, combine, format, settings, files: fileCache.current[key] })
      .then((l) => { if (!alive) return; if (l.files) fileCache.current[key] = l.files; setLinks(l); })
      .catch((e) => { if (alive) { toast('Secure link not created: ' + e.message, 'warning'); setLinks(EMPTY_LINKS); } })
      .finally(() => { if (alive) setBusy(''); });
    return () => { alive = false; };
  }, [open, doc && doc.id, key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !doc) return;
    setMsgs(buildMessages({ kind, doc, sel, lang, links, settings }));
  }, [open, doc && doc.id, sel, lang, links.report, links.invoice]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !doc) return null;
  const signed = isSigned(kind, doc);
  const reportPart = kind !== 'invoice' && sel !== 'invoice';
  const blockedUnsigned = reportPart && !signed && !canSendUnsigned(kind);
  const chosen = CHANNELS.filter((c) => ch[c]);
  const getFiles = async () => {
    const cached = fileCache.current[key];
    if (cached && cached.every((f) => f.blob)) return cached;
    const made = await prepareFiles({ kind, doc, plan, settings });
    fileCache.current[key] = made.map((f, i) => Object.assign({}, f, cached && cached[i] && cached[i].fileId ? { fileId: cached[i].fileId } : {}));
    return fileCache.current[key];
  };
  const download = async () => {
    setBusy('pdf');
    try { (await getFiles()).forEach((f) => downloadBlob(f.filename, f.blob)); } catch (e) { toast('File failed: ' + e.message, 'error'); } finally { setBusy(''); }
  };
  const go = async () => {
    if (!canDispatch()) return toast('Your role cannot dispatch documents', 'error');
    if (blockedUnsigned) return toast('Only signed reports can be dispatched by your role', 'error');
    if (!chosen.length) return toast('Choose at least one channel', 'warning');
    setBusy('send');
    try {
      const cached = fileCache.current[key];
      const needFiles = chosen.some((c) => dispatchMode(c) === 'api' && c !== 'sms') || (!links.report && kind !== 'invoice');
      const files = cached && cached.every((f) => f.fileId || f.blob) && (links.report || cached.every((f) => f.blob)) ? cached : needFiles ? await getFiles() : null;
      const out = await dispatchDocument({ kind, doc, sel, combine, format, channels: ch, to, lang, messages: msgs, links, files, attach, trigger: trigger || 'manual' });
      clearPending(kind, doc.id);
      const bad = Object.values(out.results).some((r) => r === 'failed' || r === 'blocked' || r === 'skipped');
      toast(summarize(out.results) + (Object.keys(out.errors).length ? ' — ' + Object.entries(out.errors).map(([c, m]) => c + ': ' + m).join('; ') : ''), bad ? 'warning' : 'success', 7000);
      onSent && onSent(out);
      if (!bad) onClose();
    } catch (e) { toast('Dispatch failed: ' + e.message, 'error', 7000); } finally { setBusy(''); }
  };
  const smsText = (msgs.sms || {}).body || '';
  const selOptions = [
    { value: 'report', label: 'Report only', icon: FileText },
    { value: 'invoice', label: 'Invoice only', icon: Receipt, disabled: !inv },
    { value: 'combined', label: 'Report + Invoice', icon: Layers, disabled: !inv }
  ].filter((o) => !o.disabled);
  const fileList = plan.map((p) => (p.part === 'invoice' ? 'Invoice (PDF)' : p.part === 'merged' ? 'Report + invoice (one PDF)' : (kind === 'file' ? doc.name + (p.format === 'pdf' && isWord ? ' → PDF' : '') : 'Report (' + (p.format === 'docx' ? 'Word .docx' : 'PDF') + ')')));
  return (
    <Modal open={open} onClose={onClose} size="lg" icon={Send} title={'Send ' + ({ usg: 'USG report', lab: 'lab report', invoice: 'invoice' }[kind] || 'document') + ' to patient'} subtitle={docTitle(kind, doc)}
      footer={<>
        <span className="mr-auto max-w-[46%] truncate text-[11.5px] text-muted">{chosen.map((c) => CH_LABEL[c] + ': ' + (dispatchMode(c) === 'api' ? 'silent API' : 'opens app')).join(' · ')}</span>
        <Button icon={FileDown} loading={busy === 'pdf'} onClick={download}>Download</Button>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={busy === 'send' ? Loader2 : Send} loading={busy === 'send'} disabled={blockedUnsigned || busy === 'link'} onClick={go}>Send</Button>
      </>}>
      {reportPart && !signed && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{blockedUnsigned ? 'This report is not signed yet. Your role can dispatch signed reports only — send the invoice, or wait for the doctor to sign.' : `This report is not signed yet — the PDF carries a ${kind === 'lab' ? 'PROVISIONAL' : 'DRAFT'} watermark.`}</span>
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        {(kind === 'usg' || kind === 'lab') && <Segmented size="sm" value={sel} onChange={setSel} options={selOptions} />}
        {(kind === 'usg' || kind === 'lab') && sel !== 'invoice' && <Segmented size="sm" value={format} onChange={setFormat} options={[{ value: 'pdf', label: 'PDF' }, { value: 'docx', label: 'Word .docx' }]} />}
        {sel === 'combined' && format === 'pdf' && <Segmented size="sm" value={combine} onChange={setCombine} options={[{ value: 'merged', label: 'One PDF' }, { value: 'separate', label: 'Two files' }]} />}
        {kind === 'file' && isWord && <Segmented size="sm" value={format} onChange={setFormat} options={[{ value: 'pdf', label: 'Convert to PDF' }, { value: 'original', label: 'Send as ' + fileExt(doc.name).toUpperCase() }]} />}
        {(kind === 'usg' || kind === 'lab') && !inv && <span className="text-[11px] text-muted">No invoice linked to this visit</span>}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted"><Paperclip className="h-3.5 w-3.5" />{fileList.map((f) => <Badge key={f} tone="slate">{f}</Badge>)}</div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Mobile (WhatsApp / SMS)"><Input inputMode="numeric" value={to.mobile} onChange={(e) => setTo(Object.assign({}, to, { mobile: e.target.value.replace(/\D/g, '').slice(-10) }))} placeholder="10-digit mobile" /></Field>
        <Field label="E-mail"><Input type="email" value={to.email} onChange={(e) => setTo(Object.assign({}, to, { email: e.target.value.trim() }))} placeholder="patient@example.com" /></Field>
        <Field label="Language"><Segmented value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'hi', label: 'हिन्दी' }]} /></Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface2/60 px-3 py-2">
        {CHANNELS.map((c) => {
          const I = CH_ICON[c];
          return (
            <span key={c} className="inline-flex items-center gap-1.5">
              <Checkbox checked={!!ch[c]} onChange={(v) => { setCh(Object.assign({}, ch, { [c]: v })); if (v) setTab(c); }} label={<span className="inline-flex items-center gap-1"><I className="h-4 w-4" />{CH_LABEL[c]}</span>} />
              <Badge tone={dispatchMode(c) === 'api' ? 'emerald' : 'slate'}>{dispatchMode(c) === 'api' ? 'API' : 'link'}</Badge>
            </span>
          );
        })}
        <Checkbox className="ml-auto" checked={attach} onChange={setAttach} label="Attach files (API)" />
      </div>
      <div className="mt-2 space-y-1 text-[11.5px]">
        {busy === 'link' && <div className="flex items-center gap-1.5 text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Preparing secure link…</div>}
        {links.report && <LinkRow icon={Link2} label={'Secure download link · expires ' + fmtDateTime(links.expiresAt)} url={links.report} />}
        {links.invoice && <LinkRow icon={Receipt} label="Patient web receipt" url={links.invoice} />}
        {!isServer() && kind !== 'invoice' && <p className="text-muted">Standalone mode: WhatsApp / e-mail links cannot carry files — the file downloads for you to attach. Run the clinic LAN server for secure download links and silent API sending.</p>}
      </div>
      <Tabs className="mt-3" size="sm" value={tab} onChange={setTab} tabs={CHANNELS.filter((c) => ch[c]).map((c) => ({ id: c, label: CH_LABEL[c], icon: CH_ICON[c] }))} />
      {ch[tab] && (
        <div className="mt-2 space-y-1.5">
          {tab === 'email' && <Input value={(msgs.email || {}).subject || ''} onChange={(e) => setMsgs(Object.assign({}, msgs, { email: Object.assign({}, msgs.email, { subject: e.target.value }) }))} aria-label="E-mail subject" placeholder="Subject" />}
          <Textarea rows={tab === 'sms' ? 4 : 9} className="font-deva text-[13px]" aria-label={CH_LABEL[tab] + ' message'} value={(msgs[tab] || {}).body || ''}
            onChange={(e) => setMsgs(Object.assign({}, msgs, { [tab]: Object.assign({}, msgs[tab], { body: e.target.value }) }))} />
          {tab === 'sms' && <p className="text-[11px] text-muted">{smsText.length} characters · {Math.max(1, Math.ceil(smsText.length / (/[^\x00-\x7F]/.test(smsText) ? 70 : 160)))} SMS part(s). Transactional SMS in India needs DLT-registered templates.</p>}
        </div>
      )}
    </Modal>
  );
}

function LinkRow({ icon: I, label, url }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-surface2 px-2 py-1">
      <I className="h-3.5 w-3.5 shrink-0 text-brand-600" />
      <span className="shrink-0 font-semibold">{label}:</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px]">{url}</span>
      <button className="shrink-0 text-muted hover:text-ink" title="Copy" onClick={() => copyText(url).then(() => toast('Link copied', 'success'))}><Copy className="h-3.5 w-3.5" /></button>
      <button className="shrink-0 text-muted hover:text-ink" title="Open" onClick={() => window.open(url, '_blank', 'noopener')}><ExternalLink className="h-3.5 w-3.5" /></button>
    </div>
  );
}

/** Mounted once in the Shell: opens the Send dialog on 'dispatch:open' and runs the scheduled batch timer. */
export function DispatchHost() {
  const [req, setReq] = useState(null);
  useEvent('dispatch:open', (r) => { if (r && r.doc) setReq(r); });
  useEffect(() => {
    const t = setInterval(maybeRunScheduled, 60000);
    const first = setTimeout(maybeRunScheduled, 8000);
    return () => { clearInterval(t); clearTimeout(first); };
  }, []);
  if (!req) return null;
  return <SendDialog open kind={req.kind} doc={req.doc} sel={req.sel} trigger={req.trigger} onClose={() => setReq(null)} onSent={req.onSent} />;
}
