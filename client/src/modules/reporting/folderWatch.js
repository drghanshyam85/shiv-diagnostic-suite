// Auto-folder watch for ultrasound captures exported by the USG console (e.g. Voluson S10 Expert
// "Export → JPEG / BMP / DICOM" to a USB stick, a shared folder or a cloud-synced folder). Uses the File
// System Access API (Chrome / Edge): the chosen folder handle is kept in IndexedDB, scanned every few
// seconds (plus three levels of sub-folders, as DICOM exports nest PATIENT/STUDY/SERIES), and files
// that appear after watching started are handed to the open report once their size has stopped
// changing (the console has finished writing them). DICOM files often have no extension (IM_0001).
import { events } from '../../core/store';
import { kvGet, kvSet } from '../../core/idb';

const IMG = /\.(jpe?g|png|bmp|webp|gif|dcm|dicom|dic)$/i;
const HAS_EXT = /\.[a-z0-9]{2,5}$/i;
const wanted = (name) => (IMG.test(name) || !HAS_EXT.test(name)) && name.toUpperCase() !== 'DICOMDIR' && !name.startsWith('.');
const KEY = 'usg-folder-handle';
const EVERY = 2500;

const state = { handle: null, name: '', active: false, since: 0, error: '', imported: 0, pending: [] };
let seen = new Set();
let sizes = new Map();
let timer = null;
let scanning = false;
const subs = new Set();

export const folderWatchSupported = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
export const watchState = () => ({ name: state.name, active: state.active, since: state.since, error: state.error, imported: state.imported, pending: state.pending.length });
export function onWatch(fn) { subs.add(fn); return () => subs.delete(fn); }
function bump() { const s = watchState(); subs.forEach((f) => f(s)); }

async function* imageFiles(dir, path = '', depth = 0) {
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'file' && wanted(name)) yield { key: path + name, handle: h };
    else if (h.kind === 'directory' && depth < 3 && !name.startsWith('.')) yield* imageFiles(h, path + name + '/', depth + 1);
  }
}

async function start(handle) {
  stopWatching();
  seen = new Set();
  sizes = new Map();
  // files already in the folder are history — only new exports are imported
  for await (const it of imageFiles(handle)) { const f = await it.handle.getFile(); seen.add(it.key + ':' + f.lastModified); }
  Object.assign(state, { handle, name: handle.name, active: true, since: Date.now(), error: '', imported: 0 });
  timer = setInterval(scan, EVERY);
  bump();
  return true;
}

async function scan() {
  if (scanning || !state.handle) return;
  scanning = true;
  try {
    const fresh = [];
    for await (const it of imageFiles(state.handle)) {
      const f = await it.handle.getFile();
      const key = it.key + ':' + f.lastModified;
      if (seen.has(key)) continue;
      if (sizes.get(key) !== f.size || !f.size) { sizes.set(key, f.size); continue; } // still being written
      sizes.delete(key);
      seen.add(key);
      fresh.push(f);
    }
    if (fresh.length) {
      fresh.sort((a, b) => a.lastModified - b.lastModified);
      state.pending = state.pending.concat(fresh);
      state.imported += fresh.length;
      events.emit('usg:folder-images', fresh);
      bump();
    }
  } catch (e) {
    state.error = e && e.name === 'NotAllowedError' ? 'Folder permission was withdrawn — click Resume' : (e && e.message) || 'Folder could not be read';
    stopWatching();
  } finally { scanning = false; }
}

/** Pick the console's export folder (needs a click) and start watching it. */
export async function chooseFolder() {
  const handle = await window.showDirectoryPicker({ id: 'usg-export', mode: 'read' });
  try { await kvSet(KEY, handle); } catch (e) { /* handle not storable here — watch for this session only */ }
  return start(handle);
}

/** Resume the remembered folder; `interactive` may show the browser's permission prompt (needs a click). */
export async function resumeFolder(interactive = true) {
  const handle = await kvGet(KEY, null);
  if (!handle || typeof handle.queryPermission !== 'function') return false;
  let perm = await handle.queryPermission({ mode: 'read' });
  if (perm !== 'granted' && interactive) perm = await handle.requestPermission({ mode: 'read' });
  if (perm !== 'granted') return false;
  return start(handle);
}

export async function savedFolderName() {
  try { const h = await kvGet(KEY, null); return h ? h.name : ''; } catch (e) { return ''; }
}

export function stopWatching() {
  if (timer) clearInterval(timer);
  timer = null;
  state.active = false;
  bump();
}

/** Images that arrived while no editable report was open. */
export function takePending() {
  const out = state.pending;
  state.pending = [];
  bump();
  return out;
}
export const clearPending = () => { state.pending = []; bump(); };
