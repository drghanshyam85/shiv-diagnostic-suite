// Auto-send automation (master switch + rules 1–4 incl. the evening batch), sending mode, channels,
// language, conversion & link validity — and the integrations status board with test messages.
import { useState } from 'react';
import { Zap, Upload, ShieldCheck, Inbox, Clock, PlayCircle, MessageCircle, Smartphone, Mail, PlugZap, Settings as SettingsIcon, CircleCheck, CircleX, Send, Bot, Cloud, Server, TestTube } from 'lucide-react';
import { useSettings, saveSettings, useLocalPref, navigate } from '../../core/hooks';
import { api, isServer, useNet } from '../../core/sync';
import { can, logAudit } from '../../core/auth';
import { Card, Button, Badge, Input, Toggle, Segmented, Checkbox, Field, toast } from '../../components/ui';
import { fmtDateTime } from '../../core/utils';
import { runBatch, unsentToday, lastBatch, silentChannels, CH_LABEL } from './engine';

export function RulesTab({ section = 'rules' }) {
  return section === 'integrations' ? <Integrations /> : <Rules />;
}

function Rules() {
  const settings = useSettings();
  const d = settings.dispatch;
  const rules = d.rules || {};
  const admin = can('settings:manage_clinic_and_integrations');
  const [host, setHost] = useLocalPref('dispatch-batch-host', false);
  const [busy, setBusy] = useState(false);
  const set = (patch, label) => {
    if (!admin) return toast('Only the administrator can change dispatch rules', 'error');
    saveSettings({ dispatch: patch });
    logAudit('settings:dispatch_changed', 'settings/dispatch', { change: label || Object.keys(patch).join(',') });
  };
  const setRule = (k, v) => set({ rules: Object.assign({}, rules, { [k]: v }) }, 'rule ' + k + '=' + v);
  const lb = lastBatch();
  const silent = silentChannels();
  const RULES = [
    ['onUpload', Upload, 'Rule 1 · On upload', 'Send immediately when an uploaded report is matched to a patient mobile number (Documents tab).'],
    ['onSigned', ShieldCheck, 'Rule 2 · On verify / sign', 'Send when Dr. Ghanshyam Kumawat signs a USG report or Dr. Rishabh Kumar verifies a lab report.'],
    ['onEmailImport', Inbox, 'Rule 3 · On e-mail import', 'Forward reports pulled from the e-mail inbox once the patient is matched.'],
    ['scheduled', Clock, 'Rule 4 · Evening batch', 'Send all of today’s signed reports that have not been sent yet, at a fixed time.'],
    ['onSampleCollected', TestTube, 'Rule 5 · Sample collected', 'Tell the patient on WhatsApp / SMS that the sample was collected and when the report is expected (from the test turnaround in the rate list).']
  ];
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <Card icon={Zap} title="Auto-Send Mode" subtitle={admin ? 'Changes apply on every workstation instantly' : 'Read-only — only the administrator can change rules'}
          actions={<Toggle checked={d.autoMode !== false} onChange={(v) => set({ autoMode: v }, 'autoMode=' + v)} label={d.autoMode !== false ? 'ON' : 'OFF'} disabled={!admin} />}>
          <div className="space-y-3">
            {RULES.map(([k, I, title, text]) => (
              <div key={k} className="flex items-start gap-3 rounded-xl border border-line p-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/50"><I className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold">{title}</div>
                  <div className="text-[12px] text-muted">{text}</div>
                  {k === 'scheduled' && (
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <Field label="Time" className="w-[130px]"><Input type="time" size="sm" value={rules.scheduledTime || '18:00'} disabled={!admin} onChange={(e) => setRule('scheduledTime', e.target.value || '18:00')} /></Field>
                      <Toggle size="sm" checked={!!host} onChange={(v) => setHost(v)} label="This workstation runs the batch" hint="Keep one always-on PC (e.g. reception) with this switched on" />
                      <Button size="sm" icon={PlayCircle} loading={busy} onClick={async () => { setBusy(true); try { const r = await runBatch({ manual: true }); toast(`Batch: ${r.total} report(s) · ${r.sent} sent · ${r.queued} queued for 1-click send`, 'success', 7000); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); } }}>Run now ({unsentToday().length})</Button>
                      {lb && <span className="text-[11.5px] text-muted">Last run {fmtDateTime(lb.at)} · {lb.sent} sent · {lb.queued} queued</span>}
                    </div>
                  )}
                </div>
                <Toggle checked={!!rules[k] && d.autoMode !== false} disabled={!admin || d.autoMode === false} onChange={(v) => setRule(k, v)} />
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11.5px] text-muted">{silent.length ? 'Silent sending is available for ' + silent.map((c) => CH_LABEL[c]).join(', ') + '. Other channels open the Send dialog (interactive rules) or wait in the dashboard for a 1-click send.' : 'No API channel is configured, so rules open the Send dialog or queue documents for a 1-click send. Configure WhatsApp / SMS / e-mail providers for fully silent sending.'}</p>
        </Card>
        <Card icon={Send} title="Sending defaults">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Dispatch mode" hint="API sends silently with attachments through the LAN server; deep links open WhatsApp / SMS / mail apps with the message ready.">
              <Segmented value={d.mode} onChange={(v) => set({ mode: v }, 'mode=' + v)} options={[{ value: 'api', label: 'Mode 1 · API (silent)' }, { value: 'deeplink', label: 'Mode 2 · Deep link' }]} />
            </Field>
            <Field label="Auto-send channels">
              <div className="flex flex-wrap gap-3 pt-1.5">
                {[['whatsapp', MessageCircle], ['sms', Smartphone], ['email', Mail]].map(([c, I]) => (
                  <Checkbox key={c} disabled={!admin} checked={!!(d.channels || {})[c]} onChange={(v) => set({ channels: Object.assign({}, d.channels, { [c]: v }) })} label={<span className="inline-flex items-center gap-1"><I className="h-4 w-4" />{CH_LABEL[c]}</span>} />
                ))}
              </div>
            </Field>
            <Field label="Default message language"><Segmented value={d.defaultLanguage || 'en'} onChange={(v) => set({ defaultLanguage: v })} options={[{ value: 'en', label: 'English' }, { value: 'hi', label: 'हिन्दी / Bilingual' }]} /></Field>
            <Field label="Secure link validity (days)" hint="Patients download reports from expiring links (LAN server / public URL)."><Input type="number" min={1} max={90} value={d.linkDays || 7} disabled={!admin} onChange={(e) => set({ linkDays: Math.max(1, Math.min(90, Number(e.target.value) || 7)) })} /></Field>
            <Toggle checked={d.convertDocxToPdf !== false} disabled={!admin} onChange={(v) => set({ convertDocxToPdf: v })} label="Convert .docx to .pdf before sending on WhatsApp" hint="Word files uploaded or imported are converted (LibreOffice on the server, else in the browser)." />
            <Toggle checked={!!d.gmailCompose} disabled={!admin} onChange={(v) => set({ gmailCompose: v })} label="E-mail deep links open Gmail web compose" hint="Otherwise the default mail app (mailto:) opens." />
          </div>
        </Card>
      </div>
      <Integrations compact />
    </div>
  );
}

