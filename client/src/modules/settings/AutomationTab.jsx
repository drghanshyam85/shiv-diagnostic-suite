// Settings → Automation: the server's event-driven workflows. Built-in automations (on / off, with what
// they did), the live event stream, outgoing webhooks (signed POSTs to other systems, with delivery log
// and retries) and the incoming webhook other systems use to post payments, queue status and analyzer
// results. Everything here runs on the clinic server, so it keeps working with every screen closed.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Workflow, Zap, Webhook, Inbox, Plus, Send, RefreshCw, Trash2, KeyRound, Eye, Copy, Play, ChevronDown, ChevronRight, ShieldCheck, AlertTriangle, CheckCircle2, Clock, Power, ListTree } from 'lucide-react';
import { useEvent, useSettings, saveSettings } from '../../core/hooks';
import { api, isServer } from '../../core/sync';
import { can, logAudit } from '../../core/auth';
import { cx, Card, Button, Badge, Input, Field, Segmented, Toggle, Modal, Drawer, Empty, toast, confirmDialog } from '../../components/ui';
import { copyText, fmtDateTime, timeAgo } from '../../core/utils';
import catalogue from '../../../../shared/events';

const { EVENT_GROUPS, EVENT_TYPES, AUTOMATIONS, INBOUND_TYPES } = catalogue;
const LABEL = Object.fromEntries(EVENT_TYPES.map((e) => [e.type, e.label]));
const SOURCE = { change: 'workstation', automation: 'automation', webhook: 'inbound webhook', test: 'test' };
const DELIVERY_TONE = { delivered: 'emerald', pending: 'slate', retrying: 'amber', dead: 'rose', cancelled: 'slate' };

function CopyBox({ value, label, secret }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-surface2/60 px-2.5 py-1.5">
      <code className={cx('min-w-0 flex-1 truncate font-mono text-[12px]', secret && 'select-all')} title={value}>{value}</code>
      <Button size="xs" icon={Copy} onClick={async () => { await copyText(value); toast((label || 'Copied') + ' copied', 'success', 1500); }}>Copy</Button>
    </div>
  );
}

