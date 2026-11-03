/*
 * Google Drive (API v3) — OAuth2 web flow + folder-hierarchy uploads with revision history.
 * Scope drive.file: the app can only see files/folders it created (privacy friendly).
 * Folder layout: /<root>/YYYY-MM-DD/<PatientID>_<PatientName>/<files>
 */
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'];
const KV = 'cloud:google';

const folderCache = new Map();

function authUrl(cfg, redirectUri, state) {
  const q = new URLSearchParams({
    client_id: cfg.google.clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state
  });
  return AUTH_URL + '?' + q.toString();
}

async function tokenRequest(params) {
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Google token error: ' + (b.error_description || b.error || r.status));
  return b;
}

async function exchangeCode(ctx, cfg, code, redirectUri) {
  const t = await tokenRequest({ code, client_id: cfg.google.clientId, client_secret: cfg.google.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  let email = '';
  try {
    const ui = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + t.access_token } })).json();
    email = ui.email || '';
  } catch (e) { /* optional */ }
  const saved = { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in || 3600) * 1000, email, connectedAt: Date.now(), scope: t.scope };
  await ctx.store.kvSet(KV, saved);
  folderCache.clear();
  return saved;
}

async function getToken(ctx, cfg) {
  const s = await ctx.store.kvGet(KV, null);
  if (!s || !s.refreshToken) throw Object.assign(new Error('Google Drive not connected'), { code: 'NOT_CONNECTED' });
  if (s.accessToken && s.expiresAt - 60000 > Date.now()) return s.accessToken;
  const t = await tokenRequest({ client_id: cfg.google.clientId, client_secret: cfg.google.clientSecret, refresh_token: s.refreshToken, grant_type: 'refresh_token' });
  s.accessToken = t.access_token;
  s.expiresAt = Date.now() + (t.expires_in || 3600) * 1000;
  await ctx.store.kvSet(KV, s);
  return s.accessToken;
}

async function api(ctx, cfg, url, opts = {}) {
  const token = await getToken(ctx, cfg);
  const r = await fetch(url, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + token }, opts.headers || {}) }));
  if (!r.ok) {
    const txt = await r.text();
    throw new Error('Google Drive ' + r.status + ': ' + txt.slice(0, 300));
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r.text();
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function findChild(ctx, cfg, parentId, name, isFolder) {
  const q = [`name = '${esc(name)}'`, `'${parentId}' in parents`, 'trashed = false'];
  q.push(isFolder ? "mimeType = 'application/vnd.google-apps.folder'" : "mimeType != 'application/vnd.google-apps.folder'");
  const res = await api(ctx, cfg, `${DRIVE}/files?q=${encodeURIComponent(q.join(' and '))}&fields=files(id,name,webViewLink)&spaces=drive`);
  return (res.files || [])[0] || null;
}

async function ensureFolderPath(ctx, cfg, segments) {
  let parent = 'root';
  let key = '';
  for (const seg of segments) {
    key += '/' + seg;
    if (folderCache.has(key)) { parent = folderCache.get(key); continue; }
    let f = await findChild(ctx, cfg, parent, seg, true);
    if (!f) {
      f = await api(ctx, cfg, `${DRIVE}/files?fields=id,name`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: seg, mimeType: 'application/vnd.google-apps.folder', parents: [parent] })
      });
    }
    folderCache.set(key, f.id);
    parent = f.id;
  }
  return parent;
}

function multipartBody(meta, buffer, mimeType) {
  const boundary = 'ssdc' + Math.random().toString(16).slice(2);
  const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--`);
  return { body: Buffer.concat([head, buffer, tail]), contentType: `multipart/related; boundary=${boundary}` };
}

/** Upload or overwrite (Drive keeps the previous revision automatically). */
async function uploadFile(ctx, cfg, { segments, filename, buffer, mimeType, asGoogleDoc }) {
  const folderId = await ensureFolderPath(ctx, cfg, segments);
  const targetName = asGoogleDoc ? filename.replace(/\.(docx?|html?)$/i, '') : filename;
  const existing = await findChild(ctx, cfg, folderId, targetName, false);
  if (existing && !asGoogleDoc) {
    const r = await api(ctx, cfg, `${UPLOAD}/files/${existing.id}?uploadType=media&fields=id,name,webViewLink,version,md5Checksum,size`, {
      method: 'PATCH', headers: { 'Content-Type': mimeType }, body: buffer
    });
    return { id: r.id, link: r.webViewLink, version: r.version, updated: true, meta: r };
  }
  const meta = { name: targetName, parents: [folderId] };
  if (asGoogleDoc) meta.mimeType = 'application/vnd.google-apps.document';
  const mp = multipartBody(meta, buffer, mimeType);
  const r = await api(ctx, cfg, `${UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink,version,md5Checksum,size`, {
    method: 'POST', headers: { 'Content-Type': mp.contentType }, body: mp.body
  });
  return { id: r.id, link: r.webViewLink, version: r.version, updated: false, meta: r, converted: !!asGoogleDoc };
}

/** Remote metadata (md5Checksum, size) of an existing file, without creating folders; null when absent. */
async function fileMeta(ctx, cfg, { segments, filename }) {
  let parent = 'root';
  for (const seg of segments) {
    const f = await findChild(ctx, cfg, parent, seg, true);
    if (!f) return null;
    parent = f.id;
  }
  const q = [`name = '${esc(filename)}'`, `'${parent}' in parents`, 'trashed = false'];
  const res = await api(ctx, cfg, `${DRIVE}/files?q=${encodeURIComponent(q.join(' and '))}&fields=files(id,name,webViewLink,md5Checksum,size,modifiedTime)&spaces=drive`);
  return (res.files || [])[0] || null;
}

async function quota(ctx, cfg) {
  const r = await api(ctx, cfg, `${DRIVE}/about?fields=storageQuota,user(emailAddress,displayName)`);
  return { used: Number(r.storageQuota.usage || 0), total: Number(r.storageQuota.limit || 0), account: r.user && r.user.emailAddress };
}

async function disconnect(ctx) { await ctx.store.kvSet(KV, null); folderCache.clear(); }
async function connection(ctx) { const s = await ctx.store.kvGet(KV, null); return s && s.refreshToken ? { connected: true, account: s.email, connectedAt: s.connectedAt } : { connected: false }; }

module.exports = { authUrl, exchangeCode, uploadFile, fileMeta, quota, disconnect, connection, getToken };
