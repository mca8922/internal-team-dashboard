# MCA · Internal Team Dashboard

A Next.js 15 (App Router) + Supabase port of the reStrucAI team dashboard —
punch tracking, Notion-style daily logs, goal cascades, team management,
analytics, and leave workflows.

## Stack

- **Next.js 15** App Router, React 18, TypeScript
- **Supabase** — Postgres + Auth (email/password) + Row Level Security
- Server Components for data fetching, Server Actions for mutations
- Plain global CSS (`src/app/globals.css`) — pixel-identical to the original design

## Project structure

```
supabase/migrations/      SQL — schema, RLS policies, auth trigger
scripts/seed.ts           Seeds the Arjun / Priya / Rohan demo data
src/
  middleware.ts           Refreshes the Supabase session, gates routes
  lib/
    supabase/             Browser / server / middleware clients
    types.ts              Domain + Database types
    dates.ts, roles.ts    Pure helpers
    queries.ts            Server-side read queries
    actions.ts            Server Actions (all mutations)
    auth-actions.ts       Sign in / up / out
  components/             Icon, ui primitives, charts, BlockEditor, Shell, Toast
  app/
    login/, register/     Auth pages
    (app)/                Authenticated route group (shared shell)
      dashboard/ punch/ log/ log/history/
      goals/ goals/manage/ team/ team/[id]/
      analytics/ analytics/team/ leaves/ settings/
```

## Setup

1. **Create a Supabase project** at https://supabase.com.

2. **Run the migrations.** In the Supabase dashboard SQL editor, run every file
   in `supabase/migrations/` in order (`0001` … `0015`). Or, with the
   Supabase CLI: `supabase db push`.

3. **Configure env.** Copy `.env.example` to `.env.local` and fill in the
   three values from Project Settings → API:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (used by the reset script and by the
     board-only account-creation action — never exposed to the browser)

4. **Install + reset.**
   ```
   npm install
   npm run reset    # wipes all data, creates the single Board account
   ```

5. **Run.**
   ```
   npm run dev
   ```

## Accounts

There is **no public sign-up.** Only Board Members create accounts:

- `npm run reset` provisions one Board Member account (configured at the top
  of `scripts/reset.ts`).
- Once signed in, a Board Member creates team accounts from the **Team page**
  → *Create account*. They set a temporary password and hand it over; the new
  member changes it in **Settings**.

`npm run check` verifies Supabase connectivity and that the schema exists.

## Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel, **Import Project** and select the repo. Vercel auto-detects
   Next.js — no build settings to change.
3. Under **Settings → Environment Variables**, add the same three keys as
   `.env.local` (for the Production, Preview, and Development scopes):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Deploy. After the first deploy, add your Vercel domain to Supabase under
   **Authentication → URL Configuration** (Site URL + Redirect URLs) so auth
   redirects resolve correctly.

The Supabase schema must already be migrated (step 2 of Setup) — Vercel only
hosts the app, not the database. `npm run reset` / `npm run check` are local
admin scripts and are not part of the deployment.

## Notes

- **RLS** enforces the role model server-side: board members see everything;
  everyone else sees only their own punches, logs, and leaves. The board-only
  pages also redirect non-board users at the route level.
- New sign-ups become a `profiles` row automatically via the
  `on_auth_user_created` trigger (migration 0003).
- Theme and sidebar-collapse are client-only preferences in `localStorage`;
  all domain data lives in Supabase.
- The favicon is theme-aware: `public/logo-light.png` (white background) is
  used in light mode, `public/logo-dark.png` (black background) in dark mode,
  and it follows the OS in "device" mode. Replace those two PNGs to rebrand.
