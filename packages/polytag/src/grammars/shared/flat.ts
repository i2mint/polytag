/**
 * The item-major core shared by tags-array, tag-paths, delimited and one-hot: every item
 * lists the groups it is in, optionally as path strings (`food/italian`).
 *
 * Reading paths (formats-and-grammars §3(c)): split on the separator, add `parent → child`
 * edges between consecutive segments (once per distinct pair), and attach the item to the
 * **leaf** only; the closure is read-time (zodal-groups D9). Node identity is the segment,
 * so the same group under two parents is written as two paths (a convention; Obsidian would
 * see two tags). `materialised` mode (Lightroom) also writes every ancestor, so on read a
 * tag that is a prefix of another tag of the same item is implied, not direct.
 */

import type { SpaceBuilder } from './builder.js';
import { type Loss, loss } from '../../loss.js';
import { type SnapshotEdge, type SnapshotNode, type SpaceSnapshot, findCycles } from '../../model/snapshot.js';

/** Path-string settings. */
export interface PathOptions {
  readonly separator: string;
  readonly mode: 'leafOnly' | 'materialised';
}

/** One item to write: the node and its groups' tags, in edge order. */
export interface FlatRecord {
  readonly node: SnapshotNode;
  readonly tags: readonly string[];
}

/** What {@link flatRecords} returns. */
export interface FlatLayout {
  /** Nodes that are not groups (items and isolated nodes), in node order. */
  readonly records: readonly FlatRecord[];
  /** Groups (parents of an edge), in node order. */
  readonly groups: readonly string[];
  /** Extra losses only the writer sees (cycles not expressible as paths, implied memberships, ids that split). */
  readonly losses: readonly Loss[];
}

/**
 * Lay out a reduced space item-major. Without `paths`, an item's tags are its parents' ids;
 * with `paths`, each parent becomes every root path to it (cycle-safe, at most `maxPaths`).
 */
export function flatRecords(space: SpaceSnapshot, paths?: PathOptions, { maxPaths = 256 } = {}): FlatLayout {
  const groupSet = new Set(space.edges.map((e) => e.parent));
  const incoming = new Map<string, SnapshotEdge[]>();
  for (const e of space.edges) {
    const list = incoming.get(e.child);
    if (list) list.push(e);
    else incoming.set(e.child, [e]);
  }
  const groups = space.nodes.filter((n) => groupSet.has(n.id)).map((n) => n.id);
  const items = space.nodes.filter((n) => !groupSet.has(n.id));
  if (!paths) {
    return { records: items.map((node) => ({ node, tags: (incoming.get(node.id) ?? []).map((e) => e.parent) })), groups, losses: [] };
  }

  // Root paths of a group, through group → group edges only.
  const groupParents = (g: string): string[] => [...new Set((incoming.get(g) ?? []).map((e) => e.parent))];
  const acyclic = findCycles(space.edges.filter((e) => groupSet.has(e.child))).length === 0;
  const memo = new Map<string, string[][]>();
  const pathsTo = (g: string, chain: ReadonlySet<string>): string[][] => {
    if (acyclic && memo.has(g)) return memo.get(g)!;
    const parents = groupParents(g).filter((p) => !chain.has(p));
    const next = new Set(chain).add(g);
    const out: string[][] = parents.length ? [] : [[g]];
    for (const p of parents) {
      for (const path of pathsTo(p, next)) {
        if (out.length >= maxPaths) break;
        out.push([...path, g]);
      }
    }
    if (acyclic) memo.set(g, out);
    return out;
  };

  const { separator, mode } = paths;
  const covered = new Set<string>();
  const implied: string[] = [];
  const records = items.map((node): FlatRecord => {
    const memberships = incoming.get(node.id) ?? [];
    const written: string[][] = [];
    const seen = new Set<string>();
    const add = (path: string[]): void => {
      const key = path.join('\u0000');
      if (!seen.has(key)) {
        seen.add(key);
        written.push(path);
      }
    };
    const parentsSeen = new Set<string>();
    const perEdge = memberships.map((e) => {
      // A parallel edge (the same group twice) has the same paths: written once, read once.
      if (parentsSeen.has(e.parent)) implied.push(e.id);
      parentsSeen.add(e.parent);
      const ps = pathsTo(e.parent, new Set());
      for (const p of ps) {
        if (mode === 'materialised') for (let i = 1; i < p.length; i++) add(p.slice(0, i));
        add(p);
        for (let i = 1; i < p.length; i++) covered.add(`${p[i - 1]}\u0000${p[i]}`);
      }
      return { edge: e, keys: ps.map((p) => p.join('\u0000')) };
    });
    if (mode === 'materialised') {
      const isPrefix = (k: string): boolean => [...seen].some((o) => o !== k && o.startsWith(`${k}\u0000`));
      for (const { edge, keys } of perEdge) if (keys.every(isPrefix) && !implied.includes(edge.id)) implied.push(edge.id);
    }
    return { node, tags: written.map((p) => p.join(separator)) };
  });

  const uncovered = space.edges.filter((e) => groupSet.has(e.child) && !covered.has(`${e.parent}\u0000${e.child}`)).map((e) => e.id);
  const splitting = groups.filter((id) => id.includes(separator) || id === '');
  return {
    records,
    groups,
    losses: [
      loss('group-edges', 'drop', uncovered, `${uncovered.length} group → group edge(s) lie on a cycle or beyond ${maxPaths} paths and cannot be written as paths`),
      loss('membership', 'drop', implied, `${implied.length} membership(s) would not read back: a repeated group, or (materialised) a direct membership in an ancestor of another of the item's groups`),
      loss('identity-collision', 'drop', splitting, `${splitting.length} group id(s) are empty or contain the path separator '${separator}' and would split on read`),
    ],
  };
}

