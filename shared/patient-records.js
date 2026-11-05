/*
 * Deleting patient records and cancelling entries: which records belong together, what stops the change
 * and what to warn about. Shared by the clinic server (/api/patients/..., /api/entries/...) and the
 * standalone build, so both remove exactly the same records.
 *
 *  • Cancel an entry — the patient does not go ahead with the tests: the visit with its bill, lab worklist
 *    entry, report drafts, Form F draft, files and dispatch log (or a bill made without a visit) is marked
 *    cancelled as one batch. It leaves the queue, the TV, the worklists and the cash book; the patient
 *    record stays. Not possible once a test was done (report signed, results entered, marked Completed).
 *  • Delete a patient record — the patient and every linked record go to the recycle bin as one batch.
 *    The front desk may do this while nothing has been done for the patient (no test performed, no money
 *    kept, nothing sent); a record with history needs the permission patient:delete_records.
 *  • Restore brings a batch back exactly as it was. Delete permanently replaces each record with a
 *    tombstone that carries no patient data ({ id, _deleted, purged, deleteBatch }) so workstations that
 *    were offline drop their copies too; stored files are removed from the disk.
 *  • Legal hold — a finalised PC-PNDT Form F has to be preserved (PC-PNDT Rules 1996, rule 9), so neither
 *    is possible until that Form F is unlocked with an audit reason.
 */
'use strict';

const LINKED_COLLS = ['visits', 'invoices', 'reports', 'labReports', 'formf', 'files', 'dispatchLog'];
const DELETE_COLLS = ['patients'].concat(LINKED_COLLS);
const ENTRY_COLLS = ['visits', 'invoices'];
const DELETE_FIELDS = ['deleteBatch', 'deleteKind', 'deletedAt', 'deletedBy', 'deletedByName', 'deleteReason', 'deletion'];
const DELETE_REASONS = ['Patient did not proceed with the tests', 'Duplicate registration', 'Test / dummy entry', 'Registered by mistake', 'Patient asked for the data to be erased'];
const CANCEL_REASONS = ['Patient did not proceed with the tests', 'Patient left before the test', 'Registered by mistake', 'Duplicate entry'];
const COLL_LABEL = {
  patients: ['patient record', 'patient records'], visits: ['visit', 'visits'], invoices: ['bill', 'bills'],
  reports: ['USG / X-ray report', 'USG / X-ray reports'], labReports: ['lab report', 'lab reports'], formf: ['Form F draft', 'Form F drafts'],
  files: ['file / image', 'files & images'], dispatchLog: ['dispatch log entry', 'dispatch log entries']
};
const MODALITY_NAME = { USG: 'Ultrasound', LAB: 'Lab', XRAY: 'X-ray', ECG: 'ECG', ECHO: 'Echo' };
const MIN_REASON = 5;
const LEGAL_HOLD = 'Form F records must be preserved for at least two years (PC-PNDT Rules 1996, rule 9). If it was made by mistake, unlock it in the Form F register with an audit reason first.';

const live = (d) => !!d && !d._deleted;
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const countLabel = (coll, n) => n + ' ' + (COLL_LABEL[coll] || [coll, coll])[n === 1 ? 0 : 1];
const inr = (n) => '₹' + money(n).toLocaleString('en-IN');
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/** "P-2026-0012" / "ssdc p 12" → comparable form for the type-to-confirm box. */
const normId = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** What the administrator has to type to confirm: the Reg. ID, or the name for a record without one. */
const confirmWord = (p) => (p && p.regId ? String(p.regId) : String((p && p.name) || '').trim());
const confirmMatches = (p, typed) => !!normId(confirmWord(p)) && normId(typed) === normId(confirmWord(p));

