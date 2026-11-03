// Staff sign-in: role tiles (Radiologist, Pathologist, Lab Tech, Reception desks, Auditor) + password.
import { useEffect, useRef, useState } from 'react';
import { LogIn, ShieldCheck, Wifi, HardDrive, Stethoscope, Microscope, FlaskConical, Receipt, Eye } from 'lucide-react';
import { login, loginTiles, switchUser } from '../core/auth';
import { useNet } from '../core/sync';
import { cx, Button, Input, toast } from '../components/ui';
import { brandSvg } from '../components/dept';
import perms from '../../../shared/permissions';

const ICON = { SUPER_ADMIN_RADIOLOGIST: Stethoscope, CONSULTANT_PATHOLOGIST: Microscope, LAB_TECHNICIAN: FlaskConical, RECEPTION_BILLING: Receipt, AUDITOR_VIEW_ONLY: Eye };

export function Login() {
  const net = useNet();
  const [tiles, setTiles] = useState(null);
  const [sel, setSel] = useState(null);
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pref = useRef(null);
  useEffect(() => { loginTiles().then(setTiles).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { if (sel && pref.current) pref.current.focus(); }, [sel]);
  const submit = async (e) => {
    if (e) e.preventDefault();
    if (!sel) return;
    setBusy(true); setErr('');
    try { await login(sel.id, pwd); } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };
  const quick = async (u) => { try { await switchUser(u.id); } catch (ex) { toast(ex.message, 'error'); } };
  const users = (tiles && tiles.users) || [];
  return (
    <div className="min-h-full bg-gradient-to-br from-navy-950 via-navy-900 to-brand-900 px-4 py-8 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center gap-4">
          <span dangerouslySetInnerHTML={{ __html: brandSvg(56) }} />
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">Shiv Sonography and Diagnostic Center</h1>
            <p className="text-sm text-slate-300">Opposite SDH Hospital, Gate No. 2, Jobner Road, Phulera, Jaipur · Clinic Suite</p>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <h2 className="mb-3 text-[12px] font-bold uppercase tracking-[0.15em] text-slate-400">Select your profile</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {users.map((u) => {
                const I = ICON[u.role] || ShieldCheck;
                const on = sel && sel.id === u.id;
                return (
                  <button key={u.id} onClick={() => { setSel(u); setErr(''); }}
                    className={cx('flex items-start gap-3 rounded-2xl border p-4 text-left transition', on ? 'border-brand-400 bg-white/15 ring-2 ring-brand-400/50' : 'border-white/10 bg-white/5 hover:border-white/30 hover:bg-white/10')}>
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10"><I className="h-5 w-5 text-brand-200" /></span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{u.name}</span>
                      <span className="block truncate text-xs text-slate-300">{(perms.ROLES[u.role] || {}).label}</span>
                      {u.registrationNumber && <span className="block truncate text-[11px] text-slate-400">{u.registrationNumber}</span>}
                    </span>
                  </button>
                );
              })}
              {!tiles && !err && <div className="text-sm text-slate-400">Loading staff profiles…</div>}
            </div>
          </div>
          <form onSubmit={submit} className="rounded-2xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur">
            <div className="mb-4 flex items-center gap-2 text-xs text-slate-300">
              {net.mode === 'server' ? <><Wifi className="h-4 w-4 text-emerald-300" /> Connected to clinic LAN server</> : <><HardDrive className="h-4 w-4" /> Standalone mode (this browser)</>}
            </div>
            <div className="mb-1 text-sm font-semibold">{sel ? sel.name : 'Choose a profile'}</div>
            <div className="mb-4 text-xs text-slate-400">{sel ? (perms.ROLES[sel.role] || {}).description : 'Role-based access: each staff member sees only the modules their role allows.'}</div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Password</label>
            <Input ref={pref} type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} disabled={!sel} placeholder="••••" className="border-white/20 bg-white/10 text-white placeholder:text-slate-500" />
            {sel && sel.usesDefaultPassword && <p className="mt-1.5 text-[11px] text-amber-300">First-time setup: default password is <b>1234</b> — change it after signing in.</p>}
            {err && <p className="mt-2 text-sm text-rose-300">{err}</p>}
            <Button type="submit" variant="primary" size="lg" icon={LogIn} loading={busy} disabled={!sel} className="mt-4 w-full">Sign in</Button>
            {tiles && tiles.devRoleSwitcher && sel && (
              <button type="button" onClick={() => quick(sel)} className="mt-3 w-full rounded-lg border border-dashed border-amber-400/60 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-400/10">
                DEV Role Switcher: enter as {sel.name} without password
              </button>
            )}
            <p className="mt-5 text-[11px] leading-4 text-slate-400">All actions are recorded in the clinical audit trail (PC-PNDT Form F, signed reports, discounts, refunds).</p>
          </form>
        </div>
      </div>
    </div>
  );
}
