/*
 * Persistence layer — a small document store with server-assigned change sequence numbers.
 *   1. node:sqlite (built into Node >= 22.5)      — default, zero native dependencies
 *   2. better-sqlite3 (if installed)               — fallback for older Node versions
 *   3. JSON file store                             — last-resort fallback (small installs)
 *   4. PostgreSQL (DATABASE_URL + `npm i pg`)      — optional cloud adapter (see db-pg.js)
 * All public methods are async so the PostgreSQL adapter can share the same interface.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS docs (
  coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
  updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL,
  PRIMARY KEY (coll, id));
CREATE INDEX IF NOT EXISTS idx_docs_seq ON docs(seq);
CREATE INDEX IF NOT EXISTS idx_docs_coll ON docs(coll);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, actor_id TEXT, actor_name TEXT, actor_role TEXT, action TEXT,
  target_resource TEXT, ip_address TEXT, timestamp INTEGER, metadata TEXT);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(timestamp);
CREATE TABLE IF NOT EXISTS share_links (
  token TEXT PRIMARY KEY, kind TEXT, ref TEXT, expires_at INTEGER, created_at INTEGER,
  hits INTEGER DEFAULT 0, meta TEXT);
CREATE TABLE IF NOT EXISTS cloud_queue (
  id TEXT PRIMARY KEY, provider TEXT, kind TEXT, dedupe TEXT, path TEXT, ref TEXT, payload TEXT,
  status TEXT, attempts INTEGER DEFAULT 0, last_error TEXT, created_at INTEGER, updated_at INTEGER, next_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_cq_status ON cloud_queue(status, next_at);
CREATE INDEX IF NOT EXISTS idx_cq_dedupe ON cloud_queue(dedupe);
CREATE TABLE IF NOT EXISTS cloud_log (
  id TEXT PRIMARY KEY, provider TEXT, action TEXT, path TEXT, size INTEGER, status TEXT,
  detail TEXT, link TEXT, at INTEGER);
CREATE INDEX IF NOT EXISTS idx_cl_at ON cloud_log(at);
`;

const uid = (p) => (p || '') + crypto.randomBytes(9).toString('base64url');

// ---------------------------------------------------------------------------
// SQLite adapters
// ---------------------------------------------------------------------------
function openSqlite(file) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(file);
    const cache = new Map();
    const st = (sql) => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
    return {
      kind: 'node:sqlite',
      exec: (sql) => db.exec(sql),
      run: (sql, ...p) => st(sql).run(...p),
      get: (sql, ...p) => st(sql).get(...p),
      all: (sql, ...p) => st(sql).all(...p),
      close: () => db.close()
    };
  } catch (e) { /* fall through */ }
  try {
    const Better = require('better-sqlite3');
    const db = new Better(file);
    const cache = new Map();
    const st = (sql) => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
    return {
      kind: 'better-sqlite3',
      exec: (sql) => db.exec(sql),
      run: (sql, ...p) => st(sql).run(...p),
      get: (sql, ...p) => st(sql).get(...p),
      all: (sql, ...p) => st(sql).all(...p),
      close: () => db.close()
    };
  } catch (e) { /* fall through */ }
  return null;
}

const clean = (v) => (v === undefined ? null : v);

class SqliteStore {
  constructor(adapter, file) {
    this.a = adapter;
    this.kind = adapter.kind;
    this.file = file;
    this.a.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.a.exec(SCHEMA);
    const row = this.a.get('SELECT value FROM meta WHERE key = ?', 'seq');
    this.seq = row ? Number(row.value) : 0;
  }

