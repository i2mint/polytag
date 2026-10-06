/**
 * Text in and out: `readText` (detect what is missing, decode, parse; diagnostics, never
 * exceptions), `writeText` (serialise, encode, and the full loss report), `assess` (that
 * report without writing), `exportChoices` (every compatible grammar for a format, with its
 * report, best first) and `roundTrip` (the contract of formats-and-grammars §8.3, used by
 * the gate).
 *
 * **One report.** `assess`, `exportChoices` and `writeText` all go through `prepare`: the
 * grammar's `plan` (capabilities, the format's value limits, the grammar's own checks), the
 * grammar's write, then what the format adds (values it cannot hold, values it escapes, an
 * existing file's comments). So what a person is shown before writing is what the write does,
 * and `roundTrip` checks the read against that same plan.
 *
 * The pipeline is the composition of two zodal codecs, format then grammar; `textCodec`
 * returns it as one `Codec<string, ParseResult>` built with `composeCodecs`.
 */

import { type Codec, composeCodecs } from '@zodal/core';
import {
  type AnyFormat,
  type FormatCodec,
  type FormatError,
  type FormatErrorInfo,
  type FormatRegistry,
  createFormatRegistry,
  tryDecode,
} from './formats/index.js';
import { type Detected, detectWithParses } from './detect.js';
import type { Diagnostic, GrammarCodec, ParseResult, SerialiseContext } from './grammar.js';
import { type AnyGrammar, FORMAT_DEFAULTS, type GrammarRegistry, createGrammarRegistry, isCompatible } from './grammars/index.js';
import { type LossReport, type PreviousText, formattingLosses, loss, lossReport } from './loss.js';
import type { MembershipTest } from './model/features.js';
import { type SpaceDiff, type SpaceSnapshot, diffSpaces, emptySpace, stableStringify } from './model/snapshot.js';

/** The default `maxBytes` of `readText` / `detect`: 32 MiB. */
export const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

/** Registries and codec options shared by the functions here. */
export interface IoOptions {
  readonly formats?: FormatRegistry;
  readonly grammars?: GrammarRegistry;
  /** Codec options per format id (e.g. `{ yaml: { maxAliasCount: 500 } }`). */
  readonly formatOptions?: Readonly<Record<string, object>>;
}

/** Options of {@link readText}. */
export interface ReadOptions extends IoOptions {
  /** A file name; its extension is strong format evidence. */
  readonly filename?: string;
  /** The format id; detected when absent. */
  readonly format?: string;
  /** The grammar id; detected when absent. */
  readonly grammar?: string;
  /** Grammar params, merged over the detected ones. */
  readonly params?: Readonly<Record<string, unknown>>;
  /**
   * Refuse (with a `too-large` diagnostic) a text over this many UTF-8 bytes. Default
   * {@link DEFAULT_MAX_BYTES}. Parsing is synchronous and some parsers are super-linear on
   * hostile input, so a page should also parse in a Web Worker.
   */
  readonly maxBytes?: number;
}

/** What {@link readText} returns. `ok` iff no diagnostic is an error. */
export interface ReadResult extends ParseResult {
  readonly ok: boolean;
  readonly format?: string;
  readonly grammar?: string;
  readonly params?: Readonly<Record<string, unknown>>;
  /** The format options that reproduce this text's dialect (a CSV delimiter, a YAML version): pass them back to `writeText`. */
  readonly formatOptions?: Readonly<Record<string, unknown>>;
  /** Present when anything was detected. */
  readonly detection?: Detected;
}

const failed = (diagnostic: Diagnostic, extra: Partial<ReadResult> = {}): ReadResult => ({
  ok: false,
  space: emptySpace(),
  residue: [],
  diagnostics: [diagnostic],
  ...extra,
});

const internal = (stage: string, error: unknown): Diagnostic => ({
  severity: 'error',
  code: 'internal',
  message: `unexpected failure while ${stage}: ${error instanceof Error ? error.message : String(error)}`,
  hint: 'this is a bug; please report it with the input',
});

