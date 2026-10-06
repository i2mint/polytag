/**
 * Grammar capabilities and the loss report.
 *
 * A grammar declares, per feature of the model, whether it carries it natively, only by a
 * convention (a wrapper, a reference, a duplicate copy), or not at all
 * (formats-and-grammars §4, §8.1). `reduce(space, capabilities)` is the single place that
 * decides what a grammar keeps: it returns the space the grammar will actually write and
 * the exact losses, by id. `assess` (before writing) and every grammar's `serialise` (which
 * writes the reduced space) both go through it, so the prediction and the write cannot
 * disagree; the round-trip gate checks `parse(serialise(S)) ≅ reduce(S).space`.
 */

import { type AnyFormat, type ValueLimits, isPlainObject } from './formats/index.js';
import { defaultIsMembership, groupIds, hasNodeMeta, type MembershipTest } from './model/features.js';
import { CONTAINS, type SnapshotEdge, type SnapshotNode, type SpaceSnapshot, edgeIdMinter } from './model/snapshot.js';

/** How a grammar carries a feature. */
export type Support = 'native' | 'convention' | 'no';

/** Features a grammar may carry only by convention; each has a severity (default `encode`). */
export type ConventionFeature =
  | 'itemsMultiParent'
  | 'nestedGroups'
  | 'groupsMultiParent'
  | 'groupMeta'
  | 'itemMeta'
  | 'edgeOrder'
  | 'edgeLabel'
  | 'edgeMeta'
  | 'isolatedNodes'
  | 'edgeIds';

/** What a grammar can express (formats-and-grammars §4, §8.1). */
export interface GrammarCapabilities {
  /** An item in several groups. */
  readonly itemsMultiParent: Support;
  /** A group inside a group. `no` drops every group → group edge. */
  readonly nestedGroups: Support;
  /** A group in several groups (polyhierarchy). */
  readonly groupsMultiParent: Support;
  /** A group's label, payload and family rule. */
  readonly groupMeta: Support;
  /** An item's label, payload and family rule. */
  readonly itemMeta: Support;
  /** Rank of a member within its group: `group-major` keeps it, `item-major` (an item's own tag order) does not. */
  readonly edgeOrder: 'group-major' | 'item-major' | Support;
  /** The member's name within a group. */
  readonly edgeLabel: Support;
  /** Edge provenance and other edge metadata. */
  readonly edgeMeta: Support;
  /** A node with no edge (an orphan item or an empty group; the model does not tell them apart). */
  readonly isolatedNodes: Support;
  /** `single`: only `contains` edges; other kinds are dropped. */
  readonly edgeKinds: 'native' | 'single';
  /** Edge ids that `defaultEdgeId` would not reproduce. */
  readonly edgeIds: Support;
  /** How identity is written: an id, a path, or a token in a cell. Informational. */
  readonly identity: 'id' | 'path' | 'token';
  /** Severity of each `convention` feature. Default `encode`. */
  readonly conventionSeverity?: Partial<Record<ConventionFeature, 'encode' | 'degrade'>>;
  /** How each `convention` feature is written, appended to its loss message. */
  readonly conventionNote?: Partial<Record<ConventionFeature, string>>;
}

/** What is lost. Named after the feature; the severity says how. */
export type LossKind =
  | 'edge-kind'
  | 'group-edges'
  | 'group-multi-parent'
  | 'item-multi-parent'
  | 'group-meta'
  | 'item-meta'
  | 'edge-order'
  | 'edge-label'
  | 'edge-meta'
  | 'isolated-node'
  | 'edge-id'
  /** Two different things written the same way (an id containing the delimiter). */
  | 'identity-collision'
  /** A membership a grammar convention cannot write (e.g. materialised paths imply it). */
  | 'membership'
  /** Comments and layout of an existing file that a rewrite does not keep. */
  | 'formatting'
  /** Values the format cannot write (TOML `null`). */
  | 'format-value';

