'use server';

// Server Actions the support UI calls. These are the boundary: the browser
// reaches these, and only these ever see the API key.
//
// Note what none of them accept: an email address. The reporter's identity
// always comes from the fork's own session via getSupportUser(), never from
// the request. Otherwise anyone could read a colleague's tickets by posting
// their address.
import { getSupportUser } from './current-user';
import {
  actOnRemoteTicket,
  createRemoteTicket,
  getRemoteTicket,
  listRemoteTickets,
  type RemoteTicket,
  type RemoteTicketDetail,
} from './support-api';
import { mirrorRaisedTicket, mirrorTicketDetail, mirrorTickets } from './support-mirror';
import { validateTicketInput, type SupportCategory } from './support-shared';

const NOT_SIGNED_IN = 'Please sign in again and retry.';

// The optional local mirror (support-mirror.ts) is never allowed to affect what
// the caller sees. It runs only after the real work has already succeeded, so a
// failure here costs one local row — not a lost ticket, and not an error on the
// page someone opened because something was already broken.
async function mirror(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch {
    // Deliberately swallowed. See the contract in support-mirror.ts.
  }
}

export async function raiseTicket(input: {
  category: SupportCategory;
  subject: string;
  body: string;
  page?: string;
  userAgent?: string;
}): Promise<{ ok: boolean; ref?: string; error?: string }> {
  const user = await getSupportUser();
  if (!user) return { ok: false, error: NOT_SIGNED_IN };

  // Checked here as well as in the form: the UI's copy of the rules is a
  // convenience, not the authority.
  const invalid = validateTicketInput(input);
  if (invalid) return { ok: false, error: invalid };

  const result = await createRemoteTicket({
    reporterName: user.name,
    reporterEmail: user.email,
    reporterRole: user.role,
    category: input.category,
    subject: input.subject,
    body: input.body,
    context: { page: input.page, userAgent: input.userAgent },
  });

  if (!result.ok) return { ok: false, error: result.error };

  await mirror(() =>
    mirrorRaisedTicket({
      ref: result.data.ref,
      user,
      category: input.category,
      subject: input.subject,
      body: input.body,
      context: { page: input.page, userAgent: input.userAgent },
    }),
  );

  return { ok: true, ref: result.data.ref };
}

export async function listMyTickets(): Promise<RemoteTicket[]> {
  const user = await getSupportUser();
  if (!user) return [];
  const result = await listRemoteTickets(user.email);
  // An empty list on failure: the page renders its empty state rather than an
  // error, and the person can retry by reloading. Raising a NEW ticket still
  // works even while the list call is failing.
  if (!result.ok) return [];
  await mirror(() => mirrorTickets(user, result.data.tickets));
  return result.data.tickets;
}

export async function openMyTicket(
  ref: string,
): Promise<{ ok: boolean; ticket?: RemoteTicketDetail; error?: string }> {
  const user = await getSupportUser();
  if (!user) return { ok: false, error: NOT_SIGNED_IN };
  const result = await getRemoteTicket(ref, user.email);
  if (!result.ok) return { ok: false, error: result.error };
  // The thread as reStrucAI returned it — this is where a fork with a mirror
  // picks up the replies and status entries that came back.
  await mirror(() => mirrorTicketDetail(user, result.data.ticket));
  return { ok: true, ticket: result.data.ticket };
}

export async function resolveTicket(ref: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getSupportUser();
  if (!user) return { ok: false, error: NOT_SIGNED_IN };
  const result = await actOnRemoteTicket(ref, {
    email: user.email,
    name: user.name,
    action: 'resolve',
  });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
