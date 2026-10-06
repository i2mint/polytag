/**
 * Text in and out: `readText` (detect what is missing, decode, parse; diagnostics, never
 * exceptions), `writeText` (serialise, encode, and the full loss report including the
 * format's own limits and an existing file's comments), `exportChoices` (every compatible
 * grammar for a format, with its loss report, best first) and `roundTrip` (the contract of
 * formats-and-grammars §8.3, used by the gate).
 *
 * The pipeline is the composition of two zodal codecs, format then grammar; `textCodec`
 * returns it as one `Codec<string, ParseResult>` built with `composeCodecs`.
 */

import { type Codec, composeCodecs } from '@zodal/core';
import { type AnyFormat, type FormatCodec, type FormatError, type FormatRegistry, createFormatRegistry, tryDecode } from './formats/index.js';
import { type Detected, detect } from './detect.js';
import type { Diagnostic, GrammarCodec, ParseResult } from './grammar.js';
import { type AnyGrammar, FORMAT_DEFAULTS, type GrammarRegistry, createGrammarRegistry, isCompatible } from './grammars/index.js';
import { type LossReport, type PreviousText, formattingLosses, loss, lossReport, reduce } from './loss.js';
import { type SpaceDiff, type SpaceSnapshot, diffSpaces, emptySpace } from './model/snapshot.js';

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
}

