// UI primitives: buttons, fields, toggles, modals, drawers, tabs, combobox, menus, virtual list,
// toasts, confirm/prompt dialogs, KPI tiles, mic buttons.
import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Check, ChevronDown, Mic, Plus, CircleCheck, TriangleAlert, Info, CircleDot } from 'lucide-react';
import { events } from '../core/store';
import { inr } from '../core/utils';
import { dictateOnce, speechSupported } from '../core/speech';

export const cx = (...a) => a.filter(Boolean).join(' ');

const VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-600/20',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface2 hover:border-brand-300',
  ghost: 'text-ink hover:bg-surface2',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
  'danger-ghost': 'text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700',
  warning: 'bg-amber-500 text-white hover:bg-amber-600',
  dark: 'bg-navy-900 text-white hover:bg-navy-800 dark:bg-brand-700 dark:hover:bg-brand-600',
  outline: 'border border-brand-500 text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-900/30',
  whatsapp: 'bg-[#1fa855] text-white hover:bg-[#178a45]',
  teal: 'bg-teal-600 text-white hover:bg-teal-700'
};
const SIZES = { xs: 'h-7 px-2 text-xs gap-1', sm: 'h-8 px-2.5 text-[13px] gap-1.5', md: 'h-9 px-3.5 text-sm gap-2', lg: 'h-11 px-5 text-[15px] gap-2' };

export const Button = forwardRef(function Button({ variant = 'secondary', size = 'md', icon: Icon, iconRight: IconR, loading, className, children, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={cx('inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:cursor-not-allowed disabled:opacity-50', VARIANTS[variant], SIZES[size], className)} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className={size === 'xs' ? 'h-3.5 w-3.5' : 'h-4 w-4'} /> : null}
      {children}
      {IconR && <IconR className="h-4 w-4" />}
    </button>
  );
});

export function IconBtn({ icon: Icon, title, onClick, active, className, size = 'md', tone, disabled, ...rest }) {
  const s = size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-10 w-10' : 'h-8 w-8';
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-lg transition disabled:opacity-40', s,
        active ? 'bg-brand-600 text-white' : tone === 'danger' ? 'text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40' : 'text-muted hover:bg-surface2 hover:text-ink', className)} {...rest}>
      <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
    </button>
  );
}

// A <label> forwards caption clicks to its first control: right for inputs, wrong for button groups
// (it would press the first segment), so captions only activate real text inputs / selects.
const captionClick = (e) => { if (e.target.closest('.label') && !e.currentTarget.querySelector('input, select, textarea')) e.preventDefault(); };

export function Field({ label, required, hint, error, children, className, extra }) {
  return (
    <label className={cx('block min-w-0', className)} onClick={captionClick}>
      {label && (
        <span className="label flex items-center justify-between gap-2">
          <span>{label}{required && <span className="ml-0.5 text-rose-500">*</span>}</span>
          {extra}
        </span>
      )}
      {children}
      {error ? <span className="mt-1 block text-xs font-medium text-rose-600">{error}</span> : hint ? <span className="mt-1 block text-[11px] text-muted">{hint}</span> : null}
    </label>
  );
}

export const Input = forwardRef(function Input({ className, invalid, size, ...p }, ref) {
  return <input ref={ref} className={cx('input', size === 'sm' && 'input-sm', invalid && 'input-invalid', className)} {...p} />;
});
export const Textarea = forwardRef(function Textarea({ className, invalid, ...p }, ref) {
  return <textarea ref={ref} className={cx('input min-h-[72px] resize-y', invalid && 'input-invalid', className)} {...p} />;
});
export const Select = forwardRef(function Select({ options = [], className, size, placeholder, ...p }, ref) {
  return (
    <select ref={ref} className={cx('input pr-8', size === 'sm' && 'input-sm', className)} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>))}
    </select>
  );
});