/** A format error as a diagnostic (with its position and, for YAML aliases, a hint). */
export function formatDiagnostic(error: FormatError | FormatErrorInfo): Diagnostic {
  return {
    severity: 'error',
    code: error.code === 'alias-limit' ? 'alias-limit' : 'format',
    message: error.message,
    ...(error.line !== undefined ? { line: error.line } : {}),
    ...(error.column !== undefined ? { column: error.column } : {}),
    ...(error.code === 'alias-limit' ? { hint: 'pass formatOptions: { yaml: { maxAliasCount: n } } for a trusted file' } : {}),
  };
}

/** Is `text` over `maxBytes` UTF-8 bytes? (Cheap when it clearly is or clearly is not.) */
export function exceedsBytes(text: string, maxBytes: number): boolean {
  if (text.length > maxBytes) return true;
  if (text.length * 3 <= maxBytes) return false;
  return new TextEncoder().encode(text).length > maxBytes;
}

/**
 * Read text into a space. Detects the format and/or grammar when not given; never throws on
 * bad data (format errors, unknown shapes, inconsistencies, and any unexpected failure are
 * diagnostics). Throws only on programmer errors: an unknown format or grammar id, invalid
 * params.
 */
export async function readText(text: string, options: ReadOptions = {}): Promise<ReadResult> {
  const { formats = createFormatRegistry(), grammars = createGrammarRegistry(), formatOptions = {}, maxBytes = DEFAULT_MAX_BYTES } = options;
  if (options.format && !formats.has(options.format)) throw new Error(`Unknown format '${options.format}'. Registered: ${formats.list().map((f) => f.id).join(', ')}.`);
  if (options.grammar && !grammars.has(options.grammar)) throw new Error(`Unknown grammar '${options.grammar}'. Registered: ${grammars.list().map((g) => g.id).join(', ')}.`);
  if (exceedsBytes(text, maxBytes)) {
    return failed({ severity: 'error', code: 'too-large', message: `the text is larger than maxBytes (${maxBytes} bytes)`, hint: 'raise maxBytes for a trusted file' });
  }
  let detected: Awaited<ReturnType<typeof detectWithParses>>;
  try {
    detected = await detectWithParses(text, { filename: options.filename, format: options.format, formats, grammars, formatOptions, previews: options.grammar ? 0 : 3, maxBytes });
  } catch (error) {
    return failed(internal('detecting the format and grammar', error));
  }
  const { detection, parsed } = detected;
  const decoded = detection.format.decoded;
  if (!decoded) {
    const error = detection.format.candidates.find((c) => c.error)?.error;
    return error
      ? failed(formatDiagnostic(error), { format: options.format, detection })
      : failed({ severity: 'error', code: 'undetermined', message: 'the format of the text could not be determined', hint: 'pass the format option' }, { detection });
  }
  const format = formats.get(decoded.format)!;
  const grammarId = options.grammar ?? detection.grammars[0]?.grammar;
  if (!grammarId) {
    return failed({ severity: 'error', code: 'undetermined', message: `no grammar recognises this ${format.label} value`, hint: 'pass the grammar option' }, { format: format.id, detection });
  }
  const grammar = grammars.get(grammarId)!;
  if (!isCompatible(grammar, format)) {
    return failed(
      { severity: 'error', code: 'undetermined', message: `grammar '${grammar.id}' does not read ${format.label}; it reads ${grammar.formats.join(', ')}` },
      { format: format.id, grammar: grammar.id, detection },
    );
  }
  const suggested = detection.grammars.find((c) => c.grammar === grammar.id)?.params ?? {};
  const params = { ...suggested, ...options.params };
  grammar.resolveParams(params); // invalid params are a programmer error: throw here, not in the catch below
  const reuse = parsed.get(grammar.id);
  let result: ParseResult;
  try {
    result = reuse && stableStringify(reuse.params) === stableStringify(params) ? reuse.result : grammar.parse(decoded.value, params);
  } catch (error) {
    return failed(internal(`reading the ${grammar.id} grammar`, error), { format: format.id, grammar: grammar.id, params, detection });
  }
  const extra: Diagnostic[] = [];
  let dialect: Record<string, unknown> | undefined;
  try {
    const codes = { 'duplicate-key': ['warning', 'conflicting-duplicate'], unchecked: ['info', 'unchecked'], unescaped: ['info', 'unescaped'] } as const;
    for (const w of decoded.codec.warnings?.(text) ?? []) {
      const [severity, code] = codes[w.code];
      const path = 'pointer' in w.at ? w.at.pointer : `row ${w.at.row}${w.at.column !== undefined ? `, column ${w.at.column}` : ''}`;
      extra.push({ severity, code, message: w.message, path, at: w.at });
    }
    dialect = decoded.codec.dialect?.(text);
  } catch (error) {
    extra.push(internal('inspecting the text', error));
  }
  const diagnostics = [...extra, ...result.diagnostics];
  return {
    ...result,
    diagnostics,
    ok: !diagnostics.some((d) => d.severity === 'error'),
    format: format.id,
    grammar: grammar.id,
    params,
    ...(dialect ? { formatOptions: dialect } : {}),
    detection,
  };
}

