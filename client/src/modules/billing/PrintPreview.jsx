// Interactive full-page print preview & layout controller (formats, copies, margins, scale, auto-fill A4,
// visibility toggles, colour/greyscale) → window.print() with exact @page size, or client-side PDF.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Printer, FileDown, RotateCcw, Save, ZoomIn } from 'lucide-react';
import { useSettings, saveSettings, useHotkeys } from '../../core/hooks';
import { can } from '../../core/auth';
import { printElements } from '../../core/print';
import { htmlToPdf } from '../../core/pdf';
import { deepMerge } from '../../core/utils';
import { cx, Modal, Button, Toggle, Checkbox, Segmented, Section, toast } from '../../components/ui';
import { InvoicePages, FORMATS, MARGIN_PRESETS, pageSizeFor, MM } from './InvoiceDoc';

const VIS = [
  ['header', 'Clinic header & PC-PNDT Reg. banner'], ['aadhaar', 'Patient ID (Aadhaar) field'], ['refDoctor', 'Referred-by doctor'],
  ['discount', 'Discount / concession row (auto-hidden at ₹0)'], ['balance', 'Balance due & payment-mode breakdown'], ['upiQr', 'UPI payment QR code'],
  ['guidelines', 'Patient test-preparation guidelines'], ['reviewQr', 'Google Review & feedback QR codes'], ['signature', 'Doctor signature & stamp block']
];

