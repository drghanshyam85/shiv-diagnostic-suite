// Dispatch engine shared by the Send dialog, the Dispatch Center, auto-send rules and 1-click resend:
// attachment plans (report / invoice / combined as one PDF or two files; PDF or MS Word), secure
// links, template-filled messages per channel, multi-channel sending (silent API or deep link),
// "sent" stamps on the source document and the dispatch log.
import { store, events } from '../../core/store';
import { isServer, emitEvent } from '../../core/sync';
import { getSettings } from '../../core/hooks';
import { can } from '../../core/auth';
import { fillTemplate, pickTemplate, patientInvoiceLink, clinicVars, waLink } from '../../core/share';
import { send, dispatchMode, logDispatch } from '../../core/dispatch';
import { fullName, dateKey, downloadBlob, lsGet, lsSet, validMobile, fmtTime } from '../../core/utils';
import { makeFile, invoiceFor, patientFor, varsFor, storeFile, secureLink, categoryOf, docTitle, isSigned, KIND_LABEL } from './outputs';

export const CHANNELS = ['whatsapp', 'sms', 'email'];
export const CH_LABEL = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'E-mail' };
export const REF_COLL = { usg: 'reports', lab: 'labReports', invoice: 'invoices', file: 'files' };
export const RESULT_TONE = { sent: 'emerald', opened: 'brand', blocked: 'amber', failed: 'rose', skipped: 'slate', pending: 'violet' };

export function canDispatch() { return can('print:dispatch_signed_reports', 'DRAFT') || can('billing:create_invoice'); }

/** Who may send a report that is not signed yet (it carries a DRAFT / PROVISIONAL watermark). */
export function canSendUnsigned(kind) {
  if (kind === 'usg') return can('usg:sign_and_lock_report');
  if (kind === 'lab') return can('lab:verify_and_sign_report');
  return true;
}

export function recipientsFor(kind, doc) {
  const p = patientFor(kind, doc) || {};
  return { mobile: String(p.mobile || (doc && doc.mobile) || '').replace(/\D/g, '').slice(-10), email: p.email || (doc && doc.email) || '' };
}

/**
 * Which files travel with the message.
 * sel: 'report' | 'invoice' | 'combined'; combine: 'merged' (one PDF) | 'separate' (two files); format: 'pdf' | 'docx'
 */
export function attachmentPlan({ kind, sel = 'report', combine = 'merged', format = 'pdf' }) {
  if (kind === 'invoice') return [{ part: 'invoice', format: 'pdf' }];
  if (kind === 'file') return [{ part: 'report', format: format === 'pdf' ? 'pdf' : 'original' }];
  if (sel === 'invoice') return [{ part: 'invoice', format: 'pdf' }];
  if (sel === 'combined') return combine === 'separate' || format === 'docx' ? [{ part: 'report', format }, { part: 'invoice', format: 'pdf' }] : [{ part: 'merged', format: 'pdf' }];
  return [{ part: 'report', format }];
}
const contentStamp = (kind, doc) => (kind === 'usg' ? doc.signedAt || doc.updatedAt : kind === 'lab' ? doc.verifiedAt || doc.updatedAt : doc.updatedAt) || 0;

/** Generate the planned files: [{ blob, filename, part, format, fileId? }] */
export async function prepareFiles({ kind, doc, plan, settings = getSettings() }) {
  const out = [];
  for (const it of plan) out.push(await makeFile({ kind, doc, part: it.part, format: it.format, settings }));
  return out;
}

/**
 * LAN server: upload the files (re-using an earlier upload of identical content) and create an expiring
 * secure link for the first one; the invoice part also gets the patient web-receipt link.
 */
