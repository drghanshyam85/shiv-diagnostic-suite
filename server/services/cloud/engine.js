/*
 * Multi-Cloud Auto-Save Engine
 *   - every document change → Firestore record job (dedupe per record)
 *   - every N seconds with changes → JSON backup + daily register CSV → Drive & OneDrive
 *   - report PDFs/DOCX & scan images uploaded by clients → Drive, OneDrive, Cloud Storage
 *   - offline queue with exponential back-off; status pushed to clients via Socket.io
 */
const fs = require('fs');
const path = require('path');
const google = require('./google');
const microsoft = require('./microsoft');
const gcp = require('./gcp');
const crypto = require('crypto');
const { getIntegrations } = require('../integrations');
const { localDigests, compareRemote, fromDrive, fromOneDrive, fromGcs } = require('./integrity');

const MANIFEST_KV = 'cloud:manifest';
const VERIFY_KV = 'cloud:lastVerify';
const MANIFEST_MAX = 400;

const PROVIDERS = ['gdrive', 'onedrive', 'gcp'];
const RECORD_COLLS = new Set(['patients', 'visits', 'invoices', 'reports', 'labReports', 'formf', 'expenses', 'doctors', 'tests', 'statements', 'dispatchLog', 'msgTemplates', 'dictionary']);
const NET_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

function isNetworkError(e) {
  const code = (e && e.cause && e.cause.code) || (e && e.code);
  return NET_CODES.has(code) || /fetch failed|network|socket hang up/i.test(String(e && e.message));
}

