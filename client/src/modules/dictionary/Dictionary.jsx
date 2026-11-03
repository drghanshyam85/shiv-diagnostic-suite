// Medical & Sonography Dictionary: instant fuzzy search over built-in + custom terms (virtualised),
// add / edit / delete (built-ins can be edited, hidden or restored), category & normal reference
// ranges, optional auto-text trigger, JSON / CSV import & export, and a live spell-check tester.
// Every change is whitelisted by the spell checker and expands as a trigger in the editor instantly.
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookMarked, Search, Plus, Save, Trash2, Upload, Download, RotateCcw, SpellCheck, Copy, X, Keyboard, BadgeCheck, ClipboardPaste } from 'lucide-react';
import { useDictionary, searchDictionary, saveEntry, deleteEntry, restoreSeedEntries, DICT_CATEGORIES, SEED_ENTRIES } from '../../core/dictionary';
import { macros } from '../../core/macros';
import { loadSpell, checkText, suggest, spellStats, autocorrectTail } from '../../core/spell';
import { can, logAudit } from '../../core/auth';
import { useHotkeys } from '../../core/hooks';
import { download, toCSV, csvToObjects, pickFiles, readAsText, readAsArrayBuffer, fileExt, copyText } from '../../core/utils';
import { readXlsx } from '../../core/xlsx';
import { formatRange } from '../../core/dictionary';
import { cx, PageHeader, Card, Button, Input, Textarea, Select, Field, Badge, Empty, Kpi, Menu, VirtualList, Modal, toast, confirmDialog } from '../../components/ui';

const blank = () => ({ id: null, term: '', category: 'Custom', definition: '', normal: '', trigger: '', autoText: '', rangeLow: '', rangeHigh: '', unit: '', population: '' });
const POPULATIONS = ['', 'Adult', 'Adult male', 'Adult female', 'Pregnancy', 'Child', 'Neonate', 'Elderly'];

/** Column aliases accepted by batch import (CSV, TSV, Excel, pasted cells, JSON). */
const pick = (r, names) => { for (const n of names) { const k = Object.keys(r).find((x) => x.trim().toLowerCase() === n); if (k && String(r[k]).trim() !== '') return String(r[k]).trim(); } return ''; };
function rowToEntry(r) {
  return {
    term: pick(r, ['term', 'word', 'phrase', 'name']), category: pick(r, ['category', 'modality', 'section']), definition: pick(r, ['definition', 'meaning', 'description']),
    normal: pick(r, ['normal', 'normal range', 'reference range', 'reference']), trigger: pick(r, ['trigger', 'shortcut', 'abbreviation']).replace(/\s/g, ''),
    autoText: pick(r, ['autotext', 'auto text', 'auto-text', 'expansion', 'insert text']), rangeLow: pick(r, ['rangelow', 'low', 'min', 'range low', 'lower']), rangeHigh: pick(r, ['rangehigh', 'high', 'max', 'range high', 'upper']),
    unit: pick(r, ['unit', 'units']), population: pick(r, ['population', 'group', 'applies to'])
  };
}