export async function prepareLinks({ kind, doc, sel = 'report', combine, format, settings = getSettings(), ttlHours = 24 * (Number(settings.dispatch.linkDays) || 7), files }) {
  const plan = attachmentPlan({ kind, sel, combine, format });
  const out = { report: '', invoice: '', expiresAt: 0, files: files || null };
  const inv = invoiceFor(kind, doc);
  if (inv && (kind === 'invoice' || plan.some((x) => x.part !== 'report'))) {
    const tm = {};
    store.list('tests').forEach((t) => { tm[t.id] = t; });
    out.invoice = await patientInvoiceLink(inv, settings, tm);
  }
  if (!isServer()) return out;
  if (kind === 'file' && doc.storage !== 'local' && plan[0].format === 'original') {
    out.files = [{ fileId: doc.id, filename: doc.name, part: 'report', format: 'original' }];
  } else if (kind !== 'invoice') {
    const stamp = contentStamp(kind, doc);
    const prev = plan.map((it) => store.list('files').find((f) => f.ref === doc.id && f.refColl === REF_COLL[kind] && f.part === it.part && f.format === it.format && f.storage !== 'local' && (f.createdAt || 0) >= stamp));
    if (prev.every(Boolean) && !files) {
      out.files = prev.map((f) => ({ fileId: f.id, filename: f.name, part: f.part, format: f.format }));
    } else {
      const made = files || (await prepareFiles({ kind, doc, plan, settings }));
      out.files = [];
      for (const f of made) {
        if (f.fileId) { out.files.push(f); continue; }
        const up = await storeFile(f.blob, f.filename, {
          kind: kind + '-' + f.part, part: f.part, format: f.format, category: categoryOf(kind, doc), refColl: REF_COLL[kind], ref: doc.id,
          patientId: doc.patientId || '', patientName: fullName(patientFor(kind, doc)) || '', source: 'generated'
        });
        out.files.push(Object.assign({}, f, { fileId: up.id }));
      }
    }
  } else return out;
  const link = await secureLink(out.files[0].fileId, ttlHours);
  out.report = link.url;
  out.expiresAt = link.expiresAt;
  return out;
}

const fallbackBody = (vars, kind) => (kind === 'invoice'
  ? `Dear ${vars.Patient_Name}, your invoice ${vars.Invoice_No} of Rs.${vars.Total_Amount} (${vars.Payment_Status}). Receipt: ${vars.Invoice_Link} – ${vars.Center_Name}`
  : `Dear ${vars.Patient_Name}, your ${vars.Test_Name} report is ready.${vars.Secure_Download_Link ? ' Download: ' + vars.Secure_Download_Link : ''} – ${vars.Center_Name}`);

