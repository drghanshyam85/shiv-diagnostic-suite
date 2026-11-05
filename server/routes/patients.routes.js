/*
 * Deleting patient records and cancelling entries — Registration, Dashboard, Billing Desk, the live queue,
 * the patient history and Admin Console → Patient records.
 *
 * Delete a patient (patient → recycle bin with every linked record):
 *   front desk (patient:register_and_edit) while nothing has been done for the patient — no test performed,
 *   no money kept, nothing sent — with a reason; otherwise patient:delete_records (Read: see the recycle bin ·
 *   Draft: delete & restore · Full: also delete permanently) with the Reg. ID typed and the password.
 * Cancel an entry (the patient does not go ahead with the tests): front desk or billing desk, with a reason;
 *   when money was collected also billing:modify_discounts_refunds (the money goes back to the patient).
 *
 *   GET  /api/patients/recycle-bin                        deleted patients + cancelled entries        delete_records READ
 *   GET  /api/patients/:id/deletion-impact                records that would go, holds, who may       front desk / delete_records
 *   POST /api/patients/:id/delete   { reason, confirm }   patient + linked records → recycle bin      front desk (fresh) / delete_records (+ password)
 *   POST /api/patients/:id/restore                        bring the batch back                        delete_records, or undo within 15 min
 *   POST /api/patients/:id/purge    { confirm }           delete permanently                          delete_records FULL + password
 *   GET  /api/entries/:coll/:id/cancel-impact             coll = visits | invoices                    front desk / billing
 *   POST /api/entries/:coll/:id/cancel   { reason }       visit (or bill) + linked records cancelled  front desk / billing (+ refunds when paid)
 *   POST /api/entries/:coll/:id/restore                   undo a cancellation                         front desk / billing
 *   POST /api/entries/:coll/:id/purge                     delete a cancelled entry permanently        delete_records FULL + password
 */
'use strict';

const express = require('express');
const { describeCounts } = require('../../shared/patient-records');

const KEY = 'patient:delete_records';

