/**
 * `edge-rows` (e, and TOML's m): the canonical relation itself, one row per membership plus
 * a nodes table. Lossless for every profile (formats-and-grammars §4) and polytag's own
 * interchange shape (research §9's recommendation; JGF is `node-link`).
 *
 * Value form (JSON, YAML, TOML `[[nodes]]` / `[[edges]]`):
 * ```json
 * { "nodes": [{ "id": "notes" }], "edges": [{ "parent": "food", "child": "italian", "kind": "contains" }] }
 * ```
 * A bare array of edge rows is read too. Table form (CSV, TSV): columns
 * `parent,child,kind[,label,order,id,meta,family,payload columns…]`; a row with an empty
 * `parent` describes the node named in `child` (its label, family and payload), which is how
 * isolated nodes and node data travel in one table. That also reads a parent-pointer table
 * (`id,parent`, a3): roots are node rows.
 *
 * Only the nodes that need it get a node row (data, or no edge) unless `nodeRows: 'all'`;
 * an edge id is written only when it differs from the deterministic one (`edgeIds: 'auto'`).
 */

import { z } from 'zod';
import { isPlainObject, isTable, type Table } from '../formats/index.js';
import { type Detection, defineGrammar, noDetection } from '../grammar.js';
import type { GrammarCapabilities } from '../loss.js';
import { customEdgeIdsOf, hasNodeMeta } from '../model/features.js';
import { CONTAINS, type SnapshotEdge, type SnapshotNode, positionalOrders } from '../model/snapshot.js';
import { type SpaceBuilder, createSpaceBuilder, seg } from './shared/builder.js';
import { FAMILY_KEY, PAYLOAD_KEY, coerceString, own, readNodeData, type RecordLayout, writeRecord } from './shared/records.js';
import { LEXICON, inLexicon, isScalar, recordArray } from './shared/shape.js';
import { cardinality, cellOf, columnIndex, familyCell, jsonCell, payloadCells, payloadColumns, readFamily, readPayload, tablePlan } from './shared/table.js';

/** Params of `edge-rows`. */
export const edgeRowsParams = z.object({
  parentKey: z.string().min(1).default('parent'),
  childKey: z.string().min(1).default('child'),
  kindKey: z.string().min(1).default('kind'),
  labelKey: z.string().min(1).default('label'),
  orderKey: z.string().min(1).default('order'),
  /** Edge id (edge rows) and node id (node records) key. */
  idKey: z.string().min(1).default('id'),
  metaKey: z.string().min(1).default('meta'),
  /** Value form: where the node records and the edge rows live. */
  nodesKey: z.string().min(1).default('nodes'),
  edgesKey: z.string().min(1).default('edges'),
  /** `auto`: write an edge id only when it is not the deterministic one; `never` drops custom ids. */
  edgeIds: z.enum(['auto', 'always', 'never']).default('auto'),
  /** `needed`: node rows only for nodes with data or no edge; `all`: every node. */
  nodeRows: z.enum(['needed', 'all']).default('needed'),
  /** Order cells that are all numbers are ranks (sorted numerically) rather than order keys. */
  numericOrder: z.enum(['auto', 'always', 'never']).default('auto'),
});
export type EdgeRowsParams = z.infer<typeof edgeRowsParams>;

const LOSSLESS: GrammarCapabilities = {
  itemsMultiParent: 'native',
  nestedGroups: 'native',
  groupsMultiParent: 'native',
  groupMeta: 'native',
  itemMeta: 'native',
  edgeOrder: 'group-major',
  edgeLabel: 'native',
  edgeMeta: 'native',
  isolatedNodes: 'native',
  edgeKinds: 'native',
  edgeIds: 'native',
  identity: 'id',
};

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** Turn numeric ranks into order keys, per parent, preserving numeric order. */
function applyNumericOrders(builder: SpaceBuilder, ranks: readonly { edgeId: string; parent: string; rank: number }[]): void {
  const byParent = new Map<string, { edgeId: string; rank: number }[]>();
  for (const r of ranks) {
    const list = byParent.get(r.parent);
    if (list) list.push(r);
    else byParent.set(r.parent, [r]);
  }
  for (const list of byParent.values()) {
    const keys = positionalOrders(list.length);
    [...list].sort((a, b) => a.rank - b.rank).forEach((r, i) => builder.setOrder(r.edgeId, keys[i]!));
  }
}

