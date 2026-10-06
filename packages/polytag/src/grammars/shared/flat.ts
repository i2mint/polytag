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
 *
 * Writing is two steps. {@link flatPlan} decides, before anything is written, what cannot be
 * expressed as tokens or paths (a group id that would split or vanish on read, a parallel
 * membership, a cycle, an implied materialised path) and takes those edges out, reporting
 * each by id; {@link flatRecords} then lays out the planned space, which reads back exactly.
 */

import type { SpaceBuilder } from './builder.js';
import { type Loss, type Reduction, loss } from '../../loss.js';
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
}

/** At most this many root paths are written per group (a diamond-shaped hierarchy multiplies them). */
const MAX_PATHS = 256;

const byChild = (edges: readonly SnapshotEdge[]): Map<string, SnapshotEdge[]> => {
  const incoming = new Map<string, SnapshotEdge[]>();
  for (const e of edges) {
    const list = incoming.get(e.child);
    if (list) list.push(e);
    else incoming.set(e.child, [e]);
  }
  return incoming;
};

/**
 * A root-path finder over the group → group edges of `edges`: every path from a root (a
 * group with no parent, or one where a cycle is entered) down to `g`, at most `maxPaths`.
 * Iterative, so a deep hierarchy does not overflow the stack.
 */
function pathFinder(edges: readonly SnapshotEdge[], maxPaths: number): (g: string) => string[][] {
  const groups = new Set(edges.map((e) => e.parent));
  const groupEdges = edges.filter((e) => groups.has(e.child));
  const parents = new Map<string, string[]>();
  for (const e of groupEdges) {
    const list = parents.get(e.child);
    if (!list) parents.set(e.child, [e.parent]);
    else if (!list.includes(e.parent)) list.push(e.parent);
  }
  const acyclic = findCycles(groupEdges, 1).length === 0;
  const memo = new Map<string, string[][]>();
  return (g) => {
    const cached = memo.get(g);
    if (cached) return cached;
    const out: string[][] = [];
    const stack: string[][] = [[g]];
    while (stack.length && out.length < maxPaths) {
      const suffix = stack.pop()!;
      const ps = (parents.get(suffix[0]!) ?? []).filter((p) => acyclic || !suffix.includes(p));
      if (!ps.length) out.push(suffix);
      for (let i = ps.length - 1; i >= 0; i--) stack.push([ps[i]!, ...suffix]);
    }
    if (acyclic) memo.set(g, out);
    return out;
  };
}

/** What makes a group id writable as a token, besides not being empty. */
export interface FlatPlanOptions {
  readonly paths?: PathOptions;
  /** A group id the grammar cannot write as a token (contains the delimiter, has spaces it trims...). */
  readonly invalidToken?: (id: string) => boolean;
  /** Why such an id cannot be written (for the loss message). */
  readonly tokenRule?: string;
  /** Can the grammar write the same membership twice (a repeated tag)? One-hot cannot: a cell is one boolean. Default `true`. */
  readonly repeats?: boolean;
}

/**
 * Plan an item-major write: take out every edge the tokens or paths cannot carry, and
 * report it. The returned space is what {@link flatRecords} writes and the reader gives back.
 */
