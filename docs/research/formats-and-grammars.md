# Research 06 — Data formats and grammars for flat+structure data

Date: 2026-10-04. Scope: interchange and text formats only (JSON, YAML, TOML, CSV, XML, Markdown frontmatter, sidecar files, RDF, filesystem listings). Encodings inside databases are out of scope and already covered in the group-storage report [3].

Evidence labels used below: **[verified]** = read in the cited source this session; **[measured]** = I ran it this session (scripts in a scratch directory, library versions given; see [55]); **[estimate]** = my own judgement or a number I could not source; **[unverified]** = a claim I could not confirm.

## 0. Summary and recommendation

1. **A format is not a grammar.** A *format* (JSON, YAML, TOML, CSV, XML) decides syntax and which value shapes exist. A *grammar* decides how items, groups and memberships are encoded in those shapes. One grammar can live in several formats (the "items with a tags array" grammar exists in JSON, YAML, TOML, CSV-with-a-delimited-cell and Markdown frontmatter), and one format hosts many grammars. The playground therefore needs two registries and a compatibility matrix, not one list of "formats".
2. **Every grammar is a lossy or lossless view of the canonical relation** `{id, parent, child, kind, label?, order?, meta?}` over a flat `nodes[]` + `edges[]` [1]. Only three grammars are lossless for everything: the **edge list with a nodes table**, **node-link JSON (JSON Graph Format and relatives)**, and **JSON-LD/SKOS with reified membership**. Everything else drops or conventionalises something, and the drop is *predictable per grammar*, so the registry can compute it before it writes a byte (section 8).
3. **The strongest single finding for the design:** the lossless-for-profile question is decided by about eight capability flags (multi-parent items, nested groups, multi-parent groups, group metadata, edge order, edge labels, empty groups/orphans, item identity basis). Section 4 tabulates them for every grammar. A grammar is `{detect, parse → nodes+edges, serialise ← nodes+edges, capabilities, params}`, and the lossiness report is `capabilities` minus the features the dataset actually uses.
4. **Three structural traps** the codecs must handle explicitly: (a) *order lives in arrays only* — JSON objects are "unordered" [48] and TOML tables are "not guaranteed to be in any specific order" [30], so edge `order` must be derived from array position or a column; (b) *a path is an identity, not a route* in path-string tags (Obsidian, Lightroom, digiKam), so a group with two parents is unrepresentable there [2]; (c) *YAML numerics and aliases bite*: `010` parses to the number 10 and one anchor aliased more than 100 times throws by default, both [measured].
5. **Container problem.** Several grammars (frontmatter+folder, sidecars, filesystem listings) are *multi-file*. A paste box holds one text, so the pipeline must be `text|file|dir|zip → Bundle (path → bytes) → FormatCodec → GrammarCodec → GroupSpace`, where single-file formats are a Bundle of one. Browsers can supply relative paths for a picked directory via `webkitRelativePath` [45] but, as far as I could find, no inode or symlink information (absence **[unverified]**).
6. **Libraries (section 7):** depend on `yaml` (ISC, comment-preserving Document API, anchors), `smol-toml` (BSD-3, TOML 1.1), `papaparse` (MIT, browser-first, delimiter sniffing) and `jsonc-parser` (MIT); use the browser's `DOMParser` for XML-family grammars; **do not** depend on `gray-matter` (stale since 2021, drags in js-yaml 3, I measured a 17 kB gzip bundle that duplicates the YAML engine) — write a 30-line frontmatter splitter over the format codecs instead; make `jsonld` an optional lazy peer. Everything is lazy-loaded per chosen format; measured gzip sizes are 30.6 kB (yaml), 6.5 kB (smol-toml), 7.3 kB (papaparse), 5.7 kB (jsonc-parser) [measured].
7. **Defaults per format** (section 8.4): JSON → nested tree for the familiar demo, node-link for lossless export; YAML → nested tree with anchors as the "polyhierarchy in a human format" showcase; TOML → `[[items]]` with `tags` (familiar) and `[[node]]`/`[[edge]]` (lossless); CSV → items + delimited tags (familiar) and edge rows + nodes table (lossless); Markdown → frontmatter tags + folder; XML → OPML; JSON-LD → SKOS.

## 1. What already exists in the fleet, and what is missing