export function Toggle({ checked, onChange, label, hint, disabled, size = 'md', className }) {
  const w = size === 'sm' ? 'h-4 w-7' : 'h-5 w-9';
  const k = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  const tx = size === 'sm' ? 'translate-x-3' : 'translate-x-4';
  return (
    <label className={cx('inline-flex cursor-pointer select-none items-start gap-2.5', disabled && 'cursor-not-allowed opacity-60', className)}>
      <button type="button" role="switch" aria-checked={!!checked} disabled={disabled} onClick={() => onChange && onChange(!checked)}
        className={cx('relative mt-0.5 inline-flex shrink-0 items-center rounded-full transition', w, checked ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600')}>
        <span className={cx('inline-block transform rounded-full bg-white shadow transition', k, checked ? tx : 'translate-x-0.5')} />
      </button>
      {(label || hint) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-medium leading-5 text-ink">{label}</span>}
          {hint && <span className="block text-[11px] leading-4 text-muted">{hint}</span>}
        </span>
      )}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, disabled, className }) {
  return (
    <label className={cx('inline-flex cursor-pointer select-none items-center gap-2 text-sm', disabled && 'cursor-not-allowed opacity-60', className)}>
      <span role="checkbox" aria-checked={!!checked} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : 0}
        onClick={(e) => { e.preventDefault(); if (!disabled && onChange) onChange(!checked); }}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!disabled && onChange) onChange(!checked); } }}
        className={cx('inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50', checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-400 bg-surface')}>
        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      {label && <span onClick={(e) => { e.preventDefault(); if (!disabled && onChange) onChange(!checked); }}>{label}</span>}
    </label>
  );
}

/**
 * Segmented choice (radio-group behaviour): one Tab stop — the chosen option — and ←/→ to change it,
 * so keyboard entry moves field to field instead of option to option.
 */
export function Segmented({ value, onChange, options, size = 'md', className, ariaLabel }) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const sel = opts.findIndex((o) => o.value === value);
  const move = (e, i) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const j = (i + step + opts.length) % opts.length;
    onChange(opts[j].value);
    const btns = e.currentTarget.parentElement.querySelectorAll('button');
    if (btns[j]) btns[j].focus();
  };
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cx('inline-flex max-w-full flex-wrap rounded-lg border border-line bg-surface2 p-0.5', className)}>
      {opts.map((opt, i) => {
        const on = value === opt.value;
        return (
          <button key={opt.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(opt.value)} onKeyDown={(e) => move(e, i)} title={opt.title} aria-pressed={on}
            tabIndex={on || (sel < 0 && i === 0) ? 0 : -1}
            className={cx('inline-flex items-center gap-1.5 rounded-md font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50', size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-[13px]',
              on ? 'bg-surface text-brand-700 shadow-sm dark:text-brand-300' : 'text-muted hover:text-ink')}>
            {opt.icon && <opt.icon className="h-3.5 w-3.5" />}{opt.label}
          </button>
        );
      })}
    </div>
  );
}

