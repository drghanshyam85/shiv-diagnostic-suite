// Receives "Save & Open in Other Workstation" hand-offs from Reception / Bill Desk / USG console.
import { useState } from 'react';
import { MonitorSmartphone, ArrowRight } from 'lucide-react';
import { useEvent } from '../core/hooks';
import { fmtTime } from '../core/utils';
import { Modal, Button } from '../components/ui';

export function WorkstationInbox() {
  const [msg, setMsg] = useState(null);
  useEvent('workstation:open', (m) => { if (m && m.route) setMsg(m); });
  if (!msg) return null;
  const open = () => { location.hash = msg.route.replace(/^#/, ''); setMsg(null); };
  return (
    <Modal open size="sm" onClose={() => setMsg(null)} title="Patient sent to this workstation" icon={MonitorSmartphone}
      footer={<><Button onClick={() => setMsg(null)}>Later</Button><Button variant="primary" iconRight={ArrowRight} onClick={open}>Open now</Button></>}>
      <div className="space-y-1.5 text-sm">
        <div className="font-display text-lg font-bold">{msg.patientName || msg.title}</div>
        {msg.title && msg.patientName && <div className="text-muted">{msg.title}</div>}
        {msg.note && <div className="rounded-lg bg-surface2 px-3 py-2">{msg.note}</div>}
        <div className="text-xs text-muted">From {msg.from && msg.from.workstation} {msg.from && msg.from.userName ? '· ' + msg.from.userName : ''} at {fmtTime(msg.at || Date.now())}</div>
      </div>
    </Modal>
  );
}
