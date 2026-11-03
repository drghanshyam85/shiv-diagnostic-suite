// Client-side RBAC: session, login (server JWT cookie or local PBKDF2), dev role switcher, can().
import { useSyncExternalStore } from 'react';
import { store, events } from './store';
import { api, net, setAuthed } from './sync';
import { lsGet, lsSet, uid } from './utils';
import perms from '../../../shared/permissions';

const state = { principal: null, ready: false };
let snap = { principal: null, ready: false };
const subs = new Set();
function bump() { snap = { principal: state.principal, ready: state.ready }; subs.forEach((f) => f()); }
export const useAuth = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => snap);
export const currentUser = () => state.principal;

export function buildPrincipal(user) {
  if (!user) return null;
  const roleDoc = store.get('roles', user.role);
  const permissions = {};
  perms.PERMISSIONS.forEach((p) => { permissions[p.key] = perms.effectiveLevel(roleDoc, user, p.key); });
  const { passwordHash, ...safe } = user;
  return Object.assign({}, safe, {
    permissions,
    roleLabel: (perms.ROLES[user.role] || {}).label || user.role,
    roleShort: (perms.ROLES[user.role] || {}).short || user.role
  });
}

function setPrincipal(p) {
  state.principal = p;
  store.actor = p ? p.id : null;
  bump();
}

export function can(key, level = 'FULL') {
  const p = state.principal;
  if (!p) return false;
  return perms.hasLevel(p.permissions[key] || 'NONE', level);
}
export const levelOf = (key) => (state.principal ? state.principal.permissions[key] || 'NONE' : 'NONE');

// Live permission updates (matrix edited on another workstation)
const recompute = () => {
  if (!state.principal) return;
  const u = store.get('users', state.principal.id);
  if (u && u.isActive === false) { logout(); events.emit('toast', { type: 'error', text: 'Your account was deactivated by the administrator' }); return; }
  if (u) setPrincipal(buildPrincipal(Object.assign({}, state.principal, u)));
};
store.subscribe('roles', recompute);
store.subscribe('users', recompute);