function createCloudEngine(ctx, io) {
  const outDir = path.join(ctx.dataDir, 'cloud-out');
  fs.mkdirSync(outDir, { recursive: true });
  const state = {};
  PROVIDERS.forEach((p) => { state[p] = { status: 'not_connected', pending: 0, lastSyncAt: null, lastError: null, account: '', quota: null }; });
  let busy = false;
  let dirty = false;
  let lastBackup = 0;
  let timer = null;

  async function prefs() { return Object.assign({ gdrive: true, onedrive: true, gcp: true }, (await ctx.store.kvGet('cloud:prefs', {})) || {}); }

  async function connections() {
    return {
      gdrive: await google.connection(ctx),
      onedrive: await microsoft.connection(ctx),
      gcp: await gcp.connection(ctx)
    };
  }

  async function activeProviders() {
    const [c, p] = [await connections(), await prefs()];
    return PROVIDERS.filter((x) => c[x].connected && p[x] !== false);
  }

  async function status() {
    const c = await connections();
    const p = await prefs();
    const stats = await ctx.store.cloudQueueStats();
    const out = {};
    for (const prov of PROVIDERS) {
      const s = stats[prov] || {};
      const pending = (s.pending || 0) + (s.error || 0) + (s.working || 0);
      let st = state[prov].status;
      if (!c[prov].connected) st = 'not_connected';
      else if (p[prov] === false) st = 'paused';
      else if (st !== 'offline' && st !== 'error') st = pending ? 'saving' : 'synced';
      out[prov] = Object.assign({}, state[prov], { status: st, pending, enabled: p[prov] !== false, connected: c[prov].connected, account: c[prov].account || '' });
    }
    const settings = await ctx.getSettings();
    const lv = (await ctx.store.kvGet(VERIFY_KV, null)) || null;
    const connectedFiles = PROVIDERS.filter((x) => out[x].connected && out[x].enabled && (x !== 'gcp' || true)).length;
    return {
      providers: out, rootFolder: settings.cloud.rootFolder, autoSync: settings.cloud.autoSync, intervalSeconds: settings.cloud.intervalSeconds,
      // multi-cloud redundancy: how many independent clouds hold a copy, and the latest integrity audit
      redundancy: { clouds: connectedFiles, recommended: 2 },
      integrity: lv ? { at: lv.at, summary: lv.summary, by: lv.by } : null
    };
  }

  async function broadcast() { try { io.emit('cloud:status', await status()); } catch (e) { /* ignore */ } }

  // ---- enqueue helpers -----------------------------------------------------------------
  async function enqueueFile({ localPath, relPath, mimeType, providers, asGoogleDoc }) {
    const targets = (providers && providers.length ? providers : await activeProviders()).filter((x) => PROVIDERS.includes(x));
    const ids = [];
    for (const provider of targets) {
      ids.push(await ctx.store.enqueueCloud({ provider, kind: 'file', dedupe: 'file:' + relPath, path: relPath, ref: localPath, payload: { mimeType, asGoogleDoc: !!asGoogleDoc } }));
    }
    broadcast();
    return { queued: ids.length, providers: targets };
  }

  async function onChange({ coll, doc }) {
    if (!RECORD_COLLS.has(coll)) return;
    dirty = true;
    const settings = await ctx.getSettings();
    if (!settings.cloud.autoSync || !settings.cloud.syncRecords) return;
    const conn = await gcp.connection(ctx);
    const pr = await prefs();
    if (conn.connected && pr.gcp !== false) {
      await ctx.store.enqueueCloud({ provider: 'gcp', kind: 'record', dedupe: 'rec:' + coll + '/' + doc.id, path: coll + '/' + doc.id, ref: coll + '/' + doc.id, payload: {} });
    }
  }

  async function writeBackups() {
    const settings = await ctx.getSettings();
    if (!settings.cloud.autoSync) return;
    const targets = (await activeProviders()).filter((x) => x !== 'gcp' || true);
    if (!targets.length) return;
    const today = new Date();
    const dk = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    const dump = {};
    for (const coll of RECORD_COLLS) dump[coll] = await ctx.store.listDocs(coll);
    dump.settings = await ctx.store.listDocs('settings');
    const backupPath = path.join(outDir, 'ssdc-backup-' + dk + '.json');
    fs.writeFileSync(backupPath, JSON.stringify({ app: 'ssdc-suite', exportedAt: new Date().toISOString(), data: dump }));
    const invoices = dump.invoices.filter((i) => i.dateKey === dk);
    const esc = (v) => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['Bill No', 'Time', 'Patient', 'Reg ID', 'Investigations', 'Gross', 'Discount', 'Net', 'Paid', 'Balance', 'Mode', 'Staff'].map(esc).join(',')];
    invoices.forEach((i) => rows.push([i.invoiceNo, new Date(i.date).toLocaleTimeString('en-IN'), (i.patient.title || '') + ' ' + i.patient.name, i.patient.regId, (i.items || []).map((x) => x.name).join('; '), i.gross, i.discountAmount, i.net, i.paid, i.balance, i.paymentMode, i.staffId].map(esc).join(',')));
    const csvPath = path.join(outDir, 'Daily_Register_' + dk + '.csv');
    fs.writeFileSync(csvPath, '﻿' + rows.join('\r\n'));
    for (const provider of targets) {
      if (provider === 'gcp') {
        if (settings.cloud.syncRecords) await ctx.store.enqueueCloud({ provider, kind: 'file', dedupe: 'backup:' + dk, path: '_Backups/ssdc-backup-' + dk + '.json', ref: backupPath, payload: { mimeType: 'application/json' } });
        continue;
      }
      await ctx.store.enqueueCloud({ provider, kind: 'file', dedupe: 'backup:' + dk, path: '_Backups/ssdc-backup-' + dk + '.json', ref: backupPath, payload: { mimeType: 'application/json' } });
      await ctx.store.enqueueCloud({ provider, kind: 'file', dedupe: 'register:' + dk, path: dk + '/Daily_Register_' + dk + '.csv', ref: csvPath, payload: { mimeType: 'text/csv' } });
    }
    lastBackup = Date.now();
    dirty = false;
  }

  // ---- worker --------------------------------------------------------------------------
  async function processItem(item, cfg, settings) {
    const root = settings.cloud.rootFolder || 'Shiv_Ultrasonography_Diagnostic_Center';
    if (item.kind === 'record') {
      const [coll, ...rest] = String(item.ref).split('/');
      const id = rest.join('/');
      const doc = await ctx.store.getDoc(coll, id);
      if (!doc) return { detail: 'record no longer exists' };
      const projectId = cfg.gcp.projectId || ((await ctx.store.kvGet('cloud:gcp:sa', {})) || {}).project_id;
      if (!projectId) throw new Error('GCP project id not configured');
      const clean = ctx.sanitizeForClient(coll, doc);
      const r = await gcp.firestoreUpsert(ctx, projectId, coll, id, clean);
      const json = JSON.stringify(clean);
      return { link: r.link, size: json.length, detail: 'record sha256 ' + crypto.createHash('sha256').update(json).digest('hex').slice(0, 12) + '…', stored: true };
    }
    const localPath = item.ref && path.isAbsolute(item.ref) ? item.ref : path.join(ctx.filesDir, String(item.ref));
    if (!fs.existsSync(localPath)) return { detail: 'local file missing — skipped' };
    const buffer = fs.readFileSync(localPath);
    const parts = String(item.path).split('/').filter(Boolean);
    const filename = parts.pop();
    const segments = [root].concat(parts);
    const mime = (item.payload && item.payload.mimeType) || 'application/octet-stream';
    const local = localDigests(buffer);
    let r;
    let cmp;
    if (item.provider === 'gdrive') {
      r = await google.uploadFile(ctx, cfg, { segments, filename, buffer, mimeType: mime, asGoogleDoc: item.payload && item.payload.asGoogleDoc });
      cmp = r.converted ? { ok: null, detail: 'converted to a Google Doc (no checksum)' } : compareRemote('gdrive', local, fromDrive(r.meta));
    } else if (item.provider === 'onedrive') {
      r = await microsoft.uploadFile(ctx, cfg, { segments, filename, buffer, mimeType: mime });
      cmp = compareRemote('onedrive', local, fromOneDrive(r.meta));
    } else if (item.provider === 'gcp') {
      if (!cfg.gcp.bucket) throw new Error('Cloud Storage bucket not configured');
      r = await gcp.gcsUpload(ctx, cfg.gcp.bucket, segments.concat([filename]).join('/'), buffer, mime);
      cmp = compareRemote('gcp', local, fromGcs(r.meta));
    } else throw new Error('Unknown provider ' + item.provider);
    // the provider's own checksum must match the clinic file — otherwise fail so the item is retried
    if (cmp.ok === false) throw new Error('Integrity check failed: ' + cmp.detail);
    await recordManifest(item, local, mime, cmp, !!(r && r.converted));
    return { link: r.link, size: buffer.length, detail: (r.updated ? 'new revision · ' : '') + cmp.detail, verified: cmp.ok === true };
  }

  // ---- integrity manifest & audit ------------------------------------------------------
  let manifestLock = Promise.resolve();
  function recordManifest(item, local, mimeType, cmp, converted) {
    manifestLock = manifestLock.then(async () => {
      const m = (await ctx.store.kvGet(MANIFEST_KV, null)) || { entries: {} };
      const e = m.entries[item.path] || { providers: {} };
      e.ref = item.ref; e.size = local.size; e.sha256 = local.sha256Hex; e.mimeType = mimeType; e.at = Date.now(); e.converted = converted || e.converted || false;
      e.providers[item.provider] = { at: Date.now(), ok: cmp.ok, algo: cmp.algo || '' };
      m.entries[item.path] = e;
      const keys = Object.keys(m.entries);
      if (keys.length > MANIFEST_MAX) keys.sort((a, b) => m.entries[a].at - m.entries[b].at).slice(0, keys.length - MANIFEST_MAX).forEach((k) => { delete m.entries[k]; });
      await ctx.store.kvSet(MANIFEST_KV, m);
    }).catch(() => {});
    return manifestLock;
  }
  const resolveRef = (ref) => (ref && path.isAbsolute(ref) ? ref : path.join(ctx.filesDir, String(ref || '')));

  async function remoteMeta(provider, cfg, segments, filename) {
    if (provider === 'gdrive') return fromDrive(await google.fileMeta(ctx, cfg, { segments, filename }));
    if (provider === 'onedrive') return fromOneDrive(await microsoft.itemMeta(ctx, cfg, { segments, filename }));
    if (provider === 'gcp') return cfg.gcp.bucket ? fromGcs(await gcp.gcsMeta(ctx, cfg.gcp.bucket, segments.concat([filename]).join('/'))) : undefined;
    return undefined;
  }

  let verifying = null;
  let lastVerifyCheck = Date.now() - 9 * 60 * 1000; // first look ~1 minute after start
  /** Daily integrity audit of the cloud copies, in the background. */
  async function dailyVerify() {
    const act = await activeProviders();
    if (!act.length) return;
    const lv = await ctx.store.kvGet(VERIFY_KV, null);
    const m = await ctx.store.kvGet(MANIFEST_KV, null);
    if (!m || !Object.keys(m.entries || {}).length) return;
    if (!lv || Date.now() - lv.at > 24 * 3600 * 1000) await verifyIntegrity({ limit: 25, by: 'daily check' });
  }
  /**
   * Re-read the cloud copies of the most recent files in every connected cloud and compare their
   * checksums with the clinic's files. Missing or damaged copies are re-queued (repair).
   */
  function verifyIntegrity({ limit = 40, repair = true, by = 'system' } = {}) {
    if (verifying) return verifying;
    verifying = (async () => {
      const cfg = await getIntegrations(ctx);
      const settings = await ctx.getSettings();
      const root = settings.cloud.rootFolder || 'Shiv_Ultrasonography_Diagnostic_Center';
      const act = await activeProviders();
      const m = (await ctx.store.kvGet(MANIFEST_KV, null)) || { entries: {} };
      const list = Object.entries(m.entries).sort((a, b) => b[1].at - a[1].at).slice(0, limit);
      const rows = [];
      const sum = { files: list.length, checked: 0, ok: 0, mismatch: 0, missing: 0, unchecked: 0, errors: 0, repaired: 0, localMissing: 0, copies: { 0: 0, 1: 0, 2: 0, 3: 0 } };
      for (const [p, e] of list) {
        const parts = String(p).split('/').filter(Boolean);
        const filename = parts.pop();
        const segments = [root].concat(parts);
        const lp = resolveRef(e.ref);
        const exists = fs.existsSync(lp);
        const local = exists ? localDigests(fs.readFileSync(lp)) : null;
        if (!exists) sum.localMissing += 1;
        const row = { path: p, size: local ? local.size : e.size, changedLocally: !!(local && e.sha256 && local.sha256Hex !== e.sha256), providers: {} };
        let good = 0;
        for (const prov of act) {
          if (prov === 'gcp' && !cfg.gcp.bucket) continue;
          try {
            const meta = await remoteMeta(prov, cfg, segments, filename);
            if (meta === undefined) continue;
            sum.checked += 1;
            if (!local) { row.providers[prov] = meta ? 'present (no local file to compare)' : 'missing'; if (meta) good += 1; else sum.missing += 1; continue; }
            const c = e.converted && prov === 'gdrive' ? { ok: meta ? null : false, detail: meta ? 'converted Google Doc' : 'not found in the cloud' } : compareRemote(prov, local, meta);
            let st = c.ok === true ? 'ok' : c.ok === null ? 'unchecked' : meta ? 'mismatch' : 'missing';
            if (st === 'mismatch' && row.changedLocally) st = 'outdated'; // the clinic file changed since: re-upload brings it up to date
            if (st === 'ok') { sum.ok += 1; good += 1; } else if (st === 'unchecked') { sum.unchecked += 1; good += 1; } else if (st === 'missing') sum.missing += 1; else sum.mismatch += 1;
            row.providers[prov] = st;
            if (repair && local && (st === 'missing' || st === 'mismatch' || st === 'outdated')) {
              await ctx.store.enqueueCloud({ provider: prov, kind: 'file', dedupe: 'file:' + p, path: p, ref: e.ref, payload: { mimeType: e.mimeType || 'application/octet-stream', asGoogleDoc: !!e.converted } });
              sum.repaired += 1;
              row.providers[prov] += ' → re-queued';
            }
          } catch (err) {
            sum.errors += 1;
            row.providers[prov] = 'error: ' + String(err.message || err).slice(0, 120);
            if (isNetworkError(err)) break;
          }
        }
        sum.copies[Math.min(3, good)] += 1;
        rows.push(row);
      }
      const report = { at: Date.now(), by, providers: act, summary: sum, rows: rows.slice(0, 80) };
      await ctx.store.kvSet(VERIFY_KV, report);
      await ctx.store.addCloudLog({ provider: act.join('+') || '—', action: 'verify', path: sum.files + ' file(s)', size: 0, status: sum.mismatch || sum.missing ? 'repaired' : sum.errors ? 'failed' : 'verified', detail: `${sum.ok} copies verified · ${sum.mismatch} damaged · ${sum.missing} missing · ${sum.repaired} re-queued · ${sum.errors} errors` });
      broadcast();
      return report;
    })().finally(() => { verifying = null; });
    return verifying;
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const settings = await ctx.getSettings();
      const interval = Math.max(15, Number(settings.cloud.intervalSeconds) || 60) * 1000;
      if (dirty && Date.now() - lastBackup > interval) await writeBackups().catch((e) => console.error('[cloud] backup', e.message));
      if (!verifying && Date.now() - lastVerifyCheck > 10 * 60 * 1000) { lastVerifyCheck = Date.now(); dailyVerify().catch(() => {}); }
      const items = await ctx.store.dueCloudItems(8);
      if (!items.length) return;
      const cfg = await getIntegrations(ctx);
      const act = await activeProviders();
      for (const item of items) {
        if (!act.includes(item.provider)) continue;
        await ctx.store.updateCloudItem(item.id, { status: 'working' });
        state[item.provider].status = 'saving';
        broadcast();
        try {
          const r = await processItem(item, cfg, settings);
          await ctx.store.updateCloudItem(item.id, { status: 'done', lastError: null });
          state[item.provider].lastSyncAt = Date.now();
          state[item.provider].lastError = null;
          state[item.provider].status = 'synced';
          await ctx.store.addCloudLog({ provider: item.provider, action: item.kind, path: item.path, size: r.size || 0, status: r.stored ? 'stored' : r.verified ? 'verified' : 'uploaded', detail: r.detail || '', link: r.link || '' });
        } catch (e) {
          const attempts = (item.attempts || 0) + 1;
          const offline = isNetworkError(e);
          const delay = Math.min(10 * 60 * 1000, 5000 * Math.pow(2, Math.min(attempts, 7)));
          await ctx.store.updateCloudItem(item.id, { status: 'error', attempts, lastError: e.message, nextAt: Date.now() + delay });
          state[item.provider].status = offline ? 'offline' : 'error';
          state[item.provider].lastError = e.message;
          await ctx.store.addCloudLog({ provider: item.provider, action: item.kind, path: item.path, status: offline ? 'queued-offline' : 'failed', detail: e.message.slice(0, 300) });
          if (offline) break;
        }
      }
      await ctx.store.purgeCloudDone(24 * 3600 * 1000);
    } catch (e) {
      console.error('[cloud] tick error', e.message);
    } finally {
      busy = false;
      broadcast();
    }
  }

  async function forceFullSync() {
    dirty = true;
    lastBackup = 0;
    const conn = await gcp.connection(ctx);
    let n = 0;
    if (conn.connected) {
      for (const coll of RECORD_COLLS) {
        for (const d of await ctx.store.listDocs(coll)) {
          await ctx.store.enqueueCloud({ provider: 'gcp', kind: 'record', dedupe: 'rec:' + coll + '/' + d.id, path: coll + '/' + d.id, ref: coll + '/' + d.id, payload: {} });
          n++;
        }
      }
    }
    await writeBackups();
    broadcast();
    return { records: n };
  }

  async function retryAll() {
    for (const q of await ctx.store.listCloudQueue(5000)) {
      if (q.status === 'error') await ctx.store.updateCloudItem(q.id, { status: 'pending', nextAt: Date.now() });
    }
    PROVIDERS.forEach((p) => { if (state[p].status === 'error' || state[p].status === 'offline') state[p].status = 'saving'; });
    broadcast();
  }

  async function refreshQuotas() {
    const cfg = await getIntegrations(ctx);
    const c = await connections();
    if (c.gdrive.connected) { try { state.gdrive.quota = await google.quota(ctx, cfg); } catch (e) { state.gdrive.lastError = e.message; } }
    if (c.onedrive.connected) { try { state.onedrive.quota = await microsoft.quota(ctx, cfg); } catch (e) { state.onedrive.lastError = e.message; } }
    broadcast();
  }

  function start() {
    ctx.bus.on('change', (ev) => { onChange(ev).catch(() => {}); });
    timer = setInterval(tick, 4000);
    setTimeout(refreshQuotas, 3000);
  }
  function stop() { clearInterval(timer); }

  const lastVerify = async () => ctx.store.kvGet(VERIFY_KV, null);
  return { start, stop, status, broadcast, enqueueFile, forceFullSync, retryAll, refreshQuotas, prefs, outDir, PROVIDERS, verifyIntegrity, lastVerify };
}

module.exports = { createCloudEngine };
