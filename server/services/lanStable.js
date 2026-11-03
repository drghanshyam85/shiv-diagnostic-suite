/*
 * Stable LAN address for the clinic server:
 *   • mDNS responder — answers "<name>.local" (default shiv-clinic.local) with this PC's current LAN IP,
 *     so every workstation keeps one bookmark even when the router hands out a new IP (Windows 10/11,
 *     macOS, iOS, Linux and most Android browsers resolve .local names).
 *   • preferred address — the IP shown in QR codes / links; optional bind to it alone (falls back to all
 *     interfaces when that IP is not present at start-up, so the server never becomes unreachable).
 *   • watcher — detects an IP change, tells every workstation and logs it.
 * Configuration lives on the server (kv 'lanConfig'), not in the synced settings: it is per machine.
 */
const dgram = require('dgram');
const os = require('os');
const { lanAddresses } = require('./lan');

const MDNS_ADDR = '224.0.0.251';
const MDNS_PORT = 5353;
const DEFAULT_CONFIG = { hostname: 'shiv-clinic', mdns: true, preferredAddress: '', bindPreferred: false };
const validHost = (h) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(String(h || ''));

async function getLanConfig(ctx) {
  const cfg = Object.assign({}, DEFAULT_CONFIG, (await ctx.store.kvGet('lanConfig', {})) || {});
  if (!validHost(cfg.hostname)) cfg.hostname = DEFAULT_CONFIG.hostname;
  return cfg;
}
async function setLanConfig(ctx, patch) {
  const cur = await getLanConfig(ctx);
  const next = Object.assign({}, cur);
  if (patch.hostname !== undefined) {
    if (!validHost(patch.hostname)) throw Object.assign(new Error('Name: letters, digits and hyphens only (e.g. shiv-clinic)'), { status: 400 });
    next.hostname = String(patch.hostname).toLowerCase();
  }
  if (patch.mdns !== undefined) next.mdns = !!patch.mdns;
  if (patch.preferredAddress !== undefined) next.preferredAddress = String(patch.preferredAddress || '');
  if (patch.bindPreferred !== undefined) next.bindPreferred = !!patch.bindPreferred;
  await ctx.store.kvSet('lanConfig', next);
  return next;
}

/** Interface details incl. MAC address and netmask (for router DHCP reservation and same-subnet replies). */
function interfaceDetails(port) {
  const list = lanAddresses(port);
  const ifs = os.networkInterfaces();
  return list.map((a) => {
    const raw = (ifs[a.iface] || []).find((x) => x.address === a.address) || {};
    return Object.assign({}, a, { mac: raw.mac || '', netmask: raw.netmask || '' });
  });
}

/** Host to bind: the preferred address when asked and present, otherwise every interface. */
async function chooseBindHost(ctx, envHost, port) {
  if (envHost) return { host: envHost, note: 'HOST environment variable' };
  const cfg = await getLanConfig(ctx);
  if (!cfg.bindPreferred || !cfg.preferredAddress) return { host: '0.0.0.0', note: '' };
  const present = lanAddresses(port).some((a) => a.address === cfg.preferredAddress);
  if (present) return { host: cfg.preferredAddress, note: 'bound to the preferred address' };
  return { host: '0.0.0.0', note: 'preferred address ' + cfg.preferredAddress + ' is not on this PC right now — listening on all interfaces' };
}

// ---------------------------------------------------------------- DNS wire format (A records only)
function encodeName(name) {
  const parts = String(name).split('.').filter(Boolean).map((p) => { const b = Buffer.from(p, 'utf8'); return Buffer.concat([Buffer.from([b.length]), b]); });
  return Buffer.concat(parts.concat([Buffer.from([0])]));
}
function readName(buf, off) {
  const labels = [];
  let pos = off;
  let end = -1;
  for (let guard = 0; guard < 128; guard++) {
    const len = buf[pos];
    if (len === undefined) throw new Error('truncated');
    if ((len & 0xc0) === 0xc0) { if (end < 0) end = pos + 2; pos = ((len & 0x3f) << 8) | buf[pos + 1]; continue; }
    if (len === 0) { if (end < 0) end = pos + 1; break; }
    labels.push(buf.slice(pos + 1, pos + 1 + len).toString('utf8'));
    pos += 1 + len;
  }
  return { name: labels.join('.'), end };
}
function parseQuery(buf) {
  if (buf.length < 12) return null;
  const flags = buf.readUInt16BE(2);
  if (flags & 0x8000) return null; // a response, not a query
  const qd = buf.readUInt16BE(4);
  const qs = [];
  let off = 12;
  for (let i = 0; i < qd; i++) {
    const n = readName(buf, off);
    off = n.end;
    qs.push({ name: n.name, type: buf.readUInt16BE(off), unicast: !!(buf.readUInt16BE(off + 2) & 0x8000) });
    off += 4;
  }
  return { id: buf.readUInt16BE(0), qs };
}
function aRecord(name, ip, ttl = 120) {
  const rr = Buffer.alloc(10);
  rr.writeUInt16BE(1, 0); // A
  rr.writeUInt16BE(0x8001, 2); // IN + cache-flush
  rr.writeUInt32BE(ttl, 4);
  rr.writeUInt16BE(4, 8);
  return Buffer.concat([encodeName(name), rr, Buffer.from(ip.split('.').map(Number))]);
}
function buildResponse({ id = 0, question, answers }) {
  const h = Buffer.alloc(12);
  h.writeUInt16BE(id, 0);
  h.writeUInt16BE(0x8400, 2); // response, authoritative
  h.writeUInt16BE(question ? 1 : 0, 4);
  h.writeUInt16BE(answers.length, 6);
  const parts = [h];
  if (question) { const q = Buffer.alloc(4); q.writeUInt16BE(1, 0); q.writeUInt16BE(1, 2); parts.push(encodeName(question), q); }
  return Buffer.concat(parts.concat(answers));
}
const ipToInt = (ip) => ip.split('.').reduce((n, x) => (n << 8) + Number(x), 0) >>> 0;
function sameSubnet(a, b, mask) { if (!mask) return false; const m = ipToInt(mask); return (ipToInt(a) & m) === (ipToInt(b) & m); }

