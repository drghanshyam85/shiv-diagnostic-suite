import { useEffect } from 'react';
import { useRoute, navigate } from './core/hooks';
import { useAuth, can } from './core/auth';
import { Toaster, DialogHost } from './components/ui';
import { Shell, NAV } from './layout/Shell';
import { Login } from './layout/Login';
import { PatientInvoiceView } from './modules/billing/PatientInvoiceView';
import { Dashboard } from './modules/dashboard/Dashboard';
import { Registration } from './modules/registration/Registration';
import { QueuePage } from './modules/registration/QueuePage';
import { Billing } from './modules/billing/Billing';
import { FormF } from './modules/formf/FormF';
import { ReportWorkstation } from './modules/reporting/ReportWorkstation';
import { MacroStudio } from './modules/macros/MacroStudio';
import { Dictionary } from './modules/dictionary/Dictionary';
import { LabModule } from './modules/lab/LabModule';
import { TariffDirectory } from './modules/tariff/TariffDirectory';
import { CashBook } from './modules/cashbook/CashBook';
import { Accounts } from './modules/accounts/Accounts';
import { DispatchCenter } from './modules/dispatch/DispatchCenter';
import { CloudSync } from './modules/cloud/CloudSync';
import { AdminConsole } from './modules/admin/AdminConsole';
import { Settings } from './modules/settings/Settings';

const PAGES = {
  dashboard: Dashboard, register: Registration, queue: QueuePage, billing: Billing, formf: FormF, report: ReportWorkstation,
  macros: MacroStudio, dictionary: Dictionary, lab: LabModule, tariff: TariffDirectory, cashbook: CashBook, accounts: Accounts,
  dispatch: DispatchCenter, cloud: CloudSync, admin: AdminConsole, settings: Settings
};

function Forbidden({ item }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
      <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-2xl text-rose-600">⛔</div>
      <h2 className="font-display text-lg font-bold">Access restricted</h2>
      <p className="mt-1 text-sm text-muted">Your role does not include <b>{item ? item.label : 'this module'}</b>. Ask the Super Admin to grant it in Admin Console → Permission Matrix.</p>
    </div>
  );
}

export function App({ info }) {
  const route = useRoute();
  const auth = useAuth();
  const section = route.parts[0] || 'dashboard';

  useEffect(() => { document.title = 'Shiv Sonography & Diagnostic Center – Clinic Suite'; }, []);

  if (section === 'v' || section === 'p' || (info && info.publicView)) {
    return <><PatientInvoiceView route={route} /><Toaster /></>;
  }
  if (!auth.principal) return <><Login /><Toaster /><DialogHost /></>;

  const item = NAV.find((n) => n.id === section);
  const Page = PAGES[section] || Dashboard;
  if (!PAGES[section] && section !== 'dashboard') setTimeout(() => navigate('/dashboard'), 0);
  const allowed = !item || !item.perm || item.perm.some(([k, l]) => can(k, l));
  return (
    <>
      <Shell route={route} active={section}>
        {allowed ? <Page route={route} /> : <Forbidden item={item} />}
      </Shell>
      <Toaster />
      <DialogHost />
    </>
  );
}
