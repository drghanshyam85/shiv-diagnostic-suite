// Message template editor: WhatsApp / SMS / e-mail templates for reports, invoices and doctor
// statements in English and Hindi, click-to-insert {{placeholders}}, Hinglish → हिन्दी helper,
// live preview with real sample data, SMS length / DLT notes and restore-defaults.
import { useMemo, useRef, useState } from 'react';
import { MessageSquareText, Plus, Copy, Trash2, RotateCcw, Save, Languages, MessageCircle, Smartphone, Mail, Eye } from 'lucide-react';
import { useColl, useSettings } from '../../core/hooks';
import { store } from '../../core/store';
import { can, logAudit } from '../../core/auth';
import { cx, Card, Button, Badge, Input, Textarea, Select, Field, Segmented, Empty, toast, confirmDialog } from '../../components/ui';
import { uid } from '../../core/utils';
import { fillTemplate, PLACEHOLDERS } from '../../core/share';
import { toHindi } from '../../core/translit';
import seed from '../../../../shared/seed-data';
import { varsFor } from './outputs';

const CH_ICON = { whatsapp: MessageCircle, sms: Smartphone, email: Mail };
const KINDS = [{ value: 'report', label: 'Report ready' }, { value: 'invoice', label: 'Invoice / receipt' }, { value: 'sample', label: 'Sample collected' }, { value: 'statement', label: 'Doctor statement' }, { value: 'custom', label: 'Custom' }];
const SPEC_KEYS = ['Patient_Name', 'Age_Gender', 'Report_Category', 'Test_Name', 'Doctor_Name', 'Invoice_No', 'Total_Amount', 'Payment_Status', 'Secure_Download_Link'];

function sampleVars(kind, settings) {
  const link = { report: 'https://ssdc.example/d/AbC123', invoice: 'https://ssdc.example/#/p/x7k2' };
  if (kind === 'invoice') {
    const inv = store.list('invoices').slice(-1)[0];
    if (inv) return varsFor('invoice', inv, settings, link);
  } else if (kind === 'statement') {
    return { Center_Name: settings.clinic.name, Doctor_Name: 'Dr. Kavita Jain', Period: 'October 2026', Total_Patients: 42, Total_Bill: '58,400', Total_Discount: '1,200', Share_Payable: '9,845', Audit_Status: 'Verified' };
  } else {
    const r = store.list('reports').find((x) => x.status === 'SIGNED_FINAL') || store.list('reports')[0];
    if (r) return varsFor('usg', r, settings, link);
  }
  return {};
}

