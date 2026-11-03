// Reference tables inserted from the ribbon (References → Lexicons): ACR TI-RADS, ACR BI-RADS,
// fatty-liver grading, SFU hydronephrosis grading and the Manning biophysical profile.
const t = (head, rows, note) => `<table style="width:100%;border-collapse:collapse"><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>${note ? `<p style="font-size:9pt"><em>${note}</em></p>` : '<p><br></p>'}`;

export const REF_TABLES = {
  tirads: '<p><strong>ACR TI-RADS (2017) — risk categories</strong></p>' + t(['Points', 'Category', 'FNA if ≥', 'Follow-up if ≥'], [
    ['0', 'TR1 – Benign', 'No FNA', '—'], ['2', 'TR2 – Not suspicious', 'No FNA', '—'], ['3', 'TR3 – Mildly suspicious', '2.5 cm', '1.5 cm'],
    ['4–6', 'TR4 – Moderately suspicious', '1.5 cm', '1.0 cm'], ['≥ 7', 'TR5 – Highly suspicious', '1.0 cm', '0.5 cm']
  ], 'Points: composition, echogenicity, shape, margin and echogenic foci (Tessler FN et al., JACR 2017).'),
  birads: '<p><strong>ACR BI-RADS (ultrasound) — assessment categories</strong></p>' + t(['Category', 'Assessment', 'Management'], [
    ['0', 'Incomplete – need additional imaging', 'Recall for additional imaging'], ['1', 'Negative', 'Routine screening'], ['2', 'Benign', 'Routine screening'],
    ['3', 'Probably benign (≤ 2 % malignancy)', 'Short-interval (6-month) follow-up'], ['4A / 4B / 4C', 'Suspicious – low / moderate / high', 'Tissue diagnosis'],
    ['5', 'Highly suggestive of malignancy (≥ 95 %)', 'Tissue diagnosis'], ['6', 'Known biopsy-proven malignancy', 'Surgical excision when appropriate']
  ]),
  fatty: '<p><strong>Sonographic grading of fatty liver</strong></p>' + t(['Grade', 'Features'], [
    ['Grade I (mild)', 'Diffusely increased echogenicity; diaphragm and intrahepatic vessel walls normally visualised.'],
    ['Grade II (moderate)', 'Moderately increased echogenicity; slightly impaired visualisation of intrahepatic vessels and diaphragm.'],
    ['Grade III (severe)', 'Marked increase in echogenicity; poor or non-visualisation of the posterior right lobe, diaphragm and vessel walls.']
  ]),
  hdn: '<p><strong>Society for Fetal Urology (SFU) hydronephrosis grading</strong></p>' + t(['Grade', 'Features'], [
    ['0', 'No dilatation; central renal complex intact'], ['1', 'Mild splitting of the renal pelvis only'], ['2', 'Pelvis dilated + a few calyces visible'],
    ['3', 'Pelvis dilated + all calyces dilated; parenchyma preserved'], ['4', 'As grade 3 with thinning of the renal parenchyma']
  ]),
  bpp: '<p><strong>Biophysical profile (Manning) — each 2 or 0 in 30 minutes</strong></p>' + t(['Parameter', 'Normal (score 2)'], [
    ['Foetal breathing movements', '≥ 1 episode of ≥ 30 s'], ['Gross body movements', '≥ 3 discrete body / limb movements'], ['Foetal tone', '≥ 1 episode of extension with return to flexion'],
    ['Amniotic fluid', 'Single deepest pocket ≥ 2 cm'], ['NST (if performed)', 'Reactive']
  ], 'Score 8–10 normal; 6 equivocal; ≤ 4 abnormal — correlate clinically.')
};
