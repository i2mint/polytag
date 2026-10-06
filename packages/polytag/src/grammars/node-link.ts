/**
 * `node-link` (h): graph interchange. Writes JSON Graph Format v2 (formats-and-grammars §3(h)):
 *
 * ```json
 * { "graph": { "directed": true,
 *   "nodes": { "food": { "label": "Food" }, "notes": {} },
 *   "edges": [{ "source": "food", "target": "italian", "relation": "contains" }] } }
 * ```
 *
 * Mapping: `source = parent`, `target = child`, `relation = kind`, `label = label`; node
 * payload and family go in node `metadata`; JGF has no edge `id` or `order`, so they travel
 * in edge `metadata` (a convention: an `encode`), next to the edge's own `meta`.
 *
 * Reads, besides JGF v2 (nodes as a map) and v1 (nodes as an array, or a `graphs` list):
 * the d3 / NetworkX node-link shape `{ nodes: [{id}], links | edges: [{source, target}] }`,
 * and Cytoscape `elements`, whose compound-node `parent` becomes a membership edge.
 */

import { z } from 'zod';
import { isPlainObject } from '../formats/index.js';
import { type Detection, defineGrammar, noDetection } from '../grammar.js';
import type { GrammarCapabilities } from '../loss.js';
import { customEdgeIdsOf } from '../model/features.js';
import { CONTAINS, type SnapshotNode } from '../model/snapshot.js';
import { type NodeData, type SpaceBuilder, createSpaceBuilder, seg } from './shared/builder.js';
import { FAMILY_KEY, PAYLOAD_KEY, coerceString, hasOwn, isFamilyRule, own } from './shared/records.js';

/** Params of `node-link`. */
export const nodeLinkParams = z.object({
  /** `auto`: write an edge id (in metadata) only when it is not the deterministic one. */
  edgeIds: z.enum(['auto', 'always', 'never']).default('auto'),
});
export type NodeLinkParams = z.infer<typeof nodeLinkParams>;

const CAPS: GrammarCapabilities = {
  itemsMultiParent: 'native',
  nestedGroups: 'native',
  groupsMultiParent: 'native',
  groupMeta: 'native',
  itemMeta: 'native',
  edgeOrder: 'convention',
  edgeLabel: 'native',
  edgeMeta: 'native',
  isolatedNodes: 'native',
  edgeKinds: 'native',
  edgeIds: 'convention',
  identity: 'id',
};

const META = 'meta';
const ORDER = 'order';
const ID = 'id';

