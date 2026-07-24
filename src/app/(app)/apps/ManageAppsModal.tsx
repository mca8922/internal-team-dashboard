'use client';

// Board-only "manage apps" modal. Add a new app via the form, or edit / hide /
// delete an existing one in the list below. Apps are independently deployed, so
// the Board only curates the registry here: name, URL, department, and a framed
// transparent backdrop image for the tile.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Modal } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import {
  createDepartmentApp,
  updateDepartmentApp,
  setDepartmentAppActive,
  deleteDepartmentApp,
} from '@/lib/actions';
import type { DepartmentApp } from '@/lib/types';
import { appIconName } from './AppsView';
import { ImageFramer } from './ImageFramer';

const COMPANY_WIDE = '';

type FormState = {
  name: string;
  url: string;
  department: string; // '' = company-wide
  description: string;
  image_url: string | null;
};

const EMPTY_FORM: FormState = {
  name: '',
  url: '',
  department: '',
  description: '',
  image_url: null,
};

// A small transparency-aware preview swatch (checkerboard behind the image).
function ImageSwatch({ src, size = 30 }: { src: string | null; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
        border: '1px solid var(--color-border)',
        backgroundColor: '#2a2f36',
        backgroundImage:
          'linear-gradient(45deg, rgba(255,255,255,0.08) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.08) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.08) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.08) 75%)',
        backgroundSize: '10px 10px',
        backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0',
        color: 'var(--color-grey-text)',
      }}
    >
      {src ? (
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : (
        <Icon name="monitor" size={Math.round(size * 0.5)} />
      )}
    </span>
  );
}

