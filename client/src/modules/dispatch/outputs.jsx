// Document outputs for dispatch: PDF blobs for USG reports, lab reports and invoices (or one combined
// PDF), message variables per document kind, file storage (LAN server upload or IndexedDB blob in
// standalone mode), secure expiring download links and a store-only ZIP writer for bulk export.
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { pagesToPdf } from '../../core/pdf';
import { api, isServer } from '../../core/sync';
import { store } from '../../core/store';
import { idbPut, idbGet, idbDelete } from '../../core/idb';
import { currentUser } from '../../core/auth';
import { getSettings } from '../../core/hooks';
import { fmtDate, fullName, ageSex, inr, uid, readAsDataURL, dataUrlToBlob, fileExt, slug } from '../../core/utils';
import { clinicVars, invoiceVars, STATUS_LABEL, patientInvoiceLink } from '../../core/share';
import { fileToHtml } from '../../core/importers';
import { htmlToPdf } from '../../core/pdf';
import { renderPages, reportVars, reportFileName, reportDocxBlob } from '../reporting/reportOut';
import { renderReportPages } from '../reporting/reportPrint';
import { renderLabPages, labFileName, labDocxBlob } from '../lab/labPrint';
import { InvoicePages } from '../billing/InvoiceDoc';

export const KIND_LABEL = { usg: 'USG report', lab: 'Lab report', invoice: 'Invoice', file: 'Document' };
export const CATEGORIES = ['USG', 'Pathology', 'Biochemistry', 'X-Ray', 'ECG', 'Invoice', 'Other'];

const MIME = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', rtf: 'application/rtf', html: 'text/html', htm: 'text/html', txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', odt: 'application/vnd.oasis.opendocument.text', zip: 'application/zip' };
export const guessMime = (name) => MIME[fileExt(name)] || 'application/octet-stream';

export function labCategory(rep) {
  const ds = new Set((rep.tests || []).map((t) => { const x = store.get('tests', t.testId); return x ? x.department : 'Pathology'; }));
  return ds.has('Pathology') && ds.has('Biochemistry') ? 'Pathology & Biochemistry' : ds.has('Biochemistry') ? 'Biochemistry' : 'Pathology';
}

/** Department bucket used by the download center filters and bulk ZIP folders. */
export function categoryOf(kind, doc) {
  if (kind === 'usg') return /x-?ray/i.test((doc.demographics && doc.demographics.modality) || '') ? 'X-Ray' : 'USG';
  if (kind === 'lab') return labCategory(doc) === 'Biochemistry' ? 'Biochemistry' : 'Pathology';
  if (kind === 'invoice') return 'Invoice';
  return doc.category || 'Other';
}

async function htmlPagesToHost(html) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-30000px;top:0;background:#fff';
  host.innerHTML = html;
  document.body.appendChild(host);
  await Promise.all(Array.from(host.querySelectorAll('img')).map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; setTimeout(r, 3000); }))));
  return host;
}

async function invoiceHost(inv, settings) {
  let webLink = '';
  try {
    const tm = {};
    store.list('tests').forEach((t) => { tm[t.id] = t; });
    webLink = await patientInvoiceLink(inv, settings, tm);
  } catch (e) { /* link QR is optional */ }
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-30000px;top:0;background:#fff';
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(<InvoicePages inv={inv} settings={settings} opts={Object.assign({}, settings.print, { format: 'a4' })} webLink={webLink} />));
  // QR codes render asynchronously: wait until the image count is stable and every image has decoded
  let prev = -1;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 60));
    const imgs = Array.from(host.querySelectorAll('img'));
    if (i >= 3 && imgs.length === prev && imgs.every((im) => im.complete)) break;
    prev = imgs.length;
  }
  return { host, done: () => { root.unmount(); host.remove(); } };
}

