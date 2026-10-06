# polytag — agent guide

**Stage: SCAFFOLD (i2mint/polytag#12): build, tests and CI in place; no real API yet. Next: #1 (formats × grammars).** Headless CRUD for tag-based (polyhierarchical) collections: the composition tier over zodal and zodal-groups (formats × grammars, backend menu, view menu, one-call facade, playground, shipped agent skill).

## Before anything

1. `docs/research/synthesis.md` — what exists, what is missing, what we build.
2. `docs/decisions/0001-placement-and-seams.md` — what goes here vs zodal-groups vs zodal, and the five v1 seams.
3. The model's decisions are zodal-groups' (`../zodal-groups/docs/research/_reconciliation.md`). Not re-decided here.

## Layout

| Path | What |
|---|---|
| `packages/polytag/src/index.ts` | root entry, **tag-aware**: grammars, the facade (may import `@zodal/groups-*`) |
| `packages/polytag/src/{formats,backends,views}/` | subpaths `polytag/formats`, `/backends`, `/views`, **tag-agnostic** |
| `packages/polytag/src/internal/` | shared tag-agnostic helpers (the id-keyed registry) |
| `packages/polytag/tests/` | vitest; `exports.test.ts` checks the built exports map under import and require |
| `apps/playground` | private Vite + TS app (vanilla), not published |
| `scripts/check-boundaries.mjs` | esbuild-metafile check that tag-agnostic subpaths never reach `@zodal/groups-*`; tests + fixtures beside it |

Commands: `pnpm install && pnpm build && pnpm typecheck && pnpm test && pnpm check:boundaries`. A new subpath export goes in `package.json` `exports`, `tsup.config.ts` `entry`, `tests/exports.test.ts` `EXPECTED`, and `TAG_AWARE`/`TAG_AGNOSTIC` in the boundary script.

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
- `@zodal/*` and `zod` are peers with a caret on the lowest version used (`../zodal/docs/versioning.md`), added by the first change that imports them. Publish only with `pnpm`, only via a `[publish]` commit subject; commit `pnpm-lock.yaml` with every dependency change.
- Public repo: no private project names, paths or data in code, docs, issues or commits.
