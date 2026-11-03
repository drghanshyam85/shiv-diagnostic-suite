// Obstetric calculators — Naegele's rule (EDD = LMP + 280 days), gestational age (weeks + days),
// back-calculation of clinical LMP from USG GA or EDD, trimester and Form F indication suggestions.
import { addDays, dateKey, parseKey } from './utils';

const DAY = 86400000;
const toDate = (v) => (v instanceof Date ? v : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? parseKey(v) : new Date(v));

export function eddFromLmp(lmp) { return lmp ? dateKey(addDays(toDate(lmp), 280)) : ''; }
export function lmpFromEdd(edd) { return edd ? dateKey(addDays(toDate(edd), -280)) : ''; }

export function gaFromLmp(lmp, onDate = new Date()) {
  if (!lmp) return null;
  const days = Math.round((toDate(dateKey(onDate)) - toDate(lmp)) / DAY);
  if (days < 0 || days > 320) return { weeks: 0, days: 0, totalDays: days, invalid: true };
  return { weeks: Math.floor(days / 7), days: days % 7, totalDays: days };
}

export function lmpFromGa(weeks, days, onDate = new Date()) {
  const total = (Number(weeks) || 0) * 7 + (Number(days) || 0);
  return dateKey(addDays(toDate(dateKey(onDate)), -total));
}

export function gaFromEdd(edd, onDate = new Date()) { return gaFromLmp(lmpFromEdd(edd), onDate); }

export const trimester = (weeks) => (weeks < 14 ? 1 : weeks < 28 ? 2 : 3);
export const formatGa = (w, d) => (w || w === 0 ? `${w} Weeks ${d || 0} Days` : '');

/** Official Form F – Section B Item 10 representative list (23 indications). */
export const FORM_F_INDICATIONS = [
  'To diagnose intra-uterine &/or ectopic pregnancy & confirm viability',
  'Estimation of gestational age (dating)',
  'Detection of number of fetuses and their chorionicity',
  'Suspected pregnancy with IUCD in-situ or suspected pregnancy following contraceptive failure/MTP failure',
  'Vaginal bleeding/leaking',
  'Follow-up of cases of abortion',
  'Assessment of cervical canal and diameter of internal os',
  'Discrepancy between uterine size and period of amenorrhoea',
  'Any suspected adenexal or uterine pathology/abnormality',
  'Detection of chromosomal abnormalities, foetal structural defects & other abnormalities and their follow-up',
  'To evaluate foetal presentation and position',
  'Assessment of liquor amnii',
  'Preterm labour / preterm premature rupture of membranes',
  'Evaluation of placental position, thickness, grading & abnormalities (placenta praevia, retroplacental haemorrhage, abnormal adherence etc)',
  'Evaluation of umbilical cord presentation, insertion, nuchal encirclement, number of vessels and presence of true knot',
  'Evaluation of previous Caesarean Section scars',
  'Evaluation of foetal growth parameters, foetal weight and foetal well being',
  'Colour flow mapping and duplex Doppler studies',
  'Ultrasound guided procedures such as medical termination of pregnancy, external cephalic version etc. and their follow-up',
  'Adjunct to diagnostic & therapeutic invasive interventions such as chorionic villus sampling (CVS), amniocenteses, foetal blood sampling, foetal skin biopsy, amnioinfusion, intrauterine infusion, placement of shunts',
  'Observation of intra-partum events',
  'Medical/surgical conditions complicating pregnancy',
  'Research/scientific studies in recognized institutions'
];

/** 1-based indication numbers suggested for a gestational age (weeks). */
export function suggestIndications(weeks) {
  if (weeks === null || weeks === undefined || weeks === '') return [];
  return Number(weeks) < 14 ? [1, 2] : [10, 11, 12, 17];
}

export function obstetricSummary(o, onDate) {
  if (!o) return '';
  const ga = o.mode === 'lmp' && o.lmp ? gaFromLmp(o.lmp, onDate) : o.gaWeeks !== undefined && o.gaWeeks !== '' ? { weeks: Number(o.gaWeeks), days: Number(o.gaDays || 0) } : null;
  return [o.lmp && o.mode === 'lmp' ? 'LMP ' + o.lmp.split('-').reverse().join('/') : 'LMP not known', ga ? 'GA ' + formatGa(ga.weeks, ga.days) : '', o.edd ? 'EDD ' + o.edd.split('-').reverse().join('/') : ''].filter(Boolean).join(' | ');
}
