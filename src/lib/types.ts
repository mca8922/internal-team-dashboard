// Domain types for the Mahesh Chandra & Associates dashboard.
// These mirror the SQL schema in supabase/migrations.

export type UserRole = 'board' | 'fte' | 'pte' | 'intern';
// Task tiers, top of the cascade first. Each tier's parent is the one before it:
// Yearly → Half-Yearly → Quarterly → Monthly → Daily.
export type GoalLevel = 'yearly' | 'half_yearly' | 'quarterly' | 'monthly' | 'daily';
export type GoalStatus = 'inactive' | 'active' | 'achieved' | 'not_met';
export type LeaveType = 'casual' | 'sick' | 'emergency' | 'wfh';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';

export interface LeaveBalance {
  casual: number;
  sick: number;
  emergency: number;
}

export interface Profile {
  id: string;
  name: string;
  email: string;
  commute_email: string | null;
  role: UserRole;
  department: string;
  joined_date: string;
  date_of_birth: string | null;
  confirmed_by_board: boolean;
  is_active: boolean;
  leave_balance: LeaveBalance;
  daily_target_hours: number | null;
  avatar_url: string | null;
  left_at: string | null;
  internship_months: number | null;
  job_title: string;
  created_at: string;
  tour_seen: boolean;
  transactional_emails_enabled: boolean;
  // Department Manager (Head of Department) — see migration 0033.
  is_manager: boolean;
  managed_department: string | null; // the department this person heads (managers only)
  manager_id: string | null; // on a team member's row: their Head's id
  manager_responsibilities: string | null; // Board-authored Role & Responsibilities (HTML), managers only
}

// A Manager's request for the Board to change one field on a team member's
// account. The Board approves (which applies the change) or rejects it.
export type ChangeRequestField = 'email' | 'role' | 'job_title' | 'daily_target_hours';
export type ChangeRequestStatus = 'pending' | 'approved' | 'rejected';

export interface ChangeRequest {
  id: string;
  manager_id: string;
  member_id: string;
  field: ChangeRequestField;
  current_value: string | null;
  requested_value: string;
  status: ChangeRequestStatus;
  reviewed_by: string | null;
  review_note: string;
  created_at: string;
  reviewed_at: string | null;
}

// A member's request to correct a day's attendance — either a missed punch
// (add a punch for a day with none recorded) or a day-status change
// (reclassify the day as leave). The Founder approves (which applies the
// change to `punches` or `leaves`) or rejects it with a required note.
export type PunchChangeRequestType = 'missed_punch' | 'day_status';
export type PunchChangeRequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface PunchChangeRequest {
  id: string;
  user_id: string;
  work_date: string;
  request_type: PunchChangeRequestType;
  requested_punch_in: string | null;
  requested_punch_out: string | null;
  requested_leave_type: LeaveType | null;
  requested_is_half_day: boolean | null;
  reason: string;
  status: PunchChangeRequestStatus;
  reviewed_by: string | null;
  review_note: string;
  created_at: string;
  reviewed_at: string | null;
}

export interface Punch {
  id: string;
  user_id: string;
  work_date: string;
  punch_in: string;
  punch_out: string | null;
  created_at: string;
}

export type BlockType =
  | 'text'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'numbered'
  | 'todo'
  | 'table'
  | 'divider'
  | 'quote'
  | 'code'
  | 'callout';

export interface Block {
  id: string;
  type: BlockType;
  content: string;
  done?: boolean;
  variant?: 'info' | 'warning' | 'error';
  icon?: string;
  props?: { headers: string[]; rows: string[][] };
}

export interface WorkLog {
  id: string;
  user_id: string;
  log_date: string;
  mood: string;
  energy_level: number;
  tags: string[];
  blocks: Block[];
  is_draft: boolean;
  saved_at: string;
}