/** Reads item-major memberships into a builder, optionally as path strings. */
export interface FlatReader {
  /** Add the memberships of `item` from its tags (already strings). */
  memberships(item: string, tags: readonly string[], path: string): void;
}

/** A reader over `builder`. */
export function createFlatReader(builder: SpaceBuilder, paths?: PathOptions): FlatReader {
  const groupEdges = new Set<string>();
  const seenRecords = new Map<string, Set<string>>();
  return {
    memberships(item, tags, path) {
      // A repeated record adds only memberships it did not already have.
      const known = seenRecords.get(item);
      const already = new Set(known ?? []);
      const mine = known ?? new Set<string>();
      seenRecords.set(item, mine);
      const attach = (group: string): void => {
        if (already.has(group)) return;
        mine.add(group);
        builder.edge(group, item, {}, path);
      };
      const nonEmpty = tags.filter((t, i) => {
        if (t !== '') return true;
        builder.diag({ severity: 'warning', code: 'empty-token', message: `empty tag skipped`, path: `${path}/${i}`, ids: [item] });
        return false;
      });
      if (!paths) {
        for (const t of nonEmpty) attach(t);
        return;
      }
      let lists = nonEmpty.map((t) => {
        const segments = t.split(paths.separator);
        const kept = segments.filter((s) => s !== '');
        if (kept.length !== segments.length) {
          builder.diag({ severity: 'warning', code: 'empty-token', message: `empty path segment in '${t}' skipped`, path, ids: [item] });
        }
        return kept;
      });
      if (paths.mode === 'materialised') {
        const keys = lists.map((l) => l.join('\u0000'));
        lists = lists.filter((_, i) => !keys.some((k, j) => j !== i && k.startsWith(`${keys[i]}\u0000`)));
      }
      const leaves = new Set<string>();
      for (const segments of lists) {
        if (!segments.length) continue;
        for (let i = 1; i < segments.length; i++) {
          const key = `${segments[i - 1]}\u0000${segments[i]}`;
          if (groupEdges.has(key)) continue;
          groupEdges.add(key);
          builder.edge(segments[i - 1]!, segments[i]!, {}, path);
        }
        const leaf = segments[segments.length - 1]!;
        if (!leaves.has(leaf)) attach(leaf);
        leaves.add(leaf);
      }
    },
  };
}
