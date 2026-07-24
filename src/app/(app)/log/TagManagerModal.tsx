'use client';

// Tag manager — reachable from the Tags field in the daily log editor.
// Shows usage distribution as a pie chart and lets a member rename or delete
// a tag everywhere it appears across their own logs. The chart's own legend
// IS the management list (via TagPieChart's renderName/renderActions slots)
// rather than a second, redundant list underneath it.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { TagPieChart } from '@/components/charts';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { renameTag, deleteTag } from '@/lib/actions';

interface TagStat {
  tag: string;
  count: number;
}

export function TagManagerModal({
  tagStats,
  onClose,
  onTagRenamed,
  onTagDeleted,
}: {
  tagStats: TagStat[];
  onClose: () => void;
  onTagRenamed?: (oldTag: string, newTag: string) => void;
  onTagDeleted?: (tag: string) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [stats, setStats] = React.useState(tagStats);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const startEdit = (tag: string) => {
    setEditing(tag);
    setEditValue(tag);
  };

  const commitEdit = async (oldTag: string) => {
    const clean = editValue.trim();
    setEditing(null);
    if (!clean || clean === oldTag) return;
    setBusy(oldTag);
    await renameTag(oldTag, clean);
    setStats((cur) => {
      const merged = new Map<string, number>();
      for (const s of cur) {
        const key = s.tag === oldTag ? clean : s.tag;
        merged.set(key, (merged.get(key) ?? 0) + s.count);
      }
      return [...merged.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([tag, count]) => ({ tag, count }));
    });
    setBusy(null);
    toast(`Renamed to "${clean}"`);
    onTagRenamed?.(oldTag, clean);
    router.refresh();
  };

  const remove = async (tag: string) => {
    const count = stats.find((s) => s.tag === tag)?.count ?? 0;
    const ok = await confirm({
      title: 'Delete this tag?',
      message: `"${tag}" will be removed from ${count} log${count === 1 ? '' : 's'}. This cannot be undone.`,
      confirmLabel: 'Delete tag',
      tone: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    setBusy(tag);
    await deleteTag(tag);
    setStats((cur) => cur.filter((s) => s.tag !== tag));
    setBusy(null);
    toast('Tag deleted');
    onTagDeleted?.(tag);
    router.refresh();
  };

  const total = stats.reduce((a, b) => a + b.count, 0);

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 200 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Manage tags"
        className="tagmgr-panel"
      >
        <button className="tagmgr-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div style={{ paddingRight: 36 }}>
          <div className="tagmgr-badge">Tag analytics</div>
          <h2 className="tagmgr-title">Manage tags</h2>
          <p className="tagmgr-desc">
            {total > 0
              ? `${stats.length} tag${stats.length === 1 ? '' : 's'} across ${total} use${total === 1 ? '' : 's'}. Rename or delete a tag to update it everywhere at once.`
              : 'No tags logged yet. Add some from the Daily Log page.'}
          </p>
        </div>

        {total > 0 ? (
          <TagPieChart
            data={stats}
            renderName={(tag, isOther) => {
              if (isOther) return <span className="tag-legend-name">{tag}</span>;
              if (editing === tag) {
                return (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => commitEdit(tag)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitEdit(tag); }
                      else if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
                    }}
                    className="tag-legend-name-input"
                  />
                );
              }
              return (
                <button
                  type="button"
                  className="tag-legend-name tag-legend-name-btn"
                  onClick={() => startEdit(tag)}
                  title="Click to rename"
                >
                  {tag}
                </button>
              );
            }}
            renderActions={(tag, isOther) =>
              isOther ? null : (
                <div className="tag-legend-actions">
                  <button
                    onClick={() => startEdit(tag)}
                    aria-label={`Rename ${tag}`}
                    title="Rename"
                    disabled={busy === tag}
                  >
                    <Icon name="edit" size={12} />
                  </button>
                  <button
                    className="tag-legend-delete"
                    onClick={() => remove(tag)}
                    aria-label={`Delete ${tag}`}
                    title="Delete"
                    disabled={busy === tag}
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              )
            }
          />
        ) : null}
      </div>
    </div>
  );
}
