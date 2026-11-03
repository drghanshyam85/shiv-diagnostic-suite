// Report model: demographics from registration, template choice per visit, sign / lock / compliance
// rules (Strict Form-F lock for obstetric scans), version snapshots and report images (IndexedDB blobs,
// mirrored to the LAN server so every workstation can print them).
import { store } from '../../core/store';
import { currentUser } from '../../core/auth';
import { idbPut, idbGet, idbIndexGet } from '../../core/idb';
import { api, isServer } from '../../core/sync';
import { uid, dateKey, fullName, ageShort, stripHtml, readAsDataURL } from '../../core/utils';
import { formFForVisit, impressionFromReport } from '../../core/formf';
import { TEMPLATE_BY_KEY } from '../../data/templates';

export const REPORT_DEPTS = ['Ultrasound', 'X-Ray', 'ECG', 'Echo'];
export const REPORT_TOKENS = ['USG', 'XRAY', 'ECG', 'ECHO'];
export const STATUS_META = {
  NONE: { label: 'Not started', tone: 'slate' },
  DRAFT: { label: 'Draft', tone: 'amber' },
  AMENDING: { label: 'Amending', tone: 'violet' },
  SIGNED_FINAL: { label: 'Signed', tone: 'emerald' }
};

export const reportTestsOf = (visit) => ((visit && visit.tests) || []).filter((t) => REPORT_DEPTS.includes(t.department));
export const isLocked = (r) => !!r && r.status === 'SIGNED_FINAL';
export const reportForVisit = (visitId) => (visitId ? store.list('reports').find((r) => r.visitId === visitId) || null : null);

export function templateKeysFor(visit) {
  const keys = [];
  reportTestsOf(visit).forEach((t) => { const full = store.get('tests', t.testId); const k = full && full.templateKey; if (k && !keys.includes(k)) keys.push(k); });
  return keys;
}

export function demographicsFor(visit, patient) {
  const p = patient || {};
  const tests = reportTestsOf(visit);
  return {
    name: fullName(p), age: ageShort(p.age, p.ageUnit || 'Years'), sex: p.gender || '', patientId: p.regId || '',
    date: (visit && visit.dateKey) || dateKey(), refBy: (visit && visit.referredByName) || 'Self',
    modality: tests.map((t) => t.name).join(' + '),
    indication: (visit && (visit.clinicalHistory || (visit.obstetric && visit.obstetric.indication))) || ''
  };
}

export const emptyDemographics = () => ({ name: '', age: '', sex: '', patientId: '', date: dateKey(), refBy: 'Self', modality: '', indication: '' });

/** A fresh (unsaved) report for a visit, pre-loaded with the first matching template. */
export function newReportFor(visit, patient) {
  const keys = templateKeysFor(visit);
  const tests = reportTestsOf(visit);
  const obstetric = !!(visit && visit.obstetric) || tests.some((t) => { const x = store.get('tests', t.testId); return x && x.isObstetric; });
  const tpl = keys[0] ? TEMPLATE_BY_KEY[keys[0]] : null;
  return {
    id: uid('rep_'), visitId: visit ? visit.id : '', patientId: patient ? patient.id : '', invoiceId: (visit && visit.invoiceId) || '',
    templateKey: keys[0] || '', obstetric, formFId: (visit && visit.formFId) || '',
    demographics: visit || patient ? demographicsFor(visit, patient) : emptyDemographics(),
    html: tpl ? tpl.content : '', images: [], status: 'DRAFT', version: 1
  };
}

export function reportStatus(visit) {
  const r = reportForVisit(visit.id);
  return r ? r.status : 'NONE';
}

