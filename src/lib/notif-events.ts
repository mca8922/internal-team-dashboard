//
// Which transactional-email settings flag gates each event type. Split out
// of notify-email.ts (which starts with `import 'server-only'`, and so
// cannot be imported under Vitest/plain Node) so this pure logic is directly
// unit testable.
import type { TransactionalEventType } from './types';

export function eventAllowed(
  s: { on_leave: boolean; on_goal: boolean; on_punch: boolean },
  event: TransactionalEventType,
): boolean {
  if (event === 'goal_assigned') return s.on_goal;
  if (
    event === 'punch_missing' ||
    event === 'punch_change_requested' ||
    event === 'punch_change_approved' ||
    event === 'punch_change_rejected'
  ) {
    return s.on_punch;
  }
  return s.on_leave; // leave_approved | leave_rejected
}
