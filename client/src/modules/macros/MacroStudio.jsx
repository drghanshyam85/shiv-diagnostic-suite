// Templates & Macros studio: 1,00,000+ macro library (IndexedDB + Web Worker index, virtual scrolling),
// multi-field search, categories (+ new / rename / delete), live preview with paste-into-live-report,
// bulk actions, the full-page Template Studio and the Data Hub (bulk import / export, restore defaults,
// "Seed 1,00,000 Test Macros" benchmark).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Layers, FileText, Search, Plus, Pencil, Copy, Trash2, CornerDownLeft, Replace, Database, Upload, Download, RotateCcw, Gauge, FolderTree, Printer, FileDown, Mail, Maximize2, Minimize2, Save, Bold, Italic, Underline, Heading3, List, ListOrdered, Table, Brackets, CheckSquare, Square, Tag, X, HardDrive, Zap, Clipboard } from 'lucide-react';
import { macros, MODALITIES } from '../../core/macros';
import { useSettings, useLocalPref, navigate, useHotkeys } from '../../core/hooks';
import { can } from '../../core/auth';
import { estimateStorage } from '../../core/idb';
import { stripHtml, timeAgo, fmtBytes, pickFiles, fileExt, lsGet, lsSet } from '../../core/utils';
import { copyRich, exportDocx, exportHtml, exportTxt } from '../../core/exporters';
import { htmlToPdf } from '../../core/pdf';
import { mailtoLink, gmailLink, openExternal } from '../../core/share';
import { sanitizeHtml, fileToHtml } from '../../core/importers';
import { cx, PageHeader, Button, Badge, Segmented, Select, Input, Field, Progress, Kpi, Card, Empty, Menu, VirtualList, toast, confirmDialog, promptDialog } from '../../components/ui';
import { useMacroSearch, useMacrosVersion, MacroEditorModal, duplicateMacro, deleteMacros, kindLabel } from './macroUi';
import { parseDataFile, documentsToTemplates, exportMacros, autoTrigger, guessCategory, guessModality, DOC_EXTS } from './dataHub';
import { cssFont, renderReportPages } from '../reporting/reportPrint';

/** Queue content for the reporting workstation and open it (applied at the cursor there). */
export function sendToLiveReport(payload, mode = 'cursor') {
  lsSet('ssdc-pref:rw-pending', Object.assign({ mode, at: Date.now() }, payload));
  navigate('/report');
}

