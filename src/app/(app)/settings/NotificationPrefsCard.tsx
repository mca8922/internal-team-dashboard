'use client';

// Per-type notification preferences — lets a member silence notification types
// they don't care about, independently for the in-app bell and web-push. Opt-out
// model: a type with no stored row is on for both channels. Each toggle persists
// immediately via setNotificationPref (one upsert per row).
import * as React from 'react';
import { Toggle } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { setNotificationPref } from '@/lib/actions';
import type { NotificationPref, NotificationType } from '@/lib/types';

type Audience = 'all' | 'reviewer' | 'board';

// Curated, friendly rows. `audience` hides types a member never receives:
// 'reviewer' = Board or a Manager; 'board' = Board only.
const ROWS: { type: NotificationType; label: string; hint: string; audience: Audience }[] = [
  { type: 'goal_assigned', label: 'Goal assigned', hint: 'A goal is assigned to you', audience: 'all' },
  { type: 'goal_due_soon', label: 'Goal due soon', hint: 'A goal you own is almost due', audience: 'all' },
  { type: 'work_report_reviewed', label: 'Work reviewed', hint: 'Your work report gets rated', audience: 'all' },
  { type: 'leave_approved', label: 'Leave approved', hint: 'Your leave request is approved', audience: 'all' },
  { type: 'leave_rejected', label: 'Leave declined', hint: 'Your leave request is declined', audience: 'all' },
  { type: 'punch_missing', label: 'Punch reminder', hint: 'You forgot to punch out', audience: 'all' },
  { type: 'work_anniversary', label: 'Milestones', hint: 'Your work anniversaries and milestones', audience: 'all' },
  { type: 'birthday', label: 'Birthdays', hint: 'Your birthday reminder and wishes from teammates', audience: 'all' },
  { type: 'birthday_wish_reply', label: 'Birthday replies', hint: 'A celebrant replies to your birthday wish', audience: 'all' },
  { type: 'work_report_submitted', label: 'Reports to review', hint: 'A team member submits a work report', audience: 'reviewer' },
  { type: 'leave_requested', label: 'Leave requests', hint: 'A leave request needs a decision', audience: 'board' },
];

type State = Record<string, { in_app: boolean; push: boolean }>;

export function NotificationPrefsCard({
  initialPrefs,
  isBoard,
  isManager,
}: {
  initialPrefs: NotificationPref[];
  isBoard: boolean;
  isManager: boolean;
}) {
  const toast = useToast();

  const rows = ROWS.filter(
    (r) =>
      r.audience === 'all' ||
      (r.audience === 'reviewer' && (isBoard || isManager)) ||
      (r.audience === 'board' && isBoard),
  );

  // Seed each visible row from stored prefs, defaulting to on for both channels.
  const [state, setState] = React.useState<State>(() => {
    const byType = new Map(initialPrefs.map((p) => [p.type, p]));
    const s: State = {};
    for (const r of rows) {
      const p = byType.get(r.type);
      s[r.type] = { in_app: p?.in_app ?? true, push: p?.push ?? true };
    }
    return s;
  });

  const flip = async (type: NotificationType, channel: 'in_app' | 'push', enabled: boolean) => {
    setState((s) => ({ ...s, [type]: { ...s[type], [channel]: enabled } }));
    try {
      await setNotificationPref(type, channel, enabled);
    } catch {
      // Revert on failure so the UI never lies about what's saved.
      setState((s) => ({ ...s, [type]: { ...s[type], [channel]: !enabled } }));
      toast('Could not save that preference', 'error');
    }
  };

  return (
    <div className="card">
      <div className="card-subtitle mb-1">Notification types</div>
      <div className="text-xs text-grey mb-3">
        Choose what reaches you, and where. Off means you won&apos;t be notified for that type.
      </div>

      <div className="notif-pref-grid">
        <div className="notif-pref-colhead" aria-hidden>
          <span>Bell</span>
          <span>Push</span>
        </div>
        {rows.map((r) => (
          <div key={r.type} className="notif-pref-row">
            <div className="flex-1" style={{ minWidth: 0 }}>
              <div className="text-sm fw-medium">{r.label}</div>
              <div className="text-xs text-grey">{r.hint}</div>
            </div>
            <div className="notif-pref-toggles">
              <Toggle
                on={state[r.type].in_app}
                onChange={(v) => flip(r.type, 'in_app', v)}
              />
              <Toggle on={state[r.type].push} onChange={(v) => flip(r.type, 'push', v)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
