# Standard terminology for "flat items + structuring metadata" — research 03

*Scope: the file-system, personal-information-management (PIM) and data-modelling vocabulary for organising a flat set of items with many-to-many group membership instead of one folder tree. The classification-theory vocabulary (facet, taxonomy, thesaurus, folksonomy, Z39.19, ISO 25964, SKOS, OWL, MeSH, constraint profiles) is already covered by [1] and the decisions D1-D24 in [2] and is cited here by pointer, not repeated. Date of research: 2026-10-04.*

*Verification legend. "Read" means I read the primary text. "Seen via search" means I saw only a search-result abstract or a secondary summary, so the claim is as reliable as that snippet. "Not verified" means I could not confirm it and say so. Statements labelled "inference" or "estimate" are my own reasoning, not a sourced fact.*

## 0. Main findings

1. **There is no single established name for "flat set of items + structuring metadata".** Four research communities each named a piece of it and, as far as I could tell (inference), rarely cite each other: the operating-systems community ("semantic file system", "attribute-based naming", "tag-based file system") [3, 4, 5, 6], the PIM/HCI community ("multiple classification", "folders versus tags", "placeless" property-based document spaces) [7, 8], the library-science community ("polyhierarchy", "faceted classification") [1, 9], and the social-web community ("tagging", "folksonomy") [10, 11]. The data-modelling community has the implementation vocabulary (junction table, entity-attribute-value, bridge table) [12, 13, 14]. A survey of metadata-focused file systems calls the family "metadata-focused file management systems" [15], which is descriptive rather than canonical.
2. **Recommended names for the README and docs:** *tag-based organisation* as the plain-language umbrella (it is what users, the OS literature and the folders-versus-tags studies already say), and *polyhierarchy* as the precise technical name for the structure we implement (a node with one or more parents, necessarily acyclic) [9]. "Semantic file system" is the lineage name for the file-system ancestors; "faceted" names the browsing style, not the data model. Details and a draft tagline are in section 3.
3. **The zodal-groups vocabulary (node, edge, kind, profile, membership, projection, PathNode) is consistent with established usage**, with three collisions worth resolving: `taxonomy` (a WordPress "taxonomy" is a whole vocabulary, not a hierarchy) [16], `label` (Gmail label, Kubernetes label and Neo4j label mean three different things) [17, 18, 19], and `collection` (already taken by zodal's own CRUD collection; Zotero, Presto and Are.na use it for a group) [8, 20]. See section 3.3.
4. **The empirical literature mostly disconfirms "tags beat folders" as a user-behaviour claim**, and even where it is mixed it supports a folder-like default view with multi-membership revealed progressively [7, 21, 22, 23, 24]. See section 4. Caveat: nearly all of those studies concern personal files and email, not application data managed through a CRUD library, so transfer to our use cases is an inference.

## 0.1 Addendum (2026-10-04): "view"

"View" has three meanings in the zodal/acture fleet. In polytag: a **view** is a layout configuration (`ViewConfig`: shell, navigator, layout, inspector, interaction), a lens over shared state; a **saved view** adds a name, filter, sort, group and scope. Neither is acture's `ViewRecord` (a named selector over state exposed to agents), which a polytag app would also register (selection, scope).

## 1. Glossary

Column "API?" means: **yes** = canonical term in our API and docs; **alias** = documented synonym or a UI "skin" word, not a type name; **docs** = used in prose only; **no** = avoid in the API (reason given).

### 1.1 Names for the overall approach

| term | definition | origin / source | synonyms | API? |
|---|---|---|---|---|
| semantic file system | A file system whose names are queries over attributes extracted from file contents by file-type-specific "transducers"; a path is interpreted as a conjunctive query via "virtual directories". | Gifford et al., SOSP 1991 [3, 25] | attribute-based file system, query-based namespace | docs (lineage) |
| attribute-based naming | An object has many properties of which the name is only one; "a query specifies one or more properties of the objects you are looking for". Sechrest and McClennen blended attribute components into ordinary directory paths. | [25] (read); [4] (seen via search) | descriptive naming, content-based access | docs |
| virtual system model | Users build their own "virtual systems" by selecting and organising the objects and services of interest (Prospero). | Neuman 1992 [26] (seen via search) | | docs |
| hierarchy and content (HAC) | Combining directories and symlinks with query-defined "semantic directories" holding symlinks to matching files; raises scope-consistency and data-consistency problems. | Gopal and Manber, OSDI 1999 [27] | hybrid hierarchical / content-based file system | docs |
| tagged, search-based namespace | Seltzer and Murphy's replacement for the hierarchical namespace: an object "is named by one or more tag/value pairs", and a POSIX path "is simply one name among many". | Seltzer and Murphy, HotOS 2009 [5] (read) | tag-based file system, tagged file system | docs |
| tag-based file system | A file system, usually FUSE-based, that exposes tags as directories and queries as paths. Examples: TagFS/SemFS (2006), Tagsistant, TMSU. | [6, 28, 29, 30] | semantic file system (Wikipedia uses "tags", "metadata", "semantic" and "virtual directory" interchangeably [30]) | docs |
| metadata-focused file management | Umbrella phrase used in a design-space survey for systems that replace or supplement the hierarchical file system with metadata (tags or attribute-value pairs). | Watson et al. 2017 [15] (seen via search) | post-hierarchical, non-hierarchical | docs (descriptor) |
| placeless / property-based document space | Organising documents by user-level properties ("Word file", "shared with Jim", "currently in progress") rather than by location; documents and collections are both documents. | Dourish et al., Presto, 1999 [8] (read) | document space, fluid document space | docs |
| multiple classification | Assigning one item to several categories. Bergman et al. report it "was used for storage, it was only marginally used for retrieval". Not to be confused with machine-learning *multi-label classification* (non-exclusive labels per instance) [31]. | [7] | multi-classification, many-to-many categorisation | alias (docs) |
| polyhierarchy | A hierarchy in which each node has one or more parents; it must be acyclic, so it is a directed acyclic graph. The same structure is called *multiple inheritance* in object-oriented design (equivalence seen via search of OO knowledge-representation sources, not stated in the cited glossary). | [9]; Z39.19 definition via [1] | multi-parent hierarchy, DAG | **yes** (name of the group graph) |
| faceted classification / faceted search | Classification by several orthogonal axes (facets) instead of one tree; modern faceted search combines hierarchical facet values with keyword search. Ranganathan (1930s) via [1]; Hearst's Flamenco work via [1]; Yee et al. 2003 [32]; Tunkelang 2009 [33]. | | faceted browsing, faceted navigation, dynamic taxonomy | **yes** (facet = axis; section 3.2) |
| tagging / social tagging / collaborative tagging | Users attach free keywords to resources; popularised by Delicious (2003) and Flickr [34]; the field's early papers are [10, 35]. | | free tagging, social bookmarking | alias |
| folksonomy | Formalised by Hotho et al. as a tuple F = (U, T, R, Y, ≺): users, tags, resources, a ternary relation Y ⊆ U × T × R of "tag assignments", and an optional per-user subtag/supertag relation. Equivalent to a triadic context in Formal Concept Analysis and to a tripartite hyperedge set. | [11] (read); tripartite model first in [36] | collaborative tagging vocabulary | **yes** (existing `folksonomy` profile) |
| flat namespace (plus metadata) | Object stores have "a flat structure instead of a hierarchy"; a console "folder" is only a shared key prefix, and prefix categorisation "is one-dimensional" whereas tags add "another dimension". Azure contrasts a *flat namespace* with a *hierarchical namespace*. | [37, 38, 39] | flat key space | alias (tagline-able descriptor) |

### 1.2 Names for the thing being organised (the "item")

| term | definition | origin / source | synonyms | API? |
|---|---|---|---|---|
| item | Generic leaf thing in a collection of references, notes, files. The Zotero unit that goes into collections. | [20] (seen via search) | | **yes** (docs and `maxParentsPerItem`) |
| node | A vertex of the membership graph; formal type that covers both items and groups. | graph theory; zodal-groups D5 [2]; Neo4j "node" [19] | vertex | **yes** (formal type) |
| object | Gifford's unit of attribute-based retrieval; also S3 "object", Kubernetes "object", Tagsistant "object". Heavily overloaded in JS. | [18, 25, 28, 38] | | no (overloaded) |
| resource | Hotho's R in the folksonomy tuple (URLs in Delicious, pictures in Flickr). Overloaded by REST and RDF. | [11] | | no (overloaded); docs when discussing folksonomies |
| document | Presto's unit; in Presto "the difference between files and documents" is deliberate: "Documents, though, are not files". | [8] | | no |
| file | Unit in TMSU, Hydrus, tag file systems. | [29, 40] | | alias for `filesystem`-profile UI |
| block | Are.na's unit that connects to channels. | Are.na docs via [1] | | no |
| permanode | Perkeep's "immutable root anchor of mutable objects"; its attributes (`tag`, `camliMember`) are replayed from signed claims. | [41, 42] | | no |

### 1.3 Names for the grouping thing

| term | definition | origin / source | synonyms | API? |
|---|---|---|---|---|
| group | Neutral umbrella for "anything an item can belong to": folder, tag, label, collection, category. | zodal-groups [2]; no established cross-system term exists | | **yes** (canonical) |
| tag | A small piece of text describing a single property of something; many per item; usually flat. In Hydrus: "a small bit of text describing a single property of something". In S3 and Kubernetes it is a key-value pair. | [34, 38, 40] | label, keyword | alias (UI skin for flat profiles) |
| label | Gmail: a conversation "can have as many labels applied to it as you like"; labels can be nested. Kubernetes: key/value pairs that "do not provide uniqueness". Neo4j: a node can carry any number of labels, which group nodes into sets. Three meanings. | [17, 18, 19] | | alias (Gmail-style skin); no as a type name (collides with `Node.label` display text) |
| collection | Zotero: items can be in many collections; Presto: a document that groups documents, with membership "defined both statically and dynamically"; Are.na channel is the analogue. | [8, 20] | channel (Are.na), set | alias (UI skin); **no** as type name (zodal already uses `collection` for the CRUD collection) |
| category | WordPress: the hierarchical taxonomy type, as opposed to the flat `post_tag`. | [16, 43] | | alias |
| term / taxonomy / vocabulary | WordPress: a *taxonomy* is a classification system (category, tag, custom), a *term* is one value in it, joined to posts by a relationships table. Drupal: a *vocabulary* of *terms* with hierarchy set to disabled, single or multiple parent. | [16, 43, 44] | | no (collision, see 3.3) |
| folder / directory | A group where the profile forces one parent per item and per group. | POSIX; zodal-groups profile `filesystem` [2] | | alias (UI skin) |
| facet | An axis of classification ("a grouping of concepts of the same inherent category"), not a node. Hydrus's *namespace* (`character:`, `series:`) and S3/Kubernetes *keys* play the same role. | [1, 18, 40] | namespace, key, dimension | **yes** (axis); see 3.2 |
| namespace | In Hydrus, "a category and a colon" prefix on a tag; in Flickr machine tags, the first of namespace:predicate=value; in Kubernetes an isolation scope; in Tagsistant a crowded flat tag namespace. | [18, 28, 34, 40] | | no (four meanings); accept as import syntax only |

### 1.4 Names for the relation and the operations

| term | definition | origin / source | synonyms | API? |
|---|---|---|---|---|
| membership | "Document collection membership can be defined both statically and dynamically." In our model: an edge of kind `contains` from group to child. | [8]; [2] | | **yes** |
| edge | The reified record of a relation, carrying kind, order, label, meta. | [2] D3-D4 | link, relationship (property graphs) | **yes** (formal) |
| tag assignment (tas) / tagging | One (user, tag, resource) triple; a *post* is all tags one user gave one resource. Rails-style plugins call the join record a *tagging*. | [11]; the Rails usage is not verified here | tag mapping (Hydrus: "file->tag mappings" [40]) | alias (docs for flat profiles) |
| term relationship | The WordPress join record between an object and a term-in-taxonomy. | [43] | | alias |
| connection | Are.na's name for a block's link to a channel; the API exposes the channels a block appears in. | Are.na docs via [1] | | alias |
| filing / unfiling | The PIM term for placing an item in a folder. Zotero names its orphan view *Unfiled Items*. | [20, 45] | | alias (verbs for `filesystem` skin) |
| add / remove label | Gmail API modifies labels with `addLabelIds` and `removeLabelIds`; Gmail separates "label" from "move to". | [46]; the label/move split via [1] | tag / untag | **yes** (`add`, `remove`) |
| move | Remove one membership and add another in one step; destructive of an edge the user may not see. | [2] D16 | relocate, re-file | **yes** (separate verb) |
| hard link / shortcut | A second directory entry for the same file, or (Google Drive since 30 Sep 2020) a pointer item that replaced multi-parent placement. | [24]; hard-link rule via [2] | symlink | docs |
| scope / include subgroups | Search a group and everything beneath it; Zotero's "Show Items from Subcollections". | [2]; Zotero via [1] | recursive, closure | **yes** (`scope`) |

### 1.5 Names for tag semantics (booru and Hydrus vocabulary, TMSU, Tagsistant)

| term | definition | origin / source | synonyms | API? |
|---|---|---|---|---|
| tag alias / tag sibling | A→B replacement: "any time we would normally see or use tag A or tag B, we will instead only get tag B"; B is the *ideal tag*; transitive and acyclic; "no information is lost". | Hydrus [47]; Danbooru TagAlias via [1] | synonym ring, USE/UF, `skos:altLabel` | **yes** as `alias` (to a preferred tag) |
| tag implication / tag parent | "All files that have C should also have P, without exception"; multiple parents allowed; "loops are not allowed"; virtual (does not add the tag, makes it appear). | Hydrus [48]; TMSU `imply` [29]; Danbooru TagImplication via [1] | broader/narrower, is-a, `includes` (Tagsistant [28]) | alias (the end-user word for a transitive `contains` edge) |
| tag value | A tag with a value, `year=2015`; shown as a directory level in TMSU's virtual filesystem. Flickr's machine tags generalise it to namespace:predicate=value, coined in January 2007. | [29, 34] | key-value tag, triple tag, machine tag | alias; modelled as facet + value |
| personomy | A folksonomy restricted to one user; Hotho Definition 2. | [11] | personal view of a folksonomy | docs |
| tag hierarchy (induced) | Navigable taxonomy derived from tag co-occurrence rather than declared by users. | Heymann and Garcia-Molina 2006 [49] | emergent taxonomy | no |
| tagging rights / tagging support / aggregation | Marlow's taxonomy of tagging systems: self-tagging, free-for-all or permission-based; blind, suggestive or viewable; set-based or bag-based. | [50] (seen via secondary summaries) | | docs (seams for permissions, autocomplete, per-user edges) |

### 1.6 Names for derived (query-defined) groups

| term | definition | origin / source | synonyms | API? |
|---|---|---|---|---|
| saved search | A group defined by a query that re-runs on view. Zotero's saved search is a "smart collection"; Unfiled Items is itself just a saved search. | [20] (seen via search, including a forum comment for the Unfiled Items claim) | smart collection, smart folder | alias |
| smart folder | Apple's saved search that "looks like a folder but performs a search every time you view it". | [51] (secondary); tags in [52] | saved search | alias |
| virtual directory | Gifford: a path component that is a query; *value* directories list matching files, *field* directories list the available property values (a precursor of facet value lists). | [25] | semantic directory (HAC [27]) | docs |
| fluid collection | Presto: a collection of three parts, each possibly null: a live query, an inclusion list and an exclusion list. Contents = inclusion list plus query matches minus exclusion list. | [8] | smart group with manual overrides | candidate design for `smartGroup` (3.2) |
| intensional / extensional group | Group whose members are derived by a rule, versus enumerated. | Datalog EDB/IDB via [1] | | **yes** (formal) |

### 1.7 Data-modelling terms (implementation substrate)

| term | definition | origin / source | synonyms | API? |
|---|---|---|---|---|
| junction table | A relation whose main purpose is to store pairs of foreign keys for a many-to-many relationship; the primary key is usually the pair. | [12] | association, bridge, cross-reference, intersection, join, link, linking, map, mapping, pairing, pivot table (all listed on one page) | docs ("membership table") |
| term_relationships | WordPress's concrete schema: `object_id`, `term_taxonomy_id`; `parent` lives on the term-in-taxonomy row; a `count` column is cached. | [43] | | docs (prior art for a SQL adapter) |
| bridge table (dimensional modelling) | Kimball's fix for a multivalued dimension (a patient with several diagnoses). Warns of over-counting unless "an allocation/weighting factor" is carried. | [14] | | docs; the over-counting warning supports decision D17 [2] |
| entity-attribute-value (EAV) | Storing sparse or ad hoc properties as (entity, attribute, value) rows; flexible, but attribute-centred queries are less efficient and front-end display is harder. | [13] | open schema, sparse columns | docs (alternative for item properties, not for membership) |
| labeled property graph | Nodes and relationships with properties; a node may carry zero or more labels; labels group nodes into sets. | [19] | LPG | docs |
| triadic context / tripartite hypergraph | Mathematical names for the (user, tag, resource) relation. | [11] | | docs |
| label vs annotation (Kubernetes) | Labels are "identifying attributes" used to group and select; annotations hold "non-identifying information". Selectors are equality-based or set-based (`in`, `notin`, `exists`). | [18] | | docs: group memberships select, item properties describe |

### 1.8 Storage-strategy terms

| term | definition | origin / source | synonyms | API? |
|---|---|---|---|---|
| embedded metadata | Membership stored inside the item: YAML front matter (`tags:` list), XMP in the file. | [53, 54] | in-band | **yes** (adapter strategy) |
| sidecar file | A companion file next to the item; XMP uses `.xmp` for formats that cannot carry it, with keywords in `dc:subject`. | [54] (secondary) | | **yes** (adapter strategy) |
| extended attribute (xattr) | Filesystem-level key-value on the file; `user.xdg.tags` is a de facto comma-separated convention, not an official standard. | [55] | | **yes** (adapter strategy) |
| external index | Membership kept in a separate database; TMSU "does not alter your files in any way". | [29] | sidecar database | **yes** (adapter strategy) |
| content-addressed store plus index | hFAD: objects have unique IDs in a low-level object layer, higher layers hold "naming interfaces" and "index stores". Perkeep: immutable blobs, mutable state as replayed signed claims, and "the index database is redundant with the data stored in blobs and can be recreated at any time". | [5, 42] | object store plus naming layer | docs (supports D1 and D9 in [2]) |

### 1.9 Cross-system Rosetta stone

| system | item | group | membership | derived group | source |
|---|---|---|---|---|---|
| Gmail | message / conversation | label | label applied (`addLabelIds`) | search | [17, 46] |
| Zotero | item | collection (and tag) | add to collection | saved search; Unfiled Items | [20] |
| Finder (macOS) | file | tag | tagging | Smart Folder | [51, 52] |
| Amazon S3 | object | tag (key-value) or key prefix | tag set on object | none native | [37, 38] |
| Kubernetes | object | label (key-value) | label on object | label selector | [18] |
| WordPress | post | term in a taxonomy (category or tag) | term relationship | none | [16, 43] |
| Drupal | content | term in a vocabulary; hierarchy none, single or multiple | not verified | none | [44] |
| Presto | document | collection; property | attribute / membership | live query + inclusion + exclusion | [8] |
| Perkeep | permanode | permanode with `camliMember`; `tag` attribute | claim | search | [41] |
| BibSonomy | resource | tag | tag assignment | none | [11] |
| Hydrus | file | namespaced tag | file-to-tag mapping | search; siblings and parents | [40, 47, 48] |
| TMSU | file | tag (optionally with value) | tagging | query; implications | [29] |
| Tagsistant | object | tag | tag | query; `includes` and `is_equivalent` relations | [28] |
| Semantic file system (1991) | file | attribute-value pair | extracted by transducer | virtual directory | [25] |
| Neo4j | node | label | label on node | graph query | [19] |

## 2. A short history of the idea

The idea has four independent lineages. I name them because the vocabulary diverges along these lines.

**Prehistory.** Bush's 1945 essay argued that retrieval is done through indices while the mind works by association, and that "selection by association, rather than by indexing" could be mechanised [56] (seen via search). Ranganathan's analytico-synthetic Colon Classification (1920s-1930s) is the library-science origin of faceting and is covered in [1].

**Lineage A, operating systems: from directories to queries.**
- 1991: Gifford and colleagues' *Semantic file systems* introduce attribute-based access, transducers and virtual directories inside an NFS-compatible interface [3, 25]. It is an early and widely cited statement of "name by properties, not just by place" (my characterisation; I did not survey citations).
- 1992: Sechrest and McClennen blend hierarchical and attribute-based naming [4]; Neuman's Prospero lets users build their own "virtual systems" [26].
- 1999: HAC combines directories with query-defined semantic directories and documents the consistency problems of the hybrid [27]. The Be File System, with indexed attributes and live queries, is covered in [1].
- 2003-2006: Microsoft's WinFS, a relational store with typed items and relationships, is demonstrated in 2003 and shelved in June 2006, with parts folded into ADO.NET and SQL Server [57]. The cause of the cancellation is not established in the sources I read.
- 2006 on: tag file systems appear: TagFS/SemFS (WebDAV and FUSE; "retaining the notions of directories and files" while giving them tag semantics) [6], Tagsistant [28], TMSU (project created 2014) [29], and a long tail listed by Wikipedia [30].
- 2009: Seltzer and Murphy, *Hierarchical file systems are dead*, argue that hierarchical naming "has outlasted its usefulness" and propose hFAD, an object store with an index layer whose names are tag/value pairs, with POSIX as "one name among many" [5]. Note the paper is an architecture proposal with a Linux/FUSE prototype, not a user study.
- Perkeep (no date verified) pushes the pattern to its limit: immutable content-addressed blobs, mutable state as signed claims, and a rebuildable index [42].

**Lineage B, PIM and HCI: documents are not files.**
- 1995: Barreau and Nardi observe that users prefer location-based finding for its reminding function and avoid elaborate filing schemes [45].
- 1996: Lifestreams replaces "named files, directories, and explicit storage" with a time-ordered stream and filters [58].
- 1999: Presto (Placeless Documents) states the single-inheritance problem exactly: "A filesystem provides only a 'single-inheritance' structure. Files can only be in one place at a time", and answers with user-level properties and fluid collections [8].
- 2005: Haystack, a general-purpose tool over semistructured data [59] (seen via search).
- 2008-2019: Bergman, Whittaker and colleagues build the empirical record on navigation, search and folder-versus-tag preference; see section 4.
- 2020: Dinneen and Julien's review of 230+ publications on file management is the current entry point [60].

**Lineage C, social tagging.** Delicious (2003) and Flickr popularise free tagging [34]; Mathes (2004) writes the founding paper on folksonomies [10]; Mika (2005) models them as a tripartite structure of actors, concepts and instances [36]; Golder and Huberman (2006) study usage patterns [35]; Marlow et al. (2006) give a taxonomy of tagging systems [50]; Hotho et al. (2006) give the formal definition F = (U, T, R, Y, ≺) used by BibSonomy [11]; Heymann and Garcia-Molina (2006) derive hierarchies from tags [49]; Flickr introduces machine tags in 2007 [34]. Booru-style sites and Hydrus add implication and alias vocabulary [47, 48].

**Lineage D, library and information science.** Faceted classification, Z39.19, ISO 25964, SKOS and polyhierarchy are in [1]; Hearst's hierarchical faceted metadata line continues with Yee et al. (2003) [32] and Tunkelang's 2009 monograph [33].

**Substrate: data modelling.** Every lineage ends up as items, groups and a junction table; WordPress's `term_relationships` is the mass-market instance [12, 43]. Property-style metadata ends up as entity-attribute-value or key-value maps (S3, Kubernetes, Perkeep attributes) [13, 18, 38, 41].

**What the history implies (inference).** The same structure was reinvented under at least ten names and rediscovered each time from a different pain point. For a library, the useful artefact is therefore the Rosetta stone in sections 1.9 and 3.2, not a single "correct" term.

## 3. Recommendation

### 3.1 The name of the approach (README tagline and docs)

Use two established names with distinct jobs, and keep the others as documented aliases.

1. **"Tag-based organisation"** is the umbrella users already understand. It is the phrase of the OS literature ("tag-based file systems") and of the PIM studies that pit folders against tags [6, 7, 30]. Its weakness is that "tag" suggests flat, keyless, unnested labels, so docs must say immediately that groups nest and an item can sit in many.
2. **"Polyhierarchy"** is the precise name for the structure: each node has one or more parents, acyclic [9]. It is also the term of art in information architecture, so a reader who searches for it finds the right literature (and the earlier research found npm has almost nothing under it [2]).

Aliases to list in the docs glossary: *semantic file system* (ancestors), *faceted* (the browsing style) [32, 33], *multiple classification* (PIM literature) [7], *flat namespace plus metadata* (object-store developers) [37, 39], *non-hierarchical* and *metadata-focused file management* (descriptors) [15].

I found no source that names the combination "flat items plus structuring metadata" as a single established term. A draft tagline, which is my wording and not an established phrase: **"Folders that overlap and tags that nest: a flat set of items, organised by groups an item can share."**

### 3.2 Canonical nouns and verbs

| concept | canonical | accepted aliases (docs, UI skins) | avoid | reason |
|---|---|---|---|---|
| the thing being managed | **item** (formal type `Node`) | file, entry, record, note (per host app) | object, resource, document, block | `object` and `resource` are overloaded in JS and REST/RDF; `item` is the Zotero and zodal-groups word [2, 20] |
| the thing items belong to | **group** (a node that has children) | folder, tag, label, collection, category | `collection`, `label`, `class`, `set`, `bucket` as type names | `collection` is zodal's CRUD term; `label` collides with `Node.label` and means three things across Gmail, Kubernetes and Neo4j [17, 18, 19] |
| the relation record | **edge** (formal), **membership** (an edge of kind `contains`) | tagging, tag assignment, labeling, connection, term relationship | link, relationship | Presto uses "membership" [8]; Hotho's "tag assignment" is the folksonomy form [11] |
| the relation's type | **kind** | relation type, predicate | `type` | property graphs say "relationship type", RDF says "predicate"; `kind` avoids TypeScript's `type` |
| a named restriction set | **profile** | preset, mode | | OWL 2 Profiles precedent via [1] |
| an axis of classification | **facet** | namespace (import syntax only), key, dimension | `namespace` | Hydrus namespace, Flickr namespace and Kubernetes namespace mean different things [18, 34, 40] |
| a descriptive value on an item | **property** | attribute, field, metadata, annotation | | Presto uses properties and attributes interchangeably; Kubernetes' label/annotation split is the clearest statement of "membership selects, properties describe" [8, 18] |
| a query-defined group | **smart group** (formal `IntensionalGroup`) | saved search, smart folder, virtual directory, live collection | | all four are established [8, 20, 25, 51] |
| items in no group | **unfiled** | orphans, inbox | | Zotero's "Unfiled Items", itself a saved search [20] |
| "also in these groups" | **otherLocations** | appears in | | Are.na precedent via [1]; "location" echoes Presto's complaint about single place [8] |
| search a group and below | **scope** | include subgroups, recursive | | [2] |
| transitive child-implies-parent | **implies** (end-user) / closure (internal) | tag implication, tag parent, broader | | Hydrus, TMSU and Danbooru agree on "implication" [29, 48] |
| non-preferred name for a preferred group | **alias** | sibling, synonym, USE/UF | | Hydrus and Danbooru agree on alias/sibling [47] |
| derive structure for rendering | **projection** (pure functions), **view** (UI descriptor) | | | collision: "projection" also means column selection in relational algebra and read-model in event sourcing; neither was verified in this research |
| verbs | `add`, `remove`, `move`, `delete` (the item), `create`/`rename` (the group) | `file`/`unfile` (folder skin), `tag`/`untag` (tag skin), `label`/`unlabel` (label skin) | `link`, `assign` as primary | Gmail's API uses add/remove [46]; remove-membership must never be conflated with delete-item [2] |

Two design suggestions that follow from the sources, offered as candidates for the plan rather than as decisions:

- **A "wording" seam per profile.** The same model is "folders and files" in Finder, "labels" in Gmail, "collections" in Zotero, "tags" in Finder and Hydrus [17, 20, 40, 52]. Each profile could carry a small map of UI words (noun for group, verb for add, noun for orphan view) so the API vocabulary stays fixed while the product vocabulary matches the user's mental model. This is a UI-skin concern, not a data-model one.
- **Smart groups as "rule plus pinned minus excluded".** Presto's fluid collection is a documented, 25-year-old precedent for the hybrid of an intensional rule with extensional overrides, in exactly three parts [8]. The zodal-groups decision to keep intensional groups leaf-only in v1 [2] is compatible with adopting this shape for the group's extent.

### 3.3 Consistency check against zodal-groups

I read the public README and `model.ts`/`profile.ts` of zodal-groups and compared them with the established usage above.

| zodal-groups term | established usage | verdict |
|---|---|---|
| node | graph term; Neo4j node [19] | consistent |
| edge | graph term; reified relation [2] | consistent |
| kind | property-graph "relationship type"; RDF predicate | consistent; document the synonym |
| profile | OWL 2 Profiles precedent via [1]; Drupal's three hierarchy settings are a tiny profile [44] | consistent |
| membership | Presto [8] | consistent |
| projection | event-sourcing read model; relational projection | consistent with the former; document the latter collision (not verified here) |
| PathNode | no established term; closest is a flattened tree row | keep; it is a deliberate coinage |
| GroupSpace | Presto's "document space" [8] | consistent |
| smartGroup / IntensionalGroup | Zotero saved search, Apple Smart Folder, Presto live collection | consistent |
| unfiled, otherLocations | Zotero, Are.na | consistent |
| `taxonomy` profile (groups of groups only, no items) | Z39.19 says a taxonomy may be a polyhierarchy [1]; WordPress "taxonomy" is a whole vocabulary or axis such as category or post_tag [16] | **collision**: the name will mislead WordPress and Drupal users; consider a more literal name such as `skeleton` or document the difference prominently |
| `labels` profile | Gmail semantics, but "label" is also Kubernetes key-value and Neo4j node label [18, 19] | keep (Gmail-style), always say "Gmail-style" in docs |
| `flatTags` profile | S3, Kubernetes, TMSU and Flickr tags are key-value or valued [18, 29, 34, 38]; ours is keyless | **gap**: no profile for valued tags; model as facet plus value (or as an item property) and name it, for example `facets` or `keyedTags` |
| `folksonomy` profile | Hotho's (U, T, R, Y) triple [11] | consistent |
| package name "groups" | no cross-system standard; `collection` blocked by zodal | keep |

## 4. Disconfirming evidence: where hierarchies and folders win

The evidence below argues against the strong form of the thesis ("users should abandon folders for tags"). It does not argue against the model (flat edges, many parents), which the reconciliation already separates from the default projection [2].

| study | what it found | source and verification |
|---|---|---|
| Bergman, Gradovitch, Bar-Ilan, Beyth-Marom 2013 (Gmail, 75 participants; Windows 7, 23) | "A strong preference for folders over tags for both storage and retrieval"; when tags were used, typically one per item; multiple classification used for storage but "only marginally used for retrieval"; tag retrieval had lower success and was slower. | [7], abstract read |
| Bergman et al. 2008 (Google Desktop vs Windows XP search; Spotlight vs Sherlock) | Users estimated 56-68% of retrievals by navigation and 4-15% by search; improving the search engine had limited, inconsistent effect on search use; search served mainly as a last resort; no evidence people reduced reliance on hierarchical filing. | [21], seen via search-result abstract |
| Bergman, Israeli, Whittaker 2019 (289 participants, 1,557 files) | Counter to expectation, over-50s searched more than four times as much as people in their twenties; the authors suggest older users forget locations and discuss neurocognitive roots of navigation preference. The neurocognitive account is their hypothesis, not a finding. | [22], abstract read |
| Fitchett, Cockburn 2015 (26 participants, four weeks) and Fitchett, Cockburn, Gutwin 2013 | The 2015 paper characterises real file retrieval; secondary sources cite it as evidence of navigation preference, which I could not confirm in the text. The 2013 CHI Best Paper starts from the premise that navigation through a hierarchy is slow and repetitive and shows that augmenting the file browser (Icon Highlights, Search Directed Navigation) reduces retrieval time. | [23, 61], seen via search; abstract pages blocked |
| Barreau and Nardi 1995 | Users preferred location-based finding because of its reminding function, avoided elaborate filing schemes, and used simple structures. | [45], seen via search-result summary |
| Jones et al. 2005, "Don't take my folders away!" | Title and venue verified; I did not read the content, so I use it only as a pointer to the user-attachment literature. | [62] |
| Google Drive 2020 | "No longer possible to place an item in multiple folders"; multi-parent items migrated to shortcuts. A mainstream product judged a visible-pointer model more teachable than multi-parenting. | [24], read via search results; already analysed in [2] |
| Whittaker et al. 2011 (345 email users, 85,000 refinding actions) | Mixed, and partly in our favour: people who build complex folders rely on them, but the preparation "does not improve retrieval success"; search and threading promote more effective finding. | [63], seen via search |
| Voit, Andrews, Slany 2012 | Mixed: with the tagstore framework, "tagging does not necessarily mean slower filing", and experienced users were faster. | [64], seen via search |
| Yee et al. 2003 (32 participants, 35,000 images) | 90% of participants preferred the faceted hierarchical metadata approach overall, against a "standard baseline system"; I did not verify what that baseline was, so this does not show that facets beat folders. | [32], seen via search |

**What this implies for the default UI (inference, not a sourced fact).**

1. **Default to a folder-like projection, not a tag cloud.** The preference for folders is the most consistent finding and holds across Gmail, Windows and Mac settings and across age groups [7, 21, 22]. Miller columns are the right default because they are also the macOS Finder's column view, so the familiar metaphor and the polyhierarchy-safe projection coincide [65]; this reconciles the reconciliation's "default projection must not be the tree" with D12's "always something a user already understands" [2].
2. **Show one primary location and reveal the rest on demand.** Because people use tags as folders (typically one tag per item) and rarely use multiple classification at retrieval [7], the primary path should be the breadcrumb and the other memberships a quiet "also in N groups" affordance. This is the existing `otherLocations` design [2].
3. **Keep positions stable.** Location memory is the stated reason people prefer navigation [22, 45]. Order lives on the edge (D4), and projections should not reshuffle between visits. Augmenting navigation, as Fitchett et al. did, beats replacing it [61].
4. **Search complements navigation; it is not the primary.** Search is a fallback when location is forgotten [21, 22], so make it one keystroke away, scoped to the current group (the existing `scope`), but do not hide the browse structure behind it.
5. **Lower the cost of organising.** Filing effort did not improve email retrieval success in the largest field study [63]. Favour smart groups, an `unfiled` inbox, default-add (not move) drag, and auto-assignment hooks so that the user is never required to classify.
6. **Make the single-membership path as cheap as a folder move.** Tagging may be as fast as filing for experienced users [64] but is slower in the controlled retrieval task of [7]; do not charge extra interaction cost for the common one-group case.
7. **Skin the vocabulary per profile** (section 3.2) so a `filesystem` profile says "folder" and "file in", since users hold folders as the default mental model [7, 62].

**Limits of this evidence.** Almost all of these studies are of personal files or email from 2008-2019, with Windows, Mac and Gmail users and small samples; none studies application data managed through a CRUD toolkit, agent-written documents, or AI-assisted search. The effect of modern semantic search on navigation preference is not covered. Treat the preference for folders as a strong prior for the default projection, not as a proven constraint on the model.

## 5. Gaps and things I could not verify

- **TagsFS** (named in the brief): I found TagFS/SemFS (2006) and Tagsistant but no distinct system called TagsFS; it may be the same as TagFS. I did not look further [6, 30].
- **Fitchett and Cockburn 2015**: only its abstract summary (26 participants, four weeks) was reachable; the claim that it shows navigation preference comes from secondary citations [23].
- **Sechrest and McClennen 1992, Neuman 1992, Haystack 2005, Marlow et al. 2006, Barreau and Nardi 1995, Whittaker et al. 2011, Voit et al. 2012**: seen via search-result abstracts or secondary summaries, not read in full.
- **Jones et al. 2005**: title and venue only.
- **Lifestreams**: the paper PDF could not be text-extracted; vocabulary comes from the project page, and the venue year is taken from the SIGMOD Record URL path [58].
- **Danbooru alias/implication pages**: the live help pages timed out; I rely on Hydrus's own documentation and on the earlier report's Danbooru source [1, 47, 48].
- **Rails-style "tagging" join record, event-sourcing "projection"**: stated from general knowledge, not verified in this research.
- **Drupal multi-parent behaviour and Apple Smart Folder, XMP details**: seen via search results or secondary pages [44, 51, 54].
- **WinFS cancellation causes**: not established in what I read [57].
- **Tag usage statistics at scale** (how many tags per item in the wild, depth of nesting): not researched; Golder and Huberman is the place to start [35].

## REFERENCES

1. zodal-groups research 01, **Classification theory, polyhierarchy, and tag-system semantics** (public repo, `docs/research/zgroups_01-classification-theory-and-polyhierarchy.md`). Its own numbered reference list (e.g. its [12] Vander Wal, [15] Zotero, [19-20] Are.na, [21-22] Gmail API, [23] Danbooru, [25-26] BeFS) is relied on here by pointer and was not re-verified. [https://github.com/i2mint/zodal-groups](https://github.com/i2mint/zodal-groups)
2. zodal-groups, **Reconciliation: the merged decisions** (`docs/research/_reconciliation.md`), decisions D1-D24. [https://github.com/i2mint/zodal-groups](https://github.com/i2mint/zodal-groups)
3. Gifford DK, Jouvelot P, Sheldon MA, O'Toole JW. **Semantic file systems.** Proc. 13th ACM SOSP, 1991. Bibliographic record. [https://honnef.co/notes/references/giffordsemanticfilesystems1991](https://honnef.co/notes/references/giffordsemanticfilesystems1991)
4. Sechrest S, McClennen M. **Blending hierarchical and attribute-based file naming.** Proc. 12th ICDCS, 1992. Seen only via a search-result abstract and a bibliography; the paper itself was not read. [https://wisc.academia.edu/MichaelMcclennen](https://wisc.academia.edu/MichaelMcclennen)
5. Seltzer M, Murphy N. **Hierarchical file systems are dead.** Proc. HotOS XII, 2009 (read in full text). [http://usenix.org/event/hotos09/tech/full_papers/seltzer/seltzer.pdf](http://usenix.org/event/hotos09/tech/full_papers/seltzer/seltzer.pdf)
6. Bloehdorn S, Goerlitz O, Schenk S, Voelkel M. **TagFS: tag semantics for hierarchical file systems.** Proc. I-KNOW 06, Graz, 2006. Bibliographic record (the poster PDF could not be parsed). [https://bibsonomy.org/bibtex/ab2f49f3779bb2ff505135917eae8975](https://bibsonomy.org/bibtex/ab2f49f3779bb2ff505135917eae8975)
7. Bergman O, Gradovitch N, Bar-Ilan J, Beyth-Marom R. **Folder versus tag preference in personal information management.** JASIST 64(10):1995-2012, 2013. [https://ideas.repec.org/a/bla/jamist/v64y2013i10p1995-2012.html](https://ideas.repec.org/a/bla/jamist/v64y2013i10p1995-2012.html)
8. Dourish P, Edwards WK, LaMarca A, Salisbury M. **Presto: an experimental architecture for fluid interactive document spaces.** ACM TOCHI 6(2):133-161, 1999 (read in full text). [https://dourish.com/~dourishc/publications/1999/tochi-presto.pdf](https://dourish.com/~dourishc/publications/1999/tochi-presto.pdf)
9. SNOMED International. **SNOMED CT glossary: polyhierarchy / polyhierarchical classification** (each node has one or more parents; must be acyclic). [https://docs.snomed.org/snomed-international-documents/snomed-ct-glossary/p/polyhierarchy](https://docs.snomed.org/snomed-international-documents/snomed-ct-glossary/p/polyhierarchy)
10. Mathes A. **Folksonomies: cooperative classification and communication through shared metadata.** 2004. [https://adammathes.com/academic/computer-mediated-communication/folksonomies.html](https://adammathes.com/academic/computer-mediated-communication/folksonomies.html)
11. Hotho A, Jaeschke R, Schmitz C, Stumme G. **BibSonomy: a social bookmark and publication sharing system.** Conceptual Structures Tool Interoperability Workshop, 2006 (Definitions 1-3 read in full text). [https://amor.cms.hu-berlin.de/~jaeschkr/pdf/hotho2006bibsonomy.pdf](https://amor.cms.hu-berlin.de/~jaeschkr/pdf/hotho2006bibsonomy.pdf)
12. Wikipedia. **Associative entity** (junction / bridge / association / join / link table and its many synonyms). [https://en.wikipedia.org/wiki/Associative_entity](https://en.wikipedia.org/wiki/Associative_entity)
13. Wikipedia. **Entity-attribute-value model** (sparse / ad hoc attributes; costs of attribute-centred queries). [https://en.wikipedia.org/wiki/Entity%E2%80%93attribute%E2%80%93value_model](https://en.wikipedia.org/wiki/Entity%E2%80%93attribute%E2%80%93value_model)
14. Kimball Group. **Multivalued dimension bridge table** (and Design Tip #142, *Building bridges*; over-counting and weighting factors). [https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/multivalued-dimension-bridge-table/](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/multivalued-dimension-bridge-table/)
15. Watson R, Dekeyser S, Albadri N. **Exploring the design space of metadata-focused file management systems.** 2017. Abstract seen via search results. [https://research.usq.edu.au/item/q3v89/exploring-the-design-space-of-metadata-focused-file-management-systems](https://research.usq.edu.au/item/q3v89/exploring-the-design-space-of-metadata-focused-file-management-systems)
16. WordPress developer reference. **register_taxonomy()** (taxonomy, terms, `hierarchical` flag). [https://developer.wordpress.org/reference/functions/register_taxonomy/](https://developer.wordpress.org/reference/functions/register_taxonomy/)
17. Google. **Create & manage labels in Gmail** (a conversation can carry many labels, unlike folders). Seen via search results. [https://support.google.com/mail/answer/118708](https://support.google.com/mail/answer/118708)
18. Kubernetes documentation. **Labels and selectors** (labels vs annotations; equality-based and set-based selectors; labels are not unique). [https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/)
19. Neo4j documentation. **Graph database concepts** (labeled property graph; a node may carry any number of labels). [https://neo4j.com/docs/getting-started/graphdb-concepts](https://neo4j.com/docs/getting-started/graphdb-concepts)
20. Zotero documentation. **Collections and tags** (collections, tags, saved searches, Unfiled Items). Seen via search results. [https://www.zotero.org/support/collections_and_tags](https://www.zotero.org/support/collections_and_tags)
21. Bergman O, Beyth-Marom R, Nachmias R, Gradovitch N, Whittaker S. **Improved search engines and navigation preference in personal information management.** ACM TOIS 26(4), 2008. Seen via search-result abstract. [https://cris.openu.ac.il/en/publications/improved-search-engines-and-navigation-preference-in-personal-inf-2/](https://cris.openu.ac.il/en/publications/improved-search-engines-and-navigation-preference-in-personal-inf-2/)
22. Bergman O, Israeli T, Whittaker S. **Search is the future? The young search less for files.** Proc. ASIS&T 56(1), 2019. [https://cris.iucc.ac.il/en/publications/search-is-the-future-the-young-search-less-for-files/](https://cris.iucc.ac.il/en/publications/search-is-the-future-the-young-search-less-for-files/)
23. Fitchett S, Cockburn A. **An empirical characterisation of file retrieval.** Int. J. Human-Computer Studies 74:1-13, 2015 (four-week study, 26 participants, per its abstract as seen via search results). [https://www.sciencedirect.com/science/article/abs/pii/S107158191400127X](https://www.sciencedirect.com/science/article/abs/pii/S107158191400127X)
24. Google Workspace Blog. **Simplifying Google Drive's folder structure and sharing models** (single parent from 30 Sep 2020; multi-parent items migrated to shortcuts). [https://workspace.google.com/blog/product-announcements/simplifying-google-drives-folder-structure-and-sharing-models](https://workspace.google.com/blog/product-announcements/simplifying-google-drives-folder-structure-and-sharing-models)
25. MIT 6.033 course notes, **Discussion suggestions: Semantic File Systems** (read; source of the virtual-directory and attribute-value naming quotes). [https://web.mit.edu/saltzer/www/publications/recguides/sfs.html](https://web.mit.edu/saltzer/www/publications/recguides/sfs.html)
26. Neuman BC. **The Prospero File System: a global file system based on the virtual system model.** Computing Systems 5(4), 1992. Bibliographic record only. [https://www.usenix.org/publications/compsystems/computing-systems-1992-2](https://www.usenix.org/publications/compsystems/computing-systems-1992-2)
27. Gopal B, Manber U. **Integrating content-based access mechanisms with hierarchical file systems (HAC).** Proc. OSDI, 1999. [https://www.usenix.org/legacy/event/osdi99/gopal.html](https://www.usenix.org/legacy/event/osdi99/gopal.html)
28. Wikipedia. **Tagsistant** (semantic file system for Linux; tags/, relations/, reasoner with `includes` and `is_equivalent`). [https://en.wikipedia.org/wiki/Tagsistant](https://en.wikipedia.org/wiki/Tagsistant)
29. TMSU (tag virtual filesystem), README and release notes. [https://github.com/oniony/TMSU](https://github.com/oniony/TMSU)
30. Wikipedia. **Semantic file system** (list of research and production systems, 1991-2022). [https://en.wikipedia.org/wiki/Semantic_file_system](https://en.wikipedia.org/wiki/Semantic_file_system)
31. Wikipedia. **Multi-label classification** (machine-learning sense: non-exclusive labels per instance). [https://en.wikipedia.org/wiki/Multi-label_classification](https://en.wikipedia.org/wiki/Multi-label_classification)
32. Yee K-P, Swearingen K, Li K, Hearst M. **Faceted metadata for image search and browsing.** CHI 2003:401-408. [https://courses.cs.washington.edu/courses/cse454/13wi/papers/yee-chi03.pdf](https://courses.cs.washington.edu/courses/cse454/13wi/papers/yee-chi03.pdf)
33. Tunkelang D. **Faceted search.** Synthesis Lectures on Information Concepts, Retrieval, and Services, Morgan & Claypool, 2009. [https://link.springer.com/book/9783031011344](https://link.springer.com/book/9783031011344)
34. Wikipedia. **Tag (metadata)** (machine tags / triple tags, Flickr 2007, label and keyword as near-synonyms). [https://en.wikipedia.org/wiki/Tag_(metadata)](https://en.wikipedia.org/wiki/Tag_(metadata))
35. Golder SA, Huberman BA. **Usage patterns of collaborative tagging systems.** J. Information Science 32(2):198-208, 2006. [https://www.arxiv.org/pdf/0705.1013](https://www.arxiv.org/pdf/0705.1013)
36. Mika P. **Ontologies are us: a unified model of social networks and semantics.** ISWC 2005, LNCS 3729:522-536. [https://puma.uni-kassel.de/bibtex/15ea12110b5bb0e3a8ad09aeb16a70cdb/stephandoerfel](https://puma.uni-kassel.de/bibtex/15ea12110b5bb0e3a8ad09aeb16a70cdb/stephandoerfel)
37. Amazon S3 User Guide. **Organizing objects in the console by using folders** (flat structure; folder = shared key prefix). [https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-folders.html](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-folders.html)
38. Amazon S3 User Guide. **Tagging your objects** (key-value tags, up to 10 per object; prefix categorisation is one-dimensional). [https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-tagging.html](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-tagging.html)
39. Microsoft Learn. **Azure Data Lake Storage hierarchical namespace** (flat namespace vs hierarchical namespace; slash-in-name convention). [https://learn.microsoft.com/en-us/azure/storage/blobs/data-lake-storage-namespace](https://learn.microsoft.com/en-us/azure/storage/blobs/data-lake-storage-namespace)
40. Hydrus Network documentation. **Getting started with tags** (namespaces, tag services). [https://hydrusnetwork.github.io/hydrus/getting_started_tags.html](https://hydrusnetwork.github.io/hydrus/getting_started_tags.html)
41. Perkeep documentation. **Permanode attributes** (`tag`, `camliMember`, `camliPath:`, `xattr:`). [https://perkeep.org/doc/schema/attributes.md](https://perkeep.org/doc/schema/attributes.md)
42. Perkeep documentation. **Schema**, **Permanode** and **Terms** pages (blob, schema blob, permanode, claim; the index is rebuildable from the blobs). [https://perkeep.org/doc/schema/](https://perkeep.org/doc/schema/)
43. WordPress Codex. **WordPress taxonomy** and **Database description** (`wp_terms`, `wp_term_taxonomy`, `wp_term_relationships`). [https://codex.wordpress.org/WordPress_Taxonomy](https://codex.wordpress.org/WordPress_Taxonomy)
44. Drupal API. **VocabularyInterface** (`HIERARCHY_DISABLED`, `HIERARCHY_SINGLE`, `HIERARCHY_MULTIPLE`). Seen via search-result summary. [https://api.drupal.org/api/drupal/core%21modules%21taxonomy%21src%21VocabularyInterface.php/8.9.x](https://api.drupal.org/api/drupal/core%21modules%21taxonomy%21src%21VocabularyInterface.php/8.9.x)
45. Barreau D, Nardi BA. **Finding and reminding: file organization from the desktop.** SIGCHI Bulletin 27(3), 1995. [https://homepages.cwi.nl/~steven/sigchi/bulletin/1995.3/barreau.html](https://homepages.cwi.nl/~steven/sigchi/bulletin/1995.3/barreau.html)
46. Google. **Gmail API users.messages.modify** (`addLabelIds`, `removeLabelIds`). [https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/modify](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/modify)
47. Hydrus Network documentation. **Tag siblings** (aliases; the ideal tag). [https://hydrusnetwork.github.io/hydrus/advanced_siblings.html](https://hydrusnetwork.github.io/hydrus/advanced_siblings.html)
48. Hydrus Network documentation. **Tag parents** (implication; multiple parents allowed; loops not allowed). [https://hydrusnetwork.github.io/hydrus/advanced_parents.html](https://hydrusnetwork.github.io/hydrus/advanced_parents.html)
49. Heymann P, Garcia-Molina H. **Collaborative creation of communal hierarchical taxonomies in social tagging systems.** Stanford technical report 2006-10. Bibliographic record. [https://www.bibsonomy.org/bibtex/d77846b40aadb0e25233cabf905bb93e](https://www.bibsonomy.org/bibtex/d77846b40aadb0e25233cabf905bb93e)
50. Marlow C, Naaman M, boyd d, Davis M. **Position paper, tagging, taxonomy, Flickr, article, ToRead.** Collaborative Web Tagging Workshop, WWW 2006 (taxonomy of tagging systems). Seen via secondary summaries only. [https://overstated.net/2006/08/23/ht06-tagging-paper-taxonomy](https://overstated.net/2006/08/23/ht06-tagging-paper-taxonomy)
51. MacMost. **11 Smart Folders to make you more productive on your Mac** (secondary source: a Smart Folder is a saved search that re-runs on view). [https://macmost.com/11-smart-folders-to-make-you-more-productive-on-your-mac.html](https://macmost.com/11-smart-folders-to-make-you-more-productive-on-your-mac.html)
52. Apple Support. **Tag files and folders on Mac.** [https://support.apple.com/guide/mac-help/tag-files-and-folders-mchlp15236/10.13](https://support.apple.com/guide/mac-help/tag-files-and-folders-mchlp15236/10.13)
53. Jekyll documentation. **Front matter.** [https://jekyllrb.com/docs/front-matter](https://jekyllrb.com/docs/front-matter)
54. fast.io. **Embedded metadata vs sidecar files: which XMP approach to use** (secondary source for XMP sidecars, `dc:subject`, ISO 16684-1). [https://www.fast.io/resources/embedded-metadata-vs-sidecar-files-xmp.md](https://www.fast.io/resources/embedded-metadata-vs-sidecar-files-xmp.md)
55. freedesktop.org. **Guidelines for extended attributes** (`user.xdg.comment`; `user.xdg.tags` as a de facto convention). [https://wiki.freedesktop.org/www/CommonExtendedAttributes/](https://wiki.freedesktop.org/www/CommonExtendedAttributes/)
56. Bush V. **As we may think.** The Atlantic Monthly 176(1), July 1945 (reproduction). Seen via search results. [https://www2.cs.sfu.ca/~cameron/Teaching/470/vbush.html](https://www2.cs.sfu.ca/~cameron/Teaching/470/vbush.html)
57. Wikipedia. **WinFS** (history and 2006 cancellation). [https://en.wikipedia.org/wiki/WinFS](https://en.wikipedia.org/wiki/WinFS)
58. Freeman E, Gelernter D. **Lifestreams: a storage model for personal data.** SIGMOD Record, 1996. Project page read; the PDF text could not be extracted. [https://www.cs.yale.edu/homes/freeman/lifestreams.html](https://www.cs.yale.edu/homes/freeman/lifestreams.html)
59. Karger DR, Bakshi K, Huynh D, Quan D, Sinha V. **Haystack: a customizable general-purpose information management tool for end users of semistructured data.** CIDR 2005. Seen via search-result abstract only. [https://www.cidrdb.org/cidr2005/papers/P02.pdf](https://www.cidrdb.org/cidr2005/papers/P02.pdf)
60. Dinneen JD, Julien C-A. **The ubiquitous digital file: a review of file management research.** JASIST 71(1):E1-E32, 2020. [https://arxiv.org/abs/2109.09668](https://arxiv.org/abs/2109.09668)
61. Fitchett S, Cockburn A, Gutwin C. **Improving navigation-based file retrieval.** CHI 2013 (Best Paper Award). Seen via search results; the abstract page was blocked. [https://api.openalex.org/works/doi:10.1145%2F2470654.2481323](https://api.openalex.org/works/doi:10.1145%2F2470654.2481323)
62. Jones W, Phuwanartnurak AJ, Gill R, Bruce H. **Don't take my folders away! Organizing personal information to get things done.** CHI 2005 Extended Abstracts:1505-1508. Title and venue verified; content not read. [https://doi.org/10.1145/1056808.1056952](https://doi.org/10.1145/1056808.1056952)
63. Whittaker S, Matthews T, Cerruti J, Badenes H, Tang J. **Am I wasting my time organizing email? A study of email refinding.** CHI 2011. [https://research.ibm.com/publications/am-i-wasting-my-time-organizing-email-a-study-of-email-refinding](https://research.ibm.com/publications/am-i-wasting-my-time-organizing-email-a-study-of-email-refinding)
64. Voit K, Andrews K, Slany W. **Tagging might not be slower than filing in folders.** CHI 2012 Extended Abstracts. [https://tugraz.elsevierpure.com/en/publications/tagging-might-not-be-slower-than-filing-in-folders-2](https://tugraz.elsevierpure.com/en/publications/tagging-might-not-be-slower-than-filing-in-folders-2)
65. Wikipedia. **Miller columns** (Mark S. Miller, Yale 1980; NeXTSTEP File Viewer 1986; macOS Finder column view). [https://en.wikipedia.org/wiki/Miller_columns](https://en.wikipedia.org/wiki/Miller_columns)
