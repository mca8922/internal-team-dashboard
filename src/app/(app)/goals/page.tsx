import { Suspense } from 'react';
// Goals page — mission/vision banner + the
// yearly→half-yearly→quarterly→monthly→daily cascade.
// Non-board members see only goals assigned to them or tagged to their
// department; the Board sees everything and can add/edit goals inline.
import {
  getCurrentProfile,
  getGoals,
  getArchivedGoals,
  getCompany,
  getGoalAssignees,
  getGoalChecklists,
  getGoalCompletions,
  getWorkReports,
  getWorkReportReviews,
  getReportTemplates,
  getGoalTemplates,
  getAllProfiles,
  getAssigneeProfiles,
  getReviewerProfiles,
  getOnLeaveUserIdsToday,
  getGoalPins,
  getSavedViews,
  visibleGoals,
} from '@/lib/queries';
import { GoalsView, type AssigneeChip, type AssignerInfo } from './GoalsView';
import { goalInDept } from './goal-ui';
import type { ReviewerInfo } from '@/components/WorkReportReview';
import type { AssignableMember } from './GoalForm';
import { isManager, departmentsOf, isFounder, belongsToDepartment } from '@/lib/roles';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import type {
  Goal,
  GoalChecklistItem,
  GoalChecklistCompletion,
  WorkReport,
  WorkReportReview,
} from '@/lib/types';

export const metadata = { title: 'Tasks · Mahesh Chandra & Associates' };

