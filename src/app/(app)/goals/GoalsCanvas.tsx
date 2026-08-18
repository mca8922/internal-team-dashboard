'use client';

// One-Shot — the whole goal hierarchy as a single, zoomable node canvas
// (n8n-style): every goal is a small card wired to its parent, laid out
// left→right by tier (Yearly → Half-Yearly → Quarterly → Monthly → Daily). It
// auto-fits to the viewport on open so the structure reads at a glance with no
// page scrolling; from there the user can pan/zoom to inspect a busy area.
//
// Daily goals are the most numerous tier (often one branch per assignee), so
// they collapse into a "+N" badge on their Monthly parent by default — that
// keeps the default glance to the four grouping tiers readable even on a large
// board, while the full detail stays one click away per branch.
//
// Pure client-side layout (divs + one SVG for the connector lines) — no
// canvas library, no extra requests, nothing that touches the server.
import * as React from 'react';
import { Icon } from '@/components/Icon';
import { EmptyState } from '@/components/ui';
import { STATUS } from './goal-ui';
import type { Goal, GoalLevel, GoalStatus } from '@/lib/types';

const NODE_W = 190;
const NODE_H = 62;
const COL_GAP = 230;
const ROW_H = 74;
const PAD = 48;
const MIN_SCALE = 0.15;
const MAX_SCALE = 2.5;
const FIT_MAX_SCALE = 1.3;

const COL_OF: Record<GoalLevel, number> = {
  yearly: 0,
  half_yearly: 1,
  quarterly: 2,
  monthly: 3,
  daily: 4,
};
const TIER_TAG: Record<GoalLevel, string> = {
  yearly: 'Y',
  half_yearly: 'H',
  quarterly: 'Q',
  monthly: 'M',
  daily: 'D',
};

interface Positioned {
  goal: Goal;
  x: number;
  y: number;
}

interface Layout {
  nodes: Positioned[];
  edges: { from: Positioned; to: Positioned }[];
  w: number;
  h: number;
  // goalId -> number of Daily children hidden behind its "+N" badge.
  collapsedCounts: Map<string, number>;
  // goalIds that have Daily children at all (regardless of current expand state).
  collapsibleIds: string[];
}

