// Settings: clinic profile & logo (letterheads, invoices, messages), billing / UPI / patient links /
// engagement, print & report defaults (incl. pre-printed letterhead spacers), lab report options, AI &
// Gemini, server integrations (SMTP, WhatsApp API & templates, SMS / DLT, IMAP inbox, OAuth apps),
// LAN & workstation, backup & storage, appearance. Shared settings need the administrator;
// per-workstation preferences (theme, AI key, workstation name) are open to everyone.
import { useEffect, useMemo, useState } from 'react';
import {
  Building2, Receipt, Printer, Bot, PlugZap, Network, HardDrive, Palette, Save, RotateCcw, Upload, Trash2, QrCode, ShieldCheck, Eye, EyeOff, Server, RefreshCw,
  MessageCircle, Mail, Smartphone, Inbox, Cloud, Monitor, Sun, Moon, Laptop, FlaskConical, Package, Plus, Tv, CheckCheck, Copy, KeyRound, FileImage, Pencil
} from 'lucide-react';
import { TestPicker } from '../../components/TestPicker';
import { DEPT_NAME, DEFAULT_PROC_MIN, procedureMinutes, tvDepartments } from '../../core/clinic';
import { useSettings, saveSettings, useRoute, navigate, getSettings, useColl } from '../../core/hooks';
import { events } from '../../core/store';
import { api, isServer, useNet, getWorkstationName, setWorkstationName, refreshIntegrations } from '../../core/sync';
import { can, logAudit } from '../../core/auth';
import { aiConfig, setAiConfig, aiAvailability, listModels, GEMINI_MODELS, isRetiredModel } from '../../core/ai';
import { estimateStorage, requestPersistence } from '../../core/idb';
import { applyTheme } from '../../core/boot-wrapper';
import { useQr, upiLink } from '../../core/qr';
import { cx, Card, Button, Badge, Input, Textarea, Select, Field, Segmented, Toggle, Tabs, Modal, toast, confirmDialog } from '../../components/ui';
import { letterheadHtml, imageHeaderHtml, imageFooterHtml } from '../reporting/reportPrint';
import { BrandMark, brandSvg } from '../../components/dept';
import { deepMerge, lsGet, lsSet, pickFiles, readAsDataURL, fmtBytes, inr, copyText } from '../../core/utils';

const TABS = [
  { id: 'clinic', label: 'Clinic profile', icon: Building2 },
  { id: 'billing', label: 'Billing & payments', icon: Receipt },
  { id: 'print', label: 'Print & reports', icon: Printer },
  { id: 'ai', label: 'AI & Gemini', icon: Bot },
  { id: 'integrations', label: 'Integrations', icon: PlugZap },
  { id: 'lan', label: 'LAN & workstation', icon: Network },
  { id: 'backup', label: 'Backup & storage', icon: HardDrive },
  { id: 'appearance', label: 'Appearance', icon: Palette }
];

/** Draft editing of one settings section with Save / Discard. */
function useSection(key) {
  const settings = useSettings();
  const [draft, setDraft] = useState(null);
  const cur = draft || settings[key];
  const set = (patch) => setDraft(deepMerge(cur, patch));
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(settings[key]);
  const save = () => { saveSettings({ [key]: draft }); logAudit('settings:' + key + '_saved', 'settings/' + key, {}); setDraft(null); toast('Settings saved — applied on every workstation', 'success'); };
  return { cur, set, dirty, save, discard: () => setDraft(null) };
}

function SaveBar({ s, disabled }) {
  if (!s.dirty) return null;
  return (
    <div className="sticky bottom-3 z-20 mt-3 flex items-center justify-end gap-2 rounded-xl border border-amber-300 bg-amber-50/95 px-3 py-2 shadow-pop backdrop-blur dark:border-amber-800 dark:bg-amber-950/80">
      <span className="mr-auto text-[12.5px] font-semibold text-amber-900 dark:text-amber-200">Unsaved changes</span>
      <Button size="sm" icon={RotateCcw} onClick={s.discard}>Discard</Button>
      <Button size="sm" variant="primary" icon={Save} disabled={disabled} onClick={s.save}>Save</Button>
    </div>
  );
}

export function Settings() {
  const route = useRoute();
  const admin = can('settings:manage_clinic_and_integrations');
  const tab = TABS.some((t) => t.id === route.query.tab) ? route.query.tab : 'clinic';
  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h1 className="font-display text-xl font-extrabold tracking-tight sm:text-2xl">Settings</h1>
        <p className="text-[13px] text-muted">{admin ? 'Clinic-wide settings sync to every workstation instantly.' : 'Clinic-wide settings are read-only for your role; workstation preferences are yours to change.'}</p>
      </div>
      <Tabs tabs={TABS} value={tab} onChange={(id) => navigate('/settings', { tab: id })} />
      {tab === 'clinic' && <ClinicTab admin={admin} />}
      {tab === 'billing' && <BillingTab admin={admin} />}
      {tab === 'print' && <PrintTab admin={admin} />}
      {tab === 'ai' && <AiTab admin={admin} />}
      {tab === 'integrations' && <IntegrationsTab admin={admin} />}
      {tab === 'lan' && <LanTab admin={admin} />}
      {tab === 'backup' && <BackupTab />}
      {tab === 'appearance' && <AppearanceTab />}
    </div>
  );
}

// ---------------------------------------------------------------- clinic
function ClinicTab({ admin }) {
  const s = useSection('clinic');
  const c = s.cur;
  const person = (k, label, regLabel) => (
    <Card title={label} icon={ShieldCheck}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input value={c[k].name} onChange={(e) => s.set({ [k]: { name: e.target.value } })} /></Field>
        <Field label="Qualification"><Input value={c[k].qualification || ''} onChange={(e) => s.set({ [k]: { qualification: e.target.value } })} /></Field>
        <Field label="Designation"><Input value={c[k].designation || ''} onChange={(e) => s.set({ [k]: { designation: e.target.value } })} /></Field>
        <Field label={regLabel}><Input value={c[k][k === 'labTech' ? 'rpmc' : 'rmc'] || ''} onChange={(e) => s.set({ [k]: { [k === 'labTech' ? 'rpmc' : 'rmc']: e.target.value } })} /></Field>
      </div>
    </Card>
  );
  const pickLogo = async () => {
    const [f] = await pickFiles({ accept: 'image/png,image/jpeg,image/svg+xml,image/webp' });
    if (!f) return;
    if (f.size > 350 * 1024) return toast('Logo must be under 350 KB (PNG / SVG recommended)', 'warning');
    s.set({ logo: await readAsDataURL(f) });
  };
  return (
    <fieldset disabled={!admin} className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Centre" subtitle="Printed on letterheads, invoices, statements, labels and patient messages" icon={Building2}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Centre name" className="sm:col-span-2"><Input value={c.name} onChange={(e) => s.set({ name: e.target.value })} /></Field>
            <Field label="Short name"><Input value={c.shortName} onChange={(e) => s.set({ shortName: e.target.value })} /></Field>
            <Field label="Tagline (services)"><Input value={c.tagline} onChange={(e) => s.set({ tagline: e.target.value })} /></Field>
            <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={c.address} onChange={(e) => s.set({ address: e.target.value })} /></Field>
            <Field label="Phone"><Input value={c.phone} onChange={(e) => s.set({ phone: e.target.value })} /></Field>
            <Field label="Phone 2"><Input value={c.phone2} onChange={(e) => s.set({ phone2: e.target.value })} /></Field>
            <Field label="E-mail"><Input value={c.email} onChange={(e) => s.set({ email: e.target.value })} /></Field>
            <Field label="Website"><Input value={c.website} onChange={(e) => s.set({ website: e.target.value })} /></Field>
            <Field label="GSTIN (optional)"><Input value={c.gstin} onChange={(e) => s.set({ gstin: e.target.value.toUpperCase() })} /></Field>
            <Field label="Working hours"><Input value={c.workingHours} onChange={(e) => s.set({ workingHours: e.target.value })} /></Field>
            <Field label="PC-PNDT registration (invoices & reports)" className="sm:col-span-2"><Input value={c.pcpndtRegNo} onChange={(e) => s.set({ pcpndtRegNo: e.target.value })} /></Field>
            <Field label="Invoice footer note" className="sm:col-span-2"><Input value={c.footerNote} onChange={(e) => s.set({ footerNote: e.target.value })} /></Field>
          </div>
        </Card>
        <Card title="Logo" subtitle="Used on every printed header" icon={Upload}>
          <div className="flex flex-col items-center gap-3">
            {c.logo
              ? <BrandMark logo={c.logo} className="h-28 w-28 rounded-2xl border border-line bg-white p-2" />
              : <span className="flex h-28 w-28 items-center justify-center rounded-2xl border border-line bg-white" dangerouslySetInnerHTML={{ __html: brandSvg(84) }} />}
            <div className="flex gap-2"><Button size="sm" icon={Upload} onClick={pickLogo}>Upload logo</Button>{c.logo && <Button size="sm" variant="danger-ghost" icon={Trash2} onClick={() => s.set({ logo: '' })}>Remove</Button>}</div>
            <p className="text-center text-[11px] text-muted">PNG / SVG, square, under 350 KB. Without a logo the built-in Shiv Sonography mark is used.</p>
          </div>
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        {person('radiologist', 'Radiologist (USG reports)', 'RMC registration')}
        {person('pathologist', 'Pathologist (lab reports)', 'RMC registration')}
        {person('labTech', 'Lab technician', 'RPMC registration')}
      </div>
      <p className="text-[11.5px] text-muted">Form F wording, its registration line and doctor text are edited in PC-PNDT Form F → Customise. Staff signatures are uploaded in Admin Console → Staff.</p>
      <SaveBar s={s} disabled={!admin} />
    </fieldset>
  );
}

