// Biometry for the reporting window: spoken measurement commands ("BPD 45 mm", "right kidney 10.2 by
// 4.5 cm"), Hadlock gestational age and estimated fetal weight, EDD by ultrasound, filling the
// matching report row or [__] placeholder, reading measurements back from a report, and a
// rule-based draft impression the doctor reviews before signing.
import { dateKey, addDays, fmtDate, escapeHtml } from './utils';

/** key · spoken pattern · report-label pattern · default unit · obstetric GA formula available */
export const MEASURES = [
  { key: 'bpd', name: 'BPD', spoken: /\b(?:b\s*\.?\s*p\s*\.?\s*d|biparietal(?:\s+diameter)?)\b/i, label: /biparietal|\bBPD\b/i, unit: 'mm', ga: true },
  { key: 'hc', name: 'HC', spoken: /\b(?:h\s*\.?\s*c|head\s+circumference)\b/i, label: /head\s+circumference|\bHC\b/i, unit: 'mm', ga: true },
  { key: 'ac', name: 'AC', spoken: /\b(?:a\s*\.?\s*c|abdominal\s+circumference)\b/i, label: /abdominal\s+circumference|\bAC\b/i, unit: 'mm', ga: true },
  { key: 'fl', name: 'FL', spoken: /\b(?:f\s*\.?\s*l|femur(?:\s+length)?|femoral\s+length)\b/i, label: /femur|\bFL\b/i, unit: 'mm', ga: true },
  { key: 'crl', name: 'CRL', spoken: /\b(?:c\s*\.?\s*r\s*\.?\s*l|crown[\s-]+rump(?:\s+length)?)\b/i, label: /crown.?rump|\bCRL\b/i, unit: 'mm', ga: true },
  { key: 'nt', name: 'NT', spoken: /\b(?:n\s*\.?\s*t|nuchal(?:\s+translucency)?)\b/i, label: /nuchal|\bNT\b/i, unit: 'mm' },
  { key: 'afi', name: 'AFI', spoken: /\b(?:a\s*\.?\s*f\s*\.?\s*i|amniotic\s+fluid(?:\s+index)?|liquor(?:\s+index)?)\b/i, label: /amniotic\s+fluid|\bAFI\b|liquor/i, unit: 'cm' },
  { key: 'fhr', name: 'FHR', spoken: /\b(?:f\s*\.?\s*h\s*\.?\s*r|f[oe]{1,2}tal\s+heart(?:\s+rate)?|heart\s+rate)\b/i, label: /heart\s+rate|\bFHR\b|cardiac\s+activity/i, unit: 'bpm' },
  { key: 'liver', name: 'Liver', spoken: /\bliver(?:\s+span)?\b/i, label: /\bliver\b/i, unit: 'cm' },
  { key: 'spleen', name: 'Spleen', spoken: /\bspleen\b/i, label: /\bspleen\b/i, unit: 'cm' },
  { key: 'rk', name: 'Right kidney', spoken: /\bright\s+kidney\b/i, label: /right\s+kidney/i, unit: 'cm' },
  { key: 'lk', name: 'Left kidney', spoken: /\bleft\s+kidney\b/i, label: /left\s+kidney/i, unit: 'cm' },
  { key: 'cbd', name: 'CBD', spoken: /\b(?:c\s*\.?\s*b\s*\.?\s*d|common\s+bile\s+duct)\b/i, label: /common\s+bile\s+duct|\bCBD\b/i, unit: 'mm' },
  { key: 'pv', name: 'Portal vein', spoken: /\bportal\s+vein\b/i, label: /portal\s+vein/i, unit: 'mm' },
  { key: 'gbwall', name: 'GB wall', spoken: /\b(?:gall\s*bladder\s+wall|g\s*b\s+wall)\b/i, label: /gall\s*bladder\s+wall|GB\s+wall/i, unit: 'mm' },
  { key: 'endo', name: 'Endometrium', spoken: /\bendometri(?:um|al)(?:\s+thickness)?\b/i, label: /endometri/i, unit: 'mm' },
  { key: 'uterus', name: 'Uterus', spoken: /\buterus\b/i, label: /\buterus\b/i, unit: 'cm' },
  { key: 'ro', name: 'Right ovary', spoken: /\bright\s+ovary\b/i, label: /right\s+ovary/i, unit: 'cm' },
  { key: 'lo', name: 'Left ovary', spoken: /\bleft\s+ovary\b/i, label: /left\s+ovary/i, unit: 'cm' },
  { key: 'prostate', name: 'Prostate', spoken: /\bprostate(?:\s+volume)?\b/i, label: /prostate/i, unit: 'cc' },
  { key: 'pvr', name: 'PVR', spoken: /\b(?:p\s*\.?\s*v\s*\.?\s*r|post[\s-]?void(?:\s+residual)?)\b/i, label: /post.?void|\bPVR\b/i, unit: 'ml' },
  { key: 'thyR', name: 'Right lobe', spoken: /\bright\s+lobe\b/i, label: /right\s+lobe/i, unit: 'cm' },
  { key: 'thyL', name: 'Left lobe', spoken: /\bleft\s+lobe\b/i, label: /left\s+lobe/i, unit: 'cm' }
];
const BY_KEY = Object.fromEntries(MEASURES.map((m) => [m.key, m]));

