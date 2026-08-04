'use client';

// Shared "hand off this member's open goals" modal. Used when a member goes on
// leave (cover their work) and when they're offboarded (transfer their work
// before they're gone). Lists the member's still-open assigned goals and lets
// the Board reassign each to teammates without leaving the page.
import * as React from 'react';
import { Modal, Button, Avatar } from './ui';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { loadMemberGoalsForHandoff, setGoalAssignees } from '@/lib/actions';
import { LEVEL_META } from '@/app/(app)/goals/goal-ui';
import type { GoalLevel } from '@/lib/types';

type Data = Awaited<ReturnType<typeof loadMemberGoalsForHandoff>>;
type HandoffGoal = Data['goals'][number];

// Tier labels come from goal-ui so this list can't drift out of step with the
// cascade — it used to be a hand-maintained copy that had to be edited in
// lockstep every time a tier changed.
const LEVEL_LABEL = (level: string): string =>
  LEVEL_META[level as GoalLevel]?.label ?? level;

export function MemberGoalsHandoff({
  open,
  onClose,
  memberId,
  memberName,
  contextLabel,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  memberId: string;
  memberName: string;
  contextLabel?: string;
  // When provided, a primary action button (e.g. "Offboard now") runs it after
  // the Board has reassigned what they want. Omit for the leave (optional) case.
  confirmLabel?: string;
  onConfirm?: () => Promise<void>;
}) {
  const toast = useToast();
  const [data, setData] = React.useState<Data | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [sel, setSel] = React.useState<Record<string, string[]>>({});
  const [orig, setOrig] = React.useState<Record<string, string[]>>({});
  const [saved, setSaved] = React.useState<Set<string>>(new Set());
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    setData(null);
    setSaved(new Set());
    loadMemberGoalsForHandoff(memberId)
      .then((d) => {
        setData(d);
        const s: Record<string, string[]> = {};
        for (const g of d.goals) s[g.id] = [...g.assigneeIds];
        setSel(s);
        setOrig(s);
        setLoading(false);
      })
      .catch((e) => {
        toast((e as Error).message || 'Could not load tasks.', 'error');
        setLoading(false);
      });
  }, [open, memberId, toast]);

  const candidates = (g: HandoffGoal) => {
    const inDept = (data?.members ?? []).filter((m) => m.department === g.department);
    const ids = new Set(inDept.map((m) => m.id));
    // Keep any current assignee who isn't in the department list so they can
    // still be toggled off (e.g. the leaving member, or a cross-dept assignee).
    const extra = g.assigneeIds
      .filter((id) => !ids.has(id))
      .map((id) => ({
        id,
        name: data?.names[id] ?? 'Member',
        department: g.department,
        avatar_url: data?.members.find((m) => m.id === id)?.avatar_url ?? null,
      }));
    return [...inDept, ...extra];
  };

  const toggle = (goalId: string, id: string) =>
    setSel((cur) => {
      const arr = cur[goalId] ?? [];
      return { ...cur, [goalId]: arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id] };
    });

  const dirty = (goalId: string) => {
    const a = sel[goalId] ?? [];
    const b = orig[goalId] ?? [];
    return a.length !== b.length || a.some((x) => !b.includes(x));
  };

  const saveGoal = async (goalId: string) => {
    setSavingId(goalId);
    try {
      await setGoalAssignees(goalId, sel[goalId] ?? []);
      setOrig((o) => ({ ...o, [goalId]: [...(sel[goalId] ?? [])] }));
      setSaved((s) => new Set(s).add(goalId));
      toast('Assignees updated');
    } catch (e) {
      toast((e as Error).message || 'Could not reassign.', 'error');
    } finally {
      setSavingId(null);
    }
  };

  const runConfirm = async () => {
    if (!onConfirm) return;
    setConfirming(true);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      toast((e as Error).message || 'Action failed.', 'error');
      setConfirming(false);
    }
  };

  const goals = data?.goals ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Hand off ${memberName}’s tasks`}
      subtitle={contextLabel}
      width={560}
    >
      {loading ? (
        <div className="text-grey text-sm" style={{ padding: '12px 0' }}>
          Loading their tasks…
        </div>
      ) : goals.length === 0 ? (
        <div className="text-grey text-sm" style={{ padding: '12px 0' }}>
          {memberName} has no open tasks to hand off.
        </div>
      ) : (
        <div className="mgh-list">
          {goals.map((g) => (
            <div key={g.id} className="mgh-goal">
              <div className="mgh-goal-head">
                <span className="mgh-goal-title">{g.title}</span>
                <span className="badge badge-slate">{LEVEL_LABEL(g.level)}</span>
                {saved.has(g.id) ? (
                  <span className="badge gb-onleave-badge">
                    <Icon name="check" size={11} /> Saved
                  </span>
                ) : null}
              </div>
              <div className="mgh-members">
                {candidates(g).map((m) => {
                  const on = (sel[g.id] ?? []).includes(m.id);
                  const isLeaver = m.id === memberId;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`mgh-member${on ? ' on' : ''}`}
                      onClick={() => toggle(g.id, m.id)}
                    >
                      <span className="gb-menu-check" aria-hidden>
                        {on ? <Icon name="check" size={11} /> : null}
                      </span>
                      <Avatar name={m.name} size="sm" src={m.avatar_url} />
                      <span className="mgh-member-name">
                        {m.name}
                        {isLeaver ? ' · leaving' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mgh-goal-foot">
                <Button
                  size="sm"
                  icon="check"
                  disabled={!dirty(g.id) || savingId === g.id}
                  onClick={() => saveGoal(g.id)}
                >
                  Save assignees
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="modal-actions">
        {onConfirm ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={confirming}>
              Cancel
            </Button>
            <Button variant="danger" icon="logout" onClick={runConfirm} disabled={confirming}>
              {confirmLabel ?? 'Confirm'}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Done</Button>
        )}
      </div>
    </Modal>
  );
}
