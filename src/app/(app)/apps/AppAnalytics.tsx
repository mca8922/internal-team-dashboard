'use client';

// Board-only App Analytics section. Sits at the bottom of /apps.
// SVG daily-activity timeline + per-app breakdown with skeleton loading,
// staggered row entrance, and count-up animation on stat values.
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/Icon';
import { getAppAnalytics } from './app-analytics';
import type { AppAnalyticsResult, AppClickStat, MemberClickStat, DayClick } from './app-analytics';
import { appIconName } from './AppsView';

const PERIODS = [
  { label: '7d',  days: 7  },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
] as const;

// Animates a number from 0 to target when the component mounts/remounts.
function useCountUp(target: number): number {
  const [display, setDisplay] = React.useState(0);
  const rafRef = React.useRef(0);

  React.useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const start = performance.now();
    const dur   = 600;

    const tick = (now: number) => {
      const t    = Math.min(1, (now - start) / dur);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(target * ease));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target]);

  return display;
}

// Shimmer skeleton shown while a new period loads.
function AnalyticsSkeleton() {
  return (
    <>
      <div className="ach-summary">
        {[0, 1, 2].map(i => (
          <div key={i} className="ach-stat-card ach-skeleton" style={{ minHeight: 80 }} />
        ))}
      </div>
      <div className="ach-skeleton ach-skeleton-chart" />
      <div className="ach-list">
        {[0, 1, 2].map(i => (
          <div key={i} className="ach-skeleton ach-skeleton-row" />
        ))}
      </div>
    </>
  );
}

// Popover shown when hovering (or focusing/tapping) a bar — who opened this
// app on this day, and when. Portal-positioned (fixed, edge-clamped) so it's
// never clipped by the card's own overflow and always lands on-screen
// regardless of where the bar sits — same technique as DatePicker / the Team
// Analytics info popover.
const DAY_POP_W = 250;
const DAY_POP_H_ESTIMATE = 260; // rough, only used to decide whether to flip above

function DayClickPopover({
  anchorRect,
  appName,
  date,
  clicks,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: {
  anchorRect: DOMRect;
  appName: string;
  date: string;
  clicks: DayClick[];
  onClose: () => void;
  // Hovering the popover itself (not just the bar) keeps it open — lets
  // someone move their mouse down into a long list without it vanishing
  // partway through reading it.
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const [pos, setPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const popRef = React.useRef<HTMLDivElement>(null);

  const place = React.useCallback((rect: DOMRect) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = Math.min(rect.left, vw - DAY_POP_W - 8);
    if (left < 8) left = 8;
    let top = rect.bottom + 10;
    if (top + DAY_POP_H_ESTIMATE > vh - 8) top = Math.max(8, rect.top - DAY_POP_H_ESTIMATE - 10);
    setPos({ top, left });
  }, []);

  React.useEffect(() => {
    place(anchorRect);
    const onDoc = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // A transient, one-off popup — closing on scroll (rather than tracking
    // position) keeps this simple and matches how a native tooltip behaves.
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchorRect, place, onClose]);

  const dateLabel = (() => {
    const parts = date.split('-').map(Number);
    if (parts.length !== 3) return date;
    return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  })();

  const shown = clicks.slice(0, 12);
  const overflow = clicks.length - shown.length;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-label={`Opens of ${appName} on ${dateLabel}`}
      className="ach-day-pop"
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: DAY_POP_W }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="ach-day-pop-head">
        <div>
          <div className="ach-day-pop-app">{appName}</div>
          <div className="ach-day-pop-date">{dateLabel}</div>
        </div>
        <button type="button" className="ach-day-pop-close" onClick={onClose} aria-label="Close">
          <Icon name="x" size={13} />
        </button>
      </div>
      <div className="ach-day-pop-list">
        {shown.map((c, i) => {
          const initials = c.name
            .split(' ')
            .map(w => w[0] ?? '')
            .slice(0, 2)
            .join('')
            .toUpperCase();
          return (
            <div className="ach-day-pop-row" key={`${c.userId}-${i}`}>
              <span className="ach-avatar ach-avatar-sm">
                {c.avatarUrl ? (
                  <img src={c.avatarUrl} alt={c.name} />
                ) : (
                  <span className="ach-initials">{initials}</span>
                )}
              </span>
              <span className="ach-day-pop-name">{c.name}</span>
              <span className="ach-day-pop-time">{c.time}</span>
            </div>
          );
        })}
        {overflow > 0 ? <div className="ach-day-pop-more">+{overflow} more</div> : null}
      </div>
    </div>,
    document.body,
  );
}

