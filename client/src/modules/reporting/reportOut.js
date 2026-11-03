// Report output: print (exact A4 pages), PDF blob / download, DOCX · DOC · HTML · TXT · MD · JSON exports,
// rich copy for Word / Google Docs, secure download links (LAN server) and message variables for
// WhatsApp / SMS / e-mail dispatch. Used by the workstation, the archive and the Dispatch Center.
import { printHtml } from '../../core/print';
import { htmlToPdf } from '../../core/pdf';
import { exportDoc, exportHtml, exportTxt, exportMarkdown, copyRich, openInGoogleDocs } from '../../core/exporters';
import { htmlToDocxBlob } from '../../core/docx';
import { api, isServer } from '../../core/sync';
import { store } from '../../core/store';
import { download, downloadBlob, fmtDate, slug, genderLabel } from '../../core/utils';
import { clinicVars } from '../../core/share';
import { renderReportPages, reportDocumentHtml, reportLayout } from './reportPrint';
import { imageUrls } from './reportDoc';

export function signerFor(report) {
  const id = (report && report.signedBy) || 'u_ghanshyam';
  return store.get('users', id) || store.list('users').find((u) => u.role === 'SUPER_ADMIN_RADIOLOGIST') || null;
}
export const reportFileName = (report, ext) => `${slug((report.demographics && report.demographics.name) || 'Report')}_${(report.demographics && report.demographics.date) || ''}_${slug((report.demographics && report.demographics.modality) || 'USG').slice(0, 30)}.${ext}`.replace(/_+/g, '_');

export async function renderPages(report, settings, opts = {}) {
  const urls = opts.includeImages === false ? {} : await imageUrls(report.images);
  return renderReportPages(report, settings, Object.assign({ signer: signerFor(report), imageUrls: urls }, opts));
}

export async function printReport(report, settings, opts = {}) {
  const r = await renderPages(report, settings, opts);
  await printHtml({ html: r.html, widthMm: r.widthMm, heightMm: r.heightMm, title: reportFileName(report, 'pdf').replace(/\.pdf$/, ''), audit: { action: 'report:printed', target: 'reports/' + report.id, meta: { pages: r.pageCount, status: report.status } } });
  return r.pageCount;
}

export async function reportPdfBlob(report, settings, opts = {}) {
  const r = await renderPages(report, settings, opts);
  return htmlToPdf(r.html, { widthMm: r.widthMm, heightMm: r.heightMm, filename: reportFileName(report, 'pdf'), download: !!opts.download });
}

export async function exportReport(report, settings, fmt) {
  const signer = signerFor(report);
  const doc = reportDocumentHtml(report, settings, { signer, includeHeader: fmt !== 'docx' });
  const L = reportLayout(report, settings);
  const name = reportFileName(report, fmt);
  const title = (report.demographics.modality || 'Report') + ' – ' + (report.demographics.name || '');
  switch (fmt) {
    case 'docx': {
      const blob = await reportDocxBlob(report, settings);
      downloadBlob(name, blob);
      return blob;
    }
    case 'doc': return exportDoc(name, doc.body, { title, margins: L.margins, landscape: L.orientation === 'landscape' });
    case 'pdf': return reportPdfBlob(report, settings, { download: true });
    case 'html': return exportHtml(name, doc.body, { title });
    case 'txt': return exportTxt(name, doc.body);
    case 'md': return exportMarkdown(name, doc.body);
    case 'json': return download(name, JSON.stringify(report, null, 2), 'application/json');
    default: throw new Error('Unknown format ' + fmt);
  }
}

/** Genuine MS Word (.docx) with letterhead header & footer — for downloads and Word attachments. */
export function reportDocxBlob(report, settings) {
  const signer = signerFor(report);
  const L = reportLayout(report, settings);
  const full = reportDocumentHtml(report, settings, { signer, includeHeader: false });
  const title = (report.demographics.modality || 'Report') + ' – ' + (report.demographics.name || '');
  const imgHead = L.headerMode === 'image' && L.headerImage ? `<p style="text-align:center;margin:0"><img src="${L.headerImage}" style="width:100%"></p>` : '';
  const imgFoot = L.headerMode === 'image' && L.footerImage ? `<p style="text-align:center;margin:0"><img src="${L.footerImage}" style="width:100%"></p>` : '';
  return htmlToDocxBlob(full.body, { title, headerHtml: L.showHeader !== false ? (L.headerMode === 'full' ? full.headerHtml : imgHead) : '', footerHtml: L.showFooter !== false ? (imgFoot || full.footerHtml) : '', margins: L.margins, orientation: L.orientation, fontFamily: L.fontFamily, fontSize: L.fontSize, lineHeight: Math.max(1, L.lineHeight - 0.2) });
}

export const copyReportRich = (report, settings) => copyRich(reportDocumentHtml(report, settings, { signer: signerFor(report), includeHeader: true }).body);
export const reportToGoogleDocs = (report, settings) => openInGoogleDocs(reportDocumentHtml(report, settings, { signer: signerFor(report), includeHeader: true }).body);

/** LAN server: upload the PDF and create an expiring secure download link. */
export async function shareReportPdf(report, settings, { ttlHours = 24 * 7 } = {}) {
  if (!isServer()) throw new Error('Secure links need the clinic LAN server');
  const blob = await reportPdfBlob(report, settings);
  const fd = new FormData();
  fd.append('files', new File([blob], reportFileName(report, 'pdf'), { type: 'application/pdf' }));
  fd.append('meta', JSON.stringify({ kind: 'report-pdf', reportId: report.id, category: 'USG', patientId: report.patientId }));
  const up = await api('files', { method: 'POST', form: fd });
  const fileId = up.files[0].id;
  const link = await api('share', { method: 'POST', body: { kind: 'file', ref: fileId, ttlHours } });
  return { fileId, url: link.url, expiresAt: link.expiresAt, blob };
}

export function reportVars(report, settings, link) {
  const d = report.demographics || {};
  const inv = report.invoiceId ? store.get('invoices', report.invoiceId) : null;
  return Object.assign(clinicVars(settings), {
    Patient_Name: d.name || '', Age_Gender: [d.age, genderLabel(d.sex)].filter(Boolean).join(' / '), Report_Category: d.modality && /x-?ray/i.test(d.modality) ? 'X-Ray' : 'Ultrasound (USG)',
    Test_Name: d.modality || '', Doctor_Name: report.signedByName || settings.clinic.radiologist.name, Date: d.date ? fmtDate(d.date) : '',
    Invoice_No: inv ? inv.invoiceNo : '', Total_Amount: inv ? String(inv.net) : '', Payment_Status: inv ? inv.status : '', Secure_Download_Link: link || ''
  });
}