export interface Goal {
  id: string;
  level: GoalLevel;
  title: string;
  description: string;
  due_date: string | null;
  // Primary / home department — used for analytics grouping, report-template
  // selection and back-compat. Always equals departments[0].
  department: string;
  // Every department the goal spans (multi-department goals). The primary is
  // element 0. Legacy rows backfilled to [department] by migration 0038.
  departments: string[];
  status: GoalStatus;
  progress: number;
  sort_order: number;
  parent_id: string | null;
  created_by: string | null;
  created_at: string;
  // Soft-archive (Goals cleanup): non-null means the goal is archived — hidden
  // from every view but retained and restorable. See migration 0044.
  archived_at: string | null;
  archived_by: string | null;
}

// ── Per-user Goals navigation prefs (see migration 0036) ────────────────────
// A saved view captures the full state of the Goals browser so the user can
// flip between presets ("My overdue", "Sales this month", …). Stored as JSON in
// goal_saved_views.config.
export type GoalGrouping = 'due' | 'department' | 'status' | 'level' | 'none';
export type GoalSortKey = 'title' | 'status' | 'due' | 'progress';

export interface GoalViewConfig {
  view: 'cascade' | 'table' | 'canvas';
  grouping: GoalGrouping;
  sort: { key: GoalSortKey; dir: 'asc' | 'desc' };
  query: string;
  dept: string; // 'all' or a department name
  status: 'all' | GoalStatus;
  due: 'all' | 'overdue' | 'week';
}

export interface SavedView {
  id: string;
  name: string;
  config: GoalViewConfig;
}

// One member's work report for a checklist item on a given day. Required before
// ticking when the item has report_required = true; stored as rich-text HTML.
export interface WorkReport {
  id: string;
  item_id: string;
  user_id: string;
  report_date: string; // YYYY-MM-DD (member's IST calendar day)
  body: string;
  created_at: string;
  updated_at: string;
}

// A department's reporting template — the shape members should follow when they
// report work. Board-edited; stored as rich-text HTML.
export interface ReportTemplate {
  department: string;
  body: string;
  updated_by: string | null;
  updated_at: string;
}

export interface GoalAssignee {
  goal_id: string;
  user_id: string;
  assigned_at: string;
  // Who put this goal on the member's queue (drives the "Assigned by ___" badge).
  // Null for pre-existing or system assignments.
  assigned_by: string | null;
}

// A Manager's / Board Member's review of a member's work report: a 1-5 star
// rating plus an optional comment. One editable review per (report, reviewer).
export interface WorkReportReview {
  id: string;
  report_id: string;
  reviewer_id: string;
  stars: number; // 1..5
  comment: string;
  created_at: string;
  updated_at: string;
}

// Tracks that a member has tapped open a custom-day task lock.
// Persisted so the box stays revealed after a refresh.
export interface GoalItemUnlock {
  id: string;
  item_id: string;
  user_id: string;
  unlocked_at: string;
}

export type ChecklistRecurrence =
  | 'once'
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'custom';

export interface GoalChecklistItem {
  id: string;
  goal_id: string;
  label: string;
  description: string;
  sort_order: number;
  recurrence: ChecklistRecurrence;
  // Weekdays (0=Sun..6=Sat) a 'custom' item is due on; empty for other cadences.
  recur_days: number[];
  // When true, an assigned member must submit a work report (one per day) before
  // they can tick THIS item complete. See goal_work_reports.
  report_required: boolean;
  is_done: boolean;
  done_by: string | null;
  done_at: string | null;
  created_at: string;
}

// One member's completion of one checklist item. Completion is independent per
// assignee, so a goal assigned to two members expects two completions per item.
export interface GoalChecklistCompletion {
  item_id: string;
  user_id: string;
  done_at: string;
}

export type NotificationType =
  | 'goal_assigned'
  | 'leave_requested'
  | 'leave_approved'
  | 'leave_rejected'
  | 'punch_missing'
  | 'goal_due_soon'
  | 'work_anniversary'
  // A member filed a work report — reviewers (Board + the department's Manager)
  // are told it's ready to review.
  | 'work_report_submitted'
  // A reviewer rated/commented a member's work report.
  | 'work_report_reviewed'
  // A member tapped to reveal a custom-day task description.
  | 'task_unlocked'
  // A member submitted a punch time change request (Founder-only).
  | 'punch_change_requested'
  // The Founder approved / rejected a member's punch time change request.
  | 'punch_change_approved'
  | 'punch_change_rejected'
  // A member's birthday reminder (sent to that member only).
  | 'birthday'
  // The celebrant replied to a birthday wish — delivered privately to the
  // person who sent it, never posted publicly.
  | 'birthday_wish_reply';

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  href: string;
  goal_id: string | null;
  // Department this notification belongs to, when it can be attributed to one
  // (goal assignments, deadline reminders, work-report events). Null for
  // company-wide events (leave, punch, milestones) — these render under
  // the "Company / General" section. See src/lib/notif-sections.ts.
  department: string | null;
  is_read: boolean;
  created_at: string;
}

