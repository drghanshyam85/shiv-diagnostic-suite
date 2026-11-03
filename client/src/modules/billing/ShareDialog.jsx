// Share invoice: WhatsApp / SMS / Email / Send Both, patient web link & QR, bilingual templates.
import { useEffect, useRef, useState } from 'react';
import { Share2, MessageCircle, MessageSquare, Mail, Send, Link2, Copy, ExternalLink, Zap } from 'lucide-react';
import { useSettings, useColl, useMaps } from '../../core/hooks';
import { store } from '../../core/store';
import { useNet } from '../../core/sync';
import { patientInvoiceLink, fillTemplate, invoiceVars, pickTemplate } from '../../core/share';
import { send, logDispatch, dispatchMode } from '../../core/dispatch';
import { useQr } from '../../core/qr';
import { copyText, fullName, validMobile } from '../../core/utils';
import { pagesToPdf } from '../../core/pdf';
import { Modal, Button, Textarea, Input, Checkbox, Segmented, Badge, toast, Tabs } from '../../components/ui';
import { InvoicePages } from './InvoiceDoc';

export function ShareDialog({ open, onClose, invoice, autoFire }) {
  const settings = useSettings();
  const templates = useColl('msgTemplates');
  const maps = useMaps();
  const net = useNet();
  const [lang, setLang] = useState(settings.dispatch.defaultLanguage || 'en');
  const [link, setLink] = useState('');
  const [tab, setTab] = useState('whatsapp');
  const [texts, setTexts] = useState({ whatsapp: '', sms: '', email: '', subject: '' });
  const [chan, setChan] = useState({ whatsapp: true, sms: false, email: false });
  const [to, setTo] = useState({ mobile: '', email: '' });
  const [attachPdf, setAttachPdf] = useState(true);
  const [busy, setBusy] = useState(false);
  const pdfRef = useRef(null);
  const fired = useRef(false);
  const qr = useQr(link, { size: 200 });

  useEffect(() => {
    if (!open || !invoice) return;
    fired.current = false;
    setTo({ mobile: invoice.patient.mobile || '', email: invoice.patient.email || '' });
    setChan(autoFire ? Object.assign({ whatsapp: false, sms: false, email: false }, autoFire) : Object.assign({}, settings.billing.autoSendChannels, { email: !!invoice.patient.email && settings.billing.autoSendChannels.email }));
    patientInvoiceLink(invoice, settings, maps.tests).then(setLink);
  }, [open, invoice && invoice.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !invoice) return;
    const vars = invoiceVars(invoice, settings, link);
    const t = (ch) => pickTemplate(ch, 'invoice', lang);
    const em = t('email');
    setTexts({
      whatsapp: fillTemplate((t('whatsapp') || {}).body, vars), sms: fillTemplate((t('sms') || {}).body, vars),
      email: fillTemplate((em || {}).body, vars), subject: fillTemplate((em || {}).subject || 'Invoice {{Invoice_No}}', vars)
    });
  }, [open, link, lang, templates.length, invoice && invoice.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async (channels) => {
    if (!invoice) return;
    const list = Object.keys(channels).filter((k) => channels[k]);
    if (!list.length) { toast('Choose at least one channel', 'warning'); return; }
    if ((list.includes('whatsapp') || list.includes('sms')) && !validMobile(to.mobile)) { toast('Enter a valid 10-digit mobile number', 'warning'); return; }
    if (list.includes('email') && !/\S+@\S+\.\S+/.test(to.email)) { toast('Enter the patient e-mail address', 'warning'); return; }
    setBusy(true);
    const results = {};
    let pdfBlob = null;
    for (const ch of list) {
      try {
        let attachments = [];
        if (ch !== 'sms' && attachPdf && dispatchMode(ch) === 'api') {
          if (!pdfBlob && pdfRef.current) pdfBlob = await pagesToPdf(pdfRef.current.querySelectorAll('.print-page'), { widthMm: 210, heightMm: 297, download: false });
          if (pdfBlob) attachments = [{ blob: pdfBlob, filename: invoice.invoiceNo + '.pdf' }];
        }
        const r = await send(ch, { to: ch === 'email' ? to.email : to.mobile, message: ch === 'email' ? texts.email : texts[ch], subject: texts.subject, attachments, ref: 'invoices/' + invoice.id, gmail: ch === 'email' && settings.dispatch.gmailCompose });
        results[ch] = r.mode === 'api' ? 'sent' : r.ok ? 'opened' : 'blocked';
      } catch (e) { results[ch] = 'failed'; toast(ch + ': ' + e.message, 'error'); }
    }
    const cur = store.get('invoices', invoice.id);
    if (cur) {
      const sent = Object.assign({}, cur.sent || {});
      list.forEach((ch) => { if (results[ch] !== 'failed') sent[ch] = Date.now(); });
      store.put('invoices', Object.assign({}, cur, { sent }));
    }
    logDispatch({ kind: 'invoice', ref: invoice.id, refColl: 'invoices', patientId: invoice.patientId, patientName: fullName(invoice.patient), mobile: to.mobile, email: to.email, department: 'Billing', docType: 'Invoice', format: 'PDF', channels: results, invoiceStatus: invoice.status, link });
    setBusy(false);
    const okCount = Object.values(results).filter((r) => r !== 'failed').length;
    if (okCount) toast(Object.entries(results).map(([k, v]) => k + ': ' + v).join(' · '), Object.values(results).includes('blocked') ? 'warning' : 'success');
  };

  useEffect(() => {
    if (open && autoFire && link && texts.whatsapp && !fired.current) { fired.current = true; go(autoFire); }
  }, [open, autoFire, link, texts.whatsapp]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !invoice) return null;
  const modeTag = (ch) => <Badge tone={dispatchMode(ch) === 'api' ? 'emerald' : 'slate'}>{dispatchMode(ch) === 'api' ? 'API · silent' : 'deep link'}</Badge>;
  return (
    <Modal open={open} onClose={onClose} size="lg" title={'Share invoice ' + invoice.invoiceNo} subtitle={fullName(invoice.patient)} icon={Share2}
      footer={<>
        <span className="mr-auto text-[11px] text-muted">{net.mode === 'server' ? 'API channels send silently with the PDF; deep links open WhatsApp / SMS / mail apps.' : 'Standalone: deep links open WhatsApp Web / SMS / e-mail apps.'}</span>
        <Button icon={MessageCircle} variant="whatsapp" loading={busy} onClick={() => go({ whatsapp: true })}>WhatsApp</Button>
        <Button icon={MessageSquare} loading={busy} onClick={() => go({ sms: true })}>SMS</Button>
        <Button icon={Mail} loading={busy} onClick={() => go({ email: true })}>Email</Button>
        <Button variant="primary" icon={Send} loading={busy} onClick={() => go(chan)}>Send selected</Button>
      </>}>
      <div className="grid gap-4 md:grid-cols-[1fr_230px]">
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div><span className="label">Mobile (WhatsApp / SMS)</span><Input value={to.mobile} onChange={(e) => setTo(Object.assign({}, to, { mobile: e.target.value.replace(/\D/g, '').slice(0, 10) }))} /></div>
            <div><span className="label">E-mail</span><Input value={to.email} onChange={(e) => setTo(Object.assign({}, to, { email: e.target.value }))} placeholder="patient@example.com" /></div>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface2/60 px-3 py-2">
            <span className="text-xs font-semibold text-muted">Send Both / multi-channel:</span>
            <Checkbox checked={chan.whatsapp} onChange={(v) => setChan(Object.assign({}, chan, { whatsapp: v }))} label="WhatsApp" />
            <Checkbox checked={chan.sms} onChange={(v) => setChan(Object.assign({}, chan, { sms: v }))} label="SMS" />
            <Checkbox checked={chan.email} onChange={(v) => setChan(Object.assign({}, chan, { email: v }))} label="Email" />
            <Segmented size="sm" className="ml-auto" value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'hi', label: 'हिन्दी' }]} />
          </div>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle }, { id: 'sms', label: 'SMS', icon: MessageSquare }, { id: 'email', label: 'Email', icon: Mail }]} size="sm" />
          <div className="flex items-center justify-between text-[11px] text-muted"><span>Editable message preview</span>{modeTag(tab)}</div>
          {tab === 'email' && <Input value={texts.subject} onChange={(e) => setTexts(Object.assign({}, texts, { subject: e.target.value }))} aria-label="Email subject" />}
          <Textarea rows={10} className="font-mono text-[12.5px]" value={texts[tab]} onChange={(e) => setTexts(Object.assign({}, texts, { [tab]: e.target.value }))} />
          {tab === 'sms' && <p className="text-[11px] text-muted">{texts.sms.length} characters · {Math.ceil(texts.sms.length / (/[^\x00-\x7F]/.test(texts.sms) ? 70 : 160))} SMS part(s). Transactional SMS in India requires DLT-registered templates.</p>}
          <Checkbox checked={attachPdf} onChange={setAttachPdf} label="Attach A4 PDF invoice when sending via API (WhatsApp / Email)" />
        </div>
        <div className="space-y-2">
          <div className="label flex items-center gap-1"><Link2 className="h-3.5 w-3.5" />Patient web receipt</div>
          {qr ? <img src={qr} alt="Patient link QR" className="w-full rounded-xl border border-line bg-white p-2" /> : <div className="aspect-square rounded-xl bg-surface2" />}
          <div className="break-all rounded-lg bg-surface2 p-2 font-mono text-[10px] leading-4">{link ? (link.length > 140 ? link.slice(0, 140) + '…' : link) : 'Generating…'}</div>
          <div className="flex gap-1.5">
            <Button size="xs" icon={Copy} onClick={() => copyText(link).then(() => toast('Link copied', 'success'))}>Copy</Button>
            <Button size="xs" icon={ExternalLink} onClick={() => window.open(link, '_blank')}>Open</Button>
          </div>
          <p className="text-[10.5px] leading-4 text-muted">{net.mode === 'server' && !settings.billing.publicBaseUrl ? 'LAN link — works on the clinic Wi-Fi. Set a Public Base URL in Settings → Billing for links that work anywhere.' : 'Self-contained link — the receipt data travels inside the link (#fragment), never stored on a third-party server.'}</p>
          {autoFire && <Badge tone="emerald" icon={Zap}>Auto-send on bill generation is ON</Badge>}
        </div>
      </div>
      <div className="pointer-events-none fixed -left-[12000px] top-0" aria-hidden>
        <div ref={pdfRef}><InvoicePages inv={invoice} settings={settings} opts={Object.assign({}, settings.print, { format: 'a4' })} webLink={link} /></div>
      </div>
    </Modal>
  );
}
