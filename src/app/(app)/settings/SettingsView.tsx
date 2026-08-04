'use client';

// Settings — profile, appearance, notifications, editor prefs. Ported from
// page-leaves-settings.jsx. Notification + editor prefs are client-only,
// stored in localStorage; profile changes hit Supabase.
import * as React from 'react';
import { Button, Field, Toggle } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { updateProfile, updatePassword } from '@/lib/actions';
import { getThemePref, setThemePref, type ThemePref } from '@/lib/theme';
import { calcAge } from '@/lib/dates';
import { DatePicker } from '@/components/DatePicker';
import { AvatarUpload } from './AvatarUpload';
import { NotificationPrefsCard } from './NotificationPrefsCard';
import type { NotificationPref } from '@/lib/types';
import { FEATURE_FLAGS } from '@/lib/featureFlags';

interface Prefs {
  defaultBlock: string;
  soundPunch: boolean;
  soundPresence: boolean;
  soundNotification: boolean;
  pushEnabled: boolean;
}

const DEFAULT_PREFS: Prefs = {
  defaultBlock: 'text',
  soundPunch: true,
  soundPresence: true,
  soundNotification: true,
  pushEnabled: false,
};

// Password strength — five independent checks; the bar/label reflect how
// many are met (not the individual chip state, which is shown separately).
function passwordChecks(pw: string) {
  return {
    length: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw),
  };
}

const STRENGTH_META = [
  { label: 'Very weak', color: 'var(--color-red)' },
  { label: 'Weak', color: 'var(--color-red)' },
  { label: 'Fair', color: 'var(--color-amber-text)' },
  { label: 'Good', color: 'var(--color-amber-text)' },
  { label: 'Strong', color: 'var(--color-green-primary)' },
  { label: 'Very strong', color: 'var(--color-green-primary)' },
] as const;