// ---------------------------------------------------------------- local password hashing (standalone)
async function pbkdf2(password, saltB64, iterations = 120000) {
  const enc = new TextEncoder();
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
export async function hashLocalPassword(password) {
  const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  return 'pbkdf2$120000$' + salt + '$' + (await pbkdf2(password, salt));
}
async function verifyLocal(user, password) {
  if (!user || !user.passwordHash) return false;
  const [, it, salt, hash] = String(user.passwordHash).split('$');
  return (await pbkdf2(String(password || ''), salt, Number(it))) === hash;
}

// ---------------------------------------------------------------- session lifecycle
export async function restoreSession() {
  if (net.mode === 'server') {
    try {
      const r = await api('auth/me');
      if (!r.user) throw new Error('Not signed in');
      setPrincipal(buildPrincipal(Object.assign({}, store.get('users', r.user.id) || {}, r.user)));
      setAuthed(true);
    } catch (e) {
      setPrincipal(null);
    }
  } else {
    const id = lsGet('ssdc-session-user', null);
    const u = id ? store.get('users', id) : null;
    setPrincipal(u && u.isActive !== false ? buildPrincipal(u) : null);
  }
  state.ready = true;
  bump();
}

export async function loginTiles() {
  if (net.mode === 'server') return api('auth/users');
  const s = store.get('settings', 'main');
  return {
    users: store.list('users').filter((u) => u.isActive !== false).map((u) => ({ id: u.id, name: u.name, role: u.role, designation: u.designation, registrationNumber: u.registrationNumber, usesDefaultPassword: !!u.usesDefaultPassword })),
    devRoleSwitcher: !!(s && s.ui && s.ui.devRoleSwitcher !== false)
  };
}

export async function login(userId, password) {
  if (net.mode === 'server') {
    const r = await api('auth/login', { method: 'POST', body: { userId, password } });
    setPrincipal(buildPrincipal(r.user));
    setAuthed(true);
    return state.principal;
  }
  const u = store.get('users', userId);
  if (!u || u.isActive === false || !(await verifyLocal(u, password))) throw new Error('Invalid user or password');
  lsSet('ssdc-session-user', u.id);
  store.put('users', Object.assign({}, u, { lastLogin: Date.now() }));
  setPrincipal(buildPrincipal(store.get('users', u.id)));
  logAudit('auth:login', 'users/' + u.id, {});
  return state.principal;
}

/** <RoleSwitcher /> — one-click identity switch for testing route protection & signature blocks. */
export async function switchUser(userId) {
  if (net.mode === 'server') {
    const r = await api('auth/switch', { method: 'POST', body: { userId } });
    setPrincipal(buildPrincipal(Object.assign({}, store.get('users', userId) || {}, r.user)));
    setAuthed(true);
    return state.principal;
  }
  const s = store.get('settings', 'main');
  if (s && s.ui && s.ui.devRoleSwitcher === false) throw new Error('Dev Role Switcher is disabled in Settings');
  const u = store.get('users', userId);
  if (!u) throw new Error('User not found');
  const from = state.principal ? state.principal.name : '';
  lsSet('ssdc-session-user', u.id);
  setPrincipal(buildPrincipal(u));
  logAudit('auth:dev_role_switch', 'users/' + u.id, { from });
  return state.principal;
}

export async function logout() {
  if (state.principal) await logAudit('auth:logout', 'users/' + state.principal.id, {});
  if (net.mode === 'server') { try { await api('auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ } setAuthed(false); }
  lsSet('ssdc-session-user', null);
  setPrincipal(null);
}

/**
 * Re-enter the signed-in user's password: unlocks an idle-locked workstation (reason 'unlock') or
 * confirms a sensitive admin action (reason 'reauth'). The server refreshes the session.
 */
export async function confirmPassword(password, reason = 'reauth') {
  if (!state.principal) throw new Error('Not signed in');
  if (net.mode === 'server') {
    await api('auth/confirm', { method: 'POST', body: { password, reason } });
    return true;
  }
  const u = store.get('users', state.principal.id);
  if (!(await verifyLocal(u, password))) {
    logAudit('auth:confirm_failed', 'users/' + state.principal.id, { reason });
    throw new Error('Incorrect password');
  }
  logAudit(reason === 'unlock' ? 'auth:session_unlocked' : 'auth:reauthenticated', 'users/' + u.id, {});
  return true;
}

export async function changePassword(current, next) {
  if (net.mode === 'server') return api('auth/change-password', { method: 'POST', body: { current, next } });
  const u = store.get('users', state.principal.id);
  if (!(await verifyLocal(u, current))) throw new Error('Current password is incorrect');
  store.put('users', Object.assign({}, u, { passwordHash: await hashLocalPassword(next), usesDefaultPassword: false, mustChangePassword: false }));
  logAudit('auth:password_changed', 'users/' + u.id, {});
  return { ok: true };
}

/** Clinical & security audit trail (server table in LAN mode, local collection in standalone). */
export async function logAudit(action, targetResource, metadata) {
  const p = state.principal;
  if (net.mode === 'server') {
    try { await api('audit', { method: 'POST', body: { action, targetResource, metadata } }); } catch (e) { /* offline – best effort */ }
    return;
  }
  store.put('audit', {
    id: uid('al_'), actorId: p ? p.id : 'system', actorName: p ? p.name : 'System', actorRole: p ? p.role : 'SYSTEM',
    action, targetResource: targetResource || '', ipAddress: 'local', timestamp: Date.now(), metadata: metadata || {}
  });
}

events.on('auth:expired', () => {
  if (state.principal) { setPrincipal(null); setAuthed(false); events.emit('toast', { type: 'warning', text: 'Session expired — please sign in again' }); }
});
