// Department Manager's read-only email log — the transactional emails sent
// to members of the department they head. RLS already scopes the rows to
// the manager's department; this view just presents them.
import { fmtDateDMY, fmtTime } from '@/lib/dates';
import { Icon } from '@/components/Icon';
import type { TransactionalEmailLog } from '@/lib/types';

function StatusPill({ status }: { status: string }) {
  const cls =
    status === 'sent' ? 'badge badge-green' : status === 'failed' ? 'badge badge-red' : 'badge';
  return <span className={cls}>{status}</span>;
}

export function ManagerEmailView({
  department,
  txnLogs,
}: {
  department: string;
  txnLogs: TransactionalEmailLog[];
}) {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Emails</h1>
          <div className="page-subtitle">
            Communication emails sent to the {department} department · read-only
          </div>
        </div>
      </div>

      {txnLogs.length === 0 ? (
        <div className="empty-state">
          <Icon name="mail" size={42} stroke={1.2} />
          <h3>No emails yet</h3>
          <p className="text-grey text-sm">
            Nothing has been sent to your department yet.
          </p>
        </div>
      ) : (
        <section className="card">
          <div className="card-subtitle mb-3">
            Transactional emails · {txnLogs.length}
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Event</th>
                <th>Subject</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Sent</th>
              </tr>
            </thead>
            <tbody>
              {txnLogs.map((l) => (
                <tr key={l.id}>
                  <td className="fw-medium">
                    {l.recipient_name}
                    <div className="text-xs text-grey">{l.recipient_email}</div>
                  </td>
                  <td>{String(l.event_type).replace(/_/g, ' ')}</td>
                  <td className="text-grey">{l.subject}</td>
                  <td>
                    <StatusPill status={l.status} />
                  </td>
                  <td style={{ textAlign: 'right' }} className="text-xs text-grey">
                    {l.created_at
                      ? `${fmtDateDMY(new Date(l.created_at))} · ${fmtTime(new Date(l.created_at))}`
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
