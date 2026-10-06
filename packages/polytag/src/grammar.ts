/**
 * The grammar contract: how a decoded value or table becomes items, groups and memberships
 * (a `SpaceSnapshot`), and back.
 *
 * A grammar is `{ id, inputs, formats, params (Zod), capabilities, detect, parse, serialise }`
 * (formats-and-grammars §8.1). `parse` never throws on bad data: problems are
 * `diagnostics` (with a structured `at`), unconsumed input is `residue`. `plan` decides
 * what a write keeps and loses: `reduce` to the capabilities, the target format's value
 * limits, then the grammar's own checks (an id containing its delimiter); `serialise` writes
 * the planned space, and `assess` reports the same plan, so what is shown before writing is
 * exactly what the write does. `defineGrammar` enforces that wiring; a grammar author writes
 * `detect`, `parse`, `write` and, when only the writer can see a loss, `plan`.
 */

import type { z } from 'zod';
import type { FormatKind, Location, ValueLimits } from './formats/index.js';
import { type GrammarCapabilities, type LossReport, type Reduction, limitValues, lossReport, reduce } from './loss.js';
import type { MembershipTest } from './model/features.js';
import type { SpaceSnapshot } from './model/snapshot.js';

/** How serious a diagnostic is. `error`: something could not be read. */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/** What a diagnostic is about. */
export type DiagnosticCode =
  /** The text is not valid in its format. */
  | 'format'
  /** A YAML anchor is aliased more than the decoder allows. */
  | 'alias-limit'
  /** The value does not have the shape this grammar reads. */
  | 'shape'
  /** A record, row or entry has no id. */
  | 'missing-id'
  /** A non-string scalar (YAML's `010` → 10, `yes` → true) was read where an id or tag was expected. */
  | 'coerced-scalar'
  /** The same id appears twice with different content; the first is kept. */
  | 'conflicting-duplicate'
  /** Membership edges form a cycle (kept; the model forbids it on write). */
  | 'cycle'
  /** A reference to an id that is never defined (a bare node is created). */
  | 'unresolved-ref'
  /** An empty tag, path segment or cell token was skipped. */
  | 'empty-token'
  /** A cell is neither a true nor a false value. */
  | 'not-boolean'
  /** A field had an unusable value and was ignored. */
  | 'ignored-field'
  /** No format or grammar could be determined, or the pair is incompatible. */
  | 'undetermined'
  /** The text is larger than `maxBytes`. */
  | 'too-large'
  /** An unexpected failure while reading (a bug: please report it with the input). */
  | 'internal'
  /** A format convention was undone on read (a CSV formula escape `'=…` removed). */
  | 'unescaped'
  /** A check was skipped (a document too deep to check for duplicate keys). */
  | 'unchecked';

/** A problem found while reading, located as precisely as the input allows. */
export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: DiagnosticCode;
  readonly message: string;
  /** JSON pointer (`/2/tags/0`) into a value, or `row N` / `row N, column C` in a table. */
  readonly path?: string;
  /** The same location, structured (`polytag/formats`' `locate(text, format, at)` turns it into a line). */
  readonly at?: Location;
  /** 1-based position in the text, when the format reports one. */
  readonly line?: number;
  readonly column?: number;
  /** Node ids (or a cycle's node path) the diagnostic is about. */
  readonly ids?: readonly string[];
  /** What to do about it. */
  readonly hint?: string;
}

/** Part of the input a grammar did not consume (an unknown top-level key, an unusable row). */
export interface Residue {
  readonly path: string;
  readonly value: unknown;
}

/** What `parse` returns: the space, what was left over, and what went wrong. */
export interface ParseResult<P = unknown> {
  readonly space: SpaceSnapshot<P>;
  readonly residue: readonly Residue[];
  readonly diagnostics: readonly Diagnostic[];
  /** Ids the input declared as records (items with their own entry), for grammars that have records. */
  readonly records?: readonly string[];
  /** Further named group spaces over the same records (the `spaces` param of record grammars). */
  readonly spaces?: Readonly<Record<string, SpaceSnapshot>>;
}

/** A grammar's guess that it can read an input, with evidence and the params it would use. */
export interface Detection<P = Record<string, unknown>> {
  /** 0..1, roughly `0.5·structural + 0.3·name hints + 0.2·integrity` (formats-and-grammars §6.2). */
  readonly score: number;
  readonly evidence: readonly string[];
  readonly suggestedParams: Partial<P>;
  /** Questions only a person can answer (a second list field: another space, or payload?); any makes detection ask. */
  readonly ambiguity?: readonly string[];
}

/** What `detect` may look at besides the decoded input. */
export interface DetectContext {
  /** The format id the input was decoded from. */
  readonly format?: string;
  /** The original text (YAML anchors vanish after parsing; the text still shows them). */
  readonly text?: string;
}

/** What `serialise` needs to know about the target format. */
export interface SerialiseContext {
  /** The target format id (some capabilities depend on it: YAML writes shared objects as anchors). */
  readonly format?: string;
  /** What the target format encodes: a value (JSON/YAML/TOML) or a table (CSV/TSV). Default `value`. */
  readonly kind?: FormatKind;
  /** Whether the target allows a top-level array (TOML does not). Default `true`. */
  readonly rootArray?: boolean;
  /** Values the target format can hold (TOML: no null). Default: everything. */
  readonly limits?: ValueLimits;
  /** Further named spaces to write next to the primary one (record grammars with a `spaces` param); `write` receives them planned. */
  readonly spaces?: Readonly<Record<string, SpaceSnapshot>>;
  readonly isMembership?: MembershipTest;
}

