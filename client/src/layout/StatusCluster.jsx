// Live status badges: Auto-Backup, LAN / multi-workstation link, multi-cloud sync health.
import { useEffect, useState } from 'react';
import { ShieldCheck, Wifi, WifiOff, HardDrive, Cloud } from 'lucide-react';
import { events, store } from '../core/store';
import { navigate } from '../core/hooks';
import { fmtTime } from '../core/utils';
import { cx } from '../components/ui';

const CLOUD_LABEL = { gdrive: 'Google Drive', onedrive: 'OneDrive', gcp: 'Google Cloud' };
const STATE = {
  synced: ['bg-emerald-500', 'All data synced'], saving: ['bg-sky-500 animate-pulse', 'Saving…'], offline: ['bg-amber-500', 'Offline (queued locally)'],
  error: ['bg-rose-500', 'Sync error – retry'], not_connected: ['bg-slate-300 dark:bg-slate-600', 'Not connected'], paused: ['bg-slate-400', 'Paused']
};

export function StatusCluster({ net, onLan }) {
  const [saved, setSaved] = useState(store.lastPersistAt || Date.now());
  useEffect(() => events.on('persisted', (t) => setSaved(t)), []);
  const providers = (net.cloud && net.cloud.providers) || {};
  const server = net.mode === 'server';
  const devices = (net.devices || []).length;
  return (
    <div className="hidden items-center gap-1.5 md:flex">
      <span title={'Auto-Backup Active — every change is saved instantly to this workstation (IndexedDB). Last save ' + fmtTime(saved) + (server ? '; replicated to the clinic server.' : '.')}
        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
        <ShieldCheck className="h-3.5 w-3.5" /><span className="hidden lg:inline">Auto-Backup Active</span>
      </span>
      <button onClick={onLan} title={server ? (net.connected ? `LAN server connected · ${devices} workstation(s) online · ${net.pending} pending` : 'Server unreachable — changes queued locally') : 'Standalone mode (this browser only). Run the LAN server for multi-workstation sync.'}
        className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
          server && net.connected ? 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-300'
            : server ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
              : 'border-line bg-surface2 text-muted')}>
        {server ? (net.connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />) : <HardDrive className="h-3.5 w-3.5" />}
        <span className="hidden lg:inline">{server ? (net.connected ? `LAN Live · ${devices}` : 'Reconnecting') : 'Local Mode'}</span>
        {net.pending > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[10px] text-white tnum">{net.pending}</span>}
      </button>
      {server && (
        <button onClick={() => navigate('/cloud')} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface2 px-2.5 py-1 text-[11px] font-semibold text-muted hover:text-ink"
          title={Object.keys(CLOUD_LABEL).map((k) => CLOUD_LABEL[k] + ': ' + (STATE[(providers[k] || {}).status] || STATE.not_connected)[1]).join('\n')}>
          <Cloud className="h-3.5 w-3.5" />
          {Object.keys(CLOUD_LABEL).map((k) => <span key={k} className={cx('h-2 w-2 rounded-full', (STATE[(providers[k] || {}).status] || STATE.not_connected)[0])} />)}
        </button>
      )}
    </div>
  );
}
