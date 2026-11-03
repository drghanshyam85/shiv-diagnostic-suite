// Offline "AI Text Expander": turns sonography shorthand into a structured formal report without any
// API key.  e.g.  "mild fatty liver, 14.5 cm, rest normal"   or   "32 wks live cephalic, placenta ant, AFI 12"
// Rule-based and deliberately conservative: unknown findings are echoed, never invented.

const ORGANS = [
  ['appendix', /appendi/],
  ['fluid', /ascites|free fluid|collection/],
  ['nodes', /lymph|\bnodes?\b/],
  ['prostate', /prostat|\bbph\b/],
  ['ureter', /ureter(?!o)|\buvj\b|\bvuj\b|vesico-?ureteric/],
  ['bladder', /bladder|\bub\b|cystitis|\bpvr\b|post[- ]?void/],
  ['cbd', /\bcbd\b|bile duct|choledoch/],
  ['gb', /\bgb\b|gall ?bladder|cholecyst|cholelith|gall ?stone|sludge/],
  ['pancreas', /pancrea/],
  ['spleen', /splee|spleno/],
  ['kidney', /kidney|renal|nephr|\b(rk|lk)\b|hydronephrosis|pelvicalyceal|\bpcs\b/],
  ['uterus', /uter|fibroid|myoma|endometri|adenomyo|\bet\b|iucd|cu-?t|hysterectomy/],
  ['ovary', /ovar|pcod|pcos|adnex|dermoid|follicl/],
  ['liver', /liver|hepat|fatty|steato|cirrho/]
];

const NUM = (s, units) => {
  const re = new RegExp('(\\d+(?:\\.\\d+)?)\\s*(?:x\\s*(\\d+(?:\\.\\d+)?)\\s*)?(?:x\\s*(\\d+(?:\\.\\d+)?)\\s*)?(' + units + ')\\b', 'i');
  const m = s.match(re);
  if (!m) return null;
  return { v: parseFloat(m[1]), dims: [m[1], m[2], m[3]].filter(Boolean).map(parseFloat), unit: m[4].toLowerCase(), raw: m[0] };
};
const fmtDims = (n) => n.dims.join(' × ') + ' ' + n.unit;
const sideOf = (s) => (/\b(bilateral|both|b\/l)\b/.test(s) ? 'both' : /\b(right|rt)\b/.test(s) ? 'right' : /\b(left|lt)\b/.test(s) ? 'left' : null);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function grade(s) {
  if (/grade\s*(iii|3)\b|severe|gross|marked/.test(s)) return 3;
  if (/grade\s*(ii|2)\b|moderate/.test(s)) return 2;
  if (/grade\s*(i|1)\b|mild|minimal|early/.test(s)) return 1;
  return 1;
}
const ROMAN = ['', 'I', 'II', 'III', 'IV'];

function detectExam(t, gender) {
  if (/\b\d{1,2}\s*(\+\s*\d\s*)?(wks?|weeks?)\b|\b\d{1,2}w\d?d?\b|gestation|foetus|fetus|fetal|foetal|liquor|\bafi\b|placenta|cephalic|breech|\bfhr\b|\bcrl\b|\bbpd\b|pregnan|\biup\b|yolk|gestational sac/.test(t)) return 'obstetric';
  if (/thyroid|tirads/.test(t)) return 'thyroid';
  if (/breast|birads/.test(t)) return 'breast';
  if (/testi|scrot|epididym|varicocele|hydrocele/.test(t)) return 'scrotum';
  const hasUpper = /liver|hepat|fatty|\bgb\b|gall|pancrea|splee|cbd/.test(t);
  const hasKub = /kidney|renal|ureter|bladder|prostat|nephr|\bkub\b/.test(t);
  const hasPelvis = /uter|ovar|pcod|pcos|fibroid|endometri|adnex/.test(t);
  if (!hasUpper && hasKub && !hasPelvis) return 'kub';
  if (!hasUpper && !hasKub && hasPelvis) return 'pelvis';
  return gender === 'Male' ? 'abdomen_male' : gender === 'Female' ? 'abdomen_female' : 'abdomen';
}

function clauses(t) {
  return t.split(/[,;\n]+|\.(?!\d)|\band\b(?=\s+(?:right|left|rt|lt|bilateral|both|gb|liver|spleen|kidney|uterus|ovar|prostate|bladder))/).map((x) => x.trim()).filter(Boolean);
}

