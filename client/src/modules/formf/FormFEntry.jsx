// Keyboard-friendly Form F data entry (left panel). Every input feeds the A4 template live.
import { useState } from 'react';
import { Baby, CalendarDays, Wand2, UserRound, Stethoscope, Fingerprint, ShieldOff, ShieldAlert, FileText, ClipboardCheck } from 'lucide-react';
import { useColl } from '../../core/hooks';
import { dateKey, fmtDate, digits } from '../../core/utils';
import { FORM_F_INDICATIONS, trimester, suggestIndications } from '../../core/obstetric';
import { ID_TYPES, RESULT_PRESETS, gaText, withDefaultIndications } from '../../core/formf';
import { toHindi } from '../../core/translit';
import { cx, Card, Field, Input, Textarea, Select, Segmented, Checkbox, Toggle, Badge, Button, Combobox, MicButton, toast } from '../../components/ui';

const SHORT_IND = ['Viability / IUP vs ectopic', 'Gestational age (dating)', 'No. of fetuses & chorionicity', 'Pregnancy with IUCD / contraceptive failure', 'Vaginal bleeding / leaking', 'Follow-up of abortion', 'Cervical canal / internal os', 'Size–dates discrepancy', 'Adnexal / uterine pathology', 'Chromosomal / structural defects', 'Foetal presentation & position', 'Liquor amnii', 'Preterm labour / PPROM', 'Placenta: position, grade, abnormality', 'Umbilical cord evaluation', 'Previous caesarean scar', 'Foetal growth, weight & well-being', 'Colour / duplex Doppler', 'USG-guided procedures (MTP, ECV)', 'Adjunct to invasive procedures', 'Intra-partum events', 'Medical / surgical complications', 'Research / scientific studies'];

/** Mandatory fields still empty get a red outline (class ff-miss) and the Field's "Required" note. */
const missFor = (missing) => (key, base = '') => cx(base, missing && missing.has(key) && 'ff-miss');