function formFHold(f) {
  const label = f.snoLabel || (f.sno ? 'S.No. ' + f.sno : '');
  return { code: 'formf_final', id: f.id, text: 'PC-PNDT Form F' + (label ? ' ' + label : '') + ' is finalised. ' + LEGAL_HOLD };
}
const completedModalities = (v) => Object.entries((v && v.status) || {}).filter(([, st]) => st === 'Completed').map(([m]) => m);

/**
 * Which records belong to the patient. docs: { coll: [doc] } — live documents only, or also deleted ones
 * with opts.includeDeleted (the permanent-deletion sweep); opts.todayKey ('YYYY-MM-DD', clinic time) names
 * today's visits that are still in the live queue.
 * → { items: { coll: [id] }, counts, total, holds, warnings, money, signed, desk: { allowed, reasons } }
 * desk.allowed: nothing has been done for the patient yet, so the front desk may delete the record.
 */
function planPatientDeletion(patient, docs, opts) {
  const pid = patient && patient.id;
  const all = !!(opts && opts.includeDeleted);
  const pick = (coll, fn) => ((docs && docs[coll]) || []).filter((d) => d && !d.purged && (all || live(d)) && fn(d));
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

  const holds = formf.filter((f) => live(f) && f.status === 'FINAL').map(formFHold);

  const liveInv = invoices.filter(live);
  const collected = money(liveInv.reduce((n, i) => n + (Number(i.paid) || 0), 0));
  const billed = money(liveInv.reduce((n, i) => n + (Number(i.net) || 0), 0));
  const signed = {
    reports: reports.filter((r) => live(r) && r.status === 'SIGNED_FINAL').length,
    labReports: labReports.filter((l) => live(l) && l.status === 'SIGNED_FINAL').length
  };
  const warnings = [];
  if (signed.reports + signed.labReports) {
    warnings.push({ code: 'signed', text: [signed.reports && countLabel('reports', signed.reports), signed.labReports && countLabel('labReports', signed.labReports)].filter(Boolean).join(' and ') + ' signed and locked by the doctor will be removed with the patient.' });
  }
  if (collected > 0) {
    const paidBills = liveInv.filter((i) => Number(i.paid) > 0);
    const days = Array.from(new Set(paidBills.map((i) => i.dateKey).filter(Boolean))).sort();
    warnings.push({ code: 'money', text: inr(collected) + ' collected on ' + countLabel('invoices', paidBills.length) + ' will leave the Daily Cash Book and Accounts' + (days.length ? ' for ' + days.join(', ') : '') + '. Refund or reconcile the cash first if needed.' });
  }
  const liveFormF = formf.filter(live);
  if (liveFormF.length) warnings.push({ code: 'formf_draft', text: countLabel('formf', liveFormF.length) + ' will be removed; Form F serial numbers are never reused.' });
  const sent = dispatchLog.filter(live);
  if (sent.length) warnings.push({ code: 'dispatched', text: 'Reports, bills or messages were already sent to the patient ' + sent.length + ' time(s); copies already delivered cannot be recalled.' });
  const todayKey = opts && opts.todayKey;
  const queued = todayKey ? visits.filter((v) => live(v) && v.dateKey === todayKey && !v.closedAt && Object.values(v.status || {}).some((st) => st !== 'Completed')) : [];
  if (queued.length) warnings.push({ code: 'queue', text: 'The patient is in today’s live queue; the token' + (queued.length === 1 ? '' : 's') + ' will disappear from every queue screen.' });

  // the front desk may delete a record only while nothing has been done for the patient
  const done = [];
  if (signed.reports + signed.labReports) done.push(plural(signed.reports + signed.labReports, 'signed report', 'signed reports'));
  const entered = labReports.filter((l) => live(l) && l.status === 'SUBMITTED').length;
  if (entered) done.push('lab results entered');
  const completed = visits.filter((v) => live(v) && completedModalities(v).length).length;
  if (completed) done.push(plural(completed, 'visit with tests completed', 'visits with tests completed'));
  if (collected > 0) done.push(inr(collected) + ' collected');
  if (sent.length) done.push('reports or bills already sent');
  const desk = { allowed: !done.length && !holds.length, reasons: done };

  return { items, counts, total, holds, warnings, money: { billed, collected, bills: liveInv.length }, signed, desk };
}

