// Printable outputs of the tariff directory: branded multi-page A4 rate card (all / one department /
// frequent tests, optional B2B & CGHS columns, preparation notes) and the patient estimate slip
// (A5 page or 80 mm thermal roll).
import { escapeHtml as e, fmtDate, fmtDateTime, inr, amountInWords } from '../../core/utils';
import { renderReportPages } from '../reporting/reportPrint';
import { deptSvg, deptOf, brandSvg } from '../../components/dept';

export const DEPT_ORDER = ['Ultrasound', 'Pathology', 'Biochemistry', 'X-Ray', 'ECG', 'Echo'];
const money = (n) => (Number(n) ? inr(n) : '—');

/** opts: { scope:'all'|'dept'|'frequent', dept, b2b, cghs, emergency, notes } */
export function rateCardPages(tests, settings, opts = {}) {
  const pick = tests.filter((t) => t.isActive !== false && (opts.scope === 'frequent' ? t.isFrequent : opts.scope === 'dept' ? t.department === opts.dept : true));
  const extra = [opts.emergency && 'Emergency', opts.b2b && 'B2B / Referral', opts.cghs && 'CGHS'].filter(Boolean);
  const cols = [['Code', '12%'], ['Investigation', (100 - 12 - 11 - 19 - extra.length * 10) + '%'], ['Rate', '11%']].concat(extra.map((h) => [h, '10%']), [['Report time', '19%']]);
  const sections = DEPT_ORDER.filter((d) => pick.some((t) => t.department === d)).map((d) => {
    const list = pick.filter((t) => t.department === d).sort((a, b) => String(a.code).localeCompare(String(b.code)));
    const rows = list.map((t) => `<tr><td style="white-space:nowrap">${e(t.code)}</td><td><b>${e(t.name)}</b>${t.shortName ? ` <span style="color:#64748b">(${e(t.shortName)})</span>` : ''}${opts.notes && t.description ? `<div style="font-size:0.82em;color:#475569">${e(t.description)}</div>` : ''}</td>
      <td style="text-align:right"><b>${money(t.tariff.standardRate)}</b></td>${opts.emergency ? `<td style="text-align:right">${money(t.tariff.emergencyRate)}</td>` : ''}${opts.b2b ? `<td style="text-align:right">${money(t.tariff.b2bRate)}</td>` : ''}${opts.cghs ? `<td style="text-align:right">${money(t.tariff.cghsRate)}</td>` : ''}<td style="font-size:0.85em">${e(t.tat || '')}</td></tr>`).join('');
    // icon as an <img> data URI: html2canvas draws inline stroke-only SVG unreliably in PDFs
    const icon = `<img alt="" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(deptSvg(d, 18))}" style="width:4.6mm;height:4.6mm">`;
    return `<h3 class="rc-dept" style="color:${deptOf(d).hex}">${icon} ${e(deptOf(d).label)} <span style="font-weight:500;color:#64748b;font-size:0.8em">· ${list.length} test(s)</span></h3>
      <table class="rc-tbl"><tr>${cols.map(([h, w]) => `<th style="width:${w}${/Rate|Emergency|B2B|CGHS/.test(h) ? ';text-align:right' : ''}">${h}</th>`).join('')}</tr>${rows}</table>`;
  }).join('');
  const title = opts.scope === 'frequent' ? 'FREQUENTLY ORDERED INVESTIGATIONS' : opts.scope === 'dept' ? String(deptOf(opts.dept).label).toUpperCase() + ' — RATE LIST' : 'MASTER INVESTIGATION & DIAGNOSTIC TARIFF DIRECTORY';
  const intro = `<div class="rc-title"><div><b>${e(title)}</b></div><div style="font-size:0.85em;color:#475569">Rates in Indian Rupees (₹) · effective ${e(fmtDate(Date.now()))} · ${pick.length} investigation(s) · subject to revision without notice</div></div>`;
  const pseudo = {
    id: 'ratecard', status: 'SIGNED_FINAL', html: sections || '<p>No investigations in this selection.</p>', images: [], demographics: {},
    layout: { showSignature: false, footerText: 'Rate list · ' + settings.clinic.name + ' · ☎ ' + [settings.clinic.phone, settings.clinic.phone2].filter(Boolean).join(', '), fontSize: 10, lineHeight: 1.3, margins: { top: 10, right: 12, bottom: 10, left: 12 } }
  };
  return renderReportPages(pseudo, settings, { demogHtml: intro, endHtml: '<p style="font-size:0.85em;color:#475569;margin-top:4mm">Emergency / STAT rates apply outside routine hours. NWR UMID beneficiaries are billed at CGHS rates (cashless). Ask the front desk for package rates.</p>', bare: true, includeImages: false });
}

