// PC-PNDT Form F data model: auto-fill from registration (sections A–D), LMP / USG-GA / EDD derivation
// as of the procedure date, GA-based indication suggestions, validation and register export.
import { store } from './store';
import { currentUser, can, logAudit } from './auth';
import { nextCounter, peekCounter } from './sync';
import { dateKey, parseKey, uid, pad, digits, fmtDate, toCSV } from './utils';
import { getSettings } from './hooks';
import { eddFromLmp, gaFromLmp, lmpFromGa, lmpFromEdd, gaFromEdd, suggestIndications, FORM_F_INDICATIONS } from './obstetric';

export const ID_TYPES = ['Aadhar Card', 'Jan Aadhaar Card', 'Voter ID', 'Ration Card', 'PAN Card', 'Driving Licence', 'Passport', 'Other'];
export const RESULT_PRESETS = [
  'NOT APPLICABLE',
  'Single Live Intrauterine Fetus',
  'Normal Study',
  'Single live intrauterine foetus of {GA}. Placenta and liquor normal.',
  'Twin live intrauterine gestation',
  'Early intrauterine gestational sac – viability to be confirmed on follow-up',
  'Non-viable pregnancy / missed abortion',
  'Incomplete abortion – retained products of conception',
  'No intrauterine gestation seen – ? ectopic pregnancy',
  'Intrauterine foetal demise (IUFD)'
];
export const SECTION_C_ITEMS = [17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
const TITLE_MAP = { 'Mrs.': 'Mrs', 'Smt.': 'Smt', 'Ms.': 'Ms', 'Kumari': 'Ms', 'Dr.': 'Dr' };
export const HINDI_TITLE = { Mrs: 'श्रीमती', Smt: 'श्रीमती', Ms: 'सुश्री', Dr: 'डॉ.' };

/**
 * Indications ticked on every new Form F (Section B item 10). Default: 17 — "Evaluation of foetal growth
 * parameters, foetal weight and foetal well being"; Settings → formF.defaultIndications can change it.
 * They stay ticked when indications are suggested from the gestational age, and can be unticked by hand.
 */
export function defaultIndications() {
  const s = getSettings();
  const v = s && s.formF && Array.isArray(s.formF.defaultIndications) ? s.formF.defaultIndications : [17];
  return v.map(Number).filter((n) => n >= 1 && n <= FORM_F_INDICATIONS.length);
}
export const withDefaultIndications = (list) => Array.from(new Set((list || []).concat(defaultIndications()))).sort((a, b) => a - b);

export function emptyFormFData(today = dateKey()) {
  return {
    patientTitle: 'Mrs', patientName: '', patientNameHindi: '', age: '', husbandName: '', guardianRelation: 'Husband',
    livingSons: 0, livingDaughters: 0, sonsAges: '', daughtersAges: '', totalChildren: 0, totalOverride: false,
    address: '', mobile: '', sameAsPostal: true, idAddress: '', idType: 'Aadhar Card', idNumber: '',
    refDoctorId: '', refDoctorName: '', refDoctorAddress: '', selfReferral: 'NO',
    lmpMode: 'lmp', lmp: '', gaWeeks: '', gaDays: '', edd: '', eddOverride: false, eddFirst: false,
    indications: defaultIndications(), indicationsManual: false, procUltrasound: true, procOther: false, procedureOther: '',
    procedureDate: today, declarationDate: today, result: 'NOT APPLICABLE', resultConveyedTo: '', conveyedToAuto: true, conveyedDate: today, mtp: 'NO',
    signatureType: 'signed', thumb: { name: '', ageSex: '', relation: '', addressContact: '', date: '' },
    sectionCUnlocked: false, sectionC: {}
  };
}

export function newFormFRecord(today = dateKey()) {
  return { id: uid('ff_'), sno: null, snoLabel: '', regnNo: '', visitId: '', patientId: '', date: today, status: 'DRAFT', data: emptyFormFData(today), customEdits: {} };
}

/** Normalise an older / partial record so every field the UI and printer read exists. */
export function normalizeFormF(rec) {
  const base = emptyFormFData(rec.date || dateKey());
  const data = Object.assign(base, rec.data || {});
  data.thumb = Object.assign(emptyFormFData().thumb, data.thumb || {});
  data.sectionC = Object.assign({}, data.sectionC || {});
  if (data.procUltrasound === undefined) data.procUltrasound = true;
  return Object.assign({ customEdits: {}, status: 'DRAFT' }, rec, { data });
}

const ga = (w, d) => (w === '' || w === undefined || w === null ? null : { weeks: Number(w), days: Number(d || 0) });

/** Recompute derived fields (EDD, GA as of procedure date, totals, conveyed-to, ID address, indications). */
export function deriveFormF(d, { autoIndications = true } = {}) {
  const o = Object.assign({}, d);
  const on = o.procedureDate ? parseKey(o.procedureDate) : new Date();
  if (o.lmpMode === 'lmp') {
    if (o.lmp) {
      if (!o.eddOverride) o.edd = eddFromLmp(o.lmp);
      const g = gaFromLmp(o.lmp, on);
      if (g && !g.invalid) { o.gaWeeks = g.weeks; o.gaDays = g.days; } else { o.gaWeeks = ''; o.gaDays = ''; }
    }
  } else if (o.gaWeeks !== '' && o.gaWeeks !== undefined && !o.eddFirst) {
    o.lmp = lmpFromGa(o.gaWeeks, o.gaDays || 0, on);
    o.edd = eddFromLmp(o.lmp);
  } else if (o.edd) {
    o.lmp = lmpFromEdd(o.edd);
    const g = gaFromEdd(o.edd, on);
    if (g && !g.invalid) { o.gaWeeks = g.weeks; o.gaDays = g.days; }
  }
  o.livingSons = Math.max(0, Number(o.livingSons) || 0);
  o.livingDaughters = Math.max(0, Number(o.livingDaughters) || 0);
  if (!o.totalOverride) o.totalChildren = o.livingSons + o.livingDaughters;
  if (o.sameAsPostal) o.idAddress = o.address;
  if (o.conveyedToAuto) o.resultConveyedTo = [o.patientTitle, o.patientName].filter(Boolean).join(' ');
  if (autoIndications && !o.indicationsManual) {
    const g = ga(o.gaWeeks, o.gaDays);
    o.indications = withDefaultIndications(g ? suggestIndications(g.weeks) : []);
  }
  return o;
}

function refDoctorFields(visit, patient) {
  const id = (visit && visit.referredBy) || (patient && patient.referredBy) || '';
  const d = id && id !== 'SELF' ? store.get('doctors', id) : null;
  if (!d) return { refDoctorId: '', refDoctorName: '', refDoctorAddress: '' };
  return { refDoctorId: d.id, refDoctorName: [d.name, d.qualification].filter(Boolean).join(', '), refDoctorAddress: [d.clinic, d.address].filter(Boolean).join(', ') };
}

/** Field values for the enabled sections, taken from the patient master + the visit's obstetric panel. */
export function formFFromVisit(visit, patient, sections = { A: true, B: true, C: true, D: true }) {
  const out = {};
  const p = patient || {};
  const o = (visit && visit.obstetric) || {};
  if (sections.A) {
    Object.assign(out, {
      patientTitle: TITLE_MAP[p.title] || (p.title ? String(p.title).replace(/\.$/, '') : 'Mrs'),
      patientName: p.name || '', patientNameHindi: p.nameHindi || '',
      age: p.age !== undefined && (!p.ageUnit || p.ageUnit === 'Years') ? p.age : '',
      husbandName: p.guardianName || '', guardianRelation: p.relation === 'D/O' ? 'Father' : 'Husband',
      livingSons: Number(o.sons) || 0, livingDaughters: Number(o.daughters) || 0, sonsAges: o.sonsAges || '', daughtersAges: o.daughtersAges || '', totalOverride: false,
      address: p.address || '', mobile: p.mobile || '', sameAsPostal: true,
      idType: !p.idType || /aadha+r/i.test(p.idType) ? 'Aadhar Card' : p.idType,
      idNumber: p.aadhaar ? digits(p.aadhaar).replace(/(\d{4})(?=\d)/g, '$1 ') : '',
      selfReferral: 'NO'
    }, refDoctorFields(visit, p));
  }
  if (sections.B) {
    const dk = (visit && visit.dateKey) || dateKey();
    Object.assign(out, {
      lmpMode: o.mode === 'usg' ? 'usg' : 'lmp', lmp: o.lmp || '', gaWeeks: o.gaWeeks === undefined ? '' : o.gaWeeks, gaDays: o.gaDays === undefined ? '' : o.gaDays,
      edd: o.edd || '', eddOverride: !!o.eddOverride, eddFirst: !!o.eddFirst, indicationsManual: false,
      procUltrasound: true, procOther: false, procedureOther: '', procedureDate: dk, declarationDate: dk, conveyedDate: dk,
      result: 'NOT APPLICABLE', conveyedToAuto: true, mtp: 'NO'
    });
  }
  if (sections.C) Object.assign(out, { sectionCUnlocked: false, sectionC: {} });
  if (sections.D) Object.assign(out, { signatureType: 'signed', thumb: emptyFormFData().thumb });
  return out;
}

export const isObstetricVisit = (v) => !!(v && (v.obstetric || (v.tests || []).some((t) => { const x = store.get('tests', t.testId); return x && x.isObstetric; })));
export const formFForVisit = (visitId) => (visitId ? store.list('formf').find((f) => f.visitId === visitId) || null : null);

/** Obstetric visits in the last `days` days whose Form F is missing or still a draft. */
export function pendingFormFVisits(days = 7) {
  const since = dateKey(new Date(Date.now() - days * 86400000));
  const ff = {};
  store.list('formf').forEach((f) => { if (f.visitId) ff[f.visitId] = f; });
  return store.list('visits').filter((v) => v.dateKey >= since && isObstetricVisit(v) && !(ff[v.id] && ff[v.id].status === 'FINAL'))
    .sort((a, b) => b.createdAt - a.createdAt).map((v) => ({ visit: v, formf: ff[v.id] || null }));
}

/** Called by Registration: bind a draft Form F to a freshly registered obstetric visit (no S.No yet). */
export function createFormFDraftForVisit(visit, patient, prefs) {
  if (!visit || !visit.obstetric || !can('pcpndt:manage_form_f_register', 'DRAFT')) return null;
  if (prefs && prefs.autoFill === false) return null;
  const existing = formFForVisit(visit.id);
  if (existing) return existing;
  const rec = newFormFRecord(visit.dateKey);
  const sections = (prefs && prefs.autoFillSections) || { A: true, B: true, C: true, D: true };
  rec.data = deriveFormF(Object.assign(rec.data, formFFromVisit(visit, patient, sections)), { autoIndications: !prefs || prefs.autoIndications !== false });
  const prev = previousFormFDefaults(patient.id, rec.id);
  if (prev) {
    const res = applyDefaults(rec.data, prev.values);
    if (res.used.length) { rec.data = deriveFormF(res.data, { autoIndications: !prefs || prefs.autoIndications !== false }); rec.prefilledFrom = { id: prev.from.id, sno: prev.from.snoLabel || '', date: prev.from.data.procedureDate || '', fields: res.used }; }
  }
  Object.assign(rec, { regnNo: patient.regId || '', visitId: visit.id, patientId: patient.id, autoCreated: true, createdAt: Date.now(), createdBy: (currentUser() || {}).id });
  const saved = store.put('formf', rec);
  store.patch('visits', visit.id, { formFId: saved.id });
  return saved;
}

export const snoLabelFor = (year, n) => year + '/' + pad(n, 4);
export async function previewFormFSno(date = dateKey()) {
  const y = String(date).slice(0, 4);
  return snoLabelFor(y, (await peekCounter('formf-' + y)) + 1);
}
export async function allocateFormFSno(date = dateKey()) {
  const y = String(date).slice(0, 4);
  const n = await nextCounter('formf-' + y);
  return { sno: n, snoLabel: snoLabelFor(y, n) };
}

export function validateFormF(rec) {
  const d = rec.data || {};
  const errors = [];
  const warnings = [];
  const missing = [];
  const need = (key, label) => { errors.push(label); missing.push(key); };
  if (!String(d.patientName || '').trim()) need('patientName', 'Item 3 – patient name');
  if (d.age === '' || d.age === undefined || Number(d.age) <= 0) need('age', 'Item 3 – age');
  if (!String(d.husbandName || '').trim()) need('husbandName', "Item 5 – husband's / father's name");
  if (!String(d.address || '').trim()) need('address', 'Item 6 – postal address');
  if (d.lmpMode === 'lmp' ? !d.lmp : (d.gaWeeks === '' || d.gaWeeks === undefined) && !d.edd) need(d.lmpMode === 'lmp' ? 'lmp' : 'gaWeeks', 'Item 8 – LMP or gestational age');
  if (!(d.indications || []).length) need('indications', 'Item 10 – at least one indication');
  if (!d.procUltrasound && !(d.procOther && d.procedureOther)) need('procedure', 'Item 11 – procedure carried out');
  if (!d.procedureDate) need('procedureDate', 'Item 13 – procedure date');
  if (!d.declarationDate) need('declarationDate', 'Item 12 – declaration date');
  if (!String(d.result || '').trim()) need('result', 'Item 14 – result of the procedure');
  if (!d.idNumber) warnings.push('ID proof number not recorded');
  if (d.mobile && !/^[6-9]\d{9}$/.test(digits(d.mobile))) warnings.push('Mobile number looks invalid');
  if (!d.refDoctorName && d.selfReferral !== 'YES') warnings.push('No referring doctor and self-referral is NO');
  if (d.signatureType === 'thumb' && !d.thumb.name) warnings.push('Thumb impression: identifier name missing');
  if (String(d.result || '').trim().toUpperCase() === 'NOT APPLICABLE') warnings.push('Item 14 result still reads “NOT APPLICABLE”');
  if (d.gaWeeks !== '' && Number(d.gaWeeks) > 42) warnings.push('Gestational age above 42 weeks – check LMP');
  return { errors, warnings, missing };
}

/** Repeatable details from the patient's most recent other Form F (husband, address, ID, children, referral). */
export function previousFormFDefaults(patientId, excludeId) {
  if (!patientId) return null;
  const prev = store.list('formf').filter((f) => f.patientId === patientId && f.id !== excludeId && f.data).sort((a, b) => String(b.data.procedureDate || '').localeCompare(String(a.data.procedureDate || '')) || (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  if (!prev) return null;
  const d = prev.data;
  const pick = {};
  ['husbandName', 'guardianRelation', 'address', 'sameAsPostal', 'idAddress', 'idType', 'idNumber', 'mobile', 'livingSons', 'livingDaughters', 'sonsAges', 'daughtersAges', 'patientNameHindi', 'refDoctorId', 'refDoctorName', 'refDoctorAddress']
    .forEach((k) => { if (d[k] !== undefined && d[k] !== '') pick[k] = d[k]; });
  return { from: prev, values: pick };
}

/** Fill only the fields that are still empty from the previous record's values. */
export function applyDefaults(data, values) {
  const out = Object.assign({}, data);
  const used = [];
  Object.entries(values || {}).forEach(([k, v]) => {
    const cur = out[k];
    const empty = cur === undefined || cur === null || cur === '' || ((k === 'livingSons' || k === 'livingDaughters') && Number(cur) === 0 && Number(v) > 0);
    if (empty) { out[k] = v; used.push(k); }
  });
  return { data: out, used };
}

export const gaText = (d) => (d.gaWeeks === '' || d.gaWeeks === undefined ? '' : d.gaWeeks + ' Weeks ' + (Number(d.gaDays) || 0) + ' Days');
export const indicationNames = (list) => (list || []).slice().sort((a, b) => a - b).map((n) => n + '. ' + FORM_F_INDICATIONS[n - 1]);

export function formFCsv(records) {
  const cols = [
    { label: 'Reg. SNo', key: 'snoLabel' }, { label: 'Date', get: (r) => fmtDate(r.data.procedureDate || r.date) }, { label: 'Status', key: 'status' }, { label: 'Patient Regn No', key: 'regnNo' },
    { label: 'Patient', get: (r) => [r.data.patientTitle, r.data.patientName].filter(Boolean).join(' ') }, { label: 'Age', get: (r) => r.data.age },
    { label: "Husband's / Father's Name", get: (r) => r.data.husbandName }, { label: 'Living Sons', get: (r) => r.data.livingSons + (r.data.sonsAges ? ' (' + r.data.sonsAges + ')' : '') },
    { label: 'Living Daughters', get: (r) => r.data.livingDaughters + (r.data.daughtersAges ? ' (' + r.data.daughtersAges + ')' : '') }, { label: 'Total Living Children', get: (r) => r.data.totalChildren },
    { label: 'Address', get: (r) => r.data.address }, { label: 'Mobile', get: (r) => r.data.mobile }, { label: 'ID Proof', get: (r) => r.data.idType + ' ' + r.data.idNumber },
    { label: 'Referred By', get: (r) => [r.data.refDoctorName, r.data.refDoctorAddress].filter(Boolean).join(', ') }, { label: 'Self Referral', get: (r) => r.data.selfReferral },
    { label: 'LMP', get: (r) => (r.data.lmpMode === 'lmp' ? fmtDate(r.data.lmp) : 'Not Known / By USG') }, { label: 'GA', get: (r) => gaText(r.data) }, { label: 'EDD', get: (r) => fmtDate(r.data.edd) },
    { label: 'Indications', get: (r) => (r.data.indications || []).slice().sort((a, b) => a - b).join(', ') }, { label: 'Procedure', get: (r) => [r.data.procUltrasound ? 'Ultrasound' : '', r.data.procOther ? r.data.procedureOther : ''].filter(Boolean).join('; ') },
    { label: 'Result', get: (r) => r.data.result }, { label: 'Conveyed To', get: (r) => r.data.resultConveyedTo }, { label: 'MTP Indication', get: (r) => r.data.mtp },
    { label: 'Signature', get: (r) => (r.data.signatureType === 'thumb' ? 'Thumb impression' : 'Signed') }
  ];
  return toCSV(records, cols);
}

export function logFormF(action, rec, meta) { logAudit(action, 'formf/' + rec.id, Object.assign({ sno: rec.snoLabel, patient: rec.data && rec.data.patientName }, meta || {})); }

/** Brief result for Item 14 from a USG report's IMPRESSION section (parsed inertly with DOMParser). */
export function impressionFromReport(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  doc.body.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,tr').forEach((el) => el.append('\n'));
  doc.body.querySelectorAll('br').forEach((el) => el.replaceWith('\n'));
  const text = (doc.body.textContent || '').replace(/ /g, ' ');
  const m = text.match(/impression\s*:?([\s\S]*)/i);
  if (!m) return '';
  return m[1].split(/\n\s*(?:advice|advised|suggest|recommend|note\b|dr\.|pc-?pndt|declaration|i,\s)/i)[0]
    .split('\n').map((s) => s.replace(/^[\s•▪◦\-–—*\d.)]+/, '').trim()).filter(Boolean).slice(0, 4).join('; ').slice(0, 420);
}
