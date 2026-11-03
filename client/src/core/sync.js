// Server detection, REST helper, outbox-based push, change-feed pull and Socket.io realtime link.
import { useSyncExternalStore } from 'react';
import { store, events } from './store';
import { idbGetAll, idbPutMany, idbDeleteMany, kvGet, kvSet } from './idb';
import { deviceId, lsGet, lsSet } from './utils';
import { loadScript } from './vendor';

export const net = {
  mode: 'detecting', serverInfo: null, authed: false, online: typeof navigator === 'undefined' ? true : navigator.onLine,
  socket: null, connected: false, state: 'idle', pending: 0, lastSyncAt: null, lastError: null,
  devices: [], locks: {}, cloud: null, integrations: null
};
let snap = Object.assign({}, net);
const subs = new Set();
function bump() { snap = Object.assign({}, net); subs.forEach((f) => f()); }
export const getNet = () => snap;
export const onNet = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const useNet = () => useSyncExternalStore(onNet, getNet);

export const LOCAL_ONLY = new Set(['audit']);
export const SERVER_MANAGED = new Set(['users', 'roles']);

// ---------------------------------------------------------------- detection & REST
export async function detectServer() {
  if (window.__SSDC_STANDALONE || !/^https?:$/.test(location.protocol)) { net.mode = 'standalone'; bump(); return false; }
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    const r = await fetch('api/health', { cache: 'no-store', signal: ctl.signal });
    clearTimeout(t);
    if (r.ok) {
      const j = await r.json();
      if (j && j.app === 'ssdc-suite') { net.mode = 'server'; net.serverInfo = j; bump(); return true; }
    }
  } catch (e) { /* no server */ }
  net.mode = 'standalone';
  bump();
  return false;
}

// Sensitive admin calls may answer 401 REAUTH_REQUIRED: the UI asks for the password (handler set by
// the shell), then the call is retried once.
let reauthHandler = null;
export function setReauthHandler(fn) { reauthHandler = fn; }

export async function api(path, args = {}) {
  const { method = 'GET', body, form, raw, headers = {}, timeout = 60000, _retried = false } = args;
  const opts = { method, credentials: 'same-origin', headers: Object.assign({}, headers) };
  if (net.socket && net.socket.id) opts.headers['X-Socket-Id'] = net.socket.id;
  if (form) opts.body = form;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), timeout);
  opts.signal = ctl.signal;
  let r;
  try { r = await fetch('api/' + String(path).replace(/^\//, ''), opts); }
  catch (e) { const err = new Error(e.name === 'AbortError' ? 'Request timed out' : 'Server unreachable'); err.offline = true; throw err; }
  finally { clearTimeout(tm); }
  if (raw) return r;
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  if (!r.ok) {
    if (r.status === 401 && data.code === 'REAUTH_REQUIRED' && reauthHandler && !_retried) {
      await reauthHandler(data); // throws when the user cancels
      return api(path, Object.assign({}, args, { _retried: true }));
    }
    const e = new Error(data.error || r.statusText || 'Request failed');
    e.status = r.status;
    e.data = data;
    if (r.status === 401 && data.code !== 'REAUTH_REQUIRED' && !String(path).startsWith('auth/')) events.emit('auth:expired');
    throw e;
  }
  return data;
}

export const isServer = () => net.mode === 'server';

// ---------------------------------------------------------------- outbox
const outbox = new Set();
let macroBridge = null;
export function setMacroBridge(b) { macroBridge = b; }

export async function loadOutbox() {
  try { (await idbGetAll('outbox')).forEach((r) => outbox.add(r.key)); } catch (e) { /* ignore */ }
  net.pending = outbox.size;
  bump();
}

function addOutbox(coll, id) {
  const k = coll + '\u0001' + id;
  outbox.add(k);
  idbPutMany('outbox', [{ key: k, at: Date.now() }]).catch(() => {});
  net.pending = outbox.size;
  bump();
  scheduleFlush();
}

function removeOutbox(keys) {
  if (!keys.length) return;
  keys.forEach((k) => outbox.delete(k));
  idbDeleteMany('outbox', keys).catch(() => {});
  net.pending = outbox.size;
  bump();
}

export function initSyncHooks() {
  store.onLocalWrite = (coll, doc) => {
    if (net.mode === 'server' && (LOCAL_ONLY.has(coll) || SERVER_MANAGED.has(coll))) return;
    addOutbox(coll, doc.id);
  };
}
export const queueMacro = (id) => addOutbox('macros', id);

let flushTimer = null;
let flushing = false;
function scheduleFlush(ms = 350) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, ms); }

