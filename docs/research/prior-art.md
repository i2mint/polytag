# Prior art for a headless "flat + structuring metadata" CRUD toolkit

Research report 04, 2026-10-04. Scope: libraries and products only (family 1 JS/TS CRUD and local-first stores, family 2 tag-based file managers and DAM, family 3 faceted browsers and database-view UIs, family 4 personal-knowledge-management tools). Everything the zodal ecosystem has already judged is cited, not redone.

## 0. Summary

**Main finding.** Nobody ships the combination we want. Each ingredient exists somewhere, but in different products: a provider-and-renderer seam (react-admin, Refine, TanStack DB, JSON Forms), a native multi-group membership primitive (TinyBase multi-slice indexes, Dexie `multiEntry`, Are.na connections, Hydrus parent DAG), a documented view-config schema (Notion Views API, Obsidian Bases), and a text-is-truth sidecar format (TagSpaces, Markdown frontmatter, Calibre OPF). No surveyed tool has all of: (a) item-in-many-groups as a first-class concept, (b) polyhierarchy declared separately from assignments, (c) a published menu of storage adaptors, (d) a menu of UI renderers, (e) a browser playground. The closest single products fail on one axis each: Hydrus has the best model but is a Python desktop app; Logseq's database version has multi-parent `Extends` but is AGPL, ClojureScript and beta; TanStack DB has the best seam but no tag semantics and is 0.x.

**Depend / wrap / study / avoid, in one line each.**

- Depend (runtime, optional): none from these four families is a must-have. Zod stays the substrate. Candidates for optional runtime deps are the ones already chosen in the zgroups landscape report [1].
- Wrap (write a zodal adaptor or interop shim): TinyBase, Dexie, PGlite, RxDB, TanStack DB (both directions), Meilisearch/Typesense (via the InstantSearch layer already studied), Markdown+frontmatter vaults, TagSpaces `.ts` sidecars, XMP keyword triad, Are.na via its MIT SDK, JSON Forms as one more renderer set.
- Study (steal ideas, never code): Notion Views API, Obsidian Bases, Hydrus, Zotero, paperless-ngx, Calibre, Logseq DB, Tana, Capacities, Anytype, Flamenco, Datasette, Exhibit.
- Avoid as a dependency: Triplit (AGPL, dormant), InstantDB (cloud sunsets 2027-08-31), Directus server (source-available MSCL), NocoDB (Sustainable Use License), Formily (dormant), Puck (not a CRUD seam), every closed SaaS.

**How to read the evidence labels.** Every claim carries a numbered source. UNVERIFIED means a primary source could not be read or did not state the point. ESTIMATE marks my own inference. Weekly npm downloads cover 2026-09-25 to 2026-10-01; stars, licences and push dates were read from the GitHub API and the npm registry on 2026-10-04.

### 0.1 What zodal already studied (cited, not repeated)