const UNIT_RE = /\b(millimet(?:er|re)s?|mm|centimet(?:er|re)s?|cm|cc|ml|millilit(?:er|re)s?|bpm|beats?\s+per\s+minute|grams?|g)\b/i;
const normUnit = (u) => {
  const s = String(u || '').toLowerCase();
  if (/^mm|millimet/.test(s)) return 'mm';
  if (/^cm|centimet/.test(s)) return 'cm';
  if (/^cc/.test(s)) return 'cc';
  if (/^ml|millilit/.test(s)) return 'ml';
  if (/bpm|beat/.test(s)) return 'bpm';
  if (/^g/.test(s)) return 'g';
  return '';
};

/** "BPD 45 point 2 millimetre" → { key:'bpd', values:[45.2], unit:'mm' }; null when the phrase is not a measurement. */
export function parseMeasurement(raw) {
  let t = ' ' + String(raw || '').toLowerCase().replace(/(\d)\s*point\s*(\d)/g, '$1.$2').replace(/\s+/g, ' ') + ' ';
  t = t.replace(/(\d)\s*(?:by|into|x|×|cross)\s*(\d)/g, '$1 x $2');
  for (const m of MEASURES) {
    const hit = m.spoken.exec(t);
    if (!hit) continue;
    const after = t.slice(hit.index + hit[0].length);
    const nums = /^\s*(?:is|of|measures?|measuring|=|:)?\s*(\d+(?:\.\d+)?)(?:\s*x\s*(\d+(?:\.\d+)?))?(?:\s*x\s*(\d+(?:\.\d+)?))?/.exec(after);
    if (!nums) continue;
    const values = [nums[1], nums[2], nums[3]].filter(Boolean).map(Number);
    const unitHit = UNIT_RE.exec(after.slice(nums[0].length, nums[0].length + 30));
    return { key: m.key, name: m.name, values, unit: normUnit(unitHit && unitHit[1]) || m.unit };
  }
  return null;
}

/** Value → millimetres (biometry formulas work in cm; inputs may be dictated in mm or cm). */
const toMm = (v, unit) => (unit === 'cm' ? v * 10 : v);

// ---------------------------------------------------------------- Hadlock formulas (decision support)
/** Gestational age in weeks from each available parameter (values in mm) and the Hadlock composite. */
export function gestationalAges({ bpd, hc, ac, fl, crl }) {
  const out = {};
  const cm = (mm) => mm / 10;
  if (crl > 0) out.crl = (8.052 * Math.sqrt(crl) + 23.73) / 7; // Robinson & Fleming
  if (bpd > 0) { const B = cm(bpd); out.bpd = 9.54 + 1.482 * B + 0.1676 * B * B; }
  if (hc > 0) { const H = cm(hc); out.hc = 8.96 + 0.540 * H + 0.0003 * H * H * H; }
  if (ac > 0) { const A = cm(ac); out.ac = 8.14 + 0.753 * A + 0.0036 * A * A; }
  if (fl > 0) { const F = cm(fl); out.fl = 10.35 + 2.460 * F + 0.170 * F * F; }
  if (bpd > 0 && hc > 0 && ac > 0 && fl > 0) {
    const B = cm(bpd); const H = cm(hc); const A = cm(ac); const F = cm(fl);
    out.composite = 10.85 + 0.060 * H * F + 0.6700 * B + 0.1680 * A;
  } else {
    const parts = ['bpd', 'hc', 'ac', 'fl'].filter((k) => out[k]);
    if (parts.length) out.composite = parts.reduce((s, k) => s + out[k], 0) / parts.length;
    else if (out.crl) out.composite = out.crl;
  }
  return out;
}

