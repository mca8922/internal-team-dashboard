// Leaves page — balance widgets, request flow, board approvals, holidays.
import { Suspense } from 'react';
import {
  getCurrentProfile,
  getLeaves,
  getHolidays,
  getAllProfiles,
  leaveUsage,
} from '@/lib/queries';
import { isFounder } from '@/lib/roles';
import { LeavesView } from './LeavesView';

export const metadata = { title: 'Leaves · Mahesh Chandra & Associates' };

export default async function LeavesPage() {
  const profile = (await getCurrentProfile())!;
  const isBoard = profile.role === 'board';

  const [myLeaves, allLeaves, holidays, profiles] = await Promise.all([
    getLeaves(profile.id),
    isBoard ? getLeaves() : Promise.resolve([]),
    getHolidays(),
    isBoard ? getAllProfiles() : Promise.resolve([]),
  ]);

  const nameById = new Map(profiles.map((p) => [p.id, p.name]));
  const avatarById = new Map(profiles.map((p) => [p.id, p.avatar_url]));
  // Balances are derived per quarter from the member's own approved leaves.
  const usage = leaveUsage(myLeaves);

  return (
    // Suspense boundary required because LeavesView reads useSearchParams (for
    // the ?leave=<id> notification deep-link).
    <Suspense>
    <LeavesView
      isBoard={isBoard}
      isFounder={isFounder(profile)}
      usage={usage}
      myLeaves={myLeaves}
      allLeaves={allLeaves.map((l) => ({
        ...l,
        userName: nameById.get(l.user_id) ?? 'Unknown',
        userAvatarUrl: avatarById.get(l.user_id) ?? null,
        preApproverName: l.pre_approved_by
          ? (nameById.get(l.pre_approved_by) ?? 'A Board Member')
          : null,
      }))}
      holidays={holidays}
    />
    </Suspense>
  );
}
