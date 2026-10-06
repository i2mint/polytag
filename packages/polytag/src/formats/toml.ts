/**
 * TOML format, over `smol-toml` (BSD-3-Clause; TOML 1.1, passes `toml-test`), loaded on
 * first use.
 *
 * TOML has no `null` and its document must be a table (formats-and-grammars §3(m), §5.3).
 * `smol-toml` silently drops `null` object values and throws an unhelpful `TypeError` on a
 * `null` inside an array (measured), so this codec strips every `null`/`undefined` itself
 * and `unrepresentable()` lists their paths for the caller's loss report.
 *
 * extraction candidate: a zodal format package (second consumer: zodal-dials TOML/YAML stores)
 */

import { tomlComments } from './comments.js';
import { type FormatCodec, type FormatDescriptor, FormatError, type FormatSniff, asFormatError, sniffLines } from './types.js';
import { findPaths, isPlainObject, stripValues } from './values.js';

/** Options of the `toml` codec (none yet). */
export type TomlOptions = Record<string, never>;

type TomlLib = typeof import('smol-toml');
let tomlLib: Promise<TomlLib> | undefined;
const loadToml = (): Promise<TomlLib> => (tomlLib ??= import('smol-toml'));

const isNullish = (v: unknown): boolean => v === null || v === undefined;
const HEADER = /^\s*\[\[?[\w."' -]+\]\]?\s*(#.*)?$/;
const KEY_VALUE = /^\s*[\w."'-]+\s*=\s*\S/;

/** TOML, read and written with `smol-toml`. */
export const toml: FormatDescriptor<unknown, TomlOptions> = {
  id: 'toml',
  label: 'TOML',
  extensions: ['.toml'],
  mediaTypes: ['application/toml'],
  kind: 'value',
  rootArray: false,
  limits: { null: false, nonFinite: true },
  sniff(text): FormatSniff {
    const lines = sniffLines(text).filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
    if (!lines.length) return { score: 0, evidence: [] };
    const headers = lines.filter((l) => HEADER.test(l)).length;
    const pairs = lines.filter((l) => KEY_VALUE.test(l)).length;
    const ratio = (headers + pairs) / lines.length;
    if (ratio === 0) return { score: 0, evidence: [] };
    const evidence = [`${headers + pairs} of ${lines.length} lines are \`[table]\` headers or \`key = value\` pairs`];
    return { score: Math.min(0.9, 0.3 + 0.6 * ratio + (headers ? 0.1 : 0)), evidence };
  },
  inspect: (text) => ({ comments: tomlComments(text) }),
  unrepresentable: (value) => findPaths(value, isNullish),
  async load(): Promise<FormatCodec> {
    const lib = await loadToml();
    return {
      format: 'toml',
      decode(text) {
        try {
          return lib.parse(text);
        } catch (error) {
          const { line, column } = (error ?? {}) as { line?: number; column?: number };
          const message = error instanceof Error ? error.message.split('\n')[0]! : String(error);
          throw new FormatError('toml', message, { line, column, cause: error });
        }
      },
      encode(value) {
        if (!isPlainObject(value)) {
          throw new FormatError('toml', `a TOML document must be a table, not ${Array.isArray(value) ? 'an array' : typeof value}`, {
            code: 'shape',
          });
        }
        try {
          return lib.stringify(stripValues(value, isNullish) as Record<string, unknown>);
        } catch (error) {
          throw asFormatError('toml', error, 'value');
        }
      },
    };
  },
};
