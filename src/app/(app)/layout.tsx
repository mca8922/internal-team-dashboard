// Layout for every authenticated route. Fetches the current profile plus the
// data the shell needs (pending-leave badge) on the server.
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { Shell } from '@/components/Shell';
import { LiveData } from '@/components/LiveData';
import { IdleLogout } from '@/components/IdleLogout';
import { PresenceProvider } from '@/components/Presence';
import { ToastProvider } from '@/components/Toast';
import { ConfirmProvider } from '@/components/ConfirmDialog';
import { PushManager } from '@/components/PushManager';
import {
  getCurrentProfile,
  getLeaves,
  getNotifications,
  getMutedInAppTypes,
  getDepartmentColors,
  getPendingChangeRequestCount,
  getPendingPunchChangeRequestCount,
  getHolidays,
} from '@/lib/queries';
import { isManager, FOUNDER_USER_IDS } from '@/lib/roles';
import { ensureFounderIntegrity, sweepMissedPunchOuts, sweepGoalDeadlines } from '@/lib/actions';
import { fmtDate } from '@/lib/dates';

// The reminder sweeps don't need to block rendering: their notifications
// stream into the bell live via Realtime, so nothing on the page waits for
// them. They're throttled per server instance (a warm lambda skips them for
// an hour) because they used to run on EVERY authenticated navigation, adding
// several admin-client roundtrips to first byte for every user. The daily
// cron (api/cron/daily) remains the guaranteed overnight run.
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
let lastSweepAt = 0;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Self-heal the Founder account before anything reads the profile, so a
  // tampered email / role / active flag can never lock the owner out. It shares
  // the request-cached getCurrentProfile() fetch with the call below (and is a
  // no-op with no network cost for non-Founders), so this is no longer an extra
  // round-trip on the critical path — it just has to run first.
  await ensureFounderIntegrity();

  if (Date.now() - lastSweepAt > SWEEP_INTERVAL_MS) {
    lastSweepAt = Date.now();
    after(() => Promise.allSettled([sweepMissedPunchOuts(), sweepGoalDeadlines()]));
  }

  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');

  const isBoard = profile.role === 'board';
  const isMgr = isManager(profile);
  const [
    allLeaves,
    notifications,
    mutedInApp,
    deptColors,
    pendingChangeRequests,
    pendingPunchRequests,
    holidays,
  ] = await Promise.all([
    isBoard ? getLeaves() : Promise.resolve([]),
    getNotifications(profile.id),
    getMutedInAppTypes(profile.id),
    getDepartmentColors(),
    // RLS scopes this: board sees all pending requests, a manager sees their own.
    isBoard || isMgr ? getPendingChangeRequestCount() : Promise.resolve(0),
    // Punch change requests are Founder-only.
    (FOUNDER_USER_IDS as readonly string[]).includes(profile.id)
      ? getPendingPunchChangeRequestCount()
      : Promise.resolve(0),
    getHolidays(),
  ]);

  const pendingRequests = pendingChangeRequests + pendingPunchRequests;
  const pendingLeaves = allLeaves.filter((l) => l.status === 'pending').length;
  const deptColor = deptColors[profile.department] ?? null;
  const today = fmtDate(new Date());
  const holidayToday = holidays.find((h) => h.holiday_date === today) ?? null;

  return (
    <ToastProvider>
      <ConfirmProvider>
        <PresenceProvider userId={profile.id}>
          <LiveData />
          <IdleLogout />
          <PushManager />
          <Shell
            user={profile}
            pendingLeaves={pendingLeaves}
            notifications={notifications}
            mutedInApp={mutedInApp}
            deptColor={deptColor}
            deptColors={deptColors}
            pendingRequests={pendingRequests}
            holidayToday={holidayToday}
          >
            {children}
          </Shell>
        </PresenceProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
