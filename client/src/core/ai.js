// Google Gemini client. Uses the clinic server proxy (key stays on the server) when available,
// otherwise a browser-stored key. The Copilot offers the models below; Settings also lists live
// (models.list) whatever else your key can use, and any model id can be typed there.
import { api, net } from './sync';
import { lsGet, lsSet } from './utils';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Models offered in the Copilot picker, fastest first. */
export const GEMINI_MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', note: 'Fast, everyday reports' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', note: 'Deeper reasoning (preview)' },
  { id: 'gemini-4-argon', label: 'Gemini 4 Argon', note: 'Flagship reasoning, slowest' }
];
export const DEFAULT_MODEL = GEMINI_MODELS[0].id;
/** Gemini 2.5 Flash / Flash-Lite are no longer offered; saved choices move to the default. */
const RETIRED = /^(models\/)?gemini-(2\.5-flash(-lite)?(-preview[\w.-]*)?|flash-lite-latest)$/i;
export const isRetiredModel = (m) => RETIRED.test(String(m || '').trim());
export const normalizeModel = (m) => (!m || isRetiredModel(m) ? DEFAULT_MODEL : String(m).trim().replace(/^models\//, ''));
export const modelLabel = (id) => { const m = GEMINI_MODELS.find((x) => x.id === id); return m ? m.label : id; };

export function aiConfig() {
  const c = Object.assign({ apiKey: '', model: DEFAULT_MODEL, deepThink: false, useServer: true, temperature: 0.3 }, lsGet('ssdc-ai', {}));
  c.model = normalizeModel(c.model);
  return c;
}
export function setAiConfig(patch) { lsSet('ssdc-ai', Object.assign(aiConfig(), patch)); }

export async function aiAvailability() {
  const cfg = aiConfig();
  if (net.mode === 'server' && cfg.useServer !== false) {
    try {
      const s = await api('ai/status');
      if (s.configured) return { ok: true, via: 'server', model: cfg.model || s.model };
    } catch (e) { /* not available */ }
  }
  if (cfg.apiKey) return { ok: true, via: 'browser', model: cfg.model };
  return { ok: false, via: null, model: cfg.model };
}

async function call(via, model, request) {
  if (via === 'server') return api('ai/generate', { method: 'POST', body: { model, request }, timeout: 240000 });
  const cfg = aiConfig();
  const r = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey }, body: JSON.stringify(request)
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((b.error && b.error.message) || 'Gemini request failed (' + r.status + ')'); e.status = r.status; throw e; }
  return b;
}

/** gemini({ prompt, system, parts, json, temperature, model, deepThink }) → text */
export async function gemini({ prompt, system, parts, json, temperature, model, deepThink, maxTokens } = {}) {
  const avail = await aiAvailability();
  if (!avail.ok) throw new Error('Gemini is not configured. Add an API key in Settings → AI & Gemini (or set GEMINI_API_KEY on the server).');
  const cfg = aiConfig();
  const m = normalizeModel(model || cfg.model || avail.model);
  const request = {
    contents: [{ role: 'user', parts: (parts || []).concat(prompt ? [{ text: prompt }] : []) }],
    generationConfig: { temperature: temperature === undefined ? cfg.temperature : temperature }
  };
  if (maxTokens) request.generationConfig.maxOutputTokens = maxTokens;
  if (system) request.systemInstruction = { parts: [{ text: system }] };
  if (json) request.generationConfig.responseMimeType = 'application/json';
  const think = deepThink === undefined ? cfg.deepThink : deepThink;
  if (think) {
    if (/^gemini-[3-9]/.test(m)) request.generationConfig.thinkingConfig = { thinkingLevel: 'high' };
    else request.generationConfig.thinkingConfig = { thinkingBudget: -1 };
  }
  let res;
  try { res = await call(avail.via, m, request); } catch (e) {
    if (request.generationConfig.thinkingConfig && /think/i.test(e.message)) { delete request.generationConfig.thinkingConfig; res = await call(avail.via, m, request); } else throw e;
  }
  const cand = res.candidates && res.candidates[0];
  const text = cand && cand.content && cand.content.parts ? cand.content.parts.filter((p) => !p.thought).map((p) => p.text || '').join('') : '';
  if (!text) {
    const reason = (res.promptFeedback && res.promptFeedback.blockReason) || (cand && cand.finishReason) || '';
    throw new Error('Gemini returned no text' + (reason ? ' (' + reason + ')' : ''));
  }
  return text;
}

