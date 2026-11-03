/*
 * Minimal DICOM Part 10 reader, shared by the clinic server (require) and the browser bundle (import).
 * Reads the file meta group and the dataset in Implicit / Explicit VR Little Endian and Explicit VR
 * Big Endian (and the encapsulated syntaxes, which are Explicit VR Little Endian), skips sequences,
 * and returns the clinically useful header fields plus where the pixel data sits:
 *   native     → { encapsulated: false, offset, length }
 *   compressed → { encapsulated: true, fragments: [{ offset, length }], bot: [frame offsets] }
 * Pixel decoding (RLE, JPEG through the browser, colour models, window / level) lives in the client.
 * Files exported by ultrasound consoles often have no extension (IM_0001, US000001): use isDicom().
 */
'use strict';

const TS = {
  IMPLICIT_LE: '1.2.840.10008.1.2',
  EXPLICIT_LE: '1.2.840.10008.1.2.1',
  DEFLATED_LE: '1.2.840.10008.1.2.1.99',
  EXPLICIT_BE: '1.2.840.10008.1.2.2',
  RLE: '1.2.840.10008.1.2.5',
  JPEG_BASELINE: '1.2.840.10008.1.2.4.50',
  JPEG_EXTENDED: '1.2.840.10008.1.2.4.51'
};

const TS_NAME = {
  '1.2.840.10008.1.2': 'Implicit VR Little Endian',
  '1.2.840.10008.1.2.1': 'Explicit VR Little Endian',
  '1.2.840.10008.1.2.1.99': 'Deflated Explicit VR Little Endian',
  '1.2.840.10008.1.2.2': 'Explicit VR Big Endian',
  '1.2.840.10008.1.2.5': 'RLE Lossless',
  '1.2.840.10008.1.2.4.50': 'JPEG Baseline',
  '1.2.840.10008.1.2.4.51': 'JPEG Extended',
  '1.2.840.10008.1.2.4.57': 'JPEG Lossless',
  '1.2.840.10008.1.2.4.70': 'JPEG Lossless SV1',
  '1.2.840.10008.1.2.4.80': 'JPEG-LS Lossless',
  '1.2.840.10008.1.2.4.81': 'JPEG-LS Near-lossless',
  '1.2.840.10008.1.2.4.90': 'JPEG 2000 Lossless',
  '1.2.840.10008.1.2.4.91': 'JPEG 2000',
  '1.2.840.10008.1.2.4.100': 'MPEG-2 video',
  '1.2.840.10008.1.2.4.102': 'MPEG-4 AVC/H.264 video',
  '1.2.840.10008.1.2.4.103': 'MPEG-4 AVC/H.264 BD video',
  '1.2.840.10008.1.2.4.201': 'HTJ2K Lossless',
  '1.2.840.10008.1.2.4.203': 'HTJ2K'
};

// explicit VRs that use a 2-byte reserved field and a 4-byte length
const LONG_VR = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'SV', 'UC', 'UN', 'UR', 'UT', 'UV']);
const STRING_VR = new Set(['AE', 'AS', 'CS', 'DA', 'DS', 'DT', 'IS', 'LO', 'LT', 'PN', 'SH', 'ST', 'TM', 'UI', 'UC', 'UR', 'UT']);