function AppForm({
  editing,
  departments,
  onSaved,
  onCancelEdit,
}: {
  editing: DepartmentApp | null;
  departments: string[];
  onSaved: () => void;
  onCancelEdit: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [pending, setPending] = React.useState(false);
  const [rawSrc, setRawSrc] = React.useState<string | null>(null); // image awaiting framing
  const [framerOpen, setFramerOpen] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  // Seed the form from the app being edited (or reset to blank for a new one).
  React.useEffect(() => {
    setForm(
      editing
        ? {
            name: editing.name,
            url: editing.url,
            department: editing.department ?? COMPANY_WIDE,
            description: editing.description,
            image_url: editing.image_url,
          }
        : EMPTY_FORM,
    );
  }, [editing]);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Please choose an image file.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setRawSrc(reader.result as string);
      setFramerOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    setPending(true);
    try {
      const payload = {
        name: form.name,
        url: form.url,
        department: form.department === COMPANY_WIDE ? null : form.department,
        description: form.description,
        image_url: form.image_url,
      };
      if (editing) {
        await updateDepartmentApp(editing.id, payload);
        toast(`Updated "${form.name.trim()}"`);
      } else {
        await createDepartmentApp(payload);
        toast(`Added "${form.name.trim()}"`);
      }
      setForm(EMPTY_FORM);
      onSaved();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        padding: 14,
        marginBottom: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div className="card-title">{editing ? 'Edit app' : 'Add an app'}</div>

      <div className="grid-2col-even" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="text-xs text-grey">Name</span>
          <input
            className="input"
            value={form.name}
            placeholder="e.g. Content Calendar"
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="text-xs text-grey">Department</span>
          <select
            className="select"
            value={form.department}
            onChange={(e) => set({ department: e.target.value })}
          >
            <option value={COMPANY_WIDE}>Company-wide (everyone)</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="text-xs text-grey">URL</span>
        <input
          className="input"
          value={form.url}
          placeholder="https://app.example.com"
          onChange={(e) => set({ url: e.target.value })}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span className="text-xs text-grey">Description (optional)</span>
        <input
          className="input"
          value={form.description}
          placeholder="What this tool is for, in a few words"
          onChange={(e) => set({ description: e.target.value })}
        />
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="text-xs text-grey">Tile image (optional, transparent looks best)</span>
        <div className="flex items-center gap-2">
          <ImageSwatch src={form.image_url} size={48} />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onPickFile}
            style={{ display: 'none' }}
          />
          <Button
            size="sm"
            variant="secondary"
            icon="copy"
            onClick={() => fileRef.current?.click()}
            disabled={pending}
          >
            {form.image_url ? 'Replace' : 'Upload image'}
          </Button>
          {form.image_url && (
            <Button
              size="sm"
              variant="ghost"
              icon="trash"
              onClick={() => set({ image_url: null })}
              disabled={pending}
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2" style={{ justifyContent: 'flex-end' }}>
        {editing && (
          <Button variant="ghost" size="sm" onClick={onCancelEdit} disabled={pending}>
            Cancel
          </Button>
        )}
        <Button
          size="sm"
          onClick={submit}
          loading={pending}
          disabled={pending || !form.name.trim() || !form.url.trim()}
        >
          {editing ? 'Save changes' : 'Add app'}
        </Button>
      </div>

      <ImageFramer
        open={framerOpen}
        src={rawSrc}
        onConfirm={(dataUrl) => {
          set({ image_url: dataUrl });
          setFramerOpen(false);
          setRawSrc(null);
        }}
        onCancel={() => {
          setFramerOpen(false);
          setRawSrc(null);
        }}
      />
    </div>
  );
}

function AppRow({
  app,
  pending,
  setPending,
  onEdit,
  onChanged,
}: {
  app: DepartmentApp;
  pending: boolean;
  setPending: (v: boolean) => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();

  const toggle = async () => {
    setPending(true);
    try {
      await setDepartmentAppActive(app.id, !app.is_active);
      toast(app.is_active ? `"${app.name}" hidden` : `"${app.name}" shown`);
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete "${app.name}"?`,
      message: 'This removes the app from the launchpad. The app itself is not affected.',
      confirmLabel: 'Delete app',
      tone: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    setPending(true);
    try {
      await deleteDepartmentApp(app.id);
      toast(`"${app.name}" deleted`);
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="flex items-center gap-2"
      style={{
        borderBottom: '1px solid var(--color-border)',
        padding: '10px 0',
        opacity: app.is_active ? 1 : 0.55,
      }}
    >
      {app.image_url ? (
        <ImageSwatch src={app.image_url} size={32} />
      ) : (
        <span
          aria-hidden
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 32,
            height: 32,
            borderRadius: 8,
            flexShrink: 0,
            color: 'var(--color-green-primary)',
            background: 'var(--color-green-light)',
          }}
        >
          <Icon name={appIconName(app.icon)} size={16} />
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="card-title" style={{ fontSize: 14 }}>
          {app.name}
          {!app.is_active && <span className="text-xs text-grey"> · hidden</span>}
        </div>
        <div
          className="text-xs text-grey"
          style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {app.department ?? 'Company-wide'} · {app.url}
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        icon="eye"
        onClick={toggle}
        disabled={pending}
        title={app.is_active ? 'Hide from members' : 'Show to members'}
      >
        {app.is_active ? 'Hide' : 'Show'}
      </Button>
      <Button size="sm" variant="secondary" onClick={onEdit} disabled={pending}>
        Edit
      </Button>
      <Button
        size="sm"
        variant="danger"
        icon="trash"
        onClick={remove}
        disabled={pending}
        title="Delete app"
      />
    </div>
  );
}

export function ManageAppsModal({
  open,
  onClose,
  apps,
  departments,
}: {
  open: boolean;
  onClose: () => void;
  apps: DepartmentApp[];
  departments: string[];
  deptColors: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [editing, setEditing] = React.useState<DepartmentApp | null>(null);

  // After a save, refresh so the list (passed in from the server) re-seeds.
  const refresh = () => router.refresh();

  return (
    <Modal open={open} onClose={onClose} title="Manage apps" width={620}>
      <p className="text-xs text-grey mb-4">
        Register a department&rsquo;s tools here. Members see the active apps for their own
        department (plus company-wide ones); hidden apps stay registered but invisible.
      </p>

      <AppForm
        editing={editing}
        departments={departments}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
        onCancelEdit={() => setEditing(null)}
      />

      {apps.length === 0 ? (
        <div className="empty-state" style={{ padding: '24px 0' }}>
          <Icon name="monitor" size={32} stroke={1.2} />
          <h3>No apps registered</h3>
        </div>
      ) : (
        <div>
          {apps.map((a) => (
            <AppRow
              key={a.id}
              app={a}
              pending={pending}
              setPending={setPending}
              onEdit={() => setEditing(a)}
              onChanged={refresh}
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