export async function listModels() {
  const avail = await aiAvailability();
  if (!avail.ok) throw new Error('Configure a Gemini API key first');
  if (avail.via === 'server') return (await api('ai/models')).models;
  const r = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': aiConfig().apiKey } });
  const b = await r.json();
  if (!r.ok) throw new Error((b.error && b.error.message) || 'models.list failed');
  return (b.models || []).filter((x) => (x.supportedGenerationMethods || []).includes('generateContent') && !isRetiredModel(x.name)).map((x) => ({ id: x.name.replace(/^models\//, ''), displayName: x.displayName, inputTokenLimit: x.inputTokenLimit, outputTokenLimit: x.outputTokenLimit, thinking: !!x.thinking }));
}

export function extractJson(text) {
  const t = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch (e) { /* try substring */ }
  const m = t.match(/[[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch (e) { /* ignore */ } }
  throw new Error('Could not parse JSON from Gemini response');
}

export const stripFences = (s) => String(s || '').replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim();

const PCPNDT = 'STRICT RULE (PC-PNDT Act, 1994, India): never state, hint at or infer the sex/gender of a foetus in any form. If asked, refuse that part and add: "Foetal sex is not determined or disclosed as per the PC-PNDT Act."';

export const SYSTEM = {
  radiologist: `You are an experienced consultant radiologist & sonologist (MBBS, DMRD) reporting at a diagnostic centre in Rajasthan, India.
Write formal, concise ultrasound / radiology reports in Indian clinical English using standard nomenclature (ACR, AIUM, ISUOG, ACR TI-RADS, ACR BI-RADS, SRU consensus).
Output clean HTML only (no markdown, no <html>/<body>): <h3> for organ/section headings, <p> paragraphs, <table> with <tr><th>/<td> for biometry & Doppler values, <ul> for lists.
Sections: FINDINGS (organ by organ), IMPRESSION (numbered, most significant first) and, when useful, DIFFERENTIAL DIAGNOSIS and ADVICE / RECOMMENDATION.
Never alter numbers, units, decimal points or gestational ages given by the doctor. Never invent measurements — use [__] placeholders where a value is needed but not supplied.
Organs not mentioned in the notes may be described as normal only when the notes say "rest normal" or similar; otherwise leave a [__] placeholder.
${PCPNDT}`,
  proofreader: `You are a real-time clinical sonography proofreader and medical lexical engine embedded inside an ultrasound reporting editor. Your task is to automatically correct spelling, grammar, punctuation, and phonetic voice-dictation errors in raw ultrasound notes while strictly preserving clinical meaning and measurements.
Rules:
1. Domain Specificity: Prioritize standard radiological and sonographic nomenclature (ACR, AIUM, ISUOG guidelines). Automatically correct phonetic misspellings of anatomical structures, pathologies, and Doppler parameters.
2. Custom Dictionary Adherence: Always cross-reference the user's injected [CUSTOM_DICTIONARY] JSON object. Never flag custom-defined terms as errors, and apply their defined casing and formatting rules.
3. Measurement Integrity: Never alter numerical values, gestational ages, decimal points, or units of measurement (mm, cm, cm/s, weeks/days).
4. Output Format: Return only the corrected clinical text (or a structured JSON diff of corrections if requested by the frontend) with zero conversational filler.`,
  patient: `You explain diagnostic reports to patients in simple, kind, non-alarming language (reading age ~12). Do not add new diagnoses, do not give drug doses, and always advise the patient to discuss the report with their referring doctor. ${PCPNDT}`
};

export const PROMPTS = {
  expand: (notes, ctx = {}) => `Convert the following rough sonography notes into a complete, detailed, formal ultrasound report.
Examination: ${ctx.exam || 'as appropriate from the notes'}
Patient: ${ctx.patient || 'not specified'}
Clinical indication: ${ctx.indication || 'not specified'}
Explain each finding in a full sentence, include a measurement table where measurements are given, then give IMPRESSION, overall CONCLUSION, possible diagnosis and DIFFERENTIAL DIAGNOSIS, and ADVICE.

ROUGH NOTES:
${notes}`,
  impression: (findings) => `Write only the IMPRESSION section (numbered HTML list inside <ol>) for these ultrasound findings. Most significant finding first, concise, standard terminology, include sizes already stated.

FINDINGS:
${findings}`,
  differential: (findings) => `Based on these ultrasound findings give: (1) a short overall conclusion, (2) the most likely diagnosis, (3) a ranked differential diagnosis with one-line reasoning each, (4) suggested further evaluation. HTML only.

FINDINGS:
${findings}`,
  proofreadJson: (text, dict) => `[CUSTOM_DICTIONARY]: ${JSON.stringify(dict || [])}
Return a JSON array (no prose) of corrections for the text below, each item {"original": "...", "suggestion": "...", "reason": "spelling|grammar|dictation|terminology"}. "original" must be an exact substring of the text. Return [] if nothing needs correction.

TEXT:
${text}`,
  proofreadText: (text, dict) => `[CUSTOM_DICTIONARY]: ${JSON.stringify(dict || [])}
Return only the corrected text.

TEXT:
${text}`,
  patientSummary: (report, lang) => `Write a short patient-friendly summary (max 120 words) of this report in ${lang || 'simple English'}. Use 3–5 bullet points, then one line advising follow-up with the referring doctor. Plain text with "•" bullets (suitable for WhatsApp).

REPORT:
${report}`,
  rewrite: (text, instruction) => `${instruction}

TEXT:
${text}

Return HTML only.`
};

export const DEFAULT_GEMS = [
  { id: 'gem_abdomen', name: 'Abdomen & KUB Gem', prompt: 'Act as an abdominal imaging specialist. Grade fatty liver (I–III), describe calculi with size/location/shadowing, grade hydronephrosis (SFU), estimate prostate volume (L×W×H×0.52) and PVR significance.' },
  { id: 'gem_obs', name: 'Obstetric & Fetal Medicine Gem', prompt: 'Act as a fetal medicine specialist (ISUOG). Report biometry (BPD, HC, AC, FL) with GA & percentiles if supplied, EFW (Hadlock), AFI/SDP interpretation, placenta, cord, BPP and Doppler (UA PI, MCA PI, CPR). Never mention foetal sex.' },
  { id: 'gem_tirads', name: 'Thyroid ACR TI-RADS Gem', prompt: 'Score every thyroid nodule with ACR TI-RADS: composition, echogenicity, shape, margin, echogenic foci; give TR category and FNA / follow-up recommendation by size.' },
  { id: 'gem_birads', name: 'Breast ACR BI-RADS Gem', prompt: 'Describe breast lesions with the ACR BI-RADS ultrasound lexicon (shape, orientation, margin, echo pattern, posterior features, calcifications, vascularity) and assign a BI-RADS category with management.' },
  { id: 'gem_doppler', name: 'Vascular Doppler Gem', prompt: 'Act as a vascular sonologist. Use SRU consensus criteria for carotid stenosis (PSV, EDV, ICA/CCA ratio), describe DVT (compressibility, flow, thrombus age) and arterial waveforms (tri/bi/monophasic, PSV ratios).' }
];
