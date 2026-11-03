// Cash-book reconciliation: what the system says was received (cash / UPI / card) against the
// physical cash count and the bank / UPI-app statement, automatic exception detection (mode
// mismatches, over-collection, refunds, digital receipts without a UTR, stale cash counts,
// high discounts) and the one-click daily audit pack (ZIP with PDF day book, CSVs, the audit
// trail and a SHA-256 manifest).
import JSZip from 'jszip';
import { dateKey, round2, fullName, fmtDate, fmtTime, inr, toCSV, sumBy } from '../../core/utils';
import { MODE_LABEL } from '../../core/finance';
import { api, isServer } from '../../core/sync';
import { sha256Hex } from '../../core/sha256';
import { htmlToPdf } from '../../core/pdf';
import { cashbookPages, csvRows } from './cashPrint';

const TOL = 0.5;
const isDigital = (m) => m === 'upi' || m === 'qr' || m === 'card';
/** a UTR (12 digits), card approval code or last-4 digits somewhere in the payment reference */
export const hasRef = (p) => !!(p.ref || /\d{4,}/.test(String(p.note || '')));

/** Every payment received on `date` by `staffId` ('ALL' = everyone), oldest first. */
export function paymentsOn({ date, staffId, invoices }) {
  const out = [];
  invoices.forEach((inv) => (inv.payments || []).forEach((p) => {
    if (dateKey(p.at) !== date || (staffId !== 'ALL' && p.staffId !== staffId)) return;
    out.push({ inv, p });
  }));
  return out.sort((a, b) => (a.p.at || 0) - (b.p.at || 0));
}

export function systemTotals(pays) {
  const t = { cash: 0, upi: 0, card: 0, refunds: 0 };
  pays.forEach(({ p }) => {
    const a = Number(p.amount) || 0;
    if (a < 0) t.refunds += -a;
    if (p.mode === 'cash') t.cash += a;
    else if (p.mode === 'card') t.card += a;
    else if (p.mode === 'upi' || p.mode === 'qr') t.upi += a;
  });
  return { cash: round2(t.cash), upi: round2(t.upi), card: round2(t.card), refunds: round2(t.refunds) };
}

const statusOf = (diff) => (diff === null ? 'Not entered' : Math.abs(diff) < TOL ? 'Matched' : diff < 0 ? 'Short' : 'Excess');

/**
 * Lines of the reconciliation table. denomDoc: the saved count for this date + staff view
 * ({ total, expected, status, savedAt, digital: { upi, card } }).
 */
export function reconcileLines({ kpi, sys, denomDoc }) {
  const dig = (denomDoc && denomDoc.digital) || {};
  const counted = denomDoc && denomDoc.status ? Number(denomDoc.total) : null;
  const cashDiff = counted === null ? null : round2(counted - kpi.drawer);
  const upiIn = dig.upi === undefined || dig.upi === '' || dig.upi === null ? null : Number(dig.upi);
  const cardIn = dig.card === undefined || dig.card === '' || dig.card === null ? null : Number(dig.card);
  return [
    { key: 'cash', label: 'Cash in drawer', sub: 'float + cash received − cash expenses', system: kpi.drawer, actual: counted, diff: cashDiff, status: statusOf(cashDiff), actualLabel: 'Physical count' },
    { key: 'upi', label: 'UPI / QR receipts', sub: 'as per bank / UPI business app', system: sys.upi, actual: upiIn, diff: upiIn === null ? null : round2(upiIn - sys.upi), status: statusOf(upiIn === null ? null : upiIn - sys.upi), actualLabel: 'Statement total' },
    { key: 'card', label: 'Card receipts', sub: 'as per card machine settlement', system: sys.card, actual: cardIn, diff: cardIn === null ? null : round2(cardIn - sys.card), status: statusOf(cardIn === null ? null : cardIn - sys.card), actualLabel: 'Settlement total' }
  ];
}

/**
 * Automatic exceptions for the day. severity: 'error' | 'warning' | 'info'.
 * Each: { key, severity, text, invId?, invoiceNo? }
 */
