// Session security on every workstation:
//  • idle lock — after Settings → security.idleLockMinutes without keyboard / mouse / touch / dictation
//    (adminIdleMinutes on the Admin Console and Settings) the screen locks and hides patient data; the
//    same password unlocks it, so open work is kept. A 30-second warning comes first.
//  • after signOutAfterLockMinutes locked, the workstation signs out.
//  • the waiting-hall TV display never locks.
//  • sensitive admin actions ask for the password again (server answers REAUTH_REQUIRED).
// The lock survives a page reload, and activity in another tab of the same workstation counts.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, LogOut, ShieldCheck, KeyRound, Clock } from 'lucide-react';
import { useAuth, logout, confirmPassword, logAudit } from '../core/auth';
import { useSettings, useRoute, useEvent } from '../core/hooks';
import { setReauthHandler } from '../core/sync';
import { Button, Input, Modal } from '../components/ui';
import { lsGet, lsSet, fmtTime } from '../core/utils';
import { stopVoice, voiceState } from '../core/voice';

const LOCK_KEY = 'ssdc-lock';
const LAST_KEY = 'ssdc-last-active';
const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'];
const ADMIN_PATHS = /^\/(admin|settings)\b/;

const exempt = () => !!document.querySelector('.tv-root'); // waiting-hall TV display
const readLock = (userId) => { const l = lsGet(LOCK_KEY, null); return l && l.userId === userId ? l : null; };
const sharedLast = () => { try { return Number(localStorage.getItem(LAST_KEY)) || 0; } catch (e) { return 0; } };

