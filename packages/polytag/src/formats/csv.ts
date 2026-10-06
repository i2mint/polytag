/**
 * CSV and TSV formats, over `papaparse` (MIT; browser-first, delimiter guessing), loaded on
 * first use. Both decode to a {@link Table}: the first row is the header, cells stay strings
 * (CSV has no types, RFC 4180), empty lines are skipped and a BOM is dropped.
 *
 * **Formula escaping** (on by default, `escapeFormulae`): a cell that starts with `=`, `+`,
 * `-`, `@`, a tab or a carriage return is written with a leading `'`, so a spreadsheet shows
 * it as text instead of running it (CSV injection, OWASP). Decoding removes one leading `'`
 * from such cells, and a cell that already starts with `'` followed by one of them gets one
 * more `'` on write, so the convention is reversible. `escapes()` lists the cells it touches,
 * for the loss report (an `encode`).
 *
 * extraction candidate: a zodal format package (second consumer: zodal-dials TOML/YAML stores)
 */

import { type FormatCodec, type FormatDescriptor, FormatError, type FormatSniff, type Table, firstChar, isTable, positionOf, sniffLines } from './types.js';

/** Options of the `csv` and `tsv` codecs. */
export interface CsvOptions {
  /** Cell delimiter. CSV: guessed on read (`,` `;` `|` tab), `,` on write. TSV: tab. */
  readonly delimiter?: string;
  /** Escape cells a spreadsheet would run as formulas (and unescape them on read). Default `true`. */
  readonly escapeFormulae?: boolean;
}

type Papa = typeof import('papaparse');
let papaLib: Promise<Papa> | undefined;
/** Load `papaparse` once. */
export const loadPapa = (): Promise<Papa> => (papaLib ??= import('papaparse').then((m) => ((m as { default?: Papa }).default ?? m) as Papa));

/** A cell a spreadsheet would run (after any leading apostrophes). */
const FORMULA = /^'*[=+\-@\t\r]/;
const escapeCell = (cell: string): string => (FORMULA.test(cell) ? `'${cell}` : cell);
const unescapeCell = (cell: string): string => (/^'+[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell);

/** Occurrences of `delimiter` outside double quotes in one line. */
function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === delimiter) count += 1;
  }
  return count;
}

/** Linear (no overlapping quantifiers): a YAML `key: ` / `- item` or a TOML `key =` line. */
const LOOKS_LIKE_YAML_OR_TOML = /^\s*(-\s|[^,;|\t"\s][^,;|\t"]*:\s|[\w.-]+\s*=)/;

function sniffDelimited(text: string, delimiters: readonly string[], name: string): FormatSniff {
  const c = firstChar(text);
  if (c === '{' || c === '[' || c === '<') return { score: 0, evidence: [] };
  const lines = sniffLines(text).filter((l) => l.trim() !== '').slice(0, 20);
  if (lines.length < 2) return { score: lines.length ? 0.1 : 0, evidence: lines.length ? ['a single line'] : [] };
  const yamlish = lines.filter((l) => LOOKS_LIKE_YAML_OR_TOML.test(l)).length / lines.length;
  let best: FormatSniff = { score: 0, evidence: [] };
  for (const d of delimiters) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    if (counts[0] === 0) continue;
    const consistent = counts.filter((n) => n === counts[0]).length / counts.length;
    const label = d === '\t' ? 'tab' : `'${d}'`;
    let score = 0.35 + 0.5 * consistent;
    if (yamlish > 0.5) score *= 0.4;
    if (score > best.score) {
      best = { score, evidence: [`${name}: ${label} appears ${counts[0]}× in the header and the same count in ${Math.round(consistent * 100)}% of lines`] };
    }
  }
  return best;
}

/**
 * The 1-based line where record `row` starts (header = row 1), counting quoted line breaks.
 * Rows are counted as the codec counts them (empty lines skipped).
 */
