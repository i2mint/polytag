---
name: polytag
description: Use when an app needs create/read/update/delete over a collection of items organised by tags, folders, labels or categories, especially when an item can be in several folders at once. Triggers on "add CRUD over this data with this UI", "organise my files with tags and browse them in a web app", "file explorer UI for a folder of documents", "an item in several folders at once", "pick a backend and a UI for a collection", "tag these items", "nested tags", "folders that overlap", "a tag editor", "bulk tag a selection", "faceted filter over tagged items", "import this CSV / YAML / JSON of tagged items", "what would exporting this to CSV lose". Walks the decision flow (where the data lives, which grammar reads it, which profile, which backend, which view) over polytag, @zodal/groups-* and zodal, with menus generated from the registries.
metadata:
  audience: users
---

# polytag: CRUD over tagged collections

polytag is headless CRUD for collections whose items belong to groups: folders that overlap, tags that nest, labels, facets. It sits on [zodal-groups](https://github.com/i2mint/zodal-groups) (the membership model) and [zodal](https://github.com/i2mint/zodal) (records, stores, UI). Install: `npm install polytag @zodal/groups-core @zodal/core zod`.

**Availability (check before promising an API):** `polytag`, `@zodal/groups-collection` and `@zodal/groups-store-fs` are not on npm yet, and the npm `@zodal/groups-*` 0.1.0 releases predate `inferProfile`, `createMemoryGroupStore` and the tag input's `onWrite`. Until they publish, depend on the repos' workspace packages. Run `npm view <package> versions` when it matters.

**The one idea to keep:** membership is the data, a flat set of `(group, item)` edges. A folder tree, a tag cloud, a facet panel and a breadcrumb are views computed from those edges. So "folders or tags?" is not a data-model choice; it is a **profile** (how many parents an item may have) plus a **view**.

## The decision flow

Answer these in order. Each step has a default; ask the user only when the default clearly does not fit.

### 1. Where does the data live now?

A file or a text (JSON, YAML, TOML, CSV, Markdown frontmatter) → read it with `readText`, which detects the format and the grammar. Records already in a store (a database, an API, `localStorage`) → skip to step 3; their tags are usually a `string[]` field ("embedded" memberships).

```ts
import { readText, exportChoices, writeText, toCollectionSeed } from 'polytag';

const read = await readText(text, { filename: 'recipes.yaml' });
read.space;        // { nodes, edges }: the canonical relation
read.diagnostics;  // located problems; reading never throws on bad data
read.detection;    // ranked candidates with evidence, and whether to ask the user
```

Untrusted input: parse in a Web Worker (some parsers are super-linear on hostile text); `readText` caps size (`maxBytes`, default 32 MiB).

### 2. Which grammar reads it?

A **format** is the syntax (YAML); a **grammar** is how items, groups and memberships are laid out in it (nested folders, a tags column, a group → members map). Detection usually picks right; when `read.detection` says to ask, show the user the candidates' previews.

<!-- BEGIN generated:formats -->
| format | name | extensions | reads as | import default | export default |
|---|---|---|---|---|---|
| `json` | JSON | `.json` | value | `nested` | `node-link` |
| `jsonc` | JSON with comments | `.jsonc`, `.json5` | value | `nested` | `node-link` |
| `yaml` | YAML | `.yaml`, `.yml` | value | `nested` | `node-link` |
| `toml` | TOML | `.toml` | value | `tags-array` | `edge-rows` |
| `csv` | CSV | `.csv` | table | `delimited` | `edge-rows` |
| `tsv` | TSV | `.tsv`, `.tab` | table | `delimited` | `edge-rows` |
<!-- END generated:formats -->

What each grammar keeps (`convention`: kept by an encoding convention, such as YAML anchors or a path separator, and reported as such):

<!-- BEGIN generated:grammars -->
| grammar | what it is | formats | item in several groups | nested groups | group in several groups | group metadata | typed edges |
|---|---|---|---|---|---|---|---|
| `nested` | Folders as nested objects with children arrays; array position is the order. Several parents: copies (JSON), anchors (YAML) or refs. | `json`, `jsonc`, `yaml`, `toml` | convention | yes | convention | yes | no |
| `tags-array` | Each item lists its groups. Flat: group → group edges, group metadata and group order are not written. | `json`, `jsonc`, `yaml`, `toml` | yes | no | no | no | no |
| `tag-paths` | Each item lists the paths of its groups (food/italian); prefixes give the nesting. Group metadata and group order are not written. | `json`, `jsonc`, `yaml`, `toml` | yes | yes | convention | no | no |
| `members-map` | Each group lists its members; a member that is also a key is a nested group. Node labels and payloads are not written. | `json`, `jsonc`, `yaml`, `toml` | yes | yes | yes | no | no |
| `edge-rows` | One row per membership (parent, child, kind, label, order) plus node rows: the canonical relation. Lossless. | `json`, `jsonc`, `yaml`, `toml`, `csv`, `tsv` | yes | yes | yes | yes | yes |
| `delimited` | A CSV row per item, its groups in one cell separated by a delimiter (optionally as paths). Flat unless paths are used. | `csv`, `tsv` | yes | no | no | no | no |
| `one-hot` | A CSV row per item and a boolean column per group. Flat; no order, labels or group metadata. | `csv`, `tsv` | yes | no | no | no | no |
| `node-link` | Nodes and edges as a graph: JSON Graph Format v2 (also reads d3 / NetworkX node-link and Cytoscape). Lossless. | `json`, `jsonc`, `yaml`, `toml` | yes | yes | yes | yes | yes |
<!-- END generated:grammars -->

**Before writing, show the loss.** `exportChoices(space, { format })` lists every grammar for that format with its loss report, best first; `writeText` returns the same report as `out.loss`. Never export silently to a lossy grammar: `node-link` (JSON) and `edge-rows` (CSV) are lossless.

### 3. Which profile?

The profile is the rule set over the one model. Pick the most restrictive that fits the user's words ("folders" → `filesystem`, "tags" → `flatTags`, "labels like Gmail" → `labels`, "an item in several folders" → `polyhierarchy`). Not sure? `inferProfile(space)` from `@zodal/groups-core` names the tightest profile the data already satisfies.

<!-- BEGIN generated:profiles -->
| profile | for | parents per item | parents per group | group depth | groups in groups | ordered |
|---|---|---|---|---|---|---|
| `filesystem` | folders: an item, and a folder, in exactly one place | 1 | 1 | any | yes | yes |
| `flatTags` | flat tags: many per item, no tags on tags | any | any | 0 | no | no |
| `nestedTags` | nested tags (`a/b`): many per item, the tag tree is a tree | any | 1 | any | yes | no |
| `labels` | Gmail labels: many per item, the label tree is a tree | any | 1 | any | yes | no |
| `polyhierarchy` | the general case: items and groups in several groups | any | any | any | yes | no |
| `taxonomy` | deprecated | any | any | any | yes | no |
| `thesaurus` | typed edges (`is_a`, `part_of`, `related`) with closure per kind | any | any | any | yes | no |
| `folksonomy` | flat tags whose memberships are per user | any | any | 0 | no | no |
<!-- END generated:profiles -->

### 4. Which backend?

polytag's own backend menu is not built yet ([i2mint/polytag#2](https://github.com/i2mint/polytag/issues/2)). Today, compose it:

- **Item records**: any zodal `DataProvider`: `createInMemoryProvider` (`@zodal/store`), `@zodal/store-localstorage`, `@zodal/store-fs`, `@zodal/store-http`, `@zodal/store-s3`, `@zodal/store-supabase`.
- **Memberships**: embedded (a `string[]` of group ids on each record; flat tags and labels over any provider) or a `GroupStore` (`createMemoryGroupStore` in `@zodal/groups-core`, `@zodal/groups-store-fs` for a JSON sidecar file) when groups nest, edges carry kinds, labels or order, or groups need their own names.
- **One object over both**: `defineTaggedCollection({ provider, spaces })` from `@zodal/groups-collection` gives create / tag / untag / bulkTag / rename / merge / delete, each returning the inverse that undoes it. `toCollectionSeed(read)` turns a polytag read into its records and named spaces.

### 5. Which view?

polytag's ranked view menu is not built yet ([i2mint/polytag#3](https://github.com/i2mint/polytag/issues/3)). Today, the views are zodal-groups projections drawn by a renderer:

| the user says | view | from |
|---|---|---|
| "a file explorer", "folders" | tree, or Miller columns for deep trees | `renderTree` / `renderColumns` (`@zodal/groups-ui-vanilla`) over `projectTree` / `projectColumns` |
| "filter by tags", "facets", "a sidebar" | one facet panel per family (OR within, AND across) | `facetPanel` / `renderFacets`; one call per family is a single pass over the items |
| "tag this item" | chip input with full paths | `renderTagInput`; `onWrite(delta)` persists and rolls back on failure |
| "tag a selection", "bulk edit tags" | tri-state menu, staged, "Apply to N items" | `renderTagMenu` (`@zodal/groups-ui-vanilla`) |
| "where is this item?" | breadcrumbs plus "also in" | `renderBreadcrumbs`, `otherLocations` |
| "a table of the items" | zodal's collection UI, with a tags column | the `zodal-collection-ui` skill |

React and shadcn renderers for the group views are not shipped yet; use the vanilla ones in a ref, or the headless projections directly.

## Rules that save a rewrite

- **Drag means add, not move**, unless the profile is `filesystem`. Moving silently drops the item's other memberships.
- **Remove from a group is not delete.** The item and its other memberships stay.
- **Counts are de-duplicated over the closure**, never a sum of child counts (an item under two subgroups counts once).
- **Expansion is keyed by path, selection by node id.** The same group can appear twice in a tree.
- **Load existing data as a seed** (`defineGroups({ edges })` or `createGroupSpace({ nodes, edges })`), never with `add()` in a loop.
- **An agent's edits are proposals**: keep them out of the human's undo stack, with their own origin.

## Where to read more

- polytag: [synthesis](https://github.com/i2mint/polytag/blob/main/docs/research/synthesis.md), [ADR 0001](https://github.com/i2mint/polytag/blob/main/docs/decisions/0001-placement-and-seams.md), [UI patterns](https://github.com/i2mint/polytag/blob/main/docs/research/ui-patterns.md), [formats and grammars](https://github.com/i2mint/polytag/blob/main/docs/research/formats-and-grammars.md).
- The model and its decisions: [zodal-groups](https://github.com/i2mint/zodal-groups) README and `docs/research/_reconciliation.md`.
- Records, stores and tables: the `zodal-collections` and `zodal-collection-ui` skills.

The tables above are generated from the registries by `scripts/gen-skill-tables.mjs`; CI fails when they drift.
