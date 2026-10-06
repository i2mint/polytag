/**
 * `polytag` — headless CRUD for tag-based collections.
 *
 * The root entry is the tag-aware tier: grammars (how decoded text becomes items and
 * memberships, i2mint/polytag#1) and the one-call facade (i2mint/polytag#4), which may
 * depend on zodal-groups. The tag-agnostic parts are the subpaths `polytag/formats`,
 * `polytag/backends` and `polytag/views`.
 *
 * Scaffold only: nothing tag-aware exists yet, so this entry exports nothing. It must
 * not re-export the subpaths' shared modules either: tsup would then hoist their types
 * into `index.d.ts` and make every subpath's declarations import the tag-aware root,
 * which `scripts/check-boundaries.mjs` rejects.
 */

export {};
