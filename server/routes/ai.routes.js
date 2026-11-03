/*
 * Gemini proxy — keeps the API key on the clinic server (never shipped to browsers).
 *   GET  /api/ai/status     configured? default model
 *   GET  /api/ai/models     models available to the key (models.list)
 *   POST /api/ai/generate   { model, request }  → generateContent
 *   GET  /api/ai/translit   English → Hindi (Devanagari) transliteration via Google Input Tools
 */
const express = require('express');
const { getIntegrations, RETIRED_MODEL } = require('../services/integrations');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

function aiRoutes(ctx, deps) {
  const { auth } = deps;
  const router = express.Router();

  router.get('/ai/status', auth.verifyToken, async (req, res, next) => {
    try { const cfg = await getIntegrations(ctx); res.json({ configured: !!cfg.gemini.apiKey, model: cfg.gemini.model }); } catch (e) { next(e); }
  });

  router.get('/ai/models', auth.verifyToken, async (req, res) => {
    try {
      const cfg = await getIntegrations(ctx);
      if (!cfg.gemini.apiKey) return res.status(400).json({ error: 'Gemini API key not configured on the server' });
      const r = await fetch(`${BASE}/models?pageSize=200&key=${encodeURIComponent(cfg.gemini.apiKey)}`);
      const b = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: (b.error && b.error.message) || 'models.list failed' });
      res.json({ models: (b.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => ({ id: m.name.replace(/^models\//, ''), displayName: m.displayName, inputTokenLimit: m.inputTokenLimit, outputTokenLimit: m.outputTokenLimit, thinking: !!m.thinking })) });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  router.post('/ai/generate', auth.verifyToken, async (req, res) => {
    try {
      const cfg = await getIntegrations(ctx);
      if (!cfg.gemini.apiKey) return res.status(400).json({ error: 'Gemini API key not configured on the server' });
      let model = String((req.body && req.body.model) || cfg.gemini.model || 'gemini-3.8-flash').trim().replace(/^models\//, '');
      if (RETIRED_MODEL.test(model)) model = cfg.gemini.model || 'gemini-3.8-flash';
      if (!/^[a-zA-Z0-9.\-_]+$/.test(model)) return res.status(400).json({ error: 'Invalid model id' });
      const r = await fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(cfg.gemini.apiKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify((req.body && req.body.request) || {})
      });
      const b = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: (b.error && b.error.message) || 'Gemini request failed', details: b.error });
      res.json(b);
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  router.get('/ai/translit', auth.verifyToken, async (req, res) => {
    try {
      const text = String(req.query.text || '').slice(0, 200);
      if (!text.trim()) return res.json({ result: '' });
      const words = text.trim().split(/\s+/);
      const out = [];
      for (const w of words) {
        const r = await fetch(`https://inputtools.google.com/request?text=${encodeURIComponent(w)}&itc=hi-t-i0-und&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8`);
        const b = await r.json();
        out.push(b && b[0] === 'SUCCESS' && b[1] && b[1][0] && b[1][0][1] && b[1][0][1][0] ? b[1][0][1][0] : w);
      }
      res.json({ result: out.join(' ') });
    } catch (e) { res.json({ result: '', offline: true, error: e.message }); } // client falls back to offline rules
  });

  return router;
}

module.exports = { aiRoutes };
