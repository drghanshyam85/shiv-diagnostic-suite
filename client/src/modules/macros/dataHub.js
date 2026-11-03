// Data Hub logic: parse JSON / CSV / TSV / TXT macro databases, turn Word / PDF / HTML / text documents
// into templates (auto trigger, category & modality), and export the library as JSON, CSV, TXT, HTML
// catalog, MS Word catalog (.doc / .docx) or a printable / PDF reference book.
import { macros, MODALITIES } from '../../core/macros';
import { csvToObjects, toCSV, download, downloadBlob, readAsText, stripHtml, escapeHtml, fileExt, dateKey, fmtDate } from '../../core/utils';
import { fileToHtml } from '../../core/importers';
import { exportDoc, standaloneHtml } from '../../core/exporters';
import { htmlToDocxBlob } from '../../core/docx';
import { htmlToPdf } from '../../core/pdf';
import { printHtml } from '../../core/print';
import { getSettings } from '../../core/hooks';
import { renderReportPages } from '../reporting/reportPrint';

export const DOC_EXTS = ['docx', 'doc', 'odt', 'pdf', 'html', 'htm', 'rtf', 'md'];
export const DATA_EXTS = ['json', 'csv', 'tsv', 'txt'];

export function autoTrigger(title, taken = new Set()) {
  const words = String(title || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !['usg', 'the', 'of', 'and', 'with', 'scan', 'report', 'normal', 'a', 'an', 'for', 'in'].includes(w));
  let base = '.' + (words.length === 1 ? words[0].slice(0, 6) : words.slice(0, 4).map((w) => w[0]).join('')) || '.tpl';
  if (base.length < 3) base = '.' + (words.join('').slice(0, 5) || 'tpl');
  let t = base;
  let n = 2;
  while (taken.has(t) || macros.hasTrigger(t)) t = base + n++;
  taken.add(t);
  return t;
}

const CAT_RULES = [[/obstet|pregnan|\banc\b|foet|fetal|fetus|tiffa|\bnt\b|growth|liquor/, 'Obstetric'], [/thyroid|tirads|neck/, 'Thyroid'], [/breast|birads/, 'Breast'], [/scrot|testi|varicocele|hydrocele/, 'Scrotal'],
  [/carotid|doppler|venous|arterial|dvt|vascular/, 'Vascular'], [/kub|kidney|renal|prostat|bladder/, 'KUB'], [/pelvi|uter|ovar|tvs|follic|endometri/, 'Pelvis'], [/abdom|liver|gall|pancrea|spleen/, 'Abdomen'],
  [/knee|shoulder|msk|tendon|joint|muscle/, 'Musculoskeletal'], [/chest|x-?ray|lung/, 'Chest'], [/spine|lumbar|cervical/, 'Spine'], [/cbc|haemo|hemo|platelet/, 'Haematology'], [/lft|kft|sugar|lipid|thyroid profile/, 'Biochemistry'], [/impression/, 'Impression']];
export function guessCategory(text) { const t = String(text || '').toLowerCase(); const r = CAT_RULES.find(([re]) => re.test(t)); return r ? r[1] : 'General'; }
export function guessModality(text) {
  const t = String(text || '').toLowerCase();
  if (/doppler|carotid|venous|arterial/.test(t)) return 'Color Doppler';
  if (/obstet|pregnan|foet|fetal|tiffa|\banc\b/.test(t)) return 'Obstetric / Fetal Medicine';
  if (/thyroid|breast|tirads|birads|scrot|testi/.test(t)) return 'Small Parts (TI-RADS / BI-RADS)';
  if (/x-?ray|radiograph/.test(t)) return 'Digital X-Ray';
  if (/\bct\b|computed tomography/.test(t)) return 'CT Scan';
  if (/\bmri\b|magnetic/.test(t)) return 'MRI';
  if (/cbc|haemo|hemo|urine|stool/.test(t)) return 'Pathology';
  if (/lft|kft|lipid|glucose|sugar/.test(t)) return 'Biochemistry';
  return 'Ultrasound (USG)';
}

const pick = (o, keys) => { for (const k of Object.keys(o)) if (keys.includes(k.trim().toLowerCase())) return o[k]; return undefined; };
function normalizeRow(o) {
  const content = pick(o, ['content', 'html', 'text', 'body', 'macro', 'template', 'expansion']) || '';
  const title = pick(o, ['title', 'name', 'description', 'heading']) || '';
  return {
    id: pick(o, ['id', 'uuid']) || undefined, trigger: pick(o, ['trigger', 'shortcut', 'code', 'key', 'abbreviation']) || '', title: title || stripHtml(content).slice(0, 60),
    modality: MODALITIES.includes(pick(o, ['modality'])) ? pick(o, ['modality']) : guessModality(title + ' ' + content.slice(0, 400)),
    category: pick(o, ['category', 'organ', 'section']) || guessCategory(title + ' ' + content.slice(0, 400)), tags: pick(o, ['tags', 'keywords']) || '', kind: pick(o, ['kind', 'type']) || '', content
  };
}

