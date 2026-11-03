// Lab report model helpers + A4 renderer: panel tables (result, unit, biological reference interval,
// method) with H / L / abnormal flags in bold, auto-calculated indices, panel notes, pathologist's
// comment and the dual signature block (lab technician + consultant pathologist).
import { store } from '../../core/store';
import { escapeHtml as e, fmtDate, fmtDateTime, ageShort } from '../../core/utils';
import { renderReportPages } from '../reporting/reportPrint';
import { htmlToPdf } from '../../core/pdf';
import { htmlToDocxBlob } from '../../core/docx';
import { printHtml } from '../../core/print';
import lab from '../../../../shared/lab-panels';

export const { LAB_PANELS, refText, flagFor, runCalcs } = lab;
export const LAB_STATUS = {
  PENDING: { label: 'Sample pending', tone: 'slate' },
  SAMPLE_COLLECTED: { label: 'Sample collected', tone: 'sky' },
  DRAFT: { label: 'In entry', tone: 'amber' },
  SUBMITTED: { label: 'Awaiting verification', tone: 'violet' },
  AMENDING: { label: 'Amending', tone: 'rose' },
  SIGNED_FINAL: { label: 'Verified & signed', tone: 'emerald' }
};
export const LAB_FLOW = ['PENDING', 'SAMPLE_COLLECTED', 'DRAFT', 'SUBMITTED', 'SIGNED_FINAL'];

// Panic / critical limits (low, high) that must be communicated to the referring doctor at once
export const CRITICAL = {
  hb: [7, 20], plt: [0.5, 10], tlc: [2000, 30000], fbs: [50, 400], ppbs: [50, 450], rbs: [50, 400], k: [2.8, 6.2], na: [120, 160],
  ca: [6.5, 13], inr: [null, 5], creat: [null, 5], tropi: [null, 0.5], tbil: [null, 15]
};
export function criticalFor(prm, v) {
  const lim = CRITICAL[prm.id];
  if (!lim || prm.type !== 'num' || v === undefined || v === null || v === '' || Number.isNaN(Number(v))) return '';
  const n = Number(v);
  if (lim[0] !== null && n < lim[0]) return 'LL';
  if (lim[1] !== null && n > lim[1]) return 'HH';
  return '';
}
export function criticalList(rep) {
  const out = [];
  const vals = computedValues(rep);
  panelsOf(rep).forEach((p) => p.params.forEach((prm) => {
    if (prm.heading) return;
    const v = (vals[p.id] || {})[prm.id];
    const c = criticalFor(prm, v);
    if (c) out.push({ panel: p.id, id: prm.id, name: prm.name, value: v, unit: prm.unit || '', dir: c });
  }));
  return out;
}

export const panelOf = (t) => (t && t.panel && LAB_PANELS[t.panel]) || null;
export const panelsOf = (rep) => {
  const out = [];
  (rep.tests || []).forEach((t) => { const p = panelOf(t); if (p && !out.find((x) => x.id === p.id)) out.push(p); });
  return out;
};
export const freeTests = (rep) => (rep.tests || []).filter((t) => !panelOf(t));

/** Values with calculated indices applied, per panel. */
export function computedValues(rep) {
  const out = {};
  panelsOf(rep).forEach((p) => { out[p.id] = runCalcs(p, (rep.values || {})[p.id] || {}, rep.patient); });
  return out;
}

export function flagCount(rep) {
  let n = 0;
  const vals = computedValues(rep);
  panelsOf(rep).forEach((p) => p.params.forEach((prm) => { if (!prm.heading && flagFor(prm, (vals[p.id] || {})[prm.id], rep.patient)) n++; }));
  return n;
}

export function filledCount(rep) {
  let filled = 0;
  let total = 0;
  const vals = computedValues(rep);
  panelsOf(rep).forEach((p) => p.params.forEach((prm) => {
    if (prm.heading || prm.calc) return;
    total++;
    const v = (vals[p.id] || {})[prm.id];
    if (v !== undefined && v !== null && v !== '') filled++;
  }));
  freeTests(rep).forEach((t) => { total++; if (((rep.freeResults || {})[t.testId] || '').trim()) filled++; });
  return { filled, total };
}

/** Previous verified result of the same patient for a parameter (delta check). */
export function previousResult(rep, panelId, paramId) {
  const prev = store.list('labReports').filter((r) => r.id !== rep.id && r.patientId && r.patientId === rep.patientId && r.status === 'SIGNED_FINAL' && r.values && r.values[panelId] && r.values[panelId][paramId] !== undefined && r.values[panelId][paramId] !== '')
    .sort((a, b) => (b.verifiedAt || b.createdAt) - (a.verifiedAt || a.createdAt))[0];
  return prev ? { value: prev.values[panelId][paramId], at: prev.verifiedAt || prev.createdAt } : null;
}

