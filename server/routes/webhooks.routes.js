/*
 * Delivery receipts for sent messages (public endpoints, no login — protected by tokens / signatures).
 *   GET  /api/webhooks/whatsapp            Meta webhook verification (hub.verify_token = Settings → Integrations)
 *   POST /api/webhooks/whatsapp            Meta Cloud API statuses: sent → delivered → read, or failed
 *                                          (X-Hub-Signature-256 checked when the app secret is set)
 *   POST /api/webhooks/dispatch-status     any other provider / gateway: {channel, id, status, error}
 *                                          with ?token=<status token from Settings → Integrations>
 * Each receipt updates the matching dispatch-log row (live on every workstation); a failure also
 * raises an alert on every workstation and goes into the audit trail.
 */
const express = require('express');
const crypto = require('crypto');
const { getIntegrations } = require('../services/integrations');

const RANK = { accepted: 0, sent: 1, delivered: 2, read: 3 };
const SYSTEM = { id: 'system', name: 'Delivery receipts', role: 'SYSTEM' };

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function webhookRoutes(ctx, { audit, io }) {
  const router = express.Router();

  /** Find the dispatch-log row that sent provider message `id` on `channel` and record the new status. */
  async function applyStatus(channel, id, status, at, error) {
    if (!id || !status) return false;
    const since = Date.now() - 45 * 86400000;
    const rows = await ctx.store.listDocs('dispatchLog');
    const row = rows.find((r) => (r.at || 0) >= since && r.providerIds && Array.isArray(r.providerIds[channel]) && r.providerIds[channel].includes(id));
    if (!row) return false;
    const delivery = Object.assign({}, row.delivery || {});
    const cur = delivery[channel] || {};
    const st = String(status).toLowerCase();
    // statuses can arrive out of order: never step back from read to delivered, but always record a failure
    if (st !== 'failed' && cur.status && cur.status !== 'failed' && (RANK[cur.status] || 0) >= (RANK[st] || 0)) return true;
    delivery[channel] = { status: st, at: at || Date.now(), error: error || '', id };
    const vals = Object.values(delivery).map((d) => d.status);
    const next = Object.assign({}, row, {
      delivery,
      deliveryStatus: vals.includes('failed') ? 'failed' : vals.every((v) => v === 'read') ? 'read' : vals.every((v) => v === 'read' || v === 'delivered') ? 'delivered' : 'sent',
      updatedAt: Date.now()
    });
    await ctx.saveDoc('dispatchLog', next, { actor: SYSTEM, force: true });
    if (st === 'failed') {
      const label = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'E-mail' }[channel] || channel;
      io.emit('notify', { type: 'error', text: label + ' could not be delivered to ' + (row.patientName || row.mobile || 'the patient') + (error ? ': ' + error : '') + ' — resend from Dispatch Center' });
      await audit.log(SYSTEM, 'dispatch:delivery_failed', 'dispatchLog/' + row.id, { channel, error, patient: row.patientName || '' });
    }
    return true;
  }

  router.get('/webhooks/whatsapp', async (req, res) => {
    const cfg = await getIntegrations(ctx);
    const token = cfg.whatsapp.meta.verifyToken;
    if (req.query['hub.mode'] === 'subscribe' && token && safeEqual(req.query['hub.verify_token'], token)) return res.status(200).type('text/plain').send(String(req.query['hub.challenge'] || ''));
    res.sendStatus(403);
  });

  router.post('/webhooks/whatsapp', async (req, res) => {
    try {
      const cfg = await getIntegrations(ctx);
      const secret = cfg.whatsapp.meta.appSecret;
      if (!secret && !cfg.whatsapp.meta.verifyToken) return res.sendStatus(404);
      if (secret) {
        const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody || Buffer.from('')).digest('hex');
        if (!safeEqual(req.headers['x-hub-signature-256'], expected)) return res.sendStatus(401);
      }
      res.sendStatus(200); // acknowledge at once; Meta retries slow endpoints
      for (const entry of (req.body && req.body.entry) || []) {
        for (const change of entry.changes || []) {
          for (const st of (change.value && change.value.statuses) || []) {
            const err = st.errors && st.errors[0] ? (st.errors[0].title || st.errors[0].message || '') + (st.errors[0].code ? ' (' + st.errors[0].code + ')' : '') : '';
            await applyStatus('whatsapp', st.id, st.status, Number(st.timestamp) * 1000 || Date.now(), err);
          }
        }
      }
    } catch (e) { if (!res.headersSent) res.sendStatus(500); }
  });

  router.post('/webhooks/dispatch-status', async (req, res) => {
    try {
      const cfg = await getIntegrations(ctx);
      const token = cfg.statusWebhook && cfg.statusWebhook.statusToken;
      if (!token || !safeEqual(req.query.token || req.headers['x-status-token'], token)) return res.sendStatus(401);
      const items = Array.isArray(req.body) ? req.body : [req.body || {}];
      let matched = 0;
      for (const it of items.slice(0, 500)) {
        if (await applyStatus(String(it.channel || 'whatsapp').toLowerCase(), String(it.id || ''), String(it.status || ''), Number(it.at) || Date.now(), String(it.error || ''))) matched += 1;
      }
      res.json({ ok: true, matched });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return { router, applyStatus };
}

module.exports = { webhookRoutes };