/** Edge-only fields of a row, shared by both forms. */
interface EdgeFields {
  readonly parent: string;
  readonly child: string;
  readonly kind: string;
  readonly id?: string;
  readonly label?: string;
  readonly order?: string | number;
  readonly meta?: Record<string, unknown>;
}

function addEdges(builder: SpaceBuilder, rows: readonly (EdgeFields & { path: string })[], numericOrder: EdgeRowsParams['numericOrder']): void {
  const orders = rows.map((r) => r.order).filter((o) => o !== undefined);
  const numeric = numericOrder === 'always' || (numericOrder === 'auto' && orders.length > 0 && orders.every((o) => typeof o === 'number' || NUMERIC.test(o)));
  const ranks: { edgeId: string; parent: string; rank: number }[] = [];
  for (const r of rows) {
    const keyed = !numeric && r.order !== undefined ? String(r.order) : undefined;
    const edgeId = builder.edge(r.parent, r.child, { id: r.id, kind: r.kind, label: r.label, order: keyed, meta: r.meta }, r.path);
    if (edgeId !== undefined && numeric && r.order !== undefined) ranks.push({ edgeId, parent: r.parent, rank: Number(r.order) });
  }
  applyNumericOrders(builder, ranks);
}

function parseValue(input: unknown, p: EdgeRowsParams): ReturnType<typeof createSpaceBuilder> {
  const builder = createSpaceBuilder();
  let nodeList: unknown[] = [];
  let edgeList: unknown[] | undefined;
  let edgeBase = '';
  if (Array.isArray(input)) edgeList = input;
  else if (isPlainObject(input)) {
    const edges = own(input, p.edgesKey);
    const nodes = own(input, p.nodesKey);
    if (Array.isArray(edges)) edgeList = edges;
    if (Array.isArray(nodes)) nodeList = nodes;
    edgeBase = `/${seg(p.edgesKey)}`;
    for (const [k, v] of Object.entries(input)) if (k !== p.edgesKey && k !== p.nodesKey) builder.leftover(`/${seg(k)}`, v);
    if (edgeList === undefined && !Array.isArray(nodes)) {
      builder.diag({ severity: 'error', code: 'shape', message: `expected '${p.edgesKey}' and/or '${p.nodesKey}' arrays`, path: '' });
      return builder;
    }
  } else {
    builder.diag({ severity: 'error', code: 'shape', message: 'expected { nodes, edges } or a list of edge rows', path: '' });
    builder.leftover('', input);
    return builder;
  }
  const layout: RecordLayout = { idKey: p.idKey, labelKey: p.labelKey, structural: [] };
  nodeList.forEach((record, i) => {
    const path = `/${seg(p.nodesKey)}/${i}`;
    if (isScalar(record)) {
      const id = coerceString(record, 'node id', path, builder)!;
      builder.node(id);
      builder.record(id);
      return;
    }
    const id = isPlainObject(record) ? coerceString(own(record, p.idKey), 'node id', `${path}/${seg(p.idKey)}`, builder) : undefined;
    if (id === undefined || !isPlainObject(record)) {
      builder.diag({ severity: 'error', code: 'missing-id', message: `node record has no '${p.idKey}'; skipped`, path });
      builder.leftover(path, record);
      return;
    }
    builder.node(id, readNodeData(record, layout, path, builder), path);
    builder.record(id);
  });
  const known = new Set([p.parentKey, p.childKey, p.kindKey, p.labelKey, p.orderKey, p.idKey, p.metaKey]);
  const rows: (EdgeFields & { path: string })[] = [];
  (edgeList ?? []).forEach((row, i) => {
    const path = `${edgeBase}/${i}`;
    if (!isPlainObject(row)) {
      builder.diag({ severity: 'warning', code: 'shape', message: 'edge row is not an object; skipped', path });
      builder.leftover(path, row);
      return;
    }
    const parent = coerceString(own(row, p.parentKey), 'parent', `${path}/${seg(p.parentKey)}`, builder);
    const child = coerceString(own(row, p.childKey), 'child', `${path}/${seg(p.childKey)}`, builder);
    if (parent === undefined || child === undefined) {
      builder.diag({ severity: 'error', code: 'missing-id', message: `edge row needs '${p.parentKey}' and '${p.childKey}'; skipped`, path });
      builder.leftover(path, row);
      return;
    }
    const rawOrder = own(row, p.orderKey);
    const rawMeta = own(row, p.metaKey);
    if (rawMeta !== undefined && !isPlainObject(rawMeta)) builder.diag({ severity: 'warning', code: 'ignored-field', message: `'${p.metaKey}' is not an object; ignored`, path });
    const extra = Object.keys(row).filter((k) => !known.has(k));
    if (extra.length) builder.leftover(path, Object.fromEntries(extra.map((k) => [k, own(row, k)])));
    rows.push({
      path,
      parent,
      child,
      kind: coerceString(own(row, p.kindKey), 'kind', path, builder) ?? CONTAINS,
      id: coerceString(own(row, p.idKey), 'edge id', path, builder),
      label: coerceString(own(row, p.labelKey), 'edge label', path, builder),
      order: typeof rawOrder === 'number' ? rawOrder : coerceString(rawOrder, 'order', path, builder),
      meta: isPlainObject(rawMeta) ? rawMeta : undefined,
    });
  });
  addEdges(builder, rows, p.numericOrder);
  return builder;
}

