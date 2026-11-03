// Workstation side panel: Macros (worker search, paste at cursor / replace report, edit), Templates
// (suggested for this visit + library search), Copilot (Gemini), Images (JPEG / PNG / native DICOM,
// automatic organ / time sorting, cloud folder copy and the server's cloud-folder inbox; 2 / 4 / 6 per
// printed page) and a quick Dictionary lookup that inserts terms or normal values at the cursor.
import { useEffect, useMemo, useState } from 'react';
import { Layers, FileText, Sparkles, Image as ImageIcon, BookMarked, Search, CornerDownLeft, Replace, Pencil, Plus, Upload, ArrowUp, ArrowDown, Trash2, Star, X, FolderInput, Square, Cloud, CloudOff, CheckCircle2, AlertTriangle, Inbox, FileImage, RefreshCw } from 'lucide-react';
import { useColl, navigate } from '../../core/hooks';
import { api, isServer } from '../../core/sync';
import { kvGet } from '../../core/idb';
import { events } from '../../core/store';
import { fmtDate, fmtTime } from '../../core/utils';
import { ORGANS, SORT_MODES, organLabel } from '../../core/usgImages';
import { cloudTargets } from '../cloud/cloudMirror';
import { macros } from '../../core/macros';
import { useDictionary, searchDictionary } from '../../core/dictionary';
import { escapeHtml, lsGet, lsSet, pickFiles } from '../../core/utils';
import { cx, Button, Badge, Segmented, Empty, Spinner, toast } from '../../components/ui';
import { useMacroSearch, MacroRow, useMacrosVersion } from '../macros/macroUi';
import { CopilotPanel } from './CopilotPanel';
import { imageUrl } from './reportDoc';
import { folderWatchSupported, watchState, onWatch, chooseFolder, resumeFolder, savedFolderName, stopWatching, takePending } from './folderWatch';

export const SIDE_TABS = [
  { id: 'macros', label: 'Macros', icon: Layers }, { id: 'templates', label: 'Templates', icon: FileText }, { id: 'copilot', label: 'Copilot', icon: Sparkles },
  { id: 'images', label: 'Images', icon: ImageIcon }, { id: 'dictionary', label: 'Dictionary', icon: BookMarked }
];

export function recordMacroUse(id) {
  const rec = lsGet('ssdc-pref:macro-recent', []).filter((x) => x !== id);
  rec.unshift(id);
  lsSet('ssdc-pref:macro-recent', rec.slice(0, 12));
}

