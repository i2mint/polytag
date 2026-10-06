/**
 * Format types: a text syntax and the zodal `Codec` that reads and writes it.
 *
 * A *format* (JSON, YAML, TOML, CSV) decides syntax and which value shapes exist. It knows
 * nothing about items, groups or memberships: that is a *grammar*, in the tag-aware root
 * entry (formats-and-grammars §0.1, §8.1).
 *
 * A format is registered as a {@link FormatDescriptor}: cheap, synchronous facts (id, file
 * extensions, a sniffer, a comment scanner) plus `load()`, which imports the parser library
 * on first use and resolves to a {@link FormatCodec}, a zodal `Codec<string, V>`. Both of
 * the codec's directions are fallible: they throw a {@link FormatError} with a position.
 *
 * extraction candidate: a zodal format package (second consumer: zodal-dials TOML/YAML stores)
 */

import type { Codec } from '@zodal/core';

/** What a format's codec decodes to: a JS value (JSON/YAML/TOML) or a {@link Table} (CSV/TSV). */
export type FormatKind = 'value' | 'table';

/**
 * A decoded delimited-text table: a header row and string cells. Rows may be ragged (a
 * missing cell reads as `''`); the codec never types cells, because CSV has no types
 * (RFC 4180).
 */
export interface Table {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** Is `value` a {@link Table}? */
export function isTable(value: unknown): value is Table {
  if (!value || typeof value !== 'object') return false;
  const { columns, rows } = value as Partial<Table>;
  return Array.isArray(columns) && Array.isArray(rows) && rows.every(Array.isArray);
}

/**
 * A non-fatal finding while decoding: a duplicate JSON key (the last value is kept), a check
 * skipped because the document is too deep, or a cell whose formula escape was removed.
 */
export interface FormatWarning {
  readonly code: 'duplicate-key' | 'unchecked' | 'unescaped';
  readonly message: string;
  readonly at: Location;
}

/**
 * A loaded format: a zodal `Codec<string, V>` whose `decode` parses text and whose `encode`
 * writes it. Both throw {@link FormatError}.
 */
export interface FormatCodec<V = unknown> extends Codec<string, V> {
  /** The id of the format this codec belongs to. */
  readonly format: string;
  /** Non-fatal problems in a text that decodes (duplicate keys: JSON keeps the last). */
  warnings?(text: string): readonly FormatWarning[];
  /** The codec options that reproduce `text`'s dialect when writing (a CSV delimiter, a YAML version). */
  dialect?(text: string): Record<string, unknown>;
}

/** Which values a format can hold. */
export interface ValueLimits {
  /** `null` (TOML has none). */
  readonly null: boolean;
  /** `NaN` and `±Infinity` (JSON writes them as `null`). */
  readonly nonFinite: boolean;
}

/** Where something is in a decoded document: a JSON pointer into a value, or a row (1-based, header = 1) and column of a table. */
export type Location = { readonly pointer: string } | { readonly row: number; readonly column?: string };

/** The result of a cheap, library-free look at a text: how likely it is in this format, and why. */
export interface FormatSniff {
  /** 0..1. */
  readonly score: number;
  readonly evidence: readonly string[];
}

/** A comment found in a text (1-based line). */
export interface FoundComment {
  readonly line: number;
  readonly text: string;
}

/** What a rewrite of an existing text would lose besides values (comments, layout). */
export interface FormattingInfo {
  /** Comments a full rewrite drops. Heuristic scanner, errs towards finding one. */
  readonly comments: readonly FoundComment[];
}

/**
 * A registered format. Everything except `load` is synchronous and needs no parser library,
 * so a registry of all formats costs nothing until one is used.
 */
export interface FormatDescriptor<V = unknown, O extends object = Record<string, unknown>> {
  readonly id: string;
  readonly label: string;
  /** File extensions, lower case with the dot (`.json`). The first one is the default. */
  readonly extensions: readonly string[];
  readonly mediaTypes: readonly string[];
  readonly kind: FormatKind;
  /** Whether the top level of a document may be an array (TOML: no; it must be a table). */
  readonly rootArray: boolean;
  /** Cheap, synchronous guess at whether `text` is in this format. */
  sniff(text: string): FormatSniff;
  /** Comments and layout a full rewrite of `text` would lose. */
  inspect(text: string): FormattingInfo;
  /** Which values it can hold; a writer removes or converts the rest first and reports it. */
  readonly limits: ValueLimits;
  /**
   * JSON-pointer paths in `value` this format cannot write (TOML has no `null`). The codec
   * drops them on `encode`; callers report them as a loss.
   */
  unrepresentable(value: V): readonly string[];
  /** Where `encode` (with these options) writes a value by a convention that `decode` undoes (a CSV formula escaped as `'=…`). */
  escapes?(value: V, options?: O): readonly string[];
  /** Load the parser library (once) and return a codec bound to `options`. */
  load(options?: O): Promise<FormatCodec<V>>;
}

/** Why a {@link FormatError} was thrown. */
export type FormatErrorCode =
  /** The text is not valid in this format. */
  | 'syntax'
  /** A YAML anchor is aliased more often than `maxAliasCount` allows (a resource-exhaustion guard). */
  | 'alias-limit'
  /** The value has a shape this format cannot write (a TOML document must be a table). */
  | 'shape'
  /** The value cannot be written at all (a circular structure in JSON, a BigInt). */
  | 'value'
  /** The text is past a safety limit (a CSV line longer than `maxLineLength`, a document too deep to parse). */
  | 'limit';

/** A {@link FormatError} as plain, serialisable data. */
export interface FormatErrorInfo {
  readonly format: string;
  readonly code: FormatErrorCode;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

/** A failure to decode or encode, with a 1-based position when the parser reports one. */
export class FormatError extends Error {
  readonly format: string;
  readonly code: FormatErrorCode;
  readonly line?: number;
  readonly column?: number;

