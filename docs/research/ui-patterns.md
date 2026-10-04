# 05 — UI patterns for CRUD over flat + tag collections: the menu, the operations, and the affordance/rendering split

**Scope.** The CRUD side of a headless toolkit for "flat items + structuring metadata" (items in several groups at once). Navigation patterns are not repeated: see the zodal-groups navigation report [1] (tree, Miller columns, drill-down, breadcrumbs, faceted browsing, icicle, search-first, ARIA, `PathNode[]`) and the reconciled decisions [2]. Filter UX (AND-across/OR-within, counts, applied-filter chips, URL state, select-after-filter) is owned by the faceted-filter skill [3] and its research [4]; this report cites it and does not restate it.

**Convention.** `[n]` is a cited source (see REFERENCES). **[SYNTHESIS]** marks my own design opinion. **[ESTIMATE]** marks a number I computed or guessed, with its basis. **[UNVERIFIED]** marks a claim I could not confirm from a primary page; the reason is given.

**Method note.** Product claims come from vendor help pages fetched on 2026-10-04 where the fetch succeeded. Some pages returned 403/404/500, or were summarised by a small model; those cases are flagged. Where a claim rests on a search snippet or a third-party tutorial, the reference says so.

---

## 0. Executive summary

1. **A "view" is data, not a component, in every mature database-style product.** Notion's API models a view as `{type, filter, sorts, configuration}` with ten view types [5][6]; Univer's model is `{type, fieldOrder, fieldSettings, filter, sort, group, config}` [7]; Obsidian Bases, Baserow and Directus describe the same skeleton in prose [8][9][10]. Each view keeps its own filter, sort, group and visible-field settings, independent of the others [6][8]. That skeleton is the recommended `ViewConfig` (section 3.3).

2. **Views have applicability rules, and those rules are testers.** Kanban "requires a single select field" in Airtable and Baserow [11][9]; GitHub boards need a single-select or iteration field as the column field [12]; calendar needs a date field [11][9][13]. "Which views can I offer for this schema?" is therefore a computed menu with disabled reasons, which is exactly what zodal's tester-and-priority-band registry already does for fields and for groups-ui surfaces [2][14]. This is what makes "choose a UI from a menu" a config choice.

3. **Kanban over a tag family is the one layout where multi-membership bites.** Every board product I checked takes a *single-valued* column field [11][9][12], and Linear makes label groups exclusive ("only one label from a given label group can be applied to an issue at a time") [15]. A board over a *non-exclusive* family forces a policy: duplicate the card in each column, or pick a primary. Counts have the same problem [1, §B.7]. The view config needs an explicit `multiValue` policy and the profile needs a per-family cardinality (section 3.5).

4. **Bulk tagging has a standard shape that the existing groups-ui does not yet describe.** Gmail's label menu shows a tri-state (none / some / all) per label across a selection; clicking a "some" box applies to all, then an Apply step commits [16]. Zotero adds drag-onto-tag [17]; Lightroom adds keywording panels and drag-onto-keyword [18]. zodal-groups ships `toTagTokens` (single item) and drag intents [14] but no selection-level tagging descriptor.

5. **Every gesture needs a command twin.** WCAG 2.5.7 requires that anything done by dragging can be done by a single-pointer action without dragging [19]; Gmail, Linear and Zotero all pair gestures with keyboard shortcuts [20][21][17]. The minimum contract in section 4.2 therefore treats drag as an accelerator for a command, never the only path.

6. **The model has two gaps the UI exposes.** `EdgeDelta` "never removes nodes" [source read], so undoing a tag delete or merge needs a tombstone; Linear's archive-vs-delete split [15] is the precedent. And the profile has only global cardinalities (`maxGroupsPerItem`), not per-family ones [2, §3].

---

## 1. Catalogue of layout / view patterns

### 1.1 A decomposition that keeps the catalogue small

Products blend four independent choices, and listing "views" as one flat list hides the combinatorics:

| Slot | What it decides | Examples |
|---|---|---|
| **Shell** | How many panes, and what lives in each | single pane; two-pane (navigator + items); three-pane (navigator + items + inspector) |
| **Navigator** | How the user picks a group scope | tree, Miller columns, facet panel, tag list/cloud, tabs (covered in [1]) |
| **Item layout** | How the items in scope are drawn | table, list, cards/gallery, board, calendar, timeline |
| **Inspector** | What is shown for the selected item(s) | fields, memberships, notes, preview |

**[SYNTHESIS]** The named "patterns" below are common points in this 4-slot space. A config that exposes the slots lets a developer pick "two-pane + facets + cards" without a new pattern being invented for each combination. The three-pane shape is a shell choice, not a layout.

### 1.2 The catalogue

"Fits" is the item kind where the pattern earns its cost. "Needs" lists the affordances (headless objects) the pattern consumes, using the vocabulary proposed in section 3.

