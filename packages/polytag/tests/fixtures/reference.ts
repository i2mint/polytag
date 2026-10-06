/**
 * The reference dataset (RD) of formats-and-grammars §2.1, its polyhierarchy delta P, and a
 * kitchen-sink space K that uses every feature of the model, plus RD written by hand in each
 * grammar × format (the examples of §3), as acceptance fixtures (§2.2).
 */

import { CONTAINS, type SnapshotEdge, type SnapshotNode, type SpaceSnapshot, defaultEdgeId } from '../../src/index.js';

const edge = (parent: string, child: string, extra: Partial<SnapshotEdge> = {}): SnapshotEdge => ({
  id: defaultEdgeId(parent, child, extra.kind ?? CONTAINS),
  parent,
  child,
  kind: CONTAINS,
  ...extra,
});

const ids = ['food', 'italian', 'vegetarian', 'quick', 'carbonara', 'margherita', 'salad', 'ramen', 'notes'];

/** Five items, four groups, nine `contains` edges; `notes` is an orphan. Profile: labels. */
export const RD: SpaceSnapshot = {
  nodes: ids.map((id) => ({ id })),
  edges: [
    edge('food', 'italian'),
    edge('food', 'vegetarian'),
    edge('italian', 'carbonara'),
    edge('quick', 'carbonara'),
    edge('italian', 'margherita'),
    edge('vegetarian', 'margherita'),
    edge('vegetarian', 'salad'),
    edge('quick', 'salad'),
    edge('food', 'ramen'),
  ],
};

/** RD plus `quick → italian`: a group with two parents (polyhierarchy). */
export const P: SpaceSnapshot = { nodes: RD.nodes, edges: [...RD.edges, edge('quick', 'italian')] };

const kNodes: Record<string, Omit<SnapshotNode, 'id'>> = {
  food: { label: 'Food', payload: { color: 'red' }, family: { maxPerItem: 3 } },
  quick: { family: { maxPerItem: 2 } },
  carbonara: { label: 'Pasta carbonara', payload: { minutes: 20, cuisine: 'it' } },
  margherita: { payload: { tags: ['classic'], vegan: false } },
  salad: { payload: 'a plain string payload' },
  ramen: { payload: {} },
  notes: { payload: { text: 'n' } },
};

/** Every feature: node labels, payloads (spreadable or not), family rules, edge order, label, meta, a custom edge id, a non-membership kind. */
export const K: SpaceSnapshot = {
  nodes: ids.map((id) => ({ id, ...kNodes[id] })),
  edges: [
    edge('food', 'italian'),
    edge('food', 'vegetarian'),
    edge('italian', 'carbonara', { order: 'a0' }),
    edge('quick', 'carbonara', { id: 'e-qc' }),
    edge('italian', 'margherita', { order: 'Z' }),
    edge('vegetarian', 'margherita', { label: 'Margherita (veg)' }),
    edge('vegetarian', 'salad'),
    edge('quick', 'salad', { meta: { assertedBy: 'thor' } }),
    edge('food', 'ramen', { order: 'm' }),
    edge('quick', 'italian'),
    edge('carbonara', 'ramen', { kind: 'related' }),
  ],
};

