'use client';

// Board-only "create team account" modal. The board fills in the new
// member's details plus a temporary password; the member changes it later
// in Settings. Backed by the createTeamMember server action (service-role).
import * as React from 'react';
import { Button, Field, Modal } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { createTeamMember } from '@/lib/actions';
import { DepartmentSelect } from '@/components/DepartmentSelect';

// Fixed temporary password handed to every new account. The member changes
// it in Settings after their first sign-in.
const TEMP_PASSWORD = 'pass@1234';

// Preset intern tenure lengths the board can pick from.
export const TENURE_OPTIONS = [1, 2, 3, 6, 12];

export function CreateMemberModal({
  open,
  onClose,
  departments,
}: {
  open: boolean;
  onClose: () => void;
  departments: string[];
}) {
  const toast = useToast();
  const [form, setForm] = React.useState({
    name: '',
    email: '',
    password: TEMP_PASSWORD,
    role: 'fte' as 'board' | 'fte' | 'pte' | 'intern',
    department: '',
  });
  const [internMonths, setInternMonths] = React.useState(3);
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const reset = () => {
    setForm({
      name: '',
      email: '',
      password: TEMP_PASSWORD,
      role: 'fte',
      department: '',
    });
    setInternMonths(3);
    setErr({});
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    const ne: Record<string, string> = {};
    if (!form.name.trim()) ne.name = 'Required';
    if (!form.email.trim()) ne.email = 'Required';
    else if (!/^[^@]+@[^@]+\.[^@]+$/.test(form.email)) ne.email = 'Invalid email';
    if (!form.password || form.password.length < 6) ne.password = 'At least 6 characters';
    if (!form.department.trim()) ne.department = 'Required';
    if (Object.keys(ne).length) {
      setErr(ne);
      return;
    }
    setErr({});
    setPending(true);
    const res = await createTeamMember({
      ...form,
      internshipMonths: form.role === 'intern' ? internMonths : null,
    });
    setPending(false);
    if (res.error) {
      setErr({ email: res.error });
      return;
    }
    toast(`Account created for ${form.name.split(' ')[0]}`);
    close();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Create account"
      subtitle="Set up an account for a team member or Board Member. Share the temporary password; they can change it in Settings."
    >
      <div className="grid gap-3">
        <Field label="Full name" error={err.name}>
          <input
            className="input"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Anjali Rao"
            autoFocus
          />
        </Field>
        <Field label="Email" error={err.email}>
          <input
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            placeholder="anjali@restruc.ai"
          />
        </Field>
        <div className="grid grid-2col-even" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Role">
            <select
              className="select"
              value={form.role}
              onChange={(e) => set('role', e.target.value)}
            >
              <option value="board">Board Member</option>
              <option value="fte">Full-Time</option>
              <option value="pte">Part-Time</option>
              <option value="intern">Intern</option>
            </select>
          </Field>
          <Field label="Department" error={err.department}>
            <DepartmentSelect
              value={form.department}
              departments={departments}
              onChange={(v) => set('department', v)}
            />
          </Field>
        </div>
        {form.role === 'intern' && (
          <Field
            label="Internship tenure"
            hint="Shown as a progress card on the intern's dashboard."
          >
            <select
              className="select"
              value={internMonths}
              onChange={(e) => setInternMonths(Number(e.target.value))}
            >
              {TENURE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} month{m > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field
          label="Temporary password"
          error={err.password}
          hint="Every new account starts with this password; the member changes it in Settings."
        >
          <input className="input" value={form.password} readOnly />
        </Field>
        <div className="modal-actions">
          <Button variant="ghost" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending} icon="plus">
            {pending ? 'Creating…' : 'Create account'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
