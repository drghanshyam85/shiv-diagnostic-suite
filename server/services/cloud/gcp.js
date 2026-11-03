/*
 * Google Cloud — service-account authentication (RS256 JWT assertion) for
 *   Firestore  : structured records (patients, invoices, reports metadata, templates, billing logs)
 *   Cloud Storage: raw scan images (JPEG/DICOM) and generated report files
 */
const crypto = require('crypto');

const KV = 'cloud:gcp:sa';
const SCOPES = ['https://www.googleapis.com/auth/datastore', 'https://www.googleapis.com/auth/devstorage.read_write'];
let tokenCache = { token: null, exp: 0 };

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

async function saveServiceAccount(ctx, json) {
  const sa = typeof json === 'string' ? JSON.parse(json) : json;
  if (!sa || !sa.client_email || !sa.private_key) throw new Error('Invalid service-account JSON (client_email / private_key missing)');
  await ctx.store.kvSet(KV, sa);
  tokenCache = { token: null, exp: 0 };
  return { clientEmail: sa.client_email, projectId: sa.project_id };
}

async function getToken(ctx) {
  if (tokenCache.token && tokenCache.exp - 60000 > Date.now()) return tokenCache.token;
  const sa = await ctx.store.kvGet(KV, null);
  if (!sa) throw Object.assign(new Error('Google Cloud service account not configured'), { code: 'NOT_CONNECTED' });
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPES.join(' '), aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(header + '.' + claims);
  const sig = b64url(signer.sign(sa.private_key));
  const r = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: header + '.' + claims + '.' + sig })
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('GCP token error: ' + (b.error_description || b.error || r.status));
  tokenCache = { token: b.access_token, exp: Date.now() + (b.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

function toFirestore(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v.length > 900000 ? v.slice(0, 900000) + '…[truncated]' : v };
  if (Array.isArray(v)) return { arrayValue: { values: v.slice(0, 2000).map(toFirestore) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) if (!k.startsWith('__')) fields[k.replace(/[`.\/\[\]*~]/g, '_') || '_'] = toFirestore(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

async function firestoreUpsert(ctx, projectId, coll, id, doc) {
  const token = await getToken(ctx);
  const safeId = encodeURIComponent(String(id).replace(/\//g, '_'));
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/ssdc_${coll}/${safeId}`;
  const body = JSON.stringify({ fields: toFirestore(doc).mapValue.fields });
  if (body.length > 1000000) throw new Error('Record exceeds Firestore 1 MB limit');
  const r = await fetch(url, { method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body });
  if (!r.ok) throw new Error('Firestore ' + r.status + ': ' + (await r.text()).slice(0, 300));
  return { link: `https://console.cloud.google.com/firestore/databases/-default-/data/panel/ssdc_${coll}/${safeId}?project=${projectId}` };
}

async function gcsUpload(ctx, bucket, objectPath, buffer, mimeType) {
  const token = await getToken(ctx);
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`;
  const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': mimeType || 'application/octet-stream' }, body: buffer });
  if (!r.ok) throw new Error('Cloud Storage ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const o = await r.json();
  return { id: o.id, link: `https://console.cloud.google.com/storage/browser/_details/${bucket}/${encodeURIComponent(objectPath)}`, generation: o.generation, meta: o };
}

/** Object metadata (md5Hash, size) or null when the object does not exist. */
async function gcsMeta(ctx, bucket, objectPath) {
  const token = await getToken(ctx);
  const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}`, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Cloud Storage ' + r.status + ': ' + (await r.text()).slice(0, 300));
  return r.json();
}

async function connection(ctx) {
  const sa = await ctx.store.kvGet(KV, null);
  return sa ? { connected: true, account: sa.client_email, projectId: sa.project_id } : { connected: false };
}
async function disconnect(ctx) { await ctx.store.kvSet(KV, null); tokenCache = { token: null, exp: 0 }; }

module.exports = { saveServiceAccount, firestoreUpsert, gcsUpload, gcsMeta, connection, disconnect, toFirestore };
