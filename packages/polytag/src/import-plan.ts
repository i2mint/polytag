/**
 * Import as a dry run, then a write (ADR 0001 §Revision 1; zodal's `importDuplicate`
 * affordance; holdall research §4.2).
 *
 * `planImport(existing, incoming)` decides, per node id and per edge id, one action:
 * `create` (new id), `skip` (nothing the incoming data carries differs), `update` or
 * `conflict` (something differs: the `onConflict` policy decides; `ask`, the default, leaves
 * it a conflict). The plan is plain data a UI can preview; each changed entry names the
 * fields that differ. `applyImport(existing, plan)` writes it only when every conflict is
 * resolved, and returns the new snapshot plus the same change as a zodal-groups `EdgeDelta`
 * (structurally), so a store can apply it with `applyDelta` and undo it with `invert`.
 *
 * What counts as a difference:
 * - **Only what the incoming data carries.** A field it does not have (a members map has no
 *   labels; `capabilities` can say so explicitly) is kept, never cleared. Updates merge.
 * - **Order by rank, among the members both sides have.** A reader's positional keys never
 *   equal an app's fractional keys, and adding a member must not move its siblings; the
 *   existing order is the one a writer lays out (by order, then edge position).
 * - **Exact equality** of a canonical form (`stableStringify`: key order ignored, `NaN` is not
 *   `null`), never a short hash. Hashes are kept for display only.
 *
 * Import is additive: nothing the incoming data lacks is deleted.
 */

import type { Diagnostic } from './grammar.js';
import type { GrammarCapabilities } from './loss.js';
import { orderBetween } from '@zodal/groups-core';
import { type SnapshotEdge, type SnapshotNode, type SpaceSnapshot, compareOrder, contentHash, positionalOrders, stableStringify } from './model/snapshot.js';

/** What happens to one id. */
export type ImportAction = 'create' | 'update' | 'skip' | 'conflict';

/** What to do when an id exists with different content. */
export type ConflictPolicy = 'ask' | 'skip' | 'update';

/** A field that can differ. */
export type ImportField = 'label' | 'payload' | 'family' | 'endpoints' | 'kind' | 'meta' | 'order';

/** One planned action. */
export interface PlanEntry {
  readonly id: string;
  readonly action: ImportAction;
  /** `new`: not in the existing data; `identical`: nothing carried differs; `changed`: something does. */
  readonly reason: 'new' | 'identical' | 'changed';
  /** For `changed`: the fields that differ. */
  readonly changes?: readonly ImportField[];
  /** For an `order` change: the key the edge gets (between its new neighbours, in the existing key space). */
  readonly order?: string;
  /** Short content hashes, for display (equality is decided on the full canonical form). */
  readonly incomingHash: string;
  readonly existingHash?: string;
}

/** A dry-run import: per-id actions for nodes and edges, their counts, and problems found. */
export interface ImportPlan {
  readonly nodes: readonly PlanEntry[];
  readonly edges: readonly PlanEntry[];
  readonly summary: Readonly<Record<ImportAction, number>>;
  /** The incoming data the plan was made for. */
  readonly incoming: SpaceSnapshot;
  /** Duplicate incoming ids with different content (the first is used). */
  readonly diagnostics: readonly Diagnostic[];
  /** Fields the incoming data carries (from `capabilities`, else all). */
  readonly carried: readonly ImportField[];
  /**
   * Existing edges whose order key must be (re)set so a reorder can be expressed (siblings
   * without keys, or ties). Applied only when a move under the same parent is applied.
   */
  readonly rekey: readonly { readonly id: string; readonly parent: string; readonly order: string }[];
}

/** The change as a zodal-groups `EdgeDelta` (structural): edge updates are a remove plus an add. */
export interface ImportDelta {
  readonly addedNodes: readonly SnapshotNode[];
  readonly upsertNodes: readonly SnapshotNode[];
  readonly added: readonly SnapshotEdge[];
  readonly removed: readonly string[];
}

/** The short content hash of a node (without its id), for display. */
export const nodeHash = (n: SnapshotNode): string => contentHash({ label: n.label, payload: n.payload, family: n.family });

/** The short content hash of an edge (without its id), for display. */
export const edgeHash = ({ parent, child, kind, label, order, meta }: SnapshotEdge): string => contentHash({ parent, child, kind, label, order, meta });

/** Options of {@link planImport}. */
export interface PlanOptions {
  readonly onConflict?: ConflictPolicy;
  /** What the source grammar carries (`grammar.capabilitiesFor(params, format)`); fields it does not carry are never compared. */
  readonly capabilities?: GrammarCapabilities;
}

