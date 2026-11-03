import { useEffect, useState } from 'react';
import {
  LayoutDashboard, UserPlus, ListOrdered, Receipt, ClipboardList, ScanLine, Layers, BookMarked, Microscope, IndianRupee, Wallet,
  PieChart, Send, Cloud, ShieldCheck, Settings as SettingsIcon, Menu as MenuIcon, X, ChevronsLeft, Moon, Sun, LogOut, KeyRound,
  Network, MoreHorizontal, User, ExternalLink, Lock
} from 'lucide-react';
import { useSettings, useEvent, useLocalPref, useMedia } from '../core/hooks';
import { useAuth, can, logout, changePassword } from '../core/auth';
import { useNet, getWorkstationName } from '../core/sync';
import { applyTheme } from '../core/boot-wrapper';
import { lsGet, lsSet } from '../core/utils';
import { cx, IconBtn, Menu, Modal, Button, Input, toast } from '../components/ui';
import { BrandMark } from '../components/dept';
import { PatientSearch } from './PatientSearch';
import { StatusCluster } from './StatusCluster';
import { RoleSwitcher } from './RoleSwitcher';
import { VoiceHUD, VoiceButton, VoicePill } from './VoiceHUD';
import { toggleVoice, stopVoice, resumeVoiceIfWanted } from '../core/voice';
import { IdleGuard } from './IdleGuard';
import { events } from '../core/store';
import { LanConnect } from './LanConnect';
import { WorkstationInbox } from './WorkstationInbox';
import { DispatchHost } from '../modules/dispatch/SendDialog';
import { startCloudMirror } from '../modules/cloud/cloudMirror';

const P = (k, l = 'READ') => [k, l];
export const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Front Desk' },
  { id: 'register', label: 'Patient Registration', short: 'Register', icon: UserPlus, group: 'Front Desk', perm: [P('patient:register_and_edit', 'FULL')] },
  { id: 'queue', label: 'Live Queue & Tokens', short: 'Queue', icon: ListOrdered, group: 'Front Desk', perm: [P('patient:register_and_edit'), P('usg:create_and_edit_report'), P('lab:enter_sample_values', 'DRAFT'), P('billing:create_invoice')] },
  { id: 'billing', label: 'Billing Desk', short: 'Billing', icon: Receipt, group: 'Front Desk', perm: [P('billing:create_invoice')] },
  { id: 'formf', label: 'PC-PNDT Form F', short: 'Form F', icon: ClipboardList, group: 'Clinical', perm: [P('pcpndt:manage_form_f_register', 'DRAFT')] },
  { id: 'report', label: 'USG Reporting', short: 'Reporting', icon: ScanLine, group: 'Clinical', perm: [P('usg:create_and_edit_report')] },
  { id: 'lab', label: 'Pathology Lab', short: 'Lab', icon: Microscope, group: 'Clinical', perm: [P('lab:enter_sample_values', 'DRAFT'), P('lab:verify_and_sign_report')] },
  { id: 'macros', label: 'Templates & Macros', short: 'Macros', icon: Layers, group: 'Clinical', perm: [P('templates:manage_macros')] },
  { id: 'dictionary', label: 'Medical Dictionary', short: 'Dictionary', icon: BookMarked, group: 'Clinical', perm: [P('templates:manage_macros')] },
  { id: 'dispatch', label: 'Dispatch Center', short: 'Dispatch', icon: Send, group: 'Clinical', perm: [P('print:dispatch_signed_reports')] },
  { id: 'tariff', label: 'Tariff Directory', short: 'Tariff', icon: IndianRupee, group: 'Accounts', perm: [P('tariff:manage_rate_list')] },
  { id: 'cashbook', label: 'Daily Cash Book', short: 'Cash Book', icon: Wallet, group: 'Accounts', perm: [P('cashbook:manage_daily_register')] },
  { id: 'accounts', label: 'Accounts & Doctor Sharing', short: 'Accounts', icon: PieChart, group: 'Accounts', perm: [P('finance:doctor_sharing_and_analytics')] },
  { id: 'cloud', label: 'Cloud Sync & Backup', short: 'Cloud', icon: Cloud, group: 'System', perm: [P('settings:manage_clinic_and_integrations', 'FULL')] },
  { id: 'admin', label: 'Admin Console', short: 'Admin', icon: ShieldCheck, group: 'System', perm: [P('admin:manage_roles_and_matrix'), P('admin:view_audit_logs')] },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, group: 'System' }
];
export const navAllowed = (n) => !n.perm || n.perm.some(([k, l]) => can(k, l));

