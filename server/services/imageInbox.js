/*
 * Image inbox — cloud folder syncing for ultrasound images.
 * Watches a folder on the clinic server PC: usually a cloud-synced folder (Google Drive for desktop,
 * OneDrive, Dropbox) or the network share the ultrasound console exports to. New JPEG / PNG / BMP and
 * DICOM files (with or without the .dcm extension) are copied into the clinic's file store and matched
 * to a recent patient by DICOM Patient ID, accession / token, the Reg ID or token in the file name, or
 * the DICOM patient name. Every workstation sees them instantly (collection "files", kind
 * "image-inbox") and attaches them to the report from the Images tab.
 * Settings (clinic settings → imageInbox): { enabled, folder, depth, moveImported, matchDays }.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { parseDicom, isDicom, TS } = require('../../shared/dicom');

const IMG_EXT = /\.(jpe?g|png|bmp)$/i;
const DCM_EXT = /\.(dcm|dicom|dic)$/i;
const OTHER_EXT = /\.[a-z0-9]{2,5}$/i;
const SKIP_DIR = /^(\.|imported$|processed$|\$recycle|system volume information|thumbs)/i;
const SEEN_KV = 'imageInbox:seen';
const EVERY = 6000;
const MAX_BYTES = 80 * 1024 * 1024;
const FIRST_RUN_WINDOW = 12 * 3600 * 1000; // on a new folder, only files from the last 12 h are imported

const TITLES = /^(mr|mrs|ms|miss|smt|shri|sri|baby|master|dr|kumari|km)$/i;
const nameTokens = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t && !TITLES.test(t));
const idKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { kind: 'image', mime: 'image/png' };
  if (buf.length > 2 && buf[0] === 0x42 && buf[1] === 0x4d) return { kind: 'image', mime: 'image/bmp' };
  if (isDicom(buf)) return { kind: 'dicom', mime: 'application/dicom' };
  return null;
}

function dicomHeader(buf) {
  let d = parseDicom(buf, { headerOnly: true });
  if (d.deflated) {
    try {
      const inf = zlib.inflateRawSync(buf.subarray(d.datasetOffset));
      d = parseDicom(Buffer.concat([buf.subarray(0, d.datasetOffset), inf]), { headerOnly: true, forceSyntax: TS.EXPLICIT_LE });
    } catch (e) { return null; }
  }
  if (!d.ok) return null;
  const m = d.meta;
  return {
    patientName: m.patientName || '', patientId: m.patientId || '', sex: m.patientSex || '', modality: m.modality || '',
    manufacturer: m.manufacturer || '', model: m.model || '', series: m.seriesDescription || '', study: m.studyDescription || '',
    bodyPart: m.bodyPart || '', protocol: m.protocolName || '', comments: m.imageComments || '', accession: m.accessionNumber || '',
    acquiredAt: m.acquiredAt || 0, frames: m.frames || 1, size: (m.columns || 0) + '×' + (m.rows || 0), syntax: d.syntaxName
  };
}

function createImageInbox(ctx) {
  const state = { enabled: false, folder: '', watching: false, lastScanAt: 0, lastImportAt: 0, imported: 0, error: '', scanning: false };
  let seen = null;
  let seenDirty = false;
  const sizes = new Map();
  let timer = null;
  let initFor = '';

  async function loadSeen() {
    if (seen) return;
    const arr = (await ctx.store.kvGet(SEEN_KV, [])) || [];
    seen = new Set(arr);
  }
  async function saveSeen() {
    if (!seenDirty) return;
    seenDirty = false;
    await ctx.store.kvSet(SEEN_KV, Array.from(seen).slice(-30000));
  }
  const mark = (k) => { seen.add(k); seenDirty = true; };

  function list(dir, depth, rel, out) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { if (!rel) throw e; return out; }
    for (const e of ents) {
      if (e.isDirectory()) {
        if (depth > 0 && !SKIP_DIR.test(e.name)) list(path.join(dir, e.name), depth - 1, rel + e.name + '/', out);
        continue;
      }
      if (!e.isFile() || e.name.startsWith('.') || e.name.startsWith('~')) continue;
      // images, .dcm, and extension-less console exports (IM_0001, US000001…)
      if (!IMG_EXT.test(e.name) && !DCM_EXT.test(e.name) && OTHER_EXT.test(e.name)) continue;
      out.push({ full: path.join(dir, e.name), rel: rel + e.name, name: e.name });
      if (out.length > 5000) break;
    }
    return out;
  }

  async function candidates(days) {
    const since = Date.now() - (Math.max(0, days) + 1) * 86400000;
    const visits = (await ctx.store.listDocs('visits')).filter((v) => !v._deleted && (v.createdAt || 0) >= since);
    const out = [];
    for (const v of visits) {
      const p = v.patientId ? await ctx.store.getDoc('patients', v.patientId) : null;
      out.push({ v, p, tokens: Object.values(v.tokens || {}).map(idKey).filter(Boolean), reg: idKey(p && p.regId), name: nameTokens((p && p.name) || v.patientName) });
    }
    return out.sort((a, b) => (b.v.createdAt || 0) - (a.v.createdAt || 0));
  }

  function match(cands, info, fileName) {
    const res = (c, by, confidence) => ({ patientId: (c.p && c.p.id) || c.v.patientId || '', visitId: c.v.id, regId: (c.p && c.p.regId) || '', patientName: (c.p && [c.p.title, c.p.name].filter(Boolean).join(' ')) || c.v.patientName || '', by, confidence });
    const fileKey = idKey(fileName);
    if (info) {
      const pid = idKey(info.patientId);
      if (pid) { const c = cands.find((x) => x.reg && x.reg === pid); if (c) return res(c, 'DICOM patient ID', 'high'); }
      const acc = idKey(info.accession);
      if (acc) { const c = cands.find((x) => idKey(x.v.id) === acc || x.tokens.includes(acc)); if (c) return res(c, 'DICOM accession number', 'high'); }
    }
    const byReg = cands.find((x) => x.reg && x.reg.length >= 6 && fileKey.includes(x.reg));
    if (byReg) return res(byReg, 'Reg ID in file name', 'high');
    // today's token in the file name: "USG-07 liver.jpg", "usg7_rk.png", "USG 007.dcm"
    const fn = ' ' + String(fileName).toUpperCase().replace(/\.[A-Z0-9]{2,5}$/, '').replace(/[^A-Z0-9]+/g, ' ').replace(/([A-Z]+) (\d+)/g, '$1$2') + ' ';
    const today = cands.filter((x) => new Date(x.v.createdAt || 0).toDateString() === new Date().toDateString());
    const hasTok = (t) => { const mm = /^([A-Z]+)0*(\d+)$/.exec(t); return !!mm && new RegExp('[^A-Z0-9]' + mm[1] + '0*' + mm[2] + '[^0-9]').test(fn); };
    const byTok = today.filter((x) => x.tokens.some(hasTok));
    if (byTok.length && new Set(byTok.map((x) => (x.p && x.p.id) || x.v.patientId)).size === 1) return res(byTok[0], 'token in file name', 'medium');
    if (info && info.patientName) {
      const want = nameTokens(info.patientName);
      const hits = cands.filter((x) => x.name.length && x.name[0] && want.includes(x.name[0]) && want.filter((t) => x.name.includes(t)).length >= Math.min(2, want.length, x.name.length));
      const people = new Set(hits.map((x) => (x.p && x.p.id) || x.v.patientId));
      if (people.size === 1) return res(hits[0], 'DICOM patient name', 'medium');
    }
    return null;
  }

  async function importOne(it, st, cands, cfg) {
    const buf = fs.readFileSync(it.full);
    const kind = sniff(buf);
    if (!kind) return false;
    const info = kind.kind === 'dicom' ? dicomHeader(buf) : null;
    if (kind.kind === 'dicom' && !info) return false;
    const id = 'f_' + crypto.randomBytes(10).toString('hex');
    fs.writeFileSync(path.join(ctx.filesDir, id), buf);
    const m = match(cands, info, it.name);
    const doc = {
      id, name: it.name, mime: kind.mime, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      storage: 'server', source: 'image-inbox', kind: 'image-inbox', category: 'Ultrasound image', status: 'new',
      relPath: it.rel, folder: path.basename(cfg.folder), mtime: st.mtimeMs, acquiredAt: (info && info.acquiredAt) || Math.round(st.mtimeMs),
      dicom: info, match: m, patientId: m ? m.patientId : '', patientName: m ? m.patientName : (info ? info.patientName : ''), visitId: m ? m.visitId : '',
      tags: ['inbox'], createdAt: Date.now(), createdBy: null, updatedAt: Date.now()
    };
    await ctx.saveDoc('files', doc, { actor: { id: 'system', name: 'Image inbox' }, force: true });
    if (cfg.moveImported) {
      try {
        const day = new Date().toISOString().slice(0, 10);
        const dest = path.join(cfg.folder, 'Imported', day);
        fs.mkdirSync(dest, { recursive: true });
        fs.renameSync(it.full, path.join(dest, it.name));
      } catch (e) { /* leave it in place; it is remembered as imported */ }
    }
    return true;
  }

  async function tick(manual) {
    if (state.scanning) return status();
    const s = await ctx.getSettings();
    const cfg = Object.assign({ enabled: false, folder: '', depth: 3, moveImported: false, matchDays: 1 }, s.imageInbox || {});
    state.enabled = !!cfg.enabled;
    state.folder = cfg.folder || '';
    if (!cfg.enabled || !cfg.folder) { state.watching = false; state.error = ''; return status(); }
    state.scanning = true;
    try {
      await loadSeen();
      if (!path.isAbsolute(cfg.folder)) throw new Error('Use a full folder path on the server PC, e.g. D:\\Google Drive\\USG Inbox');
      if (!fs.existsSync(cfg.folder) || !fs.statSync(cfg.folder).isDirectory()) throw new Error('Folder not found on the server PC: ' + cfg.folder);
      const items = list(cfg.folder, Math.max(0, Math.min(6, Number(cfg.depth) || 3)), '', []);
      const firstRun = initFor !== cfg.folder && !(await ctx.store.kvGet('imageInbox:init:' + cfg.folder, false));
      let cands = null;
      let n = 0;
      let tickErr = '';
      for (const it of items) {
        let st;
        try { st = fs.statSync(it.full); } catch (e) { continue; }
        const key = it.rel + ':' + Math.round(st.mtimeMs) + ':' + st.size;
        if (seen.has(key)) continue;
        if (firstRun && Date.now() - st.mtimeMs > FIRST_RUN_WINDOW) { mark(key); continue; }
        if (!st.size || st.size > MAX_BYTES) { if (st.size > MAX_BYTES) mark(key); continue; }
        // wait until the sync client / console has finished writing (same size on two scans, 2 s quiet)
        if (!manual && (sizes.get(it.rel) !== st.size || Date.now() - st.mtimeMs < 2000)) { sizes.set(it.rel, st.size); continue; }
        sizes.delete(it.rel);
        if (!cands) cands = await candidates(Number(cfg.matchDays) || 1);
        try { if (await importOne(it, st, cands, cfg)) { n += 1; state.lastImportAt = Date.now(); } } catch (e) { tickErr = it.name + ': ' + e.message; }
        mark(key);
        if (n >= 60) break; // keep each scan short; the rest come on the next one
      }
      if (firstRun) { initFor = cfg.folder; await ctx.store.kvSet('imageInbox:init:' + cfg.folder, true); }
      state.imported += n;
      state.watching = true;
      state.error = tickErr;
      await saveSeen();
    } catch (e) {
      state.watching = false;
      state.error = e.message;
    } finally {
      state.scanning = false;
      state.lastScanAt = Date.now();
    }
    return status();
  }

  function status() {
    return { enabled: state.enabled, folder: state.folder, watching: state.watching, lastScanAt: state.lastScanAt, lastImportAt: state.lastImportAt, imported: state.imported, error: state.error };
  }

  async function setStatus(fileId, patch, user) {
    const doc = await ctx.store.getDoc('files', fileId);
    if (!doc || doc.kind !== 'image-inbox') { const e = new Error('Inbox image not found'); e.status = 404; throw e; }
    const next = Object.assign({}, doc, patch, { updatedAt: Date.now() });
    await ctx.saveDoc('files', next, { actor: user, force: true });
    return next;
  }

  return {
    start() { if (!timer) { timer = setInterval(() => { tick(false).catch(() => {}); }, EVERY); setTimeout(() => tick(false).catch(() => {}), 2500); } },
    stop() { clearInterval(timer); timer = null; },
    status,
    scanNow: () => tick(true),
    attach: (fileId, reportId, user) => setStatus(fileId, { status: 'attached', attachedTo: { reportId: String(reportId || ''), at: Date.now(), by: user && user.id, byName: user && user.name } }, user),
    dismiss: (fileId, user) => setStatus(fileId, { status: 'dismissed', dismissedAt: Date.now(), dismissedBy: user && user.id }, user),
    restore: (fileId, user) => setStatus(fileId, { status: 'new', attachedTo: null }, user),
    _match: match, _sniff: sniff
  };
}

module.exports = { createImageInbox };
