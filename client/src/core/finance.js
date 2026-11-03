// Financial computations shared by Billing, Daily Cash Book and Accounts (doctor sharing & analytics).
import { round2, sumBy, dateKey, parseKey } from './utils';

export const DIGITAL_MODES = new Set(['upi', 'qr', 'card']);
export const MODE_LABEL = { cash: 'Cash', upi: 'UPI', qr: 'QR Code', card: 'Debit / Credit Card', due: 'Due / Credit', split: 'Split / Mixed', umid: 'Cashless' };

/**
 * Bill totals. Tax (GST) applies on the value after concession; diagnostic services are normally
 * exempt, so the rate defaults to 0 and UMID cashless bills (CGHS all-inclusive rates) never carry it.
 * net = taxable value + tax = the amount payable.
 */
export function invoiceTotals({ items, discountType, discountValue, taxRate, billingType }) {
  const gross = round2(sumBy(items || [], (x) => Number(x.amount !== undefined ? x.amount : x.rate) || 0));
  let discountAmount = discountType === 'percent' ? round2(gross * (Number(discountValue) || 0) / 100) : round2(Number(discountValue) || 0);
  discountAmount = Math.max(0, Math.min(gross, discountAmount));
  const taxable = round2(gross - discountAmount);
  const rate = billingType === 'umid' ? 0 : Math.max(0, Math.min(28, Number(taxRate) || 0));
  const taxAmount = round2(taxable * rate / 100);
  const net = round2(taxable + taxAmount);
  return { gross, discountAmount, taxable, taxRate: rate, taxAmount, net };
}

export function paidOf(inv) { return round2(sumBy(inv.payments || [], 'amount')); }

export function statusOf(inv) {
  if (inv.billingType === 'umid') return 'CASHLESS';
  const paid = paidOf(inv);
  if (paid >= inv.net - 0.009) return 'PAID';
  return paid > 0 ? 'PARTIAL' : 'DUE';
}

/** Recompute derived money fields of an invoice. */
export function finalizeInvoice(inv) {
  const t = invoiceTotals(inv);
  const out = Object.assign({}, inv, t);
  out.paid = paidOf(out);
  out.balance = out.billingType === 'umid' ? 0 : Math.max(0, round2(out.net - out.paid));
  out.status = statusOf(out);
  return out;
}

/** Department groupings */
export function cashbookDept(item, testsMap) {
  const t = testsMap && testsMap[item.testId];
  const dept = item.department || (t && t.department);
  if (dept === 'Ultrasound') return (t ? t.isDoppler : /doppler/i.test(item.name)) ? 'Color Doppler' : 'USG (Sonography)';
  if (dept === 'Pathology' || dept === 'Biochemistry') return 'Pathology / Lab';
  if (dept === 'X-Ray') return 'X-Ray';
  if (dept === 'ECG') return 'ECG';
  return 'Other';
}
export const CASHBOOK_DEPTS = ['USG (Sonography)', 'Color Doppler', 'Pathology / Lab', 'X-Ray', 'ECG', 'Other'];

export function accountsDept(item) {
  const d = item.department;
  if (d === 'Ultrasound') return 'Sonography (USG)';
  if (d === 'Pathology' || d === 'Biochemistry') return 'Pathology (Lab)';
  if (d === 'X-Ray') return 'X-Ray';
  if (d === 'ECG') return 'ECG';
  return 'Other Investigations';
}
export const ACCOUNTS_DEPTS = ['Sonography (USG)', 'Pathology (Lab)', 'X-Ray', 'ECG', 'Other Investigations'];
export const shareKeyFor = (item) => ({ Ultrasound: 'USG', Pathology: 'LAB', Biochemistry: 'LAB', 'X-Ray': 'XRAY' }[item.department] || 'ECG');

/** Item-level allocation of discount and payments (proportional; the rounding remainder goes to the
 *  last item so item sums always equal the bill totals exactly). */
export function allocate(inv, paymentsFilter) {
  const gross = inv.gross || 0;
  const pays = (inv.payments || []).filter(paymentsFilter || (() => true));
  const cash = sumBy(pays.filter((p) => p.mode === 'cash'), 'amount');
  const digital = sumBy(pays.filter((p) => DIGITAL_MODES.has(p.mode)), 'amount');
  const umid = inv.billingType === 'umid';
  const taxable = round2(gross - (inv.discountAmount || 0));
  const items = (inv.items || []).map((it) => {
    const share = gross ? (it.amount || 0) / gross : 0;
    const disc = round2((inv.discountAmount || 0) * share);
    const tax = taxable > 0 ? round2((inv.taxAmount || 0) * ((it.amount || 0) - disc) / taxable) : 0;
    const net = round2((it.amount || 0) - disc + tax);
    const nshare = inv.net ? net / inv.net : 0;
    return Object.assign({}, it, { disc, tax, net, cash: round2(cash * nshare), upi: round2(digital * nshare), due: umid ? 0 : round2((inv.balance || 0) * nshare), cashless: umid ? net : 0 });
  });
  if (items.length > 1) {
    const last = items[items.length - 1];
    const fix = (k, total) => { const rest = round2(total - sumBy(items, k)); if (rest) last[k] = round2(last[k] + rest); };
    fix('disc', inv.discountAmount || 0);
    fix('tax', inv.taxAmount || 0);
    last.net = round2((last.amount || 0) - last.disc + last.tax);
    fix('cash', cash);
    fix('upi', digital);
    if (!umid) fix('due', inv.balance || 0); else last.cashless = last.net;
  }
  return items;
}

