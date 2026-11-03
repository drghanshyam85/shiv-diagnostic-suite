// PC-PNDT Pregnancy / Obstetric case panel: LMP → GA & EDD (Naegele), or USG GA / EDD → clinical LMP,
// G P L A, living children (sons / daughters with ages), indication and Form F compliance.
import { Baby, CalendarDays } from 'lucide-react';
import { eddFromLmp, gaFromLmp, lmpFromGa, lmpFromEdd, gaFromEdd, trimester, formatGa } from '../../core/obstetric';
import { dateKey, fmtDate } from '../../core/utils';
import { Field, Input, Segmented, Checkbox, Badge } from '../../components/ui';

export const emptyObstetric = () => ({
  enabled: false, mode: 'lmp', lmp: '', edd: '', gaWeeks: '', gaDays: '', eddOverride: false, gaOverride: false,
  gravida: '', para: '', living: '', abortion: '', sons: 0, daughters: 0, sonsAges: '', daughtersAges: '', indication: '', formFConsent: false
});

export function deriveObstetric(o, onDate = new Date()) {
  const out = Object.assign({}, o);
  if (o.mode === 'lmp' && o.lmp) {
    if (!o.eddOverride) out.edd = eddFromLmp(o.lmp);
    if (!o.gaOverride) { const g = gaFromLmp(o.lmp, onDate); if (g && !g.invalid) { out.gaWeeks = g.weeks; out.gaDays = g.days; } }
  } else if (o.mode === 'usg') {
    if (o.gaWeeks !== '' && o.gaWeeks !== undefined && !o.eddFirst) {
      out.lmp = lmpFromGa(o.gaWeeks, o.gaDays || 0, onDate);
      out.edd = eddFromLmp(out.lmp);
    } else if (o.edd) {
      out.lmp = lmpFromEdd(o.edd);
      const g = gaFromEdd(o.edd, onDate);
      if (g && !g.invalid) { out.gaWeeks = g.weeks; out.gaDays = g.days; }
    }
  }
  return out;
}

const INDICATIONS = ['Confirm viability & dating', 'Routine ANC – foetal growth & well-being', 'Anomaly scan (TIFFA)', 'NT / NB screening', 'Bleeding / leaking P/V', 'Pain abdomen in pregnancy', 'Decreased foetal movements', 'Previous LSCS – scar evaluation', 'Suspected IUGR / Doppler', 'Placental localisation'];