/** Entries of a metadata object for `value` (spread when reversible, else under `key`), plus fixed entries. */
function metadata(fixed: [string, unknown][], value: unknown, key: string, reserved: readonly string[]): Record<string, unknown> | undefined {
  const entries = [...fixed];
  if (value !== undefined) {
    const spread = isPlainObject(value) && Object.keys(value).length > 0 && Object.keys(value).every((k) => !reserved.includes(k));
    entries.push(...(spread ? Object.entries(value as Record<string, unknown>) : [[key, value] as [string, unknown]]));
  }
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Split a metadata object into its fixed keys and the rest (the spread value, or `rest[key]` alone). */
function unmetadata(meta: Record<string, unknown>, key: string, fixed: readonly string[]): { fixed: Record<string, unknown>; value: unknown } {
  const fixedOut = Object.fromEntries(fixed.filter((k) => hasOwn(meta, k)).map((k) => [k, own(meta, k)]));
  const rest = Object.keys(meta).filter((k) => !fixed.includes(k) && k !== key);
  if (rest.length) return { fixed: fixedOut, value: Object.fromEntries([...rest.map((k) => [k, own(meta, k)]), ...(hasOwn(meta, key) ? [[key, own(meta, key)]] : [])]) };
  return { fixed: fixedOut, value: own(meta, key) };
}

function readJgfNode(builder: SpaceBuilder, id: string, raw: unknown, path: string): void {
  if (!isPlainObject(raw)) {
    builder.node(id);
    return;
  }
  const label = coerceString(own(raw, 'label'), 'label', `${path}/label`, builder);
  const meta = own(raw, 'metadata');
  let data: NodeData = { label };
  if (isPlainObject(meta)) {
    const { fixed, value } = unmetadata(meta, PAYLOAD_KEY, [FAMILY_KEY]);
    const family = isFamilyRule(fixed[FAMILY_KEY]) ? (fixed[FAMILY_KEY] as { maxPerItem: number }) : undefined;
    data = { label, family, payload: family || fixed[FAMILY_KEY] === undefined ? value : { ...(isPlainObject(value) ? value : {}), [FAMILY_KEY]: fixed[FAMILY_KEY] } };
  }
  const extra = Object.keys(raw).filter((k) => !['id', 'label', 'metadata'].includes(k));
  if (extra.length) builder.leftover(path, Object.fromEntries(extra.map((k) => [k, own(raw, k)])));
  builder.node(id, data, path);
}

/** An endpoint: an id, or (d3 after a simulation) a node object with an id. */
const endpoint = (v: unknown): unknown => (isPlainObject(v) ? own(v, 'id') : v);

function readEdge(builder: SpaceBuilder, raw: unknown, path: string, style: 'jgf' | 'plain'): { id?: string; parent: string; order?: string } | undefined {
  if (!isPlainObject(raw)) {
    builder.diag({ severity: 'warning', code: 'shape', message: 'edge is not an object; skipped', path });
    builder.leftover(path, raw);
    return undefined;
  }
  const parent = coerceString(endpoint(own(raw, 'source')), 'source', `${path}/source`, builder);
  const child = coerceString(endpoint(own(raw, 'target')), 'target', `${path}/target`, builder);
  if (parent === undefined || child === undefined) {
    builder.diag({ severity: 'error', code: 'missing-id', message: 'edge needs a source and a target; skipped', path });
    builder.leftover(path, raw);
    return undefined;
  }
  const kind = coerceString(own(raw, 'relation') ?? own(raw, 'kind'), 'relation', path, builder) ?? CONTAINS;
  const label = coerceString(own(raw, 'label'), 'label', path, builder);
  let id = coerceString(own(raw, 'id'), 'edge id', path, builder);
  let order: string | undefined;
  let meta: Record<string, unknown> | undefined;
  if (style === 'jgf') {
    const m = own(raw, 'metadata');
    if (isPlainObject(m)) {
      const { fixed, value } = unmetadata(m, META, [ID, ORDER]);
      id = coerceString(fixed[ID], 'edge id', path, builder) ?? id;
      order = coerceString(fixed[ORDER], 'order', path, builder);
      if (value !== undefined) meta = isPlainObject(value) ? value : { [META]: value };
    }
  } else {
    order = coerceString(own(raw, 'order'), 'order', path, builder);
    const rest = Object.keys(raw).filter((k) => !['source', 'target', 'relation', 'kind', 'label', 'id', 'order'].includes(k));
    if (rest.length) meta = Object.fromEntries(rest.map((k) => [k, own(raw, k)]));
  }
  const edgeId = builder.edge(parent, child, { id, kind, label, order, meta }, path);
  return edgeId === undefined ? undefined : { id: edgeId, parent, order };
}

function parseJgf(graph: Record<string, unknown>, base: string, builder: SpaceBuilder): void {
  if (own(graph, 'directed') === false) {
    builder.diag({ severity: 'warning', code: 'shape', message: 'the graph is undirected; source is read as the group and target as the member', path: base });
  }
  const nodes = own(graph, 'nodes');
  if (isPlainObject(nodes)) for (const [id, n] of Object.entries(nodes)) readJgfNode(builder, id, n, `${base}/nodes/${seg(id)}`);
  else if (Array.isArray(nodes)) {
    nodes.forEach((n, i) => {
      const id = isPlainObject(n) ? coerceString(own(n, 'id'), 'node id', `${base}/nodes/${i}`, builder) : undefined;
      if (id === undefined) builder.diag({ severity: 'error', code: 'missing-id', message: 'node has no id; skipped', path: `${base}/nodes/${i}` });
      else readJgfNode(builder, id, n, `${base}/nodes/${i}`);
    });
  }
  const edges = own(graph, 'edges');
  if (Array.isArray(edges)) edges.forEach((e, i) => readEdge(builder, e, `${base}/edges/${i}`, 'jgf'));
  for (const k of Object.keys(graph)) if (!['nodes', 'edges', 'directed', 'type', 'label', 'metadata', 'id'].includes(k)) builder.leftover(`${base}/${seg(k)}`, own(graph, k));
}

function parsePlain(nodes: unknown[], links: unknown[], linksKey: string, builder: SpaceBuilder): void {
  nodes.forEach((n, i) => {
    const path = `/nodes/${i}`;
    const id = isPlainObject(n) ? coerceString(own(n, 'id'), 'node id', `${path}/id`, builder) : coerceString(n, 'node id', path, builder);
    if (id === undefined) {
      builder.diag({ severity: 'error', code: 'missing-id', message: 'node has no id; skipped', path });
      return;
    }
    if (!isPlainObject(n)) return builder.node(id);
    const rest = Object.keys(n).filter((k) => k !== 'id' && k !== 'label');
    builder.node(id, { label: coerceString(own(n, 'label'), 'label', path, builder), payload: rest.length ? Object.fromEntries(rest.map((k) => [k, own(n, k)])) : undefined }, path);
  });
  links.forEach((l, i) => readEdge(builder, l, `/${linksKey}/${i}`, 'plain'));
}

function parseCytoscape(elements: unknown, builder: SpaceBuilder): void {
  const list = Array.isArray(elements)
    ? elements.map((e, i) => ({ e, path: `/elements/${i}`, group: isPlainObject(e) ? own(e, 'group') : undefined }))
    : isPlainObject(elements)
      ? [
          ...((own(elements, 'nodes') as unknown[] | undefined) ?? []).map((e, i) => ({ e, path: `/elements/nodes/${i}`, group: 'nodes' as unknown })),
          ...((own(elements, 'edges') as unknown[] | undefined) ?? []).map((e, i) => ({ e, path: `/elements/edges/${i}`, group: 'edges' as unknown })),
        ]
      : [];
  for (const { e, path, group } of list) {
    const data = isPlainObject(e) ? own(e, 'data') : undefined;
    if (!isPlainObject(data)) {
      builder.diag({ severity: 'warning', code: 'shape', message: 'element has no data; skipped', path });
      continue;
    }
    const isEdge = group === 'edges' || (group === undefined && hasOwn(data, 'source'));
    if (isEdge) {
      readEdge(builder, data, `${path}/data`, 'plain');
      continue;
    }
    const id = coerceString(own(data, 'id'), 'node id', `${path}/data/id`, builder);
    if (id === undefined) {
      builder.diag({ severity: 'error', code: 'missing-id', message: 'node has no id; skipped', path });
      continue;
    }
    const rest = Object.keys(data).filter((k) => !['id', 'label', 'parent'].includes(k));
    builder.node(id, { label: coerceString(own(data, 'label'), 'label', path, builder), payload: rest.length ? Object.fromEntries(rest.map((k) => [k, own(data, k)])) : undefined }, path);
    const parent = coerceString(own(data, 'parent'), 'parent', `${path}/data/parent`, builder);
    if (parent !== undefined) builder.edge(parent, id, {}, `${path}/data/parent`);
  }
}

function detect(input: unknown): Detection<NodeLinkParams> {
  if (!isPlainObject(input)) return noDetection();
  const graph = own(input, 'graph') ?? (Array.isArray(own(input, 'graphs')) ? (own(input, 'graphs') as unknown[])[0] : undefined);
  if (isPlainObject(graph) && (hasOwn(graph, 'nodes') || hasOwn(graph, 'edges'))) {
    const v2 = isPlainObject(own(graph, 'nodes'));
    return { score: 0.95, evidence: [`a JSON Graph Format ${v2 ? 'v2 (nodes as a map)' : 'v1 (nodes as an array)'} graph`], suggestedParams: {} };
  }
  if (hasOwn(input, 'elements')) return { score: 0.9, evidence: ['Cytoscape.js elements'], suggestedParams: {} };
  const links = own(input, 'links') ?? own(input, 'edges');
  if (Array.isArray(own(input, 'nodes')) && Array.isArray(links)) {
    const st = links.length > 0 && links.every((l) => isPlainObject(l) && hasOwn(l, 'source') && hasOwn(l, 'target'));
    return st
      ? { score: 0.9, evidence: [`node-link data: nodes and ${hasOwn(input, 'links') ? 'links' : 'edges'} with source/target (d3, NetworkX)`], suggestedParams: {} }
      : { score: 0.2, evidence: ['nodes and edges, but edges do not use source/target'], suggestedParams: {} };
  }
  return noDetection();
}

/** `node-link`: JSON Graph Format and other node-link shapes. Lossless (order and edge ids by convention). */
export const nodeLink = defineGrammar<NodeLinkParams>({
  id: 'node-link',
  label: 'Node-link graph (JGF)',
  description: 'Nodes and edges as a graph: JSON Graph Format v2 (also reads d3 / NetworkX node-link and Cytoscape). Lossless.',
  inputs: ['value'],
  formats: ['json', 'jsonc', 'yaml', 'toml'],
  params: nodeLinkParams,
  capabilities: (p) => (p.edgeIds === 'never' ? { ...CAPS, edgeIds: 'no' } : CAPS),
  detect,

  parse(input) {
    const builder = createSpaceBuilder();
    if (!isPlainObject(input)) {
      builder.diag({ severity: 'error', code: 'shape', message: 'expected a graph object', path: '' });
      builder.leftover('', input);
      return builder.build();
    }
    const graphs = own(input, 'graphs');
    const graph = own(input, 'graph');
    if (isPlainObject(graph)) parseJgf(graph, '/graph', builder);
    else if (Array.isArray(graphs) && isPlainObject(graphs[0])) {
      parseJgf(graphs[0], '/graphs/0', builder);
      if (graphs.length > 1) {
        builder.diag({ severity: 'warning', code: 'shape', message: `${graphs.length} graphs; only the first is read`, path: '/graphs' });
        graphs.slice(1).forEach((g, i) => builder.leftover(`/graphs/${i + 1}`, g));
      }
    } else if (hasOwn(input, 'elements')) parseCytoscape(own(input, 'elements'), builder);
    else if (Array.isArray(own(input, 'nodes'))) {
      const linksKey = Array.isArray(own(input, 'links')) ? 'links' : 'edges';
      parsePlain(own(input, 'nodes') as unknown[], (own(input, linksKey) as unknown[] | undefined) ?? [], linksKey, builder);
      if (own(input, 'directed') === false) builder.diag({ severity: 'warning', code: 'shape', message: 'the graph is undirected; source is read as the group', path: '/directed' });
    } else {
      builder.diag({ severity: 'error', code: 'shape', message: "expected 'graph', 'graphs', 'elements' or 'nodes' + 'links'", path: '' });
      builder.leftover('', input);
    }
    return builder.build();
  },

  write(space, p) {
    const custom = new Set(customEdgeIdsOf(space.edges));
    const node = (n: SnapshotNode): Record<string, unknown> =>
      Object.fromEntries([
        ...(n.label !== undefined ? [['label', n.label]] : []),
        ...(() => {
          const m = metadata(n.family ? [[FAMILY_KEY, { ...n.family }]] : [], n.payload, PAYLOAD_KEY, [FAMILY_KEY, PAYLOAD_KEY]);
          return m ? [['metadata', m]] : [];
        })(),
      ]);
    const edges = space.edges.map((e) => {
      const fixed: [string, unknown][] = [
        ...((p.edgeIds === 'always' || (p.edgeIds === 'auto' && custom.has(e.id)) ? [[ID, e.id]] : []) as [string, unknown][]),
        ...((e.order !== undefined ? [[ORDER, e.order]] : []) as [string, unknown][]),
      ];
      const m = metadata(fixed, e.meta, META, [ID, ORDER, META]);
      return Object.fromEntries([
        ['source', e.parent],
        ['target', e.child],
        ['relation', e.kind],
        ...(e.label !== undefined ? [['label', e.label]] : []),
        ...(m ? [['metadata', m]] : []),
      ]);
    });
    const nodes = Object.fromEntries(space.nodes.map((n) => [n.id, node(n)]));
    return { output: { graph: { directed: true, nodes, edges } } };
  },
});
