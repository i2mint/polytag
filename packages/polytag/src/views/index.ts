/**
 * `polytag/views` — the view menu: how people work with a collection.
 *
 * Tag-agnostic: this subpath must never import `@zodal/groups-*` (ADR 0001
 * §Consequences; enforced in CI by `scripts/check-boundaries.mjs`).
 *
 * extraction candidate: zodal (zodal#14 view generators)
 *
 * Scaffold only: a real, empty menu over a caller-chosen view type. `ViewConfig`,
 * applicability and the ranked default menu are i2mint/polytag#3.
 */

import { createRegistry, type Registry } from '../internal/registry.js';

export type { Registry, RegistryOptions } from '../internal/registry.js';

/** Create an empty view menu; `keyOf` gives each view's unique key. */
export function createViewMenu<V>(keyOf: (view: V) => string): Registry<V> {
  return createRegistry(keyOf, { kind: 'view' });
}
