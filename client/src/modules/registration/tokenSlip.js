// 80 mm thermal token slip.
import { printHtml } from '../../core/print';
import { escapeHtml as e, fmtDateTime, fullName, ageSex } from '../../core/utils';
import { getSettings } from '../../core/hooks';
import { prepGuidelines } from '../../core/clinic';
import { qrDataUrl } from '../../core/qr';

/** qr: data URL of the patient's Reg. ID — scanning the slip at the next visit loads the patient. */
export function tokenSlipHtml(visit, patient, qr) {
  const s = getSettings();
  const toks = Object.entries(visit.tokens || {}).filter(([k]) => k !== 'combined').map(([, t]) => `<span style="border:1.5px solid #000;border-radius:4px;padding:1px 6px;font-weight:800;font-size:13px">${e(t)}</span>`).join(' ');
  const prep = prepGuidelines(visit.tests).map((g) => `<div style="margin-top:2px">• <b>${e(g.test)}:</b> ${e(g.text)}</div>`).join('');
  return `<div class="print-page" style="width:80mm;padding:3.5mm 4mm 5mm;font-family:Arial,Helvetica,sans-serif;color:#000;font-size:10.5px;line-height:1.3">
  <div style="text-align:center;font-weight:800;font-size:12.5px;line-height:1.15">${e(s.clinic.name.toUpperCase())}</div>
  <div style="text-align:center;font-size:8.5px;margin-top:2px">Phulera, Jaipur · ${e(s.clinic.phone)}</div>
  <div class="dash-sep" style="margin:5px 0"></div>
  <div style="text-align:center;font-size:9px;letter-spacing:2px">TOKEN NUMBER</div>
  <div style="text-align:center;font-size:38px;font-weight:900;line-height:1.05">${e(visit.tokens.combined)}</div>
  <div style="text-align:center;margin:4px 0 2px">${toks}</div>
  <div class="dash-sep" style="margin:5px 0"></div>
  <div style="display:flex;gap:6px;align-items:flex-start">
    <div style="flex:1;min-width:0">
      <div><b>${e(fullName(patient))}</b> (${e(ageSex(patient))})</div>
      <div>Reg. ID: ${e(patient.regId)} · Mob: ${e(patient.mobile || '—')}</div>
      <div>Ref. by: ${e(visit.referredByName || 'Self')}</div>
      <div>${e(fmtDateTime(visit.createdAt))}</div>
    </div>
    ${qr ? `<div style="text-align:center;flex:0 0 auto"><img src="${qr}" alt="" style="width:19mm;height:19mm;display:block"><div style="font-size:7px">Scan next visit</div></div>` : ''}
  </div>
  <div class="dash-sep" style="margin:5px 0"></div>
  <div><b>Investigations:</b> ${e((visit.tests || []).map((t) => t.name).join(', ') || '—')}</div>
  ${prep ? `<div class="dash-sep" style="margin:5px 0"></div><div style="font-size:9px"><b>Preparation:</b>${prep}</div>` : ''}
  <div class="dash-sep" style="margin:5px 0"></div>
  <div style="text-align:center;font-size:9px">Please wait for your token to be called.<br>Thank you for choosing us.</div>
</div>`;
}

export async function printTokenSlip(visit, patient) {
  let qr = '';
  try { qr = patient.regId ? await qrDataUrl(patient.regId, { size: 180, margin: 0, dark: '#000000' }) : ''; } catch (err) { qr = ''; }
  return printHtml({ html: tokenSlipHtml(visit, patient, qr), widthMm: 80, heightMm: 'auto', title: 'Token ' + visit.tokens.combined, audit: { action: 'print:token_slip', target: 'visits/' + visit.id } });
}
