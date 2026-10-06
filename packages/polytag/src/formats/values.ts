/**
 * Small value helpers shared by the format codecs.
 *
 * extraction candidate: a zodal format package (second consumer: zodal-dials TOML/YAML stores)
 */

/** A plain object (`{}` literal, `Object.create(null)`, or a parsed JSON/YAML/TOML map). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Escape one JSON-pointer segment (RFC 6901). */
const pointerSegment = (key: string | number): string => String(key).replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * JSON-pointer paths of every node in `value` for which `test` holds (not descending into a
 * match). Cycle-safe (an object is visited once), and iterative, so deep values are fine.
 */
export function findPaths(value: unknown, test: (v: unknown) => boolean): string[] {
  const found: string[] = [];
  const seen = new Set<object>();
  const stack: [unknown, string][] = [[value, '']];
  while (stack.length) {
    const [v, path] = stack.pop()!;
    if (test(v)) {
      found.push(path);
      continue;
    }
    if (v === null || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    const entries: [string | number, unknown][] = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
    for (let i = entries.length - 1; i >= 0; i--) stack.push([entries[i]![1], `${path}/${pointerSegment(entries[i]![0])}`]);
  }
  return found;
}

/**
 * A copy of `value` without the nodes for which `test` holds: dropped from objects (the key
 * disappears) and from arrays (the element disappears). Shared sub-objects stay shared, and
 * cycles stay cycles. Iterative, so deep values are fine.
 */
export function stripValues(value: unknown, test: (v: unknown) => boolean): unknown {
  const copies = new Map<object, unknown>();
  const work: [object, unknown[] | Record<string, unknown>][] = [];
  const copyOf = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (copies.has(v)) return copies.get(v);
    if (!Array.isArray(v) && !isPlainObject(v)) return v;
    const out = Array.isArray(v) ? [] : {};
    copies.set(v, out);
    work.push([v, out]);
    return out;
  };
  const root = copyOf(value);
  while (work.length) {
    const [src, out] = work.pop()!;
    if (Array.isArray(src)) {
      for (const x of src) if (!test(x)) (out as unknown[]).push(copyOf(x));
    } else {
      for (const [k, x] of Object.entries(src)) {
        if (!test(x)) Object.defineProperty(out, k, { value: copyOf(x), enumerable: true, writable: true, configurable: true });
      }
    }
  }
  return root;
}
