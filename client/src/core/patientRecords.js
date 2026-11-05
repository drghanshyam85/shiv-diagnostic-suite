// Deleting patient records and cancelling entries, from Registration, the Dashboard, the Billing Desk, the
// live queue, the patient history and Admin Console → Patient records.
// With the LAN server the clinic server does the work (/api/patients/…, /api/entries/…, audit trail) and
// every workstation follows through the change feed. In standalone mode the same plan and the same rules
// (shared/patient-records.js) run on this computer's store.
import { store } from './store';
import { api, isServer, pull } from './sync';
import { can, currentUser, logAudit } from './auth';
import { dateKey, uid } from './utils';
import { idbDeleteMany } from './idb';
import {
  LINKED_COLLS, ENTRY_COLLS, MIN_REASON, planPatientDeletion, planEntryCancel, deleteAccess, cancelAccess, canUndoDelete, visitStats, markDeleted, restoredDoc,
  tombstone, inRecycleBin, isBatchHead, binEntry, confirmMatches, confirmWord, describeCounts
} from '../../../shared/patient-records';

export const DELETE_KEY = 'patient:delete_records';
/** Front desk may delete records where nothing has been done yet; delete_records may delete any record. */
export const canDeskDelete = () => can('patient:register_and_edit') || can(DELETE_KEY, 'DRAFT');
export const canDeletePatients = () => can(DELETE_KEY, 'DRAFT');
export const canPurgePatients = () => can(DELETE_KEY, 'FULL');
export const canSeeRecycleBin = () => can(DELETE_KEY, 'READ');
export const canCancelEntries = () => can('patient:register_and_edit') || can('billing:create_invoice');

const enc = encodeURIComponent;
const summaryOf = (p) => ({
  id: p.id, regId: p.regId || '', title: p.title || '', name: p.name || '', age: p.age, ageUnit: p.ageUnit || '', gender: p.gender || '',
  mobile: p.mobile || '', guardianName: p.guardianName || '', relation: p.relation || '', address: p.address || '',
  createdAt: p.createdAt || null, lastVisitAt: p.lastVisitAt || null, visitCount: p.visitCount || 0, confirmWord: confirmWord(p)
});
const fail = (text, data) => { const e = new Error(text); if (data) e.data = data; return e; };
const confirmHint = (p) => 'Type ' + (p.regId ? 'the Reg. ID ' + p.regId : 'the patient’s name') + ' to confirm';
const nameOf = (p) => [p.title, p.name].filter(Boolean).join(' ');
// the server's changes reach this workstation as tombstones; fetch them now in case the socket dropped
const refresh = () => { pull().catch(() => {}); };
const liveDocs = () => { const docs = {}; LINKED_COLLS.forEach((c) => { docs[c] = store.list(c); }); return docs; };
const me = () => currentUser() || {};

/** Patients that have something done already (tests performed, money kept, reports sent): front desk may not delete them. */
export function patientsWithHistory({ visits, invoices, reports, labs, dispatchLog }) {
  const out = new Set();
  const visitPatient = Object.fromEntries((visits || []).map((v) => [v.id, v.patientId]));
  const who = (d) => d.patientId || visitPatient[d.visitId];
  (reports || []).forEach((r) => { if (r.status === 'SIGNED_FINAL') out.add(who(r)); });
  (labs || []).forEach((l) => { if (l.status === 'SUBMITTED' || l.status === 'SIGNED_FINAL') out.add(who(l)); });
  (invoices || []).forEach((i) => { if (Number(i.paid) > 0) out.add(who(i)); });
  (visits || []).forEach((v) => { if (Object.values(v.status || {}).includes('Completed')) out.add(v.patientId); });
  (dispatchLog || []).forEach((x) => { if (x.patientId) out.add(x.patientId); });
  out.delete(undefined);
  return out;
}

/** Visits with money collected on their bill: cancelling them needs the refund permission. */
export function paidVisitIds(invoices) {
  const out = new Set();
  (invoices || []).forEach((i) => { if (Number(i.paid) > 0 && i.visitId) out.add(i.visitId); });
  return out;
}
export const canRefund = () => can('billing:modify_discounts_refunds');
export const REFUND_HINT = 'Money was collected on this entry — cancelling it needs the refund permission (ask the administrator)';

/** The visit that "Cancel entry" would cancel for a patient: their latest visit still open in the last 7 days. */
export function cancellableVisit(visits, patientId, now = Date.now()) {
  const since = now - 7 * 86400000;
  return (visits || []).filter((v) => v.patientId === patientId && (v.createdAt || 0) >= since && !v.closedAt && !Object.values(v.status || {}).includes('Completed'))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
}