function parseTable(table: Table, p: EdgeRowsParams): ReturnType<typeof createSpaceBuilder> {
  const builder = createSpaceBuilder();
  const col = (name: string): number => columnIndex(table, name);
  const [parent, child] = [col(p.parentKey), col(p.childKey)];
  if (parent < 0 || child < 0) {
    builder.diag({
      severity: 'error',
      code: 'shape',
      message: `expected columns '${p.parentKey}' and '${p.childKey}'; found ${table.columns.map((c) => `'${c}'`).join(', ')}`,
      path: 'row 1',
      hint: 'set the parentKey and childKey params',
    });
    return builder;
  }
  const [kind, label, order, id, meta, family, payload] = [p.kindKey, p.labelKey, p.orderKey, p.idKey, p.metaKey, FAMILY_KEY, PAYLOAD_KEY].map(col) as number[];
  const used = new Set([parent, child, kind, label, order, id, meta, family, payload]);
  const extra = table.columns.map((_, i) => i).filter((i) => !used.has(i));
  const rows: (EdgeFields & { path: string })[] = [];
  table.rows.forEach((row, r) => {
    const path = `row ${r + 2}`;
    const parentId = cellOf(row, parent);
    const childId = cellOf(row, child);
    if (childId === '') {
      builder.diag({ severity: 'error', code: 'missing-id', message: `row has no '${p.childKey}'; skipped`, path });
      builder.leftover(path, row);
      return;
    }
    if (parentId === '') {
      // A node row: the node in `child`, with its label, family and payload.
      builder.record(childId);
      builder.node(
        childId,
        {
          label: cellOf(row, label) || undefined,
          family: readFamily(cellOf(row, family), path, builder),
          payload: readPayload(row, table, payload, extra, path, builder),
        },
        path,
      );
      return;
    }
    const stray = extra.filter((i) => cellOf(row, i) !== '');
    if (stray.length || cellOf(row, payload) !== '' || cellOf(row, family) !== '') {
      builder.diag({ severity: 'info', code: 'ignored-field', message: 'node columns on an edge row are ignored', path, ids: [childId] });
      builder.leftover(path, row);
    }
    const metaText = cellOf(row, meta);
    const metaValue = metaText === '' ? undefined : jsonCell(metaText, 'meta', path, builder);
    rows.push({
      path,
      parent: parentId,
      child: childId,
      kind: cellOf(row, kind) || CONTAINS,
      id: cellOf(row, id) || undefined,
      label: cellOf(row, label) || undefined,
      order: cellOf(row, order) || undefined,
      meta: isPlainObject(metaValue) ? metaValue : undefined,
    });
  });
  addEdges(builder, rows, p.numericOrder);
  return builder;
}

