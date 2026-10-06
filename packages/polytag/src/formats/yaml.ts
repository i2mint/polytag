/**
 * YAML format, over `yaml` (eemeli; ISC), loaded on first use.
 *
 * Measured traps this codec handles (formats-and-grammars §3(a), §5.2):
 * - YAML 1.2 is the default, so `010` reads as the number 10 (a grammar reports it when a
 *   tag or id was expected); the writer quotes ambiguous strings (`"010"`, `"yes"`).
 * - One anchor aliased more than `maxAliasCount` times (default 100, the library's
 *   resource-exhaustion guard) fails with a `FormatError` of code `alias-limit`; raise the
 *   option for a trusted file.
 * - Duplicate keys are an error (JSON would silently keep the last).
 * - Repeated object identity is written as anchor + alias, so a shared sub-object (an item in
 *   two groups) round-trips as a reference, not a copy.
 *
 * extraction candidate: a zodal format package (second consumer: zodal-dials TOML/YAML stores)
 */

import { hashComments } from './comments.js';
import { type FormatCodec, type FormatDescriptor, FormatError, type FormatSniff, asFormatError, firstChar } from './types.js';

/** Options of the `yaml` codec. */
export interface YamlOptions {
  /** YAML version for reading and writing. Default `'1.2'` (in 1.1, `yes`/`no`/`on` are booleans). */
  readonly version?: '1.1' | '1.2';
  /** How many times one anchor may be aliased before decoding fails. Default 100; `-1` disables the guard. */
  readonly maxAliasCount?: number;
  /** Indentation of written text. Default 2. */
  readonly indent?: number;
  /** Write repeated object identity as anchor + alias. Default `true`. */
  readonly aliasDuplicateObjects?: boolean;
}

const DEFAULTS = { version: '1.2', maxAliasCount: 100, indent: 2, aliasDuplicateObjects: true } as const;

type YamlLib = typeof import('yaml');
let yamlLib: Promise<YamlLib> | undefined;
const loadYaml = (): Promise<YamlLib> => (yamlLib ??= import('yaml'));

const YAML_LINE = /^\s*(-(\s|$)|---|\.\.\.|[^\s#=[{][^=]*?:(\s|$)|#)/;
const TOML_LINE = /^\s*(\[\[?[\w."'-]+\]\]?\s*$|[\w."'-]+\s*=\s*\S)/;

/** YAML, read and written with the `yaml` library. */
export const yaml: FormatDescriptor<unknown, YamlOptions> = {
  id: 'yaml',
  label: 'YAML',
  extensions: ['.yaml', '.yml'],
  mediaTypes: ['application/yaml', 'text/yaml'],
  kind: 'value',
  rootArray: true,
  sniff(text): FormatSniff {
    const c = firstChar(text);
    if (c === '{' || c === '[') return { score: 0.35, evidence: ['flow collection (YAML is a JSON superset; JSON preferred)'] };
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (!lines.length) return { score: 0, evidence: [] };
    const yamlLines = lines.filter((l) => YAML_LINE.test(l)).length;
    const tomlLines = lines.filter((l) => TOML_LINE.test(l)).length;
    if (tomlLines > yamlLines) return { score: 0.1, evidence: ['more `key = value` lines than `key: value` lines'] };
    const ratio = yamlLines / lines.length;
    const evidence = [`${yamlLines} of ${lines.length} lines look like YAML (\`key:\`, \`- item\`, \`---\`)`];
    if (/(^|[\s[,{])&[\w-]+/m.test(text) && /(^|[\s[,{])\*[\w-]+/m.test(text)) evidence.push('has anchors and aliases');
    return { score: ratio > 0 ? 0.4 + 0.5 * ratio : 0.05, evidence };
  },
  inspect: (text) => ({ comments: hashComments(text) }),
  unrepresentable: () => [],
  async load(options = {}): Promise<FormatCodec> {
    const { version, maxAliasCount, indent, aliasDuplicateObjects } = { ...DEFAULTS, ...options };
    const lib = await loadYaml();
    return {
      format: 'yaml',
      decode(text) {
        const doc = lib.parseDocument(text, { version, uniqueKeys: true, prettyErrors: true });
        const [first] = doc.errors;
        if (first) {
          const pos = first.linePos?.[0];
          throw new FormatError('yaml', first.message.split('\n')[0]!, { line: pos?.line, column: pos?.col, cause: first });
        }
        try {
          return doc.toJS({ maxAliasCount });
        } catch (error) {
          if (error instanceof Error && /alias count/i.test(error.message)) {
            throw new FormatError(
              'yaml',
              `an anchor is aliased more than ${maxAliasCount} times (a resource-exhaustion guard); ` +
                'decode with a higher `maxAliasCount` if the file is trusted',
              { code: 'alias-limit', cause: error },
            );
          }
          throw asFormatError('yaml', error);
        }
      },
      encode(value) {
        try {
          return lib.stringify(value, { version, indent, aliasDuplicateObjects });
        } catch (error) {
          throw asFormatError('yaml', error, 'value');
        }
      },
    };
  },
};
