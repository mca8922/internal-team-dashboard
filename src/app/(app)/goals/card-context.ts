// Shared data bag + types threaded down the Goals cascade (card → node → tree).
//
// Pulled out of GoalsView so the card cluster (GoalCard.tsx) and the
// department-grouped results list (BoardGoalsResults.tsx) can share the exact
// same CardCtx shape without an import cycle back through GoalsView.
import type { ReviewerInfo } from '@/components/WorkReportReview';
import type { AssignableMember } from './GoalForm';
import type {
  Goal,
  GoalStatus,
  GoalChecklistItem,
  GoalChecklistCompletion,
  WorkReport,
  WorkReportReview,
} from '@/lib/types';

// A member assigned to a goal — just what a card chip needs to render.
export interface AssigneeChip {
  id: string;
  name: string;
  avatar_url: string | null;
}

// Who assigned a goal — drives the "Assigned by" badge, which is shown on
// EVERY visible task to every viewer, not only on the ones pointed at them.
export interface AssignerInfo {
  id: string;
  name: string;
  avatar_url: string | null;
  // The task's holders assigned it to themselves — an executive's own task.
  // Reads "Self-assigned" instead of naming the person twice.
  selfAssigned: boolean;
}

// One assignee's own progress on a card — a chip plus their due/done counts.
export interface PP extends AssigneeChip {
  done: number;
  total: number;
  onLeave: boolean;
}

// Shared bag of data every card/node needs, threaded down the tree.
export interface CardCtx {
  checklistsByGoal: Record<string, GoalChecklistItem[]>;
  completionsByItem: Record<string, GoalChecklistCompletion[]>;
  assigneesByGoal: Record<string, AssigneeChip[]>;
  assigneeIdsByGoal: Record<string, string[]>;
  // itemId -> [work report, ...] (all members' reports for that checklist item).
  reportsByItem: Record<string, WorkReport[]>;
  // reportId -> [review, ...] (Manager/Board ratings + comments on each report).
  reviewsByReport: Record<string, WorkReportReview[]>;
  // reviewerId -> identity (name/avatar/role) to label each review.
  reviewerById: Record<string, ReviewerInfo>;
  // goalId -> who assigned this goal to the CURRENT viewer (if anyone).
  assignerByGoal: Record<string, AssignerInfo>;
  // department -> reporting template (HTML) shown to members when reporting.
  reportTemplates: Record<string, string>;
  currentUserId: string;
  // isBoard here means "can manage goals" — true for the Board AND for a
  // Department Manager over their own department. canDelete / canAdmin stay
  // Board-only (delete a goal; edit mission/vision, report templates).
  isBoard: boolean;
  canDelete: boolean;
  canAdmin: boolean;
  // Task templates (the shared blueprint library) are open to every member:
  // anyone may save a task as a template and spin a task up from one. Deleting
  // a template is still limited to its creator or the Board (see actions.ts).
  canUseTemplates: boolean;
  // The viewer is an Executive (migration 0064): they manage no one else's
  // tasks, but they fully manage the ones they created — see canManageCard.
  selfManage: boolean;
  members: AssignableMember[];
  // User IDs on approved leave today — excluded from "due" progress and badged.
  onLeave: Set<string>;
  onEdit: (g: Goal) => void;
  onDuplicate: (g: Goal) => void;
  onDelete: (g: Goal) => void;
  onSetStatus: (g: Goal, status: GoalStatus) => void;
  onReassign: (g: Goal, userIds: string[]) => void;
  onSaveTemplate: (g: Goal) => void;
  // Active search term — when set, matching text in a goal title is highlighted.
  highlight?: string;
  // Per-user pinned goal ids + a toggle, so a card can show/flip its ★.
  pinnedIds: Set<string>;
  onTogglePin: (g: Goal) => void;
  // Goal id to briefly highlight after a jump, plus why (drives the pill text).
  flashId: string | null;
  flashReason: 'notif' | 'report';
  // Request to open a specific checklist item's report editor (from "Your day").
  reportReq: { itemId: string; n: number } | null;
}

// May the viewer open the edit form on THIS card? The Board and Managers
// manage every task in their scope; an Executive manages the ones they created
// and nothing else. Deleting is never part of it — that stays ctx.canDelete
// (Founders and Directors), matching the "goals: board delete" policy and the
// goals_archive_is_board trigger from migration 0064.
export function canManageCard(goal: Goal, ctx: CardCtx): boolean {
  if (ctx.isBoard) return true;
  return ctx.selfManage && goal.created_by === ctx.currentUserId;
}
