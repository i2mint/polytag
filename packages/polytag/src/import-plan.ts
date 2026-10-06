/**
 * Import as a dry run, then a write (ADR 0001 §Revision 1; zodal's `importDuplicate`
 * affordance; holdall research §4.2).
 *
 * `planImport(existing, incoming)` decides, per node id and per edge id, one action:
 * `create` (new id), `skip` (identical content, by content hash), `update` or `conflict`
 * (same id, different content: the `onConflict` policy decides; `ask`, the default, leaves it
 * a conflict). The plan is plain data a UI can preview. `applyImport(existing, plan)` writes
 * it only when every conflict is resolved, and returns the new snapshot plus the same change
 * as a zodal-groups `EdgeDelta` (structurally), so a store can apply it with `applyDelta`
 * and undo it with `invert`. Import is additive: nothing the incoming data lacks is deleted.
 */

import { type SnapshotEdge, type SnapshotNode, type SpaceSnapshot, contentHash, nodeContent } from './model/snapshot.js';

/** What happens to one id. */
export type ImportAction = 'create' | 'update' | 'skip' | 'conflict';

/** What to do when an id exists with different content. */
export type ConflictPolicy = 'ask' | 'skip' | 'update';

/** One planned action. */
export interface PlanEntry {
  readonly id: string;
  readonly action: ImportAction;
  /** `new`: not in the existing data; `identical`: same content hash; `changed`: same id, different content. */
  readonly reason: 'new' | 'identical' | 'changed';
  readonly incomingHash: string;
  readonly existingHash?: string;
}

/** A dry-run import: per-id actions for nodes and edges, and their counts. */
export interface ImportPlan {
  readonly nodes: readonly PlanEntry[];
  readonly edges: readonly PlanEntry[];
  readonly summary: Readonly<Record<ImportAction, number>>;
  /** The incoming data the plan was made for. */
  readonly incoming: SpaceSnapshot;
}

/** The change as a zodal-groups `EdgeDelta` (structural): edge updates are a remove plus an add. */
export interface ImportDelta {
  readonly addedNodes: readonly SnapshotNode[];
  readonly upsertNodes: readonly SnapshotNode[];
  readonly added: readonly SnapshotEdge[];
  readonly removed: readonly string[];
}

/** The content hash of a node (without its id). */
export const nodeHash = (n: SnapshotNode): string => contentHash(nodeContent(n));

/** The content hash of an edge (without its id). */
export const edgeHash = ({ parent, child, kind, label, order, meta }: SnapshotEdge): string => contentHash({ parent, child, kind, label, order, meta });

function planOf<T extends { id: string }>(existing: readonly T[], incoming: readonly T[], hash: (x: T) => string, onConflict: ConflictPolicy): PlanEntry[] {
  const before = new Map(existing.map((x) => [x.id, hash(x)]));
  const seen = new Set<string>();
  const out: PlanEntry[] = [];
  for (const x of incoming) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    const incomingHash = hash(x);
    const existingHash = before.get(x.id);
    if (existingHash === undefined) out.push({ id: x.id, action: 'create', reason: 'new', incomingHash });
    else if (existingHash === incomingHash) out.push({ id: x.id, action: 'skip', reason: 'identical', incomingHash, existingHash });
    else out.push({ id: x.id, action: onConflict === 'ask' ? 'conflict' : onConflict, reason: 'changed', incomingHash, existingHash });
  }
  return out;
}

/** Plan importing `incoming` into `existing`. Pure; nothing is written. */
export function planImport(existing: SpaceSnapshot, incoming: SpaceSnapshot, { onConflict = 'ask' }: { onConflict?: ConflictPolicy } = {}): ImportPlan {
  const nodes = planOf(existing.nodes, incoming.nodes, nodeHash, onConflict);
  const edges = planOf(existing.edges, incoming.edges, edgeHash, onConflict);
  const summary = { create: 0, update: 0, skip: 0, conflict: 0 };
  for (const e of [...nodes, ...edges]) summary[e.action] += 1;
  return { nodes, edges, summary, incoming };
}

/** How to settle the plan's conflicts: one policy for all, or per id (nodes and edges share the map). */
export type ConflictResolution = 'skip' | 'update' | Readonly<Record<string, 'skip' | 'update'>>;

/** The outcome of {@link applyImport}. */
export type ApplyResult =
  | { readonly ok: true; readonly space: SpaceSnapshot; readonly delta: ImportDelta }
  | { readonly ok: false; readonly conflicts: readonly PlanEntry[] };

/**
 * Apply an accepted plan to `existing`. Refuses (returns the unresolved conflicts) unless
 * every conflict is resolved by `resolve`. Existing nodes and edges keep their positions;
 * created ones are appended in incoming order.
 */
export function applyImport(existing: SpaceSnapshot, plan: ImportPlan, { resolve }: { resolve?: ConflictResolution } = {}): ApplyResult {
  const decide = (e: PlanEntry): ImportAction | undefined => {
    if (e.action !== 'conflict') return e.action;
    const choice = typeof resolve === 'string' ? resolve : resolve?.[e.id];
    return choice;
  };
  const unresolved = [...plan.nodes, ...plan.edges].filter((e) => decide(e) === undefined);
  if (unresolved.length) return { ok: false, conflicts: unresolved };

  const act = (entries: readonly PlanEntry[]): Map<string, ImportAction> => new Map(entries.map((e) => [e.id, decide(e)!]));
  const nodeActs = act(plan.nodes);
  const edgeActs = act(plan.edges);
  const incomingNodes = new Map(plan.incoming.nodes.map((n) => [n.id, n]));
  const incomingEdges = new Map(plan.incoming.edges.map((e) => [e.id, e]));

  const updatedNodes = existing.nodes.map((n) => (nodeActs.get(n.id) === 'update' ? incomingNodes.get(n.id)! : n));
  const createdNodes = plan.nodes.filter((e) => nodeActs.get(e.id) === 'create').map((e) => incomingNodes.get(e.id)!);
  const updatedEdges = existing.edges.map((e) => (edgeActs.get(e.id) === 'update' ? incomingEdges.get(e.id)! : e));
  const createdEdges = plan.edges.filter((e) => edgeActs.get(e.id) === 'create').map((e) => incomingEdges.get(e.id)!);
  const updatedEdgeIds = plan.edges.filter((e) => edgeActs.get(e.id) === 'update').map((e) => e.id);

  return {
    ok: true,
    space: { nodes: [...updatedNodes, ...createdNodes], edges: [...updatedEdges, ...createdEdges] },
    delta: {
      addedNodes: createdNodes,
      upsertNodes: plan.nodes.filter((e) => nodeActs.get(e.id) === 'update').map((e) => incomingNodes.get(e.id)!),
      added: [...updatedEdgeIds.map((id) => incomingEdges.get(id)!), ...createdEdges],
      removed: updatedEdgeIds,
    },
  };
}
