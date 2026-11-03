// Master Investigation & Diagnostic Tariff Directory: instant search (Ctrl+K or /) with rate
// look-up suggestions, frequently ordered tests, department pills with logos & counts, sortable
// table / department cards, quick inline tariff edit mode, add / edit / delete, bulk delete / move /
// rate change (% or ₹), patient estimate tray with slip printing, branded PDF rate card, CSV / JSON
// import (validated preview) & export, reset to the default master list.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Star, Plus, Pencil, Trash2, FileDown, Upload, Download, Printer, RotateCcw, LayoutGrid, Table2, Calculator, X, ChevronUp, ChevronDown,
  FolderInput, Percent, CheckSquare, Receipt, Settings as SettingsIcon, CircleCheck, Eye, EyeOff, Flame
} from 'lucide-react';
import { useColl, useSettings, useHotkeys, useLocalPref, navigate } from '../../core/hooks';
import { store } from '../../core/store';
import { useNet } from '../../core/sync';
import { can, logAudit } from '../../core/auth';
import { printHtml, MM } from '../../core/print';
import { htmlToPdf } from '../../core/pdf';
import { cx, Card, Button, IconBtn, Badge, Input, Textarea, Select, Field, Segmented, Toggle, Checkbox, Modal, Empty, Menu, toast, confirmDialog } from '../../components/ui';
import { DeptBadge, DeptIcon, DeptLogo, BrandMark, deptOf } from '../../components/dept';
import { testMatches, testScore, rateOf } from '../../components/TestPicker';
import { inr, uid, pad, dateKey, download, toCSV, csvToObjects, readAsText, pickFiles, lsSet, fileExt, num } from '../../core/utils';
import seed from '../../../../shared/seed-data';
import { LAB_PANELS } from '../lab/labPrint';
import { TEMPLATES } from '../../data/templates';
import { rateCardPages, estimateHtml, DEPT_ORDER } from './tariffPrint';

const RATE_FIELDS = [['standardRate', 'Standard'], ['emergencyRate', 'Emergency'], ['b2bRate', 'B2B'], ['cghsRate', 'CGHS']];
const TATS = ['Immediate / 30 Mins', 'Same Day 4 Hours', 'Same Day Evening', 'Next Day', '48 Hours', '3–5 Days'];
const PREP_TAGS = ['Overnight / 6–8 hours fasting required (plain water allowed).', 'Full bladder required – drink 4–5 glasses of water 1 hour before the scan.', '2 ml EDTA whole blood.', '3 ml clotted blood.', 'No preparation required.', 'Bring previous reports & prescriptions.'];
const r50 = (n) => Math.round(n / 50) * 50;
const r10 = (n) => Math.round(n / 10) * 10;
const DEPT_ALIAS = { usg: 'Ultrasound', ultrasound: 'Ultrasound', sonography: 'Ultrasound', path: 'Pathology', pathology: 'Pathology', bio: 'Biochemistry', biochemistry: 'Biochemistry', xray: 'X-Ray', 'x-ray': 'X-Ray', 'x ray': 'X-Ray', radiology: 'X-Ray', ecg: 'ECG', ekg: 'ECG', echo: 'Echo', '2d echo': 'Echo' };
const normDept = (d) => DEPT_ALIAS[String(d || '').trim().toLowerCase()] || (DEPT_ORDER.includes(d) ? d : '');

export function nextCode(dept, tests) {
  const meta = seed.DEPARTMENTS.find((d) => d.key === dept) || { prefix: 'GEN', start: 1 };
  const nums = tests.filter((t) => String(t.code || '').toUpperCase().startsWith(meta.prefix + '-')).map((t) => parseInt(String(t.code).split('-').pop(), 10)).filter(Number.isFinite);
  return meta.prefix + '-' + pad(Math.max(meta.start - 1, ...nums) + 1, 3);
}

/** Times each test was billed in the last 90 days (drives the 🔥 usage hint). */
function useUsage() {
  const invoices = useColl('invoices');
  return useMemo(() => {
    const since = Date.now() - 90 * 86400000;
    const m = {};
    invoices.forEach((i) => { if ((i.date || 0) >= since) (i.items || []).forEach((it) => { m[it.testId] = (m[it.testId] || 0) + 1; }); });
    return m;
  }, [invoices]);
}

