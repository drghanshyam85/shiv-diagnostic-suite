/*
 * Outbound messaging providers.
 *   Email    : SMTP via nodemailer (Gmail: smtp.gmail.com:465 + App Password)
 *   WhatsApp : Meta WhatsApp Cloud API | UltraMsg | Wati | generic signed webhook
 *   SMS      : Fast2SMS | Twilio | TextLocal
 * Attachments: [{ filename, contentType, buffer }]
 */
const crypto = require('crypto');
const nodemailer = require('nodemailer');

function normalizeIndian(num) {
  let d = String(num || '').replace(/\D/g, '');
  if (d.length === 10) d = '91' + d;
  if (d.length === 11 && d.startsWith('0')) d = '91' + d.slice(1);
  return d;
}

async function readJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { return { raw: text }; }
}

async function ensureOk(res, label) {
  const body = await readJson(res);
  if (!res.ok) {
    const msg = (body && (body.error && (body.error.message || body.error)) || body.message || body.raw || res.statusText);
    throw new Error(label + ' ' + res.status + ': ' + (typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 300));
  }
  return body;
}

// --------------------------------------------------------------------------- Email
async function sendEmail(cfg, msg) {
  const s = cfg.smtp;
  if (!s.host || !s.user || !s.pass) throw new Error('SMTP is not configured (Settings → Integrations → Email)');
  const transporter = nodemailer.createTransport({
    host: s.host, port: Number(s.port) || 465, secure: !!s.secure,
    auth: { user: s.user, pass: s.pass }
  });
  const info = await transporter.sendMail({
    from: { name: s.fromName || 'Diagnostic Center', address: s.fromEmail || s.user },
    to: msg.to, cc: msg.cc || undefined, bcc: msg.bcc || undefined,
    subject: msg.subject || '(no subject)',
    text: msg.text || undefined,
    html: msg.html || undefined,
    attachments: (msg.attachments || []).map((a) => ({ filename: a.filename, content: a.buffer, contentType: a.contentType }))
  });
  return { ok: true, provider: 'smtp', id: info.messageId, accepted: info.accepted, rejected: info.rejected };
}

// --------------------------------------------------------------------------- WhatsApp
async function sendWhatsApp(cfg, msg) {
  const w = cfg.whatsapp;
  const to = normalizeIndian(msg.to);
  if (!to) throw new Error('WhatsApp number missing');
  const atts = msg.attachments || [];
  switch (w.provider) {
    case 'meta': {
      const base = `https://graph.facebook.com/${w.meta.apiVersion || 'v21.0'}/${w.meta.phoneNumberId}`;
      const headers = { Authorization: 'Bearer ' + w.meta.token };
      const ids = [];
      const warnings = [];
      const post = async (payload) => {
        const r = await fetch(base + '/messages', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(Object.assign({ messaging_product: 'whatsapp', recipient_type: 'individual', to }, payload)) });
        try {
          const b = await ensureOk(r, 'WhatsApp Cloud API');
          ids.push(b.messages && b.messages[0] && b.messages[0].id);
        } catch (e) {
          if (/131047|re-engagement|24 hours/i.test(e.message)) throw new Error(e.message + ' — outside the 24-hour window WhatsApp only accepts an approved template: set one in Settings → Integrations → WhatsApp');
          throw e;
        }
      };
      const upload = async (a) => {
        const fd = new FormData();
        fd.append('messaging_product', 'whatsapp');
        fd.append('type', a.contentType);
        fd.append('file', new Blob([a.buffer], { type: a.contentType }), a.filename);
        return ensureOk(await fetch(base + '/media', { method: 'POST', headers, body: fd }), 'WhatsApp media upload');
      };
      let rest = atts;
      if (w.meta.templateName) {
        // business-initiated message: approved template, PDF as the document header, placeholders as body text
        const vars = msg.variables || {};
        const names = String(w.meta.templateParams || '').split(',').map((x) => x.trim()).filter(Boolean);
        const components = [];
        if (w.meta.templateHeader === 'document' && atts.length) {
          const up = await upload(atts[0]);
          components.push({ type: 'header', parameters: [{ type: 'document', document: { id: up.id, filename: atts[0].filename } }] });
          rest = atts.slice(1);
        }
        if (names.length) components.push({ type: 'body', parameters: names.map((n) => ({ type: 'text', text: String(vars[n] === undefined || vars[n] === '' ? '-' : vars[n]).replace(/\s*\n\s*/g, ' ').slice(0, 1000) })) });
        await post({ type: 'template', template: { name: w.meta.templateName, language: { code: w.meta.templateLang || 'en' }, components } });
      } else if (msg.message && (!atts.length || msg.sendTextSeparately !== false)) {
        await post({ type: 'text', text: { body: msg.message, preview_url: true } });
      }
      for (const a of rest) {
        try {
          const up = await upload(a);
          await post({ type: 'document', document: { id: up.id, filename: a.filename, caption: a.caption || '' } });
        } catch (e) {
          if (!w.meta.templateName) throw e;
          warnings.push(a.filename + ': ' + e.message);
        }
      }
      return { ok: true, provider: 'meta', ids, warnings };
    }
    case 'ultramsg': {
      const base = `https://api.ultramsg.com/${w.ultramsg.instanceId}`;
      const ids = [];
      const form = (o) => new URLSearchParams(Object.assign({ token: w.ultramsg.token, to: '+' + to }, o));
      if (msg.message) {
        const b = await ensureOk(await fetch(base + '/messages/chat', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ body: msg.message }) }), 'UltraMsg');
        if (b.error) throw new Error('UltraMsg: ' + JSON.stringify(b.error));
        ids.push(b.id);
      }
      for (const a of atts) {
        const b = await ensureOk(await fetch(base + '/messages/document', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form({ filename: a.filename, document: a.buffer.toString('base64'), caption: a.caption || '' })
        }), 'UltraMsg');
        if (b.error) throw new Error('UltraMsg: ' + JSON.stringify(b.error));
        ids.push(b.id);
      }
      return { ok: true, provider: 'ultramsg', ids };
    }
    case 'wati': {
      const base = String(w.wati.endpoint).replace(/\/$/, '');
      const headers = { Authorization: /^Bearer /i.test(w.wati.token) ? w.wati.token : 'Bearer ' + w.wati.token };
      if (msg.message) {
        await ensureOk(await fetch(`${base}/api/v1/sendSessionMessage/${to}?messageText=${encodeURIComponent(msg.message)}`, { method: 'POST', headers }), 'Wati');
      }
      for (const a of atts) {
        const fd = new FormData();
        fd.append('file', new Blob([a.buffer], { type: a.contentType }), a.filename);
        await ensureOk(await fetch(`${base}/api/v1/sendSessionFile/${to}?caption=${encodeURIComponent(a.caption || '')}`, { method: 'POST', headers, body: fd }), 'Wati');
      }
      return { ok: true, provider: 'wati' };
    }
    case 'webhook': {
      const payload = JSON.stringify({
        channel: 'whatsapp', to, message: msg.message || '',
        attachments: atts.map((a) => ({ filename: a.filename, contentType: a.contentType, base64: a.buffer.toString('base64') })),
        sentAt: new Date().toISOString()
      });
      const sig = crypto.createHmac('sha256', w.webhook.secret || '').update(payload).digest('hex');
      const r = await fetch(w.webhook.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SSDC-Signature': sig }, body: payload });
      const b = await ensureOk(r, 'Webhook');
      return { ok: true, provider: 'webhook', response: b };
    }
    default:
      throw new Error('No WhatsApp API provider configured — use deep-link mode or configure a provider in Settings → Integrations');
  }
}

