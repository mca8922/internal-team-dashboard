# reStrucAI Support — client module

Drop-in support desk for a **client fork** of this dashboard (MCA, and every client after).

Adds one thing to the fork: a **Support** entry in the sidebar. From there the client's team
raises requests, follows their status, and closes them out.

Nothing here stores a ticket. Everything is posted to reStrucAI's support API and read back
from it, so the ticket lives in exactly one database — reStrucAI's. There is no sync, no
mirror, and nothing that can drift.

The whole module is deliberately self-contained: it imports React, Next, and nothing from the
host app except wherever you get the signed-in user. That is what makes onboarding client #3
a copy of this folder rather than a re-integration.

---

## Install (about 20 minutes)

### 1. Copy the folder

Copy `client-module/support/` into the fork as `src/support/`.

### 2. Set two environment variables

```
SUPPORT_API_URL=https://restrucai-team.vercel.app
SUPPORT_API_KEY=sk_support_mca_...
```

reStrucAI issues the key with `npm run support:key -- mca`. It is shown once.

**The key must stay server-side.** Do not prefix it with `NEXT_PUBLIC_`. Every call in this
module runs on the server for exactly that reason — a key in the browser is a leaked key.

### 3. Add the styles

Append `support.css` to the fork's `src/app/globals.css`, or import it in the root layout.

(If the fork was taken from a reStrucAI build that already ships the support desk, most of
these rules are in `globals.css` already — you still need the `.sup-*` block at the bottom,
which is module-only.)

### 4. Wire in the current user

`src/support/current-user.ts` is the ONE file you edit per fork. It returns the signed-in
person's name, email and role. The stub reads the `profiles` table, which is right for a
standard fork; change the query if the fork's schema differs — not the shape it returns.

### 5. Add the page

Create `src/app/(app)/support/page.tsx`:

```tsx
import { SupportPage } from '@/support/SupportPage';
import { listMyTickets } from '@/support/support-actions';

export const metadata = { title: 'Support' };

export default async function Page() {
  const tickets = await listMyTickets();
  return <SupportPage tickets={tickets} />;
}
```

That is the whole route. `SupportPage` renders its own header, the "Report an issue" button,
the ticket list, and both modals.

### 5b. Optional: an assistant beside the ticket desk

`SupportPage` takes one optional prop, `assistant`. Pass nothing and the page is exactly what
is described above — no tabs, no wrapper, no second code path. Pass a node and the page grows
a segmented switch, **Ask the assistant** / **Raise a ticket**, defaulting to the assistant:

```tsx
// The route is a Server Component — this is an element, not a callback.
<SupportPage tickets={tickets} assistant={<AssistantPanel />} />
```

The module stays assistant-agnostic: it never imports one, and knows only that something
renders in that slot. What it hands *down* is `api.raiseTicket(draft?)`, which switches to the
ticket tab and opens the report form pre-filled from an optional `TicketDraft`
(`{ category?, subject?, body? }`). The pane reads it from context:

```tsx
'use client';
import { useSupportAssistant } from '@/support/SupportPage';

export function AssistantPanel() {
  const api = useSupportAssistant();
  // …api.raiseTicket({ subject, body }) when the assistant cannot help
}
```

Context, not a prop on the slot — **this is load-bearing**. The fork's route is a Server
Component, and `assistant={(api) => …}` there fails at runtime with *"Functions cannot be
passed directly to Client Components"*. An element serializes across the boundary; a callback
does not.

Two further rules the module enforces so this cannot go wrong:

- **The draft only seeds the form.** `SupportReportModal` reads it as initial state and never
  syncs to it afterwards — a late prop change must not overwrite words someone is typing. The
  person still reviews and sends it themselves; nothing here submits on their behalf.
- **The assistant pane is hidden, never unmounted, on a tab switch.** A widget that mounts into
  a real DOM node would be destroyed by an unmount, losing the conversation mid-flow.

Keep the pane itself *outside* this folder — see this fork's
`src/app/(app)/support/AssistantPanel.tsx` for the reference implementation.

### 6. Add the sidebar entry

In the fork's `src/components/Shell.tsx`, inside `buildNavGroups`, add Support to the tools
group (next to Apps and Settings):

```ts
const toolsItems: NavItem[] = [
  { label: 'Apps',     icon: 'monitor',     path: '/apps' },
  { label: 'Support',  icon: 'help-circle', path: '/support' },
  { label: 'Settings', icon: 'settings',    path: '/settings' },
];
```

If the fork's `NavItem` icon union does not list `'help-circle'`, add it there too.

**Give it to read-only accounts as well.** Someone locked out of their own record is exactly
who needs to be able to reach support:

```ts
const toolsItems: NavItem[] = isReadOnly
  ? [{ label: 'Support', icon: 'help-circle', path: '/support' }]
  : [ /* the three above */ ];
```

### 7. Test it

Open **Support** in the sidebar and raise a ticket. It should appear in reStrucAI's `/support`
console within a second or two, and the reporter should get an acknowledgement email with a
ticket reference.

---

## What the client sees

```
┌── Support ──────────────────────── [ Report an issue ] ─┐
│  Raise anything with the reStrucAI team.                │
│  We reply within 24 working hours.                      │
│                                                         │
│  MCA-1043  Attendance shows absent but I was present    │
│            Updated 20 minutes ago        ● In progress  │
│  ─────────────────────────────────────────────────────  │
│  MCA-1021  Can't download my salary slip                │
│            Updated 8 days ago              ● Resolved   │
└─────────────────────────────────────────────────────────┘
```

Clicking a row opens what they asked, the history of how it moved, and a **Mark as resolved**
button.

**There is no reply box.** A ticket is a record of state; the conversation happens over email,
because two places to look is how a reply gets missed.

---

## What gets sent

Every ticket carries the reporter's name, email and role, plus the page they were on and their
browser string. The report form says so, in plain words, above the submit button. Do not
remove that line — silent collection is the difference between context capture and
surveillance.

---

## Files

| File | Runs | What it is |
|---|---|---|
| `SupportPage.tsx` | client | The whole page. This is what the route renders |
| `SupportReportModal.tsx` | client | The report form |
| `AboutRestrucAI.tsx` | client | "About reStrucAI" trigger + modal. CSS wordmark, website, founder |
| `support-actions.ts` | server | Server Actions the UI calls |
| `support-api.ts` | server | The HTTP calls to reStrucAI. The only file that knows the key exists |
| `support-config.ts` | server | Reads the two env vars, returns null if unset |
| `current-user.ts` | server | **Edit this per fork.** Who is signed in |
| `support-mirror.ts` | server | **Optional, per fork.** No-ops by default; implement for a local copy |
| `support-shared.ts` | both | Labels, statuses, validation. No dependencies |
| `support.css` | — | Styles |

---

## Optional: a local mirror

reStrucAI is the source of truth and that does not change. A fork whose operator
wants their own queryable history of what their people raised can implement
`support-mirror.ts` — three no-op functions that fire after a ticket is raised,
after the list loads, and after a thread is opened.

**Most forks should leave it alone.** A mirror is a second place a ticket
exists, and a second place is a place that can drift. Take it only when someone
has asked for that trade deliberately, and keep the implementations idempotent
and non-throwing — the contract is in the file's header.
