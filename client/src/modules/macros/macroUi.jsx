// Shared macro / template UI: worker-backed search hook, Ctrl+K quick-insert palette (↑ ↓ Enter / Tab
// insert, Shift+Enter replace report, Esc close) and the create / edit editor with a live split A4 preview.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Search, Keyboard, CornerDownLeft, FileText, Layers, Save, Plus, Bold, Italic, Underline, List, ListOrdered, Heading3, Table, Brackets, Braces, Calculator, Puzzle, Eye, EyeOff } from 'lucide-react';
import { macros, MODALITIES } from '../../core/macros';
import { useSettings, useLocalPref } from '../../core/hooks';
import { can } from '../../core/auth';
import { stripHtml } from '../../core/utils';
import { cx, Modal, Button, Input, Select, Field, Badge, Segmented, Menu, toast, confirmDialog, promptDialog } from '../../components/ui';
import { DEMOG_TOKENS, CALC_TOKENS } from '../../core/templateTokens';
import { cssFont } from '../reporting/reportPrint';

export function useMacrosVersion() {
  return useSyncExternalStore(useCallback((cb) => macros.subscribe(cb), []), () => macros.version);
}

/** Debounced worker search; returns { ids, total, ms, busy }. */
export function useMacroSearch(query, filters = {}, limit = 200, delay = 60) {
  const version = useMacrosVersion();
  const [res, setRes] = useState({ ids: [], total: 0, ms: 0, busy: true });
  const fkey = JSON.stringify(filters);
  useEffect(() => {
    let alive = true;
    setRes((r) => Object.assign({}, r, { busy: true }));
    const t = setTimeout(() => {
      macros.search(query, JSON.parse(fkey), limit).then((r) => { if (alive) setRes({ ids: r.ids || [], total: r.total || 0, ms: r.ms || 0, busy: false }); });
    }, query ? delay : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [query, fkey, limit, version, delay]);
  return res;
}

export const kindLabel = (k) => (k === 'template' ? 'Template' : 'Macro');

export function MacroRow({ meta, active, onClick, onDoubleClick, right, compact }) {
  if (!meta) return null;
  return (
    <div role="option" aria-selected={active} onClick={onClick} onDoubleClick={onDoubleClick}
      className={cx('flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-1.5', active ? 'bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-950/50 dark:ring-brand-800' : 'hover:bg-surface2')}>
      <span className={cx('mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md', meta.kind === 'template' ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300' : 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300')}>
        {meta.kind === 'template' ? <FileText className="h-3.5 w-3.5" /> : <Layers className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {meta.trigger && <code className="rounded bg-slate-100 px-1 font-mono text-[11px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{meta.trigger}</code>}
          <span className="truncate text-[13px] font-medium">{meta.title}</span>
        </span>
        {!compact && <span className="block truncate text-[11px] text-muted">{[meta.category, meta.modality, (meta.tags || []).slice(0, 4).join(', ')].filter(Boolean).join(' · ')}</span>}
      </span>
      {right}
    </div>
  );
}

/** Ctrl+K / Alt+M quick-insert palette. onPick(doc, 'cursor' | 'replace'). */
export function MacroPalette({ open, onClose, onPick, initialQuery = '', kind = '', onNew }) {
  const [q, setQ] = useState(initialQuery);
  const [k, setK] = useState(kind);
  const [hi, setHi] = useState(0);
  const [preview, setPreview] = useState(null);
  const input = useRef(null);
  const list = useRef(null);
  useEffect(() => { if (open) { setQ(initialQuery || ''); setK(kind || ''); setHi(0); setTimeout(() => input.current && input.current.focus(), 30); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const res = useMacroSearch(open ? q : '', k ? { kind: k } : {}, 80, 25);
  const ids = res.ids;
  const curId = ids[Math.min(hi, ids.length - 1)];
  useEffect(() => {
    let alive = true;
    if (!curId) { setPreview(null); return undefined; }
    macros.get(curId).then((d) => { if (alive) setPreview(d); });
    return () => { alive = false; };
  }, [curId]);
  useEffect(() => { const el = list.current && list.current.querySelector('[aria-selected="true"]'); if (el) el.scrollIntoView({ block: 'nearest' }); }, [hi]);
  const pick = async (id, mode) => { const d = await macros.get(id); if (d) { onPick(d, mode); onClose(); } };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(ids.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter' && curId) { e.preventDefault(); pick(curId, e.shiftKey ? 'replace' : 'cursor'); }
    else if (e.key === 'Tab' && curId) { e.preventDefault(); pick(curId, 'cursor'); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };
  const settings = useSettings();
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} size="xl" noPad title="Quick insert — templates & macros" subtitle={`${macros.count.toLocaleString('en-IN')} in library · ${res.total.toLocaleString('en-IN')} match · ${res.ms.toFixed(2)} ms`} icon={Keyboard}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Search className="h-4 w-4 text-muted" />
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} onKeyDown={onKey} placeholder="Search trigger, title, category, modality, tags or full text…" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" aria-label="Search macros" />
        <Segmented size="sm" value={k} onChange={(v) => { setK(v); setHi(0); }} options={[{ value: '', label: 'All' }, { value: 'template', label: 'Templates' }, { value: 'macro', label: 'Macros' }]} />
      </div>
      <div className="grid min-h-[380px] md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div ref={list} role="listbox" className="max-h-[56vh] overflow-y-auto border-r border-line p-1.5">
          {ids.map((id, i) => <MacroRow key={id} meta={macros.getMeta(id)} active={i === hi} onClick={() => setHi(i)} onDoubleClick={() => pick(id, 'cursor')} />)}
          {!ids.length && !res.busy && <div className="p-6 text-center text-sm text-muted">No macro matches “{q}”.{onNew && <> <button type="button" className="link" onClick={() => { onClose(); onNew(q); }}>Create one</button></>}</div>}
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="max-h-[48vh] min-h-0 flex-1 overflow-y-auto bg-slate-100 p-3 dark:bg-slate-950/50">
            {preview ? <div className="doc-body rounded-md bg-white p-4 text-slate-900 shadow-sm" style={{ fontFamily: cssFont(settings.report.fontFamily), fontSize: '10pt', lineHeight: 1.4 }} dangerouslySetInnerHTML={{ __html: preview.content }} /> : <div className="p-6 text-center text-sm text-muted">Preview appears here</div>}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
            <span className="mr-auto flex items-center gap-2 text-[11px] text-muted"><span className="kbd">↑↓</span> browse <span className="kbd">Enter</span>/<span className="kbd">Tab</span> insert <span className="kbd">Shift+Enter</span> replace</span>
            <Button size="sm" disabled={!curId} onClick={() => pick(curId, 'replace')}>Replace report</Button>
            <Button size="sm" variant="primary" icon={CornerDownLeft} disabled={!curId} onClick={() => pick(curId, 'cursor')}>Paste at cursor</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- macro editor with live split preview
const MINI_TOOLS = [
  [Bold, 'bold'], [Italic, 'italic'], [Underline, 'underline'], [Heading3, 'formatBlock', 'h3'], [List, 'insertUnorderedList'], [ListOrdered, 'insertOrderedList']
];

export function MacroEditorModal({ open, onClose, initial, onSaved, onInject, title }) {
  const settings = useSettings();
  const version = useMacrosVersion();
  const [f, setF] = useState(null);
  const [html, setHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useLocalPref('macro-editor-preview', true);
  const ed = useRef(null);
  const lastRange = useRef(null);
  const saveSel = () => { const s = window.getSelection(); const r = s && s.rangeCount ? s.getRangeAt(0) : null; if (r && ed.current && ed.current.contains(r.startContainer)) lastRange.current = r.cloneRange(); return lastRange.current; };
  const restoreSel = (r) => { if (!r || !ed.current) return; ed.current.focus(); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); };
  const keepSel = () => { saveSel(); };
  const insertToken = (tok) => {
    if (!ed.current) return;
    restoreSel(lastRange.current);
    if (!ed.current.contains(document.getSelection().anchorNode)) { ed.current.focus(); }
    document.execCommand('insertText', false, tok);
    setHtml(ed.current.innerHTML);
  };
  const canWrite = can('templates:manage_macros', 'DRAFT');
  useEffect(() => {
    if (!open) return;
    const i = initial || {};
    setF({ id: i.id || null, title: i.title || '', trigger: i.trigger || '', modality: i.modality || MODALITIES[0], category: i.category || 'General', tags: (i.tags || []).join(', '), kind: i.kind || ((i.content || '').length > 700 ? 'template' : 'macro'), key: i.key, isDefault: i.isDefault });
    setHtml(i.content || '');
    setTimeout(() => { if (ed.current) { ed.current.innerHTML = i.content || ''; } }, 0);
  }, [open, initial]);
  const cats = useMemo(() => macros.categories(), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open || !f) return null;
  const set = (patch) => setF((x) => Object.assign({}, x, patch));
  const dupId = f.trigger.trim() ? macros.idForTrigger(f.trigger.trim()) : null;
  const dup = dupId && dupId !== f.id ? macros.getMeta(dupId) : null;
  const tool = (cmd, val) => (e) => { e.preventDefault(); ed.current.focus(); document.execCommand(cmd, false, val || null); setHtml(ed.current.innerHTML); };
  const save = async (inject) => {
    if (!canWrite) return toast('Your role cannot edit macros', 'error');
    const content = ed.current ? ed.current.innerHTML : html;
    if (!f.title.trim()) return toast('Give the macro a title', 'warning');
    if (!stripHtml(content).trim() && !/<(img|table)/i.test(content)) return toast('Content is empty', 'warning');
    if (dup) return toast(`Trigger ${f.trigger} is already used by “${dup.title}”`, 'warning');
    if (f.trigger && /\s/.test(f.trigger.trim())) return toast('Trigger codes cannot contain spaces', 'warning');
    setBusy(true);
    try {
      const prev = f.id ? await macros.get(f.id) : null;
      const doc = await macros.save(Object.assign({}, prev || {}, { id: f.id || undefined, title: f.title.trim(), trigger: f.trigger.trim(), modality: f.modality, category: f.category, tags: f.tags, kind: f.kind, content }));
      toast((f.id ? 'Updated' : 'Saved') + ' ' + kindLabel(doc.kind).toLowerCase() + ': ' + doc.title + (doc.trigger ? ' (' + doc.trigger + ')' : ''), 'success');
      onSaved && onSaved(doc);
      if (inject && onInject) onInject(doc);
      onClose();
    } catch (err) { toast('Could not save: ' + err.message, 'error'); } finally { setBusy(false); }
  };
  const addCat = async () => {
    const c = await promptDialog({ title: 'New category', label: 'Category name', required: true });
    if (c && c.trim()) { macros.addCategory(c.trim()); set({ category: c.trim() }); }
  };
  return (
    <Modal open={open} onClose={onClose} size="screen" title={title || (f.id ? 'Edit ' + kindLabel(f.kind).toLowerCase() : 'New macro / template')} subtitle="Unlimited length · rich text · [__] placeholders jump with F2 · {{Patient_Name}} fields, {{>trigger}} nested macros and {{EDD_USG}} calculated fields fill in automatically" icon={f.kind === 'template' ? FileText : Layers}
      footer={<>
        {f.isDefault && <Badge tone="slate" className="mr-auto">Built-in default (editable)</Badge>}
        <Button onClick={onClose}>Cancel</Button>
        <Button icon={Save} loading={busy} onClick={() => save(false)} disabled={!canWrite}>Save</Button>
        {onInject && <Button variant="primary" icon={CornerDownLeft} loading={busy} onClick={() => save(true)} disabled={!canWrite}>Save & insert into report</Button>}
      </>}>
      <div className="grid gap-3 md:grid-cols-12">
        <Field label="Title / clinical description" required className="md:col-span-4"><Input autoFocus value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Grade 1 hepatic steatosis" /></Field>
        <Field label="Shortcut trigger" className="md:col-span-2" error={dup ? 'Used by “' + dup.title + '”' : ''} hint="e.g. .fatty1 ;norm /tirads3"><Input value={f.trigger} onChange={(e) => set({ trigger: e.target.value.replace(/\s/g, '') })} className="font-mono" placeholder=".code" /></Field>
        <Field label="Modality" className="md:col-span-2"><Select value={f.modality} onChange={(e) => set({ modality: e.target.value })} options={MODALITIES} /></Field>
        <Field label="Category" className="md:col-span-2" extra={<button type="button" className="link normal-case" onClick={addCat}><Plus className="inline h-3 w-3" />New</button>}><Select value={f.category} onChange={(e) => set({ category: e.target.value })} options={cats.includes(f.category) ? cats : cats.concat([f.category])} /></Field>
        <Field label="Type" className="md:col-span-2"><Segmented size="sm" value={f.kind} onChange={(v) => set({ kind: v })} options={[{ value: 'macro', label: 'Macro' }, { value: 'template', label: 'Template' }]} /></Field>
        <Field label="Search tags (comma separated)" className="md:col-span-12"><Input value={f.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="calculus, gallbladder, shadow, normal" /></Field>
      </div>
      <div className={cx('mt-3 grid gap-3', showPreview && 'lg:grid-cols-2')}>
        <div className="flex min-h-0 flex-col rounded-xl border border-line">
          <div className="flex flex-wrap items-center gap-0.5 border-b border-line bg-surface2 px-2 py-1">
            {MINI_TOOLS.map(([Icon, cmd, val]) => <button key={cmd + (val || '')} type="button" onMouseDown={tool(cmd, val)} className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-surface" title={cmd}><Icon className="h-4 w-4" /></button>)}
            <button type="button" onMouseDown={(e) => { e.preventDefault(); ed.current.focus(); document.execCommand('insertHTML', false, '<table style="width:100%;border-collapse:collapse"><tr><th>Parameter</th><th>Value</th></tr><tr><td><br></td><td>[__]</td></tr></table><p><br></p>'); setHtml(ed.current.innerHTML); }} className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-surface" title="Table"><Table className="h-4 w-4" /></button>
            <button type="button" onMouseDown={(e) => { e.preventDefault(); ed.current.focus(); document.execCommand('insertText', false, '[__]'); setHtml(ed.current.innerHTML); }} className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-surface" title="Placeholder [__]"><Brackets className="h-4 w-4" /></button>
            <span onMouseDown={keepSel}>
              <Menu align="left" width="w-72" trigger={<button type="button" className="inline-flex h-7 items-center gap-1 rounded px-1.5 text-[12px] font-semibold hover:bg-surface" title="Insert a patient field — filled in when the template is used"><Braces className="h-4 w-4" />Patient field</button>}
                items={DEMOG_TOKENS.map(([k, label]) => ({ label: label + '  {{' + k + '}}', onClick: () => insertToken('{{' + k + '}}') }))} />
            </span>
            <span onMouseDown={keepSel}>
              <Menu align="left" width="w-72" trigger={<button type="button" className="inline-flex h-7 items-center gap-1 rounded px-1.5 text-[12px] font-semibold hover:bg-surface" title="Insert a calculated field (GA / EDD / EFW) that updates from the biometry"><Calculator className="h-4 w-4" />Calculated</button>}
                items={CALC_TOKENS.map(([k, label]) => ({ label: label + '  {{' + k + '}}', onClick: () => insertToken('{{' + k + '}}') }))} />
            </span>
            <button type="button" onMouseDown={async (e) => { e.preventDefault(); const sel = saveSel(); const t = await promptDialog({ title: 'Nest another macro', label: 'Trigger of the macro to include (e.g. .gbnormal)', required: true }); if (!t) return; if (!macros.hasTrigger(String(t).trim())) toast('No macro has the trigger “' + t + '” yet — it will show as “not found” until one does', 'warning'); restoreSel(sel); insertToken('{{>' + String(t).trim() + '}}'); }}
              className="inline-flex h-7 items-center gap-1 rounded px-1.5 text-[12px] font-semibold hover:bg-surface" title="Include another macro by its trigger: a modular block that stays in sync"><Puzzle className="h-4 w-4" />Nested macro</button>
            <span className="ml-auto text-[11px] text-muted">{stripHtml(html).split(/\s+/).filter(Boolean).length.toLocaleString('en-IN')} words</span>
            <button type="button" onClick={() => setShowPreview(!showPreview)} aria-pressed={showPreview} title={showPreview ? 'Hide the A4 preview: the text box takes the full width' : 'Show the live A4 preview beside the text'}
              className="ml-2 inline-flex h-7 items-center gap-1 rounded px-1.5 text-[12px] font-semibold hover:bg-surface">{showPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{showPreview ? 'Hide preview' : 'Show preview'}</button>
          </div>
          <div ref={ed} contentEditable={canWrite} suppressContentEditableWarning className={cx('doc-body w-full flex-1 overflow-y-auto bg-white px-3 py-2.5 text-slate-900', showPreview ? 'min-h-[46vh]' : 'min-h-[58vh]')} style={{ fontFamily: cssFont(settings.report.fontFamily), fontSize: '10.5pt', lineHeight: 1.45 }}
            onInput={() => setHtml(ed.current.innerHTML)} aria-label="Macro content" data-label="Macro content" />
        </div>
        {showPreview && <div className="flex min-h-0 flex-col rounded-xl border border-line">
          <div className="border-b border-line bg-surface2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Live A4 preview</div>
          <div className="max-h-[52vh] min-h-[46vh] overflow-y-auto bg-slate-200/70 p-3 dark:bg-slate-950/50">
            <div className="print-page mx-auto bg-white shadow" style={{ width: '100%', maxWidth: '210mm', minHeight: '120mm', padding: '10mm 12mm', fontFamily: cssFont(settings.report.fontFamily), fontSize: settings.report.fontSize + 'pt', lineHeight: settings.report.lineHeight }}>
              <div className="report-content" dangerouslySetInnerHTML={{ __html: html || '<p style="color:#94a3b8">Start typing on the left…</p>' }} />
            </div>
          </div>
        </div>}
      </div>
    </Modal>
  );
}

/** Helpers used by Studio cards and the workstation side panel. */
export async function duplicateMacro(id) {
  const d = await macros.get(id);
  if (!d) return null;
  let trig = d.trigger ? d.trigger + '_copy' : '';
  let n = 2;
  while (trig && macros.hasTrigger(trig)) trig = d.trigger + '_copy' + n++;
  return macros.save(Object.assign({}, d, { id: undefined, trigger: trig, title: d.title + ' (copy)', isDefault: false, key: undefined }));
}
export async function deleteMacros(ids) {
  if (!ids.length) return false;
  const names = ids.slice(0, 3).map((id) => (macros.getMeta(id) || {}).title).filter(Boolean).join(', ');
  if (!(await confirmDialog({ title: 'Delete ' + ids.length + ' item(s)?', message: names + (ids.length > 3 ? ' …' : '') + '\n\nDeleted macros sync to every workstation.', confirmText: 'Delete', danger: true }))) return false;
  await macros.remove(ids);
  toast(ids.length + ' deleted', 'info');
  return true;
}