const ALL_FIELDS: readonly ImportField[] = ['label', 'payload', 'family', 'endpoints', 'kind', 'meta', 'order'];

function carriedFields(caps: GrammarCapabilities | undefined): Set<ImportField> {
  if (!caps) return new Set(ALL_FIELDS);
  const out = new Set<ImportField>(['endpoints']);
  if (caps.groupMeta !== 'no' || caps.itemMeta !== 'no') out.add('label').add('payload').add('family');
  if (caps.edgeKinds === 'native') out.add('kind');
  if (caps.edgeMeta !== 'no') out.add('meta');
  if (caps.edgeOrder === 'group-major' || caps.edgeOrder === 'native' || caps.edgeOrder === 'convention') out.add('order');
  if (caps.edgeLabel !== 'no') out.add('label');
  return out;
}

const same = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b);

/** First occurrence of each id, and diagnostics for later ones that differ. */
function uniqueById<T extends { id: string }>(xs: readonly T[], what: string, diagnostics: Diagnostic[]): T[] {
  const first = new Map<string, T>();
  const reported = new Set<string>();
  for (const x of xs) {
    const prior = first.get(x.id);
    if (!prior) first.set(x.id, x);
    else if (!same(prior, x) && !reported.has(x.id)) {
      reported.add(x.id);
      diagnostics.push({ severity: 'warning', code: 'conflicting-duplicate', message: `incoming ${what} '${x.id}' appears more than once with different content; the first is used`, ids: [x.id] });
    }
  }
  return [...first.values()];
}

/** Indexes of a longest strictly increasing subsequence of `xs` (patience sorting). */
function longestIncreasing(xs: readonly number[]): Set<number> {
  const tails: number[] = [];
  const prev: number[] = new Array(xs.length).fill(-1);
  for (let i = 0; i < xs.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[tails[mid]!]! < xs[i]!) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo > 0 ? tails[lo - 1]! : -1;
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i !== -1; i = prev[i]!) keep.add(i);
  return keep;
}

/**
 * Minimal reorders. Per parent, the members both sides have (and the incoming side orders)
 * are compared by rank; the longest run already in the incoming order stays, and only the
 * others move, each next to its neighbour in the incoming order. Unmentioned siblings keep
 * their place. A moved edge gets a key between its new neighbours; when the existing keys
 * cannot express that (siblings without keys, ties), the whole parent is re-keyed and the
 * other edges are listed in `rekey`.
 */
function planReorders(existing: readonly SnapshotEdge[], incoming: readonly SnapshotEdge[]): { moved: Map<string, string>; rekey: ImportPlan['rekey'] } {
  const moved = new Map<string, string>();
  const rekey: { id: string; parent: string; order: string }[] = [];
  const position = new Map(existing.map((e, i) => [e.id, i]));
  const exById = new Map(existing.map((e) => [e.id, e]));
  const siblings = new Map<string, SnapshotEdge[]>();
  for (const e of existing) siblings.set(e.parent, [...(siblings.get(e.parent) ?? []), e]);
  const mentioned = new Map<string, { e: SnapshotEdge; i: number }[]>();
  incoming.forEach((e, i) => {
    const old = exById.get(e.id);
    if (e.order === undefined || !old || old.parent !== e.parent) return;
    mentioned.set(e.parent, [...(mentioned.get(e.parent) ?? []), { e, i }]);
  });
  for (const [parent, list] of mentioned) {
    const seq = [...siblings.get(parent)!].sort((a, b) => compareOrder(a.order, b.order) || position.get(a.id)! - position.get(b.id)!);
    const rank = new Map(seq.map((e, i) => [e.id, i]));
    const wanted = [...list].sort((a, b) => compareOrder(a.e.order, b.e.order) || a.i - b.i).map((x) => x.e.id);
    const keep = longestIncreasing(wanted.map((id) => rank.get(id)!));
    const moving = wanted.filter((_, i) => !keep.has(i));
    if (!moving.length) continue;
    // The final sequence: unmentioned and kept edges in place; each moved edge next to its incoming neighbour.
    const movingSet = new Set(moving);
    const final = seq.map((e) => e.id).filter((id) => !movingSet.has(id));
    wanted.forEach((id, i) => {
      if (!movingSet.has(id)) return;
      if (i > 0) final.splice(final.indexOf(wanted[i - 1]!) + 1, 0, id);
      else final.splice(final.indexOf(wanted.find((_, k) => k > i && keep.has(k))!), 0, id);
    });
    const keys = new Map(seq.map((e) => [e.id, e.order]));
    const between = (): Map<string, string> | undefined => {
      if (seq.some((e) => e.order === undefined)) return undefined;
      const out = new Map<string, string>();
      try {
        final.forEach((id, i) => {
          if (!movingSet.has(id)) return;
          const left = i > 0 ? (out.get(final[i - 1]!) ?? keys.get(final[i - 1]!)) : undefined;
          const right = final.slice(i + 1).find((x) => !movingSet.has(x));
          out.set(id, orderBetween(left, right === undefined ? undefined : keys.get(right)));
        });
      } catch {
        return undefined; // ties or keys outside the fractional-index alphabet
      }
      return out;
    };
    const fitted = between();
    if (fitted) {
      for (const [id, key] of fitted) moved.set(id, key);
      continue;
    }
    const fresh = positionalOrders(final.length);
    final.forEach((id, i) => {
      if (movingSet.has(id)) moved.set(id, fresh[i]!);
      else if (keys.get(id) !== fresh[i]) rekey.push({ id, parent, order: fresh[i]! });
    });
  }
  return { moved, rekey };
}

