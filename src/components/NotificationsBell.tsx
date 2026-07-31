'use client';

// Topbar notifications bell.
//
// Sources that feed the dropdown:
//   1. Derived app state the Shell already loads — working days not yet
//      logged, and (for the Board) leave requests waiting for a decision.
//   2. The `notifications` table — rows persisted when the Board assigns a
//      goal, a member submits a leave, or the Board reviews one. These
//      arrive LIVE: the component subscribes to Supabase Realtime INSERTs
//      scoped to the signed-in member, popping a toast + chime.
//   3. Transient teammate-punch events — the bell subscribes directly to
//      `punches`. These play a chime + toast but are NOT stored (would
//      otherwise drown out actionable notifications).
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from './Icon';
import { Avatar } from './ui';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import { createClient } from '@/lib/supabase/client';
import { markNotificationsRead, deleteNotification, clearNotifications } from '@/lib/actions';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import { playChime, playPunchChime } from '@/lib/sound';
import type { Notification, NotificationType } from '@/lib/types';
import {
  type SectionDef,
  classifyNotif,
  compareSections,
  isSectioned,
  PINNED_SECTION,
  NEEDS_SECTION,
  PERSONAL_SECTION,
} from '@/lib/notif-sections';

// A teammate currently connected to the dashboard (via Supabase presence).
// Carries the department fields needed to decide whether the signed-in member
// is allowed to see this teammate's online status (see `inPresenceScope`).
export interface OnlineUser {
  user_id: string;
  name: string;
  avatar_url: string | null;
  department: string;
  is_board: boolean;
  managed_department: string | null; // set when this teammate heads a department
}

// A short, human "x ago" label for a notification timestamp.
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

interface PanelItem {
  key: string;
  icon: IconName;
  title: string;
  detail: string;
  time?: string;        // short "x ago" label, shown on the title line
  href: string;
  tone: 'warning' | 'info';
  unread?: boolean;     // only meaningful for stored notifications
  dismissible?: boolean; // shows the × button
  notifId?: string;     // the DB row id, required when dismissible
  section: SectionDef;  // which grouped section this item belongs to
}

// Icon + tone per stored-notification type. Falls back to 'target' so any
// future type still renders something sensible.
const TYPE_META: Record<NotificationType, { icon: IconName; tone: 'warning' | 'info' }> = {
  goal_assigned: { icon: 'target', tone: 'info' },
  leave_requested: { icon: 'plane', tone: 'warning' },
  leave_approved: { icon: 'check', tone: 'info' },
  leave_rejected: { icon: 'x', tone: 'warning' },
  punch_missing: { icon: 'clock', tone: 'warning' },
  goal_due_soon: { icon: 'target', tone: 'warning' },
  work_anniversary: { icon: 'sparkles', tone: 'info' },
  birthday: { icon: 'sparkles', tone: 'info' },
  birthday_wish_reply: { icon: 'mail', tone: 'info' },
  work_report_submitted: { icon: 'inbox', tone: 'info' },
  work_report_reviewed: { icon: 'star', tone: 'info' },
  task_unlocked: { icon: 'lock', tone: 'info' },
  punch_change_requested: { icon: 'clock', tone: 'warning' },
  punch_change_approved: { icon: 'check', tone: 'info' },
  punch_change_rejected: { icon: 'x', tone: 'warning' },
};

