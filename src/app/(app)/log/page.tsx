// Daily Log page — the Notion-style editor. The ?date= query param lets the
// missing-log banner deep-link to a specific backlog day.
import { redirect } from 'next/navigation';
import { getCurrentProfile, getLog, getLeaves, getHolidays, getUserTagStats } from '@/lib/queries';
import { fmtDate, isWeekend } from '@/lib/dates';
import { LogEditor } from './LogEditor';
import { FEATURE_FLAGS } from '@/lib/featureFlags';

export const metadata = { title: 'Daily Log · Mahesh Chandra & Associates' };

export default async function LogPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  if (!FEATURE_FLAGS.dailyLog) redirect('/dashboard');
  const profile = (await getCurrentProfile())!;
  const { date: dateParam } = await searchParams;
  const date = dateParam || fmtDate(new Date());

  const [log, leaves, holidays, tagStats] = await Promise.all([
    getLog(profile.id, date),
    getLeaves(profile.id),
    getHolidays(),
    getUserTagStats(profile.id),
  ]);

  const onLeave = leaves.some(
    (l) => l.status === 'approved' && date >= l.start_date && date <= l.end_date,
  );
  const holiday = holidays.some((h) => h.holiday_date === date);

  return (
    <LogEditor
      // Re-mount the editor whenever the day changes so its local state is
      // always seeded fresh from that day's log (never carried over).
      key={date}
      date={date}
      initialLog={
        log
          ? {
              mood: log.mood,
              energyLevel: log.energy_level,
              tags: log.tags,
              blocks: log.blocks,
              savedAt: log.saved_at,
            }
          : { mood: '', energyLevel: 0, tags: [], blocks: [], savedAt: null }
      }
      isLeave={onLeave}
      isHoliday={holiday}
      isWeekendDay={isWeekend(date)}
      pastTags={tagStats.map((t) => t.tag)}
      tagStats={tagStats}
    />
  );
}
