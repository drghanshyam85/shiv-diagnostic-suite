// Native DICOM support for the Images module: opens .dcm files and the extension-less files ultrasound
// consoles export (IM_0001, US000001…), decodes single images and cine loops, and turns a frame into a
// picture the report can print.
//   • uncompressed RGB / YBR_FULL / YBR_FULL_422 / MONOCHROME1-2 (8 or 16 bit, window / level) / PALETTE COLOR
//   • RLE Lossless (decoded here), JPEG Baseline / Extended 8-bit (decoded by the browser)
//   • Deflated Explicit VR (inflated with the browser's DecompressionStream)
// JPEG-LS, JPEG Lossless, JPEG 2000 and MPEG video are reported clearly instead of failing silently.
import dicomLib from '../../../shared/dicom';

const { parseDicom, isDicom, frameFragments, TS } = dicomLib;
const JPEG_SYNTAX = new Set([TS.JPEG_BASELINE, TS.JPEG_EXTENDED, '1.2.840.10008.1.2.4.57', '1.2.840.10008.1.2.4.70']);
const J2K_SYNTAX = new Set(['1.2.840.10008.1.2.4.90', '1.2.840.10008.1.2.4.91', '1.2.840.10008.1.2.4.201', '1.2.840.10008.1.2.4.202', '1.2.840.10008.1.2.4.203']);
const NOT_DICOM = /\.(jpe?g|png|bmp|gif|webp|tiff?|pdf|docx?|odt|rtf|txt|html?|csv|json|zip|mp4|avi|mov)$/i;

/** Quick check (reads 132 bytes): .dcm files, application/dicom, and extension-less console exports. */
export async function sniffDicom(file) {
  if (!file || NOT_DICOM.test(file.name || '')) return false;
  try {
    const head = new Uint8Array(await file.slice(0, 132).arrayBuffer());
    return isDicom(head);
  } catch (e) { return false; }
}

async function inflateRaw(u8) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open deflated DICOM files');
  const buf = await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
  return new Uint8Array(buf);
}

/** Read a DICOM File / Blob / bytes → { meta, frameCount, syntax, … } ready for renderFrame(). */
export async function openDicom(src) {
  let u8 = src instanceof Uint8Array ? src : new Uint8Array(await src.arrayBuffer());
  let d = parseDicom(u8);
  if (d.deflated) {
    const inf = await inflateRaw(u8.subarray(d.datasetOffset));
    const all = new Uint8Array(d.datasetOffset + inf.length);
    all.set(u8.subarray(0, d.datasetOffset));
    all.set(inf, d.datasetOffset);
    u8 = all;
    d = parseDicom(u8, { forceSyntax: TS.EXPLICIT_LE });
    d.syntaxName = 'Deflated Explicit VR Little Endian';
  }
  if (!d.ok) throw new Error(d.error || 'Unreadable DICOM file');
  if (!d.pixel) throw new Error('This DICOM file holds no image (it may be a structured report)');
  const m = d.meta;
  if (!m.rows || !m.columns) throw new Error('Image size missing in the DICOM header');
  const frames = d.pixel.encapsulated ? frameFragments(d.pixel, m.frames, u8) : null;
  const frameCount = d.pixel.encapsulated ? Math.max(1, frames.length) : Math.max(1, m.frames || 1);
  return { u8, d, meta: m, frames, frameCount, syntax: d.syntaxName, size: u8.length };
}

const concat = (parts) => {
  if (parts.length === 1) return parts[0];
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  parts.forEach((p) => { out.set(p, o); o += p.length; });
  return out;
};

