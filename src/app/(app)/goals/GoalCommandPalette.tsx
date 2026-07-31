'use client';

// Quick-jump command palette (Cmd/Ctrl+K). Type a few letters of any goal and
// jump straight to it in the cascade — no scrolling through the tree. Filters
// by title + department; ↑/↓ to move, Enter to jump, Esc to close.
import * as React from 'react';
import { Icon } from '@/components/Icon';
import { LEVEL_META } from './goal-ui';
import type { Goal } from '@/lib/types';

export function GoalCommandPalette({
  open,
  goals,
  onClose,
  onJump,
}: {
  open: boolean;
  goals: Goal[];
  onClose: () => void;
  onJump: (g: Goal) => void;
}) {
  const [q, setQ] = React.useState('');
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Reset + focus each time it opens.
  React.useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      // focus after paint
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const matches = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    const ranked = goals.filter((g) =>
      s ? `${g.title} ${g.department}`.toLowerCase().includes(s) : true,
    );
    return ranked.slice(0, 30);
  }, [goals, q]);

  React.useEffect(() => setActive(0), [q]);

  if (!open) return null;

  const choose = (g: Goal | undefined) => {
    if (g) onJump(g);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(matches[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="gb-cmdk-backdrop" onClick={onClose} role="presentation">
      <div className="gb-cmdk" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Jump to task">
        <div className="gb-cmdk-input-wrap">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            className="gb-cmdk-input"
            placeholder="Jump to a task…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className="gb-kbd">Esc</kbd>
        </div>
        <div className="gb-cmdk-list">
          {matches.length === 0 ? (
            <div className="gb-cmdk-empty">No tasks match “{q}”.</div>
          ) : (
            matches.map((g, i) => (
              <button
                key={g.id}
                type="button"
                className={`gb-cmdk-item${i === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(g)}
              >
                <span className="gb-cmdk-tier">{LEVEL_META[g.level].label}</span>
                <span className="gb-cmdk-title">{g.title}</span>
                {g.department ? <span className="gb-cmdk-dept">{g.department}</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