/**
 * Cancelling an entry when the patient does not go ahead with the tests. root: { coll: 'visits', doc } —
 * the visit with its bill(s), lab worklist entry, report drafts, Form F draft, files and dispatch log — or
 * { coll: 'invoices', doc } for a bill made without a visit. docs: { coll: [doc] } (live documents).
 * → { items, counts, total, holds, warnings, money, needsRefund, summary }
 */
function planEntryCancel(root, docs, opts) {
  const pick = (coll, fn) => ((docs && docs[coll]) || []).filter((d) => live(d) && fn(d));
  const v = root.coll === 'visits' ? root.doc : null;
  const invoices = v ? pick('invoices', (i) => i.visitId === v.id || i.id === v.invoiceId) : [root.doc];
  const reports = v ? pick('reports', (r) => r.visitId === v.id || r.id === v.reportId) : [];
  const labReports = v ? pick('labReports', (l) => l.visitId === v.id || l.id === v.labReportId) : [];
  const formf = v ? pick('formf', (f) => f.visitId === v.id || f.id === v.formFId) : [];
  const refIds = new Set([].concat(invoices, reports, labReports, formf).map((d) => d.id));
  if (v) refIds.add(v.id);
  const files = pick('files', (f) => (!!v && f.visitId === v.id) || (!!f.reportId && refIds.has(f.reportId)) || (!!f.attachedTo && refIds.has(f.attachedTo.reportId)));
  files.forEach((f) => refIds.add(f.id));
  const dispatchLog = pick('dispatchLog', (x) => !!x.ref && refIds.has(x.ref));

  const items = { visits: v ? [v.id] : [], invoices: invoices.map((d) => d.id), reports: reports.map((d) => d.id), labReports: labReports.map((d) => d.id), formf: formf.map((d) => d.id), files: files.map((d) => d.id), dispatchLog: dispatchLog.map((d) => d.id) };
  const counts = {};
  Object.keys(items).forEach((c) => { if (items[c].length) counts[c] = items[c].length; });
  const total = Object.values(items).reduce((n, ids) => n + ids.length, 0);

  const holds = [];
  if (reports.some((r) => r.status === 'SIGNED_FINAL')) holds.push({ code: 'report_signed', text: 'The USG / X-ray report was signed, so the test was done. Correct the bill with a refund or discount instead of cancelling the entry.' });
  if (labReports.some((l) => l.status === 'SUBMITTED' || l.status === 'SIGNED_FINAL')) holds.push({ code: 'lab_results', text: 'Lab results were already entered for this visit. Correct the bill with a refund or discount instead of cancelling the entry.' });
  const doneMods = completedModalities(v);
  if (doneMods.length && !holds.length) holds.push({ code: 'test_done', text: doneMods.map((m) => MODALITY_NAME[m] || m).join(' and ') + ' is marked Completed, so the test was done. Change the status in the queue first if that was a mistake.' });
  formf.filter((f) => f.status === 'FINAL').forEach((f) => holds.push(formFHold(f)));

  const collected = money(invoices.reduce((n, i) => n + (Number(i.paid) || 0), 0));
  const billed = money(invoices.reduce((n, i) => n + (Number(i.net) || 0), 0));
  const tokens = (v && v.tokens) || {};
  const tokenText = [tokens.combined].concat(Object.entries(tokens).filter(([k]) => k !== 'combined').map(([, t]) => t)).filter(Boolean).join(' · ');
  const warnings = [];
  if (collected > 0) {
    const days = Array.from(new Set(invoices.filter((i) => Number(i.paid) > 0).map((i) => i.dateKey).filter(Boolean))).sort();
    warnings.push({ code: 'money', text: inr(collected) + ' was collected — give it back to the patient. The bill leaves the Daily Cash Book' + (days.length ? ' for ' + days.join(', ') : '') + '.' });
  }
  const todayKey = opts && opts.todayKey;
  if (v && (!todayKey || v.dateKey === todayKey) && !v.closedAt && tokenText) warnings.push({ code: 'queue', text: 'Token ' + tokenText + ' leaves every queue screen and the waiting-hall TV.' });
  const samples = labReports.filter((l) => l.status === 'SAMPLE_COLLECTED');
  if (samples.length) warnings.push({ code: 'sample', text: 'A lab sample was already collected (' + samples.map((l) => l.sampleId).filter(Boolean).join(', ') + '); discard it.' });
  const drafts = reports.filter((r) => r.status !== 'SIGNED_FINAL');
  if (drafts.length) warnings.push({ code: 'report_draft', text: 'An unsigned report draft for this visit is removed with it.' });
  if (formf.length && !formf.some((f) => f.status === 'FINAL')) warnings.push({ code: 'formf_draft', text: countLabel('formf', formf.length) + ' removed; Form F serial numbers are never reused.' });
  if (dispatchLog.length) warnings.push({ code: 'dispatched', text: 'The bill or a message was already sent to the patient; copies already delivered cannot be recalled.' });

  const inv0 = invoices[0] || null;
  const snap = (inv0 && inv0.patient) || {};
  const summary = {
    patientId: (v && v.patientId) || (inv0 && inv0.patientId) || '', patientName: (v && v.patientName) || [snap.title, snap.name].filter(Boolean).join(' '),
    regId: snap.regId || '', dateKey: (v && v.dateKey) || (inv0 && inv0.dateKey) || '', token: tokens.combined || '', tokens,
    tests: ((v && v.tests) || (inv0 && inv0.items) || []).map((t) => t.name).filter(Boolean), invoiceNos: invoices.map((i) => i.invoiceNo).filter(Boolean), net: billed
  };
  return { items, counts, total, holds, warnings, money: { billed, collected, bills: invoices.length }, needsRefund: collected > 0, summary };
}