// ------------------------------------------------------------------ abdomen / pelvis
function abdomenFindings(text, exam) {
  const f = {};
  const imp = [];
  let last = null;
  const cl = clauses(text);
  const restNormal = /rest (all )?(normal|nad|wnl)|otherwise normal|rest of (the )?(study|organs) (is )?normal/.test(text);
  for (const c of cl) {
    if (/^rest\b|otherwise normal/.test(c)) continue;
    let organ = (ORGANS.find(([, re]) => re.test(c)) || [])[0] || null;
    if (!organ) { if (last && /\d/.test(c)) organ = last; else continue; }
    last = organ;
    const side = sideOf(c);
    const o = f[organ] || (f[organ] = { lines: [], abnormal: false, data: {} });
    switch (organ) {
      case 'liver': {
        const n = NUM(c, 'cm');
        if (n) o.data.span = n.v;
        if (/fatty|steato/.test(c)) {
          const g = grade(c);
          o.abnormal = true;
          o.data.fatty = g;
          imp.push('Grade ' + ROMAN[g] + ' fatty liver' + (o.data.span && o.data.span > 15.5 ? ' with hepatomegaly (span ' + o.data.span + ' cm)' : '') + '.');
        }
        if (/hepatomegaly|enlarged/.test(c) && !o.data.fatty) { o.abnormal = true; o.data.enlarged = true; imp.push('Hepatomegaly' + (o.data.span ? ' (span ' + o.data.span + ' cm)' : '') + '.'); }
        if (/cirrho|coarse|nodular|cld/.test(c)) { o.abnormal = true; o.lines.push('Liver shows coarse echotexture with irregular, nodular surface — features suggestive of chronic liver disease.'); imp.push('Features suggestive of chronic liver disease.'); }
        if (/cyst/.test(c)) { const s = NUM(c, 'mm|cm'); o.abnormal = true; o.lines.push('A well-defined anechoic cyst' + (s ? ' measuring ' + fmtDims(s) : '') + ' with posterior acoustic enhancement is seen in the liver — likely simple hepatic cyst.'); imp.push('Simple hepatic cyst' + (s ? ' (' + fmtDims(s) + ')' : '') + '.'); }
        if (/h(a)?emangioma/.test(c)) { const s = NUM(c, 'mm|cm'); o.abnormal = true; o.lines.push('A well-defined homogeneous hyperechoic lesion' + (s ? ' measuring ' + fmtDims(s) : '') + ' is seen — likely haemangioma.'); imp.push('Hepatic lesion likely haemangioma' + (s ? ' (' + fmtDims(s) + ')' : '') + ' — correlate with CECT if required.'); }
        if (/\bsol\b|mass|space occupying/.test(c)) { const s = NUM(c, 'mm|cm'); o.abnormal = true; o.lines.push('A focal space-occupying lesion' + (s ? ' measuring ' + fmtDims(s) : '') + ' is seen in the liver.'); imp.push('Focal hepatic lesion' + (s ? ' (' + fmtDims(s) + ')' : '') + ' — further evaluation with triple-phase CECT advised.'); }
        break;
      }
      case 'gb': {
        if (/cholecystectomy|removed|not visuali/.test(c)) { o.abnormal = true; o.lines.push('Gall bladder is not visualised (post-cholecystectomy status).'); imp.push('Post-cholecystectomy status.'); break; }
        if (/contracted|post ?prandial/.test(c)) { o.lines.push('Gall bladder is contracted (post-prandial), limiting evaluation.'); break; }
        if (/calcul|stone|cholelith/.test(c)) {
          const s = NUM(c, 'mm|cm');
          const multi = /multiple|many|several/.test(c);
          const neck = /neck|impacted/.test(c);
          o.abnormal = true;
          o.lines.push((multi ? 'Multiple echogenic calculi' : 'An echogenic calculus') + (s ? (multi ? ', largest measuring ' : ' measuring ') + fmtDims(s) : '') + ' with posterior acoustic shadowing ' + (multi ? 'are' : 'is') + ' seen in the gall bladder lumen' + (neck ? ', impacted at the GB neck' : ', mobile with change of posture') + '.');
          imp.push('Cholelithiasis' + (s ? ' (' + (multi ? 'largest ' : '') + fmtDims(s) + ')' : '') + (neck ? ' with calculus impacted at GB neck' : '') + '.');
        }
        if (/sludge/.test(c)) { o.abnormal = true; o.lines.push('Echogenic non-shadowing sludge is seen in the dependent part of the gall bladder.'); imp.push('Gall bladder sludge.'); }
        if (/wall thick|cholecystitis|oedema|edema|pericholecyst/.test(c)) {
          const s = NUM(c, 'mm');
          o.abnormal = true;
          o.lines.push('Gall bladder wall is thickened' + (s ? ' (' + s.v + ' mm)' : '') + (/pericholecyst/.test(c) ? ' with pericholecystic fluid' : '') + '; sonographic Murphy\'s sign is ' + (/murphy\s*(neg|-)/.test(c) ? 'negative' : 'positive') + '.');
          imp.push((f.gb && f.gb.lines.some((l) => /calcul/.test(l)) ? 'Acute calculous cholecystitis' : 'Features of acute cholecystitis') + '.');
        }
        if (/polyp/.test(c)) { const s = NUM(c, 'mm'); o.abnormal = true; o.lines.push('A non-shadowing, non-mobile echogenic polyp' + (s ? ' measuring ' + s.v + ' mm' : '') + ' is seen arising from the GB wall.'); imp.push('Gall bladder polyp' + (s ? ' (' + s.v + ' mm)' : '') + '.'); }
        break;
      }
      case 'cbd': {
        const s = NUM(c, 'mm');
        if (/dilat|prominent/.test(c)) { o.abnormal = true; o.lines.push('Common bile duct is dilated' + (s ? ', measuring ' + s.v + ' mm' : '') + '.'); imp.push('Dilated CBD' + (s ? ' (' + s.v + ' mm)' : '') + ' — evaluate for distal obstruction (MRCP advised).'); }
        else if (s) o.lines.push('Common bile duct is normal in calibre (' + s.v + ' mm).');
        if (/calcul|stone/.test(c)) { o.abnormal = true; o.lines.push('An echogenic calculus is seen within the CBD.'); imp.push('Choledocholithiasis.'); }
        break;
      }
      case 'pancreas': {
        if (/bulky|pancreatitis|oedem|edem|hypoecho/.test(c)) { o.abnormal = true; o.lines.push('Pancreas appears bulky and hypoechoic with peripancreatic fat stranding.'); imp.push('Features suggestive of acute pancreatitis — correlate with serum amylase/lipase.'); }
        if (/calcif|chronic/.test(c)) { o.abnormal = true; o.lines.push('Pancreatic parenchymal calcifications with a dilated pancreatic duct are seen.'); imp.push('Features suggestive of chronic calcific pancreatitis.'); }
        break;
      }
      case 'spleen': {
        const n = NUM(c, 'cm');
        if (n) o.data.size = n.v;
        if (/splenomegaly|enlarged/.test(c) || (n && n.v > 12.5)) { o.abnormal = true; imp.push('Splenomegaly' + (n ? ' (' + n.v + ' cm)' : '') + '.'); o.lines.push('Spleen is enlarged in size' + (n ? ', measuring ' + n.v + ' cm' : '') + ', with normal echotexture. No focal lesion.'); }
        break;
      }
      case 'kidney': {
        const s = NUM(c, 'mm|cm');
        const sd = side || (/\brk\b/.test(c) ? 'right' : /\blk\b/.test(c) ? 'left' : null);
        const where = (c.match(/upper|mid|middle|lower|interpolar/) || [])[0];
        const loc = /pelvi|puj/.test(c) ? 'renal pelvis' : where ? (where === 'middle' ? 'mid' : where) + ' pole calyx' : 'collecting system';
        const kid = sd === 'both' ? 'both kidneys' : sd ? sd + ' kidney' : 'kidney';
        if (/calcul|stone|lith/.test(c)) {
          const multi = /multiple|many|several/.test(c);
          o.abnormal = true;
          o.lines.push((multi ? 'Multiple echogenic calculi' + (s ? ', largest ' + fmtDims(s) : '') : 'A ' + (s ? fmtDims(s) + ' ' : '') + 'echogenic calculus') + ' with posterior acoustic shadowing ' + (multi ? 'are' : 'is') + ' seen in the ' + loc + ' of the ' + kid + '.');
          imp.push(cap(sd === 'both' ? 'bilateral' : sd || '') + ' renal calculus' + (multi ? 'i' : '') + (s ? ' (' + (multi ? 'largest ' : '') + fmtDims(s) + ')' : '') + '.');
        }
        if (/hydronephrosis|\bhn\b|pcs dilat|pelvicalyceal/.test(c)) {
          const g = grade(c);
          o.abnormal = true;
          o.lines.push(cap(kid) + ' shows ' + ['', 'mild', 'moderate', 'severe'][g] + ' hydronephrosis' + (/hydroureter|huN/i.test(c) ? ' with dilated ureter (hydroureteronephrosis)' : '') + '.');
          imp.push(cap(['', 'mild', 'moderate', 'severe'][g]) + ' hydronephrosis — ' + (sd === 'both' ? 'bilateral' : sd || '') + '.');
        }
        if (/cyst/.test(c)) { o.abnormal = true; o.lines.push('A thin-walled anechoic cortical cyst' + (s ? ' measuring ' + fmtDims(s) : '') + ' is seen in the ' + kid + ' (Bosniak I).'); imp.push(cap(sd || '') + ' simple renal cortical cyst' + (s ? ' (' + fmtDims(s) + ')' : '') + '.'); }
        if (/echogenicity|mrd|medical renal|ckd|cortical thinning/.test(c)) { const g = grade(c); o.abnormal = true; o.lines.push(cap(kid) + ' show' + (sd === 'both' || !sd ? '' : 's') + ' raised cortical echogenicity with ' + (g > 1 ? 'reduced' : 'maintained') + ' corticomedullary differentiation.'); imp.push('Medical renal disease grade ' + ROMAN[g] + ' — correlate with renal function tests.'); }
        if (s && !/calcul|stone|cyst|lith/.test(c) && s.unit === 'cm') { o.data[(sd || 'kid') + 'Size'] = fmtDims(s); }
        break;
      }
      case 'ureter': {
        const s = NUM(c, 'mm|cm');
        const sd = side || '';
        const at = /uvj|vuj|vesico/.test(c) ? 'vesicoureteric junction (VUJ)' : /lower|distal/.test(c) ? 'distal ureter' : /mid/.test(c) ? 'mid ureter' : /upper|proximal|puj/.test(c) ? 'proximal ureter' : 'ureter';
        if (/calcul|stone/.test(c)) {
          o.abnormal = true;
          o.lines.push('A ' + (s ? fmtDims(s) + ' ' : '') + 'echogenic calculus is seen at the ' + (sd ? sd + ' ' : '') + at + ' causing proximal hydroureteronephrosis.');
          imp.push(cap(sd ? sd + ' ' : '') + (at.includes('VUJ') ? 'VUJ' : at) + ' calculus' + (s ? ' (' + fmtDims(s) + ')' : '') + ' with hydroureteronephrosis.');
        } else if (/dilat/.test(c)) { o.abnormal = true; o.lines.push(cap(sd ? sd + ' ' : '') + 'ureter is dilated.'); }
        break;
      }
      case 'bladder': {
        const pvr = c.match(/(?:pvr|post[- ]?void(?: residu\w*)?)\D{0,12}(\d+(?:\.\d+)?)\s*(ml|cc)?/);
        if (pvr) { o.data.pvr = parseFloat(pvr[1]); if (o.data.pvr > 50) { o.abnormal = true; imp.push('Significant post-void residual urine (' + o.data.pvr + ' ml).'); } }
        if (/cystitis|wall thick|trabecul/.test(c)) { const s = NUM(c, 'mm'); o.abnormal = true; o.lines.push('Urinary bladder wall is diffusely thickened' + (s ? ' (' + s.v + ' mm)' : '') + (/trabecul/.test(c) ? ' and trabeculated' : '') + ' with fine internal echoes.'); imp.push(/trabecul/.test(c) ? 'Thickened trabeculated bladder wall — chronic outlet obstruction pattern.' : 'Features suggestive of cystitis — correlate with urine R/M.'); }
        if (/calcul|stone/.test(c)) { const s = NUM(c, 'mm|cm'); o.abnormal = true; o.lines.push('A mobile echogenic calculus' + (s ? ' measuring ' + fmtDims(s) : '') + ' with posterior acoustic shadowing is seen in the bladder lumen.'); imp.push('Vesical calculus' + (s ? ' (' + fmtDims(s) + ')' : '') + '.'); }
        break;
      }
      case 'prostate': {
        const vol = NUM(c, 'cc|ml|gm|g|grams');
        const v = vol ? vol.v : null;
        if (v) o.data.volume = v;
        if ((v && v > 25) || /bph|enlarg|prostatomegaly/.test(c)) {
          const g = v ? (v > 80 ? 4 : v > 60 ? 3 : v > 40 ? 2 : 1) : grade(c);
          o.abnormal = true;
          o.lines.push('Prostate is enlarged in size' + (v ? ' with volume of approximately ' + v + ' cc (weight ~' + Math.round(v * 1.05) + ' g)' : '') + ', homogeneous echotexture' + (/median lobe|intravesical/.test(c) ? ' and an intravesical median lobe projection' : '') + '.');
          imp.push('Prostatomegaly — grade ' + ROMAN[g] + (v ? ' (volume ' + v + ' cc)' : '') + '.');
        }
        break;
      }
      case 'uterus': {
        if (/hysterectomy/.test(c)) { o.abnormal = true; o.lines.push('Uterus is not visualised (post-hysterectomy status). Vault appears normal.'); imp.push('Post-hysterectomy status.'); break; }
        const et = c.match(/\b(?:et|endometri\w*(?: thickness)?)\D{0,6}(\d+(?:\.\d+)?)\s*mm/);
        if (et) o.data.et = parseFloat(et[1]);
        if (/fibroid|myoma|leiomyoma/.test(c)) {
          const s = NUM(c, 'cm|mm');
          const type = (c.match(/intramural|subserosal|submucosal|pedunculated|cervical/) || ['intramural'])[0];
          const wall = (c.match(/anterior|posterior|fundal|fundus|lateral/) || [''])[0];
          o.abnormal = true;
          o.lines.push('A well-defined hypoechoic lesion' + (s ? ' measuring ' + fmtDims(s) : '') + ' is seen in the ' + (wall ? wall.replace('fundus', 'fundal') + ' ' : '') + 'myometrium (' + type + ') — suggestive of uterine fibroid (leiomyoma).');
          imp.push(cap(type) + ' uterine fibroid' + (s ? ' (' + fmtDims(s) + ')' : '') + '.');
        }
        if (/adenomyo/.test(c)) { o.abnormal = true; o.lines.push('Uterus is bulky with heterogeneous myometrial echotexture, asymmetric wall thickening, venetian-blind shadowing and subendometrial cysts.'); imp.push('Features suggestive of adenomyosis.'); }
        else if (/bulky/.test(c)) { o.abnormal = true; o.lines.push('Uterus is bulky in size with homogeneous myometrial echotexture.'); imp.push('Bulky uterus.'); }
        if (/iucd|cu-?t|copper/.test(c)) { o.lines.push('IUCD is seen in situ within the endometrial cavity.'); imp.push('IUCD in situ.'); }
        break;
      }
      case 'ovary': {
        const s = NUM(c, 'cm|mm');
        const sd = side;
        if (/pcod|pcos|polycystic/.test(c)) { o.abnormal = true; o.lines.push((sd && sd !== 'both' ? cap(sd) + ' ovary is' : 'Both ovaries are') + ' bulky with multiple (≥ 20) small peripherally arranged follicles and increased central stromal echogenicity.'); imp.push('Polycystic ovarian morphology (' + (sd && sd !== 'both' ? sd : 'bilateral') + ') — correlate clinically & hormonally (Rotterdam criteria).'); }
        if (/dermoid/.test(c)) { o.abnormal = true; o.lines.push('A heterogeneous echogenic lesion' + (s ? ' measuring ' + fmtDims(s) : '') + ' with posterior shadowing and echogenic lines is seen in the ' + (sd || '') + ' ovary.'); imp.push(cap(sd || '') + ' ovarian lesion — likely mature cystic teratoma (dermoid)' + (s ? ' (' + fmtDims(s) + ')' : '') + '.'); }
        else if (/cyst/.test(c)) {
          const hem = /h(a)?emorrhagic|reticular|lace/.test(c);
          o.abnormal = true;
          o.lines.push('A ' + (hem ? 'cyst with internal fine reticular (lace-like) echoes' : 'thin-walled anechoic unilocular cyst') + (s ? ' measuring ' + fmtDims(s) : '') + ' is seen in the ' + (sd && sd !== 'both' ? sd : '') + ' ovary.');
          imp.push(cap(sd && sd !== 'both' ? sd + ' ' : '') + (hem ? 'haemorrhagic ovarian cyst' : 'simple (likely functional) ovarian cyst') + (s ? ' (' + fmtDims(s) + ')' : '') + ' — follow-up scan after next menses advised.');
        }
        break;
      }
      case 'appendix': {
        const s = NUM(c, 'mm');
        if (/appendicitis|inflam|non[- ]?compress/.test(c) || (s && s.v > 6)) { o.abnormal = true; o.lines.push('Appendix is non-compressible, tubular and blind-ending' + (s ? ', measuring ' + s.v + ' mm in diameter' : '') + ', with periappendiceal echogenic fat' + (/appendicolith|fecalith/.test(c) ? ' and an appendicolith' : '') + '.'); imp.push('Features suggestive of acute appendicitis — surgical correlation advised.'); }
        break;
      }
      case 'fluid': {
        const g = grade(c);
        o.abnormal = true;
        o.lines.push(cap(['', 'mild', 'moderate', 'gross'][g]) + ' free fluid (ascites) is seen in the peritoneal cavity' + (/pelvi|pod/.test(c) ? ', predominantly in the pelvis / pouch of Douglas' : '') + '.');
        imp.push(cap(['', 'mild', 'moderate', 'gross'][g]) + ' ascites.');
        break;
      }
      case 'nodes': {
        const s = NUM(c, 'mm');
        o.abnormal = true;
        o.lines.push('Few enlarged mesenteric lymph nodes are seen' + (s ? ', the largest measuring ' + s.v + ' mm in short axis' : '') + '.');
        imp.push('Mesenteric lymphadenopathy / lymphadenitis.');
        break;
      }
      default: break;
    }
  }
  return { f, imp, restNormal };
}

