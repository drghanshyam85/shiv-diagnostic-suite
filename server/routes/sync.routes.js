/*
 * Multi-workstation sync API (local-first clients, server-ordered change feed).
 *   GET  /api/sync/pull?since=<seq>       change feed after a sequence number
 *   POST /api/sync/push {docs:[{coll,doc}]} last-write-wins upserts with RBAC validation
 *   POST /api/counter/next {key, min}      atomic counters (invoice no, tokens, Form F S.No.)
 *   GET  /api/counter/:key                 peek a counter
 *   POST /api/reports/:coll/:id/unlock     Super Admin unlock of a SIGNED_FINAL report (audit reason)
 */
const express = require('express');
const { checkReportLock, changedKeys } = require('../rbac/middleware/authRbac');

const SYNC_COLLECTIONS = new Set([
  'settings', 'doctors', 'tests', 'patients', 'visits', 'invoices', 'expenses', 'floats', 'denoms',
  'formf', 'reports', 'labReports', 'dictionary', 'files', 'inbox', 'dispatchLog', 'msgTemplates',
  'statements', 'macros', 'categories', 'users', 'roles'
]);
const ADMIN_ONLY_VIA_API = new Set(['users', 'roles']);
const STATUS_ONLY_KEYS = ['status', 'statusLog', 'calls', 'reportId', 'labReportId', 'formFId', 'updatedAt', 'updatedBy', '_rev', '_dev'];
const DISPATCH_KEYS = ['sent', 'sentLog', 'dispatch', 'printLog', 'printedAt', 'shareId', 'cloud', 'updatedAt', 'updatedBy', '_rev', '_dev'];

function onlyKeys(changed, allowed) { return changed.every((k) => allowed.includes(k)); }

