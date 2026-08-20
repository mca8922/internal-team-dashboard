// Log history - calendar view of every working day.
import { redirect } from 'next/navigation';
import { getCurrentProfile, getLogs, getLeaves, getHolidays, logStreak, logHasContent } from '@/lib/queries';
import { LogCalendar } from './LogCalendar';
import { FEATURE_FLAGS } from '@/lib/featureFlags';

export const metadata = { title: 'Log history · Mahesh Chandra & Associates' };

export default async function LogHistoryPage() {
  if (!FEATURE_FLAGS.dailyLog) redirect('/dashboard');
  const profile = (await getCurrentProfile())!;
  const [logs, leaves, holidays] = await Promise.all([
    getLogs(profile.id),
    getLeaves(profile.id),
    getHolidays(),
  ]);

  const loggedDates = logs
    .filter((l) => logHasContent(l.blocks))
    .map((l) => ({ date: l.log_date, mood: l.mood, tags: l.tags || [] }));
  const energyVals = logs.filter((l) => l.energy_level).map((l) => l.energy_level);
  const avgEnergy = energyVals.length
    ? (energyVals.reduce((a, b) => a + b, 0) / energyVals.length).toFixed(1)
    : '-';

  return (
    <LogCalendar
      loggedDates={loggedDates}
      holidays={holidays.map((h) => h.holiday_date)}
      approvedLeaves={leaves
        .filter((l) => l.status === 'approved')
        .map((l) => ({ start: l.start_date, end: l.end_date }))}
      streak={logStreak(logs)}
      avgEnergy={avgEnergy}
    />
  );
}