  _tx(fn) {
    this.a.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.a.exec('COMMIT'); return r; } catch (e) { try { this.a.exec('ROLLBACK'); } catch (_) {} throw e; }
  }

  _nextSeq() {
    this.seq += 1;
    this.a.run('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'seq', String(this.seq));
    return this.seq;
  }

  async getDoc(coll, id) {
    const r = this.a.get('SELECT data FROM docs WHERE coll = ? AND id = ?', coll, id);
    return r ? JSON.parse(r.data) : null;
  }

  /** Last-write-wins upsert. Returns { status: 'ok'|'stale', doc, seq } */
  async putDoc(coll, doc, opts = {}) {
    if (!doc || !doc.id) throw new Error('Document id required');
    return this._tx(() => {
      const cur = this.a.get('SELECT data, updated_at FROM docs WHERE coll = ? AND id = ?', coll, doc.id);
      const incomingTs = Number(doc.updatedAt || 0);
      if (cur && !opts.force && incomingTs <= Number(cur.updated_at)) {
        return { status: 'stale', doc: JSON.parse(cur.data) };
      }
      const toSave = opts.force && cur && incomingTs <= Number(cur.updated_at)
        ? Object.assign({}, doc, { updatedAt: Number(cur.updated_at) + 1 })
        : doc;
      const seq = this._nextSeq();
      this.a.run(
        'INSERT INTO docs(coll, id, data, updated_at, deleted, seq) VALUES(?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(coll, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, seq = excluded.seq',
        coll, String(toSave.id), JSON.stringify(toSave), Number(toSave.updatedAt || Date.now()), toSave._deleted ? 1 : 0, seq
      );
      return { status: 'ok', doc: toSave, seq, previous: cur ? JSON.parse(cur.data) : null };
    });
  }

  async putMany(coll, docs, opts = {}) {
    const out = [];
    for (const d of docs) out.push(await this.putDoc(coll, d, opts));
    return out;
  }

  async listDocs(coll, opts = {}) {
    const rows = opts.includeDeleted
      ? this.a.all('SELECT data FROM docs WHERE coll = ?', coll)
      : this.a.all('SELECT data FROM docs WHERE coll = ? AND deleted = 0', coll);
    return rows.map((r) => JSON.parse(r.data));
  }

  async countDocs(coll) {
    const r = this.a.get('SELECT COUNT(*) AS n FROM docs WHERE coll = ? AND deleted = 0', coll);
    return Number(r.n);
  }

  /** Permanently remove a server-only collection's documents last updated before `beforeTs`. */
  async purgeDocs(coll, beforeTs) {
    const r = this.a.run('DELETE FROM docs WHERE coll = ? AND updated_at < ?', coll, Number(beforeTs) || 0);
    return Number((r && r.changes) || 0);
  }

  async changesSince(seq, limit = 2000, excludeColls = []) {
    const rows = this.a.all('SELECT coll, data, seq FROM docs WHERE seq > ? ORDER BY seq ASC LIMIT ?', Number(seq) || 0, limit + 1);
    const more = rows.length > limit;
    const list = rows.slice(0, limit).filter((r) => !excludeColls.includes(r.coll)).map((r) => ({ coll: r.coll, doc: JSON.parse(r.data), seq: Number(r.seq) }));
    const last = rows.length ? Number(rows[Math.min(rows.length, limit) - 1].seq) : Number(seq) || 0;
    return { changes: list, seq: Math.max(last, Number(seq) || 0), more, head: this.seq };
  }

  async nextCounter(key, min) {
    return this._tx(() => {
      const r = this.a.get('SELECT value FROM counters WHERE key = ?', key);
      let v = (r ? Number(r.value) : 0) + 1;
      if (min && v <= min) v = min + 1;
      this.a.run('INSERT INTO counters(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, v);
      return v;
    });
  }

  async peekCounter(key) {
    const r = this.a.get('SELECT value FROM counters WHERE key = ?', key);
    return r ? Number(r.value) : 0;
  }

  async setCounter(key, value) {
    this.a.run('INSERT INTO counters(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = MAX(counters.value, excluded.value)', key, Number(value));
  }

  /** Exact set (may lower the value) — only for the admin "remove demo data" reset. */
  async resetCounter(key, value) {
    this.a.run('INSERT INTO counters(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, Number(value));
  }

  async allCounters() {
    const out = {};
    for (const r of this.a.all('SELECT key, value FROM counters')) out[r.key] = Number(r.value);
    return out;
  }

  async kvGet(key, fallback = null) {
    const r = this.a.get('SELECT value FROM meta WHERE key = ?', 'kv:' + key);
    if (!r) return fallback;
    try { return JSON.parse(r.value); } catch (e) { return fallback; }
  }

  async kvSet(key, value) {
    this.a.run('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'kv:' + key, JSON.stringify(value));
  }

  // --- audit -----------------------------------------------------------------
  async addAudit(e) {
    const row = {
      id: e.id || uid('al_'), actor_id: clean(e.actorId), actor_name: clean(e.actorName), actor_role: clean(e.actorRole),
      action: clean(e.action), target_resource: clean(e.targetResource), ip_address: clean(e.ipAddress),
      timestamp: e.timestamp || Date.now(), metadata: JSON.stringify(e.metadata || {})
    };
    this.a.run('INSERT OR REPLACE INTO audit_logs(id, actor_id, actor_name, actor_role, action, target_resource, ip_address, timestamp, metadata) VALUES(?,?,?,?,?,?,?,?,?)',
      row.id, row.actor_id, row.actor_name, row.actor_role, row.action, row.target_resource, row.ip_address, row.timestamp, row.metadata);
    return mapAudit(row);
  }

  async queryAudit(f = {}) {
    const where = [];
    const params = [];
    if (f.q) {
      where.push('(actor_name LIKE ? OR action LIKE ? OR target_resource LIKE ? OR metadata LIKE ?)');
      const q = '%' + f.q + '%';
      params.push(q, q, q, q);
    }
    if (f.action) { where.push('action LIKE ?'); params.push(f.action + '%'); }
    if (f.actorId) { where.push('actor_id = ?'); params.push(f.actorId); }
    if (f.from) { where.push('timestamp >= ?'); params.push(Number(f.from)); }
    if (f.to) { where.push('timestamp <= ?'); params.push(Number(f.to)); }
    const sqlWhere = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const total = Number(this.a.get('SELECT COUNT(*) AS n FROM audit_logs' + sqlWhere, ...params).n);
    const rows = this.a.all('SELECT * FROM audit_logs' + sqlWhere + ' ORDER BY timestamp DESC LIMIT ? OFFSET ?', ...params, Number(f.limit) || 200, Number(f.offset) || 0);
    return { total, rows: rows.map(mapAudit) };
  }

  // --- share links -------------------------------------------------------------
  async createShareLink(s) {
    const token = s.token || crypto.randomBytes(12).toString('base64url');
    this.a.run('INSERT OR REPLACE INTO share_links(token, kind, ref, expires_at, created_at, hits, meta) VALUES(?,?,?,?,?,0,?)',
      token, s.kind, s.ref, s.expiresAt || null, Date.now(), JSON.stringify(s.meta || {}));
    return token;
  }

  async getShareLink(token) {
    const r = this.a.get('SELECT * FROM share_links WHERE token = ?', token);
    if (!r) return null;
    return { token: r.token, kind: r.kind, ref: r.ref, expiresAt: r.expires_at ? Number(r.expires_at) : null, createdAt: Number(r.created_at), hits: Number(r.hits), meta: JSON.parse(r.meta || '{}') };
  }

  async hitShareLink(token) { this.a.run('UPDATE share_links SET hits = hits + 1 WHERE token = ?', token); }

  // --- cloud queue ------------------------------------------------------------
  async enqueueCloud(item) {
    const now = Date.now();
    if (item.dedupe) {
      const ex = this.a.get("SELECT id FROM cloud_queue WHERE dedupe = ? AND provider = ? AND status IN ('pending','error')", item.dedupe, item.provider);
      if (ex) {
        this.a.run("UPDATE cloud_queue SET path = ?, ref = ?, payload = ?, status = 'pending', next_at = ?, updated_at = ? WHERE id = ?",
          clean(item.path), clean(item.ref), JSON.stringify(item.payload || {}), now, now, ex.id);
        return ex.id;
      }
    }
    const id = uid('cq_');
    this.a.run('INSERT INTO cloud_queue(id, provider, kind, dedupe, path, ref, payload, status, attempts, last_error, created_at, updated_at, next_at) VALUES(?,?,?,?,?,?,?,?,0,NULL,?,?,?)',
      id, item.provider, item.kind, clean(item.dedupe), clean(item.path), clean(item.ref), JSON.stringify(item.payload || {}), 'pending', now, now, now);
    return id;
  }

  async dueCloudItems(limit = 10) {
    const rows = this.a.all("SELECT * FROM cloud_queue WHERE status IN ('pending','error') AND next_at <= ? ORDER BY created_at ASC LIMIT ?", Date.now(), limit);
    return rows.map(mapQueue);
  }

  async updateCloudItem(id, patch) {
    const cur = this.a.get('SELECT * FROM cloud_queue WHERE id = ?', id);
    if (!cur) return;
    const n = Object.assign(mapQueue(cur), patch);
    this.a.run('UPDATE cloud_queue SET status = ?, attempts = ?, last_error = ?, next_at = ?, updated_at = ? WHERE id = ?',
      n.status, n.attempts, clean(n.lastError), n.nextAt, Date.now(), id);
  }

  async listCloudQueue(limit = 200) {
    return this.a.all('SELECT * FROM cloud_queue ORDER BY updated_at DESC LIMIT ?', limit).map(mapQueue);
  }

  async cloudQueueStats() {
    const out = {};
    for (const r of this.a.all('SELECT provider, status, COUNT(*) AS n FROM cloud_queue GROUP BY provider, status')) {
      out[r.provider] = out[r.provider] || {};
      out[r.provider][r.status] = Number(r.n);
    }
    return out;
  }

  async purgeCloudDone(olderThanMs) {
    this.a.run("DELETE FROM cloud_queue WHERE status = 'done' AND updated_at < ?", Date.now() - olderThanMs);
  }

  async addCloudLog(e) {
    this.a.run('INSERT INTO cloud_log(id, provider, action, path, size, status, detail, link, at) VALUES(?,?,?,?,?,?,?,?,?)',
      uid('cl_'), clean(e.provider), clean(e.action), clean(e.path), Number(e.size || 0), clean(e.status), clean(e.detail), clean(e.link), Date.now());
  }

  async listCloudLog(limit = 300) {
    return this.a.all('SELECT * FROM cloud_log ORDER BY at DESC LIMIT ?', limit).map((r) => ({
      id: r.id, provider: r.provider, action: r.action, path: r.path, size: Number(r.size), status: r.status, detail: r.detail, link: r.link, at: Number(r.at)
    }));
  }
}

function mapAudit(r) {
  let metadata = r.metadata;
  try { metadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata || {}; } catch (e) { metadata = {}; }
  return {
    id: r.id, actorId: r.actor_id, actorName: r.actor_name, actorRole: r.actor_role, action: r.action,
    targetResource: r.target_resource, ipAddress: r.ip_address, timestamp: Number(r.timestamp), metadata
  };
}

function mapQueue(r) {
  return {
    id: r.id, provider: r.provider, kind: r.kind, dedupe: r.dedupe, path: r.path, ref: r.ref,
    payload: JSON.parse(r.payload || '{}'), status: r.status, attempts: Number(r.attempts || 0),
    lastError: r.last_error, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), nextAt: Number(r.next_at)
  };
}

// ---------------------------------------------------------------------------
// JSON file fallback (keeps everything in memory, flushes atomically)
// ---------------------------------------------------------------------------
class JsonStore {
  constructor(file) {
    this.kind = 'json-file';
    this.file = file;
    this.state = { seq: 0, docs: {}, counters: {}, kv: {}, audit: [], share: {}, queue: {}, cloudLog: [] };
    if (fs.existsSync(file)) {
      try { Object.assign(this.state, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { console.error('[db] could not parse', file, e.message); }
    }
    this.seq = this.state.seq;
    this._timer = null;
  }
  _save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.state));
      fs.renameSync(tmp, this.file);
    }, 400);
  }
  _key(c, id) { return c + '\u0001' + id; }
  async getDoc(coll, id) { const r = this.state.docs[this._key(coll, id)]; return r ? r.doc : null; }
  async putDoc(coll, doc, opts = {}) {
    const k = this._key(coll, doc.id);
    const cur = this.state.docs[k];
    const ts = Number(doc.updatedAt || 0);
    if (cur && !opts.force && ts <= Number(cur.doc.updatedAt || 0)) return { status: 'stale', doc: cur.doc };
    const toSave = opts.force && cur && ts <= Number(cur.doc.updatedAt || 0) ? Object.assign({}, doc, { updatedAt: Number(cur.doc.updatedAt) + 1 }) : doc;
    this.state.seq += 1; this.seq = this.state.seq;
    this.state.docs[k] = { coll, doc: toSave, seq: this.seq };
    this._save();
    return { status: 'ok', doc: toSave, seq: this.seq, previous: cur ? cur.doc : null };
  }
  async putMany(coll, docs, opts) { const o = []; for (const d of docs) o.push(await this.putDoc(coll, d, opts)); return o; }
  async listDocs(coll, opts = {}) {
    return Object.values(this.state.docs).filter((r) => r.coll === coll && (opts.includeDeleted || !r.doc._deleted)).map((r) => r.doc);
  }
  async countDocs(coll) { return (await this.listDocs(coll)).length; }
  async purgeDocs(coll, beforeTs) {
    let n = 0;
    for (const [k, r] of Object.entries(this.state.docs)) if (r.coll === coll && Number(r.doc.updatedAt || 0) < Number(beforeTs)) { delete this.state.docs[k]; n += 1; }
    if (n) this._save();
    return n;
  }
  async changesSince(seq, limit = 2000, excludeColls = []) {
    const rows = Object.values(this.state.docs).filter((r) => r.seq > (Number(seq) || 0)).sort((a, b) => a.seq - b.seq);
    const page = rows.slice(0, limit);
    return {
      changes: page.filter((r) => !excludeColls.includes(r.coll)).map((r) => ({ coll: r.coll, doc: r.doc, seq: r.seq })),
      seq: page.length ? page[page.length - 1].seq : Number(seq) || 0, more: rows.length > limit, head: this.seq
    };
  }
  async nextCounter(key, min) { let v = (this.state.counters[key] || 0) + 1; if (min && v <= min) v = min + 1; this.state.counters[key] = v; this._save(); return v; }
  async peekCounter(key) { return this.state.counters[key] || 0; }
  async setCounter(key, value) { this.state.counters[key] = Math.max(this.state.counters[key] || 0, Number(value)); this._save(); }
  async resetCounter(key, value) { this.state.counters[key] = Number(value); this._save(); }
  async allCounters() { return Object.assign({}, this.state.counters); }
  async kvGet(key, fallback = null) { return key in this.state.kv ? this.state.kv[key] : fallback; }
  async kvSet(key, value) { this.state.kv[key] = value; this._save(); }
  async addAudit(e) {
    const row = { id: e.id || uid('al_'), actorId: e.actorId, actorName: e.actorName, actorRole: e.actorRole, action: e.action, targetResource: e.targetResource, ipAddress: e.ipAddress, timestamp: e.timestamp || Date.now(), metadata: e.metadata || {} };
    this.state.audit.push(row);
    if (this.state.audit.length > 50000) this.state.audit.splice(0, this.state.audit.length - 50000);
    this._save();
    return row;
  }
  async queryAudit(f = {}) {
    let rows = this.state.audit.slice().reverse();
    if (f.q) { const q = f.q.toLowerCase(); rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q)); }
    if (f.action) rows = rows.filter((r) => (r.action || '').startsWith(f.action));
    if (f.actorId) rows = rows.filter((r) => r.actorId === f.actorId);
    if (f.from) rows = rows.filter((r) => r.timestamp >= Number(f.from));
    if (f.to) rows = rows.filter((r) => r.timestamp <= Number(f.to));
    const off = Number(f.offset) || 0;
    return { total: rows.length, rows: rows.slice(off, off + (Number(f.limit) || 200)) };
  }
  async createShareLink(s) { const token = s.token || crypto.randomBytes(12).toString('base64url'); this.state.share[token] = { token, kind: s.kind, ref: s.ref, expiresAt: s.expiresAt || null, createdAt: Date.now(), hits: 0, meta: s.meta || {} }; this._save(); return token; }
  async getShareLink(token) { return this.state.share[token] || null; }
  async hitShareLink(token) { if (this.state.share[token]) { this.state.share[token].hits += 1; this._save(); } }
  async enqueueCloud(item) {
    const now = Date.now();
    if (item.dedupe) {
      const ex = Object.values(this.state.queue).find((q) => q.dedupe === item.dedupe && q.provider === item.provider && (q.status === 'pending' || q.status === 'error'));
      if (ex) { Object.assign(ex, { path: item.path, ref: item.ref, payload: item.payload || {}, status: 'pending', nextAt: now, updatedAt: now }); this._save(); return ex.id; }
    }
    const id = uid('cq_');
    this.state.queue[id] = { id, provider: item.provider, kind: item.kind, dedupe: item.dedupe || null, path: item.path, ref: item.ref, payload: item.payload || {}, status: 'pending', attempts: 0, lastError: null, createdAt: now, updatedAt: now, nextAt: now };
    this._save();
    return id;
  }
  async dueCloudItems(limit = 10) {
    const now = Date.now();
    return Object.values(this.state.queue).filter((q) => (q.status === 'pending' || q.status === 'error') && q.nextAt <= now).sort((a, b) => a.createdAt - b.createdAt).slice(0, limit);
  }
  async updateCloudItem(id, patch) { if (this.state.queue[id]) { Object.assign(this.state.queue[id], patch, { updatedAt: Date.now() }); this._save(); } }
  async listCloudQueue(limit = 200) { return Object.values(this.state.queue).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit); }
  async cloudQueueStats() { const o = {}; for (const q of Object.values(this.state.queue)) { o[q.provider] = o[q.provider] || {}; o[q.provider][q.status] = (o[q.provider][q.status] || 0) + 1; } return o; }
  async purgeCloudDone(ms) { const lim = Date.now() - ms; for (const [k, q] of Object.entries(this.state.queue)) if (q.status === 'done' && q.updatedAt < lim) delete this.state.queue[k]; this._save(); }
  async addCloudLog(e) { this.state.cloudLog.push(Object.assign({ id: uid('cl_'), at: Date.now() }, e)); if (this.state.cloudLog.length > 5000) this.state.cloudLog.shift(); this._save(); }
  async listCloudLog(limit = 300) { return this.state.cloudLog.slice(-limit).reverse(); }
}

// ---------------------------------------------------------------------------
async function openStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  if (process.env.DATABASE_URL && /^postgres/i.test(process.env.DATABASE_URL)) {
    try {
      const { openPgStore } = require('./db-pg');
      const store = await openPgStore(process.env.DATABASE_URL);
      return store;
    } catch (e) {
      console.error('[db] PostgreSQL adapter unavailable (' + e.message + '). Falling back to SQLite.');
    }
  }
  const file = path.join(dataDir, 'ssdc.sqlite');
  const adapter = openSqlite(file);
  if (adapter) return new SqliteStore(adapter, file);
  // never silently start an empty JSON store next to an existing SQLite database
  if (fs.existsSync(file)) throw new Error('The data folder holds a SQLite database (' + file + ') but this Node.js cannot open it. Install Node.js 22.13+ LTS (or 24 LTS) and start again.');
  console.warn('[db] No SQLite driver available — using JSON file store (install Node.js 22.13+ LTS for the built-in node:sqlite).');
  return new JsonStore(path.join(dataDir, 'ssdc-db.json'));
}

module.exports = { openStore, uid };
