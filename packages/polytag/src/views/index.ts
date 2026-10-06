/**
 * `polytag/views` — the view menu: how people work with a collection.
 *
 * Tag-agnostic: this subpath must never import `@zodal/groups-*` (ADR 0001
 * §Consequences; enforced in CI by `scripts/check-boundaries.mjs`).
 *
 * extraction candidate: zodal (zodal#14 view generators)
 *
 * Scaffold only: the menu is real but starts empty, and its entry type is a
 * parameter. `ViewConfig`, applicability and the ranked default menu are
 * i2mint/polytag#3.
 */

import { createRegistry, type Identified, type Registry } from '../internal/registry.js';

export type { Registry, Identified } from '../internal/registry.js';

/** Create an empty view menu over view entries of type `V`. */
export function createViewMenu<V extends Identified>(): Registry<V> {
  return createRegistry<V>('view');
}
