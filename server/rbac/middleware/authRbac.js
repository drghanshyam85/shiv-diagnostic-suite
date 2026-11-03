/*
 * Authentication & RBAC middleware
 *   verifyToken            — validates the JWT (HTTP-only cookie or Bearer header), attaches req.user
 *   attachUser             — same as verifyToken but never rejects (public routes)
 *   requireRole(...roles)  — coarse-grained guard (403 on mismatch)
 *   requirePermission(k,l) — fine-grained guard: role matrix + user customPermissions overrides
 *   enforceReportLock      — blocks edits/deletes of SIGNED_FINAL USG / lab reports unless unlocked
 *   requireRecentAuth      — sensitive admin actions need a password entered within
 *                            Settings → security.adminReauthMinutes (401 REAUTH_REQUIRED otherwise)
 * Sessions last security.sessionHours (default 14 h, one working day); the token's `aat` claim is the
 * time the password was last entered (login, unlock or re-confirmation).
 */
const jwt = require('jsonwebtoken');
const { PERMISSIONS, effectiveLevel, hasLevel, ROLES } = require('../../../shared/permissions');

const COOKIE = 'ssdc_token';
// Fields that may change on a signed report without breaking the clinical lock (dispatch bookkeeping)
const LOCK_EXEMPT_KEYS = ['sent', 'sentLog', 'dispatch', 'printLog', 'printedAt', 'cloud', 'updatedAt', 'updatedBy', '_rev', '_dev'];

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function changedKeys(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  return [...keys].filter((k) => JSON.stringify((a || {})[k]) !== JSON.stringify((b || {})[k]));
}

/** Returns an error message if `incoming` would modify a locked (SIGNED_FINAL) report, else null. */
function checkReportLock(existing, incoming) {
  if (!existing || existing.status !== 'SIGNED_FINAL') return null;
  if (incoming && incoming._deleted) return 'Signed reports cannot be deleted. Unlock with an audit reason first.';
  const changed = changedKeys(existing, incoming).filter((k) => !LOCK_EXEMPT_KEYS.includes(k));
  if (!changed.length) return null;
  return 'Report is SIGNED_FINAL and locked (changed: ' + changed.slice(0, 4).join(', ') + '). The Super Admin must unlock it with an audit reason.';
}

