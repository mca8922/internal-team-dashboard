'use server';

// Auth Server Actions — sign in / sign out / password reset via Supabase Auth.
// There is no public sign-up: only Board Members create accounts, via the
// createTeamMember action in actions.ts.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function signIn(email: string, password: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}

// Emails a password-reset link (sent by Supabase Auth). The link lands on
// /auth/callback, which exchanges it for a recovery session and forwards to
// /auth/reset-password. Supabase doesn't reveal whether the email has an
// account, so the form always shows the same "check your inbox" message.
export async function requestPasswordReset(email: string): Promise<{ error?: string }> {
  const h = await headers();
  const origin =
    h.get('origin') ??
    `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/auth/reset-password`,
  });
  if (error) return { error: error.message };
  return {};
}

// Sets the new password for the recovery session opened by the reset link.
export async function resetPassword(password: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'This reset link has expired. Request a new one.' };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  revalidatePath('/', 'layout');
  return {};
}