// DICOM RLE (PackBits per byte plane) → interleaved little-endian samples
function decodeRle(bytes, m) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nseg = dv.getUint32(0, true);
  const offs = [];
  for (let s = 0; s < nseg && s < 15; s++) offs.push(dv.getUint32(4 + 4 * s, true));
  const n = m.columns * m.rows;
  const bps = Math.max(1, (m.bitsAllocated || 8) / 8);
  const spp = m.samplesPerPixel || 1;
  const out = new Uint8Array(n * spp * bps);
  const plane = new Uint8Array(n);
  for (let s = 0; s < offs.length; s++) {
    plane.fill(0);
    let i = offs[s];
    const end = s + 1 < offs.length ? offs[s + 1] : bytes.length;
    let o = 0;
    while (i < end && o < n) {
      const h = bytes[i++];
      if (h < 128) { const c = h + 1; for (let k = 0; k < c; k++) { if (o < n) plane[o++] = bytes[i]; i++; } } else if (h > 128) { const c = 257 - h; const v = bytes[i++]; for (let k = 0; k < c && o < n; k++) plane[o++] = v; }
    }
    const sample = Math.floor(s / bps);
    const byteIdx = bps - 1 - (s % bps); // segments come most-significant byte first
    for (let k = 0; k < n; k++) out[(k * spp + sample) * bps + byteIdx] = plane[k];
  }
  return out;
}

const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
function putYbr(o, k, y, cb, cr) {
  o[4 * k] = clamp8(y + 1.402 * (cr - 128));
  o[4 * k + 1] = clamp8(y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128));
  o[4 * k + 2] = clamp8(y + 1.772 * (cb - 128));
  o[4 * k + 3] = 255;
}

