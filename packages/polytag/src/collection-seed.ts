/**
 * The seam to a tagged collection (zodal-groups' planned `@zodal/groups-collection`, and
 * polytag's facade, i2mint/polytag#4): a read becomes item **records** plus one or more named
 * group **spaces** over them (ADR 0001 seam 2, `spaces`), and back.
 *
 * Records carry the item content (label, payload, family); spaces carry structure (groups,
 * with their own content, and memberships), with record nodes left bare so the content lives
 * in one place.
 */

import type { ParseResult } from './grammar.js';
import type { SnapshotNode, SpaceSnapshot } from './model/snapshot.js';

/** Item records and named group spaces over them. */
export interface CollectionSeed {
  readonly records: readonly SnapshotNode[];
  readonly spaces: Readonly<Record<string, SpaceSnapshot>>;
}

/** Options of {@link toCollectionSeed} and {@link fromCollectionSeed}. */
export interface SeedOptions {
  /** The name of the primary space (the parse's `space`). Default `groups`. */
  readonly primary?: string;
}

/**
 * Records and spaces from a parse. The records are the ids the input declared as records
 * (`ParseResult.records`), else the space's non-group nodes; their content moves to the
 * records and their nodes in every space are left bare.
 */
export function toCollectionSeed(result: Pick<ParseResult, 'space' | 'spaces' | 'records'>, { primary = 'groups' }: SeedOptions = {}): CollectionSeed {
  const groups = new Set(result.space.edges.map((e) => e.parent));
  const ids = result.records ?? result.space.nodes.filter((n) => !groups.has(n.id)).map((n) => n.id);
  const isRecord = new Set(ids);
  const byId = new Map(result.space.nodes.map((n) => [n.id, n]));
  const records = ids.map((id) => byId.get(id) ?? { id });
  const bare = (s: SpaceSnapshot): SpaceSnapshot => ({ nodes: s.nodes.map((n) => (isRecord.has(n.id) ? { id: n.id } : n)), edges: s.edges });
  return { records, spaces: { [primary]: bare(result.space), ...Object.fromEntries(Object.entries(result.spaces ?? {}).map(([k, s]) => [k, bare(s)])) } };
}

/**
 * The inverse: the primary space with the records' content put back (records it lacks are
 * appended as isolated nodes), the other spaces, and the record ids. Feed `space` and
 * `spaces` to `writeText` (`spaces` for record grammars with a `spaces` param).
 */
export function fromCollectionSeed(seed: CollectionSeed, { primary = 'groups' }: SeedOptions = {}): { space: SpaceSnapshot; spaces: Record<string, SpaceSnapshot>; records: string[] } {
  const main = seed.spaces[primary] ?? { nodes: [], edges: [] };
  const content = new Map(seed.records.map((r) => [r.id, r]));
  const present = new Set(main.nodes.map((n) => n.id));
  const nodes = [...main.nodes.map((n) => content.get(n.id) ?? n), ...seed.records.filter((r) => !present.has(r.id))];
  const spaces = Object.fromEntries(Object.entries(seed.spaces).filter(([k]) => k !== primary));
  return { space: { nodes, edges: main.edges }, spaces, records: seed.records.map((r) => r.id) };
}
