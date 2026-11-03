// Live queue page + waiting-hall TV display. Calls are recorded on the visit, so every workstation and
// the TV show the same "now calling" token with the patient's full name and department (English & Hindi,
// with the room), the recently called tokens, and for every test room the waiting patients in order with
// how many are ahead of each and an estimated wait from the room's average procedure time.
// The TV shows only the departments chosen in Settings → Rooms (Ultrasound / Sonography by default):
// other departments' queues, calls and announcements stay off the waiting-hall screen.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ListOrdered, Tv, Megaphone, Clock, CheckCircle2, Loader, Timer, Receipt } from 'lucide-react';
import { useEvent, useNow, useLocalPref, useSettings, useColl } from '../../core/hooks';
import { dateKey, fmtTime } from '../../core/utils';
import { visitOverall, recentCalls, waitStats, waitInfo, fmtWait, waitTone, callToken, DEPT_NAME, DEPT_NAME_HI, deptRoom, procedureMinutes, roomBoard, fmtEstimate, DEFAULT_PROC_MIN, tvDepartments, showWaitTimes, tvShowEstimates } from '../../core/clinic';
import { cx, Card, Button, Input, Kpi, PageHeader, toast } from '../../components/ui';
import { QueueList, useTodayQueue } from './QueueList';

const ORDER = ['USG', 'LAB', 'XRAY', 'ECG', 'ECHO'];

function announce(call, settings, hindi, withName) {
  try {
    if (!window.speechSynthesis) return;
    const tok = String(call.token).replace('-', ' ').replace(/\b0(\d)\b/, '$1');
    const room = deptRoom(call.modality, settings);
    const who = withName && call.name ? ', ' + call.name : '';
    const en = new SpeechSynthesisUtterance('Token ' + tok + who + ', please proceed to ' + (DEPT_NAME[call.modality] || 'the counter') + (room ? ', ' + room : '') + '.');
    en.lang = 'en-IN';
    window.speechSynthesis.speak(en);
    if (hindi) {
      const hi = new SpeechSynthesisUtterance('टोकन ' + tok + who + ', कृपया ' + (DEPT_NAME_HI[call.modality] || 'काउंटर') + ' पर पधारें।');
      hi.lang = 'hi-IN';
      window.speechSynthesis.speak(hi);
    }
  } catch (e) { /* speech unavailable */ }
}

const ROWS_PER_ROOM = 8;

/**
 * Every test room's line-up, packed in balanced columns; rooms with nobody waiting or inside collapse
 * into one line. If the rooms still do not fit the screen the panel turns pages every 12 seconds.
 */
