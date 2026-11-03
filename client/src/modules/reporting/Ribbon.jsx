// MS Word / Microsoft 365-style ribbon: File · Home · Insert · Draw/Tables · Design · Layout ·
// References · Review · View · Copilot. Buttons keep the editor selection (mousedown is cancelled),
// state (bold, alignment, font, size…) follows the caret, zoom runs 50–400 %.
import { useEffect, useRef, useState } from 'react';
import {
  FilePlus2, FolderOpen, FileUp, Save, FileText, Eye, Printer, Zap, Download, Copy, ExternalLink, Mail, Send, History, ShieldCheck, LockOpen,
  Scissors, ClipboardPaste, Paintbrush, Bold, Italic, Underline, Strikethrough, Subscript, Superscript, Highlighter, Baseline, RemoveFormatting,
  CaseSensitive, AArrowUp, AArrowDown, List, ListOrdered, IndentDecrease, IndentIncrease, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  ArrowDownUp, Square, Search, Replace, Undo2, Redo2, Table, Image, SeparatorHorizontal, Minus, Omega, CalendarClock, Brackets, Link,
  Signature, ScrollText, BetweenHorizontalStart, BetweenHorizontalEnd, BetweenVerticalStart, BetweenVerticalEnd, Trash2, Merge,
  PaintBucket, Grid3x3, Type, Stamp, PanelTop, Ruler, RectangleVertical, RectangleHorizontal, LayoutGrid, BookOpen, Quote, ListChecks,
  SpellCheck, Sparkles, BookMarked, Hash, Languages, ZoomIn, ZoomOut, Maximize2, Minimize2, Fullscreen, AppWindow, PanelLeft, PanelRight,
  Bot, Wand2, BrainCircuit, Stethoscope, MessageSquare, Gem, ScanEye, Mic, NotebookText, HardDrive, Pilcrow, Heading1, Heading3,
  FileDown, Clipboard, TableProperties, Rows3, Columns2, Keyboard, Globe, Lightbulb, Files, FileSignature, Lock, Calculator
} from 'lucide-react';
import { cx } from '../../components/ui';
import { getSettings } from '../../core/hooks';
import { exec, query, queryValue, currentFontPt, rangeIn, changeCase, styleBlocks, toggleBorder, tableOp, CLINICAL_TABLES, setFontSizePt, setFontFamily, setColor } from './editorUtils';
import { FONT_STACKS, MARGIN_PRESETS } from './reportPrint';

const TABS = ['File', 'Home', 'Insert', 'Draw / Tables', 'Design', 'Layout', 'References', 'Review', 'View', 'Copilot'];
const SIZES = [8, 9, 10, 10.5, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
const FONT_COLORS = ['#000000', '#0f172a', '#0c4a6e', '#0369a1', '#1d4ed8', '#b91c1c', '#c2410c', '#a16207', '#15803d', '#6d28d9', '#be185d', '#475569'];
const HILITES = ['#fef08a', '#bbf7d0', '#a5f3fc', '#fbcfe8', '#fed7aa', '#ddd6fe', '#e2e8f0'];
const SYMBOLS = ['°', '±', '×', '÷', '≈', '≤', '≥', '→', '←', '↑', '↓', 'µ', '²', '³', '½', '¼', '¾', '‰', '∆', 'α', 'β', 'γ', 'π', 'Ω', '♀', '♂', '•', '✓', '✗', '§', '©', '®', '₹', '…', '–', '—'];
const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 2.5, 3, 4];

function Btn({ icon: Icon, label, onClick, active, disabled, title, big, kbd, danger, className }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} title={title || (label + (kbd ? ' (' + kbd + ')' : ''))} aria-label={label || title} aria-pressed={active || undefined}
      className={cx('inline-flex shrink-0 items-center rounded-md text-ink transition disabled:cursor-not-allowed disabled:opacity-35',
        big ? 'h-[58px] min-w-[54px] flex-col justify-center gap-1 px-1.5 text-[10.5px] font-medium leading-3' : 'h-7 gap-1.5 px-1.5 text-[12px]',
        active ? 'bg-brand-100 text-brand-800 ring-1 ring-brand-300 dark:bg-brand-900/60 dark:text-brand-100 dark:ring-brand-700' : 'hover:bg-surface2',
        danger && 'text-rose-600', className)}>
      {Icon && <Icon className={big ? 'h-5 w-5' : 'h-4 w-4'} />}
      {label && <span className={cx(big ? 'max-w-[72px] text-center' : 'whitespace-nowrap')}>{label}</span>}
    </button>
  );
}

function Group({ label, children, className }) {
  return (
    <div className={cx('flex shrink-0 flex-col border-r border-line px-1.5', className)}>
      <div className="flex min-h-[60px] flex-1 items-center gap-0.5">{children}</div>
      <div className="pb-0.5 text-center text-[10px] text-muted">{label}</div>
    </div>
  );
}
const Col = ({ children }) => <div className="flex flex-col gap-0.5">{children}</div>;
const Row = ({ children }) => <div className="flex items-center gap-0.5">{children}</div>;