export function ObstetricPanel({ value, onChange, onDate, readOnly }) {
  const o = value;
  const set = (patch) => onChange(deriveObstetric(Object.assign({}, o, patch), onDate || new Date()));
  const weeks = o.gaWeeks === '' || o.gaWeeks === undefined ? null : Number(o.gaWeeks);
  const num = (k) => (e) => set({ [k]: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) });
  return (
    <fieldset disabled={readOnly} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={o.mode} onChange={(mode) => set({ mode, eddFirst: false })} options={[{ value: 'lmp', label: 'LMP known' }, { value: 'usg', label: 'LMP not known (by USG GA / EDD)' }]} size="sm" />
        {weeks !== null && <Badge tone="violet" icon={Baby}>GA {formatGa(o.gaWeeks, o.gaDays)} · {['', '1st', '2nd', '3rd'][trimester(weeks)]} trimester</Badge>}
        {o.edd && <Badge tone="brand" icon={CalendarDays}>EDD {fmtDate(o.edd)}</Badge>}
      </div>
      {o.mode === 'lmp' ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="LMP (Last Menstrual Period)"><Input type="date" max={dateKey()} value={o.lmp} onChange={(e) => set({ lmp: e.target.value })} /></Field>
          <Field label="Gestational age (weeks + days)" extra={<Checkbox checked={o.gaOverride} onChange={(v) => set({ gaOverride: v })} label={<span className="text-[10px] normal-case">override</span>} />}>
            <div className="flex gap-1.5"><Input type="number" min="0" max="45" value={o.gaWeeks} disabled={!o.gaOverride} onChange={num('gaWeeks')} aria-label="GA weeks" /><Input type="number" min="0" max="6" value={o.gaDays} disabled={!o.gaOverride} onChange={num('gaDays')} aria-label="GA days" /></div>
          </Field>
          <Field label="EDD (LMP + 280 days)" extra={<Checkbox checked={o.eddOverride} onChange={(v) => set({ eddOverride: v })} label={<span className="text-[10px] normal-case">override</span>} />}>
            <Input type="date" value={o.edd} disabled={!o.eddOverride} onChange={(e) => set({ edd: e.target.value })} />
          </Field>
          <Field label="Clinical indication for USG"><Input list="obs-ind" value={o.indication} onChange={(e) => set({ indication: e.target.value })} placeholder="Select / type" /></Field>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="GA by USG (weeks + days)"><div className="flex gap-1.5"><Input type="number" min="0" max="45" value={o.gaWeeks} onChange={(e) => set({ gaWeeks: e.target.value === '' ? '' : Number(e.target.value), eddFirst: false })} aria-label="USG GA weeks" /><Input type="number" min="0" max="6" value={o.gaDays} onChange={(e) => set({ gaDays: e.target.value === '' ? '' : Number(e.target.value), eddFirst: false })} aria-label="USG GA days" /></div></Field>
          <Field label="…or EDD (by USG)"><Input type="date" value={o.edd} onChange={(e) => set({ edd: e.target.value, eddFirst: true, gaWeeks: '', gaDays: '' })} /></Field>
          <Field label="Back-calculated clinical LMP"><Input value={o.lmp ? fmtDate(o.lmp) : ''} readOnly placeholder="auto" /></Field>
          <Field label="Clinical indication for USG"><Input list="obs-ind" value={o.indication} onChange={(e) => set({ indication: e.target.value })} placeholder="Select / type" /></Field>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_1.4fr]">
        <Field label="Gravida / Para / Living / Abortion">
          <div className="flex items-center gap-1">
            {[['gravida', 'G'], ['para', 'P'], ['living', 'L'], ['abortion', 'A']].map(([k, l]) => (
              <span key={k} className="flex items-center gap-0.5"><span className="text-xs font-bold text-muted">{l}</span><input type="number" min="0" aria-label={k} className="input input-sm w-12 px-1.5 text-center" value={o[k]} onChange={num(k)} /></span>
            ))}
          </div>
        </Field>
        <Field label="Living sons (count · ages)"><div className="flex gap-1.5"><Input type="number" min="0" className="w-20" value={o.sons} onChange={num('sons')} aria-label="Living sons" /><Input value={o.sonsAges} placeholder="e.g. 4 yrs, 2 yrs" onChange={(e) => set({ sonsAges: e.target.value })} aria-label="Ages of sons" /></div></Field>
        <Field label="Living daughters (count · ages)"><div className="flex gap-1.5"><Input type="number" min="0" className="w-20" value={o.daughters} onChange={num('daughters')} aria-label="Living daughters" /><Input value={o.daughtersAges} placeholder="e.g. 3 yrs" onChange={(e) => set({ daughtersAges: e.target.value })} aria-label="Ages of daughters" /></div></Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900 dark:bg-violet-950/40 dark:text-violet-200">
        <span>Total living children: <b>{(Number(o.sons) || 0) + (Number(o.daughters) || 0)}</b> {o.mode === 'usg' && weeks !== null ? `· Form F Item 8 will read “Not Known / By USG: ${o.gaWeeks} Weeks${o.gaDays ? ' ' + o.gaDays + ' Days' : ''}”` : ''}</span>
        <Checkbox checked={!!o.formFConsent} onChange={(v) => set({ formFConsent: v })} label="Form F declaration obtained & ID verified (statutory compliance)" />
      </div>
      <datalist id="obs-ind">{INDICATIONS.map((i) => <option key={i} value={i} />)}</datalist>
    </fieldset>
  );
}
