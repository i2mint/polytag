/**
 * Node ↔ record mapping shared by the value grammars, and scalar coercion with diagnostics.
 *
 * A record is `{ [idKey]: id, [labelKey]?: label, family?: rule, ...payload, ...structural }`.
 * The payload is spread into the record when that is reversible (a non-empty plain object
 * none of whose keys is reserved); otherwise it goes under a `payload` key. Reading inverts
 * this exactly: unknown keys are the payload, or `payload` alone is. Records are built with
 * `Object.fromEntries` and read with own-key checks, so ids like `__proto__` and
 * `constructor` are ordinary keys, never prototype lookups.
 */

import { isPlainObject } from '../../formats/index.js';
import type { FamilyRule, SnapshotNode } from '../../model/snapshot.js';
import type { NodeData, SpaceBuilder } from './builder.js';

/** Own-property read: `undefined` unless `key` is the object's own key. */
export const own = (obj: Record<string, unknown>, key: string): unknown => (Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);

/** Whether `key` is an own key of `obj`. */
export const hasOwn = (obj: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);

/** The key a non-spreadable payload is written under. */
export const PAYLOAD_KEY = 'payload';
/** The key a family rule is written under. */
export const FAMILY_KEY = 'family';

/** Is `value` a valid family rule (`{ maxPerItem: integer ≥ 1 }`)? */
export const isFamilyRule = (value: unknown): value is FamilyRule =>
  isPlainObject(value) && Number.isInteger(value.maxPerItem) && (value.maxPerItem as number) >= 1 && Object.keys(value).length === 1;

/**
 * Read a scalar where a string (an id, a tag) is expected. Numbers, booleans and dates (a
 * TOML datetime) are stringified with a `coerced-scalar` warning (YAML 1.2 reads `010` as 10
 * and, in 1.1, `yes` as true); anything else is `undefined`.
 */
export function coerceString(value: unknown, what: string, path: string, builder: SpaceBuilder): string | undefined {
  if (typeof value === 'string') return value;
  if (value instanceof Date) {
    const s = value.toISOString();
    builder.diag({
      severity: 'warning',
      code: 'coerced-scalar',
      message: `${what} ${s} is a date, read as the string '${s}'`,
      path,
      ids: [s],
      hint: 'quote it in the source to keep its exact spelling',
    });
    return s;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    const s = String(value);
    builder.diag({
      severity: 'warning',
      code: 'coerced-scalar',
      message: `${what} ${s} is a ${typeof value}, read as the string '${s}'`,
      path,
      ids: [s],
      hint: 'quote it in the source if it should keep leading zeros or its exact spelling (YAML reads 010 as the number 10)',
    });
    return s;
  }
  return undefined;
}

/** Where a record's keys go. */
export interface RecordLayout {
  readonly idKey: string;
  readonly labelKey: string;
  /** Keys the grammar uses for structure (`tags`, `children`...): never payload. */
  readonly structural: readonly string[];
}

const reservedOf = (layout: RecordLayout): Set<string> =>
  new Set([layout.idKey, layout.labelKey, FAMILY_KEY, PAYLOAD_KEY, ...layout.structural]);

/** Can `payload` be spread into a record of this layout and read back identically? */
export function canSpread(payload: unknown, layout: RecordLayout): payload is Record<string, unknown> {
  if (!isPlainObject(payload)) return false;
  const keys = Object.keys(payload);
  const reserved = reservedOf(layout);
  return keys.length > 0 && keys.every((k) => !reserved.has(k));
}

/** The record entries of a node's label, family and payload (structure and id are the caller's). */
export function nodeEntries(node: SnapshotNode, layout: RecordLayout): [string, unknown][] {
  const entries: [string, unknown][] = [];
  if (node.label !== undefined) entries.push([layout.labelKey, node.label]);
  if (node.family !== undefined) entries.push([FAMILY_KEY, { ...node.family }]);
  if (node.payload !== undefined) {
    if (canSpread(node.payload, layout)) entries.push(...Object.entries(node.payload));
    else entries.push([PAYLOAD_KEY, node.payload]);
  }
  return entries;
}

/** A record for `node`: id first, then label, family, payload, then the structural entries. */
export function writeRecord(node: SnapshotNode, layout: RecordLayout, structural: [string, unknown][] = []): Record<string, unknown> {
  return Object.fromEntries([[layout.idKey, node.id], ...nodeEntries(node, layout), ...structural]);
}

/** Read a record's label, family and payload (its id and structure are the caller's). */
export function readNodeData(record: Record<string, unknown>, layout: RecordLayout, path: string, builder: SpaceBuilder): NodeData {
  const reserved = reservedOf(layout);
  const extras = Object.keys(record).filter((k) => !reserved.has(k));
  let label: string | undefined;
  if (hasOwn(record, layout.labelKey)) {
    const raw = own(record, layout.labelKey);
    label = coerceString(raw, 'label', `${path}/${layout.labelKey}`, builder);
    if (label === undefined && raw !== null && raw !== undefined) extras.push(layout.labelKey);
  }
  let family: FamilyRule | undefined;
  if (hasOwn(record, FAMILY_KEY)) {
    const raw = own(record, FAMILY_KEY);
    if (isFamilyRule(raw)) family = { maxPerItem: raw.maxPerItem };
    else extras.push(FAMILY_KEY);
  }
  let payload: unknown;
  if (extras.length) {
    payload = Object.fromEntries([...extras.map((k) => [k, own(record, k)] as const), ...(hasOwn(record, PAYLOAD_KEY) ? [[PAYLOAD_KEY, own(record, PAYLOAD_KEY)] as const] : [])]);
  } else if (hasOwn(record, PAYLOAD_KEY)) {
    payload = own(record, PAYLOAD_KEY);
  }
  return { label, family, payload };
}
