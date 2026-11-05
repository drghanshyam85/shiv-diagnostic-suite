/*
 * Record change → domain events. Called for every document the server saves (from any workstation,
 * an API call, an inbound webhook or an automation). Compares the previous and the new version and
 * reports what *happened*: "a payment arrived", "the report was signed", "the sample was collected".
 * Event data carries identifiers and amounts, never clinical text; patient details are added per
 * webhook only when that endpoint is allowed to receive them.
 */
'use strict';

const { REPORT_MODALITIES } = require('../../../shared/events');

const PATIENT_FIELDS = ['title', 'name', 'mobile', 'address', 'gender', 'age', 'ageUnit', 'guardianName', 'relation', 'email'];
const lastCallAt = (v) => Math.max(0, ...((v && v.calls) || []).map((c) => Number(c.at) || 0));
const tokensOf = (v) => Object.assign({}, (v && v.tokens) || {});
const itemsKey = (inv) => JSON.stringify(((inv && inv.items) || []).map((x) => [x.testId || x.code || x.name, Number(x.amount !== undefined ? x.amount : x.rate) || 0]));

function deriveEvents({ coll, doc, previous }) {
  if (!doc || !doc.id) return [];
  // An administrator deleting a patient (recycle bin), restoring or deleting permanently: one event on the
  // patient, nothing for the linked records — a restore is not a new registration, bill or payment.
  const wasBinned = !!(previous && previous._deleted && previous.deleteBatch);
  if (doc.deleteBatch || wasBinned) {
    if (coll !== 'patients') return [];
    const data = { patientId: doc.id, regId: (previous && previous.regId) || '', batch: doc.deleteBatch || (previous && previous.deleteBatch) || '' };
    if (doc._deleted && doc.purged) return previous && !previous.purged ? [{ type: 'patient.purged', coll, id: doc.id, data }] : [];
    if (doc._deleted) return !previous || !previous._deleted ? [{ type: 'patient.deleted', coll, id: doc.id, data }] : [];
    return [{ type: 'patient.restored', coll, id: doc.id, data }];
  }
  if (doc._deleted) return [];
  const prev = previous && !previous._deleted ? previous : null;
  const out = [];
  const push = (type, data) => out.push({ type, coll, id: doc.id, data: data || {} });

  switch (coll) {
    case 'patients': {
      const base = { patientId: doc.id, regId: doc.regId || '' };
      if (!prev) push('patient.registered', base);
      else {
        const fields = PATIENT_FIELDS.filter((k) => JSON.stringify(prev[k] || '') !== JSON.stringify(doc[k] || ''));
        if (fields.length) push('patient.updated', Object.assign({ fields }, base));
      }
      break;
    }
    case 'visits': {
      const base = { visitId: doc.id, patientId: doc.patientId || '', dateKey: doc.dateKey || '', tokens: tokensOf(doc) };
      if (!prev) {
        push('visit.created', Object.assign({}, base, {
          departments: Object.keys(doc.tokens || {}).filter((k) => k !== 'combined'),
          tests: (doc.tests || []).map((t) => t.code || t.testId || t.name).filter(Boolean),
          obstetric: !!doc.obstetric, referredBy: doc.referredByName || ''
        }));
      } else {
        const a = prev.status || {};
        const b = doc.status || {};
        Object.keys(Object.assign({}, a, b)).forEach((m) => {
          const from = a[m] || 'Waiting';
          const to = b[m] || 'Waiting';
          if (from !== to) push('queue.status_changed', Object.assign({}, base, { modality: m, token: (doc.tokens || {})[m] || '', from, to }));
        });
        const since = lastCallAt(prev);
        (doc.calls || []).filter((c) => (Number(c.at) || 0) > since).forEach((c) => push('queue.called', Object.assign({}, base, { modality: c.modality, token: c.token, at: c.at })));
        if (!prev.closedAt && doc.closedAt) push('visit.completed', Object.assign({}, base, { closedAt: doc.closedAt }));
      }
      break;
    }
    case 'invoices': {
      const base = {
        invoiceId: doc.id, invoiceNo: doc.invoiceNo || '', visitId: doc.visitId || '', patientId: doc.patientId || '',
        regId: (doc.patient && doc.patient.regId) || '', net: Number(doc.net) || 0, paid: Number(doc.paid) || 0,
        balance: Number(doc.balance) || 0, status: doc.status || '', paymentMode: doc.paymentMode || ''
      };
      const before = new Set(((prev && prev.payments) || []).map((p) => p.id));
      if (!prev) push('invoice.created', base);
      else if (Number(prev.net) !== Number(doc.net) || itemsKey(prev) !== itemsKey(doc)) push('invoice.updated', Object.assign({ previousNet: Number(prev.net) || 0 }, base));
      (doc.payments || []).filter((p) => p && p.id && !before.has(p.id) && Number(p.amount) > 0).forEach((p) => {
        push('payment.received', Object.assign({}, base, { paymentId: p.id, amount: Number(p.amount) || 0, mode: p.mode || '', reference: p.ref || p.note || '', source: p.source || 'desk' }));
      });
      if ((!prev || prev.status !== 'PAID') && doc.status === 'PAID') push('invoice.paid', base);
      break;
    }
    case 'reports': {
      const base = {
        reportId: doc.id, visitId: doc.visitId || '', patientId: doc.patientId || '', modality: modalityOfReport(doc),
        examination: (doc.demographics && doc.demographics.modality) || '', status: doc.status || '', version: doc.version || 1, obstetric: !!doc.obstetric
      };
      if (!prev && doc.status !== 'SIGNED_FINAL') push('report.started', base);
      if ((!prev || prev.status !== 'SIGNED_FINAL') && doc.status === 'SIGNED_FINAL') push('report.signed', Object.assign({ signedBy: doc.signedByName || '' }, base));
      if (prev && prev.status === 'SIGNED_FINAL' && doc.status === 'AMENDING') push('report.unlocked', base);
      break;
    }
    case 'labReports': {
      const base = {
        labReportId: doc.id, sampleId: doc.sampleId || '', visitId: doc.visitId || '', patientId: doc.patientId || '',
        status: doc.status || '', tests: (doc.tests || []).map((t) => t.name).filter(Boolean)
      };
      const was = prev ? prev.status : '';
      if (doc.status === 'SAMPLE_COLLECTED' && (!prev || was === 'PENDING')) push('lab.sample_collected', base);
      if (doc.status === 'SUBMITTED' && was !== 'SUBMITTED') push('lab.results_entered', base);
      if (doc.status === 'SIGNED_FINAL' && was !== 'SIGNED_FINAL') push('lab.verified', Object.assign({ verifiedBy: doc.verifiedByName || '' }, base));
      break;
    }
    case 'formf': {
      if ((!prev || prev.status !== 'FINAL') && doc.status === 'FINAL') push('formf.finalized', { formfId: doc.id, sno: doc.snoLabel || doc.sno || '', visitId: doc.visitId || '', patientId: doc.patientId || '' });
      break;
    }
    case 'dispatchLog': {
      const base = {
        dispatchId: doc.id, kind: doc.kind || '', refColl: doc.refColl || '', ref: doc.ref || '', patientId: doc.patientId || '',
        channels: doc.channels || [], deliveryStatus: doc.deliveryStatus || 'sent'
      };
      if (!prev) push('dispatch.sent', base);
      else if (prev.deliveryStatus !== doc.deliveryStatus && ['delivered', 'read', 'failed'].includes(doc.deliveryStatus)) push('dispatch.' + doc.deliveryStatus, base);
      break;
    }
    case 'files': {
      if (doc.kind !== 'image-inbox') break;
      const base = { fileId: doc.id, name: doc.name || '', patientId: doc.patientId || '', visitId: doc.visitId || '', matchedBy: (doc.match && doc.match.by) || '' };
      if (!prev) push('image.received', base);
      else if (prev.status !== 'attached' && doc.status === 'attached') push('image.attached', Object.assign({ reportId: (doc.attachedTo && doc.attachedTo.reportId) || '' }, base));
      break;
    }
    default:
      break;
  }
  return out;
}

/** Which queue department a report belongs to (a visit can have USG and X-ray). */
function modalityOfReport(rep) {
  const text = String((rep.demographics && rep.demographics.modality) || rep.templateKey || '').toLowerCase();
  if (/x-?ray|radiograph|\bxr\b/.test(text)) return 'XRAY';
  if (/\becg\b|electrocardio/.test(text)) return 'ECG';
  if (/\becho\b|echocardio/.test(text)) return 'ECHO';
  return 'USG';
}

module.exports = { deriveEvents, modalityOfReport, REPORT_MODALITIES };
