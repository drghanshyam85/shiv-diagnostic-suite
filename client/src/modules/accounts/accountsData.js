// Accounts analytics at line-item level (so the department filter is exact): volume, gross, discount,
// net collection, doctor sharing payable, centre retention, expenses and net savings — plus doctor
// statements, statement audit status and the A4 statement / monthly summary print builders.
import { store } from '../../core/store';
import { allocate, accountsDept, ACCOUNTS_DEPTS, shareKeyFor, DISCOUNT_RULES, inRange, eachDay } from '../../core/finance';
import { escapeHtml as e, fmtDate, fmtDateTime, inr, round2, fullName, dateKey, monthLabel } from '../../core/utils';
import { renderReportPages } from '../reporting/reportPrint';

export const SHARE_KEYS = [['USG', 'USG'], ['LAB', 'Lab'], ['XRAY', 'X-Ray'], ['ECG', 'ECG / Other']];
export { ACCOUNTS_DEPTS };

export function periodOf({ mode, month, day, from, to }) {
  if (mode === 'day') return { from: day, to: day, key: 'D' + day, label: fmtDate(day) };
  if (mode === 'range') return { from, to, key: 'R' + from + '_' + to, label: fmtDate(from) + ' – ' + fmtDate(to) };
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: month + '-01', to: month + '-' + String(last).padStart(2, '0'), key: 'M' + month, label: monthLabel(month) };
}

const ruleFn = (rule) => (DISCOUNT_RULES[rule] || DISCOUNT_RULES.share_minus_discount).fn;

/** dept: '' (all) or one of ACCOUNTS_DEPTS */
export function analytics({ from, to, dept, invoices, expenses, doctors, rule }) {
  const docById = new Map(doctors.map((d) => [d.id, d]));
  const f = ruleFn(rule);
  const kpi = { patients: 0, tests: 0, gross: 0, discount: 0, net: 0, share: 0, expenses: 0, tax: 0 };
  const pats = new Set();
  const daily = new Map();
  const depts = new Map(ACCOUNTS_DEPTS.map((d) => [d, { dept: d, patients: new Set(), tests: 0, gross: 0, discount: 0, net: 0, share: 0, tax: 0 }]));
  const byDoc = new Map();
  invoices.forEach((inv) => {
    if (!inRange(inv.date, from, to)) return;
    const items = allocate(inv).filter((it) => !dept || accountsDept(it) === dept);
    if (!items.length) return;
    const pid = inv.patientId || inv.id;
    pats.add(pid);
    const dk = inv.dateKey || dateKey(inv.date);
    const day = daily.get(dk) || { date: dk, patients: new Set(), tests: 0, gross: 0, discount: 0, net: 0, share: 0 };
    day.patients.add(pid);
    const doc = docById.get(inv.referredBy);
    items.forEach((it) => {
      const pct = doc ? Number((doc.shares || {})[shareKeyFor(it)] || 0) : 0;
      const r = doc ? f(it.amount || 0, it.disc || 0, pct) : { share: 0, payable: 0 };
      kpi.tests += 1; kpi.gross += it.amount || 0; kpi.discount += it.disc || 0; kpi.net += it.net || 0; kpi.share += r.payable; kpi.tax += it.tax || 0;
      day.tests += 1; day.gross += it.amount || 0; day.discount += it.disc || 0; day.net += it.net || 0; day.share += r.payable;
      const d = depts.get(accountsDept(it));
      d.patients.add(pid); d.tests += 1; d.gross += it.amount || 0; d.discount += it.disc || 0; d.net += it.net || 0; d.share += r.payable; d.tax += it.tax || 0;
      if (doc) {
        const x = byDoc.get(doc.id) || { doctor: doc, patients: new Set(), tests: 0, bill: 0, discount: 0, share: 0, payable: 0, byKey: {} };
        x.patients.add(pid); x.tests += 1; x.bill += it.amount || 0; x.discount += it.disc || 0; x.share += r.share; x.payable += r.payable;
        const sk = shareKeyFor(it);
        x.byKey[sk] = (x.byKey[sk] || 0) + r.payable; // payout per modality at that modality's agreed %
        byDoc.set(doc.id, x);
      }
    });
    daily.set(dk, day);
  });
  kpi.patients = pats.size;
  kpi.expenses = expenses.filter((x) => x.date >= from && x.date <= to).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  ['gross', 'discount', 'net', 'share', 'expenses', 'tax'].forEach((k) => { kpi[k] = round2(kpi[k]); });
  // tax collected is passed on to the government, so it is neither retention nor savings
  kpi.savings = round2(kpi.net - kpi.tax - kpi.share - kpi.expenses);
  const days = eachDay(from, to).map((dk) => { const d = daily.get(dk); return d ? Object.assign({}, d, { patients: d.patients.size, gross: round2(d.gross), discount: round2(d.discount), net: round2(d.net), share: round2(d.share) }) : { date: dk, patients: 0, tests: 0, gross: 0, discount: 0, net: 0, share: 0 }; });
  const deptRows = Array.from(depts.values()).map((d) => Object.assign({}, d, { patients: d.patients.size, gross: round2(d.gross), discount: round2(d.discount), net: round2(d.net), share: round2(d.share), retention: round2(d.net - d.share - d.tax) })).filter((d) => !dept || d.dept === dept);
  const docRows = Array.from(byDoc.values()).map((x) => Object.assign({}, x, { patients: x.patients.size, bill: round2(x.bill), discount: round2(x.discount), share: round2(x.share), payable: round2(x.payable), byKey: Object.fromEntries(Object.entries(x.byKey).map(([k, v]) => [k, round2(v)])) })).sort((a, b) => b.payable - a.payable);
  return { kpi, days, deptRows, docRows };
}

