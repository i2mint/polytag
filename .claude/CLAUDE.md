# polytag — agent guide

**Stage: RESEARCH AND PLANNING DONE, NO CODE.** Headless CRUD for tag-based (polyhierarchical) collections: the composition tier over zodal and zodal-groups (formats × grammars, backend menu, view menu, one-call facade, playground, shipped agent skill).

## Before anything

1. `docs/research/synthesis.md` — what exists, what is missing, what we build.
2. `docs/decisions/0001-placement-and-seams.md` — what goes here vs zodal-groups vs zodal, and the five v1 seams.
3. The model's decisions are zodal-groups' (`../zodal-groups/docs/research/_reconciliation.md`). Not re-decided here.

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
- Public repo: no private project names, paths or data in code, docs, issues or commits.