/** parts: ['report'] | ['invoice'] | ['report','invoice'] → one A4 PDF blob (pages concatenated). */
export async function documentPdf({ kind, doc, invoice, settings = getSettings(), parts = ['report'] }) {
  if (kind === 'file') return fileBlob(doc);
  const cleanup = [];
  const els = [];
  try {
    if (parts.includes('report') && kind !== 'invoice') {
      const r = kind === 'lab' ? renderLabPages(doc, settings) : await renderPages(doc, settings);
      const host = await htmlPagesToHost(r.html);
      cleanup.push(() => host.remove());
      els.push(...host.querySelectorAll('.print-page'));
    }
    const inv = kind === 'invoice' ? doc : invoice;
    if ((parts.includes('invoice') || kind === 'invoice') && inv) {
      const ih = await invoiceHost(inv, settings);
      cleanup.push(ih.done);
      els.push(...ih.host.querySelectorAll('.print-page'));
    }
    if (!els.length) throw new Error('Nothing to export');
    return await pagesToPdf(els, { widthMm: 210, heightMm: 297, download: false, quality: 0.85 });
  } finally { cleanup.forEach((f) => f()); }
}

export function documentFileName(kind, doc, parts = ['report']) {
  if (kind === 'file') return doc.name || 'document.pdf';
  const inv = invoiceFor(kind, doc);
  if (kind === 'invoice' || (parts.length === 1 && parts[0] === 'invoice')) return 'Invoice_' + slug((inv && inv.invoiceNo) || 'bill') + '.pdf';
  const base = kind === 'lab' ? labFileName(doc) : reportFileName(doc, 'pdf');
  return parts.includes('invoice') ? base.replace(/\.pdf$/, '_with_Invoice.pdf') : base;
}

/**
 * One attachable file. part: 'report' | 'invoice' | 'merged' (report + invoice in one PDF);
 * format: 'pdf' | 'docx' (report part) | 'original' (uploaded / imported file as stored).
 */
export async function makeFile({ kind, doc, part = 'report', format = 'pdf', settings = getSettings() }) {
  if (kind === 'file') {
    if (format === 'pdf' && !/\.pdf$/i.test(doc.name || '')) return convertFileToPdf(doc, settings);
    return { blob: await fileBlob(doc), filename: doc.name || 'document', part, format: 'original' };
  }
  const inv = invoiceFor(kind, doc);
  if (part === 'invoice' || kind === 'invoice') {
    const invDoc = kind === 'invoice' ? doc : inv;
    if (!invDoc) throw new Error('No invoice is linked to this visit');
    return { blob: await documentPdf({ kind: 'invoice', doc: invDoc, settings }), filename: documentFileName(kind, doc, ['invoice']), part: 'invoice', format: 'pdf' };
  }
  if (part === 'merged') return { blob: await documentPdf({ kind, doc, invoice: inv, settings, parts: ['report', 'invoice'] }), filename: documentFileName(kind, doc, ['report', 'invoice']), part, format: 'pdf' };
  if (format === 'docx') {
    const blob = kind === 'lab' ? await labDocxBlob(doc, settings) : await reportDocxBlob(doc, settings);
    return { blob, filename: documentFileName(kind, doc, ['report']).replace(/\.pdf$/, '.docx'), part, format };
  }
  return { blob: await documentPdf({ kind, doc, settings, parts: ['report'] }), filename: documentFileName(kind, doc, ['report']), part, format: 'pdf' };
}

let capCache = null;
async function serverCanConvert() {
  if (!isServer()) return false;
  if (capCache === null) { try { capCache = !!(await api('files/capabilities')).libreoffice; } catch (e) { capCache = false; } }
  return capCache;
}