const PROVIDERS = [
  ['whatsapp', MessageCircle, 'WhatsApp', 'Meta Cloud API · UltraMsg · Wati · signed webhook'],
  ['sms', Smartphone, 'SMS', 'Fast2SMS (DLT) · Twilio · TextLocal'],
  ['email', Mail, 'E-mail (SMTP)', 'Gmail SMTP with App Password or any SMTP server'],
  ['imap', Inbox, 'E-mail inbox (IMAP)', 'Report importer — Gmail imap.gmail.com:993'],
  ['gemini', Bot, 'Gemini AI', 'Report drafting, dictation clean-up, proofreading'],
  ['google', Cloud, 'Google OAuth', 'Drive / Docs backup & export'],
  ['microsoft', Cloud, 'Microsoft OAuth', 'OneDrive / Word backup & export']
];

function Integrations({ compact }) {
  const net = useNet();
  const st = net.integrations || {};
  const admin = can('settings:manage_clinic_and_integrations');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState('');
  const test = async (ch) => {
    if (!to) return toast('Enter a mobile number or e-mail for the test', 'warning');
    setBusy(ch);
    try { const r = await api('integrations/test/' + ch, { method: 'POST', body: { to } }); toast('Test ' + ch + ' sent via ' + (r.provider || 'provider') + (r.warnings && r.warnings.length ? ' · ' + r.warnings.join('; ') : ''), 'success', 6000); } catch (e) { toast('Test failed: ' + e.message, 'error', 9000); } finally { setBusy(''); }
  };
  return (
    <Card icon={PlugZap} title="Integrations" subtitle={isServer() ? 'Provider status on the clinic server' : 'Standalone mode — deep links only'}
      actions={admin ? <Button size="sm" icon={SettingsIcon} onClick={() => navigate('/settings', { tab: 'integrations' })}>Configure</Button> : null}>
      {!isServer() ? (
        <div className="space-y-2 text-[12.5px]">
          <div className="flex items-center gap-2"><Server className="h-4 w-4 text-amber-600" /><b>Running without the LAN server</b></div>
          <p className="text-muted">WhatsApp (wa.me), SMS (sms:) and e-mail (mailto: / Gmail compose) deep links work from any browser. Silent API sending with attachments, secure download links and the IMAP inbox need the clinic server (<span className="font-mono">npm start</span> on the main PC).</p>
        </div>
      ) : (
        <div className={compact ? 'space-y-2' : 'grid gap-2 md:grid-cols-2'}>
          {PROVIDERS.map(([k, I, label, hint]) => {
            const on = !!st[k];
            return (
              <div key={k} className="flex items-center gap-3 rounded-xl border border-line p-2.5">
                <I className="h-4 w-4 shrink-0 text-muted" />
                <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold">{label}</div><div className="truncate text-[11px] text-muted">{hint}</div></div>
                {on ? <Badge tone="emerald" icon={CircleCheck}>{typeof st[k] === 'string' ? st[k] : 'Connected'}</Badge> : <Badge tone="slate" icon={CircleX}>Not set</Badge>}
              </div>
            );
          })}
        </div>
      )}
      {isServer() && admin && (
        <div className="mt-3 rounded-xl bg-surface2/60 p-3">
          <div className="label">Send a test message</div>
          <div className="flex flex-wrap gap-2">
            <Input size="sm" className="min-w-[180px] flex-1" placeholder="Mobile or e-mail" value={to} onChange={(e) => setTo(e.target.value.trim())} aria-label="Test recipient" />
            <Button size="sm" icon={MessageCircle} loading={busy === 'whatsapp'} disabled={!st.whatsapp} onClick={() => test('whatsapp')}>WhatsApp</Button>
            <Button size="sm" icon={Smartphone} loading={busy === 'sms'} disabled={!st.sms} onClick={() => test('sms')}>SMS</Button>
            <Button size="sm" icon={Mail} loading={busy === 'email'} disabled={!st.email} onClick={() => test('email')}>E-mail</Button>
          </div>
        </div>
      )}
      {!compact && (
        <div className="mt-3 grid gap-2 text-[11.5px] text-muted md:grid-cols-3">
          <p><b className="text-ink">WhatsApp Cloud API:</b> messages to patients who have not written to the clinic in 24 h must use an <b>approved template</b> — set its name and placeholders in Settings; the PDF goes in the template’s document header.</p>
          <p><b className="text-ink">SMS in India:</b> transactional SMS needs DLT registration (entity, sender ID and each template). Fill the DLT template ID and placeholder order for Fast2SMS.</p>
          <p><b className="text-ink">Gmail:</b> turn on 2-Step Verification and create an App Password for SMTP (smtp.gmail.com:465) and IMAP (imap.gmail.com:993).</p>
        </div>
      )}
    </Card>
  );
}
