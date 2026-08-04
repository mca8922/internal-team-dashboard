'use client';

// Searchable, filterable list of the member's notifications. Pure client-side
// filtering over the rows the server already fetched — instant, no extra queries.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '@/components/Icon';
import { EmptyState } from '@/components/ui';
import { useConfirm } from '@/components/ConfirmDialog';
import { fmtRelative, fmtTime } from '@/lib/dates';
import { clearNotifications, markNotificationsRead } from '@/lib/actions';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import {
  type SectionDef,
  classifyNotif,
  compareSections,
  isSectioned,
} from '@/lib/notif-sections';
import type { Notification, NotificationType } from '@/lib/types';

// Same icon/tone mapping the bell uses, kept local so the two can diverge if
// needed without coupling.
const TYPE_META: Record<NotificationType, { icon: IconName; tone: 'warning' | 'info'; label: string }> = {
  goal_assigned: { icon: 'target', tone: 'info', label: 'Task assigned' },
  leave_requested: { icon: 'plane', tone: 'warning', label: 'Leave requested' },
  leave_approved: { icon: 'check', tone: 'info', label: 'Leave approved' },
  leave_rejected: { icon: 'x', tone: 'warning', label: 'Leave declined' },
  punch_missing: { icon: 'clock', tone: 'warning', label: 'Punch missing' },
  goal_due_soon: { icon: 'target', tone: 'warning', label: 'Task due soon' },
  work_anniversary: { icon: 'sparkles', tone: 'info', label: 'Milestone' },
  birthday: { icon: 'sparkles', tone: 'info', label: 'Birthday' },
  birthday_wish_reply: { icon: 'mail', tone: 'info', label: 'Birthday reply' },
  work_report_submitted: { icon: 'inbox', tone: 'info', label: 'Report to review' },
  work_report_reviewed: { icon: 'star', tone: 'info', label: 'Work reviewed' },
  task_unlocked: { icon: 'lock', tone: 'info', label: 'Task opened' },
  punch_change_requested: { icon: 'clock', tone: 'warning', label: 'Punch change requested' },
  punch_change_approved: { icon: 'check', tone: 'info', label: 'Punch change approved' },
  punch_change_rejected: { icon: 'x', tone: 'warning', label: 'Punch change declined' },
};

