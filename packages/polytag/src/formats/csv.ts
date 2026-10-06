/**
 * CSV and TSV formats, over `papaparse` (MIT; browser-first, delimiter guessing), loaded on
 * first use. Both decode to a {@link Table}: the first row is the header, cells stay strings
 * (CSV has no types, RFC 4180), empty lines are skipped and a BOM is dropped.
 *
 * extraction candidate: a zodal format package (second consumer: zodal-dials TOML/YAML stores)
 */

import { type FormatCodec, type FormatDescriptor, FormatError, type FormatSniff, type Table, firstChar, isTable } from './types.js';

/** Options of the `csv` and `tsv` codecs. */
export interface CsvOptions {
  /** Cell delimiter. CSV: guessed on read (`,` `;` `|` tab), `,` on write. TSV: tab. */
  readonly delimiter?: string;
}

type Papa = typeof import('papaparse');
let papaLib: Promise<Papa> | undefined;
const loadPapa = (): Promise<Papa> => (papaLib ??= import('papaparse').then((m) => ((m as { default?: Papa }).default ?? m) as Papa));

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

const LOOKS_LIKE_YAML_OR_TOML = /^\s*(-\s|[^,;|\t"]+:\s|[\w.-]+\s*=)/;

function sniffDelimited(text: string, delimiters: readonly string[], name: string): FormatSniff {
  const c = firstChar(text);
  if (c === '{' || c === '[' || c === '<') return { score: 0, evidence: [] };
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 20);
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

function delimitedFormat(id: 'csv' | 'tsv', defaults: { read: string; write: string }): FormatDescriptor<Table, CsvOptions> {
  return {
    id,
    label: id.toUpperCase(),
    extensions: id === 'csv' ? ['.csv'] : ['.tsv', '.tab'],
    mediaTypes: id === 'csv' ? ['text/csv'] : ['text/tab-separated-values'],
    kind: 'table',
    rootArray: true,
    sniff: (text) => sniffDelimited(text, id === 'csv' ? [',', ';', '|'] : ['\t'], id.toUpperCase()),
    inspect: () => ({ comments: [] }),
    unrepresentable: () => [],
    async load({ delimiter }: CsvOptions = {}): Promise<FormatCodec<Table>> {
      const papa = await loadPapa();
      return {
        format: id,
        decode(text) {
          const result = papa.parse<string[]>(text.replace(/^﻿/, ''), {
            delimiter: delimiter ?? defaults.read,
            skipEmptyLines: 'greedy',
          });
          const fatal = result.errors.find((e) => e.code !== 'UndetectableDelimiter');
          if (fatal) {
            throw new FormatError(id, fatal.message, { line: fatal.row !== undefined ? fatal.row + 1 : undefined, cause: fatal });
          }
          const [columns = [], ...rows] = result.data;
          return { columns, rows };
        },
        encode(value) {
          if (!isTable(value)) {
            throw new FormatError(id, 'can only write a table ({ columns, rows })', { code: 'shape' });
          }
          const text = papa.unparse(
            { fields: [...value.columns], data: value.rows.map((r) => [...r]) },
            { delimiter: delimiter ?? defaults.write, newline: '\n' },
          );
          return text ? `${text}\n` : '';
        },
      };
    },
  };
}

/** CSV: delimiter guessed on read, `,` on write. */
export const csv = delimitedFormat('csv', { read: '', write: ',' });

/** TSV: tab-delimited. */
export const tsv = delimitedFormat('tsv', { read: '\t', write: '\t' });
