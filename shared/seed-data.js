/*
 * Shared seed data for Shiv Sonography and Diagnostic Center.
 * Loaded by the server (first-run DB seeding) and by the browser (standalone mode).
 * Seeded documents use deterministic ids so the same record never duplicates across devices.
 */

const SEED_TIME = 1735689600000; // 2025-01-01 — seeded docs are always "older" than any user edit

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------
const DEPARTMENTS = [
  { key: 'Ultrasound', prefix: 'USG', start: 1, token: 'USG', share: 'USG', label: 'Ultrasound (USG & Color Doppler)', color: 'cyan' },
  { key: 'Pathology', prefix: 'PATH', start: 101, token: 'LAB', share: 'LAB', label: 'Pathology', color: 'rose' },
  { key: 'Biochemistry', prefix: 'BIO', start: 201, token: 'LAB', share: 'LAB', label: 'Biochemistry', color: 'amber' },
  { key: 'X-Ray', prefix: 'XRAY', start: 301, token: 'XRAY', share: 'XRAY', label: 'X-Ray (Radiology)', color: 'indigo' },
  { key: 'ECG', prefix: 'ECG', start: 401, token: 'ECG', share: 'ECG', label: 'ECG (Electrocardiography)', color: 'emerald' },
  { key: 'Echo', prefix: 'ECHO', start: 501, token: 'ECHO', share: 'ECG', label: 'Echo (2D Echo & Cardiac Doppler)', color: 'violet' }
];

const TOKEN_MODALITIES = ['USG', 'LAB', 'XRAY', 'ECG', 'ECHO'];

// ---------------------------------------------------------------------------
// Master investigation / tariff list (80 tests)
// ---------------------------------------------------------------------------
const r50 = (n) => Math.round(n / 50) * 50;
const r10 = (n) => Math.round(n / 10) * 10;

function t(code, name, shortName, department, rate, description, tat, o) {
  o = o || {};
  return {
    id: 't_' + code.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    code,
    name,
    shortName,
    department,
    description,
    tariff: {
      standardRate: rate,
      emergencyRate: o.em || r50(rate * 1.3),
      b2bRate: o.b2b || r10(rate * 0.8),
      cghsRate: o.cghs || r10(rate * 0.65)
    },
    tat,
    isFrequent: !!o.freq,
    isActive: true,
    isObstetric: !!o.obs,
    isDoppler: !!o.dop,
    labPanel: o.panel || null,
    templateKey: o.tpl || null,
    updatedAt: SEED_TIME
  };
}

const FAST = 'Overnight / 6–8 hours fasting required (plain water allowed).';
const FULLB = 'Full bladder required – drink 4–5 glasses of water 1 hour before the scan and do not pass urine.';
const IMM = 'Immediate / 30 Mins';
const SAME = 'Same Day 4 Hours';
const NEXT = 'Next Day';