export async function csvRowLine(text: string, row: number, delimiter?: string): Promise<{ line: number; column: number } | undefined> {
  const papa = await loadPapa();
  const body = text.replace(/^﻿/, '');
  const offset = text.length - body.length;
  let seen = 0;
  let start: number | undefined;
  let previous = 0;
  papa.parse<string[]>(body, {
    delimiter: delimiter ?? '',
    skipEmptyLines: 'greedy',
    step(result, parser) {
      seen += 1;
      if (seen === row) {
        start = previous;
        parser.abort();
      }
      previous = result.meta.cursor;
    },
  });
  if (start === undefined) return undefined;
  while (start < body.length && (body[start] === '\n' || body[start] === '\r')) start += 1;
  return positionOf(text, start + offset);
}

function delimitedFormat(id: 'csv' | 'tsv', defaults: { read: string; write: string }): FormatDescriptor<Table, CsvOptions> {
  return {
    id,
    label: id.toUpperCase(),
    extensions: id === 'csv' ? ['.csv'] : ['.tsv', '.tab'],
    mediaTypes: id === 'csv' ? ['text/csv'] : ['text/tab-separated-values'],
    kind: 'table',
    rootArray: true,
    // Grammars write structured cells as JSON text: null is fine, NaN and Infinity are not.
    limits: { null: true, nonFinite: false },
    sniff: (text) => sniffDelimited(text, id === 'csv' ? [',', ';', '|'] : ['\t'], id.toUpperCase()),
    inspect: () => ({ comments: [] }),
    unrepresentable: () => [],
    escapes(value, { escapeFormulae = true } = {}) {
      if (!escapeFormulae || !isTable(value)) return [];
      const cells = [value.columns, ...value.rows].flatMap((row, r) =>
        row.flatMap((cell, c) => (FORMULA.test(cell) ? [`row ${r + 1}, column ${value.columns[c] ?? c + 1}`] : [])),
      );
      return cells;
    },
    async load({ delimiter, escapeFormulae = true }: CsvOptions = {}): Promise<FormatCodec<Table>> {
      const papa = await loadPapa();
      const read = (text: string) =>
        papa.parse<string[]>(text.replace(/^﻿/, ''), { delimiter: delimiter ?? defaults.read, skipEmptyLines: 'greedy' });
      return {
        format: id,
        decode(text) {
          const result = read(text);
          const fatal = result.errors.find((e) => e.code !== 'UndetectableDelimiter');
          if (fatal) {
            throw new FormatError(id, fatal.message, { line: fatal.row !== undefined ? fatal.row + 1 : undefined, cause: fatal });
          }
          const data = escapeFormulae ? result.data.map((row) => row.map(unescapeCell)) : result.data;
          const [columns = [], ...rows] = data;
          return { columns, rows };
        },
        encode(value) {
          if (!isTable(value)) {
            throw new FormatError(id, 'can only write a table ({ columns, rows })', { code: 'shape' });
          }
          const cell = escapeFormulae ? escapeCell : (c: string) => c;
          const text = papa.unparse(
            { fields: value.columns.map(cell), data: value.rows.map((r) => r.map(cell)) },
            { delimiter: delimiter ?? defaults.write, newline: '\n' },
          );
          return text ? `${text}\n` : '';
        },
        dialect(text) {
          if (id === 'tsv' || delimiter) return {};
          const guessed = papa.parse<string[]>(text.replace(/^﻿/, '').slice(0, 64 * 1024), { delimiter: '', preview: 20, skipEmptyLines: 'greedy' }).meta.delimiter;
          return guessed && guessed !== defaults.write ? { delimiter: guessed } : {};
        },
      };
    },
  };
}

/** CSV: delimiter guessed on read, `,` on write. */
export const csv = delimitedFormat('csv', { read: '', write: ',' });

/** TSV: tab-delimited. */
export const tsv = delimitedFormat('tsv', { read: '\t', write: '\t' });
