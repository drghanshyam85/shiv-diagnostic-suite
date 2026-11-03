// <RoleSwitcher /> dev-testing toolbar: switch identity in one click to test route protection,
// button visibility and signature-block rendering. Disable it in Settings → Security before go-live.
import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { useAuth, switchUser, loginTiles } from '../core/auth';
import { useColl } from '../core/hooks';
import { cx, Menu, toast } from '../components/ui';
import perms from '../../../shared/permissions';

const ROLE_TONE = { SUPER_ADMIN_RADIOLOGIST: 'bg-sky-600', CONSULTANT_PATHOLOGIST: 'bg-rose-600', LAB_TECHNICIAN: 'bg-amber-500', RECEPTION_BILLING: 'bg-emerald-600', AUDITOR_VIEW_ONLY: 'bg-slate-500' };

export function RoleSwitcher() {
  const { principal } = useAuth();
  const storeUsers = useColl('users');
  const [tiles, setTiles] = useState([]);
  useEffect(() => { loginTiles().then((r) => setTiles(r.users || [])).catch(() => setTiles([])); }, [storeUsers.length]);
  const users = tiles.length ? tiles : storeUsers;
  const go = async (u) => {
    try { await switchUser(u.id); toast('Switched to ' + u.name + ' (' + ((perms.ROLES[u.role] || {}).short || u.role) + ')', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Menu width="w-72" trigger={
      <button title="Dev Role Switcher — test as another staff member" className="flex items-center gap-1.5 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300">
        <Users className="h-3.5 w-3.5" /><span className="hidden sm:inline">{(perms.ROLES[principal.role] || {}).short || 'Role'}</span><span className="rounded bg-amber-400 px-1 text-[9px] text-white">DEV</span>
      </button>
    } items={[{ header: 'Switch role (dev testing)' }].concat(users.map((u) => ({
      label: u.name, hint: (perms.ROLES[u.role] || {}).short, checked: u.id === principal.id, onClick: () => go(u),
      icon: () => <span className={cx('inline-block h-2.5 w-2.5 rounded-full', ROLE_TONE[u.role] || 'bg-slate-400')} />
    })))} />
  );
}
