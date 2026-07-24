// Change-request page. The Board sees an inbox of every manager's pending (and
// past) account-change requests; the Founder additionally sees a "Punch
// requests" tab for member-submitted punch time change requests. A Manager
// sees the account-change requests they raised and their status. RLS scopes
// the rows accordingly.
import { redirect } from 'next/navigation';
import {
  getCurrentProfile,
  getChangeRequests,
  getAssigneeProfiles,
  getPunchChangeRequests,
} from '@/lib/queries';
import { isManager, isFounder } from '@/lib/roles';
import { RequestsView } from './RequestsView';
import { FEATURE_FLAGS } from '@/lib/featureFlags';

export const metadata = { title: 'Change requests · reStrucAI' };

export default async function RequestsPage() {
  if (!FEATURE_FLAGS.teamRequests) redirect('/dashboard');
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');

  const isBoard = profile.role === 'board';
  if (!isBoard && !isManager(profile)) redirect('/dashboard');

  const founder = isFounder(profile);
  const [requests, punchRequests] = await Promise.all([
    getChangeRequests(),
    founder ? getPunchChangeRequests() : Promise.resolve([]),
  ]);

  // Resolve manager + member + punch-requester names (service-role lookup so
  // the board sees every name and a manager can see their own / their
  // members').
  const ids = Array.from(
    new Set([
      ...requests.flatMap((r) => [r.manager_id, r.member_id]),
      ...punchRequests.map((r) => r.user_id),
    ]),
  );
  const people = await getAssigneeProfiles(ids);
  const nameMap: Record<string, string> = {};
  const avatarMap: Record<string, string | null> = {};
  for (const p of people) {
    nameMap[p.id] = p.name;
    avatarMap[p.id] = p.avatar_url;
  }

  return (
    <RequestsView
      requests={requests}
      punchRequests={punchRequests}
      names={nameMap}
      avatars={avatarMap}
      isBoard={isBoard}
      isFounder={founder}
    />
  );
}
