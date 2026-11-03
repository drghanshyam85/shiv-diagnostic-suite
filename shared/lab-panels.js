/*
 * Parameter-based pathology / biochemistry panels with reference intervals (adult M/F, child),
 * abnormal flagging (H / L / ABN) and auto-calculated indices.
 * Reference intervals are typical adult values used by Indian labs — verify against your
 * analyser kit inserts and edit here if your lab uses different ranges.
 */

const N = (id, name, unit, ref, o) => Object.assign({ id, name, unit, type: 'num', ref, dec: 1 }, o || {});
const S = (id, name, options, normal, o) => Object.assign({ id, name, type: 'select', options, normal, unit: '' }, o || {});
const T = (id, name, def, o) => Object.assign({ id, name, type: 'text', def: def || '', unit: '' }, o || {});
const H = (title) => ({ heading: title });

const NEG = ['Negative', 'Positive'];
const NR = ['Non-Reactive', 'Reactive'];
const WIDAL = ['<1:20', '1:20', '1:40', '1:80', '1:160', '1:320', '1:640'];

function egfr(creat, age, gender) {
  if (!creat || !age) return null;
  const f = gender === 'Female';
  const k = f ? 0.7 : 0.9;
  const a = f ? -0.241 : -0.302;
  const r = creat / k;
  return 142 * Math.pow(Math.min(r, 1), a) * Math.pow(Math.max(r, 1), -1.2) * Math.pow(0.9938, age) * (f ? 1.012 : 1);
}

