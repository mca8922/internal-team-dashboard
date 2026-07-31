'use client';

// Board-only controls + audit log for transactional emails.
import * as React from 'react';
import { Avatar } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { BarChart, LineChart } from '@/components/charts';
import { useToast } from '@/components/Toast';
import { roleLabel } from '@/lib/roles';
import { fmtDate, addDays } from '@/lib/dates';
import { setTransactionalSettings, setMemberTransactionalEnabled } from '@/lib/actions';
import type {
  Profile,
  TransactionalEmailLog,
  TransactionalEmailSettings,
  UserRole,
} from '@/lib/types';

type Member = Pick<
  Profile,
  'id' | 'name' | 'role' | 'department' | 'avatar_url' | 'commute_email' | 'email' | 'transactional_emails_enabled'
>;

const EVENT_LABEL: Record<string, string> = {
  leave_approved: 'Leave approved',
  leave_rejected: 'Leave declined',
  goal_assigned: 'Task assigned',
  punch_missing: 'Missed punch',
  bug_report: 'Bug report',
};

function Toggle({
  enabled,
  onChange,
  disabled,
  label,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      className={`txn-toggle${enabled ? ' on' : ''}`}
    >
      <span className="txn-toggle-thumb" />
    </button>
  );
}

function fmtAt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function EmailAdmin({
  settings,
  members,
  logs,
}: {
  settings: TransactionalEmailSettings;
  members: Member[];
  logs: TransactionalEmailLog[];
}) {
  const toast = useToast();
  const [s, setS] = React.useState(settings);
  const [memberState, setMemberState] = React.useState<Record<string, boolean>>(
    Object.fromEntries(members.map((m) => [m.id, m.transactional_emails_enabled])),
  );
  const [busy, setBusy] = React.useState<string | null>(null);

  const sentCount = logs.filter((l) => l.status === 'sent').length;
  const failedCount = logs.filter((l) => l.status === 'failed').length;

  // ---- analytics (derived from the same logs, client-side) ----
  const analytics = React.useMemo(() => {
    const today = new Date();
    // Daily volume over the last 14 days.
    const daily: number[] = [];
    const dailyLabels: string[] = [];
    for (let i = 13; i >= 0; i--) {
      const ds = fmtDate(addDays(today, -i));
      daily.push(logs.filter((l) => l.created_at.slice(0, 10) === ds).length);
      dailyLabels.push(String(Number(ds.slice(8, 10)))); // day-of-month
    }
    // Volume by purpose.
    const order: { key: string; label: string }[] = [
      { key: 'leave_approved', label: 'Leave OK' },
      { key: 'leave_rejected', label: 'Leave no' },
      { key: 'goal_assigned', label: 'Task' },
      { key: 'punch_missing', label: 'Punch' },
      { key: 'bug_report', label: 'Bug' },
    ];
    const byEvent = order.map((o) => logs.filter((l) => l.event_type === o.key).length);
    const byEventLabels = order.map((o) => o.label);
    return { daily, dailyLabels, byEvent, byEventLabels };
  }, [logs]);

  const deliveryRate = logs.length ? Math.round((sentCount / logs.length) * 100) : 0;

  async function saveSetting(key: keyof TransactionalEmailSettings, value: boolean) {
    setBusy(key);
    const prev = s[key];
    setS((cur) => ({ ...cur, [key]: value }));
    try {
      await setTransactionalSettings({ [key]: value });
    } catch (e) {
      setS((cur) => ({ ...cur, [key]: prev }));
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function saveMember(id: string, value: boolean) {
    setBusy(id);
    setMemberState((cur) => ({ ...cur, [id]: value }));
    try {
      await setMemberTransactionalEnabled(id, value);
    } catch (e) {
      setMemberState((cur) => ({ ...cur, [id]: !value }));
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  const eventSwitches: { key: 'on_leave' | 'on_goal' | 'on_punch'; label: string; hint: string }[] = [
    { key: 'on_leave', label: 'Leave decisions', hint: 'Approved / declined emails to the requester' },
    { key: 'on_goal', label: 'Task assignments', hint: 'When a task is assigned to a member' },
    { key: 'on_punch', label: 'Missed punches', hint: 'Forgot-to-punch-out reminders' },
  ];

  return (
    <div className="grid gap-4">
      {/* Master switch */}
      <section className="txn-section">
        <div className="txn-section-head">
          <Icon name="mail" size={16} />
          <h2>Transactional emails</h2>
          <span className="hint">Off by default. Turn on to email members on key events</span>
        </div>
        <div className="txn-member-row" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="txn-member-info">
            <div className="txn-member-name">Master switch</div>
            <div className="txn-member-sub">
              {s.enabled ? 'Emails are being sent' : 'All transactional emails are paused'}
            </div>
          </div>
          <Toggle
            enabled={s.enabled}
            onChange={(v) => saveSetting('enabled', v)}
            disabled={busy === 'enabled'}
            label="Master transactional email switch"
          />
        </div>
        {/* Per-event switches: disabled visually when master is off */}
        <div style={{ opacity: s.enabled ? 1 : 0.5, pointerEvents: s.enabled ? 'auto' : 'none' }}>
          {eventSwitches.map((ev) => (
            <div key={ev.key} className="txn-member-row">
              <div className="txn-member-info">
                <div className="txn-member-name">{ev.label}</div>
                <div className="txn-member-sub">{ev.hint}</div>
              </div>
              <Toggle
                enabled={s[ev.key]}
                onChange={(v) => saveSetting(ev.key, v)}
                disabled={busy === ev.key}
                label={`${ev.label} emails`}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Per-member recipients */}
      <section className="txn-section">
        <div className="txn-section-head">
          <Icon name="users" size={16} />
          <h2>Who receives them</h2>
          <span className="hint">Mute transactional emails for individual members</span>
        </div>
        {members.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-grey-text)', fontSize: 14 }}>
            No active members.
          </div>
        ) : (
          members.map((m) => {
            const enabled = memberState[m.id] ?? m.transactional_emails_enabled;
            // Only the communication email is a deliverable inbox — the login
            // email is just a sign-in username, so it is never emailed.
            const to = m.commute_email;
            return (
              <div key={m.id} className={`txn-member-row${enabled ? '' : ' is-paused'}`}>
                <Avatar name={m.name} size="sm" src={m.avatar_url} />
                <div className="txn-member-info">
                  <div className="txn-member-name">{m.name}</div>
                  <div className="txn-member-sub">
                    {roleLabel(m.role as UserRole)} · {m.department}
                  </div>
                </div>
                {to ? (
                  <span className="txn-email-pill has-email" title={to}>
                    <Icon name="mail" size={12} />
                    {to}
                  </span>
                ) : (
                  <span
                    className="txn-email-pill"
                    title="No communication email set. Add one in Team > Manage member. This member receives no emails until then."
                  >
                    <Icon name="mail" size={12} />
                    No communication email
                  </span>
                )}
                <Toggle
                  enabled={enabled}
                  onChange={(v) => saveMember(m.id, v)}
                  disabled={busy === m.id}
                  label={`Transactional emails for ${m.name}`}
                />
              </div>
            );
          })
        )}
      </section>

      {/* Send log */}
      <section className="txn-section">
        <div className="txn-section-head">
          <Icon name="chart" size={16} />
          <h2>Send log</h2>
          <span className="hint">
            {logs.length} recent · {sentCount} sent · {failedCount} failed
          </span>
        </div>
        {logs.length === 0 ? (
          <div className="txn-empty">
            <div className="txn-empty-emoji">📭</div>
            No transactional emails sent yet. When the master switch is on, every leave decision,
            goal assignment and missed-punch reminder is emailed and recorded here — as is any bug
            report a member sends from the crash page, regardless of the switch.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Purpose</th>
                  <th>Status</th>
                  <th>Sent</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="fw-medium">
                      {l.recipient_name}
                      <div className="text-xs text-grey">{l.recipient_email}</div>
                    </td>
                    <td>
                      <span className="badge badge-slate">
                        {EVENT_LABEL[l.event_type] ?? l.event_type}
                      </span>
                      <div className="text-xs text-grey" style={{ maxWidth: 240, marginTop: 3 }} title={l.subject}>
                        {l.subject}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${l.status === 'sent' ? '' : 'badge-red'}`}>
                        {l.status}
                      </span>
                      {l.error_message ? (
                        <div className="text-xs text-grey" style={{ maxWidth: 220 }} title={l.error_message}>
                          {l.error_message.slice(0, 60)}
                        </div>
                      ) : null}
                    </td>
                    <td className="text-grey">{fmtAt(l.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Analytics */}
      <section className="txn-section">
        <div className="txn-section-head">
          <Icon name="chart" size={16} />
          <h2>Analytics</h2>
          <span className="hint">Send volume and delivery at a glance</span>
        </div>

        {logs.length === 0 ? (
          <div className="txn-empty">
            <div className="txn-empty-emoji">📊</div>
            No data to chart yet. Once transactional emails start sending, you will see daily
            volume and a breakdown by purpose here.
          </div>
        ) : (
          <div style={{ padding: 16 }}>
            {/* Stat tiles */}
            <div className="email-stat-grid">
              <div className="email-stat">
                <div className="email-stat-value">{logs.length}</div>
                <div className="email-stat-label">Total (recent)</div>
              </div>
              <div className="email-stat">
                <div className="email-stat-value" style={{ color: '#22c55e' }}>{sentCount}</div>
                <div className="email-stat-label">Sent</div>
              </div>
              <div className="email-stat">
                <div className="email-stat-value" style={{ color: failedCount ? '#ef4444' : 'inherit' }}>
                  {failedCount}
                </div>
                <div className="email-stat-label">Failed</div>
              </div>
              <div className="email-stat">
                <div className="email-stat-value">{deliveryRate}%</div>
                <div className="email-stat-label">Delivery rate</div>
              </div>
            </div>

            {/* Charts */}
            <div className="email-chart-grid">
              <div className="card">
                <div className="card-subtitle" style={{ marginBottom: 12 }}>
                  Emails sent · last 14 days
                </div>
                <LineChart data={analytics.daily} labels={analytics.dailyLabels} />
              </div>
              <div className="card">
                <div className="card-subtitle" style={{ marginBottom: 12 }}>
                  By purpose
                </div>
                <BarChart data={analytics.byEvent} labels={analytics.byEventLabels} />
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
