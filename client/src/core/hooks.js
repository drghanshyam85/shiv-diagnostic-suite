// React bindings for the store, settings, routing, hotkeys and misc UI state.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { store, events } from './store';
import { deepMerge, lsGet, lsSet } from './utils';
import seed from '../../../shared/seed-data';

export function useColl(coll) {
  return useSyncExternalStore(
    useCallback((cb) => store.subscribe(coll, cb), [coll]),
    () => store.list(coll)
  );
}

export function useDoc(coll, id) {
  return useSyncExternalStore(
    useCallback((cb) => store.subscribe(coll, cb), [coll]),
    () => (id ? store.get(coll, id) : null)
  );
}

let settingsCache = { v: -1, val: null };
export function getSettings() {
  const raw = store.get('settings', 'main');
  const v = store.version.settings;
  if (settingsCache.v === v && settingsCache.val) return settingsCache.val;
  settingsCache = { v, val: deepMerge(seed.DEFAULT_SETTINGS, raw || {}) };
  return settingsCache.val;
}
export function useSettings() {
  return useSyncExternalStore(useCallback((cb) => store.subscribe('settings', cb), []), getSettings);
}
export function saveSettings(patch) {
  const cur = store.getRaw('settings', 'main') || { id: 'main' };
  return store.put('settings', deepMerge(cur, patch));
}

// ---------------------------------------------------------------- routing (hash based, works on file://)
function parseHash(h) {
  const raw = (h || '').replace(/^#/, '') || '/dashboard';
  const [p, q] = raw.split('?');
  const path = p.startsWith('/') ? p : '/' + p;
  const query = {};
  new URLSearchParams(q || '').forEach((v, k) => { query[k] = v; });
  return { path, parts: path.split('/').filter(Boolean), query, raw };
}
const routeSub = (cb) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); };
export function useRoute() {
  const hash = useSyncExternalStore(routeSub, () => location.hash);
  return useMemo(() => parseHash(hash), [hash]);
}
export function navigate(path, query) {
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  const next = '#' + path + (qs.length > 1 ? qs : '');
  if (location.hash === next) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = next;
}
export const currentRoute = () => parseHash(location.hash);

// ---------------------------------------------------------------- misc
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function useLocalPref(key, initial) {
  const [v, setV] = useState(() => lsGet('ssdc-pref:' + key, initial));
  const set = useCallback((nv) => {
    setV((old) => { const val = typeof nv === 'function' ? nv(old) : nv; lsSet('ssdc-pref:' + key, val); return val; });
  }, [key]);
  return [v, set];
}

export function useEvent(type, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => events.on(type, (d) => ref.current(d)), [type]);
}

/** useHotkeys({ 'ctrl+s': fn, 'alt+n': fn, 'escape': fn }) — ctrl also matches ⌘ on macOS */
export function useHotkeys(map, deps = [], opts = {}) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const h = (e) => {
      const key = (e.key || '').toLowerCase();
      const combo = [(e.ctrlKey || e.metaKey) ? 'ctrl' : '', e.altKey ? 'alt' : '', e.shiftKey ? 'shift' : '', key].filter(Boolean).join('+');
      const fn = ref.current[combo];
      if (!fn) return;
      const inField = /input|textarea|select/i.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
      if (inField && !combo.includes('ctrl') && !combo.includes('alt') && key !== 'escape' && !opts.allowInFields) return;
      const r = fn(e);
      if (r !== false) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useOutside(ref, fn, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) fn(e); };
    document.addEventListener('mousedown', h);
    document.addEventListener('touchstart', h);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('touchstart', h); };
  }, [ref, fn, active]);
}

export function useDebounced(value, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function useMedia(query) {
  const get = () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false);
  const [m, setM] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [query]);
  return m;
}

export function useMaps() {
  const tests = useColl('tests');
  const doctors = useColl('doctors');
  const patients = useColl('patients');
  return useMemo(() => {
    const t = {}, d = {}, p = {};
    tests.forEach((x) => { t[x.id] = x; });
    doctors.forEach((x) => { d[x.id] = x; });
    patients.forEach((x) => { p[x.id] = x; });
    return { tests: t, doctors: d, patients: p };
  }, [tests, doctors, patients]);
}
