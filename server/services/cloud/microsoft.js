/*
 * Microsoft OneDrive (Microsoft Graph) — OAuth2 authorization-code flow + mirrored folder hierarchy.
 * Overwriting an existing file creates a new OneDrive version (version history preserved).
 */
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = 'offline_access Files.ReadWrite User.Read';
const KV = 'cloud:microsoft';
const SIMPLE_LIMIT = 4 * 1024 * 1024;
const CHUNK = 320 * 1024 * 10; // multiple of 320 KiB

const ensured = new Set();

const tenantOf = (cfg) => cfg.microsoft.tenant || 'common';

function authUrl(cfg, redirectUri, state) {
  const q = new URLSearchParams({
    client_id: cfg.microsoft.clientId, response_type: 'code', redirect_uri: redirectUri,
    response_mode: 'query', scope: SCOPES, state, prompt: 'select_account'
  });
  return `https://login.microsoftonline.com/${tenantOf(cfg)}/oauth2/v2.0/authorize?` + q.toString();
}

async function tokenRequest(cfg, params) {
  const r = await fetch(`https://login.microsoftonline.com/${tenantOf(cfg)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.assign({ client_id: cfg.microsoft.clientId, client_secret: cfg.microsoft.clientSecret, scope: SCOPES }, params))
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Microsoft token error: ' + (b.error_description || b.error || r.status));
  return b;
}

async function exchangeCode(ctx, cfg, code, redirectUri) {
  const t = await tokenRequest(cfg, { code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  let account = '';
  try {
    const me = await (await fetch(GRAPH + '/me', { headers: { Authorization: 'Bearer ' + t.access_token } })).json();
    account = me.userPrincipalName || me.mail || '';
  } catch (e) { /* optional */ }
  const saved = { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in || 3600) * 1000, account, connectedAt: Date.now() };
  await ctx.store.kvSet(KV, saved);
  ensured.clear();
  return saved;
}

async function getToken(ctx, cfg) {
  const s = await ctx.store.kvGet(KV, null);
  if (!s || !s.refreshToken) throw Object.assign(new Error('OneDrive not connected'), { code: 'NOT_CONNECTED' });
  if (s.accessToken && s.expiresAt - 60000 > Date.now()) return s.accessToken;
  const t = await tokenRequest(cfg, { refresh_token: s.refreshToken, grant_type: 'refresh_token' });
  s.accessToken = t.access_token;
  if (t.refresh_token) s.refreshToken = t.refresh_token;
  s.expiresAt = Date.now() + (t.expires_in || 3600) * 1000;
  await ctx.store.kvSet(KV, s);
  return s.accessToken;
}

async function graph(ctx, cfg, url, opts = {}, okStatuses = []) {
  const token = await getToken(ctx, cfg);
  const r = await fetch(url.startsWith('http') ? url : GRAPH + url, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + token }, opts.headers || {}) }));
  if (!r.ok && !okStatuses.includes(r.status)) {
    const txt = await r.text();
    throw new Error('OneDrive ' + r.status + ': ' + txt.slice(0, 300));
  }
  if (r.status === 204) return {};
  return r.json().catch(() => ({}));
}

const encPath = (segs) => segs.map((s) => encodeURIComponent(s)).join('/');

async function ensureFolders(ctx, cfg, segments) {
  for (let i = 0; i < segments.length; i++) {
    const key = segments.slice(0, i + 1).join('/');
    if (ensured.has(key)) continue;
    const parent = segments.slice(0, i);
    const url = parent.length ? `/me/drive/root:/${encPath(parent)}:/children` : '/me/drive/root/children';
    await graph(ctx, cfg, url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: segments[i], folder: {}, '@microsoft.graph.conflictBehavior': 'fail' })
    }, [409]);
    ensured.add(key);
  }
}

async function uploadFile(ctx, cfg, { segments, filename, buffer, mimeType }) {
  await ensureFolders(ctx, cfg, segments);
  const p = encPath(segments.concat([filename]));
  if (buffer.length <= SIMPLE_LIMIT) {
    const item = await graph(ctx, cfg, `/me/drive/root:/${p}:/content`, { method: 'PUT', headers: { 'Content-Type': mimeType || 'application/octet-stream' }, body: buffer });
    return { id: item.id, link: item.webUrl, size: item.size, meta: item };
  }
  const session = await graph(ctx, cfg, `/me/drive/root:/${p}:/createUploadSession`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace', name: filename } })
  });
  let item = null;
  for (let start = 0; start < buffer.length; start += CHUNK) {
    const end = Math.min(buffer.length, start + CHUNK) - 1;
    const r = await fetch(session.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${buffer.length}` },
      body: buffer.subarray(start, end + 1)
    });
    if (!r.ok && r.status !== 202) throw new Error('OneDrive chunk upload ' + r.status + ': ' + (await r.text()).slice(0, 200));
    if (r.status === 200 || r.status === 201) item = await r.json();
  }
  return { id: item && item.id, link: item && item.webUrl, size: buffer.length, meta: item };
}

/** Remote item (size + file.hashes) of an existing file; null when absent. */
async function itemMeta(ctx, cfg, { segments, filename }) {
  const item = await graph(ctx, cfg, `/me/drive/root:/${encPath(segments.concat([filename]))}?select=id,name,size,file,webUrl`, {}, [404]);
  return item && item.id ? item : null;
}

async function quota(ctx, cfg) {
  const d = await graph(ctx, cfg, '/me/drive');
  return { used: Number((d.quota && d.quota.used) || 0), total: Number((d.quota && d.quota.total) || 0), account: d.owner && d.owner.user && d.owner.user.displayName };
}

async function disconnect(ctx) { await ctx.store.kvSet(KV, null); ensured.clear(); }
async function connection(ctx) { const s = await ctx.store.kvGet(KV, null); return s && s.refreshToken ? { connected: true, account: s.account, connectedAt: s.connectedAt } : { connected: false }; }

module.exports = { authUrl, exchangeCode, uploadFile, itemMeta, quota, disconnect, connection };