// ---------------------------------------------------------------- patients
/** What deleting would remove, what blocks it, and whether (and how) this user may do it. */
export async function deletionImpact(patientId) {
  if (isServer()) return api('patients/' + enc(patientId) + '/deletion-impact');
  const p = store.getRaw('patients', patientId);
  if (!p || p._deleted) throw fail(inRecycleBin(p) ? 'This patient is already in the recycle bin' : 'Patient not found');
  const plan = planPatientDeletion(p, liveDocs(), { todayKey: dateKey() });
  return { patient: summaryOf(p), plan, access: deleteAccess(can, plan) };
}

/** Patient + linked records → recycle bin (restorable). */
export async function deletePatient(patientId, { reason, confirm }) {
  if (isServer()) {
    const r = await api('patients/' + enc(patientId) + '/delete', { method: 'POST', body: { reason, confirm } });
    refresh();
    return r;
  }
  const why = String(reason || '').trim();
  if (why.length < MIN_REASON) throw fail('Give the reason for deleting this record (at least ' + MIN_REASON + ' characters)');
  const { plan, access } = await deletionImpact(patientId);
  const p = store.getRaw('patients', patientId);
  if (access.blocked === 'hold') throw fail(plan.holds[0].text, { holds: plan.holds, blocked: true });
  if (!access.allowed) throw fail(access.why || 'You may not delete this record');
  if (access.needsConfirm && !confirmMatches(p, confirm)) throw fail(confirmHint(p));
  const u = me();
  const meta = { batch: uid('del_'), kind: 'patient', at: Date.now(), by: u.id || null, byName: u.name || '', reason: why };
  LINKED_COLLS.forEach((c) => plan.items[c].forEach((id) => { const cur = store.getRaw(c, id); if (cur) store.put(c, markDeleted(cur, meta)); }));
  const deletion = { items: plan.items, counts: plan.counts, total: plan.total, money: plan.money, signed: plan.signed, warnings: plan.warnings.map((w) => w.code), mode: access.mode };
  store.put('patients', Object.assign(markDeleted(p, meta), { deletion }));
  logAudit('patient:moved_to_recycle_bin', 'patients/' + p.id, { regId: p.regId, name: nameOf(p), reason: why, batch: meta.batch, mode: access.mode, records: describeCounts(plan.counts), collected: plan.money.collected });
  return { batch: meta.batch, deletedAt: meta.at, mode: access.mode, patient: summaryOf(p), counts: plan.counts, total: plan.total, money: plan.money, signed: plan.signed, warnings: plan.warnings };
}

/** Deleted patients and cancelled entries that can still be restored / deleted permanently. */
export async function recycleBin() {
  if (isServer()) return api('patients/recycle-bin');
  const entries = store.listAll('patients').filter(isBatchHead).map((d) => binEntry(d, 'patients'));
  ENTRY_COLLS.forEach((c) => store.listAll(c).filter((d) => isBatchHead(d) && d.deleteKind === 'entry').forEach((d) => entries.push(binEntry(d, c))));
  return { entries: entries.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0)), canDelete: canDeletePatients(), canPurge: canPurgePatients() };
}

/** The batch's records as they are now on this computer (standalone), without the head. */
function localBatch(head, headColl) {
  const items = (head.deletion && head.deletion.items) || {};
  const out = [];
  LINKED_COLLS.forEach((c) => (items[c] || []).forEach((id) => {
    if (c === headColl && id === head.id) return;
    const cur = store.getRaw(c, id);
    if (cur && cur._deleted && !cur.purged && cur.deleteBatch === head.deleteBatch) out.push({ coll: c, doc: cur });
  }));
  return out;
}

function refreshVisitStats(patientId) {
  const p = patientId ? store.get('patients', patientId) : null;
  if (!p) return;
  const st = visitStats(patientId, store.list('visits'));
  if ((p.visitCount || 0) !== st.visitCount || (p.lastVisitAt || null) !== st.lastVisitAt) store.put('patients', Object.assign({}, p, st));
}

/** Bring the patient and every record deleted with it back (or undo your own front-desk deletion). */
export async function restorePatient(patientId) {
  if (isServer()) {
    const r = await api('patients/' + enc(patientId) + '/restore', { method: 'POST', body: {} });
    refresh();
    return r;
  }
  const p = store.getRaw('patients', patientId);
  if (!inRecycleBin(p) || p.deleteKind === 'entry') throw fail('This patient is not in the recycle bin');
  if (!canDeletePatients() && !canUndoDelete(can, p, me().id)) throw fail('Restoring a deleted patient needs the permission patient:delete_records');
  const counts = { patients: 1 };
  localBatch(p, 'patients').forEach(({ coll, doc }) => { store.put(coll, restoredDoc(doc)); counts[coll] = (counts[coll] || 0) + 1; });
  store.put('patients', restoredDoc(p));
  logAudit('patient:restored', 'patients/' + p.id, { regId: p.regId, name: nameOf(p), batch: p.deleteBatch, records: describeCounts(counts) });
  return { batch: p.deleteBatch, patient: summaryOf(p), counts };
}