const fmtVal = (prm, v) => {
  if (v === undefined || v === null || v === '') return '';
  if (prm.type === 'num' && !Number.isNaN(Number(v))) { const d = prm.dec === undefined ? 1 : prm.dec; return Number(v).toFixed(d); }
  return String(v);
};

export function labBodyHtml(rep, settings) {
  const vals = computedValues(rep);
  let lastSection = '';
  const parts = [`<h3 style="text-align:center;letter-spacing:.04em;margin:0 0 2mm"><u>${e((settings.lab && settings.lab.reportTitle) || 'LABORATORY INVESTIGATION REPORT')}</u></h3>`];
  panelsOf(rep).forEach((p) => {
    if (p.section && p.section !== lastSection) { parts.push(`<div class="lab-sec rp-keep">${e(p.section)}</div>`); lastSection = p.section; }
    parts.push(`<div class="lab-ptitle rp-keep">${e(p.title)}</div>`);
    const rows = [];
    p.params.forEach((prm) => {
      if (prm.heading) { rows.push(`<tr class="lab-h"><td colspan="4">${e(prm.heading)}</td></tr>`); return; }
      const v = (vals[p.id] || {})[prm.id];
      if ((v === undefined || v === '') && prm.calc) return;
      const flag = flagFor(prm, v, rep.patient);
      const txt = fmtVal(prm, v);
      const shown = txt === '' ? '—' : e(txt).replace(/\n/g, '<br>') + (flag === 'H' ? ' <span class="lab-f">H</span>' : flag === 'L' ? ' <span class="lab-f">L</span>' : '');
      const showMethod = settings.lab && settings.lab.showMethod !== false && prm.method;
      rows.push(`<tr><td>${e(prm.name)}${showMethod ? `<div class="lab-m">${e(prm.method)}</div>` : ''}</td><td class="${flag ? 'lab-ab' : ''}">${shown}</td><td>${e(prm.unit || '')}</td><td>${e(refText(prm, rep.patient))}</td></tr>`);
    });
    parts.push(`<table class="lab-tbl"><tr><th style="width:38%">Investigation</th><th style="width:20%">Result</th><th style="width:14%">Unit</th><th>Biological Ref. Interval</th></tr>${rows.join('')}</table>`);
    const meta = [p.sample ? 'Sample: ' + p.sample : '', p.method ? 'Method: ' + p.method : ''].filter(Boolean).join(' · ');
    if (meta) parts.push(`<p class="lab-meta">${e(meta)}</p>`);
    if (p.note) parts.push(`<p class="lab-note">${e(p.note)}</p>`);
    const rmk = (rep.remarks || {})[p.id];
    if (rmk) parts.push(`<p class="lab-rmk"><b>Remarks:</b> ${e(rmk)}</p>`);
  });
  const free = freeTests(rep);
  if (free.length) {
    parts.push('<div class="lab-sec rp-keep">OTHER INVESTIGATIONS</div>');
    parts.push(`<table class="lab-tbl"><tr><th style="width:38%">Investigation</th><th>Result / Observation</th></tr>${free.map((t) => `<tr><td>${e(t.name)}</td><td>${e(((rep.freeResults || {})[t.testId] || '—')).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>`);
  }
  if (rep.comment) parts.push(`<p class="lab-comment"><b>Pathologist’s comment:</b> ${e(rep.comment).replace(/\n/g, '<br>')}</p>`);
  if (rep.criticalNote) parts.push(`<p class="lab-comment"><b>Critical value communicated:</b> ${e(rep.criticalNote)}</p>`);
  parts.push('<p class="lab-end">— End of report —</p>');
  return parts.join('');
}

function signer(id, fallbackRole) {
  const u = id ? store.get('users', id) : null;
  if (u) return u;
  return store.list('users').find((x) => x.role === fallbackRole) || null;
}

export function labSignatureHtml(rep, settings) {
  const signed = rep.status === 'SIGNED_FINAL';
  const entered = rep.enteredBy ? store.get('users', rep.enteredBy) : null;
  const first = entered || signer(null, 'LAB_TECHNICIAN');
  const path = signer(rep.verifiedBy, 'CONSULTANT_PATHOLOGIST');
  // Dual-Signatory Pathology Mode (Admin Console → Compliance) prints technician + pathologist blocks
  const dual = !settings.compliance || settings.compliance.dualSignatoryPathology !== false;
  const same = !dual || !!(entered && path && entered.id === path.id);
  const c = settings.clinic;
  const isTech = !first || first.role === 'LAB_TECHNICIAN';
  const block = (u, name, line1, line2, show) => `<div class="lab-sig">${show && u && u.digitalSignatureUrl ? `<img src="${e(u.digitalSignatureUrl)}" class="rp-sigimg" alt="">` : '<div class="rp-sigspace"></div>'}<div class="rp-signname">${e(name)}</div><div class="rp-signsub">${e(line1)}${line2 ? '<br>' + e(line2) : ''}</div></div>`;
  const firstLines = [
    [first && first.qualification, (first && first.designation) || (isTech ? c.labTech.designation || 'Lab Technician' : '')].filter(Boolean).join(' · '),
    (first && first.registrationNumber) || (isTech && c.labTech.rpmc ? 'RPMC Reg. No. ' + c.labTech.rpmc : '')
  ];
  const pathLines = [[(path && path.qualification) || c.pathologist.qualification, (path && path.designation) || c.pathologist.designation].filter(Boolean).join(' · '), (path && path.registrationNumber) || (c.pathologist.rmc ? 'RMC Reg. No. ' + c.pathologist.rmc : '')];
  return `<div class="lab-sigs">
    ${same ? '<div></div>' : block(first, (first && first.name) || c.labTech.name, firstLines[0], firstLines[1], !!entered && (signed || rep.status === 'SUBMITTED'))}
    ${block(path, (path && path.name) || c.pathologist.name, pathLines[0], pathLines[1], signed)}
  </div>
  <div class="lab-verify">${signed ? 'Verified & electronically signed on ' + e(fmtDateTime(rep.verifiedAt)) : '<b>PROVISIONAL</b> — not valid until verified by the pathologist'} · Report ID ${e(rep.id)}${rep.version > 1 ? ' · Amended v' + e(rep.version) : ''} · ${e((settings.lab && settings.lab.nablText) || '')}</div>`;
}

export function labDemogHtml(rep) {
  const p = rep.patient || {};
  const row = (k1, v1, k2, v2) => `<tr><td class="k">${k1}</td><td class="v">${v1}</td><td class="k">${k2}</td><td class="v">${v2}</td></tr>`;
  return `<table class="rp-demog"><colgroup><col style="width:17%"><col style="width:36%"><col style="width:17%"><col style="width:30%"></colgroup>
    ${row('Patient Name', '<b>' + e([p.title, p.name].filter(Boolean).join(' ')) + '</b>', 'Age / Sex', e([ageShort(p.age, p.ageUnit), p.gender].filter(Boolean).join(' / ')))}
    ${row('Patient ID', e(p.regId || ''), 'Sample ID', '<b>' + e(rep.sampleId || '') + '</b>')}
    ${row('Referred By', e(rep.refBy || 'Self'), 'Collected', e(rep.sampleCollectedAt ? fmtDateTime(rep.sampleCollectedAt) : '—'))}
    ${row('Investigations', e((rep.tests || []).map((t) => t.name).join(', ')), 'Reported', e(rep.verifiedAt ? fmtDateTime(rep.verifiedAt) : rep.submittedAt ? fmtDateTime(rep.submittedAt) : fmtDate(Date.now())))}
  </table>`;
}

/** A4 pages (shared paginator: running header, footer, page n of N, PROVISIONAL watermark). */
export function renderLabPages(rep, settings) {
  const pseudo = {
    id: rep.id, status: rep.status === 'SIGNED_FINAL' ? 'SIGNED_FINAL' : 'DRAFT', html: labBodyHtml(rep, settings), images: [],
    demographics: { name: [rep.patient && rep.patient.title, rep.patient && rep.patient.name].filter(Boolean).join(' '), patientId: (rep.patient && rep.patient.regId) || '', date: rep.createdAt ? new Date(rep.createdAt).toISOString().slice(0, 10) : '' },
    layout: Object.assign({}, rep.layout || {}, { footerText: (settings.lab && settings.lab.footerText) || '', fontSize: (rep.layout && rep.layout.fontSize) || 10.5 },
      // a letterhead template chosen for lab reports (Settings → Print & reports) wins over the USG header
      settings.lab && settings.lab.letterheadId ? { headerMode: 'template', letterheadId: settings.lab.letterheadId } : {})
  };
  return renderReportPages(pseudo, settings, { demogHtml: labDemogHtml(rep), endHtml: labSignatureHtml(rep, settings), watermarkText: 'PROVISIONAL', includeImages: false, headerDoctor: settings.clinic.pathologist });
}

export const labFileName = (rep) => `Lab_${String((rep.patient && rep.patient.name) || 'Patient').replace(/[^\w]+/g, '_')}_${rep.sampleId || rep.id}.pdf`;
export async function printLab(rep, settings) {
  const r = renderLabPages(rep, settings);
  await printHtml({ html: r.html, widthMm: r.widthMm, heightMm: r.heightMm, title: labFileName(rep).replace(/\.pdf$/, ''), audit: { action: 'lab:printed', target: 'labReports/' + rep.id, meta: { pages: r.pageCount, status: rep.status } } });
}
export const labPdfBlob = (rep, settings, download = false) => { const r = renderLabPages(rep, settings); return htmlToPdf(r.html, { widthMm: r.widthMm, heightMm: r.heightMm, filename: labFileName(rep), download }); };

/** Flowing document (MS Word .docx attachment / download): demographics, results, dual signature. */
export function labDocumentHtml(rep, settings) {
  const p = rep.patient || {};
  const c = settings.clinic;
  const k = (t) => `<td style="background:#f1f5f9;width:18%"><b>${t}</b></td>`;
  const demog = `<table style="width:100%;border-collapse:collapse;margin-bottom:8pt">
    <tr>${k('Patient Name')}<td><b>${e([p.title, p.name].filter(Boolean).join(' '))}</b></td>${k('Age / Sex')}<td>${e([ageShort(p.age, p.ageUnit), p.gender].filter(Boolean).join(' / '))}</td></tr>
    <tr>${k('Patient ID')}<td>${e(p.regId || '')}</td>${k('Sample ID')}<td><b>${e(rep.sampleId || '')}</b></td></tr>
    <tr>${k('Referred By')}<td>${e(rep.refBy || 'Self')}</td>${k('Collected')}<td>${e(rep.sampleCollectedAt ? fmtDateTime(rep.sampleCollectedAt) : '—')}</td></tr>
    <tr>${k('Reported')}<td colspan="3">${e(rep.verifiedAt ? fmtDateTime(rep.verifiedAt) : fmtDate(Date.now()))}${rep.status === 'SIGNED_FINAL' ? '' : ' — PROVISIONAL (not verified)'}</td></tr></table>`;
  const entered = rep.enteredBy ? store.get('users', rep.enteredBy) : null;
  const first = entered || signer(null, 'LAB_TECHNICIAN');
  const path = signer(rep.verifiedBy, 'CONSULTANT_PATHOLOGIST');
  const cell = (u, name, l1, l2) => `<td style="width:50%;vertical-align:top;border:0"><br><br><b>${e(name)}</b><br>${e(l1)}${l2 ? '<br>' + e(l2) : ''}</td>`;
  const sigs = `<table style="width:100%;margin-top:18pt;border:0"><tr>
    ${cell(first, (first && first.name) || c.labTech.name, (first && first.designation) || c.labTech.designation || 'Lab Technician', (first && first.registrationNumber) || 'RPMC Reg. No. ' + (c.labTech.rpmc || ''))}
    ${cell(path, (path && path.name) || c.pathologist.name, [(path && path.qualification) || c.pathologist.qualification, (path && path.designation) || c.pathologist.designation].filter(Boolean).join(' · '), (path && path.registrationNumber) || 'RMC Reg. No. ' + (c.pathologist.rmc || ''))}
  </tr></table><p style="font-size:8.5pt;color:#475569">${rep.status === 'SIGNED_FINAL' ? 'Verified & electronically signed on ' + e(fmtDateTime(rep.verifiedAt)) : 'PROVISIONAL — not valid until verified by the pathologist'} · Report ID ${e(rep.id)}</p>`;
  const headerHtml = `<p style="text-align:center;margin:0"><b style="font-size:15pt;color:#0c4a6e">${e(String(c.name || '').toUpperCase())}</b><br><span style="font-size:8.5pt">${e(c.address || '')} · ☎ ${e([c.phone, c.phone2].filter(Boolean).join(', '))}</span><br><span style="font-size:8.5pt">${e(c.pathologist.name)}, ${e(c.pathologist.qualification || '')} · ${e(c.pathologist.designation || '')}</span></p>`;
  return { body: demog + labBodyHtml(rep, settings) + sigs, headerHtml, footerHtml: `<p style="font-size:8pt;color:#475569">${e((settings.lab && settings.lab.footerText) || '')}</p>` };
}

export function labDocxBlob(rep, settings) {
  const d = labDocumentHtml(rep, settings);
  return htmlToDocxBlob(d.body, { title: 'Lab report – ' + ((rep.patient && rep.patient.name) || ''), headerHtml: d.headerHtml, footerHtml: d.footerHtml, margins: { top: 12, right: 14, bottom: 12, left: 14 }, fontFamily: 'Arial', fontSize: 10 });
}