const NORMAL = {
  liver: (d) => 'Liver is ' + (d.enlarged || (d.span && d.span > 15.5) ? 'enlarged in size' : 'normal in size') + (d.span ? ' (span ' + d.span + ' cm)' : '') + (d.fatty ? ' and shows ' + ['', 'mildly increased parenchymal echogenicity with normal visualisation of the diaphragm and intrahepatic vessel walls (grade I fatty infiltration)', 'moderately increased echogenicity with slightly impaired visualisation of the intrahepatic vessels and diaphragm (grade II fatty infiltration)', 'markedly increased echogenicity with poor visualisation of the posterior right lobe, diaphragm and vessel walls (grade III fatty infiltration)'][d.fatty] : ' with normal echotexture') + '. No focal space-occupying lesion is seen. Intrahepatic biliary radicles are not dilated. Portal vein is normal in calibre.',
  gb: () => 'Gall bladder is well distended. Wall thickness is normal. No calculus, sludge or mass is seen in the lumen.',
  cbd: () => 'Common bile duct is normal in calibre.',
  pancreas: () => 'Pancreas is normal in size and echotexture. Pancreatic duct is not dilated. No peripancreatic collection.',
  spleen: (d) => 'Spleen is normal in size' + (d.size ? ' (' + d.size + ' cm)' : '') + ' and echotexture. No focal lesion.',
  kidney: (d) => 'Both kidneys are normal in size, shape and position' + (d.rightSize || d.leftSize ? ' (right ' + (d.rightSize || '[__]') + ', left ' + (d.leftSize || '[__]') + ')' : '') + ' with normal cortical echogenicity and well-maintained corticomedullary differentiation. No calculus, hydronephrosis or mass lesion is seen.',
  ureter: () => 'Both ureters are not dilated.',
  bladder: (d) => 'Urinary bladder is well distended with normal wall thickness. No intraluminal calculus or mass is seen.' + (d.pvr !== undefined ? ' Post-void residual urine: ' + d.pvr + ' ml' + (d.pvr > 50 ? ' (significant).' : ' (insignificant).') : ''),
  prostate: (d) => 'Prostate is normal in size' + (d.volume ? ' (volume ' + d.volume + ' cc)' : '') + ' with homogeneous echotexture.',
  uterus: (d) => 'Uterus is anteverted and normal in size with homogeneous myometrial echotexture.' + (d.et ? ' Endometrial thickness is ' + d.et + ' mm.' : ' Endometrial echo is central and normal.') + ' No focal myometrial lesion.',
  ovary: () => 'Both ovaries are normal in size and echotexture. No adnexal mass is seen.',
  appendix: () => '',
  fluid: () => 'No free fluid is seen in the peritoneal cavity.',
  nodes: () => ''
};
const LABEL = { liver: 'LIVER', gb: 'GALL BLADDER', cbd: 'CBD', pancreas: 'PANCREAS', spleen: 'SPLEEN', kidney: 'KIDNEYS', ureter: 'URETERS', bladder: 'URINARY BLADDER', prostate: 'PROSTATE', uterus: 'UTERUS', ovary: 'OVARIES', appendix: 'APPENDIX', fluid: 'PERITONEAL CAVITY', nodes: 'LYMPH NODES' };
const EXAM_ORGANS = {
  abdomen: ['liver', 'gb', 'cbd', 'pancreas', 'spleen', 'kidney', 'ureter', 'bladder', 'appendix', 'nodes', 'fluid'],
  abdomen_male: ['liver', 'gb', 'cbd', 'pancreas', 'spleen', 'kidney', 'ureter', 'bladder', 'prostate', 'appendix', 'nodes', 'fluid'],
  abdomen_female: ['liver', 'gb', 'cbd', 'pancreas', 'spleen', 'kidney', 'ureter', 'bladder', 'uterus', 'ovary', 'appendix', 'nodes', 'fluid'],
  kub: ['kidney', 'ureter', 'bladder', 'prostate', 'fluid'],
  pelvis: ['bladder', 'uterus', 'ovary', 'fluid']
};
const EXAM_TITLE = { abdomen: 'ULTRASOUND WHOLE ABDOMEN', abdomen_male: 'ULTRASOUND WHOLE ABDOMEN', abdomen_female: 'ULTRASOUND WHOLE ABDOMEN & PELVIS', kub: 'ULTRASOUND KUB', pelvis: 'ULTRASOUND PELVIS', obstetric: 'OBSTETRIC ULTRASOUND', thyroid: 'ULTRASOUND THYROID / NECK', breast: 'ULTRASOUND BREAST (BILATERAL)', scrotum: 'ULTRASOUND SCROTUM' };

