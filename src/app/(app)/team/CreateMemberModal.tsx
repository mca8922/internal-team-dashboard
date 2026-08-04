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
  viewerIsFounder,
  viewerDepartment,
}: {
  open: boolean;
  onClose: () => void;
  departments: string[];
  // Creating a Director is a structural change (migration 0058), so only a
  // Founder may do it. A Director hires only into their OWN department — the
  // department field is fixed to it rather than offered as a choice.
  viewerIsFounder: boolean;
  viewerDepartment: string;
}) {
  const toast = useToast();
  const [form, setForm] = React.useState({
    name: '',
    email: '',
    password: TEMP_PASSWORD,
    department: viewerIsFounder ? '' : viewerDepartment,
  });
  // Role (permission tier) and Type (employment classification) are separate
  // fields — see ManageMemberModal for the full Director/Manager/Executive
  // model. Manager isn't offered here: appointing one needs a department's
  // existing roster to pick a team from, which only exists once the account
  // is created, so that still happens afterward in "Manage member".
  const [uiRole, setUiRole] = React.useState<'director' | 'executive'>('executive');
  const [type, setType] = React.useState<'fte' | 'pte' | 'intern'>('fte');
  const [internMonths, setInternMonths] = React.useState(3);
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const role: 'board' | 'fte' | 'pte' | 'intern' = uiRole === 'director' ? 'board' : type;

  const reset = () => {
    setForm({
      name: '',
      email: '',
      password: TEMP_PASSWORD,
      department: viewerIsFounder ? '' : viewerDepartment,
    });
    setUiRole('executive');
    setType('fte');
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
      role,
      internshipMonths: role === 'intern' ? internMonths : null,
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
      subtitle="Set up an account for a team member or Director. Share the temporary password; they can change it in Settings."
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
          <Field
            label="Role"
            hint={
              viewerIsFounder
                ? 'Manager is appointed later, from Manage member.'
                : 'Only a Founder can create a Director.'
            }
          >
            <select
              className="select"
              value={uiRole}
              onChange={(e) => setUiRole(e.target.value as typeof uiRole)}
              disabled={!viewerIsFounder}
            >
              {viewerIsFounder ? <option value="director">Director</option> : null}
              <option value="executive">Executive</option>
            </select>
          </Field>
          <Field
            label="Department"
            error={err.department}
            hint={
              viewerIsFounder
                ? 'Pick an existing department. To add a new one, use Departments on the Team page.'
                : 'New accounts join your own department.'
            }
          >
            {/* Existing departments only — creating one lives in
                Team › Departments so the org's department list has a single
                deliberate home rather than growing as a side effect of hiring. */}
            <DepartmentSelect
              value={form.department}
              departments={departments}
              onChange={(v) => set('department', v)}
              allowCreate={false}
              disabled={!viewerIsFounder}
            />
          </Field>
        </div>
        {uiRole === 'executive' ? (
          <Field label="Type">
            <select
              className="select"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              <option value="fte">Full-Time</option>
              <option value="pte">Part-Time</option>
              <option value="intern">Intern</option>
            </select>
          </Field>
        ) : null}
        {role === 'intern' && (
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
