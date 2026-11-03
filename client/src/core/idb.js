// Minimal promise wrapper around IndexedDB (local-first persistence; works on http(s) and file://).

const DB_NAME = 'ssdc-suite';
const DB_VERSION = 2;

export const DOC_STORES = [
  'settings', 'users', 'roles', 'doctors', 'tests', 'patients', 'visits', 'invoices', 'expenses', 'floats',
  'denoms', 'formf', 'reports', 'labReports', 'dictionary', 'files', 'inbox', 'dispatchLog', 'msgTemplates',
  'statements', 'audit', 'categories'
];
const EXTRA_STORES = ['macros', 'blobs', 'snapshots'];
const KEY_STORES = ['outbox', 'kv'];

let dbPromise = null;
let memoryFallback = null;

function req2p(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let r;
    try { r = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { memoryFallback = new Map(); resolve(null); return; }
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of DOC_STORES.concat(EXTRA_STORES)) {
        if (!db.objectStoreNames.contains(s)) {
          const os = db.createObjectStore(s, { keyPath: 'id' });
          if (s === 'macros') os.createIndex('trigger', 'triggerLower', { unique: false });
          if (s === 'snapshots') os.createIndex('reportId', 'reportId', { unique: false });
        }
      }
      for (const s of KEY_STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'key' });
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    r.onerror = () => { console.warn('IndexedDB unavailable, using memory store', r.error); memoryFallback = new Map(); resolve(null); };
    r.onblocked = () => console.warn('IndexedDB upgrade blocked by another tab');
  });
  return dbPromise;
}

export const idbAvailable = () => !memoryFallback;

function mem(store) {
  if (!memoryFallback.has(store)) memoryFallback.set(store, new Map());
  return memoryFallback.get(store);
}
const keyOf = (store, v) => (KEY_STORES.includes(store) ? v.key : v.id);

async function tx(store, mode, fn) {
  const db = await openDB();
  if (!db) return fn(null);
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let result;
    Promise.resolve(fn(os)).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

export async function idbGetAll(store) {
  const db = await openDB();
  if (!db) return Array.from(mem(store).values());
  return req2p(db.transaction(store).objectStore(store).getAll());
}

export async function idbGet(store, key) {
  const db = await openDB();
  if (!db) return mem(store).get(key);
  return req2p(db.transaction(store).objectStore(store).get(key));
}

export async function idbGetMany(store, keys) {
  const db = await openDB();
  if (!db) return keys.map((k) => mem(store).get(k));
  const os = db.transaction(store).objectStore(store);
  return Promise.all(keys.map((k) => req2p(os.get(k))));
}

export function idbPut(store, value) { return idbPutMany(store, [value]); }

export async function idbPutMany(store, values) {
  if (!values.length) return;
  const db = await openDB();
  if (!db) { const m = mem(store); values.forEach((v) => m.set(keyOf(store, v), v)); return; }
  return tx(store, 'readwrite', (os) => { for (const v of values) os.put(v); });
}

export async function idbDelete(store, key) { return idbDeleteMany(store, [key]); }

export async function idbDeleteMany(store, keys) {
  if (!keys.length) return;
  const db = await openDB();
  if (!db) { const m = mem(store); keys.forEach((k) => m.delete(k)); return; }
  return tx(store, 'readwrite', (os) => { for (const k of keys) os.delete(k); });
}

export async function idbClear(store) {
  const db = await openDB();
  if (!db) { mem(store).clear(); return; }
  return tx(store, 'readwrite', (os) => { os.clear(); });
}

export async function idbCount(store) {
  const db = await openDB();
  if (!db) return mem(store).size;
  return req2p(db.transaction(store).objectStore(store).count());
}

/** Iterate a store in batches (non-blocking for very large stores such as 1,00,000 macros). */
export async function idbIterate(store, onBatch, batchSize = 2000) {
  const db = await openDB();
  if (!db) { const all = Array.from(mem(store).values()); for (let i = 0; i < all.length; i += batchSize) await onBatch(all.slice(i, i + batchSize)); return; }
  let lastKey = null;
  for (;;) {
    const batch = await new Promise((resolve, reject) => {
      const os = db.transaction(store).objectStore(store);
      const range = lastKey === null ? null : IDBKeyRange.lowerBound(lastKey, true);
      const out = [];
      const r = os.openCursor(range);
      r.onsuccess = () => {
        const c = r.result;
        if (c && out.length < batchSize) { out.push(c.value); c.continue(); } else resolve(out);
      };
      r.onerror = () => reject(r.error);
    });
    if (!batch.length) break;
    lastKey = keyOf(store, batch[batch.length - 1]);
    await onBatch(batch);
    if (batch.length < batchSize) break;
  }
}

export async function idbIndexGet(store, index, key) {
  const db = await openDB();
  if (!db) return Array.from(mem(store).values()).filter((v) => v[index === 'trigger' ? 'triggerLower' : index] === key);
  return req2p(db.transaction(store).objectStore(store).index(index).getAll(key));
}

export async function kvGet(key, fallback = null) { const r = await idbGet('kv', key); return r ? r.value : fallback; }
export async function kvSet(key, value) { return idbPut('kv', { key, value }); }

export async function estimateStorage() {
  try { const e = await navigator.storage.estimate(); return { usage: e.usage || 0, quota: e.quota || 0 }; } catch (e) { return null; }
}

export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { /* ignore */ }
  return false;
}