/** Delete permanently: only tombstones without patient data remain; stored files and images are removed. */
export async function purgePatient(patientId, { confirm }) {
  if (isServer()) {
    const r = await api('patients/' + enc(patientId) + '/purge', { method: 'POST', body: { confirm } });
    refresh();
    return r;
  }
  const p = store.getRaw('patients', patientId);
  if (!inRecycleBin(p) || p.deleteKind === 'entry') throw fail('Only records in the recycle bin can be deleted permanently');
  if (!confirmMatches(p, confirm)) throw fail(confirmHint(p));
  const at = Date.now();
  const counts = {};
  const blobs = [];
  // every record of the patient: this batch, entries cancelled earlier and anything deleted before
  const all = {};
  LINKED_COLLS.forEach((c) => { all[c] = store.listAll(c); });
  const sweep = planPatientDeletion(p, all, { includeDeleted: true });
  LINKED_COLLS.forEach((c) => sweep.items[c].forEach((id) => {
    const doc = store.getRaw(c, id);
    if (!doc || doc.purged) return;
    if (c === 'files' && doc.storage === 'local') blobs.push(doc.id);
    if (c === 'reports') (doc.images || []).forEach((im) => { if (im && im.id) blobs.push(im.id); });
    store.put(c, tombstone(doc, { at, batch: p.deleteBatch }));
    counts[c] = (counts[c] || 0) + 1;
  }));
  store.put('patients', tombstone(p, { at, batch: p.deleteBatch }));
  counts.patients = 1;
  if (blobs.length) await idbDeleteMany('blobs', blobs).catch(() => {});
  logAudit('patient:purged', 'patients/' + p.id, { regId: p.regId, batch: p.deleteBatch, records: describeCounts(counts), filesRemoved: blobs.length, reason: p.deleteReason || '' });
  return { batch: p.deleteBatch, regId: p.regId || '', counts, filesRemoved: blobs.length };
}

// ---------------------------------------------------------------- entries (a visit, or a bill made without a visit)
function localRoot(coll, id) {
  const doc = store.getRaw(coll, id);
  if (!doc) throw fail(coll === 'visits' ? 'Visit not found' : 'Bill not found');
  if (coll === 'invoices' && doc.visitId && !doc._deleted) {
    const v = store.get('visits', doc.visitId);
    if (v) return { coll: 'visits', doc: v };
  }
  return { coll, doc };
}
const goneText = (d) => (inRecycleBin(d) ? (d.deleteKind === 'entry' ? 'This entry was already cancelled' : 'This record was deleted with the patient') : 'This entry has been removed');

/** What cancelling the entry would remove, what blocks it, and whether this user may do it. */
export async function entryImpact(coll, id) {
  if (isServer()) return api('entries/' + coll + '/' + enc(id) + '/cancel-impact');
  const root = localRoot(coll, id);
  if (root.doc._deleted) throw fail(goneText(root.doc));
  const plan = planEntryCancel(root, liveDocs(), { todayKey: dateKey() });
  const p = plan.summary.patientId ? store.get('patients', plan.summary.patientId) : null;
  const others = p ? visitStats(p.id, store.list('visits').filter((v) => v.id !== root.doc.id)).visitCount : 0;
  return { root: { coll: root.coll, id: root.doc.id }, plan, access: cancelAccess(can, plan), patient: p ? Object.assign(summaryOf(p), { otherVisits: others }) : null };
}

