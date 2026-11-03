// Local-first reactive document store.
//  • every collection is held in memory and persisted to IndexedDB (write-behind, 250 ms)
//  • BroadcastChannel keeps other tabs/windows of the same browser in sync instantly
//  • a sync hook pushes local writes to the LAN server (see sync.js)

import { DOC_STORES, openDB, idbGetAll, idbPutMany } from './idb';
import { deviceId, debounce } from './utils';

export const COLLECTIONS = DOC_STORES;
const LISTENERS = new Map();
const ANY = new Set();

// ---------------------------------------------------------------- tiny app-wide event bus
const busTarget = new Map();
export const events = {
  on(type, fn) { if (!busTarget.has(type)) busTarget.set(type, new Set()); busTarget.get(type).add(fn); return () => busTarget.get(type).delete(fn); },
  emit(type, data) { (busTarget.get(type) || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }
};

class Store {
  constructor() {
    this.data = {};
    this.cache = {};
    this.version = {};
    this.dirty = new Map();
    this.ready = false;
    this.actor = null;
    this.lastPersistAt = 0;
    this.onLocalWrite = null;
    COLLECTIONS.forEach((c) => { this.data[c] = new Map(); this.version[c] = 0; });
    this._flushSoon = debounce(() => this.flush(), 250);
    try {
      this.bc = new BroadcastChannel('ssdc-sync');
      this.bc.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === 'put' && m.coll && m.doc) this._set(m.coll, m.doc, true);
        else events.emit('bc:' + m.type, m);
      };
    } catch (e) { this.bc = null; }
  }

  async init() {
    await openDB();
    await Promise.all(COLLECTIONS.map(async (c) => {
      const docs = await idbGetAll(c);
      const m = this.data[c];
      docs.forEach((d) => m.set(d.id, d));
      this.version[c]++;
    }));
    this.ready = true;
    window.addEventListener('beforeunload', () => { this.flush(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(); });
  }

  isEmpty() { return this.data.tests.size === 0 && this.data.settings.size === 0; }

  list(coll) {
    const v = this.version[coll];
    const c = this.cache[coll];
    if (c && c.v === v) return c.arr;
    const arr = [];
    for (const d of this.data[coll].values()) if (!d._deleted) arr.push(d);
    this.cache[coll] = { v, arr };
    return arr;
  }

  get(coll, id) {
    if (!id || !this.data[coll]) return null;
    const d = this.data[coll].get(id);
    return d && !d._deleted ? d : null;
  }

  getRaw(coll, id) { return this.data[coll] ? this.data[coll].get(id) || null : null; }

  /** Local write: stamps updatedAt/updatedBy, persists, broadcasts and queues for server sync. */
  put(coll, doc) {
    if (!this.data[coll]) throw new Error('Unknown collection ' + coll);
    if (!doc || !doc.id) throw new Error('Document id required');
    const prev = this.data[coll].get(doc.id);
    const now = Date.now();
    const next = Object.assign({}, doc, {
      updatedAt: Math.max(now, prev && prev.updatedAt ? prev.updatedAt + 1 : 0),
      updatedBy: this.actor || null,
      _dev: deviceId
    });
    if (!prev && !next.createdAt) next.createdAt = now;
    this._set(coll, next, false);
    if (this.bc) { try { this.bc.postMessage({ type: 'put', coll, doc: next }); } catch (e) { /* clone error */ } }
    if (this.onLocalWrite) this.onLocalWrite(coll, next);
    return next;
  }

  patch(coll, id, partial) {
    const cur = this.getRaw(coll, id) || { id };
    return this.put(coll, Object.assign({}, cur, partial, { id }));
  }

  remove(coll, id) {
    const cur = this.getRaw(coll, id);
    if (!cur) return null;
    return this.put(coll, Object.assign({}, cur, { _deleted: true }));
  }

  /** Remote write (server / other tab): last-write-wins unless forced. */
  applyRemote(coll, doc, force = false) {
    if (!this.data[coll] || !doc || !doc.id) return false;
    const cur = this.data[coll].get(doc.id);
    if (!force && cur && Number(cur.updatedAt || 0) > Number(doc.updatedAt || 0)) return false;
    this._set(coll, doc, false);
    return true;
  }

  /** Seed / import without bumping timestamps and without queueing for sync. */
  load(coll, docs) {
    const m = this.data[coll];
    docs.forEach((d) => { m.set(d.id, d); this._markDirty(coll, d.id); });
    this.version[coll]++;
    this._notify(coll);
    this._flushSoon();
  }

  _set(coll, doc, fromBc) {
    if (!this.data[coll]) return;
    this.data[coll].set(doc.id, doc);
    this.version[coll]++;
    if (!fromBc) this._markDirty(coll, doc.id);
    this._notify(coll);
    if (!fromBc) this._flushSoon();
  }

  _markDirty(coll, id) {
    if (!this.dirty.has(coll)) this.dirty.set(coll, new Set());
    this.dirty.get(coll).add(id);
  }

  _notify(coll) {
    (LISTENERS.get(coll) || []).forEach((fn) => fn());
    ANY.forEach((fn) => fn(coll));
  }

  async flush() {
    if (!this.dirty.size) return;
    const work = Array.from(this.dirty.entries());
    this.dirty.clear();
    await Promise.all(work.map(([coll, ids]) => {
      const docs = Array.from(ids).map((id) => this.data[coll].get(id)).filter(Boolean);
      return idbPutMany(coll, docs).catch((e) => console.error('persist failed', coll, e));
    }));
    this.lastPersistAt = Date.now();
    events.emit('persisted', this.lastPersistAt);
  }

  subscribe(coll, fn) {
    if (!LISTENERS.has(coll)) LISTENERS.set(coll, new Set());
    LISTENERS.get(coll).add(fn);
    return () => LISTENERS.get(coll).delete(fn);
  }

  subscribeAny(fn) { ANY.add(fn); return () => ANY.delete(fn); }

  exportAll({ includeDeleted = false } = {}) {
    const out = {};
    COLLECTIONS.forEach((c) => {
      out[c] = Array.from(this.data[c].values()).filter((d) => includeDeleted || !d._deleted);
    });
    return out;
  }

  /** Import a backup. mode: 'merge' (LWW) or 'replace' (overwrite everything present in backup). */
  importAll(data, mode = 'merge') {
    let n = 0;
    for (const c of COLLECTIONS) {
      const docs = (data && data[c]) || [];
      for (const d of docs) {
        if (!d || !d.id) continue;
        const cur = this.data[c].get(d.id);
        if (mode === 'merge' && cur && Number(cur.updatedAt || 0) >= Number(d.updatedAt || 0)) continue;
        this.put(c, d);
        n++;
      }
    }
    return n;
  }
}

export const store = new Store();
if (typeof window !== 'undefined') window.__ssdcStore = store;
