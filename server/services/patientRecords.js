/*
 * Deleting patient records on the clinic server (administrators only).
 *
 *   impact(id)                    what would be removed, what blocks it (PC-PNDT legal hold), what to warn about
 *   moveToBin(id, { reason, confirm, user })   the patient and every linked record → recycle bin (one batch)
 *   recycleBin()                  deleted patients that can still be restored or deleted permanently
 *   restore(id, { user })         bring the whole batch back exactly as it was
 *   purge(id, { confirm, user })  delete permanently: records become tombstones without patient data and the
 *                                 stored files are removed from the disk
 *
 * Every write goes through ctx.saveDoc(), so every workstation, the TV queue, the cloud mirror and the
 * event log follow at once. Workstations only ever receive bare tombstones of these records
 * (context.sanitizeForClient), and the sync API refuses to bring them back (sync.routes.js) — only
 * restore() can. The batch's record list is kept on the deleted patient document itself.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  LINKED_COLLS, MIN_REASON, planPatientDeletion, markDeleted, restoredDoc, tombstone, inRecycleBin, binEntry, confirmMatches, confirmWord
} = require('../../shared/patient-records');

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
  const busy = new Set(); // one deletion / restore / purge at a time per patient

  async function load(id) {
    const p = await ctx.store.getDoc('patients', String(id || ''));
    if (!p) throw httpError(404, 'Patient not found');
    return p;
  }

  async function linkedDocs() {
    const docs = {};
    for (const c of LINKED_COLLS) docs[c] = await ctx.store.listDocs(c);
    return docs;
  }

  async function exclusive(id, fn) {
    if (busy.has(id)) throw httpError(409, 'This patient record is already being changed — try again in a moment');
    busy.add(id);
    try { return await fn(); } finally { busy.delete(id); }
  }

  async function planFor(p) {
    const docs = await linkedDocs();
    return { docs, plan: planPatientDeletion(p, docs, { todayKey: clinicDay(await ctx.getSettings()) }) };
  }

  async function impact(id) {
    const p = await load(id);
    if (p._deleted) throw httpError(409, inRecycleBin(p) ? 'This patient is already in the recycle bin' : 'This patient record has been deleted');
    const { plan } = await planFor(p);
    return { patient: summary(p), plan };
  }

  async function moveToBin(id, { reason, confirm, user }) {
    const why = String(reason || '').trim().slice(0, 500);
    if (why.length < MIN_REASON) throw httpError(400, 'Give the reason for deleting this record (at least ' + MIN_REASON + ' characters)');
    return exclusive(id, async () => {
      const p = await load(id);
      if (p._deleted) throw httpError(409, inRecycleBin(p) ? 'This patient is already in the recycle bin' : 'This patient record has been deleted');
      if (!confirmMatches(p, confirm)) throw httpError(400, 'Type ' + (p.regId ? 'the Reg. ID ' + p.regId : 'the patient’s name') + ' to confirm');
      const { docs, plan } = await planFor(p);
      if (plan.holds.length) throw httpError(409, plan.holds[0].text, { holds: plan.holds, blocked: true, regId: p.regId || '' });
      const meta = { batch: 'del_' + crypto.randomBytes(8).toString('hex'), at: Date.now(), by: user.id, byName: user.name, reason: why };
      const actor = user;
      // linked records first, the patient last: its document carries the batch (the recycle-bin entry)
      for (const c of LINKED_COLLS) {
        const byId = new Map((docs[c] || []).map((d) => [d.id, d]));
        for (const docId of plan.items[c]) {
          const cur = byId.get(docId);
          if (cur) await ctx.saveDoc(c, markDeleted(cur, meta), { actor, force: true });
        }
      }
      const deletion = { items: plan.items, counts: plan.counts, total: plan.total, money: plan.money, signed: plan.signed, warnings: plan.warnings.map((w) => w.code) };
      await ctx.saveDoc('patients', Object.assign(markDeleted(p, meta), { deletion }), { actor, force: true });
      return { batch: meta.batch, deletedAt: meta.at, patient: summary(p), counts: plan.counts, total: plan.total, money: plan.money, signed: plan.signed, warnings: plan.warnings };
    });
  }

  async function recycleBin() {
    const all = await ctx.store.listDocs('patients', { includeDeleted: true });
    return all.filter(inRecycleBin).map(binEntry).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  }

  /** The batch's records as they are now (only those still deleted by this batch). */
  async function batchDocs(p) {
    const items = (p.deletion && p.deletion.items) || {};
    const out = [];
    for (const c of LINKED_COLLS) {
      for (const docId of items[c] || []) {
        const cur = await ctx.store.getDoc(c, docId);
        if (cur && cur._deleted && !cur.purged && cur.deleteBatch === p.deleteBatch) out.push({ coll: c, doc: cur });
      }
    }
    return out;
  }

  async function restore(id, { user }) {
    return exclusive(id, async () => {
      const p = await load(id);
      if (!inRecycleBin(p)) throw httpError(409, p.purged ? 'This patient record was deleted permanently and cannot be restored' : 'This patient is not in the recycle bin');
      const at = Date.now();
      const counts = {};
      for (const { coll, doc } of await batchDocs(p)) {
        await ctx.saveDoc(coll, restoredDoc(doc, at), { actor: user, force: true });
        counts[coll] = (counts[coll] || 0) + 1;
      }
      await ctx.saveDoc('patients', restoredDoc(p, at), { actor: user, force: true });
      counts.patients = 1;
      return { batch: p.deleteBatch, patient: summary(p), counts, deletedAt: p.deletedAt, deletedByName: p.deletedByName || '', reason: p.deleteReason || '' };
    });
  }

  async function purge(id, { confirm, user }) {
    return exclusive(id, async () => {
      const p = await load(id);
      if (!inRecycleBin(p)) throw httpError(409, p.purged ? 'This patient record has already been deleted permanently' : 'Only records in the recycle bin can be deleted permanently');
      if (!confirmMatches(p, confirm)) throw httpError(400, 'Type ' + (p.regId ? 'the Reg. ID ' + p.regId : 'the patient’s name') + ' to confirm');
      const at = Date.now();
      const counts = {};
      let filesRemoved = 0;
      for (const { coll, doc } of await batchDocs(p)) {
        if (coll === 'files' && doc.storage !== 'local') {
          const file = path.join(ctx.filesDir, path.basename(String(doc.id)));
          try { if (fs.existsSync(file)) { fs.rmSync(file, { force: true }); filesRemoved++; } } catch (e) { console.warn('[patients] could not remove file', doc.id, e.message); }
        }
        await ctx.saveDoc(coll, tombstone(doc, { at, batch: p.deleteBatch }), { actor: user, force: true });
        counts[coll] = (counts[coll] || 0) + 1;
      }
      await ctx.saveDoc('patients', tombstone(p, { at, batch: p.deleteBatch }), { actor: user, force: true });
      counts.patients = 1;
      return { batch: p.deleteBatch, regId: p.regId || '', counts, filesRemoved, deletedAt: p.deletedAt, reason: p.deleteReason || '' };
    });
  }

  /** Sync guard: is this patient in the recycle bin or deleted permanently by an administrator? */
  async function isAdminDeleted(patientId) {
    if (!patientId) return false;
    const p = await ctx.store.getDoc('patients', String(patientId));
    return !!(p && p._deleted && p.deleteBatch);
  }

  return { impact, moveToBin, recycleBin, restore, purge, isAdminDeleted, summary };
}

module.exports = { createPatientRecords, httpError };
