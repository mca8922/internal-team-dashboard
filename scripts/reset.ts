/**
 * Reset script — wipes ALL data and provisions a single Board Member account.
 *
 * Run with:  npm run reset
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local. Destructive: it deletes
 * every auth user and every domain row, then creates one board account.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
// The seed account password is a real credential — never hard-code it. Provide
// it at run time via .env.local (RESET_BOARD_PASSWORD) so it stays out of git.
const boardPassword = process.env.RESET_BOARD_PASSWORD;

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!boardPassword) {
  console.error('Missing RESET_BOARD_PASSWORD in .env.local — set the seed Board password there.');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// The one Board Member account to seed (the Founder). The password comes from
// the environment (RESET_BOARD_PASSWORD), never the source. NOTE: after a fresh
// seed the new account gets a new user id — set FOUNDER_USER_ID in
// src/lib/roles.ts to it so the app recognises the Founder.
const BOARD = {
  name: 'MCA',
  email: 'ceo@restrucai.com',
  password: boardPassword,
  department: 'Strategy',
};

const ALL_ZERO = '00000000-0000-0000-0000-000000000000';

async function main() {
  console.log('Resetting reStrucAI — wiping all data…');

  // ---- delete domain rows (children first so FKs are satisfied) ----
  for (const table of ['punches', 'logs', 'leaves', 'goals', 'holidays']) {
    const { error } = await admin.from(table).delete().neq('id', ALL_ZERO);
    if (error) console.warn(`  warn: clearing ${table}: ${error.message}`);
  }
  // company is a singleton — reset its content instead of deleting the row.
  await admin
    .from('company')
    .update({ mission: '', vision: '', updated_by: null })
    .eq('id', 1);

  // ---- delete every auth user (their profiles cascade away) ----
  const { data: list } = await admin.auth.admin.listUsers();
  for (const u of list?.users ?? []) {
    await admin.auth.admin.deleteUser(u.id);
    console.log(`  removed auth user ${u.email}`);
  }

  // ---- create the single Board Member ----
  const { data, error } = await admin.auth.admin.createUser({
    email: BOARD.email,
    password: BOARD.password,
    email_confirm: true,
    user_metadata: { name: BOARD.name, role: 'board', department: BOARD.department },
  });
  if (error) throw error;

  // The on_auth_user_created trigger makes the profile row; confirm + patch it.
  await new Promise((r) => setTimeout(r, 800));
  await admin
    .from('profiles')
    .update({ confirmed_by_board: true })
    .eq('id', data.user!.id);

  console.log('\nReset complete. Board Member account:');
  console.log(`  ${BOARD.email}  (password as provided)`);
  console.log('\nSign in, then create team members from the Team page.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
