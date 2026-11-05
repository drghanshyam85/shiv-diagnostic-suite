// Admin Console: interactive staff permission matrix (Full / Draft / Read / Blocked per role, save &
// reset to the default clinical policy), staff & credential directory (registration numbers, PNG
// signatures for report footers, active status, per-user overrides, password reset), compliance &
// security locks, and the live clinical audit trail with CSV export. Works against the LAN server's
// admin API, or the local store in standalone mode.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Grid3x3, Users, Lock, ScrollText, Save, RotateCcw, UserPlus, Pencil, KeyRound, Upload, Search, Download, RefreshCw, CircleCheck, CircleSlash, Eye, FilePenLine, Ban, Radio, Rocket, Trash2, Timer, UserX } from 'lucide-react';
import { useColl, useSettings, saveSettings, useRoute, navigate } from '../../core/hooks';
import { store } from '../../core/store';
import { api, isServer } from '../../core/sync';
import { can, useAuth, logAudit, hashLocalPassword } from '../../core/auth';
import { cx, Card, Button, Badge, Input, Select, Field, Toggle, Modal, Empty, Tabs, toast, confirmDialog } from '../../components/ui';
import { fmtDateTime, timeAgo, toCSV, download, pickFiles, readAsDataURL, uid, dateKey } from '../../core/utils';
import { idbGetAll, kvSet } from '../../core/idb';
import perms from '../../../../shared/permissions';
import { DEMO_COLLS, planDemoCleanup, countersAfter } from '../../../../shared/demo-cleanup';
import { PatientRecords } from './PatientRecords';