const TONES = {
  slate: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  brand: 'bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-950/60 dark:text-brand-200 dark:border-brand-800',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
  rose: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800',
  amber: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
  violet: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-800',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800',
  cyan: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/50 dark:text-cyan-300 dark:border-cyan-800',
  teal: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800'
};
export function Badge({ tone = 'slate', children, className, icon: Icon, dot }) {
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold', TONES[tone] || TONES.slate, className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

export function Card({ title, subtitle, actions, icon: Icon, children, className, bodyClass, padded = true, headerClass, style }) {
  return (
    <section className={cx('card min-w-0', className)} style={style}>
      {(title || actions) && (
        <header className={cx('flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3', headerClass)}>
          <div className="flex min-w-0 items-center gap-2.5">
            {Icon && <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300"><Icon className="h-4 w-4" /></span>}
            <div className="min-w-0">
              {title && <h3 className="truncate font-display text-[15px] font-bold text-ink">{title}</h3>}
              {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cx(padded && 'p-4', bodyClass)}>{children}</div>
    </section>
  );
}

const MODAL_SIZES = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl', full: 'max-w-[min(1600px,calc(100vw-1rem))]', screen: 'max-w-none' };
export function Modal({ open, onClose, title, subtitle, icon: Icon, size = 'md', children, footer, className, bodyClass, closeOnBackdrop = true, noPad }) {
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose && onClose(); } };
    window.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className={cx('fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-900/50 backdrop-blur-[2px]', size === 'screen' ? 'p-0 sm:p-1.5' : 'p-2 sm:p-6')} onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget && onClose) onClose(); }}>
      <div role="dialog" aria-modal="true" className={cx('relative my-auto w-full animate-slidein rounded-2xl border border-line bg-surface shadow-pop', MODAL_SIZES[size], className)}>
        {(title || onClose) && (
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
            <div className="flex min-w-0 items-center gap-3">
              {Icon && <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-300"><Icon className="h-[18px] w-[18px]" /></span>}
              <div className="min-w-0">
                <h2 className="truncate font-display text-lg font-bold">{title}</h2>
                {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
              </div>
            </div>
            {onClose && <IconBtn icon={X} title="Close (Esc)" onClick={onClose} />}
          </div>
        )}
        <div className={cx(!noPad && 'px-5 py-4', bodyClass)}>{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface2/60 px-5 py-3 rounded-b-2xl">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function Drawer({ open, onClose, title, subtitle, icon: Icon, side = 'right', width = 'sm:w-[440px]', children, footer }) {
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (e.key === 'Escape' && onClose) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex bg-slate-900/40" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <aside role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className={cx('flex h-full w-full flex-col border-line bg-surface shadow-pop', width, side === 'right' ? 'ml-auto border-l' : 'mr-auto border-r')}>
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {Icon && <Icon className="h-5 w-5 text-brand-600" />}
            <div className="min-w-0"><h2 className="truncate font-display text-base font-bold">{title}</h2>{subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}</div>
          </div>
          <IconBtn icon={X} title="Close" onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-line px-4 py-3">{footer}</div>}
      </aside>
    </div>,
    document.body
  );
}

export function Tabs({ tabs, value, onChange, className, size = 'md', scroll = true }) {
  return (
    <div className={cx('flex gap-1 border-b border-line', scroll && 'overflow-x-auto', className)}>
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button key={t.id} type="button" onClick={() => onChange(t.id)}
            className={cx('-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 font-semibold transition', size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-[13px]',
              on ? 'border-brand-600 text-brand-700 dark:text-brand-300' : 'border-transparent text-muted hover:text-ink')}>
            {t.icon && <t.icon className="h-4 w-4" />}{t.label}
            {t.count !== undefined && <span className={cx('rounded-full px-1.5 text-[10px] tnum', on ? 'bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200' : 'bg-surface2 text-muted')}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Empty({ icon: Icon = CircleDot, title, text, action, className }) {
  return (
    <div className={cx('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-surface2 text-muted"><Icon className="h-6 w-6" /></span>
      {title && <p className="font-display text-sm font-bold text-ink">{title}</p>}
      {text && <p className="mt-1 max-w-sm text-xs text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export const Spinner = ({ className }) => <Loader2 className={cx('h-4 w-4 animate-spin text-brand-600', className)} />;

export function Progress({ value = 0, max = 100, className, tone = 'brand' }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-surface2', className)}>
      <div className={cx('h-full rounded-full transition-all', tone === 'emerald' ? 'bg-emerald-500' : 'bg-brand-500')} style={{ width: pct + '%' }} />
    </div>
  );
}

const KPI_TONES = {
  brand: 'text-brand-600 bg-brand-50 dark:bg-brand-950/50 dark:text-brand-300', emerald: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 dark:text-emerald-300',
  rose: 'text-rose-600 bg-rose-50 dark:bg-rose-950/50 dark:text-rose-300', amber: 'text-amber-600 bg-amber-50 dark:bg-amber-950/50 dark:text-amber-300',
  violet: 'text-violet-600 bg-violet-50 dark:bg-violet-950/50 dark:text-violet-300', slate: 'text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-300',
  teal: 'text-teal-600 bg-teal-50 dark:bg-teal-950/50 dark:text-teal-300', indigo: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/50 dark:text-indigo-300'
};
export function Kpi({ label, value, sub, icon: Icon, tone = 'brand', children, className, onClick }) {
  return (
    <div onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } } : undefined}
      className={cx('card flex min-w-0 flex-col gap-1 p-3.5', onClick && 'cursor-pointer hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40', className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
        {Icon && <span className={cx('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', KPI_TONES[tone])}><Icon className="h-4 w-4" /></span>}
      </div>
      <div className="truncate font-display text-[22px] font-extrabold leading-tight">{value}</div>
      {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
      {children}
    </div>
  );
}

export const Money = ({ v, className, decimals }) => <span className={cx('tnum', className)}>{inr(v, decimals !== undefined ? { decimals } : {})}</span>;
export const Kbd = ({ children }) => <kbd className="kbd">{children}</kbd>;

// ---------------------------------------------------------------- toasts
let toastSeq = 0;
/** toast(text, type, ttl, action?) — action: { label, onClick } shows a button (e.g. Undo) that also closes the toast. */
export function toast(text, type = 'info', ttl, action) { events.emit('toast', { text, type, ttl, action }); }
export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => events.on('toast', (t) => {
    const id = ++toastSeq;
    setItems((x) => x.concat([{ id, text: t.text, type: t.type || 'info', action: t.action }]).slice(-5));
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.ttl || (t.type === 'error' ? 6500 : 3800));
  }), []);
  const icon = { success: CircleCheck, error: TriangleAlert, warning: TriangleAlert, info: Info };
  const tone = { success: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100 dark:border-emerald-800', error: 'border-rose-300 bg-rose-50 text-rose-900 dark:bg-rose-950 dark:text-rose-100 dark:border-rose-800', warning: 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-800', info: 'border-brand-200 bg-surface text-ink' };
  return createPortal(
    <div className="pointer-events-none fixed bottom-20 right-3 z-[120] flex w-[min(380px,calc(100vw-1.5rem))] flex-col gap-2 lg:bottom-4">
      {items.map((t) => {
        const I = icon[t.type] || Info;
        return (
          <div key={t.id} className={cx('pointer-events-auto flex animate-slidein items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-pop', tone[t.type] || tone.info)}>
            <I className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1 break-words">{t.text}</div>
            {t.action && <button className="shrink-0 text-xs font-bold underline" onClick={() => { setItems((x) => x.filter((i) => i.id !== t.id)); t.action.onClick(); }}>{t.action.label}</button>}
            <button className="opacity-60 hover:opacity-100" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}><X className="h-3.5 w-3.5" /></button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------- confirm / prompt dialogs
export function confirmDialog(opts) { return new Promise((resolve) => events.emit('dialog', Object.assign({ kind: 'confirm', resolve }, opts))); }
export function promptDialog(opts) { return new Promise((resolve) => events.emit('dialog', Object.assign({ kind: 'prompt', resolve }, opts))); }
export function DialogHost() {
  const [d, setD] = useState(null);
  const [val, setVal] = useState('');
  useEffect(() => events.on('dialog', (x) => { setVal(x.defaultValue || ''); setD(x); }), []);
  if (!d) return null;
  const close = (r) => { d.resolve(r); setD(null); };
  const ok = () => { if (d.kind === 'prompt') { if (d.required && !String(val).trim()) return; close(val); } else close(true); };
  return (
    <Modal open size="sm" title={d.title || (d.kind === 'confirm' ? 'Please confirm' : 'Enter value')} icon={d.danger ? TriangleAlert : Info} onClose={() => close(d.kind === 'prompt' ? null : false)}
      footer={<><Button onClick={() => close(d.kind === 'prompt' ? null : false)}>{d.cancelText || 'Cancel'}</Button><Button variant={d.danger ? 'danger' : 'primary'} onClick={ok}>{d.confirmText || 'OK'}</Button></>}>
      {d.message && <div className="whitespace-pre-line text-sm text-ink">{d.message}</div>}
      {d.kind === 'prompt' && (
        <div className="mt-3">
          {d.label && <span className="label">{d.label}</span>}
          {d.multiline
            ? <Textarea autoFocus rows={d.rows || 4} value={val} placeholder={d.placeholder} onChange={(e) => setVal(e.target.value)} />
            : <Input autoFocus value={val} placeholder={d.placeholder} type={d.type || 'text'} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ok(); }} />}
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- combobox (searchable autocomplete)
export function Combobox({ value, onChange, items, getKey = (x) => x.id, getLabel = (x) => x.name, getSub, filter, placeholder, onCreate, createLabel = 'Add new', className, invalid, inputRef, disabled, icon: Icon, renderItem, maxItems = 60, ariaLabel, mic }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const boxRef = useRef(null);
  const localInput = useRef(null);
  const iref = inputRef || localInput;
  const selected = items.find((x) => getKey(x) === value) || null;
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s ? items.filter((x) => (filter ? filter(x, s) : (getLabel(x) + ' ' + (getSub ? getSub(x) : '')).toLowerCase().includes(s))) : items;
    return base.slice(0, maxItems);
  }, [items, q, filter, getLabel, getSub, maxItems]);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setQ(''); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const pick = (x) => { onChange(getKey(x), x); setOpen(false); setQ(''); };
  const create = () => { if (onCreate) { onCreate(q.trim()); setOpen(false); setQ(''); } };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(list.length - (onCreate ? 0 : 1), h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { if (open) { e.preventDefault(); if (list[hi]) pick(list[hi]); else if (onCreate && q.trim()) create(); } }
    else if (e.key === 'Escape') { setOpen(false); setQ(''); }
    else if (e.key === 'Tab' && open && list[hi] && q) pick(list[hi]);
  };
  return (
    <div ref={boxRef} className={cx('relative', className)}>
      <div className="relative">
        {Icon && <Icon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />}
        <input ref={iref} aria-label={ariaLabel || placeholder} disabled={disabled} className={cx('input pr-14', Icon && 'pl-8', invalid && 'input-invalid')}
          placeholder={placeholder} value={open ? q : selected ? getLabel(selected) : q}
          onFocus={() => { setOpen(true); setHi(0); }} onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }} onKeyDown={onKey} />
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {mic && <MicButton target={iref} size="sm" />}
          <ChevronDown className="h-4 w-4 text-muted" />
        </div>
      </div>
      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-pop">
          {list.map((x, i) => (
            <button key={getKey(x)} type="button" onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(x); }}
              className={cx('flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm', i === hi ? 'bg-brand-50 dark:bg-brand-950/50' : '')}>
              {renderItem ? renderItem(x) : (
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{getLabel(x)}</span>
                  {getSub && getSub(x) && <span className="block truncate text-[11px] text-muted">{getSub(x)}</span>}
                </span>
              )}
              {getKey(x) === value && <Check className="mt-0.5 h-4 w-4 text-brand-600" />}
            </button>
          ))}
          {!list.length && !onCreate && <div className="px-3 py-3 text-center text-xs text-muted">No matches</div>}
          {onCreate && (
            <button type="button" onMouseDown={(e) => { e.preventDefault(); create(); }} onMouseEnter={() => setHi(list.length)}
              className={cx('mt-0.5 flex w-full items-center gap-2 rounded-lg border-t border-line px-2.5 py-2 text-left text-sm font-semibold text-brand-700 dark:text-brand-300', hi === list.length && 'bg-brand-50 dark:bg-brand-950/50')}>
              <Plus className="h-4 w-4" /> {createLabel}{q.trim() ? ` “${q.trim()}”` : ''}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- dropdown menu
export function Menu({ trigger, items, align = 'right', className, width = 'w-56' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div ref={ref} className={cx('relative inline-block', className)}>
      <span onClick={() => setOpen((o) => !o)}>{trigger}</span>
      {open && (
        <div className={cx('absolute z-[60] mt-1 max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-pop', width, align === 'right' ? 'right-0' : 'left-0')}>
          {items.filter(Boolean).map((it, i) => it.divider ? <div key={i} className="my-1 border-t border-line" /> : it.header ? (
            <div key={i} className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted">{it.header}</div>
          ) : (
            <button key={i} type="button" disabled={it.disabled} onClick={() => { setOpen(false); it.onClick && it.onClick(); }}
              className={cx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition disabled:opacity-40', it.danger ? 'text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40' : 'hover:bg-surface2')}>
              {it.icon && <it.icon className="h-4 w-4 shrink-0 opacity-80" />}
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.hint && <span className="text-[10px] text-muted">{it.hint}</span>}
              {it.checked && <Check className="h-4 w-4 text-brand-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- virtual list (fixed row height, 60 fps for 1,00,000+ rows)
export function VirtualList({ count, rowHeight = 44, renderRow, overscan = 8, className, onEnd }) {
  const ref = useRef(null);
  const [top, setTop] = useState(0);
  const [h, setH] = useState(400);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((top + h) / rowHeight) + overscan);
  const rows = [];
  for (let i = start; i < end; i++) rows.push(<div key={i} style={{ position: 'absolute', top: i * rowHeight, left: 0, right: 0, height: rowHeight }}>{renderRow(i)}</div>);
  return (
    <div ref={ref} className={cx('relative overflow-y-auto', className)} onScroll={(e) => { setTop(e.currentTarget.scrollTop); if (onEnd && e.currentTarget.scrollTop + h > count * rowHeight - 200) onEnd(); }}>
      <div style={{ height: count * rowHeight, position: 'relative' }}>{rows}</div>
    </div>
  );
}

// ---------------------------------------------------------------- mic button (field-level dictation)
export function MicButton({ target, size = 'md', lang = 'en-IN', className, title = 'Voice input', tabIndex }) {
  const [state, setState] = useState('idle');
  const supported = speechSupported();
  const go = useCallback(async () => {
    if (!supported) { toast('Voice input needs Google Chrome or Microsoft Edge', 'warning'); return; }
    const el = typeof target === 'string' ? document.querySelector(target) : target && target.current ? target.current : target;
    try { await dictateOnce(el, { lang, onState: setState }); } catch (e) { setState('idle'); if (e.message !== 'no-speech' && e.message !== 'aborted') toast('Voice input: ' + e.message, 'warning'); }
  }, [target, lang, supported]);
  return (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={go} data-no-dictation tabIndex={tabIndex}
      className={cx('inline-flex items-center justify-center rounded-md transition', size === 'sm' ? 'h-6 w-6' : 'h-8 w-8',
        state === 'listening' ? 'animate-pulse bg-rose-500 text-white' : 'text-muted hover:bg-surface2 hover:text-brand-600', className)}>
      <Mic className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
    </button>
  );
}

export function Section({ title, children, right, className }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted">{title}</h4>
        {right}
      </div>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, icon: Icon, actions, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-teal-500 text-white shadow-sm sm:inline-flex"><Icon className="h-5 w-5" /></span>}
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-extrabold tracking-tight sm:text-2xl">{title}</h1>
          {subtitle && <p className="truncate text-[13px] text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      {children}
    </div>
  );
}
