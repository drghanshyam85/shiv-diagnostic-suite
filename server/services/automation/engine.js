/*
 * Event-driven automation engine (clinic server).
 *
 *   any write ── ctx.saveDoc() ──► bus "change" ──► deriveEvents() ──► sysEvents (durable log, "pending")
 *                                                                          │  serial worker
 *                                    ┌─────────────────────────────────────┴───────────────────────────┐
 *                          workflow automations                                         outgoing webhooks
 *            (idempotent state transitions written back           (sysDeliveries: HMAC-signed POST, retried
 *             through saveDoc → realtime to every workstation)       1 min … 12 h, then "dead")
 *
 *   POST /api/webhooks/in/<key>  (HMAC-signed, replay-protected) ──► payment / queue status / lab results
 *                                                                    ──► saveDoc ──► events …
 *
 * Guarantees: every event is stored before it is processed and re-queued after a restart (at-least-once);
 * automations read the current record and write only when something must change (safe to repeat);
 * automation writes carry the actor "automation" and are audited by their own events.
 */
'use strict';

const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { deriveEvents } = require('./derive');
const { AUTOMATIONS, EVENT_TYPES, EVENT_TYPE_SET, QUEUE_STATUS, REPORT_MODALITIES, PAYMENT_MODES, INBOUND_TYPES } = require('../../../shared/events');

const ACTOR = { id: 'automation', name: 'Automation', role: 'SYSTEM' };
const WEBHOOK_ACTOR = { id: 'webhook', name: 'Inbound webhook', role: 'SYSTEM' };
const EVENTS = 'sysEvents';
const DELIVERIES = 'sysDeliveries';
const HOOKS_KV = 'automation:webhooks';
const INBOUND_KV = 'automation:inbound';
const STATS_KV = 'automation:stats';
const INBOUND_LOG_KV = 'automation:inboundLog';
const RETRY_SECONDS = [60, 300, 1800, 7200, 21600, 43200]; // after the first try: 1 min, 5 min, 30 min, 2 h, 6 h, 12 h
const KEEP_MS = 30 * 86400000;
const RING = 300;
const MAX_HOOKS = 20;
const GROUP_OF = Object.fromEntries(EVENT_TYPES.map((e) => [e.type, e.group]));

const rid = (p) => p + crypto.randomBytes(9).toString('base64url');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const paidOf = (inv) => round2(((inv && inv.payments) || []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
const bump = (doc) => Object.assign({}, doc, { updatedAt: Math.max(Date.now(), (Number(doc.updatedAt) || 0) + 1) });
const httpError = (status, message) => Object.assign(new Error(message), { status });

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
/** Signature sent with every webhook and expected on every inbound call: sha256=HMAC(secret, "<timestamp>.<body>") */
function signBody(secret, ts, body) { return 'sha256=' + crypto.createHmac('sha256', String(secret)).update(String(ts) + '.' + body).digest('hex'); }
const maskSecret = (s) => (s ? String(s).slice(0, 6) + '…' + String(s).slice(-4) : '');

function blockedIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 127 || a === 0 || (a === 169 && b === 254) || a >= 224;
  }
  const x = String(ip).toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff') || /^::ffff:(127|169\.254|0)\./.test(x);
}

