'use client';

// The single "Add / Edit goal" form, shown in a modal on the Goals page. One
// form covers every tier (Yearly · Monthly · Weekly · Daily) plus the
// checklist, cadence (including custom weekdays), status, progress and
// per-member assignment.
import * as React from 'react';
import { Button, Field, Toggle } from '@/components/ui';
import { useConfirm } from '@/components/ConfirmDialog';
import { Icon } from '@/components/Icon';
import { RichTextEditor } from '@/components/RichTextEditor';
import { DepartmentSelect } from '@/components/DepartmentSelect';
import { DatePicker } from '@/components/DatePicker';
import { WEEKDAYS, recurrenceOptionsForLevel } from '@/lib/recurrence';
import { periodEndDate, periodLabel } from '@/lib/fiscal';
import { fmtDate, addDays } from '@/lib/dates';
import { PARENT_LEVEL } from './goal-ui';
import type { Goal, GoalLevel, ChecklistRecurrence } from '@/lib/types';

export interface AssignableMember {
  id: string;
  name: string;
  department: string;
  avatar_url?: string | null;
}

// One checklist line in the form. `id` is set for an item already in the DB.
// `descShown` is form-local UI state — controls whether the optional
// description textarea is revealed; it isn't sent to the server.
export interface ChecklistRow {
  id?: string;
  label: string;
  description: string;
  descShown?: boolean;
  recurrence: ChecklistRecurrence;
  recurDays: number[];
  // When on, the assigned member must report their work before they can tick
  // this item complete.
  reportRequired: boolean;
}

export interface GoalSubmit {
  id?: string;
  level: GoalLevel;
  title: string;
  description: string;
  dueDate: string;
  // Primary department (departments[0]) — kept for back-compat.
  department: string;
  // Every department the goal spans (multi-department goals).
  departments: string[];
  status: 'inactive' | 'active' | 'achieved' | 'not_met';
  progress: number;
  parentId: string | null;
  assigneeIds: string[];
  checklist: ChecklistRow[];
}

