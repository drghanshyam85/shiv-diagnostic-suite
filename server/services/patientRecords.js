/*
 * Patient records on the clinic server: deleting a patient, cancelling an entry, the recycle bin.
 *
 *   impact(id, user)                     what deleting the patient would remove, legal holds, warnings and
 *                                        whether this user may do it (front desk: only while nothing has
 *                                        been done for the patient; otherwise patient:delete_records)
 *   moveToBin(id, {...})                 the patient and every linked record → recycle bin (one batch)
 *   restore(id, {...}) / purge(id, {...}) bring the batch back / delete permanently (sweeps every record of
 *                                        the patient, cancelled entries included)
 *   entryImpact / cancelEntry / restoreEntry / purgeEntry
 *                                        the same for one entry — a visit with its bill, lab worklist entry,
 *                                        report drafts, Form F draft, files and dispatch log, or a bill made
 *                                        without a visit — when the patient does not go ahead with the tests
 *   recycleBin()                         deleted patients and cancelled entries that can still be restored
 *
 * Every write goes through ctx.saveDoc(), so every workstation, the TV queue, the cloud mirror and the
 * event log follow at once. Workstations only ever receive bare tombstones of these records
 * (context.sanitizeForClient), and the sync API refuses to bring them back (sync.routes.js) — only a
 * restore can. A batch's record list is kept on its head document (the patient, the visit or the bill).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const shared = require('../../shared/patient-records');

const {
  LINKED_COLLS, ENTRY_COLLS, MIN_REASON, planPatientDeletion, planEntryCancel, visitStats, markDeleted, restoredDoc, tombstone,
  inRecycleBin, isBatchHead, binEntry, confirmMatches, confirmWord, canUndoDelete
} = shared;
const KEY = 'patient:delete_records';
const can = (user) => (k, l) => user.can(k, l);
const deleteAccess = (user, plan) => shared.deleteAccess(can(user), plan);
const cancelAccess = (user, plan) => shared.cancelAccess(can(user), plan);

function httpError(status, message, extra) {
  const e = new Error(message);
  e.status = status;
  if (extra) Object.assign(e, extra);
  return e;
}

function clinicDay(settings) {
  const tz = (settings && settings.clinic && settings.clinic.timezone) || 'Asia/Kolkata';
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); }
}

const summary = (p) => ({
  id: p.id, regId: p.regId || '', title: p.title || '', name: p.name || '', age: p.age, ageUnit: p.ageUnit || '', gender: p.gender || '',
  mobile: p.mobile || '', guardianName: p.guardianName || '', relation: p.relation || '', address: p.address || '',
  createdAt: p.createdAt || null, lastVisitAt: p.lastVisitAt || null, visitCount: p.visitCount || 0, confirmWord: confirmWord(p)
});

function createPatientRecords(ctx) {
  const busy = new Set(); // one change at a time per patient / entry

  async function exclusive(key, fn) {
    if (busy.has(key)) throw httpError(409, 'This record is already being changed — try again in a moment');
    busy.add(key);
    try { return await fn(); } finally { busy.delete(key); }
  }

  async function load(id) {
    const p = await ctx.store.getDoc('patients', String(id || ''));
    if (!p) throw httpError(404, 'Patient not found');
    return p;
  }

  async function linkedDocs(opts) {
    const docs = {};
    for (const c of LINKED_COLLS) docs[c] = await ctx.store.listDocs(c, opts);
    return docs;
  }

  async function todayKey() { return clinicDay(await ctx.getSettings()); }

  async function saveAll(list, actor) {
    for (const { coll, doc } of list) await ctx.saveDoc(coll, doc, { actor, force: true });
  }

  function removeFile(doc) {
    if (doc.storage === 'local') return 0;
    const file = path.join(ctx.filesDir, path.basename(String(doc.id)));
    try { if (fs.existsSync(file)) { fs.rmSync(file, { force: true }); return 1; } } catch (e) { console.warn('[records] could not remove file', doc.id, e.message); }
    return 0;
  }

  /** Keep the patient's visit count and last visit right after a cancel or restore. */
  async function refreshVisitStats(patientId, actor) {
    if (!patientId) return;
    const p = await ctx.store.getDoc('patients', patientId);
    if (!p || p._deleted) return;
    const st = visitStats(patientId, await ctx.store.listDocs('visits'));
    if ((p.visitCount || 0) === st.visitCount && (p.lastVisitAt || null) === st.lastVisitAt) return;
    await ctx.saveDoc('patients', Object.assign({}, p, st, { updatedAt: Math.max(Date.now(), (p.updatedAt || 0) + 1) }), { actor, force: true });
  }

  // ------------------------------------------------------------------ patients
  async function impact(id, user) {
    const p = await load(id);
    if (p._deleted) throw httpError(409, inRecycleBin(p) ? 'This patient is already in the recycle bin' : 'This patient record has been deleted');
    const plan = planPatientDeletion(p, await linkedDocs(), { todayKey: await todayKey() });
    return { patient: summary(p), plan, access: deleteAccess(user, plan) };
  }

  async function moveToBin(id, { reason, confirm, user, recentAuth, reauthMinutes }) {
    const why = String(reason || '').trim().slice(0, 500);
    if (why.length < MIN_REASON) throw httpError(400, 'Give the reason for deleting this record (at least ' + MIN_REASON + ' characters)');
    return exclusive('patients/' + id, async () => {
      const p = await load(id);
      if (p._deleted) throw httpError(409, inRecycleBin(p) ? 'This patient is already in the recycle bin' : 'This patient record has been deleted');
      const docs = await linkedDocs();
      const plan = planPatientDeletion(p, docs, { todayKey: await todayKey() });
      const access = deleteAccess(user, plan);
      if (access.blocked === 'hold') throw httpError(409, plan.holds[0].text, { holds: plan.holds, blocked: true, regId: p.regId || '' });
      if (!access.allowed) throw httpError(403, access.why || 'You may not delete this record', { reasons: access.reasons });
      if (access.needsConfirm && !confirmMatches(p, confirm)) throw httpError(400, 'Type ' + (p.regId ? 'the Reg. ID ' + p.regId : 'the patient’s name') + ' to confirm');
      if (access.needsPassword && !recentAuth) throw httpError(401, 'Please confirm your password to continue', { code: 'REAUTH_REQUIRED', minutes: reauthMinutes });
      const meta = { batch: 'del_' + crypto.randomBytes(8).toString('hex'), kind: 'patient', at: Date.now(), by: user.id, byName: user.name, reason: why };
      // linked records first, the patient last: its document carries the batch (the recycle-bin entry)
      const out = [];
      for (const c of LINKED_COLLS) {
        const byId = new Map((docs[c] || []).map((d) => [d.id, d]));
        plan.items[c].forEach((docId) => { const cur = byId.get(docId); if (cur) out.push({ coll: c, doc: markDeleted(cur, meta) }); });
      }
      await saveAll(out, user);
      const deletion = { items: plan.items, counts: plan.counts, total: plan.total, money: plan.money, signed: plan.signed, warnings: plan.warnings.map((w) => w.code), mode: access.mode };
      await ctx.saveDoc('patients', Object.assign(markDeleted(p, meta), { deletion }), { actor: user, force: true });
      return { batch: meta.batch, deletedAt: meta.at, mode: access.mode, patient: summary(p), counts: plan.counts, total: plan.total, money: plan.money, signed: plan.signed, warnings: plan.warnings };
    });
  }

  /** The batch's records as they are now (only those still deleted by this batch), without the head itself. */
  async function batchDocs(head, headColl) {
    const items = (head.deletion && head.deletion.items) || {};
    const out = [];
    for (const c of LINKED_COLLS) {
      for (const docId of items[c] || []) {
        if (c === headColl && docId === head.id) continue;
        const cur = await ctx.store.getDoc(c, docId);
        if (cur && cur._deleted && !cur.purged && cur.deleteBatch === head.deleteBatch) out.push({ coll: c, doc: cur });
      }
    }
    return out;
  }

  async function restore(id, { user }) {
    return exclusive('patients/' + id, async () => {
      const p = await load(id);
      if (!inRecycleBin(p) || p.deleteKind === 'entry') throw httpError(409, p.purged ? 'This patient record was deleted permanently and cannot be restored' : 'This patient is not in the recycle bin');
      const undo = canUndoDelete(can(user), p, user.id);
      if (!user.can(KEY, 'DRAFT') && !undo) throw httpError(403, 'Restoring a deleted patient needs the permission patient:delete_records');
      const at = Date.now();
      const list = await batchDocs(p, 'patients');
      await saveAll(list.map(({ coll, doc }) => ({ coll, doc: restoredDoc(doc, at) })), user);
      await ctx.saveDoc('patients', restoredDoc(p, at), { actor: user, force: true });
      const counts = { patients: 1 };
      list.forEach(({ coll }) => { counts[coll] = (counts[coll] || 0) + 1; });
      return { batch: p.deleteBatch, patient: summary(p), counts, deletedAt: p.deletedAt, deletedByName: p.deletedByName || '', reason: p.deleteReason || '', undo: !!undo && !user.can(KEY, 'DRAFT') };
    });
  }

  async function purge(id, { confirm, user }) {
    return exclusive('patients/' + id, async () => {
      const p = await load(id);
      if (!inRecycleBin(p) || p.deleteKind === 'entry') throw httpError(409, p.purged ? 'This patient record has already been deleted permanently' : 'Only records in the recycle bin can be deleted permanently');
      if (!confirmMatches(p, confirm)) throw httpError(400, 'Type ' + (p.regId ? 'the Reg. ID ' + p.regId : 'the patient’s name') + ' to confirm');
      const at = Date.now();
      // every record of the patient goes: this batch, entries cancelled earlier and anything deleted before
      const sweep = planPatientDeletion(p, await linkedDocs({ includeDeleted: true }), { includeDeleted: true });
      const counts = {};
      let filesRemoved = 0;
      for (const c of LINKED_COLLS) {
        for (const docId of sweep.items[c]) {
          const cur = await ctx.store.getDoc(c, docId);
          if (!cur || cur.purged) continue;
          if (c === 'files') filesRemoved += removeFile(cur);
          await ctx.saveDoc(c, tombstone(cur, { at, batch: p.deleteBatch }), { actor: user, force: true });
          counts[c] = (counts[c] || 0) + 1;
        }
      }
      await ctx.saveDoc('patients', tombstone(p, { at, batch: p.deleteBatch }), { actor: user, force: true });
      counts.patients = 1;
      return { batch: p.deleteBatch, regId: p.regId || '', counts, filesRemoved, deletedAt: p.deletedAt, reason: p.deleteReason || '' };
    });
  }

  // ------------------------------------------------------------------ entries (visit or bill)
  async function loadEntry(coll, id) {
    if (!ENTRY_COLLS.includes(coll)) throw httpError(400, 'Entries are visits or bills');
    const d = await ctx.store.getDoc(coll, String(id || ''));
    if (!d) throw httpError(404, coll === 'visits' ? 'Visit not found' : 'Bill not found');
    return d;
  }
  /** A bill that belongs to a live visit is cancelled together with its visit. */
  async function entryRoot(coll, id) {
    const doc = await loadEntry(coll, id);
    if (coll === 'invoices' && doc.visitId && !doc._deleted) {
      const v = await ctx.store.getDoc('visits', doc.visitId);
      if (v && !v._deleted) return { coll: 'visits', doc: v };
    }
    return { coll, doc };
  }
  const gone = (d) => httpError(409, inRecycleBin(d) ? (d.deleteKind === 'entry' ? 'This entry was already cancelled' : 'This record was deleted with the patient') : 'This entry has been removed');

  async function entryImpact(coll, id, user) {
    const root = await entryRoot(coll, id);
    if (root.doc._deleted) throw gone(root.doc);
    const plan = planEntryCancel(root, await linkedDocs(), { todayKey: await todayKey() });
    const p = plan.summary.patientId ? await ctx.store.getDoc('patients', plan.summary.patientId) : null;
    const others = p ? visitStats(p.id, (await ctx.store.listDocs('visits')).filter((v) => v.id !== root.doc.id)).visitCount : 0;
    return { root: { coll: root.coll, id: root.doc.id }, plan, access: cancelAccess(user, plan), patient: p && !p._deleted ? Object.assign(summary(p), { otherVisits: others }) : null };
  }

  async function cancelEntry(coll, id, { reason, user }) {
    const why = String(reason || '').trim().slice(0, 500);
    if (why.length < MIN_REASON) throw httpError(400, 'Give the reason for cancelling (at least ' + MIN_REASON + ' characters)');
    const first = await entryRoot(coll, id);
    return exclusive(first.coll + '/' + first.doc.id, async () => {
      const root = await entryRoot(coll, id);
      if (root.doc._deleted) throw gone(root.doc);
      const docs = await linkedDocs();
      const plan = planEntryCancel(root, docs, { todayKey: await todayKey() });
      const access = cancelAccess(user, plan);
      if (access.blocked === 'hold') throw httpError(409, plan.holds[0].text, { holds: plan.holds, blocked: true });
      if (!access.allowed) throw httpError(403, access.why);
      if (!plan.summary.regId && plan.summary.patientId) { const pt = await ctx.store.getDoc('patients', plan.summary.patientId); if (pt) plan.summary.regId = pt.regId || ''; }
      const meta = { batch: 'can_' + crypto.randomBytes(8).toString('hex'), kind: 'entry', at: Date.now(), by: user.id, byName: user.name, reason: why };
      const out = [];
      for (const c of LINKED_COLLS) {
        const byId = new Map((docs[c] || []).map((d) => [d.id, d]));
        (plan.items[c] || []).forEach((docId) => {
          if (c === root.coll && docId === root.doc.id) return;
          const cur = byId.get(docId);
          if (cur) out.push({ coll: c, doc: markDeleted(cur, meta) });
        });
      }
      await saveAll(out, user);
      const deletion = { items: plan.items, counts: plan.counts, total: plan.total, money: plan.money, summary: plan.summary, warnings: plan.warnings.map((w) => w.code), mode: 'cancel' };
      await ctx.saveDoc(root.coll, Object.assign(markDeleted(root.doc, meta), { deletion }), { actor: user, force: true });
      await refreshVisitStats(plan.summary.patientId, user);
      return { batch: meta.batch, root: { coll: root.coll, id: root.doc.id }, summary: plan.summary, counts: plan.counts, money: plan.money, cancelledAt: meta.at };
    });
  }

  async function restoreEntry(coll, id, { user }) {
    return exclusive(coll + '/' + id, async () => {
      const head = await loadEntry(coll, id);
      if (!isBatchHead(head) || head.deleteKind !== 'entry') throw httpError(409, head.purged ? 'This entry was deleted permanently and cannot be restored' : 'This entry is not cancelled');
      if (!(user.can('patient:register_and_edit', 'FULL') || user.can('billing:create_invoice', 'FULL') || user.can(KEY, 'DRAFT'))) throw httpError(403, 'Restoring an entry needs the front-desk or billing permission');
      const s = (head.deletion && head.deletion.summary) || {};
      if (s.patientId) {
        const p = await ctx.store.getDoc('patients', s.patientId);
        if (p && p._deleted) throw httpError(409, 'The patient record is in the recycle bin or deleted — restore the patient first');
      }
      const at = Date.now();
      const list = await batchDocs(head, coll);
      await saveAll(list.map(({ coll: c, doc }) => ({ coll: c, doc: restoredDoc(doc, at) })), user);
      await ctx.saveDoc(coll, restoredDoc(head, at), { actor: user, force: true });
      await refreshVisitStats(s.patientId, user);
      const counts = {};
      counts[coll] = 1;
      list.forEach(({ coll: c }) => { counts[c] = (counts[c] || 0) + 1; });
      return { batch: head.deleteBatch, summary: s, counts, reason: head.deleteReason || '' };
    });
  }

  async function purgeEntry(coll, id, { user }) {
    return exclusive(coll + '/' + id, async () => {
      const head = await loadEntry(coll, id);
      if (!isBatchHead(head) || head.deleteKind !== 'entry') throw httpError(409, head.purged ? 'This entry has already been deleted permanently' : 'Only cancelled entries can be deleted permanently');
      const at = Date.now();
      let filesRemoved = 0;
      const counts = {};
      for (const { coll: c, doc } of await batchDocs(head, coll)) {
        if (c === 'files') filesRemoved += removeFile(doc);
        await ctx.saveDoc(c, tombstone(doc, { at, batch: head.deleteBatch }), { actor: user, force: true });
        counts[c] = (counts[c] || 0) + 1;
      }
      await ctx.saveDoc(coll, tombstone(head, { at, batch: head.deleteBatch }), { actor: user, force: true });
      counts[coll] = (counts[coll] || 0) + 1;
      return { batch: head.deleteBatch, summary: (head.deletion && head.deletion.summary) || {}, counts, filesRemoved, reason: head.deleteReason || '' };
    });
  }

  // ------------------------------------------------------------------ recycle bin & sync guards
  async function recycleBin() {
    const out = [];
    (await ctx.store.listDocs('patients', { includeDeleted: true })).filter(isBatchHead).forEach((d) => out.push(binEntry(d, 'patients')));
    for (const c of ENTRY_COLLS) (await ctx.store.listDocs(c, { includeDeleted: true })).filter((d) => isBatchHead(d) && d.deleteKind === 'entry').forEach((d) => out.push(binEntry(d, c)));
    return out.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  }

  /** Sync guard: was this record removed as part of a batch (patient deleted, entry cancelled)? */
  async function isBatchDeleted(coll, id) {
    if (!id) return false;
    const d = await ctx.store.getDoc(coll, String(id));
    return !!(d && d._deleted && d.deleteBatch);
  }
  const isAdminDeleted = (patientId) => isBatchDeleted('patients', patientId);

  return { impact, moveToBin, restore, purge, entryImpact, cancelEntry, restoreEntry, purgeEntry, recycleBin, isAdminDeleted, isBatchDeleted, summary };
}

module.exports = { createPatientRecords, httpError };