/** Nodes that need a node row or record. */
const nodesToWrite = (nodes: readonly SnapshotNode[], edges: readonly SnapshotEdge[], p: EdgeRowsParams): SnapshotNode[] => {
  if (p.nodeRows === 'all') return [...nodes];
  const touched = new Set(edges.flatMap((e) => [e.parent, e.child]));
  return nodes.filter((n) => hasNodeMeta(n) || !touched.has(n.id));
};

function writeValue(nodes: readonly SnapshotNode[], edges: readonly SnapshotEdge[], p: EdgeRowsParams): unknown {
  const custom = new Set(customEdgeIdsOf(edges));
  const layout: RecordLayout = { idKey: p.idKey, labelKey: p.labelKey, structural: [] };
  const rows = edges.map((e) =>
    Object.fromEntries([
      ...(p.edgeIds === 'always' || custom.has(e.id) ? [[p.idKey, e.id]] : []),
      [p.parentKey, e.parent],
      [p.childKey, e.child],
      [p.kindKey, e.kind],
      ...(e.label !== undefined ? [[p.labelKey, e.label]] : []),
      ...(e.order !== undefined ? [[p.orderKey, e.order]] : []),
      ...(e.meta !== undefined ? [[p.metaKey, e.meta]] : []),
    ]),
  );
  return Object.fromEntries([
    [p.nodesKey, nodesToWrite(nodes, edges, p).map((n) => writeRecord(n, layout))],
    [p.edgesKey, rows],
  ]);
}

function writeTable(nodes: readonly SnapshotNode[], edges: readonly SnapshotEdge[], p: EdgeRowsParams): Table {
  const custom = new Set(customEdgeIdsOf(edges));
  const nodeRows = nodesToWrite(nodes, edges, p);
  const withId = p.edgeIds === 'always' || custom.size > 0;
  const has = (f: (e: SnapshotEdge) => unknown): boolean => edges.some((e) => f(e) !== undefined);
  const hasLabel = has((e) => e.label) || nodeRows.some((n) => n.label !== undefined);
  const hasOrder = has((e) => e.order);
  const hasMeta = has((e) => e.meta);
  const hasFamily = nodeRows.some((n) => n.family !== undefined);
  const base = [
    ...(withId ? [p.idKey] : []),
    p.parentKey,
    p.childKey,
    p.kindKey,
    ...(hasLabel ? [p.labelKey] : []),
    ...(hasOrder ? [p.orderKey] : []),
    ...(hasMeta ? [p.metaKey] : []),
    ...(hasFamily ? [FAMILY_KEY] : []),
  ];
  const payload = payloadColumns(nodeRows, base);
  const columns = [...base, ...payload.columns];
  const blankPayload = payload.columns.map(() => '');
  const nodeLines = nodeRows.map((n) => [
    ...(withId ? [''] : []),
    '',
    n.id,
    '',
    ...(hasLabel ? [n.label ?? ''] : []),
    ...(hasOrder ? [''] : []),
    ...(hasMeta ? [''] : []),
    ...(hasFamily ? [familyCell(n.family)] : []),
    ...payloadCells(n, payload),
  ]);
  const edgeLines = edges.map((e) => [
    ...(withId ? [p.edgeIds === 'always' || custom.has(e.id) ? e.id : ''] : []),
    e.parent,
    e.child,
    e.kind,
    ...(hasLabel ? [e.label ?? ''] : []),
    ...(hasOrder ? [e.order ?? ''] : []),
    ...(hasMeta ? [e.meta === undefined ? '' : JSON.stringify(e.meta)] : []),
    ...(hasFamily ? [''] : []),
    ...blankPayload,
  ]);
  return { columns, rows: [...nodeLines, ...edgeLines] };
}

/** Column-name pairs that name a parent and a child column. */
const COLUMN_PAIRS: readonly [string, string][] = [
  ['parent', 'child'],
  ['group', 'item'],
  ['group', 'member'],
  ['tag', 'item'],
  ['category', 'item'],
  ['collection', 'item'],
  ['folder', 'item'],
  ['parent', 'id'],
  ['parent_id', 'id'],
  ['source', 'target'],
  ['from', 'to'],
];

