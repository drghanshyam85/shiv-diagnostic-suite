/*
 * Server-side integration secrets (SMTP, WhatsApp API, SMS gateway, IMAP, Gemini, OAuth apps).
 * Secrets never leave the server: GET returns masked values, PUT keeps a secret when the client
 * sends back the masked placeholder.
 */
const { deepMerge } = require('../context');

const SECRET_KEYS = new Set(['pass', 'token', 'apiKey', 'secret', 'clientSecret', 'authToken', 'privateKey', 'refreshToken', 'accessToken', 'appSecret']);
const MASK = '••••';
/** Gemini models no longer offered (2.5 Flash / Flash-Lite); requests for them use the default instead. */
const RETIRED_MODEL = /^(models\/)?gemini-(2\.5-flash(-lite)?(-preview[\w.-]*)?|flash-lite-latest)$/i;

const DEFAULTS = {
  smtp: { host: 'smtp.gmail.com', port: 465, secure: true, user: '', pass: '', fromName: 'Shiv Sonography and Diagnostic Center', fromEmail: '' },
  whatsapp: {
    provider: 'none',
    // templateName: an approved WhatsApp template (needed outside the 24-hour customer-service window);
    // templateParams: placeholder names filling {{1}}, {{2}}…; templateHeader 'document' attaches the PDF as the header
    // verifyToken / appSecret: delivery receipts webhook (/api/webhooks/whatsapp) — verification token + app secret
    // used to check Meta's X-Hub-Signature-256
    meta: { token: '', phoneNumberId: '', apiVersion: 'v21.0', templateName: '', templateLang: 'en', templateParams: 'Patient_Name,Test_Name,Secure_Download_Link', templateHeader: 'document', verifyToken: '', appSecret: '' },
    ultramsg: { instanceId: '', token: '' },
    wati: { endpoint: '', token: '' },
    webhook: { url: '', secret: '' }
  },
  sms: {
    provider: 'none',
    // DLT route: dltVariables lists the placeholder names filling the template's {#var#} slots in order
    fast2sms: { apiKey: '', route: 'q', senderId: '', dltTemplateId: '', dltVariables: 'Patient_Name,Test_Name,Secure_Download_Link' },
    twilio: { accountSid: '', authToken: '', from: '' },
    textlocal: { apiKey: '', sender: 'TXTLCL' }
  },
  imap: { host: 'imap.gmail.com', port: 993, secure: true, user: '', pass: '', mailbox: 'INBOX' },
  gemini: { apiKey: '', model: 'gemini-3.8-flash' },
  google: { clientId: '', clientSecret: '' },
  microsoft: { clientId: '', clientSecret: '', tenant: 'common' },
  gcp: { projectId: '', bucket: '', firestore: true, serviceAccountEmail: '' },
  // any other gateway can post delivery receipts to /api/webhooks/dispatch-status?token=<statusToken>
  statusWebhook: { statusToken: '' }
};

async function getIntegrations(ctx) {
  const saved = await ctx.store.kvGet('integrations', {});
  const merged = deepMerge(DEFAULTS, saved || {});
  if (!merged.gemini.apiKey && process.env.GEMINI_API_KEY) merged.gemini.apiKey = process.env.GEMINI_API_KEY;
  // Gemini 2.5 Flash / Flash-Lite are no longer offered: an old saved default moves to Gemini 3.8 Flash
  if (!merged.gemini.model || RETIRED_MODEL.test(merged.gemini.model)) merged.gemini.model = 'gemini-3.8-flash';
  if (!merged.smtp.pass && process.env.SMTP_PASS) {
    merged.smtp.pass = process.env.SMTP_PASS;
    merged.smtp.user = merged.smtp.user || process.env.SMTP_USER || '';
  }
  return merged;
}

function mask(obj) {
  if (Array.isArray(obj)) return obj.map(mask);
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.has(k)) out[k] = v ? MASK + String(v).slice(-4) : '';
    else out[k] = mask(v);
  }
  return out;
}

function stripMasked(patch, current) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (SECRET_KEYS.has(k) && typeof v === 'string' && v.startsWith(MASK)) out[k] = current ? current[k] : '';
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = stripMasked(v, current ? current[k] : undefined);
    else out[k] = v;
  }
  return out;
}

async function setIntegrations(ctx, patch) {
  const current = await ctx.store.kvGet('integrations', {});
  const merged = deepMerge(current || {}, stripMasked(patch, deepMerge(DEFAULTS, current || {})));
  await ctx.store.kvSet('integrations', merged);
  return getIntegrations(ctx);
}

function status(cfg) {
  return {
    email: !!(cfg.smtp.host && cfg.smtp.user && cfg.smtp.pass),
    whatsapp: cfg.whatsapp.provider !== 'none' && (
      (cfg.whatsapp.provider === 'meta' && cfg.whatsapp.meta.token && cfg.whatsapp.meta.phoneNumberId) ||
      (cfg.whatsapp.provider === 'ultramsg' && cfg.whatsapp.ultramsg.instanceId && cfg.whatsapp.ultramsg.token) ||
      (cfg.whatsapp.provider === 'wati' && cfg.whatsapp.wati.endpoint && cfg.whatsapp.wati.token) ||
      (cfg.whatsapp.provider === 'webhook' && cfg.whatsapp.webhook.url)
    ) ? cfg.whatsapp.provider : false,
    sms: cfg.sms.provider !== 'none' && (
      (cfg.sms.provider === 'fast2sms' && cfg.sms.fast2sms.apiKey) ||
      (cfg.sms.provider === 'twilio' && cfg.sms.twilio.accountSid && cfg.sms.twilio.authToken) ||
      (cfg.sms.provider === 'textlocal' && cfg.sms.textlocal.apiKey)
    ) ? cfg.sms.provider : false,
    imap: !!(cfg.imap.host && cfg.imap.user && cfg.imap.pass),
    gemini: !!cfg.gemini.apiKey,
    google: !!(cfg.google.clientId && cfg.google.clientSecret),
    microsoft: !!(cfg.microsoft.clientId && cfg.microsoft.clientSecret)
  };
}

module.exports = { getIntegrations, setIntegrations, mask, status, DEFAULTS, MASK, RETIRED_MODEL };