/** Drop-down panel anchored under a ribbon button (stays open while you choose). */
function Drop({ icon, label, big, title, children, width = 'w-56', disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <Btn icon={icon} label={label} big={big} title={title} disabled={disabled} active={open} onClick={() => setOpen(!open)} />
      {open && (
        <div className={cx('absolute left-0 top-full z-[70] mt-1 rounded-xl border border-line bg-surface p-1.5 shadow-pop', width)} onClick={(e) => { if (e.target.closest('[data-close]')) setOpen(false); }}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}
const Item = ({ icon: Icon, children, onClick, hint, active }) => (
  <button type="button" data-close onClick={onClick} className={cx('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-surface2', active && 'bg-brand-50 font-semibold text-brand-800 dark:bg-brand-950/50 dark:text-brand-200')}>
    {Icon && <Icon className="h-4 w-4 shrink-0 opacity-80" />}<span className="min-w-0 flex-1 truncate">{children}</span>{hint && <span className="text-[10px] text-muted">{hint}</span>}
  </button>
);

function GridPicker({ onPick }) {
  const [hv, setHv] = useState([0, 0]);
  return (
    <div>
      <div className="mb-1 text-center text-xs font-semibold text-muted">{hv[0] ? `${hv[0]} × ${hv[1]} table` : 'Insert table'}</div>
      <div className="grid grid-cols-8 gap-0.5" onMouseLeave={() => setHv([0, 0])}>
        {Array.from({ length: 64 }).map((_, i) => {
          const r = Math.floor(i / 8) + 1;
          const c = (i % 8) + 1;
          return <button key={i} type="button" data-close onMouseEnter={() => setHv([r, c])} onClick={() => onPick(r, c)} className={cx('h-4 w-4 rounded-[3px] border', r <= hv[0] && c <= hv[1] ? 'border-brand-500 bg-brand-200' : 'border-line bg-surface2')} />;
        })}
      </div>
    </div>
  );
}

function Swatches({ colors, onPick, custom, none }) {
  return (
    <div>
      <div className="grid grid-cols-6 gap-1">
        {colors.map((c) => <button key={c} type="button" data-close title={c} onClick={() => onPick(c)} className="h-6 w-6 rounded border border-line" style={{ background: c }} />)}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {none && <button type="button" data-close className="link text-xs" onClick={() => onPick('transparent')}>No colour</button>}
        {custom && <label className="ml-auto inline-flex items-center gap-1 text-xs text-muted">Custom<input type="color" className="h-6 w-8 cursor-pointer rounded border border-line" onChange={(e) => onPick(e.target.value)} /></label>}
      </div>
    </div>
  );
}

export function Ribbon({ api, st, act }) {
  const [tab, setTab] = useState('Home');
  const [fmt, setFmt] = useState({});
  const [lastFore, setLastFore] = useState('#b91c1c');
  const [lastHi, setLastHi] = useState('#fef08a');
  const ro = st.readOnly;
  const el = () => api.current && api.current.el();

  useEffect(() => {
    let raf = 0;
    const h = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const root = el();
        if (!root || !rangeIn(root)) return;
        setFmt({
          bold: query('bold'), italic: query('italic'), underline: query('underline'), strike: query('strikeThrough'), sub: query('subscript'), sup: query('superscript'),
          left: query('justifyLeft'), center: query('justifyCenter'), right: query('justifyRight'), full: query('justifyFull'),
          ul: query('insertUnorderedList'), ol: query('insertOrderedList'), font: String(queryValue('fontName') || '').replace(/["']/g, '').split(',')[0], size: currentFontPt(root), block: String(queryValue('formatBlock') || '').toLowerCase()
        });
      });
    };
    document.addEventListener('selectionchange', h);
    return () => { document.removeEventListener('selectionchange', h); cancelAnimationFrame(raf); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (cmd, val) => () => { if (ro) return; api.current.restore(); exec(cmd, val); api.current.respell(); };
  const withRoot = (fn) => () => { if (ro) return; const root = el(); if (root) { api.current.restore(); fn(root); } };
  const ins = (html) => () => { if (!ro) api.current.insert(html); };
  const L = st.layout;
  const setL = (patch) => act.setLayout(patch);

  // keep selection in the editor when pressing ribbon buttons
  const keepSel = (e) => { const t = e.target; if (t.closest('button') && !t.closest('input,select,label[data-keep]')) e.preventDefault(); };

  const zoomStep = (dir) => { const z = st.zoom; const next = dir > 0 ? ZOOMS.find((x) => x > z + 0.001) : ZOOMS.slice().reverse().find((x) => x < z - 0.001); act.setZoom(next || z); };
  const block = (tag, style) => () => {
    if (ro) return;
    api.current.restore();
    exec('formatBlock', tag);
    if (style) { const r = rangeIn(el()); const node = r && (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement); const b = node && node.closest('h1,h2,h3,h4,p,blockquote'); if (b) Object.assign(b.style, style); }
  };

  const groups = {
    File: (
      <>
        <Group label="Document">
          <Btn big icon={FilePlus2} label="New blank" onClick={act.newDoc} />
          <Btn big icon={FolderOpen} label="Open archive" onClick={act.openArchive} />
          <Btn big icon={FileUp} label="Import file" onClick={act.importFile} disabled={ro} title="Import .docx / .pdf / .html / .txt / .rtf / .doc into the report" />
          <Btn big icon={Save} label="Save" onClick={act.save} disabled={ro} kbd="Ctrl+S" />
          <Btn big icon={FileText} label="Save as template" onClick={act.saveAsTemplate} />
        </Group>
        <Group label="Print">
          <Btn big icon={Eye} label="Print preview" onClick={act.printPreview} />
          <Btn big icon={Printer} label="Print" onClick={act.print} kbd="Ctrl+P" />
          <Btn big icon={Zap} label="Quick print" onClick={act.quickPrint} title="Print immediately with the current layout" />
        </Group>
        <Group label="Export & share">
          <Drop big icon={Download} label="Export" width="w-60">
            <Item icon={FileDown} onClick={() => act.exportAs('docx')} hint=".docx">MS Word document</Item>
            <Item icon={FileText} onClick={() => act.exportAs('doc')} hint=".doc">Word 97-2003 compatible</Item>
            <Item icon={FileDown} onClick={() => act.exportAs('pdf')} hint=".pdf">PDF (A4, as printed)</Item>
            <Item icon={Globe} onClick={() => act.exportAs('html')} hint=".html">Web page</Item>
            <Item icon={Pilcrow} onClick={() => act.exportAs('md')} hint=".md">Markdown</Item>
            <Item icon={FileText} onClick={() => act.exportAs('txt')} hint=".txt">Plain text</Item>
            <Item icon={Files} onClick={() => act.exportAs('json')} hint=".json">Report data (JSON)</Item>
          </Drop>
          <Btn big icon={Clipboard} label="Copy for Word / Docs" onClick={act.copyRich} />
          <Btn big icon={ExternalLink} label="Google Docs" onClick={act.googleDocs} title="Copy rich report and open a new Google Doc (paste with Ctrl+V)" />
          <Btn big icon={Mail} label="Email" onClick={act.email} />
          <Btn big icon={Send} label="Send to patient" onClick={act.send} />
        </Group>
        <Group label="Finalise">
          <Btn big icon={History} label="Versions" onClick={act.versions} />
          {st.status === 'SIGNED_FINAL'
            ? <Btn big icon={LockOpen} label="Unlock (admin)" onClick={act.unlock} disabled={!st.canUnlock} />
            : <Btn big icon={ShieldCheck} label="Sign & lock" onClick={act.sign} disabled={!st.canSign} />}
        </Group>
      </>
    ),
    Home: (
      <>
        <Group label="Undo">
          <Col><Btn icon={Undo2} title="Undo (Ctrl+Z)" onClick={run('undo')} disabled={ro} /><Btn icon={Redo2} title="Redo (Ctrl+Y)" onClick={run('redo')} disabled={ro} /></Col>
        </Group>
        <Group label="Clipboard">
          <Btn big icon={ClipboardPaste} label="Paste" onClick={act.paste} disabled={ro} title="Paste (Ctrl+V) · plain text: Ctrl+Shift+V" />
          <Col>
            <Btn icon={Scissors} label="Cut" onClick={run('cut')} disabled={ro} />
            <Btn icon={Copy} label="Copy" onClick={run('copy')} />
            <Btn icon={Paintbrush} label="Format painter" active={st.painter} onClick={act.painter} disabled={ro} />
          </Col>
        </Group>
        <Group label="Font">
          <Col>
            <Row>
              <select data-keep className="input input-sm h-7 w-[132px] py-0" value={Object.keys(FONT_STACKS).includes(fmt.font) ? fmt.font : ''} disabled={ro} aria-label="Font family"
                onChange={(e) => { const f = e.target.value; if (f) setFontFamily(el(), f, api.current.range()); }}>
                <option value="">{fmt.font || 'Font'}</option>
                {Object.keys(FONT_STACKS).map((f) => <option key={f} value={f} style={{ fontFamily: FONT_STACKS[f] }}>{f}</option>)}
              </select>
              <input data-keep list="rb-sizes" className="input input-sm h-7 w-[54px] py-0 text-center" value={fmt.sizeEdit !== undefined ? fmt.sizeEdit : fmt.size || ''} disabled={ro} aria-label="Font size (pt)"
                onChange={(e) => setFmt((f) => Object.assign({}, f, { sizeEdit: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') { const v = parseFloat(e.target.value); if (v >= 5 && v <= 200) setFontSizePt(el(), v, api.current.range()); setFmt((f) => Object.assign({}, f, { sizeEdit: undefined, size: v })); } }}
                onBlur={(e) => { const v = parseFloat(e.target.value); if (fmt.sizeEdit !== undefined && v >= 5 && v <= 200) setFontSizePt(el(), v, api.current.range()); setFmt((f) => Object.assign({}, f, { sizeEdit: undefined })); }} />
              <datalist id="rb-sizes">{SIZES.map((s) => <option key={s} value={s} />)}</datalist>
              <Btn icon={AArrowUp} title="Increase font size" onClick={withRoot((root) => setFontSizePt(root, Math.min(200, (fmt.size || 11) + (fmt.size >= 12 ? 2 : 1)), api.current.range()))} disabled={ro} />
              <Btn icon={AArrowDown} title="Decrease font size" onClick={withRoot((root) => setFontSizePt(root, Math.max(5, (fmt.size || 11) - (fmt.size > 12 ? 2 : 1)), api.current.range()))} disabled={ro} />
              <Drop icon={CaseSensitive} title="Change case" width="w-44" disabled={ro}>
                {['sentence', 'lower', 'upper', 'title', 'toggle'].map((m) => <Item key={m} onClick={withRoot((root) => changeCase(root, m))}>{{ sentence: 'Sentence case.', lower: 'lowercase', upper: 'UPPERCASE', title: 'Capitalize Each Word', toggle: 'tOGGLE cASE' }[m]}</Item>)}
              </Drop>
              <Btn icon={RemoveFormatting} title="Clear formatting" onClick={withRoot(() => { exec('removeFormat'); exec('unlink'); })} disabled={ro} />
            </Row>
            <Row>
              <Btn icon={Bold} title="Bold (Ctrl+B)" active={fmt.bold} onClick={run('bold')} disabled={ro} />
              <Btn icon={Italic} title="Italic (Ctrl+I)" active={fmt.italic} onClick={run('italic')} disabled={ro} />
              <Btn icon={Underline} title="Underline (Ctrl+U)" active={fmt.underline} onClick={run('underline')} disabled={ro} />
              <Btn icon={Strikethrough} title="Strikethrough" active={fmt.strike} onClick={run('strikeThrough')} disabled={ro} />
              <Btn icon={Subscript} title="Subscript" active={fmt.sub} onClick={run('subscript')} disabled={ro} />
              <Btn icon={Superscript} title="Superscript" active={fmt.sup} onClick={run('superscript')} disabled={ro} />
              <span className="flex items-center">
                <Btn icon={Highlighter} title="Text highlight colour" onClick={withRoot((root) => setColor(root, 'back', lastHi, api.current.range()))} disabled={ro} />
                <Drop title="Highlight colours" width="w-52" disabled={ro}>{() => <Swatches colors={HILITES} none custom onPick={(c) => { setLastHi(c); setColor(el(), 'back', c, api.current.range()); }} />}</Drop>
              </span>
              <span className="flex items-center">
                <Btn icon={Baseline} title="Font colour" onClick={withRoot((root) => setColor(root, 'fore', lastFore, api.current.range()))} disabled={ro} className="[&_svg]:text-current" />
                <Drop title="Font colours" width="w-52" disabled={ro}>{() => <Swatches colors={FONT_COLORS} custom onPick={(c) => { setLastFore(c); setColor(el(), 'fore', c, api.current.range()); }} />}</Drop>
              </span>
            </Row>
          </Col>
        </Group>
        <Group label="Paragraph">
          <Col>
            <Row>
              <Btn icon={List} title="Bullets" active={fmt.ul} onClick={run('insertUnorderedList')} disabled={ro} />
              <Btn icon={ListOrdered} title="Numbering" active={fmt.ol} onClick={run('insertOrderedList')} disabled={ro} />
              <Btn icon={IndentDecrease} title="Decrease indent" onClick={run('outdent')} disabled={ro} />
              <Btn icon={IndentIncrease} title="Increase indent" onClick={run('indent')} disabled={ro} />
              <Drop icon={ArrowDownUp} title="Line & paragraph spacing" width="w-52" disabled={ro}>
                {[1, 1.15, 1.3, 1.5, 2, 2.5, 3].map((v) => <Item key={v} onClick={withRoot((root) => styleBlocks(root, { lineHeight: String(v) }))}>Line spacing {v.toFixed(v % 1 ? 2 : 1)}</Item>)}
                <div className="my-1 border-t border-line" />
                <Item onClick={withRoot((root) => styleBlocks(root, { marginTop: '0', marginBottom: '0' }))}>No space before / after</Item>
                <Item onClick={withRoot((root) => styleBlocks(root, { marginBottom: '6pt' }))}>Add 6 pt after paragraph</Item>
                <Item onClick={withRoot((root) => styleBlocks(root, { marginTop: '12pt' }))}>Add 12 pt before paragraph</Item>
              </Drop>
            </Row>
            <Row>
              <Btn icon={AlignLeft} title="Align left" active={fmt.left} onClick={run('justifyLeft')} disabled={ro} />
              <Btn icon={AlignCenter} title="Center" active={fmt.center} onClick={run('justifyCenter')} disabled={ro} />
              <Btn icon={AlignRight} title="Align right" active={fmt.right} onClick={run('justifyRight')} disabled={ro} />
              <Btn icon={AlignJustify} title="Justify" active={fmt.full} onClick={run('justifyFull')} disabled={ro} />
              <Btn icon={Square} title="Borders around paragraph" onClick={withRoot((root) => toggleBorder(root))} disabled={ro} />
            </Row>
          </Col>
        </Group>
        <Group label="Styles">
          <div className="grid grid-cols-3 gap-0.5">
            {[['p', 'Normal', null, ''], ['h3', 'Heading', null, 'font-bold'], ['h3c', 'Section', { textAlign: 'center', textDecoration: 'underline' }, 'font-bold underline'], ['h2', 'Title', { textAlign: 'center' }, 'font-extrabold'], ['h4', 'Subhead', null, 'font-semibold'], ['blockquote', 'Note', null, 'italic']].map(([tag, label, style, cls]) => (
              <button key={tag} type="button" disabled={ro} onClick={block(tag === 'h3c' ? 'h3' : tag, style)}
                className={cx('h-7 rounded-md border border-line px-2 text-[11.5px] hover:border-brand-400 disabled:opacity-40', cls, (fmt.block === tag || (tag === 'p' && fmt.block === 'p')) && 'border-brand-500 bg-brand-50 dark:bg-brand-950/40')}>{label}</button>
            ))}
          </div>
        </Group>
        <Group label="Editing">
          <Col>
            <Btn icon={Search} label="Find" onClick={() => act.find(false)} kbd="Ctrl+F" />
            <Btn icon={Replace} label="Replace" onClick={() => act.find(true)} kbd="Ctrl+H" disabled={ro} />
            <Btn icon={Keyboard} label="Insert macro" onClick={act.palette} kbd="Ctrl+K" disabled={ro} />
          </Col>
        </Group>
      </>
    ),
    Insert: (
      <>
        <Group label="Tables">
          <Drop big icon={Table} label="Table" width="w-auto" disabled={ro}>{() => <GridPicker onPick={(r, c) => api.current.insert(`<table style="width:100%;border-collapse:collapse">${Array.from({ length: r }).map((_, i) => '<tr>' + Array.from({ length: c }).map(() => (i === 0 ? '<th><br></th>' : '<td><br></td>')).join('') + '</tr>').join('')}</table><p><br></p>`)} />}</Drop>
          <Drop big icon={TableProperties} label="Clinical tables" width="w-64" disabled={ro}>
            {Object.entries(CLINICAL_TABLES).map(([k, t]) => <Item key={k} icon={Grid3x3} onClick={() => act.clinicalTable(k)}>{t.label}</Item>)}
          </Drop>
        </Group>
        <Group label="Media">
          <Btn big icon={Image} label="Report images" onClick={act.images} disabled={ro} title="Attach ultrasound images (2 / 4 / 6 per page)" />
          <Btn big icon={Image} label="Inline picture" onClick={act.inlineImage} disabled={ro} />
        </Group>
        <Group label="Pages & text">
          <Btn big icon={SeparatorHorizontal} label="Page break" onClick={ins('<div class="page-break" contenteditable="false"></div><p><br></p>')} disabled={ro} />
          <Col>
            <Btn icon={Minus} label="Horizontal line" onClick={ins('<hr><p><br></p>')} disabled={ro} />
            <Btn icon={Brackets} label="Placeholder [__]" onClick={ins('[__]')} disabled={ro} />
            <Btn icon={CalendarClock} label="Date & time" onClick={() => !ro && api.current.insertText(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))} disabled={ro} />
          </Col>
          <Col>
            <Drop icon={Omega} label="Symbol" width="w-60" disabled={ro}>
              <div className="grid grid-cols-8 gap-1">{SYMBOLS.map((s) => <button key={s} type="button" data-close className="h-7 rounded border border-line text-sm hover:bg-surface2" onClick={() => api.current.insertText(s)}>{s}</button>)}</div>
            </Drop>
            <Btn icon={Link} label="Link" onClick={act.link} disabled={ro} />
            <Btn icon={Signature} label="PC-PNDT declaration" onClick={act.pcpndt} disabled={ro} />
          </Col>
        </Group>
        <Group label="Templates">
          <Btn big icon={ScrollText} label="Template" onClick={() => act.palette('template')} disabled={ro} />
          <Btn big icon={Keyboard} label="Macro / snippet" onClick={() => act.palette('macro')} disabled={ro} />
          <Btn big icon={FilePlus2} label="New template" onClick={act.newMacro} />
        </Group>
      </>
    ),
    'Draw / Tables': (
      <>
        <Group label="Draw">
          <Drop big icon={Grid3x3} label="Draw table" width="w-auto" disabled={ro}>{() => <GridPicker onPick={(r, c) => api.current.insert(`<table style="width:100%;border-collapse:collapse">${Array.from({ length: r }).map(() => '<tr>' + Array.from({ length: c }).map(() => '<td><br></td>').join('') + '</tr>').join('')}</table><p><br></p>`)} />}</Drop>
        </Group>
        <Group label="Rows & columns (place the cursor in a table)">
          <Col><Btn icon={BetweenHorizontalStart} label="Row above" onClick={withRoot((r) => tableOp(r, 'rowAbove'))} disabled={ro} /><Btn icon={BetweenHorizontalEnd} label="Row below" onClick={withRoot((r) => tableOp(r, 'rowBelow'))} disabled={ro} /></Col>
          <Col><Btn icon={BetweenVerticalStart} label="Column left" onClick={withRoot((r) => tableOp(r, 'colLeft'))} disabled={ro} /><Btn icon={BetweenVerticalEnd} label="Column right" onClick={withRoot((r) => tableOp(r, 'colRight'))} disabled={ro} /></Col>
          <Col><Btn icon={Rows3} label="Delete row" onClick={withRoot((r) => tableOp(r, 'delRow'))} disabled={ro} /><Btn icon={Columns2} label="Delete column" onClick={withRoot((r) => tableOp(r, 'delCol'))} disabled={ro} /></Col>
          <Col><Btn icon={Trash2} label="Delete table" danger onClick={withRoot((r) => tableOp(r, 'delTable'))} disabled={ro} /><Btn icon={Merge} label="Merge right" onClick={withRoot((r) => tableOp(r, 'mergeRight'))} disabled={ro} /></Col>
        </Group>
        <Group label="Style">
          <Col>
            <Btn icon={Heading1} label="Header row" onClick={withRoot((r) => tableOp(r, 'header'))} disabled={ro} />
            <Btn icon={Square} label="Borders on / off" onClick={withRoot((r) => tableOp(r, 'borders'))} disabled={ro} />
          </Col>
          <Drop big icon={PaintBucket} label="Shading" width="w-52" disabled={ro}>{() => <Swatches colors={['#f1f5f9', '#e0f2fe', '#dcfce7', '#fef9c3', '#fee2e2', '#ede9fe', '#e2e8f0', '#cbd5e1']} none custom onPick={(c) => { const root = el(); api.current.restore(); tableOp(root, 'shade', c === 'transparent' ? '' : c); }} />}</Drop>
          <Btn big icon={Maximize2} label="Fit to width" onClick={withRoot((r) => tableOp(r, 'fit'))} disabled={ro} />
        </Group>
      </>
    ),
    Design: (
      <>
        <Group label="Document font">
          <Col>
            <select className="input input-sm h-7 w-[150px] py-0" value={L.fontFamily} onChange={(e) => setL({ fontFamily: e.target.value })} aria-label="Document font">
              {Object.keys(FONT_STACKS).map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <Row>
              <span className="text-[11px] text-muted">Size</span>
              <select className="input input-sm h-7 w-[64px] py-0" value={L.fontSize} onChange={(e) => setL({ fontSize: Number(e.target.value) })} aria-label="Document font size">{[9, 10, 10.5, 11, 11.5, 12, 13, 14].map((s) => <option key={s} value={s}>{s}</option>)}</select>
              <span className="text-[11px] text-muted">Line</span>
              <select className="input input-sm h-7 w-[64px] py-0" value={L.lineHeight} onChange={(e) => setL({ lineHeight: Number(e.target.value) })} aria-label="Document line height">{[1.15, 1.25, 1.35, 1.45, 1.6, 1.8, 2].map((s) => <option key={s} value={s}>{s}</option>)}</select>
            </Row>
          </Col>
        </Group>
        <Group label="Letterhead">
          <Drop big icon={PanelTop} label="Header mode" width="w-72">
            <Item active={L.headerMode === 'full' && !L.fromTemplate && L.showHeader !== false} onClick={() => setL({ headerMode: 'full', showHeader: true })}>Full colour letterhead (plain paper)</Item>
            {(getSettings().letterheads || []).map((t) => <Item key={t.id} active={!!L.fromTemplate && L.letterheadId === t.id} onClick={() => setL({ headerMode: 'template', letterheadId: t.id, showHeader: true })}>Template: {t.name}</Item>)}
            <Item active={L.headerMode === 'letterhead'} onClick={() => setL({ headerMode: 'letterhead', showHeader: true })}>Pre-printed letterhead (blank spacer)</Item>
            <Item active={L.headerMode === 'none' || L.showHeader === false} onClick={() => setL({ headerMode: 'none' })}>No header</Item>
          </Drop>
          <Btn big icon={PanelTop} label="Header & footer" onClick={act.headerFooter} />
          <Btn big icon={Stamp} label={L.watermarkDrafts ? 'Draft watermark: on' : 'Draft watermark: off'} active={L.watermarkDrafts} onClick={() => setL({ watermarkDrafts: !L.watermarkDrafts })} />
        </Group>
        <Group label="Defaults">
          <Btn big icon={Type} label="Set as clinic default" onClick={act.layoutDefault} disabled={!st.isAdmin} title="Save this report's layout as the default for all reports" />
          <Btn big icon={Undo2} label="Reset layout" onClick={act.layoutReset} />
        </Group>
      </>
    ),
    Layout: (
      <>
        <Group label="Page setup">
          <Drop big icon={Ruler} label="Margins" width="w-60">
            {Object.entries(MARGIN_PRESETS).map(([k, p]) => <Item key={k} onClick={() => setL({ margins: p.m })} hint={`${p.m.top}/${p.m.right}/${p.m.bottom}/${p.m.left}`}>{p.label}</Item>)}
            <Item onClick={act.margins}>Custom margins…</Item>
          </Drop>
          <Drop big icon={L.orientation === 'landscape' ? RectangleHorizontal : RectangleVertical} label="Orientation" width="w-44">
            <Item icon={RectangleVertical} active={L.orientation !== 'landscape'} onClick={() => setL({ orientation: 'portrait' })}>Portrait</Item>
            <Item icon={RectangleHorizontal} active={L.orientation === 'landscape'} onClick={() => setL({ orientation: 'landscape' })}>Landscape</Item>
          </Drop>
          <Btn big icon={Files} label="Size: A4" title="Paper size A4 (210 × 297 mm)" onClick={() => {}} />
        </Group>
        <Group label="Paragraph">
          <Col>
            <Drop icon={ArrowDownUp} label="Line spacing" width="w-44" disabled={ro}>{[1, 1.15, 1.5, 2].map((v) => <Item key={v} onClick={withRoot((root) => styleBlocks(root, { lineHeight: String(v) }))}>{v}</Item>)}</Drop>
            <Btn icon={IndentIncrease} label="Indent" onClick={run('indent')} disabled={ro} />
            <Btn icon={IndentDecrease} label="Outdent" onClick={run('outdent')} disabled={ro} />
          </Col>
        </Group>
        <Group label="Breaks & images">
          <Btn big icon={SeparatorHorizontal} label="Page break" onClick={ins('<div class="page-break" contenteditable="false"></div><p><br></p>')} disabled={ro} />
          <Drop big icon={LayoutGrid} label={'Images: ' + L.imagesPerPage + ' / page'} width="w-44">
            {[2, 4, 6].map((n) => <Item key={n} active={Number(L.imagesPerPage) === n} onClick={() => setL({ imagesPerPage: n })}>{n} images per page</Item>)}
          </Drop>
        </Group>
      </>
    ),
    References: (
      <>
        <Group label="Report sections">
          <Btn big icon={Heading3} label="IMPRESSION" onClick={ins('<h3><u>IMPRESSION</u></h3><ol><li><strong>[__]</strong></li></ol>')} disabled={ro} />
          <Btn big icon={ListChecks} label="Differential" onClick={ins('<h3><u>DIFFERENTIAL DIAGNOSIS</u></h3><ol><li>[__]</li></ol>')} disabled={ro} />
          <Btn big icon={Lightbulb} label="Advice" onClick={ins('<p><strong>ADVICE:</strong> [__]</p>')} disabled={ro} />
          <Btn big icon={Quote} label="Correlate" onClick={ins('<p><em>Kindly correlate clinically.</em></p>')} disabled={ro} />
        </Group>
        <Group label="Reference values">
          <Btn big icon={BookOpen} label="Normal values" onClick={act.normals} disabled={ro} title="Insert a normal reference value from the medical dictionary" />
          <Drop big icon={BookMarked} label="Lexicons" width="w-64" disabled={ro}>
            <Item onClick={() => act.reference('tirads')}>ACR TI-RADS categories</Item>
            <Item onClick={() => act.reference('birads')}>ACR BI-RADS categories</Item>
            <Item onClick={() => act.reference('fatty')}>Fatty liver grading</Item>
            <Item onClick={() => act.reference('hdn')}>Hydronephrosis grading (SFU)</Item>
            <Item onClick={() => act.reference('bpp')}>Biophysical profile scoring</Item>
          </Drop>
          <Btn big icon={Superscript} label="Footnote" onClick={act.footnote} disabled={ro} />
        </Group>
      </>
    ),
    Review: (
      <>
        <Group label="Proofing">
          <Btn big icon={SpellCheck} label="Spelling & grammar" onClick={act.spellReview} />
          <Btn big icon={Sparkles} label="AI proofread" onClick={() => act.ai('proofread')} disabled={ro} />
          <Btn big icon={BookMarked} label="Add to dictionary" onClick={act.addToDictionary} title="Add the selected word / phrase to the custom medical dictionary" />
          <Btn big icon={Hash} label="Word count" onClick={act.wordCount} />
        </Group>
        <Group label="Live checking">
          <Col>
            <label data-keep className="flex items-center gap-1.5 px-1 text-[12px]"><input type="checkbox" className="accent-brand-600" checked={st.spellOn} onChange={act.toggleSpell} />Live spell check</label>
            <label data-keep className="flex items-center gap-1.5 px-1 text-[12px]"><input type="checkbox" className="accent-brand-600" checked={st.autocorrectOn} onChange={act.toggleAutocorrect} />Autocorrect as you type</label>
            <Btn icon={Languages} label="Dictionary manager" onClick={act.dictionary} />
          </Col>
        </Group>
        <Group label="Versions & signing">
          <Btn big icon={History} label="Version history" onClick={act.versions} />
          <Btn big icon={Save} label="Save version" onClick={act.snapshot} />
          {st.status === 'SIGNED_FINAL'
            ? <Btn big icon={LockOpen} label="Unlock" onClick={act.unlock} disabled={!st.canUnlock} />
            : <Btn big icon={FileSignature} label="Sign & lock" onClick={act.sign} disabled={!st.canSign} />}
        </Group>
      </>
    ),
    View: (
      <>
        <Group label="Views">
          <Btn big icon={FileText} label="Edit view" active={st.view === 'edit'} onClick={() => act.setView('edit')} />
          <Btn big icon={Eye} label="Print layout" active={st.view === 'print'} onClick={() => act.setView('print')} title="Exact A4 pages with running headers, footers and signature" />
          <Btn big icon={Ruler} label="Page guides" active={st.guides} onClick={act.toggleGuides} />
        </Group>
        <Group label="Zoom">
          <Btn big icon={ZoomOut} label="Zoom out" onClick={() => zoomStep(-1)} disabled={st.zoom <= 0.5} />
          <div className="flex flex-col items-center gap-1 px-1">
            <input type="range" min="50" max="400" step="5" value={Math.round(st.zoom * 100)} onChange={(e) => act.setZoom(Number(e.target.value) / 100)} className="w-28 accent-brand-600" aria-label="Zoom" />
            <select className="input input-sm h-6 w-20 py-0 text-[11px]" value={ZOOMS.includes(st.zoom) ? st.zoom : ''} onChange={(e) => act.setZoom(Number(e.target.value))} aria-label="Zoom preset">
              {!ZOOMS.includes(st.zoom) && <option value="">{Math.round(st.zoom * 100)}%</option>}
              {ZOOMS.map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
            </select>
          </div>
          <Btn big icon={ZoomIn} label="Zoom in" onClick={() => zoomStep(1)} disabled={st.zoom >= 4} />
          <Btn big icon={Maximize2} label="100%" onClick={() => act.setZoom(1)} />
          <Btn big icon={RectangleHorizontal} label="Page width" active={st.zoomFit} onClick={act.fitWidth} />
        </Group>
        <Group label="Panels">
          <Btn big icon={PanelLeft} label="Worklist" active={st.showLeft} onClick={act.toggleLeft} />
          <Btn big icon={PanelRight} label="Side panel" active={st.showRight} onClick={act.toggleRight} />
          <Btn big icon={Keyboard} label="Macro bar" active={st.macroBar} onClick={act.toggleMacroBar} />
        </Group>
        <Group label="Window">
          <Btn big icon={Minimize2} label="Minimize" onClick={act.minimize} />
          <Btn big icon={st.maximized ? Minimize2 : Maximize2} label={st.maximized ? 'Restore' : 'Maximize'} onClick={act.maximize} />
          <Btn big icon={Fullscreen} label="Full screen" onClick={act.fullscreen} />
          <Btn big icon={AppWindow} label="New window" onClick={act.newWindow} />
        </Group>
      </>
    ),
    Copilot: (
      <>
        <Group label="Write">
          <Btn big icon={Wand2} label="Expand notes" onClick={() => act.ai('expand')} disabled={ro} title="Rough notes → full structured report (offline engine or Gemini)" />
          <Btn big icon={Stethoscope} label="Impression" onClick={() => act.ai('impression')} disabled={ro} />
          <Btn big icon={BrainCircuit} label="Differential" onClick={() => act.ai('differential')} disabled={ro} />
          <Btn big icon={Sparkles} label="Rewrite selection" onClick={() => act.ai('rewrite')} disabled={ro} />
        </Group>
        <Group label="Measurements">
          <Btn big icon={Stethoscope} label="Draft impression" onClick={act.autoImpression} disabled={ro} title="Impression from the findings and biometry (offline, rule-based) — say “generate impression”" />
          <Btn big icon={Calculator} label="Recalculate" onClick={act.recalc} disabled={ro} title="GA per parameter, GA / EDD by USG, EFW (Hadlock) and EDD by LMP — say “recalculate”" />
        </Group>
        <Group label="Patient & proof">
          <Btn big icon={Languages} label="Patient summary" onClick={() => act.ai('summary')} />
          <Btn big icon={SpellCheck} label="Proofread" onClick={() => act.ai('proofread')} disabled={ro} />
          <Btn big icon={MessageSquare} label="Ask Copilot" onClick={() => act.ai('ask')} />
        </Group>
        <Group label="Gemini ecosystem">
          <Btn big icon={Gem} label="Gems" onClick={() => act.ai('gems')} />
          <Btn big icon={ScanEye} label="Image insight" onClick={() => act.ai('image')} />
          <Btn big icon={Mic} label="Voice HUD" onClick={act.voice} />
          <Btn big icon={NotebookText} label="NotebookLM" onClick={() => act.external('notebooklm')} />
          <Btn big icon={HardDrive} label="Drive context" onClick={() => act.ai('drive')} />
          <Btn big icon={Bot} label="Gemini app" onClick={() => act.external('gemini')} />
        </Group>
      </>
    )
  };

  return (
    <div className="border-b border-line bg-surface" onMouseDown={keepSel}>
      <div className="flex items-center gap-0.5 overflow-x-auto px-2 pt-1">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={cx('whitespace-nowrap rounded-t-lg px-3 py-1.5 text-[12.5px] font-semibold transition', tab === t ? 'bg-surface2 text-brand-700 shadow-[inset_0_-2px_0] shadow-brand-600 dark:text-brand-300' : 'text-muted hover:text-ink', t === 'File' && tab !== t && 'text-brand-700 dark:text-brand-300', t === 'Copilot' && 'inline-flex items-center gap-1')}>
            {t === 'Copilot' && <Sparkles className="h-3.5 w-3.5 text-violet-500" />}{t}
          </button>
        ))}
        <span className="ml-auto flex shrink-0 items-center gap-2 pb-1 pl-3 text-[11.5px]">
          <label data-keep className="inline-flex items-center gap-1.5 font-semibold"><input type="checkbox" className="accent-brand-600" checked={st.autosave} onChange={act.toggleAutosave} />Auto-Save</label>
          <span className={cx('rounded-full px-2 py-0.5 font-semibold', st.saveState === 'saved' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : st.saveState === 'saving' ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300')}>
            {st.saveState === 'saved' ? '✓ Saved' : st.saveState === 'saving' ? 'Saving…' : st.saveState === 'locked' ? <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" />Signed & locked</span> : 'Unsaved'}
          </span>
        </span>
      </div>
      <div className="flex overflow-x-auto bg-surface2/60 py-1 dark:bg-surface2/40">{groups[tab]}</div>
    </div>
  );
}
