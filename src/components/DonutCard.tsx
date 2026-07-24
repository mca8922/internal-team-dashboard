'use client';

// Donut + legend, wired together: hovering a legend row highlights its arc
// segment (brighten, thicken, dim the rest) and vice versa, via Donut's
// activeIndex/onHoverIndex controlled-hover API. A thin, reusable wrapper so
// any "ring + legend list" card gets the same lively, connected feel.
import * as React from 'react';
import { Donut } from './ui';

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
  // Pre-formatted text for the legend row (e.g. "115.6h") — falls back to
  // the plain numeric value when omitted.
  displayValue?: React.ReactNode;
}

export function DonutCard({
  data,
  size = 160,
  thickness = 26,
  centerLabel,
  centerValue,
}: {
  data: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel: string;
  centerValue: React.ReactNode;
}) {
  const [hover, setHover] = React.useState<number | null>(null);

  return (
    <div className="analytics-donut-row">
      <div className="relative">
        <Donut data={data} size={size} thickness={thickness} activeIndex={hover} onHoverIndex={setHover} />
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <div className="text-center">
            <div className="text-xs text-grey">{centerLabel}</div>
            <div className="text-xl fw-bold">{centerValue}</div>
          </div>
        </div>
      </div>
      <div className="grid gap-2">
        {data.map((d, i) => (
          <div
            key={d.label}
            className={`donut-legend-row${hover === i ? ' active' : ''}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="donut-legend-dot" style={{ background: d.color }} />
            <span className="fw-medium">{d.label}</span>
            <span className="text-grey">{d.displayValue ?? d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
