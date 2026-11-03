/*
 * Authentication routes: login tiles, login/logout, current principal, dev role switcher, password change.
 */
const express = require('express');

function authRoutes(ctx, deps) {
  const { users, audit, auth } = deps;
  const router = express.Router();
  const attempts = new Map();

  function throttled(ip) {
    const now = Date.now();
    const list = (attempts.get(ip) || []).filter((t) => now - t < 60000);
    attempts.set(ip, list);
    return list.length >= 8;
  }

  // Login screen tiles (no secrets)
  router.get('/users', async (req, res, next) => {
    try {
      const list = await users.list();
      const settings = await ctx.getSettings();
      res.json({
        users: list.filter((u) => u.isActive !== false).map((u) => ({
          id: u.id, name: u.name, role: u.role, designation: u.designation, registrationNumber: u.registrationNumber,
          usesDefaultPassword: !!u.usesDefaultPassword
        })),
        devRoleSwitcher: !!(settings.ui && settings.ui.devRoleSwitcher)
      });
    } catch (e) { next(e); }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const ip = audit.clientIp(req);
      if (throttled(ip)) return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
      const { userId, password } = req.body || {};
      const user = await users.getWithSecret(String(userId || ''));
      const ok = user && user.isActive !== false && (await users.verifyPassword(user, password));
      if (!ok) {
        attempts.get(ip).push(Date.now());
        await audit.log({ id: userId || 'unknown', name: user ? user.name : String(userId), role: user ? user.role : '' }, 'auth:login_failed', 'users/' + (userId || ''), { ip });
        return res.status(401).json({ error: 'Invalid user or password' });
      }
      await users.touchLogin(user.id);
      const fresh = await users.getWithSecret(user.id);
      const token = await auth.signFor(fresh);
      auth.setCookie(req, res, token);
      const principal = await auth.principalFor(fresh);
      req.user = principal;
      await audit.log(req, 'auth:login', 'users/' + user.id, { ua: req.headers['user-agent'] || '' });
      res.json({ user: principal, token });
    } catch (e) { next(e); }
  });

  router.post('/logout', auth.attachUser, async (req, res, next) => {
    try {
      if (req.user) await audit.log(req, 'auth:logout', 'users/' + req.user.id, {});
      auth.clearCookie(res);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // 200 with user:null when signed out, so opening the app does not log a failed request
  router.get('/me', auth.attachUser, (req, res) => {
    res.json({ user: req.user || null, session: req.user ? { expiresAt: req.user.sessionExpiresAt, authAt: req.user.authAt } : null });
  });

  /**
   * Re-enter the password of the signed-in user: unlocks an idle-locked workstation or confirms a
   * sensitive admin action (refreshes the token's password time). Throttled and audited.
   */
  router.post('/confirm', auth.verifyToken, async (req, res, next) => {
    try {
      const ip = audit.clientIp(req);
      if (throttled(ip)) return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
      const reason = (req.body || {}).reason === 'unlock' ? 'unlock' : 'reauth';
      const user = await users.getWithSecret(req.user.id);
      if (!user || !(await users.verifyPassword(user, (req.body || {}).password))) {
        attempts.get(ip).push(Date.now());
        await audit.log(req, 'auth:confirm_failed', 'users/' + req.user.id, { reason, ip });
        return res.status(401).json({ error: 'Incorrect password', code: 'CONFIRM_FAILED' });
      }
      const token = await auth.signFor(user, { aat: Date.now() });
      auth.setCookie(req, res, token);
      await audit.log(req, reason === 'unlock' ? 'auth:session_unlocked' : 'auth:reauthenticated', 'users/' + req.user.id, {});
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // <RoleSwitcher /> dev-testing toolbar — only while Settings → Dev Role Switcher is ON
  router.post('/switch', auth.attachUser, async (req, res, next) => {
    try {
      const settings = await ctx.getSettings();
      if (!(settings.ui && settings.ui.devRoleSwitcher)) return res.status(403).json({ error: 'Dev Role Switcher is disabled in Settings' });
      const target = await users.getWithSecret(String((req.body || {}).userId || ''));
      if (!target || target.isActive === false) return res.status(404).json({ error: 'User not found or inactive' });
      const token = await auth.signFor(target);
      auth.setCookie(req, res, token);
      const from = req.user ? req.user.name : 'anonymous';
      req.user = await auth.principalFor(target);
      await audit.log(req, 'auth:dev_role_switch', 'users/' + target.id, { from });
      res.json({ user: req.user, token });
    } catch (e) { next(e); }
  });

  router.post('/change-password', auth.verifyToken, async (req, res, next) => {
    try {
      const { current, next: nextPassword } = req.body || {};
      const user = await users.getWithSecret(req.user.id);
      if (!(await users.verifyPassword(user, current))) return res.status(400).json({ error: 'Current password is incorrect' });
      await users.setPassword(req.user.id, nextPassword, req.user, { keepSessions: false });
      const fresh = await users.getWithSecret(req.user.id);
      fresh.usesDefaultPassword = false;
      await ctx.saveDoc('users', Object.assign({}, fresh, { updatedAt: Date.now() }), { force: true });
      const token = await auth.signFor(fresh);
      auth.setCookie(req, res, token);
      auth.invalidate(req.user.id);
      await audit.log(req, 'auth:password_changed', 'users/' + req.user.id, {});
      res.json({ ok: true, token });
    } catch (e) { next(e); }
  });

  return router;
}

module.exports = { authRoutes };