const TESTS = [
  // ---- Ultrasound -------------------------------------------------------
  t('USG-001', 'USG Whole Abdomen', 'W/A', 'Ultrasound', 800, FAST + ' ' + FULLB, IMM, { freq: 1, tpl: 'abd_whole', cghs: 540 }),
  t('USG-002', 'USG Upper Abdomen', 'U/A', 'Ultrasound', 600, FAST, IMM, { tpl: 'abd_upper', cghs: 420 }),
  t('USG-003', 'USG KUB & Pelvis', 'KUB', 'Ultrasound', 700, FULLB, IMM, { freq: 1, tpl: 'kub', cghs: 470 }),
  t('USG-004', 'USG Pelvis / Gynae', 'PELVIS', 'Ultrasound', 600, FULLB, IMM, { freq: 1, tpl: 'pelvis', cghs: 420 }),
  t('USG-005', 'Early Pregnancy / Viability Scan', 'EPS', 'Ultrasound', 700, FULLB + ' Bring previous reports & LMP details.', IMM, { obs: 1, freq: 1, tpl: 'obs_early', cghs: 470 }),
  t('USG-006', 'USG Obstetric / Routine ANC Scan', 'ANC', 'Ultrasound', 700, 'Moderately full bladder. Bring ANC card, previous scans & LMP details.', IMM, { obs: 1, freq: 1, tpl: 'obs_growth', cghs: 470 }),
  t('USG-007', 'NT/NB Scan (11–13.6 wks)', 'NT', 'Ultrasound', 1500, 'Moderately full bladder. Ideal window 11+0 to 13+6 weeks.', IMM, { obs: 1, tpl: 'obs_nt', cghs: 950 }),
  t('USG-008', 'TIFFA / Anomaly Scan (Level II)', 'TIFFA', 'Ultrasound', 2500, 'Ideal at 18–22 weeks. No preparation; bring previous scans.', 'Same Day 1 Hour', { obs: 1, freq: 1, tpl: 'obs_tiffa', cghs: 1500 }),
  t('USG-009', 'Obstetric Growth Scan with Biophysical Profile', 'GROWTH/BPP', 'Ultrasound', 1200, 'No preparation. Have a light meal before the scan.', IMM, { obs: 1, tpl: 'obs_growth', cghs: 800 }),
  t('USG-010', 'Obstetric Color Doppler', 'OBS DOP', 'Ultrasound', 1800, 'No preparation. Bring previous scans.', 'Same Day 1 Hour', { obs: 1, dop: 1, tpl: 'obs_doppler', cghs: 1100 }),
  t('USG-011', 'Follicular Study – Baseline', 'FOLL-B', 'Ultrasound', 500, 'Day 2–3 of the cycle. Empty bladder for TVS.', IMM, { tpl: 'follicular', cghs: 350 }),
  t('USG-012', 'Follicular Study – Serial (Package)', 'FOLL-S', 'Ultrasound', 1500, 'Serial scans from Day 9 as advised. Empty bladder for TVS.', IMM, { tpl: 'follicular', cghs: 1000 }),
  t('USG-013', 'USG Breast (Bilateral)', 'BREAST', 'Ultrasound', 1200, 'No preparation. Bring previous mammogram/USG.', IMM, { tpl: 'breast', cghs: 750 }),
  t('USG-014', 'USG Thyroid / Neck', 'THY', 'Ultrasound', 900, 'No preparation.', IMM, { tpl: 'thyroid', cghs: 560 }),
  t('USG-015', 'USG Scrotum with Doppler', 'SCROTUM', 'Ultrasound', 1500, 'No preparation.', IMM, { dop: 1, tpl: 'scrotum', cghs: 950 }),
  t('USG-016', 'Carotid Doppler (Bilateral)', 'CAROTID', 'Ultrasound', 2500, 'No preparation. Wear an open-neck shirt.', 'Same Day 1 Hour', { dop: 1, tpl: 'carotid', cghs: 1500 }),
  t('USG-017', 'Renal Artery Doppler', 'RAD', 'Ultrasound', 2500, FAST, 'Same Day 1 Hour', { dop: 1, tpl: 'renal_doppler', cghs: 1500 }),
  t('USG-018', 'Bilateral Lower Limb Arterial Doppler', 'LL ART', 'Ultrasound', 3500, 'No preparation. Wear loose clothing.', 'Same Day 1 Hour', { dop: 1, tpl: 'll_arterial', cghs: 2000 }),
  t('USG-019', 'Bilateral Lower Limb Venous Doppler', 'LL VEN', 'Ultrasound', 3500, 'No preparation. Wear loose clothing.', 'Same Day 1 Hour', { dop: 1, tpl: 'll_venous', cghs: 2000 }),
  t('USG-020', 'TVS – Transvaginal Sonography', 'TVS', 'Ultrasound', 800, 'Empty bladder required before the scan.', IMM, { tpl: 'tvs', cghs: 520 }),
  t('USG-021', 'TRUS – Transrectal Ultrasound (Prostate)', 'TRUS', 'Ultrasound', 1200, 'Bowel preparation / enema as advised.', IMM, { tpl: 'trus', cghs: 780 }),
  t('USG-022', 'USG Local Part / Soft Tissue', 'LOCAL', 'Ultrasound', 600, 'No preparation.', IMM, { tpl: 'local_part', cghs: 400 }),
  t('USG-023', 'USG MSK – Shoulder / Joint', 'MSK', 'Ultrasound', 1200, 'No preparation. Wear loose clothing.', IMM, { tpl: 'msk_shoulder', cghs: 780 }),
  t('USG-024', '3D/4D Pelvic Ultrasound (GE Voluson S10)', '3D PELVIS', 'Ultrasound', 2000, 'Empty bladder for TVS. Preferably in luteal phase for Mullerian anomalies.', 'Same Day 1 Hour', { tpl: 'pelvis_3d', cghs: 1300 }),
  t('USG-025', 'Neurosonogram (Neonatal Cranial)', 'NSG', 'Ultrasound', 1200, 'Feed the baby before the scan.', IMM, { tpl: 'neurosono', cghs: 780 }),
  t('USG-026', 'Fetal Echocardiography', 'F-ECHO', 'Ultrasound', 2500, 'Ideal at 20–24 weeks. No preparation.', 'Same Day 1 Hour', { obs: 1, dop: 1, tpl: 'fetal_echo', cghs: 1500 }),

  // ---- Pathology --------------------------------------------------------
  t('PATH-101', 'CBC with ESR', 'CBC', 'Pathology', 350, '2 ml EDTA whole blood. No fasting required.', SAME, { freq: 1, panel: 'CBC', cghs: 150 }),
  t('PATH-102', 'Hemoglobin (Hb)', 'Hb', 'Pathology', 100, '2 ml EDTA whole blood.', SAME, { panel: 'HB', cghs: 50 }),
  t('PATH-103', 'Peripheral Blood Smear', 'PBS', 'Pathology', 200, '2 ml EDTA whole blood.', SAME, { panel: 'PBS', cghs: 100 }),
  t('PATH-104', 'Blood Grouping & Rh Typing', 'BG', 'Pathology', 100, '2 ml EDTA whole blood.', 'Immediate / 30 Mins', { freq: 1, panel: 'BG', cghs: 50 }),
  t('PATH-105', 'Coombs Test (Direct / Indirect)', 'DCT/ICT', 'Pathology', 450, '3 ml clotted blood + 2 ml EDTA.', SAME, { panel: 'COOMBS', cghs: 250 }),
  t('PATH-106', 'PT with INR', 'PT/INR', 'Pathology', 400, '2.7 ml citrated blood (blue top). Inform about anticoagulants.', SAME, { panel: 'PT', cghs: 200 }),
  t('PATH-107', 'APTT', 'APTT', 'Pathology', 450, '2.7 ml citrated blood (blue top).', SAME, { panel: 'APTT', cghs: 250 }),
  t('PATH-108', 'Urine Routine & Microscopy', 'Urine R/M', 'Pathology', 150, 'Early-morning midstream urine in a sterile container.', SAME, { freq: 1, panel: 'URINE', cghs: 70 }),
  t('PATH-109', 'Stool R/M & Occult Blood', 'STOOL', 'Pathology', 250, 'Fresh stool sample in a clean container.', SAME, { panel: 'STOOL', cghs: 120 }),
  t('PATH-110', 'Dengue NS1 Ag & IgG/IgM', 'DENGUE', 'Pathology', 1200, '3 ml clotted blood. No fasting.', SAME, { panel: 'DENGUE', cghs: 600 }),
  t('PATH-111', 'Malaria Antigen (Pf/Pv)', 'MP', 'Pathology', 350, '2 ml EDTA whole blood.', 'Immediate / 30 Mins', { panel: 'MALARIA', cghs: 200 }),
  t('PATH-112', 'Typhoid – Widal Test', 'WIDAL', 'Pathology', 200, '3 ml clotted blood.', SAME, { panel: 'WIDAL', cghs: 100 }),
  t('PATH-113', 'Typhidot IgM', 'TYPHIDOT', 'Pathology', 450, '3 ml clotted blood.', SAME, { panel: 'TYPHIDOT', cghs: 250 }),
  t('PATH-114', 'Semen Analysis', 'SEMEN', 'Pathology', 400, '3–5 days of abstinence. Collect in the sterile container at the centre.', SAME, { panel: 'SEMEN', cghs: 200 }),
  t('PATH-115', 'FNAC', 'FNAC', 'Pathology', 1200, 'Appointment required. Bring USG report of the swelling.', '48 Hours', { panel: 'CYTO', cghs: 700 }),
  t('PATH-116', 'Pap Smear', 'PAP', 'Pathology', 600, 'Avoid intercourse, douching & vaginal medicines 48 hrs before; not during menses.', '48 Hours', { panel: 'CYTO', cghs: 350 }),
  t('PATH-117', 'Viral Markers (HIV, HBsAg, HCV, VDRL)', 'VIRAL', 'Pathology', 800, '3 ml clotted blood. Pre-test counselling & consent.', SAME, { panel: 'SEROLOGY', cghs: 450 }),
  t('PATH-118', 'Urine Pregnancy Test', 'UPT', 'Pathology', 100, 'Early-morning urine sample preferred.', 'Immediate / 30 Mins', { panel: 'UPT', cghs: 50 }),

  // ---- Biochemistry -----------------------------------------------------
  t('BIO-201', 'Blood Sugar Fasting', 'FBS', 'Biochemistry', 80, '8–10 hours fasting. Fluoride (grey top) sample.', SAME, { panel: 'BS_F', cghs: 40 }),
  t('BIO-202', 'Blood Sugar Post Prandial', 'PPBS', 'Biochemistry', 80, 'Sample exactly 2 hours after a normal meal.', SAME, { panel: 'BS_PP', cghs: 40 }),
  t('BIO-203', 'Blood Sugar Fasting & PP', 'FBS/PPBS', 'Biochemistry', 140, '8–10 hours fasting; second sample 2 hours after meal.', SAME, { freq: 1, panel: 'BS_FPP', cghs: 80 }),
  t('BIO-204', 'Random Blood Sugar', 'RBS', 'Biochemistry', 70, 'No preparation.', 'Immediate / 30 Mins', { panel: 'BS_R', cghs: 40 }),
  t('BIO-205', 'HbA1c (Glycated Hemoglobin)', 'HbA1c', 'Biochemistry', 500, '2 ml EDTA whole blood. No fasting required.', SAME, { freq: 1, panel: 'HBA1C', cghs: 250 }),
  t('BIO-206', 'Liver Function Test', 'LFT', 'Biochemistry', 600, 'Preferably 8–10 hours fasting. 3 ml clotted blood.', SAME, { freq: 1, panel: 'LFT', cghs: 300 }),
  t('BIO-207', 'Kidney / Renal Function Test', 'KFT/RFT', 'Biochemistry', 600, '3 ml clotted blood. No fasting required.', SAME, { freq: 1, panel: 'KFT', cghs: 300 }),
  t('BIO-208', 'Lipid Profile', 'LIPID', 'Biochemistry', 600, '10–12 hours overnight fasting. Avoid fatty meal & alcohol the night before.', SAME, { freq: 1, panel: 'LIPID', cghs: 300 }),
  t('BIO-209', 'Thyroid Profile (T3, T4, TSH)', 'TFT', 'Biochemistry', 550, 'No fasting. Give sample before the morning thyroid tablet.', SAME, { freq: 1, panel: 'TFT', cghs: 300 }),
  t('BIO-210', 'Free Thyroid Profile (FT3, FT4, TSH)', 'FTFT', 'Biochemistry', 750, 'No fasting. Give sample before the morning thyroid tablet.', SAME, { panel: 'FTFT', cghs: 400 }),
  t('BIO-211', 'Vitamin D (25-OH)', 'VIT D', 'Biochemistry', 1200, '3 ml clotted blood. No fasting.', NEXT, { panel: 'VITD', cghs: 700 }),
  t('BIO-212', 'Vitamin B12', 'B12', 'Biochemistry', 900, '3 ml clotted blood. Preferably fasting.', NEXT, { panel: 'B12', cghs: 500 }),
  t('BIO-213', 'Serum Ferritin & Iron Studies', 'IRON', 'Biochemistry', 1300, 'Morning fasting sample preferred. Stop iron tablets 24 hrs before.', NEXT, { panel: 'IRON', cghs: 700 }),
  t('BIO-214', 'Serum Electrolytes (Na, K, Cl)', 'ELEC', 'Biochemistry', 450, '3 ml clotted blood.', SAME, { panel: 'ELEC', cghs: 250 }),
  t('BIO-215', 'Serum Calcium', 'CA', 'Biochemistry', 200, '3 ml clotted blood.', SAME, { panel: 'CA', cghs: 100 }),
  t('BIO-216', 'Serum Uric Acid', 'UA', 'Biochemistry', 150, '3 ml clotted blood.', SAME, { panel: 'UA', cghs: 80 }),
  t('BIO-217', 'Serum Amylase & Lipase', 'AMY/LIP', 'Biochemistry', 900, '3 ml clotted blood.', SAME, { panel: 'AMYLIP', cghs: 500 }),
  t('BIO-218', 'CRP (Quantitative)', 'CRP', 'Biochemistry', 450, '3 ml clotted blood.', SAME, { panel: 'CRP', cghs: 250 }),
  t('BIO-219', 'Troponin-I', 'TROP-I', 'Biochemistry', 900, '3 ml clotted blood. Emergency test.', 'Immediate / 30 Mins', { panel: 'TROP', cghs: 500 }),
  t('BIO-220', 'TSH (Ultrasensitive)', 'TSH', 'Biochemistry', 300, 'No fasting required.', SAME, { panel: 'TSH', cghs: 150 }),

  // ---- X-Ray --------------------------------------------------------------
  t('XRAY-301', 'Digital X-Ray Chest PA View', 'CXR', 'X-Ray', 350, 'Remove metallic objects & jewellery. Inform staff if pregnant.', IMM, { freq: 1, tpl: 'xr_chest', cghs: 200 }),
  t('XRAY-302', 'X-Ray KUB', 'XKUB', 'X-Ray', 350, 'Light diet the previous night; laxative if advised. Inform if pregnant.', IMM, { tpl: 'xr_kub', cghs: 200 }),
  t('XRAY-303', 'X-Ray Cervical Spine (AP/Lat)', 'C-SPINE', 'X-Ray', 600, 'Remove neck chains & earrings. Inform if pregnant.', IMM, { tpl: 'xr_cspine', cghs: 340 }),
  t('XRAY-304', 'X-Ray Lumbo-Sacral Spine (AP/Lat)', 'LS SPINE', 'X-Ray', 650, 'Remove metallic objects. Inform if pregnant.', IMM, { tpl: 'xr_lsspine', cghs: 380 }),
  t('XRAY-305', 'X-Ray Knee Joint (Bilateral AP/Lat)', 'KNEE', 'X-Ray', 800, 'Wear loose clothing.', IMM, { tpl: 'xr_knee', cghs: 460 }),
  t('XRAY-306', 'X-Ray Shoulder (AP)', 'SHOULDER', 'X-Ray', 400, 'Remove metallic objects.', IMM, { tpl: 'xr_shoulder', cghs: 230 }),
  t('XRAY-307', 'X-Ray Pelvis with Both Hips', 'PBH', 'X-Ray', 450, 'Inform staff if pregnant.', IMM, { tpl: 'xr_pbh', cghs: 260 }),
  t('XRAY-308', "X-Ray PNS (Water's View)", 'PNS', 'X-Ray', 350, 'Remove spectacles, earrings & hair clips.', IMM, { tpl: 'xr_pns', cghs: 200 }),
  t('XRAY-309', 'HSG – Hysterosalpingography', 'HSG', 'X-Ray', 3500, 'Day 7–10 of the menstrual cycle. Avoid intercourse after periods till the test. Appointment required.', SAME, { tpl: 'xr_hsg', cghs: 2000 }),
  t('XRAY-310', 'IVP – Intravenous Pyelography', 'IVP', 'X-Ray', 3000, 'Overnight fasting, laxative the previous night, serum creatinine report mandatory.', SAME, { tpl: 'xr_ivp', cghs: 1800 }),
  t('XRAY-311', 'X-Ray Hand / Wrist / Ankle / Foot (Single Part)', 'XR LIMB', 'X-Ray', 350, 'Remove rings, bangles & anklets.', IMM, { tpl: 'xr_limb', cghs: 200 }),

  // ---- ECG ----------------------------------------------------------------
  t('ECG-401', '12-Lead Resting Computerized ECG', 'ECG', 'ECG', 250, 'Rest for 5 minutes before the test. Wear loose clothing.', 'Immediate / 15 Mins', { freq: 1, tpl: 'ecg_normal', cghs: 120 }),
  t('ECG-402', 'ECG with Rhythm Strip (Lead II Long)', 'ECG-RS', 'ECG', 300, 'Rest for 5 minutes before the test.', 'Immediate / 15 Mins', { tpl: 'ecg_normal', cghs: 150 }),

  // ---- Echo ---------------------------------------------------------------
  t('ECHO-501', '2D Echocardiography with Color Doppler', '2D ECHO', 'Echo', 1800, 'No preparation. Bring previous ECG/Echo reports.', IMM, { freq: 1, tpl: 'echo_normal', cghs: 1100 }),
  t('ECHO-502', 'Pediatric 2D Echo', 'PED ECHO', 'Echo', 2200, 'Child should be calm/asleep; feed before the test.', IMM, { tpl: 'echo_normal', cghs: 1300 }),
  t('ECHO-503', 'Stress Echo', 'STRESS ECHO', 'Echo', 3500, '4 hours fasting. Stop beta-blockers only if advised by your physician. Appointment required.', 'Same Day 1 Hour', { cghs: 2000 })
];