/** Plan importing `incoming` into `existing`. Pure; nothing is written. */
export function planImport(existing: SpaceSnapshot, incoming: SpaceSnapshot, { onConflict = 'ask', capabilities }: PlanOptions = {}): ImportPlan {
  const diagnostics: Diagnostic[] = [];
  const carried = carriedFields(capabilities);
  const inNodes = uniqueById(incoming.nodes, 'node', diagnostics);
  const inEdges = uniqueById(incoming.edges, 'edge', diagnostics);
  const exNodes = new Map(existing.nodes.map((n) => [n.id, n]));
  const exEdges = new Map(existing.edges.map((e) => [e.id, e]));
  const { moved, rekey } = carried.has('order') ? planReorders(existing.edges, inEdges) : { moved: new Map<string, string>(), rekey: [] };
  const decide = (changes: ImportField[]): ImportAction => (changes.length ? (onConflict === 'ask' ? 'conflict' : onConflict) : 'skip');
  const differs = <T extends object>(a: T, b: T, field: keyof T & ImportField): boolean => carried.has(field) && b[field] !== undefined && !same(a[field], b[field]);

  const nodes: PlanEntry[] = inNodes.map((n) => {
    const old = exNodes.get(n.id);
    if (!old) return { id: n.id, action: 'create', reason: 'new', incomingHash: nodeHash(n) };
    const changes = (['label', 'payload', 'family'] as const).filter((f) => differs(old, n, f));
    return { id: n.id, action: decide(changes), reason: changes.length ? 'changed' : 'identical', ...(changes.length ? { changes } : {}), incomingHash: nodeHash(n), existingHash: nodeHash(old) };
  });
  const edges: PlanEntry[] = inEdges.map((e) => {
    const old = exEdges.get(e.id);
    if (!old) return { id: e.id, action: 'create', reason: 'new', incomingHash: edgeHash(e) };
    const changes: ImportField[] = [];
    if (old.parent !== e.parent || old.child !== e.child) changes.push('endpoints');
    if (carried.has('kind') && old.kind !== e.kind) changes.push('kind');
    if (differs(old, e, 'label')) changes.push('label');
    if (differs(old, e, 'meta')) changes.push('meta');
    if (moved.has(e.id)) changes.push('order');
    const order = moved.get(e.id);
    return {
      id: e.id,
      action: decide(changes),
      reason: changes.length ? 'changed' : 'identical',
      ...(changes.length ? { changes } : {}),
      ...(order !== undefined ? { order } : {}),
      incomingHash: edgeHash(e),
      existingHash: edgeHash(old),
    };
  });
  const summary = { create: 0, update: 0, skip: 0, conflict: 0 };
  for (const x of [...nodes, ...edges]) summary[x.action] += 1;
  return { nodes, edges, summary, incoming, diagnostics, carried: ALL_FIELDS.filter((f) => carried.has(f)), rekey };
}

/** How to settle the plan's conflicts: one policy for all, or per id (nodes and edges share the map). */
export type ConflictResolution = 'skip' | 'update' | Readonly<Record<string, 'skip' | 'update'>>;

/** The outcome of {@link applyImport}. */
export type ApplyResult =
  | { readonly ok: true; readonly space: SpaceSnapshot; readonly delta: ImportDelta }
  | { readonly ok: false; readonly conflicts: readonly PlanEntry[] };

const RESOLUTIONS = new Set(['skip', 'update']);

