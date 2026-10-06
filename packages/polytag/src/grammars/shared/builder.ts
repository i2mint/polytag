/**
 * The space builder every grammar's `parse` writes into.
 *
 * It owns the rules that make parsing total (diagnostics, never exceptions): a node seen
 * twice keeps its first content and reports a conflicting second one; an edge without an id
 * gets a deterministic one (`defaultEdgeId`, parallel edges counted); an edge whose explicit
 * id is taken keeps the first; cycles are kept but reported with their path (zodal-groups
 * D8: enforce on write, never trust on read; the projections are cycle-safe).
 */

import type { Location } from '../../formats/index.js';
import type { Diagnostic, ParseResult, Residue } from '../../grammar.js';
import { defaultIsMembership, type MembershipTest } from '../../model/features.js';
import {
  CONTAINS,
  type FamilyRule,
  type SnapshotEdge,
  type SnapshotNode,
  defaultEdgeId,
  findCycles,
  nodeContent,
  sameValue,
} from '../../model/snapshot.js';

/** A node's content besides its id. */
export interface NodeData {
  readonly label?: string;
  readonly payload?: unknown;
  readonly family?: FamilyRule;
}

/** An edge's fields besides its endpoints. */
export interface EdgeData {
  readonly id?: string;
  readonly kind?: string;
  readonly label?: string;
  readonly order?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** Drop `undefined` fields, so `{ label: undefined }` and `{}` are the same node. */
function defined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

const hasContent = (d: NodeData): boolean => d.label !== undefined || d.payload !== undefined || d.family !== undefined;

/** Accumulates nodes, edges, diagnostics and residue; `build()` returns the `ParseResult`. */
export interface SpaceBuilder {
  /** Add a node, or fill a bare one; a second, different content is reported and ignored. */
  node(id: string, data?: NodeData, path?: string): void;
  has(id: string): boolean;
  /** Add an edge (creating bare endpoint nodes); returns its id, or `undefined` if refused. */
  edge(parent: string, child: string, data?: EdgeData, path?: string): string | undefined;
  /** Set the order of an edge already added. */
  setOrder(edgeId: string, order: string): void;
  /** Report a problem; its `path` also becomes a structured `at`. */
  diag(d: Diagnostic): void;
  leftover(path: string, value: unknown): void;
  /** Note that the input declared `id` as a record (an item with its own entry). */
  record(id: string): void;
  build(options?: { readonly isMembership?: MembershipTest; readonly spaces?: ParseResult['spaces'] }): ParseResult;
}

/** The structured location of a diagnostic path: a JSON pointer, or `row N[, column C]`. */
export function locationOf(path: string): Location | undefined {
  const row = /^row (\d+)(?:, column (.*))?$/.exec(path);
  if (row) return row[2] === undefined ? { row: Number(row[1]) } : { row: Number(row[1]), column: row[2] };
  return path === '' || path.startsWith('/') ? { pointer: path } : undefined;
}

/** Escape a key as one JSON-pointer segment (RFC 6901). */
export const seg = (key: string | number): string => String(key).replace(/~/g, '~0').replace(/\//g, '~1');

/** A fresh, empty builder. */
export function createSpaceBuilder(): SpaceBuilder {
  const nodes = new Map<string, SnapshotNode>();
  const edges = new Map<string, SnapshotEdge>();
  const occurrences = new Map<string, number>();
  const diagnostics: Diagnostic[] = [];
  const residue: Residue[] = [];
  const conflicts = new Set<string>();
  const records = new Set<string>();

  const mint = (parent: string, child: string, kind: string): string => {
    const key = defaultEdgeId(parent, child, kind);
    let n = occurrences.get(key) ?? 0;
    let id = defaultEdgeId(parent, child, kind, n);
    while (edges.has(id)) id = defaultEdgeId(parent, child, kind, ++n);
    occurrences.set(key, n + 1);
    return id;
  };

  const builder: SpaceBuilder = {
    node(id, data = {}, path) {
      const content = defined(data);
      const existing = nodes.get(id);
      if (!existing) {
        nodes.set(id, { id, ...content });
        return;
      }
      if (!hasContent(content)) return;
      if (!hasContent(existing)) {
        nodes.set(id, { id, ...content });
        return;
      }
      if (sameValue(nodeContent(existing), nodeContent({ id, ...content })) || conflicts.has(id)) return;
      conflicts.add(id);
      builder.diag({
        severity: 'warning',
        code: 'conflicting-duplicate',
        message: `'${id}' appears more than once with different content; the first is kept`,
        ids: [id],
        ...(path !== undefined ? { path } : {}),
      });
    },
    has: (id) => nodes.has(id),
    edge(parent, child, data = {}, path) {
      builder.node(parent);
      builder.node(child);
      const kind = data.kind ?? CONTAINS;
      const fields = defined({ label: data.label, order: data.order, meta: data.meta });
      if (data.id !== undefined && edges.has(data.id)) {
        const first = edges.get(data.id)!;
        if (!sameValue({ ...first, order: undefined }, { id: data.id, parent, child, kind, ...fields, order: undefined })) {
          builder.diag({
            severity: 'warning',
            code: 'conflicting-duplicate',
            message: `edge id '${data.id}' appears more than once with different content; the first is kept`,
            ids: [data.id],
            ...(path !== undefined ? { path } : {}),
          });
        }
        return undefined;
      }
      const id = data.id ?? mint(parent, child, kind);
      edges.set(id, { id, parent, child, kind, ...fields });
      return id;
    },
    setOrder(edgeId, order) {
      const e = edges.get(edgeId);
      if (e) edges.set(edgeId, { ...e, order });
    },
    diag(d) {
      const at = d.at ?? (d.path === undefined ? undefined : locationOf(d.path));
      diagnostics.push(at ? { ...d, at } : d);
    },
    leftover: (path, value) => residue.push({ path, value }),
    record: (id) => void records.add(id),
    build({ isMembership = defaultIsMembership, spaces } = {}) {
      const edgeList = [...edges.values()];
      for (const cycle of findCycles(edgeList.filter((e) => isMembership(e.kind)))) {
        diagnostics.push({
          severity: 'warning',
          code: 'cycle',
          message: `membership cycle ${cycle.join(' → ')} (kept; zodal-groups refuses it on write)`,
          ids: cycle,
        });
      }
      return {
        space: { nodes: [...nodes.values()], edges: edgeList },
        residue,
        diagnostics,
        ...(records.size ? { records: [...records] } : {}),
        ...(spaces ? { spaces } : {}),
      };
    },
  };
  return builder;
}
