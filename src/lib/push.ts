// Server-side Web Push helper. Never imported by client code.
//
// Reads VAPID credentials from env vars. If they are not set (local dev
// without the .env keys) every call is a no-op so the rest of the app is
// unaffected.
import webpush from 'web-push';
import { createAdminClient } from '@/lib/supabase/admin';
import type { NotificationType } from '@/lib/types';

const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidEmail = process.env.VAPID_EMAIL;

if (vapidPublicKey && vapidPrivateKey && vapidEmail) {
  webpush.setVapidDetails(`mailto:${vapidEmail}`, vapidPublicKey, vapidPrivateKey);
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

// Send a push notification to every active browser subscription belonging to
// the given user(s). Uses the admin client so callers don't need to be those
// users. Stale subscriptions (HTTP 410/404 from the push service) are cleaned
// up automatically so they don't accumulate.
//
// When `type` is given, recipients who muted push for that notification type
// (notification_prefs.push = false) are dropped first — the single point where
// per-type push preferences are enforced.
export async function sendPush(
  userIds: string | string[],
  payload: PushPayload,
  type?: NotificationType,
): Promise<void> {
  if (!vapidPublicKey || !vapidPrivateKey) return;

  let ids = Array.isArray(userIds) ? userIds : [userIds];
  if (!ids.length) return;

  const admin = createAdminClient();

  if (type) {
    const { data: muted } = await admin
      .from('notification_prefs')
      .select('user_id')
      .eq('type', type)
      .eq('push', false)
      .in('user_id', ids);
    if (muted?.length) {
      const mutedSet = new Set(muted.map((m) => m.user_id));
      ids = ids.filter((id) => !mutedSet.has(id));
    }
    if (!ids.length) return;
  }

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', ids);

  if (!subs?.length) return;

  const message = JSON.stringify(payload);
  const staleIds: string[] = [];

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          message,
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) staleIds.push(sub.id);
      }
    }),
  );

  if (staleIds.length) {
    await admin.from('push_subscriptions').delete().in('id', staleIds);
  }
}
