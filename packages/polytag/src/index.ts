/**
 * `polytag` — headless CRUD for tag-based collections.
 *
 * The root entry is the tag-aware tier. "Data in" (i2mint/polytag#1): grammars turn a
 * decoded value or table into items, groups and memberships (a `SpaceSnapshot`: flat nodes
 * and edges, structurally zodal-groups' `Node` / `Edge`), and back, with a loss report
 * computed before writing; two-stage detection; `readText` / `writeText` over the formats of
 * `polytag/formats`; an import plan (dry run) and export scopes.
 *
 * ```ts
 * const read = await readText(text, { filename: 'recipes.yaml' }); // detects format and grammar
 * exportChoices(read.space, { format: 'csv' });                    // grammars, best first, with losses
 * const { text: csv, loss } = await writeText(read.space, { format: 'csv', grammar: 'delimited' });
 * ```
 *
 * The tag-agnostic parts are the subpaths `polytag/formats`, `polytag/backends` and
 * `polytag/views`. This entry imports them, never the reverse, and does not re-export their
 * shared modules (tsup would hoist those declarations here and make the subpaths' types
 * import the root, which `scripts/check-boundaries.mjs` rejects).
 */

export {
  CONTAINS,
  type FamilyRule,
  type SnapshotEdge,
  type SnapshotNode,
  type SpaceDiff,
  type SpaceSnapshot,
  compareOrder,
  contentHash,
  defaultEdgeId,
  diffSpaces,
  edgeIdMinter,
  emptySpace,
  findCycles,
  positionalOrders,
  sameValue,
  snapshotOf,
  stableStringify,
} from './model/snapshot.js';
export { type FeaturesOptions, type MembershipTest, type SpaceFeatures, defaultIsMembership, featuresOf } from './model/features.js';
export {
  type ConventionFeature,
  type GrammarCapabilities,
  type Loss,
  type LossKind,
  type LossReport,
  type LossSeverity,
  type PreviousText,
  type Reduction,
  type Support,
  formattingLosses,
  limitValues,
  lossReport,
  reduce,
} from './loss.js';
export {
  type DetectContext,
  type Detection,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticSeverity,
  type GrammarCodec,
  type GrammarSpec,
  type ParseResult,
  type Residue,
  type SerialiseContext,
  type SerialiseResult,
  defineGrammar,
  noDetection,
} from './grammar.js';
export * from './grammars/index.js';
export { type DetectOptions, type Detected, type GrammarCandidate, type Preview, detect, previewOf } from './detect.js';
export {
  type AssessOptions,
  type ExportChoice,
  type IoOptions,
  type ReadOptions,
  type ReadResult,
  type RoundTrip,
  type WriteOptions,
  type WriteResult,
  DEFAULT_MAX_BYTES,
  assess,
  exceedsBytes,
  exportChoices,
  formatDiagnostic,
  grammarCodec,
  readText,
  roundTrip,
  textCodec,
  writeText,
} from './io.js';
export {
  type ApplyResult,
  type ConflictPolicy,
  type ConflictResolution,
  type ImportAction,
  type ImportDelta,
  type ImportField,
  type ImportPlan,
  type PlanOptions,
  type PlanEntry,
  applyImport,
  edgeHash,
  nodeHash,
  planImport,
} from './import-plan.js';
export { type ExportScope, type ScopeOptions, scopeSpace } from './scope.js';
export { type CollectionSeed, type SeedOptions, fromCollectionSeed, toCollectionSeed } from './collection-seed.js';
