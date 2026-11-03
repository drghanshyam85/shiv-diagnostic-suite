// Form F visibility manager & defaults: auto-fill switches, show / hide / auto-hide fields on screen and
// print, typography, clinic wording, and "Edit Anything" wording defaults (this workstation or clinic-wide).
import { Settings2, Eye, Wand2, Type, Building2, PenLine, RotateCcw, Globe2, Save } from 'lucide-react';
import { can } from '../../core/auth';
import { saveSettings } from '../../core/hooks';
import { Drawer, Toggle, Checkbox, Segmented, Field, Input, Button, Badge, toast, confirmDialog } from '../../components/ui';
import { isLayoutKey } from './formfHtml';

const VIS = [
  ['collapseSectionC', 'Collapse Section C in data entry', 'Still printed as “Not Applicable” on page 2'],
  ['showThumbBlock', 'Thumb-impression identification block', 'Auto-fills “Not Applicable” when the patient signs'],
  ['showEddNextToLmp', 'EDD next to LMP in Item 8', ''],
  ['showSelfReferralNote', 'Self-referral explanatory note in 7(b)', 'The long statutory clarification text'],
  ['showHindi', 'Hindi declaration line (Section D)', 'मैं श्रीमती … घोषणा करती हूँ'],
  ['showPage2Ref', 'Reference line on page 2', 'Reg. SNo · patient · date — matches loose back pages'],
  ['showFrame', 'Page border frame', ''],
  ['blankLines', 'Dotted lines for empty values', 'For hand-filling missing details'],
  ['printSignature', 'Print radiologist’s digital signature', 'Off = wet signature & seal (recommended)']
];

