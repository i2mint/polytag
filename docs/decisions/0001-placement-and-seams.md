# ADR 0001 — Where polytag sits, and its v1 seams

*Status: accepted (research and planning; no code yet) · 2026-10-04, revised the same day (see §Revision 1) · evidence: [synthesis](../research/synthesis.md)*

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
| Tagged-collection facade: items `DataProvider` + one or more group spaces kept consistent; create-with-tags, tag/untag, bulk, rename, merge, delete-group vs remove-membership; every operation returns its inverse | `groups-core`, `@zodal/store` types | **zodal-groups**, new package `@zodal/groups-collection` |
| Commands for the tagging operations ([acture](https://github.com/thorwhalen/acture) `CommandRecord` shape; the result carries the inverse), alongside the declarative `OperationDefinition[]` with the same ids | `groups-core`, `@zodal/store` types; no acture dependency | **zodal-groups** `@zodal/groups-collection` |
| Undo history | the app's state layer | **the app** (acture-undo, or its hand-written equivalent); no library in this plan keeps a history stack |
| Profile inference: `inferProfile(space) → {profile, violations, evidence}` | `groups-core` | **zodal-groups** (its design rationale §6.3.6 lists it as a future direction) |
| `GroupStore` contract + capability record | `groups-core` | **zodal-groups** `groups-core` (interface) |
| `GroupStore` adapters (memory, browser, fs sidecar manifest, Supabase + RPC, http) | `groups-core` + backend SDK | **zodal-groups** `@zodal/groups-store-*` |
| Tag widgets bound to form/filter configs; selection-level tagging descriptor (tri-state) | `groups-ui` / `@zodal/ui` | zodal-groups `groups-ui*`; zodal `ui-*` for field widgets |
| `ProviderDescriptor` type; collection view generators (zodal#14, #15) | `@zodal/store`; `@zodal/ui` | **zodal** core monorepo |
| Format × grammar codecs, loss report, detection | `@zodal/core` `Codec`, `groups-core`, parser libraries | **polytag**: formats in the tag-agnostic subpath `polytag/formats` (extraction candidate; second consumer: zodal-dials' planned TOML/YAML stores), grammars in the root |
| Backend menu (aggregated descriptors incl. metadata × content compositions, lazy `import()`), view menu (`ViewConfig` lens + saved views + ranked applicability) | both sides | **polytag**, in tag-agnostic subpaths `polytag/backends`, `polytag/views` (extraction candidates for zodal) |
| One-call facade `polytag({ data, grammar, backend, view })` | both sides | **polytag** |
| Playground | everything | **polytag** `apps/playground` |
| Agent skill: "add CRUD over this data with this UI" | — | **polytag** `skills/` (shipped) |

polytag is the **composition tier**: the one place allowed to depend on both the storage side and the UI side, the way an app is. It ships as a library because the composition (choose data, grammar, backend, view) is itself what consumers repeat.

## v1 seams

| # | Seam (one keyword argument) | v1 default (no new dependency) | Replacement already pointed at |
|---|---|---|---|
| 1 | `provider`: where item records live | `createInMemoryProvider` from `@zodal/store` | `zodal-store-{http,fs,localstorage,s3,supabase}` (published), and metadata × content compositions via `createBifurcatedProvider` (in `@zodal/store` 0.2) |
| 2 | `spaces`: one or more named group spaces over the same items, each with its own `edges` | one space, `edges: {embedded: 'groups'}` (a `groups` id array on each item record: what `scopeFilter` already assumes; works over every provider) | several spaces (the Zotero acid test, zgroups_05 §8.3); a space's `edges` may be a `GroupStore` (zodal-groups `[TODO]`; the fs sidecar manifest, reconciliation §6.5) |
| 3 | `grammar` (+ `format`): how text becomes items and edges | auto-detect over the v1 registry (json, yaml, toml, csv × nested, tags-array, tag-paths, members-map, edge-rows, delimited, one-hot, node-link) | frontmatter+folder, sidecars, SKOS (formats-and-grammars §8.6) |
| 4 | `view`: a `ViewConfig` | three-pane, rendered with `@zodal/groups-ui-vanilla` + `@zodal/ui-vanilla` | shadcn and Ark renderers (zodal-groups `[TODO]`, zodal-ui-shadcn) |
| 5 | `profile` per space | `inferProfile` from zodal-groups (the tightest profile the parsed edges satisfy), overridable | any zodal-groups profile, with overrides |

```
Surface for v1: TS library + static playground + shipped agent skill (CLI, MCP, HTTP: questions answered, not built — the playground is the demo surface; the Python sibling is an idea, not a seam)
NOT seams:      playground layout and styling, sample datasets, loss-report wording, detection thresholds, the per-profile UI vocabulary (a plain map, written directly)
```

## Consequences

- polytag v1 cannot start its facade before `@zodal/groups-collection` exists; the codecs, the menus' types and the playground shell can start in parallel.
- The format codecs carry a `// extraction candidate: zodal-dials TOML/YAML stores` note.
- Every upstream gap polytag needs is filed in the upstream repo, not worked around in polytag.
- polytag's tag-agnostic parts ship as subpaths (`polytag/formats`, `polytag/backends`, `polytag/views`). A metafile check in CI fails if any of them imports `@zodal/groups-*` (the pattern of [comparanda](https://github.com/thorwhalen/comparanda) ADR-0005). The first consumer without tags (e.g. the instruments view of zodal#14) triggers their extraction into zodal.
- Backends are compositions: the catalog describes a metadata × content pair (`createBifurcatedProvider`) as well as single providers.
- Operations are declared once, as acture-shaped commands (the fleet's frontend invariant: user actions are commands declared once). polytag keeps no command list and no undo stack of its own.
- Rejected: a generic `@zodal/compose` package now. Nothing would exercise it yet; the subpath boundary keeps the later split mechanical, and the first untagged consumer is the trigger.
- Rejected: putting everything in zodal-groups (it would make that monorepo depend on both storage and UI sides and on parser libraries, against its own dependency rule); a new `zodal-store-*` or `zodal-ui-*` satellite (the work is neither one backend nor one UI library).

## Revision 1 (2026-10-04, same day)

Until a few hours after this ADR was written, the fleet's search index could not see any repo in the zodal workspace, so most of the ecosystem's own research had not been searched. A review of it (maintainers' working notes, 18 findings) changed the following, all reflected above:

1. **Operations and undo were already decided fleet-wide.** User actions are commands declared once ([acture](https://github.com/thorwhalen/acture)'s `CommandRecord`; every surface and undo are projections of that registry). polytag therefore defines no `CommandSet`/`UndoStack`, `OperationDefinition` stays declarative, and zodal-groups' facade returns inverses instead of keeping a history.
2. **Partial failure:** within one item, the record write and its edge delta succeed together or are compensated; a bulk operation keeps what succeeded and reports what failed (acture's transaction rule; Dexie `BulkError`).
3. **Several group spaces per collection** (zgroups_05 §8.3, the Zotero acid test): seam 2 is `spaces`, not one `edges`.
4. **Backends are compositions:** three of four acceptance cases are metadata + content (zodal's bifurcation).
5. **Profile inference belongs to zodal-groups.**
6. **Tag-agnostic parts are subpaths with an enforced boundary**, so they can move to zodal when an untagged consumer appears.
7. **Views:** the `ViewConfig` is a lens (layout switches keep selection and filters, as zodal-graphs decided); a saved view is a named snapshot with its own filter and sort and no autosave (comparanda ADR-0006/0007). See issue #3.
