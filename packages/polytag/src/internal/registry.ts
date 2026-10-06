/**
 * A minimal keyed registry, shared by the format, backend and view menus.
 *
 * The caller says how an entry is keyed (`(d) => d.name` for zodal's
 * `ProviderDescriptor`, `(f) => f.id` elsewhere), so no entry shape is assumed here.
 *
 * Tag-agnostic: nothing here may import `@zodal/groups-*` (enforced by
 * `scripts/check-boundaries.mjs`), so it can move to zodal together with the
 * subpaths that use it.
 */

/** A collection of entries keyed by a caller-chosen string, in registration order. */
export interface Registry<T> {
  /** Add an entry. Throws if an entry with the same key is already registered. */
  register(entry: T): void;
  /** The entry with this key, or `undefined`. */
  get(key: string): T | undefined;
  /** Whether an entry with this key is registered. */
  has(key: string): boolean;
  /** All entries, in registration order. */
  list(): T[];
}

/** Options for {@link createRegistry}. */
export interface RegistryOptions {
  /** What the entries are (e.g. `'format'`), used in error messages. Default `'entry'`. */
  kind?: string;
}

/**
 * Create an empty registry.
 *
 * @param keyOf  The entry's unique key.
 */
export function createRegistry<T>(keyOf: (entry: T) => string, { kind = 'entry' }: RegistryOptions = {}): Registry<T> {
  const entries = new Map<string, T>();
  return {
    register(entry) {
      const key = keyOf(entry);
      if (entries.has(key)) {
        throw new Error(
          `A ${kind} with key '${key}' is already registered. Registered keys: ${[...entries.keys()].join(', ')}.`,
        );
      }
      entries.set(key, entry);
    },
    get: (key) => entries.get(key),
    has: (key) => entries.has(key),
    list: () => [...entries.values()],
  };
}