// the tags we read: key → [field, VR used for Implicit VR files]
const WANT = {
  '00080005': ['charset', 'CS'],
  '00080008': ['imageType', 'CS'],
  '00080016': ['sopClassUid', 'UI'],
  '00080018': ['sopInstanceUid', 'UI'],
  '00080020': ['studyDate', 'DA'],
  '00080021': ['seriesDate', 'DA'],
  '00080022': ['acquisitionDate', 'DA'],
  '00080023': ['contentDate', 'DA'],
  '0008002A': ['acquisitionDateTime', 'DT'],
  '00080030': ['studyTime', 'TM'],
  '00080031': ['seriesTime', 'TM'],
  '00080032': ['acquisitionTime', 'TM'],
  '00080033': ['contentTime', 'TM'],
  '00080050': ['accessionNumber', 'SH'],
  '00080060': ['modality', 'CS'],
  '00080070': ['manufacturer', 'LO'],
  '00080080': ['institution', 'LO'],
  '00080090': ['referringPhysician', 'PN'],
  '00081030': ['studyDescription', 'LO'],
  '0008103E': ['seriesDescription', 'LO'],
  '00081090': ['model', 'LO'],
  '00100010': ['patientName', 'PN'],
  '00100020': ['patientId', 'LO'],
  '00100030': ['patientBirthDate', 'DA'],
  '00100040': ['patientSex', 'CS'],
  '00101010': ['patientAge', 'AS'],
  '00180015': ['bodyPart', 'CS'],
  '00181030': ['protocolName', 'LO'],
  '00181063': ['frameTime', 'DS'],
  '00200011': ['seriesNumber', 'IS'],
  '00200013': ['instanceNumber', 'IS'],
  '00204000': ['imageComments', 'LT'],
  '00280002': ['samplesPerPixel', 'US'],
  '00280004': ['photometric', 'CS'],
  '00280006': ['planarConfiguration', 'US'],
  '00280008': ['numberOfFrames', 'IS'],
  '00280010': ['rows', 'US'],
  '00280011': ['columns', 'US'],
  '00280100': ['bitsAllocated', 'US'],
  '00280101': ['bitsStored', 'US'],
  '00280102': ['highBit', 'US'],
  '00280103': ['pixelRepresentation', 'US'],
  '00281050': ['windowCenter', 'DS'],
  '00281051': ['windowWidth', 'DS'],
  '00281052': ['rescaleIntercept', 'DS'],
  '00281053': ['rescaleSlope', 'DS'],
  '00281101': ['redLutDescriptor', 'US'],
  '00281102': ['greenLutDescriptor', 'US'],
  '00281103': ['blueLutDescriptor', 'US'],
  '00281201': ['redLut', 'OW'],
  '00281202': ['greenLut', 'OW'],
  '00281203': ['blueLut', 'OW']
};
const NUMERIC_FIELDS = new Set(['samplesPerPixel', 'planarConfiguration', 'numberOfFrames', 'rows', 'columns', 'bitsAllocated', 'bitsStored', 'highBit', 'pixelRepresentation',
  'windowCenter', 'windowWidth', 'rescaleIntercept', 'rescaleSlope', 'frameTime', 'instanceNumber', 'seriesNumber']);

const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
const UNDEF = 0xffffffff;

function latin1(u8, start, len) {
  let s = '';
  const end = Math.min(u8.length, start + len);
  for (let i = start; i < end; i++) s += String.fromCharCode(u8[i]);
  return s;
}
function utf8(u8, start, len) {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(u8.subarray(start, Math.min(u8.length, start + len)));
  return Buffer.from(u8.buffer, u8.byteOffset + start, len).toString('utf8');
}

/** True when the bytes look like DICOM (DICM magic at 128, or a bare dataset starting with group 0002 / 0008). */
function isDicom(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (u8.length >= 132 && u8[128] === 0x44 && u8[129] === 0x49 && u8[130] === 0x43 && u8[131] === 0x4d) return true;
  return looksRaw(u8);
}
function looksRaw(u8) {
  if (u8.length < 16) return false;
  const g = u8[0] | (u8[1] << 8);
  if (g !== 0x0002 && g !== 0x0008) return false;
  const e = u8[2] | (u8[3] << 8);
  return e < 0x0100;
}

/**
 * parseDicom(bytes, { headerOnly, forceSyntax }) →
 *   { ok, error, transferSyntax, syntaxName, littleEndian, explicit, deflated, datasetOffset, meta, pixel }
 */
