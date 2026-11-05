/*
 * Shared RBAC definitions — used by the Node server (require) and the browser bundle (import).
 * Hybrid model: every role has a level per permission key (FULL / DRAFT / READ / NONE),
 * and each user may carry customPermissions overrides of the form "key=LEVEL".
 */

const ROLES = {
  SUPER_ADMIN_RADIOLOGIST: {
    name: 'SUPER_ADMIN_RADIOLOGIST',
    label: 'Radiologist (Super Admin)',
    short: 'Radiologist',
    description: 'Unrestricted system access, USG reporting, Form-F PC-PNDT locks, financial analytics and full Admin Console control.',
    color: 'sky'
  },
  CONSULTANT_PATHOLOGIST: {
    name: 'CONSULTANT_PATHOLOGIST',
    label: 'Consultant Pathologist',
    short: 'Pathologist',
    description: 'View, verify and co-sign pathology & hematology reports, manage pathology templates and lock final lab impressions.',
    color: 'rose'
  },
  LAB_TECHNICIAN: {
    name: 'LAB_TECHNICIAN',
    label: 'Senior Lab Technician',
    short: 'Lab Tech',
    description: 'Enter raw laboratory values, manage sample collection queues and submit drafts for pathologist verification.',
    color: 'amber'
  },
  RECEPTION_BILLING: {
    name: 'RECEPTION_BILLING',
    label: 'Front-Desk & Billing',
    short: 'Reception',
    description: 'Patient registration, scheduling, cash/UPI/card invoicing and printing of signed reports.',
    color: 'emerald'
  },
  AUDITOR_VIEW_ONLY: {
    name: 'AUDITOR_VIEW_ONLY',
    label: 'Referring Doctor / Empanelment Auditor',
    short: 'Auditor',
    description: 'Read-only access to assigned reports, billing records and audit logs.',
    color: 'slate'
  }
};

const ROLE_ORDER = [
  'SUPER_ADMIN_RADIOLOGIST',
  'CONSULTANT_PATHOLOGIST',
  'LAB_TECHNICIAN',
  'RECEPTION_BILLING',
  'AUDITOR_VIEW_ONLY'
];

const LEVELS = ['NONE', 'READ', 'DRAFT', 'FULL'];
const LEVEL_RANK = { NONE: 0, READ: 1, DRAFT: 2, FULL: 3 };
const LEVEL_LABEL = { FULL: 'Full Access', DRAFT: 'Draft Only', READ: 'Read-Only', NONE: 'Blocked' };

// spec: true  -> from the clinic's mandated matrix; spec: false -> extra keys needed by other modules
const PERMISSIONS = [
  { key: 'patient:register_and_edit', module: 'Patient Registration', label: 'Register & edit patient demographics', spec: true },
  {
    key: 'patient:delete_records', module: 'Patient Registration', label: 'Delete patient records (recycle bin, restore, permanent delete)', spec: false,
    levels: { READ: 'view the recycle bin', DRAFT: 'move to the recycle bin & restore', FULL: 'also delete permanently' }
  },
  { key: 'usg:create_and_edit_report', module: 'USG Reporting', label: 'Create & edit ultrasound reports', spec: true },
  { key: 'usg:sign_and_lock_report', module: 'USG Reporting', label: 'Digitally sign & lock USG reports', spec: true },
  { key: 'pcpndt:manage_form_f_register', module: 'PC-PNDT Form F', label: 'Manage Form F register', spec: true },
  { key: 'lab:enter_sample_values', module: 'Pathology Lab', label: 'Enter sample / test values', spec: true },
  { key: 'lab:verify_and_sign_report', module: 'Pathology Lab', label: 'Verify & sign lab reports', spec: true },
  { key: 'print:dispatch_signed_reports', module: 'Print & Dispatch', label: 'Print & dispatch signed reports', spec: true },
  { key: 'billing:modify_discounts_refunds', module: 'Billing', label: 'Give discounts / process refunds', spec: true },
  { key: 'admin:manage_roles_and_matrix', module: 'Admin Console', label: 'Manage roles, staff & permission matrix', spec: true },
  { key: 'admin:view_audit_logs', module: 'Admin Console', label: 'View clinical & security audit logs', spec: true },
  // Extended keys used by the integrated suite
  { key: 'billing:create_invoice', module: 'Billing', label: 'Create invoices & collect payments', spec: false },
  { key: 'cashbook:manage_daily_register', module: 'Daily Cash Book', label: 'Daily collection register, expenses & cash drawer', spec: false },
  { key: 'finance:doctor_sharing_and_analytics', module: 'Accounts', label: 'Doctor sharing statements & financial analytics', spec: false },
  { key: 'tariff:manage_rate_list', module: 'Tariff Directory', label: 'Edit master investigation rate list', spec: false },
  { key: 'templates:manage_macros', module: 'Templates & Macros', label: 'Create / edit report templates, macros & dictionary', spec: false },
  { key: 'settings:manage_clinic_and_integrations', module: 'Settings', label: 'Clinic profile, integrations & cloud backup', spec: false }
];