// ---------------------------------------------------------------------------
// Referring doctors
// ---------------------------------------------------------------------------
function d(id, name, qualification, speciality, clinic, address, phone, shares) {
  return { id, name, qualification, speciality, clinic, address, phone, email: '', shares, active: true, updatedAt: SEED_TIME };
}
const DOCTORS = [
  d('doc_01', 'Dr. Ramesh Sharma', 'MBBS, MD (Medicine)', 'MD Medicine', 'Sharma Clinic', 'Main Market, Phulera, Jaipur', '9000010001', { USG: 30, LAB: 25, XRAY: 20, ECG: 20 }),
  d('doc_02', 'Dr. Sunita Agarwal', 'MBBS, MS (Obs & Gynae)', 'OB-GYN', 'Agarwal Maternity Home', 'Station Road, Phulera, Jaipur', '9000010002', { USG: 25, LAB: 20, XRAY: 15, ECG: 15 }),
  d('doc_03', 'Dr. Mahesh Choudhary', 'MBBS', 'General Physician', 'SDH Phulera (Govt.)', 'Sub District Hospital, Phulera', '9000010003', { USG: 20, LAB: 20, XRAY: 20, ECG: 15 }),
  d('doc_04', 'Dr. Kavita Jain', 'MBBS, DGO', 'OB-GYN', 'Jain Nursing Home', 'Sambhar Lake, Jaipur', '9000010004', { USG: 25, LAB: 20, XRAY: 15, ECG: 15 }),
  d('doc_05', 'Dr. Anil Gupta', 'MBBS, MS (Ortho)', 'Orthopedics', 'Gupta Ortho Care', 'Jobner, Jaipur', '9000010005', { USG: 20, LAB: 15, XRAY: 30, ECG: 10 }),
  d('doc_06', 'Dr. Pradeep Saini', 'MBBS, MD (Pediatrics)', 'Pediatrics', 'Saini Child Clinic', 'Narena Road, Phulera', '9000010006', { USG: 25, LAB: 25, XRAY: 20, ECG: 10 }),
  d('doc_07', 'Dr. Neha Verma', 'MBBS, MS (Obs & Gynae)', 'OB-GYN', 'Shree Hospital', 'Renwal, Jaipur', '9000010007', { USG: 25, LAB: 20, XRAY: 15, ECG: 15 }),
  d('doc_08', 'Dr. Vikram Singh Shekhawat', 'MBBS', 'General Physician', 'Shekhawat Clinic', 'Narena, Jaipur', '9000010008', { USG: 30, LAB: 25, XRAY: 25, ECG: 20 }),
  d('doc_09', 'Dr. Suresh Yadav', 'MBBS, MD (Medicine)', 'MD Medicine', 'Yadav Hospital', 'Dudu, Jaipur', '9000010009', { USG: 25, LAB: 20, XRAY: 20, ECG: 20 }),
  d('doc_10', 'Dr. Pooja Meena', 'MBBS, DGO', 'OB-GYN', 'CHC Sambhar', 'Community Health Centre, Sambhar', '9000010010', { USG: 20, LAB: 15, XRAY: 15, ECG: 10 })
];

// ---------------------------------------------------------------------------
// Returning patients
// ---------------------------------------------------------------------------
function p(n, title, name, relation, guardianName, age, gender, mobile, address, extra) {
  return Object.assign({
    id: 'pat_demo_' + n,
    regId: 'SSDC-P-' + String(n).padStart(6, '0'),
    title, name, nameHindi: '', relation, guardianName,
    age, ageUnit: 'Years', gender, mobile, email: '', address,
    idType: 'Aadhaar Card', aadhaar: '', idVerified: false,
    referredBy: '', createdAt: SEED_TIME, updatedAt: SEED_TIME
  }, extra || {});
}
const PATIENTS = [
  p(1, 'Mrs.', 'Sunita Devi', 'W/O', 'Ramesh Kumar', 28, 'Female', '9000020001', 'Ward 12, Phulera, Jaipur', { nameHindi: 'सुनीता देवी', aadhaar: '400012345678', referredBy: 'doc_02' }),
  p(2, 'Mr.', 'Mahendra Singh', 'S/O', 'Bhanwar Singh', 45, 'Male', '9000020002', 'Jobner Road, Phulera, Jaipur', { referredBy: 'doc_01' }),
  p(3, 'Mrs.', 'Priya Sharma', 'W/O', 'Amit Sharma', 32, 'Female', '9000020003', 'Sambhar Lake, Jaipur', { nameHindi: 'प्रिया शर्मा', referredBy: 'doc_04' }),
  p(4, 'Master', 'Arjun Yadav', 'S/O', 'Rajesh Yadav', 9, 'Male', '9000020004', 'Narena, Jaipur', { referredBy: 'doc_06' }),
  p(5, 'Smt.', 'Kamla Devi', 'W/O', 'Late Mohan Lal', 62, 'Female', '9000020005', 'Hirnoda, Phulera, Jaipur', { nameHindi: 'कमला देवी', referredBy: 'doc_09' })
];

// ---------------------------------------------------------------------------
// Staff / users (RBAC)
// ---------------------------------------------------------------------------
const DEFAULT_PASSWORD = '1234';
function u(id, name, role, extra) {
  return Object.assign({
    id, name, role, email: '', phone: '', qualification: '', designation: '', registrationNumber: '',
    digitalSignatureUrl: '', isActive: true, customPermissions: [], lastLogin: null,
    mustChangePassword: false, updatedAt: SEED_TIME
  }, extra || {});
}
const USERS = [
  u('u_ghanshyam', 'Dr. Ghanshyam Kumawat', 'SUPER_ADMIN_RADIOLOGIST', {
    email: 'dr.ghanshyam85@gmail.com', phone: '6375854709', qualification: 'MBBS, DMRD',
    designation: 'Consultant Radiologist & Sonologist', registrationNumber: 'RMC Reg. No. 34378/15533'
  }),
  u('u_rishabh', 'Dr. Rishabh Kumar', 'CONSULTANT_PATHOLOGIST', {
    qualification: 'MBBS, MD (Pathology)', designation: 'Consultant Pathologist', registrationNumber: 'RMC Reg. No. 37949/26174'
  }),
  u('u_yogesh', 'Yogesh', 'LAB_TECHNICIAN', {
    qualification: 'DMLT', designation: 'Senior Lab Technician', registrationNumber: 'RPMC Reg. No. 7596'
  }),
  u('u_reception1', 'Staff 1 - Morning Desk', 'RECEPTION_BILLING', { designation: 'Front Desk & Billing (Morning Shift)', phone: '9887150552' }),
  u('u_reception2', 'Staff 2 - Evening Desk', 'RECEPTION_BILLING', { designation: 'Front Desk & Billing (Evening Shift)' }),
  u('u_auditor', 'NWR Empanelment Auditor', 'AUDITOR_VIEW_ONLY', { designation: 'External Auditor / Referring Doctor (Read-only)' })
];

