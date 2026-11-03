// Global "Returning Patient Quick Search": mobile, name, husband/father name, registration ID or token.
import { useMemo, useRef, useState, useEffect } from 'react';
import { Search, UserRound, Phone, Ticket } from 'lucide-react';
import { useColl, navigate, currentRoute, useHotkeys } from '../core/hooks';
import { dateKey, fmtDate, digits, fullName, guardianLine, ageSex } from '../core/utils';
import { cx, MicButton, Badge } from '../components/ui';

export function searchPatients(patients, visits, q, limit = 12) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return [];
  const dq = digits(s);
  const today = dateKey();
  const tokenHits = new Map();
  visits.forEach((v) => {
    if (v.dateKey !== today) return;
    Object.values(v.tokens || {}).forEach((t) => { if (String(t).toLowerCase() === s || String(t).toLowerCase().replace('-', '') === s.replace('-', '')) tokenHits.set(v.patientId, t); });
  });
  const scored = [];
  for (const p of patients) {
    let score = 0;
    const name = String(p.name || '').toLowerCase();
    const g = String(p.guardianName || '').toLowerCase();
    if (tokenHits.has(p.id)) score += 200;
    if (dq.length >= 3 && String(p.mobile || '').includes(dq)) score += String(p.mobile) === dq ? 150 : 90;
    if (p.regId && p.regId.toLowerCase().includes(s)) score += 120;
    if (name.startsWith(s)) score += 80; else if (name.includes(s)) score += 50;
    else if (s.split(/\s+/).every((w) => name.includes(w))) score += 40;
    if (g.includes(s)) score += 30;
    if (score) scored.push({ p, score: score + Math.min(20, (p.visitCount || 0) * 2), token: tokenHits.get(p.id) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function openPatient(p) {
  const r = currentRoute();
  const sec = r.parts[0];
  const target = { billing: '/billing', report: '/report', formf: '/formf', lab: '/lab' }[sec] || '/register';
  navigate(target, { patient: p.id });
}

export function PatientSearch() {
  const patients = useColl('patients');
  const visits = useColl('visits');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef(null);
  const box = useRef(null);
  const results = useMemo(() => searchPatients(patients, visits, q), [patients, visits, q]);
  useHotkeys({ 'ctrl+shift+f': () => inputRef.current && inputRef.current.focus(), f3: () => inputRef.current && inputRef.current.focus() }, []);
  useEffect(() => {
    const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const pick = (r) => { openPatient(r.p); setOpen(false); setQ(''); inputRef.current && inputRef.current.blur(); };
  return (
    <div ref={box} className="relative w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(results.length - 1, h + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          else if (e.key === 'Enter' && results[hi]) { e.preventDefault(); pick(results[hi]); }
          else if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur(); }
        }}
        aria-label="Returning patient quick search"
        placeholder="Search patient: mobile, name, husband/father, Reg. ID or token (F3)"
        className="h-9 w-full rounded-full border border-line bg-surface2 pl-9 pr-10 text-[13px] text-ink placeholder:text-muted/70 focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/25" />
      <span className="absolute right-1.5 top-1/2 -translate-y-1/2"><MicButton target={inputRef} size="sm" title="Voice search" /></span>
      {open && q.trim() && (
        <div className="absolute left-0 z-50 mt-1.5 max-h-[70vh] w-[min(600px,calc(100vw-1rem))] overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-pop">
          {!results.length && <div className="px-3 py-4 text-center text-xs text-muted">No returning patient matches “{q}”. Register as a new patient.</div>}
          {results.map((r, i) => (
            <button key={r.p.id} type="button" onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(r); }}
              className={cx('flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left', i === hi && 'bg-brand-50 dark:bg-brand-950/50')}>
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface2 text-muted"><UserRound className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{fullName(r.p)}</span><span className="text-[11px] text-muted">{ageSex(r.p)}</span></span>
                <span className="block truncate text-[11.5px] text-muted">{guardianLine(r.p)} · {r.p.address}</span>
              </span>
              <span className="hidden shrink-0 flex-col items-end gap-0.5 sm:flex">
                <span className="flex items-center gap-1 text-[11px] text-muted tnum"><Phone className="h-3 w-3" />{r.p.mobile || '—'}</span>
                <span className="flex items-center gap-1">
                  {r.token && <Badge tone="emerald" icon={Ticket}>{r.token}</Badge>}
                  <Badge tone="brand">{r.p.regId}</Badge>
                </span>
                {r.p.lastVisitAt && <span className="text-[10px] text-muted">Last visit {fmtDate(r.p.lastVisitAt)} · {r.p.visitCount || 1} visit(s)</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
