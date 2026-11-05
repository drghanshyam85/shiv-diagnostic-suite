// Deleting patient records (administrators only): recycle bin, restore and permanent deletion.
// With the LAN server the clinic server does the work (/api/patients/…, password re-confirmation, audit
// trail) and every workstation follows through the change feed. In standalone mode the same plan
// (shared/patient-records.js) runs on this computer's store.
import { store } from './store';
import { api, isServer, pull } from './sync';
import { can, currentUser, logAudit } from './auth';
import { dateKey, uid } from './utils';
import { idbDeleteMany } from './idb';
import {
  LINKED_COLLS, MIN_REASON, planPatientDeletion, markDeleted, restoredDoc, tombstone, inRecycleBin, binEntry, confirmMatches, confirmWord, describeCounts
} from '../../../shared/patient-records';

export const DELETE_KEY = 'patient:delete_records';
export const canDeletePatients = () => can(DELETE_KEY, 'DRAFT');
export const canPurgePatients = () => can(DELETE_KEY, 'FULL');
export const canSeeRecycleBin = () => can(DELETE_KEY, 'READ');

const enc = encodeURIComponent;
const summaryOf = (p) => ({
  id: p.id, regId: p.regId || '', title: p.title || '', name: p.name || '', age: p.age, ageUnit: p.ageUnit || '', gender: p.gender || '',
  mobile: p.mobile || '', guardianName: p.guardianName || '', relation: p.relation || '', address: p.address || '',
  createdAt: p.createdAt || null, lastVisitAt: p.lastVisitAt || null, visitCount: p.visitCount || 0, confirmWord: confirmWord(p)
});
const fail = (text, data) => { const e = new Error(text); if (data) e.data = data; return e; };
const confirmHint = (p) => 'Type ' + (p.regId ? 'the Reg. ID ' + p.regId : 'the patient’s name') + ' to confirm';
const nameOf = (p) => [p.title, p.name].filter(Boolean).join(' ');
// the server's records reach this workstation as tombstones; fetch them now in case the socket dropped
const refresh = () => { pull().catch(() => {}); };

/** What deleting would remove, what blocks it (finalised Form F) and what to warn about. */
export async function deletionImpact(patientId) {
  if (isServer()) return api('patients/' + enc(patientId) + '/deletion-impact');
  const p = store.getRaw('patients', patientId);
  if (!p || p._deleted) throw fail(inRecycleBin(p) ? 'This patient is already in the recycle bin' : 'Patient not found');
  const docs = {};
  LINKED_COLLS.forEach((c) => { docs[c] = store.list(c); });
  return { patient: summaryOf(p), plan: planPatientDeletion(p, docs, { todayKey: dateKey() }) };
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
  const { plan } = await deletionImpact(patientId);
  const p = store.getRaw('patients', patientId);
  if (!confirmMatches(p, confirm)) throw fail(confirmHint(p));
  if (plan.holds.length) throw fail(plan.holds[0].text, { holds: plan.holds, blocked: true });
  const u = currentUser();
  const meta = { batch: uid('del_'), at: Date.now(), by: u ? u.id : null, byName: u ? u.name : '', reason: why };
  LINKED_COLLS.forEach((c) => plan.items[c].forEach((id) => { const cur = store.getRaw(c, id); if (cur) store.put(c, markDeleted(cur, meta)); }));
  const deletion = { items: plan.items, counts: plan.counts, total: plan.total, money: plan.money, signed: plan.signed, warnings: plan.warnings.map((w) => w.code) };
  store.put('patients', Object.assign(markDeleted(p, meta), { deletion }));
  logAudit('patient:moved_to_recycle_bin', 'patients/' + p.id, { regId: p.regId, name: nameOf(p), reason: why, batch: meta.batch, records: describeCounts(plan.counts), collected: plan.money.collected });
  return { batch: meta.batch, deletedAt: meta.at, patient: summaryOf(p), counts: plan.counts, total: plan.total, money: plan.money, signed: plan.signed, warnings: plan.warnings };
}

/** Deleted patients that can still be restored / deleted permanently. */
export async function recycleBin() {
  if (isServer()) return api('patients/recycle-bin');
  return {
    entries: store.listAll('patients').filter(inRecycleBin).map(binEntry).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0)),
    canDelete: canDeletePatients(), canPurge: canPurgePatients()
  };
}

/** The batch's records as they are now on this computer (standalone). */
function localBatch(p) {
  const items = (p.deletion && p.deletion.items) || {};
  const out = [];
  LINKED_COLLS.forEach((c) => (items[c] || []).forEach((id) => {
    const cur = store.getRaw(c, id);
    if (cur && cur._deleted && !cur.purged && cur.deleteBatch === p.deleteBatch) out.push({ coll: c, doc: cur });
  }));
  return out;
}

/** Bring the patient and every record deleted with it back. */
export async function restorePatient(patientId) {
  if (isServer()) {
    const r = await api('patients/' + enc(patientId) + '/restore', { method: 'POST', body: {} });
    refresh();
    return r;
  }
  const p = store.getRaw('patients', patientId);
  if (!inRecycleBin(p)) throw fail('This patient is not in the recycle bin');
  const counts = {};
  localBatch(p).forEach(({ coll, doc }) => { store.put(coll, restoredDoc(doc)); counts[coll] = (counts[coll] || 0) + 1; });
  store.put('patients', restoredDoc(p));
  counts.patients = 1;
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
  if (!inRecycleBin(p)) throw fail('Only records in the recycle bin can be deleted permanently');
  if (!confirmMatches(p, confirm)) throw fail(confirmHint(p));
  const at = Date.now();
  const counts = {};
  const blobs = [];
  localBatch(p).forEach(({ coll, doc }) => {
    if (coll === 'files' && doc.storage === 'local') blobs.push(doc.id);
    if (coll === 'reports') (doc.images || []).forEach((im) => { if (im && im.id) blobs.push(im.id); });
    store.put(coll, tombstone(doc, { at, batch: p.deleteBatch }));
    counts[coll] = (counts[coll] || 0) + 1;
  });
  store.put('patients', tombstone(p, { at, batch: p.deleteBatch }));
  counts.patients = 1;
  if (blobs.length) await idbDeleteMany('blobs', blobs).catch(() => {});
  logAudit('patient:purged', 'patients/' + p.id, { regId: p.regId, batch: p.deleteBatch, records: describeCounts(counts), filesRemoved: blobs.length, reason: p.deleteReason || '' });
  return { batch: p.deleteBatch, regId: p.regId || '', counts, filesRemoved: blobs.length };
}
