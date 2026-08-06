// Support — the client team's way in to the reStrucAI desk. Nothing about a
// ticket is authored here: listMyTickets() reads them straight back from
// reStrucAI's API, and the local mirror (src/support/support-mirror.ts) is an
// archive written after the fact, never the source.
//
// The desk itself is src/support/, a module shared byte-identical across every
// client fork. The Phase-1 gate below is deliberately OUTSIDE it: the module
// knows nothing about this app's flags, which is what keeps it portable.
import { Icon } from '@/components/Icon';
import { FEATURE_FLAGS } from '@/lib/featureFlags';
import { AboutRestrucAI } from '@/support/AboutRestrucAI';
import { SupportPage } from '@/support/SupportPage';
import { listMyTickets } from '@/support/support-actions';

export const metadata = { title: 'Support · Mahesh Chandra & Associates' };

export default async function Page() {
  // Returns BEFORE listMyTickets(). While locked the desk must be inert: no
  // call to reStrucAI, no reporter email leaving this app, and no mirror rows
  // written. A gate that still talked to the API would be a flag in name only.
  if (!FEATURE_FLAGS.support) return <SupportLocked />;

  const tickets = await listMyTickets();
  return <SupportPage tickets={tickets} />;
}

// Matches the locked state used for notification history, so "not yet" reads
// the same wherever someone meets it.
function SupportLocked() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Support</h1>
          <div className="page-subtitle">Raising requests with reStrucAI</div>
        </div>
        {/* Deliberately still here while the desk is locked. Who built this and
            how to reach them is exactly what someone wants when the thing they
            came for is not open yet. */}
        <div className="page-header-actions">
          <AboutRestrucAI />
        </div>
      </div>

      <div className="card">
        <div className="notif-locked-page">
          <span className="notif-locked-page-icon">
            <Icon name="lock" size={20} />
          </span>
          <div className="text-sm fw-medium mt-2">Support unlocks in Phase 2</div>
          <div className="text-xs text-grey mt-1" style={{ maxWidth: 380 }}>
            You will be able to raise an issue with the reStrucAI team here, follow
            its status, and close it out. Until then, reach your usual reStrucAI
            contact by email.
          </div>
        </div>
      </div>
    </div>
  );
}
