/*
 * Email Report Importer — pulls report attachments (.pdf / .docx / .doc / .rtf / .html) from an
 * IMAP inbox (Gmail: imap.gmail.com:993 with an App Password) and stores them as files.
 */
const crypto = require('crypto');

const WANTED = /\.(pdf|docx?|rtf|html?|odt|txt)$/i;

async function fetchReportAttachments(cfg, opts = {}) {
  const { ImapFlow } = require('imapflow');
  const { simpleParser } = require('mailparser');
  const im = cfg.imap;
  if (!im.host || !im.user || !im.pass) throw new Error('IMAP inbox is not configured (Settings → Integrations → Email Inbox)');
  const client = new ImapFlow({
    host: im.host, port: Number(im.port) || 993, secure: im.secure !== false,
    auth: { user: im.user, pass: im.pass }, logger: false
  });
  const sinceDays = Math.max(1, Math.min(90, Number(opts.sinceDays) || 7));
  const max = Math.max(1, Math.min(200, Number(opts.max) || 40));
  const since = new Date(Date.now() - sinceDays * 86400000);
  const out = [];
  await client.connect();
  const lock = await client.getMailboxLock(im.mailbox || 'INBOX');
  try {
    let uids = await client.search({ since }, { uid: true });
    uids = (uids || []).slice(-max);
    for (const uid of uids) {
      const msg = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const parsed = await simpleParser(msg.source);
      const attachments = (parsed.attachments || []).filter((a) => WANTED.test(a.filename || '') || /pdf|word|officedocument|rtf/.test(a.contentType || ''));
      if (!attachments.length) continue;
      const messageId = parsed.messageId || ('uid-' + uid);
      out.push({
        key: crypto.createHash('sha1').update(messageId).digest('hex').slice(0, 20),
        messageId,
        uid,
        from: parsed.from ? parsed.from.text : '',
        to: parsed.to ? parsed.to.text : '',
        subject: parsed.subject || '',
        date: parsed.date ? parsed.date.getTime() : Date.now(),
        text: String(parsed.text || '').slice(0, 4000),
        attachments: attachments.map((a) => ({ filename: a.filename || 'attachment', contentType: a.contentType || 'application/octet-stream', size: a.size, buffer: a.content }))
      });
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return out;
}

module.exports = { fetchReportAttachments };
