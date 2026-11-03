/*
 * Cloud configuration & backup control panel API.
 */
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const google = require('../services/cloud/google');
const microsoft = require('../services/cloud/microsoft');
const gcp = require('../services/cloud/gcp');
const { getIntegrations, setIntegrations } = require('../services/integrations');

function cloudRoutes(ctx, deps) {
  const { auth, audit, engine } = deps;
  const router = express.Router();
  const states = new Map();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 80 * 1024 * 1024 } });
  const admin = [auth.verifyToken, auth.requirePermission('settings:manage_clinic_and_integrations', 'FULL')];

  const redirectFor = (req, provider) => `${req.protocol}://${req.get('host')}/api/cloud/${provider}/callback`;

  router.get('/cloud/status', auth.verifyToken, async (req, res, next) => {
    try { res.json(await engine.status()); } catch (e) { next(e); }
  });

  router.get('/cloud/:provider/auth-url', ...admin, async (req, res, next) => {
    try {
      const cfg = await getIntegrations(ctx);
      const provider = req.params.provider;
      const state = crypto.randomBytes(16).toString('hex');
      const redirectUri = redirectFor(req, provider);
      states.set(state, { provider, redirectUri, at: Date.now(), user: req.user.id });
      if (provider === 'google') {
        if (!cfg.google.clientId || !cfg.google.clientSecret) return res.status(400).json({ error: 'Enter the Google OAuth Client ID & Secret first' });
        return res.json({ url: google.authUrl(cfg, redirectUri, state), redirectUri });
      }
      if (provider === 'microsoft') {
        if (!cfg.microsoft.clientId || !cfg.microsoft.clientSecret) return res.status(400).json({ error: 'Enter the Microsoft (Azure) app Client ID & Secret first' });
        return res.json({ url: microsoft.authUrl(cfg, redirectUri, state), redirectUri });
      }
      res.status(400).json({ error: 'Unknown provider' });
    } catch (e) { next(e); }
  });

  async function callback(req, res, provider) {
    const st = states.get(String(req.query.state || ''));
    if (!st || st.provider !== provider || Date.now() - st.at > 15 * 60000) return res.status(400).send('OAuth state invalid or expired. Close this tab and try again.');
    states.delete(String(req.query.state));
    if (req.query.error) return res.redirect('/#/cloud?error=' + encodeURIComponent(req.query.error_description || req.query.error));
    try {
      const cfg = await getIntegrations(ctx);
      const saved = provider === 'google'
        ? await google.exchangeCode(ctx, cfg, String(req.query.code), st.redirectUri)
        : await microsoft.exchangeCode(ctx, cfg, String(req.query.code), st.redirectUri);
      await audit.log({ id: st.user, name: st.user, role: 'SUPER_ADMIN_RADIOLOGIST' }, 'cloud:connected', provider, { account: saved.email || saved.account });
      engine.refreshQuotas();
      res.redirect('/#/cloud?connected=' + provider);
    } catch (e) {
      res.redirect('/#/cloud?error=' + encodeURIComponent(e.message));
    }
  }
  router.get('/cloud/google/callback', (req, res) => callback(req, res, 'google'));
  router.get('/cloud/microsoft/callback', (req, res) => callback(req, res, 'microsoft'));

  router.post('/cloud/gcp/service-account', ...admin, async (req, res, next) => {
    try {
      const { json, projectId, bucket, firestore } = req.body || {};
      const info = await gcp.saveServiceAccount(ctx, json);
      await setIntegrations(ctx, { gcp: { projectId: projectId || info.projectId, bucket: bucket || '', firestore: firestore !== false, serviceAccountEmail: info.clientEmail } });
      await audit.log(req, 'cloud:connected', 'gcp', { account: info.clientEmail });
      engine.broadcast();
      res.json({ ok: true, account: info.clientEmail, projectId: projectId || info.projectId });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.post('/cloud/:provider/disconnect', ...admin, async (req, res, next) => {
    try {
      const p = req.params.provider;
      if (p === 'gdrive' || p === 'google') await google.disconnect(ctx);
      else if (p === 'onedrive' || p === 'microsoft') await microsoft.disconnect(ctx);
      else if (p === 'gcp') await gcp.disconnect(ctx);
      else return res.status(400).json({ error: 'Unknown provider' });
      await audit.log(req, 'cloud:disconnected', p, {});
      engine.broadcast();
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  router.put('/cloud/prefs', ...admin, async (req, res, next) => {
    try {
      const cur = await engine.prefs();
      const next = Object.assign(cur, req.body || {});
      await ctx.store.kvSet('cloud:prefs', next);
      engine.broadcast();
      res.json({ prefs: next });
    } catch (e) { next(e); }
  });

  // Auto-save pipeline: clients push generated report PDF/DOCX & scan images here
  router.post('/cloud/upload', auth.verifyToken, upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'file required' });
      const relPath = String(req.body.relPath || '').replace(/\\/g, '/').replace(/\.\.+/g, '.').replace(/^\/+/, '');
      if (!relPath) return res.status(400).json({ error: 'relPath required' });
      const local = path.join(engine.outDir, crypto.createHash('sha1').update(relPath).digest('hex') + path.extname(relPath));
      fs.writeFileSync(local, req.file.buffer);
      const providers = req.body.providers ? String(req.body.providers).split(',').filter(Boolean) : undefined;
      const r = await engine.enqueueFile({ localPath: local, relPath, mimeType: req.file.mimetype, providers, asGoogleDoc: req.body.asGoogleDoc === 'true' });
      res.json(r);
    } catch (e) { next(e); }
  });

  // Immediate "Open in Google Docs" — uploads DOCX/HTML converted to a native Google Doc
  router.post('/cloud/google/upload-doc', auth.verifyToken, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'file required' });
      const cfg = await getIntegrations(ctx);
      const s = await ctx.getSettings();
      const segs = [s.cloud.rootFolder, 'Google_Docs_Exports'];
      const r = await google.uploadFile(ctx, cfg, { segments: segs, filename: req.body.name || req.file.originalname, buffer: req.file.buffer, mimeType: req.file.mimetype, asGoogleDoc: true });
      res.json({ link: r.link, id: r.id });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  router.post('/cloud/force-sync', auth.verifyToken, async (req, res, next) => {
    try { const r = await engine.forceFullSync(); await audit.log(req, 'cloud:force_sync', 'cloud', r); res.json(r); } catch (e) { next(e); }
  });

  router.post('/cloud/retry', auth.verifyToken, async (req, res, next) => {
    try { await engine.retryAll(); res.json({ ok: true }); } catch (e) { next(e); }
  });

  router.get('/cloud/log', auth.verifyToken, async (req, res, next) => {
    try { res.json({ log: await ctx.store.listCloudLog(Number(req.query.limit) || 300), queue: await ctx.store.listCloudQueue(200) }); } catch (e) { next(e); }
  });

  // integrity audit: compare every recent cloud copy's checksum with the clinic file; re-queue bad copies
  router.get('/cloud/verify', auth.verifyToken, async (req, res, next) => {
    try { res.json({ report: await engine.lastVerify() }); } catch (e) { next(e); }
  });
  router.post('/cloud/verify', auth.verifyToken, auth.requirePermission('settings:manage_clinic_and_integrations', 'READ'), async (req, res, next) => {
    try {
      const limit = Math.max(1, Math.min(200, Number((req.body || {}).limit) || 60));
      const report = await engine.verifyIntegrity({ limit, repair: (req.body || {}).repair !== false, by: req.user.name });
      await audit.log(req, 'cloud:integrity_verified', 'cloud', report.summary);
      res.json({ report });
    } catch (e) { next(e); }
  });

  router.post('/cloud/quota', auth.verifyToken, async (req, res, next) => {
    try { await engine.refreshQuotas(); res.json(await engine.status()); } catch (e) { next(e); }
  });

  return router;
}

module.exports = { cloudRoutes };
