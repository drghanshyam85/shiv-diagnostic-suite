/*
 * Real-time multi-device synchronisation over the clinic LAN (Socket.io)
 *   server → client : doc:changed, devices:update, locks:update, workstation:open,
 *                     patient:registered, queue:updated, report:draft_saved, report:completed,
 *                     cloud:status, notify
 *   client → server : device:hello, device:route, lock:acquire / lock:heartbeat / lock:release,
 *                     workstation:open, event:emit
 */
const LOCK_TTL = 45000;
const RELAY_EVENTS = new Set(['notify', 'queue:call', 'queue:updated', 'report:draft_saved']);

function setupRealtime(io, ctx, deps) {
  const { auth } = deps;
  const devices = new Map();
  const locks = new Map();

  io.use(async (socket, next) => {
    try {
      const cookies = auth.parseCookies(socket.handshake.headers.cookie);
      const token = (socket.handshake.auth && socket.handshake.auth.token) || cookies[auth.COOKIE];
      const user = await auth.resolveToken(token);
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = { id: user.id, name: user.name, role: user.role };
      next();
    } catch (e) { next(e); }
  });

  const deviceList = () => [...devices.values()].map((d) => ({
    socketId: d.socketId, deviceId: d.deviceId, workstation: d.workstation, user: d.user, ip: d.ip,
    connectedAt: d.connectedAt, route: d.route, ua: d.ua
  }));
  const lockMap = () => {
    const o = {};
    for (const [k, v] of locks) o[k] = { deviceId: v.deviceId, workstation: v.workstation, userId: v.userId, userName: v.userName, since: v.since, socketId: v.socketId };
    return o;
  };
  const emitDevices = () => io.emit('devices:update', deviceList());
  const emitLocks = () => io.emit('locks:update', lockMap());

  io.on('connection', (socket) => {
    const ip = String(socket.handshake.address || '').replace(/^::ffff:/, '');
    devices.set(socket.id, {
      socketId: socket.id, deviceId: '', workstation: 'Workstation', user: socket.data.user, ip,
      connectedAt: Date.now(), route: '', ua: String(socket.handshake.headers['user-agent'] || '').slice(0, 160)
    });

    socket.on('device:hello', (info = {}) => {
      const d = devices.get(socket.id);
      if (!d) return;
      d.deviceId = String(info.deviceId || '').slice(0, 48);
      d.workstation = String(info.workstation || 'Workstation').slice(0, 48);
      d.route = String(info.route || '').slice(0, 120);
      emitDevices();
      socket.emit('locks:update', lockMap());
    });

    socket.on('device:route', (route) => {
      const d = devices.get(socket.id);
      if (d) { d.route = String(route || '').slice(0, 120); emitDevices(); }
    });

    socket.on('lock:acquire', (msg = {}, ack) => {
      const resource = String(msg.resource || '');
      if (!resource) return ack && ack({ ok: false });
      const d = devices.get(socket.id) || {};
      const cur = locks.get(resource);
      if (cur && cur.socketId !== socket.id && Date.now() - cur.beat < LOCK_TTL) {
        return ack && ack({ ok: false, holder: { workstation: cur.workstation, userName: cur.userName, since: cur.since } });
      }
      locks.set(resource, {
        socketId: socket.id, deviceId: d.deviceId, workstation: d.workstation, userId: socket.data.user.id,
        userName: socket.data.user.name, since: cur && cur.socketId === socket.id ? cur.since : Date.now(), beat: Date.now()
      });
      emitLocks();
      if (ack) ack({ ok: true });
    });

    socket.on('lock:heartbeat', (msg = {}) => {
      const cur = locks.get(String(msg.resource || ''));
      if (cur && cur.socketId === socket.id) cur.beat = Date.now();
    });

    socket.on('lock:release', (msg = {}) => {
      const resource = String(msg.resource || '');
      const cur = locks.get(resource);
      if (cur && cur.socketId === socket.id) { locks.delete(resource); emitLocks(); }
    });

    // "Save & Open in Other Workstation"
    socket.on('workstation:open', (msg = {}, ack) => {
      const from = devices.get(socket.id) || {};
      const payload = {
        from: { workstation: from.workstation, userName: socket.data.user.name, deviceId: from.deviceId },
        route: String(msg.route || ''), title: String(msg.title || '').slice(0, 200), note: String(msg.note || '').slice(0, 500),
        patientName: String(msg.patientName || '').slice(0, 120), at: Date.now()
      };
      let sent = 0;
      for (const d of devices.values()) {
        if (d.socketId === socket.id) continue;
        const match = msg.broadcast || (msg.targetDeviceId && d.deviceId === msg.targetDeviceId) || (msg.targetWorkstation && d.workstation === msg.targetWorkstation);
        if (match) { io.to(d.socketId).emit('workstation:open', payload); sent++; }
      }
      if (ack) ack({ ok: true, delivered: sent });
    });

    socket.on('event:emit', (msg = {}) => {
      if (RELAY_EVENTS.has(msg.type)) socket.broadcast.emit(msg.type, Object.assign({}, msg.data || {}, { by: socket.data.user.name }));
    });

    socket.on('disconnect', () => {
      devices.delete(socket.id);
      let changed = false;
      for (const [k, v] of locks) if (v.socketId === socket.id) { locks.delete(k); changed = true; }
      emitDevices();
      if (changed) emitLocks();
    });
  });

  setInterval(() => {
    let changed = false;
    for (const [k, v] of locks) if (Date.now() - v.beat > LOCK_TTL * 1.5) { locks.delete(k); changed = true; }
    if (changed) emitLocks();
  }, 15000).unref();

  ctx.bus.on('change', ({ coll, doc, previous, seq, originSocket }) => {
    const payload = { coll, doc, seq };
    if (originSocket) io.except(originSocket).emit('doc:changed', payload);
    else io.emit('doc:changed', payload);

    if (coll === 'visits' && !doc._deleted) {
      if (!previous) {
        io.emit('patient:registered', {
          visitId: doc.id, patientId: doc.patientId, patientName: doc.patientName || 'Patient', tokens: doc.tokens || {},
          tests: (doc.tests || []).map((t) => t.name), refBy: doc.referredByName || ''
        });
      }
      io.emit('queue:updated', { visitId: doc.id, status: doc.status || {} });
    }
    if (coll === 'reports' && !doc._deleted) {
      const done = doc.status === 'SIGNED_FINAL' && (!previous || previous.status !== 'SIGNED_FINAL');
      io.emit(done ? 'report:completed' : 'report:draft_saved', { kind: 'usg', reportId: doc.id, visitId: doc.visitId, patientName: doc.demographics && doc.demographics.name, status: doc.status });
    }
    if (coll === 'labReports' && !doc._deleted && doc.status === 'SIGNED_FINAL' && (!previous || previous.status !== 'SIGNED_FINAL')) {
      io.emit('report:completed', { kind: 'lab', reportId: doc.id, visitId: doc.visitId, patientName: doc.patient && doc.patient.name, status: doc.status });
    }
  });

  return { devices: deviceList, locks: lockMap };
}

module.exports = { setupRealtime };