// ---------------------------------------------------------------- billing
function BillingTab({ admin }) {
  const b = useSection('billing');
  const en = useSection('engagement');
  const disp = useSection('dispatch');
  const qr = useQr(b.cur.upiId ? upiLink({ pa: b.cur.upiId, pn: b.cur.upiPayeeName, am: 1, tn: 'Test' }) : '', { size: 160 });
  const both = { dirty: b.dirty || en.dirty || disp.dirty, save: () => { if (b.dirty) b.save(); if (en.dirty) en.save(); if (disp.dirty) disp.save(); }, discard: () => { b.discard(); en.discard(); disp.discard(); } };
  return (
    <fieldset disabled={!admin} className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Invoices" icon={Receipt}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Invoice prefix" hint={'Next number looks like ' + (b.cur.invoicePrefix || 'SSDC') + '-' + new Date().getFullYear() + '-' + '1'.padStart(b.cur.invoicePad || 4, '0')}><Input value={b.cur.invoicePrefix} onChange={(e) => b.set({ invoicePrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} /></Field>
            <Field label="Number width"><Select value={String(b.cur.invoicePad)} onChange={(e) => b.set({ invoicePad: Number(e.target.value) })} options={['3', '4', '5', '6']} /></Field>
            <Field label="Default payment mode"><Select value={b.cur.defaultPaymentMode} onChange={(e) => b.set({ defaultPaymentMode: e.target.value })} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }]} /></Field>
            <div className="flex flex-col justify-end gap-2">
              <Toggle checked={!!b.cur.requireReferringDoctor} onChange={(v) => b.set({ requireReferringDoctor: v })} label="Referring doctor required" />
              <Toggle checked={b.cur.showAmountInWords !== false} onChange={(v) => b.set({ showAmountInWords: v })} label="Amount in words on invoice" />
            </div>
            <Field label="Public base URL for patient links" className="sm:col-span-2" hint="e.g. https://reports.shivsonography.in/ — leave blank on the LAN (links then work on the clinic Wi-Fi, or as self-contained links)."><Input value={b.cur.publicBaseUrl} onChange={(e) => b.set({ publicBaseUrl: e.target.value.trim() })} placeholder="https://…" /></Field>
          </div>
        </Card>
        <Card title="UPI payments" subtitle="QR on invoices & the patient web receipt" icon={QrCode}>
          <div className="flex flex-wrap items-start gap-4">
            <div className="grid min-w-[240px] flex-1 gap-3">
              <Field label="UPI ID (VPA)" hint="Must be set for the UPI QR to appear — e.g. shivsono@sbi"><Input value={b.cur.upiId} onChange={(e) => b.set({ upiId: e.target.value.trim() })} placeholder="name@bank" /></Field>
              <Field label="Payee name"><Input value={b.cur.upiPayeeName} onChange={(e) => b.set({ upiPayeeName: e.target.value })} /></Field>
            </div>
            {qr ? <img src={qr} alt="UPI QR preview" className="h-36 w-36 rounded-xl border border-line bg-white p-1.5" /> : <div className="flex h-36 w-36 items-center justify-center rounded-xl border border-dashed border-line text-center text-[11px] text-muted">Enter a UPI ID to preview the QR (₹1 test)</div>}
          </div>
        </Card>
        <Card title="Auto-send invoice on bill generation" icon={MessageCircle}>
          <Toggle checked={!!b.cur.autoSend} onChange={(v) => b.set({ autoSend: v })} label="Auto-send invoice (WhatsApp / SMS / e-mail) when a bill is saved" hint="Uses the patient’s mobile / e-mail and the invoice templates" />
          <div className="mt-3 flex flex-wrap gap-4">{['whatsapp', 'sms', 'email'].map((c) => <Toggle key={c} size="sm" checked={!!(b.cur.autoSendChannels || {})[c]} onChange={(v) => b.set({ autoSendChannels: { [c]: v } })} label={{ whatsapp: 'WhatsApp', sms: 'SMS', email: 'E-mail' }[c]} />)}</div>
          <div className="mt-3 border-t border-line pt-3"><Field label="Default message language"><Segmented value={disp.cur.defaultLanguage || 'en'} onChange={(v) => disp.set({ defaultLanguage: v })} options={[{ value: 'en', label: 'English' }, { value: 'hi', label: 'हिन्दी / Bilingual' }]} /></Field></div>
          <p className="mt-2 text-[11.5px] text-muted">Report auto-send rules (on signing, upload, e-mail import, evening batch) live in Dispatch Center → Auto-send rules.</p>
        </Card>
        <Card title="Tax & receipts" subtitle="Applied to every new bill" icon={Receipt}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tax name"><Input value={b.cur.taxLabel || 'GST'} onChange={(e) => b.set({ taxLabel: e.target.value })} /></Field>
            <Field label="Tax rate on bills" hint="Diagnostic services by a clinical establishment are GST-exempt. Change only on your tax adviser’s advice.">
              <Select value={String(b.cur.taxRate || 0)} onChange={(e) => b.set({ taxRate: Number(e.target.value) })} options={[{ value: '0', label: 'Nil / exempt (0%)' }, { value: '5', label: '5%' }, { value: '12', label: '12%' }, { value: '18', label: '18%' }]} />
            </Field>
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <Toggle checked={!!(b.cur.receipt || {}).autoPrint} onChange={(v) => b.set({ receipt: { autoPrint: v } })} label="Print the receipt automatically after saving a bill" hint="Each billing desk can still switch “Print receipt” on or off at checkout" />
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <Toggle checked={!!(b.cur.tierRules || {}).autoEmergency} onChange={(v) => b.set({ tierRules: { autoEmergency: v } })} label="Start night-time bills at the Emergency / STAT rate" hint="Partner doctors’ bills always start at their own tier (Accounts → Doctor master). The desk can switch tier on any bill." />
            {(b.cur.tierRules || {}).autoEmergency && (
              <div className="mt-2 grid grid-cols-2 gap-3">
                <Field label="From"><Input type="time" value={(b.cur.tierRules || {}).emergencyFrom || '21:00'} onChange={(e) => b.set({ tierRules: { emergencyFrom: e.target.value } })} /></Field>
                <Field label="Until"><Input type="time" value={(b.cur.tierRules || {}).emergencyTo || '08:00'} onChange={(e) => b.set({ tierRules: { emergencyTo: e.target.value } })} /></Field>
              </div>
            )}
          </div>
        </Card>
        <PackagesCard admin={admin} />
        <Card title="Patient engagement" subtitle="On invoices, web receipts and messages" icon={MessageCircle}>
          <div className="grid gap-3">
            <Field label="Google review link"><Input value={en.cur.googleReviewUrl} onChange={(e) => en.set({ googleReviewUrl: e.target.value })} /></Field>
            <Field label="Feedback link (WhatsApp / form)"><Input value={en.cur.feedbackUrl} onChange={(e) => en.set({ feedbackUrl: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Review prompt"><Input value={en.cur.reviewText} onChange={(e) => en.set({ reviewText: e.target.value })} /></Field>
              <Field label="Feedback prompt"><Input value={en.cur.feedbackText} onChange={(e) => en.set({ feedbackText: e.target.value })} /></Field>
            </div>
            <Field label="Extra patient guidelines (web receipt)"><Textarea rows={3} value={en.cur.customGuidelines} onChange={(e) => en.set({ customGuidelines: e.target.value })} placeholder="e.g. Reports are ready after 4 PM. Bring this receipt when collecting reports." /></Field>
          </div>
        </Card>
      </div>
      <SaveBar s={both} disabled={!admin} />
    </fieldset>
  );
}

// ---------------------------------------------------------------- print & reports
function PrintTab({ admin }) {
  const settings = useSettings();
  const p = useSection('print');
  const r = useSection('report');
  const l = useSection('lab');
  const all = { dirty: p.dirty || r.dirty || l.dirty, save: () => { if (p.dirty) p.save(); if (r.dirty) r.save(); if (l.dirty) l.save(); }, discard: () => { p.discard(); r.discard(); l.discard(); } };
  const vis = p.cur.visibility || {};
  return (
    <fieldset disabled={!admin} className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Report letterhead (USG & lab)" subtitle="Full colour header, or blank space for pre-printed letterhead paper" icon={Printer}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Header" className="sm:col-span-2"><Segmented value={r.cur.headerMode} onChange={(v) => r.set({ headerMode: v, letterheadId: v === 'template' ? (r.cur.letterheadId || ((settings.letterheads || [])[0] || {}).id || '') : r.cur.letterheadId })}
              options={[{ value: 'full', label: 'Full colour header' }].concat((settings.letterheads || []).length ? [{ value: 'template', label: 'Letterhead template' }] : []).concat([{ value: 'letterhead', label: 'Pre-printed letterhead (spacer)' }, { value: 'none', label: 'No header' }])} /></Field>
            {r.cur.headerMode === 'template' && <Field label="Template for USG reports" className="sm:col-span-2"><Select value={r.cur.letterheadId || ''} onChange={(e) => r.set({ letterheadId: e.target.value })} options={(settings.letterheads || []).map((t) => ({ value: t.id, label: t.name }))} /></Field>}
            {r.cur.headerMode === 'letterhead' && <>
              <Field label="Top spacer (mm)" hint="Height of the printed header on your paper"><Input type="number" min={0} max={120} value={r.cur.letterheadTop} onChange={(e) => r.set({ letterheadTop: Number(e.target.value) || 0 })} /></Field>
              <Field label="Bottom spacer (mm)"><Input type="number" min={0} max={80} value={r.cur.letterheadBottom} onChange={(e) => r.set({ letterheadBottom: Number(e.target.value) || 0 })} /></Field>
            </>}
            <Field label="Font"><Select value={r.cur.fontFamily} onChange={(e) => r.set({ fontFamily: e.target.value })} options={['Arial', 'Calibri', 'Times New Roman', 'Georgia', 'Verdana', 'Tahoma', 'Cambria']} /></Field>
            <Field label="Font size (pt)"><Input type="number" min={8} max={16} step={0.5} value={r.cur.fontSize} onChange={(e) => r.set({ fontSize: Number(e.target.value) || 11 })} /></Field>
            <Field label="Line spacing"><Input type="number" min={1} max={2.2} step={0.05} value={r.cur.lineHeight} onChange={(e) => r.set({ lineHeight: Number(e.target.value) || 1.45 })} /></Field>
            <Field label="Scan images per page"><Select value={String(r.cur.imagesPerPage)} onChange={(e) => r.set({ imagesPerPage: Number(e.target.value) })} options={['2', '4', '6']} /></Field>
            <Field label="Footer text" className="sm:col-span-2"><Input value={r.cur.footerText} onChange={(e) => r.set({ footerText: e.target.value })} /></Field>
            <Field label="PC-PNDT declaration (obstetric reports)" className="sm:col-span-2"><Textarea rows={3} value={r.cur.pcpndtDeclaration} onChange={(e) => r.set({ pcpndtDeclaration: e.target.value })} /></Field>
            <Toggle checked={r.cur.showHeader !== false} onChange={(v) => r.set({ showHeader: v })} label="Show header" />
            <Toggle checked={r.cur.showFooter !== false} onChange={(v) => r.set({ showFooter: v })} label="Show footer & page numbers" />
            <Toggle checked={r.cur.watermarkDrafts !== false} onChange={(v) => r.set({ watermarkDrafts: v })} label="DRAFT / PROVISIONAL watermark until signed" />
          </div>
        </Card>
        <Card title="Report editor" icon={Printer}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Auto-save delay (seconds)"><Input type="number" min={1} max={30} value={r.cur.autosaveSeconds} onChange={(e) => r.set({ autosaveSeconds: Math.max(1, Number(e.target.value) || 2) })} /></Field>
            <div className="flex flex-col justify-end gap-2">
              <Toggle checked={r.cur.spellcheck !== false} onChange={(v) => r.set({ spellcheck: v })} label="Medical spell check" />
              <Toggle checked={r.cur.autocorrect !== false} onChange={(v) => r.set({ autocorrect: v })} label="Auto-correct dictation homophones" />
            </div>
          </div>
          <div className="mt-4 border-t border-line pt-3">
            <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><FlaskConical className="h-4 w-4 text-rose-600" />Lab reports</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Report title"><Input value={l.cur.reportTitle} onChange={(e) => l.set({ reportTitle: e.target.value })} /></Field>
              <Field label="Accreditation line"><Input value={l.cur.nablText} onChange={(e) => l.set({ nablText: e.target.value })} /></Field>
              <Field label="Footer text" className="sm:col-span-2"><Input value={l.cur.footerText} onChange={(e) => l.set({ footerText: e.target.value })} /></Field>
              <Toggle checked={l.cur.showMethod !== false} onChange={(v) => l.set({ showMethod: v })} label="Print test methods" />
            </div>
          </div>
        </Card>
        <Card title="Invoice printing defaults" subtitle="Format, copies and what appears on the bill" icon={Receipt} className="xl:col-span-2">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Paper"><Select value={p.cur.format} onChange={(e) => p.set({ format: e.target.value })} options={[{ value: 'a4', label: 'A4' }, { value: 'a5', label: 'A5' }, { value: 'third', label: '1/3 A4 slip' }, { value: 'thermal', label: '80 mm thermal' }]} /></Field>
            <Field label="Copies"><Select value={p.cur.copyMode} onChange={(e) => p.set({ copyMode: e.target.value })} options={[{ value: 'single', label: 'Single copy' }, { value: 'dual', label: 'Patient + office copy' }]} /></Field>
            <Field label="Margins"><Select value={p.cur.marginPreset} onChange={(e) => p.set({ marginPreset: e.target.value })} options={['narrow', 'standard', 'spacious']} /></Field>
            <Field label="Colour"><Select value={p.cur.colorMode} onChange={(e) => p.set({ colorMode: e.target.value })} options={[{ value: 'color', label: 'Colour' }, { value: 'grayscale', label: 'Grayscale' }]} /></Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {[['header', 'Header'], ['aadhaar', 'Aadhaar'], ['refDoctor', 'Referring doctor'], ['discount', 'Discount'], ['balance', 'Balance'], ['upiQr', 'UPI QR'], ['guidelines', 'Preparation guidelines'], ['reviewQr', 'Review QR'], ['signature', 'Signature']].map(([k, label]) => <Toggle key={k} size="sm" checked={vis[k] !== false} onChange={(v) => p.set({ visibility: { [k]: v } })} label={label} />)}
            <Toggle size="sm" checked={p.cur.maskAadhaar !== false} onChange={(v) => p.set({ maskAadhaar: v })} label="Mask Aadhaar (XXXX-XXXX-1234)" />
            <Toggle size="sm" checked={p.cur.autoScale !== false} onChange={(v) => p.set({ autoScale: v })} label="Auto-fit to page" />
          </div>
        </Card>
      </div>
      <LetterheadsCard admin={admin} />
      <SaveBar s={all} disabled={!admin} />
    </fieldset>
  );
}

// ---------------------------------------------------------------- AI
function AiTab({ admin }) {
  const net = useNet();
  const [cfg, setCfg] = useState(aiConfig());
  const [show, setShow] = useState(false);
  const [avail, setAvail] = useState(null);
  const [models, setModels] = useState([]);
  const [busy, setBusy] = useState(false);
  const update = (patch) => { setAiConfig(patch); setCfg(aiConfig()); };
  const check = async () => {
    setBusy(true);
    try { const a = await aiAvailability(); setAvail(a); if (a.ok) setModels((await listModels()) || []); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  useEffect(() => { check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // the Copilot's models first (by name), then anything else the key can use (Gemini 2.5 Flash / Flash-Lite are not offered)
  const opts = useMemo(() => {
    const curated = GEMINI_MODELS.map((m) => ({ value: m.id, label: m.label + ' — ' + m.note }));
    const seen = new Set(curated.map((o) => o.value));
    const rest = [cfg.model].concat(models.map((m) => (m.id || m.name || m).replace(/^models\//, ''))).filter((id) => id && !seen.has(id) && !isRetiredModel(id) && seen.add(id));
    return curated.concat(rest.map((id) => ({ value: id, label: id })));
  }, [models, cfg.model]);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Google Gemini" subtitle="Report drafting, Copilot expand, dictation clean-up, proofreading" icon={Bot}
        actions={avail ? <Badge tone={avail.ok ? 'emerald' : 'slate'}>{avail.ok ? 'Ready via ' + avail.via : 'Not configured'}</Badge> : null}>
        <div className="space-y-3">
          {net.mode === 'server' && <Toggle checked={cfg.useServer !== false} onChange={(v) => update({ useServer: v })} label="Use the clinic server’s key" hint="Recommended — the key stays on the server (Settings → Integrations → Gemini)" />}
          <Field label="Personal API key (this browser only)" hint="Google AI Studio → Get API key. Stored only in this browser’s local storage.">
            <div className="flex gap-2"><Input type={show ? 'text' : 'password'} value={cfg.apiKey} onChange={(e) => update({ apiKey: e.target.value.trim() })} placeholder="AIza…" autoComplete="off" /><Button icon={show ? EyeOff : Eye} onClick={() => setShow(!show)} aria-label="Show key" /></div>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Model" hint={models.length ? models.length + ' models available to your key' : 'Model list loads once a key works'}><Select value={cfg.model} onChange={(e) => update({ model: e.target.value })} options={opts} /></Field>
            <Field label="Creativity (temperature)"><Input type="number" min={0} max={1} step={0.1} value={cfg.temperature} onChange={(e) => update({ temperature: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })} /></Field>
          </div>
          <Toggle checked={!!cfg.deepThink} onChange={(v) => update({ deepThink: v })} label="Deep thinking" hint="Slower, more careful answers on models that support thinking" />
          <Button icon={RefreshCw} loading={busy} onClick={check}>Test connection & refresh models</Button>
          <p className="text-[11.5px] text-muted">AI output is a draft for the doctor to review — the suite never signs AI text automatically. Patient identifiers are not needed for drafting; review what you send.</p>
          {!admin && <p className="text-[11.5px] text-muted">The shared server key is managed by the administrator.</p>}
        </div>
      </Card>
      <Card title="Offline assistants" icon={Bot}>
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-muted">
          <li>Macro & template expansion, trigger words, medical spell check and dictation auto-correct work fully offline.</li>
          <li>Copilot “offline expand” turns shorthand findings into structured report text without any API.</li>
          <li>Voice dictation uses the browser’s speech engine (Chrome / Edge) — Hindi and English (India).</li>
        </ul>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- integrations (server secrets)
function IntegrationsTab({ admin }) {
  const net = useNet();
  const [cfg, setCfg] = useState(null);
  const [status, setStatus] = useState({});
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (isServer() && admin) api('integrations').then((r) => { setCfg(r.config); setStatus(r.status); }).catch((e) => toast(e.message, 'error')); }, [admin]);
  if (!isServer()) return <Card icon={Server} title="Integrations need the clinic LAN server"><p className="text-[13px] text-muted">SMTP e-mail, WhatsApp / SMS APIs, the IMAP inbox and cloud OAuth apps hold secrets, so they are configured on the server. In standalone mode every message uses deep links (wa.me, sms:, mailto: / Gmail compose).</p></Card>;
  if (!admin) return <Card icon={PlugZap} title="Integrations"><p className="text-[13px] text-muted">Only the administrator can view or change integration credentials. Channel status: {Object.entries(net.integrations || {}).map(([k, v]) => k + ' ' + (v ? '✓' : '—')).join(' · ')}</p></Card>;
  if (!cfg) return <Card><p className="text-[13px] text-muted">Loading…</p></Card>;
  const set = (path, value) => {
    setDirty(true);
    setCfg((c) => { const n = JSON.parse(JSON.stringify(c)); const keys = path.split('.'); let o = n; keys.slice(0, -1).forEach((k) => { o = o[k] = o[k] || {}; }); o[keys[keys.length - 1]] = value; return n; });
  };
  const F = (path, label, opts = {}) => {
    const val = path.split('.').reduce((o, k) => (o ? o[k] : ''), cfg);
    return <Field label={label} hint={opts.hint} className={opts.className}><Input type={opts.secret ? 'password' : 'text'} value={val === undefined || val === null ? '' : val} placeholder={opts.placeholder} autoComplete="off" onChange={(e) => set(path, opts.num ? Number(e.target.value) || '' : e.target.value)} /></Field>;
  };
  const save = async () => {
    setBusy(true);
    try { const r = await api('integrations', { method: 'PUT', body: cfg }); setCfg(r.config); setStatus(r.status); setDirty(false); refreshIntegrations(); toast('Integrations saved on the server', 'success'); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const ok = (k) => (status[k] ? <Badge tone="emerald">Connected{typeof status[k] === 'string' ? ' · ' + status[k] : ''}</Badge> : <Badge>Not set</Badge>);
  const wa = cfg.whatsapp;
  const sms = cfg.sms;
  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-muted">Secrets are stored only on the clinic server and are shown masked (••••). Leave a masked value as it is to keep it. Test messages: Dispatch Center → Integrations.</p>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="E-mail (SMTP)" icon={Mail} actions={ok('email')}>
          <div className="grid gap-3 sm:grid-cols-2">
            {F('smtp.host', 'SMTP host', { placeholder: 'smtp.gmail.com' })}{F('smtp.port', 'Port', { num: true })}
            {F('smtp.user', 'Username / e-mail')}{F('smtp.pass', 'Password / App Password', { secret: true, hint: 'Gmail: 2-Step Verification → App passwords' })}
            {F('smtp.fromName', 'From name')}{F('smtp.fromEmail', 'From e-mail')}
            <Toggle checked={cfg.smtp.secure !== false} onChange={(v) => set('smtp.secure', v)} label="SSL / TLS (port 465)" />
          </div>
        </Card>
        <Card title="E-mail inbox (IMAP report importer)" icon={Inbox} actions={ok('imap')}>
          <div className="grid gap-3 sm:grid-cols-2">
            {F('imap.host', 'IMAP host', { placeholder: 'imap.gmail.com' })}{F('imap.port', 'Port', { num: true })}
            {F('imap.user', 'Username / e-mail')}{F('imap.pass', 'Password / App Password', { secret: true })}
            {F('imap.mailbox', 'Mailbox / folder')}
          </div>
        </Card>
        <Card title="WhatsApp API" icon={MessageCircle} actions={ok('whatsapp')}>
          <Field label="Provider"><Segmented size="sm" value={wa.provider} onChange={(v) => set('whatsapp.provider', v)} options={[{ value: 'none', label: 'None (deep links)' }, { value: 'meta', label: 'Meta Cloud API' }, { value: 'ultramsg', label: 'UltraMsg' }, { value: 'wati', label: 'Wati' }, { value: 'webhook', label: 'Webhook' }]} /></Field>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {wa.provider === 'meta' && <>{F('whatsapp.meta.phoneNumberId', 'Phone number ID')}{F('whatsapp.meta.token', 'Permanent access token', { secret: true })}{F('whatsapp.meta.apiVersion', 'Graph API version')}
              {F('whatsapp.meta.templateName', 'Approved template name', { hint: 'Needed for patients who have not messaged you in 24 h' })}{F('whatsapp.meta.templateLang', 'Template language code', { placeholder: 'en / hi' })}
              {F('whatsapp.meta.templateParams', 'Template placeholders in order', { hint: 'e.g. Patient_Name,Test_Name,Secure_Download_Link' })}
              <Field label="Template header"><Select value={wa.meta.templateHeader || 'document'} onChange={(e) => set('whatsapp.meta.templateHeader', e.target.value)} options={[{ value: 'document', label: 'Document (attach the PDF)' }, { value: 'none', label: 'No header' }]} /></Field></>}
            {wa.provider === 'ultramsg' && <>{F('whatsapp.ultramsg.instanceId', 'Instance ID')}{F('whatsapp.ultramsg.token', 'Token', { secret: true })}</>}
            {wa.provider === 'wati' && <>{F('whatsapp.wati.endpoint', 'API endpoint', { placeholder: 'https://live-server-xxxx.wati.io' })}{F('whatsapp.wati.token', 'Access token', { secret: true })}</>}
            {wa.provider === 'webhook' && <>{F('whatsapp.webhook.url', 'Webhook URL')}{F('whatsapp.webhook.secret', 'Signing secret (HMAC-SHA256)', { secret: true })}</>}
          </div>
        </Card>
        <Card title="SMS gateway" icon={Smartphone} actions={ok('sms')}>
          <Field label="Provider"><Segmented size="sm" value={sms.provider} onChange={(v) => set('sms.provider', v)} options={[{ value: 'none', label: 'None (sms: links)' }, { value: 'fast2sms', label: 'Fast2SMS' }, { value: 'twilio', label: 'Twilio' }, { value: 'textlocal', label: 'TextLocal' }]} /></Field>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {sms.provider === 'fast2sms' && <>{F('sms.fast2sms.apiKey', 'API key', { secret: true })}
              <Field label="Route"><Select value={sms.fast2sms.route} onChange={(e) => set('sms.fast2sms.route', e.target.value)} options={[{ value: 'q', label: 'Quick (q)' }, { value: 'dlt', label: 'DLT (transactional)' }]} /></Field>
              {sms.fast2sms.route === 'dlt' && <>{F('sms.fast2sms.senderId', 'DLT sender ID')}{F('sms.fast2sms.dltTemplateId', 'DLT template ID')}{F('sms.fast2sms.dltVariables', 'Template variables in order', { className: 'sm:col-span-2', hint: 'Placeholder names for the {#var#} slots, e.g. Patient_Name,Test_Name,Secure_Download_Link' })}</>}</>}
            {sms.provider === 'twilio' && <>{F('sms.twilio.accountSid', 'Account SID')}{F('sms.twilio.authToken', 'Auth token', { secret: true })}{F('sms.twilio.from', 'From number')}</>}
            {sms.provider === 'textlocal' && <>{F('sms.textlocal.apiKey', 'API key', { secret: true })}{F('sms.textlocal.sender', 'Sender')}</>}
          </div>
        </Card>
        <ReceiptsCard cfg={cfg} set={set} F={F} />
        <Card title="Gemini (server key)" icon={Bot} actions={ok('gemini')}>
          <div className="grid gap-3 sm:grid-cols-2">{F('gemini.apiKey', 'API key', { secret: true })}{F('gemini.model', 'Default model')}</div>
        </Card>
        <Card title="Cloud OAuth apps" icon={Cloud} actions={<>{ok('google')}{ok('microsoft')}</>}>
          <div className="grid gap-3 sm:grid-cols-2">
            {F('google.clientId', 'Google OAuth client ID')}{F('google.clientSecret', 'Google client secret', { secret: true })}
            {F('microsoft.clientId', 'Microsoft (Azure) app client ID')}{F('microsoft.clientSecret', 'Microsoft client secret', { secret: true })}
            {F('microsoft.tenant', 'Microsoft tenant', { placeholder: 'common' })}
          </div>
          <p className="mt-2 text-[11.5px] text-muted">Redirect URIs to register: <span className="font-mono">{location.origin}/api/cloud/google/callback</span> and <span className="font-mono">{location.origin}/api/cloud/microsoft/callback</span>. Google accepts only https:// or http://localhost redirect addresses, so connect the accounts from the server PC itself (http://localhost:3000 → Cloud Sync & Backup).</p>
        </Card>
      </div>
      {dirty && (
        <div className="sticky bottom-3 z-20 flex items-center justify-end gap-2 rounded-xl border border-amber-300 bg-amber-50/95 px-3 py-2 shadow-pop dark:border-amber-800 dark:bg-amber-950/80">
          <span className="mr-auto text-[12.5px] font-semibold text-amber-900 dark:text-amber-200">Unsaved integration changes</span>
          <Button size="sm" variant="primary" icon={Save} loading={busy} onClick={save}>Save on server</Button>
        </div>
      )}
    </div>
  );
}

function CopyUrl({ value }) {
  return (
    <div className="flex min-w-0 items-center gap-1 rounded-lg border border-line bg-surface2/60 px-2 py-1.5">
      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]" title={value}>{value}</span>
      <button type="button" className="rounded p-1 text-muted hover:bg-surface hover:text-ink" onClick={() => copyText(value).then(() => toast('Copied', 'success'))} aria-label="Copy address"><Copy className="h-3.5 w-3.5" /></button>
    </div>
  );
}

/** Delivery receipts: WhatsApp Cloud API webhook + a generic status callback for other gateways. */
function ReceiptsCard({ cfg, set, F }) {
  const pub = String((getSettings().billing || {}).publicBaseUrl || '').replace(/\/+$/, '').replace(/#.*$/, '');
  const base = pub || location.origin;
  const waUrl = base + '/api/webhooks/whatsapp';
  const meta = cfg.whatsapp.meta || {};
  const st = cfg.statusWebhook || {};
  const genUrl = base + '/api/webhooks/dispatch-status?token=' + (st.statusToken && !String(st.statusToken).startsWith('••••') ? st.statusToken : '<status token>');
  const random = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');
  return (
    <Card title="Delivery receipts (sent → delivered → read)" icon={CheckCheck}>
      <p className="text-[12px] text-muted">The Dispatch Center log updates live when the patient’s phone receives or reads a report, and every workstation is alerted when a message fails. The server must be reachable from the internet{pub ? '' : ' — set the public base URL under Billing first'}.</p>
      <div className="mt-3 space-y-3">
        <div>
          <div className="mb-1 text-[12px] font-semibold">WhatsApp Cloud API (Meta app → WhatsApp → Configuration → Webhook, subscribe to “messages”)</div>
          <CopyUrl value={waUrl} />
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Field label="Verify token" hint="Paste the same value into Meta’s “Verify token” box">
              <div className="flex gap-1">
                <Input value={meta.verifyToken || ''} autoComplete="off" onChange={(e) => set('whatsapp.meta.verifyToken', e.target.value.trim())} />
                <Button size="sm" icon={KeyRound} onClick={() => set('whatsapp.meta.verifyToken', random())} title="Generate a random token">New</Button>
              </div>
            </Field>
            {F('whatsapp.meta.appSecret', 'App secret (signature check)', { secret: true, hint: 'Meta app → Settings → Basic. Receipts without a valid signature are rejected.' })}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[12px] font-semibold">Other gateways (SMS delivery reports, WhatsApp BSPs): POST {'{channel, id, status, error}'} to</div>
          <CopyUrl value={genUrl} />
          <div className="mt-2 flex items-end gap-1">
            {F('statusWebhook.statusToken', 'Status token', { className: 'flex-1' })}
            <Button size="sm" icon={KeyRound} onClick={() => set('statusWebhook.statusToken', random())}>New</Button>
          </div>
          <p className="mt-1 text-[11px] text-muted">status: sent · delivered · read · failed. id: the provider’s message id returned when the message was sent.</p>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- letterhead templates
/** Downscale an uploaded letterhead image (≤ 2400 px wide, ~A4 at 290 dpi) so settings stay light to sync. */
async function fitLetterheadImage(file) {
  const url = await readAsDataURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Not a readable image')); i.src = url; });
  const scale = Math.min(1, 2400 / img.naturalWidth);
  if (scale === 1 && String(url).length < 700000) return { url, w: img.naturalWidth, h: img.naturalHeight };
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  return { url: c.toDataURL('image/jpeg', 0.88), w: c.width, h: c.height };
}
const mmFor = (w, h) => Math.round((h / w) * 182); // printed height at the 182 mm text width

function LetterheadsCard({ admin }) {
  const settings = useSettings();
  const list = settings.letterheads || [];
  const [edit, setEdit] = useState(null);
  const saveList = (next, action, meta) => { saveSettings({ letterheads: next }); logAudit(action, 'settings/letterheads', meta); };
  const remove = async (t) => {
    if (!(await confirmDialog({ title: 'Delete letterhead "' + t.name + '"?', message: 'Reports using it switch back to the built-in colour header.', danger: true, confirmText: 'Delete' }))) return;
    saveList(list.filter((x) => x.id !== t.id), 'settings:letterhead_deleted', { name: t.name });
    const patch = {};
    if (settings.report.letterheadId === t.id) patch.report = { letterheadId: '', headerMode: settings.report.headerMode === 'template' ? 'full' : settings.report.headerMode };
    if ((settings.lab || {}).letterheadId === t.id) patch.lab = { letterheadId: '' };
    if ((settings.billing || {}).letterheadId === t.id) patch.billing = { letterheadId: '' };
    if (Object.keys(patch).length) saveSettings(patch);
  };
  const assign = (section, id) => { saveSettings({ [section]: { letterheadId: id } }); logAudit('settings:letterhead_assigned', 'settings/' + section, { template: id || 'built-in' }); toast('Letterhead updated on every workstation', 'success'); };
  const opts = [{ value: '', label: 'Built-in colour header' }].concat(list.map((t) => ({ value: t.id, label: t.name })));
  const usedBy = (t) => [settings.report.headerMode === 'template' && settings.report.letterheadId === t.id && 'USG', (settings.lab || {}).letterheadId === t.id && 'Lab', (settings.billing || {}).letterheadId === t.id && 'Invoices'].filter(Boolean);
  return (
    <Card title="Letterhead templates" subtitle="Your own designed or scanned letterhead (image), or an HTML header — one per document type" icon={FileImage}
      actions={admin ? <Button size="sm" icon={Plus} onClick={() => setEdit({ id: '', name: '', kind: 'image', headerImage: '', footerImage: '', headerHeight: 35, footerHeight: 15, headerHtml: '', footerText: '' })}>New template</Button> : null}>
      {!list.length ? <p className="text-[13px] text-muted">No templates yet. Upload the top strip of your printed letterhead (PNG / JPG, full page width) — it prints on plain paper exactly like the pre-printed stationery.</p> : (
        <div className="space-y-2">
          {list.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-2">
              <div className="h-12 w-40 shrink-0 overflow-hidden rounded border border-line bg-white">
                {t.kind === 'image' && t.headerImage ? <img src={t.headerImage} alt="" className="h-full w-full object-contain" /> : <div className="origin-top-left scale-[0.32] p-1 text-black" style={{ width: '312%' }} dangerouslySetInnerHTML={{ __html: t.headerHtml || '' }} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{t.name}</div>
                <div className="text-[11.5px] text-muted">{t.kind === 'image' ? 'Image · header ' + t.headerHeight + ' mm' + (t.footerImage ? ' · footer ' + t.footerHeight + ' mm' : '') : 'HTML header'}{usedBy(t).length ? ' · used for ' + usedBy(t).join(', ') : ''}</div>
              </div>
              {admin && <><Button size="xs" icon={Pencil} onClick={() => setEdit(Object.assign({}, t))}>Edit</Button><Button size="xs" variant="danger-ghost" icon={Trash2} onClick={() => remove(t)}>Delete</Button></>}
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Lab reports use" hint="Built-in = same header as USG reports"><Select value={(settings.lab || {}).letterheadId || ''} disabled={!admin} onChange={(e) => assign('lab', e.target.value)} options={[{ value: '', label: 'Same as USG reports' }].concat(list.map((t) => ({ value: t.id, label: t.name })))} aria-label="Lab report letterhead" /></Field>
        <Field label="A4 invoices & receipts use"><Select value={(settings.billing || {}).letterheadId || ''} disabled={!admin} onChange={(e) => assign('billing', e.target.value)} options={opts.filter((o) => !o.value || (list.find((t) => t.id === o.value) || {}).kind === 'image')} aria-label="Invoice letterhead" /></Field>
      </div>
      <p className="mt-2 text-[11.5px] text-muted">USG reports: choose “Letterhead template” as the header above. Doctors can also switch template per report (Report ribbon → Header mode).</p>
      {edit && <LetterheadEditor initial={edit} onClose={() => setEdit(null)} onSave={(t) => {
        const next = t.id ? list.map((x) => (x.id === t.id ? t : x)) : list.concat([Object.assign({}, t, { id: 'lh_' + Date.now().toString(36) })]);
        saveList(next, t.id ? 'settings:letterhead_updated' : 'settings:letterhead_added', { name: t.name, kind: t.kind });
        setEdit(null);
        toast('Letterhead template saved', 'success');
      }} />}
    </Card>
  );
}

function LetterheadEditor({ initial, onClose, onSave }) {
  const settings = useSettings();
  const [t, setT] = useState(initial);
  const set = (patch) => setT((x) => Object.assign({}, x, patch));
  const upload = async (which) => {
    const [f] = await pickFiles({ accept: 'image/png,image/jpeg,image/webp' });
    if (!f) return;
    try {
      const r = await fitLetterheadImage(f);
      set(which === 'header' ? { headerImage: r.url, headerHeight: Math.min(80, Math.max(12, mmFor(r.w, r.h))) } : { footerImage: r.url, footerHeight: Math.min(40, Math.max(6, mmFor(r.w, r.h))) });
    } catch (e) { toast(e.message, 'error'); }
  };
  const valid = t.name.trim() && (t.kind === 'html' ? String(t.headerHtml || '').trim() : t.headerImage);
  return (
    <Modal open size="lg" onClose={onClose} title={initial.id ? 'Edit letterhead template' : 'New letterhead template'} icon={FileImage}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Save} disabled={!valid} onClick={() => onSave(Object.assign({}, t, { name: t.name.trim() }))}>Save template</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input value={t.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Pathology letterhead" autoFocus /></Field>
        <Field label="Type"><Segmented value={t.kind} onChange={(v) => set({ kind: v, headerHtml: v === 'html' && !t.headerHtml ? letterheadHtml(settings, {}) : t.headerHtml })} options={[{ value: 'image', label: 'Image (scan / design)' }, { value: 'html', label: 'HTML header' }]} /></Field>
      </div>
      {t.kind === 'image' ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <Button icon={Upload} onClick={() => upload('header')}>{t.headerImage ? 'Replace header image' : 'Upload header image'}</Button>
            <Field label="Header height (mm)"><Input type="number" min={10} max={90} className="w-24" value={t.headerHeight} onChange={(e) => set({ headerHeight: Number(e.target.value) || 35 })} /></Field>
            <Button icon={Upload} onClick={() => upload('footer')}>{t.footerImage ? 'Replace footer image' : 'Footer image (optional)'}</Button>
            {t.footerImage && <><Field label="Footer height (mm)"><Input type="number" min={5} max={50} className="w-24" value={t.footerHeight} onChange={(e) => set({ footerHeight: Number(e.target.value) || 15 })} /></Field><Button variant="ghost" icon={Trash2} onClick={() => set({ footerImage: '' })}>Remove footer</Button></>}
          </div>
          <Field label="Footer text (when there is no footer image)"><Input value={t.footerText || ''} onChange={(e) => set({ footerText: e.target.value })} placeholder={settings.report.footerText} /></Field>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <Field label="Header HTML" hint="Started from the built-in letterhead — edit text, colours or add an <img> logo"><Textarea rows={7} className="font-mono text-[11px]" value={t.headerHtml} onChange={(e) => set({ headerHtml: e.target.value })} /></Field>
          <Field label="Footer text"><Input value={t.footerText || ''} onChange={(e) => set({ footerText: e.target.value })} placeholder={settings.report.footerText} /></Field>
        </div>
      )}
      <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Preview (A4 width)</div>
      <div className="mt-1 overflow-hidden rounded-xl border border-line bg-white p-3 text-slate-900">
        <div style={{ fontFamily: 'Arial', fontSize: '11pt' }} dangerouslySetInnerHTML={{ __html: t.kind === 'image' ? (t.headerImage ? imageHeaderHtml(t) : '<div style="padding:18px;text-align:center;color:#94a3b8">Upload the header image</div>') : letterheadHtml(settings, { headerHtml: t.headerHtml }) }} />
        <div className="my-2 h-16 rounded bg-slate-100" />
        {t.kind === 'image' && t.footerImage && <div dangerouslySetInnerHTML={{ __html: imageFooterHtml(t) }} />}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- LAN
/** Test packages (one-tap bundles in registration and billing). Saved straight away. */
function PackagesCard({ admin }) {
  const settings = useSettings();
  const tests = useColl('tests');
  const [name, setName] = useState('');
  const [items, setItems] = useState([]);
  const byCode = useMemo(() => Object.fromEntries(tests.map((t) => [t.code, t])), [tests]);
  const packages = settings.packages || [];
  const save = (next, action, meta) => { saveSettings({ packages: next }); logAudit(action, 'settings/packages', meta); };
  const add = () => {
    if (!name.trim() || items.length < 2) return toast('Name the package and pick at least two tests', 'warning');
    save(packages.concat([{ id: 'pkg_' + Date.now().toString(36), name: name.trim(), codes: items.map((i) => i.code) }]), 'settings:package_added', { name: name.trim(), tests: items.length });
    setName(''); setItems([]);
    toast('Package added', 'success');
  };
  return (
    <Card title="Test packages" subtitle="One tap adds every test at registration and billing" icon={Package}>
      <ul className="space-y-1.5">
        {packages.map((p) => {
          const list = (p.codes || []).map((c) => byCode[c]).filter(Boolean);
          return (
            <li key={p.id} className="flex items-start gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]">
              <span className="min-w-0 flex-1"><b>{p.name}</b><span className="block truncate text-muted" title={list.map((t) => t.name).join(', ')}>{list.map((t) => t.shortName || t.name).join(' + ')} · {inr(list.reduce((sum, t) => sum + Number(t.tariff.standardRate || 0), 0))}</span></span>
              {admin && <Button size="xs" variant="danger-ghost" icon={Trash2} onClick={() => save(packages.filter((x) => x.id !== p.id), 'settings:package_removed', { name: p.name })} aria-label={'Remove ' + p.name} />}
            </li>
          );
        })}
        {!packages.length && <li className="text-[12.5px] text-muted">No packages yet.</li>}
      </ul>
      {admin && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <Field label="New package name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Antenatal second trimester" /></Field>
          <TestPicker items={items} onChange={setItems} compact />
          <Button variant="primary" icon={Plus} onClick={add}>Add package</Button>
        </div>
      )}
    </Card>
  );
}

/** Room names shown with each department on the waiting-hall display and in announcements. */
function RoomsCard({ admin }) {
  const settings = useSettings();
  const visits = useColl('visits');
  const q = settings.queue || {};
  const [rooms, setRooms] = useState(() => Object.assign({}, q.rooms || {}));
  const [mins, setMins] = useState(() => Object.assign({}, q.avgMinutes || {}));
  const [tv, setTv] = useState(() => tvDepartments(settings));
  const measured = useMemo(() => procedureMinutes(visits, settings), [visits, settings]);
  const dirty = JSON.stringify(rooms) !== JSON.stringify(q.rooms || {}) || JSON.stringify(mins) !== JSON.stringify(q.avgMinutes || {}) || tv.join(',') !== tvDepartments(settings).join(',');
  const toggleTv = (m) => setTv((cur) => (cur.includes(m) ? (cur.length > 1 ? cur.filter((x) => x !== m) : cur) : ['USG', 'LAB', 'XRAY', 'ECG', 'ECHO'].filter((x) => x === m || cur.includes(x))));
  const save = () => {
    const clean = Object.fromEntries(Object.entries(mins).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Math.min(120, Math.round(Number(v)))]));
    saveSettings({ queue: { rooms, avgMinutes: clean, tvDepartments: tv } });
    logAudit('settings:queue_rooms_saved', 'settings/queue', { avgMinutes: clean, tvDepartments: tv });
    toast('Waiting hall settings saved', 'success');
  };
  return (
    <Card title="Waiting hall display" subtitle="Which departments the TV shows, room names shown and announced with each token, and the minutes per patient used for estimated waits" icon={Tv}>
      <fieldset className="mb-3 rounded-xl border border-line p-3">
        <legend className="px-1 text-[12px] font-semibold">Shown on the waiting-hall TV</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {['USG', 'LAB', 'XRAY', 'ECG', 'ECHO'].map((m) => (
            <label key={m} className="inline-flex items-center gap-2 text-[13px]">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={tv.includes(m)} disabled={!admin || (tv.length === 1 && tv.includes(m))} onChange={() => toggleTv(m)} aria-label={'Show ' + DEPT_NAME[m] + ' on the TV'} />
              {DEPT_NAME[m]}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-[11.5px] text-muted">Hidden departments’ queues, calls and announcements stay off the TV. The Live Queue page on staff computers still shows every department.</p>
      </fieldset>
      <div className="grid gap-3">
        {['USG', 'LAB', 'XRAY', 'ECG', 'ECHO'].map((m) => (
          <div key={m} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
            <Field label={DEPT_NAME[m]}><Input value={rooms[m] || ''} disabled={!admin} onChange={(e) => setRooms(Object.assign({}, rooms, { [m]: e.target.value }))} placeholder={m === 'LAB' ? 'Sample collection room' : 'Room 1'} aria-label={DEPT_NAME[m] + ' room'} /></Field>
            <Field label="Minutes / patient" hint={measured[m].from === 'measured' ? 'measured ' + measured[m].minutes + ' min (' + measured[m].n + ' scans)' : 'default ' + DEFAULT_PROC_MIN[m] + ' min'}>
              <Input type="number" min={1} max={120} value={mins[m] || ''} disabled={!admin} placeholder={String(measured[m].from === 'measured' ? measured[m].minutes : DEFAULT_PROC_MIN[m])} onChange={(e) => setMins(Object.assign({}, mins, { [m]: e.target.value }))} aria-label={DEPT_NAME[m] + ' minutes per patient'} />
            </Field>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] text-muted">Once 3 or more procedures in a room have been started and completed in the queue, the TV uses the measured average of the last 14 days instead.</p>
      {admin && <Button className="mt-3" variant="primary" icon={Save} disabled={!dirty} onClick={save}>Save waiting hall settings</Button>}
    </Card>
  );
}

function LanTab({ admin }) {
  const net = useNet();
  const settings = useSettings();
  const [name, setName] = useState(getWorkstationName());
  const [info, setInfo] = useState(null);
  useEffect(() => { if (isServer()) api('lan/info').then(setInfo).catch(() => {}); }, []);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="This workstation" icon={Monitor}>
        <Field label="Workstation name" hint="Shown to other devices (live queue, edit locks, “send to workstation”)"><div className="flex gap-2"><Input value={name} onChange={(e) => setName(e.target.value)} /><Button variant="primary" onClick={() => { setWorkstationName(name.trim() || 'Workstation'); toast('Workstation name saved', 'success'); }}>Save</Button></div></Field>
        <div className="mt-3 text-[12.5px] text-muted">Mode: <b className="text-ink">{net.mode === 'server' ? 'Connected to the clinic LAN server' : 'Standalone (this browser only)'}</b>{net.mode === 'server' ? ' · ' + (net.devices || []).length + ' device(s) online' : ''}</div>
        <Button className="mt-3" icon={Network} onClick={() => events.emit('lan:open')}>LAN Connect — QR codes & devices</Button>
      </Card>
      <Card title="Server" icon={Server}>
        {info ? (
          <div className="space-y-1 text-[12.5px]">
            <div>Host <b>{info.hostname}</b> · {info.platform} · port {info.port} · database {info.db}</div>
            <div className="text-muted">Data folder: <span className="font-mono">{info.dataDir}</span></div>
            {info.addresses.filter((a) => !a.virtual).map((a) => <div key={a.address} className="font-mono text-brand-700 dark:text-brand-300">{a.url}</div>)}
            <p className="pt-1 text-[11.5px] text-muted">Other PCs, tablets and phones on the clinic Wi-Fi open one of these addresses. If they cannot connect, allow the port in Windows Defender Firewall (private networks).</p>
          </div>
        ) : <p className="text-[12.5px] text-muted">{isServer() ? 'Loading…' : 'Start the server on the main PC with “npm start” (Node.js 22+); every device on the same network then opens http://<PC-IP>:3000.'}</p>}
        {admin && <div className="mt-3 border-t border-line pt-3"><Toggle checked={settings.ui.devRoleSwitcher !== false} onChange={(v) => { saveSettings({ ui: { devRoleSwitcher: v } }); logAudit('admin:dev_switcher_changed', 'settings/ui', { enabled: v }); }} label="Dev role switcher in the header" hint="One-click identity switch for testing — turn off in production" /></div>}
      </Card>
      <StableAddressCard admin={admin} info={info} onInfo={setInfo} />
      <RoomsCard admin={admin} />
    </div>
  );
}

/** Stable server address: .local name (mDNS), preferred IP for links / QR codes, optional bind, DHCP reservation help. */
function StableAddressCard({ admin, info, onInfo }) {
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (info && info.config) setF(Object.assign({}, info.config)); }, [info]);
  if (!isServer()) return null;
  if (!info || !f) return <Card title="Stable server address" icon={Network}><p className="text-[12.5px] text-muted">Loading…</p></Card>;
  const lanList = info.addresses.filter((a) => !a.virtual);
  const pref = lanList.find((a) => a.address === f.preferredAddress) || lanList[0];
  const dirty = JSON.stringify(f) !== JSON.stringify(info.config);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('lan/config', { method: 'PUT', body: f });
      onInfo(r);
      toast(r.restartNeeded ? 'Saved — restart the server (npm start) to apply the new binding' : 'Network settings saved', r.restartNeeded ? 'warning' : 'success', 8000);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const m = info.mdns || {};
  return (
    <Card title="Stable server address" subtitle="So every workstation keeps finding the server when the router changes its IP" icon={Network} className="xl:col-span-2">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold">Stable name (mDNS)
              {m.active ? <Badge tone="emerald">Active{m.answered ? ' · ' + m.answered + ' lookups' : ''}</Badge> : <Badge tone={f.mdns ? 'amber' : 'slate'}>{f.mdns ? 'Not running' + (m.error ? ': ' + m.error : '') : 'Off'}</Badge>}</div>
            {info.stableUrl && <div className="mt-1 flex items-center gap-2"><span className="font-mono text-[14px] font-bold text-brand-700 dark:text-brand-300">{info.stableUrl}</span><Button size="xs" icon={Copy} onClick={() => copyText(info.stableUrl).then(() => toast('Copied', 'success'))}>Copy</Button></div>}
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
              <Field label="Name on the network"><div className="flex items-center gap-1"><Input value={f.hostname} disabled={!admin} onChange={(e) => setF(Object.assign({}, f, { hostname: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} aria-label="Network name" /><span className="text-[12.5px] text-muted">.local</span></div></Field>
              <div className="flex items-end pb-1"><Toggle checked={!!f.mdns} disabled={!admin} onChange={(v) => setF(Object.assign({}, f, { mdns: v }))} label="Announce" /></div>
            </div>
            <p className="mt-1 text-[11px] text-muted">Windows 10/11, Mac, iPhone/iPad and most Android phones open .local names. Windows PCs can also use <span className="font-mono">{info.hostnameUrl}</span>.</p>
          </div>
        </div>
        <div className="space-y-3">
          <Field label="Preferred address (QR codes, links, binding)">
            <Select value={f.preferredAddress || ''} disabled={!admin} onChange={(e) => setF(Object.assign({}, f, { preferredAddress: e.target.value }))} aria-label="Preferred address"
              options={[{ value: '', label: 'Automatic (best LAN address)' }].concat(lanList.map((a) => ({ value: a.address, label: a.address + ' · ' + a.iface }))).concat(f.preferredAddress && !lanList.some((a) => a.address === f.preferredAddress) ? [{ value: f.preferredAddress, label: f.preferredAddress + ' (not on this PC now)' }] : [])} />
          </Field>
          {info.preferredMissing && <div className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">The preferred address {f.preferredAddress} is not on this PC right now — the router gave it a different IP. Use the stable name, or reserve the address in the router.</div>}
          <Toggle checked={!!f.bindPreferred} disabled={!admin || !f.preferredAddress} onChange={(v) => setF(Object.assign({}, f, { bindPreferred: v }))} label="Listen only on the preferred address"
            hint={'Applies after a server restart. Currently listening on ' + (info.bind ? info.bind.host : '0.0.0.0') + (info.bind && info.bind.note ? ' (' + info.bind.note + ')' : '') + '. If that address is missing at start-up the server listens on all interfaces, so it never becomes unreachable.'} />
          {pref && (
            <div className="rounded-xl bg-surface2/60 p-3 text-[12px]">
              <div className="font-semibold">Reserve the IP in the Wi-Fi router (recommended)</div>
              <div className="mt-1 text-muted">Router admin page → DHCP / LAN → Address reservation → add this PC:</div>
              <div className="mt-1 font-mono">MAC {pref.mac || '—'} → IP {pref.address}</div>
            </div>
          )}
        </div>
      </div>
      {admin && <div className="mt-3 flex justify-end"><Button variant="primary" icon={Save} loading={busy} disabled={!dirty} onClick={save}>Save network settings</Button></div>}
    </Card>
  );
}

// ---------------------------------------------------------------- backup & storage
function BackupTab() {
  const [est, setEst] = useState(null);
  const [persisted, setPersisted] = useState(null);
  useEffect(() => { estimateStorage().then(setEst).catch(() => {}); if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(setPersisted).catch(() => {}); }, []);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Storage on this computer" icon={HardDrive}>
        <div className="space-y-2 text-[13px]">
          <div>Used: <b>{est && est.usage !== undefined ? fmtBytes(est.usage) : '—'}</b>{est && est.quota ? ' of ' + fmtBytes(est.quota) + ' available to the browser' : ''}</div>
          <div className="flex flex-wrap items-center gap-2">Persistent storage: {persisted ? <Badge tone="emerald">Granted — the browser will not clear data</Badge> : <><Badge tone="amber">Not yet</Badge><Button size="sm" onClick={async () => { const ok = await requestPersistence(); setPersisted(ok); toast(ok ? 'Persistent storage granted' : 'The browser declined — keep regular backups', ok ? 'success' : 'warning'); }}>Request</Button></>}</div>
          <p className="text-[11.5px] text-muted">Everything is saved instantly in this browser (IndexedDB){isServer() ? ' and on the clinic server' : ''}. Download a backup regularly, or connect cloud backup.</p>
        </div>
      </Card>
      <Card title="Backups" icon={Cloud}>
        <p className="mb-3 text-[13px] text-muted">Full JSON backups (download / restore) and automatic Google Drive, OneDrive & Google Cloud sync are in Cloud Sync & Backup.</p>
        <Button variant="primary" icon={Cloud} onClick={() => navigate('/cloud')}>Open Cloud Sync & Backup</Button>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- appearance
function AppearanceTab() {
  const [theme, setTheme] = useState(() => lsGet('ssdc-theme', 'light'));
  const choose = (t) => { setTheme(t); lsSet('ssdc-theme', t); applyTheme(t); events.emit('theme:set', t); };
  const collapsed = lsGet('ssdc-pref:nav-collapsed', false);
  return (
    <Card title="Appearance" subtitle="Saved on this workstation" icon={Palette}>
      <div className="grid gap-4 sm:grid-cols-3">
        {[['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'Match Windows / phone', Laptop]].map(([t, label, I]) => (
          <button key={t} onClick={() => choose(t)} className={cx('flex items-center gap-3 rounded-xl border p-4 text-left transition', theme === t ? 'border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/30 dark:bg-brand-950/30' : 'border-line hover:border-brand-300')}>
            <I className="h-5 w-5 text-brand-600" /><span className="font-semibold">{label}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-muted">Printed reports, invoices and Form F always print in their own black-on-white layout, whatever the screen theme. Sidebar: {collapsed ? 'collapsed' : 'expanded'} (toggle with the « button in the header).</p>
      <div className="mt-3 text-[12px] text-muted">Version 1.0 · {getSettings().clinic.name}</div>
    </Card>
  );
}
