// Department Apps, the Launchpad. Each department's dedicated, independently
// deployed tools are registered here; members see their own department's apps
// (plus company-wide ones), the Board curates the whole list. Server Component:
// RLS already scopes getDepartmentApps to the viewer, so non-board users simply
// get back only what they're allowed to open.
import { redirect } from 'next/navigation';
import {
  getCurrentProfile,
  getDepartmentApps,
  getAllDepartmentApps,
  getDepartmentColors,
} from '@/lib/queries';
import { AppsView } from './AppsView';
import { getAppAnalytics } from './app-analytics';
import type { AppAnalyticsResult } from './app-analytics';
import { FEATURE_FLAGS } from '@/lib/featureFlags';

export const metadata = { title: 'Apps · Mahesh Chandra & Associates' };

export default async function AppsPage() {
  if (!FEATURE_FLAGS.apps) redirect('/dashboard');
  const profile = (await getCurrentProfile())!;
  const isBoard = profile.role === 'board';

  const [apps, deptColors, allApps, initialAnalytics] = await Promise.all([
    getDepartmentApps(),
    getDepartmentColors(),
    isBoard ? getAllDepartmentApps() : Promise.resolve([]),
    isBoard
      ? getAppAnalytics(30).catch((): AppAnalyticsResult => ({
          stats: [], totalClicks: 0, uniqueUsers: 0, mostOpened: null,
        }))
      : Promise.resolve(undefined),
  ]);

  // Department options for the Board's add/edit form: every known department
  // plus the viewer's own (in case it isn't colour-mapped yet).
  const departments = Array.from(
    new Set([...Object.keys(deptColors), profile.department].filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b)) as string[];

  return (
    <AppsView
      apps={apps}
      isBoard={isBoard}
      myDepartment={profile.department}
      deptColors={deptColors}
      allApps={allApps}
      departments={departments}
      initialAnalytics={initialAnalytics ?? undefined}
    />
  );
}
