/*
 * Optional PostgreSQL adapter (for Render / Railway managed Postgres).
 * Enable with:  npm install pg   and   DATABASE_URL=postgres://user:pass@host:5432/db
 * Implements the same async interface as SqliteStore in db.js.
 */
const crypto = require('crypto');

const SCHEMA = `
CREATE SEQUENCE IF NOT EXISTS docs_seq;
CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
  updated_at BIGINT NOT NULL, deleted SMALLINT NOT NULL DEFAULT 0, seq BIGINT NOT NULL, PRIMARY KEY (coll, id));
CREATE INDEX IF NOT EXISTS idx_docs_seq ON docs(seq);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, value BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, actor_id TEXT, actor_name TEXT, actor_role TEXT, action TEXT,
  target_resource TEXT, ip_address TEXT, timestamp BIGINT, metadata TEXT);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(timestamp);
CREATE TABLE IF NOT EXISTS share_links (token TEXT PRIMARY KEY, kind TEXT, ref TEXT, expires_at BIGINT, created_at BIGINT, hits INTEGER DEFAULT 0, meta TEXT);
CREATE TABLE IF NOT EXISTS cloud_queue (id TEXT PRIMARY KEY, provider TEXT, kind TEXT, dedupe TEXT, path TEXT, ref TEXT, payload TEXT,
  status TEXT, attempts INTEGER DEFAULT 0, last_error TEXT, created_at BIGINT, updated_at BIGINT, next_at BIGINT);
CREATE TABLE IF NOT EXISTS cloud_log (id TEXT PRIMARY KEY, provider TEXT, action TEXT, path TEXT, size BIGINT, status TEXT, detail TEXT, link TEXT, at BIGINT);
`;

const uid = (p) => (p || '') + crypto.randomBytes(9).toString('base64url');
const N = (v) => (v === null || v === undefined ? null : Number(v));