function applyIncoming(coll, doc, force) {
  if (coll === 'macros') { if (macroBridge) macroBridge.applyRemote(doc, force); return; }
  store.applyRemote(coll, doc, force);
}

export async function flush() {
  if (net.mode !== 'server' || flushing || !outbox.size || !net.authed) return;
  flushing = true;
  net.state = 'syncing';
  bump();
  try {
    while (outbox.size) {
      const keys = Array.from(outbox).slice(0, 150);
      const docs = [];
      for (const k of keys) {
        const [coll, id] = k.split('\u0001');
        const doc = coll === 'macros' ? (macroBridge ? await macroBridge.getRaw(id) : null) : store.getRaw(coll, id);
        if (doc && !(coll === 'macros' && doc.bench)) docs.push({ coll, doc });
      }
      const present = new Set(docs.map((d) => d.coll + '\u0001' + d.doc.id));
      removeOutbox(keys.filter((k) => !present.has(k)));
      if (!docs.length) continue;
      const res = await api('sync/push', { method: 'POST', body: { docs } });
      const done = [];
      for (const r of res.results || []) {
        done.push(r.coll + '\u0001' + r.id);
        if (r.status === 'stale' && r.doc) applyIncoming(r.coll, r.doc, true);
        if (r.status === 'rejected') {
          if (r.doc) applyIncoming(r.coll, r.doc, true);
          else if (r.coll !== 'macros') {
            const cur = store.getRaw(r.coll, r.id);
            if (cur) store.applyRemote(r.coll, Object.assign({}, cur, { _deleted: true, _rejected: r.error }), true);
          }
          events.emit('toast', { type: 'error', text: 'Not saved on server: ' + r.error, ttl: 7000 });
        }
      }
      removeOutbox(done);
    }
    net.state = 'synced';
    net.lastSyncAt = Date.now();
    net.lastError = null;
  } catch (e) {
    net.state = e.offline ? 'offline' : 'error';
    net.lastError = e.message;
    scheduleFlush(e.offline ? 6000 : 15000);
  } finally {
    flushing = false;
    bump();
  }
}

// ---------------------------------------------------------------- pull
let lastSeq = 0;
let pulling = null;
let pullTimer = null;
const schedulePull = (ms = 1500) => { clearTimeout(pullTimer); pullTimer = setTimeout(pull, ms); };

export async function pull() {
  if (net.mode !== 'server' || !net.authed) return;
  if (pulling) return pulling;
  pulling = (async () => {
    try {
      const inst = net.serverInfo && net.serverInfo.instanceId;
      const savedInst = await kvGet('serverInstance', null);
      lastSeq = savedInst === inst ? Number(await kvGet('lastSeq', 0)) || 0 : 0;
      let more = true;
      while (more) {
        const r = await api('sync/pull?since=' + lastSeq + '&limit=2000');
        if (r.head < lastSeq) { lastSeq = 0; continue; }
        for (const c of r.changes) applyIncoming(c.coll, c.doc, false);
        lastSeq = r.seq;
        more = r.more;
      }
      await kvSet('lastSeq', lastSeq);
      await kvSet('serverInstance', inst);
      net.lastSyncAt = Date.now();
      if (!outbox.size) net.state = 'synced';
    } catch (e) {
      net.state = e.offline ? 'offline' : 'error';
      net.lastError = e.message;
    } finally {
      pulling = null;
      bump();
    }
  })();
  return pulling;
}

// ---------------------------------------------------------------- realtime
export function getWorkstationName() {
  return lsGet('ssdc-workstation', '') || 'Reception PC';
}
export function setWorkstationName(name) {
  lsSet('ssdc-workstation', name);
  hello();
  bump();
}
function hello() {
  if (net.socket && net.connected) net.socket.emit('device:hello', { deviceId, workstation: getWorkstationName(), route: location.hash });
}

