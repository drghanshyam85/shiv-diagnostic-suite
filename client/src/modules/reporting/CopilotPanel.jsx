// Copilot side panel (Google Gemini + offline engine): rough notes → full report, impression,
// differential, AI proofread with accept / reject, rewrite selection, multilingual patient summary,
// Ask Copilot chat, Ultrasound Gems, image insight, context files, Chrome search & Google ecosystem links.
import { useEffect, useRef, useState } from 'react';
import { Wand2, Stethoscope, BrainCircuit, SpellCheck, Sparkles, Languages, MessageSquare, Gem, ScanEye, HardDrive, Search, Loader2, Check, X, Copy, Send, Mail, CornerDownLeft, Replace, Settings2, Cpu, Plus, Trash2, ExternalLink, Upload, Bot } from 'lucide-react';
import { gemini, aiAvailability, aiConfig, setAiConfig, SYSTEM, PROMPTS, DEFAULT_GEMS, GEMINI_MODELS, extractJson, stripFences } from '../../core/ai';
import { expandShorthand } from '../../core/expander';
import { checkText, suggest, loadSpell } from '../../core/spell';
import { dictionaryEntries } from '../../core/dictionary';
import { navigate } from '../../core/hooks';
import { store } from '../../core/store';
import { copyText, escapeHtml, stripHtml, lsGet, lsSet, uid, pickFiles, blobToBase64 } from '../../core/utils';
import { fileToHtml, sanitizeHtml } from '../../core/importers';
import { waLink, mailtoLink, openExternal } from '../../core/share';
import { cx, Button, Select, Textarea, Badge, Toggle, toast, promptDialog } from '../../components/ui';
import { imageUrl } from './reportDoc';

export const TOOLS = [
  { id: 'expand', label: 'Expand', icon: Wand2 }, { id: 'impression', label: 'Impression', icon: Stethoscope }, { id: 'differential', label: 'Differential', icon: BrainCircuit },
  { id: 'proofread', label: 'Proofread', icon: SpellCheck }, { id: 'rewrite', label: 'Rewrite', icon: Sparkles }, { id: 'summary', label: 'Patient summary', icon: Languages },
  { id: 'ask', label: 'Ask', icon: MessageSquare }, { id: 'gems', label: 'Gems', icon: Gem }, { id: 'image', label: 'Image', icon: ScanEye }, { id: 'drive', label: 'Context', icon: HardDrive }
];
const LANGS = ['English', 'Hindi (हिन्दी)', 'Rajasthani / Marwari', 'Gujarati', 'Marathi', 'Punjabi', 'Bengali', 'Urdu', 'Tamil', 'Telugu', 'Kannada', 'Malayalam'];
const REWRITES = ['Rewrite in formal clinical English (Indian radiology style), keep every measurement unchanged.', 'Make it more concise without losing any finding or measurement.', 'Expand into fuller descriptive sentences with standard sonographic terminology.', 'Fix spelling, grammar and punctuation only.', 'Convert into a numbered list of findings.'];
const LINKS = { notebooklm: 'https://notebooklm.google.com/', gemini: 'https://gemini.google.com/app', drive: 'https://drive.google.com/drive/my-drive', docs: 'https://docs.new', spark: 'https://gemini.google.com/gems/view' };
export const openGoogle = (k) => openExternal(LINKS[k] || LINKS.gemini);

function Out({ html, onInsert, onReplace, extra }) {
  if (!html) return null;
  return (
    <div className="mt-2 rounded-xl border border-line">
      <div className="doc-body max-h-[42vh] overflow-y-auto bg-white p-3 text-[12.5px] leading-5 text-slate-900" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="flex flex-wrap gap-1.5 border-t border-line bg-surface2 px-2 py-1.5">
        {onInsert && <Button size="sm" variant="primary" icon={CornerDownLeft} onClick={onInsert}>Insert at cursor</Button>}
        {onReplace && <Button size="sm" icon={Replace} onClick={onReplace}>Replace report</Button>}
        <Button size="sm" variant="ghost" icon={Copy} onClick={() => copyText(stripHtml(html)).then(() => toast('Copied', 'success'))}>Copy</Button>
        {extra}
      </div>
    </div>
  );
}

