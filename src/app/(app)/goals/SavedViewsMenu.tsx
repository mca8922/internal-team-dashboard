'use client';

// Saved views — name and re-apply a Goals-browser preset (view + grouping +
// sort + filters). Per-user, stored in Supabase (goal_saved_views) so they
// follow the user across devices.
import * as React from 'react';
import { Icon } from '@/components/Icon';
import { createSavedView, deleteSavedView } from '@/lib/actions';
import type { SavedView, GoalViewConfig } from '@/lib/types';

export function SavedViewsMenu({
  views,
  current,
  onApply,
  onError,
}: {
  views: SavedView[];
  current: GoalViewConfig;
  onApply: (cfg: GoalViewConfig) => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [naming, setNaming] = React.useState(false);
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setNaming(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const save = async () => {
    const clean = name.trim();
    if (!clean) return;
    setBusy(true);
    try {
      await createSavedView(clean, current);
      setName('');
      setNaming(false);
      setOpen(false);
    } catch (e) {
      onError((e as Error).message || 'Could not save the view.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteSavedView(id);
    } catch (e) {
      onError((e as Error).message || 'Could not delete the view.');
    }
  };

  return (
    <div className="gb-views-wrap" ref={wrapRef}>
      <button
        type="button"
        className="gb-views-trigger"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="eye" size={14} /> Views
        {views.length > 0 ? <span className="gb-views-count">{views.length}</span> : null}
        <Icon name="chevron-down" size={13} />
      </button>
      {open ? (
        <div className="gb-views-menu">
          {views.length === 0 ? (
            <div className="gb-views-empty">No saved views yet.</div>
          ) : (
            views.map((v) => (
              <div key={v.id} className="gb-views-item">
                <button
                  type="button"
                  className="gb-views-apply"
                  onClick={() => {
                    onApply(v.config);
                    setOpen(false);
                  }}
                >
                  {v.name}
                </button>
                <button
                  type="button"
                  className="icon-btn gb-views-del"
                  aria-label={`Delete view ${v.name}`}
                  title="Delete view"
                  onClick={() => remove(v.id)}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            ))
          )}
          <div className="gb-views-foot">
            {naming ? (
              <div className="gb-views-namerow">
                <input
                  className="gb-views-nameinput"
                  placeholder="Name this view…"
                  value={name}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') save();
                    if (e.key === 'Escape') setNaming(false);
                  }}
                />
                <button
                  type="button"
                  className="gb-views-savebtn"
                  disabled={busy || !name.trim()}
                  onClick={save}
                >
                  Save
                </button>
              </div>
            ) : (
              <button type="button" className="gb-views-add" onClick={() => setNaming(true)}>
                <Icon name="plus" size={13} /> Save current view
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
