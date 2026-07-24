## Project phases

`PHASE.md` is the source of truth for what's currently in scope for this
project. Check it before adding a new feature or touching nav/dashboard
surface area, and update it (mark items done, add new phases) whenever
scope changes.

Feature visibility is controlled centrally via `FEATURE_FLAGS` in
`src/lib/featureFlags.ts` — most non-core features are gated off, not
deleted. Re-enabling a feature is a one-line flip of its flag; see
`PHASE.md` for what each flag hides and where.