/** Cancel the entry: the visit (or bill) and its linked records leave the queue, worklists and cash book. */
export async function cancelEntry(coll, id, { reason }) {
  if (isServer()) {
    const r = await api('entries/' + coll + '/' + enc(id) + '/cancel', { method: 'POST', body: { reason } });
    refresh();
    return r;
  }
  const why = String(reason || '').trim();
  if (why.length < MIN_REASON) throw fail('Give the reason for cancelling (at least ' + MIN_REASON + ' characters)');
  const root = localRoot(coll, id);
  if (root.doc._deleted) throw fail(goneText(root.doc));
  const plan = planEntryCancel(root, liveDocs(), { todayKey: dateKey() });
  const access = cancelAccess(can, plan);
  if (access.blocked === 'hold') throw fail(plan.holds[0].text, { holds: plan.holds, blocked: true });
  if (!access.allowed) throw fail(access.why);
  if (!plan.summary.regId && plan.summary.patientId) { const pt = store.getRaw('patients', plan.summary.patientId); if (pt) plan.summary.regId = pt.regId || ''; }
  const u = me();
  const meta = { batch: uid('can_'), kind: 'entry', at: Date.now(), by: u.id || null, byName: u.name || '', reason: why };
  LINKED_COLLS.forEach((c) => (plan.items[c] || []).forEach((docId) => {
    if (c === root.coll && docId === root.doc.id) return;
    const cur = store.getRaw(c, docId);
    if (cur) store.put(c, markDeleted(cur, meta));
  }));
  const deletion = { items: plan.items, counts: plan.counts, total: plan.total, money: plan.money, summary: plan.summary, warnings: plan.warnings.map((w) => w.code), mode: 'cancel' };
  store.put(root.coll, Object.assign(markDeleted(root.doc, meta), { deletion }));
  refreshVisitStats(plan.summary.patientId);
  const s = plan.summary;
  logAudit((root.coll === 'visits' ? 'visit' : 'invoice') + ':cancelled', root.coll + '/' + root.doc.id, { patient: s.patientName, token: s.token, tests: s.tests.slice(0, 20), invoiceNos: s.invoiceNos, net: s.net, refunded: plan.money.collected, reason: why, batch: meta.batch });
  return { batch: meta.batch, root: { coll: root.coll, id: root.doc.id }, summary: s, counts: plan.counts, money: plan.money, cancelledAt: meta.at };
}

/** Undo a cancellation. */
export async function restoreEntry(coll, id) {
  if (isServer()) {
    const r = await api('entries/' + coll + '/' + enc(id) + '/restore', { method: 'POST', body: {} });
    refresh();
    return r;
  }
  const head = store.getRaw(coll, id);
  if (!isBatchHead(head) || head.deleteKind !== 'entry') throw fail('This entry is not cancelled');
  if (!canCancelEntries() && !canDeletePatients()) throw fail('Restoring an entry needs the front-desk or billing permission');
  const s = (head.deletion && head.deletion.summary) || {};
  const p = s.patientId ? store.getRaw('patients', s.patientId) : null;
  if (p && p._deleted) throw fail('The patient record is in the recycle bin or deleted — restore the patient first');
  const counts = { [coll]: 1 };
  localBatch(head, coll).forEach(({ coll: c, doc }) => { store.put(c, restoredDoc(doc)); counts[c] = (counts[c] || 0) + 1; });
  store.put(coll, restoredDoc(head));
  refreshVisitStats(s.patientId);
  logAudit((coll === 'visits' ? 'visit' : 'invoice') + ':restored', coll + '/' + id, { patient: s.patientName, token: s.token, invoiceNos: s.invoiceNos, batch: head.deleteBatch });
  return { batch: head.deleteBatch, summary: s, counts };
}

/** Delete a cancelled entry permanently (Full delete permission). */
export async function purgeEntry(coll, id) {
  if (isServer()) {
    const r = await api('entries/' + coll + '/' + enc(id) + '/purge', { method: 'POST', body: {} });
    refresh();
    return r;
  }
  const head = store.getRaw(coll, id);
  if (!isBatchHead(head) || head.deleteKind !== 'entry') throw fail('Only cancelled entries can be deleted permanently');
  if (!canPurgePatients()) throw fail('Deleting permanently needs Full access to patient:delete_records');
  const at = Date.now();
  const counts = { [coll]: 1 };
  const blobs = [];
  localBatch(head, coll).forEach(({ coll: c, doc }) => {
    if (c === 'files' && doc.storage === 'local') blobs.push(doc.id);
    if (c === 'reports') (doc.images || []).forEach((im) => { if (im && im.id) blobs.push(im.id); });
    store.put(c, tombstone(doc, { at, batch: head.deleteBatch }));
    counts[c] = (counts[c] || 0) + 1;
  });
  store.put(coll, tombstone(head, { at, batch: head.deleteBatch }));
  if (blobs.length) await idbDeleteMany('blobs', blobs).catch(() => {});
  const s = (head.deletion && head.deletion.summary) || {};
  logAudit((coll === 'visits' ? 'visit' : 'invoice') + ':purged', coll + '/' + id, { token: s.token, invoiceNos: s.invoiceNos, batch: head.deleteBatch, filesRemoved: blobs.length });
  return { batch: head.deleteBatch, summary: s, counts, filesRemoved: blobs.length };
}