export function SectionA({ rec, upd, updTop, readOnly, nextSno, missing }) {
  const d = rec.data;
  const miss = missFor(missing);
  const doctors = useColl('doctors');
  const [busy, setBusy] = useState(false);
  const translit = async () => {
    if (!d.patientName) return toast('Enter the patient name first', 'warning');
    setBusy(true);
    try { upd({ patientNameHindi: await toHindi(d.patientName) }); } finally { setBusy(false); }
  };
  const pickDoctor = (id, doc) => upd(doc ? { refDoctorId: id, refDoctorName: [doc.name, doc.qualification].filter(Boolean).join(', '), refDoctorAddress: [doc.clinic, doc.address].filter(Boolean).join(', ') } : { refDoctorId: '' });
  return (
    <Card title="Section A · Patient & referral" icon={UserRound} actions={<Badge tone="slate">Items 1–7</Badge>}>
      <fieldset disabled={readOnly} className="grid gap-3 sm:grid-cols-12">
        <Field label="Reg. S.No (register)" className="sm:col-span-3" hint={rec.snoLabel ? 'manual override allowed' : 'auto on save'}>
          <Input value={rec.snoLabel || ''} onChange={(e) => updTop({ snoLabel: e.target.value, sno: Number(String(e.target.value).split('/').pop()) || null })} placeholder={nextSno || 'auto'} aria-label="Register serial number" />
        </Field>
        <Field label="Registration No. (printed)" className="sm:col-span-3" hint={rec.regnNo ? 'patient ID ' + rec.regnNo + ' is not printed' : 'the clinic’s Form F serial number'}>
          <Input value={rec.snoLabel || (nextSno ? String(nextSno).replace(/\s*\(auto\)$/, '') + ' (on save)' : 'on save')} readOnly tabIndex={-1} className="bg-surface2 px-2 font-mono text-[13px]" aria-label="Registration number printed on Form F" />
        </Field>
        <Field label="Procedure date" className={miss('procedureDate', 'sm:col-span-3')}><Input type="date" max={dateKey()} value={d.procedureDate} onChange={(e) => upd({ procedureDate: e.target.value, conveyedDate: d.conveyedDate === d.procedureDate ? e.target.value : d.conveyedDate })} className="px-2" /></Field>
        <Field label="Declaration date" className={miss('declarationDate', 'sm:col-span-3')}><Input type="date" max={dateKey()} value={d.declarationDate} onChange={(e) => upd({ declarationDate: e.target.value })} className="px-2" /></Field>

        <Field label="Patient name (Item 3)" required className={miss('patientName', 'sm:col-span-7')} extra={<span className="normal-case"><MicButton target="#ff-name" size="sm" /></span>}>
          <div className="flex gap-1.5">
            <Select className="w-[98px] shrink-0" value={d.patientTitle} onChange={(e) => upd({ patientTitle: e.target.value })} options={['Mrs', 'Smt', 'Ms']} aria-label="Title" />
            <Input id="ff-name" value={d.patientName} onChange={(e) => upd({ patientName: e.target.value })} placeholder="e.g. Meena Kumari" aria-label="Patient name" />
          </div>
        </Field>
        <Field label="Age (years)" required className={miss('age', 'sm:col-span-2')}><Input type="number" min="10" max="60" value={d.age} onChange={(e) => upd({ age: e.target.value === '' ? '' : Number(e.target.value) })} aria-label="Age in years" /></Field>
        <Field label="Name in Hindi (D)" className="sm:col-span-3" extra={<button type="button" className="link normal-case" onClick={translit} disabled={busy} title="Transliterate the English name">{busy ? '…' : 'auto'}</button>}>
          <Input className="font-deva" value={d.patientNameHindi} onChange={(e) => upd({ patientNameHindi: e.target.value })} placeholder="हिन्दी नाम" aria-label="Patient name in Hindi" />
        </Field>

        <Field label="Item 5 · relation & name" required className={miss('husbandName', 'sm:col-span-7')}>
          <div className="flex gap-1.5">
            <Segmented size="sm" value={d.guardianRelation} onChange={(v) => upd({ guardianRelation: v })} options={['Husband', 'Father']} />
            <Input value={d.husbandName} onChange={(e) => upd({ husbandName: e.target.value })} placeholder={d.guardianRelation + "'s name"} aria-label="Husband or father name" />
          </div>
        </Field>
        <Field label="Mobile (Item 6)" className="sm:col-span-5"><Input inputMode="numeric" maxLength={10} value={d.mobile} onChange={(e) => upd({ mobile: digits(e.target.value).slice(0, 10) })} placeholder="98XXXXXXXX" /></Field>

        <Field label="Living sons · ages (4a)" className="sm:col-span-5">
          <div className="flex gap-1.5"><Input type="number" min="0" className="w-16" value={d.livingSons} onChange={(e) => upd({ livingSons: e.target.value })} aria-label="Living sons" /><Input value={d.sonsAges} onChange={(e) => upd({ sonsAges: e.target.value })} placeholder="e.g. 6 yrs, 3 yrs" aria-label="Ages of sons" /></div>
        </Field>
        <Field label="Living daughters · ages (4b)" className="sm:col-span-5">
          <div className="flex gap-1.5"><Input type="number" min="0" className="w-16" value={d.livingDaughters} onChange={(e) => upd({ livingDaughters: e.target.value })} aria-label="Living daughters" /><Input value={d.daughtersAges} onChange={(e) => upd({ daughtersAges: e.target.value })} placeholder="e.g. 4 yrs" aria-label="Ages of daughters" /></div>
        </Field>
        <Field label="Total (4)" className="sm:col-span-2" extra={<Checkbox checked={d.totalOverride} onChange={(v) => upd({ totalOverride: v })} label={<span className="text-[10px] normal-case">edit</span>} />}>
          <Input type="number" min="0" value={d.totalChildren} disabled={!d.totalOverride} onChange={(e) => upd({ totalChildren: Number(e.target.value) || 0 })} aria-label="Total living children" />
        </Field>

        <Field label="Full postal address (Item 6)" required className={miss('address', 'sm:col-span-12')}>
          <Input value={d.address} onChange={(e) => upd({ address: e.target.value })} placeholder="House / Ward, Village / Town, District" aria-label="Postal address" />
        </Field>
        <div className="sm:col-span-12 -mt-1"><Checkbox checked={d.sameAsPostal} onChange={(v) => upd({ sameAsPostal: v })} label="ID proof address same as postal address" /></div>
        {!d.sameAsPostal && <Field label="Full ID proof address of self" className="sm:col-span-12"><Input value={d.idAddress} onChange={(e) => upd({ idAddress: e.target.value })} /></Field>}
        <Field label="ID proof type" className="sm:col-span-5"><Select value={d.idType} onChange={(e) => upd({ idType: e.target.value })} options={ID_TYPES} /></Field>
        <Field label="ID number" className="sm:col-span-7"><Input value={d.idNumber} onChange={(e) => upd({ idNumber: d.idType === 'Aadhar Card' ? digits(e.target.value).slice(0, 12).replace(/(\d{4})(?=\d)/g, '$1 ') : e.target.value })} placeholder={d.idType === 'Aadhar Card' ? 'XXXX XXXX XXXX' : ''} inputMode={d.idType === 'Aadhar Card' ? 'numeric' : undefined} /></Field>

        <Field label="7(a) Referred by – saved doctors" className="sm:col-span-12">
          <Combobox value={d.refDoctorId} onChange={pickDoctor} items={doctors.filter((x) => x.active !== false && x.id !== 'doc_rly')} getSub={(x) => [x.qualification, x.clinic].filter(Boolean).join(' · ')} placeholder="Search referring doctor…" icon={Stethoscope} />
        </Field>
        <Field label="Doctor name & qualification" className="sm:col-span-5"><Input value={d.refDoctorName} onChange={(e) => upd({ refDoctorName: e.target.value, refDoctorId: '' })} /></Field>
        <Field label="Clinic / hospital address" className="sm:col-span-7"><Input value={d.refDoctorAddress} onChange={(e) => upd({ refDoctorAddress: e.target.value })} /></Field>
        <Field label="7(b) Self-referral by Gynaecologist / Radiologist / RMP" className="sm:col-span-12">
          <Segmented size="sm" value={d.selfReferral} onChange={(v) => upd({ selfReferral: v })} options={['NO', 'YES']} />
        </Field>
      </fieldset>
    </Card>
  );
}