/** WhatsApp-style formatting: *bold*, _italic_, ~strike~ */
function waFormat(text) {
  const esc = String(text || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return esc.replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>').replace(/~([^~\n]+)~/g, '<s>$1</s>').replace(/(https?:\/\/[^\s<]+)/g, '<span style="color:#0369a1;text-decoration:underline">$1</span>');
}

export function TemplatesTab() {
  const settings = useSettings();
  const templates = useColl('msgTemplates');
  const canEdit = can('print:dispatch_signed_reports', 'DRAFT') && (can('settings:manage_clinic_and_integrations') || can('templates:manage_macros'));
  const [chan, setChan] = useState('');
  const [selId, setSelId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [hinglish, setHinglish] = useState('');
  const taRef = useRef(null);

  const list = useMemo(() => templates.filter((t) => !chan || t.channel === chan).sort((a, b) => (a.kind + a.channel + a.lang).localeCompare(b.kind + b.channel + b.lang)), [templates, chan]);
  const cur = draft || (selId ? templates.find((t) => t.id === selId) : list[0]) || null;
  const editing = !!draft;
  const vars = useMemo(() => (cur ? sampleVars(cur.kind, settings) : {}), [cur && cur.kind, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = (t) => setDraft(Object.assign({}, t));
  const update = (patch) => setDraft(Object.assign({}, draft || cur, patch));
  const insert = (text) => {
    const base = draft || Object.assign({}, cur);
    const ta = taRef.current;
    const body = base.body || '';
    const a = ta ? ta.selectionStart : body.length;
    const b = ta ? ta.selectionEnd : body.length;
    const next = body.slice(0, a) + text + body.slice(b);
    setDraft(Object.assign({}, base, { body: next }));
    setTimeout(() => { if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = a + text.length; } }, 0);
  };
  const save = () => {
    if (!draft) return;
    if (!String(draft.name || '').trim() || !String(draft.body || '').trim()) return toast('Name and message are required', 'warning');
    const doc = store.put('msgTemplates', Object.assign({}, draft, { name: draft.name.trim() }));
    logAudit('templates:message_saved', 'msgTemplates/' + doc.id, { channel: doc.channel, kind: doc.kind, lang: doc.lang });
    setSelId(doc.id);
    setDraft(null);
    toast('Template saved — used for the next message', 'success');
  };
  const add = () => { const t = { id: uid('tpl_'), name: 'New template', channel: chan || 'whatsapp', kind: 'report', lang: 'en', subject: '', body: 'Dear {{Patient_Name}}, ' }; setDraft(t); setSelId(t.id); };
  const dup = () => { if (!cur) return; const t = Object.assign({}, cur, { id: uid('tpl_'), name: cur.name + ' (copy)' }); setDraft(t); setSelId(t.id); };
  const del = async () => {
    if (!cur || !store.get('msgTemplates', cur.id)) { setDraft(null); return; }
    if (!(await confirmDialog({ title: 'Delete template?', message: cur.name, danger: true, confirmText: 'Delete' }))) return;
    store.remove('msgTemplates', cur.id);
    setDraft(null);
    setSelId(null);
  };
  const restore = async () => {
    if (!(await confirmDialog({ title: 'Restore default templates?', message: 'The built-in English and Hindi templates are restored (your own extra templates are kept).', confirmText: 'Restore' }))) return;
    seed.MSG_TEMPLATES.forEach((t) => store.put('msgTemplates', Object.assign({}, t)));
    logAudit('templates:message_restored', 'msgTemplates', {});
    setDraft(null);
    toast('Default templates restored', 'success');
  };
  const hindi = async () => {
    if (!hinglish.trim()) return;
    try { const h = await toHindi(hinglish); insert(h); setHinglish(''); } catch (e) { toast(e.message, 'error'); }
  };

  const filled = cur ? fillTemplate(cur.body, vars) : '';
  const smsLen = filled.length;
  const unicode = /[^\x00-\x7F]/.test(filled);
  return (
    <div className="grid gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
      <Card padded={false} title="Templates" subtitle={templates.length + ' saved'} icon={MessageSquareText}
        actions={canEdit ? <><Button size="xs" icon={Plus} onClick={add}>New</Button><Button size="xs" icon={RotateCcw} onClick={restore}>Defaults</Button></> : null}>
        <div className="border-b border-line p-2"><Segmented size="sm" value={chan} onChange={setChan} options={[{ value: '', label: 'All' }, { value: 'whatsapp', label: 'WhatsApp' }, { value: 'sms', label: 'SMS' }, { value: 'email', label: 'E-mail' }]} /></div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {!list.length && <Empty icon={MessageSquareText} title="No templates" />}
          {list.map((t) => {
            const I = CH_ICON[t.channel] || MessageSquareText;
            return (
              <button key={t.id} onClick={() => { setDraft(null); setSelId(t.id); }} className={cx('mb-1 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left', cur && cur.id === t.id ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/30' : 'border-transparent hover:bg-surface2')}>
                <I className="h-4 w-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold">{t.name}</span><span className="text-[11px] text-muted">{(KINDS.find((k) => k.value === t.kind) || {}).label || t.kind}</span></span>
                <Badge tone={t.lang === 'hi' ? 'amber' : 'slate'}>{t.lang === 'hi' ? 'हिन्दी' : 'EN'}</Badge>
              </button>
            );
          })}
        </div>
      </Card>
      {!cur ? <Card><Empty icon={MessageSquareText} title="Select a template" /></Card> : (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card title={editing ? 'Editing: ' + (cur.name || '') : cur.name} icon={CH_ICON[cur.channel] || MessageSquareText}
            actions={canEdit ? (editing ? <><Button size="sm" onClick={() => setDraft(null)}>Cancel</Button><Button size="sm" variant="primary" icon={Save} onClick={save}>Save</Button></> : <><Button size="sm" icon={Copy} onClick={dup}>Duplicate</Button><Button size="sm" variant="danger-ghost" icon={Trash2} onClick={del}>Delete</Button><Button size="sm" variant="primary" onClick={() => begin(cur)}>Edit</Button></>) : <Badge>Read-only</Badge>}>
            <fieldset disabled={!editing} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Name" className="sm:col-span-3"><Input value={cur.name || ''} onChange={(e) => update({ name: e.target.value })} /></Field>
                <Field label="Channel"><Select value={cur.channel} onChange={(e) => update({ channel: e.target.value })} options={[{ value: 'whatsapp', label: 'WhatsApp' }, { value: 'sms', label: 'SMS' }, { value: 'email', label: 'E-mail' }]} /></Field>
                <Field label="Used for"><Select value={cur.kind} onChange={(e) => update({ kind: e.target.value })} options={KINDS} /></Field>
                <Field label="Language"><Select value={cur.lang} onChange={(e) => update({ lang: e.target.value })} options={[{ value: 'en', label: 'English' }, { value: 'hi', label: 'Hindi / Bilingual' }]} /></Field>
                {cur.channel === 'sms' && <Field label="DLT template ID" className="sm:col-span-3"><Input value={cur.dltTemplateId || ''} onChange={(e) => update({ dltTemplateId: e.target.value })} placeholder="1207…" /></Field>}
              </div>
              {cur.channel === 'email' && <Field label="Subject"><Input value={cur.subject || ''} onChange={(e) => update({ subject: e.target.value })} /></Field>}
              <Field label="Message" hint="WhatsApp formatting: *bold*  _italic_  ~strike~ · placeholders are replaced when sending">
                <Textarea ref={taRef} rows={cur.channel === 'sms' ? 5 : 14} className="font-deva text-[13px]" value={cur.body || ''} onChange={(e) => update({ body: e.target.value })} aria-label="Template message" />
              </Field>
            </fieldset>
            <div className="mt-3">
              <div className="label">Insert placeholder {editing ? '' : '(click Edit first)'}</div>
              <div className="flex flex-wrap gap-1">
                {PLACEHOLDERS.map((p) => <button key={p} disabled={!editing} onClick={() => insert('{{' + p + '}}')} className={cx('chip font-mono text-[11px] disabled:opacity-50', SPEC_KEYS.includes(p) && 'border-brand-300')}>{'{{' + p + '}}'}</button>)}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-surface2/60 p-2.5">
              <Field label="Hinglish → हिन्दी" className="min-w-[220px] flex-1"><Input value={hinglish} disabled={!editing} onChange={(e) => setHinglish(e.target.value)} placeholder="namaskar, aapki report taiyar hai" onKeyDown={(e) => { if (e.key === 'Enter') hindi(); }} /></Field>
              <Button size="sm" icon={Languages} disabled={!editing || !hinglish.trim()} onClick={hindi}>Convert & insert</Button>
            </div>
          </Card>
          <Card title="Live preview" subtitle="With sample data from your records" icon={Eye}>
            {cur.channel === 'email' ? (
              <div className="rounded-xl border border-line bg-white p-3 text-[13px] text-slate-900">
                <div className="mb-2 border-b border-slate-200 pb-2 text-[12px]"><b>Subject:</b> {fillTemplate(cur.subject || '', vars)}</div>
                <div className="whitespace-pre-wrap font-deva" dangerouslySetInnerHTML={{ __html: waFormat(filled) }} />
              </div>
            ) : (
              <div className="rounded-xl p-3" style={{ background: cur.channel === 'whatsapp' ? '#e5ddd5' : '#f1f5f9' }}>
                <div className="ml-auto max-w-[95%] rounded-lg rounded-tr-none px-3 py-2 text-[13px] text-slate-900 shadow-sm" style={{ background: cur.channel === 'whatsapp' ? '#dcf8c6' : '#ffffff' }}>
                  <div className="whitespace-pre-wrap break-words font-deva" dangerouslySetInnerHTML={{ __html: waFormat(filled) }} />
                </div>
              </div>
            )}
            {cur.channel === 'sms' && <p className="mt-2 text-[11.5px] text-muted">{smsLen} characters · {Math.max(1, Math.ceil(smsLen / (unicode ? 70 : 160)))} SMS part(s){unicode ? ' (Unicode — Hindi uses 70 characters per part)' : ''}. The DLT-registered text must match this message exactly, with {'{#var#}'} where placeholders appear.</p>}
            <p className="mt-2 text-[11px] text-muted">Required placeholders from the clinic spec: {SPEC_KEYS.map((k) => '{{' + k + '}}').join(' ')}</p>
          </Card>
        </div>
      )}
    </div>
  );
}