export function flatPlan(space: SpaceSnapshot, { paths, invalidToken = () => false, tokenRule = 'cannot be written as a token', repeats = true }: FlatPlanOptions = {}): Reduction {
  const losses: Loss[] = [];
  let edges = [...space.edges];
  const groupsOf = (es: readonly SnapshotEdge[]): Set<string> => new Set(es.map((e) => e.parent));

  // 1. Group ids that would split, vanish or collide on read: their memberships are left out,
  //    and the node itself is written as a record (any id is fine there).
  const bad = [...groupsOf(edges)].filter((g) => g === '' || invalidToken(g) || (paths !== undefined && g.includes(paths.separator)));
  if (bad.length) {
    const badSet = new Set(bad);
    const out = edges.filter((e) => badSet.has(e.parent) || badSet.has(e.child)).map((e) => e.id);
    const rule = paths ? `contain the path separator '${paths.separator}', are empty, or ${tokenRule}` : `are empty or ${tokenRule}`;
    losses.push(loss('identity-collision', 'drop', out, `the group id(s) ${bad.map((b) => JSON.stringify(b)).join(', ')} ${rule}; their ${out.length} membership(s) are left out`));
    const outSet = new Set(out);
    edges = edges.filter((e) => !outSet.has(e.id));
  }
  if (!paths) {
    if (repeats) return { space: { nodes: space.nodes, edges }, losses };
    // A repeated membership (parallel edge) is one cell: written once, read once.
    const seen = new Set<string>();
    const repeated = edges.filter((e) => {
      const key = `${e.parent}\u0000${e.child}`;
      const again = seen.has(key);
      seen.add(key);
      return again;
    }).map((e) => e.id);
    const out = new Set(repeated);
    losses.push(loss('membership', 'drop', repeated, `${repeated.length} repeated membership(s) (parallel edges) are one cell and read back once`));
    return { space: { nodes: space.nodes, edges: edges.filter((e) => !out.has(e.id)) }, losses };
  }

  // 2. Paths: repeat until nothing more is taken out (taking an edge out can change paths).
  const repeated: string[] = [];
  const uncovered: string[] = [];
  const implied: string[] = [];
  for (let round = 0; round < 4; round++) {
    const groups = groupsOf(edges);
    const drop = new Set<string>();
    // 2a. A repeated membership (parallel edge) has the same path: written once, read once.
    const seen = new Set<string>();
    for (const e of edges) {
      const key = `${e.parent}\u0000${e.child}`;
      if (seen.has(key)) drop.add(e.id), repeated.push(e.id);
      seen.add(key);
    }
    // 2b. Group edges no written path covers (a cycle, or past the path cap).
    const pathsTo = pathFinder(edges, MAX_PATHS);
    const covered = new Set<string>();
    const incoming = byChild(edges);
    const items = space.nodes.filter((n) => !groups.has(n.id));
    for (const item of items) {
      const memberships = (incoming.get(item.id) ?? []).filter((e) => !drop.has(e.id));
      const written = new Set<string>();
      const perEdge = memberships.map((e) => {
        const ps = pathsTo(e.parent);
        for (const p of ps) {
          for (let i = 1; i < p.length; i++) covered.add(`${p[i - 1]}\u0000${p[i]}`);
          if (paths.mode === 'materialised') for (let i = 1; i <= p.length; i++) written.add(p.slice(0, i).join('\u0000'));
          else written.add(p.join('\u0000'));
        }
        return { edge: e, keys: ps.map((p) => p.join('\u0000')) };
      });
      // 2c. Materialised: a direct membership in an ancestor reads as implied.
      if (paths.mode === 'materialised') {
        const isPrefix = (k: string): boolean => [...written].some((o) => o !== k && o.startsWith(`${k}\u0000`));
        for (const { edge, keys } of perEdge) if (keys.every(isPrefix)) drop.add(edge.id), implied.push(edge.id);
      }
    }
    for (const e of edges) if (groups.has(e.child) && !drop.has(e.id) && !covered.has(`${e.parent}\u0000${e.child}`)) drop.add(e.id), uncovered.push(e.id);
    if (!drop.size) break;
    edges = edges.filter((e) => !drop.has(e.id));
  }
  losses.push(
    loss('membership', 'drop', repeated, `${repeated.length} repeated membership(s) (parallel edges) have the same path and read back once`),
    loss('group-edges', 'drop', uncovered, `${uncovered.length} group → group edge(s) lie on a cycle or beyond ${MAX_PATHS} paths and cannot be written as paths`),
    loss('membership', 'drop', implied, `${implied.length} direct membership(s) in an ancestor of another of the item's groups would read as implied by the longer materialised path`),
  );
  return { space: { nodes: space.nodes, edges }, losses };
}

/**
 * Lay out a planned space item-major. Without `paths`, an item's tags are its parents' ids;
 * with `paths`, each parent becomes every root path to it.
 */
export function flatRecords(space: SpaceSnapshot, paths?: PathOptions): FlatLayout {
  const groupSet = new Set(space.edges.map((e) => e.parent));
  const incoming = byChild(space.edges);
  const groups = space.nodes.filter((n) => groupSet.has(n.id)).map((n) => n.id);
  const items = space.nodes.filter((n) => !groupSet.has(n.id));
  if (!paths) return { records: items.map((node) => ({ node, tags: (incoming.get(node.id) ?? []).map((e) => e.parent) })), groups };
  const pathsTo = pathFinder(space.edges, MAX_PATHS);
  const records = items.map((node): FlatRecord => {
    const written: string[] = [];
    const seen = new Set<string>();
    const add = (p: readonly string[]): void => {
      const key = p.join('\u0000');
      if (!seen.has(key)) {
        seen.add(key);
        written.push(p.join(paths.separator));
      }
    };
    for (const e of incoming.get(node.id) ?? []) {
      for (const p of pathsTo(e.parent)) {
        if (paths.mode === 'materialised') for (let i = 1; i < p.length; i++) add(p.slice(0, i));
        add(p);
      }
    }
    return { node, tags: written };
  });
  return { records, groups };
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
  const at = (path: string, i: number): string => (path.startsWith('row ') ? path : `${path}/${i}`);
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
        builder.diag({ severity: 'warning', code: 'empty-token', message: 'empty tag skipped', path: at(path, i), ids: [item] });
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