/**
 * `drop`: gone. `degrade`: kept in another form (duplicated, regenerated). `encode`: kept by
 * a convention other tools may not understand. A report is lossless iff nothing is dropped or
 * degraded.
 */
export type LossSeverity = 'drop' | 'degrade' | 'encode';

/** One loss: what, how badly, and exactly which ids (node or edge ids, as the kind implies). */
export interface Loss {
  readonly kind: LossKind;
  readonly severity: LossSeverity;
  readonly count: number;
  /** Every affected id (node ids or edge ids; JSON-pointer paths for `format-value`; `line N` for `formatting`). */
  readonly ids: readonly string[];
  readonly message: string;
  /** The named secondary space the loss is in (record grammars' `spaces`); absent for the primary space. */
  readonly space?: string;
}

/** The loss report of writing a space in a grammar (and format). */
export interface LossReport {
  readonly lossless: boolean;
  readonly losses: readonly Loss[];
}

/** Assemble a report; losses with no affected ids are left out. */
export function lossReport(losses: readonly Loss[]): LossReport {
  const kept = losses.filter((l) => l.count > 0);
  return { lossless: kept.every((l) => l.severity === 'encode'), losses: kept };
}

/** Make a loss entry. */
export const loss = (kind: LossKind, severity: LossSeverity, ids: readonly string[], message: string): Loss => ({
  kind,
  severity,
  count: ids.length,
  ids,
  message,
});

/** The result of {@link reduce}: the space a grammar writes, and what that costs. */
export interface Reduction {
  readonly space: SpaceSnapshot;
  readonly losses: readonly Loss[];
  /** Planned secondary spaces, for grammars that write them. */
  readonly spaces?: Readonly<Record<string, SpaceSnapshot>>;
}

