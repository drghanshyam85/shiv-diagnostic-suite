/*
 * Shared server context: store, event bus, settings helpers and the single write path for documents.
 * Every document write goes through saveDoc() so realtime broadcasting, cloud sync hooks and
 * semantic events (patient:registered, report:completed ...) fire consistently.
 */
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const seed = require('../shared/seed-data');

function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over === undefined ? base : over;
  if (base && typeof base === 'object' && over && typeof over === 'object') {
    const out = Object.assign({}, base);
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
    return out;
  }
  return over === undefined ? base : over;
}

function sanitizeForClient(coll, doc) {
  if (!doc) return doc;
  if (coll === 'users') {
    const { passwordHash, ...rest } = doc;
    return rest;
  }
  return doc;
}

function createContext({ store, dataDir }) {
  const bus = new EventEmitter();
  bus.setMaxListeners(50);
  const filesDir = path.join(dataDir, 'files');
  fs.mkdirSync(filesDir, { recursive: true });

  let settingsCache = null;
  let settingsAt = 0;

  async function getSettings() {
    if (settingsCache && Date.now() - settingsAt < 3000) return settingsCache;
    const doc = await store.getDoc('settings', 'main');
    settingsCache = deepMerge(seed.DEFAULT_SETTINGS, doc || {});
    settingsAt = Date.now();
    return settingsCache;
  }

  /**
   * Persist a document (LWW) and broadcast the change.
   * opts: { actor, force, originSocket }
   */
  async function saveDoc(coll, doc, opts = {}) {
    const res = await store.putDoc(coll, doc, { force: !!opts.force });
    if (res.status === 'ok') {
      if (coll === 'settings') settingsCache = null;
      bus.emit('change', {
        coll,
        doc: sanitizeForClient(coll, res.doc),
        previous: res.previous,
        seq: res.seq,
        actor: opts.actor || null,
        originSocket: opts.originSocket || null
      });
    }
    return res;
  }

  return { store, bus, dataDir, filesDir, getSettings, saveDoc, sanitizeForClient, deepMerge };
}

module.exports = { createContext, deepMerge, sanitizeForClient };