/**
 * Who may delete this patient, and how carefully it has to be confirmed. can(key, level) → boolean.
 * Nothing done yet (no test performed, no money kept, nothing sent): the front desk may, with a reason.
 * Otherwise patient:delete_records, with the Reg. ID typed and the password entered recently.
 */
function deleteAccess(can, plan) {
  const admin = can('patient:delete_records', 'DRAFT');
  const desk = can('patient:register_and_edit', 'FULL');
  if (plan.holds.length) return { allowed: false, blocked: 'hold' };
  if (plan.desk.allowed && (admin || desk)) return { allowed: true, mode: 'desk', needsConfirm: false, needsPassword: false };
  if (admin) return { allowed: true, mode: 'admin', needsConfirm: true, needsPassword: true };
  return {
    allowed: false, blocked: 'history', reasons: plan.desk.reasons,
    why: 'Only an administrator can delete this record because it has ' + plan.desk.reasons.join(', ') + '.'
  };
}

/** Who may cancel this entry: front desk or billing desk; giving money back also needs the refund permission. */
function cancelAccess(can, plan) {
  const desk = can('patient:register_and_edit', 'FULL') || can('billing:create_invoice', 'FULL');
  if (!desk) return { allowed: false, blocked: 'permission', why: 'Cancelling an entry needs the front-desk or billing permission.' };
  if (plan.holds.length) return { allowed: false, blocked: 'hold' };
  if (plan.needsRefund && !can('billing:modify_discounts_refunds', 'FULL')) {
    return { allowed: false, blocked: 'refund', why: 'Money was collected on this entry. Giving it back needs the refund permission (billing:modify_discounts_refunds), so ask the administrator to cancel it.' };
  }
  return { allowed: true };
}