/** Estimated fetal weight in grams: Hadlock 4-parameter (BPD, HC, AC, FL) or AC + FL. */
export function efwGrams({ bpd, hc, ac, fl }) {
  if (!(ac > 0 && fl > 0)) return null;
  const A = ac / 10; const F = fl / 10;
  if (bpd > 0 && hc > 0) {
    const B = bpd / 10; const H = hc / 10;
    return Math.round(Math.pow(10, 1.3596 - 0.00386 * A * F + 0.0064 * H + 0.00061 * B * A + 0.0424 * A + 0.174 * F));
  }
  return Math.round(Math.pow(10, 1.304 + 0.05281 * A + 0.1938 * F - 0.004 * A * F));
}

export const weeksToGa = (w) => {
  if (!(w > 0)) return null;
  const days = Math.round(w * 7);
  return { weeks: Math.floor(days / 7), days: days % 7, totalDays: days };
};
export const gaLabel = (g) => (g ? g.weeks + ' weeks ' + g.days + ' day' + (g.days === 1 ? '' : 's') : '');
export const eddFromGa = (g, onDate = new Date()) => (g ? dateKey(addDays(onDate, 280 - g.totalDays)) : '');

// ---------------------------------------------------------------- reading & writing the report DOM
const PH_RE = /\[(?:__+|X|x)\]/;
const numberIn = (s) => { const m = /(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?(?:\s*[x×]\s*(\d+(?:\.\d+)?))?\s*(mm|cm|cc|ml|bpm|g)?/i.exec(String(s || '')); return m ? { values: [m[1], m[2], m[3]].filter(Boolean).map(Number), unit: (m[4] || '').toLowerCase() } : null; };

/** Measurements already in the report: table rows (label cell → value cell) and "label … 12.3 cm" text. */
export function readMeasurements(root) {
  const out = {};
  if (!root) return out;
  root.querySelectorAll('tr').forEach((tr) => {
    const cells = tr.querySelectorAll('td,th');
    if (cells.length < 2) return;
    const label = cells[0].textContent;
    const m = MEASURES.find((x) => x.label.test(label));
    if (!m || out[m.key] || /\d\s*\/\s*\d/.test(cells[1].textContent)) return; // a score such as "2/2" is not a measurement
    const n = numberIn(cells[1].textContent);
    if (n && n.values.length) out[m.key] = { values: n.values, unit: n.unit || m.unit };
  });
  const text = root.textContent || '';
  MEASURES.forEach((m) => {
    if (out[m.key]) return;
    const re = new RegExp(m.label.source + '[^.\\n]{0,40}?(\\d+(?:\\.\\d+)?(?:\\s*[x×]\\s*\\d+(?:\\.\\d+)?){0,2})\\s*(mm|cm|cc|ml|bpm)', 'i');
    const hit = re.exec(text);
    if (hit) { const n = numberIn(hit[1] + ' ' + hit[2]); if (n) out[m.key] = { values: n.values, unit: n.unit || m.unit }; }
  });
  return out;
}

/** Biometry values in mm from read measurements. */
export function biometryMm(meas) {
  const v = {};
  ['bpd', 'hc', 'ac', 'fl', 'crl', 'nt'].forEach((k) => { if (meas[k] && meas[k].values[0]) v[k] = toMm(meas[k].values[0], meas[k].unit); });
  return v;
}

const fmtVal = (values, unit) => values.map((x) => (Number.isInteger(x) ? String(x) : String(+x.toFixed(2)))).join(' × ') + (unit ? ' ' + unit : '');

/** Replace the first [__] at or after character `from` of the element's text; the unit is added when the template has none. */
function replacePlaceholderAfter(el, from, values, unit) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let n;
  while ((n = walker.nextNode())) {
    const start = pos;
    pos += n.data.length;
    if (pos <= from) continue;
    const re = new RegExp(PH_RE.source, 'g');
    let m;
    while ((m = re.exec(n.data))) {
      if (start + m.index < from) continue;
      const tail = n.data.slice(m.index + m[0].length, m.index + m[0].length + 8);
      const text = fmtVal(values, /^\s*(mm|cm|cc|ml|bpm|g)\b/i.test(tail) ? '' : unit);
      n.data = n.data.slice(0, m.index) + text + n.data.slice(m.index + m[0].length);
      return true;
    }
  }
  return false;
}

