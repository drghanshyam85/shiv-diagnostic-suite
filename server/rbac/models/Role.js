/*
 * Role model — each role holds a permission map { "resource:action": "FULL"|"DRAFT"|"READ"|"NONE" }.
 */
const { ROLES, PERMISSIONS, LEVEL_RANK, buildDefaultRoles, defaultRolePermissions } = require('../../../shared/permissions');
const { httpError } = require('./User');

const ROLE_SCHEMA = {
  name: 'string (SUPER_ADMIN_RADIOLOGIST | CONSULTANT_PATHOLOGIST | LAB_TECHNICIAN | RECEPTION_BILLING | AUDITOR_VIEW_ONLY)',
  label: 'string',
  description: 'string',
  permissions: 'object { permissionKey: LEVEL }',
  updatedAt: 'number'
};

function createRoleModel(ctx) {
  const { store, saveDoc } = ctx;
  const cache = { at: 0, map: null };

  async function list() {
    const docs = await store.listDocs('roles');
    const byName = {};
    docs.forEach((d) => { byName[d.name] = d; });
    return Object.keys(ROLES).map((name) => byName[name] || buildDefaultRoles().find((r) => r.name === name));
  }

  async function map() {
    if (cache.map && Date.now() - cache.at < 3000) return cache.map;
    const out = {};
    (await list()).forEach((r) => { out[r.name] = r; });
    cache.map = out;
    cache.at = Date.now();
    return out;
  }

  async function get(name) { return (await map())[name] || null; }

  async function updatePermissions(name, permissions, actor) {
    if (!ROLES[name]) throw httpError(404, 'Unknown role ' + name);
    const cur = (await get(name)) || buildDefaultRoles().find((r) => r.name === name);
    const next = Object.assign({}, cur, { permissions: Object.assign({}, cur.permissions) });
    for (const [key, level] of Object.entries(permissions || {})) {
      if (!PERMISSIONS.find((p) => p.key === key)) throw httpError(400, 'Unknown permission ' + key);
      if (LEVEL_RANK[level] === undefined) throw httpError(400, 'Invalid level ' + level);
      next.permissions[key] = level;
    }
    if (name === 'SUPER_ADMIN_RADIOLOGIST' && next.permissions['admin:manage_roles_and_matrix'] !== 'FULL') {
      throw httpError(400, 'The Super Admin must keep admin:manage_roles_and_matrix (lock-out protection)');
    }
    next.updatedAt = Date.now();
    next.updatedBy = actor ? actor.id : null;
    await saveDoc('roles', next, { actor, force: true });
    cache.map = null;
    return next;
  }

  async function resetDefaults(actor) {
    const out = [];
    for (const r of buildDefaultRoles(Date.now())) {
      r.permissions = defaultRolePermissions(r.name);
      r.updatedBy = actor ? actor.id : null;
      await saveDoc('roles', r, { actor, force: true });
      out.push(r);
    }
    cache.map = null;
    return out;
  }

  function invalidate() { cache.map = null; }

  return { ROLE_SCHEMA, list, map, get, updatePermissions, resetDefaults, invalidate };
}

module.exports = { createRoleModel, ROLE_SCHEMA };
