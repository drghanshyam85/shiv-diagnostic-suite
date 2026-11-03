/*
 * First-run seeding: 5 clinic roles + named staff profiles (Dr. Ghanshyam Kumawat, Dr. Rishabh Kumar,
 * Yogesh, reception desks, auditor) and — when the database is empty — the master tariff,
 * referring doctors, returning patients, message templates and demo transactions.
 */
const bcrypt = require('bcryptjs');
const seed = require('../../shared/seed-data');
const { buildDefaultRoles } = require('../../shared/permissions');

async function seedRbac(ctx) {
  const { store } = ctx;
  let created = 0;
  for (const role of buildDefaultRoles(seed.SEED_TIME)) {
    if (!(await store.getDoc('roles', role.id))) { await store.putDoc('roles', role); created++; }
  }
  const hash = bcrypt.hashSync(seed.DEFAULT_PASSWORD, 10);
  for (const u of seed.USERS) {
    if (!(await store.getDoc('users', u.id))) {
      await store.putDoc('users', Object.assign({}, u, { passwordHash: hash, tokenVersion: 1, usesDefaultPassword: true }));
      created++;
    }
  }
  return created;
}

async function seedClinicData(ctx) {
  const { store } = ctx;
  const meta = await store.kvGet('seed', null);
  if (meta && meta.done) return 0;
  const existingTests = await store.countDocs('tests');
  let n = 0;
  if (!existingTests) {
    const put = async (coll, docs) => { for (const d of docs) { await store.putDoc(coll, d); n++; } };
    await put('settings', [seed.DEFAULT_SETTINGS]);
    await put('tests', seed.TESTS);
    await put('doctors', seed.DOCTORS);
    await put('msgTemplates', seed.MSG_TEMPLATES);
    // DEMO_DATA=false starts with an empty register (no sample patients, bills or reports)
    const demo = /^(0|false|no|off)$/i.test(String(process.env.DEMO_DATA || '')) ? { patients: [], visits: [], invoices: [], expenses: [], floats: [], reports: [], labReports: [], formf: [], counters: {} } : seed.buildDemoData(new Date());
    await put('patients', demo.patients);
    await put('visits', demo.visits);
    await put('invoices', demo.invoices);
    await put('expenses', demo.expenses);
    await put('floats', demo.floats);
    await put('reports', demo.reports);
    await put('labReports', demo.labReports);
    await put('formf', demo.formf);
    for (const [k, v] of Object.entries(demo.counters)) await store.setCounter(k, v);
  }
  await store.kvSet('seed', { done: true, at: Date.now(), version: 1 });
  return n;
}

module.exports = { seedRbac, seedClinicData };
