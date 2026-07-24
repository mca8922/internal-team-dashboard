'use client';

// Board-only "manage member" modal — edit department, set a daily target
// hours override, offboard ("Left the organization"), reinstate, or delete.
import * as React from 'react';
import { Avatar, Button, Field, Modal } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { DatePicker } from '@/components/DatePicker';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import {
  updateMemberIdentity,
  updateMemberDepartment,
  updateMemberRole,
  updateMemberJobTitle,
  updateCommuteEmail,
  setMemberTargetHours,
  setInternshipMonths,
  setMemberOnboardDate,
  markMemberLeft,
  reinstateMember,
  deleteMember,
  setMemberAsManager,
  unsetManager,
  setManagerTeam,
  setManagerResponsibilities,
} from '@/lib/actions';
import { RichTextEditor } from '@/components/RichTextEditor';
import { roleLabel, weeklyTargetFromDaily } from '@/lib/roles';
import { MemberGoalsHandoff } from '@/components/MemberGoalsHandoff';
import type { UserRole } from '@/lib/types';
import { addMonths, fmtFriendly, parseDate } from '@/lib/dates';
import { DepartmentSelect } from '@/components/DepartmentSelect';
import { TENURE_OPTIONS } from './CreateMemberModal';
import type { TeamMember } from './TeamGrid';