function MacrosTab({ query, setQuery, onPick, onEdit, onNew, readOnly }) {
  const [kind, setKind] = useState('');
  const res = useMacroSearch(query, kind ? { kind } : {}, 120);
  const [sel, setSel] = useState(0);
  useMacrosVersion();
  const recent = lsGet('ssdc-pref:macro-recent', []).map((id) => macros.getMeta(id)).filter(Boolean).slice(0, 6);
  const go = async (id, mode) => { if (readOnly) return toast('Report is signed & locked', 'warning'); const d = await macros.get(id); if (d) { onPick(d, mode); recordMacroUse(id); } };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-1.5 border-b border-line p-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input id="rw-macro-search" value={query} onChange={(e) => { setQuery(e.target.value); setSel(0); }} className="input pl-8" placeholder="Search macros… (Alt+M)" aria-label="Search macros"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(res.ids.length - 1, s + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if ((e.key === 'Enter' || e.key === 'Tab') && res.ids[sel]) { e.preventDefault(); go(res.ids[sel], e.shiftKey ? 'replace' : 'cursor'); }
            }} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Segmented size="sm" value={kind} onChange={setKind} options={[{ value: '', label: 'All' }, { value: 'macro', label: 'Macros' }, { value: 'template', label: 'Templates' }]} />
          <span className="text-[10.5px] text-muted tnum">{res.total.toLocaleString('en-IN')} · {res.ms.toFixed(1)} ms</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {!query && recent.length > 0 && (
          <div className="mb-1.5 border-b border-line pb-1.5">
            <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted">Recently used</div>
            <div className="flex flex-wrap gap-1 px-1.5">{recent.map((m) => <button key={m.id} type="button" className="chip px-2 py-0.5 text-[11px]" onClick={() => go(m.id, 'cursor')} title={m.title}><Star className="h-3 w-3 text-amber-500" />{m.trigger || m.title.slice(0, 18)}</button>)}</div>
          </div>
        )}
        {res.busy && !res.ids.length && <div className="p-4 text-center"><Spinner /></div>}
        {res.ids.map((id, i) => (
          <MacroRow key={id} meta={macros.getMeta(id)} active={i === sel} onClick={() => setSel(i)} onDoubleClick={() => go(id, 'cursor')}
            right={i === sel ? (
              <span className="flex shrink-0 flex-col gap-0.5">
                <button type="button" className="rounded bg-brand-600 px-1.5 py-0.5 text-[10.5px] font-semibold text-white" onClick={(e) => { e.stopPropagation(); go(id, 'cursor'); }} title="Paste / insert at cursor"><CornerDownLeft className="inline h-3 w-3" /> Insert</button>
                <button type="button" className="rounded border border-line px-1.5 py-0.5 text-[10.5px]" onClick={(e) => { e.stopPropagation(); go(id, 'replace'); }} title="Replace the whole report"><Replace className="inline h-3 w-3" /> Replace</button>
                <button type="button" className="rounded border border-line px-1.5 py-0.5 text-[10.5px]" onClick={(e) => { e.stopPropagation(); onEdit(id); }}><Pencil className="inline h-3 w-3" /> Edit</button>
              </span>
            ) : null} />
        ))}
        {!res.busy && !res.ids.length && <Empty icon={Layers} title="No matches" text="Try a trigger (.abd), an organ or a finding." action={<Button size="sm" icon={Plus} onClick={() => onNew(query)}>New macro</Button>} />}
      </div>
      <div className="border-t border-line p-2"><Button size="sm" className="w-full" icon={Plus} onClick={() => onNew('')}>New macro / template</Button></div>
    </div>
  );
}