/** May this user undo their own front-desk deletion (within 15 minutes)? */
const UNDO_MS = 15 * 60000;
const canUndoDelete = (can, p, userId) => !!p && !!p.deletion && p.deletion.mode === 'desk' && p.deletedBy === userId && Date.now() - (p.deletedAt || 0) <= UNDO_MS && can('patient:register_and_edit', 'FULL');

/** Visit count and last visit of a patient from their live visits (after a cancel or restore). */
function visitStats(patientId, visits) {
  const mine = (visits || []).filter((v) => live(v) && v.patientId === patientId);
  return { visitCount: mine.length, lastVisitAt: mine.length ? Math.max(...mine.map((v) => Number(v.createdAt) || 0)) : null };
}

/** Human summary of counts: "3 visits · 2 bills · 1 USG / X-ray report". */
function describeCounts(counts, opts) {
  const skipPatient = !opts || opts.skipPatient !== false;
  return DELETE_COLLS.filter((c) => counts && counts[c] && !(skipPatient && c === 'patients')).map((c) => countLabel(c, counts[c])).join(' · ');
}

// every change is stamped newer than the record's last edit, so it wins on every workstation (last write wins)
const stamp = (doc, at) => Math.max(Number(at) || Date.now(), (Number(doc && doc.updatedAt) || 0) + 1);

/** A record moved to the recycle bin (full data kept for restore). meta: { batch, kind, at, by, byName, reason } */
function markDeleted(doc, meta) {
  return Object.assign({}, doc, {
    _deleted: true, deleteBatch: meta.batch, deleteKind: meta.kind || 'patient', deletedAt: meta.at, deletedBy: meta.by || null, deletedByName: meta.byName || '',
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

/** Is this document in the recycle bin (deleted or cancelled as a batch, not yet purged)? */
const inRecycleBin = (d) => !!d && !!d._deleted && !!d.deleteBatch && !d.purged;
/** Is this document the head of a batch (the deleted patient, or the cancelled visit / bill)? */
const isBatchHead = (d) => inRecycleBin(d) && !!d.deletion;

/** Recycle-bin entry for a batch head: a deleted patient or a cancelled entry. coll: its collection. */
function binEntry(d, coll) {
  const del = d.deletion || {};
  const common = {
    id: d.id, coll: coll || 'patients', batch: d.deleteBatch, deletedAt: d.deletedAt, deletedBy: d.deletedBy || null, deletedByName: d.deletedByName || '',
    reason: d.deleteReason || '', counts: del.counts || {}, money: del.money || null, total: del.total || 1, mode: del.mode || ''
  };
  if (!coll || coll === 'patients') {
    return Object.assign(common, {
      kind: 'patient', counts: del.counts || { patients: 1 }, signed: del.signed || null, regId: d.regId || '', title: d.title || '', name: d.name || '', age: d.age,
      ageUnit: d.ageUnit || '', gender: d.gender || '', mobile: d.mobile || ''
    });
  }
  const s = del.summary || {};
  return Object.assign(common, {
    kind: 'entry', patientId: s.patientId || d.patientId || '', name: s.patientName || d.patientName || '', regId: s.regId || '', title: '', token: s.token || '',
    tests: s.tests || [], invoiceNos: s.invoiceNos || [], net: s.net || 0, dateKey: s.dateKey || ''
  });
}

module.exports = {
  LINKED_COLLS, DELETE_COLLS, ENTRY_COLLS, DELETE_FIELDS, DELETE_REASONS, CANCEL_REASONS, COLL_LABEL, MIN_REASON,
  planPatientDeletion, planEntryCancel, deleteAccess, cancelAccess, canUndoDelete, UNDO_MS, visitStats, describeCounts, countLabel, markDeleted, restoredDoc, tombstone, inRecycleBin, isBatchHead, binEntry,
  normId, confirmWord, confirmMatches
};