// ---------------------------------------------------------------------------
// Clinic settings (defaults)
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  id: 'main',
  clinic: {
    name: 'Shiv Sonography and Diagnostic Center',
    shortName: 'SSDC',
    tagline: 'Ultrasound • Color Doppler • Digital X-Ray • Pathology • ECG • Echo',
    address: 'Opposite SDH Hospital (Government Hospital), Gate Number 2, Jobner Road, Phulera, District Jaipur, PIN – 303338 (Rajasthan)',
    city: 'Phulera, Jaipur',
    phone: '6375854709',
    phone2: '9887150552',
    email: 'dr.ghanshyam85@gmail.com',
    website: '',
    gstin: '',
    logo: '',
    pcpndtRegNo: 'DYCM&MO/FW/JPR-II/PCPNDT Act 1994/2018/74',
    radiologist: { name: 'Dr. Ghanshyam Kumawat', qualification: 'MBBS, DMRD', designation: 'Consultant Radiologist', rmc: '34378/15533' },
    pathologist: { name: 'Dr. Rishabh Kumar', qualification: 'MBBS, MD (Pathology)', designation: 'Consultant Pathologist', rmc: '37949/26174' },
    labTech: { name: 'Yogesh', designation: 'Lab Technician', rpmc: '7596' },
    footerNote: 'This is a computer-generated invoice. Kindly bring this receipt at the time of report collection.',
    workingHours: 'Mon–Sat 8:00 AM – 8:00 PM | Sunday 9:00 AM – 1:00 PM'
  },
  billing: {
    invoicePrefix: 'SSDC',
    invoicePad: 4,
    upiId: '',
    upiPayeeName: 'Shiv Sonography and Diagnostic Center',
    autoSend: false,
    autoSendChannels: { whatsapp: true, sms: false, email: false },
    publicBaseUrl: '',
    defaultPaymentMode: 'cash',
    requireReferringDoctor: true,
    showAmountInWords: true,
    // diagnostic services by a clinical establishment are GST-exempt; set a rate only on your tax adviser's advice
    taxRate: 0,
    taxLabel: 'GST',
    receipt: { autoPrint: false },
    letterheadId: '', // A4 invoices: '' = built-in header, or a letterhead template id
    // new bills start at the referring doctor's partner tier, or the emergency tier at night when enabled
    tierRules: { autoEmergency: false, emergencyFrom: '21:00', emergencyTo: '08:00' }
  },
  engagement: {
    googleReviewUrl: 'https://www.google.com/maps/search/?api=1&query=Shiv+Sonography+and+Diagnostic+Center+Phulera',
    feedbackUrl: 'https://wa.me/916375854709?text=Feedback%20for%20Shiv%20Sonography%20and%20Diagnostic%20Center%3A%20',
    reviewText: 'Happy with our service? Please rate us on Google ⭐',
    feedbackText: 'Share your feedback',
    customGuidelines: ''
  },
  print: {
    format: 'a4',
    copyMode: 'single',
    dualLayout: 'stacked',
    slipOnA4: true,
    marginPreset: 'standard',
    margins: { top: 8, right: 8, bottom: 8, left: 8 },
    scale: 100,
    autoScale: true,
    autoFill: true,
    colorMode: 'color',
    visibility: {
      header: true, aadhaar: true, refDoctor: true, discount: true, balance: true,
      upiQr: true, guidelines: true, reviewQr: true, signature: true
    },
    maskAadhaar: true
  },
  // letterhead templates (Settings → Print & reports): { id, name, kind: 'image' | 'html', headerImage,
  // footerImage, headerHeight, footerHeight (mm), headerHtml, footerText }
  letterheads: [],
  report: {
    letterheadId: '',
    fontFamily: 'Arial',
    fontSize: 11,
    lineHeight: 1.45,
    margins: { top: 10, right: 14, bottom: 12, left: 14 },
    orientation: 'portrait',
    headerMode: 'full',
    letterheadTop: 45,
    letterheadBottom: 25,
    showHeader: true,
    showFooter: true,
    watermarkDrafts: true,
    imagesPerPage: 4,
    footerText: 'Ultrasound findings are subject to clinical correlation. Not valid for medico-legal purposes.',
    pcpndtDeclaration: 'I, Dr. Ghanshyam Kumawat, declare that while conducting ultrasonography on this patient, I have neither detected nor disclosed the sex of the foetus to anybody in any manner. (PC-PNDT Act, 1994)',
    autosaveSeconds: 2,
    spellcheck: true,
    autocorrect: true
  },
  formF: {
    clinicText: 'SHIV SONOGRAPHY & DIAGNOSTIC CENTRE, Opposite SDH/Government Hospital, Phulera, Phulera Distt, Jaipur, Rajasthan.',
    regNoText: 'DY CM&HO(FW)/JPR-2/PCPNDT Act 1994/2018/74',
    doctorText: 'Dr Ghanshyam Kumawat, RMC No 34378/15533',
    doctorCaps: 'DR GHANSHYAM KUMAWAT, RMC NO 34378/15533',
    doctorNameCaps: 'DR GHANSHYAM KUMAWAT',
    defaultIndications: [17], // Section B item 10, indication 17 ticked on every new form
    autoFill: true,
    autoFillSections: { A: true, B: true, C: true, D: true },
    autoIndications: true,
    visibility: {
      collapseSectionC: true, showThumbBlock: true, showEddNextToLmp: true, showSelfReferralNote: true,
      guardianLabel: 'both', showHindi: true, showPage2Ref: true, printSignature: false, showFrame: true, blankLines: true
    },
    fontPt: 10.5,
    customEdits: {}
  },
  lab: {
    letterheadId: '',
    reportTitle: 'LABORATORY INVESTIGATION REPORT',
    showMethod: true,
    footerText: 'Results relate only to the sample received. Kindly correlate clinically.',
    nablText: 'Non-NABL'
  },
  dispatch: {
    mode: 'deeplink',
    autoMode: true,
    linkDays: 7,
    gmailCompose: false,
    convertDocxToPdf: true,
    defaultLanguage: 'en',
    rules: { onUpload: false, onSigned: true, onEmailImport: false, scheduled: false, scheduledTime: '18:00', onSampleCollected: false },
    channels: { whatsapp: true, sms: false, email: true },
    runOnThisWorkstation: false
  },
  accounts: {
    discountRule: 'share_minus_discount',
    accountsInCharge: 'Accounts In-Charge',
    ownerName: 'Dr. Ghanshyam Kumawat'
  },
  compliance: {
    strictFormFLock: true,
    umidRateLock: true,
    dualSignatoryPathology: true
  },
  cloud: {
    rootFolder: 'Shiv_Ultrasonography_Diagnostic_Center',
    autoSync: true,
    intervalSeconds: 60,
    syncReports: true,
    syncImages: true,
    syncDicom: true,
    syncRecords: true
  },
  // Images: a folder on the server PC (cloud-synced — Google Drive / OneDrive / Dropbox — or the console's
  // network share) whose new JPEG / PNG / DICOM files appear in the report's Images tab, matched to the patient
  imageInbox: {
    enabled: false,
    folder: '',
    depth: 3,
    moveImported: false,
    matchDays: 1
  },
  images: {
    sortMode: 'auto'
  },
  ui: {
    devRoleSwitcher: true
  },
  // session security: idle lock per workstation (minutes, 0 = off), a shorter one on the Admin Console
  // and Settings, automatic sign-out after a long lock, password re-confirmation for sensitive admin
  // actions and the maximum length of a signed-in session (one working day)
  security: {
    idleLockMinutes: 15,
    adminIdleMinutes: 5,
    signOutAfterLockMinutes: 60,
    adminReauthMinutes: 15,
    sessionHours: 14
  },
  queue: {
    rooms: {},
    // departments the waiting-hall TV shows (its queues, calls and announcements); the staff queue shows all
    tvDepartments: ['USG']
  },
  // test packages: one tap adds every test (codes from the rate list); editable in the Tariff Directory
  packages: [
    { id: 'pkg_anc', name: 'ANC first visit', codes: ['USG-006', 'PATH-101', 'PATH-104', 'PATH-108', 'PATH-117', 'BIO-204', 'BIO-220'] },
    { id: 'pkg_fever', name: 'Fever profile', codes: ['PATH-101', 'PATH-111', 'PATH-112', 'PATH-108', 'BIO-218'] },
    { id: 'pkg_diabetes', name: 'Diabetes check', codes: ['BIO-203', 'BIO-205', 'BIO-208', 'BIO-207', 'PATH-108'] },
    { id: 'pkg_abdomen', name: 'Abdomen work-up', codes: ['USG-001', 'BIO-206', 'BIO-207', 'PATH-101'] },
    { id: 'pkg_thyroid', name: 'Thyroid work-up', codes: ['BIO-209', 'USG-014'] },
    { id: 'pkg_preop', name: 'Pre-operative', codes: ['PATH-101', 'PATH-104', 'PATH-106', 'BIO-204', 'BIO-207', 'PATH-117', 'PATH-108', 'ECG-401', 'XRAY-301'] }
  ],
  updatedAt: SEED_TIME
};

const ADDRESS_TAGS = ['Phulera', 'Jaipur', 'Sambhar Lake', 'Jobner', 'Narena', 'Renwal', 'Dudu', 'Hirnoda', 'Sakhun', 'Kishangarh-Renwal', 'Bichoon', 'Sanju'];

const EXPENSE_CATEGORIES = ['Clinical Consumables', 'Referral / Doctor Payout', 'Staff Welfare', 'Office / Admin', 'Maintenance', 'Rent', 'Salaries', 'Electricity', 'Miscellaneous'];

const UMID_UNITS = ['Jaipur Division', 'Ajmer Division', 'Bikaner Division', 'Jodhpur Division', 'NWR Headquarters, Jaipur', 'Workshop – Ajmer', 'Workshop – Jodhpur', 'Phulera Junction'];

