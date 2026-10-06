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
 * match). Cycle-safe: an object already on the current path is skipped.
 */
export function findPaths(value: unknown, test: (v: unknown) => boolean): string[] {
  const found: string[] = [];
  const stack = new Set<object>();
  const walk = (v: unknown, path: string): void => {
    if (test(v)) {
      found.push(path);
      return;
    }
    if (v === null || typeof v !== 'object' || stack.has(v)) return;
    stack.add(v);
    const entries: [string | number, unknown][] = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
    for (const [k, x] of entries) walk(x, `${path}/${pointerSegment(k)}`);
    stack.delete(v);
  };
  walk(value, '');
  return found;
}

/**
 * A copy of `value` without the nodes for which `test` holds: dropped from objects (the key
 * disappears) and from arrays (the element disappears). Shared sub-objects stay shared.
 */
export function stripValues(value: unknown, test: (v: unknown) => boolean): unknown {
  const copies = new Map<object, unknown>();
  const strip = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (copies.has(v)) return copies.get(v);
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      copies.set(v, out);
      for (const x of v) if (!test(x)) out.push(strip(x));
      return out;
    }
    if (!isPlainObject(v)) return v;
    const out: Record<string, unknown> = {};
    copies.set(v, out);
    for (const [k, x] of Object.entries(v)) {
      if (!test(x)) Object.defineProperty(out, k, { value: strip(x), enumerable: true, writable: true, configurable: true });
    }
    return out;
  };
  return strip(value);
}
