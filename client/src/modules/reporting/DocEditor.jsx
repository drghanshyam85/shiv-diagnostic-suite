// Report canvas: an A4 sheet with the clinic letterhead, a live demographics table (two-way bound to
// the workstation bar) and the contenteditable report body — inline shortcut expansion on Space /
// Enter / Tab, sonography autocorrect, live spelling + placeholder highlights, F2 placeholder jump,
// Tab between table cells, clean paste from Word / Docs, right-click spelling suggestions, and the inline
// macro / template search (type // or press Ctrl+Space; the workstation draws the popup).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { escapeHtml } from '../../core/utils';
import { sanitizeHtml } from '../../core/importers';
import { loadSpell, checkText, autocorrectTail, isKnown } from '../../core/spell';
import { AUTOCORRECT, AMBIGUOUS } from '../../data/lexicon';
import { letterheadHtml, signatureHtml, cssFont, imageHeaderHtml, imageFooterHtml } from './reportPrint';
import {
  exec, rangeIn, restoreRange, insertHtml, insertText, replaceAll, tokenBeforeCaret, textBeforeCaret, selectTextRange, jumpPlaceholder,
  moveCell, setHighlight, spellRanges, placeholderRanges, wordAtPoint, cleanPastedHtml, plainToHtml
} from './editorUtils';

const BLOCK_RE = /^(P|DIV|LI|TD|TH|H[1-6]|BLOCKQUOTE|PRE)$/;
function blockOf(node, root) {
  let n = node && node.nodeType === 3 ? node.parentNode : node;
  while (n && n !== root && !BLOCK_RE.test(n.nodeName)) n = n.parentNode;
  return n || root;
}
/** Screen position of a collapsed range (falls back to its element for an empty line). */
function caretRect(range) {
  const rects = range.getClientRects();
  let b = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
  if (!b || (!b.top && !b.left && !b.height)) {
    const n = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    b = n ? n.getBoundingClientRect() : { top: 100, left: 100, bottom: 120, height: 20 };
  }
  return { top: b.top, left: b.left, bottom: b.bottom || b.top + (b.height || 18), height: b.height || 18 };
}

function DemogTable({ d, onChange, readOnly }) {
  const inp = (k, cls, label) => (
    <input value={d[k] || ''} readOnly={readOnly} className={cls} aria-label={label} data-label={label} onChange={(e) => onChange({ [k]: e.target.value })} />
  );
  return (
    <table className="rw-demog">
      <colgroup><col style={{ width: '19%' }} /><col style={{ width: '36%' }} /><col style={{ width: '15%' }} /><col style={{ width: '30%' }} /></colgroup>
      <tbody>
        <tr><td className="k">Patient Name</td><td>{inp('name', 'b', 'Sheet: patient name')}</td><td className="k">Age / Sex</td><td><div className="flex">{inp('age', '', 'Sheet: age')}<span className="self-center px-0.5 text-slate-400">/</span>{inp('sex', '', 'Sheet: sex')}</div></td></tr>
        <tr><td className="k">Patient ID / UHID</td><td>{inp('patientId', '', 'Sheet: patient ID')}</td><td className="k">Date</td><td><input type="date" value={d.date || ''} readOnly={readOnly} aria-label="Sheet: scan date" onChange={(e) => onChange({ date: e.target.value })} /></td></tr>
        <tr><td className="k">Referred By</td><td>{inp('refBy', '', 'Sheet: referred by')}</td><td className="k">Examination</td><td>{inp('modality', '', 'Sheet: examination')}</td></tr>
        <tr><td className="k">Clinical Indication</td><td colSpan={3}>{inp('indication', '', 'Sheet: clinical indication')}</td></tr>
      </tbody>
    </table>
  );
}

