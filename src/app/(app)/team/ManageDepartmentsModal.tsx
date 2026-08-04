'use client';

// Board-only "manage departments" modal. Departments are derived from the
// `department` string on members and goals, so editing one renames it across
// everyone who uses it, and deleting one is only allowed when nothing does.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Modal } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { renameDepartment, deleteDepartment, setDepartmentColor } from '@/lib/actions';

export interface DepartmentStat {
  name: string;
  memberCount: number;
  goalCount: number;
  color: string | null;
}

const DEFAULT_DEPT_COLOR = '#1F5C3E';

// A curated, theme-safe palette to pick from quickly (plus the native picker
// for anything custom).
const SWATCHES = [
  '#1F5C3E',
  '#2563EB',
  '#7C3AED',
  '#DB2777',
  '#D97706',
  '#0891B2',
  '#DC2626',
  '#475569',
];

function DepartmentRow({
  dept,
  pending,
  setPending,
  onChanged,
}: {
  dept: DepartmentStat;
  pending: boolean;
  setPending: (v: boolean) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = React.useState(dept.name);
  const [color, setColor] = React.useState(dept.color || DEFAULT_DEPT_COLOR);

  // Keep the inputs in sync if the underlying list changes (e.g. after a save
  // refresh re-seeds the modal).
  React.useEffect(() => setName(dept.name), [dept.name]);
  React.useEffect(() => setColor(dept.color || DEFAULT_DEPT_COLOR), [dept.color]);

  const saveColor = async (next: string) => {
    setColor(next);
    setPending(true);
    try {
      await setDepartmentColor(dept.name, next);
      toast(`Colour set for "${dept.name}"`);
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setPending(false);
    }
  };

  const inUse = dept.memberCount > 0 || dept.goalCount > 0;
  const dirty = name.trim() !== dept.name && name.trim() !== '';

  const usage = [
    dept.memberCount > 0
      ? `${dept.memberCount} member${dept.memberCount > 1 ? 's' : ''}`
      : null,
    dept.goalCount > 0 ? `${dept.goalCount} goal${dept.goalCount > 1 ? 's' : ''}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const save = async () => {
    setPending(true);
    try {
      await renameDepartment(dept.name, name.trim());
      toast(`Renamed to "${name.trim()}"`);
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete "${dept.name}"?`,
      message: 'This department is unused, so removing it affects no members or tasks.',
      confirmLabel: 'Delete department',
      tone: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    setPending(true);
    try {
      await deleteDepartment(dept.name);
      toast(`"${dept.name}" deleted`);
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      style={{
        borderBottom: '1px solid var(--color-border)',
        paddingBottom: 12,
        marginBottom: 12,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          style={{
            width: 12,
            height: 12,
            borderRadius: 4,
            background: color,
            flexShrink: 0,
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)',
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="text-xs text-grey mt-1">{usage || 'Unused'}</div>
        </div>
        <Button size="sm" variant="secondary" onClick={save} disabled={pending || !dirty}>
          Save
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon="trash"
          onClick={remove}
          disabled={pending || inUse}
          title={inUse ? 'Reassign its members and tasks before deleting' : 'Delete department'}
        />
      </div>
      <div className="flex items-center gap-2 mt-2" style={{ flexWrap: 'wrap', paddingLeft: 20 }}>
        <span className="text-xs text-grey">Colour</span>
        {SWATCHES.map((s) => (
          <button
            key={s}
            type="button"
            title={s}
            onClick={() => saveColor(s)}
            disabled={pending}
            className="dept-swatch"
            style={{
              background: s,
              outline: color.toLowerCase() === s.toLowerCase() ? '2px solid var(--color-black)' : 'none',
            }}
          />
        ))}
        <input
          type="color"
          value={color}
          onChange={(e) => saveColor(e.target.value)}
          disabled={pending}
          title="Custom colour"
          className="dept-color-input"
        />
      </div>
    </div>
  );
}

export function ManageDepartmentsModal({
  open,
  departments,
  onClose,
}: {
  open: boolean;
  departments: DepartmentStat[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  return (
    <Modal open={open} onClose={onClose} title="Manage departments">
      <p className="text-xs text-grey mb-4">
        Renaming a department updates every member and goal that uses it. A department can
        only be deleted once nothing references it.
      </p>

      {departments.length === 0 ? (
        <div className="empty-state">
          <Icon name="building" size={36} stroke={1.2} />
          <h3>No departments yet</h3>
        </div>
      ) : (
        <div>
          {departments.map((d) => (
            <DepartmentRow
              key={d.name}
              dept={d}
              pending={pending}
              setPending={setPending}
              onChanged={() => router.refresh()}
            />
          ))}
        </div>
      )}

      <div className="modal-actions">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