/** What `serialise` returns: the value or table to encode, and what writing it loses. */
export interface SerialiseResult {
  readonly output: unknown;
  readonly loss: LossReport;
}

/** A registered grammar (formats-and-grammars §8.1). */
export interface GrammarCodec<P extends object = object> {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** What it reads: decoded values (JSON/YAML/TOML) and/or tables (CSV/TSV). */
  readonly inputs: readonly FormatKind[];
  /** Compatible format ids (a row of the format × grammar matrix). */
  readonly formats: readonly string[];
  /** Its settings schema; every field has a default. */
  readonly params: z.ZodType<P>;
  /** Capabilities under the default params, format-independent. */
  readonly capabilities: GrammarCapabilities;
  /** Capabilities under these params when writing to this format (and, for some grammars, this space). */
  capabilitiesFor(params?: Partial<P>, format?: string, space?: SpaceSnapshot): GrammarCapabilities;
  /** Full params from partial ones. Throws, naming the grammar, on invalid params. */
  resolveParams(params?: Partial<P>): P;
  /**
   * What writing `space` keeps, and exactly what it loses: `reduce` to the capabilities, the
   * target format's value limits, then the checks only this grammar can make (an id that
   * contains its delimiter). The report (`assess`) and the write (`serialise`) both use it.
   */
  plan(space: SpaceSnapshot, params?: Partial<P>, ctx?: SerialiseContext): Reduction;
  detect(input: unknown, ctx?: DetectContext): Detection<P>;
  parse(input: unknown, params?: Partial<P>): ParseResult;
  serialise(space: SpaceSnapshot, params?: Partial<P>, ctx?: SerialiseContext): SerialiseResult;
}

/** What a grammar author writes; {@link defineGrammar} adds params resolution and the loss wiring. */
export interface GrammarSpec<P extends object> {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly inputs: readonly FormatKind[];
  readonly formats: readonly string[];
  readonly params: z.ZodType<P>;
  readonly capabilities: GrammarCapabilities | ((params: P, format?: string, space?: SpaceSnapshot) => GrammarCapabilities);
  detect(input: unknown, ctx: DetectContext): Detection<P>;
  parse(input: unknown, params: P): ParseResult;
  /**
   * Losses only this grammar can see, after `reduce` and the value limits: return the space it
   * will actually write (offending edges or values taken out) and what that costs. Whatever
   * `write` then receives must read back exactly.
   */
  plan?(space: SpaceSnapshot, params: P, ctx: SerialiseContext): Reduction;
  /** Write a planned space. It must not lose anything more: the plan has said it all. */
  write(space: SpaceSnapshot, params: P, ctx: SerialiseContext): { readonly output: unknown };
}

/** A detection that found nothing. */
export const noDetection = <P>(): Detection<P> => ({ score: 0, evidence: [], suggestedParams: {} });

const clamp = (x: number): number => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

/** Build a {@link GrammarCodec} from its spec. */
export function defineGrammar<P extends object>(spec: GrammarSpec<P>): GrammarCodec<P> {
  const resolveParams = (params: Partial<P> = {}): P => {
    const result = spec.params.safeParse(params);
    if (result.success) return result.data;
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(params)'}: ${i.message}`).join('; ');
    throw new Error(`Invalid params for grammar '${spec.id}': ${issues}`);
  };
  const capsOf = (p: P, format?: string, space?: SpaceSnapshot): GrammarCapabilities =>
    typeof spec.capabilities === 'function' ? spec.capabilities(p, format, space) : spec.capabilities;
  const planWith = (space: SpaceSnapshot, p: P, ctx: SerialiseContext): Reduction => {
    const reduced = reduce(space, capsOf(p, ctx.format, space), { isMembership: ctx.isMembership });
    const limited = ctx.limits ? limitValues(reduced.space, ctx.limits) : { space: reduced.space, losses: [] };
    const own: Reduction = spec.plan ? spec.plan(limited.space, p, ctx) : { space: limited.space, losses: [] };
    return { space: own.space, losses: [...reduced.losses, ...limited.losses, ...own.losses], ...(own.spaces ? { spaces: own.spaces } : {}) };
  };
  return {
    id: spec.id,
    label: spec.label,
    description: spec.description,
    inputs: spec.inputs,
    formats: spec.formats,
    params: spec.params,
    capabilities: capsOf(resolveParams()),
    capabilitiesFor: (params, format, space) => capsOf(resolveParams(params), format, space),
    resolveParams,
    plan: (space, params, ctx = {}) => planWith(space, resolveParams(params), ctx),
    detect(input, ctx = {}) {
      const d = spec.detect(input, ctx);
      return { ...d, score: clamp(d.score) };
    },
    parse: (input, params) => spec.parse(input, resolveParams(params)),
    serialise(space, params, ctx = {}) {
      const p = resolveParams(params);
      const planned = planWith(space, p, ctx);
      const { output } = spec.write(planned.space, p, planned.spaces ? { ...ctx, spaces: planned.spaces } : ctx);
      return { output, loss: lossReport(planned.losses) };
    },
  };
}
