# polytag — research synthesis

*2026-10-04 · scope: in-house inventory, terminology, prior art, UI patterns, data formats and grammars, zodal capability inventory · requested for: the placement, seams and plan of a headless CRUD toolkit for tag-based (polyhierarchical) collections, with a playground.*

## Summary and recommendation

1. **The model already exists.** [zodal-groups](https://github.com/i2mint/zodal-groups) implements "membership is the canonical data, every tree, tag cloud and facet panel is a projection" (24 decisions, D1–D24, in its reconciliation [1]): reified membership edges, constraint profiles (`filesystem`, `flatTags`, `labels`, `polyhierarchy`, `thesaurus`…), `PathNode[]` projections, headless UI descriptors, vanilla renderers. polytag does not re-decide any of it.
2. **What is missing is everything between that model and a working CRUD screen** [2]: (a) no glue between a zodal *collection* of item records and a zodal-groups membership graph (create-with-tags, bulk tag, rename and merge tags, delete-group vs remove-membership, one undo across both); (b) no edge persistence (`GroupStore` exists only as a sketch); (c) no way to read tagged data from json/yaml/toml/csv; (d) no menu of backends or of views, only per-package factories and field-level renderer registries; (e) no playground (`zodal/apps/demo` is an empty folder).
3. **Placement (ADR [0001](../decisions/0001-placement-and-seams.md)):** the library pieces that are pure and flat+structure-specific go into zodal-groups (`@zodal/groups-collection`, the `GroupStore` contract and its adapters); the composition layer that must touch both the storage side and the UI side, and that ecosystem rules therefore keep out of every satellite, is the new package **polytag**: format × grammar codecs with a loss report, the backend menu, the view menu, the one-call facade, the playground, and the agent skill that turns "add CRUD over this data with this UI" into a configuration.
4. **Name the approach "tag-based organisation" in prose and "polyhierarchy" for the structure** [3]. No established term names "flat items plus structuring metadata" as a whole. Keep zodal-groups' nouns (item, group, edge, membership, kind, profile, projection); verbs `add`, `remove`, `move`, `delete`, with per-profile UI wording ("file in", "tag", "label").
5. **Default to a folder-like view.** The empirical literature mostly disconfirms "tags beat folders" as a user-behaviour claim (Bergman et al. 2013: strong preference for folders; multiple classification used for storage, rarely for retrieval) [3 §4]. So the default view shows a primary location and reveals "also in N groups" on demand, which is what zodal-groups already says (D12, `otherLocations`).
6. **A view is data.** Every mature database-style product stores a view as `{type, filter, sort, group, config}` [4 §0]. polytag's UI menu is a Zod-typed `ViewConfig` (shell, navigator, layout, inspector, interaction) whose applicability is computed by testers, so choosing a UI is editing a config, and the menu greys out what the schema cannot support, with the reason.
7. **A format is not a grammar.** The same "items with a tags array" layout exists in JSON, YAML, TOML, CSV and frontmatter; the playground needs a format registry, a grammar registry, a compatibility matrix, and a loss report computed before writing. Only edge rows plus a nodes table, node-link JSON, and SKOS with reified membership are lossless for a polyhierarchy [5 §4].
8. **Nobody ships the combination** (multi-group membership, hierarchy declared apart from assignments, an adaptor menu, a renderer menu, a playground) [6 §0]. Wrap TanStack DB, TinyBase, Dexie and PGlite later as backends; study the Notion Views API, Obsidian Bases, Hydrus and Are.na; avoid AGPL/BUSL code.

## 1. What already exists (in-house)

| Component | What it gives polytag | Status |
|---|---|---|
| [zodal](https://github.com/i2mint/zodal) `@zodal/core` / `store` / `ui` 0.2.0 | Zod schema → affordances; `DataProvider<T>` with honest `getCapabilities()`; `filterToFunction` incl. `arrayContainsAny`; field-level generators (`toColumnDefs`, `toFormConfig`, `toFilterConfig`); tester + `PRIORITY` renderer registry; `CollectionAffordances.views` declared but unused ([zodal#14](https://github.com/i2mint/zodal/issues/14), [zodal#15](https://github.com/i2mint/zodal/issues/15)) | published |
| `zodal-store-*` (in-memory, fs, localStorage, http, S3, Supabase) | the backend menu's entries; DI of clients; no registry; no IndexedDB metadata provider | published, peer-range hygiene needed [2 §1] |
| `zodal-ui-vanilla`, `zodal-ui-shadcn` | field renderers (cell/form/filter/content); no tag chips, no view-level renderers; shadcn is plain HTML for now | published |
| [zodal-groups](https://github.com/i2mint/zodal-groups) `groups-core` / `groups-ui` / `groups-ui-vanilla` 0.1.0 | the model and its projections; `scopeFilter()` (the only bridge to collections); tree, Miller columns, breadcrumbs, facets, tag input renderers; drag intent with ADD as default | published; store adapters and shadcn/Ark renderers TODO |
| [zodal-dials](https://github.com/i2mint/zodal-dials) | proof that "facets canonical, tree a projection" works; a renderer registry that specialises `@zodal/ui` (the reuse-correct precedent); format-preserving JSONC store; the codec research polytag's grammars build on | published |
| [zodal-graphs](https://github.com/i2mint/zodal-graphs) | the most mature *view menu* in the ecosystem (`availableViews`, capability-ranked selection with a degrade report): the pattern to copy for collection views | not yet on npm |

The ecosystem has three registry dialects (`@zodal/ui`, `groups-ui`, `graph-ui`); polytag uses `@zodal/ui`'s, as `zodal-dials` does [2 §3.5].

## 2. Terminology

Full glossary and history: [3]. Decisions for polytag's API and docs:

- **Tagline:** "Folders that overlap and tags that nest." Umbrella term *tag-based organisation*; precise term *polyhierarchy*; lineage *semantic file system*; *faceted* names the browsing style, not the model.
- **Nouns:** item, group, membership (edge of kind `contains`), kind, profile, facet (an axis), property (descriptive value), smart group, unfiled, projection, view. Avoid `collection` for a group (it is zodal's CRUD collection) and `label` as a type name (three incompatible meanings).
- **Collisions to raise with zodal-groups:** the `taxonomy` profile name misleads WordPress/Drupal users; there is no profile for *valued* tags (key-value facets such as `status: draft`); profiles have only global cardinalities, but a board over a tag family needs a per-family "exclusive" flag [4 §0.6].

## 3. Prior art, in one table

| Family | Verdict for polytag | What to take [6] |
|---|---|---|
| Headless CRUD frameworks (react-admin, Refine, TanStack, JSON Forms) | study | data-provider contract, renderer testers (JSON Forms), FakeRest-style in-browser backend for the playground |
| Local-first stores (TanStack DB, TinyBase, Dexie, PGlite, RxDB) | wrap, later | first non-zodal backends; TinyBase's subpath-per-adaptor packaging; a published conformance suite with badges |
| Tag file managers and DAM (TagSpaces, TMSU, Hydrus, digiKam, Lightroom, paperless-ngx, Calibre, Zotero) | study (formats from docs only; several are AGPL/GPL) | sidecar formats (TagSpaces `.ts` JSON, XMP `dc:subject` + `lr:hierarchicalSubject`); Hydrus tag *siblings* (aliases) and *parents* (implications) declared apart from assignments |
| Faceted browsers and database views (Exhibit, Flamenco, Datasette, Airtable, Notion, Baserow) | study | the Notion Views API as the `ViewConfig` skeleton; Hearst's facet rules (counts on every link, no zero-result clicks, AND across, OR within) |
| PKM (Obsidian incl. Bases, Logseq, Tana, Anytype, Are.na, Bear) | study | Markdown + frontmatter `tags` as a grammar; Are.na's "block appears in these channels" (= `otherLocations`) |

Top traps [6 §7]: multi-valued group-by is undefined in every product surveyed (no board puts a card in two columns), so a board needs an explicit `multiValue` policy; single-parent assumptions and node-level ordering; licence and viability (AGPL, BUSL, shutdowns, pre-1.0 engines); one CRUD contract forced on engines that do not fit; path-as-identity breaking on rename.

## 4. The three menus

### 4.1 Data in: formats × grammars [5]

`Container (text | file | dir | zip) → Bundle → FormatCodec → GrammarCodec → GroupSpace (+ item records)`, and back, with a `LossReport` computed *before* serialising (`featuresOf(space)` minus `grammar.capabilities`).

- **v1 formats:** json, yaml (`yaml`, ISC), toml (`smol-toml`, BSD-3), csv (`papaparse`, MIT), jsonc detection (`jsonc-parser`). All lazy-loaded; no `gray-matter`.
- **v1 grammars:** nested tree, tags array, tag paths (`a/b/c`), members map, edge rows (+ nodes table), delimited cell, one-hot, node-link. v1.1: frontmatter + folder, filesystem listing, OPML/GraphML. v2: SKOS/JSON-LD, sidecars (XMP, TagSpaces, Hydrus), comment-preserving writes.
- **Defaults:** import = what people already have (nested, tags column, frontmatter); export = the lossless grammar for the dataset's profile, always showing its loss report.

### 4.2 Backends

A `ProviderDescriptor` (name, options Zod schema, runtime `browser|node|any`, capability summary, lazy factory) declared as a *type* in `@zodal/store` and exported by each `zodal-store-*` for its own adapter; polytag aggregates them with dynamic `import()` so no satellite depends on another [2 §6.1 M1]. Memberships live either **embedded** (a `groups: NodeId[]` field on each item record, which works over every existing provider today and is what `scopeFilter` already assumes) or in a **`GroupStore`** (edge table, sidecar manifest, RPC closure) for profiles that need group-to-group edges, edge order or labels at scale.

### 4.3 Views [4]

A `ViewConfig` with slots: `shell` (single / two-pane / three-pane), `navigator` (the existing groups-ui surfaces: tree, Miller columns, facets, tag cloud), `layout` (table, list, cards, board, calendar, timeline, triage), `inspector`, plus `interaction` (`tagCommit`, `dragDefault: 'add'`, selection across filter). The menu is computed: each layout has a tester (board needs an exclusive family or an explicit `multiValue`; calendar needs a date role). Ranked default menu: three-pane; two-pane file manager; gallery with chips; faceted browse; triage of untagged; board by family; Miller columns as navigator; calendar/timeline. Every view honours the 12-point contract of [4 §4.2] (memberships shown, tri-state bulk tagging, keyboard-only tag edit, remove ≠ delete, undo, violations as messages, every gesture also a command, config round-trips through a URL).

## 5. Acceptance cases

Four planned consumers, chosen because they span the profiles and the backends. Each becomes an acceptance issue: the data as it exists today, the grammar that reads it, the backend, the view, the operations that must work.

| Case | Data today | Profile | Backend | Default view |
|---|---|---|---|---|
| [annals](https://github.com/thorwhalen/annals): agent-written documents for review | flat `docs/<id>/meta.json` with `tags`; groups as ordered id lists; a bin folder; plain files, rsync-written, no index | `labels` | http over the app's own endpoint (reads the files the agents write; no index as a second source of truth) | three-pane, triage of untagged |
| [citeget](https://github.com/thorwhalen/citeget): acquired references | per-run folders of PDFs plus markdown indexes; no tags; a reference cited by two reports is downloaded twice | `polyhierarchy` (topics) | fs (Node) with sidecar metadata | faceted browse |
| A media studio's asset library (private consumer) | flat, content-addressed artifacts; no organise operations at all | `flatTags` → `labels` | http | gallery with chips |
| A file-browser app (private consumer) | real per-user folders; list/stat/download/mkdir only | `filesystem`, then `labels` | http over a sandboxed file store | two-pane file manager + Miller columns |

## 6. Open questions

- Where the format codecs ultimately live. They are generic (any zodal collection could import CSV), and zodal-dials plans TOML/YAML stores, so they are an extraction candidate for a `zodal` package once a second consumer exists. v1 keeps them in polytag behind the registry seam.
- Whether operation handlers belong in `@zodal/core`. `OperationDefinition` has no executor today; polytag needs tagging operations bound to the facade. Proposed upstream as an optional `handler`, not decided.
- A Python sibling (the PyPI name is free): three of the four acceptance cases have Python servers over plain files. A server-side membership store over files and sidecars that speaks `zodal-store-http`'s contract would serve them all. Not v1; tracked as an idea.
- Tombstones: `EdgeDelta` never removes nodes, so undoing a tag delete or merge needs a tombstone (raise in zodal-groups).

## REFERENCES

1. [zodal-groups — Reconciliation: the merged decisions D1–D24](https://github.com/i2mint/zodal-groups/blob/main/docs/research/_reconciliation.md), and its five research reports in the same folder.
2. zodal ecosystem capability inventory, read from source on 2026-10-04 (maintainers' working notes; the facts used here are restated in this document and in the issues that cite them).
3. [Terminology — tag-based organisation, polyhierarchy, and the API vocabulary](terminology.md).
4. [UI patterns for CRUD over tagged collections, and the affordance/rendering split](ui-patterns.md).
5. [Data formats and grammars for flat + structure data](formats-and-grammars.md).
6. [Prior art — libraries and products](prior-art.md).