function RoomBoards({ mods, queue, proc, now, settings, showNames, emptyText = 'The queue is empty.' }) {
  const showEst = tvShowEstimates(settings);
  const box = useRef(null);
  useEffect(() => {
    const t = setInterval(() => {
      const el = box.current;
      if (!el || el.scrollHeight <= el.clientHeight + 4) return;
      const next = el.scrollTop + el.clientHeight >= el.scrollHeight - 4 ? 0 : el.scrollTop + el.clientHeight * 0.9;
      el.scrollTo({ top: next, behavior: 'smooth' });
    }, 12000);
    return () => clearInterval(t);
  }, []);
  const boards = mods.map((m) => {
    const avg = (proc[m] || {}).minutes || DEFAULT_PROC_MIN[m] || 10;
    return { m, avg, b: roomBoard(queue, m, avg, now) };
  });
  const active = boards.filter((x) => x.b.waiting.length || x.b.inside.length);
  const idle = boards.filter((x) => !x.b.waiting.length && !x.b.inside.length);
  // one room on the screen (e.g. the TV shows Ultrasound only) has the whole panel: list more patients
  const rows = active.length <= 1 ? ROWS_PER_ROOM + 2 : ROWS_PER_ROOM;
  return (
    <div ref={box} className="tv-rooms min-h-0 overflow-hidden">
      <div className={cx(active.length > 1 && 'xl:columns-2', 'gap-5')}>
        {active.map(({ m, avg, b }) => {
          const room = deptRoom(m, settings);
          return (
            <section key={m} className="tv-room mb-5 break-inside-avoid rounded-3xl border border-white/15 bg-white/[0.05] p-5" aria-label={DEPT_NAME[m] + ' queue'}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <div className="min-w-0">
                  <div className="font-display text-[clamp(22px,2vw,32px)] font-extrabold leading-tight">{DEPT_NAME[m]}</div>
                  <div className="text-lg text-sky-100">{DEPT_NAME_HI[m]}{room ? ' · ' + room : ''}</div>
                </div>
                <div className="text-right">
                  <div className="whitespace-nowrap text-xl font-semibold text-slate-100 tnum">{b.waiting.length} waiting</div>
                  {showEst && <div className="whitespace-nowrap text-sm text-slate-400">about {avg} min per patient</div>}
                </div>
              </div>
              {b.inside.length > 0 && (
                <div className="mt-3 rounded-xl bg-emerald-400/15 px-4 py-2 text-lg text-emerald-100">
                  In the room now: <b className="tnum">{b.inside.map((x) => x.token).join(', ')}</b>{showNames ? ' · ' + b.inside.map((x) => x.name).join(', ') : ''}
                </div>
              )}
              {b.waiting.length ? (
                <table className="tv-lineup mt-3 w-full table-fixed border-separate border-spacing-y-1.5 text-left">
                  {/* the wait column fits its longest estimate ("≈ 1 h 45 min") at the row font size */}
                  <colgroup><col style={{ width: (Math.max(5, ...b.waiting.map((x) => String(x.token).length)) * 0.84 + 1.4).toFixed(1) + 'em' }} />{showNames && <col />}<col style={{ width: !showNames ? 'auto' : 'calc(' + (showEst ? Math.max(6, ...b.waiting.slice(0, rows).map((x) => (x.called ? 'Now' : fmtEstimate(x.estMin)).length)) * 0.62 + 1.7 : 7).toFixed(2) + ' * clamp(16px, 1.2vw, 22px))' }} /></colgroup>
                  <thead><tr className="text-[13px] uppercase tracking-[0.12em] text-slate-400"><th className="px-3 font-semibold">Token</th>{showNames && <th className="px-2 font-semibold">Patient</th>}<th className="px-3 text-right font-semibold">{showEst ? 'Wait' : 'Status'}</th></tr></thead>
                  <tbody>
                    {b.waiting.slice(0, rows).map((x, i) => (
                      <tr key={x.token} className={cx('text-[clamp(16px,1.2vw,22px)]', x.called ? 'bg-amber-300/25' : i === 0 ? 'bg-amber-300/10' : 'bg-white/[0.07]')}>
                        <td className="whitespace-nowrap rounded-l-xl px-3 py-2 align-top font-display font-extrabold tnum">{x.token}</td>
                        {showNames && <td className="break-words px-2 py-2 align-top font-semibold leading-tight">{x.name}</td>}
                        <td className="rounded-r-xl px-3 py-1.5 text-right align-top leading-tight">
                          {(showEst || x.called) && <div className={cx('whitespace-nowrap font-bold tnum', x.called ? 'text-amber-200' : x.estMin >= 45 ? 'text-rose-300' : x.estMin >= 20 ? 'text-amber-200' : 'text-emerald-200')}>{x.called ? 'Now' : fmtEstimate(x.estMin)}</div>}
                          {(showEst || x.called) && <div className="whitespace-nowrap text-[0.72em] text-slate-300 tnum">{x.called ? 'please go in' : x.ahead === 0 ? 'next in line' : x.ahead + ' ahead'}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="mt-3 text-lg text-slate-400">No one waiting</div>}
              {b.waiting.length > rows && <div className="mt-1 text-lg text-slate-300">+{b.waiting.length - rows} more waiting</div>}
            </section>
          );
        })}
      </div>
      {idle.length > 0 && <div className="rounded-2xl border border-white/10 px-5 py-3 text-lg text-slate-300">No one waiting: {idle.map((x) => DEPT_NAME[x.m]).join(' · ')}</div>}
      {!mods.length && <div className="text-2xl text-slate-300">{emptyText}</div>}
    </div>
  );
}

function TvDisplay({ queue, onExit }) {
  const settings = useSettings();
  const allVisits = useColl('visits');
  const now = useNow(1000);
  const [showNames, setShowNames] = useLocalPref('tv-show-names', true);
  const [hindi, setHindi] = useLocalPref('tv-hindi', true);
  const [live, setLive] = useState(null);
  const [flash, setFlash] = useState(false);
  const spoken = useRef(null);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onExit(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onExit]);
  // only the departments chosen for the TV (Ultrasound / Sonography by default)
  const shownKey = tvDepartments(settings).join(',');
  const shown = useMemo(() => new Set(shownKey.split(',')), [shownKey]);
  // a call from another workstation arrives as an event before its visit record syncs
  useEvent('queue:call', (d) => { if (d && d.token && shown.has(d.modality || 'combined')) setLive(Object.assign({}, d, { modality: d.modality || 'combined' })); });
  // average procedure time per room (measured over 14 days, or the minutes set in Settings)
  const proc = useMemo(() => procedureMinutes(allVisits, settings, now), [allVisits, settings, Math.floor(now / 60000)]); // eslint-disable-line react-hooks/exhaustive-deps

  const calls = recentCalls(queue, 60).filter((c) => shown.has(c.modality)).slice(0, 9);
  const current = [live, calls[0]].filter(Boolean).sort((a, b) => b.at - a.at)[0] || null;
  const recent = calls.filter((c) => !current || c.at !== current.at || c.token !== current.token).slice(0, 5);
  useEffect(() => {
    if (!current) return undefined;
    if (spoken.current === null) { spoken.current = current.at; return undefined; } // don't re-announce old calls on open
    if (current.at <= spoken.current) return undefined;
    spoken.current = current.at;
    announce(current, settings, hindi, showNames);
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 5000);
    return () => clearTimeout(t);
  }, [current && current.at]); // eslint-disable-line react-hooks/exhaustive-deps

  const mods = ORDER.filter((m) => shown.has(m) && queue.some((v) => v.tokens && v.tokens[m]));
  const deptTitle = ORDER.filter((m) => shown.has(m)).map((m) => DEPT_NAME[m]).join(' · ');
  return (
    <div className="tv-root fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#071826] p-6 text-white">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="font-display text-3xl font-extrabold">{settings.clinic.name}</div>
          <div className="text-lg text-sky-200">{deptTitle} · कृपया अपने टोकन की प्रतीक्षा करें</div>
        </div>
        <div className="flex items-center gap-5">
          <div className="hidden flex-col gap-1.5 md:flex">
            <button type="button" onClick={() => setShowNames(!showNames)} aria-pressed={showNames} className="rounded-lg border border-white/20 px-2.5 py-1 text-left text-xs text-slate-200 hover:bg-white/10">Patient names: <b>{showNames ? 'shown' : 'hidden'}</b></button>
            <button type="button" onClick={() => setHindi(!hindi)} aria-pressed={hindi} className="rounded-lg border border-white/20 px-2.5 py-1 text-left text-xs text-slate-200 hover:bg-white/10">Hindi announcement: <b>{hindi ? 'on' : 'off'}</b></button>
          </div>
          <div className="text-right">
            <div className="font-display text-5xl font-extrabold tnum">{new Date(now).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
            <div className="text-sm text-slate-300">{new Date(now).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · <button className="underline" onClick={onExit}>Exit (Esc)</button></div>
          </div>
        </div>
      </header>

      <div className="mt-6 grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
        <div className="flex min-h-0 flex-col gap-6">
          <section className={cx('tv-now flex flex-col items-center justify-center rounded-3xl border p-6 text-center', flash ? 'tv-flash border-amber-300 bg-amber-300/15' : 'border-white/15 bg-white/[0.06]')} aria-live="assertive">
            <div className="flex items-center gap-2 text-lg font-semibold uppercase tracking-[0.25em] text-amber-200"><Megaphone className="h-6 w-6" />Now calling · अब बुलाया जा रहा है</div>
            {current ? (
              <>
                <div className="my-2 whitespace-nowrap font-display text-[clamp(60px,7.5vw,150px)] font-black leading-none tracking-tight text-amber-300 tnum">{current.token}</div>
                {showNames && current.name && <div className="tv-called-name max-w-full break-words font-display text-[clamp(30px,3.6vw,64px)] font-extrabold leading-tight text-white">{current.name}</div>}
                <div className="mt-2 font-display text-[clamp(22px,2.4vw,38px)] font-bold leading-tight text-sky-50">{DEPT_NAME[current.modality] || 'Reception'}</div>
                <div className="mt-1 text-[clamp(18px,1.9vw,28px)] text-sky-200">{DEPT_NAME_HI[current.modality] || ''}{deptRoom(current.modality, settings) ? ' · ' + deptRoom(current.modality, settings) : ''}</div>
              </>
            ) : <div className="my-10 text-2xl text-slate-300">No token called yet</div>}
          </section>
          <section className="min-h-0 flex-1 overflow-hidden rounded-3xl border border-white/15 bg-white/[0.04] p-5">
            <div className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Recently called · पिछले टोकन</div>
            {recent.length ? (
              <ul className="grid gap-2">
                {recent.map((c) => (
                  <li key={c.token + c.at} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-xl bg-white/[0.05] px-4 py-2">
                    <span className="whitespace-nowrap font-display text-3xl font-extrabold tnum">{c.token}</span>
                    <span className="min-w-0"><span className="block truncate text-xl font-semibold text-white">{showNames && c.name ? c.name : DEPT_NAME[c.modality] || 'Reception'}</span>{showNames && c.name && <span className="block truncate text-base text-sky-200">{DEPT_NAME[c.modality] || 'Reception'}</span>}</span>
                    <span className="text-lg text-slate-300 tnum">{fmtTime(c.at)}</span>
                  </li>
                ))}
              </ul>
            ) : <div className="text-lg text-slate-400">Called tokens will be listed here.</div>}
          </section>
        </div>

        <RoomBoards mods={mods} queue={queue} proc={proc} now={now} settings={settings} showNames={showNames} emptyText={'No patients waiting for ' + deptTitle + '.'} />
      </div>
    </div>
  );
}

export function QueuePage() {
  const [date, setDate] = useState(dateKey());
  const queue = useTodayQueue(date);
  const todayQueue = useTodayQueue(dateKey());
  const now = useNow(30000);
  const [tv, setTv] = useState(false);
  const settings = useSettings();
  const stats = useMemo(() => {
    const s = { total: queue.length, waiting: 0, progress: 0, done: 0, billed: queue.filter((v) => v.billed).length };
    queue.forEach((v) => { const o = visitOverall(v); if (o === 'Waiting') s.waiting++; else if (o === 'In Scan/Sample') s.progress++; else s.done++; });
    return s;
  }, [queue]);
  const showWaits = showWaitTimes(settings); // off by default: token and patient name only
  const waits = useMemo(() => waitStats(queue, now), [queue, now]);
  const longest = Object.entries(waits).sort((a, b) => b[1].longest - a[1].longest)[0];
  const avgAll = (() => { const r = Object.values(waits); const n = r.reduce((s, x) => s + x.waiting, 0); return n ? Math.round(r.reduce((s, x) => s + x.sum, 0) / n) : 0; })();
  const last = recentCalls(queue, 1)[0];
  const isToday = date === dateKey();
  const nextFor = (m) => queue.filter((v) => v.tokens && v.tokens[m] && waitInfo(v, m, now).status === 'Waiting')
    .sort((a, b) => ((a.calls || []).some((c) => c.modality === m) - (b.calls || []).some((c) => c.modality === m)) || a.createdAt - b.createdAt)[0];
  const callNext = (m) => {
    const v = nextFor(m);
    if (!v) return;
    callToken(v.id, m);
    toast('Calling ' + v.tokens[m] + ' to ' + DEPT_NAME[m], 'success', 2000);
  };
  const mods = ORDER.filter((m) => queue.some((v) => v.tokens && v.tokens[m]));
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Central Live Queue & Tokens" subtitle="Real-time across Reception, USG console, Lab and Bill Desk" icon={ListOrdered}
        actions={<>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" aria-label="Queue date" />
          <Button variant="dark" icon={Tv} onClick={() => { setTv(true); try { document.documentElement.requestFullscreen().catch(() => {}); } catch (e) { /* ignore */ } }}>Waiting-hall TV display</Button>
        </>} />
      <div className={cx('mb-4 grid grid-cols-2 gap-3 md:grid-cols-3', showWaits ? 'xl:grid-cols-6' : 'xl:grid-cols-5')}>
        <Kpi label="Registered" value={stats.total} icon={ListOrdered} />
        <Kpi label="Waiting" value={stats.waiting} icon={Clock} tone="amber" />
        <Kpi label="In scan / sample" value={stats.progress} icon={Loader} tone="brand" />
        <Kpi label="Completed" value={stats.done} icon={CheckCircle2} tone="emerald" />
        {showWaits && <Kpi label="Average wait now" value={fmtWait(avgAll)} sub={longest && longest[1].longest ? 'Longest ' + fmtWait(longest[1].longest) + ' · ' + DEPT_NAME[longest[0]] : 'No one waiting'} icon={Timer} tone={waitTone(avgAll) === 'emerald' ? 'emerald' : 'amber'} />}
        <Kpi label="Billed" value={stats.billed} sub={stats.total - stats.billed + ' not billed yet'} icon={Receipt} tone="violet" />
      </div>
      {isToday && mods.length > 0 && (
        <Card className="mb-4" title="Call the next patient" subtitle={last ? 'Last call ' + last.token + ' · ' + DEPT_NAME[last.modality] + ' at ' + fmtTime(last.at) : 'Calls show on the waiting-hall display and are announced'} icon={Megaphone}>
          <div className="flex flex-wrap gap-2">
            {mods.map((m) => {
              const v = nextFor(m);
              const w = waits[m] || {};
              return (
                <Button key={m} variant={v ? 'primary' : 'secondary'} icon={Megaphone} disabled={!v} onClick={() => callNext(m)}>
                  {DEPT_NAME[m]}{v ? ' · ' + v.tokens[m] : ' · nobody waiting'}{showWaits && v && w.avg ? ' · avg ' + fmtWait(w.avg) : ''}
                </Button>
              );
            })}
          </div>
          {Object.keys((settings.queue || {}).rooms || {}).length === 0 && <p className="mt-2 text-[11.5px] text-muted">Add room names (Room 1, Sample collection…) in Settings → LAN &amp; workstation to show them on the display.</p>}
        </Card>
      )}
      <Card title="Queue" subtitle={'Click a status chip to advance it' + (showWaits ? ' · the coloured time is how long the patient has waited' : '')} padded={false}>
        <div className="h-[calc(100vh-330px)] min-h-[420px]"><QueueList date={date} /></div>
      </Card>
      {tv && <TvDisplay queue={todayQueue} onExit={() => { setTv(false); try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* ignore */ } }} />}
    </div>
  );
}
