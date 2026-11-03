// Referring doctor autocomplete with "+ Add New Doctor" (saved permanently to the doctor master).
import { useEffect, useMemo, useState } from 'react';
import { Stethoscope, UserPlus, Star } from 'lucide-react';
import { useColl } from '../core/hooks';
import { store } from '../core/store';
import { uid } from '../core/utils';
import { Combobox, Modal, Button, Input, Field, toast } from './ui';
import seed from '../../../shared/seed-data';

export function DoctorQuickAdd({ open, onClose, initialName = '', onSaved }) {
  const [f, setF] = useState({ name: '', qualification: 'MBBS', speciality: 'General Physician', clinic: '', address: '', phone: '' });
  useEffect(() => {
    if (open) setF((x) => Object.assign({}, x, { name: initialName ? (/^dr/i.test(initialName) ? initialName : 'Dr. ' + initialName) : '' }));
  }, [open, initialName]);
  const save = () => {
    if (!f.name.trim()) { toast('Doctor name is required', 'warning'); return; }
    const d = store.put('doctors', { id: uid('doc_'), name: f.name.trim(), qualification: f.qualification, speciality: f.speciality, clinic: f.clinic, address: f.address, phone: f.phone.replace(/\D/g, ''), email: '', shares: { USG: 0, LAB: 0, XRAY: 0, ECG: 0 }, active: true });
    toast('Referring doctor added: ' + d.name, 'success');
    onSaved && onSaved(d);
    onClose();
  };
  const set = (k) => (e) => setF(Object.assign({}, f, { [k]: e.target.value }));
  return (
    <Modal open={open} onClose={onClose} size="md" title="Add new referring doctor" icon={UserPlus}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save doctor</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name" required><Input autoFocus value={f.name} onChange={set('name')} placeholder="Dr. …" /></Field>
        <Field label="Qualification"><Input value={f.qualification} onChange={set('qualification')} /></Field>
        <Field label="Speciality"><Input value={f.speciality} onChange={set('speciality')} list="spec-list" /></Field>
        <Field label="Mobile / WhatsApp"><Input value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
        <Field label="Clinic / Hospital"><Input value={f.clinic} onChange={set('clinic')} /></Field>
        <Field label="Address"><Input value={f.address} onChange={set('address')} /></Field>
      </div>
      <datalist id="spec-list">{['General Physician', 'MD Medicine', 'OB-GYN', 'Orthopedics', 'Pediatrics', 'Surgeon', 'Urologist', 'ENT'].map((s) => <option key={s} value={s} />)}</datalist>
      <p className="mt-3 text-[11px] text-muted">Share percentages for doctor statements are set in Accounts → Doctor Master.</p>
    </Modal>
  );
}

/** Village / town of an address: a known local place name, else the part before the district. */
export function placeOf(address) {
  const a = String(address || '').trim();
  if (!a) return '';
  // the place named first is the village / town (later ones are the tehsil or district)
  let tag = '';
  let at = Infinity;
  seed.ADDRESS_TAGS.forEach((t) => {
    if (t === 'Jaipur') return;
    const m = new RegExp('\\b' + t.replace(/[-\s]+/g, '[-\\s]+') + '\\b', 'i').exec(a);
    if (m && m.index < at) { at = m.index; tag = t; }
  });
  if (tag) return tag;
  const parts = a.split(',').map((x) => x.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2].replace(/\s*-\s*\d{6}$/, '') : a.replace(/\s*-\s*\d{6}$/, '');
}

/**
 * Who refers whom, from past visits: referrals per doctor in the last 180 days, every doctor a patient
 * was referred by (with the last date), and the leading doctors per village / town.
 */
export function useReferralStats() {
  const visits = useColl('visits');
  const patients = useColl('patients');
  return useMemo(() => {
    const since = Date.now() - 180 * 86400000;
    const total = {};
    const byPatient = {};
    const byPlace = {};
    const placeOfPatient = {};
    patients.forEach((p) => { placeOfPatient[p.id] = placeOf(p.address).toLowerCase(); });
    visits.forEach((v) => {
      const d = v.referredBy;
      if (!d) return;
      const recent = (v.createdAt || 0) >= since;
      if (recent && d !== 'SELF') total[d] = (total[d] || 0) + 1;
      const bp = byPatient[v.patientId] || (byPatient[v.patientId] = {});
      const cur = bp[d] || (bp[d] = { n: 0, last: 0 });
      cur.n += 1;
      cur.last = Math.max(cur.last, v.createdAt || 0);
      const pl = placeOfPatient[v.patientId];
      if (recent && pl && d !== 'SELF') { const m = byPlace[pl] || (byPlace[pl] = {}); m[d] = (m[d] || 0) + 1; }
    });
    return { total, byPatient, byPlace };
  }, [visits, patients]);
}

/**
 * The doctor a new visit most likely comes from: the doctor who referred this patient last (most often
 * on ties), else the leading referrer for the patient's village / town (at least 2 referrals).
 * → { id, reason } | null
 */