/**
 * Put a measurement into the report: the matching table row (value cell, and the GA cell for foetal
 * biometry), else the first [__] after the label in the same paragraph. Returns a short description,
 * or null when the report has no place for it.
 */
export function fillMeasurement(root, parsed, onDate = new Date()) {
  if (!root || !parsed) return null;
  const m = BY_KEY[parsed.key];
  const valueText = fmtVal(parsed.values, parsed.unit);
  for (const tr of root.querySelectorAll('tr')) {
    const cells = tr.querySelectorAll('td');
    if (cells.length < 2 || !m.label.test(cells[0].textContent)) continue;
    // only measurement cells: a [__] blank or an earlier value with a unit (never a score such as "2/2")
    const cur = cells[1].textContent;
    if (!PH_RE.test(cur) && !/\d\s*(mm|cm|cc|ml|bpm|g)\b/i.test(cur)) continue;
    cells[1].textContent = valueText;
    if (m.ga && cells.length > 2) {
      const ga = weeksToGa((gestationalAges({ [m.key]: toMm(parsed.values[0], parsed.unit) }) || {})[m.key]);
      if (ga) cells[2].textContent = ga.weeks + 'w ' + ga.days + 'd';
    }
    return m.name + ' ' + valueText;
  }
  for (const block of root.querySelectorAll('p,li,td,div')) {
    if (block.querySelector('p,li,div,table')) continue;
    const t = block.textContent;
    const lab = m.label.exec(t);
    if (!lab) continue;
    const ph = PH_RE.exec(t.slice(lab.index));
    if (!ph) continue;
    if (replacePlaceholderAfter(block, lab.index, parsed.values, parsed.unit)) return m.name + ' ' + valueText;
  }
  return null;
}

// ---------------------------------------------------------------- derived values (GA, EDD, EFW)
/** Calculated fields from the report's biometry and the LMP: GA / EDD by USG and by dates, EFW. */
export function computeCalc(root, { lmp, onDate = new Date() } = {}) {
  const meas = readMeasurements(root);
  const bio = biometryMm(meas);
  const ages = gestationalAges(bio);
  const ga = weeksToGa(ages.composite);
  const out = { GA_USG: ga ? gaLabel(ga) : '', EDD_USG: ga ? fmtDate(eddFromGa(ga, onDate)) : '', EFW: '' };
  const efw = efwGrams(bio);
  if (efw && ga && ga.weeks >= 16) out.EFW = efw + ' g';
  if (lmp) {
    const days = Math.round((new Date(onDate) - new Date(lmp)) / 86400000);
    if (days > 0 && days < 320) { out.GA_LMP = Math.floor(days / 7) + ' weeks ' + (days % 7) + ' day' + (days % 7 === 1 ? '' : 's'); out.EDD_LMP = fmtDate(dateKey(addDays(new Date(lmp), 280))); }
  }
  return out;
}

const CALC_ROWS = [
  [/(average|composite|mean)\s+(gestational\s+age|GA)|gestational\s+age\s+by\s+(usg|biometry)|\bGA\s+by\s+USG/i, 'GA_USG'],
  [/\bEDD\b.*\b(usg|ultrasound|biometry)\b|expected\s+date.*\b(usg|ultrasound)/i, 'EDD_USG'],
  [/estimated\s+f[oe]{1,2}tal\s+weight|\bEFW\b/i, 'EFW'],
  [/\bEDD\b.*\b(lmp|dates)\b/i, 'EDD_LMP'],
  [/\bGA\b.*\b(lmp|dates)\b|gestational\s+age\s+by\s+(lmp|dates)/i, 'GA_LMP']
];

