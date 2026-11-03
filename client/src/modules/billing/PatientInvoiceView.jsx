// Mobile-optimised patient web receipt: status, tests, totals, preparation guidelines, UPI pay button,
// Google review & feedback links, download PDF. Data from the LAN server (/#/p/<shareId>) or embedded
// in the link itself (/#/v/<payload>) so it also works on any static host.
import { useEffect, useRef, useState } from 'react';
import { Smartphone, Star, MessageSquareHeart, Download, Printer, Phone, MapPin, FlaskConical, CircleCheck, Clock } from 'lucide-react';
import { decodePayload } from '../../core/share';
import { useQr, upiLink } from '../../core/qr';
import { inr, fmtDate, fmtTime, ageSex } from '../../core/utils';
import { MODE_LABEL } from '../../core/finance';
import { htmlToPdf } from '../../core/pdf';
import { brandSvg } from '../../components/dept';

function normalizeServer(d) {
  const i = d.invoice;
  return {
    clinic: { name: d.clinic.name, address: d.clinic.address, phone: [d.clinic.phone, d.clinic.phone2].filter(Boolean).join(', '), email: d.clinic.email, doctor: d.clinic.radiologist.name + ', ' + d.clinic.radiologist.qualification, pcpndt: d.clinic.pcpndtRegNo },
    upi: d.upi, review: d.engagement.googleReviewUrl, feedback: d.engagement.feedbackUrl,
    inv: { no: i.invoiceNo, date: i.date, status: i.status, mode: i.paymentMode, patient: [i.patient.title + ' ' + i.patient.name, ageSex(i.patient), i.patient.mobile, i.patient.regId], ref: i.referredByName, items: i.items.map((x) => [x.name, x.amount, x.department]), gross: i.gross, disc: i.discountAmount, tax: i.taxAmount || 0, taxLabel: (i.taxLabel || 'GST') + ' @ ' + (i.taxRate || 0) + '%', net: i.net, paid: i.paid, bal: i.balance },
    guidelines: d.guidelines.map((g) => [g.test, g.text]), custom: d.customGuidelines
  };
}
function normalizePayload(p) {
  return {
    clinic: { name: p.c.n, address: p.c.a, phone: p.c.p, email: p.c.e, doctor: p.c.r, pcpndt: p.c.pc }, upi: { id: p.u.id, name: p.u.n }, review: p.g, feedback: p.f,
    inv: { no: p.i.no, date: p.i.d, status: p.i.s, mode: p.i.m, patient: p.i.pt, ref: p.i.rf, items: p.i.it, gross: p.i.gr, disc: p.i.di, tax: p.i.tx || 0, taxLabel: p.i.tl || 'GST', net: p.i.ne, paid: p.i.pa, bal: p.i.ba },
    guidelines: p.gl || [], custom: p.cg
  };
}

const STATUS = { PAID: ['Paid in full', 'bg-emerald-500'], PARTIAL: ['Partially paid', 'bg-amber-500'], DUE: ['Payment due', 'bg-rose-500'], CASHLESS: ['Cashless', 'bg-indigo-500'] };