class PgStore {
  constructor(pool) { this.pool = pool; this.kind = 'postgresql'; this.seq = 0; }
  async init() {
    await this.pool.query(SCHEMA);
    const r = await this.pool.query('SELECT COALESCE(MAX(seq),0) AS s FROM docs');
    this.seq = Number(r.rows[0].s);
  }
  async q(sql, params) { return (await this.pool.query(sql, params)).rows; }
  async getDoc(coll, id) {
    const r = await this.q('SELECT data FROM docs WHERE coll=$1 AND id=$2', [coll, id]);
    return r[0] ? JSON.parse(r[0].data) : null;
  }
  async putDoc(coll, doc, opts = {}) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const cur = (await c.query('SELECT data, updated_at FROM docs WHERE coll=$1 AND id=$2 FOR UPDATE', [coll, doc.id])).rows[0];
      const ts = Number(doc.updatedAt || 0);
      if (cur && !opts.force && ts <= Number(cur.updated_at)) { await c.query('ROLLBACK'); return { status: 'stale', doc: JSON.parse(cur.data) }; }
      const toSave = opts.force && cur && ts <= Number(cur.updated_at) ? Object.assign({}, doc, { updatedAt: Number(cur.updated_at) + 1 }) : doc;
      const s = (await c.query("SELECT nextval('docs_seq') AS s")).rows[0].s;
      await c.query('INSERT INTO docs(coll,id,data,updated_at,deleted,seq) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (coll,id) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at, deleted=EXCLUDED.deleted, seq=EXCLUDED.seq',
        [coll, String(toSave.id), JSON.stringify(toSave), Number(toSave.updatedAt || Date.now()), toSave._deleted ? 1 : 0, s]);
      await c.query('COMMIT');
      this.seq = Math.max(this.seq, Number(s));
      return { status: 'ok', doc: toSave, seq: Number(s), previous: cur ? JSON.parse(cur.data) : null };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }
  async putMany(coll, docs, opts) { const o = []; for (const d of docs) o.push(await this.putDoc(coll, d, opts)); return o; }
  async listDocs(coll, opts = {}) {
    const r = await this.q(opts.includeDeleted ? 'SELECT data FROM docs WHERE coll=$1' : 'SELECT data FROM docs WHERE coll=$1 AND deleted=0', [coll]);
    return r.map((x) => JSON.parse(x.data));
  }
  async countDocs(coll) { return Number((await this.q('SELECT COUNT(*) AS n FROM docs WHERE coll=$1 AND deleted=0', [coll]))[0].n); }
  async changesSince(seq, limit = 2000, exclude = []) {
    const rows = await this.q('SELECT coll, data, seq FROM docs WHERE seq > $1 ORDER BY seq ASC LIMIT $2', [Number(seq) || 0, limit + 1]);
    const page = rows.slice(0, limit);
    return {
      changes: page.filter((r) => !exclude.includes(r.coll)).map((r) => ({ coll: r.coll, doc: JSON.parse(r.data), seq: Number(r.seq) })),
      seq: page.length ? Number(page[page.length - 1].seq) : Number(seq) || 0, more: rows.length > limit, head: this.seq
    };
  }
  async nextCounter(key, min) {
    const r = await this.q('INSERT INTO counters(key,value) VALUES($1, GREATEST(1, $2::bigint + 1)) ON CONFLICT (key) DO UPDATE SET value = GREATEST(counters.value + 1, $2::bigint + 1) RETURNING value', [key, Number(min) || 0]);
    return Number(r[0].value);
  }
  async peekCounter(key) { const r = await this.q('SELECT value FROM counters WHERE key=$1', [key]); return r[0] ? Number(r[0].value) : 0; }
  async setCounter(key, value) { await this.q('INSERT INTO counters(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value = GREATEST(counters.value, EXCLUDED.value)', [key, Number(value)]); }
  async resetCounter(key, value) { await this.q('INSERT INTO counters(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, Number(value)]); }
  async allCounters() { const o = {}; for (const r of await this.q('SELECT key, value FROM counters')) o[r.key] = Number(r.value); return o; }
  async kvGet(key, fb = null) { const r = await this.q('SELECT value FROM meta WHERE key=$1', ['kv:' + key]); if (!r[0]) return fb; try { return JSON.parse(r[0].value); } catch (e) { return fb; } }
  async kvSet(key, value) { await this.q('INSERT INTO meta(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', ['kv:' + key, JSON.stringify(value)]); }
  async addAudit(e) {
    const row = { id: e.id || uid('al_'), actorId: e.actorId || null, actorName: e.actorName || null, actorRole: e.actorRole || null, action: e.action || null, targetResource: e.targetResource || null, ipAddress: e.ipAddress || null, timestamp: e.timestamp || Date.now(), metadata: e.metadata || {} };
    await this.q('INSERT INTO audit_logs VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING', [row.id, row.actorId, row.actorName, row.actorRole, row.action, row.targetResource, row.ipAddress, row.timestamp, JSON.stringify(row.metadata)]);
    return row;
  }
  async queryAudit(f = {}) {
    const w = []; const p = [];
    const add = (cond, val) => { p.push(val); w.push(cond.replace('?', '$' + p.length)); };
    if (f.q) { p.push('%' + f.q + '%'); const i = p.length; w.push(`(actor_name ILIKE $${i} OR action ILIKE $${i} OR target_resource ILIKE $${i} OR metadata ILIKE $${i})`); }
    if (f.action) add('action LIKE ?', f.action + '%');
    if (f.actorId) add('actor_id = ?', f.actorId);
    if (f.from) add('timestamp >= ?', Number(f.from));
    if (f.to) add('timestamp <= ?', Number(f.to));
    const where = w.length ? ' WHERE ' + w.join(' AND ') : '';
    const total = Number((await this.q('SELECT COUNT(*) AS n FROM audit_logs' + where, p))[0].n);
    const rows = await this.q(`SELECT * FROM audit_logs${where} ORDER BY timestamp DESC LIMIT ${Number(f.limit) || 200} OFFSET ${Number(f.offset) || 0}`, p);
    return { total, rows: rows.map((r) => ({ id: r.id, actorId: r.actor_id, actorName: r.actor_name, actorRole: r.actor_role, action: r.action, targetResource: r.target_resource, ipAddress: r.ip_address, timestamp: Number(r.timestamp), metadata: JSON.parse(r.metadata || '{}') })) };
  }
  async createShareLink(s) { const token = s.token || crypto.randomBytes(12).toString('base64url'); await this.q('INSERT INTO share_links VALUES($1,$2,$3,$4,$5,0,$6) ON CONFLICT (token) DO UPDATE SET kind=EXCLUDED.kind, ref=EXCLUDED.ref, expires_at=EXCLUDED.expires_at, meta=EXCLUDED.meta', [token, s.kind, s.ref, s.expiresAt || null, Date.now(), JSON.stringify(s.meta || {})]); return token; }
  async getShareLink(token) { const r = (await this.q('SELECT * FROM share_links WHERE token=$1', [token]))[0]; return r ? { token: r.token, kind: r.kind, ref: r.ref, expiresAt: N(r.expires_at), createdAt: N(r.created_at), hits: N(r.hits), meta: JSON.parse(r.meta || '{}') } : null; }
  async hitShareLink(token) { await this.q('UPDATE share_links SET hits = hits + 1 WHERE token=$1', [token]); }
  _mq(r) { return { id: r.id, provider: r.provider, kind: r.kind, dedupe: r.dedupe, path: r.path, ref: r.ref, payload: JSON.parse(r.payload || '{}'), status: r.status, attempts: N(r.attempts), lastError: r.last_error, createdAt: N(r.created_at), updatedAt: N(r.updated_at), nextAt: N(r.next_at) }; }
  async enqueueCloud(item) {
    const now = Date.now();
    if (item.dedupe) {
      const ex = (await this.q("SELECT id FROM cloud_queue WHERE dedupe=$1 AND provider=$2 AND status IN ('pending','error')", [item.dedupe, item.provider]))[0];
      if (ex) { await this.q("UPDATE cloud_queue SET path=$1, ref=$2, payload=$3, status='pending', next_at=$4, updated_at=$4 WHERE id=$5", [item.path || null, item.ref || null, JSON.stringify(item.payload || {}), now, ex.id]); return ex.id; }
    }
    const id = uid('cq_');
    await this.q("INSERT INTO cloud_queue VALUES($1,$2,$3,$4,$5,$6,$7,'pending',0,NULL,$8,$8,$8)", [id, item.provider, item.kind, item.dedupe || null, item.path || null, item.ref || null, JSON.stringify(item.payload || {}), now]);
    return id;
  }
  async dueCloudItems(limit = 10) { return (await this.q("SELECT * FROM cloud_queue WHERE status IN ('pending','error') AND next_at <= $1 ORDER BY created_at ASC LIMIT $2", [Date.now(), limit])).map((r) => this._mq(r)); }
  async updateCloudItem(id, patch) {
    const cur = (await this.q('SELECT * FROM cloud_queue WHERE id=$1', [id]))[0];
    if (!cur) return;
    const n = Object.assign(this._mq(cur), patch);
    await this.q('UPDATE cloud_queue SET status=$1, attempts=$2, last_error=$3, next_at=$4, updated_at=$5 WHERE id=$6', [n.status, n.attempts, n.lastError || null, n.nextAt, Date.now(), id]);
  }
  async listCloudQueue(limit = 200) { return (await this.q('SELECT * FROM cloud_queue ORDER BY updated_at DESC LIMIT $1', [limit])).map((r) => this._mq(r)); }
  async cloudQueueStats() { const o = {}; for (const r of await this.q('SELECT provider, status, COUNT(*) AS n FROM cloud_queue GROUP BY provider, status')) { o[r.provider] = o[r.provider] || {}; o[r.provider][r.status] = Number(r.n); } return o; }
  async purgeCloudDone(ms) { await this.q("DELETE FROM cloud_queue WHERE status='done' AND updated_at < $1", [Date.now() - ms]); }
  async addCloudLog(e) { await this.q('INSERT INTO cloud_log VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [uid('cl_'), e.provider || null, e.action || null, e.path || null, Number(e.size || 0), e.status || null, e.detail || null, e.link || null, Date.now()]); }
  async listCloudLog(limit = 300) { return (await this.q('SELECT * FROM cloud_log ORDER BY at DESC LIMIT $1', [limit])).map((r) => ({ id: r.id, provider: r.provider, action: r.action, path: r.path, size: N(r.size), status: r.status, detail: r.detail, link: r.link, at: N(r.at) })); }
}

async function openPgStore(url) {
  const { Pool } = require('pg');
  const needsSsl = /sslmode=require|render\.com|railway|neon\.tech|supabase/i.test(url);
  const pool = new Pool({ connectionString: url, ssl: needsSsl ? { rejectUnauthorized: false } : undefined, max: 8 });
  const store = new PgStore(pool);
  await store.init();
  return store;
}

module.exports = { openPgStore };
