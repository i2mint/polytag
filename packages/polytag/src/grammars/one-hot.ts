/**
 * `one-hot` (f): a CSV row per item and a boolean column per group.
 *
 * ```csv
 * id,food,italian,vegetarian,quick
 * carbonara,0,1,0,1
 * notes,0,0,0,0
 * ```
 *
 * Flat (formats-and-grammars §3(f)); an all-zero row is an orphan and an all-zero column an
 * empty group (both read as an isolated node). Truthiness is not standardised, so
 * `trueValues` / `falseValues` are params; group columns are `groupColumns` when given, else
 * those with `columnPrefix`, else every column whose cells are all boolean. A group whose
 * column name collides with another column, and a payload column whose values all look
 * boolean (it would read back as a group), are reported on write.
 */

import { z } from 'zod';
import { isTable } from '../formats/index.js';
import { type Detection, defineGrammar, noDetection } from '../grammar.js';
import type { GrammarCapabilities } from '../loss.js';
import { createSpaceBuilder } from './shared/builder.js';
import { createFlatReader, flatPlan, flatRecords } from './shared/flat.js';
import { itemColumns, readItemRow, writeItemTable } from './shared/item-table.js';
import { FAMILY_KEY, PAYLOAD_KEY } from './shared/records.js';
import { pickIdKey } from './shared/shape.js';
import type { SnapshotNode } from '../model/snapshot.js';
import { cellOf, chainPlans, columnIndex, tablePlan } from './shared/table.js';

const TRUE = ['1', 'true', 'True', 'TRUE', 'x', 'X', 'yes', 'Yes', 'YES', 'y', 'Y'];
const FALSE = ['0', 'false', 'False', 'FALSE', 'no', 'No', 'NO', 'n', 'N', ''];

/** Params of `one-hot`. */
export const oneHotParams = z.object({
  idKey: z.string().min(1).default('id'),
  labelKey: z.string().min(1).default('label'),
  /** Written for membership. */
  trueValue: z.string().default('1'),
  /** Written for non-membership. */
  falseValue: z.string().default('0'),
  /** Read as membership. */
  trueValues: z.array(z.string()).default(TRUE),
  /** Read as non-membership. */
  falseValues: z.array(z.string()).default(FALSE),
  /** The group columns, when the default inference (prefix, else all-boolean columns) is not right. */
  groupColumns: z.array(z.string()).optional(),
  /** A prefix that marks group columns (`tag:italian`); stripped to get the group id. */
  columnPrefix: z.string().default(''),
});
export type OneHotParams = z.infer<typeof oneHotParams>;

const CAPS: GrammarCapabilities = {
  itemsMultiParent: 'native',
  nestedGroups: 'no',
  groupsMultiParent: 'no',
  groupMeta: 'no',
  itemMeta: 'native',
  edgeOrder: 'no',
  edgeLabel: 'no',
  edgeMeta: 'no',
  isolatedNodes: 'native',
  edgeKinds: 'single',
  edgeIds: 'no',
  identity: 'token',
};

/** Indexes of the columns whose every cell is in the boolean domain, except `skip`. */
function booleanColumns(table: { columns: readonly string[]; rows: readonly (readonly string[])[] }, domain: ReadonlySet<string>, skip: ReadonlySet<number>): number[] {
  return table.columns
    .map((_, i) => i)
    .filter((i) => !skip.has(i) && table.rows.every((r) => domain.has(cellOf(r, i))) && table.rows.some((r) => cellOf(r, i) !== ''));
}

function detect(input: unknown): Detection<OneHotParams> {
  if (!isTable(input) || input.columns.length < 3 || !input.rows.length) return noDetection();
  const domain = new Set([...TRUE, ...FALSE]);
  const records = input.rows.map((r) => Object.fromEntries(input.columns.map((c, i) => [c, cellOf(r, i)])));
  const bools = booleanColumns(input, domain, new Set());
  const idKey = pickIdKey(records, bools.map((i) => input.columns[i]!));
  if (bools.length < 2) return noDetection();
  const share = bools.length / (input.columns.length - 1);
  return {
    score: 0.5 * Math.min(1, share) + 0.3 * (bools.length >= 3 ? 1 : 0.4) + 0.2 * (idKey ? 1 : 0.3),
    evidence: [`${bools.length} of ${input.columns.length} columns hold only boolean cells (${bools.slice(0, 5).map((i) => input.columns[i]).join(', ')}…)`, idKey ? `'${idKey}' is a unique id column` : 'no unique id column'],
    suggestedParams: { ...(idKey ? { idKey } : {}) },
  };
}