/** RD by hand, per grammar and format: `[grammar, format, text, params?, edges RD keeps]`. */
export const RD_TEXTS: readonly { grammar: string; format: string; text: string; params?: Record<string, unknown>; dropped?: readonly string[] }[] = [
  {
    grammar: 'nested',
    format: 'json',
    text: `[
  {"id": "food", "children": [
    {"id": "italian", "children": ["carbonara", "margherita"]},
    {"id": "vegetarian", "children": ["margherita", "salad"]},
    "ramen"]},
  {"id": "quick", "children": ["carbonara", "salad"]},
  "notes"
]`,
  },
  {
    grammar: 'nested',
    format: 'yaml',
    text: `- id: food
  children:
    - id: italian
      children: [&carbonara {id: carbonara}, &margherita {id: margherita}]
    - id: vegetarian
      children: [*margherita, &salad {id: salad}]
    - &ramen {id: ramen}
- id: quick
  children: [*carbonara, *salad]
- &notes {id: notes}
`,
  },
  {
    grammar: 'tags-array',
    format: 'json',
    text: `[
  {"id": "carbonara",  "tags": ["italian", "quick"]},
  {"id": "margherita", "tags": ["italian", "vegetarian"]},
  {"id": "salad",      "tags": ["vegetarian", "quick"]},
  {"id": "ramen",      "tags": ["food"]},
  {"id": "notes",      "tags": []}
]`,
    dropped: [defaultEdgeId('food', 'italian'), defaultEdgeId('food', 'vegetarian')],
  },
  {
    grammar: 'tag-paths',
    format: 'yaml',
    text: `carbonara:  [food/italian, quick]
margherita: [food/italian, food/vegetarian]
salad:      [food/vegetarian, quick]
ramen:      [food]
notes:      []
`,
  },
  {
    grammar: 'members-map',
    format: 'json',
    text: `{
  "food":       ["italian", "vegetarian", "ramen"],
  "italian":    ["carbonara", "margherita"],
  "vegetarian": ["margherita", "salad"],
  "quick":      ["carbonara", "salad"],
  "notes":      []
}`,
  },
  {
    grammar: 'edge-rows',
    format: 'csv',
    text: `parent,child
food,italian
food,vegetarian
italian,carbonara
quick,carbonara
italian,margherita
vegetarian,margherita
vegetarian,salad
quick,salad
food,ramen
,notes
`,
  },
  {
    grammar: 'one-hot',
    format: 'csv',
    text: `id,food,italian,vegetarian,quick
carbonara,0,1,0,1
margherita,0,1,1,0
salad,0,0,1,1
ramen,1,0,0,0
notes,0,0,0,0
`,
    dropped: [defaultEdgeId('food', 'italian'), defaultEdgeId('food', 'vegetarian')],
  },
  {
    grammar: 'delimited',
    format: 'csv',
    text: `id,title,groups
carbonara,Pasta carbonara,italian;quick
margherita,Margherita,italian;vegetarian
salad,Salad,vegetarian;quick
ramen,Ramen,food
notes,Notes,
`,
    dropped: [defaultEdgeId('food', 'italian'), defaultEdgeId('food', 'vegetarian')],
  },
  {
    grammar: 'node-link',
    format: 'json',
    text: `{"graph": {
  "directed": true,
  "nodes": {"food": {}, "italian": {}, "vegetarian": {}, "quick": {}, "carbonara": {}, "margherita": {}, "salad": {}, "ramen": {}, "notes": {}},
  "edges": [
    {"source": "food",       "target": "italian",    "relation": "contains"},
    {"source": "food",       "target": "vegetarian", "relation": "contains"},
    {"source": "italian",    "target": "carbonara",  "relation": "contains"},
    {"source": "quick",      "target": "carbonara",  "relation": "contains"},
    {"source": "italian",    "target": "margherita", "relation": "contains"},
    {"source": "vegetarian", "target": "margherita", "relation": "contains"},
    {"source": "vegetarian", "target": "salad",      "relation": "contains"},
    {"source": "quick",      "target": "salad",      "relation": "contains"},
    {"source": "food",       "target": "ramen",      "relation": "contains"}
  ]
}}`,
  },
  {
    grammar: 'tags-array',
    format: 'toml',
    text: `[[items]]
id = "carbonara"
tags = ["italian", "quick"]

[[items]]
id = "margherita"
tags = ["italian", "vegetarian"]

[[items]]
id = "salad"
tags = ["vegetarian", "quick"]

[[items]]
id = "ramen"
tags = ["food"]

[[items]]
id = "notes"
tags = []
`,
    dropped: [defaultEdgeId('food', 'italian'), defaultEdgeId('food', 'vegetarian')],
  },
];
