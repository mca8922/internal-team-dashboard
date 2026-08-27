// GET /api/assistant-token — mints a short-lived signed identity token for the
// documentation assistant widget (see docs/INTEGRATION.md).
//
// The token is a cut-down JWT: base64url(payload).base64url(hmacSha256(payload)).
// The assistant service verifies the signature with the same shared secret, so
// it can trust WHO is asking without this app exposing anything else about them.
//
// Two rules this route exists to enforce, both security-critical:
//
//  1. The user id comes from the Supabase session, NEVER from the request. A
//     caller-supplied id would let anyone ask questions as anyone else — and,
//     since the assistant's daily message cap counts against `sub`, would let
//     them reset their own allowance by inventing a new id per request.
//  2. ASSISTANT_SIGNING_SECRET is read server-side only and is never returned,
//     logged, or echoed. A leaked secret is the same as (1): any browser could
//     mint a token for any identity.
import { NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';

// Short by design — the widget re-fetches on page load, so an hour is plenty
// and keeps the blast radius of a copied token small.
const TOKEN_TTL_SECONDS = 60 * 60;

// The session cookie makes every response user-specific; caching one would risk
// handing person A's identity token to person B.
export const dynamic = 'force-dynamic';

export async function GET() {
  const secret = process.env.ASSISTANT_SIGNING_SECRET;
  // A missing secret is a deployment problem, not a caller problem — 503 says
  // "this endpoint isn't wired up yet" rather than blaming the request. The
  // message deliberately names the variable but never its value.
  if (!secret) {
    return NextResponse.json(
      { error: 'Assistant is not configured: ASSISTANT_SIGNING_SECRET is not set.' },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Name comes from the profile; email from the auth record, which is the one
  // the person actually signs in with. Both are best-effort labels for the
  // assistant's admin views — `sub` is the only field it keys anything on.
  const { data: profile } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', user.id)
    .single();

  const payload = Buffer.from(
    JSON.stringify({
      sub: String(user.id),
      name: profile?.name ?? user.email ?? 'Unknown',
      email: user.email ?? '',
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    }),
  ).toString('base64url');

  const signature = createHmac('sha256', secret).update(payload).digest('base64url');

  return NextResponse.json(
    { token: `${payload}.${signature}` },
    // Belt and braces alongside force-dynamic: this response is per-user and
    // expires in an hour, so no shared cache should ever hold it.
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
