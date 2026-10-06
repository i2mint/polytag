/**
 * `featuresOf(space)`: which parts of the model a dataset actually uses, with the ids that
 * use them. The loss report is these features minus a grammar's capabilities
 * (formats-and-grammars §8.2).
 *
 * The node type is unified (zodal-groups D1): a *group* is a node with at least one member
 * through a membership edge kind, an *item* is any other node. So an "empty group" and an
 * "orphan item" are the same thing in the model, an *isolated* node, and are one feature here.
 */

import { CONTAINS, type SnapshotEdge, type SnapshotNode, type SpaceSnapshot, defaultEdgeId, findCycles } from './snapshot.js';

/** Is an edge kind a membership (hierarchical) kind? Default: every kind except `related`. */
export type MembershipTest = (kind: string) => boolean;

/** zodal-groups' default: `related` is the one built-in associative (non-membership) kind. */
export const defaultIsMembership: MembershipTest = (kind) => kind !== 'related';

/** The features a space uses. Every list holds ids (node ids or edge ids, as named). */
export interface SpaceFeatures {
  readonly nodeCount: number;
  readonly edgeCount: number;
  /** Nodes with at least one membership child. */
  readonly groups: readonly string[];
  /** Nodes without membership children (isolated nodes included). */
  readonly items: readonly string[];
  /** Nodes with no edge at all: an orphan item or an empty group, which the model does not tell apart. */
  readonly isolated: readonly string[];
  /** Items in more than one group. */
  readonly multiParentItems: readonly string[];
  /** Groups in more than one group (polyhierarchy). */
  readonly multiParentGroups: readonly string[];
  /** Edge ids: membership edges whose child is a group (nested groups). */
  readonly groupEdges: readonly string[];
  /** Groups with a label, payload or family rule. */
  readonly groupMeta: readonly string[];
  /** Items with a label, payload or family rule. */
  readonly itemMeta: readonly string[];
  /** Edge ids with an `order`. */
  readonly orderedEdges: readonly string[];
  /** Edge ids with a `label`. */
  readonly labelledEdges: readonly string[];
  /** Edge ids with `meta`. */
  readonly edgeMeta: readonly string[];
  /** Edge ids whose kind is not `contains`. */
  readonly otherKinds: readonly string[];
  /** Edge ids a deterministic id (`defaultEdgeId`) would not reproduce. */
  readonly customEdgeIds: readonly string[];
  /** Cycles among membership edges (each a node path, first node repeated last). */
  readonly cycles: readonly (readonly string[])[];
}

/** Options of {@link featuresOf}. */
export interface FeaturesOptions {
  readonly isMembership?: MembershipTest;
}

/** Does a node carry anything besides its id? */
export const hasNodeMeta = (n: SnapshotNode): boolean => n.label !== undefined || n.payload !== undefined || n.family !== undefined;

/** The nodes that are groups: parents of membership edges. */
export function groupIds(edges: readonly SnapshotEdge[], isMembership: MembershipTest = defaultIsMembership): Set<string> {
  return new Set(edges.filter((e) => isMembership(e.kind)).map((e) => e.parent));
}

/** Ids of edges whose id differs from the deterministic one, counting parallel edges in order. */
export function customEdgeIdsOf(edges: readonly SnapshotEdge[]): string[] {
  const seen = new Map<string, number>();
  return edges
    .filter((e) => {
      const key = defaultEdgeId(e.parent, e.child, e.kind);
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      return e.id !== defaultEdgeId(e.parent, e.child, e.kind, n);
    })
    .map((e) => e.id);
}

/** The features a space uses, each with the ids that use it. */
export function featuresOf(space: SpaceSnapshot, { isMembership = defaultIsMembership }: FeaturesOptions = {}): SpaceFeatures {
  const membership = space.edges.filter((e) => isMembership(e.kind));
  const groups = groupIds(membership, () => true);
  const touched = new Set(space.edges.flatMap((e) => [e.parent, e.child]));
  const parents = new Map<string, Set<string>>();
  for (const e of membership) {
    const set = parents.get(e.child);
    if (set) set.add(e.parent);
    else parents.set(e.child, new Set([e.parent]));
  }
  const multiParent = (id: string): boolean => (parents.get(id)?.size ?? 0) > 1;
  const nodeIds = space.nodes.map((n) => n.id);
  const items = nodeIds.filter((id) => !groups.has(id));
  return {
    nodeCount: space.nodes.length,
    edgeCount: space.edges.length,
    groups: nodeIds.filter((id) => groups.has(id)),
    items,
    isolated: nodeIds.filter((id) => !touched.has(id)),
    multiParentItems: items.filter(multiParent),
    multiParentGroups: nodeIds.filter((id) => groups.has(id) && multiParent(id)),
    groupEdges: membership.filter((e) => groups.has(e.child)).map((e) => e.id),
    groupMeta: space.nodes.filter((n) => groups.has(n.id) && hasNodeMeta(n)).map((n) => n.id),
    itemMeta: space.nodes.filter((n) => !groups.has(n.id) && hasNodeMeta(n)).map((n) => n.id),
    orderedEdges: space.edges.filter((e) => e.order !== undefined).map((e) => e.id),
    labelledEdges: space.edges.filter((e) => e.label !== undefined).map((e) => e.id),
    edgeMeta: space.edges.filter((e) => e.meta !== undefined).map((e) => e.id),
    otherKinds: space.edges.filter((e) => e.kind !== CONTAINS).map((e) => e.id),
    customEdgeIds: customEdgeIdsOf(space.edges),
    cycles: findCycles(membership),
  };
}