export function ManageMemberModal({
  member,
  isSelf,
  viewerIsFounder,
  departments,
  allMembers,
  onClose,
}: {
  member: TeamMember | null;
  isSelf: boolean;
  viewerIsFounder: boolean;
  departments: string[];
  allMembers: TeamMember[];
  onClose: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [commuteEmail, setCommuteEmail] = React.useState('');
  const [department, setDepartment] = React.useState('');
  const [role, setRole] = React.useState<UserRole>('fte');
  const [jobTitle, setJobTitle] = React.useState('');
  const [targetInput, setTargetInput] = React.useState('');
  const [tenure, setTenure] = React.useState('');
  const [onboard, setOnboard] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [handoffOpen, setHandoffOpen] = React.useState(false);
  // Department-manager controls.
  const [headDept, setHeadDept] = React.useState('');
  const [team, setTeam] = React.useState<string[]>([]);
  const [responsibilities, setResponsibilities] = React.useState('');

  // Re-seed the form whenever a different member is opened.
  React.useEffect(() => {
    if (member) {
      setName(member.name);
      setEmail(member.email);
      setCommuteEmail(member.commuteEmail ?? '');
      setDepartment(member.department);
      setRole(member.role);
      setJobTitle(member.jobTitle || '');
      setTargetInput(member.targetHours != null ? String(member.targetHours) : '');
      setTenure(member.internshipMonths != null ? String(member.internshipMonths) : '');
      setOnboard(member.joinedDate);
      setHeadDept(member.managedDepartment || member.department);
      setTeam(allMembers.filter((m) => m.managerId === member.id).map((m) => m.id));
      setResponsibilities(member.managerResponsibilities || '');
    }
  }, [member, allMembers]);

  if (!member) return null;

  // The Founder account is frozen against everyone else; the Founder may still
  // edit their own profile (including email — identity is the user id, not the
  // email, so changing it never affects founder status).
  const founderProtected = member.isFounder && !isSelf;

  const run = async (fn: () => Promise<void>, msg: string) => {
    setPending(true);
    try {
      await fn();
      toast(msg);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setPending(false);
    }
  };

  const saveIdentity = async () => {
    setPending(true);
    const res = await updateMemberIdentity(member.id, { name, email });
    setPending(false);
    if (res.error) toast(res.error, 'error');
    else toast('Name & email updated');
  };

  const saveCommuteEmail = () =>
    run(() => updateCommuteEmail(member.id, commuteEmail), 'Communication email updated');

  const saveDept = () =>
    run(() => updateMemberDepartment(member.id, department), 'Department updated');

  const saveRole = () => run(() => updateMemberRole(member.id, role), 'Role updated');

  const saveJobTitle = () =>
    run(() => updateMemberJobTitle(member.id, jobTitle), 'Job title updated');

  const saveTarget = () => {
    const n = targetInput.trim() === '' ? null : Number(targetInput);
    if (n != null && (Number.isNaN(n) || n <= 0 || n > 24)) {
      toast('Enter hours between 1 and 24, or leave blank for the role default.', 'warning');
      return;
    }
    return run(() => setMemberTargetHours(member.id, n), 'Target hours updated');
  };

  const saveTenure = () => {
    const n = tenure === '' ? null : Number(tenure);
    return run(() => setInternshipMonths(member.id, n), 'Internship tenure updated');
  };

  const saveOnboard = () => {
    if (!onboard) {
      toast('Pick an onboard date.', 'warning');
      return;
    }
    return run(() => setMemberOnboardDate(member.id, onboard), 'Onboard date updated');
  };

  // ---- Department Manager controls ----
  // Candidate team members: active, non-board members of the department this
  // person heads (excluding the manager themselves and the Founder).
  const teamCandidates = member
    ? allMembers.filter(
        (m) =>
          m.isActive &&
          m.role !== 'board' &&
          !m.isFounder &&
          m.id !== member.id &&
          m.department === headDept,
      )
    : [];

  const toggleTeam = (id: string) =>
    setTeam((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  const makeManager = () =>
    run(
      () => setMemberAsManager(member!.id, headDept),
      `${member!.name} is now Head of ${headDept}`,
    );

  const saveTeam = () =>
    run(() => setManagerTeam(member!.id, team), 'Team updated');

  const saveResponsibilities = () =>
    run(
      () => setManagerResponsibilities(member!.id, responsibilities),
      'Role & responsibilities saved',
    );

  const removeManager = () =>
    run(() => unsetManager(member!.id), 'Manager status removed');

  // For interns, the tenure end date follows from onboard date + months.
  const tenureEnd =
    member.role === 'intern' && tenure && onboard
      ? fmtFriendly(addMonths(parseDate(onboard), Number(tenure)))
      : null;

  // Offboarding now goes through the hand-off modal first, so the Board can
  // reassign the member's open goals before they're locked out.
  const offboard = () => setHandoffOpen(true);

  const reinstate = () =>
    run(async () => {
      await reinstateMember(member.id);
      onClose();
    }, `${member.name} reinstated`);

  const remove = async () => {
    const ok = await confirm({
      title: `Permanently delete ${member.name}?`,
      message: `This erases their account and every punch, log, and leave they own. This cannot be undone.`,
      confirmLabel: 'Delete permanently',
      tone: 'danger',
      icon: 'trash',
    });
    if (!ok) return;
    run(async () => {
      await deleteMember(member.id);
      onClose();
    }, `${member.name} deleted`);
  };

  return (
    <>
    <Modal open={!!member} onClose={onClose} title="Manage member">
      <div className="flex items-center gap-3 mb-4">
        <Avatar name={member.name} size="lg" src={member.avatarUrl} />
        <div>
          <div className="text-md fw-bold">{member.name}</div>
          <div className="text-xs text-grey">
            {member.email} · {roleLabel(member.role)}
          </div>
          {!member.isActive ? (
            <span className="badge badge-red mt-1">Left the organization</span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4">
        {founderProtected ? (
          <div className="text-xs text-grey" style={{
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            padding: '10px 12px',
          }}>
            This is the <strong>Founder</strong> account. It’s protected and can only be
            changed by the Founder.
          </div>
        ) : null}

        {/* Name & login email */}
        <div className="grid gap-2">
          <Field label="Full name">
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={founderProtected}
            />
          </Field>
          <Field
            label="Login email"
            hint="Changing this updates the member's actual sign-in address."
          >
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={founderProtected}
            />
          </Field>
          <div>
            <Button
              size="sm"
              variant="secondary"
              onClick={saveIdentity}
              disabled={
                pending ||
                founderProtected ||
                !name.trim() ||
                !email.trim() ||
                (name === member.name && email === member.email)
              }
            >
              Save name &amp; email
            </Button>
          </div>
          <Field
            label="Communication email"
            hint="The real inbox used for all HR and team communications."
          >
            <div className="flex items-center gap-2">
              <input
                className="input"
                type="email"
                value={commuteEmail}
                placeholder={member.email}
                onChange={(e) => setCommuteEmail(e.target.value)}
                disabled={founderProtected}
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={saveCommuteEmail}
                disabled={
                  pending ||
                  founderProtected ||
                  (commuteEmail.trim() === (member.commuteEmail ?? ''))
                }
              >
                Save
              </Button>
            </div>
          </Field>
        </div>

        {/* Department */}
        <Field label="Department">
          <div className="flex items-center gap-2">
            <div style={{ flex: 1 }}>
              <DepartmentSelect
                value={department}
                departments={departments}
                onChange={setDepartment}
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={saveDept}
              disabled={
                pending ||
                founderProtected ||
                department.trim() === '' ||
                department === member.department
              }
            >
              Save
            </Button>
          </div>
        </Field>

        {/* Role / employment type — the permission level. Moving out of
            "Intern" clears the tenure window. The Founder is protected, and you
            can't change your own role (would risk locking yourself out). */}
        <Field
          label="Role"
          hint={
            isSelf
              ? 'You cannot change your own role.'
              : 'Sets permissions and the default daily hours. Board Members manage the team.'
          }
        >
          <div className="flex items-center gap-2">
            <div style={{ flex: 1 }}>
              <select
                className="select"
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                disabled={founderProtected || isSelf}
              >
                <option value="board">Board Member</option>
                <option value="fte">Full-Time</option>
                <option value="pte">Part-Time</option>
                <option value="intern">Intern</option>
              </select>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={saveRole}
              disabled={pending || founderProtected || isSelf || role === member.role}
            >
              Save
            </Button>
          </div>
        </Field>

        {/* Job title — free-form, shown on the profile card. Separate from the
            role / permission level. */}
        <Field
          label="Job title"
          hint='Visible label like "CEO", "CTO", "Lead Designer". Does not change permissions.'
        >
          <div className="flex items-center gap-2">
            <input
              className="input"
              value={jobTitle}
              placeholder="e.g. CEO"
              onChange={(e) => setJobTitle(e.target.value)}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={saveJobTitle}
              disabled={
                pending || founderProtected || jobTitle.trim() === (member.jobTitle || '').trim()
              }
            >
              Save
            </Button>
          </div>
        </Field>

        {/* Onboard (joining) date */}
        <Field
          label="Onboard date"
          hint="The member's joining date. For interns it anchors the tenure window."
        >
          <div className="flex items-center gap-2">
            <DatePicker
              value={onboard}
              onChange={(v) => setOnboard(v)}
              ariaLabel="Onboard date"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={saveOnboard}
              disabled={pending || founderProtected || !onboard || onboard === member.joinedDate}
            >
              Save
            </Button>
          </div>
        </Field>

        {/* Daily target hours */}
        <Field
          label="Daily target hours"
          hint={`Leave blank for the role default (${member.roleDefaultHours}h/day = ${weeklyTargetFromDaily(member.roleDefaultHours)}h/week). Drives their punch progress and analytics.`}
        >
          <div className="flex items-center gap-2">
            <input
              className="input"
              type="number"
              min={1}
              max={24}
              step={0.5}
              value={targetInput}
              placeholder={`${member.roleDefaultHours} (default)`}
              onChange={(e) => setTargetInput(e.target.value)}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={saveTarget}
              disabled={pending || founderProtected}
            >
              Save
            </Button>
          </div>
        </Field>

        {/* Internship tenure — interns only */}
        {member.role === 'intern' && (
          <Field
            label="Internship tenure"
            hint="Runs from the join date. Shown as a progress card on the intern's dashboard."
          >
            <div className="flex items-center gap-2">
              <div style={{ flex: 1 }}>
                <select
                  className="select"
                  value={tenure}
                  onChange={(e) => setTenure(e.target.value)}
                >
                  <option value="">Not set</option>
                  {TENURE_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m} month{m > 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <Button size="sm" variant="secondary" onClick={saveTenure} disabled={pending}>
                Save
              </Button>
            </div>
            {tenureEnd ? (
              <div className="text-xs text-grey mt-2">
                Tenure ends <strong>{tenureEnd}</strong> (onboard date + {tenure} months).
              </div>
            ) : null}
          </Field>
        )}

        {/* Department Manager (Head of Department) */}
        {member.role !== 'board' && !member.isFounder && member.isActive ? (
          <div
            style={{
              borderTop: '1px solid var(--color-border)',
              paddingTop: 16,
              display: 'grid',
              gap: 10,
            }}
          >
            <div className="flex items-center gap-2">
              <Icon name="crown" size={15} />
              <span
                className="text-xs fw-medium text-grey"
                style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}
              >
                Department Manager
              </span>
              {member.isManager ? (
                <span className="badge badge-green">Head of {member.managedDepartment}</span>
              ) : null}
            </div>

            {!member.isManager ? (
              <>
                <div className="text-xs text-grey">
                  Appoint {member.name} as the Head of a department. They gain team analytics,
                  goal editing and email visibility for that department, but never see daily
                  logs.
                </div>
                <Field label="Department to head">
                  <div className="flex items-center gap-2">
                    <div style={{ flex: 1 }}>
                      <DepartmentSelect
                        value={headDept}
                        departments={departments}
                        onChange={setHeadDept}
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={makeManager}
                      disabled={pending || !headDept.trim()}
                      icon="crown"
                    >
                      Make Manager
                    </Button>
                  </div>
                </Field>
              </>
            ) : (
              <>
                <Field
                  label="Role & responsibilities"
                  hint="Shown at the top of this manager's team page, above the members they lead. Supports basic formatting."
                >
                  <RichTextEditor
                    value={responsibilities}
                    onChange={setResponsibilities}
                    ariaLabel="Role and responsibilities"
                    placeholder="Describe what this manager owns: goals, decisions, the team they're accountable for…"
                  />
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={saveResponsibilities}
                      disabled={pending || responsibilities === (member.managerResponsibilities || '')}
                    >
                      Save responsibilities
                    </Button>
                  </div>
                </Field>

                <Field
                  label={`Team in ${member.managedDepartment}`}
                  hint="Pick the members this manager leads. Only members of the department they head are shown."
                >
                  {teamCandidates.length === 0 ? (
                    <div className="text-xs text-grey">
                      No other active members in {headDept} to assign yet.
                    </div>
                  ) : (
                    <div
                      className="grid gap-1"
                      style={{
                        maxHeight: 200,
                        overflow: 'auto',
                        border: '1px solid var(--color-border)',
                        borderRadius: 6,
                        padding: 8,
                      }}
                    >
                      {teamCandidates.map((m) => (
                        <label
                          key={m.id}
                          className="flex items-center gap-2"
                          style={{ cursor: 'pointer', padding: '4px 6px', borderRadius: 4 }}
                        >
                          <input
                            type="checkbox"
                            checked={team.includes(m.id)}
                            onChange={() => toggleTeam(m.id)}
                          />
                          <Avatar name={m.name} size="sm" src={m.avatarUrl} />
                          <span className="text-sm fw-medium">{m.name}</span>
                          <span className="text-xs text-grey">· {roleLabel(m.role)}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </Field>
                <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                  <Button size="sm" onClick={saveTeam} disabled={pending}>
                    Save team
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={removeManager}
                    disabled={pending}
                  >
                    Remove manager status
                  </Button>
                  <span className="text-xs text-grey">{team.length} selected</span>
                </div>
              </>
            )}
          </div>
        ) : null}

        {/* Offboarding */}
        <div
          style={{
            borderTop: '1px solid var(--color-border)',
            paddingTop: 16,
            display: 'grid',
            gap: 10,
          }}
        >
          <div className="text-xs fw-medium text-grey" style={{ textTransform: 'uppercase' }}>
            Danger zone
          </div>
          {member.isFounder ? (
            <div className="text-xs text-grey">
              The Founder account is protected. It can’t be offboarded or deleted.
            </div>
          ) : isSelf ? (
            <div className="text-xs text-grey">
              You cannot offboard or delete your own account.
            </div>
          ) : member.isActive ? (
            <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
              <Button variant="secondary" size="sm" icon="archive" onClick={offboard} disabled={pending}>
                Mark as left
              </Button>
              {viewerIsFounder ? (
                <Button
                  variant="danger"
                  size="sm"
                  icon="trash"
                  onClick={remove}
                  disabled={pending}
                  title="Founder only"
                >
                  Delete permanently
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
              <Button size="sm" icon="check" onClick={reinstate} disabled={pending}>
                Reinstate
              </Button>
              {viewerIsFounder ? (
                <Button
                  variant="danger"
                  size="sm"
                  icon="trash"
                  onClick={remove}
                  disabled={pending}
                  title="Founder only"
                >
                  Delete permanently
                </Button>
              ) : null}
            </div>
          )}
          {!viewerIsFounder && !isSelf ? (
            <div className="text-xs text-grey">
              Permanent deletion and punch edits are reserved for the Founder.
            </div>
          ) : null}
        </div>
      </div>

      <div className="modal-actions">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Close
        </Button>
      </div>
    </Modal>

    <MemberGoalsHandoff
      open={handoffOpen}
      onClose={() => setHandoffOpen(false)}
      memberId={member.id}
      memberName={member.name}
      contextLabel="Reassign their open goals to teammates, then offboard. Their data is kept."
      confirmLabel="Offboard now"
      onConfirm={async () => {
        await markMemberLeft(member.id);
        toast(`${member.name} marked as left`);
      }}
    />
    </>
  );
}