- react-admin versus Refine DataProvider shapes, JSON Forms tester registry, uniforms bridges, AutoForm, TanStack Table `meta`, Payload and Directus as "honorable mentions", Dexie/localForage/Supabase storage adaptors, Zustand/Jotai, and the stated gap (no tool unifies shape, field affordances, collection operations and backend capabilities) are in [2] and [3].
- UI widget libraries for trees, drag and drop, virtualisation, Miller columns, breadcrumbs, tag inputs, tree selects, hierarchical facets (InstantSearch stack, itemsjs, Orama, MiniSearch, Lunr), treemaps, graph layout, closure algorithms, and the npm polyhierarchy inventory (`dag-browser-widget` GPL, `tag-hierarchy` MIT, `jskos-tools`, `sanity-plugin-taxonomy-manager`, Drupal's per-node weight lesson) are in [1].
- The constraint-profile prior art (OWL 2 profiles, SHACL `maxCount`, Z39.19 ladder) and the constraint vocabulary (`maxParentsPerItem`, `groupsAreItems`, `edgeKinds`, projection parameters) are in [4] section 7. Several findings below confirm or sharpen that vocabulary and are flagged "confirms zgroups_01".

## 1. Family 1: JS/TS headless CRUD, admin, forms, and local-first stores

### 1.1 Frameworks (react-admin, Refine, TanStack, Payload, Directus, form libraries)

#### react-admin (marmelab): verdict **study**, keep as a compatibility target

- MIT. 5.15.4 on 2026-09-25, about 26.9k stars, `react-admin` 212,731 and `ra-core` 293,386 downloads/week [5, 6].
- Headless since v5 via `ra-core` ("does not include any UI components") [7]; official shadcn kit `shadcn-admin-kit` exists but is small (1,119 stars, 245 downloads/week) [8].
- Adaptor menu: the strongest in this family. The docs list 70+ providers, about 10 official and 60+ community, in one hand-curated alphabetical page; discovery is the `ra-data-*` naming convention, and there is no machine-readable registry [9]. An npm keyword search returned 374 hits, ESTIMATE that most are unmaintained [10].
- Playground: no embedded sandbox, but live demos (e-commerce, CRM with tags, helpdesk) run on an in-browser FakeRest provider, so no server is needed; plus a StackBlitz of the simple example [11].
- Multi-group: `ReferenceArrayInput` stores an array of foreign ids on the record and offers autocomplete, select, checkbox-group, dual-list and table inputs [12]. The junction-table editor `ReferenceManyToManyInput` is Enterprise-only [13]. The reference CRM stores tags as `contacts.tags bigint[]` plus a `tags(id, name, color)` table [14]. Tree/taxonomy is the paid `ra-tree` (details UNVERIFIED).

#### Refine: verdict **study**

- MIT. `@refinedev/core` 5.0.12 on 2026-04-02 (about six months without a core release at fetch time), 35.7k stars, 264,836 downloads/week [15, 16]. The unscoped npm name `refine` is an unrelated 2012 stub.
- Headless hooks and providers with antd, MUI, Chakra, Mantine UIs. Built-in data providers: Simple REST, GraphQL, NestJS CRUD/Query, Airtable, Strapi, Supabase, Hasura, Appwrite, Medusa, plus 15+ community; pick by `npm install` or the CLI project creator [17]. Adaptor maintenance is uneven (`@refinedev/simple-rest` last published 2025-10-23) [15].
- Playground: CodeSandbox links per UI integration and a template gallery [17]. No in-browser builder verified.
- Multi-group: reads only (`useMany` to `getMany`, falling back to N `getOne`); no first-class many-to-many or tag construct found [18]. The `meta` bag as provider-specific escape hatch is worth copying.

#### TanStack Query, Table, DB: Table and Query **wrap-friendly**, DB **study closely and wrap both ways**

- Query 5.104.1 (80.9M downloads/week) and Table 9.2.5 (26.0M/week) are MIT and headless; neither is a CRUD contract [19, 20].
- `@tanstack/db` 0.11.3 (pre-1.0), MIT, 3,925 stars, 1,371,199 downloads/week [21]. It standardises our seam: a "collection options creator" returns a config with `getKey`, `sync`, `onInsert/onUpdate/onDelete` and an optional Standard Schema `schema` [22, 23].
- Adaptor menu (first-party only): query (REST), Electric, PowerSync, RxDB, TrailBase, localStorage, in-memory, plus a SQLite persistence family for browser, node, expo, electron, capacitor; community adaptors exist for Dexie and Supabase [22, 24].
- Multi-group: no tag primitive. Many-to-many is a junction collection plus two equality joins in a live query; "includes" returns nested child collections; `groupBy` aggregates [25].
- Playground: none verified; examples live in the repo.
- Why it matters: a `zodalCollectionOptions(provider)` creator would turn any zodal DataProvider into a TanStack DB collection and unlock Electric, PowerSync and RxDB sync without writing each adaptor (ESTIMATE 2-3 days; the reverse bridge about 2 days).

#### Payload CMS: verdict **study**, avoid as a dependency

- MIT, 3.90.2 on 2026-09-23, 45k stars, 1.09M downloads/week [26]. Headless API but the admin UI is bundled Next/React, not a swappable renderer registry.
- Two adaptor families in the monorepo: database (Mongo, Postgres, SQLite, Vercel Postgres, D1; "a thin layer") and storage (S3, GCS, Azure, R2, Vercel Blob) [27]. No live demo URL could be verified (the public-demo repo was archived 2026-02-04).
- Multi-group: `relationship` with `hasMany` stores an array of ids, a `join` field gives the reverse side [28, 29]. `plugin-nested-docs` adds one `parent` field plus breadcrumbs, a single-parent tree, not polyhierarchy [30]. No tag/taxonomy plugin found; categories are by convention.

#### Directus and `@directus/sdk`: verdict **avoid** the server, optional adaptor over the MIT SDK

- The SDK is MIT (26.0.0, 175,644/week). The server moved to the Monospace Sustainable Core License, source-available, converting to GPL after four years and barring "Competing Use"; GitHub reports it as NOASSERTION [31].
- Many-to-many is an explicit junction collection; many-to-any (M2A) uses a junction with item id plus collection name [32]. SDK is composable (`createDirectus().with(rest())`) [33]. Saved views are "presets" scoped per user and role (see 3.5) [34].

#### Form generators: AutoForm, uniforms, JSON Forms, Formily, Puck

- **AutoForm**: MIT, `@autoform/core` 4.0.0 (2026-07-08), 3.5k stars. Three-axis packaging (schema provider x UI library x form library) and, notably, the shadcn UI is distributed as a copy-in registry so users own the markup; it also ships an agent skill [35, 36]. Verdict **study**.
- **uniforms**: MIT, v4.0.0 (2025-02-28), 2.1k stars, maintenance mode (ESTIMATE). Bridges for JSON Schema, SimpleSchema2, Zod and themes for antd, bootstrap, mui, semantic, unstyled; the docs playground switches the same form across schema bridges [37, 38]. Verdict **study**.
- **JSON Forms**: MIT, 3.8.0 (2026-06-16), 432,277 core downloads/week. Headless core with React, Angular, Vue bindings and separate renderer sets; first-party sets documented, community sets (antd, tailwind, shadcn, chakra, primevue, nuxt-ui, svelte) found only by npm search, with no community index [39, 40]. A multi-select is an array with `uniqueItems` plus `items.enum`/`oneOf` [41]. Verdict **study** and one possible renderer-set target (emit JSON Schema + UI Schema from zodal affordances).
- **Formily**: MIT, 2.3.7 (2025-05-15), 12.6k stars, no push since 2025-06-21; effectively dormant (ESTIMATE). Verdict **avoid**; only the Designable idea (schema editor beside a live form) is worth noting [42].
- **Puck**: MIT, `@puckeditor/core` 0.23.0 (2026-08-07), 13.4k stars. A page builder with no provider abstraction (an `external` field with a developer-supplied `fetchList`); hosted demo at its demo site [43, 44]. Verdict **avoid** for CRUD, **study** the demo-first docs.

### 1.2 Local-first, reactive stores and sync engines (storage-adaptor candidates)

None of these ships a react-admin-style `getList(filter, sort, pagination)` contract; all are query-builder plus live-subscription stores. Mapping a zodal filter expression onto each native query language is the bulk of any adaptor. Effort figures are ESTIMATES in person-days for someone who knows zodal.

#### TinyBase: verdict **wrap** (best first backend adaptor), ESTIMATE 2-3 days

- MIT, v10.0.1 (2026-09-24), 5.2k stars, 19,366 downloads/week; headless [45].
- Multi-group: its Indexes API lets the slice function return an array of slice ids, so one row belongs to several slices; this is the closest native "item in several groups" primitive in the whole survey. Its Relationships API is many-to-one only, so true many-to-many needs a junction table [46, 47].
- Adaptor menu: about 25 `persister-*` modules (localStorage, OPFS, IndexedDB, file, SQLite variants, libSQL, PGlite, Postgres, Supabase, Durable Objects, Yjs, Automerge, PartyKit and more) behind one `Persister` interface and subpath exports [48]. Largest storage menu seen.
- Schema: official "schematizers" for Zod, TypeBox, Valibot, ArkType, Yup, Effect Schema [49]; the closest schema fit to zodal.
- Playground: a "same app, successive versions" demo ladder (basics, indexes, persistence, metrics, checkpoints, collaboration), a 140,000-record city demo, `npm create tinybase@latest` templates and an in-app Inspector data editor [50].

#### Dexie (and Dexie Cloud): verdict **wrap** (default browser-persistent backend), ESTIMATE 2 days

- Apache-2.0, 4.4.6 (2026-09-10), 14.6k stars, 2,875,977 downloads/week [51].
- Multi-group: a native `multiEntry` index (`'id, author, *categories'`) with `where('categories').anyOf(...).distinct()`. Limits: a multiEntry index cannot be compound, so an AND of two tags needs a client-side fallback [51, 52].
- No adaptor menu (IndexedDB only); Dexie Cloud (realms and members, an access-group model rather than tags) is a paid sync upsell not to depend on [51]. No Zod integration in core.

#### PGlite and ElectricSQL: PGlite **wrap**, Electric **study** (read path only)

- Apache-2.0 (PGlite dual with the PostgreSQL licence). `@electric-sql/pglite` 0.5.8 (still 0.x, 24.6M downloads/week, likely inflated by tooling, ESTIMATE), `@electric-sql/client` 1.5.28 [53].
- Postgres semantics in the browser: `text[]` with GIN, junction tables, live queries, filesystems (memory, IndexedDB, OPFS). Electric shapes are single-table with a `where` that supports array operators and subqueries but not JSONB operators [54]. Electric has no write path ("does not do write-path sync") and the PGlite sync plugin is alpha, so a provider must delegate writes [55, 56].
- Playground: the PGlite REPL (full Postgres in the browser) is the best "try it" model for a SQL-backed adaptor [57]. ESTIMATE 3-5 days for a PGlite provider, about 2 days for an Electric read provider.

#### RxDB: verdict **wrap** (second, "serious offline and replication" tier), ESTIMATE 3 days

- Apache-2.0 core, 17.5.0 (2026-08-20), 23.4k stars, 115,196 downloads/week; several storages (IndexedDB, OPFS, SQLite, worker, sharding) are paid premium [58, 59].
- Multi-group: arrays of string ids with `ref` resolved by `populate()` ("there are no joins"); array-membership query operators UNVERIFIED [60].
- Adaptor menu: about 12 storages and 13 replication targets plus composable wrappers (validation, compression, encryption, sharding) around any storage [59]. JSON Schema only, no Zod or Standard Schema found.

#### Zero (Rocicorp): verdict **study**

- Apache-2.0, 1.0 stable on 2026-03-24, 1.9.0, 292k downloads/week [61]. Needs Postgres plus a `zero-cache` server, so it is a deployment, not a library menu item.
- Many-to-many via chained `many()` through a junction table, "only two levels of chaining are supported"; relationship filtering is `whereExists` (existence only) [62, 63].
- Playground: Gigabugs, a Linear-style tracker with 1.2 million bugs, cold start under 2 seconds [64]. Best "scale demo" idea.

#### Triplit: verdict **avoid** (study its Set type)

- AGPL-3.0 (`@triplit/client`); the company joined Supabase on 2025-10-08 with no product roadmap; last npm release 2025-07-31, so effectively dormant (ESTIMATE; "Cloud closed to new users" is UNVERIFIED) [65, 66].
- Native `Set` type plus relation subqueries; many-to-many via a junction collection [67].

#### Jazz: verdict **study** (watch the 2.0 alpha)

- MIT. Classic `jazz-tools` 0.20.19; 2.0 alpha 2.0.0-alpha.58 (a relational local-first database, 2026-09-30). Alpha columns support `s.array(...)` with `eq/contains/in` filters; "OR filters are not supported" [68, 69, 70]. 2.0 declares a Standard Schema dependency; classic uses Zod. No pluggable storage menu (its own cloud or `jazz-run sync`).

#### InstantDB: verdict **avoid** as a dependency, **study** its links declaration

- Apache-2.0, `@instantdb/core` 1.0.67. The team joined OpenAI; new signups closed and Instant Cloud shuts down 2027-08-31, though "all of Instant is open source" [71]. Its schema declares many-to-many as a `link` with cardinality on both sides (`has: 'many'` forward and reverse), the cleanest tag declaration in the set [72].

### 1.3 Lessons from family 1

- Three membership encodings recur: (1) id-array on the item (react-admin, Payload `hasMany`, the CRM's `bigint[]`, Dexie `*tags`, TinyBase multi-slice), (2) explicit junction collection (Directus, TanStack DB joins, Zero, Instant links), (3) a derived reverse view (Payload `join`). Default to (1), offer (2) as a declared capability, treat (3) as a query, never stored.
- Trees are single-parent plugins (Payload nested-docs, `ra-tree`); no surveyed framework offers a polyhierarchy or tag plugin. This is the real gap, in line with [1] section 12.
- Declare tag filtering as a capability (`native-index` or `client-side`) in `getCapabilities`, and never hide the AND-versus-OR difference: Jazz alpha has no OR, Dexie indexes one multiEntry per query, Zero `whereExists` is existence-only.
- Adaptor-menu packaging that works: one seam plus many leaf packages (TinyBase subpath exports, RxDB storage wrappers, TanStack `*-db-collection` packages). Cross-cutting concerns (validation, caching, encryption) should be decorators, not per-adaptor flags.
- Menus rot: sampled adaptors lag their core (Refine adaptors vs core, `@autoform/shadcn` stale since 2024, `shadcn-admin-kit` at 245 downloads/week). Ship a conformance suite and badge each adaptor with its result.
- No tool has a machine-readable adaptor registry; hand-curated docs lists plus npm naming conventions are the norm [9, 17]. A JSON manifest (name, capabilities, package, status, last published) rendered as a menu would be new.
- Playground ideas that already work: a browser-only default backend so a demo needs no server (react-admin on FakeRest), a "same form, switch the schema" tab (uniforms), tabs for Demo/Schema/UI Schema/Data (JSON Forms), a demo ladder (TinyBase), a live generated-query pane (PGlite REPL), a seeded very large dataset (Gigabugs), and a CRM-style seeded dataset with tags so multi-group membership is visible on first load.

## 2. Family 2: tag-based file managers, DAM and document managers

### 2.1 Items

#### TagSpaces: verdict **wrap** (read/write the `.ts` sidecar format), study the tag library

- Core AGPL-3.0 with a commercial dual licence and a proprietary Pro; helper packages (`@tagspaces/tagspaces-common`, indexer, shell) are MIT [73, 74]. 5.3k stars, v6.13.12 (2026-07-20) [75]. The app is not embeddable.
- Two tag storages: filename tags (`IMG-2653[vacation alps].jpg`) or a sidecar JSON `file.ext.json` in a hidden `.ts/` folder; folders use `.ts/tsm.json` [76]. Folders are the plain filesystem (single parent); tags are flat; tag groups only organise the tag library.
- The documented sidecar (verbatim shape) [77]:

```json
{
  "id": "4194969c6bb84ad3acac779645c90e70",
  "tags": [
    { "title": "tag1", "type": "sidecar", "color": "#ffcc24", "textcolor": "#ffffff" }
  ],
  "description": "# Some description\n\nin *markdown* format"
}
```

- `tsm.json` adds folder `color`, `perspectiveSettings` (list/grid/kanban view settings) and `customOrder` (`folders[]`, `files[]` of `{uuid, name}`) [77]. The tag-library export is `{appName, appVersion, settingsVersion, tagGroups[{uuid, title, color, expanded, children[]}]}`, one level deep [77].
- Lessons: human-readable and diffable, works on any storage (local, S3, WebDAV), a sidecar `id` (uuid) gives identity independent of path. Weakness: renames and moves outside the app break sidecars [78] (page not fetched; from a search result), and tag colours are duplicated into every sidecar so library and sidecars can drift (inference from the format).
- UI: multi-select then an add/remove/clear tags dialog, drag-and-drop tagging, tag library with groups [76].

#### TMSU: verdict **study**

- GPL-3.0, Go, 2.2k stars, last release v0.7.5 (2019-12-02), last push 2025-11-12 [79]. Tags are flat, with `name=value` pairs and implications. Central SQLite schema: `tag`, `file(directory, name, fingerprint, ...)`, `value`, `file_tag(file_id, tag_id, value_id)`, `implication(tag_id, value_id, implied_tag_id, implied_value_id)` [80].
- Lessons: the file/tag/value/file_tag core is a clean model for `key=value` tags; a content fingerprint beside the path answers "the file moved"; a central DB means tags are lost if the DB is not copied.

#### Tagsistant and Tabbles: **study** and **avoid**

- Tagsistant: GPL-2.0, 326 stars, last push 2018 (dormant). Flat tags with a small relation vocabulary (`includes`, `is_equivalent`) expanded by a reasoner at query time [81].
- Tabbles: proprietary Windows client on SQL Server, last release 5.9.2 (2020 per the encyclopedia entry); nested tags, polyhierarchy behaviour UNVERIFIED [82].

#### Eagle (eagle.cool): verdict **study**

- Proprietary DAM with a local HTTP API [83]. Item fields include `tags` and `folders` (plural; that items may sit in several folders is an inference from the field name, ESTIMATE); folders nest via `children`. On disk: a `.library` folder with `metadata.json`, `images/<ID>.info/metadata.json` per item; exact field names UNVERIFIED [84].

#### Hydrus Network: verdict **study** (the richest model in this family)

- WTFPL v3, Python/Qt desktop with a Client API, 3.2k stars, v689 on 2026-09-30, weekly releases [85]. Not embeddable in TS.
- Model: files are identified by SHA256; tags live in services (local or remote tag repositories); namespaces (`character:batman`); **siblings** are many-to-one replacement to an "ideal" tag (no cycles, transitive, non-destructive); **parents** imply a tag at search and display time without being stored on the file, "Tags can have multiple parents", "Loops are not allowed" (a DAG) [86, 87, 88]. Public Tag Repository: clients download update files and process them locally; petitions need janitor approval [89].
- Lesson: keep canonicalisation (siblings) and implication (parents) as relations separate from item-tag assignments, derive implied tags rather than storing them, and scope tag sets per service.

#### digiKam: verdict **wrap** the XMP convention, study the schema

- GPL-2.0, KDE project (active upstream on the KDE forge; the GitHub mirror is stale), v9.1.0 on 2026-06-06 [90]. Schema: `Tags(id, pid, name, UNIQUE(name,pid))` (single parent), a `TagsTree(id, pid)` closure table, `ImageTags`, extensible `TagProperties` and `ImageTagProperties` key/value tables; each image lives in exactly one album, so folders are single-parent and tags give multi-membership [91].
- Embedded tags: `Xmp.digiKam.TagsList` holds `/`-joined paths [92]. Central DB for speed plus metadata written back for portability gives two sources of truth.

#### Adobe Bridge and Lightroom keywords, XMP, IPTC, MWG: verdict **wrap** (the image-keyword interop target)

- Lightroom keeps a flat `dc:subject` bag and a `lr:hierarchicalSubject` bag whose levels are joined with `|`; XMP itself does not permit hierarchy in `dc:subject` [93, 94]. The Adobe keyword help page returned HTTP 403, so per-keyword options (export containing keywords, export synonyms) are from a search snippet, UNVERIFIED.
- IPTC defines `dc:subject` as free-text keywords with unbounded cardinality and says nothing about hierarchy [95]. The Metadata Working Group (Adobe, Apple, Canon, Microsoft, Nokia, Sony; site defunct) defined `mwg-kw`: `Keywords > Hierarchy > Keyword + Children + Applied`, where `Applied` distinguishes "tagged with this node" from "node is just an ancestor" [96, 97, 98].
- Practical rule for an adaptor: write all three (mwg-kw, `lr:hierarchicalSubject`, `digiKam:TagsList`) plus flat `dc:subject`; read in that order. Call out to `exiftool` rather than reimplement it (ESTIMATE of effort; its licence is GPL/Artistic).

#### macOS Finder tags, KDE Baloo and freedesktop xattrs, Windows properties: verdict **wrap** (xattr adapters), never the primary store

- Finder: xattr `com.apple.metadata:_kMDItemUserTags`, a binary plist array of `name\n<colour index>` strings; it survives iCloud Drive but is dropped by FAT, zip, email and xattrs of 80 KB or more [99, 100].
- Baloo/KDE: `user.xdg.tags` comma-separated, `user.baloo.rating`, `user.xdg.comment` [101, 102]. In the 2024 archived snapshot of the freedesktop wiki, `user.xdg.tags` is not listed, so it is a de-facto KDE convention [103]. A comma separator means tag names cannot contain commas.
- Windows: `System.Keywords` is a multivalue string stored through per-format property handlers; plain text files cannot carry it [104].

#### paperless-ngx: verdict **study**

- GPL-3.0, 46k stars, v3.2.1 (2026-09-20), full REST API [105, 106]. A document has single-valued foreign keys (correspondent, document type, storage path) and a many-to-many `tags`, a deliberate split of single- from multi-valued facets.
- Nested tags (v2.19): a tag may have a parent to depth 5; when a tag is added to a document all its parents are added automatically, and removing a tag removes its children; the closure is materialised on the document, unlike Hydrus [107]. Matching per tag: none, any, all, exact, regex, fuzzy, or auto (a trained classifier) [108].

#### Calibre: verdict **study**, wrap the dotted-name convention

- GPL-3.0, 26k stars, v9.15.0 (2026-09-18). Schema: `tags`, `books_tags_link`, runtime-defined `custom_columns` with a datatype and `display` JSON, one link table per facet [109]. Tags are flat; hierarchy is a presentation convention using periods in names (`History.Military`) enabled per column, with five search options per node [110], so polyhierarchy falls out for free (one book can carry `Sci-Fi.Space` and `Military.Space`).
- `metadata.opf` is rewritten per book from the database as a recoverable sidecar (a `metadata_dirtied` queue); DB plus sidecar redundancy is the lock-in escape [111].

#### Zotero: verdict **study**; read-only import via the Web API is a plausible later wrap

- AGPL-3.0, 15.5k stars, 10.0.5 [112]. Verbatim schema: `collections(parentCollectionID)` single parent, `collectionItems(collectionID, itemID, orderIndex)` many-to-many with per-collection order, `tags`, `itemTags(itemID, tagID, type)` with `type` 0 manual or 1 automatic [113]. Docs: an item can be in multiple collections; collections behave like playlists, not folders; collections do not transfer between libraries but tags do [114].
- Up to nine coloured tags with keys 1-9 as hotkeys (colours live in a synced setting, not on the tag row); an "Unfiled Items" virtual collection; saved searches as smart collections [114, 115].

### 2.2 Lessons from family 2

- Three things, always: items, a tag registry (id, name, colour, aliases), and assignments (item, tag, optional value/type/order). Every serious SQL system (TMSU, digiKam, Zotero, Calibre, paperless) has this shape.
- Collections (curated, ordered, hierarchical, single-parent nesting) and tags (flat many-to-many facets) are two axes; Zotero is the cleanest hybrid and puts `orderIndex` on the membership row (confirms the edge-ordering lesson in [1] section 12.3).
- Polyhierarchy: only Hydrus ships a general DAG of tags; everyone else has single-parent trees (digiKam, paperless, Zotero collections, Lightroom) or delimiter conventions (Calibre `.`, digiKam `/`, Lightroom `|`).
- Two semantics for hierarchy must be a named choice: derived implication (Hydrus: nothing stored) versus materialised closure (paperless: parents written onto the document; digiKam `TagsTree`). Derived keeps data clean; materialised makes exports and simple filters trivial.
- Per-membership attributes are needed: order (Zotero, digiKam `manualOrder`), value (TMSU), type (Zotero auto/manual), property bag (digiKam), applied flag (mwg-kw).
- Single-valued facets next to tags (paperless correspondent, Calibre series) should be "facet with cardinality 1" in one schema so the same UI renders both.
- Pluggable file identity: path alone breaks on move; TMSU adds a fingerprint, Hydrus uses SHA256 only, TagSpaces puts a uuid inside the sidecar.
- Sidecar rules: sidecar JSON in a hidden folder is the simplest portable design for arbitrary files; xattrs vanish on FAT, shares, zips and some sync paths; a central DB locks tags in unless a recoverable sidecar exists (Calibre OPF, digiKam XMP write-back); export the tag registry on its own, version it (`settingsVersion`, TMSU `version` table), and avoid duplicating registry data into every sidecar.
- UI gestures actually evidenced: multi-select then an add/remove dialog (TagSpaces), drag an item onto a tag or collection (TagSpaces, Zotero), coloured tags with 1-9 hotkeys (Zotero), a facet pane with live counts and `-tag` exclusion (Zotero, Hydrus), a virtual "Unfiled" view (Zotero), "this node only versus node plus descendants" search (Calibre), and "A (B)" alias display (Hydrus). Eagle, Lightroom and Finder gestures are UNVERIFIED.
- Licence reality: most of this family is GPL/AGPL, so implement formats from documentation and never copy code; formats themselves are not copyrightable (ESTIMATE; not legal advice). Safe to reuse as code: Hydrus (WTFPL), `tagspaces-common` (MIT), KDE kfilemetadata (LGPL, linkable).

## 3. Family 3: faceted browsers and database-view UIs

Already covered and not redone: Algolia InstantSearch and `algoliasearch-helper`, ItemsJS (correct disjunctive facets), Orama (broken disjunctive facets), MiniSearch, Lunr, Fuse, FlexSearch (no facet counts) [1] section 8.

### 3.1 SIMILE Exhibit: verdict **study**

- MIT, 178 stars, last commit on `master` 2019-04-23, a 3.1.0 release candidate; dormant (ESTIMATE). Browser-only, jQuery-era, HTML-attribute config; not headless [116]. The unscoped npm package `exhibit` is unrelated.
- Data model: an array of objects with property/value pairs; "if a value is an array, then the corresponding item is considered to have multiple values for that property", so multi-valued is native with no join table [117].
- Component model: database, collections, facets, views, lenses, coders; a lens renders one item and a view renders a set; each view has its own settings [117, 118]. A view is type plus settings over a collection, not a saved filter object.

### 3.2 Flamenco and Hearst's design lessons: verdict **study** (it is the facet UX spec)

- Berkeley research project (BSD, Python/CGI/MySQL, no maintenance since the 2000s, ESTIMATE) [119]. Key papers: Yee et al., CHI 2003 [120]; Hearst, CACM 2006 [121]; Hearst, Search User Interfaces ch. 8 [122]. Hearst's 2006 SIGIR design-recommendations PDF had a garbled text layer and could not be read, UNVERIFIED.
- Verified rules: never show a link that leads to zero results, and show a query preview (count) on every link; in the 35,000-image study, structured tasks produced 82 empty results with the baseline and 26 with facets; facets may be flat or hierarchical and single- or multi-valued; query semantics are "a conjunction of disjunctions over subhierarchies" (AND across facets, OR within a facet subtree); counts were computed with SQL `COUNT(*)` and `GROUP BY` [120, 121, 122].

### 3.3 Datasette: verdict **study** (facet JSON contract, plugin hooks, Datasette Lite as playground)

- Apache-2.0, 11.5k stars, 0.65.5 on 2026-09-16; Python, SQLite-only. The npm package `datasette` is unrelated [123].
- Facets: `?_facet=col`; JSON `facet_results` carries per value `{value, label, count, toggle_url, selected}` plus `truncated`; the server-built `toggle_url` means the UI never composes filters [124]. `facet_array` facets a JSON array column ("useful for modelling things like tags without needing to break them out into a new table"), each value toggling `tags__arraycontains=v` [124, 125, 126]. Whether counts of other values become disjunctive after a selection is UNVERIFIED.
- Suggested facets use cheap heuristics: 2 to 30 distinct values, fewer than the row count, finishing within 50 ms [124].
- Menu: a plugin directory (a summarizer said "200+", ESTIMATE) and hooks such as `register_facet_classes` for new facet types [127]. Datasette Lite runs Datasette in the browser via Pyodide and loads CSV/SQLite/JSON/Parquet URLs, a no-install playground; plugins that load their own JS/CSS do not work there [128].
- Views: no saved-view object; state lives in the URL query string.

### 3.4 Meilisearch and Typesense: verdict **wrap** as provider targets (through the InstantSearch layer)

- Meilisearch: repository licence MIT with BUSL-1.1 enterprise parts; 59k stars; v1.54.3 (2026-10-01) [129]. `facetDistribution` and numeric `facetStats` need `filterableAttributes`; array attributes match "at least one element" [130, 131]. **No built-in disjunctive mode**: the official recipe is client-side multi-search, one main query plus one per disjunctive group with that group's filter removed [132]. Hierarchy is the `lvl0/lvl1` convention, not native [133]. `@meilisearch/instant-meilisearch` 0.31.4 is MIT with a `keepZeroFacets` option and limited hierarchicalMenu support [133].
- Typesense: server GPL-3.0, 26.6k stars, v30.2; client Apache-2.0 [134]. Facet params include `facet_by`, `facet_strategy` (exhaustive/top_values/automatic), `max_facet_values`, sampling controls, and `top_values` counts may be inexact [135]. Hierarchy via per-level fields `field.lvl0..lvlN`, each of which "can also hold an array of values. This is useful for handling multiple hierarchies", i.e. polyhierarchy as arrays at each level [136]. Disjunctive count behaviour could not be verified. The adapter's LICENSE file says MIT and its `package.json` says Apache-2.0.

### 3.5 Database-view products: Airtable, Notion, Baserow, NocoDB, Grist, Directus, Teable

- **Airtable** (closed SaaS; npm client 0.12.2 MIT): grouping a grid by a multiple-select field makes one group per exact combination, a record appearing once; an Interface list duplicates the record into each element group (user report, 2024) [137, 138]. Kanban stacks only by single select, user, or a single-link record field; multiple select is not offered [139]. The Views API exposes only id, name, type and a few flags, not filters, sorts or groups, so the view config is closed [140]. Verdict **study**.
- **Notion** (closed; SDK MIT): a board groups by select, person, multi-select or relation [141]; a third-party guide says rows repeat under each tag [142]; drag-and-drop on a multi-select board is UNVERIFIED. **The Views API is the best open example of a view schema** (see 3.6). Verdict **study** closely.
- **Baserow** (MIT for the open-source edition; `premium/` and `enterprise/` have their own licences): 6.1k stars, 2.4.0 (2026-09-30) [143]. The docs say rows appear in every group of a multiple-select field [144]; the code says otherwise: a 2026 bug report and merged fix show the grid grouping by the option set, order-insensitive [145, 146]. The code is trusted over the doc (ESTIMATE). Kanban needs a single-select field and a drop overwrites the value [147]. Plugins can add field types, view types, filters, sorts and decorations (self-hosted, experimental): a view type is a backend model plus a frontend component registered by type [148]. Verdict **study**.
- **NocoDB**: Sustainable Use License (internal business or non-commercial use only; not OSI), so **avoid** [149]. Kanban stacks by single select; a request open since 2023-08-15 asks for cards to "appear in the stacks corresponding to all selections" for multi-select and many-to-many [150]. Views carry filters, sorts, groups (up to 3 levels), row colours [151].
- **Grist** (Apache-2.0, 11.9k stars): grouping by a list column flattens it in the summary table, one summary row per element, plus an explicit "empty" row for empty lists [152]. Study the explicit empty group.
- **Directus presets** and **Teable**: presets store `layout`, `layout_query`, `layout_options`, `filters`, `search`, `bookmark`, scoped per `user` and `role` [34]. Teable kanban stacks by most fields and a drop updates the stacking field; multi-value duplication UNVERIFIED [153].

### 3.6 What happens when grouping by a multi-valued field

| Tool | Behaviour | Source |
|---|---|---|
| Airtable grid | One group per exact combination; record shown once | [137] |
| Airtable Interface list | Record duplicated into every element group (user report) | [138] |
| Airtable kanban | Multi-select cannot be the stack field | [139] |
| Notion board or table | Row repeated under each tag (third-party guide); drag-and-drop UNVERIFIED | [142] |
| Baserow grid, per docs | Row appears in every group; counts may exceed the row total | [144] |
| Baserow grid, per code | One group per option set, order-insensitive; contradicts the docs | [146] |
| Baserow kanban | Single select only; drop overwrites the value | [147] |
| NocoDB kanban | Single select only; multi-select requested, open | [150] |
| Grist summary table | One summary row per element, plus an empty-list row | [152] |
| Datasette `facet_array` | A facet value per array element (a facet, not a group) | [125] |

Takeaway: no surveyed tool has a documented board where one card sits in several columns, and drag-and-drop "move versus add" for multi-valued boards is undefined everywhere it could be verified. Users ask for it [150].

### 3.7 The view-config schema worth copying (Notion Views API)

- A view is `{id, name, type, data_source_id, parent, filter, sorts, quick_filters, configuration}`; `filter` and `sorts` reuse the data-source query shapes; `type` is one of table, board, list, calendar, timeline, gallery, form, chart, map, dashboard; `configuration` is a discriminated union keyed on `type` [154, 155].
- Per-layout feature matrix: `group_by` required for board and optional for table, `sub_group_by` optional for board, `date_property_id` required for calendar and timeline. `group_by` is itself a discriminated union on property type, with `sort` (manual, ascending, descending) and `hide_empty_groups`; `multi_select` takes no extra option, so per-element versus per-combination is fixed and not configurable [155].

### 3.8 Lessons from family 3

- Multi-valued properties as plain arrays on a flat item are the oldest and simplest model (Exhibit 2007) and what Datasette, Meilisearch, Typesense, Airtable and Grist all store. Keep membership canonical on the item; derive trees and groups as projections.
- Separate "options" (a facet's value set with colour and order) from membership. Airtable's own workaround for combination grouping is to promote a multi-select into a linked table; a schema should allow a tag field to be inline-array or table-backed with identical view semantics.
- Facet UX rules: no zero-result links; a count on every link; AND across facets and OR within one; disjunctive counts take N+1 queries unless the engine does it, so the provider contract must declare it as a capability; make "show zero-count options disabled" a renderer option; expose a truncation flag and per-facet size; make "exact versus fast counts" a capability flag (Typesense sampling).
- A view schema: `{id, name, type, source, filter, sorts, quickFilters, configuration}` with `configuration` a Zod discriminated union keyed on layout, per-layout required fields as refinements, and `groupBy` with an **explicit** `multiValue: "element" | "combination"` option (every surveyed tool hard-codes one and they disagree), `sort`, `hideEmptyGroups`, and an explicit empty group. Saved views scoped per user and role; view types as plugins (Baserow); keep the view config in the open (Airtable hides it, Notion and Baserow expose it).
- Gestures: board drag on a single-valued field overwrites the field (Baserow, Teable, NocoDB). A drag that conflicts with an active sort snaps back (NocoDB docs), so disable or warn. For multi-valued fields nobody has a verified answer; propose drag = move (leave source, join target) and modifier-drag = add, with the card visibly present in each element column, plus undo (design proposal, not prior art).

## 4. Family 4: personal-knowledge-management tools

### 4.1 Items

#### Obsidian (core app, frontmatter tags, Bases, Dataview, JSON Canvas): verdict **study hard**

- Closed source; free for personal, commercial and non-profit use; the typings repo is MIT [156, 157]. Releases: v1.13.8 (2026-08-21); Bases arrived in 1.9, List and Map in 1.10, Kanban needs 1.14 early access [158, 159].
- Tags are strings, not items. Nested tags are a naming convention: "`tag:inbox` will match `#inbox` as well as all nested tags such as `#inbox/to-read`"; in Bases `file.hasTag("a")` matches `#a` and `#a/b`. So the parent is implied at **query time** by prefix expansion, not stored on the note [160]. A tag cannot have two parents; `a/b` and `c/b` are unrelated.
- Frontmatter `tags` list is the portability story (read by Foam, Dendron, static-site generators). Property types are per-name and vault-global, stored in app config, not in the note [161]:

```yaml
---
tags:
  - recipe
  - cooking
---
```

- **Bases** (`.base` YAML, documented): top-level `filters`, `formulas`, `properties`, `summaries`, `views`; filters are a recursive `and | or | not` tree of expression strings; each view has `type` (table, cards, list, map, kanban), `name`, `limit`, `groupBy {property, direction}`, view `filters`, `order`, `summaries`, plus free-form per-type config; "by default a base includes every file in the vault" and there is deliberately no `from` source [162]. Dragging a card between Kanban columns writes the grouped property back into the note [163]. Group-by on multi-valued fields is undocumented, UNVERIFIED. The evaluator is closed and no standalone parser was found.

```yaml
views:
  - type: table
    name: "My table"
    groupBy:
      property: note.age
      direction: DESC
    filters:
      and:
        - 'status != "done"'
    order:
      - file.name
      - formula.ppu
```

- **Dataview**: MIT, 9.4k stars, last release 0.5.70 (2025-04-07), slowing; successor project Datacore (MIT, 2.2k stars). Sources are minimal: `FROM #tag` (and subtags), `FROM "folder"`, with `WHERE`, `SORT`, `GROUP BY`, `FLATTEN` [164, 165].
- **JSON Canvas** 1.0: an open MIT spec (`nodes[]`, `edges[]`; node types text, file, link, group); a group is a visual container only, membership is by geometry, a lesson in what not to rely on for membership [166].

#### Logseq (database version): verdict **study**; do not copy code (AGPL)

- AGPL-3.0, 45k stars; the DB version is beta ("data loss is possible"); file graphs were split into `logseq/og` [167, 168]. A CLI works independent of the app; Clojure/ClojureScript, so not a TS drop-in [169].
- Model: a tag is a page and carries schema. "Tags can have multiple parent tags via the `Extends` property ... since a tag can have multiple parents, it can appear multiple times in a hierarchy"; properties are inherited; "a tagged node can have multiple tags" (example: `Audiobook` extends `Book` and `MediaObject`) [169]. This is polyhierarchy with property inheritance, the closest published design to our goal. Namespaces (`a/b`) are a separate mechanism for pages without common properties [169]. Storage is SQLite with an EDN build format; the file-to-DB split shows the cost of outgrowing files [168].

#### Tana: verdict **study** (closed)

- Supertags are nodes carrying fields; `Extend` is inheritance ("add a new field to #todo, and know that any extension of #todo will get the same field"; searching the base tag returns extensions too) [170]. The old Input API is write-only, a newer local API/MCP exists [171]. Tana Paste is a tiny human-writable inline syntax (`#tag`, `field::value`, indentation) [172]. Licence and export format UNVERIFIED (ESTIMATE closed, proprietary cloud).

#### Capacities: verdict **study** (a clean taxonomy of group kinds)

- Every object has exactly one type; **collections** are manual groups within one type and an object can be in several; collections cannot span types, so "use tags or a tag query instead"; **queries** are saved rule-based filters [173, 174, 175]. Four group kinds with different scope and manual or automatic nature: exclusive type, manual collection, cross-type tag, rule query. Licence UNVERIFIED (ESTIMATE closed).

#### Anytype: verdict **study**; avoid depending (licence and Go stack)

- The apps are under the Any Source Available License 1.0 (non-commercial, or commercial only in allowed networks), not OSI; the `any-sync` protocol is MIT [176, 177]. Model: every object has one Type; Properties include Multi-select and Object (links); **Collections** are manual and "the same Object can live in multiple Collections at once"; **Queries** (formerly Sets) are rule-based; formerly "Relations" are now "Properties" [178, 179, 180].

#### Are.na: verdict **study** (membership as an edge entity); possible provider via the MIT SDK

- Closed platform (UNVERIFIED), OpenAPI v3 spec and an MIT TypeScript SDK `@aredotna/sdk` [181, 182]. "On Are.na, there is no such thing as a 'like' or a 'favorite', instead we have connections"; a block can be connected to "an infinite number of channels", and channels can be connected to other channels, so groups are items and cycles are possible [183].
- API: `POST /v3/connections` connects a block or channel to one or more channels, each with `position` and `metadata`; the connection record has `id`, `position`, `pinned`, `metadata` (scalar key/values, max 50 keys), `connected_at`, `connected_by`, and move actions (`insert_at`, `move_to_top`, ...). A block can be `orphan`, "not connected to any channel" [182]. The API prohibits bulk scraping [182].
- Lesson: the join record deserves its own identity and payload. This is the clearest "edge as entity" model, and it is exactly what a plain tag array lacks.

#### Notion multi-select and relations (brief)

- `multi_select.options[]` have a stable `id` (survives renames), a case-insensitively unique `name`, `color`, `description`; a `relation` is one-way (`single_property`) or two-way (`dual_property`), which gives a free "members of this group" back-reference [184].

#### Bear, Roam, Dendron, Foam, Org-mode, Luhmann

- **Bear** (closed): nested tags `#recipes/vegetarian`; staff state that tagging `#parent/child` "is the same as tagging it with both `#parent/child` and `#parent`", a limit of the relational store, i.e. the implied parent is **materialised at write time**, the opposite of Obsidian [185, 186]. No polyhierarchy (path strings; ESTIMATE).
- **Roam** (closed): `[[X]]`, `#X` and `tags:: [[X]]` all create a reference to page X, so group equals page equals item [187]. Licence and export UNVERIFIED.
- **Dendron**: Apache-2.0, 7.5k stars, maintenance mode since 2023; hierarchy is encoded in flat filenames (`project1.designs.promotion.md`), tags are notes under `tags.*` [188, 189]. Lesson: filename-encoded hierarchy is portable and git-diffable but makes re-parenting a mass rename; "tags as notes in a subtree" is group-is-item in plain files.
- **Foam**: MIT, 17.4k stars, v0.46.0 (2026-09-30); same frontmatter and slash-nesting convention as Obsidian with a Tag Explorer panel [190]. A safe open reference for a Markdown provider; its core is not published as a library (UNVERIFIED).
- **Org-mode**: tags `:a:b:` inherit down the document tree; `#+TAGS: { @work @home }` declares mutually exclusive tags; `#+TAGS: [ GTD : Control Persp ]` declares a group tag where "searching for a group tag returns matches for all members in the group and its subgroups" [191, 192, 193]. The taxonomy lives in a declaration, separate from tag use. Org-roam keeps a rebuildable SQLite cache over text files [194].
- **Luhmann's Folgezettel** puts a single structural parent in the identifier and cross-links elsewhere [195]; good for ordering, not for multi-membership.

### 4.2 Lessons from family 4

- Three ways to say "item in several groups": (1) tag strings on the item (Obsidian, Bear, Foam, Org), (2) tags or groups as items with a schema (Logseq DB, Tana, Capacities tags, Roam), (3) explicit membership edges carrying data (Are.na). A provider should model (3) at the lowest level; (1) is the degenerate case (an edge without payload) and (2) is "group is an item" (confirms `groupsAreItems` in [4] section 7.2).
- Hierarchy is a layer on the group, in one of five places: the name (Obsidian, Bear, Foam), a declaration (Org group tags), an `Extends` edge list (Logseq, Tana, multi-parent), the filename (Dendron, single parent), the identifier (Luhmann). Decide up front.
- Implied-parent semantics must be a named strategy: Obsidian computes at query time, Bear materialises at write time, Org expands group tags on search, Hydrus derives (see 2.1). Expose `expand descendants` as an explicit query option (default on).
- Group kinds differ (Capacities, Anytype): exclusive type, manual collection, cross-type tag, rule query. Keep "manual membership" and "saved rule" as separate kinds.
- Per-membership data (order, pinned, note) is exposed only by Are.na; the Bases Kanban drag is the same need expressed as a property write.
- Small details worth copying: stable option ids under rename and case-insensitive name uniqueness (Notion); an explicit orphan or "ungrouped" state (Are.na).
- Formats: Markdown plus YAML frontmatter `tags` is the best portability (Obsidian, Foam and Dendron read it) but property types and prefix semantics live in each app. "Text is the truth, the database is a rebuildable cache" survives tool death (Org-roam; Dendron works unmaintained since 2023). Logseq's file-to-DB split shows the cost of migration; design so a file provider and a DB provider implement one interface.
- Query languages share a shape: a boolean filter tree plus a source selector plus presentation (Bases `and|or|not` over expression strings, Dataview `FROM/WHERE/SORT/GROUP BY`, Tana search nodes, Logseq simple plus Datalog, Roam Datalog). A recursive Zod union `{and|or|not: Filter[]} | Predicate`, with field references namespaced by origin (`note.x`, `file.x`, `formula.x`), maps well; free-string expressions are the weak spot.
- Gestures: "Connect" an existing item into another group without removing it from others (Are.na); type `#` to pick a tag inline (Obsidian, Logseq, Bear, Tana); drag a board card to set the grouped property (Bases, Logseq views); a sidebar tag tree with disclosure triangles (Obsidian, Bear, Foam); a "This channel appears in" reverse listing (Are.na); convert page to tag and back (Logseq).

## 5. Consolidated table

Columns: licence, maturity at 2026-10-04, headless, how multi-group membership is modelled, whether a provider or renderer menu exists, whether a playground exists, verdict. "n/a" means not applicable. Sources are in the sections above.

| Tool | Licence | Maturity | Headless | Multi-group model | Menu / playground | Verdict |
|---|---|---|---|---|---|---|
| react-admin | MIT (EE paid) | 5.15.4, 26.9k stars | yes (`ra-core`) | id-array; junction paid | 70+ providers / FakeRest demos | study |
| Refine | MIT | 5.0.12, 35.7k stars | yes | reads only | ~13 official + 15 community / CodeSandbox | study |
| TanStack Query/Table | MIT | very active | yes | none | n/a | wrap-friendly |
| TanStack DB | MIT | 0.11.3, 1.37M/wk | yes | junction + joins | collection creators / none | study, wrap both ways |
| Payload | MIT | 3.90.2, 45k stars | API yes, UI no | `hasMany` array; single-parent tree plugin | DB + storage adapters / none verified | study |
| Directus | server MSCL, SDK MIT | v12.4.1 | API yes | junction, M2A | SDK composables / presets | avoid server |
| AutoForm | MIT | 4.0.0, 3.5k stars | partly | none | schema x UI x form / docs | study |
| uniforms | MIT | v4.0.0 (2025) | logic yes | none | bridges + themes / yes | study |
| JSON Forms | MIT | 3.8.0, 432k/wk | yes | enum array | renderer sets / tabs | study, maybe renderer |
| Formily | MIT | dormant 2025 | partly | none | small / Designable | avoid |
| Puck | MIT | 0.23.0 | no | none | none / demo | avoid |
| TinyBase | MIT | v10.0.1 | yes | multi-slice index | ~25 persisters / demo ladder | wrap (first) |
| Dexie | Apache-2.0 | 4.4.6, 2.9M/wk | yes | `multiEntry` index | none / none | wrap |
| PGlite / Electric | Apache-2.0 | 0.5.8 / 1.5.28 | yes | `text[]`, junction | FS options / REPL | wrap / study |
| RxDB | Apache-2.0 (premium parts) | 17.5.0 | yes | id arrays + populate | ~12 storages / quickstart | wrap |
| Zero | Apache-2.0 | 1.9.0 | yes | chained junction | none / Gigabugs | study |
| Triplit | AGPL-3.0 | dormant | yes | native `Set` | ~7 KV stores / console | avoid |
| Jazz | MIT | 2.0 alpha | yes | arrays, relations | none / inspector | study |
| InstantDB | Apache-2.0 | cloud ends 2027-08-31 | yes | links both sides | none / explorer | avoid |
| TagSpaces | AGPL + Pro; helpers MIT | v6.13.12 | no | flat tags, sidecar | n/a | wrap sidecar |
| TMSU | GPL-3.0 | 2019 release | CLI | flat + values | n/a | study |
| Tagsistant / Tabbles | GPL-2.0 / proprietary | dormant | no | flat, relations | n/a | study / avoid |
| Eagle | proprietary | n/a | local API | `folders[]` + tags (inferred) | n/a | study |
| Hydrus | WTFPL | v689, 3.2k stars | Client API | tag DAG: parents, siblings | n/a | study |
| digiKam | GPL-2.0 | v9.1.0 | no | album + tag tree | n/a | wrap XMP |
| Lightroom/XMP/MWG | open specs / proprietary | stable | n/a | path bags, `mwg-kw` | n/a | wrap |
| Finder / Baloo / Windows | proprietary / LGPL | stable | n/a | flat xattr | n/a | wrap xattr |
| paperless-ngx | GPL-3.0 | v3.2.1, 46k stars | REST API | M2M tags + tree (closure stored) | n/a | study |
| Calibre | GPL-3.0 | v9.15.0 | CLI/API | flat + dotted names | n/a | study |
| Zotero | AGPL-3.0 | 10.0.5 | Web API | M2M collections + tags | n/a | study |
| Exhibit | MIT | dormant | no | multi-valued arrays | views / n/a | study |
| Flamenco | BSD | dormant | no | multi-valued facets | n/a | study (UX spec) |
| Datasette | Apache-2.0 | 0.65.5, 11.5k stars | JSON API | `facet_array` | plugins / Lite | study |
| Meilisearch / Typesense | MIT+BUSL / GPL-3.0 | active | engines | arrays, lvl fields | InstantSearch adapters | wrap |
| Airtable / Notion | closed | active | no | multi-select, relations | n/a | study |
| Baserow | MIT (OSE) | 2.4.0 | server | multiple select | view-type plugins | study |
| NocoDB | Sustainable Use | active | server | multi-select | n/a | avoid |
| Grist | Apache-2.0 | v1.7.20 | server | choice/ref lists | n/a | study |
| Obsidian (+Bases) | closed, MIT specs | v1.13.8 | no | tag strings, `a/b` | n/a | study |
| Logseq DB | AGPL-3.0 | beta | partly | tag = page, `Extends` DAG | n/a | study |
| Tana / Capacities | closed | active | no | supertags / four group kinds | n/a | study |
| Anytype | ASAL; any-sync MIT | v0.57.4 | no | collections, queries | n/a | study |
| Are.na | closed; SDK MIT | active | REST | connection edges | n/a | study, maybe wrap |
| Bear / Roam | closed | active | no | `#a/b` stored both / page = tag | n/a | study |
| Dendron / Foam / Org | Apache / MIT / GPL | maintenance / active / active | no | filename / frontmatter / declared | n/a | study |

## 6. Top 5 things to copy

1. **Membership as the canonical fact, with edges able to carry data.** Store `string[]` or id arrays on the item as the default; allow a membership edge entity with `position`, `pinned`, `metadata`, `connectedAt` for providers that support it (Are.na connections, Zotero `orderIndex`, digiKam `manualOrder`). Put order and weight on the edge, never the node [91, 113, 182]; this confirms the Drupal lesson in [1].
2. **Hierarchy as a declared relation, separate from assignments, with a named derive-or-materialise strategy.** Hydrus parents and siblings, Org group tags, and Logseq `Extends` show the declaration model; Obsidian (query-time), Bear and paperless (stored) show the two semantics. Expose `expand: 'direct' | 'closure'` (already in [4] section 7.2) and an `ancestorsStored: boolean` strategy [88, 107, 160, 169, 186, 193].
3. **A documented, open view-config schema** modelled on the Notion Views API and Obsidian Bases: a Zod discriminated union keyed on layout, per-layout required fields, `groupBy` with an explicit `multiValue: 'element' | 'combination'` and `hideEmptyGroups`, a recursive `and|or|not` filter, quick filters, and user/role-scoped saved views [34, 155, 162]. Add Hearst's facet rules (counts on every link, no zero results, AND across and OR within) as renderer defaults [120, 121].
4. **Adaptor-menu packaging that scales:** one seam and many leaf packages (TinyBase subpath exports, RxDB storage wrappers, TanStack `*-db-collection`), cross-cutting concerns as decorators, honest `getCapabilities`, a published conformance suite with per-adaptor badges and a machine-readable manifest. Make a TanStack DB bridge the interop shortcut to Electric, PowerSync and RxDB; start with TinyBase, Dexie and PGlite as first adaptors [22, 48, 59]. Playground defaults: a browser-only backend (react-admin on FakeRest), a demo ladder (TinyBase), a live generated-query pane (PGlite REPL), a seeded large tagged dataset (Gigabugs), and Datasette Lite's no-install approach [11, 50, 57, 64, 128].
5. **Text is the truth, indexes are rebuildable, formats are versioned.** Offer providers for Markdown plus YAML frontmatter `tags` (Obsidian/Foam compatible), the TagSpaces `.ts` sidecar JSON (stable `id`, `tags`, `description`; folder `customOrder`), and an XMP keyword triad; keep a recoverable sidecar beside any database (Calibre OPF); embed a schema version; export the tag registry on its own [77, 96, 111, 161].

## 7. Top 5 traps

1. **Multi-valued group-by is undefined and inconsistent.** Baserow's docs and code disagree, Airtable's grid and Interface list disagree, Notion's drag-and-drop is undocumented, and no surveyed board puts one card in several columns. Specify per-element versus per-combination explicitly, test it, and define the drag semantics (move versus add) before building a board renderer [138, 146, 150].
2. **Single-parent assumptions and node-level ordering.** Payload nested-docs, paperless tags, Zotero collections, digiKam, Lightroom, TypeORM trees (from [1]) and Drupal's one weight per term all bake in one parent; retrofitting polyhierarchy breaks drag-and-drop and breadcrumbs. Delimiter conventions (`/`, `.`, `|`, `,`) also forbid those characters in names [30, 101, 107].
3. **Licence and viability traps.** AGPL (Triplit, Logseq, TagSpaces core, Zotero), BUSL parts (Meilisearch), source-available (Directus MSCL, Anytype ASAL, NocoDB Sustainable Use), GPL (`dag-browser-widget` per [1]); shutdowns (Instant Cloud ends 2027-08-31, Triplit acqui-hired); pre-1.0 APIs (TanStack DB 0.x, Jazz 2.0 alpha, PGlite 0.x). Implement formats from documentation, never copy code from GPL/AGPL projects [31, 66, 71, 149, 176].
4. **Forcing one CRUD contract onto engines that do not fit, and menu rot.** Electric has no write path, Zero queries are server-permissioned with app-defined mutators, Jazz alpha has no OR, Dexie indexes one multiEntry per query; react-admin's `filter: any` is a dead end [3]. Unmaintained community adaptors and stale first-party ones erode trust; Orama's broken disjunctive facets are the warning for engines [1]. Mitigate with capability declarations, a conformance suite and a quarantine label for unmaintained adaptors [55, 62, 70].
5. **Identity and portability.** Path as identity breaks on move or rename (TagSpaces sidecars, Dendron renames, xattrs lost on FAT/zip), denormalised copies drift (TagSpaces colours in every sidecar), semantics live only in each app (Obsidian prefix expansion and vault-global property types), and central databases lock tags in. Use a pluggable identity strategy (path, content hash, uuid) and keep semantics in the declared schema, not in app code [77, 78, 80, 86, 161].

## 8. Open and unverified items

- Not verifiable from primary sources: Hearst's 2006 SIGIR design recommendations (garbled PDF); Adobe's keyword help page (HTTP 403, snippet used); the MWG specification PDF; Eagle's on-disk `metadata.json` field names and whether items sit in several folders; Tabbles' current maintenance and polyhierarchy support; TagSpaces roles of `tsi/tst/tsb/tsl`; Dolphin's `parent/sub` convention inside `user.xdg.tags`; Triplit Cloud closing to new users; RxDB array-membership operators; hosted sandboxes for Dexie, Jazz, Instant, TanStack DB and Triplit; Zero and Triplit Standard Schema support; Directus hosted demo URL; Payload live demo; JSON Forms editable playground URL; AutoForm playground URL; Formily Designable behaviour; `ra-tree` details; Typesense and Datasette disjunctive counts; Notion drag-and-drop on a multi-select board; NocoDB grid group-by on multi-select; Teable and Directus multi-value grouping; closed-source status of Tana, Capacities, Bear, Roam and the Are.na platform; Bear multiple-parent behaviour and export; Org multi-group tags; Anytype API base URL and on-disk format; any parser for `.base` outside Obsidian; Bases group-by on multi-valued fields; Foam core as a library.
- Estimates in this report (adaptor effort in days, "dormant", "maintenance mode", "most community adaptors are unmaintained") are my own and are labelled where they occur.
- Next research step suggested by the gaps: a hands-on spike of a zodal DataProvider over TinyBase and Dexie that exercises the declared tag-filter capability, and a Zod schema for the view config in 3.7, before committing to either.

## REFERENCES

[1] zodal-groups research zgroups_04: JS/TS Library Landscape (zodal-groups repo, docs/research/zgroups_04-js-ts-library-landscape.md)

[2] zodal research 06: Prior Art and Ecosystem Landscape (zodal repo, docs/research/06-prior-art-and-landscape.md)

[3] zodal research 03: Technology Research Takeaways (zodal repo, docs/research/03-technology-research-takeaways.md)

[4] zodal-groups research zgroups_01: Classification Theory and Polyhierarchy, section 7 (zodal-groups repo, docs/research/)

[5] [react-admin on the npm registry](https://registry.npmjs.org/react-admin)

[6] [marmelab/react-admin repository metadata (GitHub API)](https://api.github.com/repos/marmelab/react-admin)

[7] [ra-core README](https://github.com/marmelab/react-admin/blob/master/packages/ra-core/README.md)

[8] [marmelab/shadcn-admin-kit](https://github.com/marmelab/shadcn-admin-kit)

[9] [react-admin: Data Providers list](https://marmelab.com/react-admin/DataProviderList.html)

[10] [npm registry search: keywords react-admin data-provider](https://registry.npmjs.org/-/v1/search?text=keywords:react-admin%20data-provider&size=250)

[11] [react-admin: Demos](https://marmelab.com/react-admin/Demos.html)

[12] [react-admin: ReferenceArrayInput](https://marmelab.com/react-admin/ReferenceArrayInput.html)

[13] [react-admin: ReferenceManyToManyInput (Enterprise)](https://marmelab.com/react-admin/ReferenceManyToManyInput.html)

[14] [marmelab/atomic-crm](https://github.com/marmelab/atomic-crm)

[15] [@refinedev/core on the npm registry](https://registry.npmjs.org/@refinedev/core)

[16] [refinedev/refine repository metadata (GitHub API)](https://api.github.com/repos/refinedev/refine)

[17] [Refine: Data Provider overview](https://refine.dev/docs/data/data-provider/)

[18] [Refine: useMany](https://refine.dev/docs/data/hooks/use-many/)

[19] [@tanstack/react-query on the npm registry](https://registry.npmjs.org/@tanstack/react-query)

[20] [@tanstack/react-table on the npm registry](https://registry.npmjs.org/@tanstack/react-table)

[21] [@tanstack/db on the npm registry](https://registry.npmjs.org/@tanstack/db)

[22] [TanStack DB: Collection Options Creator guide](https://tanstack.com/db/latest/docs/guides/collection-options-creator)

[23] [TanStack DB: Schemas guide](https://tanstack.com/db/latest/docs/guides/schemas)

[24] [TanStack DB: Overview](https://tanstack.com/db/latest/docs/overview)

[25] [TanStack DB: Live Queries guide](https://tanstack.com/db/latest/docs/guides/live-queries)

[26] [payloadcms/payload repository metadata (GitHub API)](https://api.github.com/repos/payloadcms/payload)

[27] [Payload: Database overview](https://payloadcms.com/docs/database/overview)

[28] [Payload: Relationship field](https://payloadcms.com/docs/fields/relationship)

[29] [Payload: Join field](https://payloadcms.com/docs/fields/join)

[30] [Payload: Nested Docs plugin](https://payloadcms.com/docs/plugins/nested-docs)

[31] [Directus licence file (Monospace Sustainable Core License)](https://github.com/directus/directus/blob/main/license)

[32] [Directus: Relationships (data model)](https://directus.com/docs/guides/data-model/relationships)

[33] [Directus: SDK guide](https://directus.com/docs/guides/connect/sdk)

[34] [Directus: Presets API](https://directus.com/docs/api/presets)

[35] [vantezzen/autoform](https://github.com/vantezzen/autoform)

[36] [vantezzen/autoform packages directory (GitHub API)](https://api.github.com/repos/vantezzen/autoform/contents/packages)

[37] [uniforms](https://uniforms.tools/)

[38] [uniforms: basic usage example](https://uniforms.tools/docs/examples/basic-usage)

[39] [JSON Forms: renderer sets](https://jsonforms.io/docs/renderer-sets)

[40] [@jsonforms/core on the npm registry](https://registry.npmjs.org/@jsonforms/core)

[41] [JSON Forms: multiple choice](https://jsonforms.io/docs/multiple-choice/)

[42] [alibaba/formily](https://github.com/alibaba/formily)

[43] [Puck documentation](https://puckeditor.com/docs)

[44] [Puck demo](https://demo.puckeditor.com/edit)

[45] [tinybase on the npm registry](https://registry.npmjs.org/tinybase)

[46] [TinyBase: setIndexDefinition](https://tinybase.org/api/indexes/interfaces/indexes/indexes/methods/configuration/setindexdefinition/)

[47] [TinyBase: An Intro To Relationships](https://tinybase.org/guides/using-relationships/an-intro-to-relationships/)

[48] [TinyBase: An Intro To Persistence](https://tinybase.org/guides/persistence/an-intro-to-persistence/)

[49] [TinyBase: Using Schematizers](https://tinybase.org/guides/schemas/using-schematizers/)

[50] [TinyBase: Demos](https://tinybase.org/demos/)

[51] [Dexie.js documentation (llms.txt)](https://dexie.org/llms.txt)

[52] [Dexie.js: MultiEntry Index](https://dexie.org/docs/MultiEntry-Index)

[53] [PGlite](https://pglite.dev/)

[54] [ElectricSQL: Shapes](https://electric-sql.com/docs/guides/shapes)

[55] [ElectricSQL: Writes](https://electric-sql.com/docs/guides/writes)

[56] [PGlite: Sync](https://pglite.dev/docs/sync)

[57] [PGlite REPL](https://pglite.dev/repl/)

[58] [rxdb on the npm registry](https://registry.npmjs.org/rxdb)

[59] [RxDB: RxStorage](https://rxdb.info/rx-storage.html)

[60] [RxDB: Population](https://rxdb.info/population.html)

[61] [Zero 1.0 release notes](https://zero.rocicorp.dev/docs/release-notes/1.0)

[62] [Zero: Schema](https://zero.rocicorp.dev/docs/zero-schema)

[63] [Zero: ZQL](https://zero.rocicorp.dev/docs/zql)

[64] [Gigabugs (Zero demo)](https://gigabugs.rocicorp.dev/)

[65] [aspen-cloud/triplit](https://github.com/aspen-cloud/triplit)

[66] [Triplit joins Supabase (Supabase blog)](https://supabase.com/blog/triplit-joins-supabase)

[67] [Triplit docs: relations](https://github.com/aspen-cloud/triplit/blob/main/packages/docs/src/pages/schemas/relations.mdx)

[68] [garden-co/jazz](https://github.com/garden-co/jazz)

[69] [Jazz: column types](https://jazz.tools/docs/schemas/column-types)

[70] [Jazz: filters and sorting](https://jazz.tools/docs/reading/filters-and-sorting)

[71] [The Instant team joins OpenAI](https://www.instantdb.com/essays/instant_team_joins_openai)

[72] [InstantDB: modeling data](https://www.instantdb.com/docs/modeling-data)

[73] [TagSpaces LICENSING.md](https://raw.githubusercontent.com/tagspaces/tagspaces/develop/LICENSING.md)

[74] [tagspaces/tagspaces-common](https://github.com/tagspaces/tagspaces-common)

[75] [tagspaces/tagspaces repository metadata (GitHub API)](https://api.github.com/repos/tagspaces/tagspaces)

[76] [TagSpaces docs: Tagging](https://docs.tagspaces.org/tagging/)

[77] [TagSpaces docs: meta file formats](https://docs.tagspaces.org/dev/metafileformats/)

[78] [TagSpaces forum: sidecar approach and file operations outside the app](https://tagspaces.discourse.group/t/sidecar-approach-is-there-any-way-to-not-break-tags-when-doing-file-operations-move-rename-outside-of-tagspaces/648)

[79] [oniony/TMSU](https://github.com/oniony/TMSU)

[80] [TMSU database schema (schema.go)](https://raw.githubusercontent.com/oniony/TMSU/master/storage/database/schema.go)

[81] [Tagsistant (Wikipedia)](https://en.wikipedia.org/wiki/Tagsistant)

[82] [Tabbles (Wikipedia)](https://en.wikipedia.org/wiki/Tabbles)

[83] [Eagle developer documentation: folder API](https://developer.eagle.cool/web-api/api/folder.md)

[84] [Eaglepack importer plugin (describes the .library layout)](https://community.obsidian.md/plugins/eaglepack-importer)

[85] [hydrusnetwork/hydrus](https://github.com/hydrusnetwork/hydrus)

[86] [Hydrus: getting started with tags](https://hydrusnetwork.github.io/hydrus/getting_started_tags.html)

[87] [Hydrus: tag siblings](https://hydrusnetwork.github.io/hydrus/advanced_siblings.html)

[88] [Hydrus: tag parents](https://hydrusnetwork.github.io/hydrus/advanced_parents.html)

[89] [Hydrus: Public Tag Repository](https://hydrusnetwork.github.io/hydrus/PTR.html)

[90] [digiKam release tags (KDE Invent API)](https://invent.kde.org/api/v4/projects/graphics%2Fdigikam/repository/tags)

[91] [digiKam database schema (dbconfig.xml.cmake.in)](https://invent.kde.org/graphics/digikam/-/raw/master/core/data/database/dbconfig.xml.cmake.in)

[92] [Exiv2: XMP digiKam namespace](https://exiv2.org/tags-xmp-digiKam.html)

[93] [Hierarchical keywords in Lightroom: be careful (Daminion)](https://daminion.net/articles/tips/hierarchical-keywords-in-lightroom-be-careful/)

[94] [Exiv2: XMP Lightroom namespace](https://exiv2.org/tags-xmp-lr.html)

[95] [IPTC Photo Metadata Standard 2025.1](http://iptc.org/std/photometadata/specification/IPTC-PhotoMetadata-2025.1.html)

[96] [Exiv2: XMP mwg-kw namespace](https://exiv2.org/tags-xmp-mwg-kw.html)

[97] [ExifTool: MWG tags](https://exiftool.org/TagNames/MWG.html)

[98] [Metadata Working Group (Wikipedia)](https://en.wikipedia.org/wiki/Metadata_Working_Group)

[99] [Eclectic Light: xattr com.apple.metadata:_kMDItemUserTags (Finder tags)](https://eclecticlight.co/2017/12/27/xattr-com-apple-metadata_kmditemusertags-finder-tags/)

[100] [Eclectic Light: does iCloud Drive now lose almost all metadata?](https://eclecticlight.co/2026/05/11/does-icloud-drive-now-lose-almost-all-metadata/)

[101] [KDE kfilemetadata: usermetadata.cpp](https://invent.kde.org/frameworks/kfilemetadata/-/raw/master/src/usermetadata.cpp)

[102] [Vishesh Handa: extended attributes updates (Baloo)](https://vhanda.in/blog/2014/08/extended-attributes-updates/)

[103] [freedesktop.org wiki: CommonExtendedAttributes (2024 archive)](https://web.archive.org/web/2024/https://www.freedesktop.org/wiki/CommonExtendedAttributes/)

[104] [Microsoft: System.Keywords property](https://learn.microsoft.com/en-us/windows/win32/properties/props-system-keywords)

[105] [paperless-ngx/paperless-ngx](https://github.com/paperless-ngx/paperless-ngx)

[106] [paperless-ngx: REST API documentation](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/api.md)

[107] [paperless-ngx: usage (Nested Tags)](https://raw.githubusercontent.com/paperless-ngx/paperless-ngx/dev/docs/usage.md)

[108] [paperless-ngx: advanced usage (matching)](https://github.com/paperless-ngx/paperless-ngx/blob/dev/docs/advanced_usage.md)

[109] [Calibre metadata_sqlite.sql](https://raw.githubusercontent.com/kovidgoyal/calibre/master/resources/metadata_sqlite.sql)

[110] [Calibre manual: sub-groups of tags](https://manual.calibre-ebook.com/sub_groups.html)

[111] [Calibre manual: the database API](https://manual.calibre-ebook.com/db_api.html)

[112] [zotero/zotero](https://github.com/zotero/zotero)

[113] [Zotero userdata.sql schema](https://raw.githubusercontent.com/zotero/zotero/main/resource/schema/userdata.sql)

[114] [Zotero: collections and tags](https://www.zotero.org/support/collections_and_tags)

[115] [Zotero tags.js](https://raw.githubusercontent.com/zotero/zotero/main/chrome/content/zotero/xpcom/data/tags.js)

[116] [simile-widgets/exhibit (GitHub API)](https://api.github.com/repos/simile-widgets/exhibit)

[117] [Huynh, Karger, Miller. Exhibit: Lightweight Structured Data Publishing. WWW 2007](https://people.csail.mit.edu/dfhuynh/research/papers/www2007-exhibit-submitted.pdf)

[118] [Exhibit wiki: Component Overview](https://github.com/simile-widgets/exhibit/wiki/Component-Overview)

[119] [Flamenco download page](https://flamenco.berkeley.edu/download.html)

[120] [Yee, Swearingen, Li, Hearst. Faceted Metadata for Image Search and Browsing. CHI 2003](https://flamenco.berkeley.edu/papers/flamenco-chi03.pdf)

[121] [Hearst. Clustering versus Faceted Categories for Information Exploration. CACM 2006](https://flamenco.berkeley.edu/papers/cacm06.pdf)

[122] [Hearst. Search User Interfaces, chapter 8](https://searchuserinterfaces.com/book/sui_ch8_navigation_and_search.html)

[123] [simonw/datasette repository metadata (GitHub API)](https://api.github.com/repos/simonw/datasette)

[124] [Datasette: Facets](https://docs.datasette.io/en/stable/facets.html)

[125] [Datasette fixtures: facet_array example](https://latest.datasette.io/fixtures/facetable.json?_facet_array=tags&_size=0)

[126] [Datasette: JSON API](https://docs.datasette.io/en/stable/json_api.html)

[127] [Datasette: plugin hooks](https://docs.datasette.io/en/stable/plugin_hooks.html)

[128] [simonw/datasette-lite](https://github.com/simonw/datasette-lite)

[129] [meilisearch/meilisearch](https://github.com/meilisearch/meilisearch)

[130] [Meilisearch: search API reference](https://www.meilisearch.com/docs/reference/api/search)

[131] [Meilisearch: filter expression reference](https://www.meilisearch.com/docs/learn/filtering_and_sorting/filter_expression_reference)

[132] [Meilisearch: disjunctive facets](https://www.meilisearch.com/docs/capabilities/filtering_sorting_faceting/advanced/disjunctive_facets.md)

[133] [instant-meilisearch README](https://cdn.jsdelivr.net/npm/@meilisearch/instant-meilisearch@0.31.4/README.md)

[134] [typesense/typesense repository metadata (GitHub API)](https://api.github.com/repos/typesense/typesense)

[135] [Typesense: search API documentation](https://raw.githubusercontent.com/typesense/typesense-website/master/docs-site/content/29.0/api/search.md)

[136] [typesense-instantsearch-adapter README](https://raw.githubusercontent.com/typesense/typesense-instantsearch-adapter/master/README.md)

[137] [Airtable community: grouping by multi-select issue](https://community.airtable.com/base-design-9/grouping-by-mullti-select-issue-30309)

[138] [Airtable community: multiselect grouping in Interface list differs from table](https://community.airtable.com/interface-designer-12/multiselect-grouping-in-interface-list-differs-from-table-39553)

[139] [Airtable: getting started with kanban views](https://support.airtable.com/docs/getting-started-with-airtable-kanban-views)

[140] [Airtable Web API: list views](https://airtable.com/developers/web/api/list-views)

[141] [Notion help: boards](https://www.notion.com/help/boards)

[142] [Thomas Frank: database grouping in Notion](https://thomasjfrank.com/database-grouping-in-notion-heres-everything-you-need-to-know/)

[143] [baserow/baserow repository metadata (GitHub API)](https://api.github.com/repos/baserow/baserow)

[144] [Baserow: group rows](https://baserow.io/user-docs/group-rows-in-baserow)

[145] [baserow issue 5782: group-by treats multiple select as a set](https://github.com/baserow/baserow/issues/5782)

[146] [baserow pull request 5783 (merged 2026-08-11)](https://github.com/baserow/baserow/pull/5783)

[147] [Baserow: guide to kanban view](https://baserow.io/user-docs/guide-to-kanban-view)

[148] [Baserow: plugin introduction](https://baserow.io/docs/plugins/introduction)

[149] [NocoDB LICENSE.md (Sustainable Use License)](https://github.com/nocodb/nocodb/blob/develop/LICENSE.md)

[150] [nocodb issue 6184: kanban by multi-select](https://github.com/nocodb/nocodb/issues/6184)

[151] [NocoDB: views](https://nocodb.com/docs/product-docs/views)

[152] [grist-core commit: empty-list rows in summary tables](https://github.com/gristlabs/grist-core/commit/1c89d08ea36df0cf48905c73925481de704fdcf7)

[153] [Teable: kanban view](https://help.teable.ai/en/basic/view/kanban)

[154] [Notion API: working with views](https://developers.notion.com/guides/data-apis/working-with-views.md)

[155] [Notion API: view reference](https://developers.notion.com/reference/view.md)

[156] [Obsidian: terms of service](https://obsidian.md/terms)

[157] [Obsidian: licence](https://obsidian.md/license)

[158] [obsidianmd/obsidian-releases latest release (GitHub API)](https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest)

[159] [Obsidian help: Bases views](https://github.com/obsidianmd/obsidian-help/blob/master/en/Bases/Views.md)

[160] [Obsidian help: Tags](https://github.com/obsidianmd/obsidian-help/blob/master/en/Editing%20and%20formatting/Tags.md)

[161] [Obsidian help: Properties](https://github.com/obsidianmd/obsidian-help/blob/master/en/Editing%20and%20formatting/Properties.md)

[162] [Obsidian help: Bases syntax](https://github.com/obsidianmd/obsidian-help/blob/master/en/Bases/Bases%20syntax.md)

[163] [Obsidian help: Bases Kanban view](https://github.com/obsidianmd/obsidian-help/blob/master/en/Bases/Layouts/Kanban%20view.md)

[164] [blacksmithgu/obsidian-dataview](https://github.com/blacksmithgu/obsidian-dataview)

[165] [Dataview: data commands](https://blacksmithgu.github.io/obsidian-dataview/queries/data-commands/)

[166] [JSON Canvas spec 1.0](https://github.com/obsidianmd/jsoncanvas/blob/main/spec/1.0.md)

[167] [logseq/logseq README](https://github.com/logseq/logseq)

[168] [Logseq docs: database version changes](https://github.com/logseq/docs/blob/master/db-version-changes.md)

[169] [Logseq docs: database version](https://github.com/logseq/docs/blob/master/db-version.md)

[170] [Tana: when to use Extend in supertags](https://outliner.tana.inc/learn/guides/when-to-use-extend-in-supertags)

[171] [Tana: Local API and MCP](https://outliner.tana.inc/learn/features/local-api-mcp)

[172] [Tana: Tana Paste](https://outliner.tana.inc/docs/tana-paste)

[173] [Capacities: content types](https://docs.capacities.io/reference/content-types)

[174] [Capacities: collections](https://docs.capacities.io/reference/collections)

[175] [Capacities: queries versus collections](https://docs.capacities.io/faq/editing/queries-vs-collections)

[176] [anytype-ts LICENSE (Any Source Available License 1.0)](https://github.com/anyproto/anytype-ts/blob/main/LICENSE.md)

[177] [anyproto/any-sync](https://github.com/anyproto/any-sync)

[178] [Anytype docs: types](https://doc.anytype.io/anytype/organize/types.md)

[179] [Anytype docs: collections](https://doc.anytype.io/anytype/organize/collections.md)

[180] [Anytype docs: queries](https://doc.anytype.io/anytype/organize/queries.md)

[181] [aredotna/sdk](https://github.com/aredotna/sdk)

[182] [Are.na API v3 OpenAPI specification](https://api.are.na/v3/openapi.json)

[183] [Are.na help: connections](https://help.are.na/docs/getting-started/connections.md)

[184] [Notion API: property schema object](https://developers.notion.com/reference/property-schema-object)

[185] [Bear FAQ: nested tags](https://www.bear.app/faq/nested-tags)

[186] [Bear community: tag feature request (parent/child tagging)](https://community.bear.app/t/tag-feature-request-selectively-put-some-notes-in-parent-child-tags/13237)

[187] [Ness Labs: pages, tags and attributes in Roam Research](https://nesslabs.com/pages-tags-attributes-roam-research)

[188] [Dendron discussion 3890: maintenance mode](https://github.com/dendronhq/dendron/discussions/3890)

[189] [Johnny.Decimal forum: Dendron hierarchical note filename format](https://forum.johnnydecimal.com/t/dendrons-hierarchical-note-filename-format/532)

[190] [Foam docs: tags](https://github.com/foambubble/foam/blob/main/docs/user/features/tags.md)

[191] [Org mode manual: tag inheritance](https://orgmode.org/manual/Tag-Inheritance.html)

[192] [Org mode manual: setting tags](https://orgmode.org/manual/Setting-Tags.html)

[193] [Org mode manual: tag hierarchy](https://orgmode.org/manual/Tag-Hierarchy.html)

[194] [Org-roam manual](https://www.orgroam.com/manual.html)

[195] [Zettelkasten (Wikipedia)](https://en.wikipedia.org/wiki/Zettelkasten)
