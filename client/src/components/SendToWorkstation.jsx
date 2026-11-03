// "Save & Open in Other Workstation": push the patient to the USG console / Lab / Bill desk in real
// time (Socket.io on LAN, BroadcastChannel across windows) + shareable workstation link & QR.
import { useState } from 'react';
import { MonitorSmartphone, Send, Copy, Radio } from 'lucide-react';
import { useNet, sendToWorkstation, getWorkstationName } from '../core/sync';
import { useQr } from '../core/qr';
import { copyText } from '../core/utils';
import { logAudit } from '../core/auth';
import { Modal, Button, Segmented, Textarea, Badge, toast, cx } from './ui';

export function SendToWorkstation({ open, onClose, visit, patientName }) {
  const net = useNet();
  const [dest, setDest] = useState('report');
  const [target, setTarget] = useState('broadcast');
  const [note, setNote] = useState('');
  const route = '/' + dest + '?visit=' + (visit ? visit.id : '');
  const link = location.href.replace(/#.*$/, '') + '#' + route;
  const qr = useQr(open && visit ? link : '', { size: 180 });
  const others = (net.devices || []).filter((d) => !(net.socket && d.socketId === net.socket.id));
  const send = async () => {
    const msg = { route, title: { report: 'USG Reporting', lab: 'Pathology Lab', billing: 'Bill Desk', formf: 'Form F' }[dest], patientName, note };
    if (target === 'broadcast') msg.broadcast = true; else msg.targetDeviceId = target;
    const r = await sendToWorkstation(msg);
    logAudit('workstation:handoff', 'visits/' + (visit && visit.id), { to: target, dest, from: getWorkstationName() });
    toast(r.local ? 'Sent to other open windows on this computer' : r.delivered > 0 ? `Delivered to ${r.delivered} workstation(s)` : 'Sent — workstations will see it as soon as they are online', 'success');
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} size="md" title="Open in other workstation" subtitle={patientName} icon={MonitorSmartphone}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Send} onClick={send} disabled={!visit}>Send now</Button></>}>
      <div className="space-y-4">
        <div>
          <span className="label">Open on</span>
          <Segmented value={dest} onChange={setDest} options={[{ value: 'report', label: 'USG Console' }, { value: 'lab', label: 'Lab Desk' }, { value: 'billing', label: 'Bill Desk' }, { value: 'formf', label: 'Form F' }]} />
        </div>
        <div>
          <span className="label">Send to</span>
          <div className="grid gap-2 sm:grid-cols-2">
            <button onClick={() => setTarget('broadcast')} className={cx('flex items-center gap-2 rounded-xl border p-2.5 text-left text-sm', target === 'broadcast' ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40' : 'border-line')}>
              <Radio className="h-4 w-4 text-brand-600" /><span><b>All workstations</b><span className="block text-[11px] text-muted">Every connected device gets a prompt</span></span>
            </button>
            {others.map((d) => (
              <button key={d.socketId} onClick={() => setTarget(d.deviceId)} className={cx('flex items-center gap-2 rounded-xl border p-2.5 text-left text-sm', target === d.deviceId ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40' : 'border-line')}>
                <MonitorSmartphone className="h-4 w-4 text-brand-600" /><span className="min-w-0"><b className="block truncate">{d.workstation}</b><span className="block truncate text-[11px] text-muted">{d.user && d.user.name} · {d.ip}</span></span>
              </button>
            ))}
          </div>
          {net.mode !== 'server' && <p className="mt-2 text-[11px] text-muted">Standalone mode: hand-off reaches other windows/tabs of this browser. Run the LAN server to reach other computers.</p>}
        </div>
        <div><span className="label">Note for the receiving desk</span><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Full bladder ready, priority patient" /></div>
        <div className="flex items-center gap-3 rounded-xl border border-line p-3">
          {qr && <img src={qr} alt="Workstation link QR" className="h-24 w-24 rounded-lg border border-line bg-white p-1" />}
          <div className="min-w-0 flex-1">
            <div className="label">Shareable workstation link</div>
            <div className="truncate font-mono text-xs">{link}</div>
            <Button size="xs" icon={Copy} className="mt-2" onClick={() => copyText(link).then(() => toast('Link copied', 'success'))}>Copy link</Button>
          </div>
          <Badge tone="brand">{others.length} online</Badge>
        </div>
      </div>
    </Modal>
  );
}
