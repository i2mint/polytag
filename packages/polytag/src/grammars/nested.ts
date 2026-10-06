/**
 * `nested` (a1 / a2): folders as nested objects.
 *
 * ```json
 * [{ "id": "food", "children": [{ "id": "italian", "children": ["carbonara", "margherita"] }, "ramen"] }, "notes"]
 * ```
 *
 * An entry is a bare id (a leaf with no data), `{ id, label?, family?, ...payload, children? }`,
 * or a reference `{ ref: id }`. Array position is the rank within the parent (group-major
 * order, D4). A node in several groups is written per `multiParent` (formats-and-grammars
 * §3(a)):
 * - `shared` (default): the same JS object each time. JSON prints copies (a1, a degrade);
 *   YAML prints an anchor and aliases (a2, native: the polyhierarchy-in-a-human-format case).
 * - `duplicate`: fresh copies everywhere, even in YAML.
 * - `ref`: the first occurrence in full, later ones as `{ ref: id }` (an encode).
 * A membership that closes a cycle is always written as a `ref`, never as a circular object.
 *
 * Reading: a shared object (a YAML alias) is visited once; a copy with the same id adds no
 * edges its first occurrence already gave, and a copy whose children differ adds the new
 * ones with a `conflicting-duplicate` warning; a cycle through an alias is detected on the
 * stack, kept as an edge and reported.
 */

import { z } from 'zod';
import { isPlainObject } from '../formats/index.js';
import { type Detection, defineGrammar, noDetection } from '../grammar.js';
import type { GrammarCapabilities } from '../loss.js';
import { hasNodeMeta } from '../model/features.js';
import { type SnapshotEdge, type SnapshotNode, compareOrder, positionalOrders } from '../model/snapshot.js';
import { createSpaceBuilder } from './shared/builder.js';
import { coerceString, hasOwn, own, readNodeData, type RecordLayout, writeRecord } from './shared/records.js';
import { LEXICON, inLexicon, isScalar, recordArray } from './shared/shape.js';

/** Params of `nested`. */
export const nestedParams = z.object({
  idKey: z.string().min(1).default('id'),
  childrenKey: z.string().min(1).default('children'),
  labelKey: z.string().min(1).default('label'),
  /** Key of a reference entry `{ ref: id }`. */
  refKey: z.string().min(1).default('ref'),
  /** How a node in several groups is written (see the module docs). */
  multiParent: z.enum(['shared', 'duplicate', 'ref']).default('shared'),
  /** Key the tree is written under when the format cannot hold a top-level array (TOML). */
  rootKey: z.string().min(1).default('tree'),
  /** Read array position as the rank within the parent. */
  order: z.boolean().default(true),
});
export type NestedParams = z.infer<typeof nestedParams>;

const BASE: GrammarCapabilities = {
  itemsMultiParent: 'convention',
  nestedGroups: 'native',
  groupsMultiParent: 'convention',
  groupMeta: 'native',
  itemMeta: 'native',
  edgeOrder: 'group-major',
  edgeLabel: 'no',
  edgeMeta: 'no',
  isolatedNodes: 'native',
  edgeKinds: 'single',
  edgeIds: 'no',
  identity: 'id',
};

function capabilities(p: NestedParams, format?: string): GrammarCapabilities {
  const caps: GrammarCapabilities = { ...BASE, edgeOrder: p.order ? 'group-major' : 'no' };
  if (p.multiParent === 'shared' && format === 'yaml') return { ...caps, itemsMultiParent: 'native', groupsMultiParent: 'native' };
  if (p.multiParent === 'ref') return caps;
  return { ...caps, conventionSeverity: { itemsMultiParent: 'degrade', groupsMultiParent: 'degrade' } };
}

/** Every object in a tree of entries, through arrays under any key (cycle-safe). */
function objectsIn(entries: readonly unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<object>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isPlainObject(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v);
      for (const x of Object.values(v)) if (Array.isArray(x)) walk(x);
    }
  };
  walk(entries);
  return out;
}

