// Loading skeletons rendered by route `loading.tsx` files while a Server
// Component page streams its data. The shapes mirror the real page layout
// (header + a grid of cards) so the swap to real content is visually quiet.
// Pure markup — no client JS — the shimmer is CSS (.skeleton in globals.css).
import * as React from 'react';

function Bar({ w, h = 14 }: { w: number | string; h?: number }) {
  return <div className="skeleton" style={{ width: w, height: h }} />;
}

function SkeletonCard() {
  return (
    <div className="card">
      <Bar w={120} h={11} />
      <div style={{ height: 16 }} />
      <Bar w="100%" />
      <div style={{ height: 8 }} />
      <Bar w="80%" />
      <div style={{ height: 8 }} />
      <Bar w="55%" />
    </div>
  );
}

export function PageSkeleton({
  cards = 4,
  columns = 2,
}: {
  cards?: number;
  columns?: number;
}) {
  return (
    <div className="fade-in" aria-busy="true">
      <div className="page-header">
        <div>
          <Bar w={200} h={26} />
          <div style={{ height: 10 }} />
          <Bar w={280} h={13} />
        </div>
      </div>
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 16 }}
      >
        {Array.from({ length: cards }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
