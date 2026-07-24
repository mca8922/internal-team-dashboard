/**
 * One-off notifications cleanup. Reports the current breakdown, then deletes
 * already-seen notifications older than the retention window — the same policy
 * the daily sweep (sweepOldNotifications) applies, run on demand so the backlog
 * clears without waiting for the cron.
 *
 *   npm run prune:notifs            # delete read notifications older than 7 days
 *   RETAIN_DAYS=0 npm run prune:notifs   # delete ALL read notifications now
 *   DRY_RUN=1 npm run prune:notifs  # report only, delete nothing
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !service) {
  console.error('Missing Supabase env keys (.env.local)');
  process.exit(1);
}

const RETAIN_DAYS = Number(process.env.RETAIN_DAYS ?? process.env.NOTIFICATION_RETENTION_DAYS ?? 7);
const DRY_RUN = process.env.DRY_RUN === '1';

const admin = createClient(url, service, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const cutoffISO = new Date(Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000).toISOString();

async function count(filter: (q: ReturnType<typeof admin.from>) => unknown): Promise<number> {
  const q = admin.from('notifications').select('*', { count: 'exact', head: true });
  const { count: c } = (await (filter(q) as Promise<{ count: number | null }>)) ?? { count: 0 };
  return c ?? 0;
}

async function main() {
  const total = await count((q) => q);
  const read = await count((q) => (q as any).eq('is_read', true));
  const readOld = await count((q) => (q as any).eq('is_read', true).lt('created_at', cutoffISO));

  console.log(`URL: ${url}`);
  console.log(`Retention: ${RETAIN_DAYS} day(s) — cutoff ${cutoffISO}`);
  console.log('Current notifications table:');
  console.log(`  total                : ${total}`);
  console.log(`  read (seen)          : ${read}`);
  console.log(`  read & older than ${String(RETAIN_DAYS).padStart(2)}d : ${readOld}  <- target`);

  if (DRY_RUN) {
    console.log('\nDRY_RUN=1 — nothing deleted.');
    return;
  }
  if (readOld === 0) {
    console.log('\nNothing matches the policy — no rows deleted.');
    console.log('Tip: re-run with RETAIN_DAYS=0 to clear all already-seen notifications now.');
    return;
  }

  const { error } = await admin
    .from('notifications')
    .delete()
    .eq('is_read', true)
    .lt('created_at', cutoffISO);
  if (error) {
    console.error('\nDelete failed:', error.message);
    process.exit(1);
  }
  console.log(`\nDeleted ${readOld} notification(s). Remaining: ${total - readOld}.`);
}

main().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