const LEVELS: { value: GoalLevel; label: string }[] = [
  { value: 'yearly', label: 'Yearly' },
  { value: 'half_yearly', label: 'Half-Yearly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'daily', label: 'Daily' },
];

// Which level a goal of `level` hangs under (its parent tier), or null for the
// top tier. Drives the parent picker: daily→monthly→quarterly→half-yearly→yearly.
const PARENT_OF = PARENT_LEVEL;

export function GoalForm({
  initial,
  parents,
  departments,
  members,
  initialAssignees,
  initialChecklist,
  onSubmit,
  onCancel,
  submitting,
  multiDept = false,
}: {
  initial: Partial<Goal> & { level: GoalLevel };
  parents: Goal[];
  departments: string[];
  members: AssignableMember[];
  initialAssignees: string[];
  initialChecklist: ChecklistRow[];
  onSubmit: (data: GoalSubmit) => void;
  onCancel: () => void;
  submitting?: boolean;
  // Board only: let a goal span multiple departments (the picker becomes a
  // multi-select and members from every chosen department can be assigned).
  // Managers keep the single-department picker for the department they head.
  multiDept?: boolean;
}) {
  const [form, setForm] = React.useState({
    level: initial.level,
    title: initial.title || '',
    description: initial.description || '',
    // A tiered task defaults to the end of the financial period it belongs to
    // (FY Apr–Mar), so a Quarterly task lands on its quarter-end rather than an
    // arbitrary date. Daily has no period, so it keeps the week-out default.
    dueDate:
      initial.due_date ||
      (initial.level === 'daily'
        ? fmtDate(addDays(new Date(), 7))
        : periodEndDate(initial.level)),
    status: (initial.status || 'active') as 'inactive' | 'active' | 'achieved' | 'not_met',
    progress: initial.progress || 0,
    parentId: initial.parent_id || null,
  });
  // The department(s) the goal spans; element 0 is the primary. Seeded from the
  // multi-department array, falling back to the legacy single department.
  const [depts, setDepts] = React.useState<string[]>(() =>
    initial.departments && initial.departments.length
      ? initial.departments
      : initial.department
        ? [initial.department]
        : [],
  );
  const [assignees, setAssignees] = React.useState<string[]>(initialAssignees);
  const [checklist, setChecklist] = React.useState<ChecklistRow[]>(() =>
    // Auto-reveal the description on rows that already have one (so editing an
    // existing goal shows what's there); new rows start collapsed.
    initialChecklist.map((it) => ({ ...it, descShown: !!it.description })),
  );
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    hasTouched.current = true;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const isEditing = !!initial.id;
  const confirm = useConfirm();
  const hasTouched = React.useRef(false);

  const handleCancel = async () => {
    if (hasTouched.current) {
      const ok = await confirm({
        title: 'Discard changes?',
        message: 'You have unsaved changes. They will be lost if you close now.',
        confirmLabel: 'Discard',
        tone: 'danger',
        icon: 'trash',
      });
      if (!ok) return;
    }
    onCancel();
  };

  const recurrenceOptions = recurrenceOptionsForLevel(form.level);

  // Switching tier on a NEW goal clears the content the user typed for the old
  // tier (title, description, checklist) so each tier gets a fresh slate to
  // write into. When editing an existing goal we never wipe their work — only
  // snap any now-invalid checklist cadences down to the coarsest allowed one.
  const changeLevel = (next: GoalLevel) => {
    if (next === form.level) return;
    if (!isEditing) {
      hasTouched.current = false;
      setForm((f) => ({
        ...f,
        level: next,
        title: '',
        description: '',
        parentId: null,
        // Re-anchor the due date on the new tier's financial period. Only on a
        // new task — an existing task's date is the user's, never overwritten.
        dueDate:
          next === 'daily' ? fmtDate(addDays(new Date(), 7)) : periodEndDate(next),
      }));
      setChecklist([]);
      return;
    }
    hasTouched.current = true;
    const allowed = new Set(recurrenceOptionsForLevel(next).map((o) => o.value));
    const fallback: ChecklistRecurrence = allowed.has('once') ? 'once' : 'daily';
    setForm((f) => ({ ...f, level: next, parentId: null }));
    setChecklist((c) =>
      c.map((it) => (allowed.has(it.recurrence) ? it : { ...it, recurrence: fallback })),
    );
  };

  // ---- checklist editing ----
  const addChecklistItem = () => {
    hasTouched.current = true;
    setChecklist((c) => [
      ...c,
      {
        label: '',
        description: '',
        descShown: false,
        recurrence: 'once',
        recurDays: [],
        reportRequired: false,
      },
    ]);
  };
  const updateChecklistItem = (i: number, patch: Partial<ChecklistRow>) => {
    hasTouched.current = true;
    setChecklist((c) => c.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  };
  const removeChecklistItem = (i: number) => {
    hasTouched.current = true;
    setChecklist((c) => c.filter((_, idx) => idx !== i));
  };
  const toggleDay = (i: number, day: number) => {
    hasTouched.current = true;
    setChecklist((c) =>
      c.map((it, idx) =>
        idx === i
          ? {
              ...it,
              recurDays: it.recurDays.includes(day)
                ? it.recurDays.filter((d) => d !== day)
                : [...it.recurDays, day].sort((a, b) => a - b),
            }
          : it,
      ),
    );
  };
  // Filled-in items only — blank rows are ignored on submit.
  const filledChecklist = checklist.filter((c) => c.label.trim());
  const hasChecklist = filledChecklist.length > 0;

  const toggleAssignee = (id: string) => {
    hasTouched.current = true;
    setAssignees((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  };

  // Set the goal's departments and drop any picked assignees who no longer
  // belong to one of them (only members of a chosen department can be assigned).
  const setDeptsPruned = (next: string[]) => {
    hasTouched.current = true;
    setDepts(next);
    setAssignees((a) =>
      a.filter((id) => members.some((m) => m.id === id && next.includes(m.department))),
    );
  };
  // Single-department picker (managers): replace the whole selection.
  const changeDepartment = (dept: string) => setDeptsPruned(dept ? [dept] : []);
  // Multi-department picker (Board): toggle one department in/out.
  const toggleDept = (dept: string) =>
    setDeptsPruned(depts.includes(dept) ? depts.filter((d) => d !== dept) : [...depts, dept]);
  // The chip pool for the multi-select: the departments the org already has.
  // A task cannot mint a new one — departments are created in Team/Settings, not
  // here. Any department already ON this task is still included so editing a
  // task never silently drops a department that has since been retired.
  const deptPool = React.useMemo(
    () => Array.from(new Set([...departments, ...depts])),
    [departments, depts],
  );
  // Members of ANY selected department are the assignable pool.
  const deptMembers =
    depts.length > 0 ? members.filter((m) => depts.includes(m.department)) : [];
  const deptsLabel = depts.join(' · ');

  const parentLevel = PARENT_OF[form.level];
  const parentOptions = parentLevel
    ? parents.filter((p) => p.level === parentLevel)
    : [];

  const canSubmit = !!form.title.trim() && depts.length > 0 && !submitting;

  return (
    <div className="grid gap-3">
      {/* Level — the headline choice. Big segmented control so picking the
          tier is the obvious first step. */}
      <Field label="Task level">
        <div className="seg">
          {LEVELS.map((l) => (
            <button
              key={l.value}
              type="button"
              className={`seg-btn${form.level === l.value ? ' active' : ''}`}
              onClick={() => changeLevel(l.value)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Title">
        <input
          className="input"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="e.g. Post 3 reels this week"
          autoFocus
        />
      </Field>
      <Field label="Description">
        <RichTextEditor
          value={form.description}
          onChange={(html) => set('description', html)}
          placeholder="What does done look like?"
          ariaLabel="Task description"
        />
      </Field>

      {multiDept ? (
        <Field
          label="Departments"
          hint="Members from every selected department can be assigned. The first one is the primary, used for reporting and analytics."
        >
          <div className="dept-multi">
            {deptPool.map((d) => {
              const on = depts.includes(d);
              const primary = depts[0] === d;
              return (
                <button
                  key={d}
                  type="button"
                  className={`dept-chip${on ? ' on' : ''}${primary ? ' primary' : ''}`}
                  onClick={() => toggleDept(d)}
                >
                  {on ? <Icon name="check" size={12} /> : null}
                  {d}
                  {primary ? <span className="dept-chip-tag">Primary</span> : null}
                </button>
              );
            })}
          </div>
        </Field>
      ) : (
        <Field label="Department">
          <DepartmentSelect
            value={depts[0] || ''}
            departments={departments}
            onChange={changeDepartment}
            allowCreate={false}
          />
        </Field>
      )}

      <div className="form-row-2">
        <Field label="Due date">
          <DatePicker
            value={form.dueDate}
            onChange={(v) => set('dueDate', v)}
            ariaLabel="Due date"
          />
          {/* Which financial period the chosen date falls in (FY Apr–Mar), so
              the Board can see at a glance that a "Q2" task really is due in
              Jul–Sep. Purely informative — the date itself stays editable. */}
          {form.dueDate && periodLabel(form.level, form.dueDate) ? (
            <div className="field-hint">{periodLabel(form.level, form.dueDate)}</div>
          ) : null}
        </Field>
        <div />
      </div>

      <div className="form-row-2">
        <Field label="Status">
          <select
            className="select"
            value={form.status}
            onChange={(e) =>
              set('status', e.target.value as 'inactive' | 'active' | 'achieved' | 'not_met')
            }
          >
            <option value="inactive">Not-Active</option>
            <option value="active">Active</option>
            <option value="achieved">Completed</option>
            <option value="not_met">Not met</option>
          </select>
        </Field>
        {parentOptions.length > 0 ? (
          <Field label={`Parent (${parentLevel} task)`}>
            <select
              className="select"
              value={form.parentId || ''}
              onChange={(e) => set('parentId', e.target.value || null)}
            >
              <option value="">None</option>
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <div />
        )}
      </div>

      {/* Checklist — the steps that make up the goal. Each can repeat, and a
          "Custom days" cadence lets you pick exact weekdays (e.g. Mon/Wed/Fri). */}
      <Field
        label="Checklist"
        hint="Break the task into steps. Assigned members tick these off and progress updates automatically."
      >
        <div className="checklist-editor">
          {checklist.map((item, i) => (
            <div key={item.id ?? 'new-' + i} className="checklist-edit-item">
              <div className="checklist-edit-row">
                <span className="checklist-edit-num">{i + 1}</span>
                <input
                  className="input"
                  value={item.label}
                  placeholder="e.g. Create a reel"
                  onChange={(e) => updateChecklistItem(i, { label: e.target.value })}
                />
                <select
                  className="select checklist-recur"
                  value={item.recurrence}
                  onChange={(e) =>
                    updateChecklistItem(i, {
                      recurrence: e.target.value as ChecklistRecurrence,
                    })
                  }
                  title="How often this task repeats"
                >
                  {recurrenceOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => removeChecklistItem(i)}
                  aria-label="Remove item"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
              {item.descShown ? (
                <RichTextEditor
                  className="checklist-desc"
                  value={item.description}
                  placeholder="What does done look like?"
                  autoFocus
                  ariaLabel={`Checklist item ${i + 1} description`}
                  onChange={(html) =>
                    updateChecklistItem(i, { description: html })
                  }
                />
              ) : (
                <button
                  type="button"
                  className="checklist-desc-toggle"
                  onClick={() => updateChecklistItem(i, { descShown: true })}
                >
                  + Add description
                </button>
              )}
              {/* Report Work — below the description. When on, the member must
                  report their work before they can tick this item complete. */}
              <label className="checklist-report-toggle">
                <Toggle
                  on={item.reportRequired}
                  onChange={(v) => updateChecklistItem(i, { reportRequired: v })}
                />
                <span className="checklist-report-text">
                  <span className="checklist-report-label">Report Work</span>
                  <span className="checklist-report-sub">
                    Require a work report before this item can be ticked
                  </span>
                </span>
              </label>
              {item.recurrence === 'custom' ? (
                <div className="day-picker">
                  <span className="day-picker-label">Repeats on</span>
                  {WEEKDAYS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      className={`day-chip${item.recurDays.includes(d.value) ? ' active' : ''}`}
                      onClick={() => toggleDay(i, d.value)}
                      title={d.label}
                    >
                      {d.short}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            icon="plus"
            onClick={addChecklistItem}
          >
            Add checklist item
          </Button>
        </div>
      </Field>

      {hasChecklist ? (
        <Field label="Progress">
          <div className="text-sm text-grey">
            Tracked automatically from the {filledChecklist.length} checklist item
            {filledChecklist.length > 1 ? 's' : ''} above, counted per assigned member.
          </div>
        </Field>
      ) : (
        <Field label={`Progress (${form.progress}%)`}>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={form.progress}
            onChange={(e) => set('progress', Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </Field>
      )}

      {/* Assign to members. Each completes the checklist independently, so two
          assignees double the expected output. */}
      <Field
        label="Assign to members"
        hint={
          depts.length > 0
            ? `Showing ${deptsLabel}. Each assignee completes the checklist on their own.`
            : 'Pick a department above to choose members.'
        }
      >
        {depts.length === 0 ? (
          <div className="text-sm text-grey">Select a department first.</div>
        ) : deptMembers.length === 0 ? (
          <div className="text-sm text-grey">No members in {deptsLabel}.</div>
        ) : (
          <div className="assignee-list">
            {deptMembers.map((m) => (
              <label key={m.id} className="assignee-row">
                <input
                  type="checkbox"
                  checked={assignees.includes(m.id)}
                  onChange={() => toggleAssignee(m.id)}
                />
                <span className="flex-1">{m.name}</span>
                <span className="text-xs text-grey">{m.department}</span>
              </label>
            ))}
          </div>
        )}
      </Field>

      <div className="modal-actions">
        <Button variant="ghost" onClick={handleCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button
          disabled={!canSubmit}
          onClick={() => {
            if (!canSubmit) return;
            onSubmit({
              id: initial.id,
              ...form,
              department: depts[0] || '',
              departments: depts,
              assigneeIds: assignees,
              checklist: filledChecklist.map((c) => ({
                id: c.id,
                label: c.label.trim(),
                description: c.description.trim(),
                recurrence: c.recurrence,
                recurDays: c.recurrence === 'custom' ? c.recurDays : [],
                reportRequired: c.reportRequired,
              })),
            });
          }}
        >
          {initial.id ? 'Save changes' : 'Add task'}
        </Button>
      </div>
    </div>
  );
}