// SVG daily-activity timeline — one swim lane per app, one column per day.
// Uses the padding-bottom trick so the SVG scales proportionally with the container.
function ActivityTimeline({
  stats,
  deptColors,
  days,
  animKey,
}: {
  stats: AppClickStat[];
  deptColors: Record<string, string>;
  days: number;
  animKey: number;
}) {
  // Which bar's detail popover is open, if any — cleared whenever the period
  // switches (animKey changes) since the underlying rects remount anyway.
  const [open, setOpen] = React.useState<{
    rect: DOMRect;
    appName: string;
    date: string;
    clicks: DayClick[];
  } | null>(null);
  React.useEffect(() => setOpen(null), [animKey]);

  // Hover-driven: entering a bar shows it immediately; leaving schedules a
  // short-delay hide, which the popover itself cancels on its own
  // mouseenter — so moving the pointer from the bar down into the list
  // doesn't make it vanish mid-read. Keyboard focus/blur mirrors this
  // without the delay (no "moving into" concern for keyboard users).
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHide = React.useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);
  const scheduleHide = React.useCallback(() => {
    cancelHide();
    hideTimer.current = setTimeout(() => setOpen(null), 150);
  }, [cancelHide]);
  React.useEffect(() => cancelHide, [cancelHide]);
  const showBar = (rect: DOMRect, appName: string, date: string, clicks: DayClick[]) => {
    cancelHide();
    setOpen({ rect, appName, date, clicks });
  };

  const hasData = stats.some(s => s.dailyClicks.some(d => d.count > 0));
  if (!hasData) return null;

  // Fixed internal coordinate space — scales to actual container width via viewBox.
  const LABEL_W   = 120;
  const VB_W      = 800;
  const CHART_W   = VB_W - LABEL_W;
  const ROW_H     = 40;
  const AXIS_H    = 22;
  const BAR_MAX_H = ROW_H - 10;

  const totalH = ROW_H * stats.length + AXIS_H;
  const dayW   = CHART_W / days;
  const barW   = Math.max(2, dayW * 0.55);

  const labelEvery = days <= 7 ? 1 : days <= 14 ? 2 : days <= 30 ? 5 : 15;

  return (
    <div className="ach-timeline-wrap">
      <div className="ach-timeline-label">Daily activity</div>
      {/* padding-bottom keeps aspect ratio while width is 100% */}
      <div style={{ position: 'relative', paddingBottom: `${(totalH / VB_W) * 100}%` }}>
        <svg
          key={animKey}
          viewBox={`0 0 ${VB_W} ${totalH}`}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          aria-hidden
        >
          {stats.map((stat, rowI) => {
            const accent = stat.app.department
              ? (deptColors[stat.app.department] ?? null)
              : null;
            const color  = accent ?? 'var(--color-green-primary)';
            const rowY   = rowI * ROW_H;
            const maxDay = Math.max(...stat.dailyClicks.map(d => d.count), 1);
            const label  = stat.app.name.length > 13
              ? stat.app.name.slice(0, 12) + '…'
              : stat.app.name;

            return (
              <g key={stat.app.id}>
                {/* Alternating row stripe */}
                {rowI % 2 === 1 && (
                  <rect
                    x={0} y={rowY} width={VB_W} height={ROW_H}
                    fill="rgba(255,255,255,0.018)"
                  />
                )}
                {/* App name */}
                <text
                  x={LABEL_W - 12}
                  y={rowY + ROW_H / 2 + 4}
                  textAnchor="end"
                  fontSize={10}
                  fill="rgba(255,255,255,0.42)"
                  fontFamily="inherit"
                >
                  {label}
                </text>
                {/* Dept-coloured accent tick */}
                <line
                  x1={LABEL_W - 5} y1={rowY + 11}
                  x2={LABEL_W - 5} y2={rowY + ROW_H - 11}
                  stroke={color} strokeWidth={2.5} strokeLinecap="round"
                />
                {/* Daily bars — hover (or focus, or tap) shows who opened
                    this app on this day. No native <title> here any more:
                    it would fight with the custom popover for the same
                    hover moment. */}
                {stat.dailyClicks.map((day, dayI) => {
                  if (day.count === 0) return null;
                  const barH = Math.max(3, (day.count / maxDay) * BAR_MAX_H);
                  const x    = LABEL_W + dayI * dayW + (dayW - barW) / 2;
                  const barY = rowY + ROW_H - 4 - barH;
                  const showThis = (e: { currentTarget: SVGRectElement }) =>
                    showBar(e.currentTarget.getBoundingClientRect(), stat.app.name, day.date, day.clicks);
                  return (
                    <rect
                      key={day.date}
                      x={x} y={barY}
                      width={barW} height={barH}
                      rx={Math.min(barW / 2, 2)}
                      fill={color} opacity={0.82}
                      className="ach-timeline-bar"
                      style={{ animationDelay: `${dayI * 7}ms` } as React.CSSProperties}
                      tabIndex={0}
                      role="button"
                      aria-label={`${stat.app.name}, ${day.date}: ${day.count} open${day.count !== 1 ? 's' : ''}. Focus or hover to see who.`}
                      onMouseEnter={showThis}
                      onMouseLeave={scheduleHide}
                      onFocus={showThis}
                      onBlur={scheduleHide}
                      onClick={showThis}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          showThis(e);
                        }
                      }}
                    />
                  );
                })}
                {/* Row separator */}
                <line
                  x1={LABEL_W} y1={rowY + ROW_H}
                  x2={VB_W}    y2={rowY + ROW_H}
                  stroke="rgba(255,255,255,0.05)"
                />
              </g>
            );
          })}

          {/* X-axis date labels */}
          {stats[0]?.dailyClicks
            .filter((_, i) => i % labelEvery === 0)
            .map((day, idx) => {
              const actualI = idx * labelEvery;
              const x       = LABEL_W + actualI * dayW + dayW / 2;
              const parts   = day.date.split('-').map(Number);
              const dateLabel = parts.length === 3
                ? new Date(parts[0], parts[1] - 1, parts[2])
                    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : day.date;
              return (
                <text
                  key={day.date}
                  x={x} y={totalH - 4}
                  textAnchor="middle"
                  fontSize={9}
                  fill="rgba(255,255,255,0.28)"
                  fontFamily="inherit"
                >
                  {dateLabel}
                </text>
              );
            })}
        </svg>
      </div>
      {open ? (
        <DayClickPopover
          anchorRect={open.rect}
          appName={open.appName}
          date={open.date}
          clicks={open.clicks}
          onClose={() => setOpen(null)}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        />
      ) : null}
    </div>
  );
}

