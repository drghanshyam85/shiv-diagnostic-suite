/*
 * "Start fresh": find the demo records seeded on first run (sample patients, visits, bills,
 * expenses, reports, lab reports, Form F, opening floats and their dispatch log rows) and the
 * document counters implied by what remains — so the first real bill is SSDC-<year>-0001 again,
 * patient IDs restart after the last real patient and today's tokens restart at 01.
 * Shared by the server endpoint (POST /api/admin/demo-data/clear) and the standalone build.
 */
const { SEED_TIME } = require('./seed-data');

const DEMO_COLLS = ['patients', 'visits', 'invoices', 'expenses', 'floats', 'reports', 'labReports', 'formf', 'dispatchLog'];
const COUNTER_RE = /^(patient|inv-\d{4}|formf-\d{4}|token-\d{4}-\d{2}-\d{2}-[A-Z]+)$/;

function isDemoDoc(coll, d) {
  if (!d || d._deleted) return false;
  if (/_demo_/.test(String(d.id || ''))) return true;
  if (coll === 'floats') return Number(d.updatedAt) === SEED_TIME;
  if (coll === 'dispatchLog') return /_demo_/.test(String(d.ref || ''));
  return false;
}

/** docs: { coll: [doc] } → { remove: { coll: [id] }, keptPatients: [id], total } */
function planDemoCleanup(docs) {
  const remove = {};
  DEMO_COLLS.forEach((c) => { remove[c] = (docs[c] || []).filter((d) => isDemoDoc(c, d)).map((d) => d.id); });
  // a demo patient who has since been registered or billed for real stays in the master list
  const realRefs = new Set();
  ['visits', 'invoices', 'reports', 'labReports', 'formf'].forEach((c) => (docs[c] || []).forEach((d) => {
    if (!d._deleted && !isDemoDoc(c, d) && d.patientId) realRefs.add(d.patientId);
  }));
  const keptPatients = remove.patients.filter((id) => realRefs.has(id));
  remove.patients = remove.patients.filter((id) => !realRefs.has(id));
  const total = Object.values(remove).reduce((s, ids) => s + ids.length, 0);
  return { remove, keptPatients, total };
}

/** Counter values implied by the remaining records. existing: { key: value } of current counters. */
function countersAfter(docs, remove, existing) {
  const gone = {};
  Object.keys(remove).forEach((c) => { gone[c] = new Set(remove[c]); });
  const alive = (c) => (docs[c] || []).filter((d) => !d._deleted && !(gone[c] && gone[c].has(d.id)));
  const out = {};
  Object.keys(existing || {}).forEach((k) => { if (COUNTER_RE.test(k)) out[k] = 0; });
  const bump = (k, n) => { if (Number.isFinite(n) && n > (out[k] || 0)) out[k] = n; };
  alive('patients').forEach((p) => { const m = /(\d+)$/.exec(p.regId || ''); if (m) bump('patient', Number(m[1])); });
  alive('invoices').forEach((i) => { const m = /-(\d{4})-(\d+)$/.exec(i.invoiceNo || ''); if (m) bump('inv-' + m[1], Number(m[2])); });
  alive('formf').forEach((f) => { const m = /^(\d{4})\//.exec(f.snoLabel || ''); if (m && f.sno) bump('formf-' + m[1], Number(f.sno)); });
  alive('visits').forEach((v) => Object.entries(v.tokens || {}).forEach(([mod, tok]) => {
    bump('token-' + v.dateKey + '-' + (mod === 'combined' ? 'ALL' : mod), Number(String(tok).replace(/\D/g, '')));
  }));
  return out;
}

module.exports = { DEMO_COLLS, isDemoDoc, planDemoCleanup, countersAfter };
