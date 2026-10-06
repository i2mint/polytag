/**
 * Table helpers shared by the CSV grammars (edge-rows, delimited, one-hot).
 *
 * Cells are strings and an empty cell means "absent" (CSV has no null). A payload is written
 * as one column per field when every payload is a flat map of non-empty strings (readable,
 * and exact); otherwise as one `payload` column of JSON text, the Table Schema convention for
 * structured cells (formats-and-grammars §3(g)), which is exact for any JSON value.
 */

import { isPlainObject, type Table } from '../../formats/index.js';
import { type Loss, type Reduction, loss } from '../../loss.js';
import type { FamilyRule, SnapshotNode, SpaceSnapshot } from '../../model/snapshot.js';
import type { SpaceBuilder } from './builder.js';
import { FAMILY_KEY, PAYLOAD_KEY, isFamilyRule } from './records.js';

/** The cell at `index` of `row`, `''` when missing. */
export const cellOf = (row: readonly string[], index: number): string => (index < 0 ? '' : (row[index] ?? ''));

/** The index of a column, or -1. */
export const columnIndex = (table: Table, name: string | undefined): number => (name === undefined ? -1 : table.columns.indexOf(name));

/** How payloads are laid out in columns. */
export interface PayloadColumns {
  readonly mode: 'spread' | 'json';
  readonly columns: readonly string[];
}

/**
 * Choose the payload columns for `nodes` given the column names already taken; `spreadable`
 * may veto spreading (one-hot: columns that would read back as groups).
 */
export function payloadColumns(nodes: readonly SnapshotNode[], taken: readonly string[], spreadable: (columns: readonly string[]) => boolean = () => true): PayloadColumns {
  const payloads = nodes.map((n) => n.payload).filter((p) => p !== undefined);
  if (!payloads.length) return { mode: 'spread', columns: [] };
  const reserved = new Set([...taken, PAYLOAD_KEY, FAMILY_KEY]);
  const spreadOk = spreadable;
  const spreadable0 = payloads.every(
    (p) => isPlainObject(p) && Object.keys(p).length > 0 && Object.entries(p).every(([k, v]) => k !== '' && !reserved.has(k) && typeof v === 'string' && v !== ''),
  );
  if (!spreadable0) return { mode: 'json', columns: [PAYLOAD_KEY] };
  const columns = [...new Set(payloads.flatMap((p) => Object.keys(p as object)))];
  if (!spreadOk(columns)) return { mode: 'json', columns: [PAYLOAD_KEY] };
  return { mode: 'spread', columns };
}

/** A node's payload cells, in `layout.columns` order. */
export function payloadCells(node: SnapshotNode, layout: PayloadColumns): string[] {
  if (layout.mode === 'json') return [node.payload === undefined ? '' : JSON.stringify(node.payload)];
  const p = (node.payload ?? {}) as Record<string, unknown>;
  return layout.columns.map((c) => (Object.prototype.hasOwnProperty.call(p, c) ? String(p[c]) : ''));
}

/** A family rule as a cell. */
export const familyCell = (family: FamilyRule | undefined): string => (family ? JSON.stringify(family) : '');

/** Parse a JSON cell, reporting (and returning the raw string) when it is not JSON. */
export function jsonCell(text: string, what: string, path: string, builder: SpaceBuilder): unknown {
  try {
    return JSON.parse(text);
  } catch {
    builder.diag({ severity: 'warning', code: 'ignored-field', message: `${what} is not JSON; read as text`, path });
    return text;
  }
}

/** Read a family cell. */
export function readFamily(text: string, path: string, builder: SpaceBuilder): FamilyRule | undefined {
  if (text === '') return undefined;
  const value = jsonCell(text, 'family', path, builder);
  if (isFamilyRule(value)) return { maxPerItem: value.maxPerItem };
  builder.diag({ severity: 'warning', code: 'ignored-field', message: 'family is not { "maxPerItem": n }; ignored', path });
  return undefined;
}

/**
 * Read a row's payload from the `payload` JSON column and/or the remaining columns (`extra`,
 * indexes). Empty cells are absent; no cell at all is no payload.
 */
export function readPayload(row: readonly string[], table: Table, payloadIndex: number, extra: readonly number[], path: string, builder: SpaceBuilder): unknown {
  const fields = extra.map((i) => [table.columns[i]!, cellOf(row, i)] as const).filter(([, v]) => v !== '');
  const json = cellOf(row, payloadIndex);
  if (json === '') return fields.length ? Object.fromEntries(fields) : undefined;
  const parsed = jsonCell(json, 'payload', path, builder);
  if (!fields.length) return parsed;
  return isPlainObject(parsed) ? { ...Object.fromEntries(fields), ...parsed } : Object.fromEntries([...fields, [PAYLOAD_KEY, parsed]]);
}

/** Distinct values ÷ non-empty cells of a column (low = repeats, a group side). */
export function cardinality(table: Table, index: number): number {
  const values = table.rows.map((r) => cellOf(r, index)).filter((v) => v !== '');
  return values.length ? new Set(values).size / values.length : 1;
}

/**
 * What a table cannot hold, planned before writing: an empty cell reads as absent, so an
 * empty label or order is left out, and a node with an empty id cannot be a row (it and its
 * edges are left out). Pure; reports each by id.
 */
export function tablePlan(space: SpaceSnapshot): Reduction {
  const losses: Loss[] = [];
  const emptyNode = space.nodes.some((n) => n.id === '');
  const deadEdges = space.edges.filter((e) => e.parent === '' || e.child === '').map((e) => e.id);
  if (emptyNode || deadEdges.length) {
    losses.push(loss('identity-collision', 'drop', [...(emptyNode ? [''] : []), ...deadEdges], 'a node with an empty id cannot be a table row; it and its edges are left out'));
  }
  const dead = new Set(deadEdges);
  const edges0 = space.edges.filter((e) => !dead.has(e.id));
  const groups = new Set(edges0.map((e) => e.parent));
  const blankLabel = space.nodes.filter((n) => n.id !== '' && n.label === '');
  losses.push(
    loss('group-meta', 'drop', blankLabel.filter((n) => groups.has(n.id)).map((n) => n.id), 'an empty label reads back as no label in a table'),
    loss('item-meta', 'drop', blankLabel.filter((n) => !groups.has(n.id)).map((n) => n.id), 'an empty label reads back as no label in a table'),
    loss('edge-label', 'drop', edges0.filter((e) => e.label === '').map((e) => e.id), 'an empty edge label reads back as no label in a table'),
    loss('edge-order', 'drop', edges0.filter((e) => e.order === '').map((e) => e.id), 'an empty order reads back as no order in a table'),
  );
  const nodes = space.nodes
    .filter((n) => n.id !== '')
    .map((n) => {
      if (n.label !== '') return n;
      const { label: _, ...rest } = n;
      return rest;
    });
  const edges = edges0.map((e) => {
    if (e.label !== '' && e.order !== '') return e;
    const { label, order, ...rest } = e;
    return { ...rest, ...(label !== '' && label !== undefined ? { label } : {}), ...(order !== '' && order !== undefined ? { order } : {}) };
  });
  return { space: { nodes, edges }, losses };
}

/** Run plans one after the other, collecting their losses. */
export function chainPlans(space: SpaceSnapshot, ...plans: ((s: SpaceSnapshot) => Reduction)[]): Reduction {
  return plans.reduce<Reduction>(
    (acc, plan) => {
      const next = plan(acc.space);
      return { space: next.space, losses: [...acc.losses, ...next.losses] };
    },
    { space, losses: [] },
  );
}
