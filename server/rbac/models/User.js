/*
 * User model — clinic staff with role, registration number (RMC/RPMC), digital signature and
 * per-user permission overrides. Stored in the document store (collection "users").
 */
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { ROLES } = require('../../../shared/permissions');

const USER_SCHEMA = {
  id: 'string',
  name: 'string',
  email: 'string',
  phone: 'string',
  passwordHash: 'string',
  role: 'string (ROLE name)',
  registrationNumber: 'string (RMC / RPMC)',
  qualification: 'string',
  designation: 'string',
  digitalSignatureUrl: 'string (PNG data URL)',
  isActive: 'boolean',
  customPermissions: 'string[] ("permission:key=LEVEL")',
  mustChangePassword: 'boolean',
  tokenVersion: 'number (bumped to invalidate sessions)',
  lastLogin: 'number|null',
  updatedAt: 'number'
};

const EDITABLE = ['name', 'email', 'phone', 'role', 'registrationNumber', 'qualification', 'designation', 'digitalSignatureUrl', 'isActive', 'customPermissions', 'mustChangePassword'];

function createUserModel(ctx) {
  const { store, saveDoc } = ctx;

  function sanitize(u) {
    if (!u) return null;
    const { passwordHash, ...rest } = u;
    return rest;
  }

  async function list() {
    const all = await store.listDocs('users');
    return all.map(sanitize).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  async function getWithSecret(id) { return store.getDoc('users', id); }
  async function get(id) { return sanitize(await getWithSecret(id)); }

  function validate(data, partial) {
    if (!partial || data.name !== undefined) {
      if (!data.name || String(data.name).trim().length < 2) throw httpError(400, 'Staff name is required');
    }
    if (!partial || data.role !== undefined) {
      if (!ROLES[data.role]) throw httpError(400, 'Invalid role: ' + data.role);
    }
    if (data.digitalSignatureUrl && String(data.digitalSignatureUrl).length > 600000) throw httpError(413, 'Signature image too large (max ~400 KB)');
    if (data.customPermissions && !Array.isArray(data.customPermissions)) throw httpError(400, 'customPermissions must be an array');
  }

  async function create(data, actor) {
    validate(data, false);
    const id = data.id || 'u_' + crypto.randomBytes(5).toString('hex');
    if (await store.getDoc('users', id)) throw httpError(409, 'User id already exists');
    const doc = {
      id, name: String(data.name).trim(), email: data.email || '', phone: data.phone || '', role: data.role,
      registrationNumber: data.registrationNumber || '', qualification: data.qualification || '', designation: data.designation || '',
      digitalSignatureUrl: data.digitalSignatureUrl || '', isActive: data.isActive !== false,
      customPermissions: data.customPermissions || [], mustChangePassword: data.password ? false : true,
      tokenVersion: 1, lastLogin: null,
      passwordHash: bcrypt.hashSync(String(data.password || '1234'), 10),
      updatedAt: Date.now(), updatedBy: actor ? actor.id : null
    };
    await saveDoc('users', doc, { actor, force: true });
    return sanitize(doc);
  }

  async function update(id, patch, actor) {
    const cur = await getWithSecret(id);
    if (!cur) throw httpError(404, 'User not found');
    validate(patch, true);
    const next = Object.assign({}, cur);
    for (const k of EDITABLE) if (patch[k] !== undefined) next[k] = patch[k];
    if (patch.isActive === false || (patch.role && patch.role !== cur.role)) next.tokenVersion = (cur.tokenVersion || 1) + 1;
    next.updatedAt = Date.now();
    next.updatedBy = actor ? actor.id : null;
    await saveDoc('users', next, { actor, force: true });
    return sanitize(next);
  }

  async function setPassword(id, password, actor, opts = {}) {
    const cur = await getWithSecret(id);
    if (!cur) throw httpError(404, 'User not found');
    if (!password || String(password).length < 4) throw httpError(400, 'Password must be at least 4 characters');
    const next = Object.assign({}, cur, {
      passwordHash: bcrypt.hashSync(String(password), 10),
      mustChangePassword: !!opts.forceChange,
      tokenVersion: opts.keepSessions ? cur.tokenVersion || 1 : (cur.tokenVersion || 1) + 1,
      updatedAt: Date.now(), updatedBy: actor ? actor.id : null
    });
    await saveDoc('users', next, { actor, force: true });
    return sanitize(next);
  }

  async function verifyPassword(user, password) {
    if (!user || !user.passwordHash) return false;
    return bcrypt.compare(String(password || ''), user.passwordHash);
  }

  async function touchLogin(id) {
    const cur = await getWithSecret(id);
    if (!cur) return;
    await saveDoc('users', Object.assign({}, cur, { lastLogin: Date.now(), updatedAt: Date.now() }), { force: true });
  }

  return { USER_SCHEMA, list, get, getWithSecret, create, update, setPassword, verifyPassword, touchLogin, sanitize };
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

module.exports = { createUserModel, USER_SCHEMA, httpError };