  constructor(
    format: string,
    message: string,
    { code = 'syntax', line, column, cause }: { code?: FormatErrorCode; line?: number; column?: number; cause?: unknown } = {},
  ) {
    const where = line !== undefined ? ` (line ${line}${column !== undefined ? `, column ${column}` : ''})` : '';
    super(`${format}: ${message}${where}`, cause === undefined ? undefined : { cause });
    this.name = 'FormatError';
    this.format = format;
    this.code = code;
    this.line = line;
    this.column = column;
  }

  /** Plain data (an `Error`'s `message` is not enumerable, so `JSON.stringify` would lose it). */
  toJSON(): FormatErrorInfo {
    return {
      format: this.format,
      code: this.code,
      message: this.message,
      ...(this.line !== undefined ? { line: this.line } : {}),
      ...(this.column !== undefined ? { column: this.column } : {}),
    };
  }
}

/**
 * Is `error` a {@link FormatError}? Duck-typed, so it holds across bundles that each carry a
 * copy of the class.
 */
export function isFormatError(error: unknown): error is FormatError {
  return error instanceof FormatError || (error instanceof Error && error.name === 'FormatError' && typeof (error as FormatError).format === 'string');
}

/** The outcome of {@link tryDecode}: the value, or the error, never a throw. */
export type DecodeResult<V> = { readonly ok: true; readonly value: V } | { readonly ok: false; readonly error: FormatError };

/** Decode without throwing. A non-`FormatError` exception is wrapped as one. */
export function tryDecode<V>(codec: FormatCodec<V>, text: string): DecodeResult<V> {
  try {
    return { ok: true, value: codec.decode(text) };
  } catch (error) {
    return { ok: false, error: asFormatError(codec.format, error) };
  }
}

/** Wrap any thrown value as a {@link FormatError} of `format`. */
export function asFormatError(format: string, error: unknown, code: FormatErrorCode = 'syntax'): FormatError {
  if (error instanceof FormatError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new FormatError(format, message, { code, cause: error });
}

/** 1-based line and column of a character offset. */
export function positionOf(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

/** How much of a text the sniffers look at, and the longest line they read. */
export const SNIFF_CHARS = 64 * 1024;
export const SNIFF_LINE = 1024;

/** The first lines of a text for sniffing: at most {@link SNIFF_CHARS}, each cut to {@link SNIFF_LINE}. */
export const sniffLines = (text: string): string[] =>
  text
    .slice(0, SNIFF_CHARS)
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.slice(0, SNIFF_LINE));

const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '﻿' || /\s/.test(c);

/** The first non-whitespace character of `text` (after a BOM), or `''`. */
export function firstChar(text: string): string {
  const head = text.slice(0, SNIFF_CHARS);
  for (const c of head) if (!isSpace(c)) return c;
  return '';
}

/** The first character of `text` that is neither whitespace nor inside a `//` or block comment, or `''`. */
export function firstCodeChar(text: string): string {
  const head = text.slice(0, SNIFF_CHARS);
  let i = 0;
  while (i < head.length) {
    const c = head[i]!;
    if (isSpace(c)) i += 1;
    else if (c === '/' && head[i + 1] === '/') {
      const end = head.indexOf('\n', i);
      if (end === -1) return '';
      i = end + 1;
    } else if (c === '/' && head[i + 1] === '*') {
      const end = head.indexOf('*/', i + 2);
      if (end === -1) return '';
      i = end + 2;
    } else return c;
  }
  return '';
}
