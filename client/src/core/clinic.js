// Clinic workflow helpers shared by Registration, Billing, Queue, Reporting, Lab and Form F.
import { store } from './store';
import { nextCounter, peekCounter, emitEvent } from './sync';
import { logAudit, currentUser } from './auth';
import { dateKey, uid, pad, fullName, lsGet, deepMerge } from './utils';
import { getSettings } from './hooks';
import { createFormFDraftForVisit } from './formf';

export const TOKEN_OF = { Ultrasound: 'USG', Pathology: 'LAB', Biochemistry: 'LAB', 'X-Ray': 'XRAY', ECG: 'ECG', Echo: 'ECHO' };
export const MODALITY_LABEL = { USG: 'USG', LAB: 'Lab', XRAY: 'X-Ray', ECG: 'ECG', ECHO: 'Echo' };
export const QUEUE_STATUS = ['Waiting', 'In Scan/Sample', 'Completed'];

export const tokenModality = (dept) => TOKEN_OF[dept] || 'USG';
export const modalitiesOf = (tests) => Array.from(new Set((tests || []).map((t) => tokenModality(t.department))));

export function patientSnapshot(p) {
  return {
    title: p.title || '', name: p.name || '', relation: p.relation || '', guardianName: p.guardianName || '', age: p.age === undefined ? '' : p.age,
    ageUnit: p.ageUnit || 'Years', gender: p.gender || '', mobile: p.mobile || '', email: p.email || '', address: p.address || '',
    aadhaar: p.aadhaar || '', regId: p.regId || ''
  };
}

export const newShareId = () => (Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6));

export async function allocatePatientRegId() {
  const n = await nextCounter('patient');
  return 'SSDC-P-' + pad(n, 6);
}

export async function previewInvoiceNo(ts = Date.now()) {
  const s = getSettings();
  const y = new Date(ts).getFullYear();
  const n = (await peekCounter('inv-' + y)) + 1;
  return (s.billing.invoicePrefix || 'SSDC') + '-' + y + '-' + pad(n, s.billing.invoicePad || 4);
}

export async function allocateInvoiceNo(ts = Date.now()) {
  const s = getSettings();
  const y = new Date(ts).getFullYear();
  const n = await nextCounter('inv-' + y);
  return (s.billing.invoicePrefix || 'SSDC') + '-' + y + '-' + pad(n, s.billing.invoicePad || 4);
}

export async function allocateTokens(tests, dk = dateKey()) {
  const tokens = {};
  for (const m of modalitiesOf(tests)) tokens[m] = m + '-' + pad(await nextCounter('token-' + dk + '-' + m), 2);
  tokens.combined = 'T-' + pad(await nextCounter('token-' + dk + '-ALL'), 2);
  return tokens;
}

/** Create / update the patient master record. Returns the saved patient. */
export async function savePatient(form, { allowEdit = true } = {}) {
  const now = Date.now();
  let p = form.patientId ? store.get('patients', form.patientId) : null;
  const fields = {
    title: form.title, name: String(form.name || '').trim(), nameHindi: form.nameHindi || '', age: form.age === '' ? '' : Number(form.age), ageUnit: form.ageUnit,
    gender: form.gender, mobile: String(form.mobile || '').trim(), email: form.email || '', relation: form.relation, guardianName: String(form.guardianName || '').trim(),
    address: form.address || '', idType: form.idType || 'Aadhaar Card', aadhaar: form.idEnabled ? String(form.aadhaar || '').replace(/\D/g, '') : (p ? p.aadhaar : ''),
    // the Aadhaar secure QR carries only the last 4 digits; keep them for matching the next visit
    aadhaarLast4: form.idEnabled ? (String(form.aadhaar || '').replace(/\D/g, '').length === 12 ? String(form.aadhaar).replace(/\D/g, '').slice(-4) : form.aadhaarLast4 || '') : (p ? p.aadhaarLast4 || '' : ''),
    dob: form.dob || (p ? p.dob || '' : ''),
    idVerified: !!form.idVerified, referredBy: form.referredBy || ''
  };
  if (p) {
    if (allowEdit) p = store.put('patients', Object.assign({}, p, fields));
  } else {
    const regId = await allocatePatientRegId();
    p = store.put('patients', Object.assign({ id: uid('pat_'), regId, createdAt: now, visitCount: 0 }, fields));
    logAudit('patient:registered', 'patients/' + p.id, { regId, name: p.name });
  }
  return p;
}