function patientsRoutes(ctx, deps) {
  const { auth, audit, records, io } = deps;
  const router = express.Router();
  const anyOf = (...pairs) => (req, res, next) => {
    if (pairs.some(([k, l]) => req.user.can(k, l))) return next();
    return res.status(403).json({ error: 'Forbidden: requires ' + pairs.map(([k, l]) => k + ' (' + l + ')').join(' or '), code: 'PERMISSION_FORBIDDEN' });
  };
  const desk = [auth.verifyToken, anyOf(['patient:register_and_edit', 'FULL'], [KEY, 'DRAFT'])];
  const entryDesk = [auth.verifyToken, anyOf(['patient:register_and_edit', 'FULL'], ['billing:create_invoice', 'FULL'], [KEY, 'DRAFT'])];
  const fullAdmin = [auth.verifyToken, auth.requirePermission(KEY, 'FULL'), auth.requireRecentAuth];
  const fail = (res, next, e) => {
    if (e && e.status && e.status < 500) return res.status(e.status).json({ error: e.message, code: e.code, minutes: e.minutes, holds: e.holds, blocked: !!e.blocked, reasons: e.reasons });
    return next(e);
  };
  const notify = (text) => { if (io) io.emit('notify', { type: 'info', text }); };
  const name = (s) => [s.title, s.name].filter(Boolean).join(' ');
  const entryLabel = (s) => (s.token ? 'Token ' + s.token : s.invoiceNos && s.invoiceNos[0] ? 'Bill ' + s.invoiceNos[0] : 'Entry');
  const verb = (coll) => (coll === 'visits' ? 'visit' : 'invoice');
  async function recent(req) {
    const sec = await auth.security();
    return { recentAuth: !sec.reauthMinutes || Date.now() - (req.user.authAt || 0) <= sec.reauthMinutes * 60000, reauthMinutes: sec.reauthMinutes };
  }

  // ---------------------------------------------------------------- patients
  router.get('/patients/recycle-bin', auth.verifyToken, auth.requirePermission(KEY, 'READ'), async (req, res, next) => {
    try { res.json({ entries: await records.recycleBin(), canDelete: req.user.can(KEY, 'DRAFT'), canPurge: req.user.can(KEY, 'FULL') }); } catch (e) { fail(res, next, e); }
  });

  router.get('/patients/:id/deletion-impact', ...desk, async (req, res, next) => {
    try { res.json(await records.impact(req.params.id, req.user)); } catch (e) { fail(res, next, e); }
  });

  router.post('/patients/:id/delete', ...desk, async (req, res, next) => {
    const body = req.body || {};
    try {
      const r = await records.moveToBin(req.params.id, Object.assign({ reason: body.reason, confirm: body.confirm, user: req.user }, await recent(req)));
      await audit.log(req, 'patient:moved_to_recycle_bin', 'patients/' + req.params.id, {
        regId: r.patient.regId, name: name(r.patient), reason: String(body.reason || '').trim(), batch: r.batch, mode: r.mode,
        records: describeCounts(r.counts), collected: r.money.collected, signedReports: r.signed.reports + r.signed.labReports
      });
      notify('Patient record ' + (r.patient.regId || '') + ' moved to the recycle bin by ' + req.user.name);
      res.json(r);
    } catch (e) {
      if (e && e.blocked) await audit.log(req, 'patient:delete_blocked', 'patients/' + req.params.id, { regId: e.regId, hold: (e.holds || []).map((h) => h.code).join(',') }).catch(() => {});
      fail(res, next, e);
    }
  });

  router.post('/patients/:id/restore', ...desk, async (req, res, next) => {
    try {
      const r = await records.restore(req.params.id, { user: req.user });
      await audit.log(req, 'patient:restored', 'patients/' + req.params.id, { regId: r.patient.regId, name: name(r.patient), batch: r.batch, records: describeCounts(r.counts), undo: r.undo });
      notify('Patient record ' + (r.patient.regId || '') + ' restored by ' + req.user.name);
      res.json(r);
    } catch (e) { fail(res, next, e); }
  });

  router.post('/patients/:id/purge', ...fullAdmin, async (req, res, next) => {
    try {
      const r = await records.purge(req.params.id, { confirm: (req.body || {}).confirm, user: req.user });
      // the audit trail keeps who removed which Reg. ID and why — not the patient's name or details
      await audit.log(req, 'patient:purged', 'patients/' + req.params.id, { regId: r.regId, batch: r.batch, records: describeCounts(r.counts), filesRemoved: r.filesRemoved, reason: r.reason });
      res.json(r);
    } catch (e) { fail(res, next, e); }
  });

  // ---------------------------------------------------------------- entries (visit or bill without a visit)
  const okColl = (req, res, next) => (['visits', 'invoices'].includes(req.params.coll) ? next() : res.status(400).json({ error: 'Entries are visits or invoices' }));

  router.get('/entries/:coll/:id/cancel-impact', okColl, ...entryDesk, async (req, res, next) => {
    try { res.json(await records.entryImpact(req.params.coll, req.params.id, req.user)); } catch (e) { fail(res, next, e); }
  });

  router.post('/entries/:coll/:id/cancel', okColl, ...entryDesk, async (req, res, next) => {
    try {
      const reason = String((req.body || {}).reason || '').trim();
      const r = await records.cancelEntry(req.params.coll, req.params.id, { reason, user: req.user });
      const s = r.summary;
      await audit.log(req, verb(r.root.coll) + ':cancelled', r.root.coll + '/' + r.root.id, {
        patient: s.patientName, regId: s.regId, token: s.token, tests: s.tests.slice(0, 20), invoiceNos: s.invoiceNos, net: s.net, refunded: r.money.collected,
        reason, batch: r.batch, records: describeCounts(r.counts)
      });
      notify(entryLabel(s) + ' cancelled by ' + req.user.name + (r.money.collected > 0 ? ' · ₹' + r.money.collected + ' to be returned' : ''));
      res.json(r);
    } catch (e) { fail(res, next, e); }
  });

  router.post('/entries/:coll/:id/restore', okColl, ...entryDesk, async (req, res, next) => {
    try {
      const r = await records.restoreEntry(req.params.coll, req.params.id, { user: req.user });
      await audit.log(req, verb(req.params.coll) + ':restored', req.params.coll + '/' + req.params.id, { patient: r.summary.patientName, token: r.summary.token, invoiceNos: r.summary.invoiceNos, batch: r.batch, records: describeCounts(r.counts) });
      notify(entryLabel(r.summary) + ' restored by ' + req.user.name);
      res.json(r);
    } catch (e) { fail(res, next, e); }
  });

  router.post('/entries/:coll/:id/purge', okColl, ...fullAdmin, async (req, res, next) => {
    try {
      const r = await records.purgeEntry(req.params.coll, req.params.id, { user: req.user });
      await audit.log(req, verb(req.params.coll) + ':purged', req.params.coll + '/' + req.params.id, { token: r.summary.token, invoiceNos: r.summary.invoiceNos, batch: r.batch, records: describeCounts(r.counts), filesRemoved: r.filesRemoved, reason: r.reason });
      res.json(r);
    } catch (e) { fail(res, next, e); }
  });

  return router;
}

module.exports = { patientsRoutes };