| # | Pattern | Fits | Needs | Canonical products | Caveats |
|---|---|---|---|---|---|
| L1 | **Two-pane file manager** (group sidebar + item pane) | documents, mixed files, media; anyone with a folder mental model | `GroupNavigator`, `ItemCollection`, `Selection`, `DropIntent` | Finder with tags in the sidebar [22]; Gmail label sidebar [16]; Eagle (folders + tag groups; selecting a folder narrows the visible tags) [23] | Folder metaphor teaches single-parenthood; Hearst's critique applies [1, §A.5]. Use "also in" chips |
| L2 | **Three-pane with inspector** (navigator, list, preview/inspector) | references, mail, photos, any collection where each item has rich detail | L1 plus `ItemInspector`, `TaggingAffordance`, `OtherLocations` | Mail clients: the "mailboxes / mailbox contents / email text" layout of Outlook Express [24]; Zotero 7, whose item pane gained a "Libraries and Collections" section listing where the item is filed [25]; Lightroom Classic's keywording and keyword-list panels beside the grid [18] (via search snippet; the Adobe page returned 403) | The inspector is where reverse membership lives [1, §B.1]. With multi-select the inspector must switch to a "N items" bulk mode |
| L3 | **Table / grid with a tag column** | records, references, any item with several typed fields | `ItemCollection` (columns), `Selection` (tri-state header), `TaggingAffordance` as a cell editor | Notion table [6]; Airtable grid [11]; Baserow grid ("data entry, bulk editing, spreadsheet-style work") [9]; GitHub Projects table ("group, sort, and filter items, and show or hide fields") [12]; Obsidian Bases table [8]; Directus table, "the default Layout", which "directly reflects how data is stored" [10] | Use the ARIA grid pattern when cells are interactive: one tab stop, arrow keys between cells, Enter/F2 to edit, Escape to return to grid navigation [26]. TanStack's row selection keys rows by index unless `getRowId` is set, which breaks selection under re-sorting [27] |
| L4 | **Gallery / masonry with tag chips** | media, design assets, web clippings, anything with a cover image | `ItemCollection` (card fields + cover role), `Selection` (hover checkbox), chips as read-only `TaggingAffordance` | Eagle (visual asset library with tags and smart folders) [23]; Notion gallery ("card grid with cover images") [5]; Airtable and Baserow gallery [11][9]; Obsidian cards [8]; Directus cards [10] | Masonry is a presentation choice with an accessibility cost: reordering can fail WCAG 1.3.2 Meaningful Sequence, so use it only where item order carries no meaning [28] |
| L5 | **Board (kanban) grouped by a tag family** | records with a lifecycle or a small closed family (status, priority, type) | `ItemCollection` (sections), `DropIntent` scoped to the family, `Selection` | Notion board, grouped by status, select, multi-select, person or relation properties; empty values go to a "No <property>" column; dragging a card changes the property [29]; GitHub board, any single-select or iteration field as the column field, multi-card drag [12]; Linear board, with sub-grouping as rows [30]; Airtable and Baserow kanban need a single select [11][9]; Directus kanban [10] | Single-valued by construction in the products checked. A multi-valued family needs a duplicate-or-primary policy. Notion's behaviour for a multi-select group-by is not stated in its docs [29] **[UNVERIFIED]** |
| L6 | **Board per facet** (swimlanes, one board per family) | same as L5, when several families are first-class | L5 with a family picker and optional `subGroupBy` | Notion `sub_group_by` [31]; Linear sub-grouping "as rows" in lists and boards [30] | Rows x columns = two families. Cap at two |
| L7 | **Calendar / timeline** | dated records: events, journal entries, photos by capture date, deadlines | `ItemCollection` with a date-role field; tags as colour or lane | Notion calendar needs `date_property_id`, timeline needs start and end [31]; Airtable calendar needs a date field [11]; Baserow calendar and timeline (start/end) [9]; GitHub Roadmap positions items by date and iteration fields [12]; Directus calendar [10] | Only offer when the schema has a date role. Calendar views do not support grouping in Airtable [11] |
| L8 | **Miller columns** | deep, wide taxonomies; also as a *picker* into a taxonomy | `GroupNavigator` in `columns` form | Covered in [1, §A.2]; GOV.UK `miller-columns-element` as tagging picker [1] | Not repeated here |
| L9 | **Faceted search page** | large collections with many families | `GroupNavigator` in `facets` form, applied-filter summary, `Selection` with scoped select-all | Covered by [3][4]. For CRUD the extra point is that select-all must say whether it means "visible" or "all matching" [4, §7] | Select-all-matching is a query, not an id list; the confirmation must state the true count [4, §7.4] |
| L10 | **Tag cloud / tag list** | gestalt and entry point only | `GroupNavigator` in `cloud` form | [1, §A.6]: cloud users were "less accurate on a relational task and were overall slower" [1] | Never the primary navigator |
| L11 | **Command-palette-first** | power users, any item kind; the fallback surface when no layout fits | `CommandSet` (all operations as commands with enabled/reason/shortcut) | Linear and Superhuman are the usual citations; I found only practitioner blogs, not a study. One of them describes a palette as a ranked list of "places you can go, actions you can take, and objects you can find" [32] | Evidence is weak. Treat as a cross-cutting mode that every layout also gets, not as a layout |
| L12 | **Outline** | hierarchical notes, task trees, nested content | `GroupNavigator` as `tree` with inline item rows | Outliners come in one-pane, two-pane and hybrid forms; examples include WorkFlowy, Logseq, Org-mode [33] | Polyhierarchy in an outline needs mirrors/transclusion; I found nothing on the sourcing for that, so skip it in v1 **[UNVERIFIED]** |
| L13 | **Inbox / triage queue** | anything that arrives faster than it is filed | `TriageQueue` over the "untagged" projection | Linear Triage: "a special inbox for your team", with Accept (1), Decline (2), Duplicate (3 or MM), Snooze (H) [34]; Zotero Unfiled Items [1, §B.4]; DEVONthink unified Inboxes [35] | A view of a computed projection, not a stored group [1, §B.4] |
| L14 | **Smart group / saved view** | recurring queries | `SavedView` (a `ViewConfig` with a predicate scope) | Eagle smart folders: rules over type, tags, colours, sizes, notes [23]; Notion and Obsidian per-view filters [6][8]; macOS Smart Folders, Spotlight, Outlook Search Folders [1, §C.6] | Write operations on an intensional group are undefined; see O7 |

### 1.3 What the products' menus say about frequency

Which layouts appear in the view menus of the five database-style products I could check:

| Layout | Notion [5] | Airtable [11] | Baserow [9] | Directus [10] | GitHub Projects [12] | Obsidian Bases [8] |
|---|---|---|---|---|---|---|
| Table / grid | yes | yes | yes | yes | yes | yes |
| Gallery / cards | yes | yes | yes | yes | no | yes |
| Board / kanban | yes | yes | yes | yes (Cloud, per the search snippet) | yes | not listed in the search summary (a separate fetch of the same page listed Kanban; not reconciled) **[UNVERIFIED]** |
| Calendar | yes | yes | yes | yes | no | no |
| Timeline / roadmap | yes | yes | yes | no | yes | no |
| List | yes | yes | no | no | no | yes |
| Map | yes | no | no | yes | no | yes |
| Form | yes | yes | yes | no | no | no |

