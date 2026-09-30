'use client';

// A `.data-table` whose column headers sort the rows on click — first click
// ascending, next click descending, and so on. The server renders every cell
// up front and hands over a plain sort key per cell, so a Server Component
// page (Team Analytics) keeps all its data work on the server and only the
// row ORDER is decided here.
import * as React from 'react';

export type SortValue = string | number | null;
type SortDir = 'asc' | 'desc';

export interface SortColumn {
  key: string;
  label: React.ReactNode;
  // Small second line under the label (e.g. the date under a heatmap day).
  sub?: React.ReactNode;
  align?: 'left' | 'center' | 'right';
  // Defaults to true. A column with no meaningful order opts out.
  sortable?: boolean;
  // Applied to this column's <th> and every <td> (e.g. the weekend band).
  className?: string;
  thStyle?: React.CSSProperties;
  tdStyle?: React.CSSProperties;
  tdClassName?: string;
}

export interface SortRow {
  id: string;
  cells: React.ReactNode[];
  // One key per column, same order as `cells`. null always sorts last.
  sort: SortValue[];
}

function compare(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export function SortableTable({
  columns,
  rows,
  initialSort,
  className,
}: {
  columns: SortColumn[];
  rows: SortRow[];
  initialSort?: { key: string; dir: SortDir };
  className?: string;
}) {
  const [sort, setSort] = React.useState<{ key: string; dir: SortDir } | null>(initialSort ?? null);

  const sorted = React.useMemo(() => {
    const idx = sort ? columns.findIndex((c) => c.key === sort.key) : -1;
    if (!sort || idx < 0) return rows;
    const sign = sort.dir === 'asc' ? 1 : -1;
    // Stable: ties keep the server's order.
    return rows
      .map((r, i) => ({ r, i }))
      .sort((x, y) => {
        const a = x.r.sort[idx] ?? null;
        const b = y.r.sort[idx] ?? null;
        if (a === null && b === null) return x.i - y.i;
        if (a === null) return 1;
        if (b === null) return -1;
        return compare(a, b) * sign || x.i - y.i;
      })
      .map(({ r }) => r);
  }, [rows, columns, sort]);

  const toggle = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  return (
    <table className={['data-table', className].filter(Boolean).join(' ')}>
      <thead>
        <tr>
          {columns.map((c) => {
            const align = c.align ?? 'left';
            const sortable = c.sortable !== false;
            const active = sort?.key === c.key;
            const justify = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
            return (
              <th
                key={c.key}
                scope="col"
                className={[c.className, sortable && 'sort-th'].filter(Boolean).join(' ') || undefined}
                style={{ textAlign: align, ...c.thStyle }}
                aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : sortable ? 'none' : undefined}
              >
                {sortable ? (
                  <button
                    type="button"
                    className={`sort-th-btn${active ? ' active' : ''}`}
                    style={{ justifyContent: justify, flexDirection: c.sub ? 'column' : 'row', alignItems: c.sub ? (align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start') : 'center' }}
                    onClick={() => toggle(c.key)}
                    title={`Sort by ${typeof c.label === 'string' ? c.label : 'this column'}`}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {c.label}
                      <span className="sort-th-caret" aria-hidden="true">
                        {active ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </span>
                    {c.sub ? <span style={{ fontSize: 9, color: 'var(--color-grey-text)' }}>{c.sub}</span> : null}
                  </button>
                ) : (
                  <>
                    {c.label}
                    {c.sub ? <div style={{ fontSize: 9, color: 'var(--color-grey-text)' }}>{c.sub}</div> : null}
                  </>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.id}>
            {r.cells.map((cell, i) => {
              const c = columns[i];
              return (
                <td
                  key={c?.key ?? i}
                  className={[c?.className, c?.tdClassName].filter(Boolean).join(' ') || undefined}
                  style={{ textAlign: c?.align, ...c?.tdStyle }}
                >
                  {cell}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
