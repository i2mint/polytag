/**
 * `polytag/formats` — text formats (json, yaml, toml, csv, ...).
 *
 * Tag-agnostic: this subpath must never import `@zodal/groups-*` (ADR 0001
 * §Consequences; enforced in CI by `scripts/check-boundaries.mjs`). How a decoded
 * value becomes items and memberships is a *grammar*, which lives in the root entry.
 *
 * extraction candidate: zodal-dials TOML/YAML stores
 *
 * Scaffold only: a real, empty registry over a caller-chosen entry type. The format
 * descriptor (lazy loading, extensions, sniffing), the v1 formats and the loss report
 * are i2mint/polytag#1.
 */

import { createRegistry, type Registry } from '../internal/registry.js';

export type { Registry, RegistryOptions } from '../internal/registry.js';

/** Create an empty format registry; `keyOf` gives each entry's unique key. */
export function createFormatRegistry<F>(keyOf: (format: F) => string): Registry<F> {
  return createRegistry(keyOf, { kind: 'format' });
}
