/*
 * Cloud integrity: the checksum each provider reports back is compared with the local file.
 *   Google Drive   → md5Checksum (hex)          (Google-Docs conversions have none: size only)
 *   OneDrive       → quickXorHash (base64), sha1Hash / sha256Hash when present
 *   Cloud Storage  → md5Hash (base64)
 * Used right after every upload (a mismatch fails the item, so it is retried) and by the on-demand /
 * daily "verify integrity" audit, which re-reads every recent file's remote metadata in every
 * connected cloud and re-queues missing or damaged copies.
 */
const crypto = require('crypto');

// ---------------------------------------------------------------- QuickXorHash (Microsoft OneDrive)
// 160-bit circular register: byte i is XOR-ed in at bit offset (11·i) mod 160, then the 64-bit file
// length (little-endian) is XOR-ed into the last 8 bytes. Bytes 160 apart share an offset, so they are
// XOR-folded first (fast for large files).
const QX_WIDTH = 160;
const QX_SHIFT = 11;
const MASK160 = (1n << 160n) - 1n;
function quickXorHash(buf) {
  const bytes = buf instanceof Uint8Array ? buf : Buffer.from(buf);
  let reg = 0n;
  const n = Math.min(bytes.length, QX_WIDTH);
  for (let i = 0; i < n; i++) {
    let x = 0;
    for (let j = i; j < bytes.length; j += QX_WIDTH) x ^= bytes[j];
    if (!x) continue;
    const off = BigInt((QX_SHIFT * i) % QX_WIDTH);
    const v = BigInt(x) << off;
    reg ^= (v & MASK160) ^ (v >> 160n);
  }
  const out = Buffer.alloc(20);
  for (let k = 0; k < 20; k++) out[k] = Number((reg >> BigInt(8 * k)) & 0xffn);
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(bytes.length));
  for (let k = 0; k < 8; k++) out[12 + k] ^= len[k];
  return out.toString('base64');
}

function localDigests(buffer) {
  const h = (algo) => crypto.createHash(algo).update(buffer);
  const md5 = h('md5').digest();
  return {
    size: buffer.length,
    md5Hex: md5.toString('hex'),
    md5B64: md5.toString('base64'),
    sha1Hex: h('sha1').digest('hex'),
    sha256Hex: h('sha256').digest('hex'),
    quickXor: quickXorHash(buffer)
  };
}

/**
 * Compare provider metadata with local digests. remote: { size, md5Checksum (hex) | md5Hash (b64) |
 * quickXorHash | sha1Hash | sha256Hash }. → { ok: true|false|null, algo, detail }
 *   ok null = nothing comparable (e.g. converted Google Doc)
 */
function compareRemote(provider, local, remote) {
  if (!remote) return { ok: false, algo: '', detail: 'not found in the cloud' };
  const sizeOk = remote.size === undefined || remote.size === null || Number(remote.size) === local.size;
  let algo = '';
  let ok = null;
  if (provider === 'gdrive' && remote.md5Checksum) { algo = 'md5'; ok = String(remote.md5Checksum).toLowerCase() === local.md5Hex; }
  else if (provider === 'gcp' && remote.md5Hash) { algo = 'md5'; ok = remote.md5Hash === local.md5B64; }
  else if (provider === 'onedrive' && remote.sha256Hash) { algo = 'sha256'; ok = String(remote.sha256Hash).toLowerCase() === local.sha256Hex; }
  else if (provider === 'onedrive' && remote.sha1Hash) { algo = 'sha1'; ok = String(remote.sha1Hash).toLowerCase() === local.sha1Hex; }
  else if (provider === 'onedrive' && remote.quickXorHash) { algo = 'quickXor'; ok = remote.quickXorHash === local.quickXor; }
  if (ok === null) {
    if (remote.size === undefined || remote.size === null) return { ok: null, algo: '', detail: 'no checksum reported (converted document)' };
    return { ok: sizeOk ? null : false, algo: 'size', detail: sizeOk ? 'size matches (' + local.size + ' B) — no checksum reported' : 'size differs: cloud ' + remote.size + ' B vs local ' + local.size + ' B' };
  }
  if (!sizeOk) return { ok: false, algo, detail: 'size differs: cloud ' + remote.size + ' B vs local ' + local.size + ' B' };
  return { ok, algo, detail: ok ? algo + ' ✓ ' + (algo === 'md5' ? local.md5Hex.slice(0, 12) : algo === 'quickXor' ? local.quickXor.slice(0, 12) : algo === 'sha1' ? local.sha1Hex.slice(0, 12) : local.sha256Hex.slice(0, 12)) + '… · ' + local.size + ' B' : algo + ' mismatch — the cloud copy differs from the clinic file' };
}

/** Remote metadata shapes → the fields compareRemote() reads. */
const fromDrive = (f) => (f ? { size: f.size !== undefined ? Number(f.size) : undefined, md5Checksum: f.md5Checksum } : null);
const fromOneDrive = (item) => {
  if (!item) return null;
  const hs = (item.file && item.file.hashes) || {};
  return { size: item.size !== undefined ? Number(item.size) : undefined, quickXorHash: hs.quickXorHash, sha1Hash: hs.sha1Hash, sha256Hash: hs.sha256Hash };
};
const fromGcs = (o) => (o ? { size: o.size !== undefined ? Number(o.size) : undefined, md5Hash: o.md5Hash } : null);

module.exports = { quickXorHash, localDigests, compareRemote, fromDrive, fromOneDrive, fromGcs };
