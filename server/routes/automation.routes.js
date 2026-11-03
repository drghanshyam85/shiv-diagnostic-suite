/*
 * Automation & webhooks API.
 *   GET  /api/automation/overview                 automations (on/off + counters), webhooks, inbound, counts
 *   GET  /api/automation/events?limit&before&type&group     the event log (newest first)
 *   POST /api/automation/events/:id/replay        run an event again (automations + webhooks)
 *   GET|POST /api/automation/webhooks             list / add an outgoing endpoint (the secret is shown once)
 *   PUT|DELETE /api/automation/webhooks/:id       edit (events, URL, on/off) / remove
 *   POST /api/automation/webhooks/:id/test        send a signed test event now
 *   POST /api/automation/webhooks/:id/rotate      new signing secret (shown once)
 *   GET  /api/automation/webhooks/:id/deliveries  attempts, status codes, next retry
 *   POST /api/automation/deliveries/:id/retry     retry a failed delivery now
 *   GET|PUT /api/automation/inbound               incoming webhook on/off; POST …/rotate, …/reveal
 *   POST /api/webhooks/in/:key                    PUBLIC — signed requests from other systems
 * Managing needs settings:manage_clinic_and_integrations (FULL); anything that reveals a secret also
 * needs the password entered recently (requireRecentAuth).
 */
const express = require('express');

function automationRoutes(ctx, { auth, audit, automation }) {
  const r = express.Router();
  const view = [auth.verifyToken, auth.requirePermission('settings:manage_clinic_and_integrations', 'READ')];
  const admin = [auth.verifyToken, auth.requirePermission('settings:manage_clinic_and_integrations', 'FULL')];
  const sensitive = admin.concat([auth.requireRecentAuth]);
  const wrap = (fn) => async (req, res, next) => {
    try { await fn(req, res); } catch (e) { if (e.status && e.status < 500) res.status(e.status).json({ error: e.message }); else next(e); }
  };

  r.get('/automation/overview', ...view, wrap(async (req, res) => res.json(await automation.overview())));
  r.get('/automation/events', ...view, wrap(async (req, res) => {
    res.json({ events: await automation.listEvents({ limit: Number(req.query.limit) || 60, before: Number(req.query.before) || 0, type: String(req.query.type || ''), group: String(req.query.group || '') }) });
  }));
  r.post('/automation/events/:id/replay', ...admin, wrap(async (req, res) => {
    const e = await automation.replay(req.params.id);
    await audit.log(req, 'automation:event_replayed', 'sysEvents/' + e.id, { type: e.type });
    res.json({ event: e });
  }));

  r.get('/automation/webhooks', ...view, wrap(async (req, res) => res.json({ webhooks: await automation.hooks.list() })));
  r.post('/automation/webhooks', ...sensitive, wrap(async (req, res) => {
    const h = await automation.hooks.create(req.body || {}, req.user);
    await audit.log(req, 'automation:webhook_created', 'webhooks/' + h.id, { name: h.name, url: h.url, events: h.events, includePatient: h.includePatient });
    res.status(201).json({ webhook: Object.assign({}, h, { secret: undefined, secretHint: h.secret.slice(0, 6) + '…' + h.secret.slice(-4) }), secret: h.secret });
  }));
  r.put('/automation/webhooks/:id', ...admin, wrap(async (req, res) => {
    const h = await automation.hooks.update(req.params.id, req.body || {});
    await audit.log(req, 'automation:webhook_updated', 'webhooks/' + h.id, { name: h.name, active: h.active, events: h.events, includePatient: h.includePatient });
    res.json({ webhook: h });
  }));
  r.delete('/automation/webhooks/:id', ...admin, wrap(async (req, res) => {
    await automation.hooks.remove(req.params.id);
    await audit.log(req, 'automation:webhook_deleted', 'webhooks/' + req.params.id, {});
    res.json({ ok: true });
  }));
  r.post('/automation/webhooks/:id/rotate', ...sensitive, wrap(async (req, res) => {
    const h = await automation.hooks.rotate(req.params.id);
    await audit.log(req, 'automation:webhook_secret_rotated', 'webhooks/' + h.id, { name: h.name });
    res.json({ secret: h.secret });
  }));
  r.post('/automation/webhooks/:id/test', ...admin, wrap(async (req, res) => res.json({ result: await automation.hooks.test(req.params.id) })));
  r.get('/automation/webhooks/:id/deliveries', ...view, wrap(async (req, res) => res.json({ deliveries: await automation.hooks.deliveries(req.params.id, Math.min(200, Number(req.query.limit) || 50)) })));
  r.post('/automation/deliveries/:id/retry', ...admin, wrap(async (req, res) => res.json({ delivery: await automation.hooks.retry(req.params.id) })));

  const inboundView = (cfg) => ({ enabled: !!cfg.enabled, path: cfg.key ? '/api/webhooks/in/' + cfg.key : '', secretHint: cfg.secret ? cfg.secret.slice(0, 6) + '…' + cfg.secret.slice(-4) : '' });
  r.get('/automation/inbound', ...view, wrap(async (req, res) => res.json(inboundView(await automation.inbound.config()))));
  r.put('/automation/inbound', ...sensitive, wrap(async (req, res) => {
    const before = await automation.inbound.config();
    const cfg = await automation.inbound.set({ enabled: !!(req.body && req.body.enabled) });
    await audit.log(req, 'automation:inbound_' + (cfg.enabled ? 'enabled' : 'disabled'), 'automation/inbound', {});
    res.json(Object.assign(inboundView(cfg), cfg.secret !== before.secret ? { secret: cfg.secret } : {}));
  }));
  r.post('/automation/inbound/rotate', ...sensitive, wrap(async (req, res) => {
    const cfg = await automation.inbound.rotate();
    await audit.log(req, 'automation:inbound_rotated', 'automation/inbound', {});
    res.json(Object.assign(inboundView(cfg), { secret: cfg.secret }));
  }));
  r.post('/automation/inbound/reveal', ...sensitive, wrap(async (req, res) => {
    const cfg = await automation.inbound.config();
    await audit.log(req, 'automation:inbound_secret_viewed', 'automation/inbound', {});
    res.json(Object.assign(inboundView(cfg), { secret: cfg.secret || '' }));
  }));

  // public: other systems post signed requests here (raw body kept by the JSON parser for /api/webhooks/*)
  r.post('/webhooks/in/:key', wrap(async (req, res) => {
    const out = await automation.inbound.handle(req);
    res.status(out.status).json(out.body);
  }));

  return r;
}

module.exports = { automationRoutes };