export function PatientInvoiceView({ route }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const card = useRef(null);
  useEffect(() => {
    const kind = route.parts[0];
    const token = route.parts.slice(1).join('/');
    (async () => {
      try {
        if (kind === 'v') setData(normalizePayload(await decodePayload(token)));
        else {
          const r = await fetch('api/public/invoice/' + encodeURIComponent(token));
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || 'Not found');
          setData(normalizeServer(j));
        }
      } catch (e) { setErr(e.message || 'This receipt link is invalid'); }
    })();
  }, [route.raw]);
  const inv = data && data.inv;
  const payAmt = inv ? (inv.bal > 0 ? inv.bal : 0) : 0;
  const upi = data && data.upi && data.upi.id && payAmt > 0 ? upiLink({ pa: data.upi.id, pn: data.upi.name, am: payAmt, tn: 'Invoice ' + inv.no, tr: inv.no }) : '';
  const qr = useQr(upi, { size: 260 });
  useEffect(() => { if (data) document.title = 'Receipt ' + inv.no + ' – ' + data.clinic.name; }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <div className="flex min-h-full items-center justify-center bg-slate-100 p-6 text-center"><div className="max-w-sm rounded-2xl bg-white p-6 shadow"><h1 className="font-display text-lg font-bold text-slate-900">Receipt not available</h1><p className="mt-1 text-sm text-slate-600">{err}</p></div></div>;
  if (!data) return <div className="flex min-h-full items-center justify-center text-sm text-slate-500">Loading your receipt…</div>;
  const st = STATUS[inv.status] || STATUS.DUE;
  const pdf = () => htmlToPdf('<div class="print-page" style="width:120mm;background:#fff;padding:6mm">' + card.current.innerHTML + '</div>', { widthMm: 120, heightMm: 'auto', filename: 'Receipt_' + inv.no + '.pdf' });
  return (
    <div className="min-h-full bg-gradient-to-b from-slate-100 to-sky-50 px-3 py-5 text-slate-900">
      <div className="mx-auto max-w-md">
        <div ref={card} className="overflow-hidden rounded-3xl bg-white shadow-xl shadow-sky-900/10">
          <div className="bg-gradient-to-br from-slate-900 to-sky-800 p-5 text-white">
            <div className="flex items-center gap-3">
              <span className="h-12 w-12 shrink-0" dangerouslySetInnerHTML={{ __html: brandSvg(48) }} />
              <div className="min-w-0"><div className="font-display text-[17px] font-extrabold leading-tight">{data.clinic.name}</div><div className="text-[11px] text-sky-100">{data.clinic.doctor}</div></div>
            </div>
            <div className="mt-4 flex items-end justify-between">
              <div><div className="text-[11px] uppercase tracking-widest text-sky-200">Invoice</div><div className="font-mono text-lg font-bold">{inv.no}</div><div className="text-xs text-sky-100">{fmtDate(inv.date)} · {fmtTime(inv.date)}</div></div>
              <span className={'rounded-full px-3 py-1 text-xs font-bold text-white ' + st[1]}>{st[0]}</span>
            </div>
          </div>
          <div className="space-y-4 p-5">
            <div className="rounded-2xl bg-slate-50 p-3 text-sm">
              <div className="font-semibold">{inv.patient[0]} <span className="font-normal text-slate-500">· {inv.patient[1]}</span></div>
              <div className="text-xs text-slate-500">Reg. ID {inv.patient[3]} · Mobile {inv.patient[2]}{inv.ref ? ' · Ref: ' + inv.ref : ''}</div>
            </div>
            <div>
              {inv.items.map((it, i) => <div key={i} className="flex justify-between gap-3 border-b border-slate-100 py-2 text-sm"><span>{it[0]}</span><span className="font-semibold tabular-nums">{inr(it[1])}</span></div>)}
              <div className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between text-slate-500"><span>Gross</span><span className="tabular-nums">{inr(inv.gross, { decimals: 2 })}</span></div>
                {inv.disc > 0 && <div className="flex justify-between text-rose-600"><span>Concession</span><span className="tabular-nums">− {inr(inv.disc, { decimals: 2 })}</span></div>}
                {inv.tax > 0 && <div className="flex justify-between text-slate-600"><span>{inv.taxLabel}</span><span className="tabular-nums">+ {inr(inv.tax, { decimals: 2 })}</span></div>}
                <div className="flex justify-between text-base font-bold"><span>Net amount</span><span className="tabular-nums">{inr(inv.net, { decimals: 2 })}</span></div>
                {inv.status !== 'CASHLESS' && <div className="flex justify-between text-emerald-700"><span>Paid ({MODE_LABEL[inv.mode] || inv.mode})</span><span className="tabular-nums">{inr(inv.paid, { decimals: 2 })}</span></div>}
                {inv.bal > 0 && <div className="flex justify-between font-bold text-rose-600"><span>Balance due</span><span className="tabular-nums">{inr(inv.bal, { decimals: 2 })}</span></div>}
              </div>
            </div>
            {inv.bal > 0 && upi && (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-center">
                <a href={upi} className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 font-bold text-white shadow"><Smartphone className="h-5 w-5" />Pay {inr(inv.bal, { decimals: 2 })} with UPI</a>
                {qr && <img src={qr} alt="UPI QR" className="mx-auto mt-3 h-44 w-44" />}
                <div className="text-[11px] text-slate-500">Opens GPay / PhonePe / Paytm / BHIM · UPI ID {data.upi.id}</div>
              </div>
            )}
            {inv.bal <= 0 && inv.status === 'PAID' && <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700"><CircleCheck className="h-5 w-5" />Payment received in full. Thank you!</div>}
            {(data.guidelines.length > 0 || data.custom) && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                <div className="mb-1 flex items-center gap-1.5 text-sm font-bold text-amber-900"><FlaskConical className="h-4 w-4" />Preparation guidelines</div>
                {data.guidelines.map((g, i) => <div key={i} className="mt-1 text-[13px] text-amber-900"><b>{g[0]}:</b> {g[1]}</div>)}
                {data.custom && <div className="mt-1 text-[13px] text-amber-900">{data.custom}</div>}
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-slate-500"><Clock className="h-3.5 w-3.5" />Reports are shared on WhatsApp once ready.</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {data.review && <a href={data.review} target="_blank" rel="noopener" className="flex items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2.5 text-sm font-semibold shadow"><Star className="h-4 w-4 text-amber-500" />Rate us on Google</a>}
          {data.feedback && <a href={data.feedback} target="_blank" rel="noopener" className="flex items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2.5 text-sm font-semibold shadow"><MessageSquareHeart className="h-4 w-4 text-rose-500" />Feedback</a>}
          <button onClick={pdf} className="flex items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2.5 text-sm font-semibold shadow"><Download className="h-4 w-4 text-sky-600" />Download PDF</button>
          <button onClick={() => window.print()} className="flex items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2.5 text-sm font-semibold shadow"><Printer className="h-4 w-4 text-slate-600" />Print</button>
        </div>
        <div className="mt-5 space-y-1 text-center text-[11px] text-slate-500">
          <div className="flex items-center justify-center gap-1"><MapPin className="h-3 w-3" />{data.clinic.address}</div>
          <div className="flex items-center justify-center gap-1"><Phone className="h-3 w-3" /><a href={'tel:' + String(data.clinic.phone).split(',')[0]}>{data.clinic.phone}</a> · {data.clinic.email}</div>
          {data.clinic.pcpndt && <div>PC-PNDT Reg. {data.clinic.pcpndt}</div>}
        </div>
      </div>
    </div>
  );
}