function drawRaw(g, raw, m, { planar = false, le = true } = {}) {
  const W = m.columns;
  const H = m.rows;
  const n = W * H;
  const img = g.createImageData(W, H);
  const o = img.data;
  const spp = m.samplesPerPixel || 1;
  const pi = String(m.photometric || 'MONOCHROME2').toUpperCase().trim();
  const bits = m.bitsAllocated || 8;
  const sample16 = (k) => (le ? raw[2 * k] | (raw[2 * k + 1] << 8) : (raw[2 * k] << 8) | raw[2 * k + 1]);
  if (spp === 3) {
    if (pi === 'YBR_FULL_422' && !planar) {
      for (let k = 0, p = 0; k < n; k += 2, p += 4) { const cb = raw[p + 2]; const cr = raw[p + 3]; putYbr(o, k, raw[p], cb, cr); if (k + 1 < n) putYbr(o, k + 1, raw[p + 1], cb, cr); }
    } else {
      const ybr = pi.startsWith('YBR');
      for (let k = 0; k < n; k++) {
        const a = planar ? raw[k] : raw[3 * k];
        const b = planar ? raw[n + k] : raw[3 * k + 1];
        const c = planar ? raw[2 * n + k] : raw[3 * k + 2];
        if (ybr) putYbr(o, k, a, b, c); else { o[4 * k] = a; o[4 * k + 1] = b; o[4 * k + 2] = c; o[4 * k + 3] = 255; }
      }
    }
  } else if (pi === 'PALETTE COLOR' && m.redLut && m.greenLut && m.blueLut) {
    const desc = Array.isArray(m.redLutDescriptor) ? m.redLutDescriptor : [256, 0, 16];
    const entries = desc[0] || 65536;
    const first = desc[1] || 0;
    const wide = (desc[2] || 16) > 8 || Math.max(...m.redLut.slice(0, 64)) > 255;
    const lv = (lut, idx) => { const v = lut[Math.max(0, Math.min(lut.length - 1, idx))] || 0; return wide ? v >> 8 : v & 0xff; };
    for (let k = 0; k < n; k++) {
      const v = bits > 8 ? sample16(k) : raw[k];
      const idx = Math.max(0, Math.min(entries - 1, v - first));
      o[4 * k] = lv(m.redLut, idx); o[4 * k + 1] = lv(m.greenLut, idx); o[4 * k + 2] = lv(m.blueLut, idx); o[4 * k + 3] = 255;
    }
  } else {
    const stored = m.bitsStored || bits;
    const signed = m.pixelRepresentation === 1;
    const slope = Number.isFinite(m.rescaleSlope) && m.rescaleSlope ? m.rescaleSlope : 1;
    const icpt = Number.isFinite(m.rescaleIntercept) ? m.rescaleIntercept : 0;
    const vals = new Float32Array(n);
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < n; k++) {
      let v = bits > 8 ? sample16(k) : raw[k];
      if (bits > 8) { v &= (1 << stored) - 1; if (signed && v & (1 << (stored - 1))) v -= 1 << stored; } else if (signed && v > 127) v -= 256;
      v = v * slope + icpt;
      vals[k] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (Number.isFinite(m.windowCenter) && Number.isFinite(m.windowWidth) && m.windowWidth > 1) { lo = m.windowCenter - m.windowWidth / 2; hi = m.windowCenter + m.windowWidth / 2; }
    const span = hi - lo || 1;
    const inv = pi === 'MONOCHROME1';
    for (let k = 0; k < n; k++) {
      let y = ((vals[k] - lo) / span) * 255;
      y = clamp8(inv ? 255 - y : y);
      o[4 * k] = y; o[4 * k + 1] = y; o[4 * k + 2] = y; o[4 * k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

/** Draw frame i (0-based) onto a new canvas. */
export async function renderFrame(dc, i = 0) {
  const { d, meta: m, u8 } = dc;
  const W = m.columns;
  const H = m.rows;
  const k = Math.max(0, Math.min(dc.frameCount - 1, i));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d', { willReadFrequently: false });
  const ts = d.transferSyntax;
  if (d.pixel.encapsulated) {
    const parts = (dc.frames[k] || []).map((p) => u8.subarray(p.offset, p.offset + p.length));
    if (!parts.length) throw new Error('Frame ' + (k + 1) + ' is empty');
    const bytes = concat(parts);
    if (ts === TS.RLE) { drawRaw(g, decodeRle(bytes, m), m, { planar: false, le: true }); return canvas; }
    if (JPEG_SYNTAX.has(ts) || J2K_SYNTAX.has(ts)) {
      try {
        const bmp = await createImageBitmap(new Blob([bytes], { type: J2K_SYNTAX.has(ts) ? 'image/jp2' : 'image/jpeg' }));
        g.drawImage(bmp, 0, 0, W, H);
        if (bmp.close) bmp.close();
        return canvas;
      } catch (e) { /* fall through to the message below */ }
    }
    throw new Error(d.syntaxName + ' compression can’t be decoded in this browser. On the ultrasound console choose “DICOM uncompressed”, “RLE” or “JPEG baseline” export, or export JPEG images.');
  }
  const spp = m.samplesPerPixel || 1;
  const bps = Math.max(1, (m.bitsAllocated || 8) / 8);
  const pi = String(m.photometric || '').toUpperCase().trim();
  const frameBytes = pi === 'YBR_FULL_422' ? W * H * 2 : W * H * spp * bps;
  const off = d.pixel.offset + k * frameBytes;
  if (off + frameBytes > u8.length) throw new Error('The image data is incomplete (file cut short?)');
  drawRaw(g, u8.subarray(off, off + frameBytes), m, { planar: m.planarConfiguration === 1, le: d.littleEndian });
  return canvas;
}

/** A frame as a lossless PNG File, named after the source, timed from the DICOM header. */
export async function dicomFrameFile(dc, i, baseName) {
  const c = await renderFrame(dc, i);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  const name = String(baseName || 'dicom').replace(/\.(dcm|dicom|dic)$/i, '') + (dc.frameCount > 1 ? '_f' + (i + 1) : '') + '.png';
  const at = frameTime(dc, i) || Date.now();
  return new File([blob], name, { type: 'image/png', lastModified: at });
}

/** Acquisition time of frame i (cine: start + i × frame time). */
export function frameTime(dc, i = 0) {
  const m = dc.meta || {};
  return m.acquiredAt ? m.acquiredAt + Math.round((Number(m.frameTime) || 0) * i) : 0;
}

/** The header fields worth keeping with an attached image. */
export function dicomSummary(dc) {
  const m = dc.meta || {};
  return {
    patientName: m.patientName || '', patientId: m.patientId || '', sex: m.patientSex || '', modality: m.modality || '',
    manufacturer: m.manufacturer || '', model: m.model || '', institution: m.institution || '', series: m.seriesDescription || '',
    study: m.studyDescription || '', bodyPart: m.bodyPart || '', protocol: m.protocolName || '', comments: m.imageComments || '',
    acquiredAt: m.acquiredAt || 0, frames: dc.frameCount, size: m.columns + '×' + m.rows, photometric: m.photometric || '',
    syntax: dc.syntax || '', accession: m.accessionNumber || '', instance: m.instanceNumber || null
  };
}

const TITLES = /^(mr|mrs|ms|miss|smt|shri|sri|baby|master|dr|kumari|km|md|mst)\.?$/i;
const nameTokens = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t && !TITLES.test(t));
const idKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Does the DICOM patient match the report's patient? → { ok: true|false|null, reason }
 * null = the DICOM carries no patient details (nothing to check).
 */
export function dicomPatientCheck(summary, demographics) {
  const d = demographics || {};
  const dName = nameTokens(summary.patientName);
  const dId = idKey(summary.patientId);
  if (!dName.length && !dId) return { ok: null, reason: '' };
  if (dId && d.patientId && dId === idKey(d.patientId)) return { ok: true, reason: 'Patient ID matches' };
  const rName = nameTokens(d.name);
  if (dName.length && rName.length) {
    const common = dName.filter((t) => rName.includes(t)).length;
    if (common >= Math.min(2, dName.length, rName.length) && rName[0] && dName.includes(rName[0])) return { ok: true, reason: 'Name matches' };
  }
  return { ok: false, reason: 'DICOM patient “' + (summary.patientName || '—') + '”' + (summary.patientId ? ' (ID ' + summary.patientId + ')' : '') + ' differs from this report' };
}

/** EXIF DateTimeOriginal of a JPEG (consoles and phones), or 0. */
export async function exifDate(file) {
  try {
    if (!/jpe?g$/i.test(file.type || '') && !/\.jpe?g$/i.test(file.name || '')) return 0;
    const b = new Uint8Array(await file.slice(0, 131072).arrayBuffer());
    const dv = new DataView(b.buffer);
    if (dv.getUint16(0) !== 0xffd8) return 0;
    let p = 2;
    while (p + 4 < b.length) {
      const marker = dv.getUint16(p);
      const len = dv.getUint16(p + 2);
      if (marker === 0xffe1 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) {
        const t = p + 10;
        const le = dv.getUint16(t) === 0x4949;
        const u16 = (x) => dv.getUint16(x, le);
        const u32 = (x) => dv.getUint32(x, le);
        const tagIn = (ifd, tag) => { const cnt = u16(t + ifd); for (let i = 0; i < cnt; i++) { const e = t + ifd + 2 + i * 12; if (u16(e) === tag) return e; } return 0; };
        const str = (e) => { const off = t + u32(e + 8); let s = ''; for (let i = 0; i < 19; i++) s += String.fromCharCode(b[off + i]); return s; };
        const ifd0 = u32(t + 4);
        const exifPtr = tagIn(ifd0, 0x8769);
        let e = exifPtr ? tagIn(u32(exifPtr + 8), 0x9003) || tagIn(u32(exifPtr + 8), 0x9004) : 0;
        if (!e) e = tagIn(ifd0, 0x0132);
        if (!e) return 0;
        const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(str(e));
        return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : 0;
      }
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
      p += 2 + len;
    }
  } catch (e) { /* no EXIF */ }
  return 0;
}