function Tester() {
  const [text, setText] = useState('Liver shows hyper echoic echotexture. Gall bladder shows multiple calculi with acoustic shadowing; no pericholecystic fluid. Rt kidney shows mild hydronephrosis with thinned cortex. Endometrium thikened.');
  const [res, setRes] = useState([]);
  const [ready, setReady] = useState(false);
  useEffect(() => { loadSpell().then(() => setReady(true)); }, []);
  useEffect(() => {
    if (!ready) return;
    const seen = new Set();
    setRes(checkText(text).filter((e) => { const k = e.word.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).map((e) => Object.assign({}, e, { sugg: suggest(e.word, 4) })));
  }, [text, ready]);
  const fixPhrase = (() => { const out = []; const words = text.split(/(\s+)/); let acc = ''; words.forEach((w) => { acc += w; const f = /\s$/.test(w) ? autocorrectTail(acc.trimEnd()) : null; if (f && !out.find((x) => x.from === f.from)) out.push(f); }); return out; })();
  const st = ready ? spellStats() : null;
  return (
    <Card title="Spell-check tester" icon={SpellCheck} subtitle={st ? `${st.english.toLocaleString('en-IN')} English + ${st.medical.toLocaleString('en-IN')} medical + ${st.custom.toLocaleString('en-IN')} dictionary words` : 'loading word lists…'}>
      <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} aria-label="Spell-check test text" />
      <div className="mt-2 space-y-1">
        {fixPhrase.map((f) => <div key={f.from} className="text-[12.5px]"><Badge tone="brand">autocorrect</Badge> <span className="line-through">{f.from}</span> → <b>{f.to}</b></div>)}
        {res.map((e) => (
          <div key={e.word} className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
            <Badge tone={e.type === 'ambiguous' ? 'amber' : 'rose'}>{e.type === 'ambiguous' ? 'check usage' : 'misspelt'}</Badge>
            <b>{e.word}</b>{e.sugg.length ? <span className="text-muted">→ {e.sugg.join(', ')}</span> : <span className="text-muted">no suggestion</span>}
          </div>
        ))}
        {ready && !res.length && !fixPhrase.length && <p className="text-[12.5px] text-emerald-700 dark:text-emerald-400">No issues found. ✓</p>}
      </div>
    </Card>
  );
}