/** Save & Register: patient + visit with tokens + pending lab worklist entry. */
export async function registerVisit(form, opts = {}) {
  const patient = await savePatient(form, { allowEdit: opts.allowEdit !== false });
  const dk = dateKey();
  const tests = (form.tests || []).map((t) => ({ testId: t.testId, code: t.code, name: t.name, department: t.department, rate: Number(t.rate) || 0 }));
  const tokens = await allocateTokens(tests, dk);
  const status = {};
  Object.keys(tokens).filter((k) => k !== 'combined').forEach((m) => { status[m] = 'Waiting'; });
  const doc = store.get('doctors', form.referredBy);
  const visit = store.put('visits', {
    id: uid('vis_'), patientId: patient.id, patientName: fullName(patient), dateKey: dk, createdAt: Date.now(), tokens, tests,
    referredBy: form.referredBy || 'SELF', referredByName: form.referredBy === 'SELF' || !form.referredBy ? 'Self' : doc ? doc.name : '',
    obstetric: form.obstetric && form.obstetric.enabled ? Object.assign({}, form.obstetric) : null,
    discountType: form.discountType || 'flat', discountValue: Number(form.discountValue) || 0, discountReason: form.discountReason || '',
    clinicalHistory: form.clinicalHistory || '', priority: form.priority || 'Normal', status, billed: false,
    createdBy: (currentUser() || {}).id
  });
  const labTests = tests.filter((t) => t.department === 'Pathology' || t.department === 'Biochemistry');
  if (labTests.length) {
    const tm = {};
    store.list('tests').forEach((t) => { tm[t.id] = t; });
    const lab = store.put('labReports', {
      id: uid('lab_'), visitId: visit.id, patientId: patient.id, patient: Object.assign(patientSnapshot(patient), {}), refBy: visit.referredByName,
      tests: labTests.map((t) => ({ testId: t.testId, name: t.name, panel: tm[t.testId] ? tm[t.testId].labPanel : null })), values: {}, remarks: {}, comment: '',
      status: 'PENDING', sampleId: 'S' + dk.slice(2).replace(/-/g, '') + '-' + (tokens.LAB || tokens.combined).replace(/\D/g, ''), createdAt: Date.now()
    });
    store.patch('visits', visit.id, { labReportId: lab.id });
  }
  store.put('patients', Object.assign({}, store.get('patients', patient.id), { lastVisitAt: Date.now(), visitCount: (patient.visitCount || 0) + 1 }));
  if (visit.obstetric) {
    // PC-PNDT: bind a draft Form F to the visit straight away (auto-fill engine; S.No is allotted on first save)
    try { createFormFDraftForVisit(store.get('visits', visit.id), store.get('patients', patient.id), deepMerge(getSettings().formF, lsGet('ssdc-pref:formf-prefs', {}))); } catch (e) { /* non-blocking */ }
  }
  logAudit('visit:registered', 'visits/' + visit.id, { tokens, tests: tests.map((t) => t.code) });
  emitEvent('queue:updated', { visitId: visit.id });
  return { patient: store.get('patients', patient.id), visit: store.get('visits', visit.id) };
}

export function setQueueStatus(visitId, modality, status) {
  const v = store.get('visits', visitId);
  if (!v) return;
  const st = Object.assign({}, v.status || {});
  st[modality] = status;
  store.put('visits', Object.assign({}, v, { status: st, statusLog: (v.statusLog || []).concat([{ at: Date.now(), modality, status, by: (currentUser() || {}).id }]).slice(-30) }));
}