const { ROLES, ROLE_ORDER, PERMISSIONS, LEVEL_LABEL, buildDefaultRoles, defaultRolePermissions } = perms;
const LEVEL_UI = {
  FULL: { label: 'Full Access', short: 'Full', icon: CircleCheck, cls: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200' },
  DRAFT: { label: 'Draft Only', short: 'Draft', icon: FilePenLine, cls: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200' },
  READ: { label: 'Read-Only', short: 'Read', icon: Eye, cls: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200' },
  NONE: { label: 'Blocked', short: 'Blocked', icon: Ban, cls: 'border-slate-300 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400' }
};
const CYCLE = ['FULL', 'DRAFT', 'READ', 'NONE'];
const TABS = [
  { id: 'matrix', label: 'Permission matrix', icon: Grid3x3 },
  { id: 'staff', label: 'Staff & credentials', icon: Users },
  { id: 'compliance', label: 'Compliance & security locks', icon: Lock },
  { id: 'patients', label: 'Patient records', icon: UserX },
  { id: 'audit', label: 'Live audit trail', icon: ScrollText }
];

export function AdminConsole() {
  const route = useRoute();
  const isAdmin = can('admin:manage_roles_and_matrix');
  const canAudit = can('admin:view_audit_logs', 'READ');
  const tabs = TABS.filter((t) => (t.id === 'audit' ? canAudit : t.id === 'patients' ? can('patient:delete_records', 'READ') : isAdmin || can('admin:manage_roles_and_matrix', 'READ')));
  const tab = tabs.some((t) => t.id === route.query.tab) ? route.query.tab : (tabs[0] || {}).id;
  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h1 className="font-display text-xl font-extrabold tracking-tight sm:text-2xl">Admin Console</h1>
        <p className="text-[13px] text-muted">Role-based access control · staff credentials · compliance locks · patient records & recycle bin · clinical & security audit trail{isServer() ? ' · enforced by the clinic server' : ' · standalone mode (this computer)'}</p>
      </div>
      <Tabs tabs={tabs} value={tab} onChange={(id) => navigate('/admin', { tab: id })} />
      {tab === 'matrix' && <Matrix readOnly={!isAdmin} />}
      {tab === 'staff' && <Staff readOnly={!isAdmin} />}
      {tab === 'compliance' && <Compliance readOnly={!can('settings:manage_clinic_and_integrations')} />}
      {tab === 'patients' && <PatientRecords />}
      {tab === 'audit' && <AuditTrail />}
    </div>
  );
}

// ---------------------------------------------------------------- permission matrix
function Matrix({ readOnly }) {
  const roleDocs = useColl('roles');
  const base = useMemo(() => {
    const m = {};
    const defaults = buildDefaultRoles();
    // a permission added in a later version shows its default level until changed, as the server applies it
    ROLE_ORDER.forEach((r) => { const d = roleDocs.find((x) => x.name === r || x.id === r) || defaults.find((x) => x.name === r); m[r] = Object.assign(defaultRolePermissions(r), d.permissions); });
    return m;
  }, [roleDocs]);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const cur = draft || base;
  const dirty = draft ? ROLE_ORDER.some((r) => PERMISSIONS.some((p) => draft[r][p.key] !== base[r][p.key])) : false;
  const locked = (role, key) => role === 'SUPER_ADMIN_RADIOLOGIST' && key === 'admin:manage_roles_and_matrix';
  const set = (role, key, level) => {
    if (readOnly || locked(role, key)) return;
    const next = JSON.parse(JSON.stringify(cur));
    next[role][key] = level;
    setDraft(next);
  };
  const save = async () => {
    setBusy(true);
    try {
      for (const r of ROLE_ORDER) {
        const changed = {};
        PERMISSIONS.forEach((p) => { if (draft[r][p.key] !== base[r][p.key]) changed[p.key] = draft[r][p.key]; });
        if (!Object.keys(changed).length) continue;
        if (isServer()) {
          const res = await api('admin/roles/' + r + '/permissions', { method: 'PATCH', body: { permissions: changed } });
          store.applyRemote('roles', Object.assign({ id: r }, res.role), true);
        } else {
          const doc = roleDocs.find((x) => x.name === r || x.id === r) || buildDefaultRoles().find((x) => x.name === r);
          store.put('roles', Object.assign({}, doc, { id: doc.id || r, permissions: Object.assign({}, doc.permissions, changed) }));
          logAudit('admin:matrix_changed', 'roles/' + r, { diff: changed });
        }
      }
      setDraft(null);
      toast('Permission matrix saved — applied on every workstation', 'success');
    } catch (e) { toast('Save failed: ' + e.message, 'error'); } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!(await confirmDialog({ title: 'Reset to the default clinical policy?', message: 'Every role returns to the clinic’s mandated matrix. Per-user overrides are kept.', danger: true, confirmText: 'Reset matrix' }))) return;
    setBusy(true);
    try {
      if (isServer()) { const res = await api('admin/roles/reset', { method: 'POST' }); res.roles.forEach((r) => store.applyRemote('roles', Object.assign({ id: r.name }, r), true)); }
      else { buildDefaultRoles(Date.now()).forEach((r) => store.put('roles', r)); logAudit('admin:matrix_reset_default', 'roles/*', {}); }
      setDraft(null);
      toast('Default clinical policy restored', 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const modules = [];
  PERMISSIONS.forEach((p) => { let g = modules.find((m) => m.name === p.module); if (!g) modules.push((g = { name: p.module, items: [] })); g.items.push(p); });
  return (
    <Card padded={false} title="Interactive staff permission matrix" subtitle="Modules & actions × clinic roles · click a cell to cycle Full → Draft → Read → Blocked" icon={Grid3x3}
      actions={readOnly ? <Badge>Read-only</Badge> : <><Button size="sm" icon={RotateCcw} disabled={busy} onClick={reset}>Reset to default clinical policy</Button><Button size="sm" variant="primary" icon={Save} loading={busy} disabled={!dirty} onClick={save}>Save matrix changes</Button></>}>
      <div className="flex flex-wrap gap-2 border-b border-line px-4 py-2 text-[11.5px]">
        {CYCLE.map((l) => { const u = LEVEL_UI[l]; return <span key={l} className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold', u.cls)}><u.icon className="h-3 w-3" />{u.label}</span>; })}
        {dirty && <span className="ml-auto font-semibold text-amber-700 dark:text-amber-300">Unsaved changes</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-[12.5px]">
          <thead>
            <tr className="border-b border-line bg-surface2/60 text-left">
              <th className="sticky left-0 z-10 bg-surface2 px-3 py-2 text-[10.5px] uppercase tracking-wide text-muted">Module / permission key</th>
              {ROLE_ORDER.map((r) => <th key={r} className="px-2 py-2 text-center"><div className="text-[12px] font-bold text-ink">{ROLES[r].short}</div><div className="text-[10px] font-medium text-muted">{r}</div></th>)}
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => [
              <tr key={m.name} className="bg-surface2/40"><td colSpan={ROLE_ORDER.length + 1} className="sticky left-0 px-3 py-1 text-[10.5px] font-bold uppercase tracking-wider text-muted">{m.name}</td></tr>,
              ...m.items.map((p) => (
                <tr key={p.key} className="border-b border-line/60">
                  <td className="sticky left-0 z-10 bg-surface px-3 py-1.5"><div className="font-mono text-[11.5px]">{p.key}</div><div className="text-[11px] text-muted">{p.label}{!p.spec && <span className="ml-1 rounded bg-surface2 px-1 text-[10px]">suite extension</span>}</div>{p.levels && <div className="text-[10.5px] text-muted/90">{['READ', 'DRAFT', 'FULL'].map((l) => LEVEL_UI[l].short + ': ' + p.levels[l]).join(' · ')}</div>}</td>
                  {ROLE_ORDER.map((r) => {
                    const lvl = cur[r][p.key] || 'NONE';
                    const u = LEVEL_UI[lvl];
                    const changed = draft && draft[r][p.key] !== base[r][p.key];
                    const lock = locked(r, p.key);
                    return (
                      <td key={r} className="px-1.5 py-1 text-center">
                        <button type="button" disabled={readOnly || lock} title={lock ? 'Lock-out protection: the Super Admin always keeps matrix control' : 'Click to change (' + LEVEL_LABEL[lvl] + ')'}
                          onClick={() => set(r, p.key, CYCLE[(CYCLE.indexOf(lvl) + 1) % CYCLE.length])} aria-label={ROLES[r].short + ' · ' + p.key + ': ' + u.label}
                          className={cx('inline-flex min-w-[92px] items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[11.5px] font-semibold transition', u.cls, !readOnly && !lock && 'hover:ring-2 hover:ring-brand-400/40', changed && 'ring-2 ring-amber-400', lock && 'cursor-not-allowed')}>
                          <u.icon className="h-3.5 w-3.5" />{u.short}{lock && <Lock className="h-3 w-3" />}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))
            ])}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- staff directory
function useStaff() {
  const local = useColl('users');
  const [remote, setRemote] = useState(null);
  const refresh = useCallback(() => { if (isServer()) api('admin/staff').then((r) => setRemote(r.staff)).catch((e) => toast(e.message, 'error')); }, []);
  useEffect(() => { refresh(); }, [refresh, local]);
  return [isServer() ? remote || local : local, refresh];
}

function Staff({ readOnly }) {
  const [staff, refresh] = useStaff();
  const [edit, setEdit] = useState(null);
  const [tempPwd, setTempPwd] = useState(null);
  const { principal: me } = useAuth();
  const apply = (u) => { if (u) store.applyRemote('users', Object.assign({}, store.getRaw('users', u.id) || {}, u), true); refresh(); };
  const patch = async (u, body, label) => {
    try {
      if (isServer()) apply((await api('admin/staff/' + u.id, { method: 'PATCH', body })).user);
      else { store.put('users', Object.assign({}, store.get('users', u.id), body)); logAudit('admin:staff_updated', 'users/' + u.id, { changes: Object.keys(body) }); }
      toast(label || 'Saved', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  const uploadSig = async (u) => {
    const [f] = await pickFiles({ accept: 'image/png,image/jpeg,image/webp' });
    if (!f) return;
    if (f.size > 450 * 1024) return toast('Signature image must be under 450 KB', 'warning');
    try {
      if (isServer()) { const fd = new FormData(); fd.append('signature', f); apply((await api('admin/staff/' + u.id + '/signature', { method: 'POST', form: fd })).user); }
      else { store.put('users', Object.assign({}, store.get('users', u.id), { digitalSignatureUrl: await readAsDataURL(f) })); logAudit('admin:signature_uploaded', 'users/' + u.id, { bytes: f.size }); }
      toast('Digital signature saved — printed on signed reports', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  const resetPwd = async (u) => {
    if (!(await confirmDialog({ title: 'Reset password for ' + u.name + '?', message: 'A temporary password is generated; the user must change it at next sign-in. Their other sessions are signed out.', confirmText: 'Reset password' }))) return;
    try {
      let pwd;
      if (isServer()) pwd = (await api('admin/staff/' + u.id + '/reset-password', { method: 'POST', body: {} })).temporaryPassword;
      else { pwd = Math.random().toString(36).slice(2, 8); store.put('users', Object.assign({}, store.get('users', u.id), { passwordHash: await hashLocalPassword(pwd), mustChangePassword: true, usesDefaultPassword: false })); logAudit('admin:password_reset', 'users/' + u.id, {}); }
      setTempPwd({ name: u.name, pwd });
    } catch (e) { toast(e.message, 'error'); }
  };
  if (!staff) return <Card><Empty icon={Users} title="Loading staff…" /></Card>;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{!readOnly && <Button variant="primary" icon={UserPlus} onClick={() => setEdit({})}>Add staff member</Button>}</div>
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {staff.slice().sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || String(a.name).localeCompare(String(b.name))).map((u) => (
          <Card key={u.id} className={cx(u.isActive === false && 'opacity-60')}>
            <div className="flex items-start gap-3">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-teal-500 text-sm font-bold text-white">{String(u.name).replace(/^Dr\.?\s*/, '').split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5"><span className="truncate font-display text-[15px] font-bold">{u.name}</span>{u.id === me.id && <Badge tone="brand">You</Badge>}{u.isActive === false && <Badge tone="rose">Inactive</Badge>}</div>
                <div className="text-[12px] text-muted">{(ROLES[u.role] || {}).label || u.role}</div>
                <div className="mt-1 text-[12px]">{[u.qualification, u.designation].filter(Boolean).join(' · ') || '—'}</div>
                <div className="text-[12px] font-semibold">{u.registrationNumber || <span className="font-normal text-muted">No registration number</span>}</div>
                <div className="mt-0.5 text-[11px] text-muted">{[u.phone, u.email].filter(Boolean).join(' · ')}{u.lastLogin ? ' · last sign-in ' + timeAgo(u.lastLogin) : ''}</div>
                {(u.customPermissions || []).length > 0 && <div className="mt-1 flex flex-wrap gap-1">{u.customPermissions.map((c) => <Badge key={c} tone="violet">{c}</Badge>)}</div>}
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3 rounded-xl bg-surface2/60 p-2">
              <div className="flex h-12 w-36 items-center justify-center rounded-lg border border-dashed border-line bg-white">{u.digitalSignatureUrl ? <img src={u.digitalSignatureUrl} alt="Signature" className="max-h-11 max-w-[136px] object-contain" /> : <span className="text-[10.5px] text-slate-400">No signature</span>}</div>
              <div className="text-[11px] text-muted">Digital signature / stamp printed in signed report footers</div>
            </div>
            {!readOnly && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Button size="xs" icon={Pencil} onClick={() => setEdit(u)}>Edit</Button>
                <Button size="xs" icon={Upload} onClick={() => uploadSig(u)}>Signature</Button>
                <Button size="xs" icon={KeyRound} onClick={() => resetPwd(u)}>Reset password</Button>
                <Toggle size="sm" className="ml-auto" checked={u.isActive !== false} disabled={u.id === me.id} onChange={(v) => patch(u, { isActive: v }, v ? 'Account activated' : 'Account deactivated — signed out everywhere')} label={u.isActive !== false ? 'Active' : 'Inactive'} />
              </div>
            )}
          </Card>
        ))}
      </div>
      {edit && <StaffEditor initial={edit} onClose={() => setEdit(null)} onSaved={apply} isSelf={edit.id === me.id} />}
      {tempPwd && (
        <Modal open size="sm" onClose={() => setTempPwd(null)} title="Temporary password" icon={KeyRound} footer={<Button variant="primary" onClick={() => setTempPwd(null)}>Done</Button>}>
          <p className="text-[13px]">Give this one-time password to <b>{tempPwd.name}</b>. They must set a new password at sign-in.</p>
          <div className="mt-3 rounded-xl bg-surface2 p-3 text-center font-mono text-2xl font-bold tracking-widest">{tempPwd.pwd}</div>
        </Modal>
      )}
    </div>
  );
}

function StaffEditor({ initial, onClose, onSaved, isSelf }) {
  const isNew = !initial.id;
  const [f, setF] = useState(() => Object.assign({ name: '', role: 'RECEPTION_BILLING', qualification: '', designation: '', registrationNumber: '', email: '', phone: '', customPermissions: [], password: '' }, initial));
  const [ovKey, setOvKey] = useState(PERMISSIONS[0].key);
  const [ovLvl, setOvLvl] = useState('READ');
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((x) => Object.assign({}, x, patch));
  const save = async () => {
    if (String(f.name).trim().length < 2) return toast('Name is required', 'warning');
    if (isNew && String(f.password || '').length < 4) return toast('Set an initial password (min 4 characters)', 'warning');
    setBusy(true);
    const body = { name: f.name.trim(), role: f.role, qualification: f.qualification, designation: f.designation, registrationNumber: f.registrationNumber, email: f.email, phone: f.phone, customPermissions: f.customPermissions };
    try {
      if (isServer()) {
        const r = isNew ? await api('admin/staff', { method: 'POST', body: Object.assign({ password: f.password }, body) }) : await api('admin/staff/' + f.id, { method: 'PATCH', body });
        onSaved(r.user);
      } else {
        const doc = isNew ? Object.assign({ id: uid('u_'), isActive: true, digitalSignatureUrl: '', lastLogin: null, passwordHash: await hashLocalPassword(f.password), mustChangePassword: true }, body) : Object.assign({}, store.get('users', f.id), body);
        store.put('users', doc);
        logAudit(isNew ? 'admin:staff_created' : 'admin:staff_updated', 'users/' + doc.id, { role: doc.role });
      }
      toast(isNew ? 'Staff member added' : 'Staff details saved', 'success');
      onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const addOverride = () => set({ customPermissions: (f.customPermissions || []).filter((c) => !c.startsWith(ovKey + '=')).concat([ovKey + '=' + ovLvl]) });
  return (
    <Modal open size="md" onClose={onClose} title={isNew ? 'Add staff member' : 'Edit ' + initial.name} icon={isNew ? UserPlus : Pencil}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field>
        <Field label="Role"><Select value={f.role} disabled={isSelf} onChange={(e) => set({ role: e.target.value })} options={ROLE_ORDER.map((r) => ({ value: r, label: ROLES[r].label }))} /></Field>
        <Field label="Registration (RMC / RPMC)"><Input value={f.registrationNumber} onChange={(e) => set({ registrationNumber: e.target.value })} placeholder="RMC Reg. No. …" /></Field>
        <Field label="Qualification"><Input value={f.qualification} onChange={(e) => set({ qualification: e.target.value })} /></Field>
        <Field label="Designation"><Input value={f.designation} onChange={(e) => set({ designation: e.target.value })} /></Field>
        <Field label="Mobile"><Input value={f.phone} onChange={(e) => set({ phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} /></Field>
        <Field label="E-mail"><Input value={f.email} onChange={(e) => set({ email: e.target.value })} /></Field>
        {isNew && <Field label="Initial password" required className="sm:col-span-2" hint="The user changes it at first sign-in"><Input type="text" value={f.password} onChange={(e) => set({ password: e.target.value })} /></Field>}
      </div>
      <div className="mt-4 rounded-xl bg-surface2/60 p-3">
        <div className="label">Per-user permission overrides</div>
        <div className="flex flex-wrap items-end gap-2">
          <Select size="sm" className="min-w-[240px] flex-1" value={ovKey} onChange={(e) => setOvKey(e.target.value)} options={PERMISSIONS.map((p) => ({ value: p.key, label: p.key }))} />
          <Select size="sm" className="w-[130px]" value={ovLvl} onChange={(e) => setOvLvl(e.target.value)} options={CYCLE.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))} />
          <Button size="sm" onClick={addOverride}>Add override</Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">{(f.customPermissions || []).map((c) => <button key={c} className="chip" title="Remove" onClick={() => set({ customPermissions: f.customPermissions.filter((x) => x !== c) })}>{c} ✕</button>)}{!(f.customPermissions || []).length && <span className="text-[11.5px] text-muted">None — the role’s matrix applies.</span>}</div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- compliance locks
function Compliance({ readOnly }) {
  const settings = useSettings();
  const c = settings.compliance || {};
  const set = (k, v) => {
    if (readOnly) return toast('Only the administrator can change compliance locks', 'error');
    saveSettings({ compliance: { [k]: v } });
    logAudit('admin:compliance_lock_changed', 'settings/compliance', { lock: k, enabled: v });
    toast((v ? 'Enabled: ' : 'Disabled: ') + k, v ? 'success' : 'warning');
  };
  const LOCKS = [
    ['strictFormFLock', 'Strict PC-PNDT Form F lock', 'Obstetric USG reports cannot be signed, printed or sent until the linked Form F has every mandatory field (PC-PNDT Act 1994).'],
    ['dualSignatoryPathology', 'Dual-signatory pathology mode', 'Finalised lab reports carry both signature blocks (lab technician Yogesh + pathologist Dr. Rishabh Kumar); the verifier must differ from the technician who entered the results.']
  ];
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Compliance & security locks" subtitle={readOnly ? 'Read-only for your role' : 'Applied on every workstation and enforced by the server'} icon={Lock}>
        <div className="space-y-3">
          {LOCKS.map(([k, label, hint]) => (
            <div key={k} className={cx('rounded-xl border p-3', c[k] !== false ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20' : 'border-line')}>
              <Toggle checked={c[k] !== false} disabled={readOnly} onChange={(v) => set(k, v)} label={label} hint={hint} />
            </div>
          ))}
        </div>
      </Card>
      <Card title="Security posture" icon={ShieldCheck}>
        <ul className="space-y-2 text-[13px]">
          <li className="flex gap-2"><CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />Signed USG and lab reports are locked; only the Super Admin can unlock them, with a mandatory reason written to the audit trail.</li>
          <li className="flex gap-2"><CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{isServer() ? 'Every change is validated on the clinic server against the role matrix (JWT in an HTTP-only cookie).' : 'Standalone mode: permissions are enforced in this browser; run the LAN server for server-side enforcement.'}</li>
          <li className="flex gap-2"><CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />Aadhaar numbers are masked on printed copies unless the bill explicitly shows them.</li>
          <li className="flex items-start gap-2">{settings.ui.devRoleSwitcher !== false ? <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> : <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />}
            <span className="flex-1">Dev role switcher (one-click identity switch for testing) is <b>{settings.ui.devRoleSwitcher !== false ? 'ON' : 'OFF'}</b>. Turn it off before going live.
              {!readOnly && <Toggle size="sm" className="mt-1" checked={settings.ui.devRoleSwitcher !== false} onChange={(v) => { saveSettings({ ui: { devRoleSwitcher: v } }); logAudit('admin:dev_switcher_changed', 'settings/ui', { enabled: v }); }} label="Dev role switcher" />}</span></li>
        </ul>
      </Card>
      <SessionSecurity readOnly={readOnly} />
      <GoLive readOnly={readOnly} />
    </div>
  );
}

// ---------------------------------------------------------------- session timeouts
const SEC_FIELDS = [
  ['idleLockMinutes', 'Lock the screen after (minutes idle)', 'Every workstation; the same password unlocks it and open work is kept. 0 = never.', [0, 5, 10, 15, 20, 30, 45, 60]],
  ['adminIdleMinutes', 'Admin Console & Settings lock after', 'Shorter timeout while administrative screens are open.', [0, 2, 3, 5, 10, 15]],
  ['signOutAfterLockMinutes', 'Sign out after being locked for', 'Ends the session completely; unsaved drafts stay saved locally.', [0, 15, 30, 60, 120, 240]],
  ['adminReauthMinutes', 'Ask for the password again before admin changes after', 'Staff, roles, credentials, integrations, report unlocks and audit exports. 0 = never.', [0, 5, 10, 15, 30, 60]],
  ['sessionHours', 'Maximum signed-in session (hours)', 'After this, everyone signs in again — one working day is typical.', [8, 10, 12, 14, 16, 24]]
];

function SessionSecurity({ readOnly }) {
  const settings = useSettings();
  const sec = Object.assign({ idleLockMinutes: 15, adminIdleMinutes: 5, signOutAfterLockMinutes: 60, adminReauthMinutes: 15, sessionHours: 14 }, settings.security || {});
  const set = (k, v) => {
    if (readOnly) return toast('Only the administrator can change session security', 'error');
    saveSettings({ security: { [k]: Number(v) } });
    logAudit('admin:session_security_changed', 'settings/security', { [k]: Number(v), from: sec[k] });
    toast('Saved — applies on every workstation', 'success');
  };
  return (
    <Card title="Session timeouts" subtitle="Automatic screen lock, sign-out and password re-confirmation — synced to every workstation" icon={Timer}>
      <div className="grid gap-3 sm:grid-cols-2">
        {SEC_FIELDS.map(([k, label, hint, opts]) => (
          <Field key={k} label={label} hint={hint}>
            <Select value={String(sec[k])} disabled={readOnly} onChange={(e) => set(k, e.target.value)}
              options={Array.from(new Set(opts.concat([Number(sec[k])]))).sort((a, b) => a - b).map((n) => ({ value: String(n), label: n === 0 ? 'Never' : k === 'sessionHours' ? n + ' hours' : n + ' min' }))} aria-label={label} />
          </Field>
        ))}
      </div>
      <p className="mt-3 text-[11.5px] text-muted">The waiting-hall TV display never locks. Dictation counts as activity. Every lock, unlock, time-out and failed password is written to the audit trail.</p>
    </Card>
  );
}

// ---------------------------------------------------------------- go live: remove first-run demo records
const DEMO_LABEL = { patients: 'patients', visits: 'visits', invoices: 'bills', expenses: 'expenses', floats: 'opening floats', reports: 'USG reports', labReports: 'lab reports', formf: 'Form F records', dispatchLog: 'dispatch log rows' };

function localDemo() {
  const docs = {};
  DEMO_COLLS.forEach((c) => { docs[c] = store.list(c); });
  return { docs, plan: planDemoCleanup(docs) };
}
const summarizePlan = (plan) => ({ total: plan.total, keptPatients: plan.keptPatients.length, counts: Object.fromEntries(Object.entries(plan.remove).filter(([, ids]) => ids.length).map(([c, ids]) => [c, ids.length])) });

function GoLive({ readOnly }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try { setInfo(isServer() ? await api('admin/demo-data') : summarizePlan(localDemo().plan)); } catch (e) { setInfo({ error: e.message }); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const clear = async () => {
    const ok = await confirmDialog({
      title: 'Remove demo data?', danger: true, confirmText: 'Remove demo data',
      message: 'This deletes the ' + info.total + ' sample records created on first run (sample patients, bills, reports, lab reports, Form F, expenses) from every workstation, then restarts bill, patient and token numbering after your real records.\n\nClinic settings, rate list, referring doctors, staff, templates and macros are kept. Download a backup first if unsure.'
    });
    if (!ok) return;
    setBusy(true);
    try {
      if (isServer()) {
        const r = await api('admin/demo-data/clear', { method: 'POST' });
        for (const [k, v] of Object.entries(r.counters || {})) await kvSet('counter:' + k, v);
        toast(r.total + ' demo records removed — numbering restarted', 'success');
      } else {
        const { docs, plan } = localDemo();
        Object.entries(plan.remove).forEach(([c, ids]) => ids.forEach((id) => store.remove(c, id)));
        const existing = {};
        (await idbGetAll('kv')).forEach((r) => { if (String(r.key).startsWith('counter:')) existing[r.key.slice(8)] = r.value; });
        for (const [k, v] of Object.entries(countersAfter(docs, plan.remove, existing))) await kvSet('counter:' + k, v);
        logAudit('admin:demo_data_cleared', 'clinic', { total: plan.total });
        toast(plan.total + ' demo records removed — numbering restarted', 'success');
      }
      refresh();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Card title="Go live: remove demo data" subtitle="Sample records created on first run so every screen can be explored" icon={Rocket} className="xl:col-span-2">
      {!info ? <p className="text-[13px] text-muted">Checking…</p> : info.error ? <p className="text-[13px] text-rose-600">{info.error}</p> : info.total === 0 ? (
        <p className="flex items-center gap-2 text-[13px]"><CircleCheck className="h-4 w-4 text-emerald-600" />No demo records left — the register contains only real data.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 text-[13px]">
            <b>{info.total}</b> demo record{info.total === 1 ? '' : 's'}: {Object.entries(info.counts).map(([c, n]) => n + ' ' + (DEMO_LABEL[c] || c)).join(' · ')}.
            {info.keptPatients > 0 && <span className="text-muted"> {info.keptPatients} sample patient{info.keptPatients === 1 ? ' has' : 's have'} real visits and will be kept.</span>}
            <div className="mt-0.5 text-[12px] text-muted">Removing them restarts bill numbers ({'SSDC-' + new Date().getFullYear() + '-0001'}), patient IDs and today’s tokens after your real records.</div>
          </div>
          <Button variant="danger" icon={Trash2} loading={busy} disabled={readOnly} onClick={clear}>Remove demo data</Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- audit trail
const PREFIXES = ['report:', 'lab:', 'formf:', 'invoice:', 'patient:', 'visit:', 'dispatch:', 'print:', 'files:', 'auth:', 'admin:', 'settings:', 'tariff:', 'cashbook:', 'accounts:', 'share:'];

function AuditTrail() {
  const localAudit = useColl('audit');
  const users = useColl('users');
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState(dateKey(new Date(Date.now() - 7 * 86400000)));
  const [to, setTo] = useState(dateKey());
  const [live, setLive] = useState(true);
  const [remote, setRemote] = useState({ total: 0, rows: [] });
  const [limit, setLimit] = useState(200);
  const fromTs = new Date(from + 'T00:00:00').getTime();
  const toTs = new Date(to + 'T23:59:59').getTime();
  const params = () => new URLSearchParams(Object.entries({ q, action, actorId: actor, from: fromTs, to: toTs, limit }).filter(([, v]) => v !== '' && v !== null && v !== undefined)).toString();
  const load = useCallback(() => { if (isServer()) api('admin/audit-logs?' + params()).then(setRemote).catch((e) => toast(e.message, 'error')); }, [q, action, actor, fromTs, toTs, limit]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { if (!live || !isServer()) return undefined; const t = setInterval(load, 8000); return () => clearInterval(t); }, [live, load]);
  const localRows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return localAudit.filter((r) => r.timestamp >= fromTs && r.timestamp <= toTs && (!action || String(r.action).startsWith(action)) && (!actor || r.actorId === actor) && (!s || JSON.stringify(r).toLowerCase().includes(s))).sort((a, b) => b.timestamp - a.timestamp);
  }, [localAudit, q, action, actor, fromTs, toTs]);
  const rows = isServer() ? remote.rows : localRows.slice(0, limit);
  const total = isServer() ? remote.total : localRows.length;
  const exportCsv = async () => {
    try {
      if (isServer()) {
        const r = await api('admin/audit-logs.csv?' + params(), { raw: true });
        if (!r.ok) throw new Error('Export failed (' + r.status + ')');
        download('ssdc-audit-trail_' + from + '_' + to + '.csv', await r.blob());
      } else {
        download('ssdc-audit-trail_' + from + '_' + to + '.csv', toCSV(localRows.map((r) => ({ timestamp: new Date(r.timestamp).toISOString(), actor: r.actorName, role: r.actorRole, action: r.action, target: r.targetResource, ip: r.ipAddress, metadata: JSON.stringify(r.metadata || {}) }))), 'text/csv;charset=utf-8');
        logAudit('admin:audit_exported', 'audit_logs', { rows: localRows.length });
      }
    } catch (e) { toast(e.message, 'error'); }
  };
  const tone = (a) => (/unlock|delete|refund|reset|deactivat|failed|denied/.test(a) ? 'rose' : /sign|verified|final|approved/.test(a) ? 'emerald' : /print|export|dispatch|share/.test(a) ? 'violet' : /login|logout|switch/.test(a) ? 'slate' : 'brand');
  return (
    <Card padded={false} title="Live clinical & security audit trail" subtitle={total + ' event(s) in range' + (isServer() && live ? ' · auto-refreshing' : '')} icon={ScrollText}
      actions={<>{isServer() && <Toggle size="sm" checked={live} onChange={setLive} label="Live" />}<Button size="sm" icon={RefreshCw} onClick={load} disabled={!isServer()}>Refresh</Button><Button size="sm" icon={Download} onClick={exportCsv}>Export CSV</Button></>}>
      <div className="flex flex-wrap items-end gap-2 border-b border-line p-3">
        <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input size="sm" className="pl-8" placeholder="Search actor, action, target, details…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit trail" /></div>
        <Select size="sm" className="w-[150px]" value={action} onChange={(e) => setAction(e.target.value)} placeholder="All actions" options={PREFIXES.map((p) => ({ value: p, label: p + '*' }))} aria-label="Action filter" />
        <Select size="sm" className="w-[190px]" value={actor} onChange={(e) => setActor(e.target.value)} placeholder="All staff" options={users.map((u) => ({ value: u.id, label: u.name }))} aria-label="Staff filter" />
        <Input size="sm" type="date" className="w-[145px]" value={from} max={to} onChange={(e) => setFrom(e.target.value || from)} aria-label="From" />
        <Input size="sm" type="date" className="w-[145px]" value={to} min={from} onChange={(e) => setTo(e.target.value || to)} aria-label="To" />
      </div>
      {!rows.length ? <Empty icon={ScrollText} title="No audit events" text="Change the filters or date range." /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[12.5px]">
            <thead><tr className="border-b border-line bg-surface2/60 text-left text-[10.5px] uppercase tracking-wide text-muted"><th className="px-3 py-2">When</th><th className="px-2">Staff</th><th className="px-2">Action</th><th className="px-2">Target</th><th className="px-2">Details</th><th className="px-2">IP</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id || i} className="border-b border-line/60 align-top">
                  <td className="whitespace-nowrap px-3 py-1.5"><div>{fmtDateTime(r.timestamp)}</div><div className="text-[10.5px] text-muted">{timeAgo(r.timestamp)}</div></td>
                  <td className="px-2"><div className="font-semibold">{r.actorName}</div><div className="text-[10.5px] text-muted">{(ROLES[r.actorRole] || {}).short || r.actorRole}</div></td>
                  <td className="px-2"><Badge tone={tone(String(r.action))}>{r.action}</Badge></td>
                  <td className="px-2 font-mono text-[11px]">{r.targetResource}</td>
                  <td className="px-2"><div className="max-w-[360px] break-words text-[11px] text-muted">{summarizeMeta(r.metadata)}</div></td>
                  <td className="px-2 text-[11px] text-muted">{r.ipAddress}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > rows.length && <div className="p-3 text-center"><Button size="sm" onClick={() => setLimit(limit + 300)}>Show more ({total - rows.length})</Button></div>}
        </div>
      )}
      {isServer() && <div className="flex items-center gap-1.5 border-t border-line px-4 py-2 text-[11px] text-muted"><Radio className="h-3.5 w-3.5" />Server audit log — tamper-evident record of report signing, unlocking, Form F changes, prints, exports and dispatches.</div>}
    </Card>
  );
}

function summarizeMeta(m) {
  if (!m || typeof m !== 'object') return '';
  const parts = [];
  Object.entries(m).slice(0, 6).forEach(([k, v]) => {
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (s.length > 80) s = s.slice(0, 80) + '…';
    parts.push(k + ': ' + s);
  });
  return parts.join(' · ');
}
