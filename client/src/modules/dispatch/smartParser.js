// Smart attachment parser for imported / uploaded reports: extracts the document text, detects the
// report category (USG / Pathology / Biochemistry / X-Ray / ECG), the investigations named in it,
// phone numbers / e-mails, and ranks registered patients by how well they match (mobile, Reg. ID,
// name in subject / file name / text, recent visit).
import { store } from '../../core/store';
import { fileToHtml } from '../../core/importers';
import { stripHtml, fullName } from '../../core/utils';
import { fileBlob } from './outputs';

const KEYWORDS = {
  USG: [/\bultra\s*sound\b/i, /\bsonograph/i, /\busg\b/i, /\bdoppler\b/i, /\becho\s*texture\b/i, /\bechogenic/i, /\bgestation/i, /\bfoet|\bfet(al|us)\b/i, /\bhydronephrosis\b/i, /\bcbd\b/i, /\bgall\s*bladder\b/i, /\bendometri/i, /\bovar(y|ies)\b/i],
  Pathology: [/\bha?emogram\b|\bblood\s*count\b/i, /\bha?emoglobin\b/i, /\bcbc\b/i, /\bplatelet/i, /\btlc\b/i, /\bdlc\b/i, /\besr\b/i, /\burine\b/i, /\bstool\b/i, /\bwidal\b/i, /\bmalaria\b/i, /\bblood\s*group/i, /\bsmear\b/i, /\bculture\b/i, /\bdengue\b/i, /\bhistopath/i, /\bcytolog/i, /\bfnac\b/i],
  Biochemistry: [/\bthyroid\b/i, /\bliver\s*function\b|\blft\b/i, /\bkidney\s*function\b|\brenal\s*function\b|\bkft\b|\brft\b/i, /\bbilirubin\b/i, /\bsgpt\b|\balt\b/i, /\bsgot\b|\bast\b/i, /\bcreatinine\b/i, /\burea\b/i, /\bcholesterol\b/i, /\btriglyceride/i, /\btsh\b/i, /\bt3\b|\bt4\b/i, /\bhba1c\b/i, /\bglucose\b|\bblood\s*sugar\b/i, /\buric\s*acid\b/i, /\belectrolyte/i, /\bsodium\b|\bpotassium\b/i, /\bvitamin\b/i, /\blipid\b/i],
  'X-Ray': [/\bx[\s-]?ray\b/i, /\bradiograph/i, /\bskiagram\b/i, /\bchest\s*p\.?a\b/i, /\bap\s*view\b/i],
  ECG: [/\becg\b|\bekg\b/i, /\belectrocardiogra/i, /\bsinus\s*rhythm\b/i, /\bqrs\b/i]
};

export function detectCategory(text) {
  const scores = {};
  for (const [cat, list] of Object.entries(KEYWORDS)) scores[cat] = list.reduce((s, re) => s + (re.test(text) ? 1 : 0), 0);
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return { category: best && best[1] > 0 ? best[0] : 'Other', scores };
}

export function detectContacts(text) {
  const mobiles = Array.from(new Set((String(text).match(/(?:\+?91[\s-]?)?\b[6-9]\d{9}\b/g) || []).map((m) => m.replace(/\D/g, '').slice(-10))));
  const emails = Array.from(new Set(String(text).match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []));
  return { mobiles, emails };
}

/** Investigations from the tariff master whose name / short name appears in the text. */
export function detectTests(text) {
  const t = String(text).toLowerCase();
  const out = [];
  store.list('tests').forEach((x) => {
    const core = String(x.name || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const names = [x.name, core.length >= 6 ? core : '', x.shortName].filter((n) => n && n.length >= 3);
    if (names.some((n) => { const k = n.toLowerCase(); return k.length > 4 ? t.includes(k) : new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '\\b').test(t); })) out.push(x);
  });
  return out.slice(0, 8);
}

const norm = (s) => String(s || '').toLowerCase().replace(/^(mr|mrs|ms|smt|shri|sh|master|baby|dr|miss)\.?\s+/i, '').replace(/[^a-zऀ-ॿ\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** Ranked patient candidates: [{ patient, score, reasons }] */
export function matchPatients(text, { subject = '', filename = '', at = Date.now() } = {}) {
  const hay = norm([subject, filename.replace(/[_.-]+/g, ' '), text].join(' \n '));
  const head = norm([subject, filename.replace(/[_.-]+/g, ' ')].join(' '));
  const { mobiles } = detectContacts([subject, filename, text].join(' '));
  const regIds = (String([subject, filename, text].join(' ')).match(/SSDC-P-\d{3,}/gi) || []).map((x) => x.toUpperCase());
  const visits = store.list('visits');
  const recent = new Set(visits.filter((v) => Math.abs((v.createdAt || 0) - at) < 10 * 86400000).map((v) => v.patientId));
  const out = [];
  store.list('patients').forEach((p) => {
    let score = 0;
    const reasons = [];
    if (p.regId && regIds.includes(String(p.regId).toUpperCase())) { score += 120; reasons.push('Reg. ID ' + p.regId); }
    if (p.mobile && mobiles.includes(String(p.mobile).slice(-10))) { score += 100; reasons.push('mobile ' + p.mobile); }
    const n = norm(p.name);
    if (n.length >= 3) {
      if (head.includes(n)) { score += 70; reasons.push('name in subject / file name'); }
      else if (hay.includes(n)) { score += 55; reasons.push('name in report'); }
      else {
        const parts = n.split(' ').filter((w) => w.length >= 3);
        if (parts.length >= 2 && parts.every((w) => new RegExp('\\b' + w + '\\b').test(hay))) { score += 35; reasons.push('name words'); }
      }
    }
    if (score > 0 && recent.has(p.id)) { score += 15; reasons.push('visited recently'); }
    if (score >= 35) out.push({ patient: p, score, reasons });
  });
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

/** Full parse of a stored file (text extraction may take a moment for PDFs). */
export async function parseFile(f, meta = {}) {
  let text = '';
  try {
    const blob = await fileBlob(f);
    if (/^image\//.test(f.mime || '')) text = '';
    else text = stripHtml((await fileToHtml(new File([blob], f.name || 'document', { type: blob.type }))).html || '');
  } catch (e) { text = ''; }
  const subject = meta.subject || f.emailSubject || '';
  const all = [subject, f.name, text].join('\n');
  const cat = detectCategory(all);
  return {
    text, category: cat.category, scores: cat.scores, tests: detectTests(all), contacts: detectContacts(all),
    candidates: matchPatients(text, { subject, filename: f.name || '', at: meta.at || f.createdAt || Date.now() })
  };
}

export const patientLabel = (p) => [fullName(p), p.regId, p.mobile].filter(Boolean).join(' · ');
