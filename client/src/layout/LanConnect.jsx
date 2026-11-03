// LAN Connect modal: live local URLs + scannable QR codes, connected workstations, workstation name.
import { useEffect, useState } from 'react';
import { Network, Monitor, Smartphone, Copy, RefreshCw, Server } from 'lucide-react';
import { api, useNet, getWorkstationName, setWorkstationName } from '../core/sync';
import { useQr } from '../core/qr';
import { copyText, timeAgo } from '../core/utils';
import { Modal, Button, Input, Badge, Empty, toast } from '../components/ui';

function UrlQr({ url, label }) {
  const qr = useQr(url, { size: 220 });
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line p-3">
      {qr ? <img src={qr} alt={'QR ' + url} className="h-28 w-28 rounded-lg border border-line bg-white p-1" /> : <div className="h-28 w-28 rounded-lg bg-surface2" />}
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
        <div className="truncate font-mono text-[15px] font-bold text-brand-700 dark:text-brand-300">{url}</div>
        <div className="mt-2 flex gap-2">
          <Button size="xs" icon={Copy} onClick={() => copyText(url).then(() => toast('Copied', 'success'))}>Copy</Button>
          <Button size="xs" onClick={() => window.open(url, '_blank')}>Open</Button>
        </div>
      </div>
    </div>
  );
}

const PRESETS = ['Reception PC', 'Bill Desk', 'USG Console Room', 'Doctor Reporting PC', 'Pathology Lab PC', 'X-Ray Room', 'Doctor Tablet', 'Manager Phone'];

export function LanConnect({ open, onClose }) {
  const net = useNet();
  const [info, setInfo] = useState(null);
  const [name, setName] = useState(getWorkstationName());
  const [err, setErr] = useState('');
  const load = () => {
    if (net.mode !== 'server') return;
    api('lan/info').then(setInfo).catch((e) => setErr(e.message));
  };
  useEffect(() => { if (open) { load(); setName(getWorkstationName()); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const here = location.origin + location.pathname;
  return (
    <Modal open={open} onClose={onClose} size="lg" title="LAN Connect — Multi-Workstation" subtitle="Reception · USG Console · Pathology Lab · Doctor phones & tablets on the clinic Wi-Fi" icon={Network}
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="mb-4 rounded-xl border border-line bg-surface2/60 p-3">
        <span className="label">This workstation's name</span>
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. USG Console Room" />
          <Button variant="primary" onClick={() => { setWorkstationName(name.trim() || 'Workstation'); toast('Workstation name saved', 'success'); }}>Save</Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">{PRESETS.map((p) => <button key={p} className="chip" onClick={() => setName(p)}>{p}</button>)}</div>
      </div>
      {net.mode !== 'server' ? (
        <div className="space-y-3 text-sm">
          <Empty icon={Server} title="Running in standalone mode" text="Data lives only in this browser. Start the LAN server to connect Reception, USG console, Lab and doctor devices in real time." />
          <div className="rounded-xl bg-navy-950 p-4 font-mono text-[12.5px] leading-6 text-emerald-300">
            <div># on the main clinic PC (Node.js 22+)</div><div>cd shiv-diagnostic-suite</div><div>npm install</div><div>npm start</div>
            <div className="text-slate-400"># then open http://&lt;PC-IP&gt;:3000 on every device on the same Wi-Fi / LAN</div>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between"><h4 className="text-[11px] font-bold uppercase tracking-wider text-muted">Scan to connect</h4><Button size="xs" icon={RefreshCw} onClick={load}>Refresh</Button></div>
            {err && <div className="text-xs text-rose-600">{err}</div>}
            {info && info.stableUrl && <UrlQr url={info.stableUrl} label="Stable name · works after IP changes" />}
            {(info ? info.addresses.filter((a) => !a.virtual) : []).sort((x, y) => Number(y.url === info.preferredUrl) - Number(x.url === info.preferredUrl)).map((a) => <UrlQr key={a.address} url={a.url} label={(a.url === info.preferredUrl ? 'Preferred · ' : 'LAN · ') + a.iface} />)}
            {info && !info.addresses.filter((a) => !a.virtual).length && <UrlQr url={here} label="This address" />}
            {info && <p className="text-[11px] text-muted">Server: {info.hostname} · {info.platform} · port {info.port} · DB {info.db}. Allow port {info.port} in Windows Firewall if other devices cannot connect.</p>}
          </div>
          <div>
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">Connected workstations ({(net.devices || []).length})</h4>
            <div className="space-y-2">
              {(net.devices || []).map((d) => (
                <div key={d.socketId} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                  {/Mobile|Android|iPhone|iPad/i.test(d.ua) ? <Smartphone className="h-5 w-5 text-brand-600" /> : <Monitor className="h-5 w-5 text-brand-600" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{d.workstation} {net.socket && d.socketId === net.socket.id && <Badge tone="emerald">this device</Badge>}</div>
                    <div className="truncate text-[11px] text-muted">{d.user && d.user.name} · {d.ip} · {d.route || '#/'} · {timeAgo(d.connectedAt)}</div>
                  </div>
                </div>
              ))}
              {!(net.devices || []).length && <Empty title="No devices" text="Devices appear here as soon as they open the app." />}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