export function FormFCustomize({ open, onClose, prefs, setPrefs, resetPrefs, settings, rec, localEdits, setLocalEdits }) {
  const vis = prefs.visibility || {};
  const isAdmin = can('settings:manage_clinic_and_integrations');
  const setVis = (k, v) => setPrefs({ visibility: { [k]: v } });
  const recLayoutEdits = Object.fromEntries(Object.entries(rec.customEdits || {}).filter(([k]) => isLayoutKey(k)));
  const nLocal = Object.keys(localEdits || {}).length;
  const nClinic = Object.keys((settings.formF && settings.formF.customEdits) || {}).length;

  const saveMine = () => {
    if (!Object.keys(recLayoutEdits).length) return toast('This form has no wording edits — use “Enable Direct Form Editing” first', 'info');
    setLocalEdits(Object.assign({}, localEdits, recLayoutEdits));
    toast(Object.keys(recLayoutEdits).length + ' wording edit(s) saved as this workstation’s default', 'success');
  };
  const publish = async () => {
    if (!(await confirmDialog({ title: 'Publish Form F defaults to all workstations?', message: 'Auto-fill switches, visibility, font size, clinic wording and your saved wording edits become the clinic default.', confirmText: 'Publish' }))) return;
    const ff = settings.formF || {};
    saveSettings({ formF: { autoFill: prefs.autoFill, autoFillSections: prefs.autoFillSections, autoIndications: prefs.autoIndications, visibility: prefs.visibility, fontPt: prefs.fontPt, clinicText: prefs.clinicText, regNoText: prefs.regNoText, doctorText: prefs.doctorText, doctorCaps: prefs.doctorCaps, doctorNameCaps: prefs.doctorNameCaps, customEdits: Object.assign({}, ff.customEdits, localEdits) } });
    toast('Form F defaults published to every workstation', 'success');
  };
  const reset = async () => {
    if (!(await confirmDialog({ title: 'Reset this workstation’s Form F preferences?', message: 'Visibility, auto-fill and wording defaults return to the clinic default.', confirmText: 'Reset' }))) return;
    resetPrefs();
    setLocalEdits({});
    toast('Form F preferences reset to clinic default', 'info');
  };

  return (
    <Drawer open={open} onClose={onClose} title="Customise Form F" subtitle="Visibility manager · auto-fill · wording" icon={Settings2} width="sm:w-[480px]"
      footer={<div className="flex flex-wrap gap-2"><Button size="sm" icon={RotateCcw} onClick={reset}>Reset to clinic default</Button>{isAdmin && <Button size="sm" variant="primary" icon={Globe2} className="ml-auto" onClick={publish}>Publish as clinic default</Button>}</div>}>
      <div className="space-y-5 p-4">
        <section>
          <h3 className="section-title mb-2 flex items-center gap-2"><Wand2 className="h-4 w-4 text-brand-600" />Auto-fill engine</h3>
          <Toggle checked={prefs.autoFill !== false} onChange={(v) => setPrefs({ autoFill: v })} label="Auto-Fill Form F from Registration" hint="Binds patient, visit & obstetric data the moment a patient is registered or selected" />
          <div className="mt-2 flex flex-wrap gap-3 pl-11">
            {['A', 'B', 'C', 'D'].map((s) => <Checkbox key={s} disabled={prefs.autoFill === false} checked={(prefs.autoFillSections || {})[s] !== false} onChange={(v) => setPrefs({ autoFillSections: { [s]: v } })} label={'Section ' + s} />)}
          </div>
          <Toggle className="mt-3" checked={prefs.autoIndications !== false} onChange={(v) => setPrefs({ autoIndications: v })} label="Auto-tick Item 10 indications by gestational age" hint="1st trimester → 1, 2 · 2nd/3rd trimester → 10, 11, 12, 17 (manual changes are kept)" />
        </section>

        <section>
          <h3 className="section-title mb-2 flex items-center gap-2"><Eye className="h-4 w-4 text-brand-600" />Field & section visibility</h3>
          <div className="space-y-2.5">
            {VIS.map(([k, label, hint]) => <Toggle key={k} size="sm" checked={vis[k] !== false && (k !== 'printSignature' || !!vis[k])} onChange={(v) => setVis(k, v)} label={label} hint={hint} />)}
          </div>
          <div className="mt-3">
            <span className="label">Item 5 label</span>
            <Segmented size="sm" value={vis.guardianLabel || 'both'} onChange={(v) => setVis('guardianLabel', v)} options={[{ value: 'both', label: "Husband's / Father's" }, { value: 'auto', label: 'Auto (by relation)' }, { value: 'husband', label: 'Husband' }, { value: 'father', label: 'Father' }]} />
          </div>
        </section>

        <section>
          <h3 className="section-title mb-2 flex items-center gap-2"><Type className="h-4 w-4 text-brand-600" />Typography</h3>
          <div className="flex items-center gap-3">
            <input type="range" min="9" max="11.5" step="0.25" value={prefs.fontPt || 10.5} onChange={(e) => setPrefs({ fontPt: Number(e.target.value) })} className="flex-1 accent-brand-600" aria-label="Base font size" />
            <Badge tone="brand">{Number(prefs.fontPt || 10.5).toFixed(2)} pt Times</Badge>
          </div>
          <p className="mt-1 text-[11px] text-muted">Pages that overflow are auto-shrunk so each side always fits one A4 sheet.</p>
        </section>

        <section>
          <h3 className="section-title mb-2 flex items-center gap-2"><Building2 className="h-4 w-4 text-brand-600" />Clinic & doctor wording</h3>
          <div className="space-y-2">
            <Field label="Item 1 · clinic name & address"><Input value={prefs.clinicText || ''} onChange={(e) => setPrefs({ clinicText: e.target.value })} /></Field>
            <Field label="Item 2 · PC-PNDT registration no."><Input value={prefs.regNoText || ''} onChange={(e) => setPrefs({ regNoText: e.target.value })} /></Field>
            <Field label="Item 9 · doctor performing procedure"><Input value={prefs.doctorText || ''} onChange={(e) => setPrefs({ doctorText: e.target.value })} /></Field>
            <Field label="Signature block (capitals)"><Input value={prefs.doctorCaps || ''} onChange={(e) => setPrefs({ doctorCaps: e.target.value })} /></Field>
            <Field label="Doctor’s declaration name"><Input value={prefs.doctorNameCaps || ''} onChange={(e) => setPrefs({ doctorNameCaps: e.target.value })} /></Field>
          </div>
        </section>

        <section>
          <h3 className="section-title mb-2 flex items-center gap-2"><PenLine className="h-4 w-4 text-brand-600" />“Edit Anything” wording defaults</h3>
          <p className="text-[12.5px] text-muted">Wording you change directly on the A4 preview applies to that record. Save it as a default to reuse it on every new Form F.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="slate">This form: {Object.keys(recLayoutEdits).length}</Badge>
            <Badge tone="brand">Workstation default: {nLocal}</Badge>
            <Badge tone="violet">Clinic default: {nClinic}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" icon={Save} onClick={saveMine}>Save this form’s wording as my default</Button>
            {nLocal > 0 && <Button size="sm" variant="ghost" onClick={() => { setLocalEdits({}); toast('Workstation wording defaults cleared', 'info'); }}>Clear my defaults</Button>}
          </div>
        </section>
      </div>
    </Drawer>
  );
}