function detect(input: unknown): Detection<EdgeRowsParams> {
  if (isTable(input)) {
    const lower = input.columns.map((c) => c.toLowerCase());
    for (const [pa, ch] of COLUMN_PAIRS) {
      const [i, j] = [lower.indexOf(pa), lower.indexOf(ch)];
      if (i < 0 || j < 0) continue;
      const known = [pa, ch, 'kind', 'label', 'order', 'id', 'meta', 'family', 'payload'];
      const consumed = lower.filter((c) => known.includes(c)).length / lower.length;
      const pointer = ch === 'id';
      return {
        score: 0.5 * (0.6 + 0.4 * consumed) + 0.3 * 1 + 0.2 * (pointer ? 0.8 : 1),
        evidence: [`columns '${input.columns[i]}' and '${input.columns[j]}' name a ${pointer ? 'parent pointer (a3)' : 'membership'} per row`],
        suggestedParams: { parentKey: input.columns[i]!, childKey: input.columns[j]! },
      };
    }
    if (input.columns.length === 2) {
      // Two unnamed columns: the group side repeats more (lower cardinality).
      const [a, b] = [cardinality(input, 0), cardinality(input, 1)];
      const [parent, child] = a <= b ? [0, 1] : [1, 0];
      const ratio = Math.min(a, b) / Math.max(a, b);
      return {
        score: 0.5 * 0.7 + 0.3 * 0.2 + 0.2 * (1 - ratio),
        evidence: [`two columns; '${input.columns[parent]}' repeats more (cardinality ${Math.min(a, b).toFixed(2)} vs ${Math.max(a, b).toFixed(2)}), read as the group`],
        suggestedParams: { parentKey: input.columns[parent]!, childKey: input.columns[child]! },
      };
    }
    return noDetection();
  }
  const edges = isPlainObject(input) ? own(input, 'edges') : Array.isArray(input) ? input : undefined;
  const found = Array.isArray(edges) ? { array: edges } : recordArray(input);
  if (!found || !found.array.length || !found.array.every(isPlainObject)) return noDetection();
  const rows = found.array as Record<string, unknown>[];
  for (const [pa, ch] of COLUMN_PAIRS) {
    if (pa === 'source' || ch === 'id') continue;
    const share = rows.filter((r) => isScalar(r[pa]) && isScalar(r[ch])).length / rows.length;
    if (share < 0.8) continue;
    const nodes = isPlainObject(input) && Array.isArray(own(input, 'nodes'));
    return {
      score: 0.5 * share + 0.3 * (inLexicon(pa, LEXICON.parent) ? 1 : 0.5) + 0.2 * (nodes ? 1 : 0.6),
      evidence: [`${rows.length} rows with '${pa}' and '${ch}'`, nodes ? 'with a nodes table' : 'no nodes table (isolated nodes cannot appear)'],
      suggestedParams: { parentKey: pa, childKey: ch },
    };
  }
  return noDetection();
}

/** `edge-rows`: one row per membership, plus node rows. Lossless. */
export const edgeRows = defineGrammar<EdgeRowsParams>({
  id: 'edge-rows',
  label: 'Edge rows + nodes',
  description: 'One row per membership (parent, child, kind, label, order) plus node rows: the canonical relation. Lossless.',
  inputs: ['value', 'table'],
  formats: ['json', 'jsonc', 'yaml', 'toml', 'csv', 'tsv'],
  params: edgeRowsParams,
  capabilities: (p) => (p.edgeIds === 'never' ? { ...LOSSLESS, edgeIds: 'no' } : LOSSLESS),
  detect,
  parse: (input, p) => (isTable(input) ? parseTable(input, p) : parseValue(input, p)).build(),
  plan: (space, _p, ctx) => (ctx.kind === 'table' ? tablePlan(space) : { space, losses: [] }),
  write(space, p, ctx) {
    return { output: ctx.kind === 'table' ? writeTable(space.nodes, space.edges, p) : writeValue(space.nodes, space.edges, p) };
  },
});
