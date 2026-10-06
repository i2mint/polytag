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
import { type Detection, defineGrammar, noDetection, type SerialiseContext } from '../grammar.js';
import { type GrammarCapabilities, loss } from '../loss.js';
import { hasNodeMeta } from '../model/features.js';
import { CONTAINS, type SnapshotEdge, type SnapshotNode, type SpaceSnapshot, compareOrder, positionalOrders } from '../model/snapshot.js';
import { createSpaceBuilder, seg } from './shared/builder.js';
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
  /**
   * Most entries a copying write (`shared` outside YAML, `duplicate`) may produce: copies of a
   * shared subtree multiply (a diamond of 20 levels is a million entries). Past it, repeats
   * are written as `ref`s, and the loss report says so.
   */
  maxEntries: z.number().int().positive().default(50_000),
  /**
   * Deepest nesting written. A member deeper than this is written as a `ref` and started as
   * its own root entry (parsers and stringifiers recurse; JSON.stringify overflows near a few
   * thousand levels). Reads back exactly; reported as an `encode`.
   */
  maxDepth: z.number().int().min(1).default(500),
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

/** Does writing `space` with copies produce more than `p.maxEntries` entries? Counts by walking, and stops at the budget. */
function copiesExceed(space: SpaceSnapshot, p: NestedParams): number | undefined {
  const edges = space.edges.filter((e) => e.kind === CONTAINS);
  const out = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const e of edges) {
    out.set(e.parent, [...(out.get(e.parent) ?? []), e.child]);
    hasParent.add(e.child);
  }
  let count = 0;
  const visited = new Set<string>();
  const starts = [...space.nodes.filter((n) => !hasParent.has(n.id)).map((n) => n.id), ...space.nodes.map((n) => n.id)];
  for (const start of starts) {
    if (visited.has(start)) continue;
    const frames: { id: string; kids: string[]; i: number }[] = [{ id: start, kids: out.get(start) ?? [], i: 0 }];
    const onPath = new Set([start]);
    count += 1;
    visited.add(start);
    while (frames.length) {
      if (count > p.maxEntries) return count;
      const f = frames[frames.length - 1]!;
      if (f.i >= f.kids.length) {
        onPath.delete(f.id);
        frames.pop();
        continue;
      }
      const child = f.kids[f.i++]!;
      count += 1;
      visited.add(child);
      if (onPath.has(child) || !out.has(child)) continue;
      onPath.add(child);
      frames.push({ id: child, kids: out.get(child)!, i: 0 });
    }
  }
  return undefined;
}

/** How a node in several groups is actually written: copies past the budget become refs. */
function effectiveMode(p: NestedParams, format: string | undefined, space: SpaceSnapshot | undefined): { mode: NestedParams['multiParent']; note?: string } {
  const copies = p.multiParent === 'duplicate' || (p.multiParent === 'shared' && format !== 'yaml');
  if (!copies || !space) return { mode: p.multiParent };
  const n = copiesExceed(space, p);
  return n === undefined ? { mode: p.multiParent } : { mode: 'ref', note: `as { ${p.refKey} } entries: copies would exceed maxEntries ${p.maxEntries}` };
}

function capabilities(p: NestedParams, format?: string, space?: SpaceSnapshot): GrammarCapabilities {
  const caps: GrammarCapabilities = { ...BASE, edgeOrder: p.order ? 'group-major' : 'no' };
  const { mode, note } = effectiveMode(p, format, space);
  if (mode === 'shared' && format === 'yaml') return { ...caps, itemsMultiParent: 'native', groupsMultiParent: 'native' };
  if (mode === 'ref') return note ? { ...caps, conventionNote: { itemsMultiParent: note, groupsMultiParent: note } } : caps;
  return { ...caps, conventionSeverity: { itemsMultiParent: 'degrade', groupsMultiParent: 'degrade' } };
}

