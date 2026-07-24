import { redirect } from 'next/navigation';
import {
  getCurrentProfile,
  getTransactionalSettings,
  getTransactionalMembers,
  getTransactionalEmailLogs,
} from '@/lib/queries';
import { isManager } from '@/lib/roles';
import { EmailAdmin } from './EmailAdmin';
import { ManagerEmailView } from './ManagerEmailView';
import { FEATURE_FLAGS } from '@/lib/featureFlags';

export const metadata = { title: 'Emails · reStrucAI' };

export default async function EmailPage() {
  if (!FEATURE_FLAGS.emails) redirect('/dashboard');
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'board') {
    if (isManager(profile)) return <ManagerEmailPage department={profile.managed_department ?? ''} />;
    redirect('/dashboard');
  }

  const [settings, members, logs] = await Promise.all([
    getTransactionalSettings(),
    getTransactionalMembers(),
    getTransactionalEmailLogs(100),
  ]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Emails</h1>
          <div className="page-subtitle">
            Transactional email controls and send log (leave, goals, missed punches)
          </div>
        </div>
      </div>
      <EmailAdmin settings={settings} members={members} logs={logs} />
    </div>
  );
}

// Department Manager's read-only email view — only the communication emails
// sent to members of the department they head (RLS enforces the scope). No
// settings or controls.
async function ManagerEmailPage({ department }: { department: string }) {
  const txnLogs = await getTransactionalEmailLogs(100);
  return <ManagerEmailView department={department} txnLogs={txnLogs} />;
}
