/*
 * Deleting a patient record: which records belong to the patient, what stops the deletion and what to
 * warn about. Shared by the clinic server (/api/patients/... routes) and the standalone build, so both
 * remove exactly the same records.
 *
 *  • Move to the recycle bin — the patient and every linked record (visits, bills, reports, lab reports,
 *    Form F drafts, files, dispatch log) are marked deleted with one deletion batch id. They disappear
 *    from every screen and workstation; an administrator can restore the whole batch.
 *  • Delete permanently — from the recycle bin. Each record is replaced by a tombstone that carries no
 *    patient data ({ id, _deleted, purged, deleteBatch }) so workstations that were offline drop their
 *    copies too; stored files are removed from the disk.
 *  • Legal hold — a finalised PC-PNDT Form F has to be preserved (PC-PNDT Rules 1996, rule 9), so a
 *    patient with one cannot be deleted until that Form F is unlocked with an audit reason.
 */
'use strict';

const LINKED_COLLS = ['visits', 'invoices', 'reports', 'labReports', 'formf', 'files', 'dispatchLog'];
const DELETE_COLLS = ['patients'].concat(LINKED_COLLS);
const DELETE_FIELDS = ['deleteBatch', 'deletedAt', 'deletedBy', 'deletedByName', 'deleteReason', 'deletion'];
const DELETE_REASONS = ['Duplicate registration', 'Test / dummy entry', 'Registered by mistake', 'Patient asked for the data to be erased'];
const COLL_LABEL = {
  patients: ['patient record', 'patient records'], visits: ['visit', 'visits'], invoices: ['bill', 'bills'],
  reports: ['USG / X-ray report', 'USG / X-ray reports'], labReports: ['lab report', 'lab reports'], formf: ['Form F draft', 'Form F drafts'],
  files: ['file / image', 'files & images'], dispatchLog: ['dispatch log entry', 'dispatch log entries']
};
const MIN_REASON = 5;

const live = (d) => !!d && !d._deleted;
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const countLabel = (coll, n) => n + ' ' + (COLL_LABEL[coll] || [coll, coll])[n === 1 ? 0 : 1];

/** "P-2026-0012" / "ssdc p 12" → comparable form for the type-to-confirm box. */
const normId = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** What the administrator has to type to confirm: the Reg. ID, or the name for a record without one. */
const confirmWord = (p) => (p && p.regId ? String(p.regId) : String((p && p.name) || '').trim());
const confirmMatches = (p, typed) => !!normId(confirmWord(p)) && normId(typed) === normId(confirmWord(p));

/**
 * Which live records belong to the patient. docs: { coll: [doc] } (deleted documents are ignored);
 * opts.todayKey ('YYYY-MM-DD', clinic time) names today's visits that are still in the live queue.
 * → { items: { coll: [id] }, counts, total, holds: [{ code, text }], warnings: [{ code, text }], money, signed }
 */
