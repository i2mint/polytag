/**
 * A minimal id-keyed registry, shared by the format, backend and view menus.
 *
 * Tag-agnostic: nothing here may import `@zodal/groups-*` (enforced by
 * `scripts/check-boundaries.mjs`), so it can move to zodal together with the
 * subpaths that use it.
 */

/** Anything a registry can hold: an entry with a stable, unique id. */
export interface Identified {
  readonly id: string;
}

/** An id-keyed collection of entries, in registration order. */
export interface Registry<T extends Identified> {
  /** Add an entry. Throws if an entry with the same id is already registered. */
  register(entry: T): void;
  /** The entry with this id, or `undefined`. */
  get(id: string): T | undefined;
  /** Whether an entry with this id is registered. */
  has(id: string): boolean;
  /** All entries, in registration order. */
  list(): T[];
}

/**
 * Create an empty registry.
 *
 * @param kind  What the entries are (e.g. `'format'`), used in error messages.
 */
export function createRegistry<T extends Identified>(kind = 'entry'): Registry<T> {
  const entries = new Map<string, T>();
  return {
    register(entry) {
      if (entries.has(entry.id)) {
        throw new Error(
          `A ${kind} with id '${entry.id}' is already registered. ` +
            `Registered ids: ${[...entries.keys()].join(', ')}.`,
        );
      }
      entries.set(entry.id, entry);
    },
    get: (id) => entries.get(id),
    has: (id) => entries.has(id),
    list: () => [...entries.values()],
  };
}
