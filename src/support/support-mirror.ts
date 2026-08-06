import 'server-only';

// ===========================================================================
// MCA's implementation of the module's optional per-fork mirror seam.
// ===========================================================================
//
// The shared default is three no-ops. MCA opted in: the operator wants a local,
// queryable record of what this team raised and where it got to.
//
// reStrucAI remains the source of truth. Nothing the Support page renders is
// read from these tables — every write below happens AFTER the real call has
// already succeeded, and every one of them is allowed to fail silently. See
// supabase/migrations/0062_support_mirror.sql for what that costs and why these
// tables are an archive rather than an authority.
//
// Identity comes from the session, never from an argument: RLS only permits a
// row whose reporter_id is auth.uid(), so a mirror write cannot be aimed at
// someone else's history even if a caller tried.
//
// NOTE FOR RE-COPIES: this file is a per-fork seam and is DELIBERATELY not
// byte-identical to the module. When pulling a module update, copy every file
// EXCEPT this one and current-user.ts, or you will overwrite the implementation
// with the shared no-op and the mirror will go quietly dead.
import { createClient } from '@/lib/supabase/server';
import type { SupportUser } from './current-user';
import type { RemoteTicket, RemoteTicketDetail } from './support-api';
import type { SupportCategory } from './support-shared';

export interface MirrorTicketInput {
  ref: string;
  user: SupportUser;
  category: SupportCategory;
  subject: string;
  body: string;
  context?: Record<string, string | undefined>;
}

const MESSAGE_KEY = 'ticket_ref,author_type,remote_created_at,body';

// The module's SupportUser carries name/email/role but no id, and RLS needs the
// id — so the mirror resolves it from the session itself.
async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function mirrorRaisedTicket(input: MirrorTicketInput): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const supabase = await createClient();

  // Drop empty entries so the jsonb column holds only what was actually
  // captured, rather than keys with nulls under them.
  const context = Object.fromEntries(
    Object.entries(input.context ?? {}).filter(([, v]) => v != null && v !== ''),
  );

  const { error } = await supabase.from('support_mirror_tickets').upsert(
    {
      ref: input.ref,
      reporter_id: userId,
      reporter_name: input.user.name,
      reporter_email: input.user.email,
      reporter_role: input.user.role,
      category: input.category,
      subject: input.subject,
      body: input.body,
      status: 'open',
      context,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'ref' },
  );
  // The message row is a child of the ticket row, so there is nothing to write
  // if the ticket did not land.
  if (error) return;

  // The opening request, stored as the first thread entry so the local copy
  // reads as a history rather than a row with a body hanging off it — the same
  // shape reStrucAI keeps on its side.
  await supabase.from('support_mirror_messages').upsert(
    {
      ticket_ref: input.ref,
      author_type: 'client',
      author_name: input.user.name,
      body: input.body,
      remote_created_at: new Date().toISOString(),
    },
    { onConflict: MESSAGE_KEY, ignoreDuplicates: true },
  );
}

export async function mirrorTickets(user: SupportUser, tickets: RemoteTicket[]): Promise<void> {
  if (tickets.length === 0) return;
  const userId = await currentUserId();
  if (!userId) return;
  const supabase = await createClient();

  // Status is the field that moves, so this is what keeps the archive current.
  // The list carries no body — a row first seen here keeps body null until the
  // reporter opens the thread, which is why that column is nullable.
  await supabase.from('support_mirror_tickets').upsert(
    tickets.map((t) => ({
      ref: t.ref,
      reporter_id: userId,
      reporter_name: user.name,
      reporter_email: user.email,
      reporter_role: user.role,
      category: t.category,
      subject: t.subject,
      status: t.status,
      remote_created_at: t.created_at,
      remote_updated_at: t.updated_at,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'ref' },
  );
}

export async function mirrorTicketDetail(
  user: SupportUser,
  ticket: RemoteTicketDetail,
): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const supabase = await createClient();

  // messages[0] is the opening request, so this is also where a row first seen
  // via the list finally gets its body filled in.
  const opening = ticket.messages[0];

  const { error } = await supabase.from('support_mirror_tickets').upsert(
    {
      ref: ticket.ref,
      reporter_id: userId,
      reporter_name: user.name,
      reporter_email: user.email,
      reporter_role: user.role,
      category: ticket.category,
      subject: ticket.subject,
      ...(opening ? { body: opening.body } : {}),
      status: ticket.status,
      remote_created_at: ticket.created_at,
      remote_updated_at: ticket.updated_at,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'ref' },
  );
  if (error || ticket.messages.length === 0) return;

  // Idempotent by the table's (ticket_ref, author_type, remote_created_at, body)
  // key: re-opening a ticket replays the same entries and adds nothing.
  await supabase.from('support_mirror_messages').upsert(
    ticket.messages.map((m) => ({
      ticket_ref: ticket.ref,
      author_type: m.author_type,
      author_name: m.author_name,
      body: m.body,
      remote_created_at: m.created_at,
    })),
    { onConflict: MESSAGE_KEY, ignoreDuplicates: true },
  );
}