export const DISCOUNT_RULES = {
  share_minus_discount: { label: 'Share on bill − full discount (Max 0)', fn: (bill, disc, pct) => ({ share: round2(bill * pct / 100), payable: Math.max(0, round2(bill * pct / 100 - disc)) }) },
  share_on_net: { label: 'Share calculated on net (bill − discount)', fn: (bill, disc, pct) => ({ share: round2(bill * pct / 100), payable: round2(Math.max(0, bill - disc) * pct / 100) }) },
  split_discount: { label: 'Discount shared 50 : 50 with centre', fn: (bill, disc, pct) => ({ share: round2(bill * pct / 100), payable: Math.max(0, round2(bill * pct / 100 - disc / 2)) }) },
  ignore_discount: { label: 'Discount borne by centre (share on bill)', fn: (bill, disc, pct) => ({ share: round2(bill * pct / 100), payable: round2(bill * pct / 100) }) }
};

export function doctorShareRows(invoices, doctor, rule = 'share_minus_discount') {
  const f = (DISCOUNT_RULES[rule] || DISCOUNT_RULES.share_minus_discount).fn;
  const rows = [];
  invoices.filter((i) => i.referredBy === doctor.id).forEach((inv) => {
    allocate(inv).forEach((it) => {
      const pct = Number((doctor.shares || {})[shareKeyFor(it)] || 0);
      const r = f(it.amount || 0, it.disc || 0, pct);
      rows.push({ invoiceId: inv.id, invoiceNo: inv.invoiceNo, date: inv.date, patient: inv.patient, test: it.name, department: it.department, bill: it.amount || 0, discount: it.disc || 0, pct, share: r.share, payable: r.payable });
    });
  });
  return rows.sort((a, b) => a.date - b.date);
}

export function inRange(ts, from, to) {
  const k = dateKey(ts);
  return (!from || k >= from) && (!to || k <= to);
}

/** Daily cash book for one date and one staff ('ALL' = manager consolidated). */
export function cashbookDay({ date, staffId, invoices, expenses, floats, testsMap }) {
  const all = staffId === 'ALL';
  const dayInv = invoices.filter((i) => i.dateKey === date && (all || i.staffId === staffId));
  const payToday = (p) => dateKey(p.at) === date && (all || p.staffId === staffId);
  let cash = 0, upi = 0;
  invoices.forEach((inv) => (inv.payments || []).forEach((p) => {
    if (!payToday(p)) return;
    if (p.mode === 'cash') cash += Number(p.amount) || 0;
    else if (DIGITAL_MODES.has(p.mode)) upi += Number(p.amount) || 0;
  }));
  const gross = sumBy(dayInv, 'gross');
  const discount = sumBy(dayInv, 'discountAmount');
  const net = sumBy(dayInv, 'net');
  const cashless = sumBy(dayInv.filter((i) => i.billingType === 'umid'), 'net');
  const due = sumBy(dayInv.filter((i) => i.billingType !== 'umid'), 'balance');
  const exp = expenses.filter((e) => e.date === date && (all || e.staffId === staffId));
  const cashExp = sumBy(exp.filter((e) => e.mode === 'cash'), 'amount');
  const upiExp = sumBy(exp.filter((e) => e.mode !== 'cash'), 'amount');
  const fl = floats.filter((f) => f.date === date && (all || f.staffId === staffId));
  const opening = sumBy(fl, 'amount');
  const drawer = round2(opening + cash - cashExp);

  // department summary
  const depts = {};
  dayInv.forEach((inv) => allocate(inv, (p) => dateKey(p.at) === date).forEach((it) => {
    const k = cashbookDept(it, testsMap);
    const d = depts[k] || (depts[k] = { dept: k, count: 0, gross: 0, discount: 0, net: 0, cash: 0, upi: 0, due: 0, cashless: 0 });
    d.count += 1; d.gross += it.amount || 0; d.discount += it.disc; d.net += it.net; d.cash += it.cash; d.upi += it.upi; d.due += it.due; d.cashless += it.cashless;
  }));

  // due collected today for bills of earlier days
  const settlements = [];
  invoices.forEach((inv) => {
    if (inv.dateKey === date) return;
    (inv.payments || []).forEach((p) => { if (payToday(p)) settlements.push({ inv, p }); });
  });

  return {
    date, staffId, invoices: dayInv, settlements, expenses: exp,
    kpi: { bills: dayInv.length, gross: round2(gross), discount: round2(discount), net: round2(net), cash: round2(cash), upi: round2(upi), collected: round2(cash + upi), due: round2(due), cashless: round2(cashless), cashExp: round2(cashExp), upiExp: round2(upiExp), expenses: round2(cashExp + upiExp), opening: round2(opening), drawer, bank: round2(upi - upiExp) },
    depts: Object.values(depts).sort((a, b) => b.net - a.net)
  };
}