export const DocEditor = forwardRef(function DocEditor(props, ref) {
  const {
    docKey, initialHtml, readOnly, zoom = 1, layout, settings, report, signer, guides = true,
    onDemographics, onChange, onFocusChange, onSelect, onContextWord, expandTrigger, onImagePaste, onInline, spellOn = true, autocorrectOn = true
  } = props;
  const body = useRef(null);
  const lastRange = useRef(null);
  const changeTimer = useRef(null);
  const spellTimer = useRef(null);
  const plainPaste = useRef(false);
  const cb = useRef({});
  cb.current = { onChange, onSelect, expandTrigger, onImagePaste, onContextWord, onInline, spellOn, autocorrectOn, readOnly };

  // ---------------------------------------------------------------- inline macro search ("//query" or Ctrl+Space)
  // inl.current = { anchor: live Range at the start of the "//", prefix: 2 (typed //) or 0 (hotkey) }
  const inl = useRef(null);
  const inlineRange = () => {
    const s = inl.current;
    const el = body.current;
    if (!s || !el) return null;
    const r = rangeIn(el);
    if (!r || !r.collapsed || !el.contains(s.anchor.startContainer)) return null;
    const q = document.createRange();
    try { q.setStart(s.anchor.startContainer, s.anchor.startOffset); q.setEnd(r.startContainer, r.startOffset); } catch (e) { return null; }
    if (q.collapsed && (r.startContainer !== s.anchor.startContainer || r.startOffset !== s.anchor.startOffset)) return null; // caret went before the //
    if (blockOf(s.anchor.startContainer, el) !== blockOf(r.startContainer, el)) return null; // moved to another line
    const text = q.toString();
    if (s.prefix && !text.startsWith('//')) return null;
    const query = text.slice(s.prefix);
    if (query.length > 60 || /\s\s$/.test(query) || /^\s/.test(query)) return null;
    return { q, query };
  };
  const closeInline = () => { if (!inl.current) return; inl.current = null; if (cb.current.onInline) cb.current.onInline({ type: 'close' }); };
  const syncInline = () => {
    if (!inl.current) return;
    const got = inlineRange();
    if (!got) { closeInline(); return; }
    const a = document.createRange();
    a.setStart(inl.current.anchor.startContainer, inl.current.anchor.startOffset);
    a.collapse(true);
    cb.current.onInline({ type: 'update', query: got.query, rect: caretRect(a), how: inl.current.prefix ? 'slash' : 'key' });
  };
  const openInline = (node, offset, prefix) => {
    if (!cb.current.onInline || cb.current.readOnly) return;
    const anchor = document.createRange();
    anchor.setStart(node, offset);
    anchor.collapse(true);
    inl.current = { anchor, prefix };
    syncInline();
  };

  const runSpell = useCallback(() => {
    const el = body.current;
    if (!el) return;
    setHighlight('ssdc-ph', placeholderRanges(el));
    if (!cb.current.spellOn) { setHighlight('ssdc-spell', []); setHighlight('ssdc-ambig', []); return; }
    loadSpell().then(() => {
      if (!body.current) return;
      const { spell, ambig } = spellRanges(body.current, checkText);
      setHighlight('ssdc-spell', spell);
      setHighlight('ssdc-ambig', ambig);
    });
  }, []);
  const scheduleSpell = useCallback((ms = 650) => { clearTimeout(spellTimer.current); spellTimer.current = setTimeout(runSpell, ms); }, [runSpell]);
  const emitChange = useCallback((ms = 250) => {
    clearTimeout(changeTimer.current);
    changeTimer.current = setTimeout(() => { if (body.current && cb.current.onChange) cb.current.onChange(body.current.innerHTML); }, ms);
  }, []);

  // load a different document
  useEffect(() => {
    if (!body.current) return;
    body.current.innerHTML = initialHtml || '';
    lastRange.current = null;
    closeInline();
    exec('defaultParagraphSeparator', 'p');
    scheduleSpell(50);
  }, [docKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scheduleSpell(30); }, [spellOn, scheduleSpell]);
  useEffect(() => () => { clearTimeout(changeTimer.current); clearTimeout(spellTimer.current); ['ssdc-spell', 'ssdc-ambig', 'ssdc-ph'].forEach((h) => setHighlight(h, [])); }, []);

  // remember the caret (side panels, voice HUD and ribbon insert exactly where the doctor was typing)
  useEffect(() => {
    let raf = 0;
    const h = () => {
      const r = rangeIn(body.current);
      if (!r) { if (inl.current && document.activeElement !== body.current) closeInline(); return; }
      lastRange.current = r.cloneRange();
      if (inl.current) syncInline();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!cb.current.onSelect) return;
        const sel = window.getSelection();
        const rr = rangeIn(body.current);
        if (!rr) return;
        const rect = rr.getBoundingClientRect();
        cb.current.onSelect({ collapsed: rr.collapsed, text: rr.collapsed ? '' : sel.toString(), rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom } });
      });
    };
    document.addEventListener('selectionchange', h);
    return () => { document.removeEventListener('selectionchange', h); cancelAnimationFrame(raf); };
  }, []);

  useImperativeHandle(ref, () => ({
    el: () => body.current,
    focus: () => restoreRange(body.current, lastRange.current),
    html: () => (body.current ? body.current.innerHTML : ''),
    text: () => (body.current ? body.current.innerText : ''),
    setHtml: (h) => { if (!body.current) return; body.current.innerHTML = h || ''; emitChange(0); scheduleSpell(50); },
    insert: (html, mode = 'cursor') => {
      if (!body.current) return;
      if (mode === 'replace') replaceAll(body.current, html);
      else insertHtml(body.current, html, lastRange.current);
      emitChange(50);
      scheduleSpell(200);
    },
    insertText: (t) => { if (body.current) { insertText(body.current, t, lastRange.current); emitChange(50); } },
    range: () => lastRange.current,
    setRange: (r) => { lastRange.current = r; },
    selectionText: () => { const r = lastRange.current; return r && !r.collapsed ? r.toString() : ''; },
    selectionHtml: () => { const r = lastRange.current; if (!r || r.collapsed) return ''; const d = document.createElement('div'); d.appendChild(r.cloneContents()); return d.innerHTML; },
    restore: () => restoreRange(body.current, lastRange.current),
    respell: () => scheduleSpell(10),
    flush: () => { clearTimeout(changeTimer.current); if (body.current && cb.current.onChange) cb.current.onChange(body.current.innerHTML); },
    /** Remove the typed "//query" and leave the caret there, ready for the macro. */
    takeInline: () => {
      const got = inlineRange();
      inl.current = null;
      if (cb.current.onInline) cb.current.onInline({ type: 'close' });
      if (!got || !body.current) return false;
      if (!got.q.collapsed) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(got.q);
        exec('delete');
      }
      const r = rangeIn(body.current);
      if (r) lastRange.current = r.cloneRange();
      return true;
    },
    closeInline: () => closeInline(),
    plainPasteNext: () => { plainPaste.current = true; }
  }), [emitChange, scheduleSpell]);

  const onKeyDown = (e) => {
    const c = cb.current;
    if (c.readOnly) return;
    const el = body.current;
    if (inl.current && c.onInline) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault();
        c.onInline({ type: 'nav', dir: (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'PageDown' ? 5 : -5) });
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (!c.onInline({ type: 'accept', mode: e.key === 'Enter' && e.shiftKey ? 'replace' : 'cursor' })) closeInline();
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeInline(); return; }
      if (e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); c.onInline({ type: 'kind' }); return; }
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'Space' || e.key === '/')) {
      e.preventDefault();
      if (inl.current) { closeInline(); return; }
      const r = rangeIn(el);
      if (!r) return;
      if (!r.collapsed) r.collapse(false);
      const tb = textBeforeCaret(el);
      const m = tb && /[A-Za-z0-9_\-]+$/.exec(tb.text);
      if (tb) openInline(tb.node, tb.offset - (m ? m[0].length : 0), 0);
      else openInline(r.startContainer, r.startOffset, 0);
      return;
    }
    if (e.key === 'F2') { e.preventDefault(); jumpPlaceholder(el, e.shiftKey); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'v' || e.key === 'V')) { plainPaste.current = true; return; }
    const plainKey = !e.ctrlKey && !e.altKey && !e.metaKey;
    if (inl.current) return;
    if (e.key === 'Tab' && plainKey) {
      if (!e.shiftKey) {
        const tok = tokenBeforeCaret(el);
        if (tok && c.expandTrigger && c.expandTrigger(tok, 'tab')) { e.preventDefault(); return; }
      }
      e.preventDefault();
      if (!moveCell(el, e.shiftKey) && !e.shiftKey) exec('insertText', '    ');
      return;
    }
    if ((e.key === ' ' || e.key === 'Enter') && plainKey && !e.shiftKey) {
      const tok = tokenBeforeCaret(el);
      if (tok && c.expandTrigger && c.expandTrigger(tok, e.key === 'Enter' ? 'enter' : 'space')) { e.preventDefault(); return; }
    }
    if (c.autocorrectOn && plainKey && (e.key === ' ' || e.key === 'Enter' || /^[.,;:!?)]$/.test(e.key))) {
      const tb = textBeforeCaret(el);
      const fix = tb && autocorrectTail(tb.text);
      if (fix) { selectTextRange(tb.node, tb.offset - fix.from.length, tb.offset); exec('insertText', fix.to); }
    }
  };

  const onInput = (e) => {
    emitChange();
    scheduleSpell();
    if (inl.current) { syncInline(); return; }
    const ne = e && e.nativeEvent;
    if (ne && ne.inputType === 'insertText' && ne.data === '/' && cb.current.onInline && !cb.current.readOnly) {
      const tb = textBeforeCaret(body.current);
      if (tb && tb.text.endsWith('//') && (tb.text.length === 2 || /[\s\u00a0(\[>]/.test(tb.text[tb.text.length - 3]))) openInline(tb.node, tb.offset - 2, 2);
    }
  };

  const onPaste = (e) => {
    const c = cb.current;
    if (c.readOnly) return;
    const cd = e.clipboardData;
    if (!cd) return;
    const files = Array.from(cd.files || []).filter((f) => /^image\//.test(f.type));
    if (files.length && c.onImagePaste) { e.preventDefault(); c.onImagePaste(files); return; }
    const html = cd.getData('text/html');
    const text = cd.getData('text/plain');
    e.preventDefault();
    if (plainPaste.current || !html) {
      plainPaste.current = false;
      if (!/\n/.test(text)) exec('insertText', text); else exec('insertHTML', plainToHtml(text));
    } else exec('insertHTML', cleanPastedHtml(html, sanitizeHtml));
    emitChange(50);
    scheduleSpell(200);
  };

  const onContextMenu = (e) => {
    const c = cb.current;
    if (c.readOnly || !c.onContextWord) return;
    const hit = wordAtPoint(body.current, e.clientX, e.clientY);
    if (!hit) return;
    const lw = hit.word.toLowerCase();
    if (isKnown(hit.word) && !AUTOCORRECT[lw] && !AMBIGUOUS[lw]) return;
    e.preventDefault();
    c.onContextWord({ word: hit.word, range: hit.range, x: e.clientX, y: e.clientY, ambiguous: !!AMBIGUOUS[lw] });
  };

  const L = layout;
  const land = L.orientation === 'landscape';
  const W = land ? 297 : 210;
  const H = land ? 210 : 297;
  const m = L.margins;
  const showHead = L.showHeader !== false && L.headerMode !== 'none';
  return (
    <div className="rw-scroll h-full overflow-auto bg-slate-200/70 px-4 py-6 dark:bg-slate-950/70" onMouseDown={(e) => { if (e.target === e.currentTarget && body.current && !readOnly) { e.preventDefault(); restoreRange(body.current, lastRange.current); } }}>
      <div style={{ zoom, width: 'max-content', margin: '0 auto' }}>
        <div className="rw-sheet" style={{ width: W + 'mm', minHeight: H + 'mm', padding: `${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm`, fontFamily: cssFont(L.fontFamily), fontSize: L.fontSize + 'pt', lineHeight: L.lineHeight, '--page-h': H + 'mm' }}>
          {guides && <div className="rw-guides" />}
          {showHead && L.headerMode === 'letterhead' && <div style={{ height: L.letterheadTop + 'mm' }} className="mb-1 flex items-center justify-center rounded border border-dashed border-sky-300 text-[10px] uppercase tracking-wider text-sky-500">Pre-printed letterhead area · {L.letterheadTop} mm</div>}
          {showHead && L.headerMode === 'full' && <div dangerouslySetInnerHTML={{ __html: letterheadHtml(settings, L) }} />}
          {showHead && L.headerMode === 'image' && <div dangerouslySetInnerHTML={{ __html: L.headerImage ? imageHeaderHtml(L) : letterheadHtml(settings, Object.assign({}, L, { headerHtml: '' })) }} />}
          {L.showDemographics !== false && <DemogTable d={report.demographics} onChange={onDemographics} readOnly={readOnly} />}
          <div ref={body} className="doc-body" contentEditable={!readOnly} suppressContentEditableWarning spellCheck={false} data-gramm="false"
            aria-label="Report editor" data-label="Report editor" data-placeholder="Type findings, a shortcut such as .abd then Space, // to search macros & templates, or press Ctrl+K…"
            onKeyDown={onKeyDown} onInput={onInput} onPaste={onPaste} onContextMenu={onContextMenu}
            onFocus={() => onFocusChange && onFocusChange(true)} onBlur={(e) => { setTimeout(() => { if (document.activeElement !== body.current) closeInline(); }, 0); if (onFocusChange) onFocusChange(false, e); }} />
          <div className="pointer-events-none select-none opacity-90" dangerouslySetInnerHTML={{ __html: (report.obstetric && !/neither detected nor disclosed/i.test(report.html || '') ? `<p class="rp-pcpndt">${escapeHtml(settings.report.pcpndtDeclaration || '')}</p>` : '') + signatureHtml(report, settings, signer) }} />
          {L.showFooter !== false && L.headerMode === 'full' && <div className="rp-foot mt-6"><span>{L.footerText}</span><span>Page 1 of …</span></div>}
          {L.showFooter !== false && L.headerMode === 'image' && <div className="mt-6"><div className="rp-foot"><span>{L.footerImage ? '' : L.footerText}</span><span>Page 1 of …</span></div><div dangerouslySetInnerHTML={{ __html: imageFooterHtml(L) }} /></div>}
          {L.headerMode === 'letterhead' && <div style={{ height: L.letterheadBottom + 'mm' }} className="mt-4 flex items-center justify-center rounded border border-dashed border-sky-300 text-[10px] uppercase tracking-wider text-sky-500">Pre-printed footer area · {L.letterheadBottom} mm</div>}
        </div>
      </div>
    </div>
  );
});
