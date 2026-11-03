// Turns whatever a USB / Bluetooth scanner or the camera reads into registration data:
//   • SSDC-P-000123          patient card / token-slip QR  → returning patient
//   • USG-07 · T-09          today's token                  → returning patient
//   • Aadhaar QR (XML)       <PrintLetterBarcodeData …/>    → name, gender, DOB / age, care-of, address, Aadhaar no.
//   • Aadhaar Secure QR      a long number (2018+ cards)    → name, gender, DOB, care-of, address, last 4 digits
//   • 12 digits / 10 digits  Aadhaar number / mobile        → lookup
import { digits } from './utils';

const XML_RE = /<\s*PrintLetterBarcodeData\b([^>]*?)\/?>/i;
const ATTR_RE = /([A-Za-z_][\w-]*)\s*=\s*"([^"]*)"/g;
export const isRegId = (s) => /^[A-Z]{2,8}-P-\d{3,}$/i.test(String(s || '').trim());
export const isToken = (s) => /^(USG|LAB|XRAY|ECG|ECHO|T)-?\d{1,3}$/i.test(String(s || '').trim());

const titleCase = (s) => String(s || '').trim().toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
/** Aadhaar prints names in capitals; keep mixed-case names as they are. */
const niceName = (s) => (s && s === s.toUpperCase() ? titleCase(s) : String(s || '').trim());

export function genderFrom(g) {
  const s = String(g || '').trim().toUpperCase();
  if (s === 'M' || s === 'MALE') return 'Male';
  if (s === 'F' || s === 'FEMALE') return 'Female';
  if (s) return 'Other';
  return '';
}

/** Age from a date of birth (DD-MM-YYYY, DD/MM/YYYY or YYYY-MM-DD) or a year of birth. */
export function ageFrom({ dob, yob } = {}, now = new Date()) {
  let d = null;
  const a = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(String(dob || '').trim());
  const b = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(String(dob || '').trim());
  if (a) d = new Date(+a[3], +a[2] - 1, +a[1]);
  else if (b) d = new Date(+b[1], +b[2] - 1, +b[3]);
  if (d && !isNaN(d.getTime()) && d <= now) {
    let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (now.getDate() < d.getDate()) months -= 1;
    if (months >= 12) return { age: Math.floor(months / 12), ageUnit: 'Years' };
    if (months >= 1) return { age: months, ageUnit: 'Months' };
    return { age: Math.max(0, Math.floor((now - d) / 86400000)), ageUnit: 'Days' };
  }
  if (/^\d{4}$/.test(String(yob || '').trim())) return { age: Math.max(0, now.getFullYear() - Number(yob)), ageUnit: 'Years' };
  return null;
}

/** "W/O: Ramesh Kumar" → { relation: 'W/O', guardianName: 'Ramesh Kumar' } */
export function careOf(co) {
  const s = String(co || '').trim();
  if (!s) return { relation: '', guardianName: '' };
  const m = /^([WSDCH])\s*[/\\.]?\s*O\s*[:.,-]?\s*(.*)$/i.exec(s);
  if (m) {
    const rel = { W: 'W/O', S: 'S/O', D: 'D/O', C: 'C/O', H: 'W/O' }[m[1].toUpperCase()];
    return { relation: rel, guardianName: niceName(m[2]) };
  }
  return { relation: 'C/O', guardianName: niceName(s) };
}

function joinAddress(parts, pin) {
  const seen = new Set();
  const out = [];
  parts.forEach((p) => {
    const v = String(p || '').trim().replace(/\s+/g, ' ');
    if (!v || seen.has(v.toLowerCase())) return;
    seen.add(v.toLowerCase());
    out.push(v === v.toUpperCase() ? titleCase(v) : v);
  });
  return out.join(', ') + (pin ? ' - ' + String(pin).trim() : '');
}

/** A title that fits the gender, age and relation (Mrs. for a married woman, Baby / Master for children). */
export function suggestTitle({ gender, age, ageUnit, relation }) {
  const child = ageUnit && ageUnit !== 'Years' ? true : Number(age) > 0 && Number(age) < 12;
  if (gender === 'Female') return child ? 'Baby' : relation === 'W/O' ? 'Mrs.' : 'Ms.';
  if (gender === 'Male') return child ? 'Master' : 'Mr.';
  return '';
}