export function SettingsView({
  userId,
  name,
  email,
  department,
  roleText,
  avatarUrl,
  dateOfBirth,
  notificationPrefs,
  isBoard,
  isManager,
}: {
  userId: string;
  name: string;
  email: string;
  department: string;
  roleText: string;
  avatarUrl: string | null;
  dateOfBirth: string | null;
  notificationPrefs: NotificationPref[];
  isBoard: boolean;
  isManager: boolean;
}) {
  const toast = useToast();
  const [form, setForm] = React.useState({ name, department, password: '', confirm: '' });
  const [dob, setDob] = React.useState(dateOfBirth ?? '');
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [themePref, setThemePrefState] = React.useState<ThemePref>('device');
  const [prefs, setPrefs] = React.useState<Prefs>(DEFAULT_PREFS);

  React.useEffect(() => {
    setThemePrefState(getThemePref());
    const raw = localStorage.getItem('restruc:prefs');
    if (raw) {
      try {
        setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
      } catch {
        /* ignore corrupt prefs */
      }
    }
  }, []);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    const np = { ...prefs, [k]: v };
    setPrefs(np);
    localStorage.setItem('restruc:prefs', JSON.stringify(np));
    if (k === 'pushEnabled') {
      window.dispatchEvent(new CustomEvent('restruc:push-changed', { detail: { enabled: v } }));
    }
  };

  // PushManager fires this if the browser denies push permission — revert the toggle.
  React.useEffect(() => {
    const onDenied = () => setPrefs((p) => ({ ...p, pushEnabled: false }));
    window.addEventListener('restruc:push-denied', onDenied);
    return () => window.removeEventListener('restruc:push-denied', onDenied);
  }, []);
  const pickTheme = (t: ThemePref) => {
    setThemePrefState(t);
    setThemePref(t);
  };

  const saveProfile = async () => {
    if (form.password && form.password !== form.confirm) {
      setErr({ confirm: "Doesn't match" });
      return;
    }
    if (form.password && form.password.length < 6) {
      setErr({ confirm: 'At least 6 characters' });
      return;
    }
    setErr({});
    // Department is board-controlled and not sent from here.
    await updateProfile({ name: form.name, date_of_birth: dob || null });
    if (form.password) {
      try {
        await updatePassword(form.password);
      } catch (e) {
        toast((e as Error).message, 'error');
        return;
      }
      // The member set their own password — clear the onboarding reminder
      // and refresh the notifications bell.
      try {
        localStorage.setItem('restruc:pw-changed', '1');
        localStorage.removeItem('restruc:pw-reminder');
        window.dispatchEvent(new Event('restruc:notifs-changed'));
      } catch {
        /* localStorage unavailable */
      }
    }
    toast('Profile saved');
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-subtitle">Your profile, notifications, and preferences</div>
        </div>
      </div>

      <div className="grid grid-2col-even" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card-subtitle mb-3">Profile</div>
          <AvatarUpload userId={userId} name={name} initialUrl={avatarUrl} />
          <div className="text-xs text-grey mb-4">
            {email} · {roleText}
          </div>
          <div className="grid gap-3">
            <Field label="Display name">
              <input
                className="input"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
              />
            </Field>
            <Field
              label="Department"
              hint="Set by a Board Member. Contact them to change it."
            >
              <input
                className="input"
                value={form.department}
                disabled
                readOnly
                style={{ opacity: 0.7, cursor: 'not-allowed' }}
              />
            </Field>
            <Field label="Date of birth" hint="So your team can celebrate with you">
              <div className="flex items-center gap-3">
                <DatePicker value={dob} onChange={setDob} ariaLabel="Date of birth" max={new Date().toISOString().slice(0, 10)} />
                {dob ? (
                  <span className="age-badge">
                    <span className="age-badge-num">{calcAge(dob)}</span>
                    <span className="age-badge-label">years old</span>
                  </span>
                ) : null}
              </div>
            </Field>
            <div className="grid grid-2col-even" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="New password">
                <div className="pw-input-wrap">
                  <input
                    className="input"
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                  />
                  <button
                    type="button"
                    className="pw-eye-btn"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    <Icon name={showPassword ? 'eye-off' : 'eye'} size={16} />
                  </button>
                </div>
              </Field>
              <Field
                label="Confirm"
                error={
                  err.confirm ||
                  (form.confirm && form.password !== form.confirm ? 'Passwords do not match' : undefined)
                }
              >
                <div className="pw-input-wrap">
                  <input
                    className="input"
                    type={showConfirm ? 'text' : 'password'}
                    value={form.confirm}
                    onChange={(e) => set('confirm', e.target.value)}
                  />
                  <button
                    type="button"
                    className="pw-eye-btn"
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                    onClick={() => setShowConfirm((v) => !v)}
                  >
                    <Icon name={showConfirm ? 'eye-off' : 'eye'} size={16} />
                  </button>
                </div>
              </Field>
            </div>

            {form.password ? (
              (() => {
                const checks = passwordChecks(form.password);
                const score = Object.values(checks).filter(Boolean).length;
                const meta = STRENGTH_META[score];
                return (
                  <div className="grid gap-2">
                    <div className="flex items-center gap-2">
                      <div className="goal-progress" style={{ flex: 1 }}>
                        <div
                          className="goal-progress-fill"
                          style={{ width: `${(score / 5) * 100}%`, background: meta.color }}
                        />
                      </div>
                      <span className="pw-strength-label" style={{ color: meta.color }}>
                        {meta.label}
                      </span>
                    </div>
                    <div className="pw-chips">
                      <span className={`pw-chip${checks.length ? ' met' : ''}`}>
                        {checks.length ? '✓ ' : ''}8+ characters
                      </span>
                      <span className={`pw-chip${checks.upper ? ' met' : ''}`}>
                        {checks.upper ? '✓ ' : ''}Uppercase letter
                      </span>
                      <span className={`pw-chip${checks.lower ? ' met' : ''}`}>
                        {checks.lower ? '✓ ' : ''}Lowercase letter
                      </span>
                      <span className={`pw-chip${checks.number ? ' met' : ''}`}>
                        {checks.number ? '✓ ' : ''}Number
                      </span>
                      <span className={`pw-chip${checks.special ? ' met' : ''}`}>
                        {checks.special ? '✓ ' : ''}Special character
                      </span>
                    </div>
                  </div>
                );
              })()
            ) : null}
            <div className="text-xs text-grey">Leave empty to keep current</div>

            <div>
              <Button onClick={saveProfile} icon="check">
                Save profile
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="card">
            <div className="card-subtitle mb-3">Appearance</div>
            <div
              className="flex items-center gap-1"
              style={{
                background: 'var(--color-bg)',
                padding: 4,
                borderRadius: 6,
                border: '1px solid var(--color-border)',
                width: 'fit-content',
              }}
            >
              {(
                [
                  { id: 'light', icon: 'sun' },
                  { id: 'dark', icon: 'moon' },
                  { id: 'device', icon: 'settings' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => pickTheme(t.id)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 4,
                    fontSize: 13,
                    fontWeight: 500,
                    background: themePref === t.id ? 'var(--color-card)' : 'transparent',
                    color:
                      themePref === t.id ? 'var(--color-black)' : 'var(--color-grey-text)',
                    boxShadow: themePref === t.id ? 'var(--shadow-card)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    textTransform: 'capitalize',
                  }}
                >
                  <Icon name={t.icon} size={14} />
                  {t.id}
                </button>
              ))}
            </div>
            <div className="text-xs text-grey mt-2">
              “Device” follows your operating system’s light/dark setting.
            </div>
          </div>

          {FEATURE_FLAGS.settingsNotifications ? (
            <div className="card">
              <div className="card-subtitle mb-3">Notifications</div>
              <div className="grid gap-3">
                <div className="text-xs text-grey fw-medium">Browser push</div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-sm fw-medium">Browser notifications</div>
                    <div className="text-xs text-grey">
                      Receive notifications even when the tab is closed
                    </div>
                  </div>
                  <Toggle on={prefs.pushEnabled} onChange={(v) => setPref('pushEnabled', v)} />
                </div>
                <div
                  style={{ borderTop: '1px solid var(--color-border)', marginTop: 4, marginBottom: 4 }}
                />
                <div className="text-xs text-grey fw-medium">Sounds</div>
                {(
                  [
                    {
                      id: 'soundPunch',
                      label: 'Punch chime',
                      hint: 'Play a sound when you or a teammate punches in/out',
                    },
                    {
                      id: 'soundPresence',
                      label: 'Online chime',
                      hint: 'Play a sound when a teammate comes online',
                    },
                    {
                      id: 'soundNotification',
                      label: 'Notification chime',
                      hint: 'Play a sound for tasks, leaves, and reminders',
                    },
                  ] as const
                ).map((p) => (
                  <div key={p.id} className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="text-sm fw-medium">{p.label}</div>
                      <div className="text-xs text-grey">{p.hint}</div>
                    </div>
                    <Toggle on={prefs[p.id]} onChange={(v) => setPref(p.id, v)} />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {FEATURE_FLAGS.settingsNotifications ? (
            <NotificationPrefsCard
              initialPrefs={notificationPrefs}
              isBoard={isBoard}
              isManager={isManager}
            />
          ) : null}

          {FEATURE_FLAGS.dailyLog ? (
            <div className="card">
              <div className="card-subtitle mb-3">Editor</div>
              <Field label="Default block type on new log">
                <select
                  className="select"
                  value={prefs.defaultBlock}
                  onChange={(e) => setPref('defaultBlock', e.target.value)}
                >
                  <option value="text">Text</option>
                  <option value="h2">Heading 2</option>
                  <option value="todo">To-do</option>
                  <option value="bullet">Bullet</option>
                </select>
              </Field>
            </div>
          ) : null}

          <div className="card">
            <div className="card-subtitle mb-3">Help &amp; guidance</div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="text-sm fw-medium">Dashboard tour</div>
                <div className="text-xs text-grey">
                  Replay the step-by-step walkthrough of how the dashboard works.
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon="sparkles"
                onClick={() => window.dispatchEvent(new Event('restruc:open-tour'))}
              >
                Replay tour
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