/** Month-by-month net collection split into centre retention and referral payouts (oldest first). */
export function monthlyTrend({ endMonth, months = 6, dept, invoices, expenses, doctors, rule }) {
  const [y, m] = endMonth.split('-').map(Number);
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    const mk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const p = periodOf({ mode: 'month', month: mk });
    const a = analytics({ from: p.from, to: p.to, dept, invoices, expenses, doctors, rule });
    const retention = round2(a.kpi.net - a.kpi.share - a.kpi.tax);
    out.push({ month: mk, label: p.label, net: a.kpi.net, share: a.kpi.share, retention, tax: a.kpi.tax, expenses: a.kpi.expenses, savings: a.kpi.savings, tests: a.kpi.tests, retentionPct: a.kpi.net ? Math.round((retention / a.kpi.net) * 1000) / 10 : 0 });
  }
  return out;
}

/** Statement line items for one doctor (department-filtered). */
export function statementRows({ from, to, dept, invoices, doctor, rule }) {
  const f = ruleFn(rule);
  const rows = [];
  invoices.forEach((inv) => {
    if (inv.referredBy !== doctor.id || !inRange(inv.date, from, to)) return;
    allocate(inv).forEach((it) => {
      if (dept && accountsDept(it) !== dept) return;
      const pct = Number((doctor.shares || {})[shareKeyFor(it)] || 0);
      const r = f(it.amount || 0, it.disc || 0, pct);
      rows.push({ id: inv.id + ':' + (it.testId || it.name), invoiceNo: inv.invoiceNo, date: inv.date, patientId: inv.patientId || inv.id, patient: fullName(inv.patient), test: it.name, dept: accountsDept(it), shareKey: shareKeyFor(it), bill: round2(it.amount || 0), discount: round2(it.disc || 0), pct, share: r.share, payable: r.payable });
    });
  });
  rows.sort((a, b) => a.date - b.date);
  const totals = { patients: new Set(rows.map((r) => r.patientId)).size, tests: rows.length, bill: 0, discount: 0, share: 0, payable: 0 };
  rows.forEach((r) => { totals.bill += r.bill; totals.discount += r.discount; totals.share += r.share; totals.payable += r.payable; });
  ['bill', 'discount', 'share', 'payable'].forEach((k) => { totals[k] = round2(totals[k]); });
  return { rows, totals };
}

export const statementId = (doctorId, periodKey) => 'stm_' + doctorId + '_' + periodKey;
export function statementStatus(doc) {
  if (!doc) return { label: 'Draft', tone: 'slate' };
  if (doc.approved) return { label: 'Approved by Owner', tone: 'emerald' };
  if (doc.verified) return { label: 'Audit Verified', tone: 'brand' };
  return { label: 'Draft', tone: 'slate' };
}
export const shareBadges = (doctor) => SHARE_KEYS.map(([k, l]) => l + ': ' + Number((doctor.shares || {})[k] || 0) + '%').join(' | ');
export const DEPT_SHORT = { 'Sonography (USG)': 'USG', 'Pathology (Lab)': 'Lab', 'X-Ray': 'X-Ray', ECG: 'ECG', 'Other Investigations': 'Other' };