export function PrintPreview({ open, onClose, invoice, webLink, initialFormat, autoPrint }) {
  const settings = useSettings();
  const [opts, setOpts] = useState(() => Object.assign({}, settings.print, { visibility: Object.assign({}, settings.print.visibility) }));
  const [busy, setBusy] = useState(false);
  const [zoomMode, setZoomMode] = useState('fit');
  const [k, setK] = useState(0.6);
  const stage = useRef(null);
  const pages = useRef(null);
  useEffect(() => { if (open) setOpts(Object.assign({}, settings.print, { visibility: Object.assign({}, settings.print.visibility) }, initialFormat ? { format: initialFormat } : {})); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const size = pageSizeFor(opts);
  useLayoutEffect(() => {
    if (!open || !stage.current) return undefined;
    const calc = () => {
      const w = stage.current.clientWidth - 40;
      const pw = size.w * MM;
      setK(zoomMode === 'fit' ? Math.min(1.2, w / pw) : 1);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(stage.current);
    return () => ro.disconnect();
  }, [open, size.w, zoomMode]);
  const set = (patch) => setOpts((o) => deepMerge(o, patch));
  const els = () => (pages.current ? pages.current.querySelectorAll('.print-page') : []);
  const doPrint = () => printElements(els(), { widthMm: size.w, heightMm: size.h, title: 'Invoice ' + invoice.invoiceNo, audit: { action: 'print:invoice', target: 'invoices/' + invoice.id, meta: { format: opts.format } } });
  const doPdf = async () => {
    setBusy(true);
    try {
      const html = Array.from(els()).map((e) => e.outerHTML).join('');
      await htmlToPdf(html, { widthMm: size.w, heightMm: size.h, filename: invoice.invoiceNo + '_' + invoice.patient.name.replace(/\s+/g, '_') + '.pdf' });
    } catch (e) { toast('PDF failed: ' + e.message, 'error'); }
    setBusy(false);
  };
  useHotkeys(open ? { 'ctrl+p': () => doPrint() } : {}, [open, opts]);
  // checkout "Print receipt" toggle: print as soon as the pages have rendered
  useEffect(() => {
    if (!open || !autoPrint) return undefined;
    const t = setTimeout(() => { if (els().length) doPrint(); }, 700);
    return () => clearTimeout(t);
  }, [open, autoPrint]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open || !invoice) return null;
  const a4 = ['a4', 'patient', 'center'].includes(opts.format);
  return (
    <Modal open={open} onClose={onClose} size="full" title={'Print preview · ' + invoice.invoiceNo} subtitle={invoice.patient.title + ' ' + invoice.patient.name} icon={Printer} noPad>
      <div className="grid min-h-[78vh] lg:grid-cols-[330px_minmax(0,1fr)]">
        <div className="space-y-5 overflow-y-auto border-b border-line p-4 lg:max-h-[82vh] lg:border-b-0 lg:border-r">
          <Section title="Print format & copies">
            <div className="space-y-1">
              {FORMATS.map((f) => (
                <label key={f.id} className={cx('flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px]', opts.format === f.id ? 'border-brand-500 bg-brand-50 font-semibold dark:bg-brand-950/40' : 'border-line hover:bg-surface2')}>
                  <input type="radio" name="fmt" className="accent-brand-600" checked={opts.format === f.id} onChange={() => set({ format: f.id })} />{f.label}
                </label>
              ))}
            </div>
            {opts.format === 'a4dual' && <div className="mt-2"><Segmented size="sm" value={opts.dualLayout} onChange={(dualLayout) => set({ dualLayout })} options={[{ value: 'stacked', label: 'Top / bottom (A4 portrait)' }, { value: 'side', label: 'Side-by-side (A4 landscape)' }]} /></div>}
            {(opts.format === 'third' || opts.format === 'quarter') && <div className="mt-2"><Toggle size="sm" checked={opts.slipOnA4} onChange={(slipOnA4) => set({ slipOnA4 })} label="Print slip on an A4 sheet (with cut guide)" hint="Off = exact slip-size paper" /></div>}
          </Section>
          <Section title="Paper margins (mm)" right={<button className="link text-xs" onClick={() => set({ marginPreset: 'standard', margins: MARGIN_PRESETS.standard })}><RotateCcw className="mr-1 inline h-3 w-3" />Reset margins</button>}>
            <Segmented size="sm" value={opts.marginPreset} onChange={(p) => set({ marginPreset: p, margins: MARGIN_PRESETS[p] || opts.margins })} options={[{ value: 'narrow', label: 'Narrow' }, { value: 'standard', label: 'Standard' }, { value: 'spacious', label: 'Spacious' }, { value: 'custom', label: 'Custom' }]} />
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {['top', 'right', 'bottom', 'left'].map((side) => (
                <label key={side} className="text-[10px] font-semibold uppercase text-muted">{side}
                  <input type="number" min="0" max="40" step="0.5" className="input input-sm mt-0.5 px-1.5" value={opts.margins[side]} onChange={(e) => set({ marginPreset: 'custom', margins: { [side]: Number(e.target.value) } })} />
                </label>
              ))}
            </div>
          </Section>
          <Section title={'Page scale · ' + opts.scale + '%'}>
            <input type="range" min="50" max="150" step="1" value={opts.scale} onChange={(e) => set({ scale: Number(e.target.value) })} className="w-full accent-brand-600" aria-label="Page scale" />
            <div className="mt-2 space-y-2">
              <Toggle size="sm" checked={opts.autoScale} onChange={(autoScale) => set({ autoScale })} label="Auto-scale to fit page" hint="Shrinks long bills so nothing spills onto a 2nd page" />
              <Toggle size="sm" checked={opts.autoFill} disabled={!a4} onChange={(autoFill) => set({ autoFill })} label="Auto-extend row height & signature gap to fill full A4" hint="Smart vertical stretch for A4 full-page formats" />
            </div>
          </Section>
          <Section title="Show / hide on printout">
            <div className="space-y-1.5">
              {VIS.map(([key, label]) => <Checkbox key={key} checked={!!opts.visibility[key]} onChange={(v) => set({ visibility: { [key]: v } })} label={label} />)}
              <Checkbox checked={!!opts.maskAadhaar} onChange={(maskAadhaar) => set({ maskAadhaar })} label="Mask Aadhaar (XXXX-XXXX-1234)" />
            </div>
          </Section>
          <Section title="Ink">
            <Segmented size="sm" value={opts.colorMode} onChange={(colorMode) => set({ colorMode })} options={[{ value: 'color', label: 'Colour' }, { value: 'grayscale', label: 'Greyscale' }]} />
          </Section>
          <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-line bg-surface px-4 py-3">
            <Button variant="primary" size="lg" icon={Printer} className="w-full" onClick={doPrint}>Print <span className="kbd ml-1 border-white/30 bg-white/15 text-white">Ctrl+P</span></Button>
            <div className="grid grid-cols-2 gap-2">
              <Button icon={FileDown} loading={busy} onClick={doPdf}>Download PDF</Button>
              <Button icon={Save} disabled={!can('settings:manage_clinic_and_integrations')} onClick={() => { saveSettings({ print: opts }); toast('Saved as default print layout', 'success'); }}>Save default</Button>
            </div>
          </div>
        </div>
        <div ref={stage} className="relative min-w-0 overflow-auto bg-slate-200/70 p-5 dark:bg-slate-900/70 lg:max-h-[82vh]">
          <div className="absolute right-3 top-3 z-10"><Button size="xs" icon={ZoomIn} onClick={() => setZoomMode(zoomMode === 'fit' ? 'actual' : 'fit')}>{zoomMode === 'fit' ? 'Actual size' : 'Fit to width'}</Button></div>
          <div style={{ width: size.w * MM * k, margin: '0 auto' }}>
            <div ref={pages} style={{ transform: `scale(${k})`, transformOrigin: 'top left', width: size.w * MM }}>
              <div className="shadow-page" style={{ background: '#fff' }}>
                <InvoicePages inv={invoice} settings={Object.assign({}, settings, { print: opts })} opts={opts} webLink={webLink} />
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-[11px] text-muted">Page size {size.w} × {size.h === 'auto' ? 'auto (roll)' : size.h} mm · browser headers/footers are suppressed (@page margin 0). In the print dialog choose “Margins: None / Default” and the matching paper.</p>
        </div>
      </div>
    </Modal>
  );
}
