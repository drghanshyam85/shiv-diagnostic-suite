/*
 * Admin & RBAC API
 *   GET    /api/admin/staff                         list staff (active status, RMC/RPMC numbers)
 *   POST   /api/admin/staff                         create staff member (role, signature, password)
 *   PATCH  /api/admin/staff/:id                     edit staff (role, reg. no, active, overrides)
 *   POST   /api/admin/staff/:id/reset-password      force password reset
 *   POST   /api/admin/staff/:id/signature           upload PNG digital signature / stamp
 *   GET    /api/admin/roles                         roles + permission matrix
 *   PATCH  /api/admin/roles/:roleName/permissions   toggle permissions in real time
 *   POST   /api/admin/roles/reset                   reset to default clinical policy
 *   GET    /api/admin/audit-logs                    filterable audit trail (JSON)
 *   GET    /api/admin/audit-logs.csv                audit trail export
 *   POST   /api/audit                               client-side events (prints, exports, dispatches)
 *   GET    /api/admin/demo-data                     how many first-run demo records remain
 *   POST   /api/admin/demo-data/clear               remove them and restart bill / patient / token numbering
 */
const express = require('express');
const multer = require('multer');
const { PERMISSIONS, ROLES, LEVELS } = require('../../../shared/permissions');
const { DEMO_COLLS, planDemoCleanup, countersAfter } = require('../../../shared/demo-cleanup');