function TemplatesTab({ suggestedKeys, onPick, readOnly }) {
  const [q, setQ] = useState('');
  const res = useMacroSearch(q, { kind: 'template' }, 150);
  useMacrosVersion();
  const suggested = useMemo(() => {
    const out = [];
    for (const m of macros.list({ kind: 'template' })) if (m.key && suggestedKeys.includes(m.key)) out.push(m);
    return out.sort((a, b) => suggestedKeys.indexOf(a.key) - suggestedKeys.indexOf(b.key));
  }, [suggestedKeys, macros.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async (id, mode) => { if (readOnly) return toast('Report is signed & locked', 'warning'); const d = await macros.get(id); if (d) { onPick(d, mode); recordMacroUse(id); } };
  const Card = ({ m }) => (
    <div className="rounded-xl border border-line p-2">
      <div className="flex items-center gap-1.5"><FileText className="h-4 w-4 text-violet-600" /><span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{m.title}</span>{m.trigger && <code className="rounded bg-slate-100 px-1 text-[10.5px] dark:bg-slate-800">{m.trigger}</code>}</div>
      <div className="mt-1.5 flex gap-1.5"><Button size="sm" variant="primary" icon={CornerDownLeft} onClick={() => go(m.id, 'cursor')}>At cursor</Button><Button size="sm" icon={Replace} onClick={() => go(m.id, 'replace')}>Replace page</Button></div>
    </div>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line p-2.5">
        <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} className="input pl-8" placeholder="Search template library…" aria-label="Search templates" /></div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
        {!q && suggested.length > 0 && <><div className="text-[10px] font-bold uppercase tracking-wider text-muted">Suggested for this visit</div>{suggested.map((m) => <Card key={m.id} m={m} />)}<div className="pt-1 text-[10px] font-bold uppercase tracking-wider text-muted">All templates</div></>}
        {res.ids.map((id) => { const m = macros.getMeta(id); return m ? <Card key={id} m={m} /> : null; })}
        {!res.busy && !res.ids.length && <Empty icon={FileText} title="No templates found" />}
      </div>
    </div>
  );
}

function ImgCard({ im, i, n, onCaption, onOrgan, onMove, onRemove, onInline, readOnly, inCloud }) {
  const [url, setUrl] = useState('');
  useEffect(() => { let a = true; imageUrl(im).then((u) => { if (a) setUrl(u); }); return () => { a = false; }; }, [im]);
  const d = im.dicom;
  const when = im.acquiredAt || im.at;
  return (
    <div className={cx('rounded-xl border p-1.5', im.warn ? 'border-rose-300 dark:border-rose-800' : 'border-line')}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-black">
        {url ? <img src={url} alt={im.caption} className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-[11px] text-slate-400">loading…</div>}
        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white tabular-nums">{i + 1}</span>
        {d && <span className="absolute right-1 top-1 rounded bg-sky-600/90 px-1 text-[9.5px] font-bold text-white" title={['DICOM', d.series, [d.manufacturer, d.model].filter(Boolean).join(' '), d.patientName && 'Patient: ' + d.patientName + (d.patientId ? ' (' + d.patientId + ')' : ''), d.syntax, im.frames > 1 ? 'frame ' + im.frame + ' of ' + im.frames : ''].filter(Boolean).join('\n')}>DICOM{im.frames > 1 ? ' ' + im.frame + '/' + im.frames : ''}</span>}
        {inCloud && <span className="absolute bottom-1 right-1 rounded bg-emerald-600/90 p-0.5 text-white" title="Copied to the patient’s cloud folder"><Cloud className="h-3 w-3" /></span>}
      </div>
      {im.warn && <div className="mt-1 flex items-start gap-1 rounded bg-rose-50 px-1.5 py-1 text-[10.5px] leading-tight text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"><AlertTriangle className="mt-px h-3 w-3 shrink-0" />{im.warn}</div>}
      <input className="input input-sm mt-1" value={im.caption || ''} readOnly={readOnly} onChange={(e) => onCaption(e.target.value)} placeholder="Caption (e.g. Right kidney – long axis)" aria-label={'Caption image ' + (i + 1)} />
      <div className="mt-1 flex items-center gap-1">
        <select className="input input-sm h-6 min-w-0 flex-1 py-0 text-[11px]" value={im.organ || ''} disabled={readOnly} onChange={(e) => onOrgan(e.target.value)} aria-label={'Organ of image ' + (i + 1)} title="Organ (used by Auto order)">
          <option value="">Organ…</option>
          {ORGANS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        {when ? <span className="shrink-0 text-[10px] text-muted tabular-nums" title={fmtDate(when) + ' ' + fmtTime(when)}>{fmtTime(when)}</span> : null}
      </div>
      {!readOnly && (
        <div className="mt-1 flex items-center gap-0.5">
          <button type="button" className="rounded p-1 hover:bg-surface2 disabled:opacity-30" disabled={i === 0} onClick={() => onMove(-1)} title="Move up (switches to Manual order)"><ArrowUp className="h-3.5 w-3.5" /></button>
          <button type="button" className="rounded p-1 hover:bg-surface2 disabled:opacity-30" disabled={i === n - 1} onClick={() => onMove(1)} title="Move down (switches to Manual order)"><ArrowDown className="h-3.5 w-3.5" /></button>
          <button type="button" className="ml-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-surface2" onClick={() => onInline(url)} title="Also insert this image inline in the report">Inline</button>
          <button type="button" className="ml-auto rounded p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40" onClick={onRemove} title="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      )}
    </div>
  );
}

/** Images the clinic server picked up from its cloud-synced / shared inbox folder for this patient. */
function CloudInbox({ report, readOnly, onAttach }) {
  const files = useColl('files');
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState('');
  const [st, setSt] = useState(null);
  useEffect(() => { let a = true; api('images/inbox').then((x) => { if (a) setSt(x); }).catch(() => {}); return () => { a = false; }; }, []);
  const fresh = useMemo(() => files.filter((f) => f.kind === 'image-inbox' && f.status === 'new' && !f._deleted).sort((a, b) => (a.acquiredAt || 0) - (b.acquiredAt || 0)), [files]);
  const mine = fresh.filter((f) => (report.patientId && f.patientId === report.patientId) || (report.visitId && f.visitId === report.visitId));
  const unmatched = fresh.filter((f) => !f.patientId);
  if (!st || (!st.enabled && !fresh.length)) return null;
  const list = all ? mine.concat(unmatched) : mine;
  const attach = async (f) => { setBusy(f.id); try { await onAttach(f); } finally { setBusy(''); } };
  const dismiss = async (f) => { try { await api('images/inbox/' + encodeURIComponent(f.id) + '/dismiss', { method: 'POST' }); } catch (e) { toast(e.message, 'error'); } };
  return (
    <div className="space-y-1.5 rounded-lg border border-line p-2">
      <div className="flex items-center gap-1.5 text-[12px]">
        <Inbox className="h-4 w-4 text-brand-600" /><b>Cloud inbox</b>
        <Badge tone={mine.length ? 'brand' : 'slate'}>{mine.length} for this patient</Badge>
        {unmatched.length > 0 && <button type="button" className="link ml-auto text-[11px]" onClick={() => setAll(!all)}>{all ? 'Hide' : 'Show'} {unmatched.length} unmatched</button>}
      </div>
      {st && st.error && <p className="text-[11px] text-rose-600">{st.error}</p>}
      {list.length > 0 && !readOnly && mine.length > 1 && <Button size="xs" variant="primary" icon={Upload} onClick={async () => { for (const f of mine) await attach(f); }}>Attach all {mine.length}</Button>}
      <div className="grid grid-cols-3 gap-1.5">
        {list.slice(0, 24).map((f) => (
          <div key={f.id} className="rounded-lg border border-line p-1">
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded bg-black">
              {f.mime && f.mime.startsWith('image/') ? <img src={'api/files/' + encodeURIComponent(f.id) + '/raw'} alt={f.name} className="h-full w-full object-contain" loading="lazy" /> : <span className="flex flex-col items-center gap-0.5 px-1 text-center text-[9.5px] text-sky-200"><FileImage className="h-5 w-5" />DICOM{f.dicom && f.dicom.frames > 1 ? ' · ' + f.dicom.frames + ' fr' : ''}<span className="line-clamp-2 text-slate-300">{(f.dicom && f.dicom.series) || ''}</span></span>}
            </div>
            <div className="mt-0.5 truncate text-[10px]" title={f.name + (f.match ? ' · matched by ' + f.match.by : ' · no patient match') + (f.patientName ? ' · ' + f.patientName : '')}>{f.patientId ? '' : '? '}{f.name}</div>
            <div className="text-[9.5px] text-muted">{fmtTime(f.acquiredAt || f.createdAt)}</div>
            {!readOnly && (
              <div className="mt-0.5 flex gap-0.5">
                <button type="button" className="flex-1 rounded bg-brand-600 px-1 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50" disabled={!!busy} onClick={() => attach(f)}>{busy === f.id ? '…' : 'Attach'}</button>
                <button type="button" className="rounded px-1 text-[10px] text-muted hover:bg-surface2" title="Dismiss (not this patient / not needed)" onClick={() => dismiss(f)}><X className="h-3 w-3" /></button>
              </div>
            )}
          </div>
        ))}
      </div>
      {!list.length && <p className="text-[11px] text-muted">{st.enabled ? 'Watching “' + (st.folder || '').split(/[\\/]/).filter(Boolean).pop() + '” on the server — new scans for this patient appear here.' : 'Inbox folder is switched off (Cloud Sync & Backup).'}</p>}
    </div>
  );
}

function CloudStatus({ report, onSync }) {
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);
  const targets = cloudTargets();
  useEffect(() => {
    let a = true;
    const load = () => kvGet('cloud-mirror:reports:' + report.id, null).then((x) => { if (a) setSent(x); }).catch(() => {});
    load();
    const off = events.on('cloud:mirrored', (e) => { if (e && e.id === report.id) load(); });
    return () => { a = false; off(); };
  }, [report.id]);
  const imgs = report.images || [];
  if (!isServer()) return null;
  if (!targets.length) return <p className="flex items-center gap-1 text-[11px] text-muted"><CloudOff className="h-3.5 w-3.5" />No cloud connected · <button type="button" className="link" onClick={() => navigate('/cloud')}>set up cloud sync</button></p>;
  const done = imgs.filter((im) => sent && (sent.images || []).includes(im.id)).length;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
      {done === imgs.length && imgs.length ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Cloud className="h-3.5 w-3.5 text-brand-600" />}
      <span>{imgs.length ? done + ' of ' + imgs.length + ' in the cloud folder' : 'Cloud folder ready'}</span>
      <span className="text-muted">({targets.map((t) => ({ gdrive: 'Drive', onedrive: 'OneDrive', gcp: 'Cloud Storage' }[t] || t)).join(', ')})</span>
      <Button size="xs" className="ml-auto" icon={RefreshCw} loading={busy} disabled={!imgs.length} onClick={async () => { setBusy(true); try { await onSync(); } finally { setBusy(false); } }}>Sync now</Button>
    </div>
  );
}

function FolderWatch({ readOnly, onAddFiles }) {
  const [st, setSt] = useState(watchState);
  const [saved, setSaved] = useState('');
  useEffect(() => onWatch(setSt), []);
  useEffect(() => { savedFolderName().then(setSaved); }, [st.active]);
  if (!folderWatchSupported()) return <p className="text-[11px] text-muted">Auto-import from the USG console’s export folder works in Chrome or Edge.</p>;
  const run = (fn) => fn().catch((e) => { if (e && e.name !== 'AbortError') toast(e.message || 'Folder access failed', 'error'); });
  return (
    <div className="space-y-1.5 rounded-lg border border-dashed border-line p-2">
      {st.active ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <Badge tone="emerald" dot>Watching</Badge><span className="min-w-0 flex-1 truncate font-semibold" title={st.name}>{st.name}</span>
          <Button size="xs" icon={Square} onClick={stopWatching}>Stop</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {saved && <Button size="xs" variant="primary" icon={FolderInput} onClick={() => run(() => resumeFolder(true))}>Resume “{saved}”</Button>}
          <Button size="xs" icon={FolderInput} onClick={() => run(chooseFolder)}>{saved ? 'Choose another folder' : 'Watch USG export folder'}</Button>
        </div>
      )}
      <p className="text-[11px] text-muted">{st.active ? 'New JPEG / PNG / BMP / DICOM exports attach to the open draft automatically' + (st.imported ? ' · ' + st.imported + ' imported' : '') + '.' : st.error || 'Point this at the folder the ultrasound console exports to (USB, network share or a cloud-synced folder).'}</p>
      {st.pending > 0 && !readOnly && <Button size="xs" variant="primary" icon={Upload} onClick={() => onAddFiles(takePending())}>Attach {st.pending} waiting image{st.pending === 1 ? '' : 's'}</Button>}
    </div>
  );
}

function ImagesTab({ report, onImages, onAddFiles, perPage, setPerPage, onInline, readOnly, busy, sortMode, onSort, onCloudSync, onAttachInbox }) {
  const imgs = report.images || [];
  const [sent, setSent] = useState([]);
  useEffect(() => {
    let a = true;
    const load = () => kvGet('cloud-mirror:reports:' + report.id, null).then((x) => { if (a) setSent((x && x.images) || []); }).catch(() => {});
    load();
    const off = events.on('cloud:mirrored', (e) => { if (e && e.id === report.id) load(); });
    return () => { a = false; off(); };
  }, [report.id]);
  const add = async () => { const files = await pickFiles({ accept: 'image/*,.dcm,.dicom,.dic,application/dicom', multiple: true }); if (files.length) onAddFiles(files); };
  const addAny = async () => { const files = await pickFiles({ multiple: true }); if (files.length) onAddFiles(files); };
  const pasteClip = async () => {
    try {
      const items = await navigator.clipboard.read();
      const files = [];
      for (const it of items) for (const t of it.types) if (t.startsWith('image/')) files.push(new File([await it.getType(t)], 'clipboard.' + t.split('/')[1], { type: t }));
      if (files.length) onAddFiles(files); else toast('No image on the clipboard', 'info');
    } catch (e) { toast('Clipboard access was blocked — paste with Ctrl+V into the report instead', 'warning'); }
  };
  const set = (i, patch) => onImages(imgs.map((x, j) => (j === i ? Object.assign({}, x, patch) : x)));
  const setOrgan = (i, organ) => {
    const next = imgs.map((x, j) => (j === i ? Object.assign({}, x, { organ, caption: !x.caption || /^(organ…)?$/i.test(x.caption) || x.caption === organLabel(x.organ) ? organLabel(organ) : x.caption }) : x));
    onImages(next);
    if (sortMode !== 'manual') onSort(sortMode);
  };
  const move = (i, d) => { const a = imgs.slice(); const [x] = a.splice(i, 1); a.splice(i + d, 0, x); onImages(a); if (sortMode !== 'manual') onSort('manual'); };
  const warned = imgs.filter((x) => x.warn).length;
  // one scrolling column: tools first, then the images (drop files anywhere on it)
  return (
    <div className="h-full min-h-0 overflow-y-auto"
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={(e) => { e.preventDefault(); if (readOnly) return; const files = Array.from(e.dataTransfer.files || []); if (files.length) onAddFiles(files); }}>
      <div className="space-y-2 border-b border-line p-2.5">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="primary" icon={Upload} onClick={add} disabled={readOnly} loading={busy}>Add images / DICOM</Button>
          <Button size="sm" onClick={addAny} disabled={readOnly} title="Pick DICOM files without an extension (IM_0001, US000001…)">Other files</Button>
          <Button size="sm" onClick={pasteClip} disabled={readOnly}>Paste</Button>
        </div>
        <FolderWatch readOnly={readOnly} onAddFiles={onAddFiles} />
        {isServer() && <CloudInbox report={report} readOnly={readOnly} onAttach={onAttachInbox} />}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
          <span className="inline-flex items-center gap-1.5"><span className="text-muted">Order</span>
            <Segmented size="sm" ariaLabel="Image order" value={sortMode} onChange={(v) => onSort(v)} options={SORT_MODES.map((m) => ({ value: m.value, label: m.label }))} />
          </span>
          <span className="inline-flex items-center gap-1.5"><span className="text-muted">Per page</span><Segmented size="sm" ariaLabel="Images per printed page" value={String(perPage)} onChange={(v) => setPerPage(Number(v))} options={['2', '4', '6']} /></span>
        </div>
        <p className="text-[10.5px] leading-snug text-muted">{(SORT_MODES.find((m) => m.value === sortMode) || SORT_MODES[0]).title}.</p>
        <CloudStatus report={report} onSync={onCloudSync} />
        {warned > 0 && <p className="flex items-start gap-1 rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"><AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />{warned} image(s) carry another patient’s details in their DICOM header — remove them unless you are sure.</p>}
      </div>
      <div className="p-2.5">
        {imgs.length > 0 && <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">{imgs.length} image{imgs.length === 1 ? '' : 's'} · printed {perPage} per page</div>}
        {!imgs.length && <Empty icon={ImageIcon} title="No images yet" text="Drag & drop ultrasound captures or DICOM files here, paste (Ctrl+V) into the report, or click Add. They are sorted by organ automatically and print on image sheets after the report." />}
        <div className="grid grid-cols-2 gap-2">
          {imgs.map((im, i) => <ImgCard key={im.id} im={im} i={i} n={imgs.length} readOnly={readOnly} inCloud={sent.includes(im.id)} onCaption={(c) => set(i, { caption: c })} onOrgan={(o) => setOrgan(i, o)} onMove={(d) => move(i, d)} onRemove={() => onImages(imgs.filter((x) => x.id !== im.id))} onInline={(url) => onInline(url, im)} />)}
        </div>
      </div>
    </div>
  );
}

function DictionaryTab({ onInsert, readOnly }) {
  const list = useDictionary();
  const [q, setQ] = useState('');
  const res = useMemo(() => searchDictionary(list, q).slice(0, 150), [list, q]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line p-2.5"><div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} className="input pl-8" placeholder={`Search ${list.length} terms, normal values…`} aria-label="Search dictionary" />{q && <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setQ('')}><X className="h-4 w-4 text-muted" /></button>}</div></div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5">
        {res.map((e) => (
          <div key={e.id} className="rounded-lg border border-line p-2">
            <div className="flex items-center gap-1.5"><b className="min-w-0 flex-1 truncate text-[13px]">{e.term}</b><Badge tone="slate">{e.category}</Badge>{e.trigger && <code className="text-[10.5px] text-muted">{e.trigger}</code>}</div>
            {e.definition && <p className="mt-0.5 text-[11.5px] text-muted">{e.definition}</p>}
            {e.normal && <p className="mt-0.5 text-[11.5px]"><span className="font-semibold text-emerald-700 dark:text-emerald-400">Normal:</span> {e.normal}</p>}
            {!readOnly && <div className="mt-1 flex gap-1"><button type="button" className="chip px-1.5 py-0 text-[10.5px]" onClick={() => onInsert(escapeHtml(e.term))}>Insert term</button>{e.normal && <button type="button" className="chip px-1.5 py-0 text-[10.5px]" onClick={() => onInsert(`${escapeHtml(e.term)} (normal: ${escapeHtml(e.normal)})`)}>Insert with normal value</button>}</div>}
          </div>
        ))}
        {!res.length && <Empty icon={BookMarked} title="No term found" text="Add new terms in Medical Dictionary." />}
      </div>
    </div>
  );
}

export function SidePanel(props) {
  const { tab, setTab, readOnly } = props;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex border-b border-line">
        {SIDE_TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} title={t.label}
            className={cx('flex flex-1 flex-col items-center gap-0.5 px-1 py-1.5 text-[10.5px] font-semibold', tab === t.id ? 'bg-brand-50 text-brand-700 shadow-[inset_0_-2px_0] shadow-brand-600 dark:bg-brand-950/40 dark:text-brand-300' : 'text-muted hover:text-ink')}>
            <t.icon className={cx('h-4 w-4', t.id === 'copilot' && 'text-violet-500')} />{t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'macros' && <MacrosTab query={props.macroQuery} setQuery={props.setMacroQuery} onPick={props.onPick} onEdit={props.onEditMacro} onNew={props.onNewMacro} readOnly={readOnly} />}
        {tab === 'templates' && <TemplatesTab suggestedKeys={props.suggestedKeys} onPick={props.onPick} readOnly={readOnly} />}
        {tab === 'copilot' && <CopilotPanel tool={props.aiTool} setTool={props.setAiTool} api={props.api} report={props.report} readOnly={readOnly} onReplaceAll={props.onReplaceAll} />}
        {tab === 'images' && <ImagesTab report={props.report} onImages={props.onImages} onAddFiles={props.onAddImages} perPage={props.perPage} setPerPage={props.setPerPage} onInline={props.onInlineImage} readOnly={readOnly} busy={props.imgBusy}
          sortMode={props.sortMode || 'auto'} onSort={props.onSort} onCloudSync={props.onCloudSync} onAttachInbox={props.onAttachInbox} />}
        {tab === 'dictionary' && <DictionaryTab onInsert={(h) => props.api.current.insert(h)} readOnly={readOnly} />}
      </div>
    </div>
  );
}

