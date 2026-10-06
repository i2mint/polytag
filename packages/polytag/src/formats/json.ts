/**
 * JSON and JSONC formats.
 *
 * JSON needs no library (`JSON.parse`). JSONC (comments, trailing commas) is read with
 * `jsonc-parser`, loaded only when a JSONC document is actually decoded; writing JSONC
 * writes plain JSON, so its comments are a `formatting` loss (comment-preserving edits are a
 * later seam, formats-and-grammars §8.3).
 *
 * extraction candidate: a zodal format package (second consumer: zodal-dials TOML/YAML stores)
 */

import { slashComments } from './comments.js';
import {
  type FormatCodec,
  type FormatDescriptor,
  FormatError,
  type FormatSniff,
  asFormatError,
  firstChar,
  positionOf,
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

/** JSON: `JSON.parse` / `JSON.stringify`, no library. */
export const json: FormatDescriptor<unknown, JsonOptions> = {
  id: 'json',
  label: 'JSON',
  extensions: ['.json'],
  mediaTypes: ['application/json'],
  kind: 'value',
  rootArray: true,
  sniff(text): FormatSniff {
    const c = firstChar(text);
    if (c !== '{' && c !== '[') return { score: 0, evidence: [] };
    if (strictParse(text).ok) return { score: 0.95, evidence: [`starts with '${c}' and JSON.parse succeeds`] };
    return { score: 0.3, evidence: [`starts with '${c}' but JSON.parse fails`] };
  },
  inspect: () => ({ comments: [] }),
  unrepresentable: (value) => findPaths(value, notJson),
  async load({ indent = DEFAULT_INDENT } = {}): Promise<FormatCodec> {
    return {
      format: 'json',
      decode(text) {
        const parsed = strictParse(text);
        if (parsed.ok) return parsed.value;
        const message = parsed.error instanceof Error ? parsed.error.message : String(parsed.error);
        const offset = /position (\d+)/.exec(message)?.[1];
        throw new FormatError('json', message, {
          cause: parsed.error,
          ...(offset !== undefined ? positionOf(text, Number(offset)) : {}),
        });
      },
      encode: (value) => encodeJson('json', value, indent),
    };
  },
};

type JsoncParser = typeof import('jsonc-parser');

/**
 * A value from a `jsonc-parser` tree. Built here rather than with its `parse`, which assigns
 * keys (`obj[key] = v`), so a `"__proto__"` key would set the prototype instead of being a key.
 */
function valueOf(node: import('jsonc-parser').Node): unknown {
  switch (node.type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const property of node.children ?? []) {
        const [key, value] = property.children ?? [];
        if (!key || !value) continue;
        Object.defineProperty(out, key.value as string, { value: valueOf(value), enumerable: true, writable: true, configurable: true });
      }
      return out;
    }
    case 'array':
      return (node.children ?? []).map(valueOf);
    default:
      return node.value;
  }
}
let jsoncParser: Promise<JsoncParser> | undefined;
const loadJsoncParser = (): Promise<JsoncParser> =>
  (jsoncParser ??= import('jsonc-parser').then((m) => ((m as { default?: JsoncParser }).default ?? m) as JsoncParser));

/** JSONC: JSON with comments and trailing commas, read with `jsonc-parser`; written as plain JSON. */
export const jsonc: FormatDescriptor<unknown, JsonOptions> = {
  id: 'jsonc',
  label: 'JSON with comments',
  extensions: ['.jsonc', '.json5'],
  mediaTypes: ['application/jsonc'],
  kind: 'value',
  rootArray: true,
  sniff(text): FormatSniff {
    const c = firstChar(text);
    if (c !== '{' && c !== '[') return { score: 0, evidence: [] };
    if (strictParse(text).ok) return { score: 0.5, evidence: ['valid JSON (JSONC is a superset; JSON preferred)'] };
    const evidence: string[] = [];
    if (slashComments(text).length) evidence.push('has // or /* */ comments');
    if (TRAILING_COMMA.test(text)) evidence.push('has trailing commas');
    return evidence.length ? { score: 0.85, evidence } : { score: 0.2, evidence: [`starts with '${c}' but JSON.parse fails`] };
  },
  inspect: (text) => ({ comments: slashComments(text) }),
  unrepresentable: (value) => findPaths(value, notJson),
  async load({ indent = DEFAULT_INDENT } = {}): Promise<FormatCodec> {
    const lib = await loadJsoncParser();
    return {
      format: 'jsonc',
      decode(text) {
        const errors: import('jsonc-parser').ParseError[] = [];
        const tree = lib.parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });
        const [first] = errors;
        if (first) {
          throw new FormatError('jsonc', lib.printParseErrorCode(first.error), positionOf(text, first.offset));
        }
        return tree ? valueOf(tree) : undefined;
      },
      encode: (value) => encodeJson('jsonc', value, indent),
    };
  },
};
