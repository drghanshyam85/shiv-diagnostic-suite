// WhatsApp / SMS / Email deep links, message templates with {{placeholders}}, and patient web links.
import { net } from './sync';
import { store } from './store';
import { fmtDate, inr, digits, fullName, ageSex } from './utils';

export function fillTemplate(body, vars) {
  return String(body || '').replace(/\{\{\s*([A-Za-z_]+)\s*\}\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''));
}

export const PLACEHOLDERS = [
  'Patient_Name', 'Age_Gender', 'Report_Category', 'Test_Name', 'Doctor_Name', 'Invoice_No', 'Total_Amount', 'Paid_Amount',
  'Balance_Due', 'Payment_Status', 'Secure_Download_Link', 'Invoice_Link', 'Date', 'Center_Name', 'Center_Short',
  'Center_Address', 'Center_Phone', 'Center_Email', 'Review_Link', 'Period', 'Total_Patients', 'Total_Bill', 'Total_Discount',
  'Share_Payable', 'Audit_Status', 'Sample_ID', 'Collected_At', 'Report_ETA'
];

export const STATUS_LABEL = { PAID: 'Paid in full', PARTIAL: 'Partially paid', DUE: 'Payment due', CASHLESS: 'Cashless' };

export function clinicVars(settings) {
  const c = settings.clinic;
  return {
    Center_Name: c.name, Center_Short: c.shortName || 'SSDC', Center_Address: c.address,
    Center_Phone: [c.phone, c.phone2].filter(Boolean).join(', '), Center_Email: c.email,
    Review_Link: settings.engagement.googleReviewUrl || ''
  };
}

export function invoiceVars(inv, settings, link) {
  return Object.assign(clinicVars(settings), {
    Patient_Name: fullName(inv.patient), Age_Gender: ageSex(inv.patient), Invoice_No: inv.invoiceNo, Date: fmtDate(inv.date),
    Test_Name: (inv.items || []).map((x) => x.name).join(', '), Total_Amount: inr(inv.net, { symbol: false }),
    Paid_Amount: inr(inv.paid, { symbol: false }), Balance_Due: inr(inv.balance, { symbol: false }),
    Payment_Status: STATUS_LABEL[inv.status] || inv.status, Invoice_Link: link || '', Secure_Download_Link: link || '',
    Doctor_Name: settings.clinic.radiologist.name, Report_Category: 'Invoice'
  });
}

export const waNumber = (m) => { const d = digits(m); return d.length === 10 ? '91' + d : d; };
export const waLink = (mobile, text) => 'https://wa.me/' + waNumber(mobile) + '?text=' + encodeURIComponent(text || '');
export const smsLink = (mobile, text) => 'sms:+' + waNumber(mobile) + '?body=' + encodeURIComponent(text || '');
export const mailtoLink = (to, subject, body) => 'mailto:' + encodeURIComponent(to || '') + '?subject=' + encodeURIComponent(subject || '') + '&body=' + encodeURIComponent(body || '');
export const gmailLink = (to, subject, body) => 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(to || '') + '&su=' + encodeURIComponent(subject || '') + '&body=' + encodeURIComponent(body || '');

export function openExternal(url) {
  if (/^(sms|mailto|tel|upi):/i.test(url)) {
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  }
  const w = window.open(url, '_blank', 'noopener');
  return !!w;
}

export function pickTemplate(channel, kind, lang) {
  const all = store.list('msgTemplates');
  return all.find((t) => t.channel === channel && t.kind === kind && t.lang === lang) || all.find((t) => t.channel === channel && t.kind === kind) || null;
}

// ---------------------------------------------------------------- payloads for patient web links
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };

export async function encodePayload(obj) {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      const buf = new Uint8Array(await new Response(cs).arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return 'z' + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (e) { /* fall back */ }
  }
  return 'j' + b64url(json);
}

export async function decodePayload(str) {
  const kind = str[0];
  const bytes = fromB64url(str.slice(1));
  if (kind === 'z') {
    const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return JSON.parse(await new Response(ds).text());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function appBaseUrl(settings) {
  const pub = settings && settings.billing && settings.billing.publicBaseUrl;
  if (pub) return String(pub).replace(/#.*$/, '').replace(/\/?$/, '/');
  return location.href.replace(/#.*$/, '').replace(/[^/]*$/, (m) => (/\.html?$/.test(m) ? m : ''));
}

/** Compact, self-contained receipt for the patient web view (works on any static host). */
export function invoicePayload(inv, settings, testsMap) {
  const c = settings.clinic;
  const guidelines = [];
  (inv.items || []).forEach((it) => {
    const t = testsMap && testsMap[it.testId];
    if (t && t.description && !guidelines.some((g) => g[1] === t.description)) guidelines.push([it.name, t.description]);
  });
  const mob = digits(inv.patient.mobile);
  return {
    v: 1,
    c: { n: c.name, a: c.address, p: [c.phone, c.phone2].filter(Boolean).join(', '), e: c.email, r: c.radiologist.name + ', ' + c.radiologist.qualification, pc: c.pcpndtRegNo },
    u: { id: settings.billing.upiId, n: settings.billing.upiPayeeName },
    g: settings.engagement.googleReviewUrl, f: settings.engagement.feedbackUrl,
    i: {
      no: inv.invoiceNo, d: inv.date, s: inv.status, m: inv.paymentMode,
      pt: [fullName(inv.patient), ageSex(inv.patient), mob ? mob.slice(0, 2) + 'XXXXXX' + mob.slice(-2) : '', inv.patient.regId || ''],
      rf: inv.referredByName || '',
      it: (inv.items || []).map((x) => [x.name, x.amount, x.department]),
      gr: inv.gross, di: inv.discountAmount, ne: inv.net, pa: inv.paid, ba: inv.balance, tx: inv.taxAmount || 0, tl: (inv.taxLabel || 'GST') + ' @ ' + (inv.taxRate || 0) + '%'
    },
    gl: guidelines, cg: settings.engagement.customGuidelines || ''
  };
}

export async function patientInvoiceLink(inv, settings, testsMap) {
  const base = appBaseUrl(settings);
  if (net.mode === 'server' && !settings.billing.publicBaseUrl && inv.shareId) return base + '#/p/' + inv.shareId;
  return base + '#/v/' + (await encodePayload(invoicePayload(inv, settings, testsMap)));
}
