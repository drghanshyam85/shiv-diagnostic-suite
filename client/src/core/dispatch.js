// Omnichannel dispatch: WhatsApp / SMS / Email via server APIs (silent, with attachments) or deep links.
import { api, net } from './sync';
import { store } from './store';
import { getSettings } from './hooks';
import { waLink, smsLink, mailtoLink, gmailLink, openExternal } from './share';
import { blobToBase64, uid, stripHtml } from './utils';
import { currentUser, logAudit } from './auth';

export function apiChannels() {
  const st = net.integrations || {};
  return { whatsapp: !!st.whatsapp, sms: !!st.sms, email: !!st.email };
}

export function dispatchMode(channel) {
  const s = getSettings();
  if (net.mode !== 'server' || s.dispatch.mode !== 'api') return 'deeplink';
  return apiChannels()[channel] ? 'api' : 'deeplink';
}

/**
 * send(channel, { to, message, subject, html, attachments:[{blob, filename} | {fileId}], variables, gmail }) → { ok, mode, detail }
 * variables: placeholder values for WhatsApp templates / DLT SMS templates on the server
 */
export async function send(channel, msg) {
  const mode = msg.forceDeepLink ? 'deeplink' : dispatchMode(channel);
  if (mode === 'api') {
    const attachments = [];
    for (const a of msg.attachments || []) {
      if (a.fileId) attachments.push({ fileId: a.fileId, filename: a.filename });
      else if (a.blob) attachments.push({ filename: a.filename, contentType: a.blob.type || 'application/pdf', base64: await blobToBase64(a.blob) });
    }
    const body = channel === 'email'
      ? { to: msg.to, subject: msg.subject, text: msg.message, html: msg.html || '<div style="font-family:Arial;font-size:14px;white-space:pre-line">' + String(msg.message || '').replace(/</g, '&lt;') + '</div>', attachments, ref: msg.ref }
      : { to: msg.to, message: msg.message, attachments: channel === 'whatsapp' ? attachments : [], ref: msg.ref, variables: msg.variables };
    const r = await api('dispatch/' + channel, { method: 'POST', body, timeout: 120000 });
    // provider message ids let delivery receipts (webhooks) find this message later
    const ids = (Array.isArray(r.ids) ? r.ids : r.id ? [r.id] : []).filter(Boolean).map(String);
    return { ok: true, mode, detail: r.provider || 'sent', provider: r.provider, ids };
  }
  let url;
  if (channel === 'whatsapp') url = waLink(msg.to, msg.message);
  else if (channel === 'sms') url = smsLink(msg.to, msg.message);
  else url = msg.gmail ? gmailLink(msg.to, msg.subject, msg.message) : mailtoLink(msg.to, msg.subject, msg.message);
  const ok = openExternal(url);
  return { ok, mode, detail: ok ? 'opened' : 'popup blocked' };
}

export function logDispatch(entry) {
  const u = currentUser();
  const doc = store.put('dispatchLog', Object.assign({ id: uid('dl_'), at: Date.now(), by: u ? u.id : null, byName: u ? u.name : '' }, entry));
  logAudit('dispatch:' + (entry.kind || 'message'), (entry.refColl || 'dispatchLog') + '/' + (entry.ref || doc.id), { channels: entry.channels, to: entry.mobile || entry.email });
  return doc;
}

export const htmlToText = stripHtml;
