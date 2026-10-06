/**
 * The canonical relation as plain data: flat `nodes[]` + `edges[]` (zodal-groups D1, D20).
 *
 * These are *structural* types: a zodal-groups `Node` / `Edge` is assignable to
 * `SnapshotNode` / `SnapshotEdge` (its branded ids are strings), and a parsed snapshot seeds
 * `createGroupSpace({ nodes, edges })` once its ids are minted with `nodeId` / `edgeId` (or
 * cast: the brands are compile-time only). Keeping them structural means the grammars
 * depend on no zodal-groups release; `tests/groups-compat.test.ts` proves the fit.
 *
 * Also here: deterministic edge ids, positional order keys, the round-trip comparison
 * (`diffSpaces`, edge order compared by rank) and content hashing.
 */

/** The default edge kind: plain containment. */
export const CONTAINS = 'contains';

/** A per-family cardinality rule carried by a family-root node (zodal-groups `FamilyRule`). */
export interface FamilyRule {
  readonly maxPerItem: number;
}

/** A node: an item or a group (group-ness is having members). Structural zodal-groups `Node`. */
export interface SnapshotNode<P = unknown> {
  readonly id: string;
  readonly label?: string;
  readonly payload?: P;
  readonly family?: FamilyRule;
}

/** A reified membership edge, "`child` is in `parent`". Structural zodal-groups `Edge`. */
export interface SnapshotEdge {
  readonly id: string;
  readonly parent: string;
  readonly child: string;
  readonly kind: string;
  /** The child's name within this parent. */
  readonly label?: string;
  /** Rank within this parent, a fractional-index string compared by code unit. */
  readonly order?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** A group space as plain data. */
export interface SpaceSnapshot<P = unknown> {
  readonly nodes: readonly SnapshotNode<P>[];
  readonly edges: readonly SnapshotEdge[];
}

/** An empty snapshot. */
export const emptySpace = (): SpaceSnapshot => ({ nodes: [], edges: [] });

/** Escape the characters an edge id uses as separators (`%`, `:`, `/`, `#`). */
const escapeIdPart = (s: string): string => s.replace(/[%:/#]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The deterministic id of the `occurrence`-th (0-based) edge `parent → child` of `kind`:
 * `contains:food/italian`, then `contains:food/italian#2` for a parallel edge. Formats
 * without edge ids derive them this way, so a round trip does not churn ids (D7's
 * change-feed would otherwise report phantom deltas). Unambiguous: the separators are
 * escaped inside each part.
 */
export function defaultEdgeId(parent: string, child: string, kind: string = CONTAINS, occurrence = 0): string {
  const base = `${escapeIdPart(kind)}:${escapeIdPart(parent)}/${escapeIdPart(child)}`;
  return occurrence ? `${base}#${occurrence + 1}` : base;
}

/** Mints deterministic edge ids, counting parallel edges. */
export function edgeIdMinter(): (parent: string, child: string, kind?: string) => string {
  const seen = new Map<string, number>();
  return (parent, child, kind = CONTAINS) => {
    const key = defaultEdgeId(parent, child, kind);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return defaultEdgeId(parent, child, kind, n);
  };
}

/** The 62 digits of zodal-groups' fractional-index alphabet, in code-unit order. */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * `n` evenly spread, fixed-width rank strings in increasing code-unit order, valid keys of
 * zodal-groups' fractional indexing (its `orderBetween` can insert between any two). Used
 * for the order that array position gives in positional grammars.
 */
export function positionalOrders(n: number): string[] {
  let width = 1;
  while (DIGITS.length ** width <= n) width += 1;
  const span = DIGITS.length ** width;
  return Array.from({ length: n }, (_, i) => {
    let v = Math.floor(((i + 1) * span) / (n + 1));
    let key = '';
    for (let w = 0; w < width; w++) {
      key = DIGITS[v % DIGITS.length]! + key;
      v = Math.floor(v / DIGITS.length);
    }
    return key;
  });
}

/** Compare two ranks by code unit (never locale); absent ranks sort last. */
export function compareOrder(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a < b ? -1 : 1;
}

/**
 * A plain snapshot of anything shaped like a zodal-groups `GroupSpace` (maps of nodes and
 * edges) or already a snapshot (arrays).
 */
export function snapshotOf<P>(space: {
  readonly nodes: ReadonlyMap<string, SnapshotNode<P>> | readonly SnapshotNode<P>[];
  readonly edges: ReadonlyMap<string, SnapshotEdge> | readonly SnapshotEdge[];
}): SpaceSnapshot<P> {
  const values = <T>(x: ReadonlyMap<string, T> | readonly T[]): T[] => (Array.isArray(x) ? [...x] : [...(x as ReadonlyMap<string, T>).values()]);
  return { nodes: values(space.nodes), edges: values(space.edges) };
}

// ── stable serialisation and hashing ────────────────────────────────────────

/**
 * JSON with object keys sorted (by code unit), so equal values serialise equally. `undefined`
 * object values are skipped, as in JSON; a cycle is written as `"[Circular]"`.
 */
export function stableStringify(value: unknown): string {
  const stack = new Set<object>();
  const write = (v: unknown): string => {
    if (v === null || typeof v !== 'object') return typeof v === 'bigint' ? `${v}n` : (JSON.stringify(v) ?? 'null');
    if (stack.has(v)) return '"[Circular]"';
    stack.add(v);
    const out = Array.isArray(v)
      ? `[${v.map(write).join(',')}]`
      : `{${Object.keys(v)
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${write((v as Record<string, unknown>)[k])}`)
          .join(',')}}`;
    stack.delete(v);
    return out;
  };
  return write(value);
}

/** A 53-bit non-cryptographic hash (cyrb53) of a string, as 14 hex digits. */
function cyrb53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** A content hash of any JSON-like value (key order does not matter). */
export const contentHash = (value: unknown): string => cyrb53(stableStringify(value));

/** Deep equality of JSON-like values (key order does not matter). */
export const sameValue = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b);

/** A node without its id, for hashing and comparison. */
export const nodeContent = ({ label, payload, family }: SnapshotNode): unknown => ({ label, payload, family });

/** An edge without its id and order, for comparison (order is compared by rank). */
const edgeContent = ({ parent, child, kind, label, meta }: SnapshotEdge): unknown => ({ parent, child, kind, label, meta });

// ── cycles ──────────────────────────────────────────────────────────────────

/**
 * Cycles among `edges` (each as the node path that closes it, first node repeated last),
 * at most `limit`. Self-edges count. Iterative, so deep chains do not overflow the stack.
 */
export function findCycles(edges: readonly SnapshotEdge[], limit = 20): string[][] {
  const out = new Map<string, string[]>();
  for (const e of edges) {
    const list = out.get(e.parent);
    if (list) list.push(e.child);
    else out.set(e.parent, [e.child]);
  }
  const state = new Map<string, 1 | 2>();
  const cycles: string[][] = [];
  const seen = new Set<string>();
  for (const start of out.keys()) {
    if (state.has(start)) continue;
    const path: string[] = [];
    const frames: { node: string; next: number }[] = [{ node: start, next: 0 }];
    state.set(start, 1);
    path.push(start);
    while (frames.length && cycles.length < limit) {
      const frame = frames[frames.length - 1]!;
      const children = out.get(frame.node) ?? [];
      if (frame.next >= children.length) {
        state.set(frame.node, 2);
        frames.pop();
        path.pop();
        continue;
      }
      const child = children[frame.next++]!;
      const s = state.get(child);
      if (s === 1) {
        const cycle = [...path.slice(path.indexOf(child)), child];
        const key = [...new Set(cycle)].sort().join('\u0000');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (s === undefined) {
        state.set(child, 1);
        path.push(child);
        frames.push({ node: child, next: 0 });
      }
    }
  }
  return cycles;
}

// ── round-trip comparison ───────────────────────────────────────────────────

/** How `actual` differs from `expected`, by id. */
export interface SpaceDiff {
  readonly equal: boolean;
  readonly missingNodes: readonly string[];
  readonly extraNodes: readonly string[];
  /** Same id, different label, payload or family. */
  readonly changedNodes: readonly string[];
  readonly missingEdges: readonly string[];
  readonly extraEdges: readonly string[];
  /** Same id, different parent, child, kind, label or meta. */
  readonly changedEdges: readonly string[];
  /** Parents whose ordered members (in `expected`) are ranked differently, or lost their order, in `actual`. */
  readonly reordered: readonly string[];
}

/**
 * Compare two snapshots the way the round-trip contract does (formats-and-grammars §8.3):
 * nodes and edges by id and content; edge `order` by *rank* among the members `expected`
 * orders, never by string, because formats carry positions while the model carries
 * fractional keys. Order that `actual` adds where `expected` has none is not a difference.
 */
export function diffSpaces(expected: SpaceSnapshot, actual: SpaceSnapshot): SpaceDiff {
  const byId = <T extends { id: string }>(xs: readonly T[]): Map<string, T> => new Map(xs.map((x) => [x.id, x]));
  const en = byId(expected.nodes);
  const an = byId(actual.nodes);
  const ee = byId(expected.edges);
  const ae = byId(actual.edges);
  const missingNodes = [...en.keys()].filter((id) => !an.has(id));
  const extraNodes = [...an.keys()].filter((id) => !en.has(id));
  const changedNodes = [...en.keys()].filter((id) => an.has(id) && !sameValue(nodeContent(en.get(id)!), nodeContent(an.get(id)!)));
  const missingEdges = [...ee.keys()].filter((id) => !ae.has(id));
  const extraEdges = [...ae.keys()].filter((id) => !ee.has(id));
  const changedEdges = [...ee.keys()].filter((id) => ae.has(id) && !sameValue(edgeContent(ee.get(id)!), edgeContent(ae.get(id)!)));

  const orderedByParent = new Map<string, SnapshotEdge[]>();
  for (const e of expected.edges) {
    if (e.order === undefined || !ae.has(e.id)) continue;
    const list = orderedByParent.get(e.parent);
    if (list) list.push(e);
    else orderedByParent.set(e.parent, [e]);
  }
  const reordered: string[] = [];
  const byOrderThenId = (order: (e: SnapshotEdge) => string | undefined) => (a: SnapshotEdge, b: SnapshotEdge) =>
    compareOrder(order(a), order(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const [parent, list] of orderedByParent) {
    const want = [...list].sort(byOrderThenId((e) => e.order)).map((e) => e.id);
    if (list.some((e) => ae.get(e.id)!.order === undefined)) {
      reordered.push(parent);
      continue;
    }
    const got = [...list].sort(byOrderThenId((e) => ae.get(e.id)!.order)).map((e) => e.id);
    if (want.join('\u0000') !== got.join('\u0000')) reordered.push(parent);
  }
  const equal = [missingNodes, extraNodes, changedNodes, missingEdges, extraEdges, changedEdges, reordered].every((x) => x.length === 0);
  return { equal, missingNodes, extraNodes, changedNodes, missingEdges, extraEdges, changedEdges, reordered };
}
