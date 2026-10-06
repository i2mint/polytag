/**
 * `polytag/formats` — text formats: json, jsonc, yaml, toml, csv, tsv.
 *
 * Each format is a {@link FormatDescriptor} registered by id and file extension; `load()`
 * imports its parser library on first use and resolves to a zodal `Codec<string, V>` whose
 * `decode` and `encode` both throw {@link FormatError}. `detectFormat` is stage 1 of
 * detection (sniff, then confirm by decoding); `ioAffordances` exposes the registered
 * formats as zodal's `import`/`export` collection affordances.
 *
 * Tag-agnostic: this subpath must never import `@zodal/groups-*` (ADR 0001 §Consequences;
 * enforced in CI by `scripts/check-boundaries.mjs`). How a decoded value becomes items and
 * memberships is a *grammar*, which lives in the root entry.
 *
 * extraction candidate: a zodal format package (second consumer: zodal-dials TOML/YAML stores)
 */

export {
  type DecodeResult,
  type FormatCodec,
  type FormatDescriptor,
  FormatError,
  type FormatErrorCode,
  type FormatErrorInfo,
  type FormatWarning,
  type Location,
  type ValueLimits,
  isFormatError,
  type FormatKind,
  type FormatSniff,
  type FormattingInfo,
  type FoundComment,
  type Table,
  isTable,
  tryDecode,
} from './types.js';
export {
  type AnyFormat,
  type DetectFormatOptions,
  type FormatCandidate,
  type FormatDetection,
  type FormatRegistry,
  createFormatRegistry,
  defaultFormats,
  detectFormat,
  extensionOf,
  ioAffordances,
  locate,
} from './registry.js';
export { json, jsonc, type JsonOptions } from './json.js';
export { yaml, type YamlOptions } from './yaml.js';
export { toml, type TomlOptions } from './toml.js';
export { DEFAULT_MAX_LINE_LENGTH, csv, tsv, type CsvOptions } from './csv.js';
export { hashComments, slashComments, tomlComments, yamlComments } from './comments.js';
export { findPaths, isPlainObject, stripValues } from './values.js';
export type { Registry, RegistryOptions } from '../internal/registry.js';