export function periodAnalytics({ from, to, invoices, expenses, doctors, rule }) {
  const inv = invoices.filter((i) => inRange(i.date, from, to));
  const exp = expenses.filter((e) => (!from || e.date >= from) && (!to || e.date <= to));
  const docById = {};
  doctors.forEach((d) => { docById[d.id] = d; });
  const f = (DISCOUNT_RULES[rule] || DISCOUNT_RULES.share_minus_discount).fn;
  let sharePayable = 0;
  const depts = {};
  const daily = {};
  inv.forEach((i) => {
    const doc = docById[i.referredBy];
    const dk = i.dateKey || dateKey(i.date);
    const day = daily[dk] || (daily[dk] = { date: dk, patients: 0, tests: 0, gross: 0, discount: 0, net: 0 });
    day.patients += 1; day.tests += (i.items || []).length; day.gross += i.gross; day.discount += i.discountAmount; day.net += i.net;
    allocate(i).forEach((it) => {
      const k = accountsDept(it);
      const d = depts[k] || (depts[k] = { dept: k, patients: new Set(), tests: 0, gross: 0, discount: 0, net: 0, share: 0, tax: 0 });
      d.patients.add(i.patientId || i.id); d.tests += 1; d.gross += it.amount || 0; d.discount += it.disc; d.net += it.net; d.tax += it.tax || 0;
      if (doc) {
        const pct = Number((doc.shares || {})[shareKeyFor(it)] || 0);
        const s = f(it.amount || 0, it.disc, pct).payable;
        d.share += s; sharePayable += s;
      }
    });
  });
  const gross = sumBy(inv, 'gross');
  const discount = sumBy(inv, 'discountAmount');
  const net = sumBy(inv, 'net');
  const expTotal = sumBy(exp, 'amount');
  const tax = sumBy(inv, (i) => i.taxAmount || 0);
  // tax collected belongs to the government: it is not part of the centre's retention
  const deptRows = Object.values(depts).map((d) => Object.assign({}, d, { patients: d.patients.size, retention: round2(d.net - d.share - d.tax) }));
  return {
    invoices: inv, expenses: exp,
    kpi: { patients: new Set(inv.map((i) => i.patientId || i.id)).size, visits: inv.length, tests: sumBy(inv, (i) => (i.items || []).length), gross: round2(gross), discount: round2(discount), net: round2(net), tax: round2(tax), sharePayable: round2(sharePayable), expenses: round2(expTotal), netSavings: round2(net - tax - sharePayable - expTotal) },
    depts: deptRows, daily: Object.values(daily).sort((a, b) => (a.date < b.date ? -1 : 1))
  };
}

export function monthRange(mk) {
  const [y, m] = mk.split('-').map(Number);
  const from = mk + '-01';
  const last = new Date(y, m, 0).getDate();
  return { from, to: mk + '-' + String(last).padStart(2, '0'), days: last };
}

export function eachDay(from, to) {
  const out = [];
  let d = parseKey(from);
  const end = parseKey(to);
  while (d <= end) { out.push(dateKey(d)); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); }
  return out;
}


// ---------------------------------------------------------------- automatic price tier
export const TIER_LABEL = { standardRate: 'Standard', emergencyRate: 'Emergency / STAT', b2bRate: 'B2B / Referral', cghsRate: 'CGHS' };
const minutesOf = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** True when `at` falls inside the from–to window (the window may cross midnight, e.g. 21:00–08:00). */
export function inTimeWindow(at, from, to) {
  const f = minutesOf(from);
  const t = minutesOf(to);
  if (f === null || t === null || f === t) return false;
  const d = new Date(at);
  const m = d.getHours() * 60 + d.getMinutes();
  return f < t ? m >= f && m < t : m >= f || m < t;
}
/**
 * The price tier a new bill should start with: the referring doctor's partner tier (Accounts → doctor
 * master), else the emergency tier inside the night window (Settings → Billing), else standard.
 * → { tier, reason }
 */
export function autoTier({ doctor, settings, at = Date.now() }) {
  if (doctor && doctor.rateTier && doctor.rateTier !== 'standardRate') return { tier: doctor.rateTier, reason: (TIER_LABEL[doctor.rateTier] || doctor.rateTier) + ' — partner rate for ' + doctor.name };
  const r = (settings && settings.billing && settings.billing.tierRules) || {};
  if (r.autoEmergency && inTimeWindow(at, r.emergencyFrom || '21:00', r.emergencyTo || '08:00')) return { tier: 'emergencyRate', reason: 'Emergency / STAT — after-hours rate (' + (r.emergencyFrom || '21:00') + '–' + (r.emergencyTo || '08:00') + ')' };
  return { tier: 'standardRate', reason: '' };
}
