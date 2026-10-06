/**
 * JSON and JSONC formats.
 *
 * JSON decodes with `JSON.parse`; JSONC (comments, trailing commas) with `jsonc-parser`'s
 * tree. Both use that tree (loaded on first use, 5.7 kB gzip) to report duplicate keys,
 * which `JSON.parse` silently resolves to the last (RFC 8259: implementations differ), and
 * to locate a JSON pointer in the text. Writing JSONC writes plain JSON, so its comments are
 * a `formatting` loss (comment-preserving edits are a later seam, formats-and-grammars §8.3).
 *
 * extraction candidate: a zodal format package (second consumer: zodal-dials TOML/YAML stores)
 */

import { slashComments } from './comments.js';
import {
  type FormatCodec,
  type FormatDescriptor,
  FormatError,
  type FormatSniff,
  type FormatWarning,
  asFormatError,
  firstCodeChar,
  positionOf,
  SNIFF_CHARS,
} from './types.js';
import { findPaths } from './values.js';

/** Options of the `json` and `jsonc` codecs. */
export interface JsonOptions {
  /** Indentation of written text. Default 2. */
  readonly indent?: number;
}

const DEFAULT_INDENT = 2;
const TRAILING_COMMA = /,\s*[}\]]/;

/** Values JSON cannot write faithfully: non-finite numbers (become `null`), BigInt (throws), functions, symbols. */
const notJson = (v: unknown): boolean =>
  (typeof v === 'number' && !Number.isFinite(v)) || typeof v === 'bigint' || typeof v === 'function' || typeof v === 'symbol';

function encodeJson(format: string, value: unknown, indent: number): string {
  try {
    const text = JSON.stringify(value, null, indent);
    if (text === undefined) throw new FormatError(format, `cannot write a ${typeof value} as JSON`, { code: 'value' });
    return `${text}\n`;
  } catch (error) {
    throw asFormatError(format, error, 'value');
  }
}

function strictParse(text: string): { ok: true; value: unknown } | { ok: false; error: unknown } {
  try {
    return { ok: true, value: JSON.parse(text.replace(/^﻿/, '')) };
  } catch (error) {
    return { ok: false, error };
  }
}

type JsoncParser = typeof import('jsonc-parser');
type JsonNode = import('jsonc-parser').Node;
let jsoncParser: Promise<JsoncParser> | undefined;
/** Load `jsonc-parser` once. */
export const loadJsoncParser = (): Promise<JsoncParser> =>
  (jsoncParser ??= import('jsonc-parser').then((m) => ((m as { default?: JsoncParser }).default ?? m) as JsoncParser));

/**
 * A value from a `jsonc-parser` tree. Built here rather than with its `parse`, which assigns
 * keys (`obj[key] = v`), so a `"__proto__"` key would set the prototype instead of being a
 * key. A duplicate key keeps the last value, as `JSON.parse` does.
 */
function valueOf(root: JsonNode): unknown {
  const build = (node: JsonNode): unknown => {
    if (node.type === 'array') return (node.children ?? []).map(build);
    if (node.type !== 'object') return node.value;
    const out: Record<string, unknown> = {};
    for (const property of node.children ?? []) {
      const [key, value] = property.children ?? [];
      if (!key || !value) continue;
      Object.defineProperty(out, key.value as string, { value: build(value), enumerable: true, writable: true, configurable: true });
    }
    return out;
  };
  return build(root);
}

