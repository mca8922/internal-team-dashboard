'use client';

// App shell — Sidebar + TopBar. Ported from components-layout.jsx. Theme +
// sidebar-collapse state persists in localStorage (these are pure
// client-side prefs, not domain data).
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './Icon';
import { Avatar } from './ui';
import { OnboardingTour } from './OnboardingTour';
import { CommandPalette } from './CommandPalette';
import { MilestoneCelebration } from './MilestoneCelebration';
import { MilestoneAmbiance } from './MilestoneAmbiance';
import { HolidayCelebration } from './HolidayCelebration';
import { BirthdayCelebration } from './BirthdayCelebration';
import { NotificationsBell, type OnlineUser } from './NotificationsBell';
import { createClient } from '@/lib/supabase/client';
import { playPresenceChime } from '@/lib/sound';
import { useToast } from './Toast';
import { signOut } from '@/lib/auth-actions';
import { roleLabel, isManager, isFounder } from '@/lib/roles';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import { AvatarLightbox } from '@/components/AvatarLightbox';
import { fmtTimeFull, fmtFriendly, fmtDateDMY, parseDate } from '@/lib/dates';
import { getThemePref, setThemePref, applyTheme, type ThemePref } from '@/lib/theme';
import { useThemePref } from '@/lib/useThemePref';
import type { Profile, Notification, NotificationType, Holiday } from '@/lib/types';

const LOGO_LINES = ['MAHESH CHANDRA', '& ASSOCIATES'] as const;