/** Branded HTML e-mail body: clinic header, the message, doctor signature block. */
export function emailHtml(text, settings = getSettings()) {
  const c = settings.clinic;
  const esc = (x) => String(x || '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const body = esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0369a1">$1</a>').replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;max-width:640px">
  <div style="border-bottom:3px solid #0284c7;padding:10px 0 8px"><div style="font-size:18px;font-weight:800;color:#0c4a6e">${esc(c.name)}</div><div style="font-size:12px;color:#475569">${esc(c.address)}<br>☎ ${esc([c.phone, c.phone2].filter(Boolean).join(', '))} · ${esc(c.email)}</div></div>
  <div style="padding:14px 0;line-height:1.55">${body}</div>
  <div style="border-top:1px solid #e2e8f0;padding-top:8px;font-size:12px;color:#475569"><b>${esc(c.radiologist.name)}</b>, ${esc(c.radiologist.qualification)} · ${esc(c.radiologist.designation)} · RMC ${esc(c.radiologist.rmc)}<br><b>${esc(c.pathologist.name)}</b>, ${esc(c.pathologist.qualification)} · ${esc(c.pathologist.designation)} · RMC ${esc(c.pathologist.rmc)}<br><span style="color:#94a3b8">This message contains confidential medical information intended only for the patient named above.</span></div>
</div>`;
}

/** { whatsapp:{body}, sms:{body}, email:{subject, body} } from the message templates. */
export function buildMessages({ kind, doc, sel, lang, links = {}, settings = getSettings() }) {
  const vars = varsFor(kind, doc, settings, links);
  const tKind = kind === 'invoice' || sel === 'invoice' ? 'invoice' : 'report';
  const out = {};
  CHANNELS.forEach((c) => {
    const t = pickTemplate(c, tKind, lang);
    let body = t ? fillTemplate(t.body, vars) : fallbackBody(vars, tKind);
    // combined send: make sure the invoice receipt link travels with the report message
    if (sel === 'combined' && links.invoice && !/\{\{\s*Invoice_Link\s*\}\}/.test((t && t.body) || '') && c !== 'sms') body += '\n🧾 ' + (lang === 'hi' ? 'रसीद' : 'Receipt') + ': ' + links.invoice;
    out[c] = {
      body, subject: t && t.subject ? fillTemplate(t.subject, vars) : (tKind === 'invoice' ? 'Invoice ' + vars.Invoice_No : 'Your ' + (vars.Test_Name || 'report')) + ' – ' + settings.clinic.name,
      template: t ? t.name : 'Built-in ' + (tKind === 'invoice' ? 'invoice' : 'report') + ' message', templateId: t ? t.id : ''
    };
  });
  return out;
}

function stampSent(kind, doc, plan, results, entry) {
  const okCh = Object.keys(results).filter((k) => results[k] === 'sent' || results[k] === 'opened');
  if (!okCh.length) return;
  const coll = REF_COLL[kind];
  const cur = store.get(coll, doc.id);
  const at = Date.now();
  const logItem = { at, by: entry.by, channels: okCh, sel: entry.sel, link: entry.link || '', dl: entry.id };
  if (cur) {
    if (kind === 'invoice') {
      const sent = Object.assign({}, cur.sent || {});
      okCh.forEach((c) => { sent[c] = at; });
      store.put(coll, Object.assign({}, cur, { sent, sentLog: (cur.sentLog || []).concat([logItem]).slice(-30) }));
    } else if (plan.some((x) => x.part !== 'invoice')) {
      store.put(coll, Object.assign({}, cur, { sent: true, sentLog: (cur.sentLog || []).concat([logItem]).slice(-30) }));
    }
  }
  if (kind !== 'invoice' && plan.some((x) => x.part !== 'report')) {
    const inv = invoiceFor(kind, doc);
    if (inv) {
      const sent = Object.assign({}, inv.sent || {});
      okCh.forEach((c) => { sent[c] = at; });
      store.put('invoices', Object.assign({}, inv, { sent }));
    }
  }
}

/**
 * Send one document over the chosen channels.
 * opts: { kind, doc, sel, combine, format, channels:{whatsapp,sms,email}, to:{mobile,email}, lang, messages, links, files, attach, trigger, resendOf }
 * → { results:{channel: sent|opened|blocked|failed|skipped}, errors, entry }
 */
export async function dispatchDocument(opts) {
  const settings = getSettings();
  const { kind, doc, sel = 'report', combine = 'merged', format = 'pdf', to = {}, lang = 'en', trigger = 'manual' } = opts;
  const chosen = CHANNELS.filter((c) => opts.channels && opts.channels[c]);
  if (!chosen.length) throw new Error('Choose at least one channel');
  const plan = attachmentPlan({ kind, sel, combine, format });
  const links = opts.links || { report: '', invoice: '' };
  const messages = opts.messages || buildMessages({ kind, doc, sel, lang, links, settings });
  const variables = varsFor(kind, doc, settings, links);
  let files = opts.files || (links.files && links.files.length ? links.files : null);
  const getFiles = async () => {
    if (!files || files.some((f) => !f.blob && !f.fileId)) files = await prepareFiles({ kind, doc, plan, settings });
    return files;
  };
  const results = {};
  const errors = {};
  const providerIds = {};
  const delivery = {};
  let downloaded = false;
  for (const c of chosen) {
    const dest = c === 'email' ? to.email : to.mobile;
    if (!dest || (c !== 'email' && !validMobile(dest)) || (c === 'email' && !/\S+@\S+\.\S+/.test(dest))) { results[c] = 'skipped'; errors[c] = 'no valid ' + (c === 'email' ? 'e-mail' : 'mobile'); continue; }
    try {
      const mode = dispatchMode(c);
      let attachments = [];
      if (mode === 'api' && c !== 'sms' && opts.attach !== false) {
        attachments = (await getFiles()).map((f) => (f.fileId ? { fileId: f.fileId, filename: f.filename } : { blob: f.blob, filename: f.filename }));
      }
      // Deep links cannot carry files: without a secure link, hand the file(s) to the user to attach manually
      if (mode === 'deeplink' && !links.report && kind !== 'invoice' && !downloaded && opts.downloadForDeepLink !== false) {
        for (const f of await getFiles()) if (f.blob) downloadBlob(f.filename, f.blob);
        downloaded = true;
      }
      const m = messages[c] || {};
      const r = await send(c, { to: dest, message: m.body, subject: m.subject, html: c === 'email' ? emailHtml(m.body, settings) : undefined, attachments, variables, ref: REF_COLL[kind] + '/' + doc.id, gmail: c === 'email' && settings.dispatch.gmailCompose });
      results[c] = r.mode === 'api' ? 'sent' : r.ok ? 'opened' : 'blocked';
      if (r.mode === 'api') {
        if (r.ids && r.ids.length) providerIds[c] = r.ids;
        delivery[c] = { status: 'sent', at: Date.now(), provider: r.provider || '' };
      }
    } catch (e) { results[c] = 'failed'; errors[c] = e.message; delivery[c] = { status: 'failed', at: Date.now(), error: e.message }; }
  }
  const p = patientFor(kind, doc) || {};
  const vals = Object.values(results);
  const inv = invoiceFor(kind, doc);
  const entry = logDispatch({
    kind, refColl: REF_COLL[kind], ref: doc.id, title: docTitle(kind, doc), patientId: doc.patientId || '', patientRegId: p.regId || '', patientName: fullName(p) || doc.patientName || '',
    mobile: to.mobile || '', email: to.email || '', department: categoryOf(kind, doc), docType: KIND_LABEL[kind], sel, combine, format: plan.map((x) => (x.format === 'original' ? String((doc.name || '').split('.').pop() || 'file').toUpperCase() : x.format.toUpperCase())).join(' + '),
    fileNames: (files || []).map((f) => f.filename), fileIds: (files || []).map((f) => f.fileId).filter(Boolean), invoiceStatus: inv ? inv.status : '', invoiceNo: inv ? inv.invoiceNo : '',
    channels: results, errors, modes: Object.fromEntries(chosen.map((c) => [c, dispatchMode(c)])), link: links.report || '', invoiceLink: links.invoice || '',
    lang, trigger, resendOf: opts.resendOf || null, signed: isSigned(kind, doc),
    messages: Object.fromEntries(chosen.map((c) => [c, { body: String((messages[c] || {}).body || '').slice(0, 4000), subject: (messages[c] || {}).subject || '' }])),
    templates: Object.fromEntries(chosen.map((c) => [c, (messages[c] || {}).template || (opts.messages ? 'Edited message' : '')])),
    providerIds, delivery, deliveryStatus: deliveryOf(delivery),
    status: vals.every((v) => v === 'sent' || v === 'opened') ? 'sent' : vals.some((v) => v === 'sent' || v === 'opened') ? 'partial' : 'failed'
  });
  stampSent(kind, doc, plan, results, entry);
  alertFailures(entry);
  return { results, errors, entry };
}

export const summarize = (results) => Object.entries(results).map(([c, r]) => CH_LABEL[c] + ': ' + r).join(' · ');

// ---------------------------------------------------------------- delivery tracking
// API sends record the provider's message id; delivery receipts (WhatsApp Cloud API webhook or a
// gateway's status callback → /api/webhooks/…) then move each channel sent → delivered → read, or failed.
export const DELIVERY_LABEL = { sent: 'Sent', accepted: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed' };
export const DELIVERY_TONE = { sent: 'slate', accepted: 'slate', delivered: 'emerald', read: 'brand', failed: 'rose' };
export function deliveryOf(delivery) {
  const vals = Object.values(delivery || {}).map((d) => d.status);
  if (!vals.length) return '';
  if (vals.includes('failed')) return 'failed';
  if (vals.every((v) => v === 'read')) return 'read';
  if (vals.every((v) => v === 'read' || v === 'delivered')) return 'delivered';
  return 'sent';
}
/** A channel that failed to send now or failed to deliver later (and was not resent since). */
export function failedChannels(entry) {
  if (!entry || entry.resentAt) return [];
  const res = logChannels(entry);
  const d = entry.delivery || {};
  return Object.keys(Object.assign({}, res, d)).filter((c) => res[c] === 'failed' || (d[c] && d[c].status === 'failed'));
}
/** Tell every other workstation (front desk, reporting rooms) when a message could not be sent. */
export function alertFailures(entry) {
  const bad = Object.keys(entry.channels || {}).filter((c) => entry.channels[c] === 'failed');
  if (!bad.length) return;
  const why = bad.map((c) => (entry.errors && entry.errors[c] ? CH_LABEL[c] + ': ' + entry.errors[c] : CH_LABEL[c])).join(' · ');
  emitEvent('notify', { type: 'error', text: 'Could not send ' + (entry.docType || 'message') + ' to ' + (entry.patientName || entry.mobile || 'patient') + ' — ' + why + '. Resend from Dispatch Center.' });
}

/** The document a dispatch log row points to (live copy). */
export function logDoc(entry) {
  const kind = entry.kind === 'report' ? 'usg' : entry.kind;
  const coll = REF_COLL[kind] || entry.refColl;
  return { kind, doc: coll ? store.get(coll, entry.ref) : null };
}

export const logChannels = (entry) => (entry.channels && !Array.isArray(entry.channels) ? entry.channels : Object.fromEntries((entry.channels || []).map((c) => [c, 'sent'])));

/** 1-click resend of a dispatch log row (same message, same recipient; failed channels by default). */
export async function resendLog(entry, channels) {
  const { kind, doc } = logDoc(entry);
  if (!doc) throw new Error('The original document no longer exists');
  const res = logChannels(entry);
  const pick = channels || Object.keys(res).filter((c) => res[c] !== 'sent');
  const list = pick.length ? pick : Object.keys(res);
  const sel = entry.sel || (kind === 'invoice' ? 'invoice' : 'report');
  const format = /DOCX/.test(entry.format || '') ? 'docx' : 'pdf';
  let links = { report: entry.link || '', invoice: entry.invoiceLink || '' };
  let files = (entry.fileIds || []).length ? entry.fileIds.map((id, i) => ({ fileId: id, filename: (entry.fileNames || [])[i] || 'document.pdf' })) : null;
  if (!links.report && isServer() && kind !== 'invoice') { links = await prepareLinks({ kind, doc, sel, combine: entry.combine, format }); files = links.files; }
  const msgs = entry.messages && Object.keys(entry.messages).length ? entry.messages : null;
  const out = await dispatchDocument({
    kind, doc, sel, combine: entry.combine, format, lang: entry.lang || 'en', trigger: 'resend', resendOf: entry.id, links, files,
    channels: Object.fromEntries(list.map((c) => [c, true])), to: { mobile: entry.mobile, email: entry.email },
    messages: msgs ? Object.assign(buildMessages({ kind, doc, sel, lang: entry.lang || 'en', links }), msgs) : null
  });
  const cur = store.get('dispatchLog', entry.id);
  if (cur) store.put('dispatchLog', Object.assign({}, cur, { resentAt: Date.now(), resentAs: out.entry.id }));
  return out;
}

// ---------------------------------------------------------------- auto-send rules
/** Channels configured for auto-send that can be sent silently through server APIs right now. */
export function silentChannels(settings = getSettings()) {
  const want = settings.dispatch.channels || {};
  return CHANNELS.filter((c) => want[c] && dispatchMode(c) === 'api');
}

/**
 * Rule hook. trigger: 'onSigned' | 'onUpload' | 'onEmailImport' | 'scheduled'.
 * Silent API send when providers are configured; otherwise opens the Send dialog (interactive
 * triggers) or queues the document for 1-click sending in the Dispatch Center (background triggers).
 */
export async function autoDispatch(kind, doc, trigger, { interactive = true, sel = 'report' } = {}) {
  const settings = getSettings();
  const rules = settings.dispatch.rules || {};
  if (settings.dispatch.autoMode === false) return { skipped: 'auto-send mode off' };
  if (trigger !== 'scheduled' && !rules[trigger]) return { skipped: 'rule off' };
  const to = recipientsFor(kind, doc);
  const want = CHANNELS.filter((c) => (settings.dispatch.channels || {})[c] && (c === 'email' ? to.email : validMobile(to.mobile)));
  if (!want.length) {
    if (interactive) { events.emit('dispatch:open', { kind, doc, sel, trigger }); return { opened: true }; }
    queuePending(kind, doc, trigger, 'no patient mobile / e-mail');
    return { queued: true };
  }
  const silent = silentChannels(settings).filter((c) => want.includes(c));
  if (silent.length === want.length) {
    try {
      const format = kind === 'file' && settings.dispatch.convertDocxToPdf !== false ? 'pdf' : kind === 'file' ? 'original' : 'pdf';
      const links = await prepareLinks({ kind, doc, sel, format }).catch(() => ({}));
      const r = await dispatchDocument({ kind, doc, sel, format, to, lang: settings.dispatch.defaultLanguage || 'en', links, trigger, channels: Object.fromEntries(silent.map((c) => [c, true])), downloadForDeepLink: false });
      events.emit('toast', { type: r.entry.status === 'failed' ? 'error' : 'success', text: 'Auto-sent ' + KIND_LABEL[kind] + ' (' + docTitle(kind, doc) + ') · ' + summarize(r.results) });
      if (r.entry.status !== 'failed') clearPending(kind, doc.id);
      return r;
    } catch (e) {
      events.emit('toast', { type: 'error', text: 'Auto-send failed: ' + e.message });
      queuePending(kind, doc, trigger, e.message);
      return { error: e.message };
    }
  }
  if (interactive) { events.emit('dispatch:open', { kind, doc, sel, trigger }); return { opened: true }; }
  queuePending(kind, doc, trigger, 'deep-link mode — needs one click');
  return { queued: true };
}

// ---------------------------------------------------------------- patient notices (text only)
const SAMPLE_FALLBACK = 'Dear {{Patient_Name}}, your sample (ID {{Sample_ID}}) for {{Test_Name}} was collected at {{Collected_At}}. Expected report: {{Report_ETA}}. – {{Center_Name}}, {{Center_Phone}}';

/** Expected report time from the tests' turnaround in the rate list (e.g. "Same day 6 PM"). */
export function reportEta(tests) {
  const tm = {};
  store.list('tests').forEach((t) => { tm[t.id] = t; });
  const tats = Array.from(new Set((tests || []).map((t) => (tm[t.testId] || {}).tat).filter(Boolean)));
  return tats.length ? tats.join(' / ') : 'same day';
}

/**
 * Rule 5: tell the patient the sample was collected and when to expect the report. Configured
 * WhatsApp / SMS APIs send at once; in deep-link mode the result carries a WhatsApp `link` for a
 * one-click send. Every attempt is written to the dispatch log.
 */
export async function notifySampleCollected(rep, { force = false } = {}) {
  const settings = getSettings();
  const rules = settings.dispatch.rules || {};
  if (!force && (settings.dispatch.autoMode === false || !rules.onSampleCollected)) return { skipped: 'rule off' };
  const p = rep.patient || {};
  if (!validMobile(p.mobile)) return { skipped: 'no mobile number' };
  const vars = Object.assign(clinicVars(settings), {
    Patient_Name: fullName(p), Sample_ID: rep.sampleId || '', Test_Name: (rep.tests || []).map((t) => t.name).join(', '),
    Collected_At: fmtTime(rep.sampleCollectedAt || Date.now()), Report_ETA: reportEta(rep.tests), Date: dateKey()
  });
  const lang = settings.dispatch.defaultLanguage || 'en';
  const want = ['whatsapp', 'sms'].filter((c) => (settings.dispatch.channels || {})[c]);
  if (!want.length) want.push('whatsapp');
  const results = {};
  const errors = {};
  const messages = {};
  const templates = {};
  const providerIds = {};
  const delivery = {};
  let link = null;
  for (const c of want) {
    const t = pickTemplate(c, 'sample', lang);
    const body = fillTemplate(t ? t.body : SAMPLE_FALLBACK, vars);
    messages[c] = { body };
    templates[c] = t ? t.name : 'Built-in sample notice';
    if (dispatchMode(c) === 'api') {
      try {
        const r = await send(c, { to: p.mobile, message: body, ref: 'labReports/' + rep.id, variables: vars });
        results[c] = 'sent';
        if (r.ids && r.ids.length) providerIds[c] = r.ids;
        delivery[c] = { status: 'sent', at: Date.now(), provider: r.provider || '' };
      } catch (e) { results[c] = 'failed'; errors[c] = e.message; delivery[c] = { status: 'failed', at: Date.now(), error: e.message }; }
    } else if (c === 'whatsapp') { link = waLink(p.mobile, body); results[c] = 'pending'; }
  }
  const vals = Object.values(results);
  const entry = logDispatch({
    kind: 'notice', refColl: 'labReports', ref: rep.id, title: 'Sample collected · ' + (rep.sampleId || ''), patientId: rep.patientId || '', patientRegId: p.regId || '',
    patientName: fullName(p), mobile: p.mobile, department: 'Pathology', docType: 'Sample collected', channels: results, errors, trigger: 'onSampleCollected', lang,
    template: 'sample', templates, messages, providerIds, delivery, deliveryStatus: deliveryOf(delivery),
    status: vals.every((v) => v === 'sent') ? 'sent' : vals.some((v) => v === 'sent') ? 'partial' : vals.every((v) => v === 'pending') ? 'pending' : 'failed'
  });
  alertFailures(entry);
  return { results, link };
}

// documents waiting for a manual 1-click send (deep-link mode background rules), kept per workstation
const PENDING_KEY = 'ssdc-pref:dispatch-pending';
export function pendingList() { return lsGet(PENDING_KEY, []); }
export function queuePending(kind, doc, trigger, reason) {
  const list = pendingList().filter((x) => !(x.kind === kind && x.ref === doc.id));
  list.unshift({ kind, ref: doc.id, trigger, reason: reason || '', at: Date.now(), title: docTitle(kind, doc) });
  lsSet(PENDING_KEY, list.slice(0, 300));
  events.emit('dispatch:pending');
}
export function clearPending(kind, ref) {
  const list = pendingList();
  const next = list.filter((x) => !(x.kind === kind && x.ref === ref));
  if (next.length !== list.length) { lsSet(PENDING_KEY, next); events.emit('dispatch:pending'); }
}

/** Today's signed reports (USG + lab) not sent yet — the evening batch. */
export function unsentToday(day = dateKey()) {
  const out = [];
  store.list('reports').forEach((r) => { if (r.status === 'SIGNED_FINAL' && !r.sent && r.signedAt && dateKey(r.signedAt) === day) out.push({ kind: 'usg', doc: r }); });
  store.list('labReports').forEach((r) => { if (r.status === 'SIGNED_FINAL' && !r.sent && r.verifiedAt && dateKey(r.verifiedAt) === day) out.push({ kind: 'lab', doc: r }); });
  return out;
}

export const BATCH_HOST_KEY = 'ssdc-pref:dispatch-batch-host';
export const isBatchHost = () => !!lsGet(BATCH_HOST_KEY, false);
export const lastBatch = () => lsGet('ssdc-pref:dispatch-batch-last', null);

/** Run the scheduled batch (silent API where possible, the rest is queued for 1-click sending). */
export async function runBatch({ day = dateKey(), manual = false } = {}) {
  const items = unsentToday(day);
  let sent = 0;
  let queued = 0;
  for (const it of items) {
    const r = await autoDispatch(it.kind, it.doc, 'scheduled', { interactive: false });
    if (r && r.entry) sent++; else if (r && r.queued) queued++;
  }
  lsSet('ssdc-pref:dispatch-batch-last', { day, at: Date.now(), sent, queued, total: items.length, manual });
  events.emit('dispatch:pending');
  return { total: items.length, sent, queued };
}

/** Called every minute by the DispatchHost on the designated workstation. */
export function maybeRunScheduled() {
  const s = getSettings();
  if (!s.dispatch.rules || !s.dispatch.rules.scheduled || !isBatchHost()) return;
  const [hh, mm] = String(s.dispatch.rules.scheduledTime || '18:00').split(':').map(Number);
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() < hh * 60 + (mm || 0)) return;
  const last = lastBatch();
  if (last && last.day === dateKey() && !last.manual) return;
  runBatch().then((r) => { if (r.total) events.emit('toast', { type: 'info', text: `Scheduled dispatch batch: ${r.sent} sent, ${r.queued} waiting for 1-click send` }); });
}

export const openSend = (kind, doc, sel) => events.emit('dispatch:open', { kind, doc, sel: sel || (kind === 'invoice' ? 'invoice' : 'report') });