// --------------------------------------------------------------------------- SMS
/** Fast2SMS DLT: values for the registered template's {#var#} slots, pipe-separated, in order. */
function dltValues(namesCsv, msg) {
  const vars = msg.variables;
  if (!vars || typeof vars !== 'object') return String(vars || msg.message || '');
  return String(namesCsv || '').split(',').map((n) => n.trim()).filter(Boolean).map((n) => String(vars[n] === undefined ? '' : vars[n]).replace(/\|/g, '/')).join('|');
}

async function sendSms(cfg, msg) {
  const s = cfg.sms;
  const to = normalizeIndian(msg.to);
  if (!to) throw new Error('Mobile number missing');
  const unicode = /[^\x00-\x7F]/.test(msg.message || '');
  switch (s.provider) {
    case 'fast2sms': {
      const f = s.fast2sms;
      const body = f.route === 'dlt'
        ? { route: 'dlt', sender_id: f.senderId, message: f.dltTemplateId, variables_values: dltValues(f.dltVariables, msg), numbers: to.slice(-10), flash: 0 }
        : { route: f.route || 'q', message: msg.message, language: unicode ? 'unicode' : 'english', flash: 0, numbers: to.slice(-10) };
      const b = await ensureOk(await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST', headers: { authorization: f.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      }), 'Fast2SMS');
      if (b.return === false) throw new Error('Fast2SMS: ' + (b.message || JSON.stringify(b)));
      return { ok: true, provider: 'fast2sms', id: b.request_id };
    }
    case 'twilio': {
      const t = s.twilio;
      const b = await ensureOk(await fetch(`https://api.twilio.com/2010-04-01/Accounts/${t.accountSid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(t.accountSid + ':' + t.authToken).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: '+' + to, From: t.from, Body: msg.message })
      }), 'Twilio');
      return { ok: true, provider: 'twilio', id: b.sid };
    }
    case 'textlocal': {
      const t = s.textlocal;
      const b = await ensureOk(await fetch('https://api.textlocal.in/send/', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ apikey: t.apiKey, numbers: to, sender: t.sender || 'TXTLCL', message: msg.message, unicode: unicode ? 'true' : 'false' })
      }), 'TextLocal');
      if (b.status !== 'success') throw new Error('TextLocal: ' + JSON.stringify(b.errors || b));
      return { ok: true, provider: 'textlocal', id: b.batch_id };
    }
    default:
      throw new Error('No SMS gateway configured — use the sms: deep link or configure Fast2SMS / Twilio / TextLocal');
  }
}

module.exports = { sendEmail, sendWhatsApp, sendSms, normalizeIndian };
