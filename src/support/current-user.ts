import 'server-only';

// ===========================================================================
// THE ONE FILE TO EDIT PER FORK.
// ===========================================================================
//
// Everything else in this folder is identical across every client. This is the
// seam: it answers "who is signed in?" in whatever way this particular fork
// knows the answer.
//
// The stub below matches a standard fork of the reStrucAI dashboard (Supabase
// auth + a `profiles` table). If the fork's schema differs, change the query —
// not the shape of what comes back.
import { createClient } from '@/lib/supabase/server';

export interface SupportUser {
  name: string;
  email: string;   // must be a real, deliverable address — this is where replies go
  role: string;    // free text, shown to reStrucAI as context
}

export async function getSupportUser(): Promise<SupportUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, email, commute_email, job_title, role')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) return null;

  return {
    name: profile.name,
    // `email` on a profile is a login username in this schema and may not be
    // deliverable. Prefer the real communication inbox where one is set.
    email: profile.commute_email || profile.email,
    role: profile.job_title || profile.role || '',
  };
}