function parseDicom(input, opts) {
  const o = opts || {};
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const out = { ok: false, error: '', transferSyntax: '', syntaxName: '', littleEndian: true, explicit: true, deflated: false, datasetOffset: 0, meta: {}, pixel: null };
  let pos = 0;
  const preamble = u8.length >= 132 && u8[128] === 0x44 && u8[129] === 0x49 && u8[130] === 0x43 && u8[131] === 0x4d;
  if (preamble) pos = 132;
  else if (!looksRaw(u8)) { out.error = 'Not a DICOM file'; return out; }

  // ---- file meta information (always Explicit VR Little Endian)
  let ts = '';
  while (pos + 8 <= u8.length && dv.getUint16(pos, true) === 0x0002) {
    const elem = dv.getUint16(pos + 2, true);
    const vr = String.fromCharCode(u8[pos + 4], u8[pos + 5]);
    let len;
    let vp;
    if (LONG_VR.has(vr)) { len = dv.getUint32(pos + 8, true); vp = pos + 12; } else { len = dv.getUint16(pos + 6, true); vp = pos + 8; }
    if (elem === 0x0010) ts = latin1(u8, vp, len).replace(/[\0\s]+$/, '');
    pos = vp + len;
  }
  if (o.forceSyntax) ts = o.forceSyntax;
  if (!ts) {
    // no meta group: guess Explicit if a plausible VR follows the first tag, else Implicit
    const vr = String.fromCharCode(u8[pos + 4] || 0, u8[pos + 5] || 0);
    ts = /^[A-Z]{2}$/.test(vr) && (LONG_VR.has(vr) || STRING_VR.has(vr) || ['US', 'UL', 'SS', 'SL', 'FL', 'FD', 'AT', 'SQ'].includes(vr)) ? TS.EXPLICIT_LE : TS.IMPLICIT_LE;
  }
  out.transferSyntax = ts;
  out.syntaxName = TS_NAME[ts] || ts;
  out.datasetOffset = pos;
  if (ts === TS.DEFLATED_LE && !o.forceSyntax) { out.deflated = true; out.ok = true; return out; }
  const le = ts !== TS.EXPLICIT_BE;
  const explicit = ts !== TS.IMPLICIT_LE;
  out.littleEndian = le;
  out.explicit = explicit;
  let charset = '';

  const u16 = (p) => dv.getUint16(p, le);
  const u32 = (p) => dv.getUint32(p, le);

  function readHead(p) {
    if (p + 8 > u8.length) return null;
    const group = u16(p);
    const elem = u16(p + 2);
    if (group === 0xfffe) return { group, elem, vr: '', len: u32(p + 4), vp: p + 8 };
    const key = hex4(group) + hex4(elem);
    if (explicit) {
      const vr = String.fromCharCode(u8[p + 4], u8[p + 5]);
      if (LONG_VR.has(vr)) return { group, elem, key, vr, len: u32(p + 8), vp: p + 12 };
      if (/^[A-Z]{2}$/.test(vr)) return { group, elem, key, vr, len: u16(p + 6), vp: p + 8 };
      // a malformed explicit element: fall back to implicit framing
    }
    const len = u32(p + 4);
    const known = WANT[key];
    return { group, elem, key, vr: known ? known[1] : (len === UNDEF ? 'SQ' : 'UN'), len, vp: p + 8 };
  }

  // skip an undefined-length sequence / item list; returns the position after its delimiter
  function skipUndefined(p, depth) {
    if (depth > 12) return u8.length;
    while (p + 8 <= u8.length) {
      const g = u16(p);
      const e = u16(p + 2);
      const l = u32(p + 4);
      p += 8;
      if (g === 0xfffe && e === 0xe0dd) return p; // sequence delimiter
      if (g === 0xfffe && e === 0xe000) { // item
        if (l !== UNDEF) { p += l; continue; }
        while (p + 8 <= u8.length) { // item with undefined length: elements until the item delimiter
          const h = readHead(p);
          if (!h) return u8.length;
          if (h.group === 0xfffe && h.elem === 0xe00d) { p = h.vp; break; }
          p = h.len === UNDEF ? skipUndefined(h.vp, depth + 1) : h.vp + h.len;
        }
        continue;
      }
      return u8.length; // malformed
    }
    return p;
  }

  function value(h, field) {
    const vr = h.vr;
    if (STRING_VR.has(vr) || (vr === 'UN' && !/Lut$/.test(field))) {
      let s = charset === 'ISO_IR 192' ? utf8(u8, h.vp, h.len) : latin1(u8, h.vp, h.len);
      s = s.replace(/[\0\s]+$/, '').replace(/^\s+/, '');
      if (vr === 'PN') s = s.split('=')[0].replace(/\^+/g, ' ').replace(/\s+/g, ' ').trim();
      if (NUMERIC_FIELDS.has(field)) { const n = parseFloat(s.split('\\')[0]); return Number.isFinite(n) ? n : null; }
      return s;
    }
    if (vr === 'US' || vr === 'SS' || (vr === 'UN' && /Descriptor$/.test(field))) {
      if (h.len <= 2) return h.len === 2 ? (vr === 'SS' ? dv.getInt16(h.vp, le) : u16(h.vp)) : null;
      const a = [];
      for (let i = 0; i + 2 <= h.len; i += 2) a.push(u16(h.vp + i));
      return a;
    }
    if (vr === 'UL') return h.len >= 4 ? u32(h.vp) : null;
    if (vr === 'OW' || vr === 'OB' || vr === 'UN') {
      // LUT data: copy out as 16-bit words in machine order
      const n = Math.floor(h.len / 2);
      const w = new Uint16Array(n);
      for (let i = 0; i < n; i++) w[i] = u16(h.vp + i * 2);
      return w;
    }
    return null;
  }

  while (pos + 8 <= u8.length) {
    const h = readHead(pos);
    if (!h) break;
    if (h.group === 0xfffe) { pos = h.vp; continue; } // stray delimiter
    if (h.group === 0x7fe0 && h.elem === 0x0010) {
      if (h.len === UNDEF) {
        const frags = [];
        let bot = null;
        let p = h.vp;
        while (p + 8 <= u8.length) {
          const g = dv.getUint16(p, true);
          const e = dv.getUint16(p + 2, true);
          const l = dv.getUint32(p + 4, true);
          p += 8;
          if (g === 0xfffe && e === 0xe0dd) break;
          if (g !== 0xfffe || e !== 0xe000) break;
          if (bot === null) { bot = []; for (let i = 0; i + 4 <= l; i += 4) bot.push(dv.getUint32(p + i, true)); } else frags.push({ offset: p, length: Math.min(l, u8.length - p) });
          p += l;
        }
        out.pixel = { encapsulated: true, fragments: frags, bot: bot || [] };
        pos = p;
      } else {
        out.pixel = { encapsulated: false, offset: h.vp, length: Math.min(h.len, u8.length - h.vp), vr: h.vr };
        pos = h.vp + h.len;
      }
      if (o.headerOnly) break;
      continue;
    }
    if (h.len === UNDEF) { pos = skipUndefined(h.vp, 0); continue; }
    const want = WANT[h.key];
    if (want && h.vp + h.len <= u8.length) {
      if (!(o.headerOnly && /Lut$/.test(want[0]))) out.meta[want[0]] = value(h, want[0]);
      if (want[0] === 'charset') charset = String(out.meta.charset || '').split('\\').pop();
    }
    pos = h.vp + h.len;
  }

  const m = out.meta;
  m.frames = Math.max(1, Math.round(Number(m.numberOfFrames) || 1));
  m.acquiredAt = dicomTime(m);
  out.ok = !!(m.rows || m.patientName || m.sopInstanceUid || out.pixel);
  if (!out.ok) out.error = 'No image or patient data found';
  return out;
}