function ResLogo({ collapsed }: { collapsed: boolean }) {
  // Expanded: the "Mahesh Chandra & Associates" wordmark, split across two
  // lines with the same per-letter ignite/glow animation the old wordmark
  // used. Collapsed: just the circular logo mark (same image as the
  // browser-tab favicon) so the rail still reads as branded.
  let charIndex = 0;
  return (
    <div className="sidebar-logo">
      {collapsed ? (
        <img src="/logo-dark.png" alt="Mahesh Chandra & Associates" className="sidebar-logo-img" />
      ) : (
        <div className="logo-text logo-text--mca">
          {LOGO_LINES.map((line, li) => (
            <div className="logo-line" key={li}>
              {line.split('').map((ch, ci) => {
                const i = charIndex++;
                return ch === ' ' ? (
                  <span key={ci} className="logo-char-space">&nbsp;</span>
                ) : (
                  <span key={ci} className="logo-char" style={{ '--i': i } as React.CSSProperties}>
                    {ch}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// `locked` keeps an entry visible but marks it as not yet switched on — the
// item still navigates, to a page that explains when it opens. Hiding it would
// be the other valid choice; showing it is how the team learns it is coming.
type NavItem = { label: string; icon: 'home' | 'clock' | 'edit' | 'target' | 'users' | 'chart' | 'monitor' | 'inbox' | 'plane' | 'mail' | 'settings' | 'help-circle'; path: string; tier?: string; isNew?: boolean; locked?: boolean };

function isNavItemActive(pathname: string, item: NavItem) {
  return item.path === '/team'
    ? pathname === '/team' || (pathname.startsWith('/team/') && !pathname.startsWith('/team/requests'))
    : pathname.startsWith(item.path);
}

// Shared nav-item groups — consumed by the desktop Sidebar, the mobile
// bottom tab bar, and the mobile "More" sheet so all three stay in sync.
function buildNavGroups(user: Profile) {
  const isBoard = user.role === 'board';
  const isMgr = isManager(user);

  const LAUNCH = new Date('2026-06-29').getTime();
  const showNewBadge = Date.now() - LAUNCH < 7 * 24 * 60 * 60 * 1000;

  const workspaceItems: NavItem[] = [
    { label: 'Dashboard', icon: 'home',   path: '/dashboard' },
    { label: 'Punch',     icon: 'clock',  path: '/punch' },
    ...(FEATURE_FLAGS.dailyLog ? [{ label: 'Daily Log', icon: 'edit' as const, path: '/log' }] : []),
    ...(FEATURE_FLAGS.apps ? [{ label: 'Apps', icon: 'monitor' as const, path: '/apps', isNew: showNewBadge }] : []),
    { label: 'Tasks',     icon: 'target', path: '/goals' },
    { label: 'Analytics', icon: 'chart',  path: '/analytics' },
    { label: 'Leaves',    icon: 'plane',  path: '/leaves' },
  ];

  const leadershipItems: NavItem[] = (isBoard || isMgr) ? [
    { label: 'Team',     icon: 'users', path: '/team',          tier: 'lead' },
    ...(FEATURE_FLAGS.teamRequests ? [{ label: 'Requests', icon: 'inbox' as const, path: '/team/requests', tier: 'lead' }] : []),
    ...(FEATURE_FLAGS.emails ? [{ label: 'Emails', icon: 'mail' as const, path: '/email', tier: 'lead' }] : []),
  ] : [];

  const toolsItems: NavItem[] = [
    // Never role-gated, unlike everything around it: someone locked out of
    // their own record — offboarded, or read-only after a hand-off — is exactly
    // who needs to reach support, so this entry survives even when it is the
    // only thing left in the group.
    //
    // Phase 1 shows it LOCKED rather than removing it. That is the one thing
    // the flag does not take away: the entry, and the promise it is coming.
    { label: 'Support', icon: 'help-circle', path: '/support', locked: !FEATURE_FLAGS.support },
    { label: 'Settings', icon: 'settings', path: '/settings' },
  ];

  return { isBoard, isMgr, workspaceItems, leadershipItems, toolsItems };
}

const Sidebar = React.memo(function Sidebar({
  user,
  collapsed,
  pendingLeaves,
  pendingRequests,
}: {
  user: Profile;
  collapsed: boolean;
  pendingLeaves: number;
  pendingRequests: number;
}) {
  const pathname = usePathname();
  const { isBoard, isMgr, workspaceItems, leadershipItems, toolsItems } = buildNavGroups(user);

  const renderItem = (item: NavItem) => {
    const active = isNavItemActive(pathname, item);
    return (
      <Link
        key={item.path}
        href={item.path}
        data-tour={'nav-' + item.path.slice(1)}
        className={`nav-item ${active ? 'active' : ''}${item.locked ? ' nav-item--locked' : ''}`}
        title={collapsed ? `${item.label}${item.locked ? ' — unlocks in Phase 2' : ''}` : ''}
      >
        <Icon name={item.icon} size={17} />
        <span className="label">{item.label}</span>
        <span className="nav-item-right">
          {item.locked && (
            <span className="nav-lock" title="Unlocks in Phase 2" aria-label="Unlocks in Phase 2">
              <Icon name="lock" size={13} />
            </span>
          )}
          {item.isNew && <span className="nav-new-pill">NEW</span>}
          {item.tier && <span className={`nav-tier nav-tier--${item.tier}`}>★</span>}
          {item.path === '/leaves' && isBoard && pendingLeaves > 0 && (
            <span className="nav-badge">{pendingLeaves}</span>
          )}
          {item.path === '/team/requests' && pendingRequests > 0 && (
            <span className="nav-badge">{pendingRequests}</span>
          )}
        </span>
      </Link>
    );
  };

  return (
    <aside className="sidebar" data-tour="sidebar">
      <ResLogo collapsed={collapsed} />
      <div className="sidebar-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, overflow: 'auto' }}>

        {!collapsed && <div className="sidebar-section-label">Workspace</div>}
        {workspaceItems.map(renderItem)}

        {leadershipItems.length > 0 && <>
          {!collapsed && <div className="sidebar-section-label" style={{ marginTop: 8 }}>Leadership</div>}
          {leadershipItems.map(renderItem)}
        </>}

        {!collapsed && <div className="sidebar-section-label" style={{ marginTop: 8 }}>Tools</div>}
        {toolsItems.map(renderItem)}
      </div>
      <div className="sidebar-user">
        <div className="avatar-wrap">
          <Avatar name={user.name} size="sm" src={user.avatar_url} />
          <span className="online-dot" />
        </div>
        <div className="user-info">
          <div className="name">{user.name}</div>
          <div className={`role-pill${user.role === 'board' ? ' role-pill--board' : isMgr ? ' role-pill--mgr' : ''}`}>
            {roleLabel(user.role)}
          </div>
        </div>
        <form action={signOut}>
          <button className="logout-btn" title="Log out" type="submit">
            <Icon name="logout" size={16} />
          </button>
        </form>
      </div>
    </aside>
  );
});

// Primary phone-nav destinations — the four screens people reach for daily.
// Everything else (Analytics, Leaves, Team, Requests, Emails, Apps, Settings)
// lives one tap away behind "More".
const MOBILE_PRIMARY_ITEMS: NavItem[] = [
  { label: 'Home',  icon: 'home',   path: '/dashboard' },
  { label: 'Punch', icon: 'clock',  path: '/punch' },
  ...(FEATURE_FLAGS.dailyLog ? [{ label: 'Log', icon: 'edit' as const, path: '/log' }] : []),
  { label: 'Tasks', icon: 'target', path: '/goals' },
];

function BottomNav({
  pendingLeaves,
  pendingRequests,
  onOpenMore,
}: {
  pendingLeaves: number;
  pendingRequests: number;
  onOpenMore: () => void;
}) {
  const pathname = usePathname();
  const moreActive = !MOBILE_PRIMARY_ITEMS.some((item) => isNavItemActive(pathname, item));
  const moreBadge = pendingLeaves > 0 || pendingRequests > 0;

  return (
    <nav className="bottom-nav" data-tour="bottom-nav">
      {MOBILE_PRIMARY_ITEMS.map((item) => {
        const active = isNavItemActive(pathname, item);
        return (
          <Link
            key={item.path}
            href={item.path}
            data-tour={item.path === '/goals' ? 'nav-goals' : undefined}
            className={`bottom-nav-item${active ? ' active' : ''}`}
          >
            <Icon name={item.icon} size={20} />
            <span>{item.label}</span>
          </Link>
        );
      })}
      <button type="button" className={`bottom-nav-item${moreActive ? ' active' : ''}`} onClick={onOpenMore}>
        <span className="bottom-nav-more-icon">
          <Icon name="more-vertical" size={20} />
          {moreBadge && <span className="bottom-nav-dot" />}
        </span>
        <span>More</span>
      </button>
    </nav>
  );
}

// The rest of the sidebar's nav, surfaced as a bottom sheet on phones so it
// never eats permanent screen width the way the old icon-only rail did.
function MoreSheet({
  open,
  onClose,
  user,
  pendingLeaves,
  pendingRequests,
}: {
  open: boolean;
  onClose: () => void;
  user: Profile;
  pendingLeaves: number;
  pendingRequests: number;
}) {
  const pathname = usePathname();
  const { isBoard, isMgr, workspaceItems, leadershipItems, toolsItems } = buildNavGroups(user);
  const primaryPaths = new Set(MOBILE_PRIMARY_ITEMS.map((item) => item.path));
  const secondaryWorkspace = workspaceItems.filter((item) => !primaryPaths.has(item.path));

  React.useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  const tourTag: Record<string, string> = {
    '/team': 'nav-team',
    '/analytics': 'nav-analytics',
    '/leaves': 'nav-leaves',
    '/settings': 'nav-settings',
  };

  const renderItem = (item: NavItem) => {
    const active = isNavItemActive(pathname, item);
    return (
      <Link
        key={item.path}
        href={item.path}
        onClick={onClose}
        data-tour={tourTag[item.path]}
        className={`more-sheet-item${active ? ' active' : ''}${item.locked ? ' nav-item--locked' : ''}`}
      >
        <Icon name={item.icon} size={18} />
        <span className="label">{item.label}</span>
        <span className="nav-item-right">
          {item.locked && (
            <span className="nav-lock" title="Unlocks in Phase 2" aria-label="Unlocks in Phase 2">
              <Icon name="lock" size={13} />
            </span>
          )}
          {item.isNew && <span className="nav-new-pill">NEW</span>}
          {item.tier && <span className={`nav-tier nav-tier--${item.tier}`}>★</span>}
          {item.path === '/leaves' && isBoard && pendingLeaves > 0 && (
            <span className="nav-badge">{pendingLeaves}</span>
          )}
          {item.path === '/team/requests' && pendingRequests > 0 && (
            <span className="nav-badge">{pendingRequests}</span>
          )}
        </span>
      </Link>
    );
  };

  return (
    <>
      <div className="more-sheet-backdrop" onClick={onClose} />
      <div className="more-sheet" role="dialog" aria-modal="true" aria-label="More navigation">
        <div className="more-sheet-handle" />
        <div className="more-sheet-user">
          <Avatar name={user.name} size="sm" src={user.avatar_url} />
          <div className="user-info">
            <div className="name">{user.name}</div>
            <div className={`role-pill${user.role === 'board' ? ' role-pill--board' : isMgr ? ' role-pill--mgr' : ''}`}>
              {roleLabel(user.role)}
            </div>
          </div>
          <form action={signOut}>
            <button className="logout-btn" title="Log out" type="submit">
              <Icon name="logout" size={16} />
            </button>
          </form>
        </div>

        <div className="more-sheet-section-label">Workspace</div>
        {secondaryWorkspace.map(renderItem)}

        {leadershipItems.length > 0 && <>
          <div className="more-sheet-section-label">Leadership</div>
          {leadershipItems.map(renderItem)}
        </>}

        <div className="more-sheet-section-label">Tools</div>
        {toolsItems.map(renderItem)}
      </div>
    </>
  );
}

// The live clock ticks every second. Isolated in its own memoized component
// so its per-second state update does not re-render the whole TopBar (and
// with it the notifications bell) sixty times a minute.
const Clock = React.memo(function Clock() {
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  // Date and time are separate spans so the topbar can drop the date on narrow
  // phones (where the whole right-hand pill would otherwise outgrow the screen)
  // without the clock disappearing entirely.
  return (
    <div className="clock">
      {now ? (
        <>
          <span className="clock-date">{fmtDateDMY(now)}</span>
          <span className="clock-sep"> | </span>
          <span className="clock-time">{fmtTimeFull(now)}</span>
        </>
      ) : (
        ''
      )}
    </div>
  );
});

function OnlineNowStrip({ online, max }: { online: OnlineUser[]; max: number }) {
  const [hovered, setHovered] = React.useState(false);
  if (online.length === 0) return null;
  const shown = online.slice(0, max);
  const overflow = online.length - max;

  return (
    <div
      className="topbar-online-strip"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="topbar-online-avatars">
        {shown.map((u) => (
          <div key={u.user_id} className="topbar-online-avatar-wrap" title={u.name}>
            <Avatar name={u.name} size="sm" src={u.avatar_url} />
          </div>
        ))}
        {overflow > 0 && (
          <div className="topbar-online-overflow">+{overflow}</div>
        )}
      </div>
      {hovered && (
        <div className="topbar-online-tooltip">
          <div className="topbar-online-tooltip-head">
            <span className="topbar-online-dot" />
            {online.length} online now
          </div>
          <div className="topbar-online-tooltip-list">
            {online.map((u) => (
              <div key={u.user_id} className="topbar-online-tooltip-row">
                <Avatar name={u.name} size="sm" src={u.avatar_url} />
                <span>{u.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TopBar({
  user,
  themePref,
  onCycleTheme,
  onToggleSidebar,
  pendingLeaves,
  notifications,
  mutedInApp,
  deptColor,
  deptColors,
  online,
  stripMax,
  onlineBell,
  holidayToday,
}: {
  user: Profile;
  themePref: ThemePref;
  onCycleTheme: () => void;
  onToggleSidebar: () => void;
  pendingLeaves: number;
  notifications: Notification[];
  mutedInApp: NotificationType[];
  deptColor: string | null;
  deptColors: Record<string, string>;
  online: OnlineUser[];
  stripMax: number;
  onlineBell: OnlineUser[];
  holidayToday: Holiday | null;
}) {
  const pathname = usePathname();

  const labels: Record<string, string> = {
    dashboard: 'Dashboard',
    punch: 'Punch',
    log: 'Daily Log',
    goals: 'Tasks',
    manage: 'Manage',
    team: 'Team',
    requests: 'Change requests',
    analytics: 'Analytics',
    apps: 'Apps',
    leaves: 'Leaves',
    settings: 'Settings',
    history: 'History',
    email: 'Emails',
    notifications: 'Notifications',
  };
  const crumbs = pathname.split('/').filter(Boolean).map((p) => labels[p] || p);
  const onDashboard = pathname === '/dashboard';

  return (
    <div className="topbar">
      <button className="icon-btn sidebar-toggle-btn" onClick={onToggleSidebar} title="Toggle sidebar">
        <Icon name="sidebar" size={16} />
      </button>
      {onDashboard && user.department ? (
        // A warmer, branded title on the home screen: "Dashboard of <Dept>
        // Department", the department name tinted with its own accent colour.
        <div className="crumb crumb-dash">
          <span>Dashboard of</span>
          <span
            className="dept-name"
            style={
              deptColor
                ? ({ '--dept': deptColor } as React.CSSProperties)
                : undefined
            }
          >
            {user.department}
          </span>
          <span>Department</span>
        </div>
      ) : (
        <div className="crumb">
          {crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 ? (
                <span style={{ margin: '0 6px', color: 'var(--color-grey-text)' }}>/</span>
              ) : null}
              <strong
                style={
                  i === crumbs.length - 1
                    ? undefined
                    : { fontWeight: 400, color: 'var(--color-grey-text)' }
                }
              >
                {c}
              </strong>
            </span>
          ))}
        </div>
      )}
      <div className="topbar-spacer" />
      <div className="topbar-right">
        {holidayToday ? (
          <span className="badge badge-amber" title={holidayToday.name}>
            🎉 Holiday · {holidayToday.name}
          </span>
        ) : null}
        <OnlineNowStrip online={online} max={stripMax} />
        <Clock />
        <button
          className="icon-btn"
          data-tour="topbar-theme"
          onClick={onCycleTheme}
          title={`Theme: ${themePref} (click to change)`}
        >
          <Icon
            name={themePref === 'device' ? 'monitor' : themePref === 'dark' ? 'moon' : 'sun'}
            size={16}
          />
        </button>
        <span data-tour="topbar-bell" style={{ display: 'inline-flex' }}>
          <NotificationsBell
            userId={user.id}
            userName={user.name}
            userAvatarUrl={user.avatar_url}
            userDepartment={user.department}
            isManager={user.is_manager}
            managedDepartment={user.managed_department}
            pendingLeaves={pendingLeaves}
            isBoard={user.role === 'board'}
            hasAvatar={!!user.avatar_url}
            hasDob={!!user.date_of_birth}
            initialNotifications={notifications}
            departmentColors={deptColors}
            mutedInApp={mutedInApp}
            online={onlineBell}
          />
        </span>
        <AvatarLightbox
          name={user.name}
          avatarUrl={user.avatar_url}
          roleBadge={isFounder(user) ? 'Founder' : user.role === 'board' ? 'Director' : null}
          jobTitle={user.job_title || null}
          department={user.department}
          joinedLabel={fmtFriendly(parseDate(user.joined_date))}
          online={true}
          lastSeenLabel="Online now"
          triggerSize="sm"
          hintAlign="right"
        />
      </div>
    </div>
  );
}

export function Shell({
  user,
  pendingLeaves,
  notifications,
  mutedInApp,
  deptColor,
  deptColors,
  pendingRequests,
  holidayToday,
  children,
}: {
  user: Profile;
  pendingLeaves: number;
  notifications: Notification[];
  mutedInApp: NotificationType[];
  deptColor: string | null;
  deptColors: Record<string, string>;
  pendingRequests: number;
  holidayToday: Holiday | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Shared with the Appearance picker in Settings — both read the one store.
  const themePref = useThemePref();
  const [collapsed, setCollapsed] = React.useState(false);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [online, setOnline] = React.useState<OnlineUser[]>([]);
  // How many online avatars the topbar has room to show. Computed by watching
  // the topbar element width — each avatar is 28px wide with a 7px overlap,
  // so 21px of net space per additional avatar after the first.
  const [stripMax, setStripMax] = React.useState(8);
  const toast = useToast();

  React.useEffect(() => {
    // querySelector is safe here: Shell renders exactly one .topbar in the DOM.
    const el = document.querySelector('.topbar') as HTMLElement | null;
    if (!el) return;
    const compute = () => {
      // Fixed overhead: sidebar-toggle(32) + topbar-padding(48) + min-crumb(60)
      // + clock(155) + theme-btn(32) + bell(32) + profile-avatar(28)
      // + 5 gaps in pill(50) + pill-padding(22) = ~459, rounded to 480 for safety.
      const FIXED = 480;
      const available = el.offsetWidth - FIXED;
      if (available < 28) { setStripMax(0); return; }
      // First avatar: 28px, each additional: 21px (28 - 7 overlap)
      setStripMax(Math.floor((available - 28) / 21) + 1);
    };
    const obs = new ResizeObserver(compute);
    obs.observe(el);
    compute();
    return () => obs.disconnect();
  }, []);

  // Presence — one subscription at the Shell level so both the topbar strip
  // and the bell dropdown share the same live list without opening two channels.
  React.useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel('online-users', {
      config: { presence: { key: user.id } },
    });
    const known = new Set<string>();
    let ready = false;

    const userIsManager = isManager(user);
    const myDept = userIsManager ? user.managed_department ?? user.department : user.department;
    const userIsBoard = user.role === 'board';

    const inScope = (u: OnlineUser): boolean => {
      if (userIsBoard) return true;
      if (u.is_board) return true;
      if (u.department === myDept) return true;
      if (u.managed_department && u.managed_department === myDept) return true;
      return false;
    };

    const recompute = () => {
      const state = channel.presenceState<{
        user_id: string;
        name: string;
        avatar_url: string | null;
        department: string;
        is_board: boolean;
        managed_department: string | null;
      }>();
      const byId = new Map<string, OnlineUser>();
      Object.values(state).forEach((entries) =>
        entries.forEach((p) =>
          byId.set(p.user_id, {
            user_id: p.user_id,
            name: p.name,
            avatar_url: p.avatar_url ?? null,
            department: p.department ?? '',
            is_board: p.is_board ?? false,
            managed_department: p.managed_department ?? null,
          }),
        ),
      );
      const all = [...byId.values()].filter((u) => u.user_id !== user.id && inScope(u));
      if (ready) {
        all.forEach((u) => {
          if (!known.has(u.user_id)) {
            toast(`${u.name} is online`, 'success');
            playPresenceChime();
          }
        });
      }
      known.clear();
      all.forEach((u) => known.add(u.user_id));
      setOnline(all.sort((a, b) => a.name.localeCompare(b.name)));
    };

    channel
      .on('presence', { event: 'sync' }, recompute)
      .on('presence', { event: 'join' }, recompute)
      .on('presence', { event: 'leave' }, recompute)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user_id: user.id,
            name: user.name,
            avatar_url: user.avatar_url,
            department: user.department,
            is_board: userIsBoard,
            managed_department: userIsManager ? user.managed_department : null,
          });
          setTimeout(() => { ready = true; }, 1200);
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [user.id, user.name, user.avatar_url, user.department, user.role, user.managed_department, user.is_manager, toast]);

  // Restore client prefs and start following the OS in 'device' mode. The
  // preference itself comes from useThemePref() above; this only has to paint
  // it, since the server-rendered markup could not.
  React.useEffect(() => {
    applyTheme(getThemePref());
    setCollapsed(localStorage.getItem('restruc:sidebar') === 'collapsed');

    // When the preference is 'device', re-resolve whenever the OS flips.
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (getThemePref() === 'device') applyTheme('device');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Topbar button cycles light -> dark -> device -> light.
  const cycleTheme = () => {
    const order: ThemePref[] = ['light', 'dark', 'device'];
    const next = order[(order.indexOf(themePref) + 1) % order.length];
    setThemePref(next);
  };
  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('restruc:sidebar', next ? 'collapsed' : 'expanded');
  };

  // The "More" sheet is a navigation overlay — always dismiss it once the
  // route it just navigated to has actually changed.
  React.useEffect(() => { setMoreOpen(false); }, [pathname]);

  return (
    <div className="app-shell" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
      <Sidebar
        user={user}
        collapsed={collapsed}
        pendingLeaves={pendingLeaves}
        pendingRequests={pendingRequests}
      />
      <div className="main">
        <MilestoneAmbiance
          joinedDate={user.joined_date}
          role={user.role}
          internshipMonths={user.internship_months}
        />
        <TopBar
          user={user}
          themePref={themePref}
          onCycleTheme={cycleTheme}
          onToggleSidebar={toggleSidebar}
          pendingLeaves={pendingLeaves}
          notifications={notifications}
          mutedInApp={mutedInApp}
          deptColor={deptColor}
          deptColors={deptColors}
          online={online}
          stripMax={stripMax}
          onlineBell={online.slice(stripMax)}
          holidayToday={holidayToday}
        />
        <div className="page fade-in" key={pathname}>
          {children}
        </div>
      </div>
      <BottomNav
        pendingLeaves={pendingLeaves}
        pendingRequests={pendingRequests}
        onOpenMore={() => setMoreOpen(true)}
      />
      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        user={user}
        pendingLeaves={pendingLeaves}
        pendingRequests={pendingRequests}
      />
      <OnboardingTour isBoard={user.role === 'board'} isMgr={isManager(user)} tourSeen={user.tour_seen} />
      <CommandPalette isBoard={user.role === 'board'} isMgr={isManager(user)} />
      <MilestoneCelebration
        userId={user.id}
        name={user.name}
        joinedDate={user.joined_date}
        role={user.role}
        internshipMonths={user.internship_months}
      />
      {holidayToday ? (
        <HolidayCelebration date={holidayToday.holiday_date} name={holidayToday.name} />
      ) : null}
      <BirthdayCelebration userId={user.id} name={user.name} dateOfBirth={user.date_of_birth} />
    </div>
  );
}