export function IdleGuard() {
  const { principal } = useAuth();
  const settings = useSettings();
  const route = useRoute();
  const sec = Object.assign({ idleLockMinutes: 15, adminIdleMinutes: 5, signOutAfterLockMinutes: 60 }, settings.security || {});
  const [lock, setLock] = useState(() => (principal ? readLock(principal.id) : null));
  const [warn, setWarn] = useState(0);
  const last = useRef(Date.now());

  const touch = useCallback(() => {
    const now = Date.now();
    if (now - last.current < 1000) return;
    last.current = now;
    try { localStorage.setItem(LAST_KEY, String(now)); } catch (e) { /* private mode */ }
  }, []);

  useEffect(() => {
    if (lock) return undefined;
    const on = () => touch();
    ACTIVITY.forEach((ev) => window.addEventListener(ev, on, { passive: true, capture: true }));
    window.addEventListener('ssdc-activity', on);
    return () => { ACTIVITY.forEach((ev) => window.removeEventListener(ev, on, { capture: true })); window.removeEventListener('ssdc-activity', on); };
  }, [lock, touch]);

  const doLock = useCallback((reason, minutes) => {
    if (!principal) return;
    const l = { userId: principal.id, at: Date.now(), reason, minutes: minutes || 0 };
    lsSet(LOCK_KEY, l);
    setLock(l);
    setWarn(0);
    logAudit('auth:session_locked', 'users/' + principal.id, { reason, minutes: minutes || 0, route: location.hash.slice(1, 60) });
  }, [principal]);
  useEvent('session:lock', () => doLock('manual'));
  // a locked workstation must not keep listening
  useEffect(() => { if (lock && voiceState().on) stopVoice(); }, [lock]);
  // another tab of this workstation locked / unlocked
  useEffect(() => {
    const on = (e) => { if (e.key === LOCK_KEY && principal) setLock(readLock(principal.id)); };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, [principal]);

  const limitMin = ADMIN_PATHS.test(route.path || '') && Number(sec.adminIdleMinutes) > 0
    ? Math.min(Number(sec.adminIdleMinutes), Number(sec.idleLockMinutes) || Infinity)
    : Number(sec.idleLockMinutes) || 0;

  useEffect(() => {
    if (!principal) return undefined;
    const t = setInterval(() => {
      if (lock) {
        const off = Number(sec.signOutAfterLockMinutes) || 0;
        if (off && Date.now() - lock.at > off * 60000) {
          logAudit('auth:session_timeout', 'users/' + principal.id, { lockedFor: Math.round((Date.now() - lock.at) / 60000) });
          lsSet(LOCK_KEY, null);
          logout();
        }
        return;
      }
      if (exempt()) { touch(); return; }
      if (!limitMin) { if (warn) setWarn(0); return; }
      const idle = Date.now() - Math.max(last.current, sharedLast());
      const left = limitMin * 60000 - idle;
      if (left <= 0) doLock('idle', limitMin);
      else if (left <= 30000) setWarn(Math.ceil(left / 1000));
      else if (warn) setWarn(0);
    }, 1000);
    return () => clearInterval(t);
  }, [principal, lock, limitMin, warn, sec.signOutAfterLockMinutes, doLock, touch]);

  // password re-confirmation for sensitive admin actions
  const [reauth, setReauth] = useState(null);
  useEffect(() => {
    setReauthHandler((info) => new Promise((resolve, reject) => setReauth({ resolve, reject, minutes: info && info.minutes })));
    return () => setReauthHandler(null);
  }, []);

  if (!principal) return null;
  return (
    <>
      {warn > 0 && !lock && (
        <div role="alert" className="fixed inset-x-0 top-0 z-[150] flex items-center justify-center gap-3 bg-amber-500 px-3 py-2 text-[13px] font-semibold text-amber-950 shadow-pop">
          <Clock className="h-4 w-4" />Screen locks in {warn} s for patient privacy — move the mouse or press a key to stay signed in
        </div>
      )}
      {lock && <LockScreen lock={lock} principal={principal} signOutMin={Number(sec.signOutAfterLockMinutes) || 0} onUnlocked={() => { lsSet(LOCK_KEY, null); setLock(null); last.current = Date.now(); touch(); }} />}
      {reauth && <ReauthModal info={reauth} principal={principal} onDone={() => setReauth(null)} />}
    </>
  );
}

function LockScreen({ lock, principal, signOutMin, onUnlocked }) {
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const unlock = async (e) => {
    e.preventDefault();
    if (!pwd) return;
    setBusy(true); setErr('');
    try { await confirmPassword(pwd, 'unlock'); onUnlocked(); } catch (ex) {
      // the server session itself ended (e.g. after the working-day limit): sign in again
      if (ex.status === 401 && !(ex.data && ex.data.code === 'CONFIRM_FAILED')) { lsSet(LOCK_KEY, null); logout(); return; }
      setErr(ex.message || 'Incorrect password'); setPwd('');
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/95 p-4 backdrop-blur-xl" role="dialog" aria-modal="true" aria-label="Workstation locked">
      <form onSubmit={unlock} className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6 text-white shadow-2xl">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600/30 text-brand-200"><Lock className="h-7 w-7" /></div>
        <h2 className="text-center font-display text-xl font-extrabold">Workstation locked</h2>
        <p className="mt-1 text-center text-[13px] text-slate-300">{lock.reason === 'manual' ? 'Locked' : 'Locked after ' + lock.minutes + ' min without activity'} at {fmtTime(lock.at)} · open work is kept</p>
        <div className="mt-5 rounded-xl bg-white/5 px-3 py-2 text-center">
          <div className="font-semibold">{principal.name}</div>
          <div className="text-[12px] text-slate-400">{principal.roleLabel}</div>
        </div>
        <label className="mt-4 block text-[12px] font-semibold text-slate-300" htmlFor="unlock-pwd">Password</label>
        <Input id="unlock-pwd" type="password" autoFocus autoComplete="current-password" value={pwd} onChange={(e) => setPwd(e.target.value)} className="mt-1" aria-label="Password to unlock" />
        {err && <div className="mt-2 text-[12.5px] font-semibold text-rose-300" role="alert">{err}</div>}
        <Button type="submit" variant="primary" icon={ShieldCheck} loading={busy} className="mt-4 w-full">Unlock</Button>
        <button type="button" onClick={() => { lsSet(LOCK_KEY, null); logout(); }} className="mt-3 flex w-full items-center justify-center gap-1.5 text-[12.5px] font-semibold text-slate-300 hover:text-white"><LogOut className="h-3.5 w-3.5" />Sign out / switch user</button>
        {signOutMin > 0 && <p className="mt-3 text-center text-[11px] text-slate-500">Signs out automatically {signOutMin} min after locking</p>}
      </form>
    </div>
  );
}

function ReauthModal({ info, principal, onDone }) {
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const cancel = () => { info.reject(new Error('Password confirmation cancelled')); onDone(); };
  const ok = async () => {
    if (!pwd) return;
    setBusy(true); setErr('');
    try { await confirmPassword(pwd, 'reauth'); info.resolve(); onDone(); } catch (ex) { setErr(ex.message || 'Incorrect password'); setPwd(''); } finally { setBusy(false); }
  };
  return (
    <Modal open size="sm" onClose={cancel} title="Confirm it’s you" icon={KeyRound} subtitle={'Sensitive admin change · ' + principal.name}
      footer={<><Button onClick={cancel}>Cancel</Button><Button variant="primary" icon={ShieldCheck} loading={busy} onClick={ok}>Confirm</Button></>}>
      <p className="text-[13px] text-muted">Changes to staff, roles, credentials, integrations, report unlocks and audit exports need your password again{info.minutes ? ' (valid for ' + info.minutes + ' min)' : ''}.</p>
      <Input type="password" autoFocus autoComplete="current-password" className="mt-3" value={pwd} onChange={(e) => setPwd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ok(); }} aria-label="Your password" />
      {err && <div className="mt-2 text-[12.5px] font-semibold text-rose-600" role="alert">{err}</div>}
    </Modal>
  );
}
