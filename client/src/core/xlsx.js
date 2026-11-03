// Minimal Excel (.xlsx) reader for batch imports: first worksheet → array of row objects keyed by the
// header row. Handles shared strings, inline strings, numbers and booleans; formulas use their cached
// value. Built on JSZip (already bundled for Word export).
import JSZip from 'jszip';

const colIndex = (ref) => {
  const letters = /^[A-Z]+/.exec(ref)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export async function readXlsx(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
  const shared = [];
  const ss = zip.file('xl/sharedStrings.xml');
  if (ss) {
    parse(await ss.async('string')).querySelectorAll('si').forEach((si) => {
      shared.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent).join(''));
    });
  }
  // first sheet in workbook order
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = zip.file('xl/workbook.xml');
  const rels = zip.file('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = parse(await wb.async('string')).getElementsByTagName('sheet')[0];
    const rid = first && (first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
    const rel = rid && Array.from(parse(await rels.async('string')).getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === rid);
    if (rel) sheetPath = 'xl/' + rel.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const sheet = zip.file(sheetPath);
  if (!sheet) throw new Error('No worksheet found in this Excel file');
  const rows = [];
  const rowEls = parse(await sheet.async('string')).getElementsByTagName('row');
  for (const row of Array.from(rowEls)) {
    const out = [];
    for (const c of Array.from(row.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r') || '';
      const i = ref ? colIndex(ref) : out.length;
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0];
      let val = '';
      if (t === 's') val = shared[Number(v && v.textContent)] || '';
      else if (t === 'inlineStr') val = Array.from(c.getElementsByTagName('t')).map((x) => x.textContent).join('');
      else if (t === 'b') val = v && v.textContent === '1' ? 'TRUE' : 'FALSE';
      else val = v ? v.textContent : '';
      out[i] = val;
    }
    rows.push(out);
  }
  const head = (rows.shift() || []).map((h) => String(h || '').trim());
  return rows.filter((r) => r.some((x) => String(x || '').trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? '' : String(r[i])])));
}
