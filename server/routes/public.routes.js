/*
 * Public (no-login) endpoints for patients:
 *   GET  /api/public/invoice/:shareId   sanitized digital receipt + preparation guidelines + UPI details
 *   POST /api/share                      create a secure, expiring download link (staff only)
 *   GET  /d/:token                       secure report / invoice download
 */
const express = require('express');

function maskMobile(m) {
  const d = String(m || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(0, 2) + 'XXXXXX' + d.slice(-2) : '';
}

function publicRoutes(ctx, deps) {
  const { auth, audit, files } = deps;
  const api = express.Router();
  const root = express.Router();

  async function baseUrl(req) {
    const s = await ctx.getSettings();
    if (s.billing && s.billing.publicBaseUrl) return String(s.billing.publicBaseUrl).replace(/\/$/, '');
    return req.protocol + '://' + req.get('host');
  }

  api.get('/public/invoice/:shareId', async (req, res, next) => {
    try {
      const all = await ctx.store.listDocs('invoices');
      const inv = all.find((i) => i.shareId === req.params.shareId);
      if (!inv) return res.status(404).json({ error: 'Invoice link not found or expired' });
      const s = await ctx.getSettings();
      const tests = await ctx.store.listDocs('tests');
      const tmap = {};
      tests.forEach((t) => { tmap[t.id] = t; });
      const guidelines = [];
      (inv.items || []).forEach((it) => {
        const t = tmap[it.testId];
        if (t && t.description && !guidelines.find((g) => g.text === t.description)) guidelines.push({ test: it.name, text: t.description });
      });
      res.json({
        clinic: {
          name: s.clinic.name, address: s.clinic.address, phone: s.clinic.phone, phone2: s.clinic.phone2, email: s.clinic.email,
          logo: s.clinic.logo, pcpndtRegNo: s.clinic.pcpndtRegNo, radiologist: s.clinic.radiologist, workingHours: s.clinic.workingHours
        },
        upi: { id: s.billing.upiId, name: s.billing.upiPayeeName },
        engagement: s.engagement,
        invoice: {
          invoiceNo: inv.invoiceNo, date: inv.date, status: inv.status, paymentMode: inv.paymentMode, billingType: inv.billingType,
          patient: { title: inv.patient.title, name: inv.patient.name, age: inv.patient.age, ageUnit: inv.patient.ageUnit, gender: inv.patient.gender, mobile: maskMobile(inv.patient.mobile), regId: inv.patient.regId },
          referredByName: inv.referredByName,
          items: (inv.items || []).map((x) => ({ name: x.name, department: x.department, amount: x.amount })),
          gross: inv.gross, discountAmount: inv.discountAmount, taxAmount: inv.taxAmount || 0, taxRate: inv.taxRate || 0, taxLabel: inv.taxLabel || 'GST', net: inv.net, paid: inv.paid, balance: inv.balance,
          payments: (inv.payments || []).map((p) => ({ at: p.at, mode: p.mode, amount: p.amount }))
        },
        guidelines,
        customGuidelines: s.engagement.customGuidelines || ''
      });
    } catch (e) { next(e); }
  });

  api.post('/share', auth.verifyToken, async (req, res, next) => {
    try {
      const { kind, ref, ttlHours } = req.body || {};
      if (!['file', 'invoice'].includes(kind)) return res.status(400).json({ error: 'kind must be file or invoice' });
      if (kind === 'file' && !(await ctx.store.getDoc('files', ref))) return res.status(404).json({ error: 'File not found' });
      const hours = Math.max(1, Math.min(24 * 90, Number(ttlHours) || 24 * 7));
      const token = await ctx.store.createShareLink({ kind, ref, expiresAt: Date.now() + hours * 3600000, meta: { by: req.user.id } });
      const url = (await baseUrl(req)) + '/d/' + token;
      await audit.log(req, 'share:link_created', kind + '/' + ref, { hours });
      res.json({ token, url, expiresAt: Date.now() + hours * 3600000 });
    } catch (e) { next(e); }
  });

  root.get('/d/:token', async (req, res, next) => {
    try {
      const link = await ctx.store.getShareLink(req.params.token);
      if (!link) return res.status(404).send(page('Link not found', 'This download link is invalid. Please contact the centre.'));
      if (link.expiresAt && link.expiresAt < Date.now()) return res.status(410).send(page('Link expired', 'This secure link has expired. Please request a new link from the centre.'));
      await ctx.store.hitShareLink(link.token);
      if (link.kind === 'invoice') return res.redirect('/p/' + encodeURIComponent(link.ref));
      const doc = await ctx.store.getDoc('files', link.ref);
      if (!doc || doc._deleted) return res.status(404).send(page('File removed', 'This report is no longer available.'));
      await audit.log({ id: 'patient', name: 'Patient link', role: 'PUBLIC' }, 'share:downloaded', 'files/' + doc.id, { ip: req.ip });
      await files.sendFile(res, doc, req.query.inline !== '1');
    } catch (e) { next(e); }
  });

  return { api, root };
}

function page(title, text) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,Segoe UI,Arial;background:#f1f5f9;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0}
.c{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px;max-width:420px;margin:16px;box-shadow:0 10px 30px rgba(2,132,199,.08)}h1{font-size:20px;margin:0 0 8px;color:#0369a1}</style></head>
<body><div class="c"><h1>${title}</h1><p>${text}</p></div></body></html>`;
}

module.exports = { publicRoutes };