- The canonical model is settled: one relation of reified edges, flat `nodes[]` + `edges[]`, names and order on the edge, unified node type, `Member = ref | value` with content-hash identity for literals, no recursive Zod schema, and a constraint-profile ladder (`filesystem`, `flatTags`, `nestedTags`, `labels`, `polyhierarchy`, `thesaurus`, `folksonomy`) [1]. Decisions D1, D4, D5, D18, D20 are the ones this report must not contradict, and nothing below does; the implemented types confirm the edge fields [8].
- The theory report already documents SKOS (non-transitive `broader`, `Collection` disjoint from `Concept`), and the path-as-string camp (Obsidian, Gmail labels, Bear, Logseq) versus real parent edges [2 §3.3, §5]. I do not repeat that; I only add the *serialisation* consequences.
- The storage report covers the filesystem adapter and recommends a **sidecar manifest, not symlinks** for a DAG on disk [3 §4.2]. Grammars (k) and (l) below are the *interchange* side of the same question.
- The library-landscape report concluded that the RDF/SKOS JS stack ships no broader/narrower traversal helper and that we should "steal SKOS's vocabulary" but not build on RDF [4]. This report keeps that: JSON-LD/SKOS is a grammar over our model, not a storage engine.
- The settings-specialisation research already established the **codec architecture** this report extends: codecs at two levels (field-level `Codec<TEncoded, TDecoded>` and provider-level `wrapProvider(provider, codec)`), codecs compose by chaining, and format is a pluggable codec keyed by extension [5]. It also established the **round-trip law that applies here**: comment- and format-preserving writes need a *document model* (edit scripts such as `jsonc-parser`'s `modify()` + `applyEdits()`, `tomlkit`, `ruamel.yaml`), never parse → mutate → serialise, and patches model values, not text [6][7]. The recommendation there — separate the value layer from the format-preserving writer — is adopted unchanged in section 8.
- **Missing in the fleet** (this report's contribution): a catalogue of *grammars* for items-in-groups data, their expressiveness, auto-detection, and a registry design. No prior document names the grammars or their loss profiles.

## 2. Vocabulary and the reference dataset

**Format**: a syntax with a parser/serialiser (JSON, YAML, TOML, CSV, XML, Markdown+frontmatter). **Grammar**: a convention that maps items, groups and memberships onto a format's shapes. **Container**: how one or many documents arrive (pasted text, uploaded file, picked directory, zip). **Profile**: a named set of restrictions on the model [1 §3]. **Lossiness**: information in a `GroupSpace` that a grammar cannot carry; three severities are used below — *drop* (gone), *degrade* (kept in a different form, e.g. duplicated or materialised), *encode* (kept by a convention that other tools will not understand).

### 2.1 The reference dataset (RD), used in every example

Five items, four groups. Groups: `food`, `italian`, `vegetarian`, `quick`. Items: `carbonara`, `margherita`, `salad`, `ramen`, `notes`.

| Edge (parent → child) | Kind of fact |
|---|---|
| `food → italian`, `food → vegetarian` | nested groups (group tree) |
| `italian → carbonara`, `quick → carbonara` | carbonara has two parents |
| `italian → margherita`, `vegetarian → margherita` | margherita has two parents |
| `vegetarian → salad`, `quick → salad` | salad has two parents |
| `food → ramen` | ramen is directly in the top group |
| (none) | `notes` is an orphan (in no group) |

Nine nodes, nine edges, `kind = contains` throughout. RD sits in the `labels` profile (items multi-parent, groups form a tree) [1 §3]. Where a grammar needs to show *true polyhierarchy* I add a synthetic delta **P**: group `italian` also becomes a child of `quick` (a group with two parents). Per-edge `label` and `order` are shown where a grammar can carry them; RD itself has none.

### 2.2 Fixtures as acceptance tests

Every example below is a fixture for the RD in one grammar × format. A conformance suite should assert: each fixture parses to RD (modulo declared losses), and RD serialises back to a fixture that parses to the same space. The examples in this document are syntax-checked as part of writing this report (JSON, YAML, TOML, CSV) [55].

## 3. Catalogue of grammars

Notation: "multi-parent" = an item (or group) in more than one group.

### (a) Nested tree — folders as nested objects or arrays

Three sub-variants matter.

**(a1) Nested, duplicate on multi-parent** (the familiar `{name, children}` shape; the d3 hierarchy family; **[unverified]** exact accessor defaults, I did not re-read the d3-hierarchy page):

```json
[
  {"name": "food", "children": [
    {"name": "italian", "children": ["carbonara", "margherita"]},
    {"name": "vegetarian", "children": ["margherita", "salad"]},
    "ramen"]},
  {"name": "quick", "children": ["carbonara", "salad"]},
  "notes"
]
```

Expresses: nested groups, ordered children (array position = rank in that parent, which is exactly D4's group-major order), the orphan as a root-level item, empty groups (`"children": []`). Multi-parent items work only by **repeating** the item; identity must then come from an `id`/name, and the copies can drift (two copies of `margherita` with different payloads). A group with two parents (delta P) repeats the *whole subtree*, so size grows with the number of root paths — the combinatorial failure the storage report documents for materialised paths [3 §1.2]. Group metadata needs a wrapper object (`{name, meta, children}`). Edge labels are free only in the keyed-object variant (`{"food": {"italian": …}}`), where the key *is* the child's name within its parent (a dentry-style name, D4) — but then order is lost, because JSON objects are an "unordered collection" [48] and TOML tables carry "no guaranteed order" [30].

**(a2) Nested with references.** Express the second occurrence as a reference instead of a copy. In YAML this is native: an anchor on first occurrence and aliases after.

```yaml
- name: food
  children:
    - name: italian
      children: [&carbonara {id: carbonara}, &margherita {id: margherita}]
    - name: vegetarian
      children: [*margherita, &salad {id: salad}]
    - &ramen {id: ramen}
- name: quick
  children: [*carbonara, *salad]
- &notes {id: notes}
```

The YAML 1.2 spec defines the first occurrence as identified by an anchor and each later one as an alias node, aliases must refer *backward*, the representation is a graph in which "a node may have more than one incoming edge", and **cycles are permitted** [31]. Both `yaml` and `js-yaml` resolve an alias to the *same JS object* and, on stringify, re-emit repeated object identity as anchor + alias (`aliasDuplicateObjects` is on by default in `yaml` [10]) [measured: `yaml` 2.9.1, `js-yaml` 5.4.2]. So a DAG held in memory as shared objects round-trips through YAML natively. Two measured traps: (1) `yaml` throws "Excessive alias count indicates a resource exhaustion attack" when **one anchor is aliased 150 times** (default `maxAliasCount` is 100 [10]) while 150 *distinct* anchors each aliased once parse fine — a popular group referenced from many items trips the default; (2) a cycle written with an alias parses to a self-referential object (`o.self === o`), which D8 forbids on write, so the parser must detect and report it rather than hand it to the projections. JSON has no standard in-document reference: the "JSON Reference" `{"$ref": "…"}` was an Internet-Draft that expired in 2012 [42] and its fragment syntax is JSON Pointer (RFC 6901, e.g. `/foo/0`) [43]. Use explicit id-references (`{"ref": "margherita"}`) in JSON rather than `$ref`.

**(a3) Parent pointer ("adjacency list").** One row per node with a `parent` column; single parent only.

```csv
id,parent,kind
food,,group
italian,food,group
vegetarian,food,group
carbonara,italian,item
margherita,italian,item
salad,vegetarian,item
ramen,food,item
```

This is `d3.stratify`'s input: it requires **one parent per node**, unique ids, **exactly one root**, and no cycles, and errors on missing parents [33]. Frictionless Table Schema can declare it: a foreign key whose reference resource is the empty string is a **self-referencing** key [15]. RD cannot be expressed (margherita would need two rows; that is grammar (e)). Rejected as canonical in D1; kept as the `filesystem`-profile grammar.

### (b) Items with a tags array (flat)

```json
[
  {"id": "carbonara",  "tags": ["italian", "quick"]},
  {"id": "margherita", "tags": ["italian", "vegetarian"]},
  {"id": "salad",      "tags": ["vegetarian", "quick"]},
  {"id": "ramen",      "tags": ["food"]},
  {"id": "notes",      "tags": []}
]
```

The most common shape in the wild (Hugo front matter takes taxonomy terms as arrays [39]; Obsidian's `tags` property must be a list [19]; Jekyll accepts a list or a whitespace-separated string and **splits the string on whitespace** — `tags: classic hollywood` becomes two tags [40]). Expresses: multi-parent items, orphans (empty array). Cannot express: any group→group edge (RD's `food → italian` and `food → vegetarian` are **dropped**, so RD round-trips 7 of 9 edges), empty groups (a tag with no items does not exist), group metadata, edge labels. Order is **item-major** only: it ranks the groups *of an item*, not the children *of a group*, so per-group child order (D4's `order`) is unrecoverable. Identity of a tag is its string (D18: literals identified by content, `hash('cheese') = 'cheese'` [1]).

### (c) Path-string tags ("food/italian", Obsidian-style nested tags)

```yaml
carbonara:  [food/italian, quick]
margherita: [food/italian, food/vegetarian]
salad:      [food/vegetarian, quick]
ramen:      [food]
notes:      []
```

Obsidian creates hierarchy "by using forward slashes" (`#inbox/to-read`), and `tag:inbox` matches `#inbox` and all nested tags [19]. Parsing rule: split on the separator, create the chain of groups and `parent → child` edges between consecutive segments, attach the item to the **leaf** only. RD round-trips fully: `food → italian` and `food → vegetarian` come from the prefixes; `ramen`'s explicit `food` tag is a direct edge, while `carbonara` is *not* directly in `food` (closure is read-time, D9 [1]). Two writer conventions must be declared in `params`: `leafOnly` (write only leaf paths, Obsidian) versus `materialised` (also write every ancestor, which is what Lightroom does; see (k)); and the separator (`/` Obsidian, `|` Lightroom [20], `:` Hydrus namespaces [26][27]).

Cannot express: a **group with two parents** (delta P would need `quick/italian` and `food/italian`, which are *two different nodes* because the path is the identity [2 §5.1]), group metadata, empty groups, per-edge labels. Renaming a group rewrites every item that mentions it (an O(items) migration, [2]). Characters: Obsidian allows letters, digits, `_`, `-`, `/`, Unicode, requires one non-numeric character, and allows no spaces [19] — the codec must quote or reject names that violate the target tool's tag grammar.

### (d) Group → members map (inverse index)

```json
{
  "food":       ["italian", "vegetarian", "ramen"],
  "italian":    ["carbonara", "margherita"],
  "vegetarian": ["margherita", "salad"],
  "quick":      ["carbonara", "salad"]
}
```

The oldest instance is Unix `/etc/group`: `group_name:password:GID:user_list`, with the user list comma-separated [47]. Expresses: nested groups (a group id may appear in another group's list), **multi-parent groups** (the same id in two lists, delta P), empty groups, and **group-major order** (array position = rank *within that parent*, exactly D4). Cannot express: orphans (`notes` appears nowhere, so an `items` list is needed), item payload, group metadata or edge labels unless members become objects (`{"id": "margherita", "label": "Margherita (veg)"}`). Of the flat grammars it is the one closest to the canonical relation — it is the *inverse index* of D2 serialised as text.

### (e) Edge list / long format (tidy data)

```csv
parent,child
food,italian
food,vegetarian
italian,carbonara
quick,carbonara
italian,margherita
vegetarian,margherita
vegetarian,salad
quick,salad
food,ramen
```

Wickham's tidy-data rules — each variable a column, each observation a row, each type of observational unit a table [37] — make this the *normalised* form: one row per membership. The full form is the canonical relation itself, `id,parent,child,kind,label,order`, plus a second table of nodes (`id,label,…payload`), which Table Schema models with a `foreignKeys` entry from `edges.parent`/`edges.child` to `nodes.id` [15]. Lossless for everything **provided the nodes table exists** (orphans and empty groups have no edge rows, so an edge-only CSV loses `notes`). A two-column `item,group` form is the usual spreadsheet export; its direction (item→group or group→item) is ambiguous and must be a detected-or-asked parameter (section 6). Pitfalls: RFC 4180 CSV is an informational "common format" with "considerable differences among implementations" and no types [36], so `order` must be written as a string column and numbers re-typed on read.

### (f) Wide / one-hot columns

```csv
id,food,italian,vegetarian,quick
carbonara,0,1,0,1
margherita,0,1,1,0
salad,0,0,1,1
ramen,1,0,0,0
notes,0,0,0,0
```

One boolean column per group. Expresses multi-parent items, orphans (all zeros) and empty groups (an all-zero column) — the only grammar besides (d) that keeps empty groups cheaply. Cannot express group nesting (`food ⊃ italian` is lost) unless header names carry paths (`food/italian`, which makes it grammar (c) in disguise), edge order, labels, or group metadata. Truthiness is **not standardised**: Table Schema's boolean defaults are `true/True/TRUE/1` and `false/False/FALSE/0` [15], while real exports use `x`, `yes`, blank, `Y`; so the codec has `trueValues`/`falseValues` params and detection must check the column domain (section 6). The standard conversion from a delimited column to one-hot is pandas `Series.str.get_dummies(sep='|')` [44]; the inverse (one-hot → tags) is the writer. Column count grows with the number of groups, so it does not scale to thousands of tags.

### (g) Delimited multi-value cell

```csv
id,title,groups
carbonara,Pasta carbonara,italian;quick
margherita,Margherita,italian;vegetarian
salad,Salad,vegetarian;quick
ramen,Ramen,food
notes,Notes,
```

A list packed in one cell. Standards: CSV on the Web (CSVW) defines a column `separator` — "a string value used to create multiple values of cells in this column by splitting" — plus an `ordered` flag saying whether the value order matters [16]; Frictionless Table Schema has an `array` type but **no separator**: the array is "valid JSON format arrays" [15], so a Table-Schema-conformant CSV writes `["italian","quick"]` in the cell. Real delimiters seen: `;`, `,` (needs quoting), `|` (pandas default [44]; Lightroom's hierarchy delimiter [20]), and `/etc/group`'s comma [47]. Same expressiveness as (b) (flat), plus the hazard that a tag containing the delimiter silently splits. With path-tags in the cell (`food/italian;quick`) it becomes (c)+(g). `ordered` in CSVW is the only place a text-table standard says whether cell order is significant.

### (h) Nodes + edges, node-link JSON (and GraphML / GEXF / Cytoscape as references)

JSON Graph Format v2 [17]:

```json
{"graph": {
  "directed": true,
  "nodes": {
    "food": {"label": "Food"}, "italian": {}, "vegetarian": {}, "quick": {},
    "carbonara": {"label": "Pasta carbonara"}, "margherita": {}, "salad": {}, "ramen": {}, "notes": {}
  },
  "edges": [
    {"source": "food",       "target": "italian",    "relation": "contains"},
    {"source": "food",       "target": "vegetarian", "relation": "contains"},
    {"source": "italian",    "target": "carbonara",  "relation": "contains", "label": "Carbonara", "metadata": {"order": "a0"}},
    {"source": "quick",      "target": "carbonara",  "relation": "contains"},
    {"source": "italian",    "target": "margherita", "relation": "contains"},
    {"source": "vegetarian", "target": "margherita", "relation": "contains"},
    {"source": "vegetarian", "target": "salad",      "relation": "contains"},
    {"source": "quick",      "target": "salad",      "relation": "contains"},
    {"source": "food",       "target": "ramen",      "relation": "contains"}
  ]
}}
```

JGF v2 uses a **map keyed by node id** for `nodes` (v1 used an array), edges as an array of `{source, target, relation, directed?, label?, metadata?}`, optional hyperedges, a `graphs` array for several graphs, and `metadata` objects at graph, node and edge level [17]. Our edge maps to a JGF edge with `source = parent`, `target = child`, `relation = kind`, `label = label`; JGF has **no `id` or `order` field** on an edge, so `id` and `order` travel in `metadata` **[verified: field list from the spec repository summary; I did not read the JSON Schema itself]**. Lossless for the whole model, including group metadata (node `metadata`), empty groups and orphans (nodes without edges). Related shapes the detector must also accept: the `{nodes: […], links: […]}` convention used by d3-force examples [53]; NetworkX `node_link_data`, whose current documented defaults are `nodes`/`edges` plus `directed`, `multigraph`, `graph` [51] (**[unverified]** that older releases defaulted to `links`; accept both); Cytoscape.js `elements` where a compound node's `parent` field is *single-valued and immutable* [32], so Cytoscape's *hierarchy* is a single-parent grammar while its *edges* can carry multi-parent; GraphML, whose `<graph>` can nest inside a `<node>` (nested graphs), supports hyperedges and ports, and declares `edgedefault` directed/undirected [34]; and GEXF, which states it can host "hierarchical structure" with nodes hosting nodes [35]. XML members of this family parse with the browser's `DOMParser` (no library) [50]; it is not available in Web Workers or Node [50], so a worker-based playground needs a fallback (section 7).

### (i) JSON-LD / SKOS

```json
{
  "@context": {"skos": "http://www.w3.org/2004/02/skos/core#", "dcterms": "http://purl.org/dc/terms/", "@base": "https://example.org/"},
  "@graph": [
    {"@id": "food",       "@type": "skos:Concept", "skos:prefLabel": "food",
      "skos:narrower": [{"@id": "italian"}, {"@id": "vegetarian"}]},
    {"@id": "italian",    "@type": "skos:Concept", "skos:prefLabel": "italian"},
    {"@id": "vegetarian", "@type": "skos:Concept", "skos:prefLabel": "vegetarian"},
    {"@id": "quick",      "@type": "skos:Concept", "skos:prefLabel": "quick"},
    {"@id": "carbonara",  "dcterms:title": "Pasta carbonara", "dcterms:subject": [{"@id": "italian"}, {"@id": "quick"}]},
    {"@id": "margherita", "dcterms:subject": [{"@id": "italian"}, {"@id": "vegetarian"}]},
    {"@id": "salad",      "dcterms:subject": [{"@id": "vegetarian"}, {"@id": "quick"}]},
    {"@id": "ramen",      "dcterms:subject": {"@id": "food"}},
    {"@id": "notes"}
  ]
}
```

SKOS: `skos:broader`/`skos:narrower` assert only **direct** links; closure is the separate `broaderTransitive`/`narrowerTransitive`; a concept can have several broader concepts without restriction (poly-hierarchy is explicit); `skos:Collection` is disjoint from `skos:Concept` and members may be concepts or collections; a concept may be in several concept schemes; one preferred label per language [28]. For *items* (non-concepts) the Dublin Core property `dcterms:subject` ("A topic of the resource", preferably a URI in a controlled vocabulary) is the established link from a resource to a concept [52]. JSON-LD distinguishes **embedding** a node from **referencing** it by `{"@id": …}`; a reference lets one node be linked from several parents without duplication; the *flattened* form puts every node at the top level of `@graph`; `@container` `@list` is ordered, `@set` unordered, and `@reverse` expresses the inverse [29]. The flattened form is the right normal form for our parser (flat `nodes[]`, D20). Lossless for polyhierarchy, group metadata (labels, notation), empty groups and orphans. **Edge-level `label` and `order` are not expressible on a plain `broader`/`subject` triple**: they need a reified membership node (`{"@type": "Membership", "parent": …, "child": …, "order": …}`) or an `@list` for order; this is the one place SKOS makes our D3 (reified edge) *harder*, not easier. The same data can be written in unboundedly many JSON-LD shapes (compact, expanded, contexts), so a robust reader must run `flatten` first (that needs a JSON-LD processor; section 7) or accept only a restricted profile (`@graph` of flat node objects, string `@id`s, a fixed context).

### (j) Markdown frontmatter `tags:` plus folder location (the dual)

The folder is the primary parent chain; frontmatter tags are extra edges. A bundle of five files:

```text
food/italian/carbonara.md       ---\ntags: [quick]\n---
food/italian/margherita.md      ---\ntags: [food/vegetarian]\n---
food/vegetarian/salad.md        ---\ntags: [quick]\n---
food/ramen.md                   (no frontmatter)
notes.md                        (no frontmatter)
```

Jekyll states exactly this dual: any directory above `_posts` is read as a category, and these combine with categories in the front matter [40]. Hugo infers the front-matter *format* from its delimiters (`---` YAML, `+++` TOML, `{}` JSON) [39] and lets `_index.md` carry front matter for `section`, `taxonomy` and `term` pages, i.e. **group metadata lives in a file per folder** [41]. Expresses: group tree (folders), multi-parent items (folder + tags), edge *labels* (the filename is the name of the child within its folder; the second membership has no separate name), orphans (root files), empty groups (empty folders), group metadata (`_index.md`). Cannot express cleanly: a group with two parents (a folder has one path; extra parents would have to be declared in an `_index.md` field by convention), and per-parent order without a naming convention. **Name resolution is the hazard:** a tag `vegetarian` may mean the group `food/vegetarian` or a top-level `vegetarian`; the writer should emit full paths, and the parser must report ambiguous names. This grammar needs a **Bundle**, not a pasted string (section 5.6).

### (k) Sidecar files (XMP, TagSpaces, Hydrus)

XMP (shown as one `rdf:Description`; namespaces from the exiv2 schema page [21]):

```xml
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:lr="http://ns.adobe.com/lightroom/1.0/">
   <dc:subject><rdf:Bag><rdf:li>food</rdf:li><rdf:li>italian</rdf:li><rdf:li>quick</rdf:li></rdf:Bag></dc:subject>
   <lr:hierarchicalSubject><rdf:Bag><rdf:li>food|italian</rdf:li><rdf:li>quick</rdf:li></rdf:Bag></lr:hierarchicalSubject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
```

Lightroom keeps hierarchy in `lr:hierarchicalSubject` (an XMP bag of text) and the flattened keywords in `dc:subject`; the `|` delimiter splits hierarchy levels; per the Metadata Working Group guideline each hierarchy node is stored as a *separate* `dc:subject` entry [20][21]. digiKam stores full tag paths with `/` in `digiKam:TagsList` [24]; the MWG keywords schema is a *tree of structs* (`Keywords/Hierarchy` with `Keyword`, `Applied`, `Children`), whose `Applied` flag distinguishes "this keyword is attached to the item" from "this keyword is only a node on the way" — the one place a sidecar standard separates asserted from implied membership [22][23]. TagSpaces writes one JSON file per tagged file in a hidden `.ts` folder, named `<file>.json`, holding `"tags": [{"title": …, "type": "sidecar", "color": …, "textcolor": …}]`, and a folder-level `tsm.json` [25]. Hydrus sidecars are `.txt` (newline-separated tags by default, other separators configurable) or `.json` with nested keys, named like `Image_123456.txt` or `Image_123456.jpg.json` [26]; Hydrus **tag parents** ("all files that have C should also have P", multiple parents allowed) and **siblings** live in its own database, *not* in the sidecar [27][26]. Net: sidecars carry **item → tag edges only** (plus per-tag display data), the group structure is either path strings (XMP `lr`, digiKam) = grammar (c), or absent. XMP `dc:subject` and `lr` are **bags (unordered)** [21], so item-major order is unrepresentable. Sidecars are per-file, so they need a Bundle; the pragmatic playground move is to *merge* many sidecars into one table (`path`, `tags`) = grammar (g).

### (l) Path-per-item listing with symlinks / hardlinks

```text
# inode  type  path                              target
1201     f     food/italian/carbonara
1202     f     food/italian/margherita
1202     f     food/vegetarian/margherita        (hard link: same inode as the line above)
1203     f     food/vegetarian/salad
1204     l     quick/salad                       -> ../food/vegetarian/salad
1201     f     quick/carbonara                   (hard link)
1205     f     food/ramen
1206     f     notes
```

POSIX forbids hard links to directories (`link(2)` returns EPERM when `oldpath` is a directory), and a hard link and its original are indistinguishable ("impossible to tell which name was the 'original'") [46]. So a real filesystem is exactly the `labels` profile: **items multi-parent, groups single-parent** [1 §0]; the *name is on the directory entry*, so the same file can have different names under different parents (edge `label`, D4). Symlinks give multi-parent for groups too but create cycles as "your bug" [3 §4.2]. Expresses: group tree, multi-parent items (via inode or symlink target), edge labels, empty directories (a `d` row), orphans (root files). Cannot express: order (the listing order is not membership order), group metadata, a trustworthy DAG of groups. **In a browser the information is thinner:** a picked directory yields each file's relative path via `webkitRelativePath` [45] (Baseline since August 2025 [45]); I found no documented way to read inode numbers or symlinks from it (**[unverified]**, treat as absent). A pasted `find`/`ls -li`/`tar -tv` listing can carry inodes and link targets, but its columns vary by tool (the exact `find -printf` directives are **[unverified]** here and BSD `find` differs), so detection must be tolerant. A useful inference when links are absent: items with the same name and content hash in two directories are probably one node with two parents (D18's content-hash identity [1]) — offer it as a *suggestion the user confirms*, never as silent merging. `d3.stratify().path()` turns slash-delimited path strings into a hierarchy, imputing missing parents, but only as a single-parent tree [33].

### (m) TOML array-of-tables

```toml
[[items]]
id = "carbonara"
tags = ["food/italian", "quick"]

[[items]]
id = "ramen"
tags = ["food"]

[[items]]
id = "notes"
tags = []
```

and the lossless flat form (recommended for TOML):

```toml
[[node]]
id = "italian"

[[node]]
id = "carbonara"
title = "Pasta carbonara"

[[edge]]
parent = "italian"
child = "carbonara"
kind = "contains"
order = "a0"
label = "Carbonara (classic)"
```

TOML defines `[[name]]` so that "each subsequent instance creates and defines a new table element in that array", and sub-tables attach to "the most recently defined table element" [30]. That makes **flat tables with id references** TOML's natural fit. A *nested tree* in TOML is possible (`[[tree]]`, `[[tree.children]]`, …; my stringifier test emitted `[[a]]` / `[[a.b]]` headers for two levels) but is awkward to hand-edit and the headers carry the whole path at each level [measured]. TOML has **no null** [30] (so "no parent" and "no label" must be *absent keys*, never null) and "key/value pairs within tables are not guaranteed to be in any specific order" [30], so order must live in arrays or an `order` key. `smol-toml` 1.9.0 **silently drops** object keys whose value is `null`/`undefined` on stringify and throws for arrays containing them; nested `null` inside an array of tables produced an unhelpful `TypeError` [measured] — the codec must strip nulls itself and report them in the loss report.

### (n) Normalised multi-table / resource linkage (JSON:API-style, Data Package)

`{"data": [...items with "relationships": {"groups": {"data": [{"type": "group", "id": "italian"}, …]}}], "included": [...groups]}`. JSON:API's rule that "a compound document MUST NOT include more than one resource object for each type and id pair" gives exactly the *no duplication, every reference resolves* discipline of a flat node set, and to-many linkage is an array of `{type, id}` identifiers [38]. Equivalent in tables: a Frictionless Data Package with `nodes`, `edges` resources and `foreignKeys` [15]. Treat this as grammar (e)/(h) with a different envelope; it matters because it is how many existing APIs *already* ship item→group data, so detection should recognise it.

### (o) OPML outline (XML, nested tree plus category attribute)

```xml
<opml version="2.0">
  <head><title>RD</title></head>
  <body>
    <outline text="food">
      <outline text="italian">
        <outline text="carbonara" category="/quick"/>
        <outline text="margherita" category="/food/vegetarian"/>
      </outline>
      <outline text="vegetarian"><outline text="salad" category="/quick"/></outline>
      <outline text="ramen"/>
    </outline>
    <outline text="notes"/>
  </body>
</opml>
```

OPML 2.0: an `<outline>` has a required `text` attribute and "may contain zero or more `<outline>` sub-elements"; `category` is "a string of comma-separated slash-delimited category strings"; "to represent a tag, the category string should contain no slashes", e.g. `category="/Harvard/Berkman,/Politics"` [18]. So OPML is, in one standard, the **(a1)+(c)+(g) dual**: folder nesting (a) plus delimited slash-path tags (c, g) — an outliner's version of grammar (j). Same limits as (j): one folder parent, extra parents as path-tags, group identity by path. Netscape bookmark HTML is the same dual in HTML (`<DL>`/`<DT><H3>` folders, `<A>` items) [unverified: the community `TAGS` attribute is not in the format page I could access].

### Other grammars noted and rejected for v1

Nested set and materialised path are storage encodings and structurally unsuited as interchange for multi-parent data (reasons in [3 §1.2–1.3] and decision D11 [1]). Org-mode `:tag1:tag2:` and Logseq `tags::` properties are (g) with different delimiters (**[unverified]**, not researched here). Danbooru-style tag implications are *rules*, not memberships, and belong to edge `kind` / intensional groups (D21), not to a grammar [2 §4.3].

## 4. Expressiveness matrix and lossless-for-profile summary

Legend: **Y** = carried natively, **~** = carried only with a convention, a wrapper, or an extra file (state it), **N** = dropped. "Order" means rank of a child within its parent (group-major, D4); "item-major" = rank of an item's groups.

| Grammar | Items multi-parent | Nested groups | Group with 2 parents | Group metadata | Order | Edge label | Empty groups | Orphans | Identity basis |
|---|---|---|---|---|---|---|---|---|---|
| a1 nested, duplicate | ~ (copies) | Y | ~ (subtree copies) | ~ (wrapper) | Y arrays, N keyed objects | ~ (keyed names) | Y | ~ (root items) | id or name |
| a2 nested + refs (YAML anchors) | Y | Y | Y | ~ | Y | ~ | Y | ~ | object identity or id |
| a3 parent pointer | N | Y | N | Y (node row) | ~ (column) | ~ (column) | Y | Y | id |
| b tags array | Y | **N** | N | N | item-major | N | N | Y | tag string |
| c path-string tags | Y | Y (prefix) | **N** (path = identity) | N | item-major | N | N | Y | path |
| d group → members | Y | Y | Y | ~ (wrapper) | Y | ~ (wrapper) | Y | **N** | id |
| e edge rows (+ nodes table) | Y | Y | Y | Y (nodes table) | Y (column) | Y (column) | Y (nodes table) | Y (nodes table) | id |
| f wide one-hot | Y | **N** (~ header paths) | N | N | N | N | Y | Y | column header |
| g delimited cell | Y | N (~ with paths) | N | N | item-major | N | N | Y | cell token |
| h node-link (JGF etc.) | Y | Y | Y | Y | ~ (`metadata`) | Y | Y | Y | id |
| i JSON-LD / SKOS | Y | Y | Y | Y | ~ (`@list`) | ~ (reified edge) | Y | Y | IRI |
| j frontmatter + folder | Y | Y (folders) | ~ (`_index` convention) | ~ (`_index.md`) | ~ (filename convention) | Y (filename) | Y (empty folder) | Y | path + name |
| k sidecars | Y | ~ (`lr`/digiKam paths) | N | N | N (bags) | N | N | Y | tag string |
| l path listing + links | Y (hard/sym links) | Y | N (no dir hard links) | N | N | Y (dentry name) | Y | Y | inode or path |
| m TOML AoT | as hosted grammar; TOML adds: no null, no key order | | | | | | | | |
| o OPML (outline + category) | ~ (category tags) | Y | N | ~ (attributes) | Y (element order) **[unverified]** | N | Y | Y | path |

Which grammars are **lossless** for each constraint profile of the model [1 §3]. "Lossless" here means a `GroupSpace` conforming to the profile round-trips with no drop *and no degrade*; if a metadata dimension is also used (labels, group metadata, order) the extra requirement is shown.

| Profile | Lossless grammars (structure only) | If dataset also uses edge `order` | If it also uses edge `label` | If it also uses group metadata |
|---|---|---|---|---|
| `filesystem` (1 parent per item and group) | a1, a2, a3, c, d, e, h, i, j, l | a1 (arrays), a2, d, e, h (`metadata`), i (`@list`) | a1 (keyed), e, h, j, l | a3, e, h, i, j (`_index.md`) |
| `flatTags` (depth 0, no tags of tags) | b, c, d, e, f, g, h, i, k (and j, a2) | d, e, h, i | e, h | e, h, i |
| `nestedTags` / `labels` (items multi-parent, group tree) | c, d, e, h, i, j, l (hard links; not in a browser), a2 | d, e, h, i | e, h, j, l | e, h, i, j |
| `polyhierarchy` (DAG of groups) | **d, e, h, i, a2 (YAML anchors only)** | d, e, h, i | e, h | e, h, i |
| `thesaurus` (typed edge kinds, `related`) | e (kind column), h (`relation`), i (SKOS properties map to kinds) | e, h, i | e, h | e, h, i |

Reading the table: **e, h and i are the only structurally universal grammars.** d is universal for *structure* if the `items` list is added. b, f, g and k are flat by construction and must refuse (or warn on) any dataset with nested groups. c is the right bridge between flat-tag tools and nested groups, but caps at `labels`.

## 5. How each format constrains grammars

### 5.1 JSON

No comments, no references, no ordering guarantee on objects, no distinct "absent" versus `null` convention (but `null` exists). RFC 8259 calls an object "an unordered collection" and says member names "SHOULD be unique", with implementations differing on duplicates (last wins, error, keep all); arrays preserve order [48]. Hosts every grammar except the multi-file ones, the tabular ones in their native form, and XML. Practical: JSONC (comments) via `jsonc-parser` is a friendly superset for hand-edited files and gives edit-script writes [6]. For multi-parent in JSON use grammars (d), (e), (h), (i) or id-references in (a); avoid `$ref` [42].

### 5.2 YAML

The only text format here where multi-parent is *syntax*: anchors and aliases [31] (grammar a2), with the traps in section 3(a). Further measured facts (`yaml` 2.9.1): the default is YAML 1.2 where `tags: [no, yes, on, 010]` parses to `["no","yes","on",10]`; with `version: '1.1'` the same text gives `[false, true, true, 8]`; `2024`, `1e3`, `0x1F`, `null` and `~` as unquoted tags become a number, number, number, null, null, so **a tag list written by hand can silently change type**; `yaml`'s stringifier quotes ambiguous strings automatically (`"010"`, `"2024"`, `"true"`, `"null"`, `"~"`), so serialising is safe, parsing needs a `String()` coercion with a diagnostic when a non-string scalar appears where an id or tag is expected; empty list items parse to `null`; duplicate map keys are an error ("Map keys must be unique") — good, because JSON would silently take the last. Merge keys (`<<`) are off by default in 1.2 and on for 1.1 [10], [measured]. `parseDocument()` keeps comments, blank lines and styles for edit-based writes [10] (this is the comment-preserving writer the settings research asked for [6]).

### 5.3 TOML

Flat tables + references is the natural grammar family (m). Deep trees are legal but unpleasant; "no null"; "no ordering guarantee" for keys [30]; mixed-type arrays are allowed in 1.0 [30]. `smol-toml` supports TOML 1.1.0, passes the official `toml-test` suite, defaults integers to 53-bit numbers (BigInt opt-in) and dates to `Date` with millisecond precision [9]. It does not document comment preservation [9] (**[unverified]** that it has none; the README excerpt I read is silent). For comment-preserving TOML edits the JS options are thin: `@shopify/toml-patch` is WebAssembly built on Rust's `toml_edit` (0.3.0, 2025-04-23; licence field absent from the registry metadata, so check before depending) [12]; the older `toml-patch` 0.2.3 is from 2019 [12].

### 5.4 CSV (and TSV)

Tabular, untyped, no nesting [36]. Only grammars whose unit is a row fit natively: (a3), (e), (f), (g), (c)-in-a-cell. Nested trees and multi-parent maps do not fit (a tree in CSV is a parent-pointer or path column). Real-world problems the codec must carry as `params` or detect: delimiter (`,` `;` tab `|`), quote/escape rules, BOM, header presence, `;`-as-decimal-comma locales, empty cell = empty list versus absent, and per-row ragged length (`papaparse` reports `TooFewFields` and `UndetectableDelimiter` as `errors` rather than throwing [measured]). Multi-value cells: CSVW `separator` [16] is the standard; Table Schema `array` is JSON text in the cell [15].

### 5.5 XML-family (OPML, GraphML, GEXF, XMP, RDF/XML)

Hierarchy is first-class (element nesting; GraphML nested graphs [34]; GEXF hierarchy [35]); order is document order. Multi-parent needs references (`id`/`idref`, `rdf:resource`) or duplication. Parse with `DOMParser` in the main thread (zero bytes) [50]; in a Worker or Node use `fast-xml-parser` (MIT, 5.11.2, measured 24.6 kB gzip for parser+builder) or `@xmldom/xmldom` (MIT, 0.9.12) [12][measured].

### 5.6 Markdown + frontmatter, sidecars, filesystem listings (multi-document grammars)

These need the **Bundle** container. A paste box can hold a Bundle only by an explicit convention: a JSON/YAML map `{path: content}`, a concatenation with `=== path ===` headers, a `tar -tv`/`find` listing (paths only), or an upload (directory via `webkitdirectory` [45] or zip). The grammar's `input` kind is therefore one of `value` (parsed JSON/YAML/TOML), `table` (parsed CSV), `xml` (a DOM), or `bundle`. A frontmatter splitter is tiny: read the first line; `---` → YAML, `+++` → TOML, `{` → JSON object up to its closing brace; this is exactly Hugo's delimiter rule [39]. Write it over the format codecs.

## 6. Auto-detection

Principle: detection is **advisory and two-staged**. Stage 1 sniffs the *format* from the first bytes; stage 2 sniffs the *grammar* from the parsed shape. Both return a ranked list with evidence, never a single answer, and the playground parses the top candidates and shows a one-line **preview** (groups N, items N, edges N, orphans N, items with more than one parent N, loss warnings) so the user confirms with data rather than a name. All thresholds below are **[estimate]** and should be tuned on the fixtures of section 2.2.

### 6.1 Format sniffing (stage 1)

| Signal | Candidate |
|---|---|
| First non-space char `{` or `[` and `JSON.parse` succeeds | JSON (also try `jsonc-parser` leniently: comments and trailing commas → JSONC) |
| First non-space char `<` | XML family: root element `opml` → OPML; `graphml` → GraphML; `gexf` → GEXF; `x:xmpmeta` or `rdf:RDF` → XMP/RDF-XML |
| Starts with `---` then a closing `---` and a body | Markdown + YAML frontmatter; starts with `+++` → TOML frontmatter (Hugo's rule [39]) |
| Lines match `^\[\[?[\w.-]+\]\]?$` or `^[\w.-]+ *= *` | TOML |
| Consistent count of one delimiter across the first N lines; or `papaparse` delimiter guess succeeds | CSV/TSV (papaparse reports `UndetectableDelimiter` when it cannot guess, e.g. a one-column file [measured]) |
| `key: value` / `- item` lines | YAML (YAML is a JSON superset in practice, so try JSON first) |
| Many lines that look like paths (`/` separators, no spaces in 90 percent) or `ls -l` columns | path listing (l) |

### 6.2 Grammar sniffing (stage 2)

Score each candidate `0..1` as `0.5·structural + 0.3·nameHint + 0.2·integrity` **[estimate]**, where *structural* = fraction of the document the grammar would consume (unconsumed keys become `payload`, so a high consumption fraction is the strongest signal), *nameHint* = presence of lexicon hits (`tags, categories, labels, keywords, groups, collections, folders, parent, parent_id, children, members, source, target, relation`), and *integrity* = referential checks.

| Observed shape | Candidate grammar | Discriminating check |
|---|---|---|
| Root object with `nodes` and (`edges` or `links`) | h node-link (d3 `links`, NetworkX `edges` [51]) | `source`/`target` values ⊆ node ids |
| Root `graph` containing `nodes` (map or array) and `edges` | h (JGF [17]) | v2: nodes is a map |
| Root `elements` with `nodes`/`edges` arrays of `{data: {…}}` | h (Cytoscape [32]) | `data.source`/`data.target` |
| `@context` or `@graph`, or `skos:` terms | i JSON-LD/SKOS | presence of `skos:broader`/`narrower`/`dcterms:subject` |
| Root has `data` + `included`, items with `relationships` | n JSON:API-style [38] | `{type,id}` linkage objects |
| Array of objects, each with an array-of-strings field | b tags array | field name in lexicon; strings repeat across rows (low cardinality) |
| …and those strings contain a consistent `/`, `\|` or `:` | c path-string tags | ≥ 30 percent of tag strings contain the separator, and prefixes recur |
| Object whose values are all arrays of strings | d group → members | many member strings are also keys → nested groups; else flat inverse index |
| Array/object whose entries have a children-like array of same-shape entries | a1 nested tree | recursion depth > 1; repeated ids at different places → duplicate-multi-parent |
| YAML with anchors/aliases in the source text | a2 | regex `&\w+` and `\*\w+`; must inspect the **text**, since anchors vanish after parsing [31] |
| Rows with `parent`/`parent_id` column, one root | a3 parent pointer | single parent, acyclic [33] |
| Table, two columns (or named `source/target`, `parent/child`, `item/group`) | e edge rows | **inclusion test**: values of one column ⊆ distinct ids; direction rule below |
| Table with ≥ 2 columns whose cells are all in a boolean domain `{0,1,true,false,x,y,yes,no,""}` | f one-hot | all-boolean columns ≥ 2 and a leading id-like column |
| Table with a column in which some cells contain a consistent delimiter | g delimited | delimiter in ≥ 20 percent of cells and that column's name is in the lexicon |
| `.md` files with frontmatter and folders | j | any file has a `tags`/`categories` key; folders ≥ 2 levels |
| `.xmp`, `.json` inside `.ts/`, `.txt` beside media | k | file naming (`*.xmp`, `.ts/*.json` [25]) |
| Listing of paths with repeated inodes or `->` | l | repeated inode ⇒ hard link |
| Root `opml` | o | `outline` with `text` [18] |

### 6.3 Direction and role heuristics (estimates)

- **Edge direction** (`item,group` versus `group,item`; `source,target`): the group side usually has the *lower cardinality* (distinct values ÷ rows), and its values recur; in a nested group case the group column's values also appear in the item column. Treat as a suggestion with confidence, ask when the cardinalities are within a factor of two.
- **Item id column**: the column with all-unique, non-empty values; ties broken by name (`id`, `name`, `path`, `slug`, `title`).
- **Tag field versus ordinary array attribute**: a list of strings is a *group-membership field* when its values repeat across items (low cardinality) and/or its name is in the lexicon; a list of unique long strings (descriptions, urls) is payload.
- **Boolean column = group or attribute?** Ask when the column name is not in the lexicon and fewer than 3 boolean columns exist (a single `done`/`active` column is an attribute, not a tag).

### 6.4 When to ask the user

Ask (one question, with the preview) when any of: top score < 0.6, or top-two gap < 0.15 **[estimate]**; the data is an edge table and direction confidence is low; a list field might be tags or payload; the delimiter or separator is ambiguous (a `,` inside a delimited cell); frontmatter names are ambiguous between top-level and nested groups; a bundle contains both folders and tags and the user has not said which is primary. Never ask when exactly one grammar consumes ≥ 95 percent of the data and no ambiguity class above applies. After parsing, **always** show the loss preview for the *export* grammar the user picks next, since choosing a flat export for nested data is the dominant avoidable data loss.

## 7. JS/TS libraries for the format layer

Versions, licences, release dates from the npm registry [12] on 2026-10-04; weekly downloads from the npm downloads API (week 2026-09-25 to 2026-10-01) [13]; gzip sizes are **my esbuild measurements** (`--bundle --minify --format=esm --platform=browser`, default imports, gzip -9) [measured, 55], which differ from bundlephobia's figures for several packages [14] — treat sizes as order-of-magnitude, rebuilt in CI.

| Library | Version, release | Licence | Weekly dl | gzip (measured) | What it gives | Verdict |
|---|---|---|---|---|---|---|
| [yaml](https://github.com/eemeli/yaml) (eemeli) | 2.9.1, 2026-09-11 | ISC | 258 M | 30.6 kB | YAML 1.1 and 1.2, passes yaml-test-suite, `parseDocument` keeps comments/blank lines, anchors/aliases, merge option, `maxAliasCount`, `aliasDuplicateObjects`; zero deps, Node and browsers [10] | **Depend** (YAML codec; Document API for the comment-preserving writer) |
| [js-yaml](https://github.com/nodeca/js-yaml) | 5.4.2, 2026-09-13 | MIT | 363 M | 17.0 kB | YAML 1.2 `load`/`dump`; v5 exports named functions only (no default export) in my ESM test; 1 dependency (`argparse`) | **Study / fallback** (smaller, no document model found; the comment-preserving claim is **[unverified]** here) |
| [smol-toml](https://github.com/squirrelchat/smol-toml) | 1.9.0, 2026-09-22 | BSD-3-Clause | 45 M | 6.5 kB | TOML 1.1.0, passes `toml-test`, prototype-pollution guard, BigInt/Temporal options, zero deps [9] | **Depend** (TOML codec); wrap to strip nulls and report |
| @iarna/toml | 2.2.5, 2020-04-22 | ISC | 9.8 M | n/m | older TOML | **Avoid** (stale since 2020) |
| @ltd/j-toml | 1.38.0, 2023-01-16 | **LGPL-3.0** | n/m | n/m | TOML | **Avoid** (licence friction for a permissive package) |
| @shopify/toml-patch | 0.3.0, 2025-04-23 | not set in registry | n/m | n/m | WASM `toml_edit` comment-preserving edits | **Study** for a later format-preserving TOML writer |
| [papaparse](https://www.papaparse.com/) | 5.7.0, 2026-08-24 | MIT | 19.5 M | 7.3 kB | CSV parse/unparse in browser, header mode, delimiter guessing, workers, streaming | **Depend** (CSV/TSV codec) |
| d3-dsv | 3.0.1, 2021-06-05 | ISC | 26.6 M | 1.1 kB | tiny DSV parse/format; no delimiter guess (**[unverified]**) | **Study / optional** (smallest; stale release but stable) |
| csv-parse | 7.0.3, 2026-09-25 | MIT | n/m | n/m | Node-stream oriented, 1.6 MB unpacked | **Avoid** for the browser playground |
| jsonc-parser | 3.3.1, 2024-06-24 | MIT | 85 M | 5.7 kB | JSON-with-comments parse, `modify` + `applyEdits` edit scripts [6] | **Depend** (JSON/JSONC codec and edit-based writes) |
| [gray-matter](https://github.com/jonschlinkert/gray-matter) | 4.0.3, 2021-04-24 | MIT | 12.4 M | 17.3 kB (bundled, includes js-yaml 3) | frontmatter parse + stringify, pluggable engines, JS engine evaluates code [11] | **Avoid** (stale, `js-yaml` ^3.13.1 dependency, README describes `fs`/`Buffer` use [11]; it bundled under esbuild but I did not run it in a browser) |
| front-matter | 4.0.2, 2020-05-29 | MIT | 4.7 M | n/m | YAML-only frontmatter | **Avoid** (same reason; our own splitter is ~30 lines) |
| exifr | 7.1.3, 2021-08-05 | MIT | 2.5 M | 26.5 kB full, 15.0 kB lite | read-only EXIF/XMP/IPTC; XMP parsing via a "minimalistic" internal XML parser; README bundle sizes (full ~73 kB, lite ~45 kB minified) [49] | **Study / optional** adapter for reading `dc:subject`/`lr:hierarchicalSubject` from images (whether it surfaces `lr:` bags is **[unverified]**); read-only |
| exiftool-vendored | 38.3.0, 2026-09-28 | MIT | 158 k | n/a | wraps the ExifTool binary; writes XMP | **Out of scope** for a browser playground (Node-side); candidate for a Node store adapter |
| fast-xml-parser | 5.11.2, 2026-09-29 | MIT | n/m | 24.6 kB | XML parse/build, usable in Workers and Node | **Fallback** when `DOMParser` is unavailable |
| browser `DOMParser` | built in | n/a | n/a | 0 | XML/HTML → DOM; **not in Web Workers or Node** [50] | **Use first** for OPML/GraphML/GEXF/XMP |
| jsonld (digitalbazaar) | 9.0.0, 2025-11-21 | BSD-3-Clause | 322 k | 34.6 kB | full JSON-LD 1.1 processor (expand, compact, flatten); has a pluggable `documentLoader`, README ships browser bundles [54]; default remote-context fetching behaviour **[unverified]** | **Optional lazy peer** for arbitrary JSON-LD input; ship a restricted-profile reader without it |
| n3 / rdflib | 2.10.7 / 2.4.1 | MIT | n/m | n/m | Turtle/RDF parsing and stores | **Avoid in v1** (consistent with [4]: do not build on RDF) |
| graphology-graphml, graphology-gexf | 0.5.2 (2022) / 0.13.2 (2024) | MIT | 2.9 k (graphml) | n/m | GraphML/GEXF ↔ graphology | **Study**; a minimal GraphML/GEXF reader over `DOMParser` is smaller than the dependency |

Aggregate cost of the recommended set, **lazy-loaded one format at a time**: YAML 30.6 kB + TOML 6.5 kB + CSV 7.3 kB + JSONC 5.7 kB ≈ 50 kB gzip if every format were loaded; a user who picks JSON downloads nothing beyond `JSON.parse` (use `jsonc-parser` only when comments are detected). Because `yaml` is the heaviest and `js-yaml` is 13.6 kB smaller (measured), a build-time choice behind the same `FormatCodec` seam is cheap if size ever outweighs the comment-preserving Document API; I recommend `yaml` for v1.

## 8. Recommendation: the grammar registry

### 8.1 Two registries and one container

```ts
// Format layer: text <-> a JS value, table, or DOM. No knowledge of groups.
interface FormatCodec<V> {
  readonly id: 'json' | 'jsonc' | 'yaml' | 'toml' | 'csv' | 'tsv' | 'xml' | (string & {});
  readonly extensions: readonly string[];
  readonly kind: 'value' | 'table' | 'xml';            // what parse() yields
  sniff(text: string): number;                          // 0..1, cheap, no full parse
  parse(text: string, opts?: unknown): V;               // throws FormatError(position, message)
  stringify(value: V, opts?: unknown): string;
  // Optional: comment/format-preserving write against the previous text (settings research [6][7]).
  patch?(previousText: string, nextValue: V): string;
}

// Grammar layer: a parsed value/table/bundle <-> the canonical GroupSpace (flat nodes[] + edges[], D20).
interface GrammarCodec<I, P = unknown> {
  readonly id: string;                                  // 'nested' | 'tags-array' | 'tag-paths' | 'members-map' | 'edge-rows' | 'one-hot' | 'delimited' | 'node-link' | 'jsonld-skos' | 'frontmatter-folder' | 'sidecar' | 'fs-listing' | ...
  readonly input: 'value' | 'table' | 'xml' | 'bundle';
  readonly formats: readonly string[];                  // compatible FormatCodec ids (the matrix of section 5)
  readonly params: ZodType<P>;                          // own settings schema, read through one `params` argument
  readonly capabilities: GrammarCapabilities;           // static, drives the loss report
  detect(input: I, ctx: DetectContext): Detection;      // { score, evidence[], suggestedParams }
  parse(input: I, params: P): ParseResult;              // { space, residue, diagnostics[] }
  serialise(space: GroupSpace, params: P, previous?: I): SerialiseResult<I>; // { output, loss: LossReport }
}

interface GrammarCapabilities {
  itemsMultiParent: 'native' | 'convention' | 'no';
  nestedGroups: 'native' | 'convention' | 'no';
  groupsMultiParent: 'native' | 'convention' | 'no';
  groupMeta: 'native' | 'convention' | 'no';
  edgeOrder: 'group-major' | 'item-major' | 'convention' | 'no';
  edgeLabel: 'native' | 'convention' | 'no';
  emptyGroups: 'native' | 'no';
  orphans: 'native' | 'convention' | 'no';
  identity: 'id' | 'path' | 'token' | 'iri' | 'inode';
  edgeKinds: 'native' | 'single' | 'no';                // 'single' = only `contains`
}

// Container: how documents arrive. Single-file formats are a Bundle of one entry.
type Bundle = ReadonlyMap<string, string | Uint8Array>;
```

`GroupSpace` is the canonical `nodes[]` + `edges[]` of D1/D20 [1]; nothing else is authoritative, and no codec holds state. A pipeline is `Container → Bundle → FormatCodec.parse → GrammarCodec.parse → GroupSpace` and the reverse, which is the provider-level codec composition the settings research already specified (chain codecs; reverse order for the reverse direction) [5].

### 8.2 The lossiness report

```ts
interface LossReport {
  readonly lossless: boolean;
  readonly losses: readonly {
    kind: 'multi-parent-flattened' | 'duplicated' | 'group-edges-dropped' | 'edge-order'
        | 'edge-label' | 'group-meta' | 'empty-group' | 'orphan' | 'edge-kind' | 'payload-field' | 'identity-collision';
    severity: 'drop' | 'degrade' | 'encode';
    count: number;
    sample: readonly string[];                          // a few node/edge ids for the UI
  }[];
}
```

Compute it **in two places**. *Before* serialising: `assess(space, grammar)` compares `featuresOf(space)` (has multi-parent items? group edges? edge order? labels? empty groups? orphans? group meta? more than one edge kind?) against `grammar.capabilities` and returns the loss report so the UI can annotate the grammar dropdown ("drops 2 group→group edges") and disable or confirm. *After* serialising, the grammar itself returns the exact loss (e.g. an identity collision found while writing paths). This is the cheapest guard against D14's "validator is the SSOT" failing silently: the profile validator checks the space; `assess` checks the *grammar* against the space.

### 8.3 Round-trip contract and tests

- **Value round-trip (required):** for a space `S` whose features are within `capabilities`, `parse(serialise(S)) ≅ S` where `≅` compares canonicalised nodes and edges (sorted; edge `order` compared by rank, not by string, because formats carry positions while the canonical order is a fractional-index string [1 §6]).
- **Deterministic edge ids:** formats without edge ids must derive them deterministically (for example from `parent`, `child`, `kind`, plus a counter for parallel edges), otherwise round-trips churn ids and the change-feed (D7) reports phantom deltas.
- **Text round-trip (best effort):** `serialise(parse(text)) = text` only modulo whitespace and comment loss, unless the format offers `patch` (YAML `parseDocument`, `jsonc-parser` `modify`/`applyEdits`). Patch-based writes are a later seam (settings research: edits, not rewrites [6][7]); v1 documents the loss.
- **Fixtures:** the RD in every grammar × format (section 3) plus delta P and an edge case set (orphan only, empty group only, label containing the delimiter, tag `010`, one group aliased 150 times, cycle, duplicate ids with different payloads, a tag equal to a group name at two depths). A property-based generator over profile-conforming spaces is the second layer (tool choice is a team decision; not researched here).
- **Diagnostics, not exceptions:** unresolved references, cycles (reported with the offending path, D15), duplicate ids with conflicting payloads, non-string tags where YAML coerced a number, and ambiguous frontmatter names are all `diagnostics[]` on `ParseResult`, so the playground can show them next to the offending lines.

### 8.4 Default grammars per format for the playground

| Format | Demo/import default (familiar) | Lossless export default | Showcase grammar |
|---|---|---|---|
| JSON | a1 nested `{name, children}` | h node-link (`{graph: {nodes, edges}}`-style) | d members map, i JSON-LD |
| YAML | a1 nested, then offer a2 | h node-link (YAML view of the same JSON) | a2 anchors/aliases ("polyhierarchy in a human format"; warn on `maxAliasCount`) |
| TOML | m `[[items]]` with `tags` (b/c) | m flat `[[node]]` + `[[edge]]` | none beyond default |
| CSV/TSV | g items + delimited tags | e edge rows + a nodes table (two files or two sheets) | f one-hot, a3 parent pointer |
| Markdown | j frontmatter + folder (from a `{path: content}` bundle or upload) | j with `_index.md` for group metadata | — |
| XML | o OPML | h GraphML or GEXF | k XMP |
| JSON-LD | i SKOS (restricted profile; `jsonld` peer for arbitrary input) | i with reified membership for order/labels | — |

Principle: the **import default is whatever people already have** (nested, tags column, frontmatter), the **export default is the lossless grammar** for the dataset's profile, and the export dropdown always shows its loss report. Sample datasets (RD plus a bigger polyhierarchy) ship in every grammar so a first-time user sees the same data in the shape they know and the shape that is lossless.

### 8.5 Which grammar is the default for a given constraint profile

- `filesystem`: **a1 nested** (or a3 parent-pointer in CSV), j in Markdown, l for listings.
- `flatTags`: **b tags array** (JSON/YAML/TOML/frontmatter), g in CSV; f when users want spreadsheet-style toggles.
- `nestedTags` / `labels`: **c path-string tags** (round-trips to tag tools such as Obsidian), d for a clean inverse view, j when notes live in folders.
- `polyhierarchy` and `thesaurus`: **e edge rows, h node-link, i SKOS**, a2 in YAML only; never b, c, f, g, k, o as the sole carrier.
- Any profile with edge `order` or `label`: **d or e or h**; a1 only with arrays.

### 8.6 Phasing (seams, not stubs)

1. **v1 (ships the playground):** format codecs `json`, `yaml`, `toml`, `csv` (+ `jsonc` detection); grammars `nested`, `tags-array`, `tag-paths`, `members-map`, `edge-rows`, `delimited`, `one-hot`, `node-link`; the loss report; detection stage 1 + 2; value round-trip only. All are pure functions over `Value`/`Table`, no new dependency beyond the four libraries in section 7.
2. **v1.1:** `frontmatter-folder` and `fs-listing` over a Bundle container (zip and directory upload); XML family via `DOMParser` (OPML, GraphML, GEXF).
3. **v2:** `jsonld-skos` with the optional `jsonld` peer; sidecar readers (XMP via `exifr`, TagSpaces, Hydrus); patch-based, comment-preserving writes per format (the document-model seam of [6][7]).

Each step adds a codec at an existing seam; none changes `GroupSpace`.

## 9. Open questions and things I could not verify

- Exact JGF v2 field list comes from the README-level summary; I did not read the normative JSON Schema (edge `id`/`order` placement in `metadata` is my mapping, not the spec's).
- Whether `exifr` returns `lr:hierarchicalSubject` as a parsed array, and whether any XMP sidecar write path exists in the browser without WebAssembly, is unverified.
- Whether the browser file APIs can expose symlink or inode information is unverified (I found none).
- `smol-toml`'s comment-preservation is undocumented in what I read; `@shopify/toml-patch`'s licence is missing from registry metadata.
- `jsonld` default remote-context fetching, and `d3-dsv` delimiter auto-detection, are unverified.
- `find -printf` directives for inode/type/target and the Netscape `TAGS` attribute are unverified; Org-mode and Logseq tag formats were not researched.
- The scoring weights and thresholds in section 6 are estimates and need calibration on a labelled fixture corpus; a corpus of real exports (Obsidian vault, Lightroom catalogue export, a Zotero or bookmarks export, a spreadsheet of tagged assets) would turn them into measured values.
- Whether the lossless-export default should be our own flat JSON (`{nodes, edges}`) or JGF (a third-party format with an unusual `nodes`-as-map choice) is a naming decision: JGF buys interoperability with existing graph tools; our own shape buys an exact 1:1 with `Edge` (`id`, `order`, `meta` as first-class). **[estimate]** recommendation: ship our own as the canonical interchange and JGF as a grammar alongside it.

## REFERENCES

Fleet documents (paths relative to the `zodal-groups` and `zodal-dials` repositories):

1. [`zodal-groups/docs/research/_reconciliation.md`](https://github.com/i2mint/zodal-groups/blob/main/docs/research/_reconciliation.md) — decisions D1–D24, constraint profiles, sharp edges (the canonical model, D1, D4, D5, D8, D9, D11, D14, D18, D20; §3 profiles; §6 ordering).
2. [`zodal-groups/docs/research/zgroups_01-classification-theory-and-polyhierarchy.md`](https://github.com/i2mint/zodal-groups/blob/main/docs/research/zgroups_01-classification-theory-and-polyhierarchy.md) — SKOS (§3.3), hierarchical tagging in the wild, path-as-string versus real edges (§5), Danbooru implications (§4.3).
3. [`zodal-groups/docs/research/zgroups_02-storage-indexing-and-query.md`](https://github.com/i2mint/zodal-groups/blob/main/docs/research/zgroups_02-storage-indexing-and-query.md) — encodings, §1.2 materialised-path combinatorics, §4.2 filesystem sidecar-manifest recommendation.
4. [`zodal-groups/docs/research/zgroups_04-js-ts-library-landscape.md`](https://github.com/i2mint/zodal-groups/blob/main/docs/research/zgroups_04-js-ts-library-landscape.md) — SKOS/JSKOS and RDF stack conclusions ("do not build on RDF").
5. [`zodal-dials/docs/research/raw/05a-zodal-corpus-notes.md`](https://github.com/i2mint/zodal-dials/blob/main/docs/research/raw/05a-zodal-corpus-notes.md) §5 — codecs, `wrapProvider`, `composeCodecs`, format as a pluggable codec keyed by extension.
6. [`zodal-dials/docs/research/raw/02G-identity-versioning-machine.md`](https://github.com/i2mint/zodal-dials/blob/main/docs/research/raw/02G-identity-versioning-machine.md) §3 — comment/format-preserving round-trips need a document model; `jsonc-parser`, `tomlkit`, `ruamel.yaml`; patches model values, not text.
7. [`zodal-dials/docs/research/raw/04-synthesis.md`](https://github.com/i2mint/zodal-dials/blob/main/docs/research/raw/04-synthesis.md) §L — value-layer ↔ format-writer separation, codecs at field and provider level.

External sources (accessed 2026-10-04):

8. `zodal-groups/packages/groups-core/src/model.ts` and `profile.ts` — the implemented `Edge`, `Node`, `EdgeKindDef` and `GroupProfile` types (edge fields `id, parent, child, kind, label?, order?, meta?`).
9. [smol-toml (GitHub)](https://github.com/squirrelchat/smol-toml) — TOML 1.1.0, BSD-3-Clause, integer/date limits, prototype-pollution handling.
10. [yaml (eemeli) documentation](https://eemeli.org/yaml/) — YAML 1.1/1.2, `parseDocument`, comment preservation, anchors/aliases, `maxAliasCount`, `aliasDuplicateObjects`, merge keys.
11. [gray-matter (GitHub)](https://github.com/jonschlinkert/gray-matter) — engines, stringify, `fs`/`Buffer` note.
12. [npm registry metadata](https://registry.npmjs.org/) — version, licence, release date, dependencies for every package in section 7 (queried 2026-10-04 via `registry.npmjs.org/<package>`).
13. [npm downloads API](https://api.npmjs.org/downloads/point/last-week/yaml) — weekly downloads, week 2026-09-25 to 2026-10-01 (pattern: `/downloads/point/last-week/<package>`).
14. [Bundlephobia](https://bundlephobia.com/) — alternative size figures (e.g. yaml 31.3 kB gzip, smol-toml 5.6 kB, papaparse 6.8 kB, jsonld 30.2 kB); differ from my measurements in some cases.
15. [Frictionless Standards — Table Schema](https://specs.frictionlessdata.io/table-schema/) — "array: valid JSON format arrays", no delimiter property; boolean defaults; self-referencing foreign key with `resource` = "".
16. [W3C — Model for Tabular Data and Metadata on the Web (CSVW)](https://www.w3.org/TR/tabular-data-model/) — column `separator`, `ordered`, `aboutUrl`/`propertyUrl`/`valueUrl`, foreign keys.
17. [JSON Graph Format](https://jsongraphformat.info/) and [JGF specification repository](https://github.com/jsongraph/json-graph-specification) — v2: `graph`/`graphs`, `nodes` as a map, edges with `source`, `target`, `relation`, `directed`, `label`, `metadata`; hyperedges.
18. [OPML 2.0 specification](https://opml.org/spec2.html) — `outline`, required `text`, nested outlines, `category` comma-separated slash-delimited, subscription lists.
19. [Obsidian Help — Tags](https://obsidian.md/help/tags) — YAML `tags` list, inline tags, nested tags with `/`, parent-tag search, allowed characters.
20. [Daminion — Hierarchical keywords in Lightroom: be careful](https://daminion.net/articles/tips/hierarchical-keywords-in-lightroom-be-careful/) — `lr:HierarchicalSubject` versus `dc:subject`, the `|` delimiter, MWG rule of one `dc:subject` entry per hierarchy node.
21. [Exiv2 — XMP lr (Adobe Lightroom) schema](https://exiv2.org/tags-xmp-lr.html) — namespace `http://ns.adobe.com/lightroom/1.0/`, `hierarchicalSubject` as an XmpBag of text.
22. [Exiv2 — XMP mwg-kw (Metadata Working Group keywords)](https://exiv2.org/tags-xmp-mwg-kw.html) — `Keywords/Hierarchy`, `Keyword`, `Applied`, `Children`.
23. [ExifTool — MWG tags](https://exiftool.org/TagNames/MWG.html) — MWG 2.0 hierarchical keywords (`KeywordInfo`, `HierarchicalKeywords`).
24. [Exiv2 — XMP digiKam schema](https://exiv2.org/tags-xmp-digiKam.html) — `TagsList` holding `/`-separated tag paths (corroborated by [KDE bug 185805](https://bugs.kde.org/show_bug.cgi?id=185805)).
25. [TagSpaces — metadata file formats](https://docs.tagspaces.org/dev/metafileformats/) — `.ts` folder, per-file JSON sidecar `tags: [{title, type, color, textcolor}]`, folder `tsm.json`.
26. [Hydrus Network — sidecars](https://hydrusnetwork.github.io/hydrus/advanced_sidecars.html) — `.txt` and `.json` sidecars, naming, newline-separated tags, JSON path routing.
27. [Hydrus Network — tag parents](https://hydrusnetwork.github.io/hydrus/advanced_parents.html) and [siblings](https://hydrusnetwork.github.io/hydrus/advanced_siblings.html) — child → parent implication, multiple parents; sibling n-to-1 mapping; `namespace:subtag`.
28. [W3C — SKOS Simple Knowledge Organization System Reference](https://www.w3.org/TR/skos-reference/) — direct `broader`/`narrower`, transitive variants, concept schemes, collections, poly-hierarchy, preferred labels.
29. [W3C — JSON-LD 1.1](https://www.w3.org/TR/json-ld11/) — node references versus embedding, flattened form, `@container` (`@set`, `@list`, `@index`), `@reverse`.
30. [TOML v1.0.0 specification](https://toml.io/en/v1.0.0) — arrays of tables, sub-tables, inline tables, dotted keys, mixed-type arrays, no null, no key-order guarantee.
31. [YAML 1.2.2 specification](https://yaml.org/spec/1.2.2/) — anchors, aliases, representation graph versus serialisation tree, cycles permitted.
32. [Cytoscape.js — elements JSON and compound nodes](https://js.cytoscape.org/#notation/elements-json) — `parent` field of a compound node, immutable.
33. [d3-hierarchy — stratify](https://d3js.org/d3-hierarchy/stratify) — id/parentId table, one parent, one root, no cycles; `stratify.path()` for slash paths.
34. [GraphML Primer](http://graphml.graphdrawing.org/primer/graphml-primer.html) — nested graphs, hyperedges, ports, `edgedefault`, key/data attributes.
35. [GEXF — Graph Exchange XML Format](https://gexf.net/) — hierarchy support, dynamics.
36. [RFC 4180 — Common Format and MIME Type for CSV Files](https://www.rfc-editor.org/rfc/rfc4180) — informational; header line optional; quoting; "considerable differences among implementations".
37. Wickham H. [Tidy Data](https://www.jstatsoft.org/article/view/v059i10). Journal of Statistical Software. 2014;59(10):1–23 — one variable per column, one observation per row, one table per observational unit.
38. [JSON:API — document structure, resource identifier objects, compound documents](https://jsonapi.org/format/#document-compound-documents) — linkage and `included`, no duplicate resource objects.
39. [Hugo — front matter](https://gohugo.io/content-management/front-matter/) — YAML `---`, TOML `+++`, JSON `{}` delimiters; taxonomy terms in front matter.
40. [Jekyll — posts](https://jekyllrb.com/docs/posts/) — categories and tags, whitespace splitting, categories from directories above `_posts`.
41. [Hugo — content organisation](https://gohugo.io/content-management/organization/) — sections from directories, `_index.md` front matter for section/taxonomy/term pages, page bundles.
42. [JSON Reference — Internet-Draft draft-pbryan-zyp-json-ref-03 (expired)](https://datatracker.ietf.org/doc/html/draft-pbryan-zyp-json-ref-03) — `{"$ref": …}`, resolution via JSON Pointer; expired 2012-era draft.
43. [RFC 6901 — JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901) — string syntax, `/foo/0`, `~0`/`~1` escapes.
44. [pandas — Series.str.get_dummies](https://pandas.pydata.org/docs/reference/api/pandas.Series.str.get_dummies.html) — delimited string column → indicator DataFrame, default `sep='|'`.
45. [MDN — File.webkitRelativePath](https://developer.mozilla.org/en-US/docs/Web/API/File/webkitRelativePath) — relative path from a `webkitdirectory` picker; Baseline August 2025; available in Workers.
46. [Linux man-pages — link(2)](https://man7.org/linux/man-pages/man2/link.2.html) — EPERM for hard links to directories; hard links indistinguishable from the original.
47. [Linux man-pages — group(5)](https://man7.org/linux/man-pages/man5/group.5.html) — `group_name:password:GID:user_list`, comma-separated members.
48. [RFC 8259 — The JSON Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259) — objects unordered, names SHOULD be unique and implementations differ, arrays ordered.
49. [exifr (GitHub)](https://github.com/MikeKovarik/exifr) — read-only, XMP via a minimalistic XML parser, full/lite/mini bundle sizes, browser support.
50. [MDN — DOMParser](https://developer.mozilla.org/en-US/docs/Web/API/DOMParser) — `parseFromString` for XML/HTML; not available in Web Workers or Node.
51. [NetworkX — node_link_data](https://networkx.org/documentation/stable/reference/readwrite/generated/networkx.readwrite.json_graph.node_link_data.html) — current signature `edges='edges'`, `nodes='nodes'`, `source`, `target`, `directed`, `multigraph`, `graph`.
52. [DCMI Metadata Terms — subject](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/subject/) — `dcterms:subject`, "a topic of the resource", prefer a URI in a controlled vocabulary.
53. [d3-force — link](https://d3js.org/d3-force/link) — links as an array of `{source, target}`, node id accessor.
54. [jsonld.js README (npm)](https://www.npmjs.com/package/jsonld) — browser bundles, `documentLoader`.
55. Local experiments (this session, scratch directory, Node 23.11): `yaml` 2.9.1, `js-yaml` 5.4.2, `smol-toml` 1.9.0, `papaparse` 5.7.0, `d3-dsv` 3.0.1, `jsonc-parser` 3.3.1, `exifr` 7.1.3, `jsonld` 9.0.0, `fast-xml-parser` 5.11.2, `gray-matter` 4.0.3, esbuild for sizes. Results quoted in sections 3(a), 3(m), 5.2, 5.4, 7: alias identity and re-aliasing on stringify; `maxAliasCount` failure at 150 aliases of one anchor; YAML 1.1 versus 1.2 scalar typing; stringifier quoting; smol-toml null handling; papaparse error codes; per-library esbuild minified+gzip sizes. Reproducible from the versions listed; no result depends on private data.

Sources read but not cited: the OPML spec landing page, the Neo4j import documentation (the CSV header section was not retrievable, so no Neo4j claim is made), and the GEXF pages beyond the home page.