// Raw `birthday_wishes` row. The message/reply text is only ever selectable
// (per RLS) by the sender or the celebrant it's addressed to — see
// migration 0056_birthday_privacy.sql. queries.ts reshapes this into the
// privacy-safe, sender-joined `BirthdayWish` shape below before it ever
// reaches a Server Component's rendered output.
export interface BirthdayWishRow {
  id: string;
  birthday_user_id: string;
  author_id: string;
  message: string;
  reply_message: string | null;
  reply_created_at: string | null;
  created_at: string;
}

// Client-facing wish shape — already privacy-filtered per viewer server-side
// and joined with the sender's display info. A bystander only ever receives
// this fully populated for their OWN wish; every other wish in the same list
// has `message: ''` and `reply: null` (they only see who wished, never what
// was said).
export interface BirthdayWish {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_avatar_url: string | null;
  message: string;
  created_at: string;
  reply: { message: string; created_at: string } | null;
}

// A member's per-type notification mute, one row per type they've changed from
// the default. A missing row for a type means both channels are enabled.
export interface NotificationPref {
  user_id: string;
  type: NotificationType;
  in_app: boolean;
  push: boolean;
}

export interface Leave {
  id: string;
  user_id: string;
  type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
  is_half_day: boolean;
  status: LeaveStatus;
  reviewed_by: string | null;
  review_note: string;
  // Two-stage approval: a Board Member's "accept" is recorded here while the
  // request stays pending; the Founder's review then finalises it.
  pre_approved_by: string | null;
  pre_approved_at: string | null;
  created_at: string;
}

export interface Holiday {
  id: string;
  holiday_date: string;
  name: string;
  is_national: boolean;
}

export interface Company {
  id: number;
  mission: string;
  vision: string;
  updated_by: string | null;
  updated_at: string;
}

// A department's chosen accent colour. Departments themselves are still the
// distinct `department` string on profiles/goals; this table only carries the
// per-department colour the Board picks in Manage › Departments.
export interface Department {
  name: string;
  color: string;
  created_at: string;
}