function createAutomation(ctx, { io, audit }) {
  const ring = []; // newest first — the live event view
  const queue = []; // events waiting to be processed (in order)
  const pending = new Map(); // deliveries waiting for a (re)try
  const seenInbound = new Map(); // inbound delivery id → result (replay protection, 24 h)
  const rate = new Map(); // inbound key → [timestamps]
  let stats = {};
  let statsDirty = false;
  let working = false;
  let delivering = false;
  const timers = [];
  const allowLocal = process.env.WEBHOOKS_ALLOW_LOCAL === '1';

  const emitLive = (evt) => { try { io.emit('automation:event', { id: evt.id, type: evt.type, at: evt.at, status: evt.status, subject: evt.subject, automations: evt.automations, deliveries: evt.deliveries }); } catch (e) { /* no sockets */ } };
  const ringPut = (evt) => {
    const i = ring.findIndex((x) => x.id === evt.id);
    if (i >= 0) ring[i] = evt; else { ring.unshift(evt); if (ring.length > RING) ring.length = RING; }
  };

  // ------------------------------------------------------------------ events
  async function recordEvent(raw, actor, source) {
    if (!EVENT_TYPE_SET.has(raw.type)) return null;
    const evt = {
      id: rid('evt_'), type: raw.type, at: Date.now(), source: source || 'change',
      actor: actor ? { id: String(actor.id || ''), name: String(actor.name || '') } : null,
      subject: { coll: raw.coll, id: raw.id }, data: raw.data || {}, status: 'pending', automations: {}, deliveries: 0, updatedAt: Date.now()
    };
    await ctx.store.putDoc(EVENTS, evt, { force: true });
    ringPut(evt);
    queue.push(evt);
    kick();
    return evt;
  }

  ctx.bus.on('change', (ch) => {
    if (!ch || ch.coll === EVENTS || ch.coll === DELIVERIES) return;
    let list = [];
    try { list = deriveEvents(ch); } catch (e) { console.warn('[automation] could not derive events:', e.message); return; }
    const who = ch.actor && ch.actor.id;
    const source = who === ACTOR.id ? 'automation' : who === WEBHOOK_ACTOR.id ? 'webhook' : 'change';
    list.forEach((raw) => { recordEvent(raw, ch.actor, source).catch((e) => console.warn('[automation] could not record event:', e.message)); });
  });

  function kick() { if (!working) { working = true; setImmediate(drain); } }
  async function drain() {
    try {
      while (queue.length) {
        const evt = queue.shift();
        try { await processEvent(evt); } catch (e) {
          evt.status = 'error';
          evt.error = e.message;
          await ctx.store.putDoc(EVENTS, bump(evt), { force: true }).catch(() => {});
          ringPut(evt);
        }
      }
    } finally { working = false; if (queue.length) kick(); }
  }

  const ruleOn = (rules, a) => (rules[a.id] === undefined ? a.default : rules[a.id] === true);

  async function processEvent(evt) {
    const settings = await ctx.getSettings();
    const rules = (settings.automation && settings.automation.rules) || {};
    for (const a of AUTOMATIONS) {
      if (!a.on.includes(evt.type)) continue;
      if (!ruleOn(rules, a)) { evt.automations[a.id] = 'switched off'; continue; }
      const st = stats[a.id] || (stats[a.id] = { runs: 0, changed: 0, errors: 0, lastAt: 0, lastResult: '' });
      st.runs += 1;
      st.lastAt = Date.now();
      try {
        const res = await HANDLERS[a.id](evt);
        evt.automations[a.id] = res.text;
        st.lastResult = res.text;
        if (res.changed) st.changed += 1;
      } catch (e) {
        evt.automations[a.id] = 'error: ' + e.message;
        st.errors += 1;
        st.lastResult = 'error: ' + e.message;
      }
      statsDirty = true;
    }
    for (const h of await listHooks()) {
      if (!h.active || !hookWants(h, evt.type)) continue;
      await queueDelivery(h, evt);
      evt.deliveries += 1;
    }
    evt.status = 'done';
    evt.processedAt = Date.now();
    const saved = (await ctx.store.putDoc(EVENTS, bump(evt), { force: true })).doc;
    ringPut(saved);
    emitLive(saved);
  }

  // ------------------------------------------------------------------ automations
  // a visit in the recycle bin (or deleted) is left alone by every automation
  const getVisit = async (id) => { const v = id ? await ctx.store.getDoc('visits', id) : null; return v && !v._deleted ? v : null; };
  async function saveVisit(v, patch, actor) {
    const next = bump(Object.assign({}, v, patch));
    await ctx.saveDoc('visits', next, { actor: actor || ACTOR, force: true });
    return next;
  }
  function withStatus(v, changes, by) {
    const st = Object.assign({}, v.status || {});
    const log = (v.statusLog || []).slice();
    Object.entries(changes).forEach(([m, s]) => { st[m] = s; log.push({ at: Date.now(), modality: m, status: s, by }); });
    return { status: st, statusLog: log.slice(-30) };
  }

  const HANDLERS = {
    'visit.billing-link': async (evt) => {
      const inv = await ctx.store.getDoc('invoices', evt.subject.id);
      if (!inv || inv._deleted) return { text: 'bill not found' };
      if (!inv.visitId) return { text: 'bill without a visit (walk-in / cash book)' };
      const v = await getVisit(inv.visitId);
      if (!v) return { text: 'visit not found' };
      if (v.billed && v.invoiceId) return { text: 'already linked' };
      await saveVisit(v, { billed: true, invoiceId: v.invoiceId || inv.id });
      return { text: 'visit marked billed', changed: true };
    },
    'queue.report-started': async (evt) => {
      const v = await getVisit(evt.data.visitId);
      if (!v) return { text: 'no visit' };
      const mods = REPORT_MODALITIES.filter((m) => v.tokens && v.tokens[m]);
      const m = mods.length === 1 ? mods[0] : mods.includes(evt.data.modality) ? evt.data.modality : null;
      if (!m) return { text: 'no matching queue token' };
      const cur = (v.status || {})[m] || 'Waiting';
      if (cur !== 'Waiting') return { text: m + ' already ' + cur };
      await saveVisit(v, withStatus(v, { [m]: 'In Scan/Sample' }, 'automation'));
      return { text: m + ' → In Scan', changed: true };
    },
    'queue.report-signed': async (evt) => {
      const v = await getVisit(evt.data.visitId);
      if (!v) return { text: 'no visit' };
      const todo = REPORT_MODALITIES.filter((m) => v.tokens && v.tokens[m] && (v.status || {})[m] !== 'Completed');
      if (!todo.length) return { text: 'already completed' };
      await saveVisit(v, withStatus(v, Object.fromEntries(todo.map((m) => [m, 'Completed'])), 'automation'));
      return { text: todo.join(', ') + ' → Completed', changed: true };
    },
    'queue.lab-progress': async (evt) => {
      const v = await getVisit(evt.data.visitId);
      if (!v || !v.tokens || !v.tokens.LAB) return { text: 'no lab token on the visit' };
      const cur = (v.status || {}).LAB || 'Waiting';
      let want = 'In Scan/Sample';
      if (evt.type === 'lab.verified') {
        const open = (await ctx.store.listDocs('labReports')).filter((r) => r.visitId === v.id && r.status !== 'SIGNED_FINAL');
        if (open.length) return { text: open.length + ' other lab report(s) still open' };
        want = 'Completed';
      }
      if (cur === want || (want === 'In Scan/Sample' && cur === 'Completed')) return { text: 'LAB already ' + cur };
      await saveVisit(v, withStatus(v, { LAB: want }, 'automation'));
      return { text: 'LAB → ' + want, changed: true };
    },
    'visit.complete': async (evt) => {
      const v = await getVisit(evt.data.visitId);
      if (!v) return { text: 'no visit' };
      if (v.closedAt) return { text: 'already closed' };
      const mods = Object.keys(v.tokens || {}).filter((k) => k !== 'combined');
      if (!mods.length) return { text: 'no tests on the visit' };
      const open = mods.filter((m) => (v.status || {})[m] !== 'Completed');
      if (open.length) return { text: 'still open: ' + open.join(', ') };
      const bills = (await ctx.store.listDocs('invoices')).filter((i) => i.visitId === v.id && i.status !== 'CANCELLED');
      if (!bills.length) return { text: 'not billed yet' };
      const due = bills.filter((i) => !['PAID', 'CASHLESS'].includes(i.status));
      if (due.length) return { text: 'balance due on ' + due.map((i) => i.invoiceNo).join(', ') };
      await saveVisit(v, { closedAt: Date.now(), closedBy: 'automation' });
      return { text: 'visit closed', changed: true };
    }
  };

  // ------------------------------------------------------------------ outgoing webhooks
  async function listHooks() { return (await ctx.store.kvGet(HOOKS_KV, [])) || []; }
  async function saveHooks(list) { await ctx.store.kvSet(HOOKS_KV, list); }
  async function patchHook(id, patch) {
    const list = await listHooks();
    const i = list.findIndex((h) => h.id === id);
    if (i < 0) return null;
    list[i] = Object.assign({}, list[i], patch, { updatedAt: Date.now() });
    await saveHooks(list);
    return list[i];
  }
  const hookWants = (h, type) => {
    if (type === 'webhook.test') return false;
    const ev = h.events || [];
    return !ev.length || ev.includes('*') || ev.includes(type) || ev.includes(type.split('.')[0] + '.*');
  };

  async function queueDelivery(h, evt) {
    const d = { id: rid('dlv_'), hookId: h.id, eventId: evt.id, type: evt.type, status: 'pending', attempts: 0, nextAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now() };
    await ctx.store.putDoc(DELIVERIES, d, { force: true });
    pending.set(d.id, d);
    setImmediate(deliverDue);
  }

  async function assertSafeUrl(u) {
    let url;
    try { url = new URL(u); } catch (e) { throw httpError(400, 'Not a valid URL'); }
    if (!/^https?:$/.test(url.protocol)) throw httpError(400, 'Only http:// or https:// URLs');
    if (allowLocal) return url;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
    for (const a of addrs) if (blockedIp(a)) throw httpError(400, 'The address ' + a + ' is not allowed for webhooks');
    return url;
  }

  async function payloadFor(evt, h) {
    const s = await ctx.getSettings();
    const p = {
      id: evt.id, type: evt.type, createdAt: new Date(evt.at).toISOString(), clinic: (s.clinic && s.clinic.name) || '',
      source: evt.source, subject: { collection: evt.subject.coll, id: evt.subject.id }, data: evt.data
    };
    if (h.includePatient && evt.data && evt.data.patientId) {
      const pt = await ctx.store.getDoc('patients', evt.data.patientId);
      if (pt && !pt._deleted) p.patient = { id: pt.id, regId: pt.regId || '', name: [pt.title, pt.name].filter(Boolean).join(' '), mobile: pt.mobile || '', gender: pt.gender || '', age: pt.age === undefined || pt.age === '' ? '' : String(pt.age) + (pt.ageUnit && pt.ageUnit !== 'Years' ? ' ' + pt.ageUnit : '') };
    }
    return p;
  }

  async function post(h, body, type, deliveryId) {
    const t0 = Date.now();
    try {
      await assertSafeUrl(h.url);
      const ts = Math.floor(Date.now() / 1000);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      let res;
      try {
        res = await fetch(h.url, {
          method: 'POST', redirect: 'manual', signal: ctrl.signal, body,
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'SSDC-Webhooks/1.0', 'X-SSDC-Event': type, 'X-SSDC-Delivery': deliveryId, 'X-SSDC-Timestamp': String(ts), 'X-SSDC-Signature': signBody(h.secret, ts, body) }
        });
      } finally { clearTimeout(timer); }
      const text = await res.text().catch(() => '');
      const ok = res.status >= 200 && res.status < 300;
      return { ok, code: res.status, error: ok ? '' : (res.status >= 300 && res.status < 400 ? 'redirects are not followed — use the final URL' : text.slice(0, 200) || 'HTTP ' + res.status), ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, code: 0, error: e.name === 'AbortError' ? 'no answer within 10 s' : e.message, ms: Date.now() - t0 };
    }
  }

  async function deliverDue() {
    if (delivering) return;
    delivering = true;
    try {
      const now = Date.now();
      const due = [...pending.values()].filter((d) => d.nextAt <= now).sort((a, b) => a.nextAt - b.nextAt).slice(0, 25);
      for (const d of due) await attempt(d);
    } catch (e) { console.warn('[automation] delivery worker:', e.message); } finally { delivering = false; }
  }

  async function attempt(d) {
    const h = (await listHooks()).find((x) => x.id === d.hookId);
    if (!h || !h.active) return finish(d, { status: 'cancelled', lastError: 'endpoint removed or switched off' });
    const evt = await ctx.store.getDoc(EVENTS, d.eventId);
    if (!evt) return finish(d, { status: 'cancelled', lastError: 'event no longer stored' });
    const body = JSON.stringify(await payloadFor(evt, h));
    const r = await post(h, body, evt.type, d.id);
    const attempts = d.attempts + 1;
    const common = { attempts, lastAt: Date.now(), lastCode: r.code, lastError: r.error, durationMs: r.ms };
    if (r.ok) {
      await finish(d, Object.assign(common, { status: 'delivered' }));
      await patchHook(h.id, { lastDeliveryAt: Date.now(), lastStatus: 'HTTP ' + r.code, deadStreak: 0, delivered: (h.delivered || 0) + 1 });
      return null;
    }
    if (r.code === 410 || attempts > RETRY_SECONDS.length) {
      await finish(d, Object.assign(common, { status: 'dead' }));
      const streak = (h.deadStreak || 0) + 1;
      const off = r.code === 410 || streak >= 10;
      await patchHook(h.id, Object.assign({ lastDeliveryAt: Date.now(), lastStatus: r.code ? 'HTTP ' + r.code : r.error, deadStreak: streak, failed: (h.failed || 0) + 1 },
        off ? { active: false, disabledReason: r.code === 410 ? 'The endpoint answered 410 Gone' : '10 deliveries in a row failed after every retry', disabledAt: Date.now() } : {}));
      if (off) {
        try { io.emit('notify', { type: 'warning', text: 'Webhook “' + h.name + '” was switched off: ' + (r.code === 410 ? 'the endpoint answered 410 Gone' : 'deliveries keep failing') + '. Check it in Settings → Automation.' }); } catch (e) { /* ignore */ }
        await audit.log(ACTOR, 'automation:webhook_disabled', 'webhooks/' + h.id, { name: h.name, reason: r.code === 410 ? '410' : 'failures' });
      }
      return null;
    }
    d.status = 'retrying';
    d.nextAt = Date.now() + RETRY_SECONDS[attempts - 1] * 1000;
    Object.assign(d, common);
    await ctx.store.putDoc(DELIVERIES, bump(d), { force: true });
    await patchHook(h.id, { lastDeliveryAt: Date.now(), lastStatus: r.code ? 'HTTP ' + r.code : r.error });
    return null;
  }
  async function finish(d, patch) {
    pending.delete(d.id);
    Object.assign(d, patch, { nextAt: 0 });
    await ctx.store.putDoc(DELIVERIES, bump(d), { force: true });
    return null;
  }

  function validEvents(list) {
    const out = [...new Set((Array.isArray(list) ? list : []).map(String))].filter((t) => t === '*' || EVENT_TYPE_SET.has(t) || /^[a-z]+\.\*$/.test(t));
    return out.length ? out : ['*'];
  }
  const publicHook = (h) => Object.assign({}, h, { secret: undefined, secretHint: maskSecret(h.secret) });

  async function createHook(body, user) {
    const list = await listHooks();
    if (list.length >= MAX_HOOKS) throw httpError(400, 'At most ' + MAX_HOOKS + ' webhook endpoints');
    const name = String(body.name || '').trim().slice(0, 60);
    const url = String(body.url || '').trim().slice(0, 500);
    if (!name) throw httpError(400, 'Give the endpoint a name');
    await assertSafeUrl(url);
    const h = {
      id: rid('wh_'), name, url, events: validEvents(body.events), includePatient: body.includePatient === true, active: true,
      secret: 'whsec_' + crypto.randomBytes(24).toString('base64url'), createdAt: Date.now(), updatedAt: Date.now(), createdBy: user ? user.id : '', delivered: 0, failed: 0, deadStreak: 0
    };
    list.push(h);
    await saveHooks(list);
    return h; // the only response that carries the full secret (and rotateSecret's)
  }
  async function updateHook(id, body) {
    const patch = {};
    if (body.name !== undefined) patch.name = String(body.name).trim().slice(0, 60) || 'Webhook';
    if (body.url !== undefined) { patch.url = String(body.url).trim().slice(0, 500); await assertSafeUrl(patch.url); }
    if (body.events !== undefined) patch.events = validEvents(body.events);
    if (body.includePatient !== undefined) patch.includePatient = body.includePatient === true;
    if (body.active !== undefined) { patch.active = body.active === true; if (patch.active) Object.assign(patch, { disabledReason: '', deadStreak: 0 }); }
    const h = await patchHook(id, patch);
    if (!h) throw httpError(404, 'Webhook not found');
    return h;
  }
  async function deleteHook(id) {
    const list = await listHooks();
    const next = list.filter((h) => h.id !== id);
    if (next.length === list.length) throw httpError(404, 'Webhook not found');
    await saveHooks(next);
    for (const d of [...pending.values()]) if (d.hookId === id) await finish(d, { status: 'cancelled', lastError: 'endpoint deleted' });
  }
  async function rotateSecret(id) {
    const h = await patchHook(id, { secret: 'whsec_' + crypto.randomBytes(24).toString('base64url') });
    if (!h) throw httpError(404, 'Webhook not found');
    return h;
  }
  async function sendTest(id) {
    const h = (await listHooks()).find((x) => x.id === id);
    if (!h) throw httpError(404, 'Webhook not found');
    const s = await ctx.getSettings();
    const body = JSON.stringify({
      id: rid('evt_test_'), type: 'webhook.test', createdAt: new Date().toISOString(), clinic: (s.clinic && s.clinic.name) || '', source: 'test',
      subject: { collection: 'system', id: 'test' }, data: { message: 'Test event — the signature header lets you check it came from the clinic server.' }
    });
    const r = await post(h, body, 'webhook.test', rid('dlv_test_'));
    await patchHook(id, { lastTestAt: Date.now(), lastTestResult: r.ok ? 'HTTP ' + r.code + ' · ' + r.ms + ' ms' : (r.code ? 'HTTP ' + r.code + ' · ' : '') + r.error });
    return r;
  }
  async function deliveriesFor(hookId, limit = 50) {
    return (await ctx.store.listDocs(DELIVERIES)).filter((d) => !hookId || d.hookId === hookId).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }
  async function retryDelivery(id) {
    const d = (await ctx.store.getDoc(DELIVERIES, id));
    if (!d) throw httpError(404, 'Delivery not found');
    Object.assign(d, { status: 'pending', nextAt: Date.now(), lastError: '' });
    await ctx.store.putDoc(DELIVERIES, bump(d), { force: true });
    pending.set(d.id, d);
    setImmediate(deliverDue);
    return d;
  }

  // ------------------------------------------------------------------ incoming webhooks
  async function inboundConfig() { return (await ctx.store.kvGet(INBOUND_KV, null)) || { enabled: false, key: '', secret: '' }; }
  async function setInbound(patch) {
    const cur = await inboundConfig();
    const next = Object.assign({}, cur, patch, { updatedAt: Date.now() });
    if (next.enabled && (!next.key || !next.secret)) Object.assign(next, { key: crypto.randomBytes(18).toString('base64url'), secret: 'whsec_' + crypto.randomBytes(24).toString('base64url') });
    await ctx.store.kvSet(INBOUND_KV, next);
    return next;
  }
  async function rotateInbound() { return setInbound({ enabled: true, key: crypto.randomBytes(18).toString('base64url'), secret: 'whsec_' + crypto.randomBytes(24).toString('base64url') }); }

  function clinicDay(settings, offsetDays = 0) {
    const tz = (settings.clinic && settings.clinic.timezone) || 'Asia/Kolkata';
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offsetDays * 86400000)); } catch (e) { return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10); }
  }

  const INBOUND = {
    ping: async () => ({ pong: true, at: Date.now() }),
    'payment.received': async (d) => {
      const amount = round2(d.amount);
      if (!(amount > 0)) throw httpError(400, 'amount must be a positive number');
      const mode = String(d.mode || 'upi').toLowerCase();
      if (!PAYMENT_MODES.includes(mode)) throw httpError(400, 'mode must be one of: ' + PAYMENT_MODES.join(', '));
      if (!d.invoiceId && !d.invoiceNo) throw httpError(400, 'invoiceNo (or invoiceId) required');
      const inv = (await ctx.store.listDocs('invoices')).find((i) => (d.invoiceId && i.id === d.invoiceId) || (d.invoiceNo && String(i.invoiceNo || '').toUpperCase() === String(d.invoiceNo).trim().toUpperCase()));
      if (!inv) throw httpError(404, 'Bill not found');
      if (inv.billingType === 'umid' || inv.status === 'CASHLESS') throw httpError(409, 'This is a cashless bill — no payment is due');
      const ref = String(d.reference || d.utr || '').trim().slice(0, 64);
      if (ref && (inv.payments || []).some((p) => p.ref === ref || (p.note && p.note === ref))) return { duplicate: true, invoiceNo: inv.invoiceNo, status: inv.status, balance: inv.balance };
      const balance = round2(Math.max(0, (Number(inv.net) || 0) - paidOf(inv)));
      if (balance <= 0) throw httpError(409, 'Bill ' + inv.invoiceNo + ' is already paid in full');
      if (amount > balance + 0.01) throw httpError(409, 'Amount ' + amount + ' is more than the balance due (' + balance + ')');
      const pay = { id: rid('pay_'), at: Number(d.at) || Date.now(), mode, amount, staffId: 'webhook', note: ref, ref, source: 'webhook', payer: String(d.payer || '').slice(0, 60) };
      const next = Object.assign({}, inv, { payments: (inv.payments || []).concat([pay]) });
      next.paid = paidOf(next);
      next.balance = Math.max(0, round2((Number(next.net) || 0) - next.paid));
      next.status = next.paid >= (Number(next.net) || 0) - 0.009 ? 'PAID' : next.paid > 0 ? 'PARTIAL' : 'DUE';
      const modes = [...new Set(next.payments.filter((p) => Number(p.amount) > 0).map((p) => p.mode))];
      if (modes.length) next.paymentMode = modes.length > 1 ? 'split' : modes[0];
      await ctx.saveDoc('invoices', bump(next), { actor: WEBHOOK_ACTOR, force: true });
      await audit.log(WEBHOOK_ACTOR, 'billing:payment_webhook', 'invoices/' + inv.id, { invoiceNo: inv.invoiceNo, amount, mode, ref });
      return { invoiceNo: inv.invoiceNo, status: next.status, paid: next.paid, balance: next.balance };
    },
    'visit.status': async (d) => {
      const want = String(d.status || '').trim().toLowerCase();
      const status = QUEUE_STATUS.find((s) => s.toLowerCase() === want) || (/^in[ -]?(scan|sample|progress)/.test(want) ? 'In Scan/Sample' : /^(done|complete)/.test(want) ? 'Completed' : null);
      if (!status) throw httpError(400, 'status must be one of: ' + QUEUE_STATUS.join(', '));
      let m = String(d.modality || '').trim().toUpperCase();
      let v = d.visitId ? await ctx.store.getDoc('visits', String(d.visitId)) : null;
      if (v && v._deleted) v = null;
      if (!v && d.token) {
        const settings = await ctx.getSettings();
        const tok = String(d.token).toUpperCase().replace(/\s+/g, '');
        const days = d.date ? [String(d.date)] : [clinicDay(settings), clinicDay(settings, -1)];
        const visits = (await ctx.store.listDocs('visits')).filter((x) => days.includes(x.dateKey)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        v = visits.find((x) => Object.entries(x.tokens || {}).some(([k, t]) => k !== 'combined' && String(t).toUpperCase().replace(/\s+/g, '') === tok && (!m || k === m))) || null;
        if (v && !m) m = Object.keys(v.tokens).find((k) => k !== 'combined' && String(v.tokens[k]).toUpperCase().replace(/\s+/g, '') === tok);
      }
      if (!v) throw httpError(404, 'Visit not found');
      if (!m || !v.tokens || !v.tokens[m]) throw httpError(400, 'modality missing or not on this visit');
      if ((v.status || {})[m] === status) return { unchanged: true, visitId: v.id, token: v.tokens[m], modality: m, status };
      await saveVisit(v, withStatus(v, { [m]: status }, 'webhook'), WEBHOOK_ACTOR);
      return { visitId: v.id, token: v.tokens[m], modality: m, status };
    },
    'lab.results': async (d) => {
      const sid = String(d.sampleId || '').trim();
      if (!sid) throw httpError(400, 'sampleId required');
      const rep = (await ctx.store.listDocs('labReports')).find((r) => String(r.sampleId || '').toUpperCase() === sid.toUpperCase());
      if (!rep) throw httpError(404, 'Sample not found');
      if (rep.status === 'PENDING') throw httpError(409, 'The sample has not been collected yet');
      if (rep.status === 'SUBMITTED' || rep.status === 'SIGNED_FINAL') throw httpError(409, 'The report is already ' + (rep.status === 'SUBMITTED' ? 'submitted for verification' : 'signed') + ' — results were not changed');
      const panels = new Set((rep.tests || []).map((t) => t.panel).filter(Boolean));
      const vals = JSON.parse(JSON.stringify(rep.values || {}));
      const ignored = [];
      let n = 0;
      for (const [panel, params] of Object.entries(d.values || {})) {
        if (!params || typeof params !== 'object' || (panels.size && !panels.has(panel))) { ignored.push(panel); continue; }
        vals[panel] = Object.assign({}, vals[panel] || {});
        for (const [k, val] of Object.entries(params)) {
          if (val === null || val === undefined || String(val).trim() === '') continue;
          vals[panel][String(k).slice(0, 40)] = String(val).trim().slice(0, 40);
          n += 1;
        }
      }
      if (!n) throw httpError(400, 'No usable values' + (ignored.length ? ' (unknown panels: ' + ignored.join(', ') + ')' : ''));
      const next = Object.assign({}, rep, { values: vals, status: rep.status === 'SAMPLE_COLLECTED' ? 'DRAFT' : rep.status, analyzer: { at: Date.now(), source: String(d.source || 'webhook').slice(0, 40), fields: n } });
      await ctx.saveDoc('labReports', bump(next), { actor: WEBHOOK_ACTOR, force: true });
      await audit.log(WEBHOOK_ACTOR, 'lab:results_webhook', 'labReports/' + rep.id, { sampleId: rep.sampleId, fields: n });
      return { sampleId: rep.sampleId, fields: n, status: next.status, ignoredPanels: ignored };
    }
  };

  async function logInbound(entry) {
    const log = ((await ctx.store.kvGet(INBOUND_LOG_KV, [])) || []).slice(0, 99);
    log.unshift(entry);
    await ctx.store.kvSet(INBOUND_LOG_KV, log);
  }

  /** POST /api/webhooks/in/:key — returns { status, body } */
  async function handleInbound(req) {
    const cfg = await inboundConfig();
    if (!cfg.enabled || !cfg.key || !safeEqual(req.params.key, cfg.key)) return { status: 404, body: { ok: false, error: 'Not found' } };
    const now = Date.now();
    const hits = (rate.get(cfg.key) || []).filter((t) => now - t < 60000);
    if (hits.length >= 120) return { status: 429, body: { ok: false, error: 'Too many requests — at most 120 a minute' } };
    hits.push(now);
    rate.set(cfg.key, hits);
    const ts = Number(req.headers['x-ssdc-timestamp']);
    if (!ts || Math.abs(now / 1000 - ts) > 300) return { status: 401, body: { ok: false, error: 'X-SSDC-Timestamp missing or more than 5 minutes off' } };
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
    if (!safeEqual(req.headers['x-ssdc-signature'], signBody(cfg.secret, ts, raw))) return { status: 401, body: { ok: false, error: 'Bad signature' } };
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const id = String(req.headers['x-ssdc-delivery'] || body.id || '').slice(0, 80);
    for (const [k, v] of seenInbound) if (now - v.at > 86400000) seenInbound.delete(k);
    if (id && seenInbound.has(id)) return { status: 200, body: Object.assign({ ok: true, duplicate: true }, seenInbound.get(id).body) };
    const type = String(body.type || '');
    const fn = INBOUND[type];
    let out;
    if (!fn) out = { status: 400, body: { ok: false, error: 'Unknown type — use one of: ' + INBOUND_TYPES.map((t) => t.type).join(', ') } };
    else {
      try { out = { status: 200, body: { ok: true, type, result: await fn(body.data || {}) } }; } catch (e) { out = { status: e.status || 500, body: { ok: false, type, error: e.message } }; }
    }
    if (id && out.status < 500) seenInbound.set(id, { at: now, body: out.body });
    await logInbound({ at: now, id, type, status: out.status, ok: !!out.body.ok, detail: out.body.ok ? summarize(out.body.result) : out.body.error, ip: String(req.ip || '').replace(/^::ffff:/, '') }).catch(() => {});
    return out;
  }
  const summarize = (r) => (!r ? '' : r.duplicate ? 'duplicate — already applied' : r.invoiceNo ? r.invoiceNo + ' · ' + r.status + ' · balance ' + r.balance : r.sampleId ? r.sampleId + ' · ' + r.fields + ' value(s)' : r.token ? r.token + ' → ' + r.status : r.pong ? 'pong' : '');

  // ------------------------------------------------------------------ admin views
  async function overview() {
    const settings = await ctx.getSettings();
    const rules = (settings.automation && settings.automation.rules) || {};
    const hooks = await listHooks();
    const inbound = await inboundConfig();
    const since = Date.now() - 86400000;
    return {
      automations: AUTOMATIONS.map((a) => Object.assign({}, a, { enabled: ruleOn(rules, a), stats: stats[a.id] || { runs: 0, changed: 0, errors: 0, lastAt: 0, lastResult: '' } })),
      webhooks: hooks.map(publicHook),
      inbound: { enabled: !!inbound.enabled, path: inbound.key ? '/api/webhooks/in/' + inbound.key : '', secretHint: maskSecret(inbound.secret), log: ((await ctx.store.kvGet(INBOUND_LOG_KV, [])) || []).slice(0, 20), types: INBOUND_TYPES },
      counts: { events24h: ring.filter((e) => e.at >= since).length, queued: queue.length, pendingDeliveries: pending.size },
      eventTypes: EVENT_TYPES
    };
  }
  async function listEvents({ limit = 60, before = 0, type = '', group = '' } = {}) {
    const match = (e) => (!type || e.type === type) && (!group || GROUP_OF[e.type] === group) && (!before || e.at < before);
    let list = ring.filter(match);
    if (list.length < limit && (before || ring.length >= RING)) list = (await ctx.store.listDocs(EVENTS)).filter(match).sort((a, b) => b.at - a.at);
    return list.slice(0, Math.min(200, limit));
  }
  async function replay(id) {
    const evt = await ctx.store.getDoc(EVENTS, id);
    if (!evt) throw httpError(404, 'Event not found');
    const again = Object.assign({}, evt, { status: 'pending', automations: {}, deliveries: 0, replayedAt: Date.now() });
    await ctx.store.putDoc(EVENTS, bump(again), { force: true });
    queue.push(again);
    kick();
    return again;
  }

  async function prune() {
    const before = Date.now() - KEEP_MS;
    try {
      const a = await ctx.store.purgeDocs(EVENTS, before);
      const b = await ctx.store.purgeDocs(DELIVERIES, before);
      if (a || b) console.log('[automation] pruned ' + a + ' event(s) and ' + b + ' deliver(ies) older than 30 days');
    } catch (e) { console.warn('[automation] prune failed:', e.message); }
  }
  async function saveStats() { if (statsDirty) { statsDirty = false; await ctx.store.kvSet(STATS_KV, stats).catch(() => {}); } }

  async function start() {
    stats = (await ctx.store.kvGet(STATS_KV, {})) || {};
    const evs = (await ctx.store.listDocs(EVENTS)).sort((a, b) => b.at - a.at);
    ring.push(...evs.slice(0, RING));
    evs.filter((e) => e.status === 'pending').sort((a, b) => a.at - b.at).forEach((e) => queue.push(e)); // crash recovery
    (await ctx.store.listDocs(DELIVERIES)).filter((d) => d.status === 'pending' || d.status === 'retrying').forEach((d) => pending.set(d.id, d));
    kick();
    timers.push(setInterval(deliverDue, 3000));
    timers.push(setInterval(saveStats, 30000));
    timers.push(setInterval(prune, 6 * 3600000));
    setTimeout(prune, 90000);
  }
  function stop() { timers.forEach(clearInterval); saveStats(); }

  return {
    start, stop, overview, listEvents, replay, recordEvent,
    hooks: { list: async () => (await listHooks()).map(publicHook), create: createHook, update: async (id, b) => publicHook(await updateHook(id, b)), remove: deleteHook, rotate: rotateSecret, test: sendTest, deliveries: deliveriesFor, retry: retryDelivery },
    inbound: { config: inboundConfig, set: setInbound, rotate: rotateInbound, handle: handleInbound },
    _sign: signBody
  };
}

module.exports = { createAutomation, signBody };
