// DICOM viewer for the Images tab: the header (patient, device, series, time), a patient check against
// the open report, and — for cine loops — a frame scrubber / player with "attach this frame" or
// "attach N evenly spaced frames". Also opens an already attached DICOM image to show its details.
import { useEffect, useRef, useState } from 'react';
import { Play, Pause, ChevronLeft, ChevronRight, ImagePlus, SkipForward, FileImage, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { renderFrame, dicomSummary, dicomPatientCheck } from '../../core/dicomImage';
import { fmtDate, fmtTime, fmtBytes } from '../../core/utils';
import { Modal, Button, Segmented } from '../../components/ui';

export const evenlySpaced = (n, k) => {
  if (k >= n) return Array.from({ length: n }, (_, i) => i);
  if (k <= 1) return [Math.floor((n - 1) / 2)];
  return Array.from({ length: k }, (_, i) => Math.round((i * (n - 1)) / (k - 1)));
};

export function DicomViewer({ item, position, total, demographics, readOnly, onAttach, onSkip, onClose }) {
  const [frame, setFrame] = useState(0);
  const [play, setPlay] = useState(false);
  const [err, setErr] = useState('');
  const [many, setMany] = useState('4');
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  const dc = item && item.dc;
  const n = dc ? dc.frameCount : 0;

  useEffect(() => { setFrame(n > 1 ? n - 1 : 0); setPlay(false); setErr(''); }, [item]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    if (!dc) return undefined;
    renderFrame(dc, frame).then((c) => {
      if (!alive || !box.current) return;
      c.style.maxWidth = '100%';
      c.style.maxHeight = '56vh';
      c.style.width = 'auto';
      c.style.height = 'auto';
      c.setAttribute('aria-label', 'Frame ' + (frame + 1));
      box.current.replaceChildren(c);
      setErr('');
    }).catch((e) => { if (alive) { setErr(e.message); setPlay(false); } });
    return () => { alive = false; };
  }, [dc, frame]);
  useEffect(() => {
    if (!play || n < 2) return undefined;
    const ms = Math.max(30, Math.min(500, Number(dc.meta.frameTime) || 66));
    const t = setInterval(() => setFrame((f) => (f + 1) % n), ms);
    return () => clearInterval(t);
  }, [play, n, dc]);

  if (!item) return null;
  const s = dicomSummary(dc);
  const chk = dicomPatientCheck(s, demographics);
  const attach = async (frames) => { setBusy(true); try { await onAttach(frames); } finally { setBusy(false); } };
  const row = (k, v) => (v || v === 0 ? <><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words font-medium">{v}</dd></> : null);
  return (
    <Modal open onClose={onClose} size="xl" icon={FileImage}
      title={'DICOM · ' + (item.file ? item.file.name : s.series || 'image')}
      subtitle={[n > 1 ? n + ' frames (cine loop)' : 'Single image', s.syntax, total > 1 ? 'file ' + position + ' of ' + total : ''].filter(Boolean).join(' · ')}
      footer={readOnly || !onAttach ? <Button onClick={onClose}>Close</Button> : (
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {onSkip && <Button icon={SkipForward} onClick={onSkip} disabled={busy}>{total > 1 ? 'Skip this file' : 'Don’t attach'}</Button>}
          {n > 1 && (
            <span className="inline-flex items-center gap-1.5">
              <Segmented size="sm" ariaLabel="Frames to attach" value={many} onChange={setMany} options={['2', '4', '6'].filter((x) => Number(x) < n).concat(n <= 12 ? ['all'] : [])} />
              <Button icon={ImagePlus} disabled={busy || !!err} onClick={() => attach(many === 'all' ? evenlySpaced(n, n) : evenlySpaced(n, Number(many)))}>Attach {many === 'all' ? 'all ' + n : many} frames</Button>
            </span>
          )}
          <Button variant="primary" icon={ImagePlus} loading={busy} disabled={!!err} onClick={() => attach([frame])}>Attach {n > 1 ? 'frame ' + (frame + 1) : 'image'}</Button>
        </div>
      )}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_270px]">
        <div className="min-w-0">
          <div ref={box} className="flex min-h-[320px] items-center justify-center overflow-hidden rounded-xl bg-black text-[12px] text-slate-400">Decoding…</div>
          {err && <p className="mt-2 flex items-start gap-1.5 text-[13px] text-rose-600"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{err}</p>}
          {n > 1 && (
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" icon={play ? Pause : Play} onClick={() => setPlay(!play)} aria-label={play ? 'Pause' : 'Play cine'}>{play ? 'Pause' : 'Play'}</Button>
              <button type="button" className="rounded p-1 hover:bg-surface2" onClick={() => { setPlay(false); setFrame((f) => (f - 1 + n) % n); }} aria-label="Previous frame"><ChevronLeft className="h-4 w-4" /></button>
              <input type="range" min="1" max={n} value={frame + 1} onChange={(e) => { setPlay(false); setFrame(Number(e.target.value) - 1); }} className="min-w-0 flex-1 accent-brand-600" aria-label="Frame" />
              <button type="button" className="rounded p-1 hover:bg-surface2" onClick={() => { setPlay(false); setFrame((f) => (f + 1) % n); }} aria-label="Next frame"><ChevronRight className="h-4 w-4" /></button>
              <span className="w-24 text-right text-[12px] tabular-nums text-muted">Frame {frame + 1} / {n}</span>
            </div>
          )}
        </div>
        <div className="space-y-2 text-[12.5px]">
          {chk.ok === false && <div className="flex items-start gap-1.5 rounded-lg bg-rose-50 p-2 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span><b>Check the patient.</b> {chk.reason}.</span></div>}
          {chk.ok === true && <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 p-2 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"><CheckCircle2 className="h-4 w-4 shrink-0" />{chk.reason}</div>}
          <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-2 gap-y-1">
            {row('Patient', s.patientName)}
            {row('Patient ID', s.patientId)}
            {row('Sex', s.sex)}
            {row('Acquired', s.acquiredAt ? fmtDate(s.acquiredAt) + ' ' + fmtTime(s.acquiredAt) : '')}
            {row('Series', s.series)}
            {row('Study', s.study)}
            {row('Body part', s.bodyPart)}
            {row('Protocol', s.protocol)}
            {row('Comments', s.comments)}
            {row('Device', [s.manufacturer, s.model].filter(Boolean).join(' '))}
            {row('Institution', s.institution)}
            {row('Accession', s.accession)}
            {row('Image', s.size + (s.photometric ? ' · ' + s.photometric : ''))}
            {row('Encoding', s.syntax)}
            {row('File', dc.size ? fmtBytes(dc.size) : '')}
          </dl>
        </div>
      </div>
    </Modal>
  );
}
