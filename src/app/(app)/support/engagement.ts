'use server';

// Invisible engagement log for the Support surface. Nothing here changes what
// anyone sees — these are fire-and-forget writes called from the Support page
// and the "About reStrucAI" modal. The Board reads the result straight from the
// `support_engagement_events` table in the Supabase Table Editor.
//
// Every function swallows its own errors: a missed analytics row must never
// break the page someone actually came to Support to use.

import { createClient } from '@/lib/supabase/server';
import { getSupportUser } from '@/support/current-user';
import type { AboutRestrucAIEvent } from '@/support/AboutRestrucAI';

type Action = 'Viewed Support page' | 'Opened About reStrucAI' | 'Clicked a link';
type LinkLabel = 'Website' | 'Nishit Rathod – LinkedIn' | 'Referral';

async function record(row: {
  action: Action;
  link?: LinkLabel | null;
  link_url?: string | null;
}): Promise<void> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const who = await getSupportUser();
    if (!who) return;

    await supabase.from('support_engagement_events').insert({
      user_id: user.id,
      member_name: who.name,
      member_email: who.email,
      action: row.action,
      link: row.link ?? null,
      link_url: row.link_url ?? null,
    });
  } catch {
    // Analytics loss beats a broken Support page.
  }
}

// Called once from the Support route on every render of the page (locked or not).
export async function logSupportPageView(): Promise<void> {
  await record({ action: 'Viewed Support page' });
}

// Passed to <AboutRestrucAI onEvent={...}> and <SupportPage aboutOnEvent={...}>.
// Handles both "modal opened" and "one of the three links clicked".
export async function logAboutEngagement(event: AboutRestrucAIEvent): Promise<void> {
  if (event.kind === 'modal_open') {
    await record({ action: 'Opened About reStrucAI' });
    return;
  }

  const label: LinkLabel =
    event.link === 'website'
      ? 'Website'
      : event.link === 'founder'
        ? 'Nishit Rathod – LinkedIn'
        : 'Referral';

  await record({ action: 'Clicked a link', link: label, link_url: event.url });
}
