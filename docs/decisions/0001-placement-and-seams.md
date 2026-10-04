# ADR 0001 — Where polytag sits, and its v1 seams

*Status: accepted (research and planning; no code yet) · 2026-10-04 · evidence: [synthesis](../research/synthesis.md)*

## Context

The request: a headless CRUD toolkit for "flat items + structuring metadata" (an item belongs to several groups, via tags, instead of one folder), built on zodal, with a menu of backend adaptors, a menu of UI adaptors, and a playground. The research found that [zodal-groups](https://github.com/i2mint/zodal-groups) already owns the model and its projections, and that the gaps are glue, persistence, data interchange, menus and the playground (synthesis §Summary 2).

Three placements were possible: a new zodal satellite, an extension of zodal-groups, or an add-on package.

The ecosystem's rules decide most of it:

- `@zodal/ui` and `@zodal/store` never depend on each other; a satellite depends on one side or the other, never both.
- Satellites never depend on each other.
- Interfaces live in the core monorepos; implementations live in satellites.
- zodal-groups: `groups-core ← groups-ui ← groups-ui-*`; renderers never import from a store.

## Decision

**Both an extension and one add-on, split by what each piece depends on.**

| Piece | Depends on | Home |
|---|---|---|
| Tagged-collection facade: items `DataProvider` + membership edges kept consistent; create-with-tags, tag/untag, bulk, rename, merge, delete-group vs remove-membership, one undo | `groups-core`, `@zodal/store` types | **zodal-groups**, new package `@zodal/groups-collection` |
| `GroupStore` contract + capability record | `groups-core` | **zodal-groups** `groups-core` (interface) |
| `GroupStore` adapters (memory, browser, fs sidecar manifest, Supabase + RPC, http) | `groups-core` + backend SDK | **zodal-groups** `@zodal/groups-store-*` |
| Tag widgets bound to form/filter configs; selection-level tagging descriptor (tri-state) | `groups-ui` / `@zodal/ui` | zodal-groups `groups-ui*`; zodal `ui-*` for field widgets |
| `ProviderDescriptor` type; collection view generators (zodal#14, #15) | `@zodal/store`; `@zodal/ui` | **zodal** core monorepo |
| Format × grammar codecs, loss report, detection | `groups-core`, parser libraries | **polytag** (extraction candidate for formats: a zodal package once a second consumer exists) |
| Backend menu (aggregated descriptors, lazy `import()`), view menu (`ViewConfig` + computed applicability) | both sides | **polytag** |
| One-call facade `polytag({ data, grammar, backend, view })` | both sides | **polytag** |
| Playground | everything | **polytag** `apps/playground` |
| Agent skill: "add CRUD over this data with this UI" | — | **polytag** `skills/` (shipped) |

polytag is the **composition tier**: the one place allowed to depend on both the storage side and the UI side, the way an app is. It ships as a library because the composition (choose data, grammar, backend, view) is itself what consumers repeat.

## v1 seams

| # | Seam (one keyword argument) | v1 default (no new dependency) | Replacement already pointed at |
|---|---|---|---|
| 1 | `provider`: where item records live | `createInMemoryProvider` from `@zodal/store` | `zodal-store-{http,fs,localstorage,s3,supabase}` (published) |
| 2 | `edges`: where memberships live | `'embedded'`: a `groups` id array on each item record (what `scopeFilter` already assumes; works over every provider) | `GroupStore` adapters (zodal-groups `[TODO]`); the fs sidecar manifest (reconciliation §6.5) |
| 3 | `grammar` (+ `format`): how text becomes items and edges | auto-detect over the v1 registry (json, yaml, toml, csv × nested, tags-array, tag-paths, members-map, edge-rows, delimited, one-hot, node-link) | frontmatter+folder, sidecars, SKOS (formats-and-grammars §8.6) |
| 4 | `view`: a `ViewConfig` | three-pane, rendered with `@zodal/groups-ui-vanilla` + `@zodal/ui-vanilla` | shadcn and Ark renderers (zodal-groups `[TODO]`, zodal-ui-shadcn) |
| 5 | `profile`: which constraints apply | inferred from the parsed data (flat → `flatTags`, one parent → `filesystem`, …), overridable | any zodal-groups profile, with overrides |

```
Surface for v1: TS library + static playground + shipped agent skill (CLI, MCP, HTTP: questions answered, not built — the playground is the demo surface; the Python sibling is an idea, not a seam)
NOT seams:      playground layout and styling, sample datasets, loss-report wording, detection thresholds, the per-profile UI vocabulary (a plain map, written directly)
```

## Consequences

- polytag v1 cannot start its facade before `@zodal/groups-collection` exists; the codecs, the menus' types and the playground shell can start in parallel.
- The format codecs carry a `// extraction candidate: zodal-dials TOML/YAML stores` note.
- Every upstream gap polytag needs is filed in the upstream repo, not worked around in polytag.
- Rejected: putting everything in zodal-groups (it would make that monorepo depend on both storage and UI sides and on parser libraries, against its own dependency rule); a new `zodal-store-*` or `zodal-ui-*` satellite (the work is neither one backend nor one UI library).
