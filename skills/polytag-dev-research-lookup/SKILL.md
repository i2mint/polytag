---
name: polytag-dev-research-lookup
description: Use when you need to find WHICH polytag research document answers a question, or what was already decided, before reading or re-litigating it. Triggers on "what did we decide for polytag", "where does this piece go (polytag or zodal-groups or zodal)", "which grammar is lossless", "what is a grammar vs a format", "what goes in ViewConfig", "which views are in the menu", "what do we call X", "is there prior art for", "why embedded edges by default", "what are the acceptance cases". Points at the one right document; the model's own decisions live in zodal-groups.
metadata:
  audience: developers
---

# polytag · research lookup

**Read first: [`docs/research/synthesis.md`](../../docs/research/synthesis.md)** (one page), then [`docs/decisions/0001-placement-and-seams.md`](../../docs/decisions/0001-placement-and-seams.md) (where each piece lives, the five v1 seams).

**The model is not decided here.** Membership edges, profiles, closure, `PathNode[]`, drag = add, de-duplicated counts: zodal-groups decisions D1–D24 in its `docs/research/_reconciliation.md` (sibling repo `../zodal-groups`, or <https://github.com/i2mint/zodal-groups>). Do not re-litigate them from polytag.

## Route by question

| Question | Go to |
|---|---|
| Does this code belong in polytag, zodal-groups or zodal? | ADR 0001, the placement table |
| What are the v1 seams and their defaults? | ADR 0001, "v1 seams" |
| What changed after reading the zodal ecosystem's own research? | ADR 0001 §Revision 1 |
| Format vs grammar; which grammars exist; the codec interfaces | `formats-and-grammars.md` §0, §3, §8.1 |
| Which grammar is lossless for which profile? | `formats-and-grammars.md` §4 (the two tables) |
| Default grammar per format / per profile; v1 vs v1.1 vs v2 | `formats-and-grammars.md` §8.4–§8.6 |
| YAML/TOML/CSV traps (`010`, alias limits, key order) | `formats-and-grammars.md` §0.4, §5 |
| The `ViewConfig` shape | `ui-patterns.md` §3.3 |
| Which views are offered for a schema (applicability testers) | `ui-patterns.md` §3.4 |
| The ranked default view menu | `ui-patterns.md` §4.1 |
| What every view must support (the 12-point contract) | `ui-patterns.md` §4.2 |
| Bulk tagging (tri-state), violation messages | `ui-patterns.md` §2.2, §2.3 |
| Kanban over a multi-valued tag family | `ui-patterns.md` §0.3; `prior-art.md` §3.6 |
| What to call things (item, group, membership, facet, smart group…) | `terminology.md` §3.2 |
| Do users prefer folders or tags? (the default view) | `terminology.md` §4 |
| A library or product: licence, verdict | `prior-art.md` §5 (consolidated table) |
| What to copy, what to avoid | `prior-art.md` §6, §7 |
| The acceptance cases | `synthesis.md` §5 |
| How "data in" was built (formats, grammars, loss report, detection) and where it departs from the research | the decisions below, then `packages/polytag/src/loss.ts` (capabilities, `reduce`) and `src/grammar.ts` (the contract) |

## Settled — reopen only with new evidence

- polytag is the composition tier (depends on both storage and UI sides); library pieces that depend on one side go upstream.
- **Operations are acture-shaped commands; undo is the app's history over returned inverses.** No `CommandSet`/`UndoStack` in polytag, no `handler` on `OperationDefinition` (ADR 0001 §Revision 1).
- **A tagged collection has one or more group spaces** (`spaces`), each with its own profile and `edges`.
- **Bulk writes keep what succeeded** and report failures; within one item, record + edges succeed together.
- **Tag-agnostic subpaths** (`polytag/formats`, `/backends`, `/views`) never import `@zodal/groups-*`.
- Memberships default to **embedded** (`groups` id array on the item record); `GroupStore` is the opt-in for group-to-group edges, edge order and labels at scale.
- Import default = the shape people already have; export default = the lossless grammar for the dataset's profile, with its loss report shown.
- A board over a non-exclusive tag family needs an explicit `multiValue` policy.
- No AGPL/GPL code copied; formats implemented from their documentation.

## Data in, as built (i2mint/polytag#1) — where it departs from `formats-and-grammars.md`

- **A format is a `FormatDescriptor`** (sync: id, extensions, `sniff`, comment `inspect`, `unrepresentable`) whose `load()` resolves to a zodal `Codec<string, V>`; both directions throw `FormatError`. `patch` (comment-preserving writes) is not in v1.
- **`reduce(space, capabilities)` is the single source of what a grammar keeps.** `assess` (before writing) and every `serialise` go through it; the gate checks `parse(serialise(S)) ≅ reduce(S).space` for every grammar × format.
- **Loss kinds are named after the feature** (`group-edges`, `item-multi-parent`, `edge-order`, `isolated-node`, `formatting`, `format-value`…); the severity says drop / degrade / encode. Each loss lists **every** affected id (`ids`), not a sample, so the report is exact.
- **One `isolatedNodes` capability, not `emptyGroups` + `orphans`:** the node type is unified (D1), so an empty group and an orphan item are the same isolated node.
- **Capabilities may depend on params and the target format** (`capabilitiesFor(params, format)`): `nested` writes a shared node as YAML anchors (native) but as JSON copies (degrade).
- **`tag-paths` identity is the segment**, not the whole path: a group with two parents is written as two paths (an `encode`), so RD's ids round-trip; Obsidian would read them as two tags.
- **`edge-rows` is polytag's canonical interchange** (§9's recommendation); in one CSV, a row with an empty `parent` is a node row (data, isolated nodes). JGF is `node-link`.
- **Positional grammars emit fractional order keys**; round trips compare order by rank, and only where the source was ordered.
- **Snapshots are structural** (`{ nodes, edges }` fitting zodal-groups' `Node` / `Edge`); `@zodal/groups-core` is a devDependency for the compatibility test only.
- **Import is a plan first** (`planImport`: create / update / skip / conflict per id, by content hash), written by `applyImport` only when conflicts are resolved; export takes a `scope`.