export function NotificationsBell({
  userId,
  userName,
  userAvatarUrl,
  userDepartment,
  isManager,
  managedDepartment,
  pendingLeaves,
  isBoard,
  hasAvatar,
  hasDob,
  initialNotifications,
  departmentColors = {},
  mutedInApp = [],
  online = [],
}: {
  userId: string;
  userName: string;
  userAvatarUrl: string | null;
  userDepartment: string;
  isManager: boolean;
  managedDepartment: string | null;
  pendingLeaves: number;
  isBoard: boolean;
  hasAvatar: boolean;
  hasDob: boolean;
  initialNotifications: Notification[];
  departmentColors?: Record<string, string>;
  mutedInApp?: NotificationType[];
  online?: OnlineUser[];
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  // Types the member muted from the bell. Kept in a ref so the realtime handler
  // always sees the latest set without re-subscribing the channel.
  const mutedInAppRef = React.useRef<Set<NotificationType>>(new Set());
  mutedInAppRef.current = new Set(mutedInApp);
  const [open, setOpen] = React.useState(false);
  // Live list of stored notifications — seeded by the server, then kept in
  // sync by the Realtime subscription below.
  const [notifs, setNotifs] = React.useState<Notification[]>(initialNotifications);
  // Set when the onboarding tour ends; cleared once the member changes
  // their password in Settings. Lives in localStorage (a per-device pref).
  const [pwReminder, setPwReminder] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const read = () => {
      try {
        setPwReminder(
          localStorage.getItem('restruc:pw-reminder') === '1' &&
            localStorage.getItem('restruc:pw-changed') !== '1',
        );
      } catch {
        /* localStorage unavailable */
      }
    };
    read();
    window.addEventListener('restruc:notifs-changed', read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener('restruc:notifs-changed', read);
      window.removeEventListener('storage', read);
    };
  }, []);

  // Realtime — subscribe to INSERTs on `notifications` for this member only.
  // RLS ("notifications: read own") plus the user_id filter guarantee a
  // client only ever receives its own rows.
  React.useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const n = payload.new as Notification;
          if (mutedInAppRef.current.has(n.type)) return; // member muted this type
          setNotifs((cur) => (cur.some((x) => x.id === n.id) ? cur : [n, ...cur]));
          // Phase 1: these types are locked in the UI — keep syncing state
          // (for the locked row's count) but stay quiet.
          if (FEATURE_FLAGS.notificationsFull) {
            toast(n.body ? `${n.title}: ${n.body}` : n.title, 'warning');
            playChime();
          }
        },
      )
      // Keep an open tab in sync when rows change elsewhere — a read toggled on
      // another device, or a row cleared by the member / the nightly prune.
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const n = payload.new as Notification;
          setNotifs((cur) => cur.map((x) => (x.id === n.id ? n : x)));
        },
      )
      // DELETE payloads carry only the primary key (no user_id to filter on), so
      // we listen unfiltered and drop the id locally — a no-op if it isn't ours.
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'notifications' },
        (payload) => {
          const old = payload.old as { id?: string };
          if (old?.id) setNotifs((cur) => cur.filter((x) => x.id !== old.id));
        },
      )
      .subscribe();

    // After a stretch of being backgrounded the WebSocket may have dropped
    // events. Refetch the latest notifications on tab refocus to catch up.
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30);
      if (data) {
        setNotifs((cur) => {
          const known = new Set(cur.map((x) => x.id));
          // Muted types are excluded server-side on load and in the realtime
          // handler; this catch-up fetch must apply the same filter.
          const fresh = (data as Notification[]).filter(
            (n) => !known.has(n.id) && !mutedInAppRef.current.has(n.type),
          );
          return fresh.length ? [...fresh, ...cur] : cur;
        });
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, toast]);

  // Realtime — teammate punch in/out. Transient: chime + toast only, never
  // persisted (would otherwise dominate the bell). INSERT = punched in,
  // UPDATE where punch_out flips from null → set = punched out.
  //
  // Board members see batched toasts: events within a 3-second window are
  // grouped into a single message ("Alice and 2 others punched in") rather
  // than one toast per person.
  React.useEffect(() => {
    // Phase 1: punch in/out announcements are locked — skip the subscription
    // entirely rather than subscribe-and-mute.
    if (!FEATURE_FLAGS.notificationsFull) return;
    const supabase = createClient();
    const nameCache = new Map<string, string>();
    const batch = { ins: [] as string[], outs: [] as string[] };
    let batchTimer: ReturnType<typeof setTimeout> | null = null;

    const resolveName = async (uid: string): Promise<string> => {
      const hit = nameCache.get(uid);
      if (hit) return hit;
      const { data } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', uid)
        .maybeSingle();
      const name = data?.name ?? 'A teammate';
      nameCache.set(uid, name);
      return name;
    };

    const fmt = (names: string[], verb: string): string => {
      if (names.length === 1) return `${names[0]} ${verb}`;
      if (names.length === 2) return `${names[0]} and ${names[1]} ${verb}`;
      return `${names[0]} and ${names.length - 1} others ${verb}`;
    };

    const scheduleBatchFlush = () => {
      if (batchTimer) clearTimeout(batchTimer);
      batchTimer = setTimeout(() => {
        const ins = batch.ins.splice(0);
        const outs = batch.outs.splice(0);
        const parts = [
          ins.length ? fmt(ins, 'punched in') : '',
          outs.length ? fmt(outs, 'punched out') : '',
        ].filter(Boolean);
        if (parts.length) {
          toast(parts.join(' · '), 'success');
          playPunchChime();
        }
      }, 3000);
    };

    const channel = supabase
      .channel(`punches:announce:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'punches' },
        async (payload) => {
          const row = payload.new as { user_id: string };
          if (row.user_id === userId) {
            // Own punch-in: immediate chime, no toast
            playPunchChime();
            return;
          }
          if (!isBoard) return;
          const name = await resolveName(row.user_id);
          batch.ins.push(name);
          scheduleBatchFlush();
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'punches' },
        async (payload) => {
          const row = payload.new as { user_id: string; punch_out: string | null };
          const prev = payload.old as { punch_out: string | null };
          if (prev?.punch_out || !row.punch_out) return; // only the in→out flip
          if (row.user_id === userId) {
            // Own punch-out: immediate chime, no toast
            playPunchChime();
            return;
          }
          if (!isBoard) return;
          const name = await resolveName(row.user_id);
          batch.outs.push(name);
          scheduleBatchFlush();
        },
      )
      .subscribe();

    return () => {
      if (batchTimer) clearTimeout(batchTimer);
      supabase.removeChannel(channel);
    };
  }, [userId, isBoard, toast]);

  // Close the dropdown on an outside click or the Escape key.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Phase 1: stored notifications are locked out of the badge/list — only
  // the pinned device reminders count as "unread" for the bell.
  const unreadCount = FEATURE_FLAGS.notificationsFull
    ? notifs.filter((n) => !n.is_read).length
    : 0;

  // Opening the panel counts as "seen" — persist read state and clear the
  // unread badge. Done once per open, only when something is actually unread.
  const openPanel = () => {
    setOpen((o) => {
      const next = !o;
      if (next && unreadCount > 0) {
        setNotifs((cur) => cur.map((n) => ({ ...n, is_read: true })));
        markNotificationsRead().catch(() => {
          /* best-effort — the badge already cleared locally */
        });
      }
      return next;
    });
  };

  const dismiss = (id: string) => {
    setNotifs((cur) => cur.filter((n) => n.id !== id));
    deleteNotification(id).catch(() => {});
  };

  // Bulk controls. "Mark all read" clears the unread badge; "Clear all" removes
  // every stored notification (derived reminders like unlogged days stay, since
  // they recompute from app state). Both update locally first, then persist.
  const markAllRead = () => {
    setNotifs((cur) => cur.map((n) => ({ ...n, is_read: true })));
    markNotificationsRead().catch(() => {});
  };
  const clearAll = async () => {
    const ok = await confirm({
      title: 'Clear all notifications?',
      message: `This permanently removes ${notifs.length} notification${notifs.length > 1 ? 's' : ''}, including any unread. Reminders that recompute (unlogged days, leave reviews) will stay.`,
      confirmLabel: 'Clear all',
      tone: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    setNotifs([]);
    clearNotifications().catch(() => {});
  };

  // Which over-long sections the member has expanded (id -> shown in full).
  // Persisted so the bell doesn't re-collapse every open. Hydrated in an effect
  // (not the initializer) to keep server and client render identical.
  const EXPANDED_KEY = 'restruc:notif-expanded';
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(EXPANDED_KEY);
      if (raw) setExpanded(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* localStorage unavailable */
    }
  }, []);
  const toggleSection = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      try {
        localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      } catch {
        /* localStorage unavailable */
      }
      return next;
    });

  const viewer = { isBoard, isManager };
  const sectioned = isSectioned(viewer);

  // ---- build the dropdown list ----
  const items: PanelItem[] = [];

  // Profile picture missing — undismissable until they upload one.
  if (!hasAvatar) {
    items.push({
      key: 'avatar',
      icon: 'user',
      title: 'Upload your profile picture',
      detail: 'A photo helps your team recognise you',
      href: '/settings',
      tone: 'warning',
      section: PINNED_SECTION,
    });
  }

  // Date of birth missing — undismissable until they set one.
  if (!hasDob) {
    items.push({
      key: 'dob',
      icon: 'calendar',
      title: 'Add your date of birth',
      detail: 'So your team can celebrate with you',
      href: '/settings',
      tone: 'warning',
      section: PINNED_SECTION,
    });
  }

  // Security reminder from finishing the onboarding tour — keep it on top.
  if (pwReminder) {
    items.push({
      key: 'pw',
      icon: 'lock',
      title: 'Change your password',
      detail: 'Set a password only you know in Settings',
      href: '/settings',
      tone: 'warning',
      section: PINNED_SECTION,
    });
  }

  // Stored notifications — goal assignments + leave events, newest first.
  // Phase 1: locked; contribute to hiddenCount below instead of the list.
  if (FEATURE_FLAGS.notificationsFull) {
    notifs.forEach((n) => {
      const meta = TYPE_META[n.type] ?? { icon: 'target', tone: 'info' };
      items.push({
        key: 'n-' + n.id,
        icon: meta.icon,
        title: n.title,
        detail: n.body ?? '',
        time: timeAgo(n.created_at),
        href: n.href || '/goals',
        tone: meta.tone,
        unread: !n.is_read,
        dismissible: true,
        notifId: n.id,
        section: classifyNotif(n.type, n.department, viewer),
      });
    });
  }

  // Board members see leave requests that still need a decision.
  if (FEATURE_FLAGS.notificationsFull && isBoard && pendingLeaves > 0) {
    items.push({
      key: 'leaves',
      icon: 'plane',
      title:
        pendingLeaves === 1
          ? '1 leave request needs review'
          : `${pendingLeaves} leave requests need review`,
      detail: 'Open the Leaves page to approve or decline',
      href: '/leaves',
      tone: 'info',
      section: NEEDS_SECTION,
    });
  }

  // How many locked notifications are waiting behind the Phase 2 gate —
  // shown as a small count in the locked row, not counted in the badge.
  const hiddenCount = FEATURE_FLAGS.notificationsFull
    ? 0
    : notifs.length + (isBoard && pendingLeaves > 0 ? pendingLeaves : 0);

  // Badge counts the genuinely-actionable items: every derived reminder plus
  // any not-yet-seen notification.
  const derivedCount = items.filter((i) => i.unread === undefined).length;
  const count = derivedCount + unreadCount;

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  // Clicking a stored notification means the member has seen it — dismiss it
  // (remove from the bell + delete the row) as we navigate, so a notification
  // they've already opened doesn't linger. Derived reminders (unlogged days,
  // pending leaves) just navigate; they recompute from app state on their own.
  const openItem = (n: PanelItem) => {
    if (n.dismissible && n.notifId) {
      setNotifs((cur) => cur.filter((x) => x.id !== n.notifId));
      deleteNotification(n.notifId).catch(() => {});
    }
    go(n.href);
  };

  // Group items into ordered sections (Board / Manager only). Items keep their
  // newest-first order within each section; section order comes from
  // compareSections (Needs action -> departments A-Z -> Company -> Personal).
  const COLLAPSE_AT = 4;
  const grouped: { section: SectionDef; items: PanelItem[] }[] = [];
  if (sectioned) {
    const map = new Map<string, { section: SectionDef; items: PanelItem[] }>();
    for (const it of items) {
      const g = map.get(it.section.id);
      if (g) g.items.push(it);
      else map.set(it.section.id, { section: it.section, items: [it] });
    }
    grouped.push(
      ...[...map.values()].sort((a, b) => compareSections(a.section, b.section)),
    );
  }

  // One notification row — shared by the flat and sectioned layouts.
  const renderRow = (n: PanelItem) => (
    <div key={n.key} style={{ display: 'flex', alignItems: 'stretch' }}>
      <button
        className={`notif-item${n.unread ? ' unread' : ''}`}
        style={{ flex: 1, minWidth: 0 }}
        onClick={() => openItem(n)}
      >
        <span className={`notif-item-icon ${n.tone}`}>
          <Icon name={n.icon} size={15} />
        </span>
        <span className="notif-item-text">
          <span className="text-sm fw-medium notif-item-title">{n.title}</span>
          {n.detail || n.time ? (
            <span className="notif-item-bottomrow">
              <span className="text-xs text-grey notif-item-detail">{n.detail}</span>
              {n.time ? <span className="notif-item-time">{n.time}</span> : null}
            </span>
          ) : null}
        </span>
        {n.unread ? <span className="notif-dot" aria-label="Unread" /> : null}
        {!n.dismissible ? <Icon name="chevron-right" size={14} /> : null}
      </button>
      {n.dismissible && n.notifId ? (
        <button
          onClick={() => dismiss(n.notifId!)}
          title="Dismiss"
          aria-label="Dismiss notification"
          style={{
            padding: '0 12px',
            flexShrink: 0,
            color: 'var(--color-grey-text)',
            borderLeft: '1px solid var(--color-border)',
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          <Icon name="x" size={13} />
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        className="icon-btn"
        onClick={openPanel}
        title="Notifications"
        aria-label={`Notifications${count ? ` (${count})` : ''}`}
      >
        <Icon name="bell" size={16} />
        {count > 0 ? <span className="notif-badge">{count > 9 ? '9+' : count}</span> : null}
      </button>

      {open ? (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-panel-head">
            <span className="fw-bold">Notifications</span>
            {FEATURE_FLAGS.notificationsFull && notifs.length > 0 ? (
              <span className="notif-head-actions">
                {unreadCount > 0 ? (
                  <button className="notif-head-action" onClick={markAllRead}>
                    Mark all read
                  </button>
                ) : null}
                <button className="notif-head-action" onClick={clearAll}>
                  Clear all
                </button>
              </span>
            ) : (
              <span className="text-xs text-grey">
                {items.length === 0
                  ? 'Nothing new'
                  : `${items.length} item${items.length > 1 ? 's' : ''}`}
              </span>
            )}
          </div>

          {online.length > 0 ? (
            <div className="notif-online">
              <div className="notif-online-head">
                <span className="notif-online-dot" />
                Online now · {online.length}
              </div>
              <div className="notif-online-chips">
                {online.map((u) => (
                  <span key={u.user_id} className="notif-online-chip">
                    <Avatar name={u.name} size="sm" src={u.avatar_url} />
                    <span>{u.name}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {items.length === 0 ? (
            <div className="notif-empty">
              <Icon name="check" size={26} />
              <div className="text-sm fw-medium mt-2">You are all caught up</div>
              <div className="text-xs text-grey mt-1">
                {FEATURE_FLAGS.notificationsFull
                  ? 'New task assignments, logs and leaves will show up here.'
                  : 'Profile and security reminders will show up here.'}
              </div>
            </div>
          ) : sectioned ? (
            <div className="notif-list">
              {grouped.map(({ section, items: secItems }) => {
                const isExp = expanded.has(section.id);
                const shown = isExp ? secItems : secItems.slice(0, COLLAPSE_AT);
                const hidden = secItems.length - shown.length;
                const accent = section.department
                  ? departmentColors[section.department]
                  : undefined;
                return (
                  <div className="notif-section" key={section.id}>
                    <div className="notif-section-head">
                      <span
                        className={`notif-section-dot${section.kind === 'needs_action' ? ' warning' : ''}`}
                        style={accent ? { background: accent } : undefined}
                      />
                      <span className="notif-section-label">{section.label}</span>
                      <span className="notif-section-count">{secItems.length}</span>
                    </div>
                    {shown.map(renderRow)}
                    {hidden > 0 ? (
                      <button
                        className="notif-section-more"
                        onClick={() => toggleSection(section.id)}
                      >
                        +{hidden} more
                      </button>
                    ) : isExp && secItems.length > COLLAPSE_AT ? (
                      <button
                        className="notif-section-more"
                        onClick={() => toggleSection(section.id)}
                      >
                        Show less
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="notif-list">{items.map(renderRow)}</div>
          )}

          {!FEATURE_FLAGS.notificationsFull ? (
            <div className="notif-locked">
              <span className="notif-locked-icon">
                <Icon name="lock" size={14} />
              </span>
              <span className="notif-locked-text">
                <span className="text-sm fw-medium">More notifications</span>
                <span className="text-xs text-grey">
                  Goal, leave &amp; punch updates
                  {hiddenCount > 0 ? ` · ${hiddenCount} waiting` : ''}
                </span>
              </span>
              <span className="notif-locked-pill">Phase 2</span>
            </div>
          ) : null}

          <button className="notif-see-all" onClick={() => go('/notifications')}>
            See all notifications
            <Icon name="chevron-right" size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
