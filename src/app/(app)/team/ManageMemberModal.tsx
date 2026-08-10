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
  setMemberDateOfBirth,
  markMemberLeft,
  reinstateMember,
  deleteMember,
  setMemberAsManager,
  unsetManager,
  setManagerTeam,
  setManagerResponsibilities,
  setDirectorReports,
  setMemberDepartments,
} from '@/lib/actions';
import { RichTextEditor } from '@/components/RichTextEditor';
import {
  roleLabel,
  weeklyTargetFromDaily,
  canReportToDirector,
  extraDepartmentsOf,
  belongsToDepartment,
} from '@/lib/roles';
import { MemberGoalsHandoff } from '@/components/MemberGoalsHandoff';
import { addMonths, calcAge, fmtFriendly, parseDate } from '@/lib/dates';
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
  // The departments BESIDE the primary one (migration 0060). A label for
  // grouping and reporting — it grants nothing, see the section below.
  const [extraDepts, setExtraDepts] = React.useState<string[]>([]);
  // "Role" is now a 3-way tier (Director/Manager/Executive) rather than the
  // raw 4-value UserRole enum — Director maps to role='board' (same
  // permissions as the old "Board Member"), Manager maps to the existing
  // is_manager/managed_department mechanism, and only Executive exposes a
  // Type (the old fte/pte/intern choice, now a distinct concept from Role).
  const [uiRole, setUiRole] = React.useState<'director' | 'manager' | 'executive'>('executive');
  const [type, setType] = React.useState<'fte' | 'pte' | 'intern'>('fte');
  const [jobTitle, setJobTitle] = React.useState('');
  const [targetInput, setTargetInput] = React.useState('');
  const [tenure, setTenure] = React.useState('');
  const [onboard, setOnboard] = React.useState('');
  const [dob, setDob] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [handoffOpen, setHandoffOpen] = React.useState(false);
  // Department-manager controls.
  const [headDept, setHeadDept] = React.useState('');
  const [team, setTeam] = React.useState<string[]>([]);
  const [responsibilities, setResponsibilities] = React.useState('');
  // Director controls — the people who report directly to this Director.
  const [reports, setReports] = React.useState<string[]>([]);

  // Re-seed the form whenever a different member is opened.
  React.useEffect(() => {
    if (member) {
      setName(member.name);
      setEmail(member.email);
      setCommuteEmail(member.commuteEmail ?? '');
      setDepartment(member.department);
      setExtraDepts(extraDepartmentsOf(member));
      setUiRole(member.role === 'board' ? 'director' : member.isManager ? 'manager' : 'executive');
      setType(member.role === 'board' ? 'fte' : member.role);
      setJobTitle(member.jobTitle || '');
      setTargetInput(member.targetHours != null ? String(member.targetHours) : '');
      setTenure(member.internshipMonths != null ? String(member.internshipMonths) : '');
      setOnboard(member.joinedDate);
      setDob(member.dateOfBirth ?? '');
      setHeadDept(member.managedDepartment || member.department);
      setTeam(allMembers.filter((m) => m.managerId === member.id).map((m) => m.id));
      setResponsibilities(member.managerResponsibilities || '');
      setReports(allMembers.filter((m) => m.directorId === member.id).map((m) => m.id));
    }
  }, [member, allMembers]);

  if (!member) return null;

  // The Founder account is frozen against everyone else; the Founder may still
  // edit their own profile (including email — identity is the user id, not the
  // email, so changing it never affects founder status).
  const founderProtected = member.isFounder && !isSelf;

  // Structural changes — Role (who is a Director / Manager / staff), the
  // Department someone belongs to, and a Manager's team — reshape the
  // hierarchy itself and move people between security silos, so they are
  // Founders-only (migration 0058). A Director runs the department they were
  // given: they manage its people day to day, but cannot widen their own
  // scope, appoint a peer, or pull an outsider in.
  const structuralLocked = !viewerIsFounder;

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

  // ---- Multi department ----
  // Everything the member can be listed under besides their primary. The
  // primary itself is edited by the Department field above, so it is excluded
  // here rather than shown as a locked, always-ticked row.
  const savedExtras = extraDepartmentsOf(member);
  const extraOptions = departments.filter((d) => d !== member.department);
  const extrasChanged =
    extraDepts.length !== savedExtras.length ||
    extraDepts.some((d) => !savedExtras.includes(d));

  const toggleExtraDept = (d: string) =>
    setExtraDepts((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  const saveExtraDepts = () =>
    run(() => setMemberDepartments(member.id, extraDepts), 'Departments updated');

  // What Role/Type/managed-department the member ACTUALLY has right now
  // (server state), so Save only enables on a real change and so we only
  // touch the underlying role/is_manager rows that actually need to move.
  const initialUiRole: 'director' | 'manager' | 'executive' =
    member.role === 'board' ? 'director' : member.isManager ? 'manager' : 'executive';
  const initialType = member.role === 'board' ? 'fte' : member.role;
  const initialHeadDeptForRole = member.managedDepartment || member.department;

  const roleFieldChanged =
    uiRole !== initialUiRole ||
    (uiRole === 'executive' && type !== initialType) ||
    (uiRole === 'manager' &&
      headDept.trim() !== '' &&
      headDept.trim() !== initialHeadDeptForRole);

  const saveRole = () =>
    run(async () => {
      if (uiRole === 'director') {
        // A Director can't simultaneously head a department — clear that
        // first so the data stays consistent, not just UI-hidden.
        if (member.isManager) await unsetManager(member.id);
        if (member.role !== 'board') await updateMemberRole(member.id, 'board');
      } else if (uiRole === 'manager') {
        // Managers need a real fte/pte/intern role underneath (Type is just
        // hidden for them, not absent) — only forced to 'fte' when coming
        // FROM Director, since 'board' isn't a valid manager role.
        if (member.role === 'board') await updateMemberRole(member.id, type);
        await setMemberAsManager(member.id, headDept.trim() || member.department);
      } else {
        if (member.isManager) await unsetManager(member.id);
        if (member.role !== type) await updateMemberRole(member.id, type);
      }
    }, 'Role updated');

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

  const saveDob = () => {
    if (!dob) {
      toast('Pick a date of birth.', 'warning');
      return;
    }
    return run(() => setMemberDateOfBirth(member.id, dob), 'Date of birth updated');
  };

  // ---- Department Manager controls ----
  // Candidate team members: active, non-board members who BELONG TO the
  // department this person heads — primary or additional (0060/0062,
  // mirroring the Director "Direct reports" eligibility below) — excluding
  // the manager themselves and the Founder.
  const teamCandidates = member
    ? allMembers.filter(
        (m) =>
          m.isActive &&
          m.role !== 'board' &&
          !m.isFounder &&
          m.id !== member.id &&
          belongsToDepartment(m, headDept),
      )
    : [];

  const toggleTeam = (id: string) =>
    setTeam((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  const saveTeam = () =>
    run(() => setManagerTeam(member!.id, team), 'Team updated');

  const saveResponsibilities = () =>
    run(
      () => setManagerResponsibilities(member!.id, responsibilities),
      'Role & responsibilities saved',
    );

  const removeManager = () =>
    run(() => unsetManager(member!.id), 'Manager status removed');

  // ---- Director controls ----
  // Who may report to this Director: active, non-Founder members who BELONG TO
  // the Director's department — primary or additional (0060) — excluding other
  // Directors (a Director never reports to one) and the Director themselves.
  // Split into Managers and Staff so the Founder can see the two tiers at a
  // glance rather than one long list.
  //
  // Since 0061 ticking someone here is what GRANTS the Director sight of them,
  // so this list is a permission screen, not just an org chart.
  const reportCandidates = member
    ? allMembers.filter((m) => canReportToDirector(member, m))
    : [];
  const reportManagers = reportCandidates.filter((m) => m.isManager);
  const reportStaff = reportCandidates.filter((m) => !m.isManager);

  const toggleReport = (id: string) =>
    setReports((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));

  const saveReports = () =>
    run(() => setDirectorReports(member!.id, reports), 'Direct reports updated');

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

        {/* Department — the security boundary, so moving someone across it is
            a Founder-only structural change. Changing it also detaches the
            member from their old manager (the server clears manager_id). */}
        <Field
          label="Department"
          hint={
            structuralLocked
              ? 'Only a Founder can move a member between departments.'
              : 'Moving a member to another department detaches them from their current manager.'
          }
        >
          <div className="flex items-center gap-2">
            <div style={{ flex: 1 }}>
              {/* Pick from the existing departments only. New ones are created
                  in Team › Departments, so the org's department list has one
                  deliberate home instead of being extended mid-edit. */}
              <DepartmentSelect
                value={department}
                departments={departments}
                onChange={setDepartment}
                allowCreate={false}
                disabled={structuralLocked || founderProtected}
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={saveDept}
              disabled={
                pending ||
                structuralLocked ||
                founderProtected ||
                department.trim() === '' ||
                department === member.department
              }
            >
              Save
            </Button>
          </div>
        </Field>

        {/* Multi department (migration 0060) — the other departments this
            person is listed under, beside their primary above.

            This is a LABEL, not a permission. Access is still drawn on the
            primary department alone (migration 0058): adding "Audit" here does
            not let an Audit Director see this member, and does not widen what
            the member themselves can see. The same holds for a Director or a
            Manager — the department they run is their primary one. The hint
            says so out loud, because a list of departments on a member's
            profile reads like a grant unless it is spelled out.

            The Founders sit under no department at all, so the section is
            hidden for them entirely. */}
        {!member.isFounder ? (
          <Field
            label="Multi department"
            hint={
              structuralLocked
                ? 'Only a Founder can change which other departments a member belongs to.'
                : `Other departments ${member.name.split(' ')[0]} works across, beside ${member.department || 'their primary one'}. Used for grouping and reporting only — access still follows the primary department above.`
            }
          >
            {!member.department ? (
              <div className="text-xs text-grey">
                Set a primary department above first — extras sit alongside one.
              </div>
            ) : extraOptions.length === 0 ? (
              <div className="text-xs text-grey">
                There is no other department to add yet. Create one in Team › Departments.
              </div>
            ) : (
              <>
                <div className="dept-pick-list">
                  {extraOptions.map((d) => (
                    <label key={d} className="dept-pick-row">
                      <input
                        type="checkbox"
                        checked={extraDepts.includes(d)}
                        disabled={structuralLocked || founderProtected}
                        onChange={() => toggleExtraDept(d)}
                      />
                      <span className="text-sm fw-medium dept-pick-name">{d}</span>
                    </label>
                  ))}
                </div>
                {/* Live preview of what will be saved, in the same chip pattern
                    the team card uses — the primary accented, the extras as
                    quiet outlines, wrapping rather than overflowing. */}
                <div className="dept-chip-summary">
                  <div className="dept-chip-row">
                    <span className="dept-chip dept-chip--primary" title="Primary department">
                      {member.department}
                    </span>
                    {extraDepts.map((d) => (
                      <span key={d} className="dept-chip">
                        <span className="dept-chip-plus">+</span>
                        {d}
                      </span>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={saveExtraDepts}
                    disabled={
                      pending || structuralLocked || founderProtected || !extrasChanged
                    }
                  >
                    Save departments
                  </Button>
                </div>
              </>
            )}
          </Field>
        ) : null}

        {/* Role — the permission tier (Director/Manager/Executive). Executive
            is the only tier with a Type (employment classification); Director
            and Manager don't need one, same as the old "Board Member" never
            had an fte/pte/intern distinction. The Founder is protected, and
            you can't change your own role (would risk locking yourself out). */}
        <Field
          label="Role"
          hint={
            isSelf
              ? 'You cannot change your own role.'
              : structuralLocked
                ? 'Only a Founder can change who is a Director, Manager or Executive.'
                : 'Sets permissions and the default daily hours. A Director runs one department; a Manager heads a team inside it.'
          }
        >
          <select
            className="select"
            value={uiRole}
            onChange={(e) => setUiRole(e.target.value as typeof uiRole)}
            disabled={structuralLocked || founderProtected || isSelf}
          >
            <option value="director">Director</option>
            <option value="manager">Manager</option>
            <option value="executive">Executive</option>
          </select>

          {uiRole === 'executive' ? (
            <div className="mt-2">
              <Field label="Type">
                <select
                  className="select"
                  value={type}
                  onChange={(e) => setType(e.target.value as typeof type)}
                  disabled={structuralLocked || founderProtected || isSelf}
                >
                  <option value="fte">Full-Time</option>
                  <option value="pte">Part-Time</option>
                  <option value="intern">Intern</option>
                </select>
              </Field>
            </div>
          ) : null}

          {uiRole === 'manager' ? (
            <div className="mt-2">
              <Field
                label="Department to head"
                hint="A Manager heads the department they belong to — saving this moves them into it."
              >
                <DepartmentSelect
                  value={headDept}
                  departments={departments}
                  onChange={setHeadDept}
                  disabled={structuralLocked}
                />
              </Field>
            </div>
          ) : null}

          <div className="flex justify-end mt-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={saveRole}
              disabled={
                pending ||
                structuralLocked ||
                founderProtected ||
                isSelf ||
                !roleFieldChanged ||
                (uiRole === 'manager' && !headDept.trim())
              }
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

        {/* Date of birth */}
        <Field label="Date of birth" hint="Drives their Age and the birthday wishing card.">
          <div className="flex items-center gap-2">
            <DatePicker
              value={dob}
              onChange={(v) => setDob(v)}
              ariaLabel="Date of birth"
              max={new Date().toISOString().slice(0, 10)}
            />
            {dob ? (
              <span className="age-badge">
                <span className="age-badge-num">{calcAge(dob)}</span>
                <span className="age-badge-label">years old</span>
              </span>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              onClick={saveDob}
              disabled={pending || founderProtected || !dob || dob === (member.dateOfBirth || '')}
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

        {/* Director — the people who report directly to them. This records a
            reporting line, not a permission: a Director can already see their
            whole department (migration 0058), so nothing here widens their
            reach. Founders only, since it shapes the hierarchy.
            Someone may appear on a Manager's team AND here — the two lines are
            independent by design. */}
        {member.role === 'board' && !member.isFounder && member.isActive ? (
          <div
            style={{
              borderTop: '1px solid var(--color-border)',
              paddingTop: 16,
              display: 'grid',
              gap: 10,
            }}
          >
            <div className="flex items-center gap-2">
              <Icon name="shield" size={15} />
              <span
                className="text-xs fw-medium text-grey"
                style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}
              >
                Director
              </span>
              <span className="badge badge-green">{member.department}</span>
            </div>

            <Field
              label="Direct reports"
              hint={
                structuralLocked
                  ? 'Only a Founder can change who reports to a Director.'
                  : `Who answers to ${member.name.split(' ')[0]} — and, since this is now their scope, exactly who they can see and manage. Anyone with ${member.department} in their departments can be picked, even if it isn't their primary one. Someone can be here and on a Manager's team at the same time.`
              }
            >
              {reportCandidates.length === 0 ? (
                <div className="text-xs text-grey">
                  Nobody belongs to {member.department} yet. Add {member.department} to a
                  member’s departments in Manage member to make them assignable here.
                </div>
              ) : (
                <div className="dept-pick-list" style={{ maxHeight: 260 }}>
                  {[
                    { label: 'Managers', people: reportManagers },
                    { label: 'Staff', people: reportStaff },
                  ]
                    .filter((g) => g.people.length > 0)
                    .map((g) => (
                      <div key={g.label} className="grid gap-1">
                        <div
                          className="text-xs fw-medium text-grey"
                          style={{
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            padding: '4px 8px 0',
                          }}
                        >
                          {g.label}
                        </div>
                        {g.people.map((m) => (
                          <label key={m.id} className="dept-pick-row">
                            <input
                              type="checkbox"
                              checked={reports.includes(m.id)}
                              disabled={structuralLocked}
                              onChange={() => toggleReport(m.id)}
                            />
                            <Avatar name={m.name} size="sm" src={m.avatarUrl} />
                            <span className="text-sm fw-medium dept-pick-name">{m.name}</span>
                            <span className="text-xs text-grey dept-pick-meta">
                              {m.isManager ? 'Manager' : roleLabel(m.role)}
                            </span>
                            {/* Eligible via an ADDITIONAL department, not their
                                primary one — say so, so assigning someone out
                                of another department is never a surprise. */}
                            {m.department !== member.department ? (
                              <span
                                className="dept-chip dept-pick-meta"
                                title={`${m.name.split(' ')[0]}'s primary department is ${m.department}`}
                              >
                                {m.department}
                              </span>
                            ) : null}
                          </label>
                        ))}
                      </div>
                    ))}
                </div>
              )}
            </Field>
            <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
              <Button
                size="sm"
                onClick={saveReports}
                disabled={pending || structuralLocked || reportCandidates.length === 0}
              >
                Save direct reports
              </Button>
              {/* An empty list is legal but rarely intended — with nobody
                  assigned a Director's Team page shows only themselves. */}
              <span
                className={reports.length === 0 ? 'text-xs fw-medium' : 'text-xs text-grey'}
                style={reports.length === 0 ? { color: 'var(--color-amber, #B45309)' } : undefined}
              >
                {reports.length === 0
                  ? `Nobody assigned — ${member.name.split(' ')[0]} can currently see only themselves.`
                  : `${reports.length} selected`}
              </span>
            </div>
          </div>
        ) : null}

        {/* Department Manager (Head of Department) — appointing a Manager now
            happens via the Role field above (which sets is_manager + the
            managed department in one Save); this panel only shows once
            they're one, for the responsibilities + team-assignment detail
            that doesn't fit in that compact selector. */}
        {member.role !== 'board' && !member.isFounder && member.isActive && member.isManager ? (
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
              <span className="badge badge-green">Head of {member.managedDepartment}</span>
            </div>

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
              hint={
                structuralLocked
                  ? 'Only a Founder can change who reports to this manager.'
                  : `Anyone with ${headDept} in their departments can be picked, even if it isn't their primary one.`
              }
            >
              {teamCandidates.length === 0 ? (
                <div className="text-xs text-grey">
                  Nobody belongs to {headDept} yet. Add {headDept} to a member’s departments
                  in Manage member to make them assignable here.
                </div>
              ) : (
                <div className="dept-pick-list">
                  {teamCandidates.map((m) => (
                    <label key={m.id} className="dept-pick-row">
                      <input
                        type="checkbox"
                        checked={team.includes(m.id)}
                        disabled={structuralLocked}
                        onChange={() => toggleTeam(m.id)}
                      />
                      <Avatar name={m.name} size="sm" src={m.avatarUrl} />
                      <span className="text-sm fw-medium dept-pick-name">{m.name}</span>
                      <span className="text-xs text-grey dept-pick-meta">
                        {roleLabel(m.role)}
                      </span>
                      {/* Eligible via an ADDITIONAL department, not their
                          primary one — say so, so picking someone out of
                          another department is never a surprise. */}
                      {m.department !== headDept ? (
                        <span
                          className="dept-chip dept-pick-meta"
                          title={`${m.name.split(' ')[0]}'s primary department is ${m.department}`}
                        >
                          {m.department}
                        </span>
                      ) : null}
                    </label>
                  ))}
                </div>
              )}
            </Field>
            <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
              <Button size="sm" onClick={saveTeam} disabled={pending || structuralLocked}>
                Save team
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={removeManager}
                disabled={pending || structuralLocked}
              >
                Remove manager status
              </Button>
              <span className="text-xs text-grey">{team.length} selected</span>
            </div>
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
      contextLabel="Reassign their open tasks to teammates, then offboard. Their data is kept."
      confirmLabel="Offboard now"
      onConfirm={async () => {
        await markMemberLeft(member.id);
        toast(`${member.name} marked as left`);
      }}
    />
    </>
  );
}