function adminRbacRoutes(ctx, deps) {
  const { users, roles, audit, auth, io } = deps;
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 450 * 1024 } });
  const admin = [auth.verifyToken, auth.requirePermission('admin:manage_roles_and_matrix', 'FULL')];
  // changes to staff, credentials, roles and data need a recently entered password as well
  const adminChange = admin.concat([auth.requireRecentAuth]);

  async function demoPlan() {
    const docs = {};
    for (const c of DEMO_COLLS) docs[c] = await ctx.store.listDocs(c);
    return { docs, plan: planDemoCleanup(docs) };
  }

  router.get('/admin/demo-data', ...admin, async (req, res, next) => {
    try {
      const { plan } = await demoPlan();
      const counts = {};
      Object.entries(plan.remove).forEach(([c, ids]) => { if (ids.length) counts[c] = ids.length; });
      res.json({ total: plan.total, counts, keptPatients: plan.keptPatients.length });
    } catch (e) { next(e); }
  });

  router.post('/admin/demo-data/clear', ...adminChange, async (req, res, next) => {
    try {
      const { docs, plan } = await demoPlan();
      const removed = {};
      const now = Date.now();
      for (const [c, ids] of Object.entries(plan.remove)) {
        const byId = new Map((docs[c] || []).map((d) => [d.id, d]));
        for (const id of ids) {
          await ctx.saveDoc(c, Object.assign({}, byId.get(id), { _deleted: true, updatedAt: now }), { actor: req.user, force: true });
        }
        if (ids.length) removed[c] = ids.length;
      }
      const counters = countersAfter(docs, plan.remove, await ctx.store.allCounters());
      for (const [k, v] of Object.entries(counters)) await ctx.store.resetCounter(k, v);
      await audit.log(req, 'admin:demo_data_cleared', 'clinic', { removed, keptPatients: plan.keptPatients.length, counters: Object.keys(counters).length });
      io.emit('notify', { type: 'info', text: 'Demo records removed by ' + req.user.name + ' — numbering restarted' });
      res.json({ ok: true, removed, total: plan.total, keptPatients: plan.keptPatients.length, counters });
    } catch (e) { next(e); }
  });

  router.get('/admin/staff', auth.verifyToken, auth.requirePermission('admin:manage_roles_and_matrix', 'READ'), async (req, res, next) => {
    try { res.json({ staff: await users.list() }); } catch (e) { next(e); }
  });

  router.post('/admin/staff', ...adminChange, async (req, res, next) => {
    try {
      const created = await users.create(req.body || {}, req.user);
      await audit.log(req, 'admin:staff_created', 'users/' + created.id, { role: created.role, name: created.name });
      res.status(201).json({ user: created });
    } catch (e) { next(e); }
  });

  router.patch('/admin/staff/:id', ...adminChange, async (req, res, next) => {
    try {
      const before = await users.get(req.params.id);
      if (req.params.id === req.user.id && req.body && (req.body.isActive === false || (req.body.role && req.body.role !== 'SUPER_ADMIN_RADIOLOGIST'))) {
        return res.status(400).json({ error: 'You cannot deactivate or demote your own Super Admin account' });
      }
      const updated = await users.update(req.params.id, req.body || {}, req.user);
      auth.invalidate(req.params.id);
      const changes = {};
      for (const k of Object.keys(req.body || {})) if (k !== 'digitalSignatureUrl') changes[k] = { from: before ? before[k] : undefined, to: req.body[k] };
      await audit.log(req, 'admin:staff_updated', 'users/' + req.params.id, { changes, signatureChanged: 'digitalSignatureUrl' in (req.body || {}) });
      res.json({ user: updated });
    } catch (e) { next(e); }
  });

  router.post('/admin/staff/:id/reset-password', ...adminChange, async (req, res, next) => {
    try {
      const pwd = (req.body && req.body.password) || Math.random().toString(36).slice(2, 8);
      await users.setPassword(req.params.id, pwd, req.user, { forceChange: true });
      auth.invalidate(req.params.id);
      await audit.log(req, 'admin:password_reset', 'users/' + req.params.id, {});
      res.json({ ok: true, temporaryPassword: pwd });
    } catch (e) { next(e); }
  });

  router.post('/admin/staff/:id/signature', ...adminChange, upload.single('signature'), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: signature)' });
      if (!/^image\/(png|jpeg|webp)$/.test(req.file.mimetype)) return res.status(400).json({ error: 'Signature must be PNG, JPEG or WebP' });
      const url = 'data:' + req.file.mimetype + ';base64,' + req.file.buffer.toString('base64');
      const updated = await users.update(req.params.id, { digitalSignatureUrl: url }, req.user);
      await audit.log(req, 'admin:signature_uploaded', 'users/' + req.params.id, { bytes: req.file.size });
      res.json({ user: updated });
    } catch (e) { next(e); }
  });

  router.get('/admin/roles', auth.verifyToken, async (req, res, next) => {
    try { res.json({ roles: await roles.list(), permissions: PERMISSIONS, levels: LEVELS, roleMeta: ROLES }); } catch (e) { next(e); }
  });

  router.patch('/admin/roles/:roleName/permissions', ...adminChange, async (req, res, next) => {
    try {
      const before = await roles.get(req.params.roleName);
      const updated = await roles.updatePermissions(req.params.roleName, (req.body && req.body.permissions) || {}, req.user);
      auth.invalidate();
      const diff = {};
      for (const [k, v] of Object.entries(updated.permissions)) if (!before || before.permissions[k] !== v) diff[k] = { from: before ? before.permissions[k] : null, to: v };
      await audit.log(req, 'admin:matrix_changed', 'roles/' + req.params.roleName, { diff });
      if (io) io.emit('notify', { type: 'info', text: 'Permission matrix updated for ' + req.params.roleName });
      res.json({ role: updated });
    } catch (e) { next(e); }
  });

  router.post('/admin/roles/reset', ...adminChange, async (req, res, next) => {
    try {
      const list = await roles.resetDefaults(req.user);
      auth.invalidate();
      await audit.log(req, 'admin:matrix_reset_default', 'roles/*', {});
      res.json({ roles: list });
    } catch (e) { next(e); }
  });

  const auditGuard = [auth.verifyToken, auth.requirePermission('admin:view_audit_logs', 'READ')];
  router.get('/admin/audit-logs', ...auditGuard, async (req, res, next) => {
    try { res.json(await audit.query(req.query)); } catch (e) { next(e); }
  });

  router.get('/admin/audit-logs.csv', ...auditGuard, auth.requireRecentAuth, async (req, res, next) => {
    try {
      const { rows } = await audit.query(Object.assign({}, req.query, { limit: 100000 }));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="ssdc-audit-trail.csv"');
      await audit.log(req, 'admin:audit_exported', 'audit_logs', { rows: rows.length });
      res.send(audit.toCSV(rows));
    } catch (e) { next(e); }
  });

  // Client-originated audit events (prints, exports, dispatches, workstation handoffs)
  router.post('/audit', auth.verifyToken, async (req, res, next) => {
    try {
      const { action, targetResource, metadata } = req.body || {};
      if (!action || !/^[a-z_]+:[a-z_]+$/i.test(action)) return res.status(400).json({ error: 'action must look like "resource:verb"' });
      const entry = await audit.log(req, action, targetResource || '', metadata || {});
      res.json({ entry });
    } catch (e) { next(e); }
  });

  return router;
}

module.exports = { adminRbacRoutes };