function detect(input: unknown, ctx: { text?: string }): Detection<NestedParams> {
  const found = isPlainObject(input) && !recordArray(input) ? { array: [input], rest: [] as [string, unknown][] } : recordArray(input);
  if (!found || !found.array.length || !found.array.every((e) => isScalar(e) || isPlainObject(e))) return noDetection();
  const objects = objectsIn(found.array);
  if (!objects.length) return noDetection();
  // The children key: an array-valued key whose arrays hold entries (objects or scalars).
  const counts = new Map<string, number>();
  for (const o of objects) {
    for (const [k, v] of Object.entries(o)) {
      if (Array.isArray(v) && v.every((x) => isScalar(x) || isPlainObject(x))) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const ranked = [...counts].sort((a, b) => Number(inLexicon(b[0], LEXICON.children)) - Number(inLexicon(a[0], LEXICON.children)) || b[1] - a[1]);
  const childrenKey = ranked[0]?.[0];
  if (!childrenKey) return noDetection();
  const nestsObjects = objects.some((o) => (o[childrenKey] as unknown[] | undefined)?.some(isPlainObject));
  const idKey = LEXICON.id.find((k) => objects.filter((o) => isScalar(o[k])).length >= objects.length * 0.8) ?? 'id';
  const withId = objects.filter((o) => isScalar(o[idKey]) || (Object.keys(o).length === 1 && hasOwn(o, 'ref'))).length / objects.length;
  const anchors = /(^|[\s[,{])&[\w-]+/m.test(ctx.text ?? '') && /(^|[\s[,{])\*[\w-]+/m.test(ctx.text ?? '');
  const name = inLexicon(childrenKey, LEXICON.children) ? 1 : 0.3;
  const structural = withId * (nestsObjects ? 1 : 0.7);
  const evidence = [
    `${objects.length} entries; '${childrenKey}' holds nested entries${nestsObjects ? ' (more than one level)' : ''}`,
    `${Math.round(withId * 100)}% of objects have an '${idKey}'`,
    ...(anchors ? ['YAML anchors and aliases: polyhierarchy by reference (a2)'] : []),
  ];
  const suggested: Partial<NestedParams> = { idKey, childrenKey, ...(found.key ? { rootKey: found.key } : {}) };
  return { score: 0.5 * structural + 0.3 * name + 0.2 * (anchors ? 1 : withId), evidence, suggestedParams: suggested };
}

/** `nested`: a tree of entries with children arrays. */
export const nested = defineGrammar<NestedParams>({
  id: 'nested',
  label: 'Nested tree',
  description: 'Folders as nested objects with children arrays; array position is the order. Several parents: copies (JSON), anchors (YAML) or refs.',
  inputs: ['value'],
  formats: ['json', 'jsonc', 'yaml', 'toml'],
  params: nestedParams,
  capabilities,
  detect,

  parse(input, p) {
    const builder = createSpaceBuilder();
    const layout: RecordLayout = { idKey: p.idKey, labelKey: p.labelKey, structural: [p.childrenKey, p.refKey] };
    let entries: readonly unknown[];
    let base = '';
    const single = isPlainObject(input) && (hasOwn(input, p.idKey) || hasOwn(input, p.childrenKey));
    const found = single ? undefined : recordArray(input, p.rootKey);
    if (single) entries = [input];
    else if (found) {
      entries = found.array;
      base = found.key !== undefined ? `/${found.key}` : '';
      for (const [k, v] of found.rest) builder.leftover(`/${k}`, v);
    } else {
      builder.diag({ severity: 'error', code: 'shape', message: 'expected a list of entries (ids or objects with children)', path: '' });
      builder.leftover('', input);
      return builder.build();
    }

    const visited = new Map<object, string>();
    const onStack = new Set<object>();
    const primary = new Map<string, { owner: object; children: Set<string> }>();
    const reportedCopies = new Set<string>();
    const childLists = new Map<string, string[]>();
    const defined = new Set<string>();
    const refs: { id: string; path: string }[] = [];

    const link = (parent: string, child: string, owner: object, path: string): void => {
      let p0 = primary.get(parent);
      if (!p0) primary.set(parent, (p0 = { owner, children: new Set() }));
      if (p0.owner !== owner) {
        // A copy of `parent`: only memberships its first occurrence did not give.
        if (p0.children.has(child)) return;
        if (!reportedCopies.has(parent)) {
          reportedCopies.add(parent);
          builder.diag({ severity: 'warning', code: 'conflicting-duplicate', message: `copies of '${parent}' list different members; their union is kept`, path, ids: [parent] });
        }
      }
      p0.children.add(child);
      const id = builder.edge(parent, child, {}, path);
      if (id === undefined) return;
      const list = childLists.get(parent);
      if (list) list.push(id);
      else childLists.set(parent, [id]);
    };

    const visit = (entry: unknown, path: string, parent?: { id: string; owner: object }): void => {
      if (entry === null || entry === undefined) {
        builder.diag({ severity: 'info', code: 'empty-token', message: 'an empty entry was skipped', path });
        return;
      }
      if (isScalar(entry)) {
        const id = coerceString(entry, 'id', path, builder)!;
        defined.add(id);
        builder.node(id);
        if (parent) link(parent.id, id, parent.owner, path);
        return;
      }
      if (!isPlainObject(entry)) {
        builder.diag({ severity: 'warning', code: 'shape', message: 'not an entry (an id or an object); skipped', path });
        builder.leftover(path, entry);
        return;
      }
      const seenId = visited.get(entry);
      if (seenId !== undefined) {
        // A shared object (YAML alias): one node; on the stack, a cycle.
        if (parent) link(parent.id, seenId, parent.owner, path);
        return;
      }
      if (hasOwn(entry, p.refKey) && !hasOwn(entry, p.idKey)) {
        const id = coerceString(own(entry, p.refKey), 'reference', `${path}/${p.refKey}`, builder);
        if (id === undefined) {
          builder.diag({ severity: 'warning', code: 'shape', message: `'${p.refKey}' is not an id; skipped`, path });
          return;
        }
        refs.push({ id, path });
        if (parent) link(parent.id, id, parent.owner, path);
        else builder.node(id);
        return;
      }
      const id = coerceString(own(entry, p.idKey), 'id', `${path}/${p.idKey}`, builder);
      if (id === undefined) {
        builder.diag({ severity: 'error', code: 'missing-id', message: `entry has no '${p.idKey}'; skipped with its children`, path, hint: 'set the idKey param' });
        builder.leftover(path, entry);
        return;
      }
      visited.set(entry, id);
      defined.add(id);
      builder.node(id, readNodeData(entry, layout, path, builder), path);
      if (parent) link(parent.id, id, parent.owner, path);
      const children = own(entry, p.childrenKey);
      if (children === undefined) return;
      if (!Array.isArray(children)) {
        builder.diag({ severity: 'warning', code: 'ignored-field', message: `'${p.childrenKey}' is not a list; ignored`, path, ids: [id] });
        return;
      }
      onStack.add(entry);
      children.forEach((c, i) => visit(c, `${path}/${p.childrenKey}/${i}`, { id, owner: entry }));
      onStack.delete(entry);
    };
    entries.forEach((e, i) => visit(e, `${base}/${i}`));

    for (const { id, path } of refs) {
      if (!defined.has(id)) builder.diag({ severity: 'warning', code: 'unresolved-ref', message: `reference to '${id}', which is never defined; a bare node is created`, path, ids: [id] });
    }
    if (p.order) {
      for (const list of childLists.values()) {
        const keys = positionalOrders(list.length);
        list.forEach((edgeId, i) => builder.setOrder(edgeId, keys[i]!));
      }
    }
    return builder.build();
  },

  write(space, p, ctx) {
    const layout: RecordLayout = { idKey: p.idKey, labelKey: p.labelKey, structural: [p.childrenKey, p.refKey] };
    const nodes = new Map(space.nodes.map((n) => [n.id, n]));
    const out = new Map<string, SnapshotEdge[]>();
    const hasParent = new Set<string>();
    space.edges.forEach((e) => {
      const list = out.get(e.parent);
      if (list) list.push(e);
      else out.set(e.parent, [e]);
      hasParent.add(e.child);
    });
    const childrenOf = (id: string): SnapshotEdge[] =>
      (out.get(id) ?? []).map((e, i) => ({ e, i })).sort((a, b) => compareOrder(a.e.order, b.e.order) || a.i - b.i).map(({ e }) => e);
    const rendered = new Map<string, unknown>();
    const reached = new Set<string>();

    const render = (id: string, stack: ReadonlySet<string>): unknown => {
      reached.add(id);
      const node: SnapshotNode = nodes.get(id) ?? { id };
      const kids = childrenOf(id);
      if (!kids.length && !hasNodeMeta(node)) return id;
      if (stack.has(id)) return Object.fromEntries([[p.refKey, id]]);
      if (rendered.has(id)) {
        if (p.multiParent === 'shared') return rendered.get(id);
        if (p.multiParent === 'ref') return Object.fromEntries([[p.refKey, id]]);
      }
      const inner = new Set(stack).add(id);
      const structural: [string, unknown][] = kids.length ? [[p.childrenKey, kids.map((e) => render(e.child, inner))]] : [];
      const record = writeRecord(node, layout, structural);
      if (!rendered.has(id)) rendered.set(id, record);
      return record;
    };

    const roots: unknown[] = space.nodes.filter((n) => !hasParent.has(n.id)).map((n) => render(n.id, new Set()));
    // Nodes only reachable through a cycle: start one where the cycle is entered.
    for (const n of space.nodes) if (!reached.has(n.id)) roots.push(render(n.id, new Set()));
    return { output: ctx.rootArray === false ? Object.fromEntries([[p.rootKey, roots]]) : roots };
  },
});