export function findExceptions({ day, pays, denomDoc, kpi }) {
  const ex = [];
  const date = day.date;
  day.invoices.forEach((inv) => {
    if (inv.billingType === 'umid') return;
    const todays = (inv.payments || []).filter((p) => dateKey(p.at) === date && Number(p.amount) > 0);
    const declared = inv.paymentMode === 'qr' ? 'upi' : inv.paymentMode;
    if (['cash', 'upi', 'card'].includes(declared) && todays.length) {
      const other = Array.from(new Set(todays.map((p) => (p.mode === 'qr' ? 'upi' : p.mode)))).filter((m) => m !== declared);
      if (other.length) ex.push({ key: 'mode-' + inv.id, severity: 'warning', invId: inv.id, invoiceNo: inv.invoiceNo, text: `${inv.invoiceNo} · ${fullName(inv.patient)}: bill marked ${MODE_LABEL[declared]} but ${other.map((m) => MODE_LABEL[m] || m).join(' + ')} recorded` });
    }
    const paid = round2(sumBy(inv.payments || [], 'amount'));
    if (paid > Number(inv.net || 0) + TOL) ex.push({ key: 'over-' + inv.id, severity: 'error', invId: inv.id, invoiceNo: inv.invoiceNo, text: `${inv.invoiceNo} · ${fullName(inv.patient)}: ${inr(round2(paid - inv.net))} collected above the bill amount` });
    const gross = Number(inv.gross) || 0;
    if (gross > 0 && Number(inv.discountAmount) / gross >= 0.25) ex.push({ key: 'disc-' + inv.id, severity: 'info', invId: inv.id, invoiceNo: inv.invoiceNo, text: `${inv.invoiceNo} · ${fullName(inv.patient)}: ${Math.round((inv.discountAmount / gross) * 100)}% discount (${inr(inv.discountAmount)})${inv.discountReason ? ' — ' + inv.discountReason : ''}` });
  });
  pays.forEach(({ inv, p }) => {
    if (Number(p.amount) < 0) ex.push({ key: 'ref-' + p.id, severity: 'warning', invId: inv.id, invoiceNo: inv.invoiceNo, text: `Refund ${inr(-p.amount)} (${MODE_LABEL[p.mode] || p.mode}) on ${inv.invoiceNo} · ${fullName(inv.patient)} at ${fmtTime(p.at)}` });
  });
  const noRef = pays.filter(({ p }) => isDigital(p.mode) && Number(p.amount) > 0 && !hasRef(p));
  if (noRef.length) ex.push({ key: 'noref', severity: 'info', text: `${noRef.length} digital receipt(s) worth ${inr(round2(sumBy(noRef, (x) => x.p.amount)))} have no UTR / approval code — match them in the bank app by amount and time`, payIds: noRef.map((x) => x.p.id) });
  if (denomDoc && denomDoc.status) {
    const moved = round2(kpi.drawer - Number(denomDoc.expected || 0));
    if (Math.abs(moved) >= TOL) ex.push({ key: 'stale', severity: 'warning', text: `Cash count at ${fmtTime(denomDoc.savedAt)} is out of date — the drawer changed by ${moved > 0 ? '+' : '−'}${inr(Math.abs(moved))} since; count again` });
  }
  const order = { error: 0, warning: 1, info: 2 };
  return ex.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Short status for the dashboard: null when everything is fine. */
export function drawerAlert({ kpi, sys, denomDoc }) {
  if (!denomDoc) return null;
  const lines = reconcileLines({ kpi, sys, denomDoc });
  const bad = lines.filter((l) => l.diff !== null && Math.abs(l.diff) >= TOL);
  const stale = denomDoc.status && Math.abs(kpi.drawer - Number(denomDoc.expected || 0)) >= TOL;
  if (!bad.length && !stale) return null;
  return {
    title: bad.length ? bad.map((l) => (l.key === 'cash' ? 'Cash' : l.key === 'upi' ? 'UPI' : 'Card') + ' ' + (l.diff < 0 ? 'short ' : 'excess ') + inr(Math.abs(l.diff))).join(' · ') : 'Recount needed',
    sub: stale ? 'drawer changed since the count at ' + fmtTime(denomDoc.savedAt) : 'counted ' + inr(denomDoc.total || 0) + ' vs expected ' + inr(kpi.drawer)
  };
}

// ---------------------------------------------------------------- audit pack
const FIN_ACTIONS = /^(cashbook|invoice|billing|umid|accounts|tariff|payment|finance):/;

/** Build the ZIP. Returns { blob, filename, files:[{name, bytes, sha256}] }. */
export async function buildAuditPack({ date, scope, view, day, rows, staffRows, names, settings, denomDoc, pays, preparedBy, user }) {
  const zip = new JSZip();
  const files = [];
  const add = async (name, content) => {
    zip.file(name, content);
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content).length : content.size || content.byteLength || 0;
    files.push({ name, bytes, sha256: await sha256Hex(content) });
  };
  const k = day.kpi;
  const sys = systemTotals(pays);
  const lines = reconcileLines({ kpi: k, sys, denomDoc });
  const exceptions = findExceptions({ day, pays, denomDoc, kpi: k });

  // 1. day book (A4 PDF; the printable HTML when the PDF engine is unavailable offline)
  const pages = cashbookPages({ day, rows, settlements: day.settlements, staffRows, scope, includeList: true, settings, names, preparedBy });
  try {
    const pdf = await htmlToPdf(pages.html, { filename: 'Day_book.pdf', download: false, widthMm: 210, heightMm: 297, scale: 1.6 });
    await add('01_Day_book_' + date + '.pdf', pdf);
  } catch (e) {
    await add('01_Day_book_' + date + '.html', '<!doctype html><meta charset="utf-8"><title>Day book ' + date + '</title>' + pages.html);
  }
  // 2. registers
  await add('02_Collection_register.csv', toCSV(csvRows({ rows, settlements: day.settlements, expenses: day.expenses, names })));
  await add('03_Payments_received.csv', toCSV(pays.map(({ inv, p }) => ({
    Time: fmtTime(p.at), 'Bill no.': inv.invoiceNo, 'Bill date': fmtDate(inv.date), Patient: fullName(inv.patient), Mode: MODE_LABEL[p.mode] || p.mode, Amount: p.amount,
    'Reference / UTR': p.ref || p.note || '', 'Received by': names[p.staffId] || '', 'Has reference': isDigital(p.mode) ? (hasRef(p) ? 'Yes' : 'No') : ''
  })), [{ key: 'Time' }, { key: 'Bill no.' }, { key: 'Bill date' }, { key: 'Patient' }, { key: 'Mode' }, { key: 'Amount' }, { key: 'Reference / UTR' }, { key: 'Received by' }, { key: 'Has reference' }]));
  await add('04_Expenses.csv', toCSV(day.expenses.map((x) => ({ Time: fmtTime(x.createdAt), Description: x.description, Category: x.category, Mode: x.mode === 'cash' ? 'Cash' : 'UPI / Bank', Amount: x.amount, 'Paid to': x.paidTo || '', 'Logged by': names[x.staffId] || '' })),
    [{ key: 'Time' }, { key: 'Description' }, { key: 'Category' }, { key: 'Mode' }, { key: 'Amount' }, { key: 'Paid to' }, { key: 'Logged by' }]));
  await add('05_Department_summary.csv', toCSV(day.depts.map((d) => ({ Department: d.dept, Count: d.count, Gross: round2(d.gross), Discount: round2(d.discount), Net: round2(d.net), Cash: round2(d.cash), 'UPI / card': round2(d.upi), Due: round2(d.due), 'UMID cashless': round2(d.cashless) })),
    [{ key: 'Department' }, { key: 'Count' }, { key: 'Gross' }, { key: 'Discount' }, { key: 'Net' }, { key: 'Cash' }, { key: 'UPI / card' }, { key: 'Due' }, { key: 'UMID cashless' }]));
  if (view === 'ALL') {
    await add('06_Staff_handover.csv', toCSV(staffRows.map((s) => ({ Staff: s.name, 'Opening float': s.opening, Bills: s.bills, Gross: s.gross, Discount: s.discount, Cash: s.cash, 'UPI / card': s.upi, Due: s.due, 'Cash expenses': s.cashExp, 'Cash to hand over': s.drawer })),
      [{ key: 'Staff' }, { key: 'Opening float' }, { key: 'Bills' }, { key: 'Gross' }, { key: 'Discount' }, { key: 'Cash' }, { key: 'UPI / card' }, { key: 'Due' }, { key: 'Cash expenses' }, { key: 'Cash to hand over' }]));
  }
  const recon = lines.map((l) => ({ Section: 'Reconciliation', Item: l.label, 'As per system': l.system, 'Counted / statement': l.actual === null ? '' : l.actual, Difference: l.diff === null ? '' : l.diff, Status: l.status }))
    .concat(exceptions.map((x) => ({ Section: 'Exception (' + x.severity + ')', Item: x.text, 'As per system': '', 'Counted / statement': '', Difference: '', Status: '' })));
  await add('07_Reconciliation_and_exceptions.csv', toCSV(recon, [{ key: 'Section' }, { key: 'Item' }, { key: 'As per system' }, { key: 'Counted / statement' }, { key: 'Difference' }, { key: 'Status' }]));
  // 3. audit trail of money actions that day (server)
  let auditNote = 'Audit trail: not included (standalone mode or no permission to view the audit log).';
  if (isServer()) {
    try {
      const from = new Date(date + 'T00:00:00').getTime();
      const r = await api('admin/audit-logs?from=' + from + '&to=' + (from + 86400000 - 1) + '&limit=20000');
      const fin = (r.rows || []).filter((a) => FIN_ACTIONS.test(a.action || ''));
      await add('08_Audit_trail_money_actions.csv', toCSV(fin.map((a) => ({ Time: new Date(a.timestamp).toLocaleString('en-IN'), Actor: a.actorName, Role: a.actorRole, Action: a.action, Target: a.targetResource, Details: JSON.stringify(a.metadata || {}) })),
        [{ key: 'Time' }, { key: 'Actor' }, { key: 'Role' }, { key: 'Action' }, { key: 'Target' }, { key: 'Details' }]));
      auditNote = 'Audit trail: ' + fin.length + ' money-related action(s) from the server audit log.';
    } catch (e) { /* no permission */ }
  }
  const summary = [
    settings.clinic.name + ' — daily financial audit pack', 'Date: ' + fmtDate(date) + '   Scope: ' + scope, 'Prepared by: ' + (user ? user.name : preparedBy || '') + '   Generated: ' + new Date().toLocaleString('en-IN'), '',
    'Bills ' + k.bills + ' · gross ' + inr(k.gross) + ' · discount ' + inr(k.discount) + ' · net ' + inr(k.net),
    'Received: cash ' + inr(sys.cash) + ' · UPI/QR ' + inr(sys.upi) + ' · card ' + inr(sys.card) + (sys.refunds ? ' · refunds ' + inr(sys.refunds) : ''),
    'Expenses: cash ' + inr(k.cashExp) + ' · UPI/bank ' + inr(k.upiExp) + '   Due today: ' + inr(k.due), '',
    'Reconciliation:', ...lines.map((l) => '  ' + l.label + ': system ' + inr(l.system) + ' · ' + (l.actual === null ? 'not entered' : 'actual ' + inr(l.actual) + ' · ' + l.status + (l.diff ? ' ' + inr(Math.abs(l.diff)) : ''))), '',
    exceptions.length ? 'Exceptions (' + exceptions.length + '):' : 'Exceptions: none', ...exceptions.map((x) => '  [' + x.severity + '] ' + x.text), '', auditNote, '',
    'manifest.json lists the SHA-256 checksum of every file; any later change to a file changes its checksum.'
  ].join('\r\n');
  await add('00_README.txt', summary);
  zip.file('manifest.json', JSON.stringify({ app: 'ssdc-suite', kind: 'daily-audit-pack', clinic: settings.clinic.name, date, scope, generatedAt: new Date().toISOString(), generatedBy: user ? user.name : '', files }, null, 2));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const filename = 'SSDC_Audit_' + date + '_' + String(scope).replace(/\W+/g, '_').replace(/^_|_$/g, '') + '.zip';
  return { blob, filename, files, exceptions, lines };
}