export function suggestDoctor(stats, { patientId, address } = {}) {
  const doctors = Object.fromEntries(store.list('doctors').map((d) => [d.id, d]));
  const ok = (id) => id === 'SELF' || (doctors[id] && doctors[id].active !== false);
  const mine = patientId && stats.byPatient[patientId];
  if (mine) {
    const best = Object.entries(mine).filter(([id]) => ok(id)).sort((a, b) => b[1].last - a[1].last || b[1].n - a[1].n)[0];
    if (best) return { id: best[0], reason: best[0] === 'SELF' ? 'came self-referred last time' : 'referred this patient last time' + (best[1].n > 1 ? ' (' + best[1].n + ' visits)' : '') };
  }
  const pl = placeOf(address).toLowerCase();
  const local = pl && stats.byPlace[pl];
  if (local) {
    const best = Object.entries(local).filter(([id]) => ok(id)).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 2) return { id: best[0], reason: 'refers most patients from ' + placeOf(address) + ' (' + best[1] + ' in 6 months)', local: true };
  }
  return null;
}

/**
 * Referring-doctor autocomplete ranked by what actually happens: this patient's previous doctors first,
 * then the most frequent referrers (last 6 months), then everyone else alphabetically.
 */
export function DoctorPicker({ value, onChange, invalid, placeholder = 'Search referring doctor or choose Self', inputRef, patientId, address }) {
  const doctors = useColl('doctors');
  const stats = useReferralStats();
  const [adding, setAdding] = useState(null);
  const items = useMemo(() => {
    const mine = (patientId && stats.byPatient[patientId]) || {};
    const pl = placeOf(address).toLowerCase();
    const local = (pl && stats.byPlace[pl]) || {};
    const rank = (d) => (mine[d.id] ? 1e9 + mine[d.id].last / 1e4 : 0) + (local[d.id] || 0) * 1e5 + (stats.total[d.id] || 0) * 100;
    const active = doctors.filter((d) => d.active !== false).map((d) => Object.assign({}, d, {
      _n: stats.total[d.id] || 0, _mine: !!mine[d.id], _local: local[d.id] || 0, _rank: rank(d)
    }));
    active.sort((a, b) => b._rank - a._rank || a.name.localeCompare(b.name));
    return [{ id: 'SELF', name: 'Self', speciality: 'Self-referred / walk-in', clinic: '', _mine: !!mine.SELF }].concat(active);
  }, [doctors, stats, patientId, address]);
  const sub = (d) => {
    const tags = [];
    if (d._mine) tags.push('★ this patient’s doctor');
    else if (d._local) tags.push('★ common for ' + placeOf(address));
    if (d._n) tags.push(d._n + ' referral' + (d._n === 1 ? '' : 's') + ' in 6 months');
    return tags.concat([d.speciality, d.clinic].filter(Boolean)).join(' · ');
  };
  return (
    <>
      <Combobox value={value} onChange={(id) => onChange(id)} items={items} invalid={invalid} icon={Stethoscope} inputRef={inputRef} mic ariaLabel="Referring doctor"
        getLabel={(d) => d.name} getSub={sub} placeholder={placeholder}
        onCreate={(q) => setAdding(q || '')} createLabel="Add new doctor" />
      <DoctorQuickAdd open={adding !== null} initialName={adding || ''} onClose={() => setAdding(null)} onSaved={(d) => onChange(d.id)} />
    </>
  );
}

/**
 * One-tap chips: the suggested doctor (this patient's / this village's), "Self" and the most frequent
 * referrers of the last 90 days. Chips are skipped by Tab so the keyboard moves field to field.
 */
export function QuickDoctors({ value, onChange, limit = 6, suggestion }) {
  const visits = useColl('visits');
  const doctors = useColl('doctors');
  const top = useMemo(() => {
    const since = Date.now() - 90 * 86400000;
    const count = {};
    visits.forEach((v) => { if ((v.createdAt || 0) >= since && v.referredBy && v.referredBy !== 'SELF') count[v.referredBy] = (count[v.referredBy] || 0) + 1; });
    const byId = {};
    doctors.forEach((d) => { byId[d.id] = d; });
    return Object.entries(count).filter(([id]) => byId[id] && byId[id].active !== false).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, n]) => ({ d: byId[id], n }));
  }, [visits, doctors, limit]);
  const sugDoc = suggestion && suggestion.id !== 'SELF' ? doctors.find((d) => d.id === suggestion.id) : null;
  const chip = (id, label, title, star) => (
    <button key={id} type="button" tabIndex={-1} onClick={() => onChange(id)} title={title}
      className={'chip px-2 py-0.5 text-[11px]' + (value === id ? ' chip-on' : '') + (star ? ' border-amber-300 dark:border-amber-700' : '')}>{star ? <Star className="h-3 w-3 fill-amber-400 text-amber-500" /> : <Stethoscope className="h-3 w-3" />}{label}</button>
  );
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {sugDoc && chip(sugDoc.id, sugDoc.name.replace(/^Dr\.?\s*/i, 'Dr. '), 'Suggested: ' + suggestion.reason, true)}
      {chip('SELF', 'Self', 'Self-referred patient', suggestion && suggestion.id === 'SELF')}
      {top.filter(({ d }) => !sugDoc || d.id !== sugDoc.id).map(({ d, n }) => chip(d.id, d.name.replace(/^Dr\.?\s*/i, 'Dr. '), (d.speciality || '') + ' · ' + n + ' referrals in 90 days'))}
    </div>
  );
}
