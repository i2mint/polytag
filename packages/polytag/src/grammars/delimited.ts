/**
 * `delimited` (g): a CSV row per item with its groups packed in one cell.
 *
 * ```csv
 * id,groups
 * carbonara,italian;quick
 * notes,
 * ```
 *
 * Flat like `tags-array` (formats-and-grammars §3(g)); with `pathSeparator` the tokens are
 * path strings (`food/italian;quick`), which carries nesting as `tag-paths` does. Tokens are
 * trimmed on read, so a group id that contains the delimiter, has surrounding spaces, or is
 * empty cannot be written faithfully: `serialise` reports it as an identity collision.
 */

import { z } from 'zod';
import { isTable } from '../formats/index.js';
import { type Detection, defineGrammar, noDetection } from '../grammar.js';
import type { GrammarCapabilities } from '../loss.js';
import { createSpaceBuilder } from './shared/builder.js';
import { type PathOptions, createFlatReader, flatPlan, flatRecords } from './shared/flat.js';
import { itemColumns, readItemRow, writeItemTable } from './shared/item-table.js';
import { LEXICON, dominantSeparator, inLexicon, pickIdKey } from './shared/shape.js';
import { cellOf, chainPlans, columnIndex, tablePlan } from './shared/table.js';

/** Params of `delimited`. */
export const delimitedParams = z.object({
  idKey: z.string().min(1).default('id'),
  labelKey: z.string().min(1).default('label'),
  /** The column holding the groups. */
  tagsKey: z.string().min(1).default('groups'),
  /** Separator between groups inside the cell (`;`, `|`, `,`). */
  delimiter: z.string().min(1).default(';'),
  /** When set, each token is a path (`food/italian`), as in `tag-paths`. */
  pathSeparator: z.string().min(1).optional(),
  mode: z.enum(['leafOnly', 'materialised']).default('leafOnly'),
});
export type DelimitedParams = z.infer<typeof delimitedParams>;

const FLAT: GrammarCapabilities = {
  itemsMultiParent: 'native',
  nestedGroups: 'no',
  groupsMultiParent: 'no',
  groupMeta: 'no',
  itemMeta: 'native',
  edgeOrder: 'item-major',
  edgeLabel: 'no',
  edgeMeta: 'no',
  isolatedNodes: 'native',
  edgeKinds: 'single',
  edgeIds: 'no',
  identity: 'token',
};

const pathsOf = (p: DelimitedParams): PathOptions | undefined => (p.pathSeparator ? { separator: p.pathSeparator, mode: p.mode } : undefined);

const DELIMITERS = [';', '|', ','] as const;

function detect(input: unknown): Detection<DelimitedParams> {
  if (!isTable(input) || input.columns.length < 2 || !input.rows.length) return noDetection();
  let best: { index: number; delimiter: string; share: number; named: boolean } | undefined;
  input.columns.forEach((name, index) => {
    const cells = input.rows.map((r) => cellOf(r, index)).filter((c) => c !== '');
    const named = inLexicon(name, LEXICON.tags);
    for (const d of DELIMITERS) {
      const share = cells.length ? cells.filter((c) => c.includes(d)).length / cells.length : 0;
      // A tag-like column name outweighs delimiters found in another column.
      const better = !best || 1.5 * Number(named) + share > 1.5 * Number(best.named) + best.share;
      if ((named || share >= 0.2) && better) best = { index, delimiter: d, share, named };
    }
  });
  if (!best) return noDetection();
  const tagsKey = input.columns[best.index]!;
  const records = input.rows.map((r) => Object.fromEntries(input.columns.map((c, i) => [c, cellOf(r, i)])));
  const idKey = pickIdKey(records, [tagsKey]);
  const tokens = input.rows.flatMap((r) => cellOf(r, best!.index).split(best!.delimiter)).map((t) => t.trim()).filter(Boolean);
  const { separator, share: pathShare } = dominantSeparator(tokens.filter(() => true));
  const paths = separator !== best.delimiter && pathShare >= 0.3;
  const structural = best.named ? 0.7 + 0.3 * Math.min(1, best.share / 0.2) : Math.min(1, best.share / 0.2);
  return {
    score: 0.5 * structural + 0.3 * (best.named ? 1 : 0.3) + 0.2 * (idKey ? 1 : 0.4),
    evidence: [
      `column '${tagsKey}'${best.named ? ' (a tag-like name)' : ''}: ${Math.round(best.share * 100)}% of cells contain '${best.delimiter}'`,
      idKey ? `'${idKey}' is a unique id column` : 'no unique id column',
      ...(paths ? [`${Math.round(pathShare * 100)}% of tokens are paths with '${separator}'`] : []),
    ],
    suggestedParams: { tagsKey, delimiter: best.delimiter, ...(idKey ? { idKey } : {}), ...(paths ? { pathSeparator: separator } : {}) },
  };
}

/** `delimited`: one row per item, groups in one delimited cell. */
export const delimited = defineGrammar<DelimitedParams>({
  id: 'delimited',
  label: 'Items + delimited groups cell',
  description: 'A CSV row per item, its groups in one cell separated by a delimiter (optionally as paths). Flat unless paths are used.',
  inputs: ['table'],
  formats: ['csv', 'tsv'],
  params: delimitedParams,
  capabilities: (p) => (p.pathSeparator ? { ...FLAT, nestedGroups: 'native', groupsMultiParent: 'convention', identity: 'path' } : FLAT),
  detect,

  parse(input, p) {
    const builder = createSpaceBuilder();
    if (!isTable(input)) {
      builder.diag({ severity: 'error', code: 'shape', message: 'expected a table (CSV or TSV)', path: '' });
      return builder.build();
    }
    const tags = columnIndex(input, p.tagsKey);
    const cols = itemColumns(input, p, new Set([tags]));
    if (cols.id < 0) {
      builder.diag({ severity: 'error', code: 'shape', message: `no '${p.idKey}' column`, path: 'row 1', hint: 'set the idKey param' });
      return builder.build();
    }
    if (tags < 0) builder.diag({ severity: 'warning', code: 'shape', message: `no '${p.tagsKey}' column: items without groups`, path: 'row 1', hint: 'set the tagsKey param' });
    const reader = createFlatReader(builder, pathsOf(p));
    input.rows.forEach((row, r) => {
      const path = `row ${r + 2}`;
      const id = readItemRow(row, input, cols, path, builder);
      if (id === undefined) return;
      builder.record(id);
      const cell = cellOf(row, tags);
      const tokens = cell === '' ? [] : cell.split(p.delimiter).map((t) => t.trim());
      reader.memberships(id, tokens, `${path}, column ${p.tagsKey}`);
    });
    return builder.build();
  },

  plan: (space, p) =>
    chainPlans(space, tablePlan, (s) =>
      flatPlan(s, {
        paths: pathsOf(p),
        invalidToken: (g) => g.includes(p.delimiter) || g !== g.trim(),
        tokenRule: `contain the delimiter '${p.delimiter}' or surrounding spaces (tokens are split and trimmed on read)`,
      }),
    ),

  write(space, p) {
    const { records } = flatRecords(space, pathsOf(p));
    const { table } = writeItemTable(records, { ...p, reserved: [p.tagsKey] }, { columns: [p.tagsKey], cells: (r) => [r.tags.join(p.delimiter)] });
    return { output: table };
  },
});