// Member avatar chip.
function MemberChip({ m }: { m: MemberClickStat }) {
  const initials = m.name
    .split(' ')
    .map(w => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div
      className="ach-member"
      title={`${m.name}: ${m.count} open${m.count !== 1 ? 's' : ''}`}
    >
      <span className="ach-avatar">
        {m.avatar_url ? (
          <img src={m.avatar_url} alt={m.name} />
        ) : (
          <span className="ach-initials">{initials}</span>
        )}
      </span>
      <span className="ach-member-count">{m.count}</span>
    </div>
  );
}

// Single per-app row. Remounted on animKey change so CSS animation replays.
function AppStatRow({
  stat,
  accent,
  index,
}: {
  stat: AppClickStat;
  accent: string | null;
  index: number;
}) {
  return (
    <div
      className="ach-row"
      style={{ '--row-i': index } as React.CSSProperties}
    >
      <div className="ach-row-left">
        <div className="ach-thumb-wrap">
          {stat.app.image_url ? (
            <img src={stat.app.image_url} alt="" className="ach-thumb" />
          ) : (
            <span
              className="ach-thumb-fallback"
              style={accent ? ({ '--app-accent': accent } as React.CSSProperties) : undefined}
            >
              <Icon name={appIconName(stat.app.icon)} size={18} />
            </span>
          )}
        </div>
        <div className="ach-identity">
          <div className="ach-app-name">{stat.app.name}</div>
          {stat.app.department && (
            <div className="ach-app-dept">
              <span
                className="ach-dept-dot"
                style={accent ? { background: accent } : undefined}
              />
              {stat.app.department}
            </div>
          )}
          {stat.members.length > 0 && (
            <div className="ach-members">
              {stat.members.slice(0, 7).map(m => <MemberChip key={m.id} m={m} />)}
              {stat.members.length > 7 && (
                <span className="ach-members-more">+{stat.members.length - 7}</span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="ach-row-right">
        <div className="ach-count-block">
          <span className="ach-count">{stat.total}</span>
          <span className="ach-count-label">opens</span>
          {stat.trend !== null && (
            <span className={`ach-trend ${stat.trend >= 0 ? 'ach-trend-up' : 'ach-trend-down'}`}>
              {stat.trend >= 0 ? '↑' : '↓'}{Math.abs(stat.trend)}%
            </span>
          )}
        </div>
        <div className="ach-bar-track">
          <div
            className="ach-bar-fill"
            style={{
              width: `${stat.share}%`,
              background: accent ?? 'var(--color-green-primary)',
            }}
          />
        </div>
        <div className="ach-share">{stat.share}% of opens</div>
      </div>
    </div>
  );
}

// Summary stat card — numbers animate up from 0 on mount.
function StatCard({
  value,
  label,
  accent = false,
  isText = false,
}: {
  value: number | string;
  label: string;
  accent?: boolean;
  isText?: boolean;
}) {
  const numeric  = typeof value === 'number' ? value : 0;
  const animated = useCountUp(numeric);
  return (
    <div className={`ach-stat-card${accent ? ' ach-stat-card-accent' : ''}`}>
      <div className={`ach-stat-value${isText ? ' ach-stat-value-sm' : ''}`}>
        {isText ? value : animated}
      </div>
      <div className="ach-stat-label">{label}</div>
    </div>
  );
}

export function AppAnalytics({
  initial,
  deptColors,
}: {
  initial: AppAnalyticsResult;
  deptColors: Record<string, string>;
}) {
  const [period,  setPeriod]  = React.useState<number>(30);
  const [data,    setData]    = React.useState<AppAnalyticsResult>(initial);
  const [loading, setLoading] = React.useState(false);
  // Incrementing key forces React to remount animated children, replaying animations.
  const [animKey, setAnimKey] = React.useState(0);

  const switchPeriod = async (days: number) => {
    if (days === period || loading) return;
    setPeriod(days);
    setLoading(true);
    try {
      const result = await getAppAnalytics(days);
      setData(result);
      setAnimKey(k => k + 1);
    } catch {
      // keep stale data on error
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="ach-section">
      <div className="ach-divider" />

      <div className="ach-header">
        <div>
          <h2 className="ach-title">App Analytics</h2>
          <p className="ach-subtitle">
            Board-only &middot; who opened what and how many times
          </p>
        </div>
        <div className="ach-periods">
          {PERIODS.map(p => (
            <button
              key={p.days}
              className={`ach-period-btn${period === p.days ? ' active' : ''}`}
              onClick={() => void switchPeriod(p.days)}
              disabled={loading}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <AnalyticsSkeleton />
      ) : (
        // Key on the fragment so all animated children remount when animKey changes.
        <React.Fragment key={animKey}>
          <div className="ach-summary">
            <StatCard value={data.totalClicks} label="Total opens" />
            <StatCard
              value={data.mostOpened ?? 'None yet'}
              label="Most opened"
              accent
              isText
            />
            <StatCard value={data.uniqueUsers} label="Active members" />
          </div>

          {data.stats.length > 0 && (
            <ActivityTimeline
              stats={data.stats}
              deptColors={deptColors}
              days={period}
              animKey={animKey}
            />
          )}

          <div className="ach-list">
            {data.stats.length === 0 ? (
              <div className="empty-state" style={{ padding: '32px 0' }}>
                <Icon name="chart" size={32} stroke={1.2} />
                <h3>No activity yet</h3>
                <p>Opens will appear here once members start using the apps.</p>
              </div>
            ) : (
              data.stats.map((stat, i) => (
                <AppStatRow
                  key={stat.app.id}
                  stat={stat}
                  accent={stat.app.department ? (deptColors[stat.app.department] ?? null) : null}
                  index={i}
                />
              ))
            )}
          </div>
        </React.Fragment>
      )}
    </section>
  );
}
