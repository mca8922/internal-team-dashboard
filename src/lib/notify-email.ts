import 'server-only';

// Transactional email companion to the in-app `notifications` table. The same
// key events that drop a notification row (leave decided, goal assigned, punch
// missing) can also reach members by email, reusing the existing SMTP transport
// — no new service, so it stays on the free tier.
//
// Fully board-controlled via the transactional_email_settings row and a
// per-member flag (see the /email admin page):
//   - master switch (off by default — auto-emailing the team is opt-in)
//   - per-event-type switch (leave / goal / punch)
//   - per-member opt-out (profiles.transactional_emails_enabled)
// Every attempt is written to transactional_email_logs for the audit view.
//
// Sends under a neutral "reStrucAI Dashboard" identity and with no BCC.
import { eventAllowed } from './notif-events';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendMail } from '@/lib/mailer';
import { renderTransactionalEmail, transactionalPlainText } from './email-shell';
import type { TransactionalEventType } from '@/lib/types';

const FROM = '"reStrucAI Dashboard" <sales@restrucai.com>';
const APP_URL = 'https://restrucai-team.vercel.app';

// Keep the email copy em-dash / en-dash / emoji free, no matter what the
// source notification text contains — leave ranges use an en-dash, and goal
// titles or review notes may carry emojis.
function sanitize(s: string): string {
  return s
    .replace(/[—–]/g, '-') // em/en dash -> hyphen
    // Strip emoji + pictographic symbol blocks (keeps normal punctuation like ·).
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu,
      '',
    )
    .replace(/ {2,}/g, ' ')
    .trim();
}

// Emails the given members one notification, honouring every switch and logging
// the outcome. Best-effort and fully isolated: a disabled feature or a send
// failure never affects the in-app notification or the action that triggered it.
export async function notifyByEmail(
  userIds: string[],
  n: { eventType: TransactionalEventType; title: string; body?: string; href?: string },
): Promise<void> {
  if (userIds.length === 0) return;
  const admin = createAdminClient();

  const { data: settings } = await admin
    .from('transactional_email_settings')
    .select('enabled, on_leave, on_goal, on_punch')
    .eq('id', 1)
    .single();
  if (!settings || !settings.enabled || !eventAllowed(settings, n.eventType)) return;

  const { data: people } = await admin
    .from('profiles')
    .select('id, name, commute_email, email, transactional_emails_enabled')
    .in('id', userIds);
  if (!people || people.length === 0) return;

  const url = n.href ? `${APP_URL}${n.href}` : APP_URL;
  const title = sanitize(n.title);
  const body = n.body ? sanitize(n.body) : '';

  await Promise.allSettled(
    people.map(async (p) => {
      if (!p.transactional_emails_enabled) return; // member opted out
      // Only ever email the real communication inbox — profiles.email is just a
      // login username, not a deliverable address. No communication email set
      // means the member silently receives nothing until the board adds one.
      const to = p.commute_email;
      if (!to) return;
      // Built per-recipient so each member is greeted by their own name.
      const html = renderTransactionalEmail({ name: p.name, title, body, ctaUrl: url });
      const text = transactionalPlainText({ name: p.name, title, body, ctaUrl: url });
      try {
        await sendMail({ to, from: FROM, bcc: false, subject: title, html, text });
        await logSend(admin, p, n.eventType, title, to, 'sent');
      } catch (err) {
        await logSend(admin, p, n.eventType, title, to, 'failed', err instanceof Error ? err.message : String(err));
      }
    }),
  );
}

async function logSend(
  admin: ReturnType<typeof createAdminClient>,
  person: { id: string; name: string },
  eventType: TransactionalEventType,
  subject: string,
  to: string,
  status: 'sent' | 'failed',
  errorMessage?: string,
): Promise<void> {
  await admin.from('transactional_email_logs').insert({
    recipient_id: person.id,
    recipient_email: to,
    recipient_name: person.name,
    event_type: eventType,
    subject,
    status,
    error_message: errorMessage ?? null,
  });
}
