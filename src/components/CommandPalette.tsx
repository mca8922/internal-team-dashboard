'use client';

// Global quick-switcher (⌘K / Ctrl+K). Type to fuzzy-find a page or action and
// jump straight there — no hunting through the sidebar. Board-only destinations
// are filtered out for members.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  keywords?: string;
  run: () => void;
}

export function CommandPalette({ isBoard }: { isBoard: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const commands: Cmd[] = React.useMemo(() => {
    const go = (path: string) => () => {
      setOpen(false);
      router.push(path);
    };
    const list: (Cmd | null)[] = [
      { id: 'dashboard', label: 'Dashboard', icon: 'home', run: go('/dashboard') },
      { id: 'punch', label: 'Punch', icon: 'clock', keywords: 'time clock in out', run: go('/punch') },
      { id: 'log', label: 'Daily Log', icon: 'edit', keywords: 'journal write', run: go('/log') },
      { id: 'goals', label: 'Goals', icon: 'target', keywords: 'tasks checklist', run: go('/goals') },
      isBoard ? { id: 'team', label: 'Team', icon: 'users', keywords: 'members people', run: go('/team') } : null,
      { id: 'analytics', label: 'Analytics', icon: 'chart', keywords: 'stats hours', run: go('/analytics') },
      isBoard
        ? {
            id: 'team-analytics',
            label: 'Team analytics',
            hint: 'Goals & org roll-ups',
            icon: 'chart',
            keywords: 'goals completion overdue department',
            run: go('/analytics/team'),
          }
        : null,
      { id: 'leaves', label: 'Leaves', icon: 'plane', keywords: 'time off holiday', run: go('/leaves') },
      isBoard ? { id: 'emails', label: 'Emails', icon: 'mail', run: go('/email') } : null,
      { id: 'settings', label: 'Settings', icon: 'settings', keywords: 'profile password theme', run: go('/settings') },
      {
        id: 'tour',
        label: 'Replay onboarding tour',
        icon: 'help-circle',
        keywords: 'help guide walkthrough',
        run: () => {
          setOpen(false);
          window.dispatchEvent(new Event('restruc:open-tour'));
        },
      },
    ];
    return list.filter(Boolean) as Cmd[];
  }, [isBoard, router]);

  const filtered = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter((c) =>
      `${c.label} ${c.hint ?? ''} ${c.keywords ?? ''}`.toLowerCase().includes(s),
    );
  }, [q, commands]);

  // Global open/close hotkey.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  React.useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);
  React.useEffect(() => setActive(0), [q]);

  if (!open || typeof document === 'undefined') return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      filtered[active]?.run();
    }
  };

  return createPortal(
    <div className="cmdk-overlay" onMouseDown={() => setOpen(false)}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="cmdk-input-wrap">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Jump to a page or action…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Command palette"
          />
          <kbd className="cmdk-kbd">Esc</kbd>
        </div>
        <div className="cmdk-list">
          {filtered.length === 0 ? (
            <div className="cmdk-empty">No matches</div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                type="button"
                className={`cmdk-item${i === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => c.run()}
              >
                <Icon name={c.icon} size={16} />
                <span className="cmdk-item-label">{c.label}</span>
                {c.hint ? <span className="cmdk-item-hint">{c.hint}</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