/** Options of {@link writeText}. */
export interface WriteOptions extends IoOptions {
  /** The format id. */
  readonly format: string;
  /** The grammar id. Default: the format's lossless export default (formats-and-grammars §8.4). */
  readonly grammar?: string;
  readonly params?: Readonly<Record<string, unknown>>;
  /** The existing text this write replaces: its comments and layout are reported as `formatting` loss. */
  readonly previous?: string;
  /** Further named spaces, for record grammars with a `spaces` param. */
  readonly spaces?: SerialiseContext['spaces'];
  readonly isMembership?: MembershipTest;
}

/** What {@link writeText} returns. */
export interface WriteResult {
  readonly text: string;
  readonly format: string;
  readonly grammar: string;
  readonly loss: LossReport;
}

function resolvePair(options: { format: string; grammar?: string; formats?: FormatRegistry; grammars?: GrammarRegistry }): { format: AnyFormat; grammar: AnyGrammar; formats: FormatRegistry } {
  const { formats = createFormatRegistry(), grammars = createGrammarRegistry() } = options;
  const format = formats.get(options.format);
  if (!format) throw new Error(`Unknown format '${options.format}'. Registered: ${formats.list().map((f) => f.id).join(', ')}.`);
  const grammarId = options.grammar ?? FORMAT_DEFAULTS[format.id]?.export ?? grammars.forFormat(format)[0]?.id;
  const grammar = grammarId === undefined ? undefined : grammars.get(grammarId);
  if (!grammar) throw new Error(`Unknown grammar '${grammarId}'. Registered: ${grammars.list().map((g) => g.id).join(', ')}.`);
  if (!isCompatible(grammar, format)) throw new Error(`Grammar '${grammar.id}' cannot write ${format.label}; it writes ${grammar.formats.join(', ')}.`);
  return { format, grammar, formats };
}

/** The serialise context for a format. */
const contextFor = (format: AnyFormat, options: { spaces?: SerialiseContext['spaces']; isMembership?: MembershipTest }): SerialiseContext => ({
  format: format.id,
  kind: format.kind,
  rootArray: format.rootArray,
  limits: format.limits,
  ...(options.spaces ? { spaces: options.spaces } : {}),
  ...(options.isMembership ? { isMembership: options.isMembership } : {}),
});

/** The one path to a report: plan + write, then what the format adds. Sync, in memory. */
function prepare(
  space: SpaceSnapshot,
  grammar: AnyGrammar,
  format: AnyFormat,
  options: { params?: Readonly<Record<string, unknown>>; previous?: string; formatOptions?: Readonly<Record<string, object>>; spaces?: SerialiseContext['spaces']; isMembership?: MembershipTest },
): { output: unknown; loss: LossReport } {
  const { output, loss: grammarLoss } = grammar.serialise(space, options.params, contextFor(format, options));
  const unwritable = format.unrepresentable(output);
  const escaped = format.escapes?.(output, options.formatOptions?.[format.id]) ?? [];
  const previous: PreviousText | undefined = options.previous === undefined ? undefined : { text: options.previous, format };
  return {
    output,
    loss: lossReport([
      ...grammarLoss.losses,
      loss('format-value', 'drop', unwritable, `${unwritable.length} value(s) cannot be written in ${format.label} and are left out`),
      loss('format-value', 'encode', escaped, `${escaped.length} cell(s) that a spreadsheet would run as a formula are written with a leading ' (read back without it)`),
      ...(previous ? formattingLosses(previous) : []),
    ]),
  };
}