function createAuthRbac(ctx, deps) {
  const { users, roles, jwtSecret } = deps;
  const cache = new Map();

  async function security() {
    const s = await ctx.getSettings();
    const sec = (s && s.security) || {};
    return {
      hours: Math.min(24 * 30, Math.max(1, Number(sec.sessionHours) || 14)),
      reauthMinutes: sec.adminReauthMinutes === 0 ? 0 : Math.max(1, Number(sec.adminReauthMinutes) || 15)
    };
  }

  let cookieHours = 14;
  /** sign(user, { aat, hours }) — aat: when the password was last entered (ms) */
  function sign(user, opts = {}) {
    const hours = opts.hours || cookieHours;
    return jwt.sign({ sub: user.id, role: user.role, name: user.name, tv: user.tokenVersion || 1, aat: opts.aat || Date.now() }, jwtSecret, { expiresIn: Math.round(hours * 3600) });
  }
  /** Same as sign() with the session length from Settings → Security. */
  async function signFor(user, opts = {}) {
    const sec = await security();
    cookieHours = sec.hours;
    return sign(user, Object.assign({ hours: sec.hours }, opts));
  }

  function setCookie(req, res, token) {
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: !!(req.secure || req.headers['x-forwarded-proto'] === 'https'),
      maxAge: cookieHours * 3600 * 1000,
      path: '/'
    });
  }

  function clearCookie(res) { res.clearCookie(COOKIE, { path: '/' }); }

  function readToken(req) {
    const h = req.headers && req.headers.authorization;
    if (h && /^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, '').trim();
    if (req.cookies && req.cookies[COOKIE]) return req.cookies[COOKIE];
    const c = parseCookies(req.headers && req.headers.cookie);
    return c[COOKIE] || null;
  }

  async function principalFor(user) {
    const roleDoc = await roles.get(user.role);
    const permissions = {};
    for (const p of PERMISSIONS) permissions[p.key] = effectiveLevel(roleDoc, user, p.key);
    const safe = users.sanitize(user);
    return Object.assign({}, safe, {
      roleLabel: ROLES[user.role] ? ROLES[user.role].label : user.role,
      permissions,
      can(key, level) { return hasLevel(permissions[key] || 'NONE', level || 'FULL'); }
    });
  }

  async function resolveToken(token) {
    if (!token) return null;
    let payload;
    try { payload = jwt.verify(token, jwtSecret); } catch (e) { return null; }
    const hit = cache.get(payload.sub);
    let user;
    if (hit && Date.now() - hit.at < 3000) user = hit.user;
    else {
      user = await users.getWithSecret(payload.sub);
      cache.set(payload.sub, { at: Date.now(), user });
    }
    if (!user || user.isActive === false) return null;
    if ((user.tokenVersion || 1) !== (payload.tv || 1)) return null;
    const principal = await principalFor(user);
    // when the password was last entered: older tokens have no `aat`, so use their issue time
    Object.defineProperty(principal, 'authAt', { value: Number(payload.aat) || Number(payload.iat) * 1000 || 0, enumerable: false });
    Object.defineProperty(principal, 'sessionExpiresAt', { value: Number(payload.exp) * 1000 || 0, enumerable: false });
    return principal;
  }

  function invalidate(userId) { if (userId) cache.delete(userId); else cache.clear(); }

  const verifyToken = async (req, res, next) => {
    try {
      const principal = await resolveToken(readToken(req));
      if (!principal) return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
      req.user = principal;
      next();
    } catch (e) { next(e); }
  };

  const attachUser = async (req, res, next) => {
    try { req.user = await resolveToken(readToken(req)); } catch (e) { req.user = null; }
    next();
  };

  const requireRole = (...allowed) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: requires role ' + allowed.join(' or '), code: 'ROLE_FORBIDDEN' });
    }
    next();
  };

  const requirePermission = (key, level = 'FULL') => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!req.user.can(key, level)) {
      return res.status(403).json({ error: `Forbidden: requires ${key} (${level})`, code: 'PERMISSION_FORBIDDEN', permission: key, level });
    }
    next();
  };

  /** Sensitive admin actions: the password must have been entered recently (sudo-style re-confirmation). */
  const requireRecentAuth = async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Authentication required' });
      const sec = await security();
      if (!sec.reauthMinutes) return next();
      if (Date.now() - (req.user.authAt || 0) <= sec.reauthMinutes * 60000) return next();
      res.status(401).json({ error: 'Please confirm your password to continue', code: 'REAUTH_REQUIRED', minutes: sec.reauthMinutes });
    } catch (e) { next(e); }
  };

  /** Express middleware for /api/reports/:coll/:id routes */
  const enforceReportLock = async (req, res, next) => {
    try {
      const coll = req.params.coll;
      if (!['reports', 'labReports'].includes(coll)) return res.status(400).json({ error: 'Unknown report collection' });
      const existing = await ctx.store.getDoc(coll, req.params.id);
      const incoming = req.method === 'DELETE' ? Object.assign({}, existing, { _deleted: true }) : req.body;
      const err = checkReportLock(existing, incoming);
      if (err) return res.status(423).json({ error: err, code: 'REPORT_LOCKED' });
      req.existingReport = existing;
      next();
    } catch (e) { next(e); }
  };

  return { COOKIE, sign, signFor, security, setCookie, clearCookie, readToken, resolveToken, principalFor, invalidate, verifyToken, attachUser, requireRole, requirePermission, requireRecentAuth, enforceReportLock, checkReportLock, parseCookies };
}

module.exports = { createAuthRbac, checkReportLock, changedKeys, parseCookies, LOCK_EXEMPT_KEYS };
