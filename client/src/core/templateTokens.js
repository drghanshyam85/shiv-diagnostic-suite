// Dynamic template content, resolved when a template / macro is inserted into a report:
//   {{Patient_Name}} {{Age}} {{Sex}} {{Age_Sex}} {{Patient_ID}} {{Ref_Doctor}} {{Date}} {{Exam}}
//   {{Indication}} {{LMP}} {{Doctor_Name}} {{Clinic_Name}}      → the patient's details ([__] if unknown)
//   {{>trigger}}                                                  → another macro, nested (modular blocks)
//   {{GA_USG}} {{EDD_USG}} {{EFW}} {{GA_LMP}} {{EDD_LMP}}         → calculated fields that stay live and
//                                                                   update with "Recalculate" / new biometry
import { escapeHtml, fmtDate, genderLabel } from './utils';

export const DEMOG_TOKENS = [
  ['Patient_Name', 'Patient name'], ['Age', 'Age'], ['Sex', 'Sex'], ['Age_Sex', 'Age / sex'], ['Patient_ID', 'Patient ID'],
  ['Ref_Doctor', 'Referring doctor'], ['Date', 'Scan date'], ['Exam', 'Examination'], ['Indication', 'Clinical indication'],
  ['LMP', 'LMP'], ['Doctor_Name', 'Reporting doctor'], ['Clinic_Name', 'Centre name']
];
export const CALC_TOKENS = [
  ['GA_USG', 'GA by USG (biometry)'], ['EDD_USG', 'EDD by USG'], ['EFW', 'Estimated foetal weight'], ['GA_LMP', 'GA by LMP'], ['EDD_LMP', 'EDD by LMP']
];
const CALC_SET = new Set(CALC_TOKENS.map(([k]) => k));
const NEST_RE = /\{\{\s*(?:>|macro:)\s*([^}\s]+)\s*\}\}/gi;
const TOKEN_RE = /\{\{\s*([A-Za-z_]+)\s*\}\}/g;

/** Values for the demographic placeholders from the report being edited. */
export function demographicValues({ report, visit, settings }) {
  const d = (report && report.demographics) || {};
  const o = (visit && visit.obstetric) || {};
  const sex = genderLabel(d.sex);
  return {
    Patient_Name: d.name || '', Age: d.age || '', Sex: sex, Age_Sex: [d.age, sex].filter(Boolean).join(' / '), Patient_ID: d.patientId || '',
    Ref_Doctor: d.refBy || '', Date: d.date ? fmtDate(d.date) : '', Exam: d.modality || '', Indication: d.indication || '',
    LMP: o.lmp ? fmtDate(o.lmp) : '', Doctor_Name: settings ? settings.clinic.radiologist.name : '', Clinic_Name: settings ? settings.clinic.name : ''
  };
}

/**
 * Resolve nested macros (depth ≤ 4, loops cut), demographic placeholders and calculated fields.
 * getByTrigger(trigger) → Promise<macro|null>. calc: current calculated values (optional).
 */
export async function expandTemplateContent(html, { values = {}, calc = {}, getByTrigger, depth = 0, seen = new Set() } = {}) {
  let out = String(html || '');
  if (getByTrigger && depth < 4) {
    const parts = [];
    let last = 0;
    let m;
    NEST_RE.lastIndex = 0;
    const src = out;
    while ((m = NEST_RE.exec(src))) {
      parts.push(src.slice(last, m.index));
      const trig = m[1].toLowerCase();
      if (seen.has(trig)) { parts.push('[__]'); last = m.index + m[0].length; continue; }
      const mac = await getByTrigger(trig);
      if (mac && mac.content) {
        const inner = await expandTemplateContent(mac.content, { values, calc, getByTrigger, depth: depth + 1, seen: new Set(Array.from(seen).concat([trig])) });
        parts.push(inner.replace(/^\s*<p>([\s\S]*)<\/p>\s*$/i, (all, x) => (/<\/?(p|div|table|ol|ul|h\d)\b/i.test(x) ? all : x)));
      } else parts.push('[' + m[1] + ' not found]');
      last = m.index + m[0].length;
    }
    parts.push(src.slice(last));
    out = parts.join('');
  }
  return out.replace(TOKEN_RE, (all, key) => {
    if (CALC_SET.has(key)) return '<span data-calc="' + key + '">' + escapeHtml(calc[key] || '[__]') + '</span>';
    if (Object.prototype.hasOwnProperty.call(values, key)) return values[key] ? escapeHtml(values[key]) : '[__]';
    return all; // unknown tokens stay visible for the doctor
  });
}

export const hasDynamicTokens = (html) => /\{\{\s*(?:>|macro:)?\s*[A-Za-z_]/.test(String(html || ''));