/** `one-hot`: one boolean column per group. */
export const oneHot = defineGrammar<OneHotParams>({
  id: 'one-hot',
  label: 'One-hot group columns',
  description: 'A CSV row per item and a boolean column per group. Flat; no order, labels or group metadata.',
  inputs: ['table'],
  formats: ['csv', 'tsv'],
  params: oneHotParams,
  capabilities: CAPS,
  detect,

  parse(input, p) {
    const builder = createSpaceBuilder();
    if (!isTable(input)) {
      builder.diag({ severity: 'error', code: 'shape', message: 'expected a table (CSV or TSV)', path: '' });
      return builder.build();
    }
    const id = columnIndex(input, p.idKey);
    if (id < 0) {
      builder.diag({ severity: 'error', code: 'shape', message: `no '${p.idKey}' column`, path: 'row 1', hint: 'set the idKey param' });
      return builder.build();
    }
    const own = new Set([id, columnIndex(input, p.labelKey), columnIndex(input, FAMILY_KEY), columnIndex(input, PAYLOAD_KEY)]);
    const truthy = new Set(p.trueValues);
    const falsy = new Set(p.falseValues);
    let groupIdx: number[];
    if (p.groupColumns) {
      groupIdx = p.groupColumns.map((c) => columnIndex(input, c));
      p.groupColumns.filter((_, i) => groupIdx[i]! < 0).forEach((c) => builder.diag({ severity: 'warning', code: 'shape', message: `group column '${c}' not found`, path: 'row 1' }));
      groupIdx = groupIdx.filter((i) => i >= 0);
    } else if (p.columnPrefix) {
      groupIdx = input.columns.map((c, i) => (c.startsWith(p.columnPrefix) && !own.has(i) ? i : -1)).filter((i) => i >= 0);
    } else {
      groupIdx = booleanColumns(input, new Set([...truthy, ...falsy]), own);
    }
    const groupOf = (i: number): string => input.columns[i]!.slice(p.groupColumns ? 0 : p.columnPrefix.length);
    const cols = itemColumns(input, p, new Set(groupIdx));
    for (const i of groupIdx) builder.node(groupOf(i));
    const reader = createFlatReader(builder);
    input.rows.forEach((row, r) => {
      const path = `row ${r + 2}`;
      const item = readItemRow(row, input, cols, path, builder);
      if (item === undefined) return;
      builder.record(item);
      const tags = groupIdx.filter((i) => {
        const cell = cellOf(row, i);
        if (truthy.has(cell)) return true;
        if (!falsy.has(cell)) builder.diag({ severity: 'warning', code: 'not-boolean', message: `'${cell}' in column '${input.columns[i]}' is neither true nor false; read as false`, path, ids: [item] });
        return false;
      });
      reader.memberships(item, tags.map(groupOf), path);
    });
    return builder.build();
  },

  plan: (space, p) =>
    chainPlans(space, tablePlan, (s) =>
      flatPlan(s, {
        invalidToken: (g) => [p.idKey, p.labelKey, FAMILY_KEY, PAYLOAD_KEY].includes(`${p.columnPrefix}${g}`),
        tokenRule: `would be the same column as the id, label, family or payload column`,
      }),
    ),

  write(space, p) {
    const { records, groups } = flatRecords(space);
    const header = groups.map((g) => `${p.columnPrefix}${g}`);
    const domain = new Set([...p.trueValues, ...p.falseValues]);
    // Payload columns whose values all look boolean would read back as groups: write JSON instead.
    const inferred = !p.groupColumns && !p.columnPrefix;
    const spreadable = (nodes: readonly SnapshotNode[], columns: readonly string[]): boolean =>
      !inferred ||
      columns.every((c) => {
        const cells = nodes.map((n) => (n.payload as Record<string, unknown> | undefined)?.[c]).map((v) => (v === undefined ? '' : String(v)));
        return !(cells.every((v) => domain.has(v)) && cells.some((v) => v !== ''));
      });
    const { table } = writeItemTable(records, p, { columns: header, cells: (r) => groups.map((g) => (r.tags.includes(g) ? p.trueValue : p.falseValue)) }, { spreadable });
    return { output: table };
  },
});
