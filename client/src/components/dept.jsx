// Department identity: colour-coded SVG logos for Ultrasound, Pathology, Biochemistry, X-Ray, ECG, Echo
// plus the centre's brand mark. SVG strings are also exported for print/PDF templates.
import { cx } from './ui';

const PATHS = {
  Ultrasound: '<path d="M7 3h4v6.5a2 2 0 0 1-2 2 2 2 0 0 1-2-2V3z"/><path d="M8 11.5v2.5"/><path d="M5.2 16.4a5 5 0 0 0 7.6 0"/><path d="M3.4 18.6a8 8 0 0 0 11.2 0"/><path d="M15 6.5c1.4.9 2.3 2.4 2.3 4.1"/><path d="M17.4 4.2c2.2 1.5 3.6 3.9 3.6 6.6"/>',
  Pathology: '<path d="M9 3h4"/><path d="M10 3v3.5l-1.2 1.1a1.6 1.6 0 0 0 0 2.3l.9.8a1.6 1.6 0 0 0 2.3 0l1.1-1.2"/><path d="M13.6 9.6 16 12"/><path d="M5 21h11"/><path d="M8 21v-2a6 6 0 0 1 8.6-5.4"/><path d="M18.5 13.2s-2 2.3-2 3.6a2 2 0 0 0 4 0c0-1.3-2-3.6-2-3.6z"/>',
  Biochemistry: '<path d="M9 3h6"/><path d="M10 3v6.2L4.8 18.1A1.9 1.9 0 0 0 6.4 21h11.2a1.9 1.9 0 0 0 1.6-2.9L14 9.2V3"/><path d="M7 15h10"/><circle cx="10" cy="17.6" r=".9"/><circle cx="13.6" cy="18.3" r=".7"/><circle cx="12.2" cy="13" r=".6"/>',
  'X-Ray': '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M12 6v12"/><path d="M8 8.5c1.2-.7 2.6-.9 4-.6"/><path d="M16 8.5c-1.2-.7-2.6-.9-4-.6"/><path d="M7.2 11.5c1.5-.7 3.2-.9 4.8-.5"/><path d="M16.8 11.5c-1.5-.7-3.2-.9-4.8-.5"/><path d="M7.4 14.5c1.5-.6 3.1-.7 4.6-.3"/><path d="M16.6 14.5c-1.5-.6-3.1-.7-4.6-.3"/>',
  ECG: '<rect x="2.5" y="4" width="19" height="16" rx="3"/><path d="M5 12.5h3l1.5-3 2.2 6 2-8.5 1.6 5.5h3.7"/>',
  Echo: '<path d="M12 20s-7-4.2-7-9.6A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.4c0 1.2-.3 2.3-.9 3.3"/><path d="M12 8V5.5"/><path d="M14.5 7.2c.6-1.4 1.8-2.2 3-2.2"/><path d="M15.5 16.3a2.7 2.7 0 0 0 3.6 0"/><path d="M14.3 18.4a5 5 0 0 0 6 0"/>'
};

export const DEPTS = {
  Ultrasound: { key: 'Ultrasound', short: 'USG', label: 'Ultrasound (USG & Color Doppler)', hex: '#0891b2', soft: '#ecfeff', tone: 'cyan', chip: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/50 dark:text-cyan-300 dark:border-cyan-800', solid: 'bg-cyan-600', grad: 'from-cyan-500 to-teal-500' },
  Pathology: { key: 'Pathology', short: 'PATH', label: 'Pathology', hex: '#e11d48', soft: '#fff1f2', tone: 'rose', chip: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800', solid: 'bg-rose-600', grad: 'from-rose-500 to-pink-500' },
  Biochemistry: { key: 'Biochemistry', short: 'BIO', label: 'Biochemistry', hex: '#d97706', soft: '#fffbeb', tone: 'amber', chip: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800', solid: 'bg-amber-500', grad: 'from-amber-500 to-orange-500' },
  'X-Ray': { key: 'X-Ray', short: 'XRAY', label: 'X-Ray (Radiology)', hex: '#4f46e5', soft: '#eef2ff', tone: 'indigo', chip: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800', solid: 'bg-indigo-600', grad: 'from-indigo-500 to-blue-600' },
  ECG: { key: 'ECG', short: 'ECG', label: 'ECG (Electrocardiography)', hex: '#059669', soft: '#ecfdf5', tone: 'emerald', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800', solid: 'bg-emerald-600', grad: 'from-emerald-500 to-green-600' },
  Echo: { key: 'Echo', short: 'ECHO', label: 'Echo (2D Echo & Cardiac Doppler)', hex: '#7c3aed', soft: '#f5f3ff', tone: 'violet', chip: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-800', solid: 'bg-violet-600', grad: 'from-violet-500 to-purple-600' }
};
export const DEPT_LIST = Object.values(DEPTS);
export const deptOf = (d) => DEPTS[d] || { key: d, short: d || '—', label: d, hex: '#64748b', soft: '#f1f5f9', tone: 'slate', chip: 'bg-slate-100 text-slate-700 border-slate-200', solid: 'bg-slate-500', grad: 'from-slate-400 to-slate-500' };

export function deptSvg(dept, size = 20, color) {
  const d = deptOf(dept);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color || d.hex}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[dept] || PATHS.Ultrasound}</svg>`;
}

export function DeptIcon({ dept, className, color, style }) {
  return <svg style={style} className={cx('h-4 w-4', className)} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: PATHS[dept] || PATHS.Ultrasound }} />;
}

export function DeptLogo({ dept, size = 'md', className }) {
  const d = deptOf(dept);
  const s = size === 'sm' ? 'h-7 w-7 rounded-lg' : size === 'lg' ? 'h-12 w-12 rounded-2xl' : 'h-9 w-9 rounded-xl';
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center bg-gradient-to-br text-white shadow-sm', d.grad, s, className)} title={d.label}>
      <DeptIcon dept={dept} className={size === 'lg' ? 'h-6 w-6' : size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} color="#fff" />
    </span>
  );
}

export function DeptBadge({ dept, full, className }) {
  const d = deptOf(dept);
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold', d.chip, className)}>
      <DeptIcon dept={dept} className="h-3 w-3" />{full ? d.key : d.short}
    </span>
  );
}

/** Centre brand mark (used when no custom logo is uploaded). */
let brandSeq = 0;
/** Gradient ids are unique per call: a duplicate id inside a hidden subtree (e.g. the sidebar while printing) would blank the fill. */
export function brandSvg(size = 56) {
  const gid = 'ssdc-bg-' + (++brandSeq);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0284c7"/><stop offset="1" stop-color="#0d9488"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#${gid})"/><g fill="none" stroke="#fff" stroke-linecap="round" stroke-width="3.2"><path d="M20 18h12v14a6 6 0 0 1-12 0z" fill="#fff" fill-opacity=".18"/><path d="M26 38v5"/><path d="M17 46a12 12 0 0 0 18 0"/><path d="M12.5 51a19 19 0 0 0 27 0"/><path d="M38 17c3.6 2.3 6 6.3 6 10.8"/><path d="M43 11c5.5 3.6 9 9.8 9 16.8"/></g><path d="M44 40l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8z" fill="#fde68a"/></svg>`;
}

export function BrandMark({ className, logo }) {
  if (logo) return <img src={logo} alt="Logo" className={cx('h-10 w-10 rounded-xl object-contain', className)} />;
  return <span className={cx('inline-block h-10 w-10', className)} dangerouslySetInnerHTML={{ __html: brandSvg(40) }} />;
}
