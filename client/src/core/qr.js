// QR codes (UPI scan-to-pay, Google Review, feedback, LAN pairing, patient web links).
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

const cache = new Map();

export async function qrDataUrl(text, { size = 240, margin = 1, dark = '#0f172a', level = 'M' } = {}) {
  if (!text) return '';
  const key = [text, size, margin, dark, level].join('|');
  if (cache.has(key)) return cache.get(key);
  const url = await QRCode.toDataURL(String(text), { width: size, margin, errorCorrectionLevel: level, color: { dark, light: '#ffffff' } });
  if (cache.size > 200) cache.clear();
  cache.set(key, url);
  return url;
}

export function useQr(text, opts) {
  const [url, setUrl] = useState('');
  const key = JSON.stringify(opts || {});
  useEffect(() => {
    let alive = true;
    if (!text) { setUrl(''); return undefined; }
    qrDataUrl(text, opts).then((u) => { if (alive) setUrl(u); }).catch(() => setUrl(''));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, key]);
  return url;
}

/** NPCI UPI deep link — encodes the exact amount (scan-to-pay). */
export function upiLink({ pa, pn, am, tn, tr }) {
  if (!pa) return '';
  const q = new URLSearchParams();
  q.set('pa', pa);
  if (pn) q.set('pn', pn);
  if (am !== undefined && am !== null && Number(am) > 0) q.set('am', Number(am).toFixed(2));
  q.set('cu', 'INR');
  if (tn) q.set('tn', String(tn).slice(0, 60));
  if (tr) q.set('tr', String(tr).slice(0, 35));
  return 'upi://pay?' + q.toString().replace(/\+/g, '%20');
}