/** What {@link readText} returns. `ok` iff no diagnostic is an error. */
export interface ReadResult extends ParseResult {
  readonly ok: boolean;
  readonly format?: string;
  readonly grammar?: string;
  readonly params?: Readonly<Record<string, unknown>>;
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

/** A format error as a diagnostic (with its position and, for YAML aliases, a hint). */
export function formatDiagnostic(error: FormatError): Diagnostic {
  return {
    severity: 'error',
    code: error.code === 'alias-limit' ? 'alias-limit' : 'format',
    message: error.message,
    ...(error.line !== undefined ? { line: error.line } : {}),
    ...(error.column !== undefined ? { column: error.column } : {}),
    ...(error.code === 'alias-limit' ? { hint: 'pass formatOptions: { yaml: { maxAliasCount: n } } for a trusted file' } : {}),
  };
}

/**
 * Read text into a space. Detects the format and/or grammar when not given; never throws on
 * bad data (format errors, unknown shapes and inconsistencies are diagnostics). Throws only
 * on programmer errors: an unknown format or grammar id, invalid params.
 */
export async function readText(text: string, options: ReadOptions = {}): Promise<ReadResult> {
  const { formats = createFormatRegistry(), grammars = createGrammarRegistry(), formatOptions = {} } = options;
  if (options.format && !formats.has(options.format)) throw new Error(`Unknown format '${options.format}'. Registered: ${formats.list().map((f) => f.id).join(', ')}.`);
  if (options.grammar && !grammars.has(options.grammar)) throw new Error(`Unknown grammar '${options.grammar}'. Registered: ${grammars.list().map((g) => g.id).join(', ')}.`);
  const detection = await detect(text, { filename: options.filename, format: options.format, formats, grammars, formatOptions, previews: options.grammar ? 0 : 3 });
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
  const result = grammar.parse(decoded.value, params);
  return {
    ...result,
    ok: !result.diagnostics.some((d) => d.severity === 'error'),
    format: format.id,
    grammar: grammar.id,
    params,
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
}

/** What {@link writeText} returns. */
export interface WriteResult {
  readonly text: string;
  readonly format: string;
  readonly grammar: string;
  readonly loss: LossReport;
}

function resolvePair(options: WriteOptions): { format: AnyFormat; grammar: AnyGrammar; formats: FormatRegistry } {
  const { formats = createFormatRegistry(), grammars = createGrammarRegistry() } = options;
  const format = formats.get(options.format);
  if (!format) throw new Error(`Unknown format '${options.format}'. Registered: ${formats.list().map((f) => f.id).join(', ')}.`);
  const grammarId = options.grammar ?? FORMAT_DEFAULTS[format.id]?.export ?? grammars.forFormat(format)[0]?.id;
  const grammar = grammarId === undefined ? undefined : grammars.get(grammarId);
  if (!grammar) throw new Error(`Unknown grammar '${grammarId}'. Registered: ${grammars.list().map((g) => g.id).join(', ')}.`);
  if (!isCompatible(grammar, format)) throw new Error(`Grammar '${grammar.id}' cannot write ${format.label}; it writes ${grammar.formats.join(', ')}.`);
  return { format, grammar, formats };
}

/**
 * Write a space as text. The loss report is exact: what the grammar drops (by id), values
 * the format cannot hold (TOML `null`, by path) and, with `previous`, the comments of the
 * file being replaced. Throws a `FormatError` only if the format cannot encode at all.
 */
export async function writeText(space: SpaceSnapshot, options: WriteOptions): Promise<WriteResult> {
  const { format, grammar, formats } = resolvePair(options);
  const { output, loss: grammarLoss } = grammar.serialise(space, options.params, { format: format.id, kind: format.kind, rootArray: format.rootArray });
  const unwritable = format.unrepresentable(output);
  const codec = await formats.load(format.id, options.formatOptions?.[format.id]);
  const previous: PreviousText | undefined = options.previous === undefined ? undefined : { text: options.previous, format };
  return {
    text: codec.encode(output),
    format: format.id,
    grammar: grammar.id,
    loss: lossReport([
      ...grammarLoss.losses,
      loss('format-value', 'drop', unwritable, `${unwritable.length} value(s) cannot be written in ${format.label} and are left out`),
      ...(previous ? formattingLosses(previous) : []),
    ]),
  };
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
 * Every grammar that can write `format`, with the loss report of writing `space` in it, best
 * first: lossless before lossy, then fewer drops, fewer degrades, fewer encodes, then the
 * familiar shape. The first entry is the export default for this dataset's profile.
 */
export function exportChoices(space: SpaceSnapshot, options: Omit<WriteOptions, 'grammar' | 'params'>): ExportChoice[] {
  const { formats = createFormatRegistry(), grammars = createGrammarRegistry() } = options;
  const format = formats.get(options.format);
  if (!format) throw new Error(`Unknown format '${options.format}'. Registered: ${formats.list().map((f) => f.id).join(', ')}.`);
  const previous: PreviousText | undefined = options.previous === undefined ? undefined : { text: options.previous, format };
  const count = (r: LossReport, s: string): number => r.losses.filter((l) => l.severity === s).reduce((n, l) => n + l.count, 0);
  const rank = (id: string): number => (PREFERENCE.includes(id) ? PREFERENCE.indexOf(id) : PREFERENCE.length);
  return grammars
    .forFormat(format)
    .map((g) => {
      const { losses } = reduce(space, g.capabilitiesFor(undefined, format.id));
      return { grammar: g.id, label: g.label, loss: lossReport([...losses, ...(previous ? formattingLosses(previous) : [])]) };
    })
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
  /** What the round trip should give: the space reduced to the grammar's capabilities. */
  readonly expected: SpaceSnapshot;
  readonly read: ReadResult;
  /** `read.space` compared to `expected` (edge order by rank). */
  readonly diff: SpaceDiff;
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
  const reduced = reduce(space, grammar.capabilitiesFor(options.params, format.id)).space;
  // Memberships only the writer knows it drops (a cycle as paths, an implied materialised path).
  const writerDropped = new Set(written.loss.losses.filter((l) => l.severity === 'drop' && (l.kind === 'group-edges' || l.kind === 'membership')).flatMap((l) => l.ids));
  const expected: SpaceSnapshot = { nodes: reduced.nodes, edges: reduced.edges.filter((e) => !writerDropped.has(e.id)) };
  const diff = diffSpaces(expected, read.space);
  return { text: written.text, loss: written.loss, expected, read, diff, ok: read.ok && diff.equal };
}

/**
 * A grammar as a zodal `Codec<unknown, ParseResult>`: `decode` parses a decoded value,
 * `encode` serialises a result's space (its loss report is dropped; use `serialise` or
 * `writeText` to see it).
 */
export function grammarCodec<P extends object>(grammar: GrammarCodec<P>, params?: Partial<P>, ctx: { format?: string; kind?: 'value' | 'table'; rootArray?: boolean } = {}): Codec<unknown, ParseResult> {
  return {
    decode: (value) => grammar.parse(value, params),
    encode: (result) => grammar.serialise(result.space, params, ctx).output,
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
