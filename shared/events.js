/*
 * Event catalogue shared by the clinic server (require) and the browser bundle (import).
 *
 * Every saved record change is turned into zero or more *domain events* on the server
 * (server/services/automation). Events drive the built-in workflow automations and are delivered to
 * outgoing webhooks. Names are "<area>.<what happened>", past tense, stable — external systems rely
 * on them.
 */
'use strict';

const EVENT_GROUPS = [
  { id: 'registration', label: 'Registration & queue' },
  { id: 'billing', label: 'Billing' },
  { id: 'reporting', label: 'Clinical reporting' },
  { id: 'lab', label: 'Pathology lab' },
  { id: 'dispatch', label: 'Report dispatch' },
  { id: 'images', label: 'Images' },
  { id: 'system', label: 'System' }
];

const EVENT_TYPES = [
  { type: 'patient.registered', group: 'registration', label: 'New patient registered' },
  { type: 'patient.updated', group: 'registration', label: 'Patient details changed' },
  { type: 'patient.deleted', group: 'registration', label: 'Patient record moved to the recycle bin (administrator)' },
  { type: 'patient.restored', group: 'registration', label: 'Patient record restored from the recycle bin' },
  { type: 'patient.purged', group: 'registration', label: 'Patient record deleted permanently' },
  { type: 'visit.created', group: 'registration', label: 'Visit registered, tokens issued' },
  { type: 'queue.called', group: 'registration', label: 'Token called to a room' },
  { type: 'queue.status_changed', group: 'registration', label: 'Queue status changed' },
  { type: 'visit.completed', group: 'registration', label: 'Visit finished (all tests done, bill paid)' },
  { type: 'visit.cancelled', group: 'registration', label: 'Entry cancelled — the patient did not go ahead with the tests' },
  { type: 'visit.restored', group: 'registration', label: 'Cancelled entry restored' },
  { type: 'invoice.created', group: 'billing', label: 'Bill created' },
  { type: 'invoice.updated', group: 'billing', label: 'Bill amount or items changed' },
  { type: 'payment.received', group: 'billing', label: 'Payment received' },
  { type: 'invoice.paid', group: 'billing', label: 'Bill fully paid' },
  { type: 'invoice.cancelled', group: 'billing', label: 'Bill cancelled with its entry' },
  { type: 'invoice.restored', group: 'billing', label: 'Cancelled bill restored' },
  { type: 'report.started', group: 'reporting', label: 'USG / X-ray / ECG report started' },
  { type: 'report.signed', group: 'reporting', label: 'Report signed and locked' },
  { type: 'report.unlocked', group: 'reporting', label: 'Signed report unlocked for amendment' },
  { type: 'formf.finalized', group: 'reporting', label: 'PC-PNDT Form F finalised' },
  { type: 'lab.sample_collected', group: 'lab', label: 'Lab sample collected' },
  { type: 'lab.results_entered', group: 'lab', label: 'Lab results entered (awaiting verification)' },
  { type: 'lab.verified', group: 'lab', label: 'Lab report verified and signed' },
  { type: 'dispatch.sent', group: 'dispatch', label: 'Report / bill sent to the patient' },
  { type: 'dispatch.delivered', group: 'dispatch', label: 'Message delivered' },
  { type: 'dispatch.read', group: 'dispatch', label: 'Message read' },
  { type: 'dispatch.failed', group: 'dispatch', label: 'Message delivery failed' },
  { type: 'image.received', group: 'images', label: 'Scan image arrived in the cloud inbox' },
  { type: 'image.attached', group: 'images', label: 'Inbox image attached to a report' },
  { type: 'webhook.test', group: 'system', label: 'Test event' }
];
const EVENT_TYPE_SET = new Set(EVENT_TYPES.map((e) => e.type));

/**
 * Built-in workflow automations. Each reacts to events, checks the current state and writes only when
 * something actually needs to change, so running it twice does nothing the second time (idempotent).
 */
const AUTOMATIONS = [
  {
    id: 'visit.billing-link', label: 'Link bills to visits', on: ['invoice.created', 'invoice.updated', 'payment.received'], default: true,
    description: 'When a bill is saved (at the desk, in the cash book or by a payment webhook), the visit is marked billed and linked to the bill.'
  },
  {
    id: 'queue.report-started', label: 'Report started → In Scan', on: ['report.started'], default: true,
    description: 'When the doctor starts a USG, X-ray, ECG or Echo report, a waiting patient moves to “In Scan” on every queue screen.'
  },
  {
    id: 'queue.report-signed', label: 'Report signed → Completed', on: ['report.signed'], default: true,
    description: 'When a report is signed, that test is marked Completed in the live queue, even if the signing screen went offline.'
  },
  {
    id: 'queue.lab-progress', label: 'Lab progress → queue', on: ['lab.sample_collected', 'lab.verified'], default: true,
    description: 'Sample collected moves the patient to “In Sample”; a verified lab report marks the lab test Completed.'
  },
  {
    id: 'visit.complete', label: 'Close finished visits', on: ['queue.status_changed', 'invoice.paid', 'payment.received', 'invoice.created'], default: true,
    description: 'When every test of a visit is Completed and its bill is paid, the visit is closed and a visit.completed event is sent.'
  }
];

/** Requests other systems can send to the inbound webhook (POST /api/webhooks/in/<key>). */
const INBOUND_TYPES = [
  { type: 'payment.received', label: 'Payment received (UPI / card gateway, bank)', example: { invoiceNo: 'SSDC-2026-0024', amount: 500, mode: 'upi', reference: 'UTR123456789' } },
  { type: 'visit.status', label: 'Queue status from another system (kiosk, console)', example: { token: 'USG-07', modality: 'USG', status: 'In Scan/Sample' } },
  { type: 'lab.results', label: 'Analyzer / LIS results (pre-filled, a technician still submits)', example: { sampleId: 'S261103-18', values: { cbc: { hb: '12.5', tlc: '7800' } } } },
  { type: 'ping', label: 'Connection test', example: {} }
];

const QUEUE_STATUS = ['Waiting', 'In Scan/Sample', 'Completed'];
const REPORT_MODALITIES = ['USG', 'XRAY', 'ECG', 'ECHO'];
const PAYMENT_MODES = ['cash', 'upi', 'qr', 'card', 'bank'];

module.exports = { EVENT_GROUPS, EVENT_TYPES, EVENT_TYPE_SET, AUTOMATIONS, INBOUND_TYPES, QUEUE_STATUS, REPORT_MODALITIES, PAYMENT_MODES };