export async function connectRealtime() {
  if (net.mode !== 'server' || net.socket) return;
  try { await loadScript('socket.io/socket.io.js', 'io'); } catch (e) { console.warn('socket.io client unavailable', e); return; }
  const base = location.pathname.replace(/[^/]*$/, '');
  const socket = window.io({ path: base + 'socket.io', withCredentials: true, transports: ['websocket', 'polling'], reconnectionDelayMax: 8000 });
  net.socket = socket;
  socket.on('connect', () => {
    net.connected = true;
    bump();
    hello();
    pull().then(flush);
  });
  socket.on('disconnect', () => { net.connected = false; net.state = 'offline'; bump(); });
  socket.on('connect_error', (e) => { net.connected = false; net.lastError = e.message; bump(); });
  socket.on('doc:changed', (m) => {
    if (!m || !m.coll || !m.doc) return;
    applyIncoming(m.coll, m.doc, false);
    if (m.seq === lastSeq + 1) { lastSeq = m.seq; kvSet('lastSeq', lastSeq); } else schedulePull();
  });
  socket.on('devices:update', (list) => { net.devices = list || []; bump(); });
  socket.on('locks:update', (map) => { net.locks = map || {}; bump(); });
  socket.on('cloud:status', (s) => { net.cloud = s; bump(); });
  ['workstation:open', 'patient:registered', 'queue:updated', 'report:draft_saved', 'report:completed', 'notify', 'queue:call', 'lan:changed'].forEach((ev) => {
    socket.on(ev, (data) => events.emit(ev, data));
  });
  window.addEventListener('hashchange', () => { if (net.connected) socket.emit('device:route', location.hash); });
  window.addEventListener('online', () => { net.online = true; bump(); flush(); });
  window.addEventListener('offline', () => { net.online = false; net.state = 'offline'; bump(); });
  setInterval(() => { if (net.connected) pull(); else if (outbox.size) flush(); }, 30000);
}

export function disconnectRealtime() {
  if (net.socket) { net.socket.disconnect(); net.socket = null; net.connected = false; bump(); }
}

export function setAuthed(v) {
  net.authed = !!v;
  bump();
  if (v && net.mode === 'server') {
    connectRealtime();
    pull().then(flush);
    refreshIntegrations();
    api('cloud/status').then((r) => { net.cloud = r; bump(); }).catch(() => {});
  }
}

/** Re-read which messaging channels the server has configured (after Settings → Integrations saves). */
export function refreshIntegrations() {
  return api('integrations/status').then((r) => { net.integrations = r.status; bump(); return r.status; }).catch(() => null);
}

export function emitEvent(type, data) {
  if (net.socket && net.connected) net.socket.emit('event:emit', { type, data });
  if (store.bc) store.bc.postMessage({ type, data });
}

/** Optimistic edit lock (badge on other devices). Returns release(). */
export function acquireLock(resource, onDenied) {
  if (!net.socket || !net.connected) return () => {};
  let alive = true;
  const tryAcquire = () => net.socket.emit('lock:acquire', { resource }, (r) => { if (r && !r.ok && onDenied) onDenied(r.holder); });
  tryAcquire();
  const beat = setInterval(() => { if (alive && net.connected) net.socket.emit('lock:heartbeat', { resource }); }, 15000);
  return () => { alive = false; clearInterval(beat); if (net.socket) net.socket.emit('lock:release', { resource }); };
}

export function lockHolder(resource) {
  const l = net.locks && net.locks[resource];
  if (!l || (net.socket && l.socketId === net.socket.id)) return null;
  return l;
}

/** "Save & Open in Other Workstation" */
export function sendToWorkstation(msg) {
  return new Promise((resolve) => {
    if (net.socket && net.connected) {
      net.socket.emit('workstation:open', msg, (ack) => resolve(ack || { ok: true, delivered: 0 }));
      setTimeout(() => resolve({ ok: true, delivered: -1 }), 3000);
    } else {
      if (store.bc) store.bc.postMessage({ type: 'workstation:open', payload: Object.assign({ from: { workstation: getWorkstationName() }, at: Date.now() }, msg) });
      resolve({ ok: true, delivered: -1, local: true });
    }
  });
}
events.on('bc:workstation:open', (m) => events.emit('workstation:open', m.payload));

// ---------------------------------------------------------------- counters
export async function nextCounter(key, min = 0) {
  if (net.mode === 'server' && net.authed) {
    try {
      const r = await api('counter/next', { method: 'POST', body: { key, min } });
      await kvSet('counter:' + key, r.value);
      return r.value;
    } catch (e) {
      if (!e.offline) throw e;
      events.emit('toast', { type: 'warning', text: 'Server offline – number allocated on this workstation' });
    }
  }
  const run = async () => {
    const v = Math.max(Number(await kvGet('counter:' + key, 0)) || 0, min) + 1;
    await kvSet('counter:' + key, v);
    return v;
  };
  if (navigator.locks && navigator.locks.request) return navigator.locks.request('ssdc-counter-' + key, run);
  return run();
}

export async function peekCounter(key) {
  if (net.mode === 'server' && net.authed) {
    try { return (await api('counter/' + encodeURIComponent(key))).value; } catch (e) { /* fall back */ }
  }
  return Number(await kvGet('counter:' + key, 0)) || 0;
}

export async function setLocalCounters(map) {
  for (const [k, v] of Object.entries(map || {})) {
    const cur = Number(await kvGet('counter:' + k, 0)) || 0;
    if (v > cur) await kvSet('counter:' + k, v);
  }
}