Table, gallery/cards, board, calendar and timeline recur across at least four of six. This is evidence about *what vendors ship*, not about how often users need each. Directus's list comes from a search snippet because the docs page fetch redirected and then 404'd on the follow-up pages.

---

## 2. Catalogue of CRUD operations and their gestures

For each: the standard name, the best-practice gesture, products that do it well. Drag, ADD-vs-MOVE, remove-vs-delete, counts and bulk scope are already argued in [1, §B.4, §B.5, §B.7, §B.8]; they appear here only as rows in the table, with what is new.

### 2.1 Operation table

| # | Operation (standard name) | Best-practice gesture | Products that do it well | Notes |
|---|---|---|---|---|
| O1 | **Create item in context** | A "New" button whose result inherits the current scope's static groups. Smart groups cannot receive items | Obsidian Bases toolbar has a "New" button per base [8]; Notion boards drag-update the grouping property [29] | That a new item inherits the scope's filter values is common practice but **[UNVERIFIED]**: I did not find it in any doc I could fetch. Treat as a design rule, not a finding |
| O2 | **Tag one item**: add | A combobox with autocomplete over existing tags, Enter or comma to add, paste splits on a delimiter, "create new" as the last suggestion | Zotero: "As you type, you will be shown a list of matching existing tags" [17]; Notion multi-select: type and press Enter after each [36]; Linear: create inline with `Type/Bug`, which makes the group and the label together [15]; Zag Tags Input: Enter or comma, add-on-paste, `delimiter`, duplicates rejected by default, `max`, `validate` [37] | The APG combobox is explicitly single-valued: "the listbox allows only one suggested value to be selected at a time" [38]. A tag input is therefore a composite (combobox + tag list) with no APG pattern of its own. React Aria's TagGroup covers selection and removal but not creation [39]. Downshift's `useMultipleSelection` (now marked deprecated in favour of `useTagGroup`) pairs with `useCombobox` and keeps the popup open for continuous tagging [40] |
| O3 | **Tag one item**: remove | A chip with a remove button, plus Backspace/Delete on the focused chip; a toast with Undo, no confirm | Gmail label chips with `x` [1, §B.1]; Zag: Delete/Backspace on a focused tag [37]; React Aria: `onRemove` receives a set of keys, remove button rendered automatically [39]; Material 3 input chips "represent a discrete piece of info entered by user, e.g. tags" and are removable [41] | Removal is non-destructive, so undo beats confirm [42]. Smart-group chips must have no `x` [1, §C.6] |
| O4 | **Edit a tag in place** | Double-click or Enter on a focused chip | Zag: edit via double-click or focus + Enter, `editable: false` to disable [37] | Editing a chip should mean "rename this tag everywhere" only if the UI says so; otherwise it means "replace on this item". The two are different operations; **[SYNTHESIS]** make in-chip edit mean replace and put global rename in the tag manager (O8) |
| O5 | **Bulk tag a selection** | Select rows, open a Labels menu, show a tri-state per tag (none/some/all), click cycles to "all", commit with Apply | Gmail: "a line is displayed to let us know that some but not all of the conversations use this label", clicking applies to all, then Apply [16] (secondary source; Google's own help page does not describe it [43]); Lightroom: apply keywords to many photos from Grid view [18]; Zotero: drag items onto a tag in the tag selector [17]; TanStack exposes `getIsSomeRowsSelected` for the header's indeterminate state [27] | Two commit models exist: immediate (Zotero drag) and staged (Gmail Apply). Expose the choice. The tri-state needs the counts `{none, some, all}` per tag across the selection, which is a core computation, not a renderer one |
| O6 | **Select, then act** | Header checkbox with partial state; separate "select visible" and "select all matching"; the selected count in a live region and in the accessible name | Gmail's banner copy: "All 50 conversations on this page are selected. Select all 2,000 conversations in Inbox"; AG Grid `selectAll` values `all`/`filtered`/`currentPage`; Polaris copy with `+` for unpaid-for counts [4, §7.1][4, §7.2] | A selection that outlives its filter is the dangerous bug; keep ids, keep selected rows visible, show `12 selected - 4 not shown` [4, §7.3] |
| O7 | **Smart group (saved search)** | "Save this filter as a group"; the result renders like a group but is read-only for membership | Eagle smart folders [23]; Notion/Obsidian views with own filters [6][8]; Spotlight lineage [1, §C.6] | `canAddItem` is false; the drop target is rejected with an explanation; chips lack `x` [1, §C.6]. Guard predicate cycles separately from graph cycles [1] |
| O8 | **Tag management**: rename | Right-click or menu on the tag, "Rename", applies to all items | Zotero: "Rename Tag..." across all items [17]; DEVONthink: renaming updates the documents [35]; Obsidian's core Tags view does not rename, a community plugin (Tag Wrangler) adds it, including subtags [44] | Rename touches one node, not N edges, if names live on the node. The model puts names on the *edge* [2]; check which applies before promising O(1) rename |
| O9 | **Tag management**: merge | Drag tag onto tag, or rename to an existing name, with a preview of affected items | Zotero: rename a tag to match another's name [17]; DEVONthink To Go: "Merge selected groups or tags" [45] | Merge is destructive of a node and rewrites edges: needs `previewMerge -> {itemsAffected, duplicatesCollapsed}`. I found no product that shows that preview in its docs |
| O10 | **Tag management**: split | **No product documented**. **[SYNTHESIS]** model it as "create the new tag, select the subset, bulk-move" | none found | Do not build a split gesture in v1 |
| O11 | **Tag management**: recolour / icon | Colour swatch menu on the tag | Gmail: up to 100 custom colours [43]; Zotero colours, each tag with a position number usable as a shortcut [17]; Finder tag colours in Settings [22] | Presentational data stored on the tag node |
| O12 | **Tag management**: nest | "Nest under" picker, or path syntax in the name | Gmail "Nest label under" [43]; Lightroom `animal | dog`, `animal > dog`, `dog < animal` [18]; Linear `Type/Bug` creates group and label together [15] | Path strings re-impose single parenthood on the tag [1, §A.6]; offer them as *input syntax* that compiles to edges, not as the stored form |
| O13 | **Tag management**: alias / synonym | A field on the tag listing alternative names; imports resolve through it | DEVONthink: an alias so documents imported with the old tag name get the new tag [35]; Lightroom keyword synonyms [18] | Pairs with merge: after a merge, keep the old name as an alias |
| O14 | **Tag management**: delete vs archive vs remove membership | Three distinct menu items with distinct copy: "Remove from this item", "Archive tag" (hide, keep history), "Delete tag" (everywhere) | Linear: "Archiving preserves historical label data on existing issues while preventing new applications. Deletion permanently removes labels" [15]; Zotero deletes a tag across all items [17]; Gmail deleting a label leaves the messages [1, §B.4] | Archive is the missing middle state in most tag UIs; it also solves undo (O17) |
| O15 | **Untagged / triage** | A computed "Unfiled" view with fast keyboard actions | Linear Triage keys 1/2/3/H and `G` then `T` to open [34]; Zotero Unfiled Items [1, §B.4]; Notion's "No status" column [29] | See L13 |
| O16 | **"Also in" indicator** | Chips on the row (with `+N` overflow), a Memberships section in the inspector, modifier-hold highlight in navigators | Zotero 7 item-pane section [25]; Gmail chips; Zotero Option-hold highlight [1, §B.1] | Covered in [1, §B.1]; renderers consume `toOtherLocations` [14] |
| O17 | **Undo** | A toast with Undo and a keyboard shortcut; no confirm for reversible operations | Gmail: after deleting, an undo option appears immediately [42]; Gmail `z` is "Undo last action" [20] | Raskin's caveat: undo is hard under concurrent editing [42]. In this model `EdgeDelta` has an inverse, so single-user undo is cheap for membership changes. Tag delete/merge need tombstones because `EdgeDelta` "never removes nodes" |
| O18 | **Validation / conflict messages** | Inline, next to the source, plain language, say what to do, keep the user's input | NN/g: show the error "close to the error's source", "human-readable language", "constructive advice", preserve input [46] | Map each structured `Violation` code to a message template plus a suggested fix (see 2.3) |
| O19 | **Keyboard flows** | Every operation has a command; a few have single-key shortcuts; the palette lists them with their shortcuts | Gmail: `l` label menu, `v` move to, `x` select, `e` archive, `z` undo, `g` then `l` go to label [20]; Linear `L` applies labels [15]; Zotero number keys toggle coloured tags [17]; listbox multi-select: Space toggles, Shift+Arrow extends, Ctrl+A selects all [47] | Shortcut conventions vary; keep them as data in the `CommandSet` so apps can remap |
| O20 | **Remove from group vs delete item** | Context-sensitive: only "Remove from {group}" when in a group view | Lightroom withholds the destructive option outside the folder view [1, §B.4] | Covered in [1, §B.4]; listed so every view's contract includes it |
| O21 | **Drag to tag (ADD) / modifier to move** | Default ADD; modifier MOVE; live verb on the drop indicator; menu twin for every drag | Decision D15/D16 [2]; Finder tag sidebar for the "drag onto a tag" gesture [22]; DEVONthink: drag selected documents into the Tags area [35]; Zotero Cmd/Shift-drag removes [17] | WCAG 2.5.7 forbids drag as the only path [19] |

### 2.2 The tri-state in detail (the operation that most needs a descriptor)

For a selection S and a tag T, the state is `none` if no item in S has T, `all` if every item does, else `some`. Gmail's behaviour, as reported by a secondary source [16]:

- A `some` box shows a dash; clicking it applies T to all selected items, turning the dash into a check.
- The change commits when the user clicks Apply.

**[SYNTHESIS]** The click cycle most users expect from a native tri-state checkbox is the APG one: the mixed state is entered by the controller and exited by the user into checked [48]. For a tag menu I would make the cycle `some -> all -> none -> all` and let the staged commit show the delta as text ("add 'Reading' to 7 items, remove 'Inbox' from 12"). The text delta is the "apply to N items" affordance; it should be computed in the core as a dry run, the same shape as `previewRemove` [1, §B.8].

### 2.3 Violation messages

`Violation.code` in the model is a closed set: `cycle`, `maxDepth`, `maxParentsPerItem`, `maxParentsPerGroup`, `maxGroupsPerItem`, `groupsMayContainGroups`, `groupsMayContainItems`, `groupsAreItems`, `unknownEdgeKind`, `disjointEdgeKind`, `selfEdge`, `duplicateEdge` [source read]. **[SYNTHESIS]** The headless layer should map each code to `{message(params), fix?}` where `fix` is a command descriptor ("Remove 'Archive' to add 'Reading'"). NN/g's guideline set (visible, plain, specific, constructive, preserve input) [46] is the acceptance test. For `cycle`, the offending path is already in the violation and is what the tooltip renders [1, §B.6].

---

## 3. The affordance / rendering split

### 3.1 Prior art for a headless split

| Prior art | What is declared (headless) | What is left to the renderer | Lesson for us |
|---|---|---|---|
| **JSON Forms** | Data schema plus UI schema; core is "independent of any UI technology"; renderer sets are swappable [49] | Each renderer registers a tester, a function returning a number; `-1` (`NOT_APPLICABLE`) means "not at all"; the highest rank wins [50] | The pattern zodal already uses. Extend it from fields to views |
| **TanStack Table** | "the logic, state, processing, and APIs for UI elements" [51]; row selection and other state is hoistable via `onRowSelectionChange` and a `state` option [27] | "markup, styles, or pre-built implementations" [51] | State must be a plain serialisable object the host can own and put in a URL |
| **Zag.js** | State machines per component, framework-agnostic; props normalised by adapters; unstyled [52] | Markup and styling | Behaviour as a machine plus a "connect" step that yields props; good model for the tag input and tag manager |
| **React Aria** | Hooks and components; behaviour, a11y and state; render props let the caller override DOM [39] | Visuals | Prop-getter style: the headless object returns the props each element needs |
| **Downshift** | Hooks that return prop getters (`getSelectedItemProps`, `getDropdownProps`) and actions (`addSelectedItem`, `removeSelectedItem`), plus an `aria-live` removal message [40] | Elements | Ship a11y announcements as part of the headless object |
| **Refine** | Data provider, headless hooks (`useTable`, `useList`, `useForm`), resource definitions; UI integrations "optional" [53] | UI kit | Resource-level wiring (the zodal collection) is separate from per-view state |
| **Puck** | A component config of `fields` (what the editing UI offers per prop), a `render` function, `resolveData`, `permissions` [54] | The visual render | Permissions as data: what a user may do is declared next to the schema |
| **Notion / Airtable / Baserow / Univer / Directus / Obsidian** | A view object: type, filter, sort, group, field visibility/order, type-specific config [5][6][7][8][9][10] | Rendering of that type | The `ViewConfig` skeleton. Views are saved, named and independent; Baserow also separates collaborative, personal and restrictive views [9] |

### 3.2 What exists in zodal today (read from source, 2026-10-04)

- `@zodal/core`: `CollectionAffordances` with `views?: ViewMode[]`, `defaultView`, `savedViews?: boolean`, `groupBy?: boolean | GroupByConfig`, `selectable`, `bulkEdit`, `bulkDelete`; `ViewMode = 'table' | 'grid' | 'list' | 'kanban'`. `GroupByConfig` holds only `defaultField`, `collapsible`, `defaultState`.
- `@zodal/ui`: `RendererRegistry`, testers returning a score, `PRIORITY` bands `FALLBACK 1 / DEFAULT 10 / LIBRARY 50 / APP 100 / OVERRIDE 200`; resolution is per *field*.
- `@zodal/groups-ui`: its own registry keyed by `(surface, profile)`, with `Surface = 'tree' | 'columns' | 'breadcrumbs' | 'facets' | 'tagInput' | 'treeSelect' | 'otherLocations' | 'icicle'`; `TreeRow` with `key` (path) and `nodeId`; `toTagTokens`; `resolveDrop` with ADD-default; `MEMBERSHIP_ACTIONS` (`add`, `move`, `remove`).

**Gap analysis (what a CRUD toolkit adds).**

1. `ViewMode` is a string enum with no per-view config. There is no place for `groupBy` per view, card fields, sort per view, or a date field for a calendar.
2. The registries resolve *widgets* (a field editor, a tree, a tag input), not *views* or *shells*.
3. No descriptor exists for selection-level tagging, tag management, the inspector, triage, or the command list.
4. No applicability computation ("which views can this schema and profile offer?").

### 3.3 Proposed `ViewConfig`

**[SYNTHESIS]** A single serialisable object, one per saved view. Names follow the products where they agree (`type`, `filter`, `sort`, `group`) [5][7].

```ts
type ViewConfig = {
  id: string;
  name: string;
  shell: 'single' | 'two-pane' | 'three-pane';       // slot 1
  navigator?: NavigatorConfig;                        // slot 2 (reuses groups-ui surfaces)
  layout: LayoutConfig;                               // slot 3, discriminated on `kind`
  inspector?: false | { sections: ('fields' | 'memberships' | 'notes' | 'preview')[] };
  scope: { group?: NodeId; descendants: boolean; includeSmart: boolean };
  filter?: FilterExpression;                          // zodal core
  sort?: { field: string; direction: 'asc' | 'desc' }[];
  fields?: { order: string[]; hidden?: string[] };    // columns or card fields
  interaction: {
    tagCommit: 'immediate' | 'staged';
    dragDefault: 'add' | 'move';                      // 'add' per decision D15 [2]
    selectionAcrossFilter: 'keep-visible' | 'drop';   // per [4, §7.3]
  };
};

type LayoutConfig =
  | { kind: 'table'; tagColumn?: string }
  | { kind: 'list' }
  | { kind: 'cards'; cover?: string; size?: 'sm' | 'md' | 'lg'; masonry?: boolean }
  | { kind: 'board'; groupBy: FamilyRef; subGroupBy?: FamilyRef;
      multiValue: 'duplicate' | 'primary' | 'forbid'; showEmpty: boolean }
  | { kind: 'calendar'; dateField: string; range: 'month' | 'week' }
  | { kind: 'timeline'; startField: string; endField?: string }
  | { kind: 'triage'; source: 'untagged' | SavedViewRef };
```

Why this shape:

- **Slots, not a flat menu.** Table, cards, board, calendar, timeline are `layout` kinds; two-pane and three-pane are `shell`; the navigators are the existing groups-ui surfaces.
- **Type-specific config is required where the product requires it.** `board` requires `groupBy`; `calendar` requires `dateField`. This matches Notion (board needs `group_by`, calendar needs `date_property_id`) [31] and Univer's `config: ViewSpecificConfig` [7].
- **`multiValue` is explicit.** It is the one setting products leave implicit and that polyhierarchy makes load-bearing (section 0, item 3).
- **Everything in it is plain data**, so it round-trips through a URL, a file or a DB row, in line with the URL-state rule [4, §6] and with `savedViews` in the core affordances.

### 3.4 Applicability: the menu is computed

**[SYNTHESIS]** Add `availableViews(schema, profile, fieldRoles) -> {kind, enabled, reason?}[]`.

| Layout | Applicable when |
|---|---|
| table, list | always |
| cards | always; richer with a `cover` role |
| board | the schema or group space has at least one family that is exclusive, or `multiValue` is chosen explicitly |
| calendar / timeline | a date-role field exists (start and end for timeline) |
| triage | the "untagged" projection is non-trivially used (always available; offered by default when `profile.maxGroupsPerItem != 0`) |

This needs *field roles* in schema metadata (`title`, `cover`, `date`, `body`, `family`). Notion's gallery `cover` and calendar `date_property_id` [31] and Directus's display templates [10] are the precedent. In zodal this is `.meta()` on the Zod field; roles can be inferred (a `z.date()` is a candidate date role) and overridden, in line with how the registry already treats metadata overrides at the `OVERRIDE` band.

Resolution reuses the existing machinery: a `RendererContext` carrying `{surface: 'itemLayout', layout.kind, profile, roles}`, testers return scores, `explain()` answers "why did I get that renderer?" [14]. The new `Surface` values: `shell`, `itemLayout`, `bulkTagMenu`, `tagManager`, `inspector`, `triage`, `commandPalette`.

### 3.5 Headless affordance objects

> **Superseded in part (2026-10-04):** the `CommandSet` and `UndoStack` objects below are not built by polytag. The fleet already decided that user actions are commands declared once (acture's `CommandRecord`) and that undo is the app's history over the commands' returned inverses. See [ADR 0001 §Revision 1](../decisions/0001-placement-and-seams.md). (the vocabulary a renderer must consume)

Each object is `{state, derived data, commands, capabilities, a11y}`. The core computes it; the renderer draws it. Existing objects are marked.

| Object | Carries | Commands it exposes | Status |
|---|---|---|---|
| `GroupNavigator` | rows (`TreeRow[]`/columns/facet rows), scope, counts with their semantics, drop targets | `select(nodeId)`, `expand(pathKey)` | exists in pieces [14] |
| `ItemCollection` | the items after scope, filter, sort; `sections` when grouped (with the `multiValue` policy applied); **distinct** result count next to any grouped count [1, §C.5]; a `capabilities` flag per field | `setSort`, `setGroupBy` | new; builds on `FilterExpression` |
| `Selection` | `mode: 'ids' | 'query'`, ids, exclusions, count, `hiddenSelectedCount`, header state `none|some|all`, the live-region text | `toggle`, `selectVisible`, `selectAllMatching`, `clear` | new; rules from [4, §7] |
| `TaggingAffordance` | for one item or a selection: applied chips (kind: static / smart / inherited; removable?), `suggest(query)`, `canCreate(name) -> Result`, per-tag `{none,some,all}` counts, `commit` model, pending delta text | `add`, `remove`, `toggle`, `create`, `apply`, `cancel` | new; `toTagToken` covers the single-item chip only |
| `OtherLocations` | the item's other groups, as a flat list | `reveal(nodeId)` | exists [14] |
| `DropIntent` | operation, validity, reason, indicator, `destructive` | `resolveDrop`, `applyDrop` | exists [14] |
| `TagManager` | tag list with counts, usage, archived flag | `rename`, `merge`, `nest`, `recolour`, `alias`, `archive`, `delete`, each with `preview*` dry run | new |
| `ItemInspector` | sections, edit state, single vs bulk mode | `edit(field)`, plus tagging commands | new |
| `TriageQueue` | next item, progress, actions with keys | `assign`, `skip`, `snooze` | new |
| `SavedView` | the `ViewConfig`, owner, visibility (personal / shared) | `save`, `duplicate`, `share` | new; Baserow's personal vs collaborative [9] |
| `CommandSet` | every operation above as `{id, label, enabled, reason, shortcut, destructive, undoable}` | `run(id, args)` | new; the palette, toolbar, context menu and shortcuts are all renderings of this list |
| `UndoStack` | entries from `EdgeDelta.invert`, toast text | `undo`, `redo` | the delta exists; stack is new |
| `ViolationMessage` | message, fix command | none | new (section 2.3) |

**Two model gaps the objects expose:**

1. **Per-family cardinality.** The profile as reconciled has global `maxGroupsPerItem` [2, §3], while a board and a Linear-style label group need "at most one tag from this family". I did not find a per-family field in the profile as described; confirm in code before relying on this.
2. **Undoing tag delete/merge.** `EdgeDelta` "never removes nodes" [source read], so `TagManager` needs tombstones. Linear's archive-versus-delete split [15] is the working precedent.

### 3.6 What is presentational, and the test for it

Purely presentational (a renderer may choose freely, no affordance needed): density; card size and whether masonry packing is used (with the reading-order caveat [28]); chip colours and icons; popover vs sheet vs inline editor; pane widths and resizing; animation; which drag library; whether a remove `x` is always visible or on hover; copy tone (templates are injectable).

**[SYNTHESIS] The test.** If a renderer could ignore the setting and still be *correct*, it is presentational. If ignoring it changes what data can be written, what a keyboard user can do, which count is shown, or what a screen reader announces, it belongs in an affordance. By that test: `tagCommit` (staged vs immediate), `multiValue`, `dragDefault`, `selectionAcrossFilter`, the `none/some/all` tag state and the live-region text are affordances; card size and chip colour are not.

### 3.7 How "pick a UI from a menu" becomes a config choice

```ts
const view: ViewConfig = {
  id: 'reading-board', name: 'Reading status',
  shell: 'three-pane',
  navigator: { surface: 'facets' },
  layout: { kind: 'board', groupBy: { family: 'status' }, multiValue: 'primary', showEmpty: true },
  inspector: { sections: ['fields', 'memberships'] },
  scope: { descendants: true, includeSmart: false },
  interaction: { tagCommit: 'immediate', dragDefault: 'add', selectionAcrossFilter: 'keep-visible' },
};
```

A developer, or an agent, edits one JSON object; the registry resolves each slot to a renderer for the target (shadcn/React or vanilla DOM) at the `LIBRARY`, `APP` or `OVERRIDE` band. Swapping `layout.kind` from `board` to `table` changes the item pane and nothing else; swapping the renderer package changes pixels and nothing else.

---

## 4. Recommended default menu and the minimum contract

### 4.1 Default menu (ranked)

**[ESTIMATE]** The ranking is my judgement of how often each fits across the four item kinds the brief names (documents, media, references, records). It is not measured. The only quantitative evidence is how many vendors ship each layout (section 1.3).

| Rank | View (shell + navigator + layout) | Fits | Why this rank |
|---|---|---|---|
| 1 | **Three-pane: group list or tree, table/list with a tag column, inspector** | references, records, documents | Fits every kind; the inspector is where memberships, bulk mode and field editing live. Table is in every vendor's menu (section 1.3) |
| 2 | **Two-pane file manager: group sidebar + list/grid** | documents, mixed files, media | The folder mental model; lowest learning cost; Finder, Gmail, Eagle [22][16][23] |
| 3 | **Gallery: sidebar + cards with tag chips** | media, clippings, assets | Needs a `cover` role; cards in 5 of 6 products |
| 4 | **Faceted browse: facet panel + results** | large collections, many families | Hearst's polyhierarchy-native pattern [1]; rules in [3][4] |
| 5 | **Triage / inbox over the "untagged" projection** | everything that grows by ingestion | Required by the "no implicit universal group" decision [1, §B.4]; Linear's Triage shows the keys [34] |
| 6 | **Board by family** | records with an exclusive family | Only applicable with an exclusive family or an explicit `multiValue` |
| 7 | **Miller columns navigator** (as a navigator option for ranks 1 to 3) | deep trees; taxonomy pickers | Survives polyhierarchy natively [1] |
| 8 | **Calendar / timeline** | dated records | Only when a date role exists |

Cross-cutting, not ranked: **command palette** (every view gets it), **tag cloud** (a widget inside a navigator, never primary [1]), **outline** (deferred; no evidence base gathered), **smart group / saved view** (a `ViewConfig` saved by name).

### 4.2 Minimum operations every view must support (the view contract)

**[SYNTHESIS]** A renderer or layout that cannot honour every row is not a conforming view. Ordered by dependency.

| # | Requirement | Basis |
|---|---|---|
| M1 | Show each item's memberships (chips, with overflow) | [1, §B.1] |
| M2 | Select one or many items, keyed by item id, with a header state (none/some/all) and the count announced in a live region | [27][4, §7.2] |
| M3 | Open the selected item in an inspector (or equivalent) | three-pane pattern [24][25] |
| M4 | Add and remove a tag on one item with the keyboard only, including creating a new tag | [37][38][39] |
| M5 | Add and remove a tag on a selection through a menu showing `{none,some,all}` per tag, with "apply to N items" | [16][27] |
| M6 | Create an item in the current scope (static groups only) | O1 |
| M7 | Distinguish "remove from this group" from "delete item", context-sensitively | [1, §B.4] |
| M8 | Undo any membership write | [42][1, §B.4 on EdgeDelta] |
| M9 | Surface every `Violation` as a message with a suggested fix | [46] |
| M10 | Reach the "untagged" projection and a free-text/filter control | [1, §B.4][3] |
| M11 | Every operation is reachable as a command; drag, hover and inline-edit are accelerators only | [19][20] |
| M12 | The view's `ViewConfig` round-trips through a URL or file | [4, §6] |

Optional per view: drag-to-tag, inline cell editing, reorder, per-view saved state.

---

## 5. What I could not verify, and open questions

- **Notion board grouped by a multi-select property.** The docs I fetched say a board can be grouped by "select, multi-select, person, or relation" but do not state whether a multi-valued card appears in each column [29]. Behaviour for the duplicate-or-primary policy is therefore from design reasoning, not a product citation. Linear's and Jira's duplicates came from a search summary, not primary docs, so I did not rely on them.
- **Create-in-context** inheriting the scope's values (O1): not found in any fetchable doc.
- **Gmail's tri-state label menu** is documented by a third-party help article; Google's own label help page does not describe multi-select behaviour [43].
- **Lightroom Classic keyword behaviour** is from a search summary of Adobe's help page; the page itself returned 403 [18].
- **Directus layouts** are from a search snippet; the docs URLs I tried redirected or 404'd [10].
- **Obsidian Bases view types** differ between two retrievals of the same page; I list only Table, List, Cards, Map as confirmed [8].
- **Command-palette evidence** is practitioner blog posts, not research [32].
- **Tag split** has no documented product precedent; none found.
- **No study** found comparing three-pane vs two-pane, or board vs table, for tagged collections. Rankings in section 4.1 are judgement.
- **Source-read claims** (EdgeDelta never removes nodes, `Violation` codes, `ViewMode`, `Surface`) are from the zodal and zodal-groups source as it stood on 2026-10-04 and should be re-checked before they are cited externally.

---

## REFERENCES

Internal documents (this repository family, public):

1. zodal-groups research 03, navigation and UX patterns for hierarchies and what breaks in a polyhierarchy: [`zodal-groups/docs/research/zgroups_03-navigation-and-ux-patterns.md`](https://github.com/i2mint/zodal-groups/blob/main/docs/research/zgroups_03-navigation-and-ux-patterns.md). Section letters (A.x, B.x, C.x) refer to it.
2. zodal-groups research reconciliation, the merged decisions (D12, D15, D16, constraint profiles in section 3, UI-layer rules in section 4): [`zodal-groups/docs/research/_reconciliation.md`](https://github.com/i2mint/zodal-groups/blob/main/docs/research/_reconciliation.md).
3. Faceted-filter UX guidance (an internal agent skill of the maintainers; not public). Its claims are restated here with their primary sources where they matter.
4. Faceted filtering UX research (section 6 state and undo; section 7 selecting results after filtering), an internal survey of public sources by the maintainers; not public.

External sources (all fetched or searched 2026-10-04 unless noted):

5. [Notion developer docs: the view object (10 view types)](https://developers.notion.com/reference/view.md)
6. [Notion help: views, filters, sorts and groups](https://www.notion.com/help/views-filters-and-sorts)
7. [Univer Bases: views model (type, fieldOrder, fieldSettings, filter, sort, group, config)](https://docs.univer.ai/guides/bases/model/views)
8. [Obsidian Help: Bases views](https://obsidian.md/help/bases/views)
9. [Baserow: overview of views; view configuration options](https://baserow.io/user-docs/overview-of-baserow-views)
10. [Directus: layouts (search-result snippets; docs pages redirected)](https://docs.directus.io/user-guide/content-module/layouts)
11. [Airtable support: getting started with views](https://support.airtable.com/docs/getting-started-with-airtable-views)
12. [GitHub Docs: changing the layout of a view (Table, Board, Roadmap)](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/changing-the-layout-of-a-view)
13. [Directus feature spotlight: layouts (calendar for temporal data)](https://directus.io/blog/directus-feature-spotlight-layouts)
14. zodal and zodal-groups source as read on 2026-10-04: `zodal/packages/core/src/types.ts` (`CollectionAffordances`, `ViewMode`, `GroupByConfig`), `zodal/packages/ui/src/registry/`, `zodal-groups/packages/groups-ui/src/{views,drag,registry}.ts`, `zodal-groups/packages/groups-core/src/model.ts`.
15. [Linear docs: labels (label groups, inline creation, archive vs delete)](https://linear.app/docs/labels)
16. [Turnkey Internet KB: how to use labels in Gmail (indeterminate checkbox behaviour; third-party)](https://turnkeyinternet.net/kb/how-to-use-labels-in-gmail/)
17. [Zotero: collections and tags](https://www.zotero.org/support/collections_and_tags)
18. [Adobe: Lightroom Classic, use keywords (via search snippet; page returned 403)](https://helpx.adobe.com/uk/lightroom-classic/desktop/organize-photos-in-lightroom-classic/keywords.html)
19. [W3C: Understanding WCAG 2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
20. [Google: Gmail keyboard shortcuts](https://support.google.com/mail/answer/6594)
21. [Linear docs: triage](https://linear.app/docs/triage)
22. [Apple: tag files and folders on Mac](https://support.apple.com/guide/mac-help/tag-files-and-folders-mchlp15236/mac)
23. [Eagle: organizing a library with folders and tags (search snippets)](https://eagle.cool/blog/post/how-to-organize-files-with-logic)
24. [Wikipedia: Paned window (three-pane interface; Outlook Express layout)](https://en.wikipedia.org/wiki/Paned_window_(computing))
25. [Zotero blog: Zotero 7, redesigned (item pane "Libraries and Collections" section; via search summary)](https://www.zotero.org/blog/zotero-7/)
26. [W3C WAI-ARIA APG: grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
27. [TanStack Table v8: row selection guide](https://tanstack.com/table/v8/docs/guide/row-selection)
28. [CSS Working Group issue 5675: masonry layout reading order and accessibility](https://github.com/w3c/csswg-drafts/issues/5675)
29. [Notion help: board view](https://www.notion.com/help/boards)
30. [Linear docs: display options](https://linear.app/docs/display-options)
31. [Notion developer docs: working with views (per-type configuration)](https://developers.notion.com/guides/data-apis/working-with-views)
32. [Chameleon: CMD+K search pattern (practitioner source)](https://www.chameleon.io/patterns/cmd-k-search)
33. [Wikipedia: Outliner](https://en.wikipedia.org/wiki/Outliner)
34. [Linear docs: triage (actions and shortcuts)](https://linear.app/docs/triage)
35. [DEVONthink forum and blog (tag assignment by drag, alias field, unified tags; search snippets)](https://discourse.devontechnologies.com/t/ahhhhhh-where-did-the-tags-come-from/11519)
36. [Notion help: database properties (multi-select options)](https://www.notion.com/help/database-properties)
37. [Zag.js: Tags Input](https://zagjs.com/components/react/tags-input)
38. [W3C WAI-ARIA APG: combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
39. [React Aria: TagGroup](https://react-aria.adobe.com/TagGroup)
40. [Downshift: useMultipleSelection](https://www.downshift-js.com/use-multiple-selection)
41. [Material Design 3: chips](https://m3.material.io/components/chips/guidelines)
42. [Aza Raskin, A List Apart: Never use a warning when you mean undo](https://alistapart.com/article/neveruseawarning)
43. [Google: create labels to organize Gmail (colours, nesting, deletion)](https://support.google.com/mail/answer/118708)
44. [Obsidian community plugin: Tag Wrangler; Obsidian Help: Tags view](https://community.obsidian.md/plugins/tag-wrangler)
45. [DEVONtechnologies blog: DEVONthink To Go 3.7.3 (merge groups or tags)](https://www.devontechnologies.com/blog/20230719-devonthinktogo-373-update)
46. [Nielsen Norman Group: error-message guidelines](https://www.nngroup.com/articles/error-message-guidelines/)
47. [W3C WAI-ARIA APG: listbox pattern (multi-select keyboard model)](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)
48. W3C WAI-ARIA APG mixed-state checkbox, as quoted in the faceted-filter research [4, §7.2] (not re-fetched).
49. [JSON Forms: architecture](https://jsonforms.io/docs/architecture/)
50. [JSON Forms: custom renderers tutorial (testers and rank)](https://jsonforms.io/docs/tutorial/custom-renderers/)
51. [TanStack Table: overview (definition of headless)](https://tanstack.com/table/latest/docs/overview)
52. [Zag.js: introduction](https://zagjs.com/overview/introduction)
53. [Refine: general concepts (headless)](https://refine.dev/docs/guides-concepts/general-concepts/)
54. [Puck: component configuration](https://puckeditor.com/docs/api-reference/configuration/component-config)
