// A4 "Daily Collection Register, Department Summary & Cash Reconciliation Sheet" (grayscale-friendly),
// CSV export rows and the WhatsApp summary text for the owner.
import { escapeHtml as e, fmtDate, fmtDateTime, fmtTime, inr, fullName } from '../../core/utils';
import { renderReportPages } from '../reporting/reportPrint';

const m = (n) => inr(n, { decimals: Number.isInteger(Number(n) || 0) ? 0 : 2 });

export function itemsText(inv) { return (inv.items || []).map((x) => x.name).join(', '); }

/** rows: register rows from CashBook (bill-level), staffRows: per staff summary, day: cashbookDay(), names: staffId → name */
export function cashbookPages({ day, rows, settlements, staffRows, scope, includeList, settings, names, preparedBy }) {
  const k = day.kpi;
  const grid = `<table class="cb-grid"><tr>
    <td><span>Total gross billed</span><b>${m(k.gross)}</b></td><td><span>Total discount</span><b>${m(k.discount)}</b></td><td><span>Net billed</span><b>${m(k.net)}</b></td>
    <td><span>Cash collected</span><b>${m(k.cash)}</b></td></tr><tr>
    <td><span>UPI / online collected</span><b>${m(k.upi)}</b></td><td><span>Pending due</span><b>${m(k.due)}</b></td><td><span>Cashless</span><b>${m(k.cashless)}</b></td>
    <td><span>Total expenses</span><b>${m(k.expenses)}</b><small>Cash ${m(k.cashExp)} · UPI ${m(k.upiExp)}</small></td></tr></table>`;
  const formula = `<table class="cb-formula"><tr><td>Opening float<br><b>${m(k.opening)}</b></td><td class="op">+</td><td>Cash received<br><b>${m(k.cash)}</b></td><td class="op">−</td><td>Cash expenses<br><b>${m(k.cashExp)}</b></td><td class="op">=</td><td class="res">Net physical cash in drawer<br><b>${m(k.drawer)}</b></td></tr></table>`;
  const deptRows = day.depts.map((d) => `<tr><td>${e(d.dept)}</td><td class="n">${d.count}</td><td class="n">${m(d.gross)}</td><td class="n">${m(d.discount)}</td><td class="n">${m(d.net)}</td><td class="n">${m(d.cash)}</td><td class="n">${m(d.upi)}</td><td class="n">${m(d.due)}</td></tr>`).join('');
  const dt = day.depts.reduce((a, d) => ({ count: a.count + d.count, gross: a.gross + d.gross, discount: a.discount + d.discount, net: a.net + d.net, cash: a.cash + d.cash, upi: a.upi + d.upi, due: a.due + d.due }), { count: 0, gross: 0, discount: 0, net: 0, cash: 0, upi: 0, due: 0 });
  const deptTable = `<table class="cb-tbl"><tr><th>Department</th><th class="n">Investigations</th><th class="n">Gross</th><th class="n">Discount</th><th class="n">Net revenue</th><th class="n">Cash</th><th class="n">UPI</th><th class="n">Due</th></tr>${deptRows || '<tr><td colspan="8">No bills.</td></tr>'}
    <tr class="tot"><td>Total</td><td class="n">${dt.count}</td><td class="n">${m(dt.gross)}</td><td class="n">${m(dt.discount)}</td><td class="n">${m(dt.net)}</td><td class="n">${m(dt.cash)}</td><td class="n">${m(dt.upi)}</td><td class="n">${m(dt.due)}</td></tr></table>`;
  const staffTable = `<table class="cb-tbl cb-staff"><tr><th style="width:22%">Staff / billing desk</th><th class="n">Float</th><th class="n" style="width:6%">Bills</th><th class="n">Gross</th><th class="n">Disc.</th><th class="n">Cash</th><th class="n">UPI</th><th class="n">Due</th><th class="n">Cash exp.</th><th class="n" style="width:11%">Hand over</th></tr>
    ${staffRows.map((s) => `<tr${s.total ? ' class="tot"' : ''}><td>${e(s.name)}</td><td class="n">${m(s.opening)}</td><td class="n">${s.bills}</td><td class="n">${m(s.gross)}</td><td class="n">${m(s.discount)}</td><td class="n">${m(s.cash)}</td><td class="n">${m(s.upi)}</td><td class="n">${m(s.due)}</td><td class="n">${m(s.cashExp)}</td><td class="n"><b>${m(s.drawer)}</b></td></tr>`).join('')}</table>`;
  const expTable = `<table class="cb-tbl"><tr><th style="width:6%">S.No</th><th>Description</th><th>Category</th><th>Mode</th><th>Staff</th><th class="n">Amount</th></tr>
    ${day.expenses.map((x, i) => `<tr><td>${i + 1}</td><td>${e(x.description)}${x.paidTo ? ' <span class="mut">(' + e(x.paidTo) + ')</span>' : ''}</td><td>${e(x.category)}</td><td>${x.mode === 'cash' ? 'Cash' : 'UPI / Bank'}</td><td>${e(names[x.staffId] || '')}</td><td class="n">${m(x.amount)}</td></tr>`).join('') || '<tr><td colspan="6">No expenses recorded.</td></tr>'}
    <tr class="tot"><td colspan="5">Total (cash ${m(k.cashExp)} · UPI / bank ${m(k.upiExp)})</td><td class="n">${m(k.expenses)}</td></tr></table>`;
  const listTable = includeList ? `<h4 class="cb-h">6 · Daily collection list</h4><table class="cb-tbl cb-list"><tr><th>#</th><th>Time</th><th>Bill no.</th><th>Patient</th><th>Investigations</th><th class="n">Gross</th><th class="n">Disc.</th><th class="n">Net</th><th class="n">Cash</th><th class="n">UPI</th><th class="n">Due</th><th>Staff</th></tr>
    ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${e(fmtTime(r.inv.date))}</td><td>${e(r.inv.invoiceNo)}</td><td>${e(fullName(r.inv.patient))}</td><td>${e(itemsText(r.inv))}</td><td class="n">${m(r.inv.gross)}</td><td class="n">${m(r.inv.discountAmount)}</td><td class="n">${m(r.inv.net)}</td><td class="n">${m(r.cash)}</td><td class="n">${m(r.upi)}</td><td class="n">${r.inv.billingType === 'umid' ? 'UMID' : m(r.inv.balance)}</td><td>${e(names[r.inv.staffId] || '')}</td></tr>`).join('')}
    ${settlements.length ? `<tr><td colspan="12" class="mut">Old dues collected today</td></tr>` + settlements.map((s) => `<tr><td></td><td>${e(fmtTime(s.p.at))}</td><td>${e(s.inv.invoiceNo)}</td><td>${e(fullName(s.inv.patient))}</td><td>Balance of ${e(fmtDate(s.inv.date))}</td><td colspan="3"></td><td class="n">${s.p.mode === 'cash' ? m(s.p.amount) : ''}</td><td class="n">${s.p.mode !== 'cash' ? m(s.p.amount) : ''}</td><td></td><td>${e(names[s.p.staffId] || '')}</td></tr>`).join('') : ''}</table>` : '';
  const body = `<h4 class="cb-h">1 · Executive collection & payment-mode breakdown</h4>${grid}
    <h4 class="cb-h">2 · Cash drawer reconciliation</h4>${formula}
    <h4 class="cb-h">3 · Department-wise investigation & revenue summary</h4>${deptTable}
    <h4 class="cb-h">4 · Staff / billing desk handover summary</h4>${staffTable}
    <h4 class="cb-h">5 · Daily expenses</h4>${expTable}${listTable}`;
  const head = `<div class="cb-head"><div class="cb-title">${e(String(settings.clinic.name).toUpperCase())}</div><div class="cb-sub">Daily Collection Register, Department Summary & Cash Reconciliation Sheet</div>
    <div class="cb-meta"><span><b>Date:</b> ${e(fmtDate(day.date))}</span><span><b>Scope:</b> ${e(scope)}</span><span><b>Printed:</b> ${e(fmtDateTime(Date.now()))}</span></div></div>`;
  const sig = `<div class="cb-sign cb-pin"><div><div class="ln"></div>Prepared by (billing desk)<br><b>${e(preparedBy || '')}</b></div><div><div class="ln"></div>Cash handed over by</div><div><div class="ln"></div>Verified & received by (Manager / Director)</div></div>`;
  const pseudo = { id: 'cashbook', status: 'SIGNED_FINAL', html: body, images: [], demographics: {}, layout: { showHeader: false, showSignature: false, footerText: 'Daily cash book · ' + settings.clinic.name, fontSize: 9.5, lineHeight: 1.3, margins: { top: 10, right: 11, bottom: 9, left: 11 } } };
  return renderReportPages(pseudo, settings, { demogHtml: head, endHtml: sig, bare: true, includeImages: false });
}

export function csvRows({ rows, settlements, expenses, names }) {
  const out = [];
  rows.forEach((r) => out.push({ Type: 'Collection', Time: fmtTime(r.inv.date), Ref: r.inv.invoiceNo, Party: fullName(r.inv.patient), Department: r.depts, Investigation: itemsText(r.inv), Gross: r.inv.gross, Discount: r.inv.discountAmount, Net: r.inv.net, Cash: r.cash, UPI: r.upi, Due: r.inv.billingType === 'umid' ? 0 : r.inv.balance, Cashless: r.inv.billingType === 'umid' ? r.inv.net : 0, ExpenseMode: '', Expense: '', Staff: names[r.inv.staffId] || '' }));
  settlements.forEach((s) => out.push({ Type: 'Old due collected', Time: fmtTime(s.p.at), Ref: s.inv.invoiceNo, Party: fullName(s.inv.patient), Department: '', Investigation: 'Balance of ' + fmtDate(s.inv.date), Gross: '', Discount: '', Net: '', Cash: s.p.mode === 'cash' ? s.p.amount : 0, UPI: s.p.mode !== 'cash' ? s.p.amount : 0, Due: '', Cashless: '', ExpenseMode: '', Expense: '', Staff: names[s.p.staffId] || '' }));
  expenses.forEach((x) => out.push({ Type: 'Expense', Time: fmtTime(x.createdAt), Ref: x.id, Party: x.description + (x.paidTo ? ' (' + x.paidTo + ')' : ''), Department: x.category, Investigation: '', Gross: '', Discount: '', Net: '', Cash: '', UPI: '', Due: '', Cashless: '', ExpenseMode: x.mode === 'cash' ? 'Cash' : 'UPI / Bank', Expense: x.amount, Staff: names[x.staffId] || '' }));
  return out;
}

export function whatsappSummary({ day, scope, staffRows, settings }) {
  const k = day.kpi;
  const lines = [
    `*${settings.clinic.name}*`, `Daily cash book · ${fmtDate(day.date)} · ${scope}`, '',
    `🧾 Bills: ${k.bills}  |  Gross ${inr(k.gross)}  |  Discount ${inr(k.discount)}`, `💰 Net billed: *${inr(k.net)}*`,
    `💵 Cash ${inr(k.cash)}  |  📲 UPI ${inr(k.upi)}  |  ⏳ Due ${inr(k.due)}${k.cashless ? '  |  Cashless ' + inr(k.cashless) : ''}`,
    `📤 Expenses ${inr(k.expenses)} (cash ${inr(k.cashExp)}, UPI ${inr(k.upiExp)})`, '',
    `🗄️ Drawer: float ${inr(k.opening)} + cash ${inr(k.cash)} − cash exp. ${inr(k.cashExp)} = *${inr(k.drawer)}*`
  ];
  if (staffRows.length > 2) { lines.push('', '*Staff handover*'); staffRows.filter((s) => !s.total).forEach((s) => lines.push(`• ${s.name}: ${s.bills} bills · cash ${inr(s.cash)} · hand over ${inr(s.drawer)}`)); }
  if (day.depts.length) { lines.push('', '*Departments*'); day.depts.forEach((d) => lines.push(`• ${d.dept}: ${d.count} · ${inr(d.net)}`)); }
  return lines.join('\n');
}
