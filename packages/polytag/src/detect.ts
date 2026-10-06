/**
 * Two-stage detection (formats-and-grammars §6): stage 1 sniffs the *format* from the text
 * (and confirms by decoding), stage 2 sniffs the *grammar* from the decoded shape. Both are
 * advisory: they return ranked candidates with evidence and suggested params, and the top
 * grammar candidates are parsed into a one-line preview (groups, items, edges, orphans,
 * multi-parent items, problems) so a person confirms with data rather than a name.
 * `needsConfirmation` follows §6.4: ask when the top score is below 0.6 or the top two are
 * within 0.15 (estimates).
 */

import {
  type FormatCandidate,
  type FormatCodec,
  type FormatDetection,
  type FormatRegistry,
  createFormatRegistry,
  detectFormat,
  tryDecode,
} from './formats/index.js';
import { type GrammarRegistry, createGrammarRegistry } from './grammars/index.js';
import { featuresOf } from './model/features.js';
import type { ParseResult } from './grammar.js';

/** The numbers a person checks before accepting a reading. */
export interface Preview {
  readonly nodes: number;
  readonly groups: number;
  readonly items: number;
  readonly edges: number;
  /** Nodes in no group and with no member. */
  readonly isolated: number;
  readonly multiParentItems: number;
  readonly multiParentGroups: number;
  readonly errors: number;
  readonly warnings: number;
}

/** The preview of a parse. */
export function previewOf(result: ParseResult): Preview {
  const f = featuresOf(result.space);
  const count = (s: string): number => result.diagnostics.filter((d) => d.severity === s).length;
  return {
    nodes: f.nodeCount,
    groups: f.groups.length,
    items: f.items.length,
    edges: f.edgeCount,
    isolated: f.isolated.length,
    multiParentItems: f.multiParentItems.length,
    multiParentGroups: f.multiParentGroups.length,
    errors: count('error'),
    warnings: count('warning'),
  };
}

/** One grammar candidate. */
export interface GrammarCandidate {
  readonly grammar: string;
  readonly score: number;
  readonly evidence: readonly string[];
  /** The params `detect` suggests (merge your own over them). */
  readonly params: Readonly<Record<string, unknown>>;
  /** Present for the top candidates. */
  readonly preview?: Preview;
}

/** The outcome of {@link detect}. */
export interface Detected {
  readonly format: FormatDetection;
  /** Grammar candidates for the decoded format, best first (empty when nothing decoded). */
  readonly grammars: readonly GrammarCandidate[];
  /** Whether to ask the person before reading (formats-and-grammars §6.4). */
  readonly needsConfirmation: boolean;
  readonly reasons: readonly string[];
}

/** Options of {@link detect}. */
export interface DetectOptions {
  /** A file name; its extension is strong format evidence. */
  readonly filename?: string;
  /** Skip stage 1: the text is in this format. */
  readonly format?: string;
  readonly formats?: FormatRegistry;
  readonly grammars?: GrammarRegistry;
  /** Codec options per format id (e.g. `{ yaml: { maxAliasCount: 500 } }`). */
  readonly formatOptions?: Readonly<Record<string, object>>;
  /** How many top candidates get a preview. Default 3. */
  readonly previews?: number;
}

const ASK_BELOW = 0.6;
const ASK_GAP = 0.15;
/** A candidate whose preview has parse errors keeps this share of its score. */
const ERROR_PENALTY = 0.8;

/** Stage 1 for a given format: decode it, as a one-candidate detection. */
async function givenFormat(text: string, id: string, formats: FormatRegistry, options?: object): Promise<FormatDetection> {
  const codec: FormatCodec = await formats.load(id, options);
  const result = tryDecode(codec, text);
  const candidate: FormatCandidate = result.ok
    ? { format: id, score: 1, evidence: ['given'] }
    : { format: id, score: 0, evidence: ['given', `does not decode: ${result.error.message}`], error: result.error };
  return result.ok ? { candidates: [candidate], decoded: { format: id, codec, value: result.value } } : { candidates: [candidate] };
}

/** Detect the format and the grammar of `text`. Never throws on bad data. */
export async function detect(text: string, options: DetectOptions = {}): Promise<Detected> {
  const { filename, formats = createFormatRegistry(), grammars = createGrammarRegistry(), formatOptions = {}, previews = 3 } = options;
  const format = options.format
    ? await givenFormat(text, options.format, formats, formatOptions[options.format])
    : await detectFormat(text, { filename, formats, formatOptions });
  if (!format.decoded) {
    const why = format.candidates[0]?.error?.message ?? 'no format matches';
    return { format, grammars: [], needsConfirmation: true, reasons: [`the text could not be decoded (${why})`] };
  }
  const { value, format: formatId } = format.decoded;
  const descriptor = formats.get(formatId)!;
  const scored = grammars
    .forFormat(descriptor)
    .map((g) => ({ g, d: g.detect(value, { format: formatId, text }) }))
    .filter(({ d }) => d.score > 0)
    .sort((a, b) => b.d.score - a.d.score);
  const candidates: GrammarCandidate[] = scored.map(({ g, d }, i) => {
    const base = { grammar: g.id, score: d.score, evidence: d.evidence, params: d.suggestedParams as Record<string, unknown> };
    if (i >= previews) return base;
    const preview = previewOf(g.parse(value, d.suggestedParams));
    if (!preview.errors) return { ...base, preview };
    return { ...base, preview, score: d.score * ERROR_PENALTY, evidence: [...d.evidence, `${preview.errors} error(s) when parsed`] };
  });
  candidates.sort((a, b) => b.score - a.score);
  const reasons: string[] = [];
  const [top, second] = candidates;
  if (!top) reasons.push(`no grammar recognises this ${descriptor.label} value`);
  else {
    if (top.score < ASK_BELOW) reasons.push(`the best grammar ('${top.grammar}') scores ${top.score.toFixed(2)}, below ${ASK_BELOW}`);
    if (second && top.score - second.score < ASK_GAP) reasons.push(`'${top.grammar}' and '${second.grammar}' are within ${ASK_GAP} of each other`);
  }
  return { format, grammars: candidates, needsConfirmation: reasons.length > 0, reasons };
}