const pointerSegment = (key: string | number): string => String(key).replace(/~/g, '~0').replace(/\//g, '~1');

/** Duplicate keys in a tree, as warnings located by JSON pointer (iterative: deep documents are fine). */
function duplicateKeys(root: JsonNode | undefined): FormatWarning[] {
  const out: FormatWarning[] = [];
  const stack: [JsonNode, string][] = root ? [[root, '']] : [];
  while (stack.length) {
    const [node, path] = stack.pop()!;
    if (node.type === 'array') (node.children ?? []).forEach((c, i) => stack.push([c, `${path}/${i}`]));
    if (node.type !== 'object') continue;
    const seen = new Set<string>();
    for (const property of node.children ?? []) {
      const [key, value] = property.children ?? [];
      if (!key) continue;
      const k = key.value as string;
      const at = `${path}/${pointerSegment(k)}`;
      if (seen.has(k)) out.push({ code: 'duplicate-key', message: `duplicate key '${k}'; the last value is kept (JSON parsers differ)`, at: { pointer: at } });
      seen.add(k);
      if (value) stack.push([value, at]);
    }
  }
  return out.reverse();
}

/** The offset of the value a JSON pointer names in a jsonc-parser tree, or `undefined`. */
export function jsonOffset(root: JsonNode | undefined, pointer: string): number | undefined {
  if (!root) return undefined;
  let node: JsonNode | undefined = root;
  const segments = pointer === '' ? [] : pointer.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  for (const seg of segments) {
    if (!node) return undefined;
    if (node.type === 'array') node = node.children?.[Number(seg)];
    else if (node.type === 'object') {
      const matches: JsonNode[] = (node.children ?? []).filter((p) => p.children?.[0]?.value === seg);
      node = matches.at(-1)?.children?.[1];
    } else return undefined;
  }
  return node?.offset;
}

/** The parse tree of a JSON / JSONC text (for locating pointers); `undefined` if it is too deep for the (recursive) parser. */
export async function jsonTree(text: string): Promise<JsonNode | undefined> {
  const lib = await loadJsoncParser();
  const tree = treeOrDeep(() => lib.parseTree(text, [], { allowTrailingComma: true, disallowComments: false }));
  return tree === TOO_DEEP ? undefined : tree;
}

const TOO_DEEP = Symbol('too deep');

/** Run a (recursive) jsonc-parser call; a stack overflow on a very deep document is reported, not thrown. */
function treeOrDeep<T>(run: () => T): T | typeof TOO_DEEP {
  try {
    return run();
  } catch (error) {
    if (error instanceof RangeError) return TOO_DEEP;
    throw error;
  }
}

/** Duplicate-key warnings for `text`, or one `unchecked` warning when it is too deep to walk. */
function duplicateWarnings(lib: JsoncParser, text: string, allowTrailingComma: boolean): FormatWarning[] {
  const tree = treeOrDeep(() => lib.parseTree(text, [], { allowTrailingComma, disallowComments: !allowTrailingComma }));
  if (tree === TOO_DEEP) return [{ code: 'unchecked', message: 'too deeply nested to check for duplicate keys', at: { pointer: '' } }];
  return duplicateKeys(tree);
}

const VALUE_LIMITS = { null: true, nonFinite: false } as const;

/** JSON: `JSON.parse` / `JSON.stringify`. */
export const json: FormatDescriptor<unknown, JsonOptions> = {
  id: 'json',
  label: 'JSON',
  extensions: ['.json'],
  mediaTypes: ['application/json'],
  kind: 'value',
  rootArray: true,
  limits: VALUE_LIMITS,
  sniff(text): FormatSniff {
    const c = firstCodeChar(text);
    if (c !== '{' && c !== '[') return { score: 0, evidence: [] };
    if (text.length <= SNIFF_CHARS * 16 && strictParse(text).ok) return { score: 0.95, evidence: [`starts with '${c}' and JSON.parse succeeds`] };
    if (text.length > SNIFF_CHARS * 16) return { score: 0.6, evidence: [`starts with '${c}' (too long to parse while sniffing)`] };
    return { score: 0.3, evidence: [`starts with '${c}' but JSON.parse fails`] };
  },
  inspect: () => ({ comments: [] }),
  unrepresentable: (value) => findPaths(value, notJson),
  async load({ indent = DEFAULT_INDENT } = {}): Promise<FormatCodec> {
    const lib = await loadJsoncParser();
    return {
      format: 'json',
      decode(text) {
        const parsed = strictParse(text);
        if (parsed.ok) return parsed.value;
        const message = parsed.error instanceof Error ? parsed.error.message : String(parsed.error);
        const errors: import('jsonc-parser').ParseError[] = [];
        treeOrDeep(() => lib.parseTree(text, errors, { allowTrailingComma: false, disallowComments: true }));
        const offset = errors[0]?.offset ?? Number(/position (\d+)/.exec(message)?.[1] ?? Number.NaN);
        throw new FormatError('json', message, { cause: parsed.error, ...(Number.isFinite(offset) ? positionOf(text, offset) : {}) });
      },
      encode: (value) => encodeJson('json', value, indent),
      warnings: (text) => duplicateWarnings(lib, text, false),
    };
  },
};

/** JSONC: JSON with comments and trailing commas, read with `jsonc-parser`; written as plain JSON. */
export const jsonc: FormatDescriptor<unknown, JsonOptions> = {
  id: 'jsonc',
  label: 'JSON with comments',
  extensions: ['.jsonc', '.json5'],
  mediaTypes: ['application/jsonc'],
  kind: 'value',
  rootArray: true,
  limits: VALUE_LIMITS,
  sniff(text): FormatSniff {
    const c = firstCodeChar(text);
    if (c !== '{' && c !== '[') return { score: 0, evidence: [] };
    const head = text.slice(0, SNIFF_CHARS);
    const evidence: string[] = [];
    if (slashComments(head).length) evidence.push('has // or /* */ comments');
    if (TRAILING_COMMA.test(head)) evidence.push('has trailing commas');
    if (evidence.length) return { score: 0.85, evidence };
    return { score: 0.5, evidence: ['looks like JSON (JSONC is a superset; JSON preferred)'] };
  },
  inspect: (text) => ({ comments: slashComments(text) }),
  unrepresentable: (value) => findPaths(value, notJson),
  async load({ indent = DEFAULT_INDENT } = {}): Promise<FormatCodec> {
    const lib = await loadJsoncParser();
    const parse = (text: string): { tree: JsonNode | undefined; errors: import('jsonc-parser').ParseError[] } => {
      const errors: import('jsonc-parser').ParseError[] = [];
      const tree = treeOrDeep(() => lib.parseTree(text, errors, { allowTrailingComma: true, disallowComments: false }));
      if (tree === TOO_DEEP) throw new FormatError('jsonc', 'too deeply nested for the JSONC parser', { code: 'limit' });
      return { tree, errors };
    };
    return {
      format: 'jsonc',
      decode(text) {
        const { tree, errors } = parse(text);
        const [first] = errors;
        if (first) throw new FormatError('jsonc', lib.printParseErrorCode(first.error), positionOf(text, first.offset));
        try {
          return tree ? valueOf(tree) : undefined;
        } catch (error) {
          if (error instanceof RangeError) throw new FormatError('jsonc', 'too deeply nested for the JSONC parser', { code: 'limit' });
          throw error;
        }
      },
      encode: (value) => encodeJson('jsonc', value, indent),
      warnings: (text) => duplicateWarnings(lib, text, true),
    };
  },
};