/** Word / RTF / HTML / image → A4 PDF (LibreOffice on the LAN server when installed, else in the browser). */
export async function convertFileToPdf(f, settings = getSettings()) {
  const base = String(f.name || 'document').replace(/\.[^.]+$/, '');
  if (f.storage !== 'local' && (await serverCanConvert())) {
    const r = await api('files/' + encodeURIComponent(f.id) + '/convert', { method: 'POST', body: { to: 'pdf' }, timeout: 120000 });
    store.applyRemote('files', r.file);
    return { blob: await serverFileBlob(r.file.id), filename: base + '.pdf', part: 'report', format: 'pdf', fileId: r.file.id };
  }
  const blob = await fileBlob(f);
  let html;
  if (/^image\//.test(f.mime || blob.type)) html = `<p style="text-align:center"><img src="${await readAsDataURL(blob)}" style="max-width:100%;max-height:250mm"></p>`;
  else html = (await fileToHtml(new File([blob], f.name || 'document', { type: blob.type }))).html;
  const pseudo = { id: f.id, status: 'SIGNED_FINAL', html, images: [], demographics: {}, layout: { showHeader: false, showFooter: false, showDemographics: false, showSignature: false, footerText: '', margins: { top: 12, right: 14, bottom: 12, left: 14 } } };
  const r = renderReportPages(pseudo, settings, { endHtml: '', bare: true, includeImages: false });
  return { blob: await htmlToPdf(r.html, { widthMm: r.widthMm, heightMm: r.heightMm, download: false }), filename: base + '.pdf', part: 'report', format: 'pdf' };
}

export function invoiceFor(kind, doc) {
  if (!doc) return null;
  if (kind === 'invoice') return doc;
  const id = doc.invoiceId || (doc.visitId && (store.get('visits', doc.visitId) || {}).invoiceId);
  if (id && store.get('invoices', id)) return store.get('invoices', id);
  if (doc.visitId) return store.list('invoices').find((i) => i.visitId === doc.visitId) || null;
  return null;
}

export function patientFor(kind, doc) {
  if (!doc) return null;
  if (doc.patientId && store.get('patients', doc.patientId)) return store.get('patients', doc.patientId);
  if (kind === 'invoice' || kind === 'lab') return doc.patient ? Object.assign({}, doc.patient) : null;
  if (kind === 'file') return { name: doc.patientName || '', mobile: doc.mobile || '', email: doc.email || '' };
  return null;
}

export function docTitle(kind, doc) {
  if (!doc) return '';
  if (kind === 'usg') return [doc.demographics && doc.demographics.name, doc.demographics && doc.demographics.modality].filter(Boolean).join(' · ');
  if (kind === 'lab') return [doc.patient && fullName(doc.patient), (doc.tests || []).map((t) => t.name).join(', ')].filter(Boolean).join(' · ');
  if (kind === 'invoice') return doc.invoiceNo + ' · ' + fullName(doc.patient);
  return doc.name;
}

export function isSigned(kind, doc) {
  return kind === 'invoice' || kind === 'file' || (doc && doc.status === 'SIGNED_FINAL');
}

/** Placeholder values for message templates. */
export function varsFor(kind, doc, settings, links = {}) {
  if (kind === 'usg') return Object.assign(reportVars(doc, settings, links.report || ''), { Invoice_Link: links.invoice || '' }, (() => { const inv = invoiceFor(kind, doc); return inv ? { Invoice_No: inv.invoiceNo, Total_Amount: inr(inv.net, { symbol: false }), Payment_Status: STATUS_LABEL[inv.status] || inv.status } : {}; })());
  if (kind === 'invoice') return invoiceVars(doc, settings, links.invoice || links.report || '');
  const inv = invoiceFor(kind, doc);
  const p = patientFor(kind, doc) || {};
  const base = Object.assign(clinicVars(settings), {
    Patient_Name: fullName(p) || doc.patientName || '', Age_Gender: p.age !== undefined ? ageSex(p) : '', Date: fmtDate(doc.verifiedAt || doc.createdAt || Date.now()),
    Invoice_No: inv ? inv.invoiceNo : '', Total_Amount: inv ? inr(inv.net, { symbol: false }) : '', Paid_Amount: inv ? inr(inv.paid, { symbol: false }) : '',
    Balance_Due: inv ? inr(inv.balance, { symbol: false }) : '', Payment_Status: inv ? STATUS_LABEL[inv.status] || inv.status : '',
    Secure_Download_Link: links.report || '', Invoice_Link: links.invoice || ''
  });
  if (kind === 'lab') return Object.assign(base, { Report_Category: labCategory(doc), Test_Name: (doc.tests || []).map((t) => t.name).join(', '), Doctor_Name: settings.clinic.pathologist.name });
  // uploaded / e-mailed documents: never claim one of our doctors reported an external report
  const fromName = String(doc.emailFrom || '').replace(/<[^>]*>/, '').replace(/"/g, '').trim();
  const cleanName = String(doc.name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  return Object.assign(base, {
    Report_Category: doc.category && doc.category !== 'Other' ? doc.category : 'Medical', Test_Name: doc.testName || cleanName || 'investigation',
    Doctor_Name: doc.doctorName || (doc.source === 'email' && fromName) || settings.clinic.name
  });
}

// ---------------------------------------------------------------- file storage
export async function uploadBlob(blob, filename, meta = {}) {
  const fd = new FormData();
  fd.append('files', new File([blob], filename, { type: blob.type || guessMime(filename) }));
  fd.append('meta', JSON.stringify(meta));
  const r = await api('files', { method: 'POST', form: fd });
  const doc = r.files[0];
  store.applyRemote('files', doc);
  return doc;
}

/** Keep a document: LAN server upload (visible on every workstation) or an IndexedDB blob (standalone). */
export async function storeFile(blob, filename, meta = {}) {
  if (isServer()) return uploadBlob(blob, filename, meta);
  const id = uid('f_');
  await idbPut('blobs', { id, dataUrl: await readAsDataURL(blob), mime: blob.type || guessMime(filename), at: Date.now() });
  const u = currentUser();
  return store.put('files', Object.assign({
    id, name: filename, mime: blob.type || guessMime(filename), size: blob.size, storage: 'local', source: 'upload', category: 'Other',
    patientId: '', patientName: '', mobile: '', email: '', testName: '', tags: [], createdAt: Date.now(), createdBy: u ? u.id : null
  }, meta));
}

export async function serverFileBlob(fileId) {
  const r = await api('files/' + encodeURIComponent(fileId) + '/raw', { raw: true });
  if (!r.ok) throw new Error('Download failed (' + r.status + ')');
  return r.blob();
}

export async function fileBlob(f) {
  if (f.storage === 'local') {
    const b = await idbGet('blobs', f.id);
    if (!b) throw new Error('The file content is stored on another workstation');
    return dataUrlToBlob(b.dataUrl);
  }
  return serverFileBlob(f.id);
}

export async function deleteFile(f) {
  if (f.storage === 'local') { await idbDelete('blobs', f.id).catch(() => {}); store.remove('files', f.id); return; }
  await api('files/' + encodeURIComponent(f.id), { method: 'DELETE' });
  const cur = store.getRaw('files', f.id);
  if (cur) store.applyRemote('files', Object.assign({}, cur, { _deleted: true, updatedAt: Date.now() }), true);
}

export async function secureLink(fileId, ttlHours = 24 * 7) {
  if (!isServer()) throw new Error('Secure links need the clinic LAN server');
  return api('share', { method: 'POST', body: { kind: 'file', ref: fileId, ttlHours } });
}

// ---------------------------------------------------------------- ZIP (store method; PDFs are already compressed)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

/** entries: [{ name: 'USG/2026-10-28/Report.pdf', blob }] → Blob (application/zip). Names are de-duplicated. */
export async function makeZip(entries) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const seen = new Map();
  const { time, date } = dosTime(new Date());
  for (const e of entries) {
    let name = String(e.name).replace(/^\/+/, '').replace(/\\/g, '/');
    const n = seen.get(name) || 0;
    seen.set(name, n + 1);
    if (n) name = name.replace(/(\.[^./]+)?$/, (m) => ' (' + (n + 1) + ')' + m);
    const nameBytes = enc.encode(name);
    const data = new Uint8Array(await e.blob.arrayBuffer());
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, time, true); local.setUint16(12, date, true); local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nameBytes.length, true); local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
    cen.setUint16(12, time, true); cen.setUint16(14, date, true); cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameBytes.length, true); cen.setUint16(30, 0, true); cen.setUint16(32, 0, true); cen.setUint16(34, 0, true); cen.setUint16(36, 0, true);
    cen.setUint32(38, 0, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