// ---------------------------------------------------------------- waiting times & token calls
/** Department names for the waiting hall (English + Hindi), with the room from Settings when set. */
export const DEPT_NAME = { USG: 'Ultrasound / Sonography', LAB: 'Pathology · Sample Collection', XRAY: 'Digital X-Ray', ECG: 'ECG', ECHO: 'Echocardiography', combined: 'Reception' };
export const DEPT_NAME_HI = { USG: 'सोनोग्राफी', LAB: 'पैथोलॉजी · सैंपल', XRAY: 'डिजिटल एक्स-रे', ECG: 'ई.सी.जी.', ECHO: 'इको', combined: 'रिसेप्शन' };
export const deptRoom = (m, settings = getSettings()) => ((settings.queue || {}).rooms || {})[m] || '';
/** Waiting times on staff screens (Dashboard, Live Queue) — off unless switched on in Settings. */
export const showWaitTimes = (settings = getSettings()) => (settings.queue || {}).showWaitTimes === true;
/** The TV's place in line and estimated wait per patient — on unless switched off in Settings. */
export const tvShowEstimates = (settings = getSettings()) => (settings.queue || {}).tvShowEstimates !== false;
/** Departments shown on the waiting-hall TV — Ultrasound / Sonography unless the clinic chose others in Settings. */
export const TV_DEPARTMENTS_DEFAULT = ['USG'];
export function tvDepartments(settings = getSettings()) {
  const a = (settings.queue || {}).tvDepartments;
  const ok = Array.isArray(a) ? a.filter((m) => DEPT_NAME[m] && m !== 'combined') : [];
  return ok.length ? ok : TV_DEPARTMENTS_DEFAULT;
}

/** How long a modality has waited: live while Waiting, frozen once the scan / sample started. */
export function waitInfo(v, m, now = Date.now()) {
  const st = (v.status || {})[m] || 'Waiting';
  const log = (v.statusLog || []).filter((e) => e.modality === m);
  const began = log.find((e) => e.status === 'In Scan/Sample') || log.find((e) => e.status === 'Completed');
  const end = st === 'Waiting' ? now : began ? began.at : now;
  return { status: st, minutes: Math.max(0, Math.round((end - (v.createdAt || now)) / 60000)), live: st === 'Waiting' };
}
export const waitTone = (min) => (min >= 45 ? 'rose' : min >= 20 ? 'amber' : 'emerald');

// ---------------------------------------------------------------- estimated waits for the waiting hall
/** Typical minutes per patient per room, used until enough procedures are measured (Settings → LAN). */
export const DEFAULT_PROC_MIN = { USG: 15, LAB: 6, XRAY: 10, ECG: 10, ECHO: 20 };

/**
 * Average procedure time per room (minutes): "In Scan/Sample" → "Completed" over the last 14 days,
 * trimmed of the fastest and slowest 10 % (forgotten clicks). Needs 3 measured procedures; otherwise the
 * minutes set in Settings, otherwise DEFAULT_PROC_MIN. → { USG: { minutes, from: 'measured'|'set'|'default', n } }
 */
export function procedureMinutes(visits, settings = getSettings(), now = Date.now()) {
  const conf = ((settings && settings.queue) || {}).avgMinutes || {};
  const since = now - 14 * 86400000;
  const acc = {};
  visits.forEach((v) => {
    if ((v.createdAt || 0) < since) return;
    const log = v.statusLog || [];
    Object.keys(v.tokens || {}).forEach((m) => {
      if (m === 'combined') return;
      const start = log.find((e) => e.modality === m && e.status === 'In Scan/Sample');
      const end = log.find((e) => e.modality === m && e.status === 'Completed');
      if (!start || !end || end.at <= start.at) return;
      const mins = (end.at - start.at) / 60000;
      if (mins >= 1 && mins <= 120) (acc[m] = acc[m] || []).push(mins);
    });
  });
  const out = {};
  Object.keys(DEFAULT_PROC_MIN).forEach((m) => {
    const arr = (acc[m] || []).sort((a, b) => a - b);
    if (arr.length >= 3) {
      const cut = Math.floor(arr.length * 0.1);
      const kept = arr.slice(cut, arr.length - cut);
      out[m] = { minutes: Math.max(1, Math.round(kept.reduce((s, x) => s + x, 0) / kept.length)), from: 'measured', n: arr.length };
    } else out[m] = { minutes: Number(conf[m]) || DEFAULT_PROC_MIN[m], from: conf[m] ? 'set' : 'default', n: arr.length };
  });
  return out;
}

/**
 * One room's line-up: who is inside now and every waiting patient in order with how many are ahead
 * and the estimated wait (time left for the patient inside + one average procedure per patient ahead).
 */
