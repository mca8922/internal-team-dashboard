import 'server-only';

// The only file that talks to reStrucAI. Four calls, all server-to-server with
// the client API key in a header.
//
// Every function returns a discriminated result rather than throwing. Support
// is what people reach for when something is already broken — a failure here
// must degrade to a readable message, never to a second error page on top of
// the first.
import { supportConfig } from './support-config';
import type { SupportStatus, SupportCategory } from './support-shared';

export interface RemoteTicket {
  ref: string;
  subject: string;
  category: SupportCategory;
  status: SupportStatus;
  created_at: string;
  updated_at: string;
}

export interface RemoteMessage {
  author_type: 'client' | 'agent' | 'system';
  author_name: string;
  body: string;
  created_at: string;
}

export interface RemoteTicketDetail extends RemoteTicket {
  messages: RemoteMessage[];
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

const UNCONFIGURED = 'Support is not set up yet. Please contact your administrator.';
const UNREACHABLE = 'We could not reach reStrucAI support. Please try again in a moment.';

async function call<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<ApiResult<T>> {
  const cfg = supportConfig();
  if (!cfg) return { ok: false, error: UNCONFIGURED };

  try {
    const res = await fetch(`${cfg.apiUrl}${path}`, {
      method: init.method,
      headers: {
        'content-type': 'application/json',
        'x-support-key': cfg.apiKey,
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      // Ticket state changes the moment someone replies; a cached list would
      // show a stale status right when the person is checking for an update.
      cache: 'no-store',
    });

    const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) {
      // Never surface reStrucAI's raw error text or status code to a client's
      // team — it is our internal detail, and 401 vs 404 tells a prober things.
      return { ok: false, error: json?.error ?? UNREACHABLE };
    }
    // A 2xx we could not parse is not a success. Every support endpoint answers
    // with a JSON object, so a null body means we never reached one — most
    // often an auth redirect that fetch followed to a 200 HTML login page.
    // Without this guard the null is cast to T and the caller dereferences it
    // (`result.data.tickets`), which crashes the one page someone opens when
    // something is already broken. The cast below is why the compiler cannot
    // catch it for us.
    if (json === null) return { ok: false, error: UNREACHABLE };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export function createRemoteTicket(input: {
  reporterName: string;
  reporterEmail: string;
  reporterRole: string;
  category: SupportCategory;
  subject: string;
  body: string;
  context?: Record<string, string | undefined>;
}): Promise<ApiResult<{ ref: string }>> {
  return call('/api/support/intake', { method: 'POST', body: input });
}

export function listRemoteTickets(email: string): Promise<ApiResult<{ tickets: RemoteTicket[] }>> {
  return call(`/api/support/tickets?email=${encodeURIComponent(email)}`, { method: 'GET' });
}

export function getRemoteTicket(
  ref: string,
  email: string,
): Promise<ApiResult<{ ticket: RemoteTicketDetail }>> {
  return call(`/api/support/tickets/${encodeURIComponent(ref)}?email=${encodeURIComponent(email)}`, {
    method: 'GET',
  });
}

export function actOnRemoteTicket(
  ref: string,
  payload: { email: string; name: string; action: 'resolve' },
): Promise<ApiResult<Record<string, never>>> {
  return call(`/api/support/tickets/${encodeURIComponent(ref)}`, { method: 'POST', body: payload });
}
