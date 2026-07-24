// API route for managing push subscriptions.
//
// POST   /api/push  — save (upsert) a PushSubscription for the signed-in user
// DELETE /api/push  — remove a PushSubscription by endpoint
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { endpoint, p256dh, auth } = (await req.json()) as {
    endpoint: string;
    p256dh: string;
    auth: string;
  };
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  await supabase
    .from('push_subscriptions')
    .upsert({ user_id: user.id, endpoint, p256dh, auth }, { onConflict: 'user_id,endpoint' });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { endpoint } = (await req.json()) as { endpoint?: string };

  let q = supabase.from('push_subscriptions').delete().eq('user_id', user.id);
  if (endpoint) q = q.eq('endpoint', endpoint);
  await q;

  return NextResponse.json({ ok: true });
}