/** Replace (or append) the IMPRESSION section of a report body. */
export function withImpression(bodyHtml, impressionHtml) {
  const doc = new DOMParser().parseFromString('<body>' + (bodyHtml || '') + '</body>', 'text/html');
  const heads = Array.from(doc.body.querySelectorAll('h1,h2,h3,h4,p,strong')).filter((h) => /^\s*impression\s*:?\s*$/i.test(h.textContent));
  const h = heads[0] && (heads[0].closest('h1,h2,h3,h4,p') || heads[0]);
  if (!h) return (bodyHtml || '') + impressionHtml;
  let n = h.nextElementSibling;
  while (n && !/^H[1-4]$/.test(n.tagName) && !/kindly correlate|neither detected|pc-?pndt/i.test(n.textContent)) { const nx = n.nextElementSibling; n.remove(); n = nx; }
  const tmp = doc.createElement('div');
  tmp.innerHTML = impressionHtml;
  h.replaceWith(...Array.from(tmp.childNodes));
  return doc.body.innerHTML;
}

export function CopilotPanel({ tool, setTool, api, report, readOnly, onReplaceAll }) {
  const [avail, setAvail] = useState({ ok: false, via: null, model: aiConfig().model });
  const [cfg, setCfg] = useState(aiConfig());
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState('');
  const [notes, setNotes] = useState('');
  const [exam, setExam] = useState('');
  const [rw, setRw] = useState(REWRITES[0]);
  const [lang, setLang] = useState('Hindi (हिन्दी)');
  const [summary, setSummary] = useState('');
  const [fixes, setFixes] = useState(null);
  const [chat, setChat] = useState([]);
  const [ask, setAsk] = useState('');
  const [gems, setGems] = useState(() => DEFAULT_GEMS.concat(lsGet('ssdc-gems', [])));
  const [gemId, setGemId] = useState(() => lsGet('ssdc-gem-active', ''));
  const [ctxFiles, setCtxFiles] = useState([]);
  const [imgId, setImgId] = useState('');
  const [q, setQ] = useState('');
  const chatEnd = useRef(null);

  useEffect(() => { aiAvailability().then(setAvail); }, [cfg.apiKey, cfg.useServer]);
  useEffect(() => { setOut(''); setFixes(null); if (tool === 'expand' || tool === 'rewrite') { const sel = api.current && api.current.selectionText(); if (sel) setNotes(sel); } }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (chatEnd.current) chatEnd.current.scrollIntoView({ block: 'end' }); }, [chat]);

  const gem = gems.find((g) => g.id === gemId);
  const sys = (base) => [base, gem ? 'Specialist focus: ' + gem.prompt : '', ctxFiles.length ? 'Reference context supplied by the doctor (use only if relevant):\n' + ctxFiles.map((f) => '### ' + f.name + '\n' + f.text.slice(0, 20000)).join('\n\n') : ''].filter(Boolean).join('\n\n');
  const reportText = () => (api.current ? api.current.text() : stripHtml(report.html || ''));
  const patient = report.patientId ? store.get('patients', report.patientId) : null;
  const ctxLine = `${report.demographics.name || 'patient'}, ${report.demographics.age || ''} ${report.demographics.sex || ''}`.trim();
  const needAi = () => { if (!avail.ok) { toast('Configure Gemini first (Settings → AI & Gemini, or GEMINI key on the server)', 'warning'); return false; } return true; };
  const runAi = async (fn) => {
    if (!needAi()) return;
    setBusy(true);
    try { await fn(); } catch (e) { toast('Gemini: ' + e.message, 'error', 7000); } finally { setBusy(false); }
  };
  const insert = (html) => { if (readOnly) return toast('Report is signed & locked', 'warning'); api.current.insert(html); toast('Inserted at cursor', 'success'); };
  const replace = (html) => { if (readOnly) return toast('Report is signed & locked', 'warning'); onReplaceAll(html); };
  const saveCfg = (patch) => { setAiConfig(patch); setCfg(aiConfig()); };

  const offlineExpand = () => {
    const r = expandShorthand(notes, { gender: report.demographics.sex, exam: exam || undefined });
    if (!r) return toast('Type a few rough notes first, e.g. “mild fatty liver, 14.5 cm, rest normal”', 'info');
    setOut(r.html);
  };
  const aiExpand = () => runAi(async () => setOut(sanitizeHtml(stripFences(await gemini({ system: sys(SYSTEM.radiologist), prompt: PROMPTS.expand(notes, { exam: exam || report.demographics.modality, patient: ctxLine, indication: report.demographics.indication }) })))));
  const aiImpression = () => runAi(async () => { const r = stripFences(await gemini({ system: sys(SYSTEM.radiologist), prompt: PROMPTS.impression(reportText()) })); setOut('<h3><u>IMPRESSION</u></h3>' + sanitizeHtml(/<ol/i.test(r) ? r : '<ol><li>' + r + '</li></ol>')); });
  const aiDifferential = () => runAi(async () => setOut(sanitizeHtml(stripFences(await gemini({ system: sys(SYSTEM.radiologist), prompt: PROMPTS.differential(reportText()), deepThink: cfg.deepThink })))));
  const aiRewrite = () => {
    const sel = api.current && api.current.selectionHtml();
    const src = sel || notes;
    if (!src) return toast('Select text in the report (or paste it above) to rewrite', 'info');
    return runAi(async () => setOut(sanitizeHtml(stripFences(await gemini({ system: sys(SYSTEM.radiologist), prompt: PROMPTS.rewrite(src, rw) })))));
  };
  const aiSummary = () => runAi(async () => setSummary((await gemini({ system: SYSTEM.patient, prompt: PROMPTS.patientSummary(reportText(), lang) })).trim()));
  const proofread = async (useAi) => {
    const text = reportText();
    if (!text.trim()) return toast('The report is empty', 'info');
    if (useAi) {
      return runAi(async () => {
        const dict = dictionaryEntries().slice(0, 400).map((e) => ({ term: e.term, trigger: e.trigger || undefined }));
        const arr = extractJson(await gemini({ system: SYSTEM.proofreader, prompt: PROMPTS.proofreadJson(text, dict), json: true, temperature: 0.1 }));
        setFixes((Array.isArray(arr) ? arr : []).filter((x) => x && x.original && x.suggestion && x.original !== x.suggestion && text.includes(x.original)).map((x) => Object.assign({ id: uid('fx') }, x)));
      });
    }
    await loadSpell();
    const seen = new Set();
    const list = [];
    checkText(text).forEach((er) => { if (seen.has(er.word.toLowerCase())) return; seen.add(er.word.toLowerCase()); const s = suggest(er.word, 3); if (s.length) list.push({ id: uid('fx'), original: er.word, suggestion: s[0], alternatives: s.slice(1), reason: er.type === 'ambiguous' ? 'check usage' : 'spelling' }); });
    setFixes(list);
  };
  const applyFix = (fx, all) => {
    if (readOnly) return;
    const root = api.current.el();
    const esc = fx.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp((/^\w/.test(fx.original) ? '\\b' : '') + esc + (/\w$/.test(fx.original) ? '\\b' : ''), 'g');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    let done = 0;
    while ((n = walker.nextNode())) {
      if (!re.test(n.data)) { re.lastIndex = 0; continue; }
      re.lastIndex = 0;
      n.data = all ? n.data.replace(re, fx.suggestion) : n.data.replace(new RegExp(re.source), fx.suggestion);
      done++;
      if (!all) break;
    }
    root.dispatchEvent(new Event('input', { bubbles: true }));
    setFixes((l) => l.filter((x) => x.id !== fx.id));
    if (!done) toast('“' + fx.original + '” no longer found', 'info');
  };
  const askSend = () => {
    const qn = ask.trim();
    if (!qn) return;
    const hist = chat.concat([{ role: 'user', text: qn }]);
    setChat(hist);
    setAsk('');
    runAi(async () => {
      const prompt = 'Current report (for context):\n' + reportText().slice(0, 30000) + '\n\nConversation:\n' + hist.map((m) => (m.role === 'user' ? 'Doctor: ' : 'Copilot: ') + m.text).join('\n') + '\n\nReply to the doctor concisely. Use HTML only when a table or list helps.';
      const r = await gemini({ system: sys(SYSTEM.radiologist), prompt, deepThink: cfg.deepThink });
      setChat((c) => c.concat([{ role: 'ai', text: stripFences(r) }]));
    });
  };
  const imageInsight = () => {
    const im = (report.images || []).find((x) => x.id === imgId) || (report.images || [])[0];
    if (!im) return toast('Attach an ultrasound image first (Images tab)', 'info');
    runAi(async () => {
      const url = await imageUrl(im);
      const blob = await (await fetch(url, { credentials: 'same-origin' })).blob();
      const data = (await blobToBase64(blob)).replace(/^data:[^,]+,/, '');
      const r = await gemini({ system: sys(SYSTEM.radiologist), parts: [{ inlineData: { mimeType: blob.type || 'image/jpeg', data } }], prompt: 'Describe the sonographic appearance in this image in concise report language (organ, echotexture, lesions with features). This is decision support only — mark uncertain findings with "?" and never comment on foetal sex. HTML paragraphs only.' });
      setOut(sanitizeHtml(stripFences(r)));
    });
  };
  const addCtx = async () => {
    const files = await pickFiles({ accept: '.txt,.md,.pdf,.docx,.html,.htm,.rtf', multiple: true });
    for (const f of files) {
      try { const r = await fileToHtml(f); setCtxFiles((l) => l.concat([{ id: uid('cx'), name: f.name, text: stripHtml(r.html) }])); } catch (e) { toast(f.name + ': ' + e.message, 'error'); }
    }
  };
  const saveGem = async () => {
    const name = await promptDialog({ title: 'New Gem', label: 'Gem name', placeholder: 'e.g. Paediatric hip Gem', required: true });
    if (!name) return;
    const prompt = await promptDialog({ title: 'New Gem · ' + name, label: 'Instructions for this Gem', placeholder: 'e.g. Report infant hip ultrasound using the Graf classification; state alpha and beta angles…', multiline: true, rows: 6, required: true });
    if (!prompt) return;
    const g = { id: uid('gem_'), name: name.trim(), prompt: prompt.trim(), custom: true };
    const custom = lsGet('ssdc-gems', []).concat([g]);
    lsSet('ssdc-gems', custom);
    setGems(DEFAULT_GEMS.concat(custom));
  };
  const delGem = (id) => { const custom = lsGet('ssdc-gems', []).filter((g) => g.id !== id); lsSet('ssdc-gems', custom); setGems(DEFAULT_GEMS.concat(custom)); if (gemId === id) { setGemId(''); lsSet('ssdc-gem-active', ''); } };
  const hasMobile = !!(patient && patient.mobile);

  const T = TOOLS.find((t) => t.id === tool) || TOOLS[0];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-line p-2.5">
        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); if (q.trim()) openExternal('https://www.google.com/search?q=' + encodeURIComponent(q.trim())); }}>
          <div className="relative flex-1"><Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} className="input input-sm pl-7" placeholder="Search Google (opens Chrome tab)…" aria-label="Google search" /></div>
          <Button size="sm" type="submit">Go</Button>
        </form>
        <div className="flex flex-wrap gap-1">
          {TOOLS.map((t) => <button key={t.id} type="button" onClick={() => setTool(t.id)} className={cx('chip px-2 py-0.5 text-[11px]', tool === t.id && 'chip-on')}><t.icon className="h-3 w-3" />{t.label}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <Badge tone={avail.ok ? 'emerald' : 'amber'} icon={Cpu}>{avail.ok ? (avail.via === 'server' ? 'Gemini via server' : 'Gemini (browser key)') : 'Gemini not configured'}</Badge>
          <select className="input input-sm h-6 w-40 py-0 text-[11px]" value={cfg.model} onChange={(e) => saveCfg({ model: e.target.value })} aria-label="Gemini model"
            title={(GEMINI_MODELS.find((m) => m.id === cfg.model) || { note: 'Custom model chosen in Settings → AI & Gemini' }).note}>
            {GEMINI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            {!GEMINI_MODELS.some((m) => m.id === cfg.model) && <option value={cfg.model}>{cfg.model}</option>}
          </select>
          <Toggle size="sm" checked={!!cfg.deepThink} onChange={(v) => saveCfg({ deepThink: v })} label={<span className="text-[11px]">Deep think (R-mode)</span>} />
          {!avail.ok && <button type="button" className="link" onClick={() => navigate('/settings', { tab: 'ai' })}><Settings2 className="inline h-3 w-3" /> Set up</button>}
        </div>
        {gem && <div className="flex items-center gap-1.5 rounded-lg bg-violet-50 px-2 py-1 text-[11px] text-violet-800 dark:bg-violet-950/40 dark:text-violet-200"><Gem className="h-3 w-3" />Active Gem: <b>{gem.name}</b><button type="button" className="ml-auto" onClick={() => { setGemId(''); lsSet('ssdc-gem-active', ''); }}><X className="h-3 w-3" /></button></div>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5 text-[13px]">
        <div className="mb-2 flex items-center gap-1.5 font-display text-sm font-bold"><T.icon className="h-4 w-4 text-violet-600" />{T.label}{busy && <Loader2 className="h-4 w-4 animate-spin text-brand-600" />}</div>

        {tool === 'expand' && (
          <>
            <p className="mb-1.5 text-[12px] text-muted">Rough notes → complete formal report with impression. The offline engine works without internet; Gemini adds explanations, differentials and advice.</p>
            <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. mild fatty liver, liver 14.5 cm, gb 2 calculi largest 8 mm, rest normal   ·   32 wks live cephalic, placenta ant, AFI 12" aria-label="Rough notes" />
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Select size="sm" className="w-44" value={exam} onChange={(e) => setExam(e.target.value)} options={[{ value: '', label: 'Auto-detect exam' }, { value: 'abdomen_male', label: 'Whole abdomen (male)' }, { value: 'abdomen_female', label: 'Abdomen & pelvis (female)' }, { value: 'kub', label: 'KUB' }, { value: 'pelvis', label: 'Pelvis' }, { value: 'obstetric', label: 'Obstetric' }]} />
              <Button size="sm" icon={Wand2} onClick={offlineExpand}>Offline expand</Button>
              <Button size="sm" variant="primary" icon={Sparkles} onClick={aiExpand} disabled={busy || !notes.trim()}>Gemini expand</Button>
            </div>
            <Out html={out} onInsert={() => insert(out)} onReplace={() => replace(out)} />
          </>
        )}

        {tool === 'impression' && (
          <>
            <p className="mb-1.5 text-[12px] text-muted">Writes a numbered IMPRESSION from the findings currently in the report (most significant first).</p>
            <Button size="sm" variant="primary" icon={Stethoscope} onClick={aiImpression} disabled={busy}>Generate impression</Button>
            <Out html={out} onInsert={() => insert(out)} extra={<Button size="sm" onClick={() => { if (readOnly) return; onReplaceAll(withImpression(api.current.html(), out)); toast('IMPRESSION section updated', 'success'); }}>Replace existing IMPRESSION</Button>} />
          </>
        )}

        {tool === 'differential' && (
          <>
            <p className="mb-1.5 text-[12px] text-muted">Overall conclusion, most likely diagnosis, ranked differential diagnosis and suggested further evaluation (turn on Deep think for harder cases).</p>
            <Button size="sm" variant="primary" icon={BrainCircuit} onClick={aiDifferential} disabled={busy}>Generate differential</Button>
            <Out html={out} onInsert={() => insert(out)} />
          </>
        )}

        {tool === 'proofread' && (
          <>
            <p className="mb-1.5 text-[12px] text-muted">Measurements, units and gestational ages are never changed. Your custom dictionary is always respected.</p>
            <div className="flex flex-wrap gap-1.5"><Button size="sm" icon={SpellCheck} onClick={() => proofread(false)}>Offline spelling check</Button><Button size="sm" variant="primary" icon={Sparkles} onClick={() => proofread(true)} disabled={busy}>Gemini proofread</Button></div>
            {fixes && (
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center justify-between text-[12px]"><b>{fixes.length} suggestion(s)</b>{fixes.length > 1 && !readOnly && <button type="button" className="link" onClick={() => fixes.slice().forEach((fx) => applyFix(fx, true))}>Accept all</button>}</div>
                {fixes.map((fx) => (
                  <div key={fx.id} className="rounded-lg border border-line p-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]"><span className="rounded bg-rose-50 px-1 text-rose-700 line-through dark:bg-rose-950/40 dark:text-rose-300">{fx.original}</span>→<b className="rounded bg-emerald-50 px-1 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{fx.suggestion}</b><Badge tone="slate">{fx.reason || 'fix'}</Badge></div>
                    {(fx.alternatives || []).length > 0 && <div className="mt-1 flex flex-wrap gap-1">{fx.alternatives.map((a) => <button key={a} type="button" className="chip px-1.5 py-0 text-[11px]" onClick={() => applyFix(Object.assign({}, fx, { suggestion: a }), true)}>{a}</button>)}</div>}
                    <div className="mt-1.5 flex gap-1.5"><Button size="sm" variant="success" icon={Check} onClick={() => applyFix(fx, true)} disabled={readOnly}>Accept</Button><Button size="sm" variant="ghost" icon={X} onClick={() => setFixes((l) => l.filter((x) => x.id !== fx.id))}>Ignore</Button></div>
                  </div>
                ))}
                {!fixes.length && <p className="rounded-lg bg-emerald-50 p-2 text-[12px] text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">No corrections needed. ✓</p>}
              </div>
            )}
          </>
        )}

        {tool === 'rewrite' && (
          <>
            <p className="mb-1.5 text-[12px] text-muted">Select text in the report first (or paste below), choose how to rewrite it, then replace the selection.</p>
            <Select size="sm" value={rw} onChange={(e) => setRw(e.target.value)} options={REWRITES} />
            <Textarea className="mt-1.5" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="(optional) text to rewrite when nothing is selected" />
            <Button className="mt-1.5" size="sm" variant="primary" icon={Sparkles} onClick={aiRewrite} disabled={busy}>Rewrite</Button>
            <Out html={out} extra={<Button size="sm" variant="primary" onClick={() => { if (readOnly) return; api.current.insert(out); toast('Selection replaced', 'success'); }}>Replace selection</Button>} />
          </>
        )}

        {tool === 'summary' && (
          <>
            <p className="mb-1.5 text-[12px] text-muted">A short, kind, patient-friendly summary in the patient’s language — ready for WhatsApp or e-mail.</p>
            <div className="flex gap-1.5"><Select size="sm" value={lang} onChange={(e) => setLang(e.target.value)} options={LANGS} /><Button size="sm" variant="primary" icon={Languages} onClick={aiSummary} disabled={busy}>Generate</Button></div>
            {summary && (
              <div className="mt-2">
                <Textarea rows={9} value={summary} onChange={(e) => setSummary(e.target.value)} className="font-deva text-[13px]" aria-label="Patient summary" />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Button size="sm" icon={Copy} onClick={() => copyText(summary).then(() => toast('Copied', 'success'))}>Copy</Button>
                  <Button size="sm" variant="whatsapp" icon={Send} disabled={!hasMobile} onClick={() => openExternal(waLink(patient.mobile, summary))}>WhatsApp{hasMobile ? '' : ' (no mobile)'}</Button>
                  <Button size="sm" icon={Mail} onClick={() => openExternal(mailtoLink((patient && patient.email) || '', 'Your report summary', summary))}>Email</Button>
                  <Button size="sm" variant="ghost" onClick={() => insert('<p><em>Patient summary (' + escapeHtml(lang) + '):</em></p><p>' + escapeHtml(summary).replace(/\n/g, '<br>') + '</p>')}>Insert</Button>
                </div>
              </div>
            )}
          </>
        )}

        {tool === 'ask' && (
          <div className="flex h-full flex-col">
            <div className="min-h-[120px] space-y-2">
              {!chat.length && <p className="text-[12px] text-muted">Ask about this case — e.g. “Is a 9 mm CBD significant at 72 years?”, “Suggest TI-RADS category”, “What follow-up interval?”</p>}
              {chat.map((m, i) => (
                <div key={i} className={cx('rounded-xl px-2.5 py-1.5 text-[12.5px]', m.role === 'user' ? 'ml-6 bg-brand-50 dark:bg-brand-950/40' : 'mr-4 border border-line bg-surface')}>
                  {m.role === 'ai' ? <div className="doc-body" dangerouslySetInnerHTML={{ __html: /<\w/.test(m.text) ? sanitizeHtml(m.text) : escapeHtml(m.text).replace(/\n/g, '<br>') }} /> : m.text}
                  {m.role === 'ai' && !readOnly && <button type="button" className="link mt-1 block text-[11px]" onClick={() => insert(/<\w/.test(m.text) ? sanitizeHtml(m.text) : '<p>' + escapeHtml(m.text).replace(/\n/g, '<br>') + '</p>')}>Insert into report</button>}
                </div>
              ))}
              <div ref={chatEnd} />
            </div>
            <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); askSend(); }}>
              <input className="input input-sm" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ask Copilot…" aria-label="Ask Copilot" />
              <Button size="sm" variant="primary" type="submit" icon={Send} disabled={busy}>Ask</Button>
            </form>
          </div>
        )}

        {tool === 'gems' && (
          <>
            <p className="mb-1.5 text-[12px] text-muted">Specialised Ultrasound Gems add expert instructions to Expand, Impression, Differential and Ask.</p>
            <div className="space-y-1.5">
              {gems.map((g) => (
                <div key={g.id} className={cx('rounded-lg border p-2', gemId === g.id ? 'border-violet-400 bg-violet-50 dark:bg-violet-950/40' : 'border-line')}>
                  <div className="flex items-center gap-1.5"><Gem className="h-3.5 w-3.5 text-violet-600" /><b className="text-[12.5px]">{g.name}</b>
                    <span className="ml-auto flex gap-1">{g.custom && <button type="button" title="Delete Gem" onClick={() => delGem(g.id)}><Trash2 className="h-3.5 w-3.5 text-rose-500" /></button>}
                      <Button size="sm" variant={gemId === g.id ? 'primary' : 'secondary'} onClick={() => { const v = gemId === g.id ? '' : g.id; setGemId(v); lsSet('ssdc-gem-active', v); }}>{gemId === g.id ? 'Active' : 'Use'}</Button></span>
                  </div>
                  <p className="mt-1 text-[11.5px] text-muted">{g.prompt}</p>
                </div>
              ))}
            </div>
            <Button className="mt-2" size="sm" icon={Plus} onClick={saveGem}>New custom Gem</Button>
          </>
        )}

        {tool === 'image' && (
          <>
            <p className="mb-1.5 text-[12px] text-muted">Decision support only: Gemini describes an attached image in report language. Always verify against the live scan.</p>
            {(report.images || []).length ? (
              <div className="grid grid-cols-3 gap-1.5">{report.images.map((im) => <ImgThumb key={im.id} im={im} active={(imgId || report.images[0].id) === im.id} onClick={() => setImgId(im.id)} />)}</div>
            ) : <p className="rounded-lg bg-surface2 p-2 text-[12px]">No images attached yet — add them in the Images tab.</p>}
            <Button className="mt-2" size="sm" variant="primary" icon={ScanEye} onClick={imageInsight} disabled={busy || !(report.images || []).length}>Describe image</Button>
            <Out html={out} onInsert={() => insert(out)} />
          </>
        )}

        {tool === 'drive' && (
          <>
            <p className="mb-1.5 text-[12px] text-muted">Add reference files (previous reports, guidelines, referral letters) as context for Copilot, or open your Google workspace tools.</p>
            <Button size="sm" icon={Upload} onClick={addCtx}>Add context files</Button>
            <div className="mt-2 space-y-1">{ctxFiles.map((f) => <div key={f.id} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[12px]"><HardDrive className="h-3.5 w-3.5 text-muted" /><span className="min-w-0 flex-1 truncate">{f.name}</span><span className="text-muted">{Math.round(f.text.length / 1000)}k chars</span><button type="button" onClick={() => setCtxFiles((l) => l.filter((x) => x.id !== f.id))}><X className="h-3.5 w-3.5" /></button></div>)}</div>
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              <Button size="sm" icon={ExternalLink} onClick={() => { copyText(reportText()); openGoogle('notebooklm'); toast('Report copied — paste it as a NotebookLM source', 'info'); }}>NotebookLM</Button>
              <Button size="sm" icon={ExternalLink} onClick={() => openGoogle('drive')}>Google Drive</Button>
              <Button size="sm" icon={Bot} onClick={() => openGoogle('gemini')}>Gemini app</Button>
              <Button size="sm" icon={Sparkles} onClick={() => openGoogle('spark')}>Gems / Spark</Button>
            </div>
            <p className="mt-2 text-[11px] text-muted">NotebookLM, Spark and the Gemini app have no public API — they open in a new tab with your report on the clipboard.</p>
          </>
        )}
      </div>
    </div>
  );
}

function ImgThumb({ im, active, onClick }) {
  const [url, setUrl] = useState('');
  useEffect(() => { let a = true; imageUrl(im).then((u) => { if (a) setUrl(u); }); return () => { a = false; }; }, [im]);
  return <button type="button" onClick={onClick} className={cx('aspect-square overflow-hidden rounded-lg border-2 bg-black', active ? 'border-brand-500' : 'border-transparent')}>{url && <img src={url} alt={im.caption} className="h-full w-full object-contain" />}</button>;
}
