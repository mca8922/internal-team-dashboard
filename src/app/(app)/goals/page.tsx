import { Suspense } from 'react';
// Goals page — mission/vision banner + the yearly→monthly→weekly→daily cascade.
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
import { isManager } from '@/lib/roles';
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
  const isMgr = isManager(profile);
  // A Department Manager manages goals for the department they head: full
  // board-style create/edit/assign UI, but never delete and never the org-wide
  // admin (mission/vision, templates). canManage drives the management UI.
  const canManage = isBoard || isMgr;
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
    isBoard ? getArchivedGoals() : Promise.resolve<Goal[]>([]),
  ]);

  // Board: everything. Manager: every goal in the department they head (so they
  // can manage the whole department). Member: just what's visible to them.
  const myGoals = isMgr
    ? goals.filter((g) => goalInDept(g, managedDept))
    : visibleGoals(goals, assignees, profile);

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
  const myAssignerByGoal: Record<string, string> = {};
  for (const a of assignees) {
    if (a.user_id === profile.id && a.assigned_by && visibleIds.has(a.goal_id)) {
      myAssignerByGoal[a.goal_id] = a.assigned_by;
      peopleToResolve.add(a.assigned_by);
    }
  }
  const reviewerProfiles = await getReviewerProfiles(Array.from(peopleToResolve));
  const reviewerById: Record<string, ReviewerInfo> = {};
  for (const p of reviewerProfiles) reviewerById[p.id] = p;

  // goalId -> who assigned this goal to the current viewer.
  const assignerByGoal: Record<string, AssignerInfo> = {};
  for (const [goalId, assignerId] of Object.entries(myAssignerByGoal)) {
    const p = reviewerById[assignerId];
    if (p) assignerByGoal[goalId] = { name: p.name, avatar_url: p.avatar_url };
  }

  // Form inputs. Board: everyone, every department. Manager: the Board-picked
  // team they lead (manager_id === them) plus themselves — RLS allows assigning
  // exactly this set on goals in the department they head.
  const members: AssignableMember[] = isBoard
    ? profiles.map((p) => ({ id: p.id, name: p.name, department: p.department, avatar_url: p.avatar_url }))
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
  const departments = isBoard
    ? Array.from(new Set(profiles.map((p) => p.department).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b),
      )
    : isMgr && managedDept
      ? [managedDept]
      : [];

  return (
    // Suspense boundary required because GoalsView reads useSearchParams (for the
    // ?goal=<id> notification deep-link).
    <Suspense>
    <GoalsView
      goals={myGoals}
      allGoals={isBoard ? goals : myGoals}
      archivedGoals={archivedGoals}
      mission={company.mission}
      vision={company.vision}
      isBoard={canManage}
      canDelete={isBoard}
      canAdmin={isBoard}
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
