#!/usr/bin/env node
/*
 * Shiv Sonography and Diagnostic Center — Clinic Suite server
 * Multi-device LAN server (binds 0.0.0.0) + cloud-ready (Render / Railway / any Node host).
 *
 *   npm install
 *   npm start                 → http://localhost:3000  and  http://<LAN-IP>:3000
 *
 * Environment (or a .env file, see .env.example): PORT, HOST, DATA_DIR, JWT_SECRET, DEMO_DATA, DATABASE_URL
 * (postgres, optional), GEMINI_API_KEY, SMTP_USER / SMTP_PASS, SOFFICE_PATH
 */
const path = require('path');
const fs = require('fs');

// optional .env next to server.js (KEY=value lines, see .env.example); real environment variables win
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[2] !== '' && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch (e) { /* no .env file */ }
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const { openStore } = require('./server/db');
const { createContext } = require('./server/context');
const { createUserModel } = require('./server/rbac/models/User');
const { createRoleModel } = require('./server/rbac/models/Role');
const { createAuditModel } = require('./server/rbac/models/AuditLog');
const { createAuthRbac } = require('./server/rbac/middleware/authRbac');
const { authRoutes } = require('./server/rbac/routes/auth.routes');
const { adminRbacRoutes } = require('./server/rbac/routes/adminRbac.routes');
const { seedRbac, seedClinicData } = require('./server/rbac/seed');
const { syncRoutes } = require('./server/routes/sync.routes');
const { filesRoutes } = require('./server/routes/files.routes');
const { publicRoutes } = require('./server/routes/public.routes');
const { dispatchRoutes } = require('./server/routes/dispatch.routes');
const { cloudRoutes } = require('./server/routes/cloud.routes');
const { aiRoutes } = require('./server/routes/ai.routes');
const { webhookRoutes } = require('./server/routes/webhooks.routes');
const { createCloudEngine } = require('./server/services/cloud/engine');
const { createImageInbox } = require('./server/services/imageInbox');
const { createAutomation } = require('./server/services/automation/engine');
const { automationRoutes } = require('./server/routes/automation.routes');
const { imagesRoutes } = require('./server/routes/images.routes');
const { lanAddresses } = require('./server/services/lan');
const { getLanConfig, setLanConfig, chooseBindHost, createMdnsResponder, watchAddresses, interfaceDetails } = require('./server/services/lanStable');
const { setupRealtime } = require('./server/realtime');
const pkg = require('./package.json');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');

function loadOrCreateSecret(dir) {
  const f = path.join(dir, '.jwt-secret');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch (e) { /* create */ }
  const s = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}