export function NotificationsHistory({
  notifications,
  isBoard,
  isManager,
  departmentColors = {},
}: {
  notifications: Notification[];
  isBoard: boolean;
  isManager: boolean;
  departmentColors?: Record<string, string>;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [query, setQuery] = React.useState('');
  const [type, setType] = React.useState<NotificationType | 'all'>('all');
  const viewer = { isBoard, isManager };
  const sectioned = isSectioned(viewer);

  // Only offer filters for types that actually appear in this member's history.
  const presentTypes = React.useMemo(() => {
    const set = new Set<NotificationType>();
    notifications.forEach((n) => set.add(n.type));
    return [...set];
  }, [notifications]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return notifications.filter((n) => {
      if (type !== 'all' && n.type !== type) return false;
      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) || (n.body ?? '').toLowerCase().includes(q)
      );
    });
  }, [notifications, query, type]);

  // Group the filtered rows into ordered sections (Board / Manager only).
  const grouped = React.useMemo(() => {
    if (!sectioned) return [];
    const map = new Map<string, { section: SectionDef; items: Notification[] }>();
    for (const n of filtered) {
      const section = classifyNotif(n.type, n.department, viewer);
      const g = map.get(section.id);
      if (g) g.items.push(n);
      else map.set(section.id, { section, items: [n] });
    }
    return [...map.values()].sort((a, b) => compareSections(a.section, b.section));
    // viewer is derived from the two booleans below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sectioned, isBoard, isManager]);

  const hasUnread = notifications.some((n) => !n.is_read);
  const markAllRead = () => {
    markNotificationsRead()
      .then(() => router.refresh())
      .catch(() => {});
  };
  const clearAll = async () => {
    const ok = await confirm({
      title: 'Clear all notifications?',
      message: `This permanently removes ${notifications.length} notification${notifications.length > 1 ? 's' : ''}, including any unread.`,
      confirmLabel: 'Clear all',
      tone: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    clearNotifications()
      .then(() => router.refresh())
      .catch(() => {});
  };

  // One notification row — shared by the flat and sectioned layouts.
  const renderRow = (n: Notification) => {
    const meta = TYPE_META[n.type] ?? { icon: 'bell' as IconName, tone: 'info' as const };
    return (
      <button
        key={n.id}
        className={`notif-item${n.is_read ? '' : ' unread'}`}
        style={{ width: '100%' }}
        onClick={() => router.push(n.href || '/dashboard')}
      >
        <span className={`notif-item-icon ${meta.tone}`}>
          <Icon name={meta.icon} size={15} />
        </span>
        <span className="notif-item-text">
          <span className="text-sm fw-medium">{n.title}</span>
          <span className="text-xs text-grey">
            {n.body ? `${n.body} · ` : ''}
            {fmtRelative(n.created_at)} · {fmtTime(n.created_at)}
          </span>
        </span>
        {!n.is_read ? <span className="notif-dot" aria-label="Unread" /> : null}
      </button>
    );
  };

  // Phase 1: this entire history is stored notification types (goal, leave,
  // punch, work-report) — all locked. Show a single locked state instead of
  // the search/filter list; flip FEATURE_FLAGS.notificationsFull to restore it.
  if (!FEATURE_FLAGS.notificationsFull) {
    return (
      <div className="card">
        <div className="notif-locked-page">
          <span className="notif-locked-page-icon">
            <Icon name="lock" size={20} />
          </span>
          <div className="text-sm fw-medium mt-2">Notification history unlocks in Phase 2</div>
          <div className="text-xs text-grey mt-1" style={{ maxWidth: 360 }}>
            Goal, leave, punch and work-report updates will appear here once this
            feature is switched on.
            {notifications.length > 0
              ? ` ${notifications.length} waiting behind the scenes.`
              : ''}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
        <div className="input-icon-wrap" style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <input
            className="input"
            placeholder="Search notifications…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search notifications"
          />
        </div>
        <select
          className="select"
          style={{ width: 'auto' }}
          value={type}
          onChange={(e) => setType(e.target.value as NotificationType | 'all')}
          aria-label="Filter by type"
        >
          <option value="all">All types</option>
          {presentTypes.map((t) => (
            <option key={t} value={t}>
              {TYPE_META[t]?.label ?? t}
            </option>
          ))}
        </select>
        {notifications.length > 0 ? (
          <span className="notif-head-actions" style={{ marginLeft: 'auto' }}>
            {hasUnread ? (
              <button className="notif-head-action" onClick={markAllRead}>
                Mark all read
              </button>
            ) : null}
            <button className="notif-head-action" onClick={clearAll}>
              Clear all
            </button>
          </span>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="bell"
          title={notifications.length === 0 ? 'No notifications yet' : 'Nothing matches'}
          hint={
            notifications.length === 0
              ? 'Task assignments, leave updates and reminders will show up here.'
              : 'Try a different search or filter.'
          }
        />
      ) : sectioned ? (
        <div className="notif-list">
          {grouped.map(({ section, items }) => {
            const accent = section.department ? departmentColors[section.department] : undefined;
            return (
              <div className="notif-section" key={section.id}>
                <div className="notif-section-head">
                  <span
                    className={`notif-section-dot${section.kind === 'needs_action' ? ' warning' : ''}`}
                    style={accent ? { background: accent } : undefined}
                  />
                  <span className="notif-section-label">{section.label}</span>
                  <span className="notif-section-count">{items.length}</span>
                </div>
                {items.map(renderRow)}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="notif-list">{filtered.map(renderRow)}</div>
      )}
    </div>
  );
}
