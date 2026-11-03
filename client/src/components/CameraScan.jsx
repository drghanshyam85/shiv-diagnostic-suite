// Camera barcode / QR scanner shared by Registration (patient cards, Aadhaar) and the Lab (sample tubes).
// Uses the browser's built-in BarcodeDetector where it exists (Chrome on Android / Mac / ChromeOS) and the
// bundled jsQR decoder elsewhere (Windows / Linux Chrome & Edge, Firefox) — QR codes only in that case.
// Cameras need a secure page: http://localhost on the server PC or an https:// address.
import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import jsQR from 'jsqr';
import { Modal } from './ui';

export const cameraScanSupported = () => typeof window !== 'undefined' && window.isSecureContext && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
const nativeDetector = () => typeof window !== 'undefined' && 'BarcodeDetector' in window;

export function CameraScan({ open, onClose, onCode, title = 'Scan a barcode or QR code', hint, formats = ['qr_code', 'code_128', 'code_39', 'ean_13'] }) {
  const video = useRef(null);
  const canvas = useRef(null);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('');
  useEffect(() => {
    if (!open) return undefined;
    let stream = null;
    let timer = null;
    let stopped = false;
    setErr('');
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (stopped) return;
        video.current.srcObject = stream;
        await video.current.play();
        let det = null;
        if (nativeDetector()) {
          try {
            const supported = window.BarcodeDetector.getSupportedFormats ? await window.BarcodeDetector.getSupportedFormats() : formats;
            det = new window.BarcodeDetector({ formats: formats.filter((f) => supported.includes(f)) });
          } catch (e) { det = null; }
        }
        setMode(det ? 'native' : 'qr');
        const done = (text) => { if (stopped || !text) return; stopped = true; clearInterval(timer); onCode(text); };
        timer = setInterval(async () => {
          const v = video.current;
          if (!v || v.readyState < 2) return;
          try {
            if (det) {
              const codes = await det.detect(v);
              if (codes && codes[0] && codes[0].rawValue) done(codes[0].rawValue);
              return;
            }
            const c = canvas.current;
            const w = Math.min(1280, v.videoWidth);
            const h = Math.round((v.videoHeight / v.videoWidth) * w);
            c.width = w; c.height = h;
            const g = c.getContext('2d', { willReadFrequently: true });
            g.drawImage(v, 0, 0, w, h);
            const img = g.getImageData(0, 0, w, h);
            const r = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
            if (r && r.data) done(r.data);
          } catch (e) { /* frame not ready */ }
        }, 280);
      } catch (e) {
        setErr(e && e.name === 'NotAllowedError' ? 'Camera permission was refused.' : !window.isSecureContext ? 'Cameras only work on http://localhost or an https:// address. Use a USB / Bluetooth scanner on this computer.' : 'The camera could not start: ' + ((e && e.message) || e));
      }
    })();
    return () => { stopped = true; clearInterval(timer); if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onClose={onClose} size="md" title={title} icon={Camera}>
      {err ? <p className="text-sm text-rose-600">{err}</p> : (
        <div className="space-y-2">
          <video ref={video} className="aspect-video w-full rounded-xl bg-black object-cover" muted playsInline />
          <canvas ref={canvas} className="hidden" />
          <p className="text-[12px] text-muted">{hint || 'Hold the code inside the frame, about 15–20 cm from the camera.'}{mode === 'qr' ? ' This browser reads QR codes with the camera; use a USB scanner for line barcodes.' : ''}</p>
        </div>
      )}
    </Modal>
  );
}