// ---------------------------------------------------------------- library
function Library({ onEdit, onStudio }) {
  const settings = useSettings();
  const version = useMacrosVersion();
  const [q, setQ] = useState('');
  const [modality, setModality] = useState('');
  const [category, setCategory] = useState('');
  const [kind, setKind] = useState('');
  const [selId, setSelId] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const [preview, setPreview] = useState(null);
  const filters = useMemo(() => Object.assign({}, modality && { modality }, category && { category }, kind && { kind }), [modality, category, kind]);
  const res = useMacroSearch(q, filters, 1000000, 40);
  const canWrite = can('templates:manage_macros', 'DRAFT');
  const cats = useMemo(() => {
    const counts = {};
    for (const m of macros.meta.values()) counts[m.category] = (counts[m.category] || 0) + 1;
    return macros.categories().map((c) => [c, counts[c] || 0]);
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (res.ids.length && (!selId || !res.ids.includes(selId))) setSelId(res.ids[0]); }, [res.ids]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    if (!selId) { setPreview(null); return undefined; }
    macros.get(selId).then((d) => { if (alive) setPreview(d); });
    return () => { alive = false; };
  }, [selId, version]);
  const toggle = (id) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allChecked = res.ids.length > 0 && checked.size >= res.ids.length;
  const bulkMove = async () => {
    const c = await promptDialog({ title: 'Move ' + checked.size + ' item(s) to category', label: 'Category', defaultValue: category || 'General', required: true });
    if (!c) return;
    let n = 0;
    for (const id of checked) { const d = await macros.get(id); if (d) { await macros.save(Object.assign({}, d, { category: c.trim() }), { silent: true }); n++; } }
    macros.addCategory(c.trim());
    toast(n + ' moved to ' + c, 'success');
  };
  const addCat = async () => { const c = await promptDialog({ title: 'New category', label: 'Name', required: true }); if (c && c.trim()) { macros.addCategory(c.trim()); setCategory(c.trim()); } };
  const renameCat = async (c) => { const to = await promptDialog({ title: 'Rename category “' + c + '”', label: 'New name', defaultValue: c, required: true }); if (to && to.trim() && to.trim() !== c) { const n = await macros.renameCategory(c, to.trim()); toast(n + ' item(s) updated', 'success'); setCategory(to.trim()); } };
  const delCat = async (c) => { if (await confirmDialog({ title: 'Delete category “' + c + '”?', message: 'Its macros move to “General”.', confirmText: 'Delete', danger: true })) { const n = await macros.deleteCategory(c, 'General'); toast(n + ' item(s) moved to General', 'info'); if (category === c) setCategory(''); } };
  const meta = selId ? macros.getMeta(selId) : null;
  return (
    <div className="grid min-h-0 gap-3 lg:grid-cols-[230px_minmax(0,1fr)_minmax(0,1.05fr)]" style={{ height: 'calc(100vh - 15rem)', minHeight: 520 }}>
      <Card padded={false} className="flex min-h-0 flex-col" bodyClass="flex min-h-0 flex-1 flex-col" title="Categories" icon={FolderTree} actions={canWrite && <Button size="sm" variant="ghost" icon={Plus} onClick={addCat}>New</Button>}>
        <div className="space-y-2 border-b border-line p-2.5">
          <Select size="sm" value={modality} onChange={(e) => setModality(e.target.value)} options={[{ value: '', label: 'All Modalities' }].concat(MODALITIES.map((m) => ({ value: m, label: m })))} aria-label="Modality filter" />
          <Segmented size="sm" value={kind} onChange={setKind} options={[{ value: '', label: 'All' }, { value: 'macro', label: 'Macros' }, { value: 'template', label: 'Templates' }]} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          <button type="button" onClick={() => setCategory('')} className={cx('flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[13px]', !category ? 'bg-brand-50 font-semibold text-brand-800 dark:bg-brand-950/50 dark:text-brand-200' : 'hover:bg-surface2')}><span>All categories</span><span className="text-[11px] text-muted tnum">{macros.count.toLocaleString('en-IN')}</span></button>
          {cats.map(([c, n]) => (
            <div key={c} className={cx('group flex items-center rounded-lg', category === c ? 'bg-brand-50 dark:bg-brand-950/50' : 'hover:bg-surface2')}>
              <button type="button" onClick={() => setCategory(c)} className={cx('flex min-w-0 flex-1 items-center justify-between px-2 py-1.5 text-[13px]', category === c && 'font-semibold text-brand-800 dark:text-brand-200')}><span className="truncate">{c}</span><span className="text-[11px] text-muted tnum">{n.toLocaleString('en-IN')}</span></button>
              {canWrite && <span className="hidden pr-1 group-hover:flex"><button type="button" title="Rename" onClick={() => renameCat(c)} className="p-0.5"><Pencil className="h-3 w-3" /></button><button type="button" title="Delete" onClick={() => delCat(c)} className="p-0.5 text-rose-600"><Trash2 className="h-3 w-3" /></button></span>}
            </div>
          ))}
        </div>
      </Card>

      <Card padded={false} className="flex min-h-0 flex-col" bodyClass="flex min-h-0 flex-1 flex-col">
        <div className="space-y-2 border-b border-line p-2.5">
          <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input id="ms-search" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trigger, title, category, modality, tags or full text…" aria-label="Search library" />{q && <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setQ('')}><X className="h-4 w-4 text-muted" /></button>}</div>
          <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
            <button type="button" className="inline-flex items-center gap-1" onClick={() => setChecked(allChecked ? new Set() : new Set(res.ids.slice(0, 20000)))}>{allChecked ? <CheckSquare className="h-4 w-4 text-brand-600" /> : <Square className="h-4 w-4" />}Select all</button>
            <span className="text-muted tnum">{res.total.toLocaleString('en-IN')} found · {res.ms.toFixed(2)} ms</span>
            {checked.size > 0 && canWrite && (
              <span className="ml-auto flex items-center gap-1">
                <Badge tone="brand">{checked.size.toLocaleString('en-IN')} selected</Badge>
                <Button size="sm" icon={Tag} onClick={bulkMove}>Move</Button>
                <Menu trigger={<Button size="sm" icon={Download}>Export</Button>} items={['json', 'csv', 'txt', 'html', 'doc', 'docx', 'pdf'].map((f) => ({ label: f.toUpperCase(), onClick: () => exportMacros(f, Array.from(checked)).then((n) => toast(n + ' exported', 'success')).catch((e) => toast(e.message, 'error')) }))} />
                <Button size="sm" variant="danger-ghost" icon={Trash2} onClick={async () => { if (await deleteMacros(Array.from(checked))) setChecked(new Set()); }}>Delete</Button>
              </span>
            )}
          </div>
        </div>
        {res.ids.length ? (
          <VirtualList className="min-h-0 flex-1" count={res.ids.length} rowHeight={56} renderRow={(i) => {
            const id = res.ids[i];
            const m = macros.getMeta(id);
            if (!m) return null;
            return (
              <div onClick={() => setSelId(id)} onDoubleClick={() => onEdit(id)} className={cx('mx-1.5 flex h-[52px] cursor-pointer items-center gap-2 rounded-lg border px-2', selId === id ? 'border-brand-300 bg-brand-50 dark:border-brand-800 dark:bg-brand-950/40' : 'border-transparent hover:bg-surface2')}>
                <button type="button" onClick={(e) => { e.stopPropagation(); toggle(id); }} aria-label="Select">{checked.has(id) ? <CheckSquare className="h-4 w-4 text-brand-600" /> : <Square className="h-4 w-4 text-muted" />}</button>
                <span className={cx('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md', m.kind === 'template' ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300' : 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300')}>{m.kind === 'template' ? <FileText className="h-3.5 w-3.5" /> : <Layers className="h-3.5 w-3.5" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">{m.trigger && <code className="rounded bg-slate-100 px-1 font-mono text-[11px] font-bold dark:bg-slate-800">{m.trigger}</code>}<span className="truncate text-[13px] font-medium">{m.title}</span></span>
                  <span className="block truncate text-[11px] text-muted">{m.category} · {m.modality}{m.tags && m.tags.length ? ' · ' + m.tags.slice(0, 4).join(', ') : ''}</span>
                </span>
                <span className="hidden shrink-0 text-right text-[10.5px] text-muted sm:block">{timeAgo(m.updatedAt)}<br />{fmtBytes(m.size || 0)}</span>
              </div>
            );
          }} />
        ) : <Empty icon={Search} title={res.busy ? 'Searching…' : 'Nothing found'} text="Try a trigger like .abd, an organ, or a finding." />}
      </Card>

      <Card padded={false} className="flex min-h-0 flex-col" bodyClass="flex min-h-0 flex-1 flex-col" title={meta ? meta.title : 'Preview'} subtitle={meta ? `${kindLabel(meta.kind)} · ${meta.trigger || 'no trigger'} · ${meta.category}` : ''} icon={meta && meta.kind === 'template' ? FileText : Layers}>
        {preview ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-200/70 p-3 dark:bg-slate-950/60">
              <div className="print-page mx-auto bg-white p-[10mm] shadow" style={{ maxWidth: '210mm', fontFamily: cssFont(settings.report.fontFamily), fontSize: settings.report.fontSize + 'pt', lineHeight: settings.report.lineHeight }}>
                <div className="report-content" dangerouslySetInnerHTML={{ __html: preview.content }} />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 border-t border-line p-2.5">
              <Button size="sm" variant="primary" icon={CornerDownLeft} onClick={() => sendToLiveReport({ id: preview.id }, 'cursor')}>Paste / insert at cursor</Button>
              <Button size="sm" icon={Replace} onClick={() => sendToLiveReport({ id: preview.id }, 'replace')}>Replace report</Button>
              {canWrite && <Button size="sm" icon={Pencil} onClick={() => onEdit(preview.id)}>Edit</Button>}
              <Menu trigger={<Button size="sm">More</Button>} items={[
                { label: 'Open in Template Studio', icon: Maximize2, onClick: () => onStudio(preview) },
                canWrite && { label: 'Duplicate', icon: Copy, onClick: async () => { const d = await duplicateMacro(preview.id); if (d) { setSelId(d.id); toast('Duplicated', 'success'); } } },
                { label: 'Copy for Word / Docs', icon: Clipboard, onClick: async () => { await copyRich(preview.content); toast('Copied', 'success'); } },
                { label: 'Export .docx', icon: FileDown, onClick: () => exportDocx(preview.title, preview.content, { title: preview.title }) },
                { label: 'Print', icon: Printer, onClick: () => exportMacros('print', [preview.id]) },
                { label: 'Email', icon: Mail, onClick: () => openExternal(mailtoLink('', preview.title, stripHtml(preview.content))) },
                canWrite && { divider: true },
                canWrite && { label: 'Delete', icon: Trash2, danger: true, onClick: async () => { if (await deleteMacros([preview.id])) setSelId(null); } }
              ]} />
            </div>
          </>
        ) : <Empty icon={FileText} title="Select a macro" text="Its formatted preview appears here." />}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- full-page template studio
const TOOLS = [[Bold, 'bold'], [Italic, 'italic'], [Underline, 'underline'], [Heading3, 'formatBlock', 'h3'], [List, 'insertUnorderedList'], [ListOrdered, 'insertOrderedList']];
export function TemplateStudio({ initial, onSaved }) {
  const settings = useSettings();
  const version = useMacrosVersion();
  const [full, setFull] = useState(false);
  // the writing surface fills the whole width; "A4 page" brings back the printed-page look
  const [pageView, setPageView] = useLocalPref('studio-page-view', false);
  const [f, setF] = useState(() => Object.assign({ id: null, title: '', trigger: '', category: 'General', modality: MODALITIES[0] }, lsGet('ssdc-pref:studio-draft-meta', {})));
  const [saved, setSaved] = useState('');
  const ed = useRef(null);
  const canWrite = can('templates:manage_macros', 'DRAFT');
  useEffect(() => {
    if (initial) {
      setF({ id: initial.id || null, title: initial.title || '', trigger: initial.trigger || '', category: initial.category || 'General', modality: initial.modality || MODALITIES[0] });
      if (ed.current) ed.current.innerHTML = initial.content || '';
    } else if (ed.current && !ed.current.innerHTML) ed.current.innerHTML = lsGet('ssdc-pref:studio-draft', '');
  }, [initial]);
  // draft auto-save (visual indicator)
  const draftTimer = useRef(null);
  useEffect(() => () => clearTimeout(draftTimer.current), []);
  const onInput = () => {
    clearTimeout(draftTimer.current);
    setSaved('…');
    draftTimer.current = setTimeout(() => {
      if (!ed.current) return;
      const h = ed.current.innerHTML;
      lsSet('ssdc-pref:studio-draft', h.length < 2000000 ? h : '');
      lsSet('ssdc-pref:studio-draft-meta', f);
      setSaved('Draft saved ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 700);
  };
  const set = (p) => setF((x) => Object.assign({}, x, p));
  const html = () => (ed.current ? ed.current.innerHTML : '');
  const cats = useMemo(() => macros.categories(), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const dupId = f.trigger ? macros.idForTrigger(f.trigger) : null;
  const dup = dupId && dupId !== f.id ? macros.getMeta(dupId) : null;
  const save = async (inject) => {
    if (!canWrite) return toast('Your role cannot save templates', 'error');
    if (!f.title.trim()) return toast('Template title is required', 'warning');
    if (dup) return toast('Trigger ' + f.trigger + ' already belongs to “' + dup.title + '”', 'warning');
    const prev = f.id ? await macros.get(f.id) : null;
    const doc = await macros.save(Object.assign({}, prev || {}, { id: f.id || undefined, title: f.title.trim(), trigger: f.trigger.trim(), category: f.category, modality: f.modality, kind: 'template', content: html() }));
    set({ id: doc.id });
    clearTimeout(draftTimer.current);
    lsSet('ssdc-pref:studio-draft', '');
    toast('Template saved' + (doc.trigger ? ' — type ' + doc.trigger + ' + Space in any report' : ''), 'success');
    onSaved && onSaved(doc);
    if (inject) sendToLiveReport({ id: doc.id }, 'cursor');
  };
  const importInto = async () => {
    const files = await pickFiles({ accept: DOC_EXTS.map((e) => '.' + e).join(',') + ',.txt', multiple: true });
    for (const file of files) {
      try {
        const r = await fileToHtml(file);
        ed.current.focus();
        document.execCommand('insertHTML', false, r.html);
        if (!f.title) set({ title: r.title, category: guessCategory(r.title + ' ' + stripHtml(r.html).slice(0, 400)), modality: guessModality(r.title), trigger: f.trigger || autoTrigger(r.title) });
        toast('Imported ' + file.name, 'success');
      } catch (e) { toast(file.name + ': ' + e.message, 'error'); }
    }
    onInput();
  };
  const exportAs = async (fmt) => {
    const name = (f.title || 'Template').replace(/[^\w-]+/g, '_');
    if (fmt === 'docx') return exportDocx(name, html(), { title: f.title });
    if (fmt === 'html') return exportHtml(name, html(), { title: f.title });
    if (fmt === 'txt') return exportTxt(name, html());
    const r = renderReportPages({ id: 'tpl', status: 'SIGNED_FINAL', html: html(), images: [], demographics: { name: f.title, date: '' }, layout: { showDemographics: false, showSignature: false, watermarkDrafts: false } }, settings, {});
    return htmlToPdf(r.html, { widthMm: r.widthMm, heightMm: r.heightMm, filename: name + '.pdf' });
  };
  const tool = (cmd, val) => (e) => { e.preventDefault(); ed.current.focus(); document.execCommand(cmd, false, val || null); onInput(); };
  return (
    <div className={cx(full ? 'fixed inset-0 z-[66] flex flex-col bg-canvas' : 'flex flex-col')} style={full ? undefined : { height: 'calc(100vh - 15rem)', minHeight: 560 }}>
      <Card padded={false} className={cx('flex min-h-0 flex-1 flex-col', full && 'rounded-none border-0')} bodyClass="flex min-h-0 flex-1 flex-col">
        <div className="grid gap-2 border-b border-line p-3 md:grid-cols-12">
          <Field label="Template title" className="md:col-span-4"><Input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. USG Whole Abdomen – Grade II Fatty Liver" /></Field>
          <Field label="Shortcut trigger" className="md:col-span-2" error={dup ? 'used by “' + dup.title + '”' : ''}><Input className="font-mono" value={f.trigger} onChange={(e) => set({ trigger: e.target.value.replace(/\s/g, '') })} placeholder=".code" /></Field>
          <Field label="Category" className="md:col-span-2" extra={<button type="button" className="link normal-case" onClick={async () => { const c = await promptDialog({ title: 'New category', label: 'Name', required: true }); if (c) { macros.addCategory(c.trim()); set({ category: c.trim() }); } }}>+ new</button>}><Select value={f.category} onChange={(e) => set({ category: e.target.value })} options={cats.includes(f.category) ? cats : cats.concat([f.category])} /></Field>
          <Field label="Modality" className="md:col-span-2"><Select value={f.modality} onChange={(e) => set({ modality: e.target.value })} options={MODALITIES} /></Field>
          <div className="flex items-end justify-end gap-1.5 md:col-span-2">
            <Button size="sm" icon={full ? Minimize2 : Maximize2} onClick={() => setFull(!full)}>{full ? 'Exit full page' : 'Full page'}</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-0.5 border-b border-line bg-surface2 px-3 py-1">
          {TOOLS.map(([Icon, cmd, val]) => <button key={cmd + (val || '')} type="button" onMouseDown={tool(cmd, val)} className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-surface" title={cmd}><Icon className="h-4 w-4" /></button>)}
          <button type="button" title="Table" onMouseDown={(e) => { e.preventDefault(); ed.current.focus(); document.execCommand('insertHTML', false, '<table style="width:100%;border-collapse:collapse"><tr><th>Parameter</th><th>Measurement</th><th>Remark</th></tr><tr><td><br></td><td>[__]</td><td><br></td></tr></table><p><br></p>'); onInput(); }} className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-surface"><Table className="h-4 w-4" /></button>
          <button type="button" title="Placeholder [__]" onMouseDown={(e) => { e.preventDefault(); ed.current.focus(); document.execCommand('insertText', false, '[__]'); onInput(); }} className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-surface"><Brackets className="h-4 w-4" /></button>
          <span className="ml-2 inline-flex items-center gap-1.5 border-l border-line pl-2">
            <Segmented size="sm" ariaLabel="Editor width" value={pageView ? 'page' : 'wide'} onChange={(v) => setPageView(v === 'page')} options={[{ value: 'wide', label: 'Full width' }, { value: 'page', label: 'A4 page' }]} />
          </span>
          <span className="ml-3 text-[11px] text-muted">{saved}</span>
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button size="sm" icon={Upload} onClick={importInto}>Import file into box</Button>
            <Menu trigger={<Button size="sm" icon={Download}>Export</Button>} items={[{ label: 'MS Word (.docx)', onClick: () => exportAs('docx') }, { label: 'PDF (A4)', onClick: () => exportAs('pdf') }, { label: 'HTML', onClick: () => exportAs('html') }, { label: 'Plain text', onClick: () => exportAs('txt') }]} />
            <Menu trigger={<Button size="sm" icon={Mail}>Email</Button>} items={[{ label: 'Default mail app', onClick: () => openExternal(mailtoLink('', f.title || 'Template', stripHtml(html()))) }, { label: 'Gmail (web)', onClick: () => openExternal(gmailLink('', f.title || 'Template', stripHtml(html()))) }]} />
            <Button size="sm" icon={Save} onClick={() => save(false)} disabled={!canWrite}>Save template</Button>
            <Button size="sm" variant="primary" icon={CornerDownLeft} onClick={() => save(true)} disabled={!canWrite}>Save & inject into live report</Button>
          </span>
        </div>
        <div className={cx('min-h-0 flex-1 overflow-y-auto', pageView ? 'bg-slate-200/70 p-4 dark:bg-slate-950/60' : 'bg-white')}>
          <div ref={ed} contentEditable suppressContentEditableWarning onInput={onInput} aria-label="Template full-page editor" data-label="Template editor"
            className={cx('doc-body bg-white text-slate-900 outline-none', pageView ? 'mx-auto p-[14mm] shadow' : 'w-full px-3 py-2.5')}
            style={Object.assign({ fontFamily: cssFont(settings.report.fontFamily), fontSize: settings.report.fontSize + 'pt', lineHeight: settings.report.lineHeight },
              pageView ? { maxWidth: '210mm', minHeight: '297mm' } : { minHeight: '100%' })} />
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- data hub
function DataHub() {
  useMacrosVersion();
  const [busy, setBusy] = useState(null);
  const [prog, setProg] = useState({ done: 0, total: 0, label: '' });
  const [bench, setBench] = useState(null);
  const [storage, setStorage] = useState(null);
  const [stored, setStored] = useState(null);
  const [workerTokens, setWorkerTokens] = useState(null);
  const pasteBox = useRef(null);
  const canWrite = can('templates:manage_macros', 'DRAFT');
  const benchCount = Array.from(macros.meta.values()).filter((m) => m.bench).length;
  const refresh = async () => { setStorage(await estimateStorage()); setStored(await macros.storedCount()); const s = await macros.workerStats(); setWorkerTokens(s.tokens); };
  useEffect(() => { refresh(); }, []);
  const run = async (key, fn) => { setBusy(key); try { await fn(); } catch (e) { toast(e.message, 'error', 7000); } finally { setBusy(null); refresh(); } };
  const onProg = (label) => (done, total) => setProg({ done, total, label });

  const importData = () => run('data', async () => {
    const files = await pickFiles({ accept: '.json,.csv,.tsv,.txt', multiple: true });
    let total = 0;
    for (const f of files) {
      const recs = await parseDataFile(f);
      if (!recs.length) { toast(f.name + ': no macros found', 'warning'); continue; }
      const r = await macros.bulkImport(recs, onProg('Importing ' + f.name));
      total += r.count;
      toast(`${f.name}: ${r.count.toLocaleString('en-IN')} imported in ${r.ms} ms`, 'success');
    }
    if (total) toast(total.toLocaleString('en-IN') + ' macro(s) imported', 'success');
  });
  const importDocs = (files) => run('docs', async () => {
    const list = files || (await pickFiles({ accept: DOC_EXTS.map((e) => '.' + e).join(','), multiple: true }));
    if (!list.length) return;
    const recs = await documentsToTemplates(list, (d, t, name) => setProg({ done: d, total: t, label: 'Reading ' + name }));
    const r = await macros.bulkImport(recs, onProg('Indexing templates'));
    toast(r.count + ' template(s) created with automatic triggers', 'success');
  });
  const exportAll = (fmt) => run('export', async () => { const n = await exportMacros(fmt, null, onProg('Exporting')); toast(n.toLocaleString('en-IN') + ' exported as ' + fmt.toUpperCase(), 'success'); });
  const restore = async (mode) => {
    if (mode === 'reset' && !(await confirmDialog({ title: 'Factory reset the macro library?', message: 'A safety backup (JSON) of the current library downloads first. Then every macro is deleted and the built-in clinical library is restored.', confirmText: 'Back up & reset', danger: true }))) return;
    run('restore', async () => {
      if (mode === 'reset') await exportMacros('json');
      const n = await macros.restoreDefaults(mode);
      toast(mode === 'reset' ? 'Factory defaults restored (' + n + ' items)' : n + ' missing default(s) restored', 'success');
    });
  };
  const seed = () => run('seed', async () => {
    const r = await macros.seedBenchmark(100000, onProg('Seeding benchmark macros'));
    const qs = ['liver', 'calculus kidney', 'moderate hydronephrosis', 'thyroid nodule', '.b99999', 'benchmark 4567'];
    const rows = [];
    for (const qq of qs) {
      let best = null;
      for (let k = 0; k < 3; k++) { const t0 = performance.now(); const sr = await macros.search(qq, {}, 50); const rt = performance.now() - t0; if (!best || sr.ms < best.ms) best = { q: qq, ms: sr.ms, total: sr.total, rt, cold: best ? best.cold : sr.ms }; if (k === 0) best.cold = sr.ms; }
      rows.push(best);
    }
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) macros.idForTrigger('.b' + i * 97);
    rows.push({ q: '1,000 trigger look-ups (per look-up)', ms: (performance.now() - t0) / 1000, cold: (performance.now() - t0) / 1000, total: 1000, rt: performance.now() - t0 });
    setBench({ count: r.count, ms: r.ms, rows });
  });
  const clearBench = () => run('clear', async () => { const n = await macros.clearBenchmark(); toast(n.toLocaleString('en-IN') + ' benchmark macros removed', 'info'); setBench(null); });
  const savePaste = async () => {
    const h = pasteBox.current ? sanitizeHtml(pasteBox.current.innerHTML) : '';
    if (!stripHtml(h).trim()) return toast('Paste some content first', 'info');
    const title = await promptDialog({ title: 'Save pasted content as template', label: 'Title', required: true, defaultValue: stripHtml(h).trim().split(/\s+/).slice(0, 6).join(' ') });
    if (!title) return;
    const d = await macros.save({ title, trigger: autoTrigger(title), kind: 'template', category: guessCategory(title + ' ' + stripHtml(h).slice(0, 400)), modality: guessModality(title), content: h });
    pasteBox.current.innerHTML = '';
    toast('Saved “' + d.title + '” as ' + d.trigger, 'success');
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {busy && prog.total > 0 && (
        <div className="xl:col-span-2"><Card><div className="mb-1 flex justify-between text-sm"><b>{prog.label}</b><span className="tnum">{prog.done.toLocaleString('en-IN')} / {prog.total.toLocaleString('en-IN')}</span></div><Progress value={prog.done} max={prog.total} /></Card></div>
      )}
      <div className="grid gap-3 sm:grid-cols-4 xl:col-span-2">
        <Kpi label="Macros & templates" value={macros.count.toLocaleString('en-IN')} sub={`${Array.from(macros.meta.values()).filter((m) => m.kind === 'template').length.toLocaleString('en-IN')} templates`} icon={Layers} />
        <Kpi label="Stored in IndexedDB" value={stored === null ? '…' : stored.toLocaleString('en-IN')} sub="incl. deleted tombstones" icon={HardDrive} tone="violet" />
        <Kpi label="Search index terms" value={workerTokens === null ? '…' : workerTokens.toLocaleString('en-IN')} sub="Web Worker inverted index" icon={Zap} tone="amber" />
        <Kpi label="Browser storage used" value={storage ? fmtBytes(storage.usage) : '…'} sub={storage ? 'of ' + fmtBytes(storage.quota) + ' quota' : ''} icon={Database} tone="emerald" />
      </div>

      <Card title="Import" icon={Upload} subtitle="Word · PDF · HTML · Google Docs · JSON · CSV · TSV · TXT">
        <div className="space-y-3">
          <div className="rounded-xl border-2 border-dashed border-line p-4 text-center text-sm" onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const files = Array.from(e.dataTransfer.files || []); const docs = files.filter((f) => DOC_EXTS.includes(fileExt(f.name))); if (docs.length) importDocs(docs); else toast('Drop .docx / .pdf / .html files here (use the data import for JSON / CSV)', 'info'); }}>
            <FileText className="mx-auto mb-1 h-6 w-6 text-muted" />Drag & drop any number of Word / PDF / HTML documents — each becomes a template with an automatic trigger.
            <div className="mt-2 flex flex-wrap justify-center gap-2"><Button size="sm" icon={Upload} loading={busy === 'docs'} disabled={!canWrite} onClick={() => importDocs()}>Choose documents</Button><Button size="sm" icon={Database} loading={busy === 'data'} disabled={!canWrite} onClick={importData}>Bulk database (JSON / CSV / TSV / TXT)</Button></div>
          </div>
          <p className="text-[11.5px] text-muted">CSV / TSV columns: <code>trigger, title, modality, category, tags, content</code> (content may be HTML). TXT: one macro per block — first line <code>.trigger | Title</code>, then the text; separate blocks with a blank line. Imports run in 2,500-record chunks so 1,00,000+ rows never freeze the screen.</p>
          <div>
            <span className="label">Paste from Google Docs / MS Word</span>
            <div ref={pasteBox} contentEditable suppressContentEditableWarning className="doc-body max-h-48 min-h-[90px] overflow-y-auto rounded-lg border border-line bg-white p-2 text-[12.5px] text-slate-900" aria-label="Paste box" />
            <Button className="mt-1.5" size="sm" icon={Save} onClick={savePaste} disabled={!canWrite}>Save pasted content as template</Button>
          </div>
        </div>
      </Card>

      <Card title="Export & backup" icon={Download} subtitle="Whole library (filter & select in the Library tab to export a subset)">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[['json', 'JSON backup'], ['csv', 'CSV spreadsheet'], ['txt', 'Plain text'], ['html', 'HTML catalog'], ['doc', 'MS Word catalog (.doc)'], ['docx', 'MS Word (.docx ≤ 3,000)'], ['pdf', 'PDF reference book (≤ 1,500)'], ['print', 'Print reference book']].map(([f, label]) => (
            <Button key={f} size="sm" icon={f === 'print' ? Printer : FileDown} loading={busy === 'export'} onClick={() => exportAll(f)}>{label}</Button>
          ))}
        </div>
        <div className="mt-4 rounded-xl border border-line p-3">
          <div className="mb-1 flex items-center gap-2 font-semibold"><RotateCcw className="h-4 w-4 text-brand-600" />Restore Default Clinical Macros</div>
          <p className="text-[12.5px] text-muted">Abdomen, KUB, pelvis, obstetric, TI-RADS, BI-RADS, scrotal Doppler, X-ray and pathology baselines.</p>
          <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" loading={busy === 'restore'} disabled={!canWrite} onClick={() => restore('merge')}>Merge with my custom macros</Button><Button size="sm" variant="danger-ghost" disabled={!canWrite} onClick={() => restore('reset')}>Reset to factory defaults…</Button></div>
        </div>
      </Card>

      <Card title="Performance benchmark" icon={Gauge} subtitle="Seeds 1,00,000 realistic test macros into IndexedDB + the worker index" className="xl:col-span-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={Zap} loading={busy === 'seed'} onClick={seed} disabled={!!busy}>Seed 1,00,000 Test Macros</Button>
          {benchCount > 0 && <Button icon={Trash2} loading={busy === 'clear'} onClick={clearBench}>Remove {benchCount.toLocaleString('en-IN')} benchmark macros</Button>}
          <span className="text-[12px] text-muted">Benchmark macros stay on this workstation (not synced). Try typing <code>.b12345</code> + Space in a report.</span>
        </div>
        {bench && (
          <div className="mt-3 overflow-x-auto">
            <p className="mb-2 text-sm">Seeded <b>{bench.count.toLocaleString('en-IN')}</b> macros in <b>{(bench.ms / 1000).toFixed(1)} s</b>. Library now holds <b>{macros.count.toLocaleString('en-IN')}</b>.</p>
            <table className="tbl"><thead><tr><th>Query</th><th className="text-right">Search (warm)</th><th className="text-right">First run</th><th className="text-right">UI round trip</th><th className="text-right">Matches</th></tr></thead>
              <tbody>{bench.rows.map((r) => <tr key={r.q}><td><code>{r.q}</code></td><td className="text-right font-semibold tnum">{r.ms.toFixed(3)} ms</td><td className="text-right tnum text-muted">{(r.cold || r.ms).toFixed(2)} ms</td><td className="text-right tnum">{r.rt.toFixed(2)} ms</td><td className="text-right tnum">{r.total.toLocaleString('en-IN')}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- page
export function MacroStudio({ route }) {
  useMacrosVersion();
  const [tab, setTab] = useLocalPref('ms-tab', 'library');
  const [edit, setEdit] = useState(null);
  const [studioDoc, setStudioDoc] = useState(null);
  const canWrite = can('templates:manage_macros', 'DRAFT');
  useHotkeys({ 'ctrl+k': () => { setTab('library'); setTimeout(() => { const el = document.getElementById('ms-search'); if (el) el.focus(); }, 30); }, 'alt+m': () => { setTab('library'); setTimeout(() => { const el = document.getElementById('ms-search'); if (el) el.focus(); }, 30); } }, []);
  return (
    <div className="w-full">
      <PageHeader title="Templates & Macros" icon={Layers} subtitle={`${macros.count.toLocaleString('en-IN')} in library · IndexedDB + Web Worker index · triggers expand on Space / Enter / Tab in every report`}
        actions={<>
          <Button icon={Plus} disabled={!canWrite} onClick={() => setEdit({ kind: 'macro' })}>New macro</Button>
          <Button icon={FileText} disabled={!canWrite} onClick={() => { setStudioDoc({ title: '', content: '' }); setTab('studio'); }}>New template</Button>
          <Button variant="primary" icon={CornerDownLeft} onClick={() => navigate('/report')}>Open live report</Button>
        </>} />
      <div className="mb-3"><Segmented value={tab} onChange={setTab} options={[{ value: 'library', label: 'Library', icon: Layers }, { value: 'studio', label: 'Template Studio', icon: Maximize2 }, { value: 'hub', label: 'Data Hub', icon: Database }]} /></div>
      {tab === 'library' && <Library onEdit={async (id) => setEdit(await macros.get(id))} onStudio={(d) => { setStudioDoc(d); setTab('studio'); }} />}
      {tab === 'studio' && <TemplateStudio initial={studioDoc} />}
      {tab === 'hub' && <DataHub />}
      <MacroEditorModal open={!!edit} initial={edit} onClose={() => setEdit(null)} onInject={(doc) => sendToLiveReport({ id: doc.id }, 'cursor')} />
    </div>
  );
}

