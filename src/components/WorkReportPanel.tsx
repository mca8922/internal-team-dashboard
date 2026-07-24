'use client';

// "Report your work" — shown inline under a checklist item when the Board has
// turned ON Report Work for that item. The assigned member writes a short report
// (guided by their department's template) before the item can be ticked.
// On submit the parent ticks the item and plays the party popper over the whole
// box (see GoalChecklist), so this component just owns the editor + persistence.
//
// One report per member per item per day (keyed on the member's local calendar
// day, so it lines up with the same "due today" logic the checklist uses).
// Re-opening the editor on a day already reported lets the member edit it.
import * as React from 'react';
import { Button } from './ui';
import { Icon } from './Icon';
import { RichTextEditor, RichText } from './RichTextEditor';
import { useToast } from './Toast';
import { submitWorkReport } from '@/lib/actions';

export function WorkReportPanel({
  itemId,
  templateBody,
  existingBody,
  reportDate,
  openSignal = 0,
  onSubmitted,
}: {
  itemId: string;
  // The department's reporting template (HTML) — prefilled as a starting point.
  templateBody: string;
  // The member's already-submitted report for today (HTML), or null.
  existingBody: string | null;
  // The member's local calendar day (YYYY-MM-DD) the report is filed under.
  reportDate: string;
  // Bumped by the parent when a blocked tick asks the member to report first;
  // each change opens (and focuses) the editor.
  openSignal?: number;
  // Called after a successful submit — the parent ticks the item + celebrates.
  onSubmitted?: () => void;
}) {
  const toast = useToast();
  const [, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [draft, setDraft] = React.useState('');

  const reported = existingBody != null;

  // Reviewer feedback (stars + comments) is no longer shown here — it now lives
  // in a goal-level "Feedback on your work" panel (see MemberGoalFeedback in
  // GoalsView) so it survives the day/period rollover that empties this editor.

  // Open (and seed) the editor — from the member's own button or a blocked tick.
  const openEditor = React.useCallback(() => {
    setDraft(existingBody || templateBody || '');
    setOpen(true);
  }, [existingBody, templateBody]);

  // A blocked tick in the checklist bumps openSignal to bring the member here.
  React.useEffect(() => {
    if (openSignal > 0) openEditor();
  }, [openSignal, openEditor]);

  const submit = () => {
    setSubmitting(true);
    startTransition(async () => {
      try {
        const res = await submitWorkReport(itemId, draft, reportDate);
        if (!res.ok) throw new Error(res.error || 'Could not submit your report.');
        setOpen(false);
        onSubmitted?.(); // parent ticks the item + plays the party popper
      } catch (e) {
        toast((e as Error).message || 'Could not submit your report.', 'error');
      } finally {
        setSubmitting(false);
      }
    });
  };

  return (
    <div className="work-report">
      <div className="work-report-head">
        <Icon name="edit" size={13} />
        <span>Report Work</span>
        {reported ? (
          <span className="work-report-done-badge">
            <Icon name="check" size={11} /> Reported today
          </span>
        ) : (
          <span className="work-report-need-badge">Required before completing</span>
        )}
      </div>

      {/* Already reported (and not editing): show what they wrote + edit. */}
      {reported && !open ? (
        <div className="work-report-card">
          {existingBody ? (
            <RichText className="work-report-body" value={existingBody} />
          ) : (
            <span className="work-report-empty">Submitted (no details).</span>
          )}
          <div className="work-report-actions">
            <Button size="sm" variant="ghost" icon="edit" onClick={openEditor}>
              Edit report
            </Button>
          </div>
        </div>
      ) : null}

      {/* Not yet reported (and not editing): the call to action. */}
      {!reported && !open ? (
        <div className="work-report-card">
          <p className="work-report-prompt">
            Tell us what you got done. Submitting ticks this task complete.
          </p>
          <div className="work-report-actions">
            <Button size="sm" icon="edit" onClick={openEditor}>
              Report your work
            </Button>
          </div>
        </div>
      ) : null}

      {/* Editing. */}
      {open ? (
        <div className="work-report-editor">
          <RichTextEditor
            value={draft}
            onChange={setDraft}
            placeholder="What did you get done? Follow your team's reporting format."
            ariaLabel="Work report"
            autoFocus
          />
          <div className="work-report-actions">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button size="sm" icon="check" onClick={submit} loading={submitting}>
              {reported ? 'Save report' : 'Submit & tick'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
