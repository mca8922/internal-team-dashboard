'use client';

// Detailed, read-only viewer for one member's work logs. The Board picks a date
// from the list on the left and reads that day's full entry (mood, energy,
// tags, and every block) on the right — no truncation, unlike the dashboard
// preview cards.
import * as React from 'react';
import { BlockRender } from '@/components/BlockEditor';
import { EmptyState } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { fmtFriendly, fmtRelative, parseDate } from '@/lib/dates';
import type { WorkLog } from '@/lib/types';

export function MemberLogs({ logs }: { logs: WorkLog[] }) {
  // Newest first; only logs with actual content are passed in.
  const [selectedId, setSelectedId] = React.useState<string | null>(
    logs.length ? logs[0].id : null,
  );
  const [query, setQuery] = React.useState('');

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((l) => {
      if ((l.tags || []).some((t) => t.toLowerCase().includes(q))) return true;
      return (l.blocks || []).some((b) => (b.content || '').toLowerCase().includes(q));
    });
  }, [logs, query]);

  const selected = logs.find((l) => l.id === selectedId) || filtered[0] || null;

  if (logs.length === 0) {
    return (
      <div className="card">
        <div className="card-subtitle mb-3">Work logs</div>
        <EmptyState icon="edit" title="No logs yet" />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-subtitle">Work logs · {logs.length}</div>
        <div style={{ position: 'relative', width: 200 }}>
          <Icon
            name="search"
            size={13}
            style={{ position: 'absolute', left: 10, top: 10, color: 'var(--color-grey-text)' }}
          />
          <input
            className="input"
            placeholder="Search logs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ paddingLeft: 30, height: 34, fontSize: 13 }}
          />
        </div>
      </div>

      <div className="grid member-logs-grid" style={{ gridTemplateColumns: '220px 1fr', gap: 16 }}>
        {/* date list */}
        <div
          className="member-logs-list"
          style={{
            maxHeight: 520,
            overflowY: 'auto',
            borderRight: '1px solid var(--color-border)',
            paddingRight: 12,
          }}
        >
          {filtered.length === 0 ? (
            <div className="text-grey text-sm">No logs match.</div>
          ) : (
            <div className="grid gap-1">
              {filtered.map((l) => {
                const active = selected?.id === l.id;
                return (
                  <button
                    key={l.id}
                    onClick={() => setSelectedId(l.id)}
                    style={{
                      textAlign: 'left',
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: active ? 'var(--color-bg)' : 'transparent',
                      border: active
                        ? '1px solid var(--color-border)'
                        : '1px solid transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm fw-medium">{fmtRelative(parseDate(l.log_date))}</span>
                      {l.mood ? <span style={{ fontSize: 15 }}>{l.mood}</span> : null}
                    </div>
                    <div className="text-xs text-grey">{l.log_date}</div>
                    {(l.tags || []).length > 0 && (
                      <div
                        className="flex items-center gap-1 mt-1"
                        style={{ flexWrap: 'wrap' }}
                      >
                        {l.tags.slice(0, 3).map((t) => (
                          <span key={t} className="tag-chip" style={{ fontSize: 10 }}>
                            {t}
                          </span>
                        ))}
                        {l.tags.length > 3 ? (
                          <span className="text-xs text-grey">+{l.tags.length - 3}</span>
                        ) : null}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* selected log detail */}
        <div>
          {selected ? (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="fw-bold text-lg">
                  {fmtFriendly(parseDate(selected.log_date))}
                </div>
                <div className="flex items-center gap-3">
                  {selected.mood ? (
                    <span style={{ fontSize: 22 }}>{selected.mood}</span>
                  ) : null}
                  {selected.energy_level ? (
                    <span className="text-xs text-grey">energy {selected.energy_level}/5</span>
                  ) : null}
                </div>
              </div>
              {(selected.tags || []).length > 0 && (
                <div
                  className="flex items-center gap-1 mb-4"
                  style={{ flexWrap: 'wrap' }}
                >
                  {selected.tags.map((t) => (
                    <span key={t} className="tag-chip">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 14, color: 'var(--color-slate)', lineHeight: 1.6 }}>
                <BlockRender blocks={selected.blocks || []} />
              </div>
            </div>
          ) : (
            <div className="text-grey text-sm">Select a date to read the log.</div>
          )}
        </div>
      </div>
    </div>
  );
}