async function main() {
  const store = await openStore(DATA_DIR);
  const ctx = createContext({ store, dataDir: DATA_DIR });
  const jwtSecret = process.env.JWT_SECRET || loadOrCreateSecret(DATA_DIR);

  const users = createUserModel(ctx);
  const roles = createRoleModel(ctx);
  const audit = createAuditModel(ctx);
  const auth = createAuthRbac(ctx, { users, roles, jwtSecret });

  const seededRbac = await seedRbac(ctx);
  const seededData = await seedClinicData(ctx);

  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 5e6, cors: { origin: true, credentials: true } });

  app.use(compression());
  app.use(cookieParser());
  // delivery-receipt webhooks need the exact bytes to check the provider's signature
  app.use(express.json({ limit: '40mb', verify: (req, res, buf) => { if (req.url.startsWith('/api/webhooks/')) req.rawBody = buf; } }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  let instanceId = await store.kvGet('instanceId', null);
  if (!instanceId) { instanceId = crypto.randomBytes(8).toString('hex'); await store.kvSet('instanceId', instanceId); }
  app.get('/api/health', (req, res) => res.json({
    ok: true, app: 'ssdc-suite', version: pkg.version, db: store.kind, time: Date.now(), hostname: os.hostname(), instanceId
  }));

  const engine = createCloudEngine(ctx, io);
  const imageInbox = createImageInbox(ctx);
  // event-driven workflows: every saved change → domain events → automations + outgoing webhooks
  const automation = createAutomation(ctx, { io, audit });
  const files = filesRoutes(ctx, { auth, audit });
  const pub = publicRoutes(ctx, { auth, audit, files });

  app.use('/api/auth', authRoutes(ctx, { users, audit, auth }));
  app.use('/api', adminRbacRoutes(ctx, { users, roles, audit, auth, io }));
  app.use('/api', syncRoutes(ctx, { auth, audit, users }));
  app.use('/api', files.router);
  app.use('/api', pub.api);
  app.use('/api', dispatchRoutes(ctx, { auth, audit, files }));
  app.use('/api', cloudRoutes(ctx, { auth, audit, engine }));
  app.use('/api', imagesRoutes(ctx, { auth, audit, inbox: imageInbox }));
  app.use('/api', automationRoutes(ctx, { auth, audit, automation }));
  app.use('/api', aiRoutes(ctx, { auth }));
  app.use('/api', webhookRoutes(ctx, { audit, io }).router);

  let realtime = null;
  const bind = await chooseBindHost(ctx, process.env.HOST, PORT);
  const mdns = createMdnsResponder({ getConfig: () => getLanConfig(ctx), port: PORT });
  async function lanInfo() {
    const cfg = await getLanConfig(ctx);
    const addresses = interfaceDetails(PORT);
    const preferred = addresses.find((a) => a.address === cfg.preferredAddress) || addresses.find((a) => !a.virtual) || null;
    const m = mdns.status();
    return {
      hostname: os.hostname(), port: PORT, platform: os.platform(), addresses,
      devices: realtime ? realtime.devices() : [], db: store.kind, dataDir: DATA_DIR, uptime: process.uptime(),
      config: cfg, bind, mdns: m, preferredUrl: preferred ? preferred.url : '', stableUrl: m.active ? 'http://' + m.name + ':' + PORT : '',
      hostnameUrl: 'http://' + os.hostname() + ':' + PORT, preferredMissing: !!(cfg.preferredAddress && !addresses.some((a) => a.address === cfg.preferredAddress))
    };
  }
  app.get('/api/lan/info', auth.verifyToken, async (req, res, next) => { try { res.json(await lanInfo()); } catch (e) { next(e); } });
  // per-machine network settings: .local name, preferred address, bind to it (restart), mDNS on/off
  app.put('/api/lan/config', auth.verifyToken, auth.requirePermission('settings:manage_clinic_and_integrations', 'FULL'), auth.requireRecentAuth, async (req, res, next) => {
    try {
      const cfg = await setLanConfig(ctx, req.body || {});
      await mdns.start();
      await audit.log(req, 'settings:lan_config_changed', 'lanConfig', cfg);
      const want = cfg.bindPreferred && cfg.preferredAddress && lanAddresses(PORT).some((a) => a.address === cfg.preferredAddress) ? cfg.preferredAddress : '0.0.0.0';
      res.json(Object.assign(await lanInfo(), { restartNeeded: !process.env.HOST && want !== bind.host }));
    } catch (e) { next(e); }
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found: ' + req.method + ' ' + req.originalUrl }));

  app.use(pub.root);
  app.get('/p/:shareId', (req, res) => res.redirect('/#/p/' + encodeURIComponent(req.params.shareId)));
  app.use(express.static(PUBLIC_DIR, {
    index: 'index.html',
    setHeaders(res, file) {
      if (file.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      else if (file.includes(path.sep + 'vendor' + path.sep) || file.includes('fonts')) res.setHeader('Cache-Control', 'public, max-age=604800');
      else res.setHeader('Cache-Control', 'no-cache');
    }
  }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    if (status >= 500) console.error('[error]', req.method, req.originalUrl, err);
    res.status(status).json({ error: err.message || 'Server error' });
  });

  realtime = setupRealtime(io, ctx, { auth });
  engine.start();
  imageInbox.start();
  automation.start().catch((e) => console.error('[automation] could not start:', e.message));
  // the server PC's address changed (DHCP): tell every workstation, re-announce the .local name
  const stopWatch = watchAddresses({
    port: PORT,
    onChange: async (c) => {
      mdns.refresh();
      const urls = c.addresses.filter((a) => !a.virtual).map((a) => a.url);
      console.warn('[lan] network address changed — now ' + (urls.join(', ') || 'no LAN address'));
      const m = mdns.status();
      io.emit('lan:changed', { added: c.added, removed: c.removed, urls, stableUrl: m.active ? 'http://' + m.name + ':' + PORT : '' });
      await audit.log({ id: 'system', name: 'LAN watcher', role: 'SYSTEM' }, 'lan:address_changed', 'lan', { added: c.added, removed: c.removed });
    }
  });

  server.listen(PORT, bind.host, async () => {
    await mdns.start();
    const lan = lanAddresses(PORT).filter((a) => !a.virtual);
    const line = '─'.repeat(66);
    console.log('\n' + line);
    console.log('  Shiv Sonography and Diagnostic Center — Clinic Suite v' + pkg.version);
    console.log(line);
    if (bind.host === '0.0.0.0' || bind.host === '127.0.0.1' || bind.host === 'localhost') console.log('  Local       : http://localhost:' + PORT);
    lan.forEach((a) => console.log(('  LAN (' + a.iface + ')').padEnd(14) + ': ' + a.url));
    const ms = mdns.status();
    if (ms.active) console.log('  Stable name : http://' + ms.name + ':' + PORT + '   (keeps working if the router changes the IP)');
    if (bind.note) console.log('  Binding     : ' + bind.host + ' — ' + bind.note);
    console.log('  Database    : ' + store.kind + '  (' + DATA_DIR + ')');
    if (seededRbac || seededData) console.log('  First run   : seeded ' + seededRbac + ' roles/staff, ' + seededData + ' clinic records');
    console.log('  Default login password for all seeded staff: 1234 (change it in Admin Console)');
    console.log(line);
    if (lan[0] && process.stdout.isTTY !== false) {
      try {
        const qr = await QRCode.toString(lan[0].url, { type: 'terminal', small: true });
        console.log('  Scan to open on a phone / tablet connected to the clinic Wi-Fi:\n');
        console.log(qr);
      } catch (e) { /* ignore */ }
    }
  });

  const shutdown = () => {
    console.log('\nShutting down…');
    engine.stop();
    mdns.stop();
    stopWatch();
    io.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('Fatal startup error:', e);
  process.exit(1);
});