const F = 'FULL', D = 'DRAFT', R = 'READ', N = 'NONE';
//                                      Radiologist Pathologist LabTech Reception Auditor
const row = (a, b, c, d, e) => ({
  SUPER_ADMIN_RADIOLOGIST: a, CONSULTANT_PATHOLOGIST: b, LAB_TECHNICIAN: c, RECEPTION_BILLING: d, AUDITOR_VIEW_ONLY: e
});

const DEFAULT_MATRIX = {
  'patient:register_and_edit':            row(F, N, N, F, N),
  'patient:delete_records':               row(F, N, N, N, N),
  'usg:create_and_edit_report':           row(F, N, N, N, N),
  'usg:sign_and_lock_report':             row(F, N, N, N, N),
  'pcpndt:manage_form_f_register':        row(F, N, N, D, N),
  'lab:enter_sample_values':              row(F, F, F, N, N),
  'lab:verify_and_sign_report':           row(F, F, N, N, N),
  'print:dispatch_signed_reports':        row(F, F, F, F, R),
  'billing:modify_discounts_refunds':     row(F, N, N, N, N),
  'admin:manage_roles_and_matrix':        row(F, N, N, N, N),
  'admin:view_audit_logs':                row(F, N, N, N, R),
  'billing:create_invoice':               row(F, N, N, F, R),
  'cashbook:manage_daily_register':       row(F, N, N, F, R),
  'finance:doctor_sharing_and_analytics': row(F, N, N, N, R),
  'tariff:manage_rate_list':              row(F, R, R, R, R),
  'templates:manage_macros':              row(F, F, R, N, N),
  'settings:manage_clinic_and_integrations': row(F, N, N, N, N)
};

function defaultRolePermissions(roleName) {
  const out = {};
  for (const p of PERMISSIONS) out[p.key] = (DEFAULT_MATRIX[p.key] && DEFAULT_MATRIX[p.key][roleName]) || 'NONE';
  return out;
}

function buildDefaultRoles(now) {
  return ROLE_ORDER.map((name) => ({
    id: name,
    name,
    label: ROLES[name].label,
    description: ROLES[name].description,
    permissions: defaultRolePermissions(name),
    updatedAt: now || 1
  }));
}

/**
 * Resolve the effective level for a permission key.
 * role: role document ({permissions:{key:LEVEL}}) ; user: {role, customPermissions:["key=LEVEL"]}
 */
function effectiveLevel(roleDoc, user, key) {
  if (user && Array.isArray(user.customPermissions)) {
    for (const entry of user.customPermissions) {
      const [k, lvl] = String(entry).split('=');
      if (k === key && LEVEL_RANK[lvl] !== undefined) return lvl;
    }
  }
  const lvl = roleDoc && roleDoc.permissions && roleDoc.permissions[key];
  if (lvl && LEVEL_RANK[lvl] !== undefined) return lvl;
  if (user && DEFAULT_MATRIX[key]) return DEFAULT_MATRIX[key][user.role] || 'NONE';
  return 'NONE';
}

function hasLevel(level, required) {
  return (LEVEL_RANK[level] || 0) >= (LEVEL_RANK[required || 'FULL'] || 3);
}

module.exports = {
  ROLES, ROLE_ORDER, LEVELS, LEVEL_RANK, LEVEL_LABEL, PERMISSIONS, DEFAULT_MATRIX,
  defaultRolePermissions, buildDefaultRoles, effectiveLevel, hasLevel
};