function syncRoutes(ctx, deps) {
  const { auth, audit, users } = deps;
  const { store } = ctx;
  const router = express.Router();
  let testsCache = { at: 0, map: null };

  async function testsMap() {
    if (testsCache.map && Date.now() - testsCache.at < 10000) return testsCache.map;
    const m = {};
    (await store.listDocs('tests')).forEach((t) => { m[t.id] = t; });
    testsCache = { at: Date.now(), map: m };
    return m;
  }

  /** Returns null when allowed, or an error string. May push follow-up audit entries into `notes`. */
  async function validate(coll, incoming, existing, user, notes) {
    const can = (k, l) => user.can(k, l || 'FULL');
    const changed = changedKeys(existing || {}, incoming);
    const deleting = !!incoming._deleted && !(existing && existing._deleted);

    switch (coll) {
      case 'settings':
        return can('settings:manage_clinic_and_integrations') ? null : 'Only the administrator can change clinic settings';
      case 'tests': {
        if (!can('tariff:manage_rate_list')) return 'Requires tariff:manage_rate_list';
        return null;
      }
      case 'doctors': {
        const sharesChanged = existing ? changed.includes('shares') : Object.values(incoming.shares || {}).some((v) => Number(v) > 0);
        if (sharesChanged && !can('finance:doctor_sharing_and_analytics')) {
          if (!existing && can('patient:register_and_edit')) { incoming.shares = { USG: 0, LAB: 0, XRAY: 0, ECG: 0 }; return null; }
          return 'Changing doctor share % requires finance:doctor_sharing_and_analytics';
        }
        return can('patient:register_and_edit') || can('finance:doctor_sharing_and_analytics') ? null : 'Requires patient:register_and_edit';
      }
      case 'patients': {
        if (!can('patient:register_and_edit')) return 'Requires patient:register_and_edit';
        // identity changes and deletions of a patient record are sensitive: keep who / what in the audit trail
        if (deleting) notes.push(['patient:deleted', { regId: existing && existing.regId, name: existing && existing.name }]);
        else if (existing) {
          const ID_KEYS = ['name', 'title', 'age', 'ageUnit', 'gender', 'mobile', 'aadhaar', 'guardianName', 'relation', 'address', 'dob'];
          const idChanged = changed.filter((k) => ID_KEYS.includes(k));
          if (idChanged.length) notes.push(['patient:identity_edited', { regId: incoming.regId, fields: idChanged }]);
        }
        return null;
      }
      case 'visits':
        if (can('patient:register_and_edit')) return null;
        if (existing && onlyKeys(changed, STATUS_ONLY_KEYS) && user.role !== 'AUDITOR_VIEW_ONLY') return null;
        return 'Requires patient:register_and_edit';
      case 'invoices': {
        if (deleting) {
          if (!can('billing:modify_discounts_refunds')) return 'Cancelling/deleting invoices requires billing:modify_discounts_refunds';
          notes.push(['invoice:deleted', { invoiceNo: existing && existing.invoiceNo }]);
          return null;
        }
        if (existing && onlyKeys(changed, DISPATCH_KEYS) && can('print:dispatch_signed_reports', 'DRAFT')) return null;
        if (!can('billing:create_invoice')) return 'Requires billing:create_invoice';
        const prevDisc = existing ? Number(existing.discountAmount || 0) : 0;
        const disc = Number(incoming.discountAmount || 0);
        if (disc !== prevDisc && disc > 0 && !can('billing:modify_discounts_refunds')) return 'Discounts / concessions require billing:modify_discounts_refunds';
        const refunds = (incoming.payments || []).filter((p) => Number(p.amount) < 0);
        const prevRefunds = ((existing && existing.payments) || []).filter((p) => Number(p.amount) < 0);
        if (refunds.length > prevRefunds.length) {
          if (!can('billing:modify_discounts_refunds')) return 'Refunds require billing:modify_discounts_refunds';
          notes.push(['invoice:refund', { invoiceNo: incoming.invoiceNo, amount: refunds[refunds.length - 1].amount }]);
        }
        if (incoming.billingType === 'umid') {
          if (!can('umid:verify_and_generate_claim')) return 'UMID cashless billing requires umid:verify_and_generate_claim';
          const settings = await ctx.getSettings();
          if (settings.compliance && settings.compliance.umidRateLock && user.role !== 'SUPER_ADMIN_RADIOLOGIST') {
            const tm = await testsMap();
            const bad = (incoming.items || []).find((it) => tm[it.testId] && Number(it.rate) !== Number(tm[it.testId].tariff.cghsRate));
            if (bad) return 'NWR UMID Cashless Rate Lock: ' + bad.name + ' must be billed at the CGHS rate ₹' + tm[bad.testId].tariff.cghsRate;
          }
        }
        if (!existing) notes.push(['invoice:created', { invoiceNo: incoming.invoiceNo, net: incoming.net, discount: disc }]);
        else if (disc !== prevDisc) notes.push(['invoice:discount_changed', { invoiceNo: incoming.invoiceNo, from: prevDisc, to: disc }]);
        return null;
      }
      case 'expenses': case 'floats': case 'denoms':
        return can('cashbook:manage_daily_register') ? null : 'Requires cashbook:manage_daily_register';
      case 'statements':
        return can('finance:doctor_sharing_and_analytics') ? null : 'Requires finance:doctor_sharing_and_analytics';
      case 'formf': {
        if (!can('pcpndt:manage_form_f_register', 'DRAFT')) return 'Requires pcpndt:manage_form_f_register';
        const finalizing = incoming.status === 'FINAL' && (!existing || existing.status !== 'FINAL');
        if (finalizing && !can('pcpndt:manage_form_f_register')) return 'Finalising Form F requires FULL access (Draft-only role)';
        if (existing && existing.status === 'FINAL' && !deleting && changed.some((k) => !DISPATCH_KEYS.includes(k))) {
          if (!can('pcpndt:manage_form_f_register')) return 'Form F is FINAL; only the radiologist can amend it';
          notes.push(['formf:amended', { sno: incoming.sno, changed: changed.slice(0, 10) }]);
        }
        if (deleting) {
          if (user.role !== 'SUPER_ADMIN_RADIOLOGIST') return 'Only the Super Admin may delete a Form F record';
          notes.push(['formf:deleted', { sno: existing && existing.sno }]);
        }
        if (finalizing) notes.push(['formf:finalized', { sno: incoming.sno, patient: incoming.data && incoming.data.patientName }]);
        return null;
      }
      case 'reports': {
        const lockErr = checkReportLock(existing, incoming);
        if (lockErr) return lockErr;
        if (existing && onlyKeys(changed, DISPATCH_KEYS)) return can('print:dispatch_signed_reports', 'DRAFT') ? null : 'Requires print:dispatch_signed_reports';
        if (!can('usg:create_and_edit_report')) return 'Requires usg:create_and_edit_report';
        if (incoming.status === 'SIGNED_FINAL' && (!existing || existing.status !== 'SIGNED_FINAL')) {
          if (!can('usg:sign_and_lock_report')) return 'Requires usg:sign_and_lock_report';
          notes.push(['report:signed', { patient: incoming.demographics && incoming.demographics.name, version: incoming.version || 1 }]);
        }
        if (deleting) notes.push(['report:deleted', {}]);
        return null;
      }
      case 'labReports': {
        const lockErr = checkReportLock(existing, incoming);
        if (lockErr) return lockErr;
        if (existing && onlyKeys(changed, DISPATCH_KEYS)) return can('print:dispatch_signed_reports', 'DRAFT') ? null : 'Requires print:dispatch_signed_reports';
        if (!can('lab:enter_sample_values', 'DRAFT') && !can('lab:verify_and_sign_report')) {
          // Reception may create the pending lab worklist entry
          if (!existing && incoming.status === 'PENDING' && can('patient:register_and_edit')) return null;
          return 'Requires lab:enter_sample_values';
        }
        if (deleting) notes.push(['lab:deleted', { sampleId: existing && existing.sampleId, status: existing && existing.status }]);
        if (incoming.status === 'SIGNED_FINAL' && (!existing || existing.status !== 'SIGNED_FINAL')) {
          if (!can('lab:verify_and_sign_report')) return 'Requires lab:verify_and_sign_report (pathologist)';
          const settings = await ctx.getSettings();
          if (!settings.compliance || settings.compliance.dualSignatoryPathology !== false) {
            if (!incoming.enteredBy) return 'Dual-signatory compliance: results must be entered by a lab technician before verification';
            if (incoming.enteredBy === user.id) return 'Dual-signatory compliance: the verifying pathologist must differ from the technician who entered the results';
          }
          if (incoming.verifiedBy && incoming.verifiedBy !== user.id) return 'verifiedBy must be the signing user';
          notes.push(['lab:verified_signed', { patient: incoming.patient && incoming.patient.name, version: incoming.version || 1 }]);
        }
        return null;
      }
      case 'macros': case 'dictionary': case 'categories':
        return can('templates:manage_macros', 'DRAFT') ? null : 'Requires templates:manage_macros';
      case 'msgTemplates': case 'files': case 'inbox': case 'dispatchLog':
        return can('print:dispatch_signed_reports', 'DRAFT') ? null : 'Requires print:dispatch_signed_reports';
      default:
        return 'Unknown collection ' + coll;
    }
  }

  router.get('/sync/pull', auth.verifyToken, async (req, res, next) => {
    try {
      const since = Number(req.query.since) || 0;
      const limit = Math.min(5000, Number(req.query.limit) || 2000);
      const out = await store.changesSince(since, limit);
      out.changes = out.changes.map((c) => ({ coll: c.coll, doc: ctx.sanitizeForClient(c.coll, c.doc), seq: c.seq }));
      out.serverTime = Date.now();
      res.json(out);
    } catch (e) { next(e); }
  });

  router.post('/sync/push', auth.verifyToken, async (req, res, next) => {
    try {
      const docs = Array.isArray(req.body && req.body.docs) ? req.body.docs : [];
      const origin = req.headers['x-socket-id'] || null;
      const results = [];
      for (const item of docs.slice(0, 2000)) {
        const { coll, doc } = item || {};
        if (!coll || !doc || !doc.id) { results.push({ coll, id: doc && doc.id, status: 'rejected', error: 'Malformed document' }); continue; }
        if (!SYNC_COLLECTIONS.has(coll)) { results.push({ coll, id: doc.id, status: 'rejected', error: 'Unknown collection' }); continue; }
        if (ADMIN_ONLY_VIA_API.has(coll)) {
          const cur = await store.getDoc(coll, doc.id);
          results.push({ coll, id: doc.id, status: 'rejected', error: 'Use the Admin Console API for ' + coll, doc: ctx.sanitizeForClient(coll, cur) });
          continue;
        }
        const existing = await store.getDoc(coll, doc.id);
        const notes = [];
        const err = await validate(coll, doc, existing, req.user, notes);
        if (err) {
          results.push({ coll, id: doc.id, status: 'rejected', error: err, doc: ctx.sanitizeForClient(coll, existing) });
          await audit.log(req, 'sync:rejected', coll + '/' + doc.id, { error: err });
          continue;
        }
        doc.updatedBy = req.user.id;
        const r = await ctx.saveDoc(coll, doc, { actor: req.user, originSocket: origin });
        if (r.status === 'ok') {
          for (const [action, meta] of notes) await audit.log(req, action, coll + '/' + doc.id, meta);
          results.push({ coll, id: doc.id, status: 'ok', seq: r.seq });
        } else {
          results.push({ coll, id: doc.id, status: 'stale', doc: ctx.sanitizeForClient(coll, r.doc) });
        }
      }
      res.json({ results, head: store.seq });
    } catch (e) { next(e); }
  });

  router.post('/counter/next', auth.verifyToken, async (req, res, next) => {
    try {
      const key = String((req.body && req.body.key) || '');
      if (!/^[a-zA-Z0-9:_\-]{2,80}$/.test(key)) return res.status(400).json({ error: 'Invalid counter key' });
      const value = await store.nextCounter(key, Number(req.body.min) || 0);
      res.json({ key, value });
    } catch (e) { next(e); }
  });

  router.get('/counter/:key', auth.verifyToken, async (req, res, next) => {
    try { res.json({ key: req.params.key, value: await store.peekCounter(req.params.key) }); } catch (e) { next(e); }
  });

  router.get('/counters', auth.verifyToken, async (req, res, next) => {
    try { res.json({ counters: await store.allCounters() }); } catch (e) { next(e); }
  });

  // Super Admin unlock (mandatory audit reason)
  router.post('/reports/:coll/:id/unlock', auth.verifyToken, auth.requireRole('SUPER_ADMIN_RADIOLOGIST'), auth.requireRecentAuth, async (req, res, next) => {
    try {
      const { coll, id } = req.params;
      if (!['reports', 'labReports', 'formf'].includes(coll)) return res.status(400).json({ error: 'Unknown report collection' });
      const reason = String((req.body && req.body.reason) || '').trim();
      if (reason.length < 5) return res.status(400).json({ error: 'A mandatory audit reason (min 5 characters) is required to unlock' });
      const cur = await store.getDoc(coll, id);
      if (!cur) return res.status(404).json({ error: 'Report not found' });
      const next = Object.assign({}, cur, {
        status: coll === 'formf' ? 'DRAFT' : 'AMENDING',
        unlockLog: (cur.unlockLog || []).concat([{ at: Date.now(), by: req.user.id, byName: req.user.name, reason }]),
        updatedAt: Date.now(), updatedBy: req.user.id
      });
      await ctx.saveDoc(coll, next, { actor: req.user, force: true });
      await audit.log(req, 'report:unlocked', coll + '/' + id, { reason, previousStatus: cur.status });
      res.json({ doc: next });
    } catch (e) { next(e); }
  });

  // Generic REST access to reports with lock enforcement (used by integrations / external tools)
  router.put('/reports/:coll/:id', auth.verifyToken, auth.enforceReportLock, async (req, res, next) => {
    try {
      const notes = [];
      const doc = Object.assign({}, req.body, { id: req.params.id, updatedAt: Date.now() });
      const err = await validate(req.params.coll, doc, req.existingReport, req.user, notes);
      if (err) return res.status(403).json({ error: err });
      const r = await ctx.saveDoc(req.params.coll, doc, { actor: req.user, force: true });
      for (const [a, m] of notes) await audit.log(req, a, req.params.coll + '/' + req.params.id, m);
      res.json({ doc: r.doc });
    } catch (e) { next(e); }
  });

  router.delete('/reports/:coll/:id', auth.verifyToken, auth.enforceReportLock, async (req, res, next) => {
    try {
      if (!req.existingReport) return res.status(404).json({ error: 'Not found' });
      const doc = Object.assign({}, req.existingReport, { _deleted: true, updatedAt: Date.now() });
      const notes = [];
      const err = await validate(req.params.coll, doc, req.existingReport, req.user, notes);
      if (err) return res.status(403).json({ error: err });
      await ctx.saveDoc(req.params.coll, doc, { actor: req.user, force: true });
      await audit.log(req, 'report:deleted', req.params.coll + '/' + req.params.id, {});
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  return router;
}

module.exports = { syncRoutes, SYNC_COLLECTIONS };