// Tidy top-down layout: leaves stack one per row; a parent centers on the
// vertical span of its own (visible) children. Independent trees (yearly
// roots, plus any goal whose parent isn't in the visible set) stack below
// one another. Daily children of a goal not in `expanded` are skipped and
// counted instead, so the default view stays to the four grouping tiers.
function layout(goals: Goal[], expanded: Set<string>): Layout {
  const byId = new Map(goals.map((g) => [g.id, g]));
  const childrenOf = new Map<string, Goal[]>();
  for (const g of goals) {
    if (g.parent_id && byId.has(g.parent_id)) {
      const arr = childrenOf.get(g.parent_id);
      if (arr) arr.push(g);
      else childrenOf.set(g.parent_id, [g]);
    }
  }
  const collapsibleIds: string[] = [];
  for (const [pid, kids] of childrenOf) {
    if (kids.length > 0 && kids[0].level === 'daily') collapsibleIds.push(pid);
  }
  const collapsedCounts = new Map<string, number>();
  const positions = new Map<string, { x: number; y: number }>();
  const visiting = new Set<string>();
  let rowCursor = 0;

  const place = (g: Goal): number => {
    if (positions.has(g.id)) return positions.get(g.id)!.y / ROW_H;
    if (visiting.has(g.id)) return rowCursor; // cycle guard — malformed data only
    visiting.add(g.id);
    const rawKids = (childrenOf.get(g.id) ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
    const collapse = rawKids.length > 0 && rawKids[0].level === 'daily' && !expanded.has(g.id);
    if (collapse) collapsedCounts.set(g.id, rawKids.length);
    const kids = collapse ? [] : rawKids;
    const x = COL_OF[g.level] * COL_GAP;
    let rowY: number;
    if (kids.length === 0) {
      rowY = rowCursor;
      rowCursor += 1;
    } else {
      const childRows = kids.map(place);
      rowY = (childRows[0] + childRows[childRows.length - 1]) / 2;
    }
    positions.set(g.id, { x, y: rowY * ROW_H });
    visiting.delete(g.id);
    return rowY;
  };

  const parentedIds = new Set<string>();
  for (const [, kids] of childrenOf) for (const k of kids) parentedIds.add(k.id);
  const roots = goals.filter((g) => !parentedIds.has(g.id));
  for (const root of roots) place(root);

  const nodes: Positioned[] = goals
    .filter((g) => positions.has(g.id))
    .map((g) => ({ goal: g, ...positions.get(g.id)! }));
  const byGoalId = new Map(nodes.map((n) => [n.goal.id, n]));
  const edges: { from: Positioned; to: Positioned }[] = [];
  for (const n of nodes) {
    const parent = n.goal.parent_id ? byGoalId.get(n.goal.parent_id) : undefined;
    if (parent) edges.push({ from: parent, to: n });
  }

  const maxX = nodes.reduce((m, n) => Math.max(m, n.x + NODE_W), 0);
  const maxY = nodes.reduce((m, n) => Math.max(m, n.y + NODE_H), 0);
  return { nodes, edges, w: maxX, h: maxY, collapsedCounts, collapsibleIds };
}

function edgePath(from: Positioned, to: Positioned): string {
  const sx = from.x + NODE_W;
  const sy = from.y + NODE_H / 2;
  const ex = to.x;
  const ey = to.y + NODE_H / 2;
  const dx = Math.max(24, (ex - sx) / 2);
  return `M ${sx},${sy} C ${sx + dx},${sy} ${ex - dx},${ey} ${ex},${ey}`;
}

export function GoalsCanvas({
  goals,
  onOpen,
  query,
  dept,
  status,
  due,
  assignee,
  isMatch,
}: {
  goals: Goal[];
  onOpen: (g: Goal) => void;
  query: string;
  dept: string;
  status: 'all' | GoalStatus;
  due: 'all' | 'overdue' | 'week';
  assignee: string;
  isMatch: (g: Goal) => boolean;
}) {
  // Daily goals collapsed by default (one badge per Monthly parent) — see
  // module doc comment for why.
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const { nodes, edges, w, h, collapsedCounts, collapsibleIds } = React.useMemo(
    () => layout(goals, expanded),
    [goals, expanded],
  );
  const filtersActive =
    query.trim() !== '' || dept !== 'all' || status !== 'all' || due !== 'all' || assignee !== 'all';

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const allExpanded = collapsibleIds.length > 0 && collapsibleIds.every((id) => expanded.has(id));
  const toggleExpandAll = () => setExpanded(allExpanded ? new Set() : new Set(collapsibleIds));

  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [t, setT] = React.useState({ x: 0, y: 0, scale: 1 });
  const dragRef = React.useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  // Full-screen mode: the canvas takes over the whole viewport (CSS overlay,
  // not the browser Fullscreen API, so it works the same inside an iframe or
  // embedded window). Escape exits it, matching normal full-screen behavior.
  const [fullscreen, setFullscreen] = React.useState(false);
  React.useEffect(() => {
    if (!fullscreen) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [fullscreen]);

  const fit = React.useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || nodes.length === 0) return;
    const rect = vp.getBoundingClientRect();
    const availW = Math.max(1, rect.width - PAD * 2);
    const availH = Math.max(1, rect.height - PAD * 2);
    const scale = Math.max(MIN_SCALE, Math.min(FIT_MAX_SCALE, availW / Math.max(w, 1), availH / Math.max(h, 1)));
    const x = (rect.width - w * scale) / 2;
    const y = (rect.height - h * scale) / 2;
    setT({ x, y, scale });
  }, [nodes.length, w, h]);

  React.useEffect(() => {
    fit();
  }, [fit]);

  React.useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(vp);
    return () => ro.disconnect();
  }, [fit]);

  // Stretch the canvas to fill the rest of the viewport below it (instead of
  // capping at a fixed height) so it reads as one big board rather than a
  // small tile with dead space beneath it. Measured once against the page's
  // resting scroll position — everything above the canvas is static once
  // mounted — and re-measured on resize. The mobile bottom tab bar eats into
  // the available space, so it gets extra margin there.
  React.useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    if (fullscreen) {
      // Full-screen CSS class owns sizing (100vh) — drop the inline override.
      vp.style.height = '';
      return;
    }
    const update = () => {
      const isMobile = window.innerWidth <= 768;
      const bottomMargin = isMobile ? 90 : 24;
      const rect = vp.getBoundingClientRect();
      const h = Math.max(420, window.innerHeight - rect.top - bottomMargin);
      vp.style.height = `${h}px`;
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [fullscreen]);

  // Wheel-to-zoom, anchored on the cursor. Bound natively (not passive) so
  // preventDefault actually stops the page from scrolling underneath.
  React.useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setT((prev) => {
        const factor = Math.exp(-e.deltaY * 0.0018);
        const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale * factor));
        const worldX = (cx - prev.x) / prev.scale;
        const worldY = (cy - prev.y) / prev.scale;
        return { scale, x: cx - worldX * scale, y: cy - worldY * scale };
      });
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, []);

  const onBgPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
  };
  const onBgPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setT((prev) => ({ ...prev, x: d.tx + (e.clientX - d.x), y: d.ty + (e.clientY - d.y) }));
  };
  const onBgPointerUp = () => {
    dragRef.current = null;
  };

  const zoomBy = (factor: number) => {
    const vp = viewportRef.current;
    const rect = vp?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;
    setT((prev) => {
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale * factor));
      const worldX = (cx - prev.x) / prev.scale;
      const worldY = (cy - prev.y) / prev.scale;
      return { scale, x: cx - worldX * scale, y: cy - worldY * scale };
    });
  };

  if (nodes.length === 0) {
    return (
      <div className="gb-canvas-viewport gb-canvas-empty">
        <EmptyState icon="target" title="Nothing to map yet" hint="Add a yearly task to see it here." />
      </div>
    );
  }

  return (
    <div
      className={`gb-canvas-viewport${fullscreen ? ' gb-canvas-fullscreen' : ''}`}
      ref={viewportRef}
    >
      <div
        className="gb-canvas-pan"
        onPointerDown={onBgPointerDown}
        onPointerMove={onBgPointerMove}
        onPointerUp={onBgPointerUp}
        onPointerLeave={onBgPointerUp}
      >
        <div
          className="gb-canvas-world"
          style={{
            width: w,
            height: h,
            transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`,
          }}
        >
          <svg className="gb-canvas-edges" width={w} height={h}>
            {edges.map(({ from, to }) => (
              <path
                key={to.goal.id}
                d={edgePath(from, to)}
                className={`gb-canvas-edge gb-canvas-edge-${to.goal.status}`}
              />
            ))}
          </svg>
          {nodes.map((n) => {
            const dim = filtersActive && !isMatch(n.goal);
            const hidden = collapsedCounts.get(n.goal.id) ?? 0;
            return (
              <div
                key={n.goal.id}
                role="button"
                tabIndex={0}
                className={`gb-canvas-node gb-canvas-node-${n.goal.status}${dim ? ' gb-canvas-node-dim' : ''}`}
                style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onOpen(n.goal)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(n.goal);
                  }
                }}
                title={n.goal.title}
              >
                <span className="gb-canvas-node-tier">{TIER_TAG[n.goal.level]}</span>
                <span className="gb-canvas-node-title">{n.goal.title}</span>
                <span className={`gb-canvas-node-badge badge ${STATUS[n.goal.status].cls}`}>
                  {STATUS[n.goal.status].label}
                </span>
                {hidden > 0 ? (
                  <button
                    type="button"
                    className="gb-canvas-node-more"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(n.goal.id);
                    }}
                  >
                    +{hidden} <Icon name="chevron-right" size={10} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {collapsibleIds.length > 0 ? (
        <div className="gb-canvas-topbar">
          <button type="button" className="gb-canvas-topbar-btn" onClick={toggleExpandAll}>
            <Icon name={allExpanded ? 'chevron-down' : 'chevron-right'} size={13} />
            {allExpanded ? 'Collapse daily tasks' : 'Expand all daily tasks'}
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className="gb-canvas-fs-btn"
        onClick={() => setFullscreen((v) => !v)}
        aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
        title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen'}
      >
        <Icon name={fullscreen ? 'minimize' : 'maximize'} size={15} />
      </button>
      <div className="gb-canvas-controls">
        <button type="button" className="gb-canvas-ctl-btn" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
          <Icon name="minus" size={14} />
        </button>
        <span className="gb-canvas-zoom-pct">{Math.round(t.scale * 100)}%</span>
        <button type="button" className="gb-canvas-ctl-btn" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
          <Icon name="plus" size={14} />
        </button>
        <button type="button" className="gb-canvas-ctl-btn gb-canvas-ctl-fit" onClick={fit}>
          <Icon name="eye" size={13} /> Fit all
        </button>
      </div>
    </div>
  );
}