/** Recompute per-parameter GA cells, calculated rows and [data-calc] fields; returns how many changed. */
export function recalcFields(root, ctx = {}) {
  if (!root) return 0;
  let n = 0;
  root.querySelectorAll('tr').forEach((tr) => {
    const cells = tr.querySelectorAll('td');
    if (cells.length < 3) return;
    const m = MEASURES.find((x) => x.ga && x.label.test(cells[0].textContent));
    const v = m && numberIn(cells[1].textContent);
    if (!m || !v || !v.values[0]) return;
    const ga = weeksToGa(gestationalAges({ [m.key]: toMm(v.values[0], v.unit || m.unit) })[m.key]);
    const txt = ga ? ga.weeks + 'w ' + ga.days + 'd' : '';
    if (txt && cells[2].textContent.trim() !== txt) { cells[2].textContent = txt; n += 1; }
  });
  const calc = computeCalc(root, ctx);
  root.querySelectorAll('[data-calc]').forEach((el) => {
    const v = calc[el.getAttribute('data-calc')];
    if (v && el.textContent !== v) { el.textContent = v; n += 1; }
  });
  root.querySelectorAll('tr').forEach((tr) => {
    const cells = Array.from(tr.querySelectorAll('td'));
    if (cells.length < 2) return;
    const hit = CALC_ROWS.find(([re]) => re.test(cells[0].textContent));
    const v = hit && calc[hit[1]];
    if (!v) return;
    const rest = cells.slice(1);
    const target = rest.find((c) => c.hasAttribute('data-calc')) || rest.find((c) => PH_RE.test(c.textContent)) || (rest.every((c) => !c.textContent.trim()) ? rest[rest.length - 1] : null);
    if (!target) return;
    const before = target.textContent;
    if (hit[1] === 'EFW' && /\[__\]\s*g/.test(before)) replacePlaceholderAfter(target, 0, [parseInt(v, 10)], 'g');
    else target.textContent = v;
    target.setAttribute('data-calc', hit[1]);
    if (target.textContent !== before) n += 1;
  });
  // "LMP: [__] | GA by LMP: [__] weeks [__] days | EDD by LMP: [__]" style lines
  if (ctx.lmp) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let t;
    while ((t = walker.nextNode())) nodes.push(t);
    nodes.forEach((node) => {
      let d = node.data;
      const before = d;
      if (calc.GA_LMP) d = d.replace(/(GA\s+by\s+(?:LMP|dates)\s*:?\s*)\[__\]\s*weeks\s*\[__\]\s*days/i, '$1' + calc.GA_LMP);
      if (calc.EDD_LMP) d = d.replace(/(EDD\s+by\s+(?:LMP|dates)\s*:?\s*)\[__\]/i, '$1' + calc.EDD_LMP);
      const label = node.parentElement && node.parentElement.previousSibling === null && node.previousSibling;
      if (/^\s*\[__\]\s*\|\s*GA\s+by\s+LMP/i.test(d) || (label && /^\s*LMP\s*:?\s*$/i.test(label.textContent || '') && /^\s*\[__\]/.test(d))) d = d.replace(/\[__\]/, fmtDate(ctx.lmp));
      if (d !== before) { node.data = d; n += 1; }
    });
  }
  return n;
}

// ---------------------------------------------------------------- impression drafting
const ABNORMAL = /(calcul|stone|hydro(?:nephrosis|ureter)|dilat|cyst|mass|lesion|nodul|fibroid|polyp|thicken|fatty|grade\s+[i1-3]|enlarg|hepatomegaly|splenomegaly|collection|free\s+fluid|ascites|sludge|echogenic\s+focus|hyperechoic|hypoechoic|heterogen|oedema|edema|inflam|abscess|torsion|varicocele|hernia|effusion|calcification|retained|incomplete|ectopic|oligo|polyhydramnios|breech|transverse|low[\s-]?lying|praevia|previa|cord\s+around|IUGR|small\s+for)/i;
const NEGATED = /\b(no|not|without|absent|nil|negative|normal)\b[^.]*$/i;