/** JSON / CSV / TSV / TXT macro database → normalised records. */
export async function parseDataFile(file) {
  const ext = fileExt(file.name);
  const text = await readAsText(file);
  if (ext === 'json') {
    const j = JSON.parse(text);
    const arr = Array.isArray(j) ? j : j.macros || j.records || j.templates || j.items || [];
    return arr.filter((x) => x && (x.content || x.html || x.text || x.body)).map(normalizeRow);
  }
  if (ext === 'csv' || ext === 'tsv') return csvToObjects(text, ext === 'tsv' ? '\t' : undefined).map(normalizeRow).filter((r) => r.content);
  // TXT: blocks separated by blank lines; first line "trigger | title" (or just a title), the rest is the content
  return text.replace(/\r/g, '').split(/\n\s*\n(?=\S)/).map((block) => {
    const lines = block.split('\n');
    const head = lines.shift() || '';
    const m = head.match(/^\s*([.;/]?[\w-]+)\s*\|\s*(.+)$/);
    const body = lines.join('\n').trim() || head;
    return normalizeRow({ trigger: m ? m[1] : '', title: m ? m[2] : head.slice(0, 80), content: '<p>' + escapeHtml(body).replace(/\n/g, '<br>') + '</p>' });
  }).filter((r) => stripHtml(r.content).trim());
}

/** Word / PDF / HTML / RTF / Markdown documents → one template each (auto trigger, category, modality). */
export async function documentsToTemplates(files, onProgress) {
  const taken = new Set();
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const r = await fileToHtml(f);
    const title = (r.title || f.name).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    const hint = title + ' ' + stripHtml(r.html).slice(0, 600);
    out.push({ title, trigger: autoTrigger(title, taken), kind: 'template', category: guessCategory(hint), modality: guessModality(hint), tags: ['imported', fileExt(f.name)], content: r.html });
    if (onProgress) onProgress(i + 1, files.length, f.name);
  }
  return out;
}

// ---------------------------------------------------------------- exports
const stamp = () => dateKey();
function catalogHtml(list) {
  const groups = {};
  list.forEach((m) => { (groups[m.category || 'General'] = groups[m.category || 'General'] || []).push(m); });
  return Object.keys(groups).sort().map((cat) => `<h2>${escapeHtml(cat)}</h2>` + groups[cat].sort((a, b) => String(a.title).localeCompare(String(b.title))).map((m) =>
    `<h3>${m.trigger ? '<code>' + escapeHtml(m.trigger) + '</code> · ' : ''}${escapeHtml(m.title)}</h3><p style="font-size:9pt;color:#475569">${escapeHtml([m.modality, (m.tags || []).join(', ')].filter(Boolean).join(' · '))}</p>${m.content || ''}<hr>`).join('')).join('');
}

export async function exportMacros(fmt, ids, onProgress) {
  const list = await macros.exportAll(ids && ids.length ? ids : null);
  const n = list.length;
  const base = 'SSDC_Macro_Library_' + stamp();
  if (onProgress) onProgress(0, n);
  switch (fmt) {
    case 'json': download(base + '.json', JSON.stringify({ app: 'ssdc-suite', kind: 'macro-library', exportedAt: new Date().toISOString(), count: n, macros: list }), 'application/json'); break;
    case 'csv': download(base + '.csv', toCSV(list, [{ label: 'id', key: 'id' }, { label: 'trigger', key: 'trigger' }, { label: 'title', key: 'title' }, { label: 'modality', key: 'modality' }, { label: 'category', key: 'category' }, { label: 'tags', get: (m) => (m.tags || []).join('; ') }, { label: 'kind', key: 'kind' }, { label: 'content', key: 'content' }, { label: 'updatedAt', get: (m) => new Date(m.updatedAt || 0).toISOString() }]), 'text/csv;charset=utf-8'); break;
    case 'txt': download(base + '.txt', list.map((m) => (m.trigger || '-') + ' | ' + m.title + '\n' + stripHtml(m.content)).join('\n\n'), 'text/plain;charset=utf-8'); break;
    case 'html': download(base + '.html', standaloneHtml('<h1>Macro & template reference — ' + escapeHtml(getSettings().clinic.name) + '</h1><p>' + n + ' entries · exported ' + fmtDate(Date.now()) + '</p>' + catalogHtml(list), { title: 'Macro library', css: 'code{background:#f1f5f9;padding:1px 4px;border-radius:3px}h2{border-bottom:2px solid #0c4a6e;color:#0c4a6e;margin-top:24px}' }), 'text/html;charset=utf-8'); break;
    case 'doc': exportDoc(base + '.doc', '<h1>Macro & template reference</h1><p>' + n + ' entries · ' + fmtDate(Date.now()) + '</p>' + catalogHtml(list), { title: 'Macro library' }); break;
    case 'docx': {
      if (n > 3000) throw new Error('Word (.docx) catalog is limited to 3,000 entries — filter the list or use .doc / HTML');
      downloadBlob(base + '.docx', await htmlToDocxBlob('<h1>Macro & template reference</h1><p>' + n + ' entries</p>' + catalogHtml(list), { title: 'Macro library', fontSize: 10 }));
      break;
    }
    case 'pdf': case 'print': {
      if (n > 1500) throw new Error('The printable reference book is limited to 1,500 entries — filter the list first');
      const settings = getSettings();
      const pseudo = { id: 'macro-book', status: 'SIGNED_FINAL', html: catalogHtml(list), images: [], demographics: { name: 'Macro & template reference book', patientId: n + ' entries', date: dateKey() }, layout: { showDemographics: false, showSignature: false, watermarkDrafts: false, fontSize: 10 } };
      const r = renderReportPages(pseudo, settings, {});
      if (fmt === 'pdf') await htmlToPdf(r.html, { widthMm: r.widthMm, heightMm: r.heightMm, filename: base + '.pdf' });
      else await printHtml({ html: r.html, widthMm: r.widthMm, heightMm: r.heightMm, title: 'Macro reference book' });
      break;
    }
    default: throw new Error('Unknown export format');
  }
  if (onProgress) onProgress(n, n);
  return n;
}
