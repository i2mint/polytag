/**
 * One row per item, for the CSV grammars `delimited` and `one-hot`: an id column, an
 * optional label and family column, payload columns, then the grammar's own membership
 * columns.
 */

import type { Table } from '../../formats/index.js';
import type { SpaceBuilder } from './builder.js';
import type { FlatRecord } from './flat.js';
import { FAMILY_KEY, PAYLOAD_KEY } from './records.js';
import { cellOf, columnIndex, familyCell, payloadCells, payloadColumns, readFamily, readPayload } from './table.js';

/** Where an item row's own fields are. */
export interface ItemColumns {
  readonly id: number;
  readonly label: number;
  readonly family: number;
  readonly payload: number;
  /** Other columns, read as payload fields. */
  readonly extra: readonly number[];
}

/** Locate the item columns, given the column indexes the grammar uses for memberships. */
export function itemColumns(table: Table, keys: { idKey: string; labelKey: string }, membership: ReadonlySet<number>): ItemColumns {
  const id = columnIndex(table, keys.idKey);
  const label = columnIndex(table, keys.labelKey);
  const family = columnIndex(table, FAMILY_KEY);
  const payload = columnIndex(table, PAYLOAD_KEY);
  const used = new Set([id, label, family, payload, ...membership]);
  return { id, label, family, payload, extra: table.columns.map((_, i) => i).filter((i) => !used.has(i)) };
}

/** Read one item row into `builder`; returns its id, or `undefined` (reported) when it has none. */
export function readItemRow(row: readonly string[], table: Table, cols: ItemColumns, path: string, builder: SpaceBuilder): string | undefined {
  const id = cellOf(row, cols.id);
  if (id === '') {
    builder.diag({ severity: 'error', code: 'missing-id', message: 'row has no id; skipped', path });
    builder.leftover(path, row);
    return undefined;
  }
  builder.node(
    id,
    {
      label: cellOf(row, cols.label) || undefined,
      family: readFamily(cellOf(row, cols.family), path, builder),
      payload: readPayload(row, table, cols.payload, cols.extra, path, builder),
    },
    path,
  );
  return id;
}

/** Write item rows: id, label, family and payload columns, then `membership` columns. */
export function writeItemTable(
  records: readonly FlatRecord[],
  keys: { idKey: string; labelKey: string },
  membership: { readonly columns: readonly string[]; readonly cells: (r: FlatRecord) => readonly string[] },
): { table: Table; payloadColumns: readonly string[] } {
  const nodes = records.map((r) => r.node);
  const hasLabel = nodes.some((n) => n.label !== undefined);
  const hasFamily = nodes.some((n) => n.family !== undefined);
  const base = [keys.idKey, ...(hasLabel ? [keys.labelKey] : []), ...(hasFamily ? [FAMILY_KEY] : [])];
  const payload = payloadColumns(nodes, [...base, ...membership.columns]);
  const rows = records.map((r) => [
    r.node.id,
    ...(hasLabel ? [r.node.label ?? ''] : []),
    ...(hasFamily ? [familyCell(r.node.family)] : []),
    ...payloadCells(r.node, payload),
    ...membership.cells(r),
  ]);
  return { table: { columns: [...base, ...payload.columns, ...membership.columns], rows }, payloadColumns: payload.columns };
}