/** Every object in a tree of entries, through arrays under any key (cycle-safe). */
function objectsIn(entries: readonly unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<object>();
  const stack: unknown[] = [entries];
  while (stack.length) {
    const v = stack.pop();
    if (Array.isArray(v)) for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]);
    else if (isPlainObject(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v);
      for (const x of Object.values(v)) if (Array.isArray(x)) stack.push(x);
    }
  }
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
  const ambiguity = inLexicon(childrenKey, LEXICON.children) || nestsObjects ? [] : [`'${childrenKey}' is not a children-like field name and holds no nested entries: are its values members or payload?`];
  return { score: 0.5 * structural + 0.3 * name + 0.2 * (anchors ? 1 : withId), evidence, suggestedParams: suggested, ambiguity };
}

/**
 * Lay out a (planned) space as a tree of entries. Iterative post-order build, so a deep
 * hierarchy does not overflow the stack; past `maxDepth` a member is written as a ref and
 * started as its own root. Returns the root entries and the edges written that way.
 */
function layout(space: SpaceSnapshot, p: NestedParams, ctx: SerialiseContext): { roots: unknown[]; deferred: string[] } {
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
    const { mode } = effectiveMode(p, ctx.format, space);
    const ref = (id: string): unknown => Object.fromEntries([[p.refKey, id]]);
    const onPath = new Set<string>();

    /** A value that needs no expansion, or `undefined` when the node must be expanded. */
    const immediate = (id: string): unknown => {
      reached.add(id);
      const node: SnapshotNode = nodes.get(id) ?? { id };
      if (!out.has(id) && !hasNodeMeta(node)) return id;
      if (onPath.has(id)) return ref(id);
      if (rendered.has(id)) {
        if (mode === 'shared') return rendered.get(id);
        if (mode === 'ref') return ref(id);
      }
      return undefined;
    };
    type Frame = { id: string; kids: SnapshotEdge[]; i: number; values: unknown[] };
    const open = (id: string): Frame => {
      onPath.add(id);
      return { id, kids: childrenOf(id), i: 0, values: [] };
    };
    const close = (f: Frame): unknown => {
      onPath.delete(f.id);
      const node: SnapshotNode = nodes.get(f.id) ?? { id: f.id };
      const record = writeRecord(node, layout, f.kids.length ? [[p.childrenKey, f.values]] : []);
      if (!rendered.has(f.id)) rendered.set(f.id, record);
      return record;
    };
    // Iterative post-order build: a deep hierarchy does not overflow the stack.
    const render = (root: string): unknown => {
      const now = immediate(root);
      if (now !== undefined) return now;
      const frames: Frame[] = [open(root)];
      for (;;) {
        const f = frames[frames.length - 1]!;
        if (f.i < f.kids.length) {
          const edge = f.kids[f.i++]!;
          const v = immediate(edge.child);
          if (v !== undefined) f.values.push(v);
          else if (frames.length >= p.maxDepth) {
            // Too deep to nest: a ref here, and the member starts its own root entry.
            f.values.push(ref(edge.child));
            deferred.push(edge.id);
            queue.push(edge.child);
          } else frames.push(open(edge.child));
          continue;
        }
        const value = close(frames.pop()!);
        if (!frames.length) return value;
        frames[frames.length - 1]!.values.push(value);
      }
    };

    const deferred: string[] = [];
    const queue: string[] = [];
    const roots: unknown[] = space.nodes.filter((n) => !hasParent.has(n.id)).map((n) => render(n.id));
    const drain = (): void => {
      while (queue.length) {
        const id = queue.shift()!;
        if (!rendered.has(id)) roots.push(render(id));
      }
    };
    drain();
    // Nodes only reachable through a cycle: start one where the cycle is entered.
    for (const n of space.nodes) {
      if (!reached.has(n.id)) roots.push(render(n.id));
      drain();
    }
    return { roots, deferred };
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
      base = found.key !== undefined ? `/${seg(found.key)}` : '';
      for (const [k, v] of found.rest) builder.leftover(`/${seg(k)}`, v);
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

    /** One entry: handle it, and return a frame when its children must be visited. */
    type Frame = { entry: Record<string, unknown>; id: string; children: unknown[]; path: string; i: number };
    const visit = (entry: unknown, path: string, parent?: { id: string; owner: object }): Frame | undefined => {
      if (entry === null || entry === undefined) {
        builder.diag({ severity: 'info', code: 'empty-token', message: 'an empty entry was skipped', path });
        return undefined;
      }
      if (isScalar(entry) || entry instanceof Date) {
        const id = coerceString(entry, 'id', path, builder)!;
        defined.add(id);
        builder.node(id);
        if (parent) link(parent.id, id, parent.owner, path);
        return undefined;
      }
      if (!isPlainObject(entry)) {
        builder.diag({ severity: 'warning', code: 'shape', message: 'not an entry (an id or an object); skipped', path });
        builder.leftover(path, entry);
        return undefined;
      }
      const seenId = visited.get(entry);
      if (seenId !== undefined) {
        // A shared object (YAML alias): one node; on the stack, a cycle.
        if (parent) link(parent.id, seenId, parent.owner, path);
        return undefined;
      }
      if (hasOwn(entry, p.refKey) && !hasOwn(entry, p.idKey)) {
        const id = coerceString(own(entry, p.refKey), 'reference', `${path}/${seg(p.refKey)}`, builder);
        if (id === undefined) {
          builder.diag({ severity: 'warning', code: 'shape', message: `'${p.refKey}' is not an id; skipped`, path });
          return undefined;
        }
        refs.push({ id, path });
        if (parent) link(parent.id, id, parent.owner, path);
        else builder.node(id);
        return undefined;
      }
      const id = coerceString(own(entry, p.idKey), 'id', `${path}/${seg(p.idKey)}`, builder);
      if (id === undefined) {
        builder.diag({ severity: 'error', code: 'missing-id', message: `entry has no '${p.idKey}'; skipped with its children`, path, hint: 'set the idKey param' });
        builder.leftover(path, entry);
        return undefined;
      }
      visited.set(entry, id);
      defined.add(id);
      builder.node(id, readNodeData(entry, layout, path, builder), path);
      if (parent) link(parent.id, id, parent.owner, path);
      const children = own(entry, p.childrenKey);
      if (children === undefined) return undefined;
      if (!Array.isArray(children)) {
        builder.diag({ severity: 'warning', code: 'ignored-field', message: `'${p.childrenKey}' is not a list; ignored`, path, ids: [id] });
        return undefined;
      }
      return { entry, id, children, path: `${path}/${seg(p.childrenKey)}`, i: 0 };
    };
    // Iterative depth-first walk: a deep tree does not overflow the stack.
    entries.forEach((e, i) => {
      const first = visit(e, `${base}/${i}`);
      if (!first) return;
      const frames: Frame[] = [first];
      onStack.add(first.entry);
      while (frames.length) {
        const f = frames[frames.length - 1]!;
        if (f.i >= f.children.length) {
          onStack.delete(f.entry);
          frames.pop();
          continue;
        }
        const index = f.i++;
        const next = visit(f.children[index], `${f.path}/${index}`, { id: f.id, owner: f.entry });
        if (next) {
          onStack.add(next.entry);
          frames.push(next);
        }
      }
    });

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

  plan(space, p, ctx) {
    const { deferred } = layout(space, p, ctx);
    return {
      space,
      losses: [loss('group-edges', 'encode', deferred, `${deferred.length} membership(s) deeper than maxDepth ${p.maxDepth} are written as { ${p.refKey} } entries, their member starting a new root entry`)],
    };
  },

  write(space, p, ctx) {
    const { roots } = layout(space, p, ctx);
    return { output: ctx.rootArray === false ? Object.fromEntries([[p.rootKey, roots]]) : roots };
  },
});
