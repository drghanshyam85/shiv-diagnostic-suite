// App start-up: open IndexedDB, detect the LAN server, seed standalone data, restore the session.
import { store } from './store';
import { detectServer, initSyncHooks, loadOutbox, setLocalCounters, net } from './sync';
import { restoreSession, hashLocalPassword } from './auth';
import { macros } from './macros';
import { requestPersistence, kvGet, kvSet } from './idb';
import seed from '../../../shared/seed-data';
import perms from '../../../shared/permissions';

async function seedStandalone() {
  const done = await kvGet('seeded', false);
  if (done && !store.isEmpty()) return false;
  const demo = seed.buildDemoData(new Date());
  const hash = await hashLocalPassword(seed.DEFAULT_PASSWORD);
  store.load('settings', [seed.DEFAULT_SETTINGS]);
  store.load('tests', seed.TESTS);
  store.load('doctors', seed.DOCTORS);
  store.load('msgTemplates', seed.MSG_TEMPLATES);
  store.load('roles', perms.buildDefaultRoles(seed.SEED_TIME));
  store.load('users', seed.USERS.map((u) => Object.assign({}, u, { passwordHash: hash, usesDefaultPassword: true })));
  ['patients', 'visits', 'invoices', 'expenses', 'floats', 'reports', 'labReports', 'formf'].forEach((c) => store.load(c, demo[c] || []));
  await setLocalCounters(demo.counters);
  await store.flush();
  await kvSet('seeded', true);
  return true;
}

export async function boot() {
  await store.init();
  await detectServer();
  initSyncHooks();
  await loadOutbox();
  let seeded = false;
  if (net.mode !== 'server') seeded = await seedStandalone();
  await restoreSession();
  requestPersistence();
  macros.init().catch((e) => console.error('macro init failed', e));
  return { mode: net.mode, seeded };
}