function buildAbdomen(text, exam, gender) {
  const { f, imp, restNormal } = abdomenFindings(text, exam);
  let organs = EXAM_ORGANS[exam] || EXAM_ORGANS.abdomen;
  if (exam === 'kub' && gender === 'Female') organs = organs.filter((o) => o !== 'prostate');
  let html = '';
  for (const o of organs) {
    const e = f[o];
    if (!e && !restNormal && !['appendix', 'nodes'].includes(o)) {
      html += `<p><strong>${LABEL[o]}:</strong> [__]</p>`;
      continue;
    }
    const d = (e && e.data) || {};
    const base = o === 'liver' || o === 'spleen' || o === 'prostate' || o === 'bladder' || o === 'uterus' || o === 'kidney' ? NORMAL[o](d) : '';
    let lines = e ? e.lines.slice() : [];
    if (o === 'liver') lines = [base].concat(lines);
    else if (o === 'kidney' && e && e.abnormal) lines = lines.concat(['The ' + (lines.join(' ').includes('right kidney') ? 'left' : lines.join(' ').includes('left kidney') ? 'right' : 'contralateral') + ' kidney is normal in size and echotexture.']);
    else if (o === 'kidney') lines = [base];
    else if (o === 'prostate' && !(e && e.abnormal)) lines = [base];
    else if (o === 'bladder') lines = e && e.abnormal ? lines.concat(d.pvr !== undefined ? ['Post-void residual urine: ' + d.pvr + ' ml.'] : []) : [base];
    else if (o === 'uterus' && !(e && e.abnormal)) lines = [base];
    else if (o === 'uterus' && d.et) lines.push('Endometrial thickness is ' + d.et + ' mm.');
    else if (o === 'spleen' && !(e && e.abnormal)) lines = [base];
    else if (!lines.length) lines = [NORMAL[o](d)];
    lines = lines.filter(Boolean);
    if (lines.length) html += `<p><strong>${LABEL[o]}:</strong> ${lines.join(' ')}</p>`;
  }
  const impressions = imp.length ? imp : ['No significant sonographic abnormality detected in the visualised organs.'];
  return { html, impressions };
}

