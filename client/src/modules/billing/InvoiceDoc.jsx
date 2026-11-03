// Invoice / receipt document renderer for every paper format. Inline styles keep the output identical
// on screen, in print (@media print) and in html2canvas PDFs, independent of the dark theme.
import { useLayoutEffect, useRef, useState } from 'react';
import { useQr, upiLink } from '../../core/qr';
import { amountInWords, fmtDate, fmtTime, fullName, ageSex, guardianLine, maskAadhaar, formatAadhaar, inr } from '../../core/utils';
import { MODE_LABEL, DIGITAL_MODES } from '../../core/finance';
import { prepGuidelines } from '../../core/clinic';
import { store } from '../../core/store';
import { brandSvg, deptOf } from '../../components/dept';

export const MM = 3.7795275591;
export const FORMATS = [
  { id: 'a4', label: 'A4 Full Page (Single Copy)' },
  { id: 'a4dual', label: 'A4 Dual Copy (Patient + Center)' },
  { id: 'patient', label: 'Print Patient Copy Only' },
  { id: 'center', label: 'Print Center Copy Only' },
  { id: 'third', label: '1/3 A4 Slip' },
  { id: 'quarter', label: '1/4 A4 Slip' },
  { id: 'thermal', label: '80 mm Thermal Receipt' }
];
export const MARGIN_PRESETS = { narrow: { top: 5, right: 5, bottom: 5, left: 5 }, standard: { top: 8, right: 8, bottom: 8, left: 8 }, spacious: { top: 15, right: 15, bottom: 15, left: 15 } };

const money = (n) => inr(n, { decimals: 2 });
const STATUS_TXT = { PAID: 'PAID IN FULL', PARTIAL: 'PARTIALLY PAID', DUE: 'PAYMENT DUE', CASHLESS: 'CASHLESS' };
const STATUS_CLR = { PAID: '#047857', PARTIAL: '#b45309', DUE: '#be123c', CASHLESS: '#4338ca' };

function useInvoiceQrs(inv, settings, vis, webLink) {
  const upiAmt = inv.balance > 0 ? inv.balance : inv.net;
  const showUpi = vis.upiQr && settings.billing.upiId && inv.billingType !== 'umid' && (inv.balance > 0 || DIGITAL_MODES.has(inv.paymentMode) || inv.paymentMode === 'split');
  const upi = useQr(showUpi ? upiLink({ pa: settings.billing.upiId, pn: settings.billing.upiPayeeName, am: upiAmt, tn: 'Invoice ' + inv.invoiceNo, tr: inv.invoiceNo }) : '', { size: 220 });
  const review = useQr(vis.reviewQr ? settings.engagement.googleReviewUrl : '', { size: 160 });
  const feedback = useQr(vis.reviewQr ? settings.engagement.feedbackUrl : '', { size: 160 });
  const web = useQr(webLink || '', { size: 160 });
  return { upi, upiAmt, review, feedback, web, showUpi: showUpi && !!upi };
}

function signer() {
  const u = store.get('users', 'u_ghanshyam');
  return u && u.digitalSignatureUrl ? u.digitalSignatureUrl : '';
}

function paymentsLine(inv) {
  if (inv.billingType === 'umid') return 'Cashless bill at CGHS rates';
  const pays = (inv.payments || []).filter((p) => Number(p.amount) !== 0);
  if (!pays.length) return 'No payment received (credit / due)';
  return pays.map((p) => (MODE_LABEL[p.mode] || p.mode) + ' ' + money(p.amount) + (fmtDate(p.at) !== fmtDate(inv.date) ? ' (' + fmtDate(p.at) + ')' : '')).join(' + ');
}

