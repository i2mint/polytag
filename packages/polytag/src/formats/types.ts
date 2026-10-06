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
 * A loaded format: a zodal `Codec<string, V>` whose `decode` parses text and whose `encode`
 * writes it. Both throw {@link FormatError}.
 */
export interface FormatCodec<V = unknown> extends Codec<string, V> {
  /** The id of the format this codec belongs to. */
  readonly format: string;
}

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
  /**
   * JSON-pointer paths in `value` this format cannot write (TOML has no `null`). The codec
   * drops them on `encode`; callers report them as a loss.
   */
  unrepresentable(value: V): readonly string[];
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
  | 'value';

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

/** The first non-whitespace character of `text` (after a BOM), or `''`. */
export function firstChar(text: string): string {
  return /^﻿?\s*(\S)/.exec(text)?.[1] ?? '';
}