// A registered department tool in the Launchpad. The app itself is deployed
// independently (its own Vercel project, etc.); this row only indexes it: a
// name, a URL, and the department it belongs to (null = company-wide). The
// Board curates these; members see only their department's active apps.
export interface DepartmentApp {
  id: string;
  department: string | null;
  name: string;
  description: string;
  url: string;
  icon: string;
  // A transparent backdrop image (cropped + framed data URL), or null to fall
  // back to the tile glyph.
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Event types that can trigger a transactional email (mirrors the in-app
// notification types that members care about by email).
export type TransactionalEventType =
  | 'leave_approved'
  | 'leave_rejected'
  | 'goal_assigned'
  | 'punch_missing'
  | 'punch_change_requested'
  | 'punch_change_approved'
  | 'punch_change_rejected';

export interface TransactionalEmailSettings {
  id: number;
  enabled: boolean;   // master switch
  on_leave: boolean;  // leave approved / declined
  on_goal: boolean;   // goal assigned
  on_punch: boolean;  // missed punch-out reminder
  updated_by: string | null;
  updated_at: string;
}

export interface TransactionalEmailLog {
  id: string;
  recipient_id: string | null;
  recipient_email: string;
  recipient_name: string;
  event_type: TransactionalEventType | string;
  subject: string;
  status: 'sent' | 'failed';
  error_message: string | null;
  created_at: string;
}

// Supabase generated-style Database type so the typed client knows the schema.
// Insert / Update shapes are written as explicit object literals — the
// supabase-js client overloads resolve those cleanly, whereas mapped types
// (Omit / Partial) can collapse to `never` inside the generic.
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: {
          id: string;
          name: string;
          email: string;
          role?: UserRole;
          department?: string;
          joined_date?: string;
          date_of_birth?: string | null;
          confirmed_by_board?: boolean;
          is_active?: boolean;
          leave_balance?: LeaveBalance;
          daily_target_hours?: number | null;
          avatar_url?: string | null;
          left_at?: string | null;
          internship_months?: number | null;
          job_title?: string;
          is_manager?: boolean;
          managed_department?: string | null;
          manager_id?: string | null;
          manager_responsibilities?: string | null;
        };
        Update: {
          name?: string;
          email?: string;
          commute_email?: string | null;
          transactional_emails_enabled?: boolean;
          role?: UserRole;
          department?: string;
          joined_date?: string;
          date_of_birth?: string | null;
          confirmed_by_board?: boolean;
          is_active?: boolean;
          leave_balance?: LeaveBalance;
          daily_target_hours?: number | null;
          avatar_url?: string | null;
          left_at?: string | null;
          internship_months?: number | null;
          job_title?: string;
          is_manager?: boolean;
          managed_department?: string | null;
          manager_id?: string | null;
          manager_responsibilities?: string | null;
        };
      };
      punches: {
        Row: Punch;
        Insert: {
          id?: string;
          user_id: string;
          work_date: string;
          punch_in: string;
          punch_out?: string | null;
        };
        Update: { punch_in?: string; punch_out?: string | null };
      };
      logs: {
        Row: WorkLog;
        Insert: {
          id?: string;
          user_id: string;
          log_date: string;
          mood?: string;
          energy_level?: number;
          tags?: string[];
          blocks?: Block[];
          is_draft?: boolean;
          saved_at?: string;
        };
        Update: {
          mood?: string;
          energy_level?: number;
          tags?: string[];
          blocks?: Block[];
          is_draft?: boolean;
          saved_at?: string;
        };
      };
      goals: {
        Row: Goal;
        Insert: {
          id?: string;
          level: GoalLevel;
          title: string;
          description?: string;
          due_date?: string | null;
          department?: string;
          departments?: string[];
          status?: GoalStatus;
          progress?: number;
          sort_order?: number;
          parent_id?: string | null;
          created_by?: string | null;
        };
        Update: {
          level?: GoalLevel;
          title?: string;
          description?: string;
          due_date?: string | null;
          department?: string;
          departments?: string[];
          status?: GoalStatus;
          progress?: number;
          sort_order?: number;
          parent_id?: string | null;
        };
      };
      goal_assignees: {
        Row: GoalAssignee;
        Insert: { goal_id: string; user_id: string; assigned_at?: string };
        Update: { goal_id?: string; user_id?: string };
      };
      goal_checklist_items: {
        Row: GoalChecklistItem;
        Insert: {
          id?: string;
          goal_id: string;
          label: string;
          description?: string;
          sort_order?: number;
          recurrence?: ChecklistRecurrence;
          recur_days?: number[];
          report_required?: boolean;
          is_done?: boolean;
          done_by?: string | null;
          done_at?: string | null;
        };
        Update: {
          label?: string;
          description?: string;
          sort_order?: number;
          recurrence?: ChecklistRecurrence;
          recur_days?: number[];
          report_required?: boolean;
          is_done?: boolean;
          done_by?: string | null;
          done_at?: string | null;
        };
      };
      goal_checklist_completions: {
        Row: GoalChecklistCompletion;
        Insert: { item_id: string; user_id: string; done_at?: string };
        Update: { done_at?: string };
      };
      notifications: {
        Row: Notification;
        Insert: {
          id?: string;
          user_id: string;
          type?: NotificationType;
          title: string;
          body?: string;
          href?: string;
          goal_id?: string | null;
          is_read?: boolean;
        };
        Update: { is_read?: boolean };
      };
      leaves: {
        Row: Leave;
        Insert: {
          id?: string;
          user_id: string;
          type: LeaveType;
          start_date: string;
          end_date: string;
          reason?: string;
          is_half_day?: boolean;
          status?: LeaveStatus;
          reviewed_by?: string | null;
          review_note?: string;
        };
        Update: {
          status?: LeaveStatus;
          reviewed_by?: string | null;
          review_note?: string;
          pre_approved_by?: string | null;
          pre_approved_at?: string | null;
        };
      };
      holidays: {
        Row: Holiday;
        Insert: { id?: string; holiday_date: string; name: string; is_national?: boolean };
        Update: { holiday_date?: string; name?: string; is_national?: boolean };
      };
      company: {
        Row: Company;
        Insert: { id?: number; mission?: string; vision?: string; updated_by?: string | null };
        Update: {
          mission?: string;
          vision?: string;
          updated_by?: string | null;
          updated_at?: string;
        };
      };
      departments: {
        Row: Department;
        Insert: { name: string; color?: string };
        Update: { name?: string; color?: string };
      };
      department_apps: {
        Row: DepartmentApp;
        Insert: {
          id?: string;
          department?: string | null;
          name: string;
          description?: string;
          url: string;
          icon?: string;
          image_url?: string | null;
          sort_order?: number;
          is_active?: boolean;
          created_by?: string | null;
        };
        Update: {
          department?: string | null;
          name?: string;
          description?: string;
          url?: string;
          icon?: string;
          image_url?: string | null;
          sort_order?: number;
          is_active?: boolean;
          updated_at?: string;
        };
      };
      report_templates: {
        Row: ReportTemplate;
        Insert: { department: string; body?: string; updated_by?: string | null };
        Update: { body?: string; updated_by?: string | null; updated_at?: string };
      };
      goal_work_reports: {
        Row: WorkReport;
        Insert: {
          id?: string;
          item_id: string;
          user_id: string;
          report_date: string;
          body?: string;
        };
        Update: { body?: string; updated_at?: string };
      };
      change_requests: {
        Row: ChangeRequest;
        Insert: {
          id?: string;
          manager_id: string;
          member_id: string;
          field: ChangeRequestField;
          current_value?: string | null;
          requested_value: string;
          status?: ChangeRequestStatus;
          reviewed_by?: string | null;
          review_note?: string;
          reviewed_at?: string | null;
        };
        Update: {
          status?: ChangeRequestStatus;
          reviewed_by?: string | null;
          review_note?: string;
          reviewed_at?: string | null;
        };
      };
      punch_change_requests: {
        Row: PunchChangeRequest;
        Insert: {
          id?: string;
          user_id: string;
          work_date: string;
          request_type: PunchChangeRequestType;
          requested_punch_in?: string | null;
          requested_punch_out?: string | null;
          requested_leave_type?: LeaveType | null;
          requested_is_half_day?: boolean | null;
          reason: string;
          status?: PunchChangeRequestStatus;
          reviewed_by?: string | null;
          review_note?: string;
          reviewed_at?: string | null;
        };
        Update: {
          status?: PunchChangeRequestStatus;
          reviewed_by?: string | null;
          review_note?: string;
          reviewed_at?: string | null;
        };
      };
      department_app_clicks: {
        Row: DepartmentAppClick;
        Insert: { id?: string; app_id: string; user_id: string; clicked_at?: string };
        Update: Record<string, never>;
      };
      goal_templates: {
        Row: GoalTemplateRow;
        Insert: {
          id?: string;
          name: string;
          level: string;
          department?: string;
          title?: string;
          description?: string;
          checklist?: unknown;
          created_by?: string | null;
        };
        Update: {
          name?: string;
          level?: string;
          department?: string;
          title?: string;
          description?: string;
          checklist?: unknown;
        };
      };
    };
  };
}

export interface DepartmentAppClick {
  id: string;
  app_id: string;
  user_id: string;
  clicked_at: string;
}

// an array of TemplateChecklistRow (see lib/goal-templates.ts).
export interface GoalTemplateRow {
  id: string;
  name: string;
  level: GoalLevel;
  department: string;
  title: string;
  description: string;
  checklist: unknown;
  created_by: string | null;
  created_at: string;
}