// ---------------------------------------------------------------------------
// Message templates (WhatsApp / SMS / Email)
// ---------------------------------------------------------------------------
function mt(id, name, channel, kind, lang, body, subject) {
  return { id, name, channel, kind, lang, subject: subject || '', body, updatedAt: SEED_TIME };
}
const MSG_TEMPLATES = [
  mt('tpl_wa_invoice_en', 'Invoice – WhatsApp (English)', 'whatsapp', 'invoice', 'en',
`*{{Center_Name}}*
{{Center_Address}}
📞 {{Center_Phone}}

Dear {{Patient_Name}},
Thank you for choosing us. Your invoice details:

🧾 *Invoice No:* {{Invoice_No}}
📅 *Date:* {{Date}}
🔬 *Investigations:* {{Test_Name}}
💰 *Net Amount:* ₹{{Total_Amount}}
✅ *Paid:* ₹{{Paid_Amount}}
⏳ *Balance Due:* ₹{{Balance_Due}}
📌 *Status:* {{Payment_Status}}

View your digital receipt, preparation guidelines & pay online:
{{Invoice_Link}}

⭐ Rate us on Google: {{Review_Link}}
— {{Center_Name}}`),
  mt('tpl_wa_invoice_hi', 'Invoice – WhatsApp (Hindi / Bilingual)', 'whatsapp', 'invoice', 'hi',
`*{{Center_Name}}*
नमस्कार {{Patient_Name}},
आपका बिल विवरण / Invoice details:

🧾 बिल नं.: {{Invoice_No}} ({{Date}})
🔬 जाँच: {{Test_Name}}
💰 कुल राशि: ₹{{Total_Amount}} | जमा: ₹{{Paid_Amount}} | बकाया: ₹{{Balance_Due}}
📌 स्थिति: {{Payment_Status}}

डिजिटल रसीद व जाँच की तैयारी के निर्देश:
{{Invoice_Link}}

संपर्क: {{Center_Phone}} — {{Center_Name}}, फुलेरा`),
  mt('tpl_sms_invoice_en', 'Invoice – SMS (English)', 'sms', 'invoice', 'en',
`{{Center_Short}}: Dear {{Patient_Name}}, Invoice {{Invoice_No}} dt {{Date}}. Tests: {{Test_Name}}. Net Rs.{{Total_Amount}}, Paid Rs.{{Paid_Amount}}, Due Rs.{{Balance_Due}}. Receipt: {{Invoice_Link}} Ph {{Center_Phone}}`),
  mt('tpl_email_invoice_en', 'Invoice – Email (English)', 'email', 'invoice', 'en',
`Dear {{Patient_Name}},

Thank you for visiting {{Center_Name}}.

Invoice No: {{Invoice_No}}
Date: {{Date}}
Investigations: {{Test_Name}}
Net Amount: Rs. {{Total_Amount}}
Paid: Rs. {{Paid_Amount}}
Balance Due: Rs. {{Balance_Due}}
Payment Status: {{Payment_Status}}

Digital receipt & preparation guidelines: {{Invoice_Link}}

Regards,
{{Center_Name}}
{{Center_Address}}
Phone: {{Center_Phone}} | Email: {{Center_Email}}`, 'Invoice {{Invoice_No}} – {{Center_Name}}'),
  mt('tpl_wa_sample_en', 'Sample Collected – WhatsApp (English)', 'whatsapp', 'sample', 'en',
`Dear {{Patient_Name}},
Your sample (ID *{{Sample_ID}}*) for {{Test_Name}} was collected at {{Collected_At}}.
Expected report: *{{Report_ETA}}*. We will send it here as soon as it is verified.
– {{Center_Name}}, 📞 {{Center_Phone}}`),
  mt('tpl_wa_sample_hi', 'Sample Collected – WhatsApp (Hindi)', 'whatsapp', 'sample', 'hi',
`नमस्ते {{Patient_Name}},
आपका सैंपल (ID *{{Sample_ID}}*) {{Test_Name}} के लिए {{Collected_At}} बजे लिया गया है।
रिपोर्ट अनुमानित समय: *{{Report_ETA}}*। सत्यापन के बाद रिपोर्ट यहीं भेजी जाएगी।
– {{Center_Name}}, 📞 {{Center_Phone}}`),
  mt('tpl_sms_sample_en', 'Sample Collected – SMS (English)', 'sms', 'sample', 'en',
'Dear {{Patient_Name}}, sample {{Sample_ID}} for {{Test_Name}} collected at {{Collected_At}}. Report expected: {{Report_ETA}}. -{{Center_Short}} {{Center_Phone}}'),
  mt('tpl_wa_report_en', 'Report Ready – WhatsApp (English)', 'whatsapp', 'report', 'en',
`*{{Center_Name}}*

Dear {{Patient_Name}} ({{Age_Gender}}),
Your *{{Report_Category}}* report for *{{Test_Name}}* is ready.
Reported by: {{Doctor_Name}}

📄 Download your report: {{Secure_Download_Link}}
🧾 Invoice {{Invoice_No}} – ₹{{Total_Amount}} ({{Payment_Status}})

For any query call {{Center_Phone}}.
— {{Center_Name}}, Phulera`),
  mt('tpl_wa_report_hi', 'Report Ready – WhatsApp (Hindi)', 'whatsapp', 'report', 'hi',
`*{{Center_Name}}*
नमस्कार {{Patient_Name}}, आपकी {{Test_Name}} रिपोर्ट तैयार है।
रिपोर्टकर्ता: {{Doctor_Name}}

📄 रिपोर्ट डाउनलोड करें: {{Secure_Download_Link}}
🧾 बिल: {{Invoice_No}} – ₹{{Total_Amount}} ({{Payment_Status}})

किसी भी जानकारी हेतु संपर्क करें: {{Center_Phone}}`),
  mt('tpl_sms_report_en', 'Report Ready – SMS (English)', 'sms', 'report', 'en',
`{{Center_Short}}: Dear {{Patient_Name}}, your {{Test_Name}} report is ready. Download: {{Secure_Download_Link}} Bill Rs.{{Total_Amount}} ({{Payment_Status}}). Ph {{Center_Phone}}`),
  mt('tpl_email_report_en', 'Report – Email (English)', 'email', 'report', 'en',
`Dear {{Patient_Name}},

Please find attached your {{Report_Category}} report ({{Test_Name}}), reported by {{Doctor_Name}}.

Secure download link: {{Secure_Download_Link}}
Invoice: {{Invoice_No}} – Rs. {{Total_Amount}} ({{Payment_Status}})

Wishing you good health,
{{Center_Name}}
{{Center_Address}}
Phone: {{Center_Phone}}`, 'Your {{Test_Name}} report – {{Center_Name}}'),
  mt('tpl_wa_doctor_stmt', 'Doctor Statement – WhatsApp', 'whatsapp', 'statement', 'en',
`*{{Center_Name}}*
Referral & Sharing Statement

Dear {{Doctor_Name}},
Statement period: *{{Period}}*
👥 Total patients: {{Total_Patients}}
🧾 Total bill: ₹{{Total_Bill}}
🏷️ Total discount: ₹{{Total_Discount}}
💰 *Net sharing payable: ₹{{Share_Payable}}*
✅ Status: {{Audit_Status}}

Thank you for your continued trust.
— Accounts, {{Center_Name}}`)
];

// ---------------------------------------------------------------------------
// Demo transactions (dated relative to "today" at first run)
// ---------------------------------------------------------------------------
function pad2(n) { return String(n).padStart(2, '0'); }
function dateKeyOf(dt) { return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate()); }
function atTime(base, daysAgo, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate() - daysAgo, h, m, 0, 0);
  return dt;
}

