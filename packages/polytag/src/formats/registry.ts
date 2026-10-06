/**
 * The format registry (keyed by id, looked up by file extension), format sniffing (stage 1 of
 * detection, formats-and-grammars §6.1) and the collection import/export affordances.
 *
 * extraction candidate: a zodal format package (second consumer: zodal-dials TOML/YAML stores)
 */

import { createRegistry, type Registry } from '../internal/registry.js';
import { csv, tsv } from './csv.js';
import { json, jsonc } from './json.js';
import { toml } from './toml.js';
import { type FormatCodec, type FormatDescriptor, type FormatError, tryDecode } from './types.js';
import { yaml } from './yaml.js';

/** A format of any value and option type, as a registry holds them. */
export type AnyFormat = FormatDescriptor<any, any>;

/** The v1 formats, in sniffing tie-break order. */
export const defaultFormats: readonly AnyFormat[] = [json, jsonc, yaml, toml, csv, tsv];

/** A registry of formats keyed by id, with lookup by file extension and lazy loading. */
export interface FormatRegistry extends Registry<AnyFormat> {
  /** The format registered for a file name or extension (`'notes.yml'`, `'.yml'`, `'yml'`). */
  byExtension(fileNameOrExtension: string): AnyFormat | undefined;
  /** Load a format's codec. Throws if the id is not registered. */
  load(id: string, options?: object): Promise<FormatCodec>;
}

/** The lower-case extension (with the dot) of a file name, or of an extension given bare. */
export function extensionOf(fileNameOrExtension: string): string {
  const name = fileNameOrExtension.trim().toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot === -1 ? `.${name}` : name.slice(dot);
}

/**
 * Create a format registry. Default: the v1 formats (json, jsonc, yaml, toml, csv, tsv).
 * Registering two formats with one id, or one extension twice, throws.
 */
export function createFormatRegistry(formats: Iterable<AnyFormat> = defaultFormats): FormatRegistry {
  const registry = createRegistry((f: AnyFormat) => f.id, { kind: 'format' });
  const byExt = new Map<string, AnyFormat>();
  const register = (format: AnyFormat): void => {
    if (registry.has(format.id)) registry.register(format); // throws, naming the registered ids
    const taken = format.extensions.find((e) => byExt.has(e.toLowerCase()));
    if (taken) throw new Error(`Extension '${taken}' is already registered to format '${byExt.get(taken)!.id}'.`);
    registry.register(format);
    for (const e of format.extensions) byExt.set(e.toLowerCase(), format);
  };
  for (const f of formats) register(f);
  return {
    ...registry,
    register,
    byExtension: (name) => byExt.get(extensionOf(name)),
    async load(id, options) {
      const format = registry.get(id);
      if (!format) {
        throw new Error(`Unknown format '${id}'. Registered formats: ${registry.list().map((f) => f.id).join(', ')}.`);
      }
      return format.load(options);
    },
  };
}

/** One format candidate of {@link detectFormat}. */
export interface FormatCandidate {
  readonly format: string;
  /** 0..1 after confirmation (a failed decode divides the sniff score by 10). */
  readonly score: number;
  readonly evidence: readonly string[];
  /** Set when a trial decode was attempted and failed. */
  readonly error?: FormatError;
}

/** The outcome of {@link detectFormat}. */
export interface FormatDetection {
  /** Every format with a non-zero score, best first. */
  readonly candidates: readonly FormatCandidate[];
  /** The best candidate that decoded, with its codec and value; absent when none did. */
  readonly decoded?: { readonly format: string; readonly codec: FormatCodec; readonly value: unknown };
}

/** Options of {@link detectFormat}. */
export interface DetectFormatOptions {
  /** A file name; its extension is strong evidence (score at least 0.9). */
  readonly filename?: string;
  /** Formats to consider. Default: the v1 registry. */
  readonly formats?: FormatRegistry;
  /** Codec options per format id (e.g. `{ yaml: { maxAliasCount: 500 } }`). */
  readonly formatOptions?: Readonly<Record<string, object>>;
}

/** Below this sniff score a format is not worth a trial decode. */
const TRIAL_THRESHOLD = 0.1;
const EXTENSION_SCORE = 0.9;

/**
 * Stage 1 of detection: rank the formats `text` may be in, with evidence, then confirm by
 * decoding the candidates in order until one succeeds (each library loads only when tried).
 * Advisory: it returns a ranked list, never a single verdict.
 */
export async function detectFormat(text: string, options: DetectFormatOptions = {}): Promise<FormatDetection> {
  const { filename, formats = createFormatRegistry(), formatOptions = {} } = options;
  const byFile = filename ? formats.byExtension(filename) : undefined;
  const sniffed = formats.list().map((f): FormatCandidate => {
    const { score, evidence } = f.sniff(text);
    if (f !== byFile) return { format: f.id, score, evidence };
    return { format: f.id, score: Math.max(score, EXTENSION_SCORE), evidence: [`file extension ${extensionOf(filename!)}`, ...evidence] };
  });
  const order = sniffed.filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
  const confirmed: FormatCandidate[] = [];
  let decoded: FormatDetection['decoded'];
  for (const candidate of order) {
    if (decoded || candidate.score < TRIAL_THRESHOLD) {
      confirmed.push(candidate);
      continue;
    }
    const codec = await formats.load(candidate.format, formatOptions[candidate.format]);
    const result = tryDecode(codec, text);
    if (result.ok) {
      decoded = { format: candidate.format, codec, value: result.value };
      confirmed.push({ ...candidate, evidence: [...candidate.evidence, 'decodes'] });
    } else {
      confirmed.push({ ...candidate, score: candidate.score / 10, evidence: [...candidate.evidence, `does not decode: ${result.error.message}`], error: result.error });
    }
  }
  confirmed.sort((a, b) => b.score - a.score);
  return decoded ? { candidates: confirmed, decoded } : { candidates: confirmed };
}

/**
 * The collection affordances for file import and export: the ids of the registered formats,
 * as zodal's `CollectionAffordances.import` / `.export` (`string[]`) expect.
 */
export function ioAffordances(formats: FormatRegistry = createFormatRegistry()): { import: string[]; export: string[] } {
  const ids = formats.list().map((f) => f.id);
  return { import: ids, export: [...ids] };
}

