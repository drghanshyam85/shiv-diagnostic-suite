// Multi-cloud report mirror. The clinic server owns the Google Drive / OneDrive / Google Cloud
// connections and its upload queue (retry, offline back-off, version history); this workstation
// renders what only a browser can — the A4 report PDF and the Word file — and hands them, with new
// scan images, to POST /api/cloud/upload under
//   <root>/YYYY-MM-DD/<PatientID>_<Patient_Name>/
// Only the workstation that edited a report mirrors it (no duplicate uploads from every PC).
import { store, events } from '../../core/store';
import { api, isServer, getNet } from '../../core/sync';
import { kvGet, kvSet } from '../../core/idb';
import { getSettings } from '../../core/hooks';
import { dateKey, slug } from '../../core/utils';
import { reportPdfBlob, reportDocxBlob } from '../reporting/reportOut';
import { imageUrls } from '../reporting/reportDoc';
import { labPdfBlob, labDocxBlob } from '../lab/labPrint';

const DRAFT_DELAY = 60000;
const SIGNED_DELAY = 4000;
const RETRY_DELAY = 5 * 60000;
const timers = new Map();
let started = false;
const stats = { files: 0, lastAt: null, lastError: null, pending: 0 };
export const mirrorStats = () => Object.assign({}, stats, { pending: timers.size });

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

export function cloudTargets() {
  const c = getNet().cloud;
  const p = (c && c.providers) || {};
  return Object.keys(p).filter((k) => p[k].connected && p[k].enabled !== false);
}

function folderOf(coll, doc) {
  if (coll === 'reports') {
    const d = doc.demographics || {};
    return (d.date || dateKey(doc.createdAt || Date.now())) + '/' + slug((d.patientId || 'NoID') + '_' + (d.name || 'Patient'));
  }
  const p = doc.patient || {};
  return dateKey(doc.createdAt || Date.now()) + '/' + slug((p.regId || 'NoID') + '_' + [p.title, p.name].filter(Boolean).join(' '));
}

const stampOf = (coll, doc) => fnv(JSON.stringify(coll === 'reports'
  ? [doc.html, doc.demographics, doc.status, doc.version, doc.layout, (doc.images || []).map((i) => i.id + (i.caption || '')), doc.imageSort]
  : [doc.values, doc.freeResults, doc.remarks, doc.comment, doc.status, doc.version, doc.tests]));

async function upload(blob, relPath, mime) {
  const fd = new FormData();
  fd.append('file', new File([blob], relPath.split('/').pop(), { type: mime || blob.type || 'application/octet-stream' }));
  fd.append('relPath', relPath);
  await api('cloud/upload', { method: 'POST', form: fd, timeout: 120000 });
  stats.files += 1;
  stats.lastAt = Date.now();
}

async function mirror(coll, id) {
  const settings = getSettings();
  const doc = store.get(coll, id);
  if (!doc || !settings.cloud.autoSync || !settings.cloud.syncReports || !cloudTargets().length) return;
  if (coll === 'reports' && !String(doc.html || '').trim()) return;
  if (coll === 'labReports' && ['PENDING', 'SAMPLE_COLLECTED'].includes(doc.status)) return;
  const key = 'cloud-mirror:' + coll + ':' + id;
  const last = (await kvGet(key, null)) || { stamp: '', images: [] };
  const stamp = stampOf(coll, doc);
  const folder = folderOf(coll, doc);
  if (last.stamp !== stamp) {
    const base = coll === 'reports' ? 'USG_Report_' + slug((doc.demographics && doc.demographics.modality) || 'Ultrasound').slice(0, 50) : 'Lab_Report_' + slug(doc.sampleId || doc.id);
    const pdf = coll === 'reports' ? await reportPdfBlob(doc, settings) : await labPdfBlob(doc, settings, false);
    await upload(pdf, folder + '/' + base + '.pdf', 'application/pdf');
    const docx = coll === 'reports' ? await reportDocxBlob(doc, settings) : await labDocxBlob(doc, settings);
    await upload(docx, folder + '/' + base + '.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }
  const sent = new Set(last.images || []);
  if (coll === 'reports' && settings.cloud.syncImages && (doc.images || []).some((im) => !sent.has(im.id))) {
    const urls = await imageUrls(doc.images.filter((im) => !sent.has(im.id)));
    for (const im of doc.images) {
      if (sent.has(im.id) || !urls[im.id]) continue;
      const blob = await (await fetch(urls[im.id])).blob();
      await upload(blob, folder + '/Images/' + slug(im.caption || 'Scan') + '_' + im.id.slice(-6) + '.jpg', blob.type || 'image/jpeg');
      sent.add(im.id);
    }
  }
  // original DICOM files (one per source file, however many frames were attached from it)
  if (coll === 'reports' && settings.cloud.syncImages && settings.cloud.syncDicom !== false) {
    const originals = new Map();
    (doc.images || []).forEach((im) => { if (im.dicomFileId && !sent.has('dcm:' + im.dicomFileId)) originals.set(im.dicomFileId, im); });
    for (const [fileId, im] of originals) {
      const r = await fetch('api/files/' + encodeURIComponent(fileId) + '/raw', { credentials: 'same-origin' });
      if (!r.ok) continue;
      const blob = await r.blob();
      const base = slug(String(im.dicomName || im.caption || 'Scan').replace(/\.(dcm|dicom|dic)$/i, '')) || 'Scan';
      await upload(blob, folder + '/Images/DICOM/' + base + '_' + fileId.slice(-6) + '.dcm', 'application/dicom');
      sent.add('dcm:' + fileId);
    }
  }
  await kvSet(key, { stamp, images: Array.from(sent), at: Date.now(), folder });
  events.emit('cloud:mirrored', { coll, id, folder });
}

function schedule(coll, id, delay) {
  clearTimeout(timers.get(coll + ':' + id));
  timers.set(coll + ':' + id, setTimeout(() => {
    timers.delete(coll + ':' + id);
    const run = () => mirror(coll, id).catch((e) => {
      stats.lastError = e.message;
      if (e.offline || e.status >= 500) schedule(coll, id, RETRY_DELAY);
      else console.warn('[cloud mirror]', coll, id, e.message);
    });
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 15000 }); else run();
  }, delay));
}

/** Hook local writes (chained after the sync hook) — call once after login in server mode. */
export function startCloudMirror() {
  if (started || !isServer()) return;
  started = true;
  const prev = store.onLocalWrite;
  store.onLocalWrite = (coll, doc) => {
    if (prev) prev(coll, doc);
    if (coll !== 'reports' && coll !== 'labReports') return;
    if (!cloudTargets().length) return;
    schedule(coll, doc.id, doc.status === 'SIGNED_FINAL' ? SIGNED_DELAY : DRAFT_DELAY);
  };
}

/** Mirror one document right away (Cloud page → "Mirror now"). */
export const mirrorNow = (coll, id) => mirror(coll, id);
