/**
 * `polytag/backends` — the backend menu: where item records (and their content) live.
 *
 * Tag-agnostic: this subpath must never import `@zodal/groups-*` (ADR 0001
 * §Consequences; enforced in CI by `scripts/check-boundaries.mjs`).
 *
 * extraction candidate: zodal (the first consumer without tags)
 *
 * Scaffold only: the catalog is real but starts empty, and its entry type is a
 * parameter. The descriptor type is zodal's `ProviderDescriptor`
 * (i2mint/zodal#16); the catalog itself is i2mint/polytag#2.
 */

import { createRegistry, type Identified, type Registry } from '../internal/registry.js';

export type { Registry, Identified } from '../internal/registry.js';

/** Create an empty backend catalog over descriptors of type `D`. */
export function createBackendCatalog<D extends Identified>(): Registry<D> {
  return createRegistry<D>('backend');
}