/** "20261103" + "142530.25" → local timestamp; prefers acquisition, then content, series, study time. */
function dicomTime(m) {
  const fromDT = (dt) => { const s = String(dt || '').replace(/[^0-9.]/g, ''); return s.length >= 8 ? mk(s.slice(0, 8), s.slice(8)) : 0; };
  const mk = (da, tm) => {
    const d = String(da || '').replace(/[^0-9]/g, '');
    if (d.length < 8) return 0;
    const t = String(tm || '').replace(/[^0-9.]/g, '');
    const x = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +(t.slice(0, 2) || 0), +(t.slice(2, 4) || 0), +(t.slice(4, 6) || 0), Math.round(parseFloat('0' + (t.slice(6) || '')) * 1000) || 0);
    return isNaN(x.getTime()) ? 0 : x.getTime();
  };
  return fromDT(m.acquisitionDateTime) || mk(m.acquisitionDate || m.contentDate, m.acquisitionTime) || mk(m.contentDate, m.contentTime) || mk(m.seriesDate, m.seriesTime) || mk(m.studyDate, m.studyTime) || 0;
}

/** The fragments that make up each frame of encapsulated pixel data. */
function frameFragments(pixel, frames, u8) {
  const f = (pixel && pixel.fragments) || [];
  if (!f.length) return [];
  const n = Math.max(1, frames || 1);
  if (n === 1) return [f];
  if (pixel.bot && pixel.bot.length === n) {
    const base = f[0].offset - 8;
    return pixel.bot.map((off, i) => {
      const start = base + off;
      const end = i + 1 < n ? base + pixel.bot[i + 1] : Infinity;
      return f.filter((x) => x.offset - 8 >= start && x.offset - 8 < end);
    });
  }
  if (f.length === n) return f.map((x) => [x]);
  const out = [];
  f.forEach((x) => {
    const soi = u8 && u8[x.offset] === 0xff && u8[x.offset + 1] === 0xd8;
    if (soi || !out.length) out.push([x]); else out[out.length - 1].push(x);
  });
  return out;
}

const syntaxName = (uid) => TS_NAME[uid] || uid || 'unknown';

module.exports = { parseDicom, isDicom, frameFragments, dicomTime, syntaxName, TS, TS_NAME };