/** Options of {@link assess}. */
export interface AssessOptions<P extends object> {
  readonly params?: Partial<P>;
  /** The target format (an id or a descriptor). Without it, only the grammar's own losses. */
  readonly format?: string | AnyFormat;
  readonly formats?: FormatRegistry;
  readonly formatOptions?: Readonly<Record<string, object>>;
  /** The existing text a write would replace: its comments and layout are reported as `formatting` loss. */
  readonly previous?: string;
  readonly spaces?: SerialiseContext['spaces'];
  readonly isMembership?: MembershipTest;
}

/**
 * The loss report of writing `space` in `grammar` (and format), computed **before** writing
 * and identical to what `writeText` reports: every dropped, degraded or encoded id.
 */
export function assess<P extends object>(space: SpaceSnapshot, grammar: GrammarCodec<P>, options: AssessOptions<P> = {}): LossReport {
  const { format, formats = createFormatRegistry() } = options;
  const descriptor = typeof format === 'string' ? formats.get(format) : format;
  if (typeof format === 'string' && !descriptor) throw new Error(`Unknown format '${format}'. Registered: ${formats.list().map((f) => f.id).join(', ')}.`);
  if (!descriptor) return lossReport(grammar.plan(space, options.params, { isMembership: options.isMembership }).losses);
  return prepare(space, grammar as AnyGrammar, descriptor, options as Parameters<typeof prepare>[3]).loss;
}

/**
 * Write a space as text. The loss report is exact and is the one `assess` gives: what the
 * grammar drops (by id), values the format cannot hold, cells it escapes and, with
 * `previous`, the comments of the file being replaced. Throws a `FormatError` only if the
 * format cannot encode at all (a BigInt in JSON).
 */
export async function writeText(space: SpaceSnapshot, options: WriteOptions): Promise<WriteResult> {
  const { format, grammar, formats } = resolvePair(options);
  const { output, loss: report } = prepare(space, grammar, format, options);
  const codec = await formats.load(format.id, options.formatOptions?.[format.id]);
  return { text: codec.encode(output), format: format.id, grammar: grammar.id, loss: report };
}

/** One export option. */
export interface ExportChoice {
  readonly grammar: string;
  readonly label: string;
  readonly loss: LossReport;
}

/** Preference among equally lossy grammars: familiar shapes first (formats-and-grammars §8.5). */
const PREFERENCE = ['tags-array', 'delimited', 'tag-paths', 'nested', 'one-hot', 'members-map', 'node-link', 'edge-rows'];

/**
 * Every grammar that can write `format`, with the loss report of writing `space` in it (the
 * same report `writeText` gives), best first: lossless before lossy, then fewer drops, fewer
 * degrades, fewer encodes, then the familiar shape.
 */
export function exportChoices(space: SpaceSnapshot, options: Omit<WriteOptions, 'grammar' | 'params'>): ExportChoice[] {
  const { formats = createFormatRegistry(), grammars = createGrammarRegistry() } = options;
  const format = formats.get(options.format);
  if (!format) throw new Error(`Unknown format '${options.format}'. Registered: ${formats.list().map((f) => f.id).join(', ')}.`);
  const count = (r: LossReport, s: string): number => r.losses.filter((l) => l.severity === s).reduce((n, l) => n + l.count, 0);
  const rank = (id: string): number => (PREFERENCE.includes(id) ? PREFERENCE.indexOf(id) : PREFERENCE.length);
  return grammars
    .forFormat(format)
    .map((g) => ({ grammar: g.id, label: g.label, loss: prepare(space, g, format, options).loss }))
    .sort(
      (a, b) =>
        Number(b.loss.lossless) - Number(a.loss.lossless) ||
        count(a.loss, 'drop') - count(b.loss, 'drop') ||
        count(a.loss, 'degrade') - count(b.loss, 'degrade') ||
        count(a.loss, 'encode') - count(b.loss, 'encode') ||
        rank(a.grammar) - rank(b.grammar),
    );
}

