/*
 * AuditLog model — append-only clinical & security trail (PC-PNDT Form F, signed report
 * tampering prevention, UMID claims, logins, permission changes, prints and dispatches).
 */
const AUDIT_SCHEMA = {
  id: 'string',
  actorId: 'string',
  actorName: 'string',
  actorRole: 'string',
  action: 'string (e.g. report:signed, report:unlocked, formf:finalized, invoice:created, auth:login)',
  targetResource: 'string (e.g. reports/rep_123)',
  ipAddress: 'string',
  timestamp: 'number (ms)',
  metadata: 'object'
};

function clientIp(req) {
  if (!req) return '';
  const fwd = req.headers && req.headers['x-forwarded-for'];
  const ip = (fwd ? String(fwd).split(',')[0] : (req.socket && req.socket.remoteAddress) || req.ip || '').trim();
  return ip.replace(/^::ffff:/, '');
}

function createAuditModel(ctx) {
  const { store, bus } = ctx;

  async function log(reqOrActor, action, targetResource, metadata) {
    const req = reqOrActor && reqOrActor.headers ? reqOrActor : null;
    const actor = req ? req.user : reqOrActor;
    const entry = await store.addAudit({
      actorId: actor ? actor.id : 'system',
      actorName: actor ? actor.name : 'System',
      actorRole: actor ? actor.role : 'SYSTEM',
      action,
      targetResource: targetResource || '',
      ipAddress: req ? clientIp(req) : (metadata && metadata.ip) || '',
      timestamp: Date.now(),
      metadata: metadata || {}
    });
    bus.emit('audit', entry);
    return entry;
  }

  async function query(filters) { return store.queryAudit(filters || {}); }

  function toCSV(rows) {
    const esc = (v) => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
    const head = ['Timestamp', 'Actor', 'Role', 'Action', 'Target Resource', 'IP Address', 'Metadata'];
    const lines = [head.map(esc).join(',')];
    for (const r of rows) {
      lines.push([new Date(r.timestamp).toISOString(), r.actorName, r.actorRole, r.action, r.targetResource, r.ipAddress, JSON.stringify(r.metadata || {})].map(esc).join(','));
    }
    return '﻿' + lines.join('\r\n');
  }

  return { AUDIT_SCHEMA, log, query, toCSV, clientIp };
}

module.exports = { createAuditModel, AUDIT_SCHEMA, clientIp };