export function TariffDirectory() {
  const settings = useSettings();
  const net = useNet();
  const tests = useColl('tests');
  const usage = useUsage();
  const canEdit = can('tariff:manage_rate_list');
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const [dept, setDept] = useLocalPref('tariff-dept', 'all');
  const [view, setView] = useLocalPref('tariff-view', 'table');
  const [showInactive, setShowInactive] = useState(false);
  const [freqOpen, setFreqOpen] = useLocalPref('tariff-freq-open', true);
  const [quick, setQuick] = useState(false);
  const [sort, setSort] = useState({ key: 'department', dir: 1 });
  const [sel, setSel] = useState(() => new Set());
  const [edit, setEdit] = useState(null);
  const [bulk, setBulk] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [est, setEst] = useLocalPref('tariff-estimate', { items: [], field: 'standardRate', discount: 0, patient: '' });
  const searchRef = useRef(null);
  useHotkeys({ 'ctrl+k': () => searchRef.current && searchRef.current.focus(), '/': () => { if (searchRef.current) { searchRef.current.focus(); return true; } return false; } }, []);

  const active = useMemo(() => tests.filter((t) => showInactive || t.isActive !== false), [tests, showInactive]);
  const counts = useMemo(() => {
    const c = { all: active.length, frequent: active.filter((t) => t.isFrequent).length };
    DEPT_ORDER.forEach((d) => { c[d] = active.filter((t) => t.department === d).length; });
    return c;
  }, [active]);
  const s = q.trim().toLowerCase();
  const rows = useMemo(() => {
    const list = active.filter((t) => (dept === 'all' || (dept === 'frequent' ? t.isFrequent : t.department === dept)) && testMatches(t, s));
    const key = sort.key;
    const val = (t) => (key === 'rate' ? rateOf(t) : key === 'department' ? DEPT_ORDER.indexOf(t.department) + (t.code || '') : String(t[key] || '').toLowerCase());
    return list.sort((a, b) => (s ? testScore(b, s) - testScore(a, s) : 0) || (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [active, dept, s, sort]);
  const suggestions = useMemo(() => (s ? active.filter((t) => testMatches(t, s)).sort((a, b) => testScore(b, s) - testScore(a, s)).slice(0, 8) : []), [active, s]);
  const frequent = useMemo(() => active.filter((t) => t.isFrequent).sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0) || DEPT_ORDER.indexOf(a.department) - DEPT_ORDER.indexOf(b.department)), [active, usage]);

  const save = (t, patch, action = 'tariff:test_updated') => {
    if (!canEdit) return toast('Read-only: your role cannot edit the rate list', 'error');
    const next = store.put('tests', Object.assign({}, t, patch));
    logAudit(action, 'tests/' + t.id, { code: t.code, changed: Object.keys(patch), from: patch.tariff ? t.tariff.standardRate : undefined, to: patch.tariff ? patch.tariff.standardRate : undefined });
    return next;
  };
  const star = (t) => { if (canEdit) save(t, { isFrequent: !t.isFrequent }, 'tariff:frequent_toggled'); else toast('Only the administrator can change frequent tests', 'warning'); };
  const addEst = (t) => { if (est.items.includes(t.id)) return toast(t.name + ' is already in the estimate', 'info'); setEst(Object.assign({}, est, { items: est.items.concat([t.id]) })); };
  const del = async (t) => {
    if (!(await confirmDialog({ title: 'Delete investigation?', message: `${t.code} · ${t.name}\n\nPast invoices keep their own copy of the test. Consider deactivating instead if it may be offered again.`, danger: true, confirmText: 'Delete' }))) return;
    store.remove('tests', t.id);
    logAudit('tariff:test_deleted', 'tests/' + t.id, { code: t.code, name: t.name });
    toast('Deleted ' + t.name, 'success');
  };
  const toggleSort = (key) => setSort((x) => ({ key, dir: x.key === key ? -x.dir : 1 }));
  const selected = rows.filter((t) => sel.has(t.id));
  const allOn = rows.length > 0 && rows.every((t) => sel.has(t.id));

  const exportCsv = () => {
    const cols = [{ key: 'code', label: 'code' }, { key: 'name', label: 'name' }, { key: 'shortName', label: 'shortName' }, { key: 'department', label: 'department' }, { key: 'description', label: 'description' },
      { label: 'standardRate', get: (t) => t.tariff.standardRate }, { label: 'emergencyRate', get: (t) => t.tariff.emergencyRate }, { label: 'b2bRate', get: (t) => t.tariff.b2bRate }, { label: 'cghsRate', get: (t) => t.tariff.cghsRate },
      { key: 'tat', label: 'tat' }, { label: 'isFrequent', get: (t) => (t.isFrequent ? 'yes' : 'no') }, { label: 'isActive', get: (t) => (t.isActive === false ? 'no' : 'yes') }];
    download('SSDC_Tariff_' + dateKey() + '.csv', toCSV(tests.slice().sort((a, b) => String(a.code).localeCompare(String(b.code))), cols), 'text/csv;charset=utf-8');
    logAudit('tariff:exported', 'tests', { format: 'csv', count: tests.length });
  };
  const exportJson = () => { download('SSDC_Tariff_' + dateKey() + '.json', JSON.stringify({ app: 'ssdc-suite', kind: 'tariff', exportedAt: new Date().toISOString(), tests }, null, 2), 'application/json'); logAudit('tariff:exported', 'tests', { format: 'json', count: tests.length }); };
  const resetDefaults = async () => {
    if (!(await confirmDialog({ title: 'Reset to the default master list?', message: `All ${seed.TESTS.length} built-in investigations are restored with their default rates (deleted ones come back). Investigations you added yourself are kept.`, danger: true, confirmText: 'Reset rates' }))) return;
    seed.TESTS.forEach((t) => store.put('tests', Object.assign({}, t)));
    logAudit('tariff:reset_defaults', 'tests', { count: seed.TESTS.length });
    toast('Default master list restored', 'success');
  };

  const c = settings.clinic;
  return (
    <div className="min-w-0 pb-24">
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card">
        <BrandMark logo={c.logo} className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-lg font-extrabold leading-tight sm:text-xl">{c.name}</div>
          <div className="truncate text-[13px] font-semibold text-brand-700 dark:text-brand-300">Master Investigation & Diagnostic Tariff Directory</div>
          <div className="truncate text-[11.5px] text-muted">{c.address} · ☎ {[c.phone, c.phone2].filter(Boolean).join(', ')} · {c.email}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="emerald" icon={CircleCheck}>Auto-save on{net.mode === 'server' ? ' · synced to all PCs' : ''}</Badge>
          {canEdit && <IconBtn icon={SettingsIcon} title="Edit centre name, address, logo & footer" onClick={() => navigate('/settings', { tab: 'clinic' })} />}
        </div>
      </div>

      <div className="sticky top-0 z-20 -mx-1 mb-3 bg-canvas/95 px-1 pb-2 pt-1 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[260px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input ref={searchRef} className="h-11 pl-9 text-[15px]" placeholder="Search code, test name, alias (CBC, W/A, LFT), department, preparation or price…  (Ctrl+K or /)" value={q}
              onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur(); } }} aria-label="Search tariff" />
            {focus && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
                {suggestions.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 border-b border-line/60 px-3 py-2 last:border-0 hover:bg-surface2">
                    <DeptIcon dept={t.department} color={deptOf(t.department).hex} />
                    <button className="min-w-0 flex-1 text-left" onMouseDown={(e) => { e.preventDefault(); setQ(t.code); }}>
                      <span className="block truncate text-[13.5px] font-semibold">{t.name}</span>
                      <span className="text-[11px] text-muted">{t.code}{t.shortName ? ' · ' + t.shortName : ''} · {t.tat}</span>
                    </button>
                    <span className="font-display text-[15px] font-extrabold tnum">{inr(t.tariff.standardRate)}</span>
                    <Button size="xs" icon={Calculator} onMouseDown={(e) => { e.preventDefault(); addEst(t); }}>Estimate</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Segmented value={view} onChange={setView} options={[{ value: 'table', label: 'Table', icon: Table2 }, { value: 'cards', label: 'Cards', icon: LayoutGrid }]} />
          {canEdit && <Toggle checked={quick} onChange={setQuick} label="Quick tariff edit" />}
          {canEdit && <Button variant="primary" icon={Plus} onClick={() => setEdit({ isNew: true })}>Add investigation</Button>}
          <Menu width="w-60" trigger={<Button icon={Download}>Export / import</Button>} items={[
            { label: 'PDF rate card…', icon: FileDown, onClick: () => setCardOpen(true) },
            { label: 'Export CSV (Excel)', icon: Download, onClick: exportCsv },
            { label: 'Export JSON backup', icon: Download, onClick: exportJson },
            canEdit && { divider: true },
            canEdit && { label: 'Import CSV / JSON…', icon: Upload, onClick: () => setImportOpen(true) },
            canEdit && { label: 'Reset to default master list', icon: RotateCcw, danger: true, onClick: resetDefaults }
          ].filter(Boolean)} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button onClick={() => setDept('all')} className={cx('chip', dept === 'all' && 'chip-on')}>All departments<span className="text-[10px] tnum text-muted">{counts.all}</span></button>
          <button onClick={() => setDept('frequent')} className={cx('chip', dept === 'frequent' && 'chip-on')}><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />Frequently used<span className="text-[10px] tnum text-muted">{counts.frequent}</span></button>
          {DEPT_ORDER.map((d) => (
            <button key={d} onClick={() => setDept(d)} className={cx('chip', dept === d && 'chip-on')}><DeptIcon dept={d} color={deptOf(d).hex} />{deptOf(d).key}<span className="text-[10px] tnum text-muted">{counts[d]}</span></button>
          ))}
          <button onClick={() => setShowInactive(!showInactive)} className={cx('chip ml-auto', showInactive && 'chip-on')}>{showInactive ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}Inactive</button>
        </div>
      </div>

      {frequent.length > 0 && dept !== 'frequent' && !s && (
        <Card className="mb-4" padded={false} title="Frequently ordered tests" subtitle="One click adds to the patient estimate · ★ to pin / unpin" icon={Star}
          actions={<IconBtn icon={freqOpen ? ChevronUp : ChevronDown} title={freqOpen ? 'Collapse' : 'Expand'} onClick={() => setFreqOpen(!freqOpen)} />}>
          {freqOpen && (
            <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {frequent.map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-xl border border-line px-2.5 py-2 hover:border-brand-300">
                  <DeptLogo dept={t.department} size="sm" />
                  <button className="min-w-0 flex-1 text-left" onClick={() => addEst(t)} title="Add to estimate">
                    <span className="block truncate text-[13px] font-semibold">{t.name}</span>
                    <span className="text-[11px] text-muted">{t.code}{usage[t.id] ? ' · ' + usage[t.id] + '× in 90 days' : ''}</span>
                  </button>
                  <span className="font-display text-[14px] font-extrabold tnum">{inr(t.tariff.standardRate)}</span>
                  <StarBtn on title="Unpin" onClick={() => star(t)} />
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {selected.length > 0 && canEdit && (
        <div className="sticky top-[118px] z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-300 bg-brand-50 px-3 py-2 text-[13px] dark:border-brand-800 dark:bg-brand-950/50">
          <CheckSquare className="h-4 w-4 text-brand-600" /><b>{selected.length} selected</b>
          <Button size="sm" icon={Percent} onClick={() => setBulk({ mode: 'rate' })}>Modify rates</Button>
          <Button size="sm" icon={FolderInput} onClick={() => setBulk({ mode: 'move' })}>Move department</Button>
          <Button size="sm" icon={Star} onClick={() => { selected.forEach((t) => store.put('tests', Object.assign({}, t, { isFrequent: true }))); logAudit('tariff:bulk_frequent', 'tests', { count: selected.length }); }}>Mark frequent</Button>
          <Button size="sm" icon={EyeOff} onClick={() => { selected.forEach((t) => store.put('tests', Object.assign({}, t, { isActive: !(t.isActive !== false) }))); logAudit('tariff:bulk_active_toggled', 'tests', { count: selected.length }); }}>Toggle active</Button>
          <Button size="sm" icon={Calculator} onClick={() => setEst(Object.assign({}, est, { items: Array.from(new Set(est.items.concat(selected.map((t) => t.id)))) }))}>Add to estimate</Button>
          <Button size="sm" variant="danger-ghost" icon={Trash2} onClick={async () => {
            if (!(await confirmDialog({ title: `Delete ${selected.length} investigation(s)?`, message: selected.slice(0, 12).map((t) => t.code + ' · ' + t.name).join('\n') + (selected.length > 12 ? '\n…' : ''), danger: true, confirmText: 'Delete all' }))) return;
            selected.forEach((t) => store.remove('tests', t.id));
            logAudit('tariff:bulk_deleted', 'tests', { count: selected.length, codes: selected.map((t) => t.code).slice(0, 50) });
            setSel(new Set());
          }}>Delete</Button>
          <Button size="sm" variant="ghost" icon={X} className="ml-auto" onClick={() => setSel(new Set())}>Clear</Button>
        </div>
      )}

      {!rows.length ? <Card><Empty icon={Search} title="No investigation matches" text={s ? 'Try the short alias (e.g. CBC, W/A, LFT, CXR) or the price.' : 'No tests in this department yet.'} action={canEdit ? <Button icon={Plus} onClick={() => setEdit({ isNew: true, department: DEPT_ORDER.includes(dept) ? dept : 'Ultrasound' })}>Add investigation</Button> : null} /></Card>
        : view === 'cards' ? <CardsView rows={rows} usage={usage} onEdit={canEdit ? (t) => setEdit(t) : null} onStar={star} onEstimate={addEst} />
          : (
            <Card padded={false}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-surface2/60 text-left text-[10.5px] uppercase tracking-wide text-muted">
                      {canEdit && <th className="w-8 px-3 py-2"><Checkbox checked={allOn} onChange={(v) => setSel(v ? new Set(rows.map((t) => t.id)) : new Set())} /></th>}
                      <SortTh k="code" sort={sort} onSort={toggleSort} className="w-[96px] pl-3">Code</SortTh>
                      <SortTh k="name" sort={sort} onSort={toggleSort}>Investigation</SortTh>
                      <SortTh k="department" sort={sort} onSort={toggleSort} className="w-[96px]">Dept.</SortTh>
                      <SortTh k="rate" sort={sort} onSort={toggleSort} className="w-[96px] text-right">Rate</SortTh>
                      <th className="w-[86px] px-2 py-2 text-right font-semibold">Emergency</th><th className="w-[80px] px-2 py-2 text-right font-semibold">B2B</th><th className="w-[86px] px-2 py-2 text-right font-semibold">CGHS</th>
                      <th className="w-[120px] px-2 py-2 font-semibold">Report time</th><th className="w-[124px] px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => <TestRow key={t.id} t={t} quick={quick && canEdit} canEdit={canEdit} selected={sel.has(t.id)} usage={usage[t.id] || 0}
                      onSelect={() => setSel((x) => { const n = new Set(x); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}
                      onSave={(patch) => save(t, patch)} onStar={() => star(t)} onEstimate={() => addEst(t)} onEdit={() => setEdit(t)} onDelete={() => del(t)} />)}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-line px-4 py-2 text-[11.5px] text-muted">{rows.length} investigation(s){quick ? ' · Quick edit: change a value and press Enter or leave the field to save' : ''}</div>
            </Card>
          )}

      {edit && <TestEditor initial={edit} tests={tests} onClose={() => setEdit(null)} />}
      {bulk && <BulkModal mode={bulk.mode} items={selected} onClose={() => setBulk(null)} onDone={() => { setBulk(null); setSel(new Set()); }} />}
      {importOpen && <ImportModal tests={tests} onClose={() => setImportOpen(false)} />}
      {cardOpen && <RateCardModal tests={tests} settings={settings} initialDept={DEPT_ORDER.includes(dept) ? dept : ''} onClose={() => setCardOpen(false)} />}
      <EstimateTray est={est} setEst={setEst} settings={settings} />
    </div>
  );
}

function StarBtn({ on, title, onClick }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg hover:bg-surface2">
      <Star className={cx('h-4 w-4', on ? 'fill-amber-400 text-amber-500' : 'text-muted')} />
    </button>
  );
}

function SortTh({ k, sort, onSort, children, className }) {
  const on = sort.key === k;
  return (
    <th className={cx('px-2 py-2 font-semibold', className)}>
      <button className={cx('inline-flex items-center gap-0.5 uppercase hover:text-ink', on && 'text-ink')} onClick={() => onSort(k)}>{children}{on && (sort.dir > 0 ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}</button>
    </th>
  );
}

function InlineCell({ value, onCommit, type = 'text', className, align }) {
  const [v, setV] = useState(value === undefined || value === null ? '' : String(value));
  useEffect(() => { setV(value === undefined || value === null ? '' : String(value)); }, [value]);
  const commit = () => { const nv = type === 'number' ? Math.max(0, num(v)) : v.trim(); if (String(nv) !== String(value === undefined || value === null ? '' : value)) onCommit(nv); };
  return <input className={cx('input input-sm', align === 'right' && 'text-right tnum', className)} value={v} inputMode={type === 'number' ? 'decimal' : undefined}
    onChange={(e) => setV(type === 'number' ? e.target.value.replace(/[^\d.]/g, '') : e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setV(String(value || '')); e.currentTarget.blur(); } }} />;
}

function TestRow({ t, quick, canEdit, selected, usage, onSelect, onSave, onStar, onEstimate, onEdit, onDelete }) {
  const inactive = t.isActive === false;
  const rate = (k) => (quick ? <InlineCell type="number" align="right" value={t.tariff[k]} onCommit={(v) => onSave({ tariff: Object.assign({}, t.tariff, { [k]: v }) })} /> : <span className="tnum">{Number(t.tariff[k]) ? inr(t.tariff[k]) : '—'}</span>);
  return (
    <tr className={cx('border-b border-line/70 align-top hover:bg-surface2/40', selected && 'bg-brand-50/50 dark:bg-brand-950/20', inactive && 'opacity-55')}>
      {canEdit && <td className="px-3 py-2"><Checkbox checked={selected} onChange={onSelect} /></td>}
      <td className="px-2 py-2 pl-3 font-mono text-[12px]">{quick ? <InlineCell value={t.code} onCommit={(v) => v && onSave({ code: v.toUpperCase() })} /> : t.code}</td>
      <td className="px-2 py-2">
        {quick ? (
          <div className="space-y-1"><InlineCell value={t.name} onCommit={(v) => v && onSave({ name: v })} /><InlineCell value={t.description} onCommit={(v) => onSave({ description: v })} className="text-[11.5px]" /></div>
        ) : (
          <>
            <div className="flex items-center gap-1.5 font-semibold">{t.name}{t.shortName && <span className="rounded bg-surface2 px-1.5 py-0.5 text-[10.5px] font-medium text-muted">{t.shortName}</span>}{inactive && <Badge>inactive</Badge>}{usage > 0 && <span className="inline-flex items-center text-[10.5px] font-medium text-orange-600" title="Billed in the last 90 days"><Flame className="h-3 w-3" />{usage}</span>}</div>
            {t.description && <div className="mt-0.5 line-clamp-2 text-[11.5px] text-muted">{t.description}</div>}
          </>
        )}
      </td>
      <td className="px-2 py-2"><DeptBadge dept={t.department} /></td>
      <td className="px-2 py-2 text-right font-display text-[14px] font-extrabold">{rate('standardRate')}</td>
      <td className="px-2 py-2 text-right">{rate('emergencyRate')}</td>
      <td className="px-2 py-2 text-right">{rate('b2bRate')}</td>
      <td className="px-2 py-2 text-right">{rate('cghsRate')}</td>
      <td className="px-2 py-2 text-[12px] text-muted">{t.tat}</td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right">
        <StarBtn on={t.isFrequent} title={t.isFrequent ? 'Unpin from frequent' : 'Pin as frequent'} onClick={onStar} />
        <IconBtn size="sm" icon={Calculator} title="Add to patient estimate" onClick={onEstimate} />
        {canEdit && <IconBtn size="sm" icon={Pencil} title="Edit" onClick={onEdit} />}
        {canEdit && <IconBtn size="sm" icon={Trash2} tone="danger" title="Delete" onClick={onDelete} />}
      </td>
    </tr>
  );
}

function CardsView({ rows, usage, onEdit, onStar, onEstimate }) {
  return (
    <div className="space-y-5">
      {DEPT_ORDER.filter((d) => rows.some((t) => t.department === d)).map((d) => (
        <section key={d}>
          <div className="mb-2 flex items-center gap-2"><DeptLogo dept={d} size="sm" /><h3 className="font-display text-[15px] font-bold">{deptOf(d).label}</h3><span className="text-[12px] text-muted">{rows.filter((t) => t.department === d).length}</span></div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {rows.filter((t) => t.department === d).map((t) => (
              <div key={t.id} className={cx('card flex flex-col gap-1 p-3', t.isActive === false && 'opacity-55')} style={{ borderTop: '3px solid ' + deptOf(d).hex }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="truncate text-[13.5px] font-semibold">{t.name}</div><div className="text-[11px] text-muted">{t.code}{t.shortName ? ' · ' + t.shortName : ''}{usage[t.id] ? ' · ' + usage[t.id] + '× / 90 d' : ''}</div></div>
                  <StarBtn on={t.isFrequent} title={t.isFrequent ? 'Unpin from frequent' : 'Pin as frequent'} onClick={() => onStar(t)} />
                </div>
                {t.description && <div className="line-clamp-2 text-[11.5px] text-muted">{t.description}</div>}
                <div className="mt-auto flex items-end justify-between gap-2 pt-1">
                  <div><div className="font-display text-lg font-extrabold leading-5 tnum">{inr(t.tariff.standardRate)}</div><div className="text-[10.5px] text-muted">{t.tat}</div></div>
                  <div className="flex gap-1">{onEdit && <IconBtn size="sm" icon={Pencil} title="Edit" onClick={() => onEdit(t)} />}<Button size="xs" icon={Calculator} onClick={() => onEstimate(t)}>Estimate</Button></div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- add / edit
function TestEditor({ initial, tests, onClose }) {
  const isNew = !!initial.isNew;
  const [f, setF] = useState(() => {
    const dept = initial.department || 'Ultrasound';
    const base = isNew ? { id: uid('t_'), code: nextCode(dept, tests), name: '', shortName: '', department: dept, description: '', tariff: { standardRate: '', emergencyRate: '', b2bRate: '', cghsRate: '' }, tat: 'Same Day 4 Hours', isFrequent: false, isActive: true, isObstetric: false, isDoppler: false, labPanel: null, templateKey: null } : JSON.parse(JSON.stringify(initial));
    return Object.assign(base, { autoCode: isNew, autoRates: isNew });
  });
  const set = (patch) => setF((x) => Object.assign({}, x, patch));
  const setRate = (k, v) => setF((x) => {
    const tariff = Object.assign({}, x.tariff, { [k]: v });
    if (k === 'standardRate' && x.autoRates) { const n = num(v); Object.assign(tariff, { emergencyRate: n ? r50(n * 1.3) : '', b2bRate: n ? r10(n * 0.8) : '', cghsRate: n ? r10(n * 0.65) : '' }); }
    return Object.assign({}, x, { tariff });
  });
  const setDept = (d) => set({ department: d, code: f.autoCode ? nextCode(d, tests.filter((t) => t.id !== f.id)) : f.code, labPanel: ['Pathology', 'Biochemistry'].includes(d) ? f.labPanel : null, templateKey: ['Ultrasound', 'X-Ray', 'Echo'].includes(d) ? f.templateKey : null, isObstetric: d === 'Ultrasound' ? f.isObstetric : false });
  const save = async () => {
    const name = String(f.name || '').trim();
    const code = String(f.code || '').trim().toUpperCase();
    if (!name) return toast('Investigation name is required', 'warning');
    if (!code) return toast('Code is required', 'warning');
    if (tests.some((t) => t.id !== f.id && String(t.code).toUpperCase() === code)) return toast('Code ' + code + ' is already used', 'warning');
    if (!(num(f.tariff.standardRate) > 0)) return toast('Enter the standard rate', 'warning');
    const twin = tests.find((t) => t.id !== f.id && String(t.name).trim().toLowerCase() === name.toLowerCase());
    if (twin && !(await confirmDialog({ title: 'Duplicate name', message: `“${twin.name}” already exists as ${twin.code} (${twin.department}, ${inr(twin.tariff.standardRate)}). Save another test with the same name?`, confirmText: 'Save anyway' }))) return;
    const { autoCode, autoRates, isNew: _n, ...rest } = f;
    const doc = Object.assign(rest, { name, code, shortName: String(f.shortName || '').trim(), tariff: { standardRate: num(f.tariff.standardRate), emergencyRate: num(f.tariff.emergencyRate) || num(f.tariff.standardRate), b2bRate: num(f.tariff.b2bRate) || num(f.tariff.standardRate), cghsRate: num(f.tariff.cghsRate) || num(f.tariff.standardRate) } });
    store.put('tests', doc);
    logAudit(isNew ? 'tariff:test_added' : 'tariff:test_updated', 'tests/' + doc.id, { code: doc.code, rate: doc.tariff.standardRate });
    toast((isNew ? 'Added ' : 'Saved ') + doc.name, 'success');
    onClose();
  };
  const tplOptions = TEMPLATES.filter((x) => x.kind === 'template' && (f.department === 'X-Ray' ? /x-?ray/i.test(x.modality) : f.department === 'Echo' ? /echo|doppler/i.test(x.title + x.modality) : !/x-?ray/i.test(x.modality))).map((x) => ({ value: x.key, label: x.title }));
  return (
    <Modal open size="lg" onClose={onClose} title={isNew ? 'Add investigation' : 'Edit investigation'} subtitle={isNew ? 'New test in the master rate list' : f.code + ' · ' + f.name} icon={isNew ? Plus : Pencil}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>{isNew ? 'Add to rate list' : 'Save changes'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-6">
        <Field label="Department" className="sm:col-span-3"><div className="flex items-center gap-2"><DeptLogo dept={f.department} size="sm" /><Select value={f.department} onChange={(e) => setDept(e.target.value)} options={DEPT_ORDER.map((d) => ({ value: d, label: deptOf(d).label }))} /></div></Field>
        <Field label="Code" className="sm:col-span-3" extra={<Toggle size="sm" checked={f.autoCode} onChange={(v) => set({ autoCode: v, code: v ? nextCode(f.department, tests.filter((t) => t.id !== f.id)) : f.code })} label="Auto" />}>
          <Input value={f.code} disabled={f.autoCode} onChange={(e) => set({ code: e.target.value.toUpperCase() })} className="font-mono" />
        </Field>
        <Field label="Investigation name" required className="sm:col-span-4"><Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. USG Whole Abdomen" autoFocus /></Field>
        <Field label="Short name / alias" className="sm:col-span-2"><Input value={f.shortName} onChange={(e) => set({ shortName: e.target.value })} placeholder="W/A, CBC, LFT, CXR" /></Field>
        <Field label="Preparation / sample / clinical notes" className="sm:col-span-6">
          <Textarea rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} />
          <div className="mt-1 flex flex-wrap gap-1">{PREP_TAGS.map((p) => <button key={p} type="button" className="chip text-[11px]" onClick={() => set({ description: (f.description ? f.description.trim() + ' ' : '') + p })}>+ {p.split(/[–(.]/)[0].trim()}</button>)}</div>
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:col-span-6 sm:grid-cols-4">
          {RATE_FIELDS.map(([k, label]) => (
            <Field key={k} label={label + ' (₹)'} required={k === 'standardRate'}>
              <Input inputMode="decimal" value={f.tariff[k]} disabled={k !== 'standardRate' && f.autoRates} onChange={(e) => setRate(k, e.target.value.replace(/[^\d.]/g, ''))} className="tnum" />
            </Field>
          ))}
        </div>
        <div className="sm:col-span-6"><Toggle size="sm" checked={f.autoRates} onChange={(v) => set({ autoRates: v })} label="Auto-calculate emergency (×1.3), B2B (×0.8) and CGHS (×0.65) from the standard rate" /></div>
        <Field label="Reporting turnaround time" className="sm:col-span-3">
          <Input list="tat-list" value={f.tat} onChange={(e) => set({ tat: e.target.value })} />
          <datalist id="tat-list">{TATS.map((x) => <option key={x} value={x} />)}</datalist>
        </Field>
        <div className="flex flex-col justify-end gap-2 sm:col-span-3">
          <Toggle checked={!!f.isFrequent} onChange={(v) => set({ isFrequent: v })} label="Mark as frequently ordered" />
          <Toggle checked={f.isActive !== false} onChange={(v) => set({ isActive: v })} label="Active in the rate list" />
        </div>
        {f.department === 'Ultrasound' && (
          <div className="flex flex-wrap gap-4 rounded-xl bg-surface2/60 p-3 sm:col-span-6">
            <Toggle checked={!!f.isObstetric} onChange={(v) => set({ isObstetric: v })} label="Obstetric scan (PC-PNDT Form F)" hint="Registration opens the pregnancy panel and auto-creates Form F" />
            <Toggle checked={!!f.isDoppler} onChange={(v) => set({ isDoppler: v })} label="Colour Doppler study" />
          </div>
        )}
        {['Ultrasound', 'X-Ray', 'Echo'].includes(f.department) && <Field label="Default report template" className="sm:col-span-6"><Select value={f.templateKey || ''} onChange={(e) => set({ templateKey: e.target.value || null })} placeholder="— none —" options={tplOptions} /></Field>}
        {['Pathology', 'Biochemistry'].includes(f.department) && <Field label="Lab result panel (parameters, units & reference ranges)" className="sm:col-span-6"><Select value={f.labPanel || ''} onChange={(e) => set({ labPanel: e.target.value || null })} placeholder="— free-text result —" options={Object.values(LAB_PANELS).map((p) => ({ value: p.id, label: p.title }))} /></Field>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- bulk actions
function BulkModal({ mode, items, onClose, onDone }) {
  const [fields, setFields] = useState({ standardRate: true, emergencyRate: true, b2bRate: true, cghsRate: false });
  const [dir, setDir] = useState('up');
  const [unit, setUnit] = useState('pct');
  const [amount, setAmount] = useState('10');
  const [round, setRound] = useState('10');
  const [dept, setDept] = useState(DEPT_ORDER[0]);
  const calc = (v) => {
    const n = Number(v) || 0;
    const a = num(amount);
    let x = unit === 'pct' ? n * (1 + (dir === 'up' ? a : -a) / 100) : n + (dir === 'up' ? a : -a);
    const r = Number(round);
    if (r > 0) x = Math.round(x / r) * r;
    return Math.max(0, Math.round(x * 100) / 100);
  };
  const apply = () => {
    if (mode === 'move') {
      items.forEach((t) => store.put('tests', Object.assign({}, t, { department: dept })));
      logAudit('tariff:bulk_moved', 'tests', { count: items.length, to: dept });
      toast(`${items.length} test(s) moved to ${dept}`, 'success');
    } else {
      if (!(num(amount) > 0)) return toast('Enter the amount', 'warning');
      items.forEach((t) => {
        const tariff = Object.assign({}, t.tariff);
        Object.keys(fields).forEach((k) => { if (fields[k]) tariff[k] = calc(tariff[k]); });
        store.put('tests', Object.assign({}, t, { tariff }));
      });
      logAudit('tariff:bulk_rate_change', 'tests', { count: items.length, dir, unit, amount: num(amount), fields: Object.keys(fields).filter((k) => fields[k]) });
      toast(`Rates updated for ${items.length} test(s)`, 'success');
    }
    onDone();
  };
  return (
    <Modal open size="md" onClose={onClose} title={mode === 'move' ? 'Move to department' : 'Bulk rate modification'} subtitle={items.length + ' selected investigation(s)'} icon={mode === 'move' ? FolderInput : Percent}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={apply}>Apply to {items.length}</Button></>}>
      {mode === 'move' ? (
        <Field label="New department"><Select value={dept} onChange={(e) => setDept(e.target.value)} options={DEPT_ORDER.map((d) => ({ value: d, label: deptOf(d).label }))} /></Field>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">{RATE_FIELDS.map(([k, label]) => <Checkbox key={k} checked={!!fields[k]} onChange={(v) => setFields(Object.assign({}, fields, { [k]: v }))} label={label} />)}</div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Change"><Segmented value={dir} onChange={setDir} options={[{ value: 'up', label: 'Increase' }, { value: 'down', label: 'Decrease' }]} /></Field>
            <Field label="By"><Segmented value={unit} onChange={setUnit} options={[{ value: 'pct', label: '%' }, { value: 'flat', label: '₹' }]} /></Field>
            <Field label="Amount"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
            <Field label="Round to"><Select value={round} onChange={(e) => setRound(e.target.value)} options={[{ value: '0', label: 'No rounding' }, { value: '5', label: '₹5' }, { value: '10', label: '₹10' }, { value: '50', label: '₹50' }]} /></Field>
          </div>
          <div className="rounded-xl bg-surface2/60 p-2.5 text-[12px]">
            <div className="label">Preview</div>
            {items.slice(0, 6).map((t) => <div key={t.id} className="flex justify-between gap-2"><span className="truncate">{t.code} · {t.name}</span><span className="tnum">{inr(t.tariff.standardRate)} → <b>{fields.standardRate ? inr(calc(t.tariff.standardRate)) : inr(t.tariff.standardRate)}</b></span></div>)}
            {items.length > 6 && <div className="text-muted">… and {items.length - 6} more</div>}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- import
const COL_ALIASES = {
  code: ['code', 'test code', 'investigation code'], name: ['name', 'test name', 'investigation', 'test'], shortName: ['shortname', 'short name', 'alias', 'abbreviation'],
  department: ['department', 'dept', 'category'], description: ['description', 'preparation', 'notes', 'prep'], standardRate: ['standardrate', 'rate', 'price', 'standard', 'mrp', 'amount'],
  emergencyRate: ['emergencyrate', 'emergency', 'stat'], b2bRate: ['b2brate', 'b2b', 'referral', 'corporate'], cghsRate: ['cghsrate', 'cghs', 'umid'], tat: ['tat', 'turnaround', 'report time'],
  isFrequent: ['isfrequent', 'frequent', 'star'], isActive: ['isactive', 'active', 'enabled']
};
function mapRow(raw) {
  const out = {};
  const keys = Object.keys(raw);
  Object.entries(COL_ALIASES).forEach(([field, aliases]) => {
    const k = keys.find((x) => aliases.includes(String(x).trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')) || aliases.includes(String(x).trim().toLowerCase().replace(/[\s_-]+/g, '')));
    if (k !== undefined) out[field] = raw[k];
  });
  if (raw.tariff && typeof raw.tariff === 'object') Object.assign(out, raw.tariff);
  return out;
}
const yes = (v, d) => (v === undefined || v === '' ? d : /^(1|y|yes|true|✓|★)$/i.test(String(v).trim()));

function ImportModal({ tests, onClose }) {
  const [rows, setRows] = useState(null);
  const [name, setName] = useState('');
  const load = async () => {
    const [file] = await pickFiles({ accept: '.csv,.json,.tsv,.txt' });
    if (!file) return;
    try {
      const text = await readAsText(file);
      let raw = fileExt(file.name) === 'json' ? JSON.parse(text) : csvToObjects(text);
      if (raw && !Array.isArray(raw)) raw = raw.tests || raw.items || [];
      const byCode = new Map(tests.map((t) => [String(t.code).toUpperCase(), t]));
      const pending = tests.slice();
      const out = raw.map((r, i) => {
        const m = mapRow(r);
        const errors = [];
        const department = normDept(m.department);
        const name = String(m.name || '').trim();
        if (!name) errors.push('name missing');
        if (!department) errors.push('unknown department "' + (m.department || '') + '"');
        const rate = num(m.standardRate);
        if (!(rate > 0)) errors.push('rate missing');
        const existing = m.code ? byCode.get(String(m.code).trim().toUpperCase()) : null;
        const code = existing ? existing.code : String(m.code || '').trim().toUpperCase() || (department ? nextCode(department, pending) : '');
        const doc = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid('t_'), isActive: true, isFrequent: false, isObstetric: false, isDoppler: false, labPanel: null, templateKey: null, tariff: {} };
        Object.assign(doc, { code, name: name || doc.name, department: department || doc.department, shortName: m.shortName !== undefined ? String(m.shortName) : doc.shortName || '', description: m.description !== undefined ? String(m.description) : doc.description || '', tat: m.tat || doc.tat || 'Same Day 4 Hours', isFrequent: yes(m.isFrequent, doc.isFrequent), isActive: yes(m.isActive, doc.isActive !== false) });
        doc.tariff = { standardRate: rate || num(doc.tariff.standardRate), emergencyRate: num(m.emergencyRate) || num(doc.tariff.emergencyRate) || r50(rate * 1.3), b2bRate: num(m.b2bRate) || num(doc.tariff.b2bRate) || r10(rate * 0.8), cghsRate: num(m.cghsRate) || num(doc.tariff.cghsRate) || r10(rate * 0.65) };
        if (!existing && !errors.length) pending.push(doc);
        return { i: i + 1, doc, errors, status: errors.length ? 'error' : existing ? 'update' : 'new', before: existing ? existing.tariff.standardRate : null };
      });
      setRows(out);
      setName(file.name);
    } catch (e) { toast('Could not read the file: ' + e.message, 'error'); }
  };
  const valid = (rows || []).filter((r) => r.status !== 'error');
  const apply = () => {
    valid.forEach((r) => store.put('tests', r.doc));
    logAudit('tariff:imported', 'tests', { file: name, added: valid.filter((r) => r.status === 'new').length, updated: valid.filter((r) => r.status === 'update').length });
    toast(`Imported: ${valid.filter((r) => r.status === 'new').length} new · ${valid.filter((r) => r.status === 'update').length} updated`, 'success');
    onClose();
  };
  return (
    <Modal open size="xl" onClose={onClose} title="Import rate list" subtitle="CSV (Excel) or JSON · existing codes are updated, new codes are added" icon={Upload}
      footer={<><span className="mr-auto text-[12px] text-muted">{rows ? `${rows.length} row(s) · ${valid.length} valid · ${rows.length - valid.length} with errors` : 'Columns: code, name, shortName, department, description, standardRate, emergencyRate, b2bRate, cghsRate, tat, isFrequent, isActive'}</span><Button onClick={onClose}>Cancel</Button><Button icon={Upload} onClick={load}>{rows ? 'Choose another file' : 'Choose file'}</Button>{rows && <Button variant="primary" disabled={!valid.length} onClick={apply}>Import {valid.length}</Button>}</>}>
      {!rows ? <Empty icon={Upload} title="Choose a CSV or JSON file" text="Tip: export the current list first, edit it in Excel, then import it back. Department accepts USG / Pathology / Biochemistry / X-Ray / ECG / Echo." action={<Button variant="primary" icon={Upload} onClick={load}>Choose file</Button>} /> : (
        <div className="max-h-[60vh] overflow-auto rounded-xl border border-line">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-surface2 text-left text-[10.5px] uppercase text-muted"><tr><th className="px-2 py-1.5">#</th><th className="px-2">Status</th><th className="px-2">Code</th><th className="px-2">Name</th><th className="px-2">Dept.</th><th className="px-2 text-right">Rate</th><th className="px-2">Notes</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.i} className="border-t border-line/70">
                  <td className="px-2 py-1">{r.i}</td>
                  <td className="px-2"><Badge tone={r.status === 'new' ? 'emerald' : r.status === 'update' ? 'brand' : 'rose'}>{r.status}</Badge></td>
                  <td className="px-2 font-mono">{r.doc.code}</td><td className="px-2">{r.doc.name}</td><td className="px-2">{r.doc.department}</td>
                  <td className="px-2 text-right tnum">{r.before !== null && r.before !== r.doc.tariff.standardRate ? <span className="text-muted line-through">{inr(r.before)}</span> : null} {inr(r.doc.tariff.standardRate)}</td>
                  <td className="px-2 text-rose-600">{r.errors.join('; ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- PDF rate card
function RateCardModal({ tests, settings, initialDept, onClose }) {
  const [scope, setScope] = useState(initialDept ? 'dept' : 'all');
  const [dept, setDept] = useState(initialDept || 'Ultrasound');
  const [opt, setOpt] = useState({ b2b: false, cghs: false, emergency: false, notes: true });
  const [busy, setBusy] = useState(false);
  const outer = useRef(null);
  const [w, setW] = useState(700);
  const res = useMemo(() => rateCardPages(tests, settings, Object.assign({ scope, dept }, opt)), [tests, settings, scope, dept, opt]);
  useEffect(() => {
    if (!outer.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(outer.current);
    return () => ro.disconnect();
  }, []);
  const k = Math.min(1, Math.max(0.3, (w - 24) / (210 * MM)));
  const title = 'Rate_List_' + (scope === 'dept' ? dept : scope) + '_' + dateKey();
  const print = () => { printHtml({ html: res.html, widthMm: 210, heightMm: 297, title, audit: { action: 'tariff:rate_card_printed', target: 'tests', meta: { scope, dept } } }); };
  const pdf = async () => { setBusy(true); try { await htmlToPdf(res.html, { widthMm: 210, heightMm: 297, filename: title + '.pdf', scale: 1.6, quality: 0.8 }); logAudit('tariff:rate_card_pdf', 'tests', { scope, dept }); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); } };
  return (
    <Modal open size="xl" onClose={onClose} title="PDF rate card" subtitle={`${res.pageCount} A4 page(s) · branded header, department sections, page numbers`} icon={FileDown}
      footer={<><Button onClick={onClose}>Close</Button><Button icon={Printer} onClick={print}>Print</Button><Button variant="primary" icon={FileDown} loading={busy} onClick={pdf}>Download PDF</Button></>}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented value={scope} onChange={setScope} options={[{ value: 'all', label: 'All departments' }, { value: 'dept', label: 'One department' }, { value: 'frequent', label: 'Frequent tests' }]} />
        {scope === 'dept' && <Select className="w-[220px]" value={dept} onChange={(e) => setDept(e.target.value)} options={DEPT_ORDER.map((d) => ({ value: d, label: deptOf(d).label }))} />}
        <Checkbox checked={opt.notes} onChange={(v) => setOpt(Object.assign({}, opt, { notes: v }))} label="Preparation notes" />
        <Checkbox checked={opt.emergency} onChange={(v) => setOpt(Object.assign({}, opt, { emergency: v }))} label="Emergency rates" />
        <Checkbox checked={opt.b2b} onChange={(v) => setOpt(Object.assign({}, opt, { b2b: v }))} label="B2B / referral rates" />
        <Checkbox checked={opt.cghs} onChange={(v) => setOpt(Object.assign({}, opt, { cghs: v }))} label="CGHS rates" />
      </div>
      <div ref={outer} className="ff-preview max-h-[64vh] overflow-y-auto rounded-xl bg-slate-200/70 p-3 dark:bg-slate-950/60">
        <div style={{ width: 210 * MM * k, height: (297 * MM + 18) * res.pageCount * k, margin: '0 auto', position: 'relative' }}>
          <div style={{ width: 210 * MM, transform: `scale(${k})`, transformOrigin: 'top left', position: 'absolute', left: 0, top: 0 }} dangerouslySetInnerHTML={{ __html: res.html }} />
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- patient estimate tray
function EstimateTray({ est, setEst, settings }) {
  const [open, setOpen] = useState(true);
  const items = est.items.map((id) => store.get('tests', id)).filter(Boolean);
  if (!items.length) return null;
  const field = est.field || 'standardRate';
  const total = items.reduce((s, t) => s + rateOf(t, field), 0);
  const disc = Math.min(total, num(est.discount));
  const label = (RATE_FIELDS.find(([k]) => k === field) || [0, 'Standard'])[1];
  const print = (format) => printHtml({ html: estimateHtml({ items: items.map((t) => ({ name: t.name, code: t.code, department: t.department, rate: rateOf(t, field) })), discount: disc, rateLabel: label, format, patient: est.patient }, settings), widthMm: format === 'thermal' ? 80 : 148, heightMm: format === 'thermal' ? 'auto' : 210, title: 'Estimate', audit: { action: 'tariff:estimate_printed', target: 'tests', meta: { items: items.length, total: total - disc } } });
  const toBill = () => {
    lsSet('ssdc-pref:billing-estimate', { at: Date.now(), items: items.map((t) => ({ testId: t.id, code: t.code, name: t.name, department: t.department, rate: rateOf(t, field), amount: rateOf(t, field) })), discount: disc, patientName: est.patient || '' });
    navigate('/billing', { estimate: Date.now() });
  };
  return (
    <div className="fixed bottom-20 right-3 z-40 w-[min(380px,calc(100vw-1.5rem))] rounded-2xl border border-brand-300 bg-surface shadow-pop lg:bottom-4">
      <button className="flex w-full items-center gap-2 rounded-t-2xl bg-brand-600 px-3 py-2 text-left text-white" onClick={() => setOpen(!open)}>
        <Calculator className="h-4 w-4" /><b className="flex-1">Patient estimate · {items.length} test(s)</b><span className="font-display text-lg font-extrabold tnum">{inr(total - disc)}</span>{open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>
      {open && (
        <div className="space-y-2 p-3">
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {items.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-[12.5px]">
                <DeptIcon dept={t.department} color={deptOf(t.department).hex} />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="tnum">{inr(rateOf(t, field))}</span>
                <button className="text-muted hover:text-rose-600" title="Remove" onClick={() => setEst(Object.assign({}, est, { items: est.items.filter((x) => x !== t.id) }))}><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Rate type"><Select size="sm" value={field} onChange={(e) => setEst(Object.assign({}, est, { field: e.target.value }))} options={RATE_FIELDS.map(([k, l]) => ({ value: k, label: l }))} /></Field>
            <Field label="Discount (₹)"><Input size="sm" inputMode="decimal" value={est.discount || ''} onChange={(e) => setEst(Object.assign({}, est, { discount: e.target.value.replace(/[^\d.]/g, '') }))} /></Field>
            <Field label="Patient (optional)" className="col-span-2"><Input size="sm" value={est.patient || ''} onChange={(e) => setEst(Object.assign({}, est, { patient: e.target.value }))} /></Field>
          </div>
          <div className="flex items-center justify-between border-t border-line pt-2 text-[13px]"><span className="text-muted">Total {inr(total)}{disc ? ' − ' + inr(disc) : ''}</span><b className="font-display text-lg tnum">{inr(total - disc)}</b></div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" icon={Printer} onClick={() => print('a5')}>A5 slip</Button>
            <Button size="sm" icon={Printer} onClick={() => print('thermal')}>80 mm</Button>
            {can('billing:create_invoice') && <Button size="sm" variant="primary" icon={Receipt} onClick={toBill}>Create bill</Button>}
            <Button size="sm" variant="ghost" icon={Trash2} className="ml-auto" onClick={() => setEst({ items: [], field: 'standardRate', discount: 0, patient: '' })}>Clear</Button>
          </div>
        </div>
      )}
    </div>
  );
}