/**
 * mDNS responder for "<hostname>.local". Returns { stop, status(), refresh() }.
 * getConfig() → current lanConfig; port: HTTP port (only for address listing).
 */
function createMdnsResponder({ getConfig, port, log = console }) {
  let sock = null;
  let state = { active: false, error: '', answered: 0, name: '' };
  let joined = new Set();
  let cfg = Object.assign({}, DEFAULT_CONFIG);

  const pickIp = (fromIp) => {
    const list = interfaceDetails(port).filter((a) => !a.virtual);
    const same = fromIp && list.find((a) => sameSubnet(a.address, fromIp, a.netmask));
    if (same) return same.address;
    const pref = list.find((a) => a.address === cfg.preferredAddress);
    return (pref || list[0] || {}).address || '';
  };
  const join = () => {
    if (!sock) return;
    for (const a of interfaceDetails(port)) {
      if (a.virtual || joined.has(a.address)) continue;
      try { sock.addMembership(MDNS_ADDR, a.address); joined.add(a.address); } catch (e) { /* interface not multicast-capable */ }
    }
  };
  const announce = () => {
    if (!sock || !state.active) return;
    const ip = pickIp('');
    if (!ip) return;
    const pkt = buildResponse({ answers: [aRecord(state.name, ip)] });
    sock.send(pkt, MDNS_PORT, MDNS_ADDR, () => {});
  };

  async function start() {
    cfg = await getConfig();
    stop();
    if (!cfg.mdns) { state = { active: false, error: 'turned off', answered: 0, name: cfg.hostname + '.local' }; return state; }
    state = { active: false, error: '', answered: 0, name: cfg.hostname + '.local' };
    await new Promise((resolve) => {
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('error', (e) => { state.error = e.message; state.active = false; try { sock.close(); } catch (x) { /* closed */ } sock = null; resolve(); });
      sock.on('message', (msg, rinfo) => {
        let q;
        try { q = parseQuery(msg); } catch (e) { return; }
        if (!q) return;
        const hit = q.qs.find((x) => x.name.toLowerCase() === state.name.toLowerCase() && (x.type === 1 || x.type === 255));
        if (!hit) return;
        const ip = pickIp(rinfo.address);
        if (!ip) return;
        state.answered += 1;
        if (rinfo.port !== MDNS_PORT) {
          // legacy unicast query (e.g. nslookup / dig -p 5353): reply directly, echoing id + question
          sock.send(buildResponse({ id: q.id, question: hit.name, answers: [aRecord(hit.name, ip, 10)] }), rinfo.port, rinfo.address, () => {});
        } else if (hit.unicast) {
          sock.send(buildResponse({ answers: [aRecord(state.name, ip)] }), rinfo.port, rinfo.address, () => {});
        } else {
          sock.send(buildResponse({ answers: [aRecord(state.name, ip)] }), MDNS_PORT, MDNS_ADDR, () => {});
        }
      });
      sock.bind(MDNS_PORT, () => {
        try { sock.setMulticastTTL(255); sock.setMulticastLoopback(true); } catch (e) { /* ignore */ }
        joined = new Set();
        join();
        state.active = true;
        announce();
        setTimeout(announce, 1500);
        resolve();
      });
    });
    if (state.error) log.warn('[mdns] ' + state.name + ' not available: ' + state.error);
    return state;
  }
  function stop() {
    if (sock) { try { sock.close(); } catch (e) { /* closed */ } }
    sock = null;
    state.active = false;
  }
  function refresh() { join(); announce(); }
  return { start, stop, refresh, status: () => Object.assign({}, state) };
}

/** Poll the interfaces; on a change, call onChange({ added, removed, addresses }). */
function watchAddresses({ port, onChange, every = 20000 }) {
  const key = () => lanAddresses(port).filter((a) => !a.virtual).map((a) => a.address).sort().join(',');
  let last = key();
  const t = setInterval(() => {
    const now = key();
    if (now === last) return;
    const before = new Set(last ? last.split(',') : []);
    const after = new Set(now ? now.split(',') : []);
    last = now;
    onChange({ added: [...after].filter((x) => !before.has(x)), removed: [...before].filter((x) => !after.has(x)), addresses: lanAddresses(port) });
  }, every);
  t.unref();
  return () => clearInterval(t);
}

module.exports = { getLanConfig, setLanConfig, chooseBindHost, createMdnsResponder, watchAddresses, interfaceDetails, parseQuery, buildResponse, aRecord, DEFAULT_CONFIG };
