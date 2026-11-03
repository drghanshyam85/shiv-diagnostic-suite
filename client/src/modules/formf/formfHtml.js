// Form F renderer: two exact A4 pages (front = Sections A & B, back = Sections C & D) as an HTML string
// shared by the live preview, the print engine and PDF export. Every label / clause / value carries a
// data-edit key so "Edit Anything" mode can override it; ticks are inline SVG so they print crisply.
import { escapeHtml as esc, fmtDate } from '../../core/utils';
import { FORM_F_INDICATIONS } from '../../core/obstetric';
import { gaText, HINDI_TITLE } from '../../core/formf';

const BOX = '<rect x="0.7" y="0.7" width="10.6" height="10.6" fill="none" stroke="#000" stroke-width="1.2"/>';
const CB_ON = `<svg class="ff-cbx" viewBox="0 0 12 12" aria-hidden="true">${BOX}<path d="M2.4 6.2 5 8.8 9.8 3" fill="none" stroke="#000" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CB_OFF = `<svg class="ff-cbx" viewBox="0 0 12 12" aria-hidden="true">${BOX}</svg>`;
const NA = 'Not Applicable';

/** Built-in wording (keys are what "Edit Anything" stores overrides under). */
export const FF_TEXT = {
  'h.form': 'FORM F',
  'h.rule': '[See Provision to Section 4(3), Rule 9(4) and Rule 10(1A)]',
  'h.title': 'FORM FOR MAINTENANCE OF RECORD IN CASE OF PRENATAL DIAGNOSTIC TEST/PROCEDURE BY GENETIC CLINIC/ULTRASOUND CLINIC/IMAGING CENTRE',
  secA: 'Section A: To be Filled for all Diagnostic Procedures/Tests',
  l1: 'Name and address of the Genetic Clinic / Ultrasound Clinic / Imaging Centre:',
  l2: 'Registration Number (PCPNDT Act 1994):',
  l2sno: 'Reg. SNo:',
  l3: "Patient's name and her age:",
  l4: 'Total Number of living children:',
  l4a: '(a) No. of living sons with age of each:',
  l4b: '(b) No. of living daughters with age of each:',
  l6: 'Full Postal Address of patient with Tel No, if any:',
  l6id: 'Full ID Proof Address of Self:',
  l7a: '(a) Referred by (Full Name & Address of Doctor(s)/Genetic Counselling Centre):',
  l7b: '(b) Self Referral by Gynaecologist/Radiologist/RMP conducting the diagnostic procedures',
  l7bnote: '(Referral note with indications and case papers of the patient to be preserved with Form F) (Self Referral does not mean a client coming to a clinic & requesting for the test or the relatives requesting for the test of a pregnant woman)',
  secB: 'Section B: To be Filled for performing non-Invasive Diagnostic Procedures/Tests',
  l8: 'Last menstrual period / Weeks of Pregnancy:',
  l9: 'Name of Doctor(s) performing the Procedure(s):',
  l10: 'Indications for diagnostic procedure (Specify with reference to the request made in the referral slip or in a self referral note. Ultrasonography prenatal diagnosis during pregnancy should only be performed when indicated. The following is the representative list of indications for ultrasound during pregnancy. Put a Tick against the appropriate indication(s) for ultrasound):',
  l10note: '(Note: Ultrasound is not indicated/advised/performed to determine the sex of fetus except for diagnosis of sex linked diseases such as Duchenne muscular dystrophy, haemophilia A & B etc.)',
  l11: 'Procedures carried out (Non-Invasive) (Put a tick on appropriate procedure):',
  l12: 'Date on which declaration of pregnant woman/person was obtained:',
  l13: 'Date(s) on which procedures carried out:',
  l14: 'Result of the non-invasive procedure carried out (report in brief of the test including ultrasound carried out):',
  l15: 'The result of pre-natal diagnostic procedure were conveyed to:',
  l15on: 'On Date:',
  l16: 'Any Indication for MTP as per the abnormality detected in the diagnostic procedures/Tests:',
  date: 'Date:',
  place: 'Place:',
  sigCap: 'Name in Capital, Registration No with Seal of the Gynaecologist/Radiologist/Registered Medical Practitioner Conducting Diagnostic Procedure',
  secC: 'Section C: To be filled for performing invasive Procedures/Tests only:',
  l17: 'Name of the doctor(s) performing the procedure(s):',
  l18: 'History of genetic/medical disease in the family (specify):',
  l18b: 'Basis of Diagnosis: Tick on appropriate basis of diagnosis (a) Clinical (b) Bio-chemical (c) Cytogenetic (d) Other (radiological, usg etc specify):',
  l19: 'Indication for pre-natal diagnosis. Tick on appropriate indications:',
  l19A: 'A. Previous child/children with: (i) Chromosomal disorders (ii) Metabolic disorders (iii) Congenital anomaly (iv) Mental retardation (v) Haemoglobinopathy (vi) Sex linked disorders (vii) Single gene disorder (viii) Any other-specify:',
  l19B: 'B. Advanced maternal age (35 years):',
  l19C: 'C. Mother/father/sibling has genetic disease (specify):',
  l19D: 'D. Other (specify):',
  l20: 'Date on which consent of pregnant woman/person was obtained in Form G prescribed in PC&PNDT Act 1994:',
  l21: 'Invasive procedures carried. Tick on appropriate indications: (i) Amniocentesis (ii) Chorionic Villi aspiration (iii) Foetal biopsy (iv) Cordocentesis (v) Any other (specify):',
  l22: 'Any complication of invasive procedure - please specify:',
  l23: 'Additional Test recommended. Please mention if applicable: (i) Chromosomal studies (ii) Biochemical studies (iii) Molecular studies (iv) Preimplantation genetic diagnosis:',
  l24: 'Result of the Procedures/Tests carried out (report in brief of the invasive tests/procedures carried out):',
  l25: 'Date(s) on which procedures carried out:',
  l26: 'The result of pre-natal diagnostic procedure were conveyed to ... on ...:',
  l27: 'Any Indication for MTP as per the abnormality detected in the diagnostic procedures/Tests:',
  secD: 'Section D: Declaration',
  dPtHead: 'DECLARATION OF THE PERSON UNDERGOING PRENATAL DIAGNOSTIC TEST/PROCEDURE',
  dPtEn1: 'I,',
  dPtEn2: '(Name of the pregnant woman) declare that by undergoing ultrasonography / image scanning etc. I do not want to know the sex of my foetus.',
  dPtHi1: 'मैं',
  dPtHi2: '(गर्भवती महिला का नाम) घोषणा करती हूँ कि मैं सोनोग्राफी परीक्षण से अपने गर्भस्थ शिशु के लिंग पहचान नहीं करवाना चाहती हूँ।',
  dPtSig: 'Signature/Thumb impression of pregnant woman / गर्भवती महिला के हस्ताक्षर या अंगूठे का निशान',
  thHead: 'In Case of thumb Impression:',
  thName: 'Identified by Name:',
  thAge: 'Age & Sex:',
  thRel: 'Relation:',
  thAddr: 'Address & Contact No:',
  thDate: 'Date:',
  thSig: 'Signature of Person attesting Thumb impression',
  thBox: 'Thumb impression',
  dDrHead: 'DECLARATION OF DOCTOR/PERSON CONDUCTING PRENATAL DIAGNOSTIC PROCEDURE/TEST',
  dDr1: 'I,',
  dDr2: '(Name of the person conducting ultrasonography / image scanning) declare that while conducting ultrasonography / image scanning on',
  dDr3: '(Name of the Pregnant Woman), I have neither detected nor disclosed the sex of her foetus to anybody in any manner.',
  p2ref: 'Form F (continued) –'
};
FORM_F_INDICATIONS.forEach((t, i) => { FF_TEXT['ind' + (i + 1)] = t; });

const GUARDIAN_LABEL = { both: "Husband's / Father's Name:", husband: "Husband's Name:", father: "Father's Name:" };
export const isLayoutKey = (k) => !/^v/.test(k); // v* = record values; everything else is layout wording

/** Strip anything but plain text and simple emphasis from a contenteditable edit. */
export function cleanEdit(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  const walk = (node) => {
    let out = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) out += esc(n.nodeValue);
      else if (n.nodeType === 1) {
        const tag = n.tagName.toLowerCase();
        const inner = walk(n);
        if (tag === 'br') out += '<br>';
        else if (['b', 'strong', 'i', 'em', 'u'].includes(tag)) out += `<${tag}>${inner}</${tag}>`;
        else if (tag === 'div' || tag === 'p') out += (out ? '<br>' : '') + inner;
        else out += inner;
      }
    });
    return out;
  };
  return walk(tpl.content).replace(/(<br>)+$/, '');
}

export function formFHtml(rec, opts = {}) {
  const { settings, prefs = {}, edits = {}, editMode = false, pages = ['front', 'back'], interactive = false, signatureUrl = '' } = opts;
  const d = rec.data || {};
  const vis = Object.assign({ guardianLabel: 'both', showHindi: true, showPage2Ref: true, printSignature: false, showFrame: true, blankLines: true, showThumbBlock: true, showEddNextToLmp: true, showSelfReferralNote: true }, prefs.visibility || {});
  const ff = Object.assign({}, (settings && settings.formF) || {}, prefs);
  const ce = editMode ? ' contenteditable="true" spellcheck="false"' : '';
  const blank = vis.blankLines ? '<span class="ff-blank"></span>' : '—';
  const has = (k) => Object.prototype.hasOwnProperty.call(edits, k);
  // label / clause (layout wording)
  const L = (k, tag = 'span', cls = '') => `<${tag}${cls ? ` class="${cls}"` : ''} data-edit="${k}"${ce}>${has(k) ? edits[k] : esc(FF_TEXT[k] || '')}</${tag}>`;
  // value (bold); static values use s* keys, record values v* keys
  const V = (k, text, cls = 'ff-v') => `<b class="${cls}" data-edit="${k}"${ce}>${has(k) ? edits[k] : text === '' || text === null || text === undefined ? blank : esc(text)}</b>`;
  const dt = (k) => (k ? fmtDate(k) : '');
  const ptName = [d.patientTitle, d.patientName].filter(Boolean).join(' ');
  const hiName = (d.patientNameHindi ? (HINDI_TITLE[d.patientTitle] || 'श्रीमती') + ' ' + d.patientNameHindi : ptName);
  const clinic = ff.clinicText || '';
  const doctorCaps = ff.doctorCaps || '';
  const tick = (on) => (on ? CB_ON : CB_OFF);
  const item = (no, body) => `<div class="ff-item"><span class="ff-no">${no}</span><div>${body}</div></div>`;
  const kids = (n, ages, sex) => (n > 0 ? `${n} Live ${sex} ${n > 1 ? 'Children' : 'Child'}${ages ? ' (Age: ' + ages + ')' : ''}` : `0 Live ${sex} Child`);
  const sigBlock = (dateVal, keySuffix) => `
    <div class="ff-sign">
      <div class="l">
        <div>${L('date')} ${V('vDate' + keySuffix, dt(dateVal))}</div>
        <div class="pl">${L('place')} ${V('sPlace', clinic, 'ff-place')}</div>
      </div>
      <div class="r">
        <div class="sp">${vis.printSignature && signatureUrl ? `<img src="${esc(signatureUrl)}" alt="">` : ''}</div>
        <div class="nm" data-edit="sSig"${ce}>${has('sSig') ? edits.sSig : esc(doctorCaps)}</div>
        ${L('sigCap', 'div', 'cap')}
      </div>
    </div>`;
  const header = `
    <div class="ff-hd">
      ${L('h.form', 'div', 't1')}
      ${L('h.rule', 'div', 't2')}
      ${L('h.title', 'div', 't3')}
    </div>`;

  // ---------------------------------------------------------------- page 1 (front): Sections A & B
  let gaVal;
  if (d.lmpMode === 'usg') gaVal = 'Not Known / By USG: ' + (gaText(d) || '—');
  else gaVal = (d.lmp ? dt(d.lmp) : '') + (gaText(d) ? ' | GA: ' + gaText(d) : '');
  if (vis.showEddNextToLmp && d.edd) gaVal += ' (EDD: ' + dt(d.edd) + ')';
  const ind = d.indications || [];
  const indCell = (n) => `<div class="ff-indi${ind.includes(n) ? ' on' : ''}" data-ind="${n}">${tick(ind.includes(n))}<span class="n">${n}.</span>${L('ind' + n)}</div>`;
  const cells = FORM_F_INDICATIONS.map((_, i) => indCell(i + 1)).join('');
  const guardLabel = vis.guardianLabel === 'auto' ? GUARDIAN_LABEL[d.guardianRelation === 'Father' ? 'father' : 'husband'] : GUARDIAN_LABEL[vis.guardianLabel] || GUARDIAN_LABEL.both;
  const idLine = [d.idType || 'Aadhar Card', d.idNumber].filter(Boolean).join(': ');
  const front = `
  <div class="print-page ff-page${vis.showFrame ? ' ff-frame' : ''}" data-page="front">
    <div class="ff-inner" style="font-size:${Number(ff.fontPt) || 10.5}pt">
      ${header}
      ${L('secA', 'div', 'ff-sec')}
      ${item('1.', `${L('l1')} ${V('s1', clinic)}`)}
      ${item('2.', `${L('l2')} ${V('s2', ff.regNoText || '')} | <span class="ff-nowrap">${L('l2sno')} ${V('vSno', rec.snoLabel || '')}</span>.`)}
      ${item('3.', `${L('l3')} ${V('v3', ptName ? ptName + ', Age: ' + (d.age !== '' && d.age !== undefined ? d.age + ' Years' : '___') + (rec.snoLabel ? ' (Regn No: ' + rec.snoLabel + ')' : '') : '')}`)}
      ${item('4.', `${L('l4')} ${V('v4', d.totalChildren + ' ' + (Number(d.totalChildren) === 1 ? 'Child' : 'Children'))}
        <div class="ff-sub">${L('l4a')} ${V('v4a', kids(d.livingSons, d.sonsAges, 'Male'))}</div>
        <div class="ff-sub">${L('l4b')} ${V('v4b', kids(d.livingDaughters, d.daughtersAges, 'Female'))}</div>`)}
      ${item('5.', `<span data-edit="l5"${ce}>${has('l5') ? edits.l5 : esc(guardLabel)}</span> ${V('v5', d.husbandName)}`)}
      ${item('6.', `${L('l6')} ${V('v6', [d.address, d.mobile ? 'Phone ' + d.mobile : ''].filter(Boolean).join(' '))}
        <div>${L('l6id')} ${V('v6id', d.idAddress || '')} ${d.idNumber ? V('v6idn', '(' + idLine + ')') : vis.blankLines ? '(' + esc(d.idType || 'Aadhar Card') + ': ' + blank + ')' : ''}</div>`)}
      ${item('7.', `<div>${L('l7a')} ${V('v7a', [d.refDoctorName, d.refDoctorAddress].filter(Boolean).join(', '))}</div>
        <div>${L('l7b')}${vis.showSelfReferralNote ? ' ' + L('l7bnote') : ''}: <b class="ff-v" data-toggle="selfReferral" data-edit="v7b"${ce}>${has('v7b') ? edits.v7b : esc(d.selfReferral || 'NO')}</b>.</div>`)}
      ${L('secB', 'div', 'ff-sec')}
      ${item('8.', `${L('l8')} ${V('v8', gaVal)}`)}
      ${item('9.', `${L('l9')} ${V('s9', ff.doctorText || '')}`)}
      ${item('10.', `${L('l10')}
        <div class="ff-ind">${cells}</div>
        ${L('l10note', 'div', 'ff-note')}`)}
      ${item('11.', `${L('l11')} <span class="ff-nowrap${d.procUltrasound ? ' ff-v' : ''}" data-proc="us">${tick(d.procUltrasound)} (i) Ultrasound</span> | <span class="ff-nowrap${d.procOther ? ' ff-v' : ''}" data-proc="other">${tick(d.procOther)} (ii) Any Other:</span> ${d.procOther ? V('v11', d.procedureOther) : '<span data-edit="l11sp"' + ce + '>' + (has('l11sp') ? edits.l11sp : 'Specify') + '</span>'}.`)}
      ${item('12.', `${L('l12')} ${V('v12', dt(d.declarationDate))}`)}
      ${item('13.', `${L('l13')} ${V('v13', dt(d.procedureDate))}`)}
      ${item('14.', `${L('l14')} ${V('v14', d.result)}`)}
      ${item('15.', `${L('l15')} ${V('v15', d.resultConveyedTo)} ${L('l15on')} ${V('v15d', dt(d.conveyedDate))}`)}
      ${item('16.', `${L('l16')} <b class="ff-v" data-toggle="mtp" data-edit="v16"${ce}>${has('v16') ? edits.v16 : esc(d.mtp || 'NO')}</b>.`)}
      <div class="ff-spacer"></div>
      ${sigBlock(d.procedureDate, 'P1')}
    </div>
  </div>`;

  // ---------------------------------------------------------------- page 2 (back): Sections C & D
  const sc = d.sectionC || {};
  const cv = (k) => (d.sectionCUnlocked && String(sc[k] || '').trim() ? sc[k] : NA);
  const th = d.thumb || {};
  const thumb = d.signatureType === 'thumb';
  const thv = (k, key) => V(key, thumb ? th[k] || '' : NA);
  const back = `
  <div class="print-page ff-page${vis.showFrame ? ' ff-frame' : ''}" data-page="back">
    <div class="ff-inner" style="font-size:${Number(ff.fontPt) || 10.5}pt">
      ${header}
      ${vis.showPage2Ref ? `<div class="ff-ref"><span>${L('p2ref')} ${L('l2sno')} <b>${esc(rec.snoLabel || '—')}</b></span><span>${esc(ptName || '')}</span><span>${L('date')} <b>${esc(dt(d.procedureDate))}</b></span></div>` : ''}
      <div class="ff-sec">${L('secC')} ${V('vC', d.sectionCUnlocked ? '' : 'NOT APPLICABLE', 'ff-v ff-na')}</div>
      ${item('17.', `${L('l17')} ${V('vC17', cv('17'))}`)}
      ${item('18.', `${L('l18')} ${V('vC18', cv('18'))} | ${L('l18b')} ${V('vC18b', cv('18b'))}`)}
      ${item('19.', `${L('l19')} ${V('vC19', cv('19'))}
        <div class="ff-sub">${L('l19A')} ${V('vC19A', cv('19A'))}</div>
        <div class="ff-sub">${L('l19B')} ${V('vC19B', cv('19B'))}</div>
        <div class="ff-sub">${L('l19C')} ${V('vC19C', cv('19C'))}</div>
        <div class="ff-sub">${L('l19D')} ${V('vC19D', cv('19D'))}</div>`)}
      ${['20', '21', '22', '23', '24', '25', '26', '27'].map((n) => item(n + '.', `${L('l' + n)} ${V('vC' + n, cv(n))}`)).join('')}
      ${sigBlock(d.procedureDate, 'C')}
      ${L('secD', 'div', 'ff-sec')}
      ${L('dPtHead', 'div', 'ff-decl-h')}
      <div class="ff-decl">${L('dPtEn1')} ${V('vDName', ptName)} ${L('dPtEn2')}</div>
      ${vis.showHindi ? `<div class="ff-decl ff-hi">${L('dPtHi1')} ${V('vDNameHi', hiName)} ${L('dPtHi2')}</div>` : ''}
      <div class="ff-sign">
        <div class="l"><div>${L('date')} ${V('vDDate', dt(d.declarationDate))}</div></div>
        <div class="r">
          ${thumb ? `<div class="ff-tbox">${L('thBox')}</div>` : '<div class="sp"></div>'}
          <div class="nm">${V('vDName2', ptName, '')}</div>
          ${L('dPtSig', 'div', 'cap')}
        </div>
      </div>
      ${vis.showThumbBlock ? `
      <div class="ff-thumb">
        <div>${L('thHead', 'b')}</div>
        <div class="g">
          <div>${L('thName')} ${thv('name', 'vThName')}</div>
          <div>${L('thAge')} ${thv('ageSex', 'vThAge')}</div>
          <div>${L('thRel')} ${thv('relation', 'vThRel')}</div>
          <div>${L('thDate')} ${V('vThDate', thumb ? dt(th.date) : NA)}</div>
          <div class="span2">${L('thAddr')} ${thv('addressContact', 'vThAddr')}</div>
        </div>
        <div class="ff-thsig">${thumb ? '<span class="ff-blank" style="min-width:55mm"></span><br>' : ''}${L('thSig')}</div>
      </div>` : ''}
      ${L('dDrHead', 'div', 'ff-decl-h')}
      <div class="ff-decl">${L('dDr1')} ${V('sDrName', ff.doctorNameCaps || '')} ${L('dDr2')} ${V('vDName3', ptName)} ${L('dDr3')}</div>
      <div class="ff-spacer"></div>
      ${sigBlock(d.procedureDate, 'D')}
    </div>
  </div>`;

  const out = [];
  if (pages.includes('front')) out.push(front);
  if (pages.includes('back')) out.push(back);
  return `<div class="ff-doc${interactive ? ' ff-live' : ''}${editMode ? ' edit-mode' : ''}">${out.join('')}</div>`;
}

/** Largest base font (≤ preferred size) at which each page still fits its A4 sheet — binary search. */
/**
 * Shrink each page's text just enough to fit its A4 page (never below 7.5 pt), keeping a 3-px safety
 * margin so the printed page (a hair shorter than 297 mm, see styles) never clips the last line.
 * → number of pages whose text still does not fit at 7.5 pt (0 = everything fits).
 */
export function fitFormF(root, basePt = 10.5) {
  let over = 0;
  root.querySelectorAll('.ff-inner').forEach((inner) => {
    const spacer = inner.querySelector('.ff-spacer');
    // the flexible spacer absorbs free space, so "fits" = no overflow and at least 3 px of spacer left
    const fits = (pt) => {
      inner.style.fontSize = pt.toFixed(2) + 'pt';
      if (inner.scrollHeight > inner.clientHeight + 1) return false;
      return spacer ? spacer.offsetHeight >= 3 : inner.scrollHeight <= inner.clientHeight - 3;
    };
    let best = Number(basePt) || 10.5;
    if (!fits(best)) {
      let lo = 7.5;
      let hi = best;
      for (let i = 0; i < 8; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
      best = Math.floor(lo * 20) / 20;
    }
    inner.style.fontSize = best.toFixed(2) + 'pt';
    inner.dataset.fitPt = best.toFixed(2);
    const ok = inner.scrollHeight <= inner.clientHeight + 1;
    inner.dataset.overflow = ok ? '' : '1';
    if (!ok) over += 1;
  });
  return over;
}