function Header({ settings, compact, tiny }) {
  const c = settings.clinic;
  // A4 / A5 bills can print the clinic's own letterhead image (Settings → Print & reports → Letterhead templates)
  const lt = !tiny && (settings.letterheads || []).find((t) => t.id === (settings.billing || {}).letterheadId && t.kind === 'image' && t.headerImage);
  if (lt) {
    return (
      <div style={{ height: (Number(lt.headerHeight) || 35) * MM * (compact ? 0.72 : 1), marginBottom: 3, flexShrink: 0 }}>
        <img src={lt.headerImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center top', display: 'block' }} />
      </div>
    );
  }
  const logo = c.logo ? `<img src="${c.logo}" style="width:100%;height:100%;object-fit:contain"/>` : brandSvg('100%');
  if (tiny) {
    return (
      <div style={{ textAlign: 'center', borderBottom: '1.5px solid #0f172a', paddingBottom: 3, marginBottom: 4 }}>
        <div style={{ fontWeight: 800, fontSize: 11.5, letterSpacing: 0.2 }}>{c.name.toUpperCase()}</div>
        <div style={{ fontSize: 7.5 }}>{c.address}</div>
        <div style={{ fontSize: 7.5 }}>☎ {c.phone}{c.phone2 ? ', ' + c.phone2 : ''} · {c.email}</div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: compact ? 8 : 12, alignItems: 'center', borderBottom: '2px solid #0369a1', paddingBottom: compact ? 4 : 7 }}>
      <div style={{ width: compact ? 38 : 58, height: compact ? 38 : 58, flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: logo }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: '"Plus Jakarta Sans", Inter, Arial', fontWeight: 800, fontSize: compact ? 14.5 : 20, color: '#0c4a6e', lineHeight: 1.1, letterSpacing: -0.2 }}>{c.name.toUpperCase()}</div>
        <div style={{ fontSize: compact ? 8.3 : 9.6, color: '#334155', marginTop: 2, lineHeight: 1.3 }}>{c.address}</div>
        <div style={{ fontSize: compact ? 8.3 : 9.6, color: '#334155', lineHeight: 1.3 }}>☎ {c.phone}{c.phone2 ? ', ' + c.phone2 : ''} &nbsp;|&nbsp; ✉ {c.email}{c.gstin ? ' | GSTIN ' + c.gstin : ''}</div>
      </div>
      {!compact && (
        <div style={{ textAlign: 'right', fontSize: 9, lineHeight: 1.35, color: '#0f172a', maxWidth: '38%' }}>
          <div style={{ fontWeight: 700, fontSize: 10.5 }}>{c.radiologist.name}</div>
          <div>{c.radiologist.qualification} · {c.radiologist.designation}</div>
          <div>RMC Reg. No.: {c.radiologist.rmc}</div>
        </div>
      )}
    </div>
  );
}

function PndtBanner({ settings, compact }) {
  return (
    <div style={{ background: '#e0f2fe', border: '1px solid #7dd3fc', color: '#0c4a6e', fontSize: compact ? 7.8 : 9, fontWeight: 700, padding: compact ? '2px 6px' : '3px 8px', marginTop: 4, borderRadius: 3, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span>PC-PNDT Reg. No.: {settings.clinic.pcpndtRegNo}</span>
      {compact ? <span>{settings.clinic.radiologist.name} · RMC {settings.clinic.radiologist.rmc}</span> : <span>Sex determination of foetus is not done here — punishable under PC-PNDT Act, 1994</span>}
    </div>
  );
}

function TitleBar({ copy, inv, compact }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: compact ? '4px 0' : '7px 0 5px' }}>
      <div style={{ fontWeight: 800, fontSize: compact ? 11 : 13.5, letterSpacing: 1.5, color: '#0f172a' }}>{inv.billingType === 'umid' ? 'CASHLESS BILL' : 'INVOICE / BILL RECEIPT'}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ border: '1.5px solid ' + STATUS_CLR[inv.status], color: STATUS_CLR[inv.status], fontWeight: 800, fontSize: compact ? 8 : 9.5, padding: '1px 7px', borderRadius: 3 }}>{STATUS_TXT[inv.status] || inv.status}</span>
        {copy && <span style={{ background: '#0f172a', color: '#fff', fontWeight: 800, fontSize: compact ? 8 : 9.5, padding: '2px 8px', borderRadius: 3, letterSpacing: 1 }}>{copy}</span>}
      </div>
    </div>
  );
}

