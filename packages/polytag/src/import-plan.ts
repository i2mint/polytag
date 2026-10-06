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
import { type SnapshotEdge, type SnapshotNode, type SpaceSnapshot, compareOrder, contentHash, stableStringify } from './model/snapshot.js';

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

/**
 * Edges whose rank among their siblings differs. Per parent, only the edges both sides
 * have (and the incoming side orders) are compared; existing ranks are as a writer lays them
 * out (order, then position). If any of them moved, all of them change (they take the
 * incoming keys together, so the keys stay consistent).
 */
function reordered(existing: readonly SnapshotEdge[], incoming: readonly SnapshotEdge[]): Set<string> {
  const ex = new Map(existing.map((e, i) => [e.id, { e, i }]));
  const byParent = new Map<string, { e: SnapshotEdge; i: number }[]>();
  incoming.forEach((e, i) => {
    const old = ex.get(e.id);
    if (e.order === undefined || !old || old.e.parent !== e.parent) return;
    byParent.set(e.parent, [...(byParent.get(e.parent) ?? []), { e, i }]);
  });
  const moved = new Set<string>();
  for (const list of byParent.values()) {
    const got = [...list].sort((a, b) => compareOrder(a.e.order, b.e.order) || a.i - b.i).map((x) => x.e.id);
    const want = list.map((x) => ex.get(x.e.id)!).sort((a, b) => compareOrder(a.e.order, b.e.order) || a.i - b.i).map((x) => x.e.id);
    if (got.join('\u0000') !== want.join('\u0000')) for (const id of got) moved.add(id);
  }
  return moved;
}

/** Plan importing `incoming` into `existing`. Pure; nothing is written. */
export function planImport(existing: SpaceSnapshot, incoming: SpaceSnapshot, { onConflict = 'ask', capabilities }: PlanOptions = {}): ImportPlan {
  const diagnostics: Diagnostic[] = [];
  const carried = carriedFields(capabilities);
  const inNodes = uniqueById(incoming.nodes, 'node', diagnostics);
  const inEdges = uniqueById(incoming.edges, 'edge', diagnostics);
  const exNodes = new Map(existing.nodes.map((n) => [n.id, n]));
  const exEdges = new Map(existing.edges.map((e) => [e.id, e]));
  const moved = carried.has('order') ? reordered(existing.edges, inEdges) : new Set<string>();
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
    return { id: e.id, action: decide(changes), reason: changes.length ? 'changed' : 'identical', ...(changes.length ? { changes } : {}), incomingHash: edgeHash(e), existingHash: edgeHash(old) };
  });
  const summary = { create: 0, update: 0, skip: 0, conflict: 0 };
  for (const x of [...nodes, ...edges]) summary[x.action] += 1;
  return { nodes, edges, summary, incoming, diagnostics, carried: ALL_FIELDS.filter((f) => carried.has(f)) };
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

  const nodeActs = new Map(plan.nodes.map((e) => [e.id, { act: decide(e)!, changes: e.changes ?? [] }]));
  const edgeActs = new Map(plan.edges.map((e) => [e.id, { act: decide(e)!, changes: e.changes ?? [] }]));
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
  const mergeEdge = (old: SnapshotEdge, changes: readonly ImportField[]): SnapshotEdge => {
    const next = incomingEdges.get(old.id)!;
    const out: Record<string, unknown> = { ...old };
    for (const f of changes) {
      if (f === 'endpoints') Object.assign(out, { parent: next.parent, child: next.child });
      else if (f === 'kind' || f === 'label' || f === 'meta' || f === 'order') out[f] = next[f];
    }
    return out as unknown as SnapshotEdge;
  };

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
    if (a?.act !== 'update') return e;
    const merged = mergeEdge(e, a.changes);
    updatedEdges.push(merged);
    return merged;
  });
  const createdNodes = plan.nodes.filter((e) => nodeActs.get(e.id)!.act === 'create').map((e) => incomingNodes.get(e.id)!);
  const createdEdges = plan.edges.filter((e) => edgeActs.get(e.id)!.act === 'create').map((e) => incomingEdges.get(e.id)!);
  return {
    ok: true,
    space: { nodes: [...nodes, ...createdNodes], edges: [...edges, ...createdEdges] },
    delta: { addedNodes: createdNodes, upsertNodes: updatedNodes, added: [...updatedEdges, ...createdEdges], removed: updatedEdges.map((e) => e.id) },
  };
}
