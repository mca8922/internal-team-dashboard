/** Connectivity + schema check — confirms env, reachability, and tables. */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anon || !service) {
  console.error('Missing env keys');
  process.exit(1);
}

const admin = createClient(url, service, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const tables = ['profiles', 'punches', 'logs', 'goals', 'leaves', 'holidays', 'company'];

async function main() {
  console.log('URL:', url);
  let ok = true;
  for (const t of tables) {
    const { error, count } = await admin
      .from(t)
      .select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`  ✗ ${t.padEnd(10)} — ${error.message}`);
      ok = false;
    } else {
      console.log(`  ✓ ${t.padEnd(10)} — ${count ?? 0} rows`);
    }
  }
  // is_board() helper
  const { error: fnErr } = await admin.rpc('is_board');
  console.log(
    fnErr
      ? `  ✗ is_board() — ${fnErr.message}`
      : '  ✓ is_board() function exists',
  );
  if (fnErr) ok = false;

  console.log(ok ? '\nSchema OK.' : '\nSchema check FAILED — run the migrations.');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('Connection failed:', e.message);
  process.exit(1);
});