export default async function GoalsPage() {
  const profile = (await getCurrentProfile())!;
  const isBoard = profile.role === 'board';
  // Only a FOUNDER sees the whole company. A Director is board-level but scoped
  // to the departments they are listed under (see visibleGoals) — so every
  // "board sees everything" branch below has to key off this, not off isBoard,
  // or the page would hand a Director org-wide data through the back door even
  // though the cascade itself is filtered.
  const isFounderViewer = isFounder(profile);
  const myDepartments = departmentsOf(profile);
  const isMgr = isManager(profile);
  // A Department Manager manages goals for the department they head: full
  // board-style create/edit/assign UI, but never delete and never the org-wide
  // admin (mission/vision, templates). canManage drives the management UI.
  const canManage = isBoard || isMgr;
  // Everyone else is an "Executive" (migration 0064): they create tasks too,
  // but only ever for themselves, and they manage only the ones they created.
  // The scope lives in the props below — a members list of exactly one and
  // their own departments — so the same GoalForm serves all three tiers.
  const isExec = !canManage && FEATURE_FLAGS.executiveTasks;
  const managedDept = profile.managed_department ?? '';
  const [
    goals,
    company,
    assignees,
    checklists,
    completions,
    reports,
    reviews,
    reportTemplateRows,
    goalTemplates,
    profiles,
    onLeaveUserIds,
    pinnedGoalIds,
    savedViews,
    archivedGoals,
  ] = await Promise.all([
    getGoals(),
    getCompany(),
    getGoalAssignees(),
    getGoalChecklists(),
    getGoalCompletions(),
    getWorkReports(),
    getWorkReportReviews(),
    getReportTemplates(),
    getGoalTemplates(),
    getAllProfiles(),
    getOnLeaveUserIdsToday(),
    getGoalPins(profile.id),
    getSavedViews(profile.id),
    // Archived goals power the Board-only cleanup "Archived" tab (restore /
    // permanent delete). Members never see it, so skip the query for them.
    // A Director's copy is narrowed to their own departments below.
    isBoard ? getArchivedGoals() : Promise.resolve<Goal[]>([]),
  ]);

  // Founder: everything. Director: their departments (visibleGoals). Manager:
  // every goal in the department they head (so they can manage the whole
  // department). Member: just what's visible to them.
  const myGoals = isMgr
    ? goals.filter((g) => goalInDept(g, managedDept))
    : visibleGoals(goals, assignees, profile);
  // The cleanup tab restores and permanently deletes; a Director must not be
  // able to reach another department's archived task there any more than they
  // can reach its live one.
  const myArchivedGoals = isFounderViewer
    ? archivedGoals
    : archivedGoals.filter((g) => myDepartments.some((d) => goalInDept(g, d)));

  // goalId -> [checklist item, ...]
  const checklistsByGoal: Record<string, GoalChecklistItem[]> = {};
  for (const c of checklists) {
    (checklistsByGoal[c.goal_id] = checklistsByGoal[c.goal_id] || []).push(c);
  }

  // itemId -> [completion, ...] so a card can resolve each member's ticks.
  const completionsByItem: Record<string, GoalChecklistCompletion[]> = {};
  for (const c of completions) {
    (completionsByItem[c.item_id] = completionsByItem[c.item_id] || []).push(c);
  }

  // itemId -> [work report, ...] (Report Work items) and department -> template.
  const reportsByItem: Record<string, WorkReport[]> = {};
  for (const r of reports) {
    (reportsByItem[r.item_id] = reportsByItem[r.item_id] || []).push(r);
  }
  const reportTemplates: Record<string, string> = {};
  for (const t of reportTemplateRows) reportTemplates[t.department] = t.body;

  // goalId -> [userId, ...] for the visible goals, plus the names to label them.
  // Names come from a service-role lookup so a member can see WHO ELSE shares a
  // goal even though profiles RLS would otherwise hide other members' rows.
  const assigneeIdsByGoal: Record<string, string[]> = {};
  const visibleIds = new Set(myGoals.map((g) => g.id));
  // Archived goals aren't in myGoals, but the cleanup export needs their
  // assignee names too — resolve those profiles alongside the visible ones.
  const archivedIds = new Set(archivedGoals.map((g) => g.id));
  const neededAssigneeIds: string[] = [];
  for (const a of assignees) {
    (assigneeIdsByGoal[a.goal_id] = assigneeIdsByGoal[a.goal_id] || []).push(a.user_id);
    if (visibleIds.has(a.goal_id) || archivedIds.has(a.goal_id)) neededAssigneeIds.push(a.user_id);
  }
  const assigneeProfiles = await getAssigneeProfiles(neededAssigneeIds);
  const profileById = new Map(assigneeProfiles.map((p) => [p.id, p]));

  // goalId -> [assignee chip, ...]
  const assigneesByGoal: Record<string, AssigneeChip[]> = {};
  for (const a of assignees) {
    const p = profileById.get(a.user_id);
    if (!p) continue;
    (assigneesByGoal[a.goal_id] = assigneesByGoal[a.goal_id] || []).push({
      id: p.id,
      name: p.name,
      avatar_url: p.avatar_url,
    });
  }

  // reportId -> [review, ...] (Manager/Board ratings + comments on each report).
  const reviewsByReport: Record<string, WorkReportReview[]> = {};
  for (const r of reviews) {
    (reviewsByReport[r.report_id] = reviewsByReport[r.report_id] || []).push(r);
  }

  // Who to resolve names/roles for: every reviewer (to label their comment) plus
  // whoever assigned the CURRENT viewer their visible goals (for the "Assigned
  // by" badge). One service-role lookup covers both.
  const peopleToResolve = new Set<string>(reviews.map((r) => r.reviewer_id));
  // Whoever wrote or last edited a visible task — the card's "Added by" /
  // "Edited by" line needs their name and avatar. Archived goals are in here
  // too so the cleanup export can attribute them as well.
  for (const g of [...myGoals, ...archivedGoals]) {
    if (g.created_by) peopleToResolve.add(g.created_by);
    if (g.updated_by) peopleToResolve.add(g.updated_by);
  }
  // Who assigned each VISIBLE task — resolved for every task on screen, not just
  // the ones pointed at the viewer. That's the transparency rule: Rajesh looking
  // at Rohit's task should read "Assigned by Dharmesh" the same way Rohit does.
  //
  // assigned_by is per assignee row, so in principle a task could carry two
  // different assigners. In practice it cannot: setGoalAssignees rewrites every
  // row with one editor's id (delete-all + insert-all), and all 259 rows in the
  // database today agree per task. The viewer's own row still wins where one
  // exists, so a genuinely mixed task shows them the person who assigned THEM.
  const assignerIdByGoal: Record<string, string> = {};
  // A task is self-assigned when every row on it names its own holder as the
  // assigner — an executive's own task. A Director who assigns a team including
  // themselves fails this (the other rows name the Director), which is right:
  // that task WAS handed out.
  const selfAssignedGoals = new Set<string>();
  const allSelf: Record<string, boolean> = {};
  for (const a of assignees) {
    if (!visibleIds.has(a.goal_id) || !a.assigned_by) continue;
    const isSelf = a.assigned_by === a.user_id;
    allSelf[a.goal_id] = (allSelf[a.goal_id] ?? true) && isSelf;
    // First row seeds it; the viewer's own row overrides.
    if (!assignerIdByGoal[a.goal_id] || a.user_id === profile.id) {
      assignerIdByGoal[a.goal_id] = a.assigned_by;
    }
    peopleToResolve.add(a.assigned_by);
  }
  for (const [goalId, isSelf] of Object.entries(allSelf)) {
    if (isSelf) selfAssignedGoals.add(goalId);
  }
  const reviewerProfiles = await getReviewerProfiles(Array.from(peopleToResolve));
  const reviewerById: Record<string, ReviewerInfo> = {};
  for (const p of reviewerProfiles) reviewerById[p.id] = p;

  // goalId -> who assigned it, for every visible task.
  const assignerByGoal: Record<string, AssignerInfo> = {};
  for (const [goalId, assignerId] of Object.entries(assignerIdByGoal)) {
    const p = reviewerById[assignerId];
    if (p) {
      assignerByGoal[goalId] = {
        id: p.id,
        name: p.name,
        avatar_url: p.avatar_url,
        selfAssigned: selfAssignedGoals.has(goalId),
      };
    }
  }

  // Form inputs. Board: everyone, every department. Manager: the Board-picked
  // team they lead (manager_id === them) plus themselves — RLS allows assigning
  // exactly this set on goals in the department they head.
  const members: AssignableMember[] = isFounderViewer
    ? profiles.map((p) => ({ id: p.id, name: p.name, department: p.department, avatar_url: p.avatar_url }))
    : isBoard
      ? // A Director assigns within the departments they hold. Without this they
        // could hand a task to another department's member and then never see
        // it again, since the cascade only shows them their own departments.
        profiles
          .filter((p) => myDepartments.some((d) => belongsToDepartment(p, d)))
          .map((p) => ({ id: p.id, name: p.name, department: p.department, avatar_url: p.avatar_url }))
    : isExec
      ? // An executive assigns to exactly one person: themselves. GoalForm gets
        // this same entry as `selfAssignee` and renders a locked row instead of
        // a picker, so the single choice is stated rather than merely implied.
        [
          {
            id: profile.id,
            name: profile.name,
            department: profile.department,
            avatar_url: profile.avatar_url,
          },
        ]
    : isMgr
      ? [
          ...profiles
            .filter((p) => p.manager_id === profile.id)
            .map((p) => ({ id: p.id, name: p.name, department: p.department, avatar_url: p.avatar_url })),
          // The manager themselves, pinned to the department they head so they
          // surface on those goals' assignee picker.
          { id: profile.id, name: profile.name, department: managedDept, avatar_url: profile.avatar_url },
        ]
      : [];
  const departments = isFounderViewer
    ? Array.from(new Set(profiles.map((p) => p.department).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b),
      )
    : isBoard
      ? // Same reason as `members` above: the department picker must not offer a
        // Director somewhere their own cascade would then hide the result.
        [...myDepartments].sort((a, b) => a.localeCompare(b))
    : isMgr && managedDept
      ? [managedDept]
      : // An executive files their task under a department they actually belong
        // to — primary or additional (0060). The "goals: board insert" policy
        // checks the same list server-side.
        departmentsOf(profile);

  return (
    // Suspense boundary required because GoalsView reads useSearchParams (for the
    // ?goal=<id> notification deep-link).
    <Suspense>
    <GoalsView
      goals={myGoals}
      allGoals={isFounderViewer ? goals : myGoals}
      archivedGoals={myArchivedGoals}
      mission={company.mission}
      vision={company.vision}
      isBoard={canManage}
      canDelete={isBoard}
      canAdmin={isBoard}
      selfManage={isExec}
      viewerRole={profile.role}
      tenureMonths={profile.internship_months}
      currentUserId={profile.id}
      checklistsByGoal={checklistsByGoal}
      completionsByItem={completionsByItem}
      assigneesByGoal={assigneesByGoal}
      assigneeIdsByGoal={assigneeIdsByGoal}
      reportsByItem={reportsByItem}
      reviewsByReport={reviewsByReport}
      reviewerById={reviewerById}
      assignerByGoal={assignerByGoal}
      reportTemplates={reportTemplates}
      goalTemplates={goalTemplates}
      onLeaveUserIds={onLeaveUserIds}
      members={members}
      departments={departments}
      pinnedGoalIds={pinnedGoalIds}
      savedViews={savedViews}
    />
    </Suspense>
  );
}