const LAB_PANELS = {
  CBC: {
    id: 'CBC', title: 'COMPLETE BLOOD COUNT (CBC) WITH ESR', section: 'HAEMATOLOGY', sample: 'EDTA Whole Blood', method: '5-Part Automated Haematology Analyser',
    params: [
      H('Haemogram'),
      N('hb', 'Haemoglobin (Hb)', 'g/dL', { M: [13, 17], F: [12, 15], C: [11, 14.5] }, { method: 'SLS Photometry' }),
      N('rbc', 'Total RBC Count', 'million/cumm', { M: [4.5, 5.5], F: [3.8, 4.8], C: [4, 5.2] }, { dec: 2, method: 'Impedance' }),
      N('pcv', 'Haematocrit (PCV)', '%', { M: [40, 50], F: [36, 46], C: [35, 45] }),
      N('mcv', 'MCV', 'fL', { all: [83, 101] }, { calc: (v) => (v.pcv && v.rbc ? (v.pcv / v.rbc) * 10 : null), method: 'Calculated' }),
      N('mch', 'MCH', 'pg', { all: [27, 32] }, { calc: (v) => (v.hb && v.rbc ? (v.hb / v.rbc) * 10 : null), method: 'Calculated' }),
      N('mchc', 'MCHC', 'g/dL', { all: [31.5, 34.5] }, { calc: (v) => (v.hb && v.pcv ? (v.hb / v.pcv) * 100 : null), method: 'Calculated' }),
      N('rdw', 'RDW-CV', '%', { all: [11.6, 14] }),
      N('tlc', 'Total Leucocyte Count (TLC)', '/cumm', { all: [4000, 11000], C: [5000, 13000] }, { dec: 0 }),
      H('Differential Leucocyte Count'),
      N('neut', 'Neutrophils', '%', { all: [40, 80] }, { dec: 0 }),
      N('lymph', 'Lymphocytes', '%', { all: [20, 40] }, { dec: 0 }),
      N('mono', 'Monocytes', '%', { all: [2, 10] }, { dec: 0 }),
      N('eos', 'Eosinophils', '%', { all: [1, 6] }, { dec: 0 }),
      N('baso', 'Basophils', '%', { all: [0, 2] }, { dec: 0 }),
      H('Absolute Counts'),
      N('anc', 'Absolute Neutrophil Count', '/cumm', { all: [2000, 7000] }, { dec: 0, calc: (v) => (v.tlc && v.neut !== undefined ? (v.tlc * v.neut) / 100 : null), method: 'Calculated' }),
      N('alc', 'Absolute Lymphocyte Count', '/cumm', { all: [1000, 3000] }, { dec: 0, calc: (v) => (v.tlc && v.lymph !== undefined ? (v.tlc * v.lymph) / 100 : null), method: 'Calculated' }),
      N('aec', 'Absolute Eosinophil Count', '/cumm', { all: [20, 500] }, { dec: 0, calc: (v) => (v.tlc && v.eos !== undefined ? (v.tlc * v.eos) / 100 : null), method: 'Calculated' }),
      H('Platelets & ESR'),
      N('plt', 'Platelet Count', 'lakh/cumm', { all: [1.5, 4.1] }, { dec: 2 }),
      N('mpv', 'Mean Platelet Volume (MPV)', 'fL', { all: [7.5, 11.5] }),
      N('esr', 'ESR (Westergren)', 'mm/1st hr', { M: [0, 15], F: [0, 20] }, { dec: 0, method: 'Westergren' })
    ],
    check: (v) => {
      const keys = ['neut', 'lymph', 'mono', 'eos', 'baso'];
      if (!keys.every((k) => v[k] !== undefined && v[k] !== '')) return null;
      const s = keys.reduce((a, k) => a + Number(v[k] || 0), 0);
      return s === 100 ? null : 'DLC total is ' + s + '% (should be 100%)';
    }
  },
  HB: { id: 'HB', title: 'HAEMOGLOBIN', section: 'HAEMATOLOGY', sample: 'EDTA Whole Blood', params: [N('hb', 'Haemoglobin (Hb)', 'g/dL', { M: [13, 17], F: [12, 15], C: [11, 14.5] }, { method: 'SLS Photometry' })] },
  PBS: {
    id: 'PBS', title: 'PERIPHERAL BLOOD SMEAR EXAMINATION', section: 'HAEMATOLOGY', sample: 'EDTA Whole Blood (Leishman stain)',
    params: [T('rbcm', 'RBC Morphology', 'Predominantly normocytic normochromic RBCs.'), T('wbcm', 'WBC Morphology', 'Total count within normal limits. No immature cells seen.'), T('pltm', 'Platelets', 'Adequate on smear.'), T('para', 'Haemoparasites', 'Not seen.'), T('imp', 'Impression', 'Normocytic normochromic blood picture.')]
  },
  BG: { id: 'BG', title: 'BLOOD GROUPING & Rh TYPING', section: 'IMMUNOHAEMATOLOGY', sample: 'EDTA Whole Blood', method: 'Slide / Tube agglutination', params: [S('abo', 'ABO Group', ['A', 'B', 'AB', 'O'], null), S('rh', 'Rh (D) Type', ['Positive', 'Negative'], null)] },
  COOMBS: { id: 'COOMBS', title: 'COOMBS TEST', section: 'IMMUNOHAEMATOLOGY', sample: 'Clotted blood + EDTA', params: [S('dct', 'Direct Coombs Test (DCT)', NEG, ['Negative']), S('ict', 'Indirect Coombs Test (ICT)', NEG, ['Negative'])] },
  PT: {
    id: 'PT', title: 'PROTHROMBIN TIME WITH INR', section: 'COAGULATION', sample: '3.2% Sodium Citrate Plasma', method: 'Clot detection',
    params: [N('pt', 'Prothrombin Time (Patient)', 'seconds', { all: [11, 13.5] }), N('ptc', 'Prothrombin Time (Control)', 'seconds', null, { def: 12 }), N('isi', 'ISI of Thromboplastin', '', null, { def: 1, dec: 2 }), N('inr', 'INR', '', { all: [0.8, 1.2] }, { dec: 2, calc: (v) => (v.pt && v.ptc ? Math.pow(v.pt / v.ptc, v.isi || 1) : null), method: 'Calculated' })],
    note: 'Therapeutic INR on oral anticoagulants: 2.0 – 3.0 (mechanical valves 2.5 – 3.5).'
  },
  APTT: { id: 'APTT', title: 'ACTIVATED PARTIAL THROMBOPLASTIN TIME (APTT)', section: 'COAGULATION', sample: '3.2% Sodium Citrate Plasma', params: [N('aptt', 'APTT (Patient)', 'seconds', { all: [25, 35] }), N('apttc', 'APTT (Control)', 'seconds', null, { def: 30 })] },
  URINE: {
    id: 'URINE', title: 'URINE ROUTINE & MICROSCOPIC EXAMINATION', section: 'CLINICAL PATHOLOGY', sample: 'Midstream urine',
    params: [
      H('Physical Examination'),
      T('vol', 'Quantity', '20 ml'),
      S('col', 'Colour', ['Pale Yellow', 'Yellow', 'Dark Yellow', 'Amber', 'Red', 'Brown'], ['Pale Yellow', 'Yellow']),
      S('app', 'Appearance', ['Clear', 'Slightly Turbid', 'Turbid'], ['Clear']),
      N('sg', 'Specific Gravity', '', { all: [1.005, 1.03] }, { dec: 3 }),
      N('ph', 'Reaction (pH)', '', { all: [4.5, 8] }),
      H('Chemical Examination'),
      S('prot', 'Protein (Albumin)', ['Nil', 'Trace', '1+', '2+', '3+', '4+'], ['Nil']),
      S('glu', 'Sugar (Glucose)', ['Nil', 'Trace', '1+', '2+', '3+', '4+'], ['Nil']),
      S('ket', 'Ketone Bodies', ['Negative', 'Positive'], ['Negative']),
      S('bs', 'Bile Salts', ['Absent', 'Present'], ['Absent']),
      S('bp', 'Bile Pigments', ['Absent', 'Present'], ['Absent']),
      S('ubg', 'Urobilinogen', ['Normal', 'Increased'], ['Normal']),
      S('bld', 'Blood', ['Negative', 'Trace', 'Positive'], ['Negative']),
      S('nit', 'Nitrite', ['Negative', 'Positive'], ['Negative']),
      H('Microscopic Examination'),
      T('pus', 'Pus Cells', '2-3 /hpf', { normalText: /^(nil|0|0-[1-5]|1-[2-5]|2-[3-5]|3-[4-5]|[0-5])\b/i }),
      T('rbcs', 'RBCs', 'Nil /hpf', { normalText: /^(nil|0|0-[12])\b/i }),
      T('epi', 'Epithelial Cells', '1-2 /hpf'),
      T('cast', 'Casts', 'Nil', { normalText: /^nil|absent/i }),
      T('cry', 'Crystals', 'Nil', { normalText: /^nil|absent/i }),
      T('bact', 'Bacteria', 'Nil', { normalText: /^nil|absent/i }),
      T('oth', 'Others', 'Nil')
    ]
  },
  STOOL: {
    id: 'STOOL', title: 'STOOL ROUTINE, MICROSCOPY & OCCULT BLOOD', section: 'CLINICAL PATHOLOGY', sample: 'Fresh stool',
    params: [
      S('col', 'Colour', ['Brown', 'Yellow', 'Green', 'Black', 'Red', 'Clay'], ['Brown', 'Yellow']),
      S('cons', 'Consistency', ['Formed', 'Semi-formed', 'Loose', 'Watery'], ['Formed', 'Semi-formed']),
      S('muc', 'Mucus', ['Absent', 'Present'], ['Absent']),
      S('blood', 'Visible Blood', ['Absent', 'Present'], ['Absent']),
      T('ova', 'Ova', 'Not seen', { normalText: /not seen|nil|absent/i }),
      T('cyst', 'Cysts', 'Not seen', { normalText: /not seen|nil|absent/i }),
      T('pus', 'Pus Cells', '0-1 /hpf'),
      T('rbcs', 'RBCs', 'Nil'),
      S('obt', 'Occult Blood', ['Negative', 'Positive'], ['Negative'])
    ]
  },
  DENGUE: { id: 'DENGUE', title: 'DENGUE NS1 ANTIGEN & IgG / IgM ANTIBODIES', section: 'SEROLOGY', sample: 'Serum', method: 'Immunochromatography (Rapid card)', params: [S('ns1', 'Dengue NS1 Antigen', NEG, ['Negative']), S('igm', 'Dengue IgM Antibody', NEG, ['Negative']), S('igg', 'Dengue IgG Antibody', NEG, ['Negative'])], note: 'Rapid card test is a screening test; confirm positives by ELISA.' },
  MALARIA: { id: 'MALARIA', title: 'MALARIA ANTIGEN (Pf / Pv)', section: 'SEROLOGY', sample: 'EDTA Whole Blood', method: 'Immunochromatography', params: [S('pf', 'Plasmodium falciparum (HRP-2)', NEG, ['Negative']), S('pv', 'Plasmodium vivax (pLDH)', NEG, ['Negative'])] },
  WIDAL: {
    id: 'WIDAL', title: 'WIDAL TEST (Slide / Tube)', section: 'SEROLOGY', sample: 'Serum',
    params: [S('so', 'S. Typhi "O"', WIDAL, ['<1:20', '1:20', '1:40', '1:80']), S('sh', 'S. Typhi "H"', WIDAL, ['<1:20', '1:20', '1:40', '1:80']), S('sah', 'S. Paratyphi "AH"', WIDAL, ['<1:20', '1:20', '1:40', '1:80']), S('sbh', 'S. Paratyphi "BH"', WIDAL, ['<1:20', '1:20', '1:40', '1:80'])],
    note: 'Titres of 1:160 or more are significant in endemic areas. A rising titre in paired sera is diagnostic.'
  },
  TYPHIDOT: { id: 'TYPHIDOT', title: 'TYPHIDOT (Salmonella Typhi IgM)', section: 'SEROLOGY', sample: 'Serum', params: [S('igm', 'S. Typhi IgM', NEG, ['Negative'])] },
  SEMEN: {
    id: 'SEMEN', title: 'SEMEN ANALYSIS', section: 'CLINICAL PATHOLOGY', sample: 'Semen (abstinence 3–5 days)', method: 'WHO 6th Edition (2021)',
    params: [
      T('abst', 'Period of Abstinence', '3 days'), N('vol', 'Volume', 'ml', { all: [1.4, 6] }), T('liq', 'Liquefaction Time', 'Complete in 30 min'),
      N('ph', 'pH', '', { all: [7.2, 8] }), N('count', 'Sperm Concentration', 'million/ml', { all: [16, 250] }, { dec: 0 }),
      N('tmot', 'Total Motility (PR + NP)', '%', { all: [42, 100] }, { dec: 0 }), N('pmot', 'Progressive Motility (PR)', '%', { all: [30, 100] }, { dec: 0 }),
      N('morph', 'Normal Morphology', '%', { all: [4, 100] }, { dec: 0 }), T('pus', 'Pus Cells', '1-2 /hpf'), T('imp', 'Impression', 'Normozoospermia')
    ]
  },
  CYTO: { id: 'CYTO', title: 'CYTOPATHOLOGY REPORT', section: 'CYTOLOGY', sample: 'As received', params: [T('spec', 'Specimen', ''), T('site', 'Site / Clinical Details', ''), T('gross', 'Gross / Procedure', ''), T('micro', 'Microscopy', '', { multiline: true }), T('imp', 'Impression / Diagnosis', '', { multiline: true })] },
  SEROLOGY: { id: 'SEROLOGY', title: 'VIRAL MARKERS', section: 'SEROLOGY', sample: 'Serum', method: 'Immunochromatography / ELISA', params: [S('hiv', 'HIV I & II Antibodies', NR, ['Non-Reactive']), S('hbsag', 'HBsAg (Hepatitis B)', NR, ['Non-Reactive']), S('hcv', 'Anti-HCV Antibodies', NR, ['Non-Reactive']), S('vdrl', 'VDRL / RPR', NR, ['Non-Reactive'])], note: 'Reactive screening results must be confirmed by supplementary tests as per NACO guidelines.' },
  UPT: { id: 'UPT', title: 'URINE PREGNANCY TEST', section: 'CLINICAL PATHOLOGY', sample: 'Urine', method: 'Immunochromatography (hCG)', params: [S('upt', 'Urine hCG', NEG, null)] },
  BS_F: { id: 'BS_F', title: 'BLOOD SUGAR – FASTING', section: 'BIOCHEMISTRY', sample: 'Fluoride Plasma', method: 'GOD-POD', params: [N('fbs', 'Glucose Fasting', 'mg/dL', { all: [70, 100] }, { dec: 0 })], note: 'ADA: 100–125 mg/dL impaired fasting glucose; ≥126 mg/dL diabetes.' },
  BS_PP: { id: 'BS_PP', title: 'BLOOD SUGAR – POST PRANDIAL (2 hr)', section: 'BIOCHEMISTRY', sample: 'Fluoride Plasma', method: 'GOD-POD', params: [N('ppbs', 'Glucose Post Prandial (2 hr)', 'mg/dL', { all: [70, 140] }, { dec: 0 })] },
  BS_FPP: { id: 'BS_FPP', title: 'BLOOD SUGAR – FASTING & POST PRANDIAL', section: 'BIOCHEMISTRY', sample: 'Fluoride Plasma', method: 'GOD-POD', params: [N('fbs', 'Glucose Fasting', 'mg/dL', { all: [70, 100] }, { dec: 0 }), N('ppbs', 'Glucose Post Prandial (2 hr)', 'mg/dL', { all: [70, 140] }, { dec: 0 })], note: 'ADA: FPG ≥126 mg/dL or 2-hr PG ≥200 mg/dL suggests diabetes mellitus.' },
  BS_R: { id: 'BS_R', title: 'BLOOD SUGAR – RANDOM', section: 'BIOCHEMISTRY', sample: 'Fluoride Plasma', method: 'GOD-POD', params: [N('rbs', 'Glucose Random', 'mg/dL', { all: [70, 140] }, { dec: 0 })] },
  HBA1C: {
    id: 'HBA1C', title: 'GLYCATED HAEMOGLOBIN (HbA1c)', section: 'BIOCHEMISTRY', sample: 'EDTA Whole Blood', method: 'HPLC / Immunoturbidimetry (NGSP certified)',
    params: [N('a1c', 'HbA1c', '%', { all: [4, 5.6] }), N('eag', 'Estimated Average Glucose (eAG)', 'mg/dL', { all: [68, 114] }, { dec: 0, calc: (v) => (v.a1c ? 28.7 * v.a1c - 46.7 : null), method: 'Calculated (ADAG)' })],
    note: 'Non-diabetic: < 5.7 %   |   Pre-diabetes: 5.7 – 6.4 %   |   Diabetes: ≥ 6.5 %   |   Good control in diabetics: < 7.0 %'
  },
  LFT: {
    id: 'LFT', title: 'LIVER FUNCTION TEST (LFT)', section: 'BIOCHEMISTRY', sample: 'Serum',
    params: [
      N('tbil', 'Bilirubin – Total', 'mg/dL', { all: [0.3, 1.2] }, { dec: 2, method: 'Diazo' }),
      N('dbil', 'Bilirubin – Direct', 'mg/dL', { all: [0, 0.3] }, { dec: 2, method: 'Diazo' }),
      N('ibil', 'Bilirubin – Indirect', 'mg/dL', { all: [0.1, 1] }, { dec: 2, calc: (v) => (v.tbil !== undefined && v.dbil !== undefined ? v.tbil - v.dbil : null), method: 'Calculated' }),
      N('ast', 'SGOT / AST', 'U/L', { M: [0, 40], F: [0, 32] }, { dec: 0, method: 'IFCC without P5P' }),
      N('alt', 'SGPT / ALT', 'U/L', { M: [0, 41], F: [0, 33] }, { dec: 0, method: 'IFCC without P5P' }),
      N('alp', 'Alkaline Phosphatase', 'U/L', { all: [40, 129], C: [100, 390] }, { dec: 0, method: 'IFCC AMP' }),
      N('ggt', 'Gamma GT', 'U/L', { M: [8, 61], F: [5, 36] }, { dec: 0 }),
      N('tp', 'Total Protein', 'g/dL', { all: [6.4, 8.3] }, { method: 'Biuret' }),
      N('alb', 'Albumin', 'g/dL', { all: [3.5, 5.2] }, { method: 'BCG' }),
      N('glob', 'Globulin', 'g/dL', { all: [2, 3.5] }, { calc: (v) => (v.tp && v.alb ? v.tp - v.alb : null), method: 'Calculated' }),
      N('ag', 'A/G Ratio', '', { all: [1, 2.1] }, { dec: 2, calc: (v) => (v.tp && v.alb && v.tp - v.alb > 0 ? v.alb / (v.tp - v.alb) : null), method: 'Calculated' })
    ]
  },
  KFT: {
    id: 'KFT', title: 'KIDNEY / RENAL FUNCTION TEST (KFT)', section: 'BIOCHEMISTRY', sample: 'Serum',
    params: [
      N('urea', 'Blood Urea', 'mg/dL', { all: [17, 43] }, { dec: 0, method: 'Urease-GLDH' }),
      N('bun', 'Blood Urea Nitrogen (BUN)', 'mg/dL', { all: [8, 20] }, { calc: (v) => (v.urea ? v.urea / 2.14 : null), method: 'Calculated' }),
      N('creat', 'Serum Creatinine', 'mg/dL', { M: [0.7, 1.3], F: [0.55, 1.02], C: [0.3, 0.7] }, { dec: 2, method: 'Jaffe kinetic' }),
      N('egfr', 'eGFR (CKD-EPI 2021)', 'mL/min/1.73m²', { all: [90, 200] }, { dec: 0, calc: (v, p) => (p && p.ageYears >= 18 ? egfr(v.creat, p.ageYears, p.gender) : null), method: 'Calculated' }),
      N('bcr', 'BUN / Creatinine Ratio', '', { all: [10, 20] }, { calc: (v) => (v.urea && v.creat ? v.urea / 2.14 / v.creat : null), method: 'Calculated' }),
      N('ua', 'Uric Acid', 'mg/dL', { M: [3.5, 7.2], F: [2.6, 6] }, { method: 'Uricase' }),
      N('na', 'Sodium (Na⁺)', 'mmol/L', { all: [136, 145] }, { dec: 0, method: 'ISE' }),
      N('k', 'Potassium (K⁺)', 'mmol/L', { all: [3.5, 5.1] }, { method: 'ISE' }),
      N('cl', 'Chloride (Cl⁻)', 'mmol/L', { all: [98, 107] }, { dec: 0, method: 'ISE' }),
      N('ca', 'Calcium (Total)', 'mg/dL', { all: [8.6, 10.3] }, { method: 'Arsenazo III' })
    ],
    note: 'eGFR (CKD-EPI 2021, race-free) is reported for adults ≥ 18 years. CKD staging: G1 ≥90, G2 60–89, G3a 45–59, G3b 30–44, G4 15–29, G5 <15 mL/min/1.73m².'
  },
  LIPID: {
    id: 'LIPID', title: 'LIPID PROFILE', section: 'BIOCHEMISTRY', sample: 'Serum (12 hr fasting)',
    params: [
      N('tc', 'Total Cholesterol', 'mg/dL', { all: [0, 200] }, { dec: 0, method: 'CHOD-PAP' }),
      N('tg', 'Triglycerides', 'mg/dL', { all: [0, 150] }, { dec: 0, method: 'GPO-PAP' }),
      N('hdl', 'HDL Cholesterol', 'mg/dL', { M: [40, null], F: [50, null] }, { dec: 0, method: 'Direct' }),
      N('ldl', 'LDL Cholesterol', 'mg/dL', { all: [0, 100] }, { dec: 0, calc: (v) => (v.tc && v.hdl && v.tg && v.tg < 400 ? v.tc - v.hdl - v.tg / 5 : null), method: 'Calculated (Friedewald)' }),
      N('vldl', 'VLDL Cholesterol', 'mg/dL', { all: [2, 30] }, { dec: 0, calc: (v) => (v.tg ? v.tg / 5 : null), method: 'Calculated' }),
      N('nonhdl', 'Non-HDL Cholesterol', 'mg/dL', { all: [0, 130] }, { dec: 0, calc: (v) => (v.tc && v.hdl ? v.tc - v.hdl : null), method: 'Calculated' }),
      N('tchdl', 'Total Cholesterol / HDL Ratio', '', { all: [0, 5] }, { dec: 2, calc: (v) => (v.tc && v.hdl ? v.tc / v.hdl : null), method: 'Calculated' }),
      N('ldlhdl', 'LDL / HDL Ratio', '', { all: [0, 3.5] }, { dec: 2, calc: (v) => (v.tc && v.hdl && v.tg && v.tg < 400 ? (v.tc - v.hdl - v.tg / 5) / v.hdl : null), method: 'Calculated' })
    ],
    note: 'NCEP ATP-III: Total cholesterol desirable < 200; Triglycerides normal < 150; LDL optimal < 100 mg/dL. LDL is not calculated when TG ≥ 400 mg/dL.'
  },
  TFT: { id: 'TFT', title: 'THYROID PROFILE (T3, T4, TSH)', section: 'IMMUNOASSAY', sample: 'Serum', method: 'CLIA / ECLIA', params: [N('t3', 'Total T3 (Triiodothyronine)', 'ng/mL', { all: [0.8, 2] }, { dec: 2 }), N('t4', 'Total T4 (Thyroxine)', 'µg/dL', { all: [5.1, 14.1] }, { dec: 2 }), N('tsh', 'TSH (Ultrasensitive)', 'µIU/mL', { all: [0.27, 4.2] }, { dec: 2 })], note: 'Pregnancy (TSH, ATA): 1st trimester 0.1–2.5, 2nd 0.2–3.0, 3rd 0.3–3.0 µIU/mL.' },
  FTFT: { id: 'FTFT', title: 'FREE THYROID PROFILE (FT3, FT4, TSH)', section: 'IMMUNOASSAY', sample: 'Serum', method: 'CLIA / ECLIA', params: [N('ft3', 'Free T3', 'pg/mL', { all: [2, 4.4] }, { dec: 2 }), N('ft4', 'Free T4', 'ng/dL', { all: [0.93, 1.7] }, { dec: 2 }), N('tsh', 'TSH (Ultrasensitive)', 'µIU/mL', { all: [0.27, 4.2] }, { dec: 2 })] },
  TSH: { id: 'TSH', title: 'TSH (ULTRASENSITIVE)', section: 'IMMUNOASSAY', sample: 'Serum', method: 'CLIA / ECLIA', params: [N('tsh', 'TSH (Ultrasensitive)', 'µIU/mL', { all: [0.27, 4.2] }, { dec: 2 })] },
  VITD: { id: 'VITD', title: 'VITAMIN D (25-HYDROXY)', section: 'IMMUNOASSAY', sample: 'Serum', method: 'CLIA', params: [N('vitd', '25-OH Vitamin D (Total)', 'ng/mL', { all: [30, 100] })], note: 'Deficient < 20   |   Insufficient 20 – 29   |   Sufficient 30 – 100   |   Potential toxicity > 100 ng/mL' },
  B12: { id: 'B12', title: 'VITAMIN B12 (CYANOCOBALAMIN)', section: 'IMMUNOASSAY', sample: 'Serum', method: 'CLIA', params: [N('b12', 'Vitamin B12', 'pg/mL', { all: [211, 911] }, { dec: 0 })] },
  IRON: {
    id: 'IRON', title: 'IRON STUDIES WITH SERUM FERRITIN', section: 'BIOCHEMISTRY', sample: 'Serum (morning)',
    params: [N('iron', 'Serum Iron', 'µg/dL', { M: [65, 175], F: [50, 170] }, { dec: 0 }), N('tibc', 'Total Iron Binding Capacity (TIBC)', 'µg/dL', { all: [250, 450] }, { dec: 0 }), N('tsat', 'Transferrin Saturation', '%', { all: [20, 50] }, { dec: 0, calc: (v) => (v.iron && v.tibc ? (v.iron / v.tibc) * 100 : null), method: 'Calculated' }), N('ferr', 'Serum Ferritin', 'ng/mL', { M: [30, 400], F: [13, 150] }, { dec: 0, method: 'CLIA' })]
  },
  ELEC: { id: 'ELEC', title: 'SERUM ELECTROLYTES', section: 'BIOCHEMISTRY', sample: 'Serum', method: 'Ion Selective Electrode (ISE)', params: [N('na', 'Sodium (Na⁺)', 'mmol/L', { all: [136, 145] }, { dec: 0 }), N('k', 'Potassium (K⁺)', 'mmol/L', { all: [3.5, 5.1] }), N('cl', 'Chloride (Cl⁻)', 'mmol/L', { all: [98, 107] }, { dec: 0 })] },
  CA: { id: 'CA', title: 'SERUM CALCIUM', section: 'BIOCHEMISTRY', sample: 'Serum', method: 'Arsenazo III', params: [N('ca', 'Calcium (Total)', 'mg/dL', { all: [8.6, 10.3] })] },
  UA: { id: 'UA', title: 'SERUM URIC ACID', section: 'BIOCHEMISTRY', sample: 'Serum', method: 'Uricase-POD', params: [N('ua', 'Uric Acid', 'mg/dL', { M: [3.5, 7.2], F: [2.6, 6] })] },
  AMYLIP: { id: 'AMYLIP', title: 'SERUM AMYLASE & LIPASE', section: 'BIOCHEMISTRY', sample: 'Serum', params: [N('amy', 'Serum Amylase', 'U/L', { all: [28, 100] }, { dec: 0 }), N('lip', 'Serum Lipase', 'U/L', { all: [13, 60] }, { dec: 0 })], note: 'Lipase > 3× upper limit of normal supports acute pancreatitis in the appropriate clinical setting.' },
  CRP: { id: 'CRP', title: 'C-REACTIVE PROTEIN (QUANTITATIVE)', section: 'IMMUNOLOGY', sample: 'Serum', method: 'Immunoturbidimetry', params: [N('crp', 'CRP', 'mg/L', { all: [0, 6] })] },
  TROP: { id: 'TROP', title: 'TROPONIN-I', section: 'CARDIAC MARKERS', sample: 'Serum', method: 'CLIA / Rapid', params: [N('tropi', 'Troponin-I', 'ng/mL', { all: [0, 0.04] }, { dec: 3 })], note: 'Values above the 99th percentile URL with a rise/fall pattern support myocardial injury; correlate with ECG & clinical findings.' }
};

