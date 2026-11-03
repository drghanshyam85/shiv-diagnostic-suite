// Cloud Sync & Backup: live health of Google Drive, Microsoft OneDrive and Google Cloud (Firestore +
// Cloud Storage) — connect / disconnect, per-provider pause, quota, pending queue — sync preferences
// (root folder, auto-sync interval, what to sync), Force Full Cloud Sync, retry, the verified sync log
// with links, this workstation's report mirror, and local JSON backup / restore (works offline too).
import { useCallback, useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw, Link2, Unlink, Upload, Download, HardDriveDownload, ShieldCheck, ExternalLink, CircleCheck, TriangleAlert, Loader2, Settings as SettingsIcon, FolderTree, Database, Clock, Inbox, Save } from 'lucide-react';
import { useSettings, saveSettings, useRoute, navigate, useEvent } from '../../core/hooks';
import { store } from '../../core/store';
import { api, isServer, useNet } from '../../core/sync';
import { can, logAudit } from '../../core/auth';
import { Card, Button, Badge, Input, Field, Toggle, Modal, Empty, Progress, Textarea, toast, confirmDialog } from '../../components/ui';
import { fmtDateTime, fmtBytes, timeAgo, download, pickFiles, readAsText, dateKey } from '../../core/utils';
import { mirrorStats } from './cloudMirror';

const PROVIDERS = [
  { id: 'gdrive', name: 'Google Drive', oauth: 'google', what: 'Patient folders with report PDF + Word, scan images, daily register & backups (Drive API v3)' },
  { id: 'onedrive', name: 'Microsoft OneDrive', oauth: 'microsoft', what: 'The same folder tree mirrored through Microsoft Graph' },
  { id: 'gcp', name: 'Google Cloud', oauth: null, what: 'Structured records in Firestore + files in a Cloud Storage bucket (service account)' }
];
const STATUS = {
  synced: ['emerald', 'All data synced', CircleCheck], saving: ['brand', 'Saving…', Loader2], offline: ['amber', 'Offline (queued locally)', CloudOff],
  error: ['rose', 'Sync error – retry', TriangleAlert], not_connected: ['slate', 'Not connected', CloudOff], paused: ['slate', 'Paused', Clock]
};