/** Draft impression lines from the report text (obstetric biometry, else abnormal findings). */
export function draftImpression(root, { lmp, onDate = new Date(), obstetric } = {}) {
  const meas = readMeasurements(root);
  const lines = [];
  const text = (root && root.textContent) || '';
  const bio = biometryMm(meas);
  const isObs = obstetric || !!(bio.crl || bio.bpd || bio.fl || bio.ac);
  if (isObs) {
    const ages = gestationalAges(bio);
    const ga = weeksToGa(ages.composite);
    const live = meas.fhr ? 'live ' : '';
    const multiple = /\b(twin|dichorionic|monochorionic|two\s+f[oe]{1,2}tus)/i.test(text);
    if (ga) {
      let l = (multiple ? 'Live twin intrauterine gestation' : 'Single ' + live + 'intrauterine fœtus') + ' of about ' + gaLabel(ga) + ' by ultrasound biometry (EDD by USG ' + fmtDate(eddFromGa(ga, onDate)) + ')';
      if (lmp) {
        const lmpDays = Math.round((new Date(onDate) - new Date(lmp)) / 86400000);
        const diff = ga.totalDays - lmpDays;
        l += Math.abs(diff) <= 7 ? ', corresponding to the period of amenorrhoea' : diff < 0 ? ', lagging behind dates by about ' + Math.round(-diff / 7) + ' week' + (Math.round(-diff / 7) === 1 ? '' : 's') : ', ahead of dates by about ' + Math.round(diff / 7) + ' week' + (Math.round(diff / 7) === 1 ? '' : 's');
      }
      lines.push(l + '.');
    }
    const efw = efwGrams(bio);
    if (efw && ga && ga.weeks >= 16) lines.push('Estimated foetal weight ' + efw + ' g (± 15%, Hadlock).');
    if (meas.fhr) lines.push('Foetal cardiac activity present (FHR ' + meas.fhr.values[0] + ' bpm).');
    const pres = /\b(cephalic|breech|transverse|oblique)\b\s+(?:presentation|lie)?/i.exec(text);
    if (pres) lines.push(pres[1].charAt(0).toUpperCase() + pres[1].slice(1).toLowerCase() + ' presentation.');
    const plac = /placenta[^.]{0,40}?\b(anterior|posterior|fundal|lateral|left\s+lateral|right\s+lateral)\b[^.]*\./i.exec(text);
    if (plac) lines.push(plac[0].trim().replace(/\s+/g, ' ').replace(/^[A-Z][A-Z\s/]+:\s*/, ''));
    if (meas.afi) { const a = meas.afi.values[0]; lines.push(a < 5 ? 'Oligohydramnios (AFI ' + a + ' cm).' : a > 24 ? 'Polyhydramnios (AFI ' + a + ' cm).' : 'Liquor adequate (AFI ' + a + ' cm).'); }
    if (meas.nt) lines.push('Nuchal translucency ' + meas.nt.values[0] + ' mm' + (meas.nt.values[0] >= 3.5 ? ' (increased; correlate with combined screening)' : ' (within normal limits)') + '.');
    return { lines, meas, obstetric: true };
  }
  const findings = text.split(/IMPRESSION/i)[0];
  findings.split(/(?<=[.])\s+/).forEach((sent) => {
    const s = sent.replace(/\s+/g, ' ').trim();
    if (s.length < 8 || !ABNORMAL.test(s)) return;
    const head = s.slice(0, s.search(ABNORMAL));
    if (NEGATED.test(head)) return;
    if (!lines.includes(s)) lines.push(s.endsWith('.') ? s : s + '.');
  });
  if (!lines.length) lines.push('No significant sonographic abnormality detected in the regions examined.');
  return { lines: lines.slice(0, 6), meas, obstetric: false };
}

/** Replace (or add) the IMPRESSION section of a report element with the given lines. */
export function setImpression(root, lines) {
  const html = '<ol>' + lines.map((l) => '<li><strong>' + escapeHtml(l) + '</strong></li>').join('') + '</ol>';
  const heads = Array.from(root.querySelectorAll('h1,h2,h3,h4,p,div,strong,b')).filter((el) => /^\s*impression\s*:?\s*$/i.test(el.textContent));
  let head = heads[0];
  if (head && /^(STRONG|B)$/.test(head.tagName)) head = head.closest('p,div,h1,h2,h3,h4') || head;
  if (!head) {
    root.insertAdjacentHTML('beforeend', '<h3>IMPRESSION</h3>' + html);
    return 'added';
  }
  // remove the old impression list / lines, keeping what follows (PC-PNDT declaration, notes, signature)
  const keep = /declare|pc-?pndt|correlat|advice|advise|recommend|note|signature|dictated|electronically/i;
  let n = head.nextElementSibling;
  let removed = 0;
  while (n && removed < 8 && !/^H[1-4]$/.test(n.tagName) && !n.matches('.sig,.signature,[data-sig],table') && !keep.test(n.textContent)) {
    const next = n.nextElementSibling;
    const isList = /^(OL|UL)$/.test(n.tagName);
    n.remove();
    removed += 1;
    n = next;
    if (isList) break;
  }
  head.insertAdjacentHTML('afterend', html);
  return 'replaced';
}

/** Spoken report commands other than measurements. */
export function parseReportCommand(raw) {
  const t = String(raw || '').toLowerCase().replace(/[.!]/g, '').trim();
  if (/^(generate|write|draft|create|make)\s+(the\s+)?impression$/.test(t) || t === 'auto impression') return 'impression';
  if (/^(recalculate|calculate|update)\s+(the\s+)?(biometry|measurements|calculations|gestational age|ga|edd)$/.test(t)) return 'recalc';
  if (/^(next|go to next)\s+(field|blank|placeholder)$/.test(t)) return 'next';
  return null;
}