function buildDemoData(now) {
  now = now || new Date();
  const testByCode = {};
  TESTS.forEach((x) => { testByCode[x.code] = x; });
  const docById = {};
  DOCTORS.forEach((x) => { docById[x.id] = x; });

  const patients = PATIENTS.map((x) => Object.assign({}, x));
  const extraPatients = {
    w1: { title: 'Mr.', name: 'Ramesh Chand Kumawat', relation: 'S/O', guardianName: 'Gopal Lal Kumawat', age: 55, gender: 'Male', mobile: '9000020006', address: 'Railway Colony, Phulera' },
    w2: { title: 'Mrs.', name: 'Rekha Saini', relation: 'W/O', guardianName: 'Manoj Saini', age: 26, gender: 'Female', mobile: '9000020007', address: 'Renwal, Jaipur' },
    w3: { title: 'Mr.', name: 'Vikas Jangid', relation: 'S/O', guardianName: 'Om Prakash Jangid', age: 34, gender: 'Male', mobile: '9000020008', address: 'Phulera, Jaipur' },
    w4: { title: 'Mrs.', name: 'Manju Kanwar', relation: 'W/O', guardianName: 'Surendra Singh', age: 41, gender: 'Female', mobile: '9000020009', address: 'Jobner, Jaipur' },
    w5: { title: 'Mr.', name: 'Hanuman Prasad', relation: 'S/O', guardianName: 'Ram Narayan', age: 67, gender: 'Male', mobile: '9000020010', address: 'Sambhar Lake, Jaipur' },
    w6: { title: 'Ms.', name: 'Pinky Meena', relation: 'D/O', guardianName: 'Mukesh Meena', age: 22, gender: 'Female', mobile: '9000020011', address: 'Narena, Jaipur' },
    w7: { title: 'Mr.', name: 'Suresh Kumar Sharma', relation: 'S/O', guardianName: 'Banwari Lal Sharma', age: 38, gender: 'Male', mobile: '9000020012', address: 'Dudu, Jaipur' },
    w8: { title: 'Baby', name: 'Anaya', relation: 'D/O', guardianName: 'Deepak Kumawat', age: 3, gender: 'Female', mobile: '9000020013', address: 'Phulera, Jaipur' },
    w9: { title: 'Mrs.', name: 'Santosh Devi', relation: 'W/O', guardianName: 'Kailash Chand', age: 50, gender: 'Female', mobile: '9000020014', address: 'Hirnoda, Phulera' }
  };
  let pn = PATIENTS.length;
  const extraIds = {};
  Object.keys(extraPatients).forEach((k) => {
    pn += 1;
    const e = extraPatients[k];
    const doc = p(pn, e.title, e.name, e.relation, e.guardianName, e.age, e.gender, e.mobile, e.address);
    patients.push(doc);
    extraIds[k] = doc.id;
  });
  const patById = {};
  patients.forEach((x) => { patById[x.id] = x; });
  const P = (ref) => (typeof ref === 'number' ? 'pat_demo_' + ref : extraIds[ref]);

  // [daysAgo, time, patientRef, testCodes, doctorId, discount, payments{cash,upi,card}|'umid', staff, extra]
  const rows = [
    [24, '10:15', 1, ['USG-008', 'PATH-104', 'PATH-102'], 'doc_02', 0, { cash: 2700 }, 'u_reception1', { obsLmpDaysAgo: 150 }],
    [22, '11:30', 2, ['USG-001', 'BIO-203'], 'doc_01', 0, { upi: 940 }, 'u_reception1'],
    [20, '09:45', 'w4', ['USG-004', 'PATH-101'], 'doc_04', 50, { cash: 900 }, 'u_reception1'],
    [18, '17:20', 'w5', ['USG-003', 'BIO-207', 'XRAY-301'], 'doc_09', 100, { cash: 800, upi: 750 }, 'u_reception2'],
    [16, '12:10', 'w6', ['USG-004', 'BIO-209'], 'doc_07', 0, { upi: 1150 }, 'u_reception1'],
    [14, '16:40', 'w7', ['XRAY-304', 'XRAY-303'], 'doc_05', 0, { cash: 1250 }, 'u_reception2'],
    [12, '10:05', 'w8', ['USG-001', 'PATH-101'], 'doc_06', 150, { cash: 1000 }, 'u_reception1'],
    [10, '11:55', 'w9', ['USG-014', 'BIO-209', 'BIO-205'], 'doc_08', 0, { upi: 1950 }, 'u_reception1'],
    [8, '18:25', 3, ['USG-020', 'BIO-208'], 'doc_04', 0, { card: 1400 }, 'u_reception2'],
    [6, '09:35', 'w5', ['ECG-401', 'ECHO-501'], 'doc_09', 50, { cash: 2000 }, 'u_reception1'],
    [5, '13:15', 'w4', ['USG-013'], 'doc_10', 0, { upi: 1200 }, 'u_reception1'],
    [4, '15:50', 'w7', ['USG-001', 'BIO-206', 'BIO-207'], 'doc_03', 0, { cash: 1600 }, 'u_reception2'],
    [3, '17:05', 'w6', ['USG-016'], 'doc_08', 100, { cash: 2000 }, 'u_reception2', { settleToday: { cash: 400, staff: 'u_reception2', time: '17:30' } }],
    [2, '10:40', 'w9', ['XRAY-305', 'PATH-101'], 'doc_05', 0, { upi: 1150 }, 'u_reception1'],
    // --- today ---
    [0, '09:12', 1, ['USG-006', 'PATH-101', 'PATH-108'], 'doc_02', 0, { cash: 1200 }, 'u_reception1', { obsLmpDaysAgo: 174, status: 'Completed' }],
    [0, '09:40', 2, ['USG-001', 'BIO-206'], 'doc_01', 100, { upi: 1300 }, 'u_reception1', { reason: 'Regular patient', status: 'Completed' }],
    [0, '10:25', 3, ['USG-004', 'BIO-209'], 'doc_04', '10%', { cash: 500, upi: 535 }, 'u_reception1', { reason: 'Doctor reference', status: 'Completed' }],
    [0, '11:05', 4, ['XRAY-301', 'PATH-101'], 'doc_06', 0, { cash: 400 }, 'u_reception1', { status: 'In Scan/Sample' }],
    [0, '12:30', 'w1', ['USG-003', 'BIO-207'], 'doc_03', 0, { cash: 1300 }, 'u_reception1', { status: 'In Scan/Sample' }],
    [0, '15:10', 5, ['ECG-401', 'ECHO-501', 'BIO-208'], 'doc_09', 150, { card: 2500 }, 'u_reception2', { reason: 'Senior citizen', status: 'Waiting' }],
    [0, '16:20', 'w2', ['USG-005', 'PATH-104', 'PATH-102'], 'doc_07', 0, { upi: 900 }, 'u_reception2', { obsLmpDaysAgo: 56, status: 'Waiting' }],
    [0, '18:05', 'w3', ['USG-015'], 'SELF', 0, { cash: 1000 }, 'u_reception2', { status: 'Waiting' }]
  ];

  const invoices = [];
  const visits = [];
  const counters = {};
  const tokenCount = {};
  let seqByYear = {};

  rows.forEach((r, idx) => {
    const [daysAgo, time, pref, codes, docId, disc, pay, staff, extra = {}] = r;
    const at = atTime(now, daysAgo, time);
    const dk = dateKeyOf(at);
    const year = at.getFullYear();
    seqByYear[year] = (seqByYear[year] || 0) + 1;
    const n = String(idx + 1).padStart(2, '0');
    const pid = P(pref);
    const pat = patById[pid];
    const umid = pay === 'umid';
    const items = codes.map((c) => {
      const tt = testByCode[c];
      const rate = umid ? tt.tariff.cghsRate : tt.tariff.standardRate;
      return { testId: tt.id, code: tt.code, name: tt.name, department: tt.department, rate, amount: rate };
    });
    const gross = items.reduce((s, x) => s + x.amount, 0);
    let discountType = 'flat';
    let discountValue = 0;
    let discountAmount = 0;
    if (typeof disc === 'string' && disc.endsWith('%')) {
      discountType = 'percent';
      discountValue = parseFloat(disc);
      discountAmount = Math.round(gross * discountValue / 100);
    } else {
      discountValue = disc || 0;
      discountAmount = disc || 0;
    }
    const net = gross - discountAmount;
    const payments = [];
    let paymentMode = 'cash';
    if (!umid) {
      const modes = Object.keys(pay).filter((k) => pay[k] > 0);
      paymentMode = modes.length > 1 ? 'split' : (modes[0] || 'due');
      modes.forEach((m, i) => {
        payments.push({ id: 'pay_demo_' + n + '_' + i, at: at.getTime(), mode: m, amount: pay[m], staffId: staff, note: '' });
      });
    } else {
      paymentMode = 'umid';
    }
    if (extra.settleToday) {
      const st = atTime(now, 0, extra.settleToday.time);
      payments.push({ id: 'pay_demo_' + n + '_settle', at: st.getTime(), mode: 'cash', amount: extra.settleToday.cash, staffId: extra.settleToday.staff, note: 'Balance due collected' });
    }
    const paid = payments.reduce((s, x) => s + x.amount, 0);
    const balance = umid ? 0 : Math.max(0, net - paid);
    const doc = docById[docId];
    const invNo = 'SSDC-' + year + '-' + String(seqByYear[year]).padStart(4, '0');
    const visitId = 'vis_demo_' + n;
    const status = umid ? 'CASHLESS' : balance <= 0 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'DUE';

    // tokens
    const mods = Array.from(new Set(items.map((x) => (DEPARTMENTS.find((dd) => dd.key === x.department) || {}).token)));
    const tokens = {};
    mods.forEach((m) => {
      const key = 'token-' + dk + '-' + m;
      tokenCount[key] = (tokenCount[key] || 0) + 1;
      tokens[m] = m + '-' + String(tokenCount[key]).padStart(2, '0');
    });
    const ckey = 'token-' + dk + '-ALL';
    tokenCount[ckey] = (tokenCount[ckey] || 0) + 1;
    tokens.combined = 'T-' + String(tokenCount[ckey]).padStart(2, '0');

    let obstetric = null;
    if (extra.obsLmpDaysAgo) {
      const lmp = new Date(at.getFullYear(), at.getMonth(), at.getDate() - extra.obsLmpDaysAgo);
      const edd = new Date(lmp.getFullYear(), lmp.getMonth(), lmp.getDate() + 280);
      obstetric = {
        enabled: true, mode: 'lmp', lmp: dateKeyOf(lmp), edd: dateKeyOf(edd),
        gaWeeks: Math.floor(extra.obsLmpDaysAgo / 7), gaDays: extra.obsLmpDaysAgo % 7,
        gravida: 2, para: 1, living: 1, abortion: 0, sons: 0, daughters: 1, sonsAges: '', daughtersAges: '3 yrs',
        indication: extra.obsLmpDaysAgo < 98 ? 'Confirm viability & dating' : 'Routine ANC – foetal growth & well-being',
        formFConsent: true
      };
    }
    const st = extra.status || 'Completed';
    const statusMap = {};
    mods.forEach((m) => { statusMap[m] = st; });

    visits.push({
      id: visitId, patientId: pid, dateKey: dk, createdAt: at.getTime(), tokens,
      tests: items.map((x) => ({ testId: x.testId, code: x.code, name: x.name, department: x.department, rate: x.rate })),
      referredBy: docId, referredByName: docId === 'SELF' ? 'Self' : doc ? doc.name : '',
      obstetric, status: statusMap, billed: true, invoiceId: 'inv_demo_' + n,
      createdBy: staff, updatedAt: SEED_TIME
    });

    invoices.push({
      id: 'inv_demo_' + n,
      invoiceNo: invNo,
      date: at.getTime(),
      dateKey: dk,
      patientId: pid,
      visitId,
      patient: {
        title: pat.title, name: pat.name, relation: pat.relation, guardianName: pat.guardianName,
        age: pat.age, ageUnit: pat.ageUnit, gender: pat.gender, mobile: pat.mobile, email: pat.email,
        address: pat.address, aadhaar: pat.aadhaar, regId: pat.regId
      },
      referredBy: docId,
      referredByName: docId === 'SELF' ? 'Self' : doc ? doc.name : '',
      items,
      billingType: umid ? 'umid' : 'standard',
      umid: umid ? {
        cardNo: 'NWR-UMID-0482-7731', beneficiaryName: pat.name, employeeName: pat.name, relation: 'Self',
        designation: 'Senior Section Engineer (Retd.)', unit: 'Jaipur Division', referralNo: 'RHU/PHL/2026/118',
        referralDate: dk, referringUnit: 'Railway Health Unit – Phulera', verified: true, verifiedBy: 'u_reception1', verifiedAt: at.getTime()
      } : null,
      gross, discountType, discountValue, discountAmount, discountReason: extra.reason || '',
      net, paymentMode, payments, paid, balance, status,
      staffId: staff, createdBy: staff, shareId: 'sh' + (100000 + idx * 7919).toString(36) + 'demo',
      notes: '', sent: {}, createdAt: at.getTime(), updatedAt: SEED_TIME
    });
    counters['inv-' + year] = seqByYear[year];
  });

  Object.keys(tokenCount).forEach((k) => { counters[k] = tokenCount[k]; });
  counters.patient = patients.length;

  // patient visit stats
  patients.forEach((pt) => {
    const vs = visits.filter((v) => v.patientId === pt.id);
    pt.visitCount = vs.length;
    pt.lastVisitAt = vs.length ? Math.max.apply(null, vs.map((v) => v.createdAt)) : null;
  });

  const today = dateKeyOf(now);
  const floats = [
    { id: 'flt_' + today + '_u_reception1', date: today, staffId: 'u_reception1', amount: 2000, updatedAt: SEED_TIME },
    { id: 'flt_' + today + '_u_reception2', date: today, staffId: 'u_reception2', amount: 0, updatedAt: SEED_TIME }
  ];

  const dayOfMonth = now.getDate();
  const md = (day) => dateKeyOf(new Date(now.getFullYear(), now.getMonth(), Math.min(day, dayOfMonth)));
  const e = (id, date, description, category, mode, amount, staffId, paidTo, time) => ({
    id, date, description, category, mode, amount, staffId, paidTo: paidTo || '',
    createdAt: atTime(new Date(date + 'T00:00:00'), 0, time || '10:00').getTime(), updatedAt: SEED_TIME
  });
  const expenses = [
    e('exp_demo_01', today, 'Ultrasound Gel & Thermal Rolls', 'Clinical Consumables', 'cash', 650, 'u_reception1', 'Jaipur Surgicals', '10:50'),
    e('exp_demo_02', today, 'Staff Tea / Refreshments', 'Staff Welfare', 'cash', 180, 'u_reception2', 'Tea stall', '16:00'),
    e('exp_demo_03', today, 'Courier – Samples to Jaipur Reference Lab', 'Office / Admin', 'upi', 250, 'u_reception1', 'DTDC Courier', '13:20'),
    e('exp_demo_04', md(1), 'Clinic Rent – Monthly', 'Rent', 'upi', 18000, 'u_ghanshyam', 'Building Owner'),
    e('exp_demo_05', md(1), 'Staff Salaries – Monthly', 'Salaries', 'upi', 52000, 'u_ghanshyam', 'Staff'),
    e('exp_demo_06', md(3), 'Electricity Bill (JVVNL)', 'Electricity', 'upi', 7450, 'u_ghanshyam', 'JVVNL'),
    e('exp_demo_07', md(4), 'Lab Reagents & Kits', 'Clinical Consumables', 'upi', 9800, 'u_ghanshyam', 'Jaipur Diagnostics Supply'),
    e('exp_demo_08', md(5), 'USG Machine AMC Visit', 'Maintenance', 'cash', 3500, 'u_ghanshyam', 'GE Service Engineer'),
    e('exp_demo_09', md(5), 'Internet & Telephone', 'Office / Admin', 'upi', 1199, 'u_ghanshyam', 'Airtel')
  ];

  const out = { patients, visits, invoices, expenses, floats, counters };
  const clin = demoClinical(out, now);
  out.reports = clin.reports;
  out.labReports = clin.labReports;
  out.formf = clin.formf;
  Object.assign(out.counters, clin.counters);
  visits.forEach((v) => {
    const r = clin.reports.find((x) => x.visitId === v.id);
    const l = clin.labReports.find((x) => x.visitId === v.id);
    const f = clin.formf.find((x) => x.visitId === v.id);
    if (r) v.reportId = r.id;
    if (l) v.labReportId = l.id;
    if (f) v.formFId = f.id;
    const p = patients.find((x) => x.id === v.patientId);
    v.patientName = p ? (p.title + ' ' + p.name) : '';
  });
  return out;
}