function patientCategory(p) {
  const years = p ? (p.ageUnit === 'Months' ? (p.age || 0) / 12 : p.ageUnit === 'Days' ? (p.age || 0) / 365 : Number(p.age) || 0) : 30;
  return { child: years < 12, gender: p && p.gender, ageYears: years };
}

function refFor(param, patient) {
  const r = param.ref;
  if (!r) return null;
  const c = patientCategory(patient);
  if (c.child && r.C) return r.C;
  if (c.gender === 'Female' && r.F) return r.F;
  if (c.gender === 'Male' && r.M) return r.M;
  return r.all || r.M || r.F || null;
}

function refText(param, patient) {
  if (param.type === 'select') return param.normal ? param.normal[0] : '';
  if (param.type === 'text') return '';
  const r = refFor(param, patient);
  if (!r) return '';
  const d = param.dec === undefined ? 1 : param.dec;
  const f = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(Math.max(0, Math.min(3, d))));
  if (r[0] !== null && r[1] !== null) return f(r[0]) + ' – ' + f(r[1]);
  if (r[0] !== null) return '> ' + f(r[0]);
  if (r[1] !== null) return '< ' + f(r[1]);
  return '';
}

/** 'H' | 'L' | 'ABN' | '' */
function flagFor(param, value, patient) {
  if (value === undefined || value === null || value === '') return '';
  if (param.type === 'num') {
    const v = Number(value);
    const r = refFor(param, patient);
    if (!r || Number.isNaN(v)) return '';
    if (r[0] !== null && v < r[0]) return 'L';
    if (r[1] !== null && v > r[1]) return 'H';
    return '';
  }
  if (param.type === 'select') return param.normal && !param.normal.includes(value) ? 'ABN' : '';
  if (param.type === 'text' && param.normalText) return param.normalText.test(String(value).trim()) ? '' : 'ABN';
  return '';
}

/** Apply calculated parameters; returns a new values object. */
function runCalcs(panel, values, patient) {
  const v = {};
  for (const [k, x] of Object.entries(values || {})) v[k] = x === '' || x === null || x === undefined ? undefined : (isNaN(Number(x)) ? x : Number(x));
  const pc = Object.assign({}, patient || {}, patientCategory(patient));
  const out = Object.assign({}, values);
  for (const prm of panel.params) {
    if (prm.heading) continue;
    if (prm.def !== undefined && (out[prm.id] === undefined || out[prm.id] === '')) { out[prm.id] = prm.def; v[prm.id] = typeof prm.def === 'number' ? prm.def : prm.def; }
    if (prm.calc) {
      const r = prm.calc(v, pc);
      if (r === null || r === undefined || !Number.isFinite(r)) { if (prm.calcOnly !== false) out[prm.id] = out[prm.id] && !prm.calc ? out[prm.id] : ''; }
      else { const d = prm.dec === undefined ? 1 : prm.dec; out[prm.id] = Number(r.toFixed(d)); v[prm.id] = out[prm.id]; }
    }
  }
  return out;
}

module.exports = { LAB_PANELS, refFor, refText, flagFor, runCalcs, patientCategory, egfr };
