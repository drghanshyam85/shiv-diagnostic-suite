/*
 * Deleting patient records — Admin Console → Patient records, and the patient history drawer.
 * Needs the permission patient:delete_records (by default only the Super Admin radiologist):
 *   READ  view the recycle bin · DRAFT  move to the recycle bin and restore · FULL  also delete permanently.
 * Every change also needs the password entered recently and is written to the audit trail.
 *
 *   GET  /api/patients/recycle-bin                       deleted patients that can be restored        READ
 *   GET  /api/patients/:id/deletion-impact               records that would go, legal holds, warnings  DRAFT
 *   POST /api/patients/:id/delete   { reason, confirm }  patient + linked records → recycle bin        DRAFT + password
 *   POST /api/patients/:id/restore                       bring the whole batch back                    DRAFT + password
 *   POST /api/patients/:id/purge    { confirm }          delete permanently (no patient data remains)  FULL + password
 */
'use strict';

const express = require('express');
const { describeCounts } = require('../../shared/patient-records');

const KEY = 'patient:delete_records';

function patientsRoutes(ctx, deps) {
  const { auth, audit, records, io } = deps;
  const router = express.Router();
  const guard = (level) => [auth.verifyToken, auth.requirePermission(KEY, level)];
  const change = (level) => guard(level).concat([auth.requireRecentAuth]);
  const fail = (res, next, e) => {
    if (e && e.status && e.status < 500) return res.status(e.status).json({ error: e.message, holds: e.holds, blocked: !!e.blocked });
    return next(e);
  };
  const notify = (text) => { if (io) io.emit('notify', { type: 'info', text }); };

  router.get('/patients/recycle-bin', ...guard('READ'), async (req, res, next) => {
    try { res.json({ entries: await records.recycleBin(), canDelete: req.user.can(KEY, 'DRAFT'), canPurge: req.user.can(KEY, 'FULL') }); } catch (e) { fail(res, next, e); }
  });

  router.get('/patients/:id/deletion-impact', ...guard('DRAFT'), async (req, res, next) => {
    try { res.json(await records.impact(req.params.id)); } catch (e) { fail(res, next, e); }
  });

  router.post('/patients/:id/delete', ...change('DRAFT'), async (req, res, next) => {
    const body = req.body || {};
    try {
      const r = await records.moveToBin(req.params.id, { reason: body.reason, confirm: body.confirm, user: req.user });
      await audit.log(req, 'patient:moved_to_recycle_bin', 'patients/' + req.params.id, {
        regId: r.patient.regId, name: [r.patient.title, r.patient.name].filter(Boolean).join(' '), reason: String(body.reason || '').trim(), batch: r.batch,
        records: describeCounts(r.counts), collected: r.money.collected, signedReports: r.signed.reports + r.signed.labReports
      });
      notify('Patient record ' + (r.patient.regId || '') + ' moved to the recycle bin by ' + req.user.name);
      res.json(r);
    } catch (e) {
      if (e && e.blocked) await audit.log(req, 'patient:delete_blocked', 'patients/' + req.params.id, { regId: e.regId, hold: (e.holds || []).map((h) => h.code).join(',') }).catch(() => {});
      fail(res, next, e);
    }
  });

  router.post('/patients/:id/restore', ...change('DRAFT'), async (req, res, next) => {
    try {
      const r = await records.restore(req.params.id, { user: req.user });
      await audit.log(req, 'patient:restored', 'patients/' + req.params.id, { regId: r.patient.regId, name: [r.patient.title, r.patient.name].filter(Boolean).join(' '), batch: r.batch, records: describeCounts(r.counts) });
      notify('Patient record ' + (r.patient.regId || '') + ' restored by ' + req.user.name);
      res.json(r);
    } catch (e) { fail(res, next, e); }
  });

  router.post('/patients/:id/purge', ...change('FULL'), async (req, res, next) => {
    try {
      const r = await records.purge(req.params.id, { confirm: (req.body || {}).confirm, user: req.user });
      // the audit trail keeps who removed which Reg. ID and why — not the patient's name or details
      await audit.log(req, 'patient:purged', 'patients/' + req.params.id, { regId: r.regId, batch: r.batch, records: describeCounts(r.counts), filesRemoved: r.filesRemoved, reason: r.reason });
      res.json(r);
    } catch (e) { fail(res, next, e); }
  });

  return router;
}

module.exports = { patientsRoutes };
