/**
 * One-off de-duplication of the notifications table. Exact duplicates — same
 * recipient, type, title and body — carry no extra information; they pile up
 * when an upstream job re-ingests the same event. Keeps the earliest of each
 * set (first seen wins) and deletes the rest.
 *
 *   DRY_RUN=1 npm run dedupe:notifs   # report only, delete nothing
 *   npm run dedupe:notifs             # delete the duplicates
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
const DRY = process.env.DRY_RUN === '1';
const admin = createClient(url, service, { auth: { persistSession: false } });

async function main() {
  const { data, error } = await admin
    .from('notifications')
    .select('id, user_id, type, title, body, created_at')
    .order('created_at', { ascending: true }); // earliest first => first seen wins
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  const rows = data ?? [];

  const seen = new Set<string>();
  const dupeIds: string[] = [];
  for (const n of rows) {
    const key = `${n.user_id}|${n.type}|${n.title}|${n.body ?? ''}`;
    if (seen.has(key)) dupeIds.push(n.id);
    else seen.add(key);
  }

  console.log(`Total: ${rows.length} | unique: ${seen.size} | duplicates: ${dupeIds.length}`);
  if (DRY) {
    console.log('DRY_RUN=1 — nothing deleted.');
    return;
  }
  if (!dupeIds.length) {
    console.log('No duplicates to remove.');
    return;
  }

  for (let i = 0; i < dupeIds.length; i += 100) {
    const chunk = dupeIds.slice(i, i + 100);
    const { error: delErr } = await admin.from('notifications').delete().in('id', chunk);
    if (delErr) {
      console.error(delErr.message);
      process.exit(1);
    }
  }
  console.log(`Deleted ${dupeIds.length} duplicate(s). Remaining: ${rows.length - dupeIds.length}.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
