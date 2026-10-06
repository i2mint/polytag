/**
 * Export scope (ADR 0001 §Revision 1): export `all`, the `filtered` items, or the `selected`
 * ones. polytag does not know the filter or the selection; the caller passes the ids, and the
 * scope names why (for the UI and for the file's provenance).
 *
 * A scoped export keeps each chosen node's memberships: the chosen nodes, all their ancestor
 * groups (so the hierarchy above them survives), and every edge between kept nodes. With
 * `descendants`, a chosen group brings its members too.
 */

import { defaultIsMembership, type MembershipTest } from './model/features.js';
import type { SpaceSnapshot } from './model/snapshot.js';

/** Which part of a collection to export. */
export type ExportScope = 'all' | 'filtered' | 'selected';

/** Options of {@link scopeSpace}. */
export interface ScopeOptions {
  readonly scope: ExportScope;
  /** The filtered or selected node ids (ignored for `all`). */
  readonly ids?: Iterable<string>;
  /** Also keep the members (transitively) of chosen groups. Default `false`. */
  readonly descendants?: boolean;
  readonly isMembership?: MembershipTest;
}

/** The part of `space` an export with this scope writes. */
export function scopeSpace(space: SpaceSnapshot, options: ScopeOptions): SpaceSnapshot {
  const { scope, ids = [], descendants = false, isMembership = defaultIsMembership } = options;
  if (scope === 'all') return space;
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string): void => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };
  for (const e of space.edges) {
    if (!isMembership(e.kind)) continue;
    push(parentsOf, e.child, e.parent);
    push(childrenOf, e.parent, e.child);
  }
  const keep = new Set<string>();
  const walk = (start: Iterable<string>, next: (id: string) => string[]): void => {
    const queue = [...start];
    while (queue.length) {
      const id = queue.pop()!;
      for (const n of next(id)) {
        if (!keep.has(n)) {
          keep.add(n);
          queue.push(n);
        }
      }
    }
  };
  const chosen = [...ids];
  for (const id of chosen) keep.add(id);
  if (descendants) walk(chosen, (id) => childrenOf.get(id) ?? []);
  walk([...keep], (id) => parentsOf.get(id) ?? []);
  return {
    nodes: space.nodes.filter((n) => keep.has(n.id)),
    edges: space.edges.filter((e) => keep.has(e.parent) && keep.has(e.child)),
  };
}