export function Dictionary() {
  const list = useDictionary();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [sel, setSel] = useState(null);
  const [f, setF] = useState(blank());
  const search = useRef(null);
  const canWrite = can('templates:manage_macros', 'DRAFT');
  const results = useMemo(() => searchDictionary(list, q, cat), [list, q, cat]);
  const cats = useMemo(() => { const c = {}; list.forEach((e) => { c[e.category] = (c[e.category] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]); }, [list]);
  const nCustom = list.filter((e) => !e.seed).length;
  useEffect(() => { if (sel) { const e = list.find((x) => x.id === sel); if (e) setF(Object.assign(blank(), e)); } }, [sel, list]);
  useHotkeys({ 'ctrl+k': () => { if (search.current) search.current.focus(); }, 'alt+n': () => { setSel(null); setF(blank()); } }, []);
  const set = (p) => setF((x) => Object.assign({}, x, p));
  const trigClash = (() => {
    const t = String(f.trigger || '').trim().toLowerCase();
    if (!t) return '';
    const other = list.find((e) => e.id !== f.id && String(e.trigger || '').toLowerCase() === t);
    if (other) return 'already used by “' + other.term + '”';
    const mid = macros.idForTrigger(t);
    return mid ? 'used by macro “' + (macros.getMeta(mid) || {}).title + '” (the macro wins)' : '';
  })();
  const save = () => {
    if (!canWrite) return toast('Your role cannot edit the dictionary', 'error');
    if (!f.term.trim()) return toast('Term is required', 'warning');
    const dupe = list.find((e) => e.id !== f.id && e.term.toLowerCase() === f.term.trim().toLowerCase());
    if (dupe && !f.id) return toast('“' + dupe.term + '” already exists', 'warning');
    const d = saveEntry(f);
    setSel(d.id);
    toast((f.id ? 'Updated ' : 'Added ') + d.term + ' — whitelisted for spell check' + (d.trigger ? ' · trigger ' + d.trigger : ''), 'success');
  };
  const remove = async () => {
    if (!f.id) return;
    if (!(await confirmDialog({ title: 'Delete “' + f.term + '”?', message: f.id.startsWith('dseed_') ? 'This built-in term is hidden (restore it any time with “Restore built-in terms”).' : 'This custom term is deleted on every workstation.', confirmText: 'Delete', danger: true }))) return;
    deleteEntry(f);
    setSel(null);
    setF(blank());
  };
  const exportAs = (fmt) => {
    // same column names the importer reads, so an exported file can be edited in Excel and imported back
    const rows = results.map((e) => ({
      term: e.term, category: e.category, definition: e.definition || '', normal: e.normal || '', trigger: e.trigger || '', autoText: e.autoText || '',
      rangeLow: e.rangeLow ?? '', rangeHigh: e.rangeHigh ?? '', unit: e.unit || '', population: e.population || '', source: e.seed ? (e.edited ? 'built-in (edited)' : 'built-in') : 'custom'
    }));
    if (fmt === 'json') download('SSDC_Medical_Dictionary.json', JSON.stringify({ app: 'ssdc-suite', kind: 'dictionary', exportedAt: new Date().toISOString(), entries: rows }, null, 2), 'application/json');
    else download('SSDC_Medical_Dictionary.csv', toCSV(rows), 'text/csv;charset=utf-8');
    toast(rows.length + ' term(s) exported', 'success');
  };
  /** Merge imported rows: new terms are added, existing terms (same name) only get the columns that were filled. */
  const importRows = (rows, source) => {
    const have = new Map(list.map((e) => [e.term.toLowerCase(), e]));
    let added = 0;
    let updated = 0;
    rows.forEach((raw) => {
      const r = rowToEntry(raw);
      if (!r.term) return;
      const prev = have.get(r.term.toLowerCase());
      const merged = Object.assign({}, prev || {}, Object.fromEntries(Object.entries(r).filter(([, v]) => v !== '')));
      if (!merged.category) merged.category = 'Custom';
      if (prev && !r.normal && (r.rangeLow || r.rangeHigh)) merged.normal = '';
      saveEntry(merged);
      if (prev) updated++; else added++;
    });
    logAudit('dictionary:imported', 'dictionary', { source, added, updated });
    toast(`Dictionary import: ${added} added, ${updated} updated`, 'success');
  };
  const importFile = async () => {
    const files = await pickFiles({ accept: '.xlsx,.json,.csv,.tsv,.txt' });
    if (!files[0]) return;
    try {
      const ext = fileExt(files[0].name);
      let rows;
      if (ext === 'xlsx') rows = await readXlsx(await readAsArrayBuffer(files[0]));
      else {
        const text = await readAsText(files[0]);
        if (ext === 'json') { const j = JSON.parse(text); rows = Array.isArray(j) ? j : j.entries || j.dictionary || []; }
        else if (ext === 'txt') rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((term) => ({ term }));
        else rows = csvToObjects(text, ext === 'tsv' ? '\t' : undefined);
      }
      importRows(rows, files[0].name);
    } catch (e) { toast('Import failed: ' + e.message, 'error'); }
  };
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const importPaste = () => {
    const text = pasteText.trim();
    if (!text) return;
    const first = text.split(/\r?\n/)[0];
    const hasHeader = /term|word|phrase/i.test(first);
    const body = hasHeader ? text : 'term\tcategory\tdefinition\tnormal\ttrigger\n' + text;
    importRows(csvToObjects(body, first.includes('\t') || !hasHeader ? '\t' : undefined), 'pasted cells');
    setPasteText('');
    setPasteOpen(false);
  };
  const restore = async () => {
    if (!(await confirmDialog({ title: 'Restore built-in terms?', message: 'All edits to built-in terms are discarded and hidden built-ins come back. Your custom terms are kept.', confirmText: 'Restore' }))) return;
    toast(restoreSeedEntries() + ' built-in term(s) restored', 'success');
  };

  return (
    <div className="mx-auto max-w-[1700px]">
      <PageHeader title="Medical & Sonography Dictionary" icon={BookMarked} subtitle={`${list.length.toLocaleString('en-IN')} terms · ${nCustom} custom · instantly whitelisted for spell-check and shortcut expansion`}
        actions={<>
          <Button icon={Plus} disabled={!canWrite} onClick={() => { setSel(null); setF(blank()); }}>Add term <span className="kbd ml-1">Alt+N</span></Button>
          <Button icon={Upload} disabled={!canWrite} onClick={importFile}>Import Excel / CSV / JSON</Button>
          <Button icon={ClipboardPaste} disabled={!canWrite} onClick={() => setPasteOpen(true)}>Paste from Excel</Button>
          <Menu trigger={<Button icon={Download}>Export</Button>} items={[{ label: 'JSON backup', onClick: () => exportAs('json') }, { label: 'CSV / Excel', onClick: () => exportAs('csv') }]} />
          <Button icon={RotateCcw} disabled={!canWrite} onClick={restore}>Restore built-in terms</Button>
        </>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Kpi label="Total terms" value={list.length.toLocaleString('en-IN')} icon={BookMarked} />
        <Kpi label="Built-in" value={(list.length - nCustom).toLocaleString('en-IN')} sub={SEED_ENTRIES.length + ' shipped'} icon={BadgeCheck} tone="emerald" />
        <Kpi label="Custom" value={nCustom.toLocaleString('en-IN')} icon={Plus} tone="violet" />
        <Kpi label="With shortcut trigger" value={list.filter((e) => e.trigger).length} icon={Keyboard} tone="amber" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card padded={false} className="flex flex-col" bodyClass="flex min-h-0 flex-1 flex-col" style={{ height: 'calc(100vh - 19rem)', minHeight: 480 }}>
          <div className="space-y-2 border-b border-line p-3">
            <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input ref={search} autoFocus className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Fuzzy search terms, abbreviations, normal values… (Ctrl+K)" aria-label="Search dictionary" />{q && <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setQ('')}><X className="h-4 w-4 text-muted" /></button>}</div>
            <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
              <button type="button" className={cx('chip px-2 py-0.5 text-[11px]', !cat && 'chip-on')} onClick={() => setCat('')}>All <span className="text-muted">{list.length}</span></button>
              {cats.map(([c, n]) => <button key={c} type="button" className={cx('chip px-2 py-0.5 text-[11px]', cat === c && 'chip-on')} onClick={() => setCat(cat === c ? '' : c)}>{c} <span className="text-muted">{n}</span></button>)}
            </div>
            <div className="text-[11px] text-muted">{results.length.toLocaleString('en-IN')} match(es)</div>
          </div>
          {results.length ? (
            <VirtualList className="min-h-0 flex-1" count={results.length} rowHeight={58} renderRow={(i) => {
              const e = results[i];
              return (
                <div onClick={() => setSel(e.id)} className={cx('mx-1.5 h-[54px] cursor-pointer rounded-lg border px-2.5 py-1.5', sel === e.id ? 'border-brand-300 bg-brand-50 dark:border-brand-800 dark:bg-brand-950/40' : 'border-transparent hover:bg-surface2')}>
                  <div className="flex items-center gap-1.5"><b className="min-w-0 flex-1 truncate text-[13px]">{e.term}</b>{e.trigger && <code className="text-[10.5px] text-muted">{e.trigger}</code>}<Badge tone={e.seed ? (e.edited ? 'amber' : 'slate') : 'violet'}>{e.seed ? (e.edited ? 'edited' : 'built-in') : 'custom'}</Badge></div>
                  <div className="truncate text-[11px] text-muted">{e.category}{e.normal ? ' · Normal: ' + e.normal : e.definition ? ' · ' + e.definition : ''}</div>
                </div>
              );
            }} />
          ) : <Empty icon={BookMarked} title="No term found" text={q ? 'Add “' + q + '” as a new term →' : ''} action={canWrite && q ? <Button size="sm" icon={Plus} onClick={() => { setSel(null); setF(Object.assign(blank(), { term: q })); }}>Add “{q}”</Button> : null} />}
        </Card>

        <div className="space-y-4">
          <Card title={f.id ? 'Edit term' : 'Add new term'} icon={f.id ? BookMarked : Plus} actions={f.id && f.id.startsWith('dseed_') ? <Badge tone="slate">Built-in</Badge> : null}>
            <fieldset disabled={!canWrite} className="grid gap-3 sm:grid-cols-2">
              <Field label="Term / phrase" required className="sm:col-span-2"><Input value={f.term} onChange={(e) => set({ term: e.target.value })} placeholder="e.g. Resistive index (RI)" /></Field>
              <Field label="Category / modality"><Select value={f.category} onChange={(e) => set({ category: e.target.value })} options={Array.from(new Set(DICT_CATEGORIES.concat(cats.map((c) => c[0]), [f.category])))} /></Field>
              <Field label="Auto-text trigger (optional)" error={trigClash} hint="typed in a report + Space inserts the auto-text (or the term)"><Input className="font-mono" value={f.trigger} onChange={(e) => set({ trigger: e.target.value.replace(/\s/g, '') })} placeholder="e.g. ;ri" /></Field>
              <Field label="Auto-text inserted by the trigger (optional)" className="sm:col-span-2" hint="e.g. trigger ;hsm → “Hepatosplenomegaly with normal echotexture.” Leave blank to insert the term itself."><Textarea rows={2} value={f.autoText || ''} onChange={(e) => set({ autoText: e.target.value })} /></Field>
              <Field label="Clinical definition" className="sm:col-span-2"><Textarea rows={3} value={f.definition} onChange={(e) => set({ definition: e.target.value })} /></Field>
              <div className="sm:col-span-2 rounded-xl border border-line p-3">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">Normal reference range</div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <Field label="Low"><Input inputMode="decimal" value={f.rangeLow} onChange={(e) => set({ rangeLow: e.target.value, normal: '' })} placeholder="0.55" /></Field>
                  <Field label="High"><Input inputMode="decimal" value={f.rangeHigh} onChange={(e) => set({ rangeHigh: e.target.value, normal: '' })} placeholder="0.70" /></Field>
                  <Field label="Unit"><Input value={f.unit} onChange={(e) => set({ unit: e.target.value, normal: '' })} placeholder="mm, cm/s, g/dL…" /></Field>
                  <Field label="Applies to"><Select value={f.population} onChange={(e) => set({ population: e.target.value, normal: '' })} options={POPULATIONS.map((x) => ({ value: x, label: x || 'Everyone' }))} /></Field>
                </div>
                <Field label="Shown as" className="mt-2" hint="Built from the fields above; type here to word it yourself (e.g. several ranges)"><Input value={f.normal || formatRange(f)} onChange={(e) => set({ normal: e.target.value })} placeholder="e.g. 0.55–0.70 (renal interlobar arteries)" /></Field>
              </div>
            </fieldset>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" icon={Save} disabled={!canWrite} onClick={save}>{f.id ? 'Save changes' : 'Add to dictionary'}</Button>
              {f.id && <Button icon={Copy} onClick={() => copyText([f.term, f.definition, f.normal ? 'Normal: ' + f.normal : ''].filter(Boolean).join(' — ')).then(() => toast('Copied', 'success'))}>Copy</Button>}
              {f.id && canWrite && <Button variant="danger-ghost" icon={Trash2} onClick={remove}>Delete</Button>}
            </div>
          </Card>
          <Tester />
        </div>
      </div>
      <Modal open={pasteOpen} onClose={() => setPasteOpen(false)} size="lg" title="Paste terms from Excel / Google Sheets" icon={ClipboardPaste}
        footer={<><Button onClick={() => setPasteOpen(false)}>Cancel</Button><Button variant="primary" icon={Upload} disabled={!pasteText.trim()} onClick={importPaste}>Import</Button></>}>
        <p className="mb-2 text-[12.5px] text-muted">Copy cells from a spreadsheet and paste them here. With a header row, columns can be in any order: term, category, definition, normal, low, high, unit, population, trigger, auto-text. Without a header the order is term · category · definition · normal · trigger.</p>
        <Textarea rows={10} value={pasteText} onChange={(e) => setPasteText(e.target.value)} className="font-mono text-[12px]" placeholder={'term\tcategory\tlow\thigh\tunit\tpopulation\nHemoglobin\tPathology\t12\t15.5\tg/dL\tAdult female'} aria-label="Pasted spreadsheet cells" />
      </Modal>
    </div>
  );
}
