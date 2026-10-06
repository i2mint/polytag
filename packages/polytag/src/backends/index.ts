/**
 * `polytag/backends` — the backend menu: where item records (and their content) live.
 *
 * Tag-agnostic: this subpath must never import `@zodal/groups-*` (ADR 0001
 * §Consequences; enforced in CI by `scripts/check-boundaries.mjs`). Membership modes
 * (embedded ids vs a `GroupStore`) depend on zodal-groups, so they belong to the root
 * entry, not here.
 *
 * extraction candidate: zodal (the first consumer without tags)
 *
 * Scaffold only: a real, empty catalog over a caller-chosen descriptor type, e.g.
 * `createBackendCatalog<ProviderDescriptor>((d) => d.name)` once zodal's
 * `ProviderDescriptor` exists (i2mint/zodal#16). The catalog itself is i2mint/polytag#2.
 */

import { createRegistry, type Registry } from '../internal/registry.js';

export type { Registry, RegistryOptions } from '../internal/registry.js';

/** Create an empty backend catalog; `keyOf` gives each descriptor's unique key. */
export function createBackendCatalog<D>(keyOf: (descriptor: D) => string): Registry<D> {
  return createRegistry(keyOf, { kind: 'backend' });
}
