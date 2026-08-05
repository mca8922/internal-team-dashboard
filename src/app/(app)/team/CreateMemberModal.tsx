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
  // Departments beside the primary one (migration 0060). Founder-only, and a
  // grouping label rather than a grant — see the section below.
  const [extraDepts, setExtraDepts] = React.useState<string[]>([]);
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
    setExtraDepts([]);
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
      // Never send what the picker below couldn't have set — if the primary
      // changed after a box was ticked, that tick is stale.
      extraDepartments: viewerIsFounder
        ? extraDepts.filter((d) => d !== form.department.trim())
        : [],
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
        {/* Multi department (migration 0060) — the other departments this hire
            works across, beside the primary above.

            A LABEL, not a permission: access is drawn on the primary
            department alone (migration 0058), so ticking "Audit" here does not
            expose the new account to an Audit Director, nor widen what they can
            see. Founder-only, matching the Manage member section — a Director
            hires into their own department and nowhere else, so they are not
            offered the choice at all. */}
        {viewerIsFounder ? (
          <Field
            label="Multi department"
            hint="Optional. Other departments this person works across — used for grouping and reporting only; access follows the primary department above. Can be changed later in Manage member."
          >
            {!form.department.trim() ? (
              <div className="text-xs text-grey">Pick a department above first.</div>
            ) : (
              (() => {
                const options = departments.filter((d) => d !== form.department.trim());
                if (options.length === 0) {
                  return (
                    <div className="text-xs text-grey">
                      There is no other department to add yet.
                    </div>
                  );
                }
                const picked = extraDepts.filter((d) => options.includes(d));
                return (
                  <>
                    <div className="dept-pick-list" style={{ maxHeight: 160 }}>
                      {options.map((d) => (
                        <label key={d} className="dept-pick-row">
                          <input
                            type="checkbox"
                            checked={extraDepts.includes(d)}
                            onChange={() =>
                              setExtraDepts((cur) =>
                                cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d],
                              )
                            }
                          />
                          <span className="text-sm fw-medium dept-pick-name">{d}</span>
                        </label>
                      ))}
                    </div>
                    {/* Same chip preview as Manage member, so what you pick here
                        looks like what you'll see on the card afterwards. */}
                    <div className="dept-chip-row" style={{ marginTop: 10 }}>
                      <span className="dept-chip dept-chip--primary" title="Primary department">
                        {form.department.trim()}
                      </span>
                      {picked.map((d) => (
                        <span key={d} className="dept-chip">
                          <span className="dept-chip-plus">+</span>
                          {d}
                        </span>
                      ))}
                    </div>
                  </>
                );
              })()
            )}
          </Field>
        ) : null}
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