// ---------------------------------------------------------------- A4 builders
const m = (n) => inr(n, { decimals: Number.isInteger(Number(n) || 0) ? 0 : 2 });

export function statementPages({ doctor, period, rows, totals, stm, settings, ruleLabel }) {
  const st = statementStatus(stm);
  const intro = `<div class="st-head"><div class="st-title">DOCTOR REFERRAL & SHARING STATEMENT</div>
    <table class="st-meta"><tr><td><b>Consultant</b><br>${e(doctor.name)}${doctor.qualification ? ', ' + e(doctor.qualification) : ''}</td><td><b>Speciality</b><br>${e(doctor.speciality || '—')}</td><td><b>Phone</b><br>${e(doctor.phone || '—')}</td><td><b>Statement period</b><br>${e(period.label)}</td></tr></table>
    <div class="st-badges">${SHARE_KEYS.map(([k, l]) => `<span>${e(l)}: <b>${Number((doctor.shares || {})[k] || 0)}%</b></span>`).join('')}<span class="st-rule">Discount rule: ${e(ruleLabel)}</span></div></div>`;
  const body = `<table class="cb-tbl st-tbl"><tr><th style="width:6%">S.No</th><th style="width:11%">Date</th><th style="width:20%">Patient</th><th>Investigation</th><th class="n" style="width:10%">Bill</th><th class="n" style="width:9%">Discount</th><th class="n" style="width:9%">Share</th><th class="n" style="width:11%">Payable</th></tr>
    ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${e(fmtDate(r.date))}</td><td>${e(r.patient)}</td><td>${e(r.test)} <span class="st-dept">${e(DEPT_SHORT[r.dept] || r.dept)} ${r.pct}%</span></td><td class="n">${m(r.bill)}</td><td class="n">${r.discount ? m(r.discount) : '—'}</td><td class="n">${m(r.share)}</td><td class="n"><b>${m(r.payable)}</b></td></tr>`).join('') || '<tr><td colspan="8">No referrals in this period.</td></tr>'}
    <tr class="tot"><td colspan="4">Total · ${totals.patients} patient(s) · ${totals.tests} investigation(s)</td><td class="n">${m(totals.bill)}</td><td class="n">${m(totals.discount)}</td><td class="n">${m(totals.share)}</td><td class="n">${m(totals.payable)}</td></tr></table>
    <table class="st-sum"><tr><td>Total patients<b>${totals.patients}</b></td><td>Total bill<b>${m(totals.bill)}</b></td><td>Total discount<b>${m(totals.discount)}</b></td><td>Total share<b>${m(totals.share)}</b></td><td class="hl">Total sharing payable<b>${m(totals.payable)}</b></td></tr></table>`;
  const stamp = (on, text, sub) => `<div class="st-stamp${on ? ' on' : ''}">${on ? e(text) : 'Pending'}${sub ? `<small>${e(sub)}</small>` : ''}</div>`;
  const sign = `<div class="st-sign cb-pin">
    <div><div class="ln"></div><b>${e(settings.accounts.accountsInCharge || 'Accounts In-Charge')}</b><br>${e(settings.clinic.name)}</div>
    <div>${stamp(stm && stm.verified, 'AUDIT VERIFIED', stm && stm.verifiedAt ? fmtDate(stm.verifiedAt) : '')}Audit status</div>
    <div>${stamp(stm && stm.approved, 'APPROVED BY OWNER', stm && stm.approvedAt ? fmtDate(stm.approvedAt) : '')}Status approved by Owner – ${e(settings.clinic.name)}</div>
  </div><div class="st-foot">Status: ${e(st.label)} · generated ${e(fmtDateTime(Date.now()))}</div>`;
  const pseudo = { id: 'stm', status: 'SIGNED_FINAL', html: body, images: [], demographics: { name: doctor.name }, layout: { showSignature: false, footerText: 'Referral & sharing statement · ' + doctor.name + ' · ' + period.label, fontSize: 9.6, lineHeight: 1.3, margins: { top: 9, right: 11, bottom: 9, left: 11 } } };
  return renderReportPages(pseudo, settings, { demogHtml: intro, endHtml: sign, bare: true, includeImages: false });
}

export function summaryPages({ period, data, deptFilter, expenses, settings }) {
  const k = data.kpi;
  const grid = `<table class="cb-grid"><tr><td><span>Patients · tests</span><b>${k.patients} · ${k.tests}</b></td><td><span>Gross bill</span><b>${m(k.gross)}</b></td><td><span>Discounts</span><b>${m(k.discount)}</b></td><td><span>Net collection</span><b>${m(k.net)}</b></td></tr>
    <tr><td><span>Doctor sharing payable</span><b>${m(k.share)}</b></td><td><span>Centre expenses</span><b>${m(k.expenses)}</b></td><td colspan="2"><span>Net revenue / net savings</span><b>${m(k.savings)}</b><small>net collection − sharing payable − expenses</small></td></tr></table>`;
  const dept = `<table class="cb-tbl"><tr><th>Department</th><th class="n">Patients</th><th class="n">Tests</th><th class="n">Gross</th><th class="n">Discount</th><th class="n">Net</th><th class="n">Doctor share</th><th class="n">Centre retention</th></tr>
    ${data.deptRows.map((d) => `<tr><td>${e(d.dept)}</td><td class="n">${d.patients}</td><td class="n">${d.tests}</td><td class="n">${m(d.gross)}</td><td class="n">${m(d.discount)}</td><td class="n">${m(d.net)}</td><td class="n">${m(d.share)}</td><td class="n"><b>${m(d.retention)}</b></td></tr>`).join('')}</table>`;
  const docs = `<table class="cb-tbl"><tr><th>Referring doctor</th><th>Speciality</th><th class="n">Patients</th><th class="n">Tests</th><th class="n">Bill</th><th class="n">Discount</th><th class="n">Payable</th></tr>
    ${data.docRows.map((x) => `<tr><td>${e(x.doctor.name)}</td><td>${e(x.doctor.speciality || '')}</td><td class="n">${x.patients}</td><td class="n">${x.tests}</td><td class="n">${m(x.bill)}</td><td class="n">${m(x.discount)}</td><td class="n"><b>${m(x.payable)}</b></td></tr>`).join('') || '<tr><td colspan="7">No referrals.</td></tr>'}</table>`;
  const cats = new Map();
  expenses.forEach((x) => cats.set(x.category, (cats.get(x.category) || 0) + (Number(x.amount) || 0)));
  const exp = `<table class="cb-tbl"><tr><th>Expense category</th><th class="n">Amount</th></tr>${Array.from(cats.entries()).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<tr><td>${e(c)}</td><td class="n">${m(v)}</td></tr>`).join('') || '<tr><td colspan="2">No expenses.</td></tr>'}<tr class="tot"><td>Total</td><td class="n">${m(k.expenses)}</td></tr></table>`;
  const head = `<div class="cb-head"><div class="cb-title">${e(String(settings.clinic.name).toUpperCase())}</div><div class="cb-sub">Monthly Financial & Department Collection Summary</div>
    <div class="cb-meta"><span><b>Period:</b> ${e(period.label)}</span><span><b>Department:</b> ${e(deptFilter || 'All departments')}</span><span><b>Printed:</b> ${e(fmtDateTime(Date.now()))}</span></div></div>`;
  const body = `<h4 class="cb-h">1 · Key figures</h4>${grid}<h4 class="cb-h">2 · Department-wise collection & retention</h4>${dept}<h4 class="cb-h">3 · Referring doctors — sharing payable</h4>${docs}<h4 class="cb-h">4 · Expenses by category</h4>${exp}`;
  const sig = `<div class="cb-sign cb-pin"><div><div class="ln"></div>${e(settings.accounts.accountsInCharge || 'Accounts In-Charge')}</div><div><div class="ln"></div>Audit</div><div><div class="ln"></div>${e(settings.accounts.ownerName || 'Owner')} (Owner)</div></div>`;
  const pseudo = { id: 'summary', status: 'SIGNED_FINAL', html: body, images: [], demographics: {}, layout: { showHeader: false, showSignature: false, footerText: 'Monthly summary · ' + settings.clinic.name, fontSize: 9.6, lineHeight: 1.3, margins: { top: 10, right: 11, bottom: 9, left: 11 } } };
  return renderReportPages(pseudo, settings, { demogHtml: head, endHtml: sig, bare: true, includeImages: false });
}

export function statementVars({ doctor, period, totals, stm, settings }) {
  return {
    Center_Name: settings.clinic.name, Doctor_Name: doctor.name, Period: period.label, Total_Patients: totals.patients,
    Total_Bill: inr(totals.bill, { symbol: false }), Total_Discount: inr(totals.discount, { symbol: false }), Share_Payable: inr(totals.payable, { symbol: false }),
    Audit_Status: statementStatus(stm).label
  };
}

export const allStatements = () => store.list('statements');