function planPatientDeletion(patient, docs, opts) {
  const pid = patient && patient.id;
  const pick = (coll, fn) => ((docs && docs[coll]) || []).filter((d) => live(d) && fn(d));
  const visits = pick('visits', (v) => v.patientId === pid);
  const visitIds = new Set(visits.map((v) => v.id));
  const mine = (d) => d.patientId === pid || (!!d.visitId && visitIds.has(d.visitId));
  const invoices = pick('invoices', (i) => mine(i) || (i.patient && i.patient.id === pid) || visits.some((v) => v.invoiceId === i.id));
  const reports = pick('reports', (r) => mine(r) || visits.some((v) => v.reportId === r.id));
  const labReports = pick('labReports', (l) => mine(l) || visits.some((v) => v.labReportId === l.id));
  const formf = pick('formf', (f) => mine(f) || visits.some((v) => v.formFId === f.id));
  const refIds = new Set([].concat(invoices, reports, labReports, formf).map((d) => d.id));
  const files = pick('files', (f) => mine(f) || (!!f.reportId && refIds.has(f.reportId)) || (!!f.attachedTo && refIds.has(f.attachedTo.reportId)));
  files.forEach((f) => refIds.add(f.id));
  const dispatchLog = pick('dispatchLog', (x) => x.patientId === pid || (!!x.ref && refIds.has(x.ref)));

  const items = { patients: pid ? [pid] : [], visits: [], invoices: [], reports: [], labReports: [], formf: [], files: [], dispatchLog: [] };
  const lists = { visits, invoices, reports, labReports, formf, files, dispatchLog };
  Object.keys(lists).forEach((c) => { items[c] = lists[c].map((d) => d.id); });
  const counts = {};
  Object.keys(items).forEach((c) => { if (items[c].length) counts[c] = items[c].length; });
  const total = Object.values(items).reduce((n, ids) => n + ids.length, 0);

  const holds = [];
  formf.filter((f) => f.status === 'FINAL').forEach((f) => {
    const label = f.snoLabel || (f.sno ? 'S.No. ' + f.sno : '');
    holds.push({
      code: 'formf_final', id: f.id,
      text: 'PC-PNDT Form F' + (label ? ' ' + label : '') + ' is finalised. Form F records must be preserved for at least two years (PC-PNDT Rules 1996, rule 9). If it was made by mistake, unlock it in the Form F register with an audit reason first.'
    });
  });

  const collected = money(invoices.reduce((n, i) => n + (Number(i.paid) || 0), 0));
  const billed = money(invoices.reduce((n, i) => n + (Number(i.net) || 0), 0));
  const signed = {
    reports: reports.filter((r) => r.status === 'SIGNED_FINAL').length,
    labReports: labReports.filter((l) => l.status === 'SIGNED_FINAL').length
  };
  const warnings = [];
  if (signed.reports + signed.labReports) {
    warnings.push({ code: 'signed', text: [signed.reports && countLabel('reports', signed.reports), signed.labReports && countLabel('labReports', signed.labReports)].filter(Boolean).join(' and ') + ' signed and locked by the doctor will be removed with the patient.' });
  }
  if (collected > 0) {
    const days = Array.from(new Set(invoices.filter((i) => Number(i.paid) > 0).map((i) => i.dateKey).filter(Boolean))).sort();
    warnings.push({ code: 'money', text: '₹' + collected.toLocaleString('en-IN') + ' collected on ' + countLabel('invoices', invoices.filter((i) => Number(i.paid) > 0).length) + ' will leave the Daily Cash Book and Accounts' + (days.length ? ' for ' + days.join(', ') : '') + '. Refund or reconcile the cash first if needed.' });
  }
  if (formf.length) warnings.push({ code: 'formf_draft', text: countLabel('formf', formf.length) + ' will be removed; Form F serial numbers are never reused.' });
  if (dispatchLog.length) warnings.push({ code: 'dispatched', text: 'Reports, bills or messages were already sent to the patient ' + dispatchLog.length + ' time(s); copies already delivered cannot be recalled.' });
  const todayKey = opts && opts.todayKey;
  const queued = todayKey ? visits.filter((v) => v.dateKey === todayKey && !v.closedAt && Object.values(v.status || {}).some((st) => st !== 'Completed')) : [];
  if (queued.length) warnings.push({ code: 'queue', text: 'The patient is in today\u2019s live queue; the token' + (queued.length === 1 ? '' : 's') + ' will disappear from every queue screen.' });

  return { items, counts, total, holds, warnings, money: { billed, collected, bills: invoices.length }, signed };
}

/** Human summary of counts: "3 visits · 2 bills · 1 USG / X-ray report". */
function describeCounts(counts, opts) {
  const skipPatient = !opts || opts.skipPatient !== false;
  return DELETE_COLLS.filter((c) => counts && counts[c] && !(skipPatient && c === 'patients')).map((c) => countLabel(c, counts[c])).join(' · ');
}

// every change is stamped newer than the record's last edit, so it wins on every workstation (last write wins)
const stamp = (doc, at) => Math.max(Number(at) || Date.now(), (Number(doc && doc.updatedAt) || 0) + 1);

/** A record moved to the recycle bin (full data kept for restore). meta: { batch, at, by, byName, reason } */
function markDeleted(doc, meta) {
  return Object.assign({}, doc, {
    _deleted: true, deleteBatch: meta.batch, deletedAt: meta.at, deletedBy: meta.by || null, deletedByName: meta.byName || '',
    deleteReason: meta.reason || '', updatedAt: stamp(doc, meta.at)
  });
}

/** The same record restored from the recycle bin. */
function restoredDoc(doc, at) {
  const out = Object.assign({}, doc);
  DELETE_FIELDS.forEach((k) => { delete out[k]; });
  delete out._deleted;
  delete out._rejected;
  out.updatedAt = stamp(doc, at);
  return out;
}

/** What is left of a permanently deleted record: no patient data, enough for every copy to be dropped. */
function tombstone(doc, meta) {
  return { id: doc.id, _deleted: true, purged: true, deleteBatch: doc.deleteBatch || meta.batch, purgedAt: meta.at, updatedAt: stamp(doc, meta.at) };
}

/** Is this document in the recycle bin (deleted by an administrator, not yet purged)? */
const inRecycleBin = (d) => !!d && !!d._deleted && !!d.deleteBatch && !d.purged;

/** Recycle-bin entry for a deleted patient document (the batch metadata lives on the patient record). */
function binEntry(p) {
  const del = p.deletion || {};
  return {
    id: p.id, batch: p.deleteBatch, regId: p.regId || '', title: p.title || '', name: p.name || '', age: p.age, ageUnit: p.ageUnit || '', gender: p.gender || '',
    mobile: p.mobile || '', deletedAt: p.deletedAt, deletedBy: p.deletedBy || null, deletedByName: p.deletedByName || '', reason: p.deleteReason || '',
    counts: del.counts || { patients: 1 }, money: del.money || null, signed: del.signed || null, total: del.total || 1
  };
}

module.exports = {
  LINKED_COLLS, DELETE_COLLS, DELETE_FIELDS, DELETE_REASONS, COLL_LABEL, MIN_REASON,
  planPatientDeletion, describeCounts, countLabel, markDeleted, restoredDoc, tombstone, inRecycleBin, binEntry,
  normId, confirmWord, confirmMatches
};