/**
 * Apply an accepted plan to `existing`. Refuses (returns the unresolved conflicts) unless
 * every conflict is resolved by `resolve` (own keys only; values `'skip'` or `'update'`).
 * Updates merge the fields that changed; nothing else is touched. Existing nodes and edges
 * keep their positions; created ones are appended in incoming order.
 */
export function applyImport(existing: SpaceSnapshot, plan: ImportPlan, { resolve }: { resolve?: ConflictResolution } = {}): ApplyResult {
  if (typeof resolve === 'string' && !RESOLUTIONS.has(resolve)) {
    throw new Error(`resolve must be 'skip' or 'update' (or a map of id → 'skip' | 'update'), not '${resolve}'.`);
  }
  const decide = (e: PlanEntry): ImportAction | undefined => {
    if (e.action !== 'conflict') return e.action;
    if (typeof resolve === 'string') return resolve;
    if (!resolve || !Object.prototype.hasOwnProperty.call(resolve, e.id)) return undefined;
    const choice = (resolve as Record<string, unknown>)[e.id];
    return typeof choice === 'string' && RESOLUTIONS.has(choice) ? (choice as ImportAction) : undefined;
  };
  const unresolved = [...plan.nodes, ...plan.edges].filter((e) => decide(e) === undefined);
  if (unresolved.length) return { ok: false, conflicts: unresolved };

  const nodeActs = new Map(plan.nodes.map((e) => [e.id, { act: decide(e)!, changes: e.changes ?? [], order: e.order }]));
  const edgeActs = new Map(plan.edges.map((e) => [e.id, { act: decide(e)!, changes: e.changes ?? [], order: e.order }]));
  const firstOf = <T extends { id: string }>(xs: readonly T[]): Map<string, T> => {
    const m = new Map<string, T>();
    for (const x of xs) if (!m.has(x.id)) m.set(x.id, x);
    return m;
  };
  const incomingNodes = firstOf(plan.incoming.nodes);
  const incomingEdges = firstOf(plan.incoming.edges);

  const mergeNode = (old: SnapshotNode, changes: readonly ImportField[]): SnapshotNode => {
    const next = incomingNodes.get(old.id)!;
    const out: Record<string, unknown> = { ...old };
    for (const f of changes) if (f === 'label' || f === 'payload' || f === 'family') out[f] = next[f];
    return out as unknown as SnapshotNode;
  };
  const mergeEdge = (old: SnapshotEdge, changes: readonly ImportField[], order: string | undefined): SnapshotEdge => {
    const next = incomingEdges.get(old.id)!;
    const out: Record<string, unknown> = { ...old };
    for (const f of changes) {
      if (f === 'endpoints') Object.assign(out, { parent: next.parent, child: next.child });
      else if (f === 'order') out.order = order ?? next.order;
      else if (f === 'kind' || f === 'label' || f === 'meta') out[f] = next[f];
    }
    return out as unknown as SnapshotEdge;
  };
  // A re-key applies where a move under the same parent is applied.
  const movedParents = new Set(
    plan.edges.filter((e) => edgeActs.get(e.id)!.act === 'update' && e.changes?.includes('order')).map((e) => incomingEdges.get(e.id)!.parent),
  );
  const rekeys = new Map(plan.rekey.filter((r) => movedParents.has(r.parent)).map((r) => [r.id, r.order]));

  const updatedNodes: SnapshotNode[] = [];
  const nodes = existing.nodes.map((n) => {
    const a = nodeActs.get(n.id);
    if (a?.act !== 'update') return n;
    const merged = mergeNode(n, a.changes);
    updatedNodes.push(merged);
    return merged;
  });
  const updatedEdges: SnapshotEdge[] = [];
  const edges = existing.edges.map((e) => {
    const a = edgeActs.get(e.id);
    const key = rekeys.get(e.id);
    if (a?.act !== 'update' && key === undefined) return e;
    const merged = a?.act === 'update' ? mergeEdge(e, a.changes, a.order) : e;
    const final = key !== undefined && !a?.changes.includes('order') ? { ...merged, order: key } : merged;
    updatedEdges.push(final);
    return final;
  });
  const createdNodes = plan.nodes.filter((e) => nodeActs.get(e.id)!.act === 'create').map((e) => incomingNodes.get(e.id)!);
  const createdEdges = plan.edges.filter((e) => edgeActs.get(e.id)!.act === 'create').map((e) => incomingEdges.get(e.id)!);
  return {
    ok: true,
    space: { nodes: [...nodes, ...createdNodes], edges: [...edges, ...createdEdges] },
    delta: { addedNodes: createdNodes, upsertNodes: updatedNodes, added: [...updatedEdges, ...createdEdges], removed: updatedEdges.map((e) => e.id) },
  };
}