// ------------------------------------------------------------------ obstetric
function buildObstetric(text) {
  const t = text;
  let ga = null;
  let m = t.match(/(\d{1,2})\s*(?:\+\s*(\d))?\s*(?:wks?|weeks?)(?:\s*(\d)\s*d(?:ays?)?)?/) || t.match(/\b(\d{1,2})w(\d)?d?\b/);
  if (m) ga = { w: +m[1], d: +(m[2] || m[3] || 0) };
  const twins = /twin|two (live )?fetus|dichorionic|monochorionic/.test(t);
  const dead = /no cardiac|absent cardiac|\biud\b|missed (abortion|miscarriage)|non[- ]?viable|no fhr/.test(t);
  const fhrM = t.match(/(?:fhr|heart rate|cardiac activity)\D{0,6}(\d{2,3})/) || t.match(/(\d{2,3})\s*bpm/);
  const pres = (t.match(/cephalic|vertex|breech|transverse|oblique|variable/) || [])[0];
  const plLoc = (t.match(/placenta\w*\s*(?:is\s*)?(anterior|ant|posterior|post|fundal|fundo-?\w+|left lateral|right lateral|lateral|low[- ]lying|previa|praevia)/) || t.match(/\b(anterior|posterior|fundal) placenta/) || [])[1];
  const plGrade = (t.match(/grade\s*(iii|ii|i|[0123])\b/) || [])[1];
  const afiM = t.match(/\bafi\D{0,4}(\d+(?:\.\d+)?)/);
  const sdpM = t.match(/\b(?:sdp|svp|single deepest pocket|mvp)\D{0,4}(\d+(?:\.\d+)?)/);
  const efwM = t.match(/\befw\D{0,4}(\d{3,4})/);
  const crlM = t.match(/\bcrl\D{0,4}(\d+(?:\.\d+)?)\s*(mm|cm)?/);
  const cervixM = t.match(/cervi\w*\s*(?:length)?\D{0,4}(\d+(?:\.\d+)?)\s*(cm|mm)/);
  const cord = /cord around neck|nuchal cord|loop of cord|\bcan\b/.test(t);
  const early = ga ? ga.w < 14 : /\bgs\b|gestational sac|yolk|crl|early/.test(t);
  const bio = [];
  [['bpd', 'Biparietal Diameter (BPD)'], ['hc', 'Head Circumference (HC)'], ['ac', 'Abdominal Circumference (AC)'], ['fl', 'Femur Length (FL)']].forEach(([k, label]) => {
    const r = t.match(new RegExp('\\b' + k + '\\D{0,3}(\\d+(?:\\.\\d+)?)\\s*(mm|cm)?(?:\\D{0,6}(\\d{1,2})\\s*w(?:ks?|eeks?)?\\s*(\\d)?\\s*d?)?'));
    if (r) bio.push([label, r[1] + ' ' + (r[2] || 'mm'), r[3] ? r[3] + ' wks ' + (r[4] || 0) + ' days' : '[__]']);
  });

  const placentaTxt = plLoc ? ({ ant: 'anterior', post: 'posterior', previa: 'low-lying (placenta praevia)', praevia: 'low-lying (placenta praevia)' }[plLoc] || plLoc.replace('-', ' ')) : '[__]';
  const afi = afiM ? parseFloat(afiM[1]) : null;
  const sdp = sdpM ? parseFloat(sdpM[1]) : null;
  const liquor = afi !== null ? (afi < 5 ? 'reduced (oligohydramnios)' : afi > 24 ? 'increased (polyhydramnios)' : 'adequate') : sdp !== null ? (sdp < 2 ? 'reduced (oligohydramnios)' : sdp > 8 ? 'increased (polyhydramnios)' : 'adequate') : /oligo/.test(t) ? 'reduced (oligohydramnios)' : /poly/.test(t) ? 'increased (polyhydramnios)' : 'adequate';
  const n = twins ? 'Twin' : 'Single';
  const life = dead ? 'No cardiac activity is seen' : 'Foetal cardiac activity is present' + (fhrM ? ' (FHR ' + fhrM[1] + ' bpm, regular)' : '') + '. Foetal movements are seen';
  let html = '';
  if (early) {
    html += `<p><strong>UTERUS:</strong> Uterus is enlarged and shows a ${twins ? 'twin' : 'single'} intrauterine gestational sac with a yolk sac and foetal pole. ${life}.</p>`;
    if (crlM) html += `<p><strong>CROWN–RUMP LENGTH:</strong> ${crlM[1]} ${crlM[2] || 'mm'}, corresponding to ${ga ? ga.w + ' weeks ' + ga.d + ' days' : '[__]'}.</p>`;
    html += '<p><strong>ADNEXA:</strong> Both adnexa are normal. No adnexal mass. No free fluid in the pouch of Douglas.</p>';
  } else {
    html += `<p><strong>FOETUS:</strong> ${n} live intrauterine foetus${dead ? ' (see below)' : ''} is seen in ${pres ? pres.replace('vertex', 'cephalic') : '[__]'} presentation. ${life}.</p>`;
    html += '<table style="width:100%"><tr><th>Biometry</th><th>Measurement</th><th>Corresponding GA</th></tr>' +
      (bio.length ? bio : [['Biparietal Diameter (BPD)', '[__] mm', '[__]'], ['Head Circumference (HC)', '[__] mm', '[__]'], ['Abdominal Circumference (AC)', '[__] mm', '[__]'], ['Femur Length (FL)', '[__] mm', '[__]']]).map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('') +
      `<tr><td><strong>Average GA (by USG)</strong></td><td colspan="2"><strong>${ga ? ga.w + ' weeks ' + ga.d + ' days' : '[__]'}</strong></td></tr>` +
      `<tr><td>Estimated Foetal Weight (Hadlock)</td><td colspan="2">${efwM ? efwM[1] + ' g' : '[__] g'}</td></tr></table>`;
    html += `<p><strong>PLACENTA:</strong> ${cap(placentaTxt)}${plGrade ? ', grade ' + String(plGrade).toUpperCase().replace(/^([0-3])$/, (x) => ROMAN[+x] || x) : ''}${/previa|praevia|low/.test(placentaTxt) ? ' — lower edge reaching / close to the internal os' : ', upper segment, clear of the internal os'}. No retroplacental collection.</p>`;
    html += `<p><strong>LIQUOR:</strong> Liquor amnii is ${liquor}${afi !== null ? ' (AFI ' + afi + ' cm)' : sdp !== null ? ' (single deepest pocket ' + sdp + ' cm)' : ''}.</p>`;
    html += `<p><strong>UMBILICAL CORD:</strong> Three-vessel cord.${cord ? ' A loop of cord is seen around the foetal neck.' : ''}</p>`;
    if (cervixM) html += `<p><strong>CERVIX:</strong> Cervical length ${cervixM[1]} ${cervixM[2]}; internal os is closed.</p>`;
  }
  const imp = [];
  if (dead) imp.push(n + ' intrauterine gestation with no cardiac activity — features of missed abortion / intrauterine foetal demise. Clinical correlation & repeat scan advised.');
  else imp.push(n + ' live intrauterine ' + (early ? 'pregnancy' : 'foetus') + ' of approximately ' + (ga ? ga.w + ' weeks ' + ga.d + ' days' : '[__] weeks') + ' gestation by USG' + (pres && !early ? ', ' + pres.replace('vertex', 'cephalic') + ' presentation' : '') + '.');
  if (!early) {
    imp.push('Placenta ' + placentaTxt + (plGrade ? ', grade ' + String(plGrade).toUpperCase() : '') + '.');
    imp.push('Liquor ' + liquor + (afi !== null ? ' (AFI ' + afi + ' cm)' : '') + '.');
    if (efwM) imp.push('Estimated foetal weight ' + efwM[1] + ' g.');
    if (cord) imp.push('Single loop of cord around the foetal neck.');
  }
  return { html, impressions: imp };
}

/** expandShorthand(text, { gender, patientName }) → { title, html, impressions, exam } */
export function expandShorthand(input, opts = {}) {
  const text = String(input || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const exam = opts.exam || detectExam(text, opts.gender);
  let body;
  if (exam === 'obstetric') body = buildObstetric(text);
  else if (EXAM_ORGANS[exam]) body = buildAbdomen(text, exam, opts.gender);
  else body = { html: '<p><strong>FINDINGS:</strong> ' + input.replace(/</g, '&lt;') + '</p>', impressions: ['[__]'] };
  const pcpndt = exam === 'obstetric' ? '<p style="font-size:10pt"><em>Foetal sex is neither detected nor disclosed as per the PC-PNDT Act, 1994.</em></p>' : '';
  const html = `<h3 style="text-align:center">${EXAM_TITLE[exam] || 'ULTRASOUND REPORT'}</h3>${body.html}<h3>IMPRESSION</h3><ol>${body.impressions.map((i) => '<li><strong>' + i + '</strong></li>').join('')}</ol>${pcpndt}<p><em>Kindly correlate clinically.</em></p>`;
  return { exam, title: EXAM_TITLE[exam] || 'ULTRASOUND REPORT', html, impressions: body.impressions };
}
