// Sample tube labels (50 × 25 mm thermal / label printer): one label per container type with a
// Code 128 barcode of the sample ID, patient, age / sex, collection time and the tests in that tube.
import { printHtml } from '../../core/print';
import { escapeHtml as e, fmtDateTime, ageShort, genderLabel } from '../../core/utils';
import { store } from '../../core/store';
import { LAB_PANELS } from './labPrint';

// Code 128 bar/space widths for values 0–106 (106 = stop, 7 elements)
const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 '
  + '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 '
  + '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 '
  + '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 '
  + '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 '
  + '114131 311141 411131 211412 211214 211232 2331112').split(' ');

/** Code 128-B barcode as an SVG string (printable ASCII only). */
export function code128Svg(text, { height = 34, module = 1.4, quiet = 10 } = {}) {
  const chars = String(text || '').replace(/[^\x20-\x7e]/g, '');
  const vals = [104];
  for (const ch of chars) vals.push(ch.charCodeAt(0) - 32);
  let sum = 104;
  for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
  vals.push(sum % 103, 106);
  const widths = vals.map((v) => C128[v]).join('').split('').map(Number);
  const total = widths.reduce((s, w) => s + w, 0) + quiet * 2;
  let x = quiet;
  const rects = [];
  widths.forEach((w, i) => { if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`); x += w; });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" width="${(total * module).toFixed(1)}" height="${height}" preserveAspectRatio="none" shape-rendering="crispEdges" fill="#000">${rects.join('')}</svg>`;
}

const TUBES = [
  [/edta/i, 'EDTA', 'Lavender'],
  [/citrate/i, 'CITRATE', 'Blue'],
  [/fluoride/i, 'FLUORIDE', 'Grey'],
  [/urine/i, 'URINE', 'Container'],
  [/stool/i, 'STOOL', 'Container'],
  [/semen/i, 'SEMEN', 'Container'],
  [/smear|aspirat|cytolog|fnac|pap/i, 'SLIDE', 'Slide'],
  [/serum|clotted|plain/i, 'SERUM', 'Red / Yellow']
];
function tubeOf(sample) {
  for (const [re, code, cap] of TUBES) if (re.test(sample || '')) return { code, cap };
  return { code: 'SAMPLE', cap: '' };
}

/** [{ tube:{code,cap}, tests:[short names] }] grouped by container type */
export function containersFor(rep) {
  const groups = new Map();
  (rep.tests || []).forEach((t) => {
    const p = t.panel && LAB_PANELS[t.panel];
    const tube = tubeOf(p ? p.sample : (store.get('tests', t.testId) || {}).description);
    const g = groups.get(tube.code) || { tube, tests: [] };
    const test = store.get('tests', t.testId);
    g.tests.push((test && test.shortName) || t.name);
    groups.set(tube.code, g);
  });
  return Array.from(groups.values());
}

export function sampleLabelsHtml(rep) {
  const p = rep.patient || {};
  const when = rep.sampleCollectedAt || Date.now();
  return containersFor(rep).map((g, i, all) => `<div class="print-page" style="width:50mm;height:25mm;padding:1.4mm 2mm;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;color:#000;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between">
    <div style="display:flex;justify-content:space-between;gap:1mm;font-size:7.6pt;line-height:1.1"><b style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e([p.title, p.name].filter(Boolean).join(' '))}</b><span style="white-space:nowrap">${e([ageShort(p.age, p.ageUnit), genderLabel(p.gender)].filter(Boolean).join(' / '))}</span></div>
    <div style="height:9.5mm;display:flex;justify-content:center">${code128Svg(rep.sampleId || rep.id, { height: 36 }).replace(/width="[\d.]+"/, 'width="100%"').replace(/height="36"/, 'height="100%"')}</div>
    <div style="display:flex;justify-content:space-between;font-size:7pt;line-height:1.1"><b style="letter-spacing:.04em">${e(rep.sampleId || '')}</b><span>${e(g.tube.code)}${all.length > 1 ? ' ' + (i + 1) + '/' + all.length : ''}</span></div>
    <div style="display:flex;justify-content:space-between;gap:1mm;font-size:6.4pt;line-height:1.1"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e(g.tests.join(', '))}</span><span style="white-space:nowrap">${e(fmtDateTime(when).replace(/\/\d{4}/, ''))}</span></div>
  </div>`).join('');
}

export function printSampleLabels(rep) {
  return printHtml({ html: sampleLabelsHtml(rep), widthMm: 50, heightMm: 25, title: 'Labels ' + (rep.sampleId || ''), audit: { action: 'lab:labels_printed', target: 'labReports/' + rep.id, meta: { sampleId: rep.sampleId } } });
}