export function CloudSync() {
  const net = useNet();
  const route = useRoute();
  const settings = useSettings();
  const admin = can('settings:manage_clinic_and_integrations');
  const [log, setLog] = useState({ log: [], queue: [] });
  const [busy, setBusy] = useState('');
  const [gcpOpen, setGcpOpen] = useState(false);
  const [, tick] = useState(0);
  useEvent('cloud:mirrored', () => tick((x) => x + 1));
  const [status, setStatus] = useState(null);
  const cloud = net.cloud || status || { providers: {} };
  const refresh = useCallback(() => {
    if (!isServer()) return;
    api('cloud/log?limit=200').then(setLog).catch(() => {});
    api('cloud/status').then(setStatus).catch(() => {});
  }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 6000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => {
    if (route.query.connected) toast('Connected: ' + route.query.connected, 'success');
    if (route.query.error) toast('Cloud connection failed: ' + route.query.error, 'error', 9000);
  }, [route.query.connected, route.query.error]);

  const run = async (label, fn) => { setBusy(label); try { await fn(); } catch (e) { toast(e.message, 'error', 8000); } finally { setBusy(''); refresh(); } };
  const connect = (p) => run('c-' + p.id, async () => {
    if (p.oauth) { const r = await api('cloud/' + p.oauth + '/auth-url'); location.href = r.url; } else setGcpOpen(true);
  });
  const disconnect = (p) => run('d-' + p.id, async () => {
    if (!(await confirmDialog({ title: 'Disconnect ' + p.name + '?', message: 'Files already uploaded stay in the cloud. New changes stop syncing to ' + p.name + '.', danger: true, confirmText: 'Disconnect' }))) return;
    await api('cloud/' + p.id + '/disconnect', { method: 'POST' });
    toast(p.name + ' disconnected', 'info');
  });
  const setPref = (p, enabled) => run('p-' + p.id, () => api('cloud/prefs', { method: 'PUT', body: { [p.id]: enabled } }));
  const ms = mirrorStats();
  const c = settings.cloud;

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-xl font-extrabold tracking-tight sm:text-2xl">Cloud Sync & Backup</h1>
          <p className="text-[13px] text-muted">{settings.clinic.name} · zero-data-loss auto-save to Google Drive, OneDrive and Google Cloud — every change is first saved on this workstation, then queued for the cloud</p>
        </div>
        {isServer() && (
          <div className="flex flex-wrap gap-2">
            <Button icon={RefreshCw} loading={busy === 'retry'} onClick={() => run('retry', async () => { await api('cloud/retry', { method: 'POST' }); toast('Retrying queued uploads', 'info'); })}>Retry failed</Button>
            <Button icon={HardDriveDownload} loading={busy === 'quota'} onClick={() => run('quota', () => api('cloud/quota', { method: 'POST' }))}>Refresh quota</Button>
            <Button variant="primary" icon={Cloud} loading={busy === 'force'} onClick={() => run('force', async () => { const r = await api('cloud/force-sync', { method: 'POST', timeout: 180000 }); toast('Full cloud sync queued' + (r && r.queued !== undefined ? ': ' + r.queued + ' item(s)' : ''), 'success'); })}>Force full cloud sync</Button>
          </div>
        )}
      </div>

      {!isServer() ? (
        <Card icon={CloudOff} title="Cloud sync needs the clinic LAN server">
          <p className="text-[13px] text-muted">Google Drive, OneDrive and Google Cloud are connected once, on the clinic server (OAuth secrets never sit in a browser). Start the server on the main PC (<span className="font-mono">npm start</span>) and open the suite from its address. Until then, use the local backup below — every change is already saved in this browser’s IndexedDB.</p>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          {PROVIDERS.map((p) => {
            const s = (cloud.providers || {})[p.id] || { status: 'not_connected' };
            const [tone, label, Icon] = STATUS[s.status] || STATUS.not_connected;
            const q = s.quota;
            return (
              <Card key={p.id} title={p.name} subtitle={s.account || p.what} icon={Cloud} actions={<Badge tone={tone} icon={Icon}>{label}</Badge>}>
                <div className="space-y-2 text-[12.5px]">
                  <div className="flex justify-between"><span className="text-muted">Pending uploads</span><b className="tnum">{s.pending || 0}</b></div>
                  <div className="flex justify-between"><span className="text-muted">Last synced</span><span>{s.lastSyncAt ? timeAgo(s.lastSyncAt) : '—'}</span></div>
                  {q && q.total > 0 && <div><div className="flex justify-between text-[11.5px]"><span className="text-muted">Storage</span><span>{fmtBytes(q.used)} of {fmtBytes(q.total)}</span></div><Progress value={q.used} max={q.total} className="mt-1" /></div>}
                  {s.lastError && <div className="rounded-lg bg-rose-50 px-2 py-1 text-[11.5px] text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{s.lastError}</div>}
                  {s.account && <p className="text-[11.5px] text-muted">{p.what}</p>}
                  {admin && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
                      {s.connected
                        ? <><Toggle size="sm" checked={s.enabled !== false} onChange={(v) => setPref(p, v)} label="Sync on" /><Button size="xs" variant="danger-ghost" icon={Unlink} className="ml-auto" loading={busy === 'd-' + p.id} onClick={() => disconnect(p)}>Disconnect</Button></>
                        : <Button size="sm" variant="primary" icon={Link2} loading={busy === 'c-' + p.id} onClick={() => connect(p)}>Connect {p.oauth ? 'account' : 'service account'}</Button>}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {isServer() && <IntegrityCard cloud={cloud} canRun={can('settings:manage_clinic_and_integrations', 'READ')} onDone={refresh} />}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Sync preferences" icon={SettingsIcon} subtitle={admin ? 'Applied by the server and every workstation' : 'Read-only for your role'}>
          <div className="space-y-3">
            <Field label="Root backup folder" hint={'Folder tree: /' + (c.rootFolder || '') + '/YYYY-MM-DD/[Patient_ID]_[Patient_Name]/'}>
              <Input value={c.rootFolder || ''} disabled={!admin} onChange={(e) => saveSettings({ cloud: { rootFolder: e.target.value.replace(/[\\/:*?"<>|]+/g, '_') } })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Toggle checked={c.autoSync !== false} disabled={!admin} onChange={(v) => { saveSettings({ cloud: { autoSync: v } }); logAudit('settings:cloud_autosync', 'settings/cloud', { enabled: v }); }} label="Automatic cloud sync" hint="Zero manual save" />
              <Field label="Record backup interval (seconds)"><Input type="number" min={15} max={3600} disabled={!admin} value={c.intervalSeconds || 60} onChange={(e) => saveSettings({ cloud: { intervalSeconds: Math.max(15, Math.min(3600, Number(e.target.value) || 60)) } })} /></Field>
              <Toggle checked={c.syncReports !== false} disabled={!admin} onChange={(v) => saveSettings({ cloud: { syncReports: v } })} label="Report PDF & Word files" hint="Re-uploaded (new version) whenever a report changes" />
              <Toggle checked={c.syncImages !== false} disabled={!admin} onChange={(v) => saveSettings({ cloud: { syncImages: v } })} label="Scan images" hint="Ultrasound frames attached to reports" />
              <Toggle checked={c.syncDicom !== false && c.syncImages !== false} disabled={!admin || c.syncImages === false} onChange={(v) => saveSettings({ cloud: { syncDicom: v } })} label="Original DICOM files" hint="Kept beside the JPEGs in Images/DICOM" />
              <Toggle checked={c.syncRecords !== false} disabled={!admin} onChange={(v) => saveSettings({ cloud: { syncRecords: v } })} label="Database records" hint="Firestore records + daily JSON backup & register CSV" />
            </div>
            {admin && <Button size="sm" icon={SettingsIcon} onClick={() => navigate('/settings', { tab: 'integrations' })}>OAuth app credentials (Settings → Integrations)</Button>}
          </div>
        </Card>
        <Card title="This workstation" icon={FolderTree} subtitle="Report mirror & local safety net">
          <div className="space-y-2 text-[12.5px]">
            <div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><span>Every keystroke is saved to this browser (IndexedDB) within a fraction of a second{isServer() ? ' and replicated to the clinic server' : ''}.</span></div>
            {isServer() && <div className="flex items-start gap-2"><Cloud className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /><span>Report mirror: {ms.files} file(s) sent from this PC{ms.lastAt ? ' · last ' + timeAgo(ms.lastAt) : ''}{ms.pending ? ' · ' + ms.pending + ' waiting' : ''}. Reports edited here are re-rendered as PDF + Word one minute after the last change (a few seconds after signing).</span></div>}
            {ms.lastError && <div className="rounded-lg bg-amber-50 px-2 py-1 text-[11.5px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Last mirror error: {ms.lastError}</div>}
          </div>
          <LocalBackup />
        </Card>
      </div>

      {isServer() && <ImageInboxCard admin={admin} />}

      {isServer() && (
        <Card padded={false} title="Live sync log & version history" subtitle={`${log.log.length} recent upload(s) · ${log.queue.length} in queue`} icon={Database}>
          {log.queue.length > 0 && (
            <div className="border-b border-line px-4 py-2 text-[12px]">
              <div className="mb-1 font-semibold">Queue</div>
              {log.queue.slice(0, 8).map((q) => <div key={q.id} className="flex flex-wrap gap-x-3 text-muted"><Badge tone={q.status === 'error' ? 'rose' : 'brand'}>{q.status}</Badge><span>{q.provider}</span><span className="font-mono">{q.path}</span>{q.attempts ? <span>attempt {q.attempts}</span> : null}{q.lastError && <span className="text-rose-600">{q.lastError}</span>}</div>)}
            </div>
          )}
          {!log.log.length ? <Empty icon={Database} title="Nothing synced yet" text="Connect a cloud account; uploads appear here with size, time and verification status." /> : (
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full min-w-[860px] text-[12.5px]">
                <thead className="sticky top-0 bg-surface2"><tr className="text-left text-[10.5px] uppercase tracking-wide text-muted"><th className="px-3 py-2">When</th><th className="px-2">Destination</th><th className="px-2">File / record</th><th className="px-2 text-right">Size</th><th className="px-2">Status</th><th className="px-2" /></tr></thead>
                <tbody>{log.log.map((r) => (
                  <tr key={r.id} className="border-t border-line/70">
                    <td className="whitespace-nowrap px-3 py-1.5">{fmtDateTime(r.at)}</td><td className="px-2">{(PROVIDERS.find((p) => p.id === r.provider) || {}).name || r.provider}</td>
                    <td className="px-2 font-mono text-[11px]">{r.path}</td><td className="px-2 text-right tnum">{r.size ? fmtBytes(r.size) : '—'}</td>
                    <td className="px-2"><Badge tone={r.status === 'verified' ? 'emerald' : r.status === 'error' ? 'rose' : 'slate'}>{r.status}</Badge>{r.detail && <span className="ml-1 text-[11px] text-muted">{r.detail}</span>}</td>
                    <td className="px-2 text-right">{r.link && <a className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand-700 hover:underline dark:text-brand-300" href={r.link} target="_blank" rel="noopener noreferrer">Open<ExternalLink className="h-3 w-3" /></a>}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {gcpOpen && <GcpModal onClose={() => { setGcpOpen(false); refresh(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- integrity & redundancy
const PNAME = { gdrive: 'Google Drive', onedrive: 'OneDrive', gcp: 'Cloud Storage' };
const CELL = (st) => {
  const s = String(st || '');
  if (s.startsWith('ok')) return ['emerald', '✓ verified'];
  if (s.startsWith('unchecked') || s.startsWith('present')) return ['slate', '✓ present'];
  if (s.startsWith('outdated')) return ['amber', 'outdated' + (s.includes('re-queued') ? ' → re-queued' : '')];
  if (s.startsWith('mismatch')) return ['rose', 'damaged' + (s.includes('re-queued') ? ' → re-queued' : '')];
  if (s.startsWith('missing')) return ['rose', 'missing' + (s.includes('re-queued') ? ' → re-queued' : '')];
  if (s.startsWith('error')) return ['amber', 'error'];
  return ['slate', '—'];
};

/** Cloud folder → Images: a folder on the server PC (Drive / OneDrive / Dropbox sync folder or the console's share). */
function ImageInboxCard({ admin }) {
  const settings = useSettings();
  const cfg = Object.assign({ enabled: false, folder: '', depth: 3, moveImported: false, matchDays: 1 }, settings.imageInbox || {});
  const [folder, setFolder] = useState(cfg.folder);
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setFolder(cfg.folder); }, [cfg.folder]);
  const load = useCallback(() => api('images/inbox').then(setSt).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);
  const save = (patch) => { saveSettings({ imageInbox: patch }); logAudit('settings:image_inbox', 'settings/imageInbox', patch); setTimeout(load, 1500); };
  const scan = async () => { setBusy(true); try { setSt(await api('images/inbox/scan', { method: 'POST' })); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); } };
  const tone = !cfg.enabled ? 'slate' : st && st.error ? 'rose' : st && st.watching ? 'emerald' : 'amber';
  return (
    <Card title="Image inbox — cloud folder" icon={Inbox} subtitle="New ultrasound images and DICOM files dropped into this folder appear in the report’s Images tab, matched to the patient"
      actions={<Badge tone={tone}>{!cfg.enabled ? 'Off' : st && st.error ? 'Problem' : st && st.watching ? 'Watching' : 'Starting…'}</Badge>}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <Toggle checked={!!cfg.enabled} disabled={!admin} onChange={(v) => save({ enabled: v })} label="Watch an inbox folder on the server PC" hint="Google Drive for desktop, OneDrive or Dropbox folder, or the ultrasound console’s network share" />
          <Field label="Folder on the server PC" hint="Full path, e.g. D:\Google Drive\USG Inbox or /home/clinic/OneDrive/USG">
            <div className="flex gap-2">
              <Input value={folder} disabled={!admin} onChange={(e) => setFolder(e.target.value)} placeholder="D:\Google Drive\USG Inbox" aria-label="Inbox folder path" />
              <Button icon={Save} disabled={!admin || folder.trim() === cfg.folder} onClick={() => save({ folder: folder.trim() })}>Save</Button>
            </div>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Sub-folder depth"><Input type="number" min={0} max={6} disabled={!admin} value={cfg.depth} onChange={(e) => save({ depth: Math.max(0, Math.min(6, Number(e.target.value) || 0)) })} /></Field>
            <Field label="Match patients registered in the last (days)"><Input type="number" min={0} max={30} disabled={!admin} value={cfg.matchDays} onChange={(e) => save({ matchDays: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} /></Field>
          </div>
          <Toggle checked={!!cfg.moveImported} disabled={!admin} onChange={(v) => save({ moveImported: v })} label="Move imported files into “Imported/<date>”" hint="Keeps the inbox folder tidy (the sync client mirrors the move)" />
        </div>
        <div className="space-y-2 rounded-xl bg-surface2/60 p-3 text-[12.5px]">
          <div className="font-semibold">How patients are matched</div>
          <ol className="list-decimal space-y-0.5 pl-4 text-muted">
            <li>DICOM Patient ID = the clinic Reg ID (set it on the console’s worklist)</li>
            <li>DICOM accession number = the visit token</li>
            <li>Reg ID or today’s token in the file name (e.g. <code>USG-07 liver.jpg</code>)</li>
            <li>DICOM patient name, when only one recent patient fits</li>
          </ol>
          <p className="text-muted">Unmatched images still show in the Images tab under “unmatched” for manual attaching.</p>
          {st && (
            <div className="space-y-1 border-t border-line pt-2">
              <div>Last scan: <b>{st.lastScanAt ? timeAgo(st.lastScanAt) : '—'}</b> · imported since start: <b>{st.imported || 0}</b>{st.lastImportAt ? ' · last ' + timeAgo(st.lastImportAt) : ''}</div>
              {st.error && <div className="rounded bg-rose-50 px-2 py-1 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{st.error}</div>}
              <Button size="sm" icon={RefreshCw} loading={busy} disabled={!cfg.enabled} onClick={scan}>Scan now</Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function IntegrityCard({ cloud, canRun, onDone }) {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const at = cloud.integrity && cloud.integrity.at;
  useEffect(() => { api('cloud/verify').then((r) => setReport(r.report)).catch(() => {}); }, [at]);
  const red = cloud.redundancy || { clouds: 0, recommended: 2 };
  const run = async () => {
    setBusy(true);
    try {
      const r = await api('cloud/verify', { method: 'POST', body: { limit: 60 }, timeout: 300000 });
      setReport(r.report);
      const s = r.report.summary;
      toast(`Integrity check: ${s.ok} cloud copies verified${s.mismatch ? ' · ' + s.mismatch + ' damaged' : ''}${s.missing ? ' · ' + s.missing + ' missing' : ''}${s.repaired ? ' · ' + s.repaired + ' re-queued' : ''}`, s.mismatch || s.missing ? 'warning' : 'success', 7000);
      onDone && onDone();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const s = report && report.summary;
  const provs = report ? report.providers || [] : [];
  return (
    <Card title="Integrity & redundancy" icon={ShieldCheck}
      subtitle={'Every upload is checked against the checksum the cloud reports (MD5 · QuickXorHash); damaged or missing copies are re-uploaded automatically. Audit runs daily.'}
      actions={canRun ? <Button size="sm" icon={ShieldCheck} loading={busy} onClick={run}>Verify integrity now</Button> : null}>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <Badge tone={red.clouds >= red.recommended ? 'emerald' : red.clouds ? 'amber' : 'rose'} icon={red.clouds >= red.recommended ? CircleCheck : TriangleAlert}>
          {red.clouds ? 'Copies kept in ' + red.clouds + ' cloud' + (red.clouds > 1 ? 's' : '') : 'No cloud connected'}
        </Badge>
        {red.clouds < red.recommended && <span className="text-muted">Connect {red.recommended - red.clouds > 1 ? 'two clouds' : 'a second cloud'} so one provider’s outage or account problem never loses data.</span>}
        {s && <span className="ml-auto text-muted">Last audit {timeAgo(report.at)} · {report.by}</span>}
      </div>
      {!s ? <p className="mt-3 text-[13px] text-muted">No audit yet. It runs automatically once files have been uploaded, or press “Verify integrity now”.</p> : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[['Files checked', s.files, 'slate'], ['Copies verified', s.ok + (s.unchecked ? ' (+' + s.unchecked + ')' : ''), 'emerald'], ['Damaged', s.mismatch, s.mismatch ? 'rose' : 'slate'], ['Missing', s.missing, s.missing ? 'rose' : 'slate'], ['Re-queued', s.repaired, s.repaired ? 'amber' : 'slate']].map(([l, v, tone]) => (
              <div key={l} className="rounded-xl border border-line px-3 py-2"><div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">{l}</div><div className={'font-display text-lg font-extrabold tnum ' + (tone === 'rose' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-600' : tone === 'emerald' ? 'text-emerald-600' : '')}>{v}</div></div>
            ))}
          </div>
          <div className="mt-2 text-[12px] text-muted">Redundancy: {[3, 2, 1, 0].filter((k) => s.copies && s.copies[k]).map((k) => s.copies[k] + ' file(s) in ' + k + ' cloud' + (k === 1 ? '' : 's')).join(' · ') || '—'}{s.localMissing ? ' · ' + s.localMissing + ' no longer on the clinic PC' : ''}</div>
          {report.rows && report.rows.length > 0 && (
            <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-line">
              <table className="w-full min-w-[640px] text-[12px]">
                <thead className="sticky top-0 bg-surface2"><tr className="text-left text-[10.5px] uppercase tracking-wide text-muted"><th className="px-3 py-1.5">File</th><th className="px-2 text-right">Size</th>{provs.map((p) => <th key={p} className="px-2">{PNAME[p] || p}</th>)}</tr></thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.path} className="border-t border-line/70">
                      <td className="max-w-[320px] truncate px-3 py-1.5 font-mono text-[11px]" title={r.path}>{r.path}{r.changedLocally ? ' · changed since upload' : ''}</td>
                      <td className="px-2 text-right tnum">{fmtBytes(r.size || 0)}</td>
                      {provs.map((p) => { const [tone, label] = CELL(r.providers[p]); return <td key={p} className="px-2"><Badge tone={tone}><span title={r.providers[p] || ''}>{label}</span></Badge></td>; })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function GcpModal({ onClose }) {
  const [json, setJson] = useState('');
  const [bucket, setBucket] = useState('');
  const [projectId, setProjectId] = useState('');
  const [firestore, setFirestore] = useState(true);
  const [busy, setBusy] = useState(false);
  const pick = async () => { const [f] = await pickFiles({ accept: '.json,application/json' }); if (f) { const t = await readAsText(f); setJson(t); try { setProjectId(JSON.parse(t).project_id || ''); } catch (e) { /* shown on save */ } } };
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('cloud/gcp/service-account', { method: 'POST', body: { json, projectId, bucket, firestore } });
      toast('Google Cloud connected as ' + r.account, 'success');
      onClose();
    } catch (e) { toast(e.message, 'error', 8000); } finally { setBusy(false); }
  };
  return (
    <Modal open size="md" onClose={onClose} title="Connect Google Cloud" subtitle="Service account with Firestore & Cloud Storage access" icon={Cloud}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!json.trim()} onClick={save}>Connect</Button></>}>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-[12.5px] text-muted">
        <li>Google Cloud Console → IAM → Service accounts → create one with <b>Cloud Datastore User</b> and <b>Storage Object Admin</b> roles.</li>
        <li>Keys → Add key → JSON, then upload or paste it here. The key is stored only on the clinic server.</li>
        <li>Create a Cloud Storage bucket (e.g. <span className="font-mono">ssdc-phulera-backup</span>) in region asia-south1.</li>
      </ol>
      <div className="space-y-3">
        <Field label="Service account key (JSON)" extra={<Button size="xs" icon={Upload} onClick={pick}>Choose file</Button>}><Textarea rows={5} className="font-mono text-[11px]" value={json} onChange={(e) => setJson(e.target.value)} placeholder='{"type": "service_account", ...}' /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Project ID"><Input value={projectId} onChange={(e) => setProjectId(e.target.value)} /></Field>
          <Field label="Cloud Storage bucket"><Input value={bucket} onChange={(e) => setBucket(e.target.value)} /></Field>
        </div>
        <Toggle checked={firestore} onChange={setFirestore} label="Mirror database records to Firestore" />
      </div>
    </Modal>
  );
}

function LocalBackup() {
  const [busy, setBusy] = useState('');
  const canRestore = can('settings:manage_clinic_and_integrations');
  const exportAll = () => {
    const data = store.exportAll();
    delete data.audit;
    if (data.users) data.users = data.users.map(({ passwordHash, ...u }) => u);
    download('ssdc-backup-' + dateKey() + '.json', JSON.stringify({ app: 'ssdc-suite', kind: 'backup', exportedAt: new Date().toISOString(), data }), 'application/json');
    logAudit('backup:exported', 'all', { collections: Object.keys(data).length });
  };
  const restore = async () => {
    const [f] = await pickFiles({ accept: '.json,application/json' });
    if (!f) return;
    setBusy('restore');
    try {
      const j = JSON.parse(await readAsText(f));
      const data = j.data || j;
      const counts = Object.entries(data).filter(([, v]) => Array.isArray(v)).map(([k, v]) => k + ' ' + v.length).join(', ');
      if (!(await confirmDialog({ title: 'Restore this backup?', message: 'Backup of ' + (j.exportedAt ? fmtDateTime(j.exportedAt) : 'unknown date') + '\n' + counts + '\n\nNewer records already on this system are kept (merge by last edit).', confirmText: 'Restore (merge)' }))) return;
      if (data.users) delete data.users;
      if (data.roles) delete data.roles;
      const n = store.importAll(data, 'merge');
      logAudit('backup:restored', 'all', { records: n });
      toast(n + ' record(s) restored' + (isServer() ? ' and syncing to the server' : ''), 'success');
    } catch (e) { toast('Restore failed: ' + e.message, 'error'); } finally { setBusy(''); }
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <Button size="sm" icon={Download} onClick={exportAll}>Download full backup (JSON)</Button>
      {canRestore && <Button size="sm" icon={Upload} loading={busy === 'restore'} onClick={restore}>Restore from backup…</Button>}
      <span className="text-[11px] text-muted">Patients, visits, bills, reports, Form F, lab, templates, settings — staff passwords are never exported.</span>
    </div>
  );
}
