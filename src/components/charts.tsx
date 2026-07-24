'use client';
// Custom SVG charts — bar + line + energy donut. Interactive hover via React state.
import { useState, Fragment, type ReactNode } from 'react';
import { Icon } from './Icon';

// Merges a boolean-per-index flag array into contiguous index ranges — used to
// paint one merged band/pill across adjacent flagged columns (e.g. a Sat+Sun
// weekend, or a run of leave days) instead of one per column.
function groupConsecutive(flags: boolean[]): { start: number; end: number }[] {
  const groups: { start: number; end: number }[] = [];
  let s = -1;
  for (let i = 0; i <= flags.length; i++) {
    const on = i < flags.length && flags[i];
    if (on && s === -1) s = i;
    if (!on && s !== -1) {
      groups.push({ start: s, end: i - 1 });
      s = -1;
    }
  }
  return groups;
}

export function BarChart({
  data,
  width = 480,
  height = 200,
  labels,
  color = 'var(--color-green-primary)',
  overlay,
  weekend,
  leave,
}: {
  data: number[];
  width?: number;
  height?: number;
  labels: string[];
  color?: string;
  overlay?: number[];
  // Per-index flag: true where the column is a Saturday/Sunday. When set, a
  // subtle shaded band is painted behind those columns.
  weekend?: boolean[];
  // Per-index label (e.g. "Casual leave"): set where the member was on
  // approved full-day leave that day, so a 0 reads as "excused", not "missing".
  // Paints a distinct band + merged "Leave" pill, same mechanic as `weekend`.
  leave?: (string | null)[];
}) {
  const max = Math.max(...data, ...(overlay || []), 1);
  const padding = { l: 32, r: 12, t: 16, b: 28 };
  const w = width - padding.l - padding.r;
  const h = height - padding.t - padding.b;
  const bw = w / data.length;

  // Merge consecutive weekend/leave columns into contiguous groups, so an
  // adjacent Sat+Sun (or a run of leave days) read as ONE block — a single
  // rounded band behind the bars plus one merged pill in place of the
  // separate day labels.
  const weekendGroups = weekend ? groupConsecutive(weekend) : [];
  const leaveGroups = leave ? groupConsecutive(leave.map(Boolean)) : [];

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`}>
      {/* Weekend bands — one rounded block per group, behind grid + bars. */}
      {weekendGroups.map((g) => (
        <rect
          key={`wkb-${g.start}`}
          x={padding.l + g.start * bw}
          y={padding.t}
          width={(g.end - g.start + 1) * bw}
          height={h}
          rx="8"
          className="chart-weekend-band"
        />
      ))}
      {/* Leave bands — same mechanic as weekend, distinct color, behind grid + bars. */}
      {leaveGroups.map((g) => (
        <rect
          key={`lvb-${g.start}`}
          x={padding.l + g.start * bw}
          y={padding.t}
          width={(g.end - g.start + 1) * bw}
          height={h}
          rx="8"
          className="chart-leave-band"
        />
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((p) => (
        <line
          key={p}
          x1={padding.l}
          x2={width - padding.r}
          y1={padding.t + h * (1 - p)}
          y2={padding.t + h * (1 - p)}
          stroke="var(--color-border)"
          strokeWidth="1"
        />
      ))}
      {[0, 0.5, 1].map((p) => (
        <text
          key={p}
          x={padding.l - 6}
          y={padding.t + h * (1 - p) + 3}
          textAnchor="end"
          fontSize="10"
          fill="var(--color-grey-text)"
        >
          {Math.round(max * p)}
        </text>
      ))}
      {data.map((v, i) => {
        const bh = (v / max) * h;
        const x = padding.l + i * bw + bw * 0.18;
        const bwActual = bw * 0.64;
        return (
          <g key={i} className="chart-bar-group">
            {overlay && overlay[i] !== undefined ? (
              <rect
                x={x}
                y={padding.t + h - (overlay[i] / max) * h}
                width={bwActual}
                height={(overlay[i] / max) * h}
                fill="var(--color-green-light)"
                rx="2"
                className="chart-bar-ghost"
                style={{ animationDelay: `${i * 55}ms` }}
              />
            ) : null}
            {/* Full-height transparent hit area so the whole column is hoverable */}
            <rect
              x={padding.l + i * bw}
              y={padding.t}
              width={bw}
              height={h}
              fill="transparent"
              className="chart-bar-hit"
            >
              <title>{leave?.[i] ? `${labels[i]}: ${leave[i]}` : `${labels[i]}: ${v}`}</title>
            </rect>
            <rect
              x={x}
              y={padding.t + h - bh}
              width={bwActual}
              height={bh}
              fill={color}
              rx="2"
              className="chart-bar"
              style={{ animationDelay: `${i * 55}ms` }}
            >
              <title>{leave?.[i] ? `${labels[i]}: ${leave[i]}` : `${labels[i]}: ${v}`}</title>
            </rect>
            {/* Weekend/leave day labels are replaced by the merged pill. */}
            {weekend?.[i] || leave?.[i] ? null : (
              <text
                x={x + bwActual / 2}
                y={height - 10}
                textAnchor="middle"
                fontSize="10"
                fill="var(--color-grey-text)"
              >
                {labels[i]}
              </text>
            )}
            <text
              x={x + bwActual / 2}
              y={padding.t + h - bh - 4}
              textAnchor="middle"
              fontSize="10"
              fill="var(--color-slate)"
              fontWeight="600"
              className="chart-value"
              style={{ animationDelay: `${i * 55 + 280}ms` }}
            >
              {v > 0 ? v : ''}
            </text>
          </g>
        );
      })}

      {/* Merged "Weekend" pill — one rounded card spanning each weekend group,
          replacing the individual Sat/Sun day labels. */}
      {weekendGroups.map((g) => {
        const gx = padding.l + g.start * bw;
        const gw = (g.end - g.start + 1) * bw;
        const pw = Math.max(40, gw - 8);
        const px = gx + (gw - pw) / 2;
        const py = height - 19;
        return (
          <g key={`wkp-${g.start}`} style={{ pointerEvents: 'none' }}>
            <rect x={px} y={py} width={pw} height={15} rx="7.5" className="chart-weekend-pill" />
            <text
              x={gx + gw / 2}
              y={py + 10.5}
              textAnchor="middle"
              fontSize="8.5"
              letterSpacing="0.04em"
              className="chart-weekend-pill-text"
            >
              Weekend
            </text>
          </g>
        );
      })}

      {/* Merged "Leave" pill — one rounded card spanning each leave group,
          replacing the individual day labels. Generic text on purpose (the
          specific leave type is in the hover tooltip); mirrors the Weekend pill. */}
      {leaveGroups.map((g) => {
        const gx = padding.l + g.start * bw;
        const gw = (g.end - g.start + 1) * bw;
        const pw = Math.max(40, gw - 8);
        const px = gx + (gw - pw) / 2;
        const py = height - 19;
        return (
          <g key={`lvp-${g.start}`} style={{ pointerEvents: 'none' }}>
            <rect x={px} y={py} width={pw} height={15} rx="7.5" className="chart-leave-pill" />
            <text
              x={gx + gw / 2}
              y={py + 10.5}
              textAnchor="middle"
              fontSize="8.5"
              letterSpacing="0.04em"
              className="chart-leave-pill-text"
            >
              Leave
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Monotone cubic spline (Fritsch-Carlson) ────────────────────────────────
// Unlike Catmull-Rom, this guarantees no overshoot between data points, which
// is critical for data charts where going below zero is misleading.
function monotoneLinePath(coords: [number, number][]): string {
  const n = coords.length;
  if (n === 0) return '';
  if (n === 1) return `M${coords[0][0]},${coords[0][1]}`;

  // Slopes between consecutive points
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = coords[i + 1][0] - coords[i][0];
    delta.push(dx !== 0 ? (coords[i + 1][1] - coords[i][1]) / dx : 0);
  }

  // Initial tangents
  const m: number[] = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    // Flat tangent at sign changes to enforce monotonicity
    m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
  }

  // Fritsch-Carlson rescaling to prevent any remaining overshoot
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(delta[i]) < 1e-10) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const alpha = m[i] / delta[i];
      const beta = m[i + 1] / delta[i];
      const s = Math.hypot(alpha, beta);
      if (s > 3) {
        m[i] = (3 / s) * alpha * delta[i];
        m[i + 1] = (3 / s) * beta * delta[i];
      }
    }
  }

  let d = `M${coords[0][0].toFixed(1)},${coords[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = coords[i];
    const [x1, y1] = coords[i + 1];
    const dx = x1 - x0;
    const cp1x = x0 + dx / 3;
    const cp1y = y0 + (m[i] * dx) / 3;
    const cp2x = x1 - dx / 3;
    const cp2y = y1 - (m[i + 1] * dx) / 3;
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

export function LineChart({
  data,
  width = 480,
  height = 200,
  labels,
  color = 'var(--color-green-primary)',
  weekend,
  leave,
  overlay,
  centerValue,
  centerCaption,
}: {
  data: number[];
  width?: number;
  height?: number;
  labels: string[];
  color?: string;
  // Per-index flag: true where the point is a Saturday/Sunday. When set, a
  // subtle shaded band is painted behind those points. For a rolling window
  // the band spans half a step either side, so adjacent Sat+Sun read as one
  // weekend block.
  weekend?: boolean[];
  // Per-index label (e.g. "Sick leave"): set where the member was on approved
  // full-day leave that day, so a 0 reads as "excused", not "missing". Paints
  // a distinct band, same mechanic as `weekend`, and the hover tooltip shows
  // the label instead of the raw value.
  leave?: (string | null)[];
  // A comparison series (e.g. last month) drawn as a recessive ghost line +
  // faint area behind the main series. Aligned by index; scales into the same
  // axis. Same length as `data`.
  overlay?: number[];
  // Optional big value (e.g. an average) shown centred over the plot, with an
  // optional caption beneath it.
  centerValue?: string;
  centerCaption?: string;
}) {
  const [hi, setHi] = useState<number | null>(null);

  const hasOverlay = !!overlay && overlay.length > 0;
  const max = Math.max(...data, ...(hasOverlay ? overlay! : []), 1);
  const padding = { l: 32, r: 12, t: 20, b: 28 };
  const w = width - padding.l - padding.r;
  const h = height - padding.t - padding.b;
  const step = data.length > 1 ? w / (data.length - 1) : 0;

  const coords: [number, number][] = data.map((v, i) => [
    padding.l + i * step,
    padding.t + h - (v / max) * h,
  ]);

  const linePath = monotoneLinePath(coords);
  const areaPath =
    coords.length > 0
      ? `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${(padding.t + h).toFixed(1)} L${coords[0][0].toFixed(1)},${(padding.t + h).toFixed(1)} Z`
      : '';

  // Ghost comparison series (e.g. last month), same axis, drawn behind.
  const overlayCoords: [number, number][] = hasOverlay
    ? overlay!.map((v, i) => [padding.l + i * step, padding.t + h - (v / max) * h])
    : [];
  const overlayLinePath = overlayCoords.length ? monotoneLinePath(overlayCoords) : '';
  const overlayAreaPath =
    overlayCoords.length > 0
      ? `${overlayLinePath} L${overlayCoords[overlayCoords.length - 1][0].toFixed(1)},${(padding.t + h).toFixed(1)} L${overlayCoords[0][0].toFixed(1)},${(padding.t + h).toFixed(1)} Z`
      : '';

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (step === 0 || data.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * width;
    setHi(Math.max(0, Math.min(data.length - 1, Math.round((svgX - padding.l) / step))));
  };

  // Tooltip shows the leave label instead of the raw value on a leave day —
  // widened to fit whichever text is actually showing, then clamped so it
  // never clips the SVG edge.
  const tooltipText = hi !== null ? (leave?.[hi] ? leave[hi] : String(data[hi])) : '';
  const showTooltip = hi !== null && (data[hi] > 0 || !!leave?.[hi]);
  const TW = Math.max(36, tooltipText.length * 6.2 + 12);
  const TH = 18;
  const tipX =
    hi !== null
      ? Math.max(padding.l + TW / 2 + 2, Math.min(width - padding.r - TW / 2 - 2, coords[hi][0]))
      : 0;
  const tipY =
    hi !== null ? Math.max(padding.t + TH + 4, coords[hi][1] - 10) : 0;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      onMouseMove={onMove}
      onMouseLeave={() => setHi(null)}
      style={{ cursor: 'crosshair', display: 'block' }}
    >
      <defs>
        <linearGradient
          id="chart-area-fill"
          x1="0"
          y1={padding.t}
          x2="0"
          y2={padding.t + h}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>

      {/* Weekend bands — behind grid, area and line. */}
      {step > 0 &&
        weekend?.map((wknd, i) => {
          if (!wknd) return null;
          const bx = Math.max(padding.l, coords[i][0] - step / 2);
          const bx2 = Math.min(width - padding.r, coords[i][0] + step / 2);
          return (
            <rect
              key={`wk-${i}`}
              x={bx}
              y={padding.t}
              width={Math.max(0, bx2 - bx)}
              height={h}
              className="chart-weekend-band"
            />
          );
        })}

      {/* Leave bands — same mechanic as weekend, distinct color. A native
          <title> lets a direct hover on the band itself show the full label
          (e.g. "12: Sick leave") even between crosshair steps. */}
      {step > 0 &&
        leave?.map((lv, i) => {
          if (!lv) return null;
          const bx = Math.max(padding.l, coords[i][0] - step / 2);
          const bx2 = Math.min(width - padding.r, coords[i][0] + step / 2);
          return (
            <rect
              key={`lv-${i}`}
              x={bx}
              y={padding.t}
              width={Math.max(0, bx2 - bx)}
              height={h}
              className="chart-leave-band"
            >
              <title>{`${labels[i]}: ${lv}`}</title>
            </rect>
          );
        })}

      {/* Y-axis labels */}
      {[0, 0.5, 1].map((p) => (
        <text
          key={p}
          x={padding.l - 6}
          y={padding.t + h * (1 - p) + 4}
          textAnchor="end"
          fontSize="10"
          fill="var(--color-grey-text)"
        >
          {Math.round(max * p)}
        </text>
      ))}

      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((p) => (
        <line
          key={p}
          x1={padding.l}
          x2={width - padding.r}
          y1={padding.t + h * (1 - p)}
          y2={padding.t + h * (1 - p)}
          stroke="var(--color-border)"
          strokeWidth="1"
        />
      ))}

      {/* Ghost comparison series (e.g. last month) — behind the main series.
          Wrapped so the whole ghost fades in as one on (re)mount. */}
      {hasOverlay && (
        <g className="chart-ghost">
          {overlayAreaPath && <path d={overlayAreaPath} className="chart-area-ghost" />}
          {overlayLinePath && (
            <path
              d={overlayLinePath}
              fill="none"
              stroke="var(--color-green-primary)"
              strokeWidth="2"
              strokeDasharray="4 4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="chart-line-ghost"
            />
          )}
        </g>
      )}

      {/* Gradient area */}
      {areaPath && <path d={areaPath} fill="url(#chart-area-fill)" className="chart-area" />}

      {/* Smooth monotone line */}
      {linePath && (
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          // Normalised length so the left-to-right draw is exact at any width.
          pathLength={1}
          className="chart-line"
        />
      )}

      {/* Hover vertical rule */}
      {hi !== null && (
        <line
          x1={coords[hi][0]}
          x2={coords[hi][0]}
          y1={padding.t}
          y2={padding.t + h}
          stroke={color}
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity="0.4"
        />
      )}

      {/* Data dots (skip zeros) + hover halo */}
      {data.map((v, i) =>
        v === 0 ? null : (
          <g key={i}>
            {hi === i && (
              <circle cx={coords[i][0]} cy={coords[i][1]} r="10" fill={color} opacity="0.12" />
            )}
            <circle
              cx={coords[i][0]}
              cy={coords[i][1]}
              r={hi === i ? 4.5 : 3}
              fill={hi === i ? 'var(--color-card)' : color}
              stroke={color}
              strokeWidth={hi === i ? 2 : 0}
              className="chart-point"
              // Pop each dot in as the line's draw sweeps past it, left→right.
              style={{
                animationDelay: `${140 + (data.length > 1 ? (i / (data.length - 1)) * 560 : 0)}ms`,
              }}
            />
          </g>
        ),
      )}

      {/* Tooltip bubble */}
      {showTooltip && (
        <g style={{ pointerEvents: 'none' }}>
          <rect
            x={tipX - TW / 2}
            y={tipY - TH}
            width={TW}
            height={TH}
            rx="4"
            fill="var(--color-black)"
          />
          <text
            x={tipX}
            y={tipY - 5}
            textAnchor="middle"
            fontSize="9.5"
            fill="var(--color-bg)"
            fontWeight="700"
          >
            {tooltipText}
          </text>
        </g>
      )}

      {/* X-axis labels — sample up to 10 */}
      {labels.map((l, i) =>
        l && i % Math.ceil(labels.length / 10) === 0 ? (
          <text
            key={i}
            x={coords[i][0]}
            y={height - 6}
            textAnchor="middle"
            fontSize="10"
            fill="var(--color-grey-text)"
          >
            {l}
          </text>
        ) : null,
      )}

      {/* Centred value (e.g. an average) over the plot. */}
      {centerValue ? (
        <g style={{ pointerEvents: 'none' }}>
          <text
            x={padding.l + w / 2}
            y={padding.t + h / 2 + (centerCaption ? -2 : 6)}
            textAnchor="middle"
            fontSize="34"
            fontWeight="800"
            fill="var(--color-slate)"
            className="chart-center-value"
          >
            {centerValue}
          </text>
          {centerCaption ? (
            <text
              x={padding.l + w / 2}
              y={padding.t + h / 2 + 16}
              textAnchor="middle"
              fontSize="10"
              fontWeight="600"
              fill="var(--color-grey-text)"
              letterSpacing="0.06em"
            >
              {centerCaption}
            </text>
          ) : null}
        </g>
      ) : null}
    </svg>
  );
}

// ─── Energy donut chart ──────────────────────────────────────────────────────
// Shows distribution of energy levels (1–5) over a period as a donut + emoji legend.
const ENERGY_LEVELS = [
  { n: 5, emoji: '🚀', label: 'Great',    color: '#288A5D' },
  { n: 4, emoji: '😊', label: 'Good',     color: '#4ade80' },
  { n: 3, emoji: '😐', label: 'OK',       color: '#fbbf24' },
  { n: 2, emoji: '😕', label: 'Low',      color: '#fb923c' },
  { n: 1, emoji: '😴', label: 'Very low', color: '#f87171' },
] as const;

export function EnergyChart({ data }: { data: number[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const logged = data.filter((v) => v > 0);
  const total = logged.length;
  const avg = total > 0 ? logged.reduce((a, b) => a + b, 0) / total : 0;
  const avgEmoji = [...ENERGY_LEVELS].reverse().find((l) => l.n <= Math.round(avg))?.emoji ?? '-';

  const SZ = 144, TH = 20;
  const cx = SZ / 2, cy = SZ / 2;
  const r = (SZ - TH) / 2;
  const C = 2 * Math.PI * r;
  const GAP = C * 0.028; // gap between slices

  // Build slices in descending level order (5 → 1)
  let cumLen = 0;
  const slices = ENERGY_LEVELS.map((l) => {
    const count = data.filter((v) => v === l.n).length;
    const pct = total > 0 ? count / total : 0;
    const len = Math.max(0, pct * C - GAP);
    const start = cumLen;
    cumLen += pct * C;
    return { ...l, count, pct, len, start };
  }).filter((s) => s.count > 0);

  if (total === 0) {
    return (
      <div className="energy-empty">
        <span style={{ fontSize: 28 }}>😴</span>
        <span className="text-grey text-sm">No energy data yet</span>
      </div>
    );
  }

  return (
    <div className="energy-chart">
      {/* Donut */}
      <div className="energy-donut-wrap">
        <svg
          width={SZ}
          height={SZ}
          viewBox={`0 0 ${SZ} ${SZ}`}
          style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}
        >
          {/* Background track */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-border)" strokeWidth={TH} />
          {/* Slices */}
          {slices.map((s) => (
            <circle
              key={s.n}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={hovered === s.n ? TH + 4 : TH}
              strokeDasharray={`${s.len} ${C}`}
              strokeDashoffset={-s.start}
              strokeLinecap="butt"
              style={{ transition: 'stroke-width 180ms ease', cursor: 'pointer' }}
              onMouseEnter={() => setHovered(s.n)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </svg>

        {/* Centre — shows hovered slice or average */}
        <div className="energy-donut-center">
          {hovered !== null ? (
            <>
              <div className="energy-avg-emoji">
                {ENERGY_LEVELS.find((l) => l.n === hovered)?.emoji}
              </div>
              <div className="energy-avg-label">
                {ENERGY_LEVELS.find((l) => l.n === hovered)?.label}
              </div>
              <div className="energy-avg-num">
                {slices.find((s) => s.n === hovered)?.count}d
              </div>
            </>
          ) : (
            <>
              <div className="energy-avg-emoji">{avgEmoji}</div>
              <div className="energy-avg-num">{avg.toFixed(1)} avg</div>
            </>
          )}
        </div>
      </div>

      {/* Emoji legend with mini bars */}
      <div className="energy-legend">
        {slices.map((s, idx) => (
          <div
            key={s.n}
            className={`energy-legend-row${hovered === s.n ? ' energy-legend-row-active' : ''}`}
            style={{ animationDelay: `${idx * 80}ms` }}
            onMouseEnter={() => setHovered(s.n)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="energy-legend-emoji">{s.emoji}</span>
            <div className="energy-legend-track">
              <div
                className="energy-legend-fill"
                style={{ width: `${s.pct * 100}%`, background: s.color, animationDelay: `${idx * 80 + 60}ms` }}
              />
            </div>
            <span className="energy-legend-count">{s.count}d</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tag usage pie chart ─────────────────────────────────────────────────────
// Fixed, validated categorical order (see globals.css --tag-series-*) — hues
// are assigned by rank, never cycled. Beyond the 7th tag, the remainder folds
// into a neutral "Other" slice rather than generating a 9th hue.
const TAG_SERIES = [
  'var(--tag-series-1)',
  'var(--tag-series-2)',
  'var(--tag-series-3)',
  'var(--tag-series-4)',
  'var(--tag-series-5)',
  'var(--tag-series-6)',
  'var(--tag-series-7)',
];
const TAG_OTHER_COLOR = 'var(--tag-series-other)';
const TAG_MAX_SLICES = 7;

interface TagSlice {
  tag: string;
  count: number;
  color: string;
  isOther?: boolean;
  otherTags?: { tag: string; count: number }[];
}

export function TagPieChart({
  data,
  renderName,
  renderActions,
}: {
  data: { tag: string; count: number }[];
  // Optional slots so a caller (the tag manager modal) can turn this same
  // legend into an editable list — inline rename input in place of the plain
  // name, action buttons appended per row — without the chart itself knowing
  // anything about renaming/deleting. Omit both for the plain read-only chart.
  renderName?: (tag: string, isOther: boolean) => ReactNode;
  renderActions?: (tag: string, isOther: boolean) => ReactNode;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  // The "Other" bucket folds 8th+ tags into one slice so the chart never
  // has to invent a 9th hue — but those tags still need to be individually
  // rename/delete-able, so clicking it reveals them as their own rows.
  const [otherExpanded, setOtherExpanded] = useState(false);

  const total = data.reduce((a, b) => a + b.count, 0);

  if (total === 0) {
    return (
      <div className="energy-empty">
        <span style={{ fontSize: 28 }}>🏷️</span>
        <span className="text-grey text-sm">No tags yet</span>
      </div>
    );
  }

  const ranked = [...data].sort((a, b) => b.count - a.count);
  const top = ranked.slice(0, TAG_MAX_SLICES);
  const rest = ranked.slice(TAG_MAX_SLICES);
  const restCount = rest.reduce((a, b) => a + b.count, 0);

  const base: TagSlice[] = top.map((t, i) => ({ tag: t.tag, count: t.count, color: TAG_SERIES[i] }));
  if (restCount > 0) {
    base.push({
      tag: 'Other',
      count: restCount,
      color: TAG_OTHER_COLOR,
      isOther: true,
      otherTags: rest,
    });
  }

  const SZ = 144, TH = 20;
  const cx = SZ / 2, cy = SZ / 2;
  const r = (SZ - TH) / 2;
  const C = 2 * Math.PI * r;
  const GAP = base.length > 1 ? C * 0.02 : 0;

  let cumLen = 0;
  const slices = base.map((s) => {
    const pct = s.count / total;
    const len = Math.max(0, pct * C - GAP);
    const start = cumLen;
    cumLen += pct * C;
    return { ...s, pct, len, start };
  });

  const active = hovered ? slices.find((s) => s.tag === hovered) : null;

  return (
    <div className="energy-chart">
      <div className="energy-donut-wrap">
        <svg
          width={SZ}
          height={SZ}
          viewBox={`0 0 ${SZ} ${SZ}`}
          style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}
        >
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-border)" strokeWidth={TH} />
          {slices.map((s) => (
            <circle
              key={s.tag}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={hovered === s.tag ? TH + 4 : TH}
              strokeDasharray={`${s.len} ${C}`}
              strokeDashoffset={-s.start}
              strokeLinecap="butt"
              style={{ transition: 'stroke-width 180ms ease', cursor: 'pointer' }}
              onMouseEnter={() => setHovered(s.tag)}
              onMouseLeave={() => setHovered(null)}
            >
              <title>
                {s.isOther
                  ? `Other (${s.otherTags?.map((t) => t.tag).join(', ')}): ${s.count}`
                  : `${s.tag}: ${s.count}`}
              </title>
            </circle>
          ))}
        </svg>

        <div className="energy-donut-center">
          {active ? (
            <>
              <div className="energy-avg-num" style={{ fontSize: 15, fontWeight: 800, color: 'var(--color-black)' }}>
                {Math.round(active.pct * 100)}%
              </div>
              <div className="energy-avg-label" style={{ maxWidth: 92, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {active.tag}
              </div>
              <div className="energy-avg-num">{active.count} {active.count === 1 ? 'log' : 'logs'}</div>
            </>
          ) : (
            <>
              <div className="energy-avg-num" style={{ fontSize: 20, fontWeight: 800, color: 'var(--color-black)' }}>
                {total}
              </div>
              <div className="energy-avg-label">tag uses</div>
            </>
          )}
        </div>
      </div>

      <div className="energy-legend">
        {slices.map((s, idx) => (
          <Fragment key={s.tag}>
            <div
              className={`energy-legend-row${hovered === s.tag ? ' energy-legend-row-active' : ''}${s.isOther ? ' tag-legend-row--other' : ''}`}
              style={{ animationDelay: `${idx * 80}ms` }}
              onMouseEnter={() => setHovered(s.tag)}
              onMouseLeave={() => setHovered(null)}
              onClick={s.isOther ? () => setOtherExpanded((v) => !v) : undefined}
              title={s.isOther ? s.otherTags?.map((t) => t.tag).join(', ') : undefined}
            >
              {s.isOther ? (
                <Icon name={otherExpanded ? 'chevron-down' : 'chevron-right'} size={11} />
              ) : (
                <span className="tag-legend-swatch" style={{ background: s.color }} />
              )}
              {renderName ? renderName(s.tag, !!s.isOther) : <span className="tag-legend-name">{s.tag}</span>}
              <div className="energy-legend-track">
                <div
                  className="energy-legend-fill"
                  style={{ width: `${s.pct * 100}%`, background: s.color, animationDelay: `${idx * 80 + 60}ms` }}
                />
              </div>
              <span className="energy-legend-count">{Math.round(s.pct * 100)}% · {s.count}</span>
              {renderActions ? (
                <div className="tag-legend-actions">{renderActions(s.tag, !!s.isOther)}</div>
              ) : null}
            </div>

            {/* Expanded "Other" — each folded tag as its own manageable row,
                so nothing that made it into "Other" becomes unreachable. */}
            {s.isOther && otherExpanded
              ? s.otherTags?.map((ft, fi) => {
                  const pct = total > 0 ? ft.count / total : 0;
                  return (
                    <div
                      key={ft.tag}
                      className="energy-legend-row tag-legend-row--sub"
                      style={{ animationDelay: `${(idx + fi + 1) * 60}ms` }}
                    >
                      <span className="tag-legend-swatch" style={{ background: TAG_OTHER_COLOR }} />
                      {renderName ? renderName(ft.tag, false) : <span className="tag-legend-name">{ft.tag}</span>}
                      <div className="energy-legend-track">
                        <div
                          className="energy-legend-fill"
                          style={{ width: `${pct * 100}%`, background: TAG_OTHER_COLOR }}
                        />
                      </div>
                      <span className="energy-legend-count">{Math.round(pct * 100)}% · {ft.count}</span>
                      {renderActions ? (
                        <div className="tag-legend-actions">{renderActions(ft.tag, false)}</div>
                      ) : null}
                    </div>
                  );
                })
              : null}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