/** Patient estimate slip. items: [{name, code, department, rate}] */
export function estimateHtml({ items, discount = 0, rateLabel = 'Standard', format = 'a5', patient = '' }, settings) {
  const c = settings.clinic;
  const gross = items.reduce((s, x) => s + Number(x.rate || 0), 0);
  const net = Math.max(0, gross - Number(discount || 0));
  const thermal = format === 'thermal';
  const logo = c.logo ? `<img src="${e(c.logo)}" style="width:${thermal ? 34 : 44}px;height:${thermal ? 34 : 44}px;object-fit:contain">` : brandSvg(thermal ? 34 : 44);
  const rows = items.map((x, i) => `<tr><td>${i + 1}</td><td>${e(x.name)}<div style="font-size:0.8em;color:#64748b">${e(x.code || '')} · ${e(x.department || '')}</div></td><td style="text-align:right">${inr(x.rate)}</td></tr>`).join('');
  const style = thermal ? 'width:80mm;padding:3mm 3.5mm 5mm;font-size:10.5px' : 'width:148mm;height:210mm;padding:10mm 11mm;font-size:12px';
  return `<div class="print-page" style="${style};box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;color:#000;line-height:1.35">
    <div style="display:flex;align-items:center;gap:8px;border-bottom:2px solid #0284c7;padding-bottom:6px">${logo}<div><div style="font-weight:800;font-size:${thermal ? 12 : 15}px;color:#0c4a6e">${e(String(c.name).toUpperCase())}</div><div style="font-size:${thermal ? 8.5 : 9.5}px">${e(c.address)}<br>☎ ${e([c.phone, c.phone2].filter(Boolean).join(', '))}</div></div></div>
    <div style="text-align:center;font-weight:800;letter-spacing:.08em;margin:8px 0 4px">PATIENT ESTIMATE</div>
    <div style="display:flex;justify-content:space-between;font-size:0.9em"><span>${patient ? 'Patient: <b>' + e(patient) + '</b>' : ''}</span><span>${e(fmtDateTime(Date.now()))}</span></div>
    <table style="width:100%;border-collapse:collapse;margin-top:6px">
      <tr style="border-bottom:1px solid #000"><th style="text-align:left;width:7%">#</th><th style="text-align:left">Investigation</th><th style="text-align:right;width:24%">${e(rateLabel)} rate</th></tr>
      ${rows}
      <tr style="border-top:1px solid #000"><td></td><td style="text-align:right">Total</td><td style="text-align:right">${inr(gross)}</td></tr>
      ${Number(discount) ? `<tr><td></td><td style="text-align:right">Discount</td><td style="text-align:right">− ${inr(discount)}</td></tr>` : ''}
      <tr><td></td><td style="text-align:right;font-weight:800">Estimated amount</td><td style="text-align:right;font-weight:800;font-size:1.15em">${inr(net)}</td></tr>
    </table>
    <div style="font-size:0.85em;margin-top:4px"><i>${e(amountInWords(net))}</i></div>
    <div style="margin-top:10px;font-size:0.82em;color:#334155;border-top:1px dashed #94a3b8;padding-top:6px">This is an estimate only, not a bill or receipt. Final charges are confirmed at the billing desk. Rates are valid on the date of issue.</div>
  </div>`;
}
