/*
 * Images: the server-side image inbox (cloud-synced / shared folder) status, manual scan, and the
 * attach / dismiss actions workstations use from the report's Images tab.
 */
const express = require('express');

function imagesRoutes(ctx, { auth, audit, inbox }) {
  const router = express.Router();

  router.get('/images/inbox', auth.verifyToken, (req, res) => res.json(inbox.status()));

  router.post('/images/inbox/scan', auth.verifyToken, auth.requirePermission('usg:create_and_edit_report', 'DRAFT'), async (req, res, next) => {
    try { res.json(await inbox.scanNow()); } catch (e) { next(e); }
  });

  router.post('/images/inbox/:id/attach', auth.verifyToken, auth.requirePermission('usg:create_and_edit_report', 'DRAFT'), async (req, res, next) => {
    try {
      const doc = await inbox.attach(req.params.id, (req.body && req.body.reportId) || '', req.user);
      await audit.log(req, 'images:inbox_attached', 'files/' + doc.id, { name: doc.name, reportId: doc.attachedTo && doc.attachedTo.reportId });
      res.json({ ok: true, file: doc });
    } catch (e) { next(e); }
  });

  router.post('/images/inbox/:id/dismiss', auth.verifyToken, auth.requirePermission('usg:create_and_edit_report', 'DRAFT'), async (req, res, next) => {
    try {
      const doc = await inbox.dismiss(req.params.id, req.user);
      await audit.log(req, 'images:inbox_dismissed', 'files/' + doc.id, { name: doc.name });
      res.json({ ok: true, file: doc });
    } catch (e) { next(e); }
  });

  router.post('/images/inbox/:id/restore', auth.verifyToken, auth.requirePermission('usg:create_and_edit_report', 'DRAFT'), async (req, res, next) => {
    try { res.json({ ok: true, file: await inbox.restore(req.params.id, req.user) }); } catch (e) { next(e); }
  });

  return router;
}

module.exports = { imagesRoutes };
