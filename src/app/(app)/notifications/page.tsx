// Full notifications history. The bell dropdown only shows the most recent
// items; this page lists everything for the signed-in member with search and a
// type filter, backed by the same `notifications` table (no new infra).
import { getCurrentProfile, getNotifications, getDepartmentColors } from '@/lib/queries';
import { isManager } from '@/lib/roles';
import { NotificationsHistory } from './NotificationsHistory';

export const metadata = { title: 'Notifications · Mahesh Chandra & Associates' };

export default async function NotificationsPage() {
  const profile = (await getCurrentProfile())!;
  // Pull a generous slice — the weekly pg_cron prune keeps this bounded.
  const [notifications, deptColors] = await Promise.all([
    getNotifications(profile.id, 500),
    getDepartmentColors(),
  ]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Notifications</h1>
          <div className="page-subtitle">Everything that pinged you, newest first</div>
        </div>
      </div>
      <NotificationsHistory
        notifications={notifications}
        isBoard={profile.role === 'board'}
        isManager={isManager(profile)}
        departmentColors={deptColors}
      />
    </div>
  );
}