// ---------------------------------------------------------------------------
// Demo clinical records: USG reports, lab reports (all workflow stages), Form F
// ---------------------------------------------------------------------------
function demoClinical(demo, now) {
  const inv = (n) => demo.invoices.find((i) => i.id === 'inv_demo_' + n);
  const vis = (n) => demo.visits.find((v) => v.id === 'vis_demo_' + n);
  const docName = (id) => { const d = DOCTORS.find((x) => x.id === id); return id === 'SELF' ? 'Self' : d ? d.name : ''; };
  const demog = (i, modality, indication) => ({
    name: (i.patient.title + ' ' + i.patient.name).trim(), age: i.patient.age + ' Y', sex: i.patient.gender, patientId: i.patient.regId,
    date: i.dateKey, refBy: docName(i.referredBy), modality, indication
  });
  const H3 = (t) => '<h3 style="text-align:center"><u>' + t + '</u></h3>';
  const Pp = (l, t) => '<p><strong>' + l + ':</strong> ' + t + '</p>';
  const PND = '<p style="font-size:10pt"><em>I, Dr. Ghanshyam Kumawat, declare that while conducting ultrasonography on this patient I have neither detected nor disclosed the sex of the foetus to anybody in any manner (PC-PNDT Act, 1994).</em></p>';
  const abdHtml = (fatty) => H3('ULTRASOUND WHOLE ABDOMEN') +
    Pp('LIVER', fatty ? 'Liver is normal in size (span 14.6 cm) and shows diffusely increased parenchymal echogenicity with normal visualisation of the diaphragm and intrahepatic vessel walls — grade I fatty infiltration. No focal lesion. IHBR not dilated. PV 10 mm.' : 'Liver is normal in size (span 13.8 cm) with normal echotexture. No focal lesion.') +
    Pp('GALL BLADDER', 'Well distended with normal wall thickness. No calculus or sludge.') + Pp('CBD', 'Normal in calibre (4 mm).') +
    Pp('PANCREAS', 'Normal in size and echotexture.') + Pp('SPLEEN', 'Normal in size (10.2 cm) and echotexture.') +
    Pp('KIDNEYS', 'Right kidney 10.1 × 4.6 cm, left kidney 10.4 × 4.8 cm. Both kidneys are normal in size and echotexture with maintained corticomedullary differentiation. No calculus or hydronephrosis.') +
    Pp('URINARY BLADDER', 'Well distended, normal wall thickness.') + Pp('PROSTATE', 'Normal in size (volume 18 cc).') +
    Pp('OTHERS', 'No free fluid. No lymphadenopathy.') +
    '<h3><u>IMPRESSION</u></h3><ol><li><strong>' + (fatty ? 'Grade I fatty liver.' : 'No significant abnormality detected.') + '</strong></li></ol><p><em>Kindly correlate clinically.</em></p>';
  const obsHtml = (o, tiffa) => H3(tiffa ? 'TARGETED IMAGING FOR FOETAL ANOMALIES (TIFFA / LEVEL II)' : 'OBSTETRIC ULTRASOUND – GROWTH SCAN WITH BIOPHYSICAL PROFILE') +
    Pp('LMP', o.lmp.split('-').reverse().join('/') + '   |   GA by LMP: ' + o.gaWeeks + ' weeks ' + o.gaDays + ' days   |   EDD: ' + o.edd.split('-').reverse().join('/')) +
    Pp('FOETUS', 'Single live intrauterine foetus in ' + (tiffa ? 'variable' : 'cephalic') + ' presentation. Foetal cardiac activity (FHR ' + (tiffa ? 148 : 142) + ' bpm) and movements are present.') +
    '<table style="width:100%"><tr><th>Biometry</th><th>Measurement</th><th>Corresponding GA</th></tr>' +
    (tiffa ? '<tr><td>BPD</td><td>50 mm</td><td>21 w 2 d</td></tr><tr><td>HC</td><td>188 mm</td><td>21 w 0 d</td></tr><tr><td>AC</td><td>164 mm</td><td>21 w 1 d</td></tr><tr><td>FL</td><td>35 mm</td><td>21 w 2 d</td></tr><tr><td><strong>Average GA</strong></td><td colspan="2"><strong>21 weeks 2 days</strong></td></tr><tr><td>EFW</td><td colspan="2">410 g</td></tr>'
      : '<tr><td>BPD</td><td>62 mm</td><td>25 w 1 d</td></tr><tr><td>HC</td><td>230 mm</td><td>25 w 0 d</td></tr><tr><td>AC</td><td>207 mm</td><td>25 w 2 d</td></tr><tr><td>FL</td><td>46 mm</td><td>25 w 1 d</td></tr><tr><td><strong>Average GA</strong></td><td colspan="2"><strong>25 weeks 1 day</strong></td></tr><tr><td>EFW (Hadlock)</td><td colspan="2">780 g</td></tr>') +
    '</table>' + Pp('PLACENTA', 'Anterior, upper segment, grade ' + (tiffa ? 'I' : 'II') + ', clear of the internal os.') + Pp('LIQUOR', 'Adequate (AFI ' + (tiffa ? '13.5' : '12.4') + ' cm).') + Pp('UMBILICAL CORD', 'Three-vessel cord.') +
    (tiffa ? Pp('ANATOMY SURVEY', 'Head, face, spine, heart (4-chamber, outflow tracts), abdomen, kidneys, bladder and limbs appear normal for gestational age.') : '') +
    '<h3><u>IMPRESSION</u></h3><ol><li><strong>Single live intrauterine foetus of ' + (tiffa ? '21 weeks 2 days' : '25 weeks 1 day') + ' by USG.</strong></li><li><strong>Placenta anterior, liquor adequate.</strong></li>' + (tiffa ? '<li><strong>No obvious structural foetal anomaly detected.</strong></li>' : '<li><strong>BPP 8/8.</strong></li>') + '</ol>' + PND + '<p><em>Kindly correlate clinically.</em></p>';

  const signed = (at) => ({ status: 'SIGNED_FINAL', signedBy: 'u_ghanshyam', signedByName: 'Dr. Ghanshyam Kumawat', signedAt: at, version: 1 });
  const reports = [];
  const i1 = inv('01'); const v1 = vis('01');
  reports.push(Object.assign({ id: 'rep_demo_01', visitId: v1.id, patientId: i1.patientId, invoiceId: i1.id, templateKey: 'obs_tiffa', obstetric: true, formFId: 'ff_demo_01', demographics: demog(i1, 'TIFFA / Anomaly Scan (Level II)', 'Routine anomaly scan'), html: obsHtml(v1.obstetric, true), images: [], createdAt: i1.date + 1800000, createdBy: 'u_ghanshyam', updatedAt: SEED_TIME }, signed(i1.date + 2400000)));
  const i2 = inv('02');
  reports.push(Object.assign({ id: 'rep_demo_02', visitId: 'vis_demo_02', patientId: i2.patientId, invoiceId: i2.id, templateKey: 'abd_whole', demographics: demog(i2, 'USG Whole Abdomen', 'Dyspepsia, raised SGPT'), html: abdHtml(true), images: [], createdAt: i2.date + 1500000, createdBy: 'u_ghanshyam', updatedAt: SEED_TIME }, signed(i2.date + 2000000)));
  const i15 = inv('15'); const v15 = vis('15');
  reports.push(Object.assign({ id: 'rep_demo_15', visitId: v15.id, patientId: i15.patientId, invoiceId: i15.id, templateKey: 'obs_growth', obstetric: true, formFId: 'ff_demo_15', demographics: demog(i15, 'USG Obstetric / Routine ANC Scan', 'Routine ANC – foetal growth'), html: obsHtml(v15.obstetric, false), images: [], createdAt: i15.date + 1200000, createdBy: 'u_ghanshyam', updatedAt: SEED_TIME }, signed(i15.date + 1800000)));
  const i16 = inv('16');
  reports.push({ id: 'rep_demo_16', visitId: 'vis_demo_16', patientId: i16.patientId, invoiceId: i16.id, templateKey: 'abd_whole', demographics: demog(i16, 'USG Whole Abdomen', 'Follow-up fatty liver'), html: abdHtml(true), images: [], status: 'DRAFT', version: 1, createdAt: i16.date + 900000, createdBy: 'u_ghanshyam', updatedAt: SEED_TIME });

  const pt = (i) => ({ title: i.patient.title, name: i.patient.name, age: i.patient.age, ageUnit: i.patient.ageUnit, gender: i.patient.gender, regId: i.patient.regId, mobile: i.patient.mobile });
  const labTests = (i) => i.items.filter((x) => x.department === 'Pathology' || x.department === 'Biochemistry').map((x) => ({ testId: x.testId, name: x.name, panel: (TESTS.find((t) => t.id === x.testId) || {}).labPanel }));
  const lab = (n, status, values, extra) => {
    const i = inv(n);
    const sid = 'S' + i.dateKey.slice(2).replace(/-/g, '') + '-' + n;
    return Object.assign({ id: 'lab_demo_' + n, visitId: 'vis_demo_' + n, patientId: i.patientId, invoiceId: i.id, patient: pt(i), refBy: docName(i.referredBy), tests: labTests(i), values: values || {}, remarks: {}, comment: '', status, sampleId: sid, createdAt: i.date, updatedAt: SEED_TIME }, extra || {});
  };
  const t = (n, mins) => inv(n).date + mins * 60000;
  const labReports = [
    lab('15', 'SIGNED_FINAL', { CBC: { hb: 10.8, rbc: 3.9, pcv: 33.1, rdw: 14.8, tlc: 9200, neut: 70, lymph: 24, mono: 4, eos: 2, baso: 0, plt: 2.65, mpv: 9.1, esr: 28 }, URINE: { vol: '20 ml', col: 'Pale Yellow', app: 'Clear', sg: 1.015, ph: 6.0, prot: 'Nil', glu: 'Nil', ket: 'Negative', bs: 'Absent', bp: 'Absent', ubg: 'Normal', bld: 'Negative', nit: 'Negative', pus: '3-4 /hpf', rbcs: 'Nil', epi: '2-3 /hpf', cast: 'Nil', cry: 'Nil', bact: 'Nil', oth: 'Nil' } }, { sampleCollectedAt: t('15', 10), enteredBy: 'u_yogesh', enteredAt: t('15', 70), submittedAt: t('15', 75), verifiedBy: 'u_rishabh', verifiedAt: t('15', 110), comment: 'Mild normocytic anaemia of pregnancy. Iron supplementation as advised by the treating obstetrician.' }),
    lab('16', 'SUBMITTED', { LFT: { tbil: 1.1, dbil: 0.3, ast: 48, alt: 67, alp: 118, ggt: 58, tp: 7.3, alb: 4.2 } }, { sampleCollectedAt: t('16', 12), enteredBy: 'u_yogesh', enteredAt: t('16', 80), submittedAt: t('16', 85) }),
    lab('17', 'DRAFT', { TFT: { t3: 1.12, t4: 7.9 } }, { sampleCollectedAt: t('17', 8), enteredBy: 'u_yogesh', enteredAt: t('17', 60) }),
    lab('18', 'SAMPLE_COLLECTED', {}, { sampleCollectedAt: t('18', 15) }),
    lab('19', 'PENDING', {}),
    lab('20', 'PENDING', {}),
    lab('21', 'PENDING', {})
  ];

  const ff = (id, n, sno, status) => {
    const i = inv(n); const v = vis(n); const o = v.obstetric; const p = demo.patients.find((x) => x.id === i.patientId); const d = DOCTORS.find((x) => x.id === i.referredBy) || {};
    return {
      id, sno, snoLabel: i.dateKey.slice(0, 4) + '/' + String(sno).padStart(4, '0'), regnNo: p.regId, visitId: v.id, patientId: p.id, date: i.dateKey, status,
      data: {
        patientName: p.name, patientNameHindi: p.nameHindi || '', age: p.age, husbandName: p.guardianName, guardianRelation: p.relation === 'D/O' ? 'Father' : 'Husband',
        livingSons: o.sons, livingDaughters: o.daughters, sonsAges: o.sonsAges, daughtersAges: o.daughtersAges, totalChildren: o.sons + o.daughters,
        address: p.address, mobile: p.mobile, sameAsPostal: true, idAddress: p.address, idType: 'Aadhar Card', idNumber: p.aadhaar ? p.aadhaar.replace(/(\d{4})(?=\d)/g, '$1 ') : '',
        refDoctorName: d.name || '', refDoctorAddress: [d.clinic, d.address].filter(Boolean).join(', '), selfReferral: 'NO',
        lmpMode: 'lmp', lmp: o.lmp, gaWeeks: o.gaWeeks, gaDays: o.gaDays, edd: o.edd, indications: o.gaWeeks < 14 ? [1, 2] : [10, 11, 12, 17],
        procedureOther: '', procedureDate: i.dateKey, declarationDate: i.dateKey, result: 'Single live intrauterine foetus of ' + o.gaWeeks + ' weeks ' + o.gaDays + ' days. Placenta anterior. Liquor adequate.',
        resultConveyedTo: p.title + ' ' + p.name, conveyedDate: i.dateKey, mtp: 'NO', signatureType: 'signed', thumb: {}
      },
      customEdits: {}, createdAt: i.date + 600000, createdBy: 'u_ghanshyam', updatedAt: SEED_TIME
    };
  };
  const formf = [ff('ff_demo_01', '01', 1, 'FINAL'), ff('ff_demo_15', '15', 2, 'FINAL')];
  // Rekha (early pregnancy, today) — Form F still to be completed by the radiologist
  return { reports, labReports, formf, counters: { ['formf-' + now.getFullYear()]: 2 } };
}

module.exports = {
  SEED_TIME, DEPARTMENTS, TOKEN_MODALITIES, TESTS, DOCTORS, PATIENTS, USERS, DEFAULT_PASSWORD,
  DEFAULT_SETTINGS, ADDRESS_TAGS, EXPENSE_CATEGORIES, UMID_UNITS, MSG_TEMPLATES, buildDemoData, dateKeyOf
};