const NOWRAP = new Set(['Bill No.', 'Reg. ID', 'Mobile', 'Age / Sex']);
function PatientGrid({ inv, vis, settings, compact }) {
  const p = inv.patient;
  const aad = p.aadhaar ? (settings.print.maskAadhaar ? maskAadhaar(p.aadhaar) : formatAadhaar(p.aadhaar)) : '';
  const cells = [
    ['Bill No.', <b key="n">{inv.invoiceNo}</b>], ['Date & Time', fmtDate(inv.date) + ' ' + fmtTime(inv.date)],
    ['Patient', <b key="p">{fullName(p)}</b>], ['Age / Sex', ageSex(p)],
    [p.relation || 'C/O', p.guardianName || '—'], ['Mobile', p.mobile || '—'],
    ['Reg. ID', p.regId || '—'], vis.refDoctor ? ['Referred by', inv.referredByName || 'Self'] : null,
    ['Address', p.address || '—'], vis.aadhaar && aad ? ['Aadhaar', aad] : null
  ].filter(Boolean);
  const fs = compact ? 8.6 : 10;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: fs }}>
      {cells.map(([k, v], i) => (
        <div key={i} style={{ display: 'flex', gap: compact ? 4 : 6, padding: compact ? '2px 5px' : '3.5px 8px', borderBottom: i < cells.length - 2 ? '1px solid #e2e8f0' : 'none', borderRight: i % 2 === 0 ? '1px solid #e2e8f0' : 'none', minWidth: 0 }}>
          <span style={{ color: '#64748b', minWidth: compact ? 46 : 68, flexShrink: 0 }}>{k}</span><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: NOWRAP.has(k) ? 'nowrap' : undefined }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function UmidBlock({ inv, compact }) {
  if (inv.billingType !== 'umid' || !inv.umid) return null;
  const u = inv.umid;
  return (
    <div style={{ marginTop: 5, border: '1px dashed #6366f1', background: '#eef2ff', borderRadius: 4, padding: compact ? '2px 6px' : '4px 8px', fontSize: compact ? 8 : 9.2, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 10px' }}>
      <span><b>UMID Card:</b> {u.cardNo}</span><span><b>Referral No.:</b> {u.referralNo} ({fmtDate(u.referralDate)})</span>
      <span><b>Employee:</b> {u.employeeName} ({u.relation})</span><span><b>Designation / Unit:</b> {u.designation}, {u.unit}</span>
      <span><b>Referred from:</b> {u.referringUnit}</span><span><b>Verified:</b> {u.verified ? 'Yes – ' + fmtDate(u.verifiedAt) : 'Pending'}</span>
    </div>
  );
}

function ItemsTable({ inv, rowPad, compact, fs }) {
  const pad = (rowPad || (compact ? 2 : 5)) + 'px 7px';
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: fs || (compact ? 9 : 10.5), marginTop: compact ? 4 : 7 }}>
      <thead>
        <tr style={{ background: '#0c4a6e', color: '#fff' }}>
          <th style={{ padding: '4px 6px', textAlign: 'left', width: 26 }}>#</th>
          <th style={{ padding: '4px 6px', textAlign: 'left' }}>Investigation</th>
          {!compact && <th style={{ padding: '4px 6px', textAlign: 'left', width: 92 }}>Department</th>}
          <th style={{ padding: '4px 6px', textAlign: 'right', width: 88 }}>Amount (₹)</th>
        </tr>
      </thead>
      <tbody>
        {(inv.items || []).map((it, i) => (
          <tr key={i} style={{ borderBottom: '1px solid #e2e8f0', background: i % 2 ? '#f8fafc' : '#fff' }}>
            <td style={{ padding: pad, color: '#64748b' }}>{i + 1}</td>
            <td style={{ padding: pad }}><span style={{ fontWeight: 600 }}>{it.name}</span>{!compact && <span style={{ color: '#94a3b8', fontSize: '0.85em' }}> &nbsp;{it.code}</span>}</td>
            {!compact && <td style={{ padding: pad, color: deptOf(it.department).hex, fontWeight: 600 }}>{deptOf(it.department).short}</td>}
            <td style={{ padding: pad, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(it.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Totals({ inv, vis, compact, width }) {
  const row = (k, v, o = {}) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: compact ? '1px 0' : '2.5px 0', fontWeight: o.bold ? 800 : 500, color: o.color || '#0f172a', fontSize: o.big ? (compact ? 11.5 : 14) : compact ? 9 : 10.5, borderTop: o.line ? '1px solid #cbd5e1' : 'none' }}>
      <span>{k}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );
  const showDisc = vis.discount && Number(inv.discountAmount) > 0;
  return (
    <div style={{ width: width || '46%', minWidth: compact ? 0 : 190 }}>
      {row('Gross Total', money(inv.gross))}
      {showDisc && row('Concession' + (inv.discountType === 'percent' ? ' (' + inv.discountValue + '%)' : ''), '− ' + money(inv.discountAmount), { color: '#be123c' })}
      {Number(inv.taxAmount) > 0 && row((inv.taxLabel || 'GST') + ' @ ' + inv.taxRate + '% on ' + money(inv.taxable), '+ ' + money(inv.taxAmount))}
      {row(inv.billingType === 'umid' ? 'Net Claim (CGHS)' : 'Net Payable', money(inv.net), { bold: true, big: true, line: true })}
      {vis.balance && inv.billingType !== 'umid' && row('Total Received', money(inv.paid), { color: '#047857' })}
      {vis.balance && inv.billingType !== 'umid' && (inv.balance > 0
        ? row('Balance Due', money(inv.balance), { bold: true, color: '#be123c' })
        : <div style={{ marginTop: 3, textAlign: 'right' }}><span style={{ display: 'inline-block', border: '2px solid #047857', color: '#047857', fontWeight: 900, fontSize: compact ? 9 : 11, padding: '1px 8px', borderRadius: 4, transform: 'rotate(-3deg)', letterSpacing: 1 }}>PAID IN FULL</span></div>)}
    </div>
  );
}

function SignatureBlock({ settings, compact, staffName }) {
  const sig = signer();
  const c = settings.clinic;
  return (
    <div style={{ textAlign: 'right', fontSize: compact ? 8 : 9.5, lineHeight: 1.3 }}>
      <div style={{ height: compact ? 22 : 40, display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end' }}>{sig && <img src={sig} alt="" style={{ maxHeight: compact ? 22 : 40, maxWidth: 140 }} />}</div>
      <div style={{ borderTop: '1px solid #0f172a', paddingTop: 2, fontWeight: 800 }}>{c.radiologist.name}, {c.radiologist.qualification}</div>
      <div>RMC: {c.radiologist.rmc} · Authorised Signatory</div>
      {staffName && <div style={{ color: '#64748b' }}>Prepared by: {staffName}</div>}
    </div>
  );
}

function QrTile({ src, label, size }) {
  if (!src) return null;
  return (
    <div style={{ textAlign: 'center', width: size + 8 }}>
      <img src={src} alt={label} style={{ width: size, height: size, display: 'block', margin: '0 auto', border: '1px solid #e2e8f0' }} />
      <div style={{ fontSize: 7.5, color: '#334155', marginTop: 1, lineHeight: 1.15 }}>{label}</div>
    </div>
  );
}

/** One full-page A4 invoice with smart vertical auto-fill. */
function A4Invoice({ inv, settings, opts, copy, qrs, staffName }) {
  const vis = opts.visibility;
  const m = opts.margins;
  const innerH = (297 - m.top - m.bottom) * MM;
  const boxRef = useRef(null);
  const [rowPad, setRowPad] = useState(5);
  const [fit, setFit] = useState(1);
  const scale = (opts.scale || 100) / 100;
  const guides = vis.guidelines ? prepGuidelines(inv.items) : [];
  const custom = settings.engagement.customGuidelines;

  useLayoutEffect(() => {
    const el = boxRef.current;
    const content = el && el.querySelector('[data-content]');
    const spacer = content && content.querySelector('[data-spacer]');
    if (!content || !spacer || !content.firstElementChild) return;
    const r = el.getBoundingClientRect().height / innerH;
    if (!r) return;
    const zoom = scale * fit;
    const first = content.firstElementChild.getBoundingClientRect();
    const last = content.lastElementChild.getBoundingClientRect();
    const sp = spacer.getBoundingClientRect();
    const used = (last.bottom - first.top - sp.height) / r;
    const rows = Math.max(1, (inv.items || []).length);
    const curExtra = opts.autoFill ? rows * 2 * (rowPad - 5) * zoom : 0;
    const natural = (used - curExtra) / zoom;
    let nf = 1;
    if (opts.autoScale && natural * scale > innerH - 2) nf = Math.max(0.5, Math.floor(((innerH - 2) / (natural * scale)) * 100) / 100);
    if (Math.abs(nf - fit) > 0.004) { setFit(nf); return; }
    if (opts.autoFill) {
      const free0 = innerH - natural * zoom;
      const want = Math.round(Math.max(5, Math.min(20, 5 + (free0 * 0.45) / (rows * 2 * zoom))));
      if (want !== rowPad) setRowPad(want);
    } else if (rowPad !== 5) setRowPad(5);
  });

  return (
    <div ref={boxRef} style={{ height: innerH, overflow: 'hidden' }}>
      <div data-content style={{ zoom: scale * fit, minHeight: innerH / (scale * fit), display: 'flex', flexDirection: 'column', fontFamily: 'Inter, Arial, sans-serif', color: '#0f172a' }}>
        {vis.header ? <><Header settings={settings} /><PndtBanner settings={settings} /></> : <div style={{ height: (settings.report.letterheadTop || 40) * MM }} />}
        <TitleBar copy={copy} inv={inv} />
        <PatientGrid inv={inv} vis={vis} settings={settings} />
        <UmidBlock inv={inv} />
        <ItemsTable inv={inv} rowPad={opts.autoFill ? rowPad : 5} />
        <div data-spacer style={{ flexGrow: opts.autoFill ? 1 : 0, minHeight: 6 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, borderTop: '1.5px solid #0c4a6e', paddingTop: 6, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, fontSize: 9.5, minWidth: 0 }}>
            {settings.billing.showAmountInWords && <div style={{ fontWeight: 600, marginBottom: 3 }}>{amountInWords(inv.billingType === 'umid' ? inv.net : inv.paid || inv.net)}{inv.billingType !== 'umid' && inv.paid ? ' (received)' : ''}</div>}
            {vis.balance && <div style={{ color: '#334155', marginBottom: 3 }}><b>Payment:</b> {paymentsLine(inv)}</div>}
            {inv.discountReason && vis.discount && Number(inv.discountAmount) > 0 && <div style={{ color: '#334155' }}><b>Concession remark:</b> {inv.discountReason}</div>}
            {qrs.showUpi && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                <img src={qrs.upi} alt="UPI" style={{ width: 74, height: 74, border: '1px solid #e2e8f0' }} />
                <div style={{ fontSize: 9 }}><div style={{ fontWeight: 800, color: '#0c4a6e' }}>Scan to pay via any UPI app</div><div>Amount: <b>{money(qrs.upiAmt)}</b></div><div>UPI ID: {settings.billing.upiId}</div></div>
              </div>
            )}
          </div>
          <Totals inv={inv} vis={vis} />
        </div>
        {(guides.length > 0 || (vis.guidelines && custom)) && (
          <div style={{ marginTop: 7, border: '1px solid #bae6fd', background: '#f0f9ff', borderRadius: 4, padding: '4px 8px', fontSize: 8.8, lineHeight: 1.35 }}>
            <div style={{ fontWeight: 800, color: '#0369a1', marginBottom: 1 }}>Patient preparation guidelines</div>
            {guides.map((g, i) => <div key={i}>• <b>{g.test}:</b> {g.text}</div>)}
            {custom && <div>• {custom}</div>}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 8, gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {vis.reviewQr && <QrTile src={qrs.review} label={'Rate us on Google ⭐'} size={58} />}
            {vis.reviewQr && <QrTile src={qrs.feedback} label="Feedback" size={58} />}
            {qrs.web && <QrTile src={qrs.web} label="Digital receipt" size={58} />}
          </div>
          {vis.signature && <SignatureBlock settings={settings} staffName={staffName} />}
        </div>
        <div style={{ marginTop: 6, borderTop: '1px solid #cbd5e1', paddingTop: 3, fontSize: 8, color: '#64748b', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{settings.clinic.footerNote}</span><span>{settings.clinic.workingHours}</span>
        </div>
      </div>
    </div>
  );
}

/** Compact copy used for dual (half-page), 1/3 and 1/4 slips. */
function CompactInvoice({ inv, settings, opts, copy, qrs, staffName, variant, heightMm, widthMm }) {
  const vis = opts.visibility;
  const scale = (opts.scale || 100) / 100;
  const third = variant === 'third';
  const quarter = variant === 'quarter';
  const boxRef = useRef(null);
  const [fit, setFit] = useState(1);
  const h = heightMm * MM;
  useLayoutEffect(() => {
    const box = boxRef.current;
    const c = box && box.firstChild;
    if (!c || !c.firstElementChild) return;
    const r = box.getBoundingClientRect().height / h;
    if (!r) return;
    const used = (c.lastElementChild.getBoundingClientRect().bottom - c.firstElementChild.getBoundingClientRect().top) / r;
    const natural = used / (scale * fit);
    let nf = 1;
    if (opts.autoScale && natural * scale > h - 2) nf = Math.max(0.45, Math.floor(((h - 2) / (natural * scale)) * 100) / 100);
    if (Math.abs(nf - fit) > 0.004) setFit(nf);
  });
  const body = (
    <div style={{ zoom: scale * fit, fontFamily: 'Inter, Arial, sans-serif', color: '#0f172a', width: widthMm ? (widthMm * MM) / (scale * fit) : undefined }}>
      {vis.header ? <><Header settings={settings} compact />{!quarter && <PndtBanner settings={settings} compact />}</> : <div style={{ height: 14 * MM }} />}
      <TitleBar copy={copy} inv={inv} compact />
      {third ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1.05fr 1fr 0.8fr', gap: 8 }}>
          <PatientGrid inv={inv} vis={vis} settings={settings} compact />
          <ItemsTable inv={inv} compact fs={8.6} />
          <div><Totals inv={inv} vis={vis} compact width="100%" />{qrs.showUpi && <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 3 }}><img src={qrs.upi} alt="UPI" style={{ width: 46, height: 46 }} /><span style={{ fontSize: 7.5 }}>Scan to pay {money(qrs.upiAmt)}</span></div>}</div>
        </div>
      ) : (
        <>
          <PatientGrid inv={inv} vis={vis} settings={settings} compact />
          <UmidBlock inv={inv} compact />
          <ItemsTable inv={inv} compact fs={quarter ? 8.4 : 9} />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 4, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, fontSize: 8, minWidth: 0 }}>
              {vis.balance && <div><b>Payment:</b> {paymentsLine(inv)}</div>}
              {qrs.showUpi && <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginTop: 3 }}><img src={qrs.upi} alt="UPI" style={{ width: quarter ? 44 : 52, height: quarter ? 44 : 52 }} /><span style={{ fontSize: 7.6 }}>Scan to pay<br /><b>{money(qrs.upiAmt)}</b></span></div>}
            </div>
            <Totals inv={inv} vis={vis} compact width={quarter ? '58%' : '44%'} />
          </div>
        </>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 4, gap: 6 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {vis.reviewQr && !quarter && <QrTile src={qrs.review} label="Google review" size={36} />}
        </div>
        {vis.signature && <SignatureBlock settings={settings} compact staffName={quarter ? '' : staffName} />}
      </div>
    </div>
  );
  return <div ref={boxRef} style={{ height: h, overflow: 'hidden' }}>{body}</div>;
}

function ThermalReceipt({ inv, settings, opts, qrs, staffName }) {
  const vis = opts.visibility;
  const line = <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />;
  const r = (k, v, b) => <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: b ? 800 : 400 }}><span>{k}</span><span>{v}</span></div>;
  return (
    <div style={{ zoom: (opts.scale || 100) / 100, fontFamily: '"Courier New", Consolas, monospace', fontSize: 10.5, color: '#000', lineHeight: 1.3 }}>
      {vis.header && <Header settings={settings} tiny />}
      {vis.header && <div style={{ fontSize: 7.5, textAlign: 'center' }}>PC-PNDT: {settings.clinic.pcpndtRegNo}</div>}
      {line}
      <div style={{ textAlign: 'center', fontWeight: 800 }}>{inv.billingType === 'umid' ? 'CASHLESS BILL' : 'BILL RECEIPT'}</div>
      {r('Bill:', inv.invoiceNo)}
      {r('Date:', fmtDate(inv.date) + ' ' + fmtTime(inv.date))}
      <div>Pt: <b>{fullName(inv.patient)}</b> ({ageSex(inv.patient)})</div>
      {inv.patient.guardianName && <div>{guardianLine(inv.patient)}</div>}
      <div>Mob: {inv.patient.mobile || '-'} · {inv.patient.regId}</div>
      {vis.refDoctor && <div>Ref: {inv.referredByName || 'Self'}</div>}
      {line}
      {(inv.items || []).map((it, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}><span>{i + 1}. {it.name}</span><span style={{ whiteSpace: 'nowrap' }}>{inr(it.amount, { symbol: false, decimals: 2 })}</span></div>
      ))}
      {line}
      {r('Gross', inr(inv.gross, { decimals: 2 }))}
      {vis.discount && Number(inv.discountAmount) > 0 && r('Discount', '-' + inr(inv.discountAmount, { decimals: 2 }))}
      {Number(inv.taxAmount) > 0 && r((inv.taxLabel || 'GST') + ' ' + inv.taxRate + '%', '+' + inr(inv.taxAmount, { decimals: 2 }))}
      {r('NET', inr(inv.net, { decimals: 2 }), true)}
      {vis.balance && inv.billingType !== 'umid' && r('Paid', inr(inv.paid, { decimals: 2 }))}
      {vis.balance && inv.billingType !== 'umid' && r(inv.balance > 0 ? 'BALANCE DUE' : 'STATUS', inv.balance > 0 ? inr(inv.balance, { decimals: 2 }) : 'PAID IN FULL', true)}
      {vis.balance && <div style={{ fontSize: 9 }}>{paymentsLine(inv)}</div>}
      {qrs.showUpi && <div style={{ textAlign: 'center', marginTop: 4 }}><img src={qrs.upi} alt="UPI" style={{ width: 110, height: 110 }} /><div style={{ fontSize: 9 }}>Scan & pay {inr(qrs.upiAmt, { decimals: 2 })}</div></div>}
      {line}
      {vis.guidelines && prepGuidelines(inv.items).map((g, i) => <div key={i} style={{ fontSize: 8.5 }}>* {g.test}: {g.text}</div>)}
      {vis.reviewQr && qrs.review && <div style={{ textAlign: 'center', marginTop: 4 }}><img src={qrs.review} alt="Review" style={{ width: 70, height: 70 }} /><div style={{ fontSize: 8.5 }}>Rate us on Google</div></div>}
      {vis.signature && <div style={{ textAlign: 'center', marginTop: 6, fontSize: 9 }}>{settings.clinic.radiologist.name}, {settings.clinic.radiologist.qualification}<br />RMC {settings.clinic.radiologist.rmc}</div>}
      <div style={{ textAlign: 'center', fontSize: 9, marginTop: 4 }}>{staffName ? 'Billed by ' + staffName + ' · ' : ''}Thank you · Get well soon</div>
    </div>
  );
}

const pageStyle = (w, h, m, gray) => ({ width: w + 'mm', height: h === 'auto' ? 'auto' : h + 'mm', padding: m ? `${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm` : 0, filter: gray ? 'grayscale(1)' : undefined });

/**
 * Renders the printable pages (.print-page) for the chosen format.
 * opts: { format, dualLayout, slipOnA4, margins, scale, autoScale, autoFill, colorMode, visibility }
 */
export function InvoicePages({ inv, settings, opts, webLink }) {
  const qrs = useInvoiceQrs(inv, settings, opts.visibility, webLink);
  const staff = store.get('users', inv.staffId);
  const staffName = staff ? staff.name : '';
  const gray = opts.colorMode === 'grayscale';
  const m = opts.margins;
  const common = { inv, settings, opts, qrs, staffName };
  switch (opts.format) {
    case 'a4dual': {
      if (opts.dualLayout === 'side') {
        const w = (297 - m.left - m.right - 8) / 2;
        return (
          <div className="print-page" style={pageStyle(297, 210, m, gray)}>
            <div style={{ display: 'flex', gap: 0, height: '100%' }}>
              <div style={{ width: w + 'mm', paddingRight: '4mm' }}><CompactInvoice {...common} copy="PATIENT COPY" variant="half" heightMm={210 - m.top - m.bottom} widthMm={w - 4} /></div>
              <div style={{ borderLeft: '1.5px dashed #64748b', position: 'relative' }}><span style={{ position: 'absolute', top: '45%', left: -9, background: '#fff', fontSize: 12 }}>✂</span></div>
              <div style={{ width: w + 'mm', paddingLeft: '4mm' }}><CompactInvoice {...common} copy="CENTER COPY" variant="half" heightMm={210 - m.top - m.bottom} widthMm={w - 4} /></div>
            </div>
          </div>
        );
      }
      const half = (297 - m.top - m.bottom - 8) / 2;
      return (
        <div className="print-page" style={pageStyle(210, 297, m, gray)}>
          <CompactInvoice {...common} copy="PATIENT COPY" variant="half" heightMm={half} />
          <div style={{ height: '8mm', display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 8 }}><span>✂</span><div style={{ flex: 1, borderTop: '1.5px dashed #64748b' }} /><span>cut here</span><div style={{ flex: 1, borderTop: '1.5px dashed #64748b' }} /></div>
          <CompactInvoice {...common} copy="CENTER COPY" variant="half" heightMm={half} />
        </div>
      );
    }
    case 'third':
    case 'quarter': {
      const third = opts.format === 'third';
      const w = third ? 210 : 105;
      const h = third ? 99 : 148.5;
      const slipM = { top: 5, right: 6, bottom: 4, left: 6 };
      const slip = (
        <div style={{ width: w + 'mm', height: h + 'mm', padding: `${slipM.top}mm ${slipM.right}mm ${slipM.bottom}mm ${slipM.left}mm`, boxSizing: 'border-box', position: 'relative', outline: opts.slipOnA4 ? '1px dashed #94a3b8' : 'none' }}>
          <CompactInvoice {...common} variant={opts.format} heightMm={h - slipM.top - slipM.bottom} />
        </div>
      );
      if (opts.slipOnA4) return <div className="print-page" style={pageStyle(210, 297, null, gray)}>{slip}<div style={{ fontSize: 8, color: '#94a3b8', padding: '2mm 6mm' }}>✂ Cut along the dashed line</div></div>;
      return <div className="print-page" style={pageStyle(w, h, null, gray)}>{slip}</div>;
    }
    case 'thermal':
      return <div className="print-page" style={Object.assign(pageStyle(80, 'auto', null, gray), { padding: '3mm 3.5mm 6mm' })}><ThermalReceipt {...common} /></div>;
    case 'patient':
    case 'center':
    case 'a4':
    default:
      return (
        <div className="print-page" style={pageStyle(210, 297, m, gray)}>
          <A4Invoice {...common} copy={opts.format === 'patient' ? 'PATIENT COPY' : opts.format === 'center' ? 'CENTER COPY' : ''} />
        </div>
      );
  }
}

export function pageSizeFor(opts) {
  if (opts.format === 'a4dual' && opts.dualLayout === 'side') return { w: 297, h: 210 };
  if (opts.format === 'third') return opts.slipOnA4 ? { w: 210, h: 297 } : { w: 210, h: 99 };
  if (opts.format === 'quarter') return opts.slipOnA4 ? { w: 210, h: 297 } : { w: 105, h: 148.5 };
  if (opts.format === 'thermal') return { w: 80, h: 'auto' };
  return { w: 210, h: 297 };
}