/** The outcome of {@link roundTrip}. */
export interface RoundTrip {
  readonly text: string;
  readonly loss: LossReport;
  /** What the round trip should give: the grammar's plan of the space for this format. */
  readonly expected: SpaceSnapshot;
  readonly read: ReadResult;
  /** `read.space` compared to `expected` (edge order by rank). */
  readonly diff: SpaceDiff;
  /** Each planned secondary space compared to the one read back. */
  readonly spaceDiffs?: Readonly<Record<string, SpaceDiff>>;
  /** The read has no error and matches `expected`. */
  readonly ok: boolean;
}

/**
 * Write `space` and read it back with the same format, grammar and params; compare with
 * what the loss report predicts (formats-and-grammars §8.3). `ok` means the loss report told
 * the whole truth: nothing was lost beyond it, and nothing it kept changed.
 */
export async function roundTrip(space: SpaceSnapshot, options: WriteOptions): Promise<RoundTrip> {
  const { format, grammar, formats } = resolvePair(options);
  const written = await writeText(space, { ...options, format: format.id, grammar: grammar.id });
  // Read with exactly the writer's params: no detection, no suggested params.
  const decoded = tryDecode(await formats.load(format.id, options.formatOptions?.[format.id]), written.text);
  const parsed = decoded.ok ? grammar.parse(decoded.value, options.params) : undefined;
  const read: ReadResult = parsed
    ? { ...parsed, ok: !parsed.diagnostics.some((d) => d.severity === 'error'), format: format.id, grammar: grammar.id, params: options.params }
    : failed(formatDiagnostic((decoded as { error: FormatError }).error), { format: format.id, grammar: grammar.id });
  const planned = grammar.plan(space, options.params, contextFor(format, options));
  const expected = planned.space;
  const diff = diffSpaces(expected, read.space);
  const spaceDiffs = planned.spaces
    ? Object.fromEntries(Object.entries(planned.spaces).map(([name, s]) => [name, diffSpaces(s, read.spaces?.[name] ?? emptySpace())]))
    : undefined;
  const ok = read.ok && diff.equal && Object.values(spaceDiffs ?? {}).every((d) => d.equal);
  return { text: written.text, loss: written.loss, expected, read, diff, ...(spaceDiffs ? { spaceDiffs } : {}), ok };
}

/**
 * A grammar as a zodal `Codec<unknown, ParseResult>`: `decode` parses a decoded value,
 * `encode` serialises a result's space (its loss report is dropped; use `assess` or
 * `writeText` to see it).
 */
export function grammarCodec<P extends object>(grammar: GrammarCodec<P>, params?: Partial<P>, ctx: SerialiseContext = {}): Codec<unknown, ParseResult> {
  return {
    decode: (value) => grammar.parse(value, params),
    encode: (result) => grammar.serialise(result.space, params, { ...ctx, ...(result.spaces ? { spaces: result.spaces } : {}) }).output,
  };
}

/**
 * Text ↔ space as one zodal codec: `composeCodecs(format, grammar)`. `decode` throws the
 * format's `FormatError` on invalid text; everything after is diagnostics.
 */
export function textCodec<V, P extends object>(
  format: FormatCodec<V>,
  grammar: GrammarCodec<P>,
  params?: Partial<P>,
  ctx: { kind?: 'value' | 'table'; rootArray?: boolean } = {},
): Codec<string, ParseResult> {
  // The grammar writes the value or table shape this format encodes (its `kind`).
  return composeCodecs(format, grammarCodec(grammar, params, { format: format.format, ...ctx }) as Codec<V, ParseResult>);
}

