/**
 * Shape helpers for detection and parsing: the name lexicon of formats-and-grammars §6.2,
 * finding the record array of a document, and choosing id and tag fields.
 *
 * Scores and thresholds here are estimates (formats-and-grammars §6, "[estimate]"), tuned on
 * the reference-dataset fixtures; the playground shows evidence and a preview so the user
 * confirms with data, not a name.
 */

import { isPlainObject } from '../../formats/index.js';

/** Field names that hint at a role. */
export const LEXICON = {
  id: ['id', 'name', 'slug', 'key', 'path', 'uid', 'title'],
  tags: ['tags', 'tag', 'categories', 'category', 'labels', 'keywords', 'groups', 'collections', 'folders', 'topics', 'subjects'],
  children: ['children', 'items', 'members', 'contents', 'nodes', 'subgroups', 'subfolders', 'entries'],
  parent: ['parent', 'parent_id', 'parentId', 'group', 'folder', 'category', 'tag', 'collection', 'source', 'from'],
  child: ['child', 'child_id', 'childId', 'item', 'member', 'target', 'to', 'id', 'name'],
} as const;

/** Is `name` (case-insensitively) in a lexicon list? */
export const inLexicon = (name: string, list: readonly string[]): boolean => list.includes(name.toLowerCase() as never);

/** Is `v` a string, number or boolean? */
export const isScalar = (v: unknown): v is string | number | boolean => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/** The array a document's records live in: the root array, or the one array of objects under a key. */
export interface RecordArray {
  readonly array: readonly unknown[];
  /** The key it was under, if any. */
  readonly key?: string;
  /** The other top-level entries (residue). */
  readonly rest: readonly [string, unknown][];
}

/** Find the record array of `value`: itself, `value[key]`, or the single array-of-objects entry. */
export function recordArray(value: unknown, key?: string): RecordArray | undefined {
  if (Array.isArray(value)) return { array: value, rest: [] };
  if (!isPlainObject(value)) return undefined;
  const entries = Object.entries(value);
  const pick = (k: string): RecordArray => ({ array: value[k] as unknown[], key: k, rest: entries.filter(([e]) => e !== k) });
  if (key !== undefined && Object.prototype.hasOwnProperty.call(value, key) && Array.isArray(value[key])) return pick(key);
  const candidates = entries.filter(([, v]) => Array.isArray(v) && v.length > 0 && v.every(isPlainObject));
  return candidates.length === 1 ? pick(candidates[0]![0]) : undefined;
}

/** Keys present in at least `share` of `objects`, in first-seen order. */
export function commonKeys(objects: readonly Record<string, unknown>[], share = 0.8): string[] {
  const counts = new Map<string, number>();
  for (const o of objects) for (const k of Object.keys(o)) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts].filter(([, n]) => n >= share * objects.length).map(([k]) => k);
}

/**
 * The best id field: present with a scalar in every record. A lexicon name (`id`, `name`...)
 * wins even with duplicates (those are a data problem the parser reports); any other field
 * must be unique.
 */
export function pickIdKey(objects: readonly Record<string, unknown>[], exclude: readonly string[] = []): string | undefined {
  const keys = commonKeys(objects, 1).filter((k) => !exclude.includes(k) && objects.every((o) => isScalar(o[k]) && o[k] !== ''));
  const unique = (k: string): boolean => new Set(objects.map((o) => String(o[k]))).size === objects.length;
  const rank = (k: string): number => LEXICON.id.indexOf(k.toLowerCase() as never);
  const named = keys.filter((k) => rank(k) >= 0).sort((a, b) => rank(a) - rank(b));
  return named[0] ?? keys.find(unique);
}

/** Separators a path-string tag may use, in preference order. */
export const PATH_SEPARATORS = ['/', '|', '>', ':', '.'] as const;

/** The separator most tags contain, and the share of tags containing it. */
export function dominantSeparator(tags: readonly string[]): { separator: string; share: number } {
  let best = { separator: '/', share: 0 };
  if (!tags.length) return best;
  for (const sep of PATH_SEPARATORS) {
    const share = tags.filter((t) => t.includes(sep) && !t.startsWith(sep) && !t.endsWith(sep)).length / tags.length;
    if (share > best.share) best = { separator: sep, share };
  }
  return best;
}

/**
 * A field whose values are lists of scalars in most records: a tag-field candidate, with how
 * much its values repeat across records (tags repeat; descriptions and URLs do not).
 */
export interface ListField {
  readonly key: string;
  readonly coverage: number;
  readonly values: readonly string[];
  readonly repetition: number;
}

/** List-of-scalar fields of `objects`, best tag candidates first. */
export function listFields(objects: readonly Record<string, unknown>[]): ListField[] {
  const keys = commonKeys(objects, 0.5);
  const fields: ListField[] = [];
  for (const key of keys) {
    const lists = objects.map((o) => o[key]).filter((v) => v !== undefined && v !== null);
    if (!lists.length || !lists.every((v) => Array.isArray(v) && v.every((x) => isScalar(x) || x === null))) continue;
    const values = (lists as unknown[][]).flat().filter(isScalar).map(String);
    const repetition = values.length ? 1 - new Set(values).size / values.length : 0;
    fields.push({ key, coverage: lists.length / objects.length, values, repetition });
  }
  const score = (f: ListField): number => (inLexicon(f.key, LEXICON.tags) ? 1 : 0) + f.repetition + f.coverage;
  return fields.sort((a, b) => score(b) - score(a));
}