export function SectionB({ rec, upd, readOnly, prefs, report, onUseReport, missing }) {
  const miss = missFor(missing);
  const d = rec.data;
  const weeks = d.gaWeeks === '' || d.gaWeeks === undefined ? null : Number(d.gaWeeks);
  const ind = d.indications || [];
  const toggleInd = (n) => upd({ indicationsManual: true, indications: ind.includes(n) ? ind.filter((x) => x !== n) : ind.concat([n]).sort((a, b) => a - b) });
  const auto = withDefaultIndications(suggestIndications(weeks));
  const presetVal = RESULT_PRESETS.find((p) => p.replace('{GA}', gaText(d)) === d.result) || '';
  return (
    <Card title="Section B · Non-invasive procedure" icon={Baby} actions={<Badge tone="slate">Items 8–16</Badge>}>
      <fieldset disabled={readOnly} className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented size="sm" value={d.lmpMode} onChange={(v) => upd({ lmpMode: v, eddFirst: false })} options={[{ value: 'lmp', label: 'LMP known' }, { value: 'usg', label: 'LMP not known · by USG GA / EDD' }]} />
          {weeks !== null && <Badge tone="violet" icon={Baby}>GA {gaText(d)} · {['', '1st', '2nd', '3rd'][trimester(weeks)]} trimester</Badge>}
          {d.edd && <Badge tone="brand" icon={CalendarDays}>EDD {fmtDate(d.edd)}</Badge>}
        </div>
        {d.lmpMode === 'lmp' ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="LMP (Item 8)" required className={miss('lmp')}><Input type="date" max={d.procedureDate || dateKey()} value={d.lmp} onChange={(e) => upd({ lmp: e.target.value })} aria-label="Last menstrual period" /></Field>
            <Field label={'GA as of ' + fmtDate(d.procedureDate)}><Input readOnly value={gaText(d)} placeholder="auto" aria-label="Gestational age" /></Field>
            <Field label="EDD (LMP + 280 d)" extra={<Checkbox checked={d.eddOverride} onChange={(v) => upd({ eddOverride: v })} label={<span className="text-[10px] normal-case">override</span>} />}>
              <Input type="date" value={d.edd} disabled={!d.eddOverride} onChange={(e) => upd({ edd: e.target.value })} aria-label="Expected date of delivery" />
            </Field>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="GA by USG (weeks + days)" required className={miss('gaWeeks')}>
              <div className="flex gap-1.5">
                <Input type="number" min="0" max="44" value={d.gaWeeks} onChange={(e) => upd({ gaWeeks: e.target.value === '' ? '' : Number(e.target.value), eddFirst: false })} aria-label="USG GA weeks" />
                <Input type="number" min="0" max="6" value={d.gaDays} onChange={(e) => upd({ gaDays: e.target.value === '' ? '' : Number(e.target.value), eddFirst: false })} aria-label="USG GA days" />
              </div>
            </Field>
            <Field label="…or EDD by USG"><Input type="date" value={d.edd} onChange={(e) => upd({ edd: e.target.value, eddFirst: true })} aria-label="EDD by USG" /></Field>
            <Field label="Back-calculated clinical LMP"><Input readOnly value={d.lmp ? fmtDate(d.lmp) : ''} placeholder="auto" /></Field>
          </div>
        )}

        <div className={miss('indications')}>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="label mb-0">Item 10 · indications ({ind.length} ticked)</span>
            <span className="flex items-center gap-2">
              <Badge tone={d.indicationsManual ? 'amber' : 'emerald'}>{d.indicationsManual ? 'Manual selection' : prefs.autoIndications ? 'Auto by GA' : 'Manual'}</Badge>
              <Button size="sm" icon={Wand2} disabled={weeks === null} onClick={() => upd({ indicationsManual: false, indications: auto })} title={'Tick ' + auto.join(', ')}>Auto-select by GA</Button>
            </span>
          </div>
          <div className="grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
            {FORM_F_INDICATIONS.map((full, i) => (
              <label key={i} title={full} className={cx('flex cursor-pointer items-start gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] leading-4 hover:bg-surface2', ind.includes(i + 1) && 'bg-brand-50 font-semibold text-brand-800 dark:bg-brand-950/40 dark:text-brand-200')}>
                <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-brand-600" checked={ind.includes(i + 1)} onChange={() => toggleInd(i + 1)} />
                <span><span className="tnum text-muted">{i + 1}.</span> {SHORT_IND[i]}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
          <Field label="Item 11 · procedure" className={miss('procedure')}>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Checkbox checked={d.procUltrasound} onChange={(v) => upd({ procUltrasound: v })} label="(i) Ultrasound" />
              <Checkbox checked={d.procOther} onChange={(v) => upd({ procOther: v })} label="(ii) Any other" />
            </div>
          </Field>
          {d.procOther && <Field label="Specify other procedure"><Input value={d.procedureOther} onChange={(e) => upd({ procedureOther: e.target.value })} placeholder="e.g. Colour Doppler" /></Field>}
        </div>

        <Field label="Item 14 · result of the non-invasive procedure (brief)" required className={miss('result')}
          extra={report && <button type="button" className="link inline-flex items-center gap-1 normal-case" onClick={onUseReport}><FileText className="h-3 w-3" />use report impression</button>}>
          <div className="space-y-1.5">
            <Select value={presetVal} onChange={(e) => e.target.value && upd({ result: e.target.value.replace('{GA}', gaText(d) || '__ weeks') })} options={RESULT_PRESETS.map((p) => ({ value: p, label: p.replace('{GA}', gaText(d) || '[GA]') }))} placeholder="Presets…" />
            <Textarea rows={2} value={d.result} onChange={(e) => upd({ result: e.target.value })} aria-label="Result of procedure" />
          </div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <Field label="Item 15 · result conveyed to" extra={<Checkbox checked={d.conveyedToAuto} onChange={(v) => upd({ conveyedToAuto: v })} label={<span className="text-[10px] normal-case">auto</span>} />}>
            <Input value={d.resultConveyedTo} disabled={d.conveyedToAuto} onChange={(e) => upd({ resultConveyedTo: e.target.value })} />
          </Field>
          <Field label="On date"><Input type="date" value={d.conveyedDate} onChange={(e) => upd({ conveyedDate: e.target.value })} /></Field>
          <Field label="16 · MTP indication"><Segmented size="sm" value={d.mtp} onChange={(v) => upd({ mtp: v })} options={['NO', 'YES']} /></Field>
        </div>
      </fieldset>
    </Card>
  );
}

const C_FIELDS = [['17', 'Doctor(s) performing invasive procedure'], ['18', 'Family history of genetic / medical disease'], ['18b', 'Basis of diagnosis'], ['19', 'Indication for pre-natal diagnosis'], ['19A', 'A. Previous child/children with…'], ['19B', 'B. Advanced maternal age (35 years)'], ['19C', 'C. Mother/father/sibling genetic disease'], ['19D', 'D. Other'], ['20', 'Form G consent date'], ['21', 'Invasive procedure carried out'], ['22', 'Complications'], ['23', 'Additional tests recommended'], ['24', 'Result of invasive procedure'], ['25', 'Date(s) of procedure'], ['26', 'Result conveyed to … on …'], ['27', 'MTP indication']];

export function SectionC({ rec, upd, readOnly, collapsed }) {
  const d = rec.data;
  const [open, setOpen] = useState(!collapsed || d.sectionCUnlocked);
  return (
    <Card title="Section C · Invasive procedures" icon={d.sectionCUnlocked ? ShieldAlert : ShieldOff}
      actions={<button type="button" className="link text-xs" onClick={() => setOpen(!open)}>{open ? 'Collapse' : 'Expand'}</button>}>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface2 px-3 py-2 text-[13px]">
        <span><b>Items 17–27</b> print as <b>“Not Applicable”</b> on page 2 (non-invasive ultrasound only).</span>
        <Toggle size="sm" disabled={readOnly} checked={d.sectionCUnlocked} onChange={(v) => { upd({ sectionCUnlocked: v }); if (v) setOpen(true); }} label="Unlock to edit" />
      </div>
      {open && d.sectionCUnlocked && (
        <fieldset disabled={readOnly} className="mt-3 grid gap-2 sm:grid-cols-2">
          {C_FIELDS.map(([k, label]) => (
            <Field key={k} label={k.replace(/^(\d+)/, '$1. ') + label}>
              <Input value={(d.sectionC || {})[k] || ''} placeholder="Not Applicable" onChange={(e) => upd({ sectionC: Object.assign({}, d.sectionC, { [k]: e.target.value }) })} />
            </Field>
          ))}
        </fieldset>
      )}
    </Card>
  );
}

export function SectionD({ rec, upd, readOnly }) {
  const d = rec.data;
  const th = d.thumb || {};
  const setT = (patch) => upd({ thumb: Object.assign({}, th, patch) });
  return (
    <Card title="Section D · Declarations" icon={d.signatureType === 'thumb' ? Fingerprint : ClipboardCheck}>
      <fieldset disabled={readOnly} className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label mb-0">Patient signs by</span>
          <Segmented size="sm" value={d.signatureType} onChange={(v) => upd({ signatureType: v, thumb: v === 'thumb' && !th.date ? Object.assign({}, th, { date: d.declarationDate }) : th })}
            options={[{ value: 'signed', label: 'Signature (thumb block = Not Applicable)' }, { value: 'thumb', label: 'Thumb impression', icon: Fingerprint }]} />
        </div>
        {d.signatureType === 'thumb' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Identified by – name"><Input value={th.name} onChange={(e) => setT({ name: e.target.value })} /></Field>
            <Field label="Age & sex"><Input value={th.ageSex} onChange={(e) => setT({ ageSex: e.target.value })} placeholder="e.g. 34 Y / M" /></Field>
            <Field label="Relation to patient"><Input value={th.relation} onChange={(e) => setT({ relation: e.target.value })} placeholder="Husband / Mother-in-law…" /></Field>
            <Field label="Date"><Input type="date" value={th.date} onChange={(e) => setT({ date: e.target.value })} /></Field>
            <Field label="Address & contact no." className="sm:col-span-2"><Input value={th.addressContact} onChange={(e) => setT({ addressContact: e.target.value })} /></Field>
          </div>
        ) : (
          <p className="text-[13px] text-muted">The thumb-impression attestation fields print as “Not Applicable”. The bilingual declaration auto-inserts <b className="text-ink">{[d.patientTitle, d.patientName].filter(Boolean).join(' ') || 'the patient name'}</b>{d.patientNameHindi ? <> / <b className="font-deva text-ink">{d.patientNameHindi}</b></> : ''}.</p>
        )}
      </fieldset>
    </Card>
  );
}