function fieldsFromAadhaar(x) {
  const gender = genderFrom(x.gender);
  const ag = ageFrom({ dob: x.dob, yob: x.yob }) || {};
  const co = careOf(x.careOf);
  const f = {
    name: niceName(x.name), gender, age: ag.age === undefined ? '' : ag.age, ageUnit: ag.ageUnit || 'Years', dob: x.dob || '',
    relation: co.relation, guardianName: co.guardianName,
    address: joinAddress([x.house, x.street, x.landmark, x.location, x.vtc, x.po, x.subdistrict, x.district, x.state], x.pincode),
    aadhaar: digits(x.uid).length === 12 ? digits(x.uid) : '', aadhaarLast4: x.last4 || (digits(x.uid).length === 12 ? digits(x.uid).slice(-4) : ''),
    mobileLast4: x.mobileLast4 || ''
  };
  f.title = suggestTitle(f);
  return f;
}

/** Old Aadhaar QR: an XML element with attributes. */
export function parseAadhaarXml(text) {
  const m = XML_RE.exec(String(text || ''));
  if (!m) return null;
  const a = {};
  let g;
  ATTR_RE.lastIndex = 0;
  while ((g = ATTR_RE.exec(m[1]))) a[g[1].toLowerCase()] = g[2];
  return fieldsFromAadhaar({
    uid: a.uid, name: a.name, gender: a.gender, dob: a.dob, yob: a.yob, careOf: a.co, house: a.house, street: a.street, landmark: a.lm,
    location: a.loc, vtc: a.vtc, po: a.po, subdistrict: a.subdist, district: a.dist, state: a.state, pincode: a.pc
  });
}

/**
 * Aadhaar Secure QR (UIDAI spec v2): base-10 big number → bytes → gzip → fields separated by byte 255
 * (V2 starts with "V2"): indicator, reference id (last 4 Aadhaar digits + timestamp), name, DOB, gender,
 * care of, district, landmark, house, location, PIN, post office, state, street, sub-district, VTC,
 * last 4 mobile digits (V2) — followed by the photo and UIDAI's signature (not used here).
 */
export async function parseAadhaarSecure(numStr) {
  const s = String(numStr || '').trim();
  if (!/^\d{200,}$/.test(s) || typeof BigInt === 'undefined' || typeof DecompressionStream === 'undefined') return null;
  let hex = BigInt(s).toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  let out;
  try {
    out = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  } catch (e) { return null; }
  const latin = new TextDecoder('iso-8859-1');
  const f = [];
  let start = 0;
  for (let i = 0; i < out.length && f.length < 20; i++) {
    if (out[i] === 255) { f.push(latin.decode(out.subarray(start, i))); start = i + 1; }
  }
  const k = /^V\d+$/.test(f[0] || '') ? 1 : 0;
  if (f.length < k + 16) return null;
  return fieldsFromAadhaar({
    last4: String(f[k + 1] || '').slice(0, 4), name: f[k + 2], dob: f[k + 3], gender: f[k + 4], careOf: f[k + 5], district: f[k + 6], landmark: f[k + 7],
    house: f[k + 8], location: f[k + 9], pincode: f[k + 10], po: f[k + 11], state: f[k + 12], street: f[k + 13], subdistrict: f[k + 14], vtc: f[k + 15],
    mobileLast4: k ? f[k + 16] : ''
  });
}

/**
 * Classify a scan. → { kind, value, fields?, label }
 *   kind: 'regId' | 'token' | 'aadhaarXml' | 'aadhaarSecure' | 'aadhaarNumber' | 'mobile' | 'text'
 */
export async function parseScan(raw) {
  const text = String(raw || '').replace(/[\r\n]+$/, '').trim();
  if (!text) return { kind: 'text', value: '', label: '' };
  if (isRegId(text)) return { kind: 'regId', value: text.toUpperCase(), label: 'Patient ID' };
  if (isToken(text)) return { kind: 'token', value: text.toUpperCase(), label: 'Token' };
  if (XML_RE.test(text)) {
    const fields = parseAadhaarXml(text);
    if (fields) return { kind: 'aadhaarXml', value: fields.aadhaar, fields, label: 'Aadhaar QR' };
  }
  if (/^\d{200,}$/.test(text)) {
    const fields = await parseAadhaarSecure(text);
    if (fields) return { kind: 'aadhaarSecure', value: fields.aadhaarLast4, fields, label: 'Aadhaar secure QR' };
    return { kind: 'text', value: '', label: 'Unreadable Aadhaar QR' };
  }
  const d = digits(text);
  if (d.length === 12 && d === text.replace(/[\s-]/g, '')) return { kind: 'aadhaarNumber', value: d, label: 'Aadhaar number' };
  if (/^(\+?91)?[6-9]\d{9}$/.test(text.replace(/[\s-]/g, ''))) return { kind: 'mobile', value: d.slice(-10), label: 'Mobile' };
  return { kind: 'text', value: text, label: '' };
}