function SecretOnce({ open, onClose, secret, title, extra }) {
  return (
    <Modal open={open} onClose={onClose} size="md" title={title || 'Signing secret'} icon={KeyRound} footer={<Button variant="primary" onClick={onClose}>I have saved it</Button>}>
      <div className="space-y-3 text-[13px]">
        <p>Copy this secret into the other system now. For your safety it is shown only this once; later you can rotate it to get a new one.</p>
        <CopyBox value={secret || ''} label="Secret" secret />
        {extra}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ automations
function AutomationsCard({ data, admin }) {
  const settings = useSettings();
  const rules = (settings.automation && settings.automation.rules) || {};
  const set = (id, on) => {
    saveSettings({ automation: { rules: Object.assign({}, rules, { [id]: on }) } });
    logAudit('settings:automation_rule', 'settings/automation', { id, on });
    toast((on ? 'Switched on: ' : 'Switched off: ') + (AUTOMATIONS.find((a) => a.id === id) || {}).label, 'success', 1800);
  };
  const byId = Object.fromEntries(((data && data.automations) || []).map((a) => [a.id, a]));
  return (
    <Card title="Workflow automations" icon={Workflow} subtitle="Run on the clinic server for every change, from any workstation. They only write when something actually needs to change.">
      <ul className="divide-y divide-line">
        {AUTOMATIONS.map((a) => {
          const on = rules[a.id] === undefined ? a.default : rules[a.id] === true;
          const st = (byId[a.id] && byId[a.id].stats) || {};
          return (
            <li key={a.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><b className="text-[13.5px]">{a.label}</b><code className="text-[10.5px] text-muted">{a.id}</code></div>
                <p className="mt-0.5 text-[12.5px] text-muted">{a.description}</p>
                <p className="mt-1 text-[11.5px] text-muted">
                  Reacts to {a.on.map((t) => <code key={t} className="mr-1 rounded bg-surface2 px-1">{t}</code>)}
                  {st.runs ? <> · ran {st.runs}× · changed {st.changed}{st.errors ? <span className="text-rose-600"> · {st.errors} error(s)</span> : ''} · last {timeAgo(st.lastAt)}: {st.lastResult}</> : ' · has not run yet'}
                </p>
              </div>
              <Toggle checked={on} disabled={!admin} onChange={(v) => set(a.id, v)} label={on ? 'On' : 'Off'} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------------ event stream
function EventRow({ e, admin, onReplay }) {
  const [open, setOpen] = useState(false);
  const autos = Object.entries(e.automations || {});
  const changed = autos.filter(([, r]) => /→|marked|closed/.test(r)).length;
  const errors = autos.filter(([, r]) => /^error/.test(r)).length;
  return (
    <li className="py-2">
      <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <code className="rounded bg-brand-50 px-1.5 text-[11.5px] font-semibold text-brand-800 dark:bg-brand-950/50 dark:text-brand-200">{e.type}</code>
            <span className="text-[12.5px]">{LABEL[e.type] || ''}</span>
            {changed > 0 && <Badge tone="emerald" icon={Zap}>{changed} automation{changed > 1 ? 's' : ''} acted</Badge>}
            {errors > 0 && <Badge tone="rose" icon={AlertTriangle}>{errors} error</Badge>}
            {e.deliveries > 0 && <Badge tone="violet" icon={Webhook}>{e.deliveries} webhook{e.deliveries > 1 ? 's' : ''}</Badge>}
            {e.status === 'pending' && <Badge tone="amber" icon={Clock}>queued</Badge>}
          </span>
          <span className="block text-[11.5px] text-muted">{fmtDateTime(e.at)} · from {SOURCE[e.source] || e.source}{e.actor && e.actor.name ? ' (' + e.actor.name + ')' : ''} · {e.subject.coll}/{e.subject.id}</span>
        </span>
      </button>
      {open && (
        <div className="ml-6 mt-1.5 space-y-1.5 rounded-lg bg-surface2/60 p-2.5 text-[12px]">
          {autos.length > 0 && <ul className="space-y-0.5">{autos.map(([k, r]) => <li key={k}><code className="text-[11px]">{k}</code> — {r}</li>)}</ul>}
          <pre className="max-h-48 overflow-auto rounded bg-surface p-2 font-mono text-[11px] leading-snug">{JSON.stringify(e.data, null, 2)}</pre>
          {admin && <Button size="xs" icon={Play} onClick={() => onReplay(e)}>Run again</Button>}
        </div>
      )}
    </li>
  );
}

function EventsCard({ admin }) {
  const [group, setGroup] = useState('');
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (older) => {
    setBusy(true);
    try {
      const before = older && list.length ? list[list.length - 1].at : 0;
      const r = await api('automation/events?limit=40' + (group ? '&group=' + group : '') + (before ? '&before=' + before : ''));
      setList((cur) => (older ? cur.concat(r.events) : r.events));
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }, [group, list]);
  useEffect(() => { load(false); }, [group]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tick, setTick] = useState(0);
  useEvent('automation:event', () => setTick((t) => t + 1));
  useEffect(() => { if (!tick) return undefined; const t = setTimeout(() => load(false), 700); return () => clearTimeout(t); }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const replay = async (e) => {
    if (!(await confirmDialog({ title: 'Run this event again?', message: 'Its automations run again (they only change what still needs changing) and it is sent again to the matching webhooks.', confirmText: 'Run again' }))) return;
    try { await api('automation/events/' + encodeURIComponent(e.id) + '/replay', { method: 'POST' }); toast('Queued again', 'success'); setTimeout(() => load(false), 800); } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <Card title="Event stream" icon={ListTree} subtitle="Everything that happened, as the server saw it — live" padded={false}
      actions={<Button size="sm" icon={RefreshCw} loading={busy} onClick={() => load(false)}>Refresh</Button>}>
      <div className="border-b border-line px-4 py-2.5">
        <Segmented size="sm" ariaLabel="Event group" value={group} onChange={setGroup} options={[{ value: '', label: 'All' }].concat(EVENT_GROUPS.filter((g) => g.id !== 'system').map((g) => ({ value: g.id, label: g.label })))} />
      </div>
      <div className="max-h-[520px] overflow-y-auto px-4">
        {!list.length && !busy && <div className="py-6"><Empty icon={ListTree} title="No events yet" text="Register a patient, save a bill or sign a report — events appear here within a second." /></div>}
        <ul className="divide-y divide-line">{list.map((e) => <EventRow key={e.id} e={e} admin={admin} onReplay={replay} />)}</ul>
        {list.length >= 40 && <div className="py-3 text-center"><Button size="sm" loading={busy} onClick={() => load(true)}>Load older</Button></div>}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ outgoing webhooks
function EventPicker({ value, onChange }) {
  const all = !value.length || value.includes('*');
  const toggle = (t) => { const cur = all ? [] : value.slice(); onChange(cur.includes(t) ? cur.filter((x) => x !== t) : cur.concat([t])); };
  return (
    <div className="space-y-2">
      <Toggle checked={all} onChange={(v) => onChange(v ? ['*'] : [])} label="All events" hint="New event types are included automatically" />
      {!all && (
        <div className="grid max-h-64 gap-2 overflow-y-auto rounded-lg border border-line p-2.5 sm:grid-cols-2">
          {EVENT_GROUPS.filter((g) => g.id !== 'system').map((g) => (
            <fieldset key={g.id} className="min-w-0">
              <legend className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">{g.label}</legend>
              {EVENT_TYPES.filter((e) => e.group === g.id).map((e) => (
                <label key={e.type} className="flex items-start gap-2 py-0.5 text-[12.5px]">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={value.includes(e.type)} onChange={() => toggle(e.type)} />
                  <span className="min-w-0"><code className="text-[11px]">{e.type}</code><span className="block text-[11px] text-muted">{e.label}</span></span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      )}
    </div>
  );
}

function HookForm({ open, onClose, initial, onSaved }) {
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF(Object.assign({ name: '', url: 'https://', events: ['*'], includePatient: false }, initial || {})); }, [open, initial]);
  if (!open || !f) return null;
  const save = async () => {
    setBusy(true);
    try {
      if (initial && initial.id) { await api('automation/webhooks/' + encodeURIComponent(initial.id), { method: 'PUT', body: { name: f.name, url: f.url, events: f.events, includePatient: f.includePatient } }); onSaved(null); }
      else { const r = await api('automation/webhooks', { method: 'POST', body: f }); onSaved(r.secret); }
      onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" icon={Webhook} title={initial && initial.id ? 'Edit webhook endpoint' : 'Add a webhook endpoint'}
      subtitle="The clinic server POSTs each chosen event to this URL, signed with a secret"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!f.name.trim() || !/^https?:\/\/.+/.test(f.url)}>{initial && initial.id ? 'Save' : 'Add endpoint'}</Button></>}>
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF(Object.assign({}, f, { name: e.target.value }))} placeholder="Accounts sheet / HIS / n8n" aria-label="Webhook name" /></Field>
          <Field label="URL" hint="https:// recommended; http:// only inside the clinic network"><Input value={f.url} onChange={(e) => setF(Object.assign({}, f, { url: e.target.value.trim() }))} placeholder="https://example.com/ssdc-webhook" aria-label="Webhook URL" /></Field>
        </div>
        <EventPicker value={f.events} onChange={(events) => setF(Object.assign({}, f, { events }))} />
        <Toggle checked={!!f.includePatient} onChange={(v) => setF(Object.assign({}, f, { includePatient: v }))} label="Include patient name, mobile, age and gender"
          hint="Off: only IDs, tokens, amounts and statuses are sent. Turn on only for systems you trust with patient data." />
        {f.includePatient && <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Patient details will leave the clinic server. Use an https:// URL and keep the secret safe.</p>}
      </div>
    </Modal>
  );
}

function DeliveriesDrawer({ hook, onClose, admin }) {
  const [list, setList] = useState(null);
  const load = useCallback(() => { if (hook) api('automation/webhooks/' + encodeURIComponent(hook.id) + '/deliveries?limit=80').then((r) => setList(r.deliveries)).catch((e) => toast(e.message, 'error')); }, [hook]);
  useEffect(() => { setList(null); load(); }, [load]);
  const retry = async (d) => { try { await api('automation/deliveries/' + encodeURIComponent(d.id) + '/retry', { method: 'POST' }); toast('Retrying now', 'info', 1500); setTimeout(load, 2500); } catch (e) { toast(e.message, 'error'); } };
  return (
    <Drawer open={!!hook} onClose={onClose} title={hook ? 'Deliveries · ' + hook.name : ''} subtitle={hook ? hook.url : ''} icon={Send} width="sm:w-[620px]"
      footer={<Button icon={RefreshCw} onClick={load}>Refresh</Button>}>
      <div className="p-4">
        {!list ? <p className="text-sm text-muted">Loading…</p> : !list.length ? <Empty icon={Send} title="Nothing sent yet" text="Deliveries appear here as events happen." /> : (
          <table className="tbl w-full text-[12px]">
            <thead><tr><th>When</th><th>Event</th><th>Result</th><th className="text-right">Tries</th><th /></tr></thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(d.createdAt)}</td>
                  <td><code className="text-[11px]">{d.type}</code></td>
                  <td>
                    <Badge tone={DELIVERY_TONE[d.status] || 'slate'}>{d.status}</Badge>
                    {d.lastCode ? <span className="ml-1 text-muted">HTTP {d.lastCode}</span> : null}
                    {d.lastError && <span className="block max-w-[220px] truncate text-[11px] text-rose-600" title={d.lastError}>{d.lastError}</span>}
                    {d.status === 'retrying' && d.nextAt ? <span className="block text-[11px] text-muted">next try {d.nextAt <= Date.now() ? 'now' : 'at ' + fmtDateTime(d.nextAt)}</span> : null}
                  </td>
                  <td className="text-right tnum">{d.attempts}</td>
                  <td className="text-right">{admin && d.status !== 'delivered' && <Button size="xs" icon={RefreshCw} onClick={() => retry(d)}>Retry</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Drawer>
  );
}

function WebhooksCard({ data, admin, reload }) {
  const [form, setForm] = useState(null);
  const [secret, setSecret] = useState('');
  const [log, setLog] = useState(null);
  const [busy, setBusy] = useState('');
  const hooks = (data && data.webhooks) || [];
  const act = async (id, fn) => { setBusy(id); try { await fn(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); reload(); } };
  const test = (h) => act(h.id + 'test', async () => {
    const r = (await api('automation/webhooks/' + encodeURIComponent(h.id) + '/test', { method: 'POST' })).result;
    toast(r.ok ? 'Test delivered: HTTP ' + r.code + ' in ' + r.ms + ' ms' : 'Test failed: ' + (r.code ? 'HTTP ' + r.code + ' · ' : '') + r.error, r.ok ? 'success' : 'error');
  });
  const toggle = (h) => act(h.id, () => api('automation/webhooks/' + encodeURIComponent(h.id), { method: 'PUT', body: { active: !h.active } }));
  const rotate = (h) => act(h.id, async () => {
    if (!(await confirmDialog({ title: 'New signing secret?', message: 'The old secret stops working at once. Update the receiving system with the new one.', confirmText: 'Rotate secret' }))) return;
    setSecret((await api('automation/webhooks/' + encodeURIComponent(h.id) + '/rotate', { method: 'POST' })).secret);
  });
  const remove = (h) => act(h.id, async () => {
    if (!(await confirmDialog({ title: 'Delete “' + h.name + '”?', message: 'Pending deliveries to it are cancelled.', confirmText: 'Delete', danger: true }))) return;
    await api('automation/webhooks/' + encodeURIComponent(h.id), { method: 'DELETE' });
  });
  return (
    <Card title="Outgoing webhooks" icon={Webhook} subtitle="Send events to other systems — an accounts sheet, a hospital system, n8n / Zapier / Make — as they happen"
      actions={admin && <Button size="sm" variant="primary" icon={Plus} onClick={() => setForm({})}>Add endpoint</Button>}>
      {!hooks.length ? <Empty icon={Webhook} title="No endpoints yet" text="Add one to keep another system in step automatically: each event is POSTed as JSON, signed, and retried for 24 hours if the other side is down." /> : (
        <ul className="space-y-2.5">
          {hooks.map((h) => (
            <li key={h.id} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-[13.5px]">{h.name}</b>
                {h.active ? <Badge tone="emerald" dot>Active</Badge> : <Badge tone={h.disabledReason ? 'rose' : 'slate'}>{h.disabledReason ? 'Switched off automatically' : 'Off'}</Badge>}
                {h.includePatient && <Badge tone="amber">patient details</Badge>}
                <span className="ml-auto text-[11.5px] text-muted">{h.delivered || 0} delivered · {h.failed || 0} failed{h.lastDeliveryAt ? ' · last ' + timeAgo(h.lastDeliveryAt) + ' (' + h.lastStatus + ')' : ''}</span>
              </div>
              <div className="mt-1 truncate font-mono text-[12px] text-muted" title={h.url}>{h.url}</div>
              <div className="mt-1 text-[11.5px] text-muted">Events: {h.events.includes('*') ? 'all' : h.events.join(', ')} · secret {h.secretHint}{h.lastTestAt ? ' · test ' + timeAgo(h.lastTestAt) + ': ' + h.lastTestResult : ''}</div>
              {h.disabledReason && <div className="mt-1 text-[12px] text-rose-600">{h.disabledReason} — fix the receiver, then switch it back on.</div>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="xs" icon={Send} loading={busy === h.id + 'test'} disabled={!admin} onClick={() => test(h)}>Send test</Button>
                <Button size="xs" icon={ListTree} onClick={() => setLog(h)}>Deliveries</Button>
                {admin && <Button size="xs" onClick={() => setForm(h)}>Edit</Button>}
                {admin && <Button size="xs" icon={Power} loading={busy === h.id} onClick={() => toggle(h)}>{h.active ? 'Switch off' : 'Switch on'}</Button>}
                {admin && <Button size="xs" icon={KeyRound} onClick={() => rotate(h)}>Rotate secret</Button>}
                {admin && <Button size="xs" variant="ghost" icon={Trash2} onClick={() => remove(h)}>Delete</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <details className="mt-3 rounded-lg border border-line p-2.5 text-[12.5px]">
        <summary className="cursor-pointer font-semibold">What the receiver gets, and how to check the signature</summary>
        <div className="mt-2 space-y-2">
          <p>A <code>POST</code> with a JSON body <code>{'{ id, type, createdAt, clinic, source, subject, data }'}</code> and the headers <code>X-SSDC-Event</code>, <code>X-SSDC-Delivery</code>, <code>X-SSDC-Timestamp</code> and <code>X-SSDC-Signature: sha256=HMAC(secret, "timestamp.body")</code>. Answer with any 2xx within 10 seconds; anything else is retried after 1 min, 5 min, 30 min, 2 h, 6 h and 12 h. Deliveries can repeat — use <code>id</code> to ignore duplicates.</p>
          <pre className="overflow-auto rounded bg-surface2 p-2 font-mono text-[11px] leading-snug">{`// Node.js — rawBody is the exact request body text
const crypto = require('crypto');
const ts = req.headers['x-ssdc-timestamp'];
const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(ts + '.' + rawBody).digest('hex');
const ok = expected === req.headers['x-ssdc-signature'] && Math.abs(Date.now() / 1000 - ts) < 300;`}</pre>
        </div>
      </details>
      <HookForm open={!!form} initial={form && form.id ? form : null} onClose={() => setForm(null)} onSaved={(s) => { if (s) setSecret(s); reload(); }} />
      <SecretOnce open={!!secret} secret={secret} onClose={() => setSecret('')} title="Webhook signing secret" />
      <DeliveriesDrawer hook={log} admin={admin} onClose={() => setLog(null)} />
    </Card>
  );
}

// ------------------------------------------------------------------ incoming webhook
function InboundCard({ data, admin, reload }) {
  const ib = (data && data.inbound) || { enabled: false, path: '', log: [], types: INBOUND_TYPES };
  const [secret, setSecret] = useState('');
  const [shown, setShown] = useState('');
  const url = ib.path ? location.origin + location.pathname.replace(/\/$/, '').replace(/\/index\.html$/, '') + ib.path : '';
  const run = async (fn) => { try { await fn(); } catch (e) { if (e.message !== 'cancelled') toast(e.message, 'error'); } finally { reload(); } };
  const enable = (on) => run(async () => { const r = await api('automation/inbound', { method: 'PUT', body: { enabled: on } }); if (r.secret) setSecret(r.secret); toast(on ? 'Incoming webhook switched on' : 'Incoming webhook switched off', 'success', 1600); });
  const rotate = () => run(async () => {
    if (!(await confirmDialog({ title: 'New address and secret?', message: 'The current URL and secret stop working at once.', confirmText: 'Rotate' }))) return;
    setSecret((await api('automation/inbound/rotate', { method: 'POST' })).secret);
  });
  const reveal = () => run(async () => setShown((await api('automation/inbound/reveal', { method: 'POST' })).secret));
  const example = INBOUND_TYPES.find((t) => t.type === 'payment.received');
  const curl = `BODY='${JSON.stringify({ type: 'payment.received', data: example.example })}'
TS=$(date +%s)
SIG="sha256=$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')"
curl -X POST "${url || 'https://<server>/api/webhooks/in/<key>'}" \\
  -H "Content-Type: application/json" -H "X-SSDC-Timestamp: $TS" \\
  -H "X-SSDC-Signature: $SIG" -H "X-SSDC-Delivery: $(date +%s%N)" -d "$BODY"`;
  return (
    <Card title="Incoming webhook" icon={Inbox} subtitle="Let a payment gateway, a kiosk or the lab analyzer update the clinic records directly"
      actions={<Badge tone={ib.enabled ? 'emerald' : 'slate'} dot={ib.enabled}>{ib.enabled ? 'On' : 'Off'}</Badge>}>
      <div className="space-y-3 text-[13px]">
        <Toggle checked={ib.enabled} disabled={!admin} onChange={enable} label="Accept signed requests from other systems" hint="Every request must carry an HMAC signature made with the secret, and a time stamp within 5 minutes" />
        {ib.enabled && url && (
          <>
            <Field label="URL"><CopyBox value={url} label="URL" /></Field>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted">Secret {ib.secretHint}</span>
              {admin && <Button size="xs" icon={Eye} onClick={reveal}>Show secret</Button>}
              {admin && <Button size="xs" icon={KeyRound} onClick={rotate}>Rotate URL &amp; secret</Button>}
            </div>
            {shown && <CopyBox value={shown} label="Secret" secret />}
          </>
        )}
        <div>
          <div className="mb-1 font-semibold">What other systems can send</div>
          <ul className="space-y-1.5">
            {ib.types.map((t) => (
              <li key={t.type} className="rounded-lg border border-line p-2">
                <div><code className="text-[12px] font-semibold">{t.type}</code> — {t.label}</div>
                {Object.keys(t.example).length > 0 && <code className="mt-0.5 block truncate text-[11px] text-muted">{JSON.stringify({ type: t.type, data: t.example })}</code>}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11.5px] text-muted">Payments are checked against the balance due and the UTR / reference (no double entry). Analyzer results only pre-fill the report — a technician still submits and the pathologist still verifies.</p>
        </div>
        <details className="rounded-lg border border-line p-2.5">
          <summary className="cursor-pointer font-semibold">Example request (bash)</summary>
          <pre className="mt-2 overflow-auto rounded bg-surface2 p-2 font-mono text-[11px] leading-snug">{curl}</pre>
        </details>
        {ib.log && ib.log.length > 0 && (
          <div>
            <div className="mb-1 font-semibold">Recent requests</div>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {ib.log.map((l, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-[12px]">
                  {l.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-rose-600" />}
                  <code className="text-[11.5px]">{l.type || '—'}</code>
                  <span className="min-w-0 flex-1 truncate text-muted" title={l.detail}>{l.detail}</span>
                  <span className="text-[11px] text-muted">HTTP {l.status} · {timeAgo(l.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <SecretOnce open={!!secret} secret={secret} onClose={() => setSecret('')} title="Incoming webhook secret" />
    </Card>
  );
}

export function AutomationTab() {
  const admin = can('settings:manage_clinic_and_integrations');
  const view = can('settings:manage_clinic_and_integrations', 'READ');
  const [data, setData] = useState(null);
  const reload = useCallback(() => { if (isServer() && view) api('automation/overview').then(setData).catch((e) => toast('Automation: ' + e.message, 'error')); }, [view]);
  useEffect(() => { reload(); const t = setInterval(reload, 15000); return () => clearInterval(t); }, [reload]);
  const [tick, setTick] = useState(0);
  useEvent('automation:event', () => setTick((t) => t + 1));
  useEffect(() => { if (!tick) return undefined; const t = setTimeout(reload, 1200); return () => clearTimeout(t); }, [tick, reload]);
  const counts = (data && data.counts) || {};
  const summary = useMemo(() => [
    { label: 'Events in 24 h', value: counts.events24h || 0 },
    { label: 'Waiting to process', value: counts.queued || 0 },
    { label: 'Webhook retries pending', value: counts.pendingDeliveries || 0 }
  ], [counts.events24h, counts.queued, counts.pendingDeliveries]);
  if (!isServer()) return <Card title="Automation" icon={Workflow}><Empty icon={Workflow} title="Runs on the clinic server" text="Automations and webhooks need the clinic server version (start-windows.bat on the clinic PC, or the Render deployment)." /></Card>;
  if (!view) return <Card title="Automation" icon={Workflow}><Empty icon={ShieldCheck} title="No access" text="Needs the Settings & integrations permission." /></Card>;
  return (
    <div className="grid gap-4">
      <Card title="How the automation works" icon={Zap}>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <ol className="list-decimal space-y-1 pl-5 text-[13px]">
            <li>Every save — registration, bill, report, lab result, message — reaches the clinic server and becomes an <b>event</b> such as <code>invoice.paid</code> or <code>report.signed</code>.</li>
            <li>The server’s <b>automations</b> move the patient along: the queue, the bill link and the visit status update themselves on every screen.</li>
            <li><b>Webhooks</b> pass each event to other systems, and let them send payments, queue updates and analyzer results back in.</li>
          </ol>
          <div className="grid grid-cols-3 gap-2">
            {summary.map((s) => <div key={s.label} className="rounded-xl bg-surface2/70 p-3 text-center"><div className="font-display text-2xl font-extrabold tnum">{s.value}</div><div className="text-[11px] text-muted">{s.label}</div></div>)}
          </div>
        </div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <AutomationsCard data={data} admin={admin} />
        <EventsCard admin={admin} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <WebhooksCard data={data} admin={admin} reload={reload} />
        <InboundCard data={data} admin={admin} reload={reload} />
      </div>
    </div>
  );
}
