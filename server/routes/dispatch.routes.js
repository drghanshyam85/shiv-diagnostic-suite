/*
 * Omnichannel dispatch (server-side, silent background sending when a provider is configured)
 *   GET  /api/integrations           masked integration settings (admin)
 *   PUT  /api/integrations           save integration settings (admin)
 *   GET  /api/integrations/status    which channels are configured (all staff)
 *   POST /api/integrations/test/:ch  send a test message
 *   POST /api/dispatch/email|whatsapp|sms
 *   POST /api/inbox/sync             pull report attachments from the IMAP inbox
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getIntegrations, setIntegrations, mask, status } = require('../services/integrations');
const { sendEmail, sendWhatsApp, sendSms } = require('../services/messaging');
const { fetchReportAttachments } = require('../services/imap');

function dispatchRoutes(ctx, deps) {
  const { auth, audit, files } = deps;
  const router = express.Router();
  const adminGuard = [auth.verifyToken, auth.requirePermission('settings:manage_clinic_and_integrations', 'FULL')];
  const senders = (req, res, next) => {
    if (req.user.can('print:dispatch_signed_reports', 'DRAFT') || req.user.can('billing:create_invoice', 'FULL')) return next();
    return res.status(403).json({ error: 'Requires print:dispatch_signed_reports or billing:create_invoice' });
  };

  async function resolveAttachments(list) {
    const out = [];
    for (const a of list || []) {
      if (a.fileId) {
        const doc = await ctx.store.getDoc('files', a.fileId);
        if (!doc) throw new Error('Attachment file not found: ' + a.fileId);
        out.push({ filename: a.filename || doc.name, contentType: doc.mime, buffer: fs.readFileSync(path.join(ctx.filesDir, path.basename(doc.id))), caption: a.caption });
      } else if (a.base64) {
        out.push({ filename: a.filename || 'document.pdf', contentType: a.contentType || 'application/pdf', buffer: Buffer.from(String(a.base64).replace(/^data:[^,]+,/, ''), 'base64'), caption: a.caption });
      }
    }
    const total = out.reduce((s, x) => s + x.buffer.length, 0);
    if (total > 24 * 1024 * 1024) throw new Error('Attachments exceed 24 MB');
    return out;
  }

  router.get('/integrations', ...adminGuard, async (req, res, next) => {
    try { const cfg = await getIntegrations(ctx); res.json({ config: mask(cfg), status: status(cfg) }); } catch (e) { next(e); }
  });

  router.put('/integrations', ...adminGuard, auth.requireRecentAuth, async (req, res, next) => {
    try {
      const cfg = await setIntegrations(ctx, req.body || {});
      await audit.log(req, 'settings:integrations_updated', 'integrations', { sections: Object.keys(req.body || {}) });
      res.json({ config: mask(cfg), status: status(cfg) });
    } catch (e) { next(e); }
  });

  router.get('/integrations/status', auth.verifyToken, async (req, res, next) => {
    try { res.json({ status: status(await getIntegrations(ctx)) }); } catch (e) { next(e); }
  });

  router.post('/integrations/test/:channel', ...adminGuard, async (req, res, next) => {
    try {
      const cfg = await getIntegrations(ctx);
      const to = (req.body && req.body.to) || '';
      const s = await ctx.getSettings();
      const text = 'Test message from ' + s.clinic.name + ' (' + new Date().toLocaleString('en-IN') + ')';
      let r;
      if (req.params.channel === 'email') r = await sendEmail(cfg, { to: to || cfg.smtp.user, subject: 'Test – ' + s.clinic.name, text, html: '<p>' + text + '</p>' });
      else if (req.params.channel === 'whatsapp') r = await sendWhatsApp(cfg, { to, message: text });
      else if (req.params.channel === 'sms') r = await sendSms(cfg, { to, message: text });
      else return res.status(400).json({ error: 'Unknown channel' });
      res.json(r);
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  router.post('/dispatch/:channel', auth.verifyToken, senders, async (req, res) => {
    const channel = req.params.channel;
    const body = req.body || {};
    try {
      const cfg = await getIntegrations(ctx);
      const attachments = await resolveAttachments(body.attachments);
      let r;
      if (channel === 'email') {
        if (!body.to) throw new Error('Recipient email required');
        r = await sendEmail(cfg, { to: body.to, cc: body.cc, subject: body.subject, html: body.html, text: body.text, attachments });
      } else if (channel === 'whatsapp') {
        r = await sendWhatsApp(cfg, { to: body.to, message: body.message, attachments, variables: body.variables });
      } else if (channel === 'sms') {
        r = await sendSms(cfg, { to: body.to, message: body.message, variables: body.variables });
      } else return res.status(400).json({ error: 'Unknown channel' });
      await audit.log(req, 'dispatch:' + channel + '_sent', body.ref || '', { to: body.to, attachments: attachments.map((a) => a.filename), provider: r.provider });
      res.json(r);
    } catch (e) {
      await audit.log(req, 'dispatch:' + channel + '_failed', body.ref || '', { to: body.to, error: e.message });
      res.status(502).json({ error: e.message });
    }
  });

  router.post('/inbox/sync', auth.verifyToken, auth.requirePermission('print:dispatch_signed_reports', 'DRAFT'), async (req, res, next) => {
    try {
      const cfg = await getIntegrations(ctx);
      const messages = await fetchReportAttachments(cfg, req.body || {});
      const imported = [];
      for (const m of messages) {
        const id = 'mail_' + m.key;
        if (await ctx.store.getDoc('inbox', id)) continue;
        const fileIds = [];
        for (const a of m.attachments) {
          const fid = 'f_' + crypto.randomBytes(10).toString('hex');
          fs.writeFileSync(path.join(ctx.filesDir, fid), a.buffer);
          await files.createFileDoc({
            id: fid, name: a.filename, mime: a.contentType || files.guessMime(a.filename), size: a.buffer.length,
            sha: crypto.createHash('sha256').update(a.buffer).digest('hex'),
            meta: { source: 'email', category: 'Other', emailFrom: m.from, emailSubject: m.subject, inboxId: id }, user: req.user
          });
          fileIds.push(fid);
        }
        const doc = { id, messageId: m.messageId, from: m.from, to: m.to, subject: m.subject, date: m.date, text: m.text, fileIds, status: 'new', createdAt: Date.now(), updatedAt: Date.now() };
        await ctx.saveDoc('inbox', doc, { actor: req.user, force: true });
        imported.push(doc);
      }
      await audit.log(req, 'inbox:synced', 'inbox', { fetched: messages.length, imported: imported.length });
      res.json({ fetched: messages.length, imported: imported.length, items: imported });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  return router;
}

module.exports = { dispatchRoutes };