function SideNav({ active, collapsed, onNavigate }) {
  const settings = useSettings();
  const groups = [];
  NAV.filter(navAllowed).forEach((n) => {
    let g = groups.find((x) => x.name === n.group);
    if (!g) groups.push((g = { name: n.group, items: [] }));
    g.items.push(n);
  });
  return (
    <div className="flex h-full flex-col bg-navy-950 text-slate-300">
      <div className={cx('flex items-center gap-2.5 border-b border-white/5 px-3 py-3.5', collapsed && 'justify-center')}>
        <BrandMark logo={settings.clinic.logo} className="h-9 w-9" />
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate font-display text-[13px] font-extrabold leading-tight text-white">Shiv Sonography</div>
            <div className="truncate text-[10.5px] text-slate-400">& Diagnostic Center · Phulera</div>
          </div>
        )}
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {groups.map((g) => (
          <div key={g.name} className="mb-2">
            {!collapsed && <div className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{g.name}</div>}
            {g.items.map((n) => {
              const on = n.id === active;
              return (
                <a key={n.id} href={'#/' + n.id} onClick={() => onNavigate && onNavigate()} title={n.label}
                  className={cx('group mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition', collapsed && 'justify-center',
                    on ? 'bg-brand-600 text-white shadow-sm shadow-brand-900/40' : 'text-slate-300 hover:bg-white/5 hover:text-white')}>
                  <n.icon className={cx('h-[18px] w-[18px] shrink-0', on ? 'text-white' : 'text-slate-400 group-hover:text-brand-300')} />
                  {!collapsed && <span className="truncate">{n.label}</span>}
                </a>
              );
            })}
          </div>
        ))}
      </nav>
      {!collapsed && (
        <div className="border-t border-white/5 px-3 py-2.5 text-[10.5px] leading-4 text-slate-500">
          <div className="truncate">PC-PNDT Reg.: {settings.clinic.pcpndtRegNo}</div>
          <div>v1.0 · {getWorkstationName()}</div>
        </div>
      )}
    </div>
  );
}

