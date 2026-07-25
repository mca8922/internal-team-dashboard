// Punch page — Server Component fetches today's sessions + 14-day heatmap
// data, plus the current/previous-month window used by punch change requests.
import {
  getCurrentProfile,
  getPunches,
  punchTotalMsForDate,
  punchStatus,
  activeOpenSession,
  getMyPunchChangeRequests,
} from '@/lib/queries';
import { fmtDate, addDays, addMonths, parseDate } from '@/lib/dates';
import { targetHours } from '@/lib/roles';
import { PunchConsole } from './PunchConsole';
import { PunchRequestsCard } from './PunchRequestsCard';
import { FEATURE_FLAGS } from '@/lib/featureFlags';

export const metadata = { title: 'Punch · Mahesh Chandra & Associates' };

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export default async function PunchPage() {
  const profile = (await getCurrentProfile())!;
  const today = fmtDate(new Date());
  const windowStart = fmtDate(firstOfMonth(addMonths(new Date(), -1)));
  const fromDate = fmtDate(addDays(new Date(), -14));

  const [windowPunches, myRequests] = await Promise.all([
    getPunches(profile.id, windowStart),
    FEATURE_FLAGS.punchRequests ? getMyPunchChangeRequests(profile.id) : Promise.resolve([]),
  ]);
  // The last-14-days heatmap is a subset of the window fetch above — no
  // second query needed.
  const punches = windowPunches.filter((p) => p.work_date >= fromDate);

  const active = activeOpenSession(windowPunches);
  const todayRows = windowPunches.filter((p) => p.work_date === today);
  const sessionRows =
    active && active.work_date !== today ? [active, ...todayRows] : todayRows;
  const todaySessions = sessionRows.map((p) => ({ punch_in: p.punch_in, punch_out: p.punch_out }));

  const heat: { ds: string; hours: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(new Date(), -i);
    const ds = fmtDate(d);
    const ms = punchTotalMsForDate(punches, ds);
    heat.push({ ds, hours: ms / (60 * 60 * 1000) });
  }

  // Days in the request-eligible window (current + previous calendar month),
  // newest first, each carrying its worked hours and whether a request is
  // already pending for that date.
  const pendingDates = new Set(
    myRequests.filter((r) => r.status === 'pending').map((r) => r.work_date),
  );
  const days: { date: string; hours: number; hasPendingRequest: boolean }[] = [];
  for (let d = parseDate(today); fmtDate(d) >= windowStart; d = addDays(d, -1)) {
    const ds = fmtDate(d);
    days.push({
      date: ds,
      hours: punchTotalMsForDate(windowPunches, ds) / (60 * 60 * 1000),
      hasPendingRequest: pendingDates.has(ds),
    });
  }

  return (
    <>
      <PunchConsole
        todaySessions={todaySessions}
        status={active ? 'in' : punchStatus(todayRows)}
        expectedHrs={targetHours(profile)}
        heat={heat}
      />
      {FEATURE_FLAGS.punchRequests ? (
        <PunchRequestsCard days={days} today={today} myRequests={myRequests} />
      ) : null}
    </>
  );
}
