// Automatic ultrasound image sorting: every attached image gets an organ (from its caption, file name or
// DICOM series / body part / protocol / comments) and an acquisition time (DICOM header, EXIF, or the
// file's own time). "Auto" order follows the organs in the order the report describes them, then time;
// "Time" is the order the images were captured; "Manual" keeps the doctor's own arrangement.
import { stripHtml } from './utils';

export const ORGANS = [
  { key: 'liver', label: 'Liver', re: /\b(liver|hepatic|lvr|segment\s*[ivx1-8]+)\b/ },
  { key: 'gb', label: 'Gall bladder', re: /\b(gall\s*bladder|gb|gallstones?|cholecyst\w*)\b/ },
  { key: 'cbd', label: 'CBD / portal vein', re: /\b(cbd|common bile duct|chd|portal vein|pv|porta)\b/ },
  { key: 'pancreas', label: 'Pancreas', re: /\b(pancrea\w*|panc)\b/ },
  { key: 'spleen', label: 'Spleen', re: /\b(spleen|splenic|spl)\b/ },
  { key: 'rk', label: 'Right kidney', re: /\b(right\s*kidney|rt\.?\s*(kidney|kid|renal)|r\.?\s*kid(ney)?|rk)\b/ },
  { key: 'lk', label: 'Left kidney', re: /\b(left\s*kidney|lt\.?\s*(kidney|kid|renal)|l\.?\s*kid(ney)?|lk)\b/ },
  { key: 'kidney', label: 'Kidneys', re: /\b(kidneys?|renal|kub)\b/ },
  { key: 'ureter', label: 'Ureters', re: /\b(ureters?|vuj|puj)\b/ },
  { key: 'bladder', label: 'Urinary bladder', re: /\b(urinary\s*bladder|(?<!gall\s?)bladder|ub|pvr|post\s*void\w*)\b/ },
  { key: 'prostate', label: 'Prostate', re: /\b(prostat\w*)\b/ },
  { key: 'uterus', label: 'Uterus', re: /\b(uterus|uterine|endometri\w*|myometri\w*|cervix|cervical length)\b/ },
  { key: 'ovary', label: 'Ovaries / adnexa', re: /\b(ovar(y|ies|ian)|adnex\w*|follicles?|rt\s*ovary|lt\s*ovary)\b/ },
  { key: 'fetus', label: 'Foetus / biometry', re: /\b(f(o)?et(us|al)|bpd|hc|ac|fl|crl|fhr|nt|nuchal|biometry|efw|gestational sac|gs|yolk sac)\b/ },
  { key: 'placenta', label: 'Placenta / liquor', re: /\b(placenta\w*|afi|liquor|amniotic|svp)\b/ },
  { key: 'thyroid', label: 'Thyroid / neck', re: /\b(thyroid|isthmus|neck|cervical nodes?)\b/ },
  { key: 'breast', label: 'Breast / axilla', re: /\b(breasts?|axilla\w*|birads)\b/ },
  { key: 'scrotum', label: 'Scrotum / testes', re: /\b(scrot\w*|test(is|es|icular)|epididym\w*|varicocele)\b/ },
  { key: 'carotid', label: 'Carotid / vertebral', re: /\b(carotids?|cca|ica|eca|vertebral|imt)\b/ },
  { key: 'vessels', label: 'Limb vessels', re: /\b(artery|arteries|arterial|venous|veins?|dvt|cfa|sfa|popliteal|gsv)\b/ },
  { key: 'appendix', label: 'Appendix / RIF', re: /\b(append(ix|icitis|iceal)|rif|mcburney)\b/ },
  { key: 'bowel', label: 'Bowel / free fluid', re: /\b(bowel|ascites|free fluid|peritone\w*|morison\w*|pouch of douglas|pod)\b/ },
  { key: 'chest', label: 'Chest / pleura', re: /\b(pleura\w*|lungs?|chest|effusion)\b/ },
  { key: 'soft', label: 'Soft tissue', re: /\b(soft tissue|swelling|lump|lymph node|hernia|abscess)\b/ }
];
const BY_KEY = Object.fromEntries(ORGANS.map((o, i) => [o.key, Object.assign({ rank: i }, o)]));
export const organLabel = (key) => (BY_KEY[key] ? BY_KEY[key].label : '');

const norm = (s) => ' ' + String(s || '')
  .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase file names
  .replace(/[_\-.+()[\]/\\]+/g, ' ')
  .toLowerCase().replace(/\s+/g, ' ') + ' ';

/** The organ the texts talk about (first, most specific match), or ''. */
export function detectOrgan(...texts) {
  const t = norm(texts.filter(Boolean).join(' '));
  if (!t.trim()) return '';
  for (const o of ORGANS) if (o.re.test(t)) return o.key;
  return '';
}

const GENERIC = /^(img|image|im|dsc|dscn|us|usg|scan|capture|clipboard|screenshot|photo|pic|frame|snap|export|series|dicom|untitled)?[\s_-]*\d*[\s_-]*(f\d+)?$/i;
/** A caption that is just a file name like "IMG 0001" or "US000012" — safe to replace. */
export const genericCaption = (c) => !String(c || '').trim() || GENERIC.test(String(c).trim()) || /^\d[\d\s_-]*$/.test(String(c).trim());

const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Rt|Lt|Cbd|Gb|Ub|Pvr|Afi|Bpd|Hc|Ac|Fl|Crl|Fhr|Kub)\b/g, (x) => x.toUpperCase());

/** Caption for a new image: keep a real caption, else the DICOM series, else the organ. */
export function autoCaption(current, { organ, series, frame, frames } = {}) {
  if (!genericCaption(current)) return current;
  const base = series && !genericCaption(series) ? titleCase(series) : organLabel(organ);
  if (!base) return current || '';
  return base + (frames > 1 && frame ? ' – frame ' + frame : '');
}

/** Where each organ first appears in the report text → rank (organs the report never mentions go last). */
export function organOrder(html) {
  const t = norm(stripHtml(html || ''));
  const pos = {};
  ORGANS.forEach((o) => {
    const m = o.re.exec(t);
    pos[o.key] = m ? m.index : 1e7 + BY_KEY[o.key].rank;
  });
  if (pos.kidney < 1e7) { // a "KIDNEYS:" section covers both sides, right first
    if (pos.rk >= 1e7) pos.rk = pos.kidney + 0.1;
    if (pos.lk >= 1e7) pos.lk = pos.kidney + 0.2;
  }
  return pos;
}

const timeOf = (im) => im.acquiredAt || im.at || 0;

/** Sort report images: mode 'auto' (organ order of the report, then time) | 'time' | 'manual'. */
export function sortImages(images, mode, html) {
  const list = (images || []).slice();
  if (mode === 'manual') return list;
  const idx = new Map(list.map((im, i) => [im.id, i]));
  if (mode === 'time') return list.sort((a, b) => timeOf(a) - timeOf(b) || idx.get(a.id) - idx.get(b.id));
  const pos = organOrder(html);
  const rank = (im) => (im.organ && pos[im.organ] !== undefined ? pos[im.organ] : 2e7);
  return list.sort((a, b) => rank(a) - rank(b) || timeOf(a) - timeOf(b) || idx.get(a.id) - idx.get(b.id));
}

export const SORT_MODES = [
  { value: 'auto', label: 'Auto', title: 'Follow the organs in the order the report describes them, then capture time' },
  { value: 'time', label: 'Time', title: 'The order the images were captured' },
  { value: 'manual', label: 'Manual', title: 'Your own order (arrows / drag)' }
];
