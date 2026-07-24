// Reusable goal "blueprints" the Board can spin up repeatedly (e.g. a standard
// weekly checklist). These now live in the database (table `goal_templates`,
// migration 0032) so every Board Member shares one library — read via
// getGoalTemplates() and written via the createGoalTemplate / deleteGoalTemplate
// server actions. This module just holds the shared shapes + a parser for the
// JSONB checklist column.
import type { ChecklistRecurrence, GoalLevel } from './types';
import type { GoalTemplateRow } from './types';

export interface TemplateChecklistRow {
  label: string;
  description: string;
  recurrence: ChecklistRecurrence;
  recurDays: number[];
  // Whether this checklist item requires a work report before it can be ticked.
  reportRequired: boolean;
}

export interface GoalTemplate {
  id: string;
  name: string;
  level: GoalLevel;
  department: string;
  title: string;
  description: string;
  checklist: TemplateChecklistRow[];
}

// Normalises one stored checklist row (which may predate newer fields) into a
// fully-populated TemplateChecklistRow.
function parseRow(raw: unknown): TemplateChecklistRow {
  const r = (raw ?? {}) as Partial<TemplateChecklistRow> & { recurDays?: unknown };
  return {
    label: typeof r.label === 'string' ? r.label : '',
    description: typeof r.description === 'string' ? r.description : '',
    recurrence: (r.recurrence as ChecklistRecurrence) || 'once',
    recurDays: Array.isArray(r.recurDays) ? (r.recurDays as number[]) : [],
    reportRequired: !!r.reportRequired,
  };
}

// Turns a DB row (with its JSONB checklist) into a typed GoalTemplate.
export function parseGoalTemplate(row: GoalTemplateRow): GoalTemplate {
  const list = Array.isArray(row.checklist) ? row.checklist : [];
  return {
    id: row.id,
    name: row.name,
    level: row.level,
    department: row.department,
    title: row.title,
    description: row.description,
    checklist: list.map(parseRow),
  };
}
