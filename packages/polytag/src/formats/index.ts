/**
 * `polytag/formats` — text formats (json, yaml, toml, csv, ...) as codecs.
 *
 * Tag-agnostic: this subpath must never import `@zodal/groups-*` (ADR 0001
 * §Consequences; enforced in CI by `scripts/check-boundaries.mjs`). How a decoded
 * value becomes items and memberships is a *grammar*, which lives in the root entry.
 *
 * extraction candidate: zodal-dials TOML/YAML stores
 *
 * Scaffold only: the registry is real but starts empty. The v1 codecs, detection
 * and the loss report arrive with i2mint/polytag#1.
 */

import { createRegistry, type Registry } from '../internal/registry.js';

export type { Registry, Identified } from '../internal/registry.js';

/**
 * A text format: parses text into a plain value and serialises it back.
 *
 * Structurally a `Codec<string, unknown>` from `@zodal/core` (`decode` / `encode`),
 * plus an `id`, so a format can be passed wherever zodal expects a codec.
 */
export interface FormatCodec<TValue = unknown> {
  /** Stable identifier, e.g. `'json'`. */
  readonly id: string;
  /** Parse text into a value. */
  decode(text: string): TValue;
  /** Serialise a value to text. */
  encode(value: TValue): string;
}

/** Create an empty registry of format codecs. */
export function createFormatRegistry(): Registry<FormatCodec> {
  return createRegistry<FormatCodec>('format');
}
