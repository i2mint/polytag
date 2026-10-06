/**
 * The v1 grammar registry, the format × grammar compatibility matrix, and the per-format
 * defaults (formats-and-grammars §8.4, §8.6).
 */

import type { AnyFormat, FormatRegistry } from '../formats/index.js';
import type { GrammarCodec } from '../grammar.js';
import { createRegistry, type Registry } from '../internal/registry.js';
import { delimited } from './delimited.js';
import { edgeRows } from './edge-rows.js';
import { membersMap } from './members.js';
import { nested } from './nested.js';
import { nodeLink } from './node-link.js';
import { oneHot } from './one-hot.js';
import { tagPaths, tagsArray } from './tags.js';

/** A grammar with any params, as a registry holds them. */
export type AnyGrammar = GrammarCodec<any>;

/** The v1 grammars. */
export const defaultGrammars: readonly AnyGrammar[] = [nested, tagsArray, tagPaths, membersMap, edgeRows, delimited, oneHot, nodeLink];

/** A registry of grammars keyed by id. */
export interface GrammarRegistry extends Registry<AnyGrammar> {
  /** The grammars that can read and write `format`. */
  forFormat(format: AnyFormat): AnyGrammar[];
}

/** Can `grammar` read and write `format`? Its `formats` list names it and it reads that format's kind. */
export const isCompatible = (grammar: AnyGrammar, format: AnyFormat): boolean => grammar.formats.includes(format.id) && grammar.inputs.includes(format.kind);

/** Create a grammar registry. Default: the v1 grammars. */
export function createGrammarRegistry(grammars: Iterable<AnyGrammar> = defaultGrammars): GrammarRegistry {
  const registry = createRegistry((g: AnyGrammar) => g.id, { kind: 'grammar' });
  for (const g of grammars) registry.register(g);
  return { ...registry, forFormat: (format) => registry.list().filter((g) => isCompatible(g, format)) };
}

/** The format × grammar matrix: for each grammar id, the ids of the formats it can use. */
export function compatibility(grammars: GrammarRegistry, formats: FormatRegistry): Record<string, string[]> {
  return Object.fromEntries(grammars.list().map((g) => [g.id, formats.list().filter((f) => isCompatible(g, f)).map((f) => f.id)]));
}

/**
 * Per-format defaults (formats-and-grammars §8.4): the import default is the shape people
 * already have; the export default is the lossless grammar.
 */
export const FORMAT_DEFAULTS: Readonly<Record<string, { readonly import: string; readonly export: string }>> = {
  json: { import: 'nested', export: 'node-link' },
  jsonc: { import: 'nested', export: 'node-link' },
  yaml: { import: 'nested', export: 'node-link' },
  toml: { import: 'tags-array', export: 'edge-rows' },
  csv: { import: 'delimited', export: 'edge-rows' },
  tsv: { import: 'delimited', export: 'edge-rows' },
};

export { delimited, edgeRows, membersMap, nested, nodeLink, oneHot, tagPaths, tagsArray };
export { delimitedParams, type DelimitedParams } from './delimited.js';
export { edgeRowsParams, type EdgeRowsParams } from './edge-rows.js';
export { membersMapParams, type MembersMapParams } from './members.js';
export { nestedParams, type NestedParams } from './nested.js';
export { nodeLinkParams, type NodeLinkParams } from './node-link.js';
export { oneHotParams, type OneHotParams } from './one-hot.js';
export { tagPathsParams, tagsArrayParams, type TagPathsParams, type TagsArrayParams } from './tags.js';