function ChangePassword({ open, onClose }) {
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (nw.length < 4) { toast('New password must be at least 4 characters', 'warning'); return; }
    setBusy(true);
    try { await changePassword(cur, nw); toast('Password changed', 'success'); onClose(); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Change password" icon={KeyRound}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <div><span className="label">Current password</span><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoFocus /></div>
        <div><span className="label">New password</span><Input type="password" value={nw} onChange={(e) => setNw(e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export function Shell({ children, active }) {
  const { principal } = useAuth();
  const net = useNet();
  const settings = useSettings();
  const [collapsed, setCollapsed] = useLocalPref('nav-collapsed', false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState(() => lsGet('ssdc-theme', 'light'));
  const [hud, setHud] = useLocalPref('voice-hud', false);
  const [lan, setLan] = useState(false);
  const [pwd, setPwd] = useState(false);
  const wide = useMedia('(min-width: 1024px)');
  const item = NAV.find((n) => n.id === active) || NAV[0];

  useEffect(() => {
    applyTheme(theme);
    lsSet('ssdc-theme', theme);
    if (theme !== 'system' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => applyTheme('system');
    mq.addEventListener('change', follow);
    return () => mq.removeEventListener('change', follow);
  }, [theme]);
  useEvent('theme:set', (t) => setTheme(t));
  useEffect(() => { startCloudMirror(); }, []);
  // each screen opens at its top (the scroll area is shared between screens)
  useEffect(() => { const m = document.getElementById('main'); if (m) m.scrollTop = 0; }, [active]);
  useEvent('voice:toggle', () => setHud((h) => !h));
  // system-wide dictation: F8 or Ctrl+Shift+Space on any screen; back on after a reload if it was on;
  // off when the user signs out (Shell unmounts)
  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat) return;
      if (e.key === 'F8' || (e.code === 'Space' && e.ctrlKey && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); toggleVoice(); }
    };
    window.addEventListener('keydown', onKey, true);
    resumeVoiceIfWanted();
    return () => { window.removeEventListener('keydown', onKey, true); stopVoice(); };
  }, []);
  useEvent('lan:open', () => setLan(true));
  useEvent('patient:registered', (d) => { if (d && d.by !== principal.name) toast(`New registration: ${d.patientName} · ${Object.entries(d.tokens || {}).filter(([k]) => k !== 'combined').map(([, v]) => v).join(', ')}`, 'info'); });
  useEvent('report:completed', (d) => { if (d) toast(`${d.kind === 'lab' ? 'Lab' : 'USG'} report signed: ${d.patientName || ''}`, 'success'); });
  useEvent('notify', (d) => { if (d && d.text) toast(d.text, d.type || 'info'); });
  // the clinic server PC got a new IP from the router: other devices should use the stable .local name
  useEvent('lan:changed', (d) => { if (d) toast('Clinic server network address changed' + (d.urls && d.urls.length ? ' — now ' + d.urls.join(', ') : '') + (d.stableUrl ? '. The stable address ' + d.stableUrl + ' keeps working.' : '. Reserve the server’s IP in the Wi-Fi router (Settings → LAN).'), 'warning', 12000); });

  const bottom = NAV.filter(navAllowed).filter((n) => ['dashboard', 'register', 'billing', 'queue', 'report', 'lab'].includes(n.id)).slice(0, 4);

  return (
    <div className="flex h-full min-h-0">
      {wide && (
        <aside className={cx('h-full shrink-0 transition-all print:hidden', collapsed ? 'w-[64px]' : 'w-[236px]')}>
          <SideNav active={active} collapsed={collapsed} />
        </aside>
      )}
      {!wide && mobileOpen && (
        <div className="fixed inset-0 z-[90] flex bg-slate-900/50" onClick={() => setMobileOpen(false)}>
          <aside className="h-full w-[270px] max-w-[85vw]" onClick={(e) => e.stopPropagation()}>
            <SideNav active={active} collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
          <button className="m-3 h-9 w-9 rounded-full bg-white/90 text-slate-700" onClick={() => setMobileOpen(false)}><X className="m-auto h-5 w-5" /></button>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/95 px-2 backdrop-blur sm:px-3 print:hidden">
          {wide
            ? <IconBtn icon={collapsed ? MenuIcon : ChevronsLeft} title={collapsed ? 'Expand menu' : 'Collapse menu'} onClick={() => setCollapsed(!collapsed)} />
            : <IconBtn icon={MenuIcon} title="Menu" onClick={() => setMobileOpen(true)} />}
          <div className="hidden min-w-0 items-center gap-2 md:flex">
            <item.icon className="h-[18px] w-[18px] text-brand-600" />
            <span className="truncate font-display text-[15px] font-bold">{item.label}</span>
          </div>
          <div className="mx-auto w-full min-w-0 max-w-xl flex-1"><PatientSearch /></div>
          <StatusCluster net={net} onLan={() => setLan(true)} />
          <VoiceButton panelOpen={hud} onPanel={() => setHud(!hud)} />
          <IconBtn icon={theme === 'dark' ? Sun : Moon} title="Toggle dark / light mode" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="hidden sm:inline-flex" />
          {settings.ui.devRoleSwitcher !== false && <RoleSwitcher />}
          <Menu width="w-64" trigger={
            <button className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface2" title={principal.name}>
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-teal-500 text-xs font-bold text-white">{principal.name.replace(/^Dr\.?\s*/, '').split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
              <span className="hidden min-w-0 text-left xl:block"><span className="block max-w-[140px] truncate text-[12.5px] font-semibold leading-4">{principal.name}</span><span className="block text-[10.5px] leading-4 text-muted">{principal.roleShort}</span></span>
            </button>
          } items={[
            { header: principal.roleLabel },
            { label: principal.registrationNumber || principal.designation || 'Staff', icon: User, disabled: true },
            { divider: true },
            { label: 'LAN / Workstation connect', icon: Network, onClick: () => setLan(true) },
            { label: 'Open in new window', icon: ExternalLink, onClick: () => window.open(location.href, '_blank') },
            { label: theme === 'dark' ? 'Light mode' : 'Dark mode', icon: theme === 'dark' ? Sun : Moon, onClick: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
            { label: 'Change password', icon: KeyRound, onClick: () => setPwd(true) },
            { label: 'Lock screen', icon: Lock, onClick: () => events.emit('session:lock') },
            { divider: true },
            { label: 'Sign out', icon: LogOut, danger: true, onClick: () => logout() }
          ]} />
        </header>
        {window.__SSDC_DEMO_LINK && (
          <div className="border-b border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-900 print:hidden dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
            Online demo with sample patients. Everything you enter stays in this browser only. Printing, PDF and Word downloads, voice dictation, WhatsApp / SMS sending and multi-computer sync work in the clinic server version.
          </div>
        )}
        {principal.usesDefaultPassword && (
          <div className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 print:hidden dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <span>You are using the default password. Please change it to keep patient records secure.</span>
            <button className="font-bold underline" onClick={() => setPwd(true)}>Change now</button>
          </div>
        )}
        {net.mode === 'server' && !net.connected && net.authed && (
          <div className="border-b border-rose-200 bg-rose-50 px-3 py-1 text-center text-xs font-medium text-rose-800 print:hidden dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            Connection to the clinic server lost — working offline, {net.pending} change(s) queued locally. Reconnecting…
          </div>
        )}
        <main id="main" className="min-h-0 flex-1 overflow-y-auto px-3 pb-24 pt-4 sm:px-5 lg:pb-6">{children}</main>
        {!wide && (
          <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface/95 backdrop-blur print:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            {bottom.map((n) => (
              <a key={n.id} href={'#/' + n.id} className={cx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-semibold', n.id === active ? 'text-brand-600' : 'text-muted')}>
                <n.icon className="h-5 w-5" />{n.short || n.label}
              </a>
            ))}
            <button onClick={() => setMobileOpen(true)} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-semibold text-muted"><MoreHorizontal className="h-5 w-5" />More</button>
          </nav>
        )}
      </div>
      {hud && <VoiceHUD onClose={() => setHud(false)} />}
      {!hud && <VoicePill onPanel={() => setHud(true)} />}
      <LanConnect open={lan} onClose={() => setLan(false)} />
      <ChangePassword open={pwd} onClose={() => setPwd(false)} />
      <WorkstationInbox />
      <DispatchHost />
      <IdleGuard />
    </div>
  );
}
