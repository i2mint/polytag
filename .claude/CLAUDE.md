# polytag — agent guide

**Stage: DATA IN (i2mint/polytag#1): formats, grammars, loss report, detection, import plan and the round-trip gate. Next: #2 (backend menu), #3 (view menu).** Headless CRUD for tag-based (polyhierarchical) collections: the composition tier over zodal and zodal-groups (formats × grammars, backend menu, view menu, one-call facade, playground, shipped agent skill).

## Before anything

1. `docs/research/synthesis.md` — what exists, what is missing, what we build.
2. `docs/decisions/0001-placement-and-seams.md` — what goes here vs zodal-groups vs zodal, and the five v1 seams.
3. The model's decisions are zodal-groups' (`../zodal-groups/docs/research/_reconciliation.md`). Not re-decided here.

## Layout

| Path | What |
|---|---|
| `packages/polytag/subpaths.json` | **SSOT** for subpaths: source entry and tag-aware flag; `tsup.config.ts` and the boundary check read it |
| `packages/polytag/src/index.ts` | root entry, **tag-aware**: grammars, membership modes (embedded / `GroupStore`), the facade (may import `@zodal/groups-*`) |
| `packages/polytag/src/{model,grammars}/`, `src/{loss,grammar,detect,io,import-plan,scope,collection-seed}.ts` | data in (#1): the snapshot model and features; capabilities, `reduce` and value limits; the grammar contract (`defineGrammar`, whose `plan` is the one place a write's losses are decided); the eight v1 grammars; two-stage detection; `readText`/`writeText`/`roundTrip`; import plan; export scope |
| `packages/polytag/src/{formats,backends,views}/` | subpaths `polytag/formats`, `/backends`, `/views`, **tag-agnostic** |
| `packages/polytag/src/internal/` | shared tag-agnostic helpers (a registry keyed by a caller-supplied selector) |
| `packages/polytag/tests/` | vitest; `roundtrip.test.ts` is **the round-trip gate** (every grammar × format × RD/P/K must equal what the loss report predicts), `fuzz.test.ts` its seeded property-test twin, `review.test.ts` the PR #16 review regressions; `exports.test.ts` loads every built subpath under import and require, `types-resolution.test.ts` resolves its types under node10 / node16 / bundler |
| `apps/playground` | private Vite + TS app (vanilla), not published |
| `scripts/check-boundaries.mjs` | boundary check: tag-agnostic sources, built JS and `.d.ts` never reach `@zodal/groups-*` or the root; tests + fixtures beside it |
| `scripts/release-gate.mjs` | CI release decision: a `[publish]` subject since the last `v*` tag + an unpublished version |

Commands: `pnpm install && pnpm build && pnpm typecheck && pnpm test && pnpm check:boundaries`. A new subpath goes in `subpaths.json`, `package.json` `exports` (with `types` for every condition) and `typesVersions`, and `tests/exports.test.ts` `EXPECTED`; the boundary check fails if `subpaths.json` and `exports` disagree. A deliberate non-literal `import()` in tag-agnostic code needs a `boundary-check: allow-dynamic` comment.

## Skills

| Task | Skill |
|---|---|
| "What did we decide / which doc answers X?" | `.claude/skills/polytag-dev-research-lookup/` |
| zodal conventions, adapters, renderers | `../zodal/.claude/skills/` (`zodal-dev`, `zodal-store-adapter`, `zodal-ui-renderer`, `zodal-collection-ui`) |
| The groups model and projections | `../zodal-groups/skills/zodal-groups-dev-model/`, `-dev-projections/`, `-dev-renderer/`, `-dev-store-adapter/` |

Real files live in `skills/`; `.claude/skills/` is a symlink bridge.

## Rules

- polytag may depend on both `@zodal/store` and `@zodal/ui`; nothing upstream may depend on polytag.
- A gap in zodal or zodal-groups is filed upstream, never worked around here.
- Tag-agnostic subpaths never import `@zodal/groups-*`, directly or through `src/index.ts` (CI enforces it).
- `@zodal/*` and `zod` are peers with a caret on the lowest version used (`../zodal/docs/versioning.md`), added by the first change that imports them. Publish only with `pnpm`, only via a `[publish]` commit subject plus a version bump, and only after an owner approves the `npm-publish` environment; commit `pnpm-lock.yaml` with every dependency change.
- Public repo: no private project names, paths or data in code, docs, issues or commits.