/** Options of {@link reduce}. */
export interface ReduceOptions {
  readonly isMembership?: MembershipTest;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * Reduce `space` to what a grammar with `caps` can carry, and list exactly what that drops,
 * degrades or encodes. Pure; node and edge order are kept.
 */
export function reduce(space: SpaceSnapshot, caps: GrammarCapabilities, { isMembership = defaultIsMembership }: ReduceOptions = {}): Reduction {
  const losses: Loss[] = [];
  const severity = (f: ConventionFeature): LossSeverity => caps.conventionSeverity?.[f] ?? 'encode';
  const note = (f: ConventionFeature): string => (caps.conventionNote?.[f] ? ` (${caps.conventionNote[f]})` : '');
  let nodes: SnapshotNode[] = [...space.nodes];
  let edges: SnapshotEdge[] = [...space.edges];
  const without = (drop: Set<string>): void => {
    edges = edges.filter((e) => !drop.has(e.id));
  };

  // 1. Edge kinds.
  if (caps.edgeKinds === 'single') {
    const other = edges.filter((e) => e.kind !== CONTAINS).map((e) => e.id);
    losses.push(loss('edge-kind', 'drop', other, `${plural(other.length, 'edge')} of a kind other than '${CONTAINS}' cannot be written`));
    without(new Set(other));
  }

  // 2. Nested groups.
  let groups = groupIds(edges, isMembership);
  const groupEdges = edges.filter((e) => isMembership(e.kind) && groups.has(e.child)).map((e) => e.id);
  if (caps.nestedGroups === 'no') {
    losses.push(loss('group-edges', 'drop', groupEdges, `${plural(groupEdges.length, 'group → group edge')} cannot be written (a flat grammar)`));
    without(new Set(groupEdges));
    groups = groupIds(edges, isMembership);
  } else if (caps.nestedGroups === 'convention') {
    losses.push(loss('group-edges', severity('nestedGroups'), groupEdges, `${plural(groupEdges.length, 'group → group edge')} written by convention`));
  }

  // 3–4. Several parents, for groups (if nesting survives) then items.
  const multiParent = (isGroup: boolean, cap: Support, kind: 'group-multi-parent' | 'item-multi-parent', feature: ConventionFeature): void => {
    const firstParent = new Map<string, string>();
    const dropped: string[] = [];
    const multi = new Set<string>();
    for (const e of edges) {
      if (!isMembership(e.kind) || groups.has(e.child) !== isGroup) continue;
      const first = firstParent.get(e.child);
      if (first === undefined) firstParent.set(e.child, e.parent);
      else if (first !== e.parent) {
        multi.add(e.child);
        dropped.push(e.id);
      }
    }
    const what = isGroup ? 'group' : 'item';
    if (cap === 'no') {
      losses.push(loss(kind, 'drop', dropped, `${plural(dropped.length, 'membership')} beyond each ${what}'s first group cannot be written`));
      without(new Set(dropped));
    } else if (cap === 'convention') {
      losses.push(loss(kind, severity(feature), [...multi], `${plural(multi.size, `${what} in several groups`, `${what}s in several groups`)}, written by convention${note(feature)}`));
    }
  };
  if (caps.nestedGroups !== 'no') multiParent(true, caps.groupsMultiParent, 'group-multi-parent', 'groupsMultiParent');
  multiParent(false, caps.itemsMultiParent, 'item-multi-parent', 'itemsMultiParent');
  groups = groupIds(edges, isMembership);

  // 5. Node metadata.
  const nodeMeta = (isGroup: boolean, cap: Support, kind: 'group-meta' | 'item-meta', feature: ConventionFeature): void => {
    const ids = nodes.filter((n) => groups.has(n.id) === isGroup && hasNodeMeta(n)).map((n) => n.id);
    const what = isGroup ? 'group' : 'item';
    if (cap === 'no') {
      const strip = new Set(ids);
      nodes = nodes.map((n) => (strip.has(n.id) ? { id: n.id } : n));
      losses.push(loss(kind, 'drop', ids, `the label, payload and family rule of ${plural(ids.length, what)} cannot be written`));
    } else if (cap === 'convention') {
      losses.push(loss(kind, severity(feature), ids, `the label, payload and family rule of ${plural(ids.length, what)} are written by convention`));
    }
  };
  nodeMeta(true, caps.groupMeta, 'group-meta', 'groupMeta');
  nodeMeta(false, caps.itemMeta, 'item-meta', 'itemMeta');

  // 6. Edge fields.
  const edgeField = (field: 'order' | 'label' | 'meta', cap: Support | 'group-major' | 'item-major', kind: LossKind, feature: ConventionFeature, what: string): void => {
    const ids = edges.filter((e) => e[field] !== undefined).map((e) => e.id);
    if (cap === 'native' || cap === 'group-major') return;
    if (cap === 'convention') {
      losses.push(loss(kind, severity(feature), ids, `${what} of ${plural(ids.length, 'edge')} written by convention`));
      return;
    }
    const strip = new Set(ids);
    edges = edges.map((e) => {
      if (!strip.has(e.id)) return e;
      const { [field]: _, ...rest } = e;
      return rest;
    });
    const why = cap === 'item-major' ? ' (this grammar orders an item\'s groups, not a group\'s members)' : '';
    losses.push(loss(kind, 'drop', ids, `${what} of ${plural(ids.length, 'edge')} cannot be written${why}`));
  };
  edgeField('order', caps.edgeOrder, 'edge-order', 'edgeOrder', 'the rank within the group');
  edgeField('label', caps.edgeLabel, 'edge-label', 'edgeLabel', 'the name within the group');
  edgeField('meta', caps.edgeMeta, 'edge-meta', 'edgeMeta', 'the metadata');

  // 7. Isolated nodes (after every drop above).
  const touched = new Set(edges.flatMap((e) => [e.parent, e.child]));
  const isolated = nodes.filter((n) => !touched.has(n.id)).map((n) => n.id);
  if (caps.isolatedNodes === 'no') {
    const gone = new Set(isolated);
    nodes = nodes.filter((n) => !gone.has(n.id));
    losses.push(loss('isolated-node', 'drop', isolated, `${plural(isolated.length, 'node')} in no group and with no member cannot be written`));
  } else if (caps.isolatedNodes === 'convention') {
    losses.push(loss('isolated-node', severity('isolatedNodes'), isolated, `${plural(isolated.length, 'node')} in no group and with no member, written by convention`));
  }

  // 8. Edge ids.
  if (caps.edgeIds !== 'native') {
    const mint = edgeIdMinter();
    const renamed: string[] = [];
    const reminted = edges.map((e) => {
      const id = mint(e.parent, e.child, e.kind);
      if (id === e.id) return e;
      renamed.push(e.id);
      return caps.edgeIds === 'no' ? { ...e, id } : e;
    });
    if (caps.edgeIds === 'no') {
      edges = reminted;
      losses.push(loss('edge-id', 'degrade', renamed, `${plural(renamed.length, 'edge id')} cannot be written and will be regenerated`));
    } else {
      losses.push(loss('edge-id', severity('edgeIds'), renamed, `${plural(renamed.length, 'edge id')} written by convention`));
    }
  }

  return { space: { nodes, edges }, losses };
}

/** An existing text a write would replace, and its format. */
export interface PreviousText {
  readonly text: string;
  readonly format: AnyFormat;
}

/**
 * What overwriting an existing commented file costs: its comments (dropped) and its layout
 * (key order, whitespace, quoting: degraded). Empty when the file has no comments; a
 * comment-preserving writer is a later seam (formats-and-grammars §8.3).
 */
export function formattingLosses({ text, format }: PreviousText): Loss[] {
  const { comments } = format.inspect(text);
  if (!comments.length) return [];
  return [
    loss('formatting', 'drop', comments.map((c) => `line ${c.line}`), `${plural(comments.length, 'comment')} in the existing ${format.label} file would be lost`),
    loss('formatting', 'degrade', ['layout'], `key order, whitespace and quoting of the existing ${format.label} file would be rewritten`),
  ];
}

const DROP = Symbol('drop');

/**
 * Fit the payloads and edge metadata of `space` to what a format can hold: without `null`
 * (TOML), nulls are left out (`format-value` drop); without non-finite numbers (JSON, and
 * CSV's JSON cells), `NaN` and `±Infinity` become `null` (`format-value` degrade). Ids are
 * the nodes and edges affected. Pure.
 */
export function limitValues(space: SpaceSnapshot, limits: ValueLimits): Reduction {
  if (limits.null && limits.nonFinite) return { space, losses: [] };
  let dropped = false;
  let converted = false;
  const fit = (v: unknown): unknown => {
    if (v === null) {
      if (limits.null) return v;
      dropped = true;
      return DROP;
    }
    if (typeof v === 'number' && !Number.isFinite(v) && !limits.nonFinite) {
      if (limits.null) {
        converted = true;
        return null;
      }
      dropped = true;
      return DROP;
    }
    if (Array.isArray(v)) return v.map(fit).filter((x) => x !== DROP);
    if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fit(x)] as const).filter(([, x]) => x !== DROP));
    return v;
  };
  const droppedIds: string[] = [];
  const convertedIds: string[] = [];
  const track = (id: string): void => {
    if (dropped) droppedIds.push(id);
    if (converted) convertedIds.push(id);
    dropped = false;
    converted = false;
  };
  const nodes = space.nodes.map((n) => {
    if (n.payload === undefined) return n;
    const payload = fit(n.payload);
    track(n.id);
    if (payload === DROP) {
      const { payload: _, ...rest } = n;
      return rest;
    }
    return payload === n.payload ? n : { ...n, payload };
  });
  const edges = space.edges.map((e) => {
    if (e.meta === undefined) return e;
    const meta = fit(e.meta);
    track(e.id);
    return { ...e, meta: meta as Record<string, unknown> };
  });
  return {
    space: { nodes, edges },
    losses: [
      loss('format-value', 'drop', droppedIds, `${plural(droppedIds.length, 'node or edge', 'nodes or edges')} hold null, which this format cannot write; left out`),
      loss('format-value', 'degrade', convertedIds, `${plural(convertedIds.length, 'node or edge', 'nodes or edges')} hold NaN or Infinity, written as null`),
    ],
  };
}