export const placeholderCount = (html) => (String(html || '').match(/\[(?:__+|X|x)\]/g) || []).length;
export const wordCount = (text) => (String(text || '').match(/[A-Za-z0-9ऀ-ॿ]+(?:['’.-][A-Za-z0-9]+)*/g) || []).length;
export const impressionOf = (report) => impressionFromReport(report && report.html);

/** PC-PNDT antenatal reminders: mandatory obstetric details recorded at registration or in Form F. */
export function antenatalChecklist(report, settings) {
  if (!report || !report.obstetric) return [];
  const v = report.visitId ? store.get('visits', report.visitId) : null;
  const o = (v && v.obstetric) || {};
  const ff = report.visitId ? formFForVisit(report.visitId) : null;
  const fd = (ff && ff.data) || {};
  const has = (x) => x !== undefined && x !== null && String(x).trim() !== '';
  return [
    { key: 'lmp', label: 'LMP recorded', ok: has(o.lmp) || has(fd.lmp), hint: 'Registration → Pregnancy panel, or Form F item 9' },
    { key: 'edd', label: 'EDD / gestational age', ok: has(o.edd) || has(o.gaWeeks) || has(fd.edd) || has(fd.gaWeeks), hint: 'Calculated from the LMP or the USG gestational age' },
    { key: 'gp', label: 'Gravida / Para (obstetric history)', ok: has(o.gravida) || has(o.para), hint: 'Registration → Pregnancy panel' },
    { key: 'ref', label: 'Referring doctor details', ok: (v && v.referredBy && v.referredBy !== 'SELF') || has(fd.refDoctorName) || fd.selfReferral === 'YES', hint: 'Doctor name & address, or mark self-referral in Form F' },
    { key: 'formf', label: 'Form F finalised in the PC-PNDT register', ok: !!(ff && ff.status === 'FINAL'), hint: ff ? 'Draft ' + (ff.snoLabel || '') + ' — complete & finalise it' : 'Not started for this visit' },
    { key: 'decl', label: 'PC-PNDT declaration printed on the report', ok: has(settings && settings.report && settings.report.pcpndtDeclaration), hint: 'Settings → Print & reports' }
  ];
}

/** Hard blockers and soft warnings before "Sign & Lock". */
export function signCheck(report, settings) {
  const blockers = [];
  const warnings = [];
  const text = stripHtml(report.html || '').trim();
  if (!text) blockers.push('The report body is empty.');
  if (!String(report.demographics.name || '').trim()) blockers.push('Patient name is missing in the demographics.');
  if (report.obstetric && settings.compliance && settings.compliance.strictFormFLock) {
    const ff = report.visitId ? formFForVisit(report.visitId) : null;
    if (!ff || ff.status !== 'FINAL') blockers.push('PC-PNDT Strict Form-F lock: finalise this patient’s Form F before signing an obstetric report.');
  }
  antenatalChecklist(report, settings).forEach((x) => {
    if (!x.ok && !(x.key === 'formf' && settings.compliance && settings.compliance.strictFormFLock)) warnings.push('Antenatal checklist: ' + x.label.replace(/ recorded$/, '') + ' — missing. ' + x.hint + '.');
  });
  const ph = placeholderCount(report.html);
  if (ph) warnings.push(ph + ' unfilled placeholder' + (ph > 1 ? 's' : '') + ' [__] (press F2 to jump to them).');
  if (!/impression/i.test(text)) warnings.push('No IMPRESSION section found.');
  if (report.obstetric && /\b(male|female)\s+(foetus|fetus|baby|child)\b|\bsex of (the )?(foetus|fetus) is\b/i.test(text)) blockers.push('PC-PNDT: the report text appears to mention foetal sex — remove it before signing.');
  return { blockers, warnings };
}

// ---------------------------------------------------------------- version snapshots (per workstation, IndexedDB)
export async function saveSnapshot(report, label) {
  const u = currentUser() || {};
  const snap = { id: uid('snap_'), reportId: report.id, at: Date.now(), by: u.name || '', label: label || 'Snapshot', html: report.html, demographics: report.demographics, status: report.status, version: report.version || 1 };
  await idbPut('snapshots', snap);
  return snap;
}
export async function listSnapshots(reportId) {
  const list = (await idbIndexGet('snapshots', 'reportId', reportId)) || [];
  return list.sort((a, b) => b.at - a.at);
}

// ---------------------------------------------------------------- report images
/** Downscale to ≤ maxPx and JPEG-encode (keeps reports light enough to sync over the LAN). */
export async function compressImage(file, maxPx = 1600, quality = 0.86) {
  const src = await readAsDataURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const k = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * k);
  const h = Math.round(img.naturalHeight * k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  return { dataUrl: c.toDataURL('image/jpeg', quality), w, h };
}

const urlCache = new Map();
/**
 * Store an image for a report: local blob first, then (LAN mode) upload so other workstations see it.
 * extra: { source, organ, acquiredAt, dicom, dicomFileId, frame, frames, warn, caption } kept on the image.
 */
export async function addReportImage(reportId, file, extra) {
  const { dataUrl, w, h } = await compressImage(file);
  const id = uid('img_');
  await idbPut('blobs', { id, dataUrl, mime: 'image/jpeg', reportId, at: Date.now() });
  urlCache.set(id, dataUrl);
  const img = Object.assign({ id, caption: String(file.name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').slice(0, 60), w, h, at: Date.now() }, extra || {});
  if (isServer()) {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const fd = new FormData();
      fd.append('files', new File([blob], id + '.jpg', { type: 'image/jpeg' }));
      fd.append('meta', JSON.stringify({ kind: 'report-image', reportId }));
      const r = await api('files', { method: 'POST', form: fd });
      if (r.files && r.files[0]) img.fileId = r.files[0].id;
    } catch (e) { /* stays local; retried on next save is unnecessary — local copy prints fine */ }
  }
  return img;
}

/** Keep the original DICOM file on the clinic server (cloud sync uploads it beside the JPEG). → file id | null */
export async function uploadReportOriginal(reportId, file, meta) {
  if (!isServer() || !file || file.size > 60 * 1024 * 1024) return null;
  const fd = new FormData();
  fd.append('files', file, file.name || 'image.dcm');
  fd.append('meta', JSON.stringify(Object.assign({ kind: 'report-dicom', reportId, category: 'DICOM', source: 'report' }, meta || {})));
  try {
    const r = await api('files', { method: 'POST', form: fd, timeout: 180000 });
    return r.files && r.files[0] ? r.files[0].id : null;
  } catch (e) { return null; }
}

/** Resolve a displayable URL for a report image (local blob → server file). */
export async function imageUrl(img) {
  if (!img) return '';
  if (urlCache.has(img.id)) return urlCache.get(img.id);
  const b = await idbGet('blobs', img.id);
  if (b && b.dataUrl) { urlCache.set(img.id, b.dataUrl); return b.dataUrl; }
  if (img.fileId) return 'api/files/' + encodeURIComponent(img.fileId) + '/raw';
  return '';
}
export async function imageUrls(images) {
  const out = {};
  for (const im of images || []) out[im.id] = await imageUrl(im);
  return out;
}