export function roomBoard(queue, m, avg, now = Date.now()) {
  const waiting = [];
  const inside = [];
  queue.forEach((v) => {
    if (!v.tokens || !v.tokens[m]) return;
    const w = waitInfo(v, m, now);
    if (w.status === 'Waiting') waiting.push({ visitId: v.id, token: v.tokens[m], name: v.patientName, at: v.createdAt, waited: w.minutes, called: (v.calls || []).some((c) => c.token === v.tokens[m]) });
    else if (w.status === 'In Scan/Sample') {
      const st = (v.statusLog || []).filter((e) => e.modality === m && e.status === 'In Scan/Sample').pop();
      inside.push({ visitId: v.id, token: v.tokens[m], name: v.patientName, since: st ? st.at : now });
    }
  });
  waiting.sort((a, b) => a.at - b.at);
  const started = inside.length ? Math.min.apply(null, inside.map((x) => x.since)) : 0;
  const left = inside.length ? Math.max(1, Math.round(avg - (now - started) / 60000)) : 0;
  waiting.forEach((x, i) => { x.ahead = i; x.estMin = left + i * avg; });
  return { waiting, inside, avg, left };
}

/** "Now" · "≈ 6 min" · "≈ 25 min" · "≈ 1 h 10 min" (5-minute steps above 10 minutes). */
export function fmtEstimate(min) {
  if (min <= 1) return 'Now';
  const m = min < 10 ? Math.round(min) : Math.round(min / 5) * 5;
  return '≈ ' + (m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : ''));
}
export const fmtWait = (min) => (min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + pad(min % 60) + ' min');

/** Average and longest live wait per modality for today's queue. */
export function waitStats(visits, now = Date.now()) {
  const out = {};
  visits.forEach((v) => Object.keys(v.tokens || {}).forEach((m) => {
    if (m === 'combined') return;
    const w = waitInfo(v, m, now);
    const r = out[m] || (out[m] = { waiting: 0, sum: 0, longest: 0, served: 0, servedSum: 0 });
    if (w.live) { r.waiting += 1; r.sum += w.minutes; r.longest = Math.max(r.longest, w.minutes); } else { r.served += 1; r.servedSum += w.minutes; }
  }));
  Object.values(out).forEach((r) => { r.avg = r.waiting ? Math.round(r.sum / r.waiting) : 0; r.avgServed = r.served ? Math.round(r.servedSum / r.served) : 0; });
  return out;
}

/** Call a token: recorded on the visit (synced to every screen and the TV display) and announced at once. */
export function callToken(visitId, modality) {
  const v = store.get('visits', visitId);
  if (!v || !v.tokens) return null;
  const token = modality === 'combined' ? v.tokens.combined : v.tokens[modality];
  if (!token) return null;
  const call = { at: Date.now(), modality, token, by: (currentUser() || {}).id };
  store.put('visits', Object.assign({}, v, { calls: (v.calls || []).concat([call]).slice(-12) }));
  emitEvent('queue:call', { token, modality, name: v.patientName, at: call.at, visitId });
  return call;
}

/** Calls across today's visits, newest first. */
export function recentCalls(visits, limit = 8) {
  const out = [];
  visits.forEach((v) => (v.calls || []).forEach((c) => out.push(Object.assign({ name: v.patientName, visitId: v.id }, c))));
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}

export function visitOverall(v) {
  const vals = Object.values(v.status || {});
  if (!vals.length) return v.billed ? 'Billed' : 'Waiting';
  if (vals.every((s) => s === 'Completed')) return v.billed ? 'Completed' : 'Completed';
  if (vals.some((s) => s === 'In Scan/Sample')) return 'In Scan/Sample';
  return 'Waiting';
}

export function testsForVisit(v) { return (v && v.tests) || []; }

export function isObstetricTest(t) {
  if (!t) return false;
  if (t.isObstetric) return true;
  const full = store.get('tests', t.testId);
  return !!(full && full.isObstetric);
}

export function prepGuidelines(items) {
  const out = [];
  (items || []).forEach((it) => {
    const t = store.get('tests', it.testId);
    if (t && t.description && !out.some((g) => g.text === t.description)) out.push({ test: it.name, text: t.description });
  });
  return out;
}
