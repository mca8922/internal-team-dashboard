import 'server-only';

// Service-role Supabase client. Bypasses RLS and can manage auth users —
// used ONLY by server-side board actions (e.g. creating team accounts).
// The `server-only` import makes the build fail if this is ever imported
// into a Client Component, so the service-role key can never reach the browser.
import { createClient } from '@supabase/supabase-js';

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
