/**
 * The view menu is computed, not declared: given what a collection offers (its field roles and
 * families), each view is offered, offered in a weaker form, or greyed out with the reason
 * (ui-patterns §3.4, §4.1).
 *
 * A view entry is a template: `config(caps)` builds its `ViewConfig` for one collection (a
 * board needs the family to group by, a calendar the date field), and `gaps(caps)` says what
 * stops it. Gaps are codes, not prose, so an app or an agent can act on them; `GAP_MESSAGES`
 * gives the default wording.
 *
 * extraction candidate: zodal (a generic rank-and-degrade registry; `@zodal/ui`'s registry
 * resolves fields only).
 */

import { createRegistry, type Registry } from '../internal/registry.js';
import { DEFAULT_INTERACTION, type ViewConfig } from './config.js';

/**
 * What a collection offers a view, as plain data. The tag-aware root derives it from a schema
 * and a group space; anything else can fill it by hand.
 */
export interface CollectionCapabilities {
  /** Field roles: which field holds the item's date, cover image, title... */
  readonly roles?: {
    readonly title?: string;
    readonly cover?: string;
    readonly date?: string;
    readonly start?: string;
    readonly end?: string;
  };
  /** The families of the group space; `exclusive` means an item has at most one tag of it. */
  readonly families?: readonly { readonly name: string; readonly exclusive: boolean }[];
  /** The most groups one item is in, if known; `0` means nothing is tagged yet. */
  readonly maxGroupsPerItem?: number;
}

/** Why a view is unavailable (`blocking`) or offered in a weaker form (`degraded`). */
export type GapCode = 'needs-date-role' | 'needs-start-role' | 'needs-exclusive-family' | 'needs-cover-role';

/** Default wording for each gap. */
export const GAP_MESSAGES: Readonly<Record<GapCode, string>> = Object.freeze({
  'needs-date-role': 'No field has the date role, so items cannot be placed on a calendar.',
  'needs-start-role': 'No field has the start (or date) role, so items cannot be placed on a timeline.',
  'needs-exclusive-family':
    'No family is exclusive (one tag per item), so a board would put a card in several columns.',
  'needs-cover-role': 'No field has the cover role, so cards show no image.',
});

/** A gap, with whether it hides the view (`blocking`) or only weakens it. */
export interface Gap {
  readonly code: GapCode;
  readonly blocking: boolean;
}

/** One view of the menu: a template over a collection's capabilities. */
export interface ViewEntry {
  /** Unique key, e.g. `'three-pane'`. */
  readonly id: string;
  /** Lower ranks come first. */
  readonly rank: number;
  readonly label: string;
  /** Which weakness of the default view this one repairs (empty for the default). */
  readonly repairs: string;
  /** What stops or weakens this view for a collection. */
  readonly gaps: (caps: CollectionCapabilities) => readonly Gap[];
  /** The view's config for a collection. Only called when no gap is blocking. */
  readonly config: (caps: CollectionCapabilities) => ViewConfig;
}

/** A menu line for one collection. */
export interface MenuItem {
  readonly id: string;
  readonly rank: number;
  readonly label: string;
  readonly repairs: string;
  readonly enabled: boolean;
  /** Every gap, blocking or not. */
  readonly gaps: readonly Gap[];
  /** The config to apply, when enabled. */
  readonly config?: ViewConfig;
}

/** Create an empty view menu: of {@link ViewEntry}s keyed by id, or of any view type keyed by `keyOf`. */
export function createViewMenu(): Registry<ViewEntry>;
export function createViewMenu<V>(keyOf: (view: V) => string): Registry<V>;
export function createViewMenu<V>(keyOf?: (view: V) => string): Registry<V> | Registry<ViewEntry> {
  return keyOf ? createRegistry(keyOf, { kind: 'view' }) : createRegistry((entry: ViewEntry) => entry.id, { kind: 'view' });
}

/** The menu for one collection: every entry, ranked, enabled or greyed out with its gaps. */
export function availableViews(
  menu: Registry<ViewEntry> | readonly ViewEntry[],
  caps: CollectionCapabilities,
): MenuItem[] {
  const entries: readonly ViewEntry[] = 'list' in menu ? menu.list() : menu;
  return [...entries]
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => {
      const gaps = entry.gaps(caps);
      const enabled = !gaps.some((g) => g.blocking);
      const { id, rank, label, repairs } = entry;
      return enabled ? { id, rank, label, repairs, enabled, gaps, config: entry.config(caps) } : { id, rank, label, repairs, enabled, gaps };
    });
}

// ---- the ranked default menu (ui-patterns §4.1) ----

const none = (): readonly Gap[] => [];
const blocking = (code: GapCode): Gap => ({ code, blocking: true });
const degraded = (code: GapCode): Gap => ({ code, blocking: false });
const firstExclusive = (caps: CollectionCapabilities) => caps.families?.find((f) => f.exclusive);
const startOf = (caps: CollectionCapabilities) => caps.roles?.start ?? caps.roles?.date;

const base = { interaction: DEFAULT_INTERACTION } as const;
const inspector = { sections: ['fields', 'memberships'] } as const;

/** The eight default views, ranked by how often each fits documents, media, references and records. */
export const DEFAULT_VIEWS: readonly ViewEntry[] = Object.freeze([
  {
    id: 'three-pane',
    rank: 1,
    label: 'Three-pane: groups, table, inspector',
    repairs: '',
    gaps: none,
    config: () => ({
      ...base,
      shell: 'three-pane',
      navigator: { surface: 'auto' },
      layout: { kind: 'table' },
      inspector: { sections: [...inspector.sections] },
    }),
  },
  {
    id: 'file-manager',
    rank: 2,
    label: 'Two-pane file manager: group sidebar and list',
    repairs: 'Lower learning cost: the folder model, with no inspector to learn.',
    gaps: none,
    config: () => ({ ...base, shell: 'two-pane', navigator: { surface: 'auto' }, layout: { kind: 'list' } }),
  },
  {
    id: 'gallery',
    rank: 3,
    label: 'Gallery: sidebar and cards with tag chips',
    repairs: 'Items recognised by their image, not their title.',
    gaps: (caps) => (caps.roles?.cover ? [] : [degraded('needs-cover-role')]),
    config: (caps) => ({
      ...base,
      shell: 'two-pane',
      navigator: { surface: 'auto' },
      layout: caps.roles?.cover ? { kind: 'cards', cover: caps.roles.cover } : { kind: 'cards' },
    }),
  },
  {
    id: 'faceted',
    rank: 4,
    label: 'Faceted browse: facet panel and results',
    repairs: 'Large collections with many families: narrow by several at once.',
    gaps: none,
    config: () => ({
      ...base,
      shell: 'three-pane',
      navigator: { surface: 'facets' },
      layout: { kind: 'table' },
      inspector: { sections: [...inspector.sections] },
    }),
  },
  {
    id: 'triage',
    rank: 5,
    label: 'Triage: the untagged items, one at a time',
    repairs: 'Items that arrive faster than they are filed are never lost among the filed ones.',
    gaps: none,
    config: () => ({
      ...base,
      shell: 'three-pane',
      layout: { kind: 'triage', source: 'untagged' },
      inspector: { sections: [...inspector.sections] },
    }),
  },
  {
    id: 'board',
    rank: 6,
    label: 'Board by family',
    repairs: 'Lifecycle at a glance: one column per tag of an exclusive family, drag to change it.',
    gaps: (caps) => (firstExclusive(caps) ? [] : [blocking('needs-exclusive-family')]),
    config: (caps) => ({
      ...base,
      shell: 'two-pane',
      navigator: { surface: 'auto' },
      layout: { kind: 'board', groupBy: { family: firstExclusive(caps)!.name }, multiValue: 'forbid', showEmpty: true },
    }),
  },
  {
    id: 'miller',
    rank: 7,
    label: 'Miller columns: three-pane with a column navigator',
    repairs: 'Deep or polyhierarchical taxonomies: every path stays visible.',
    gaps: none,
    config: () => ({
      ...base,
      shell: 'three-pane',
      navigator: { surface: 'columns' },
      layout: { kind: 'table' },
      inspector: { sections: [...inspector.sections] },
    }),
  },
  {
    id: 'calendar',
    rank: 8,
    label: 'Calendar',
    repairs: 'Dated records placed in time.',
    gaps: (caps) => (caps.roles?.date ? [] : [blocking('needs-date-role')]),
    config: (caps) => ({ ...base, shell: 'two-pane', navigator: { surface: 'auto' }, layout: { kind: 'calendar', dateField: caps.roles!.date!, range: 'month' } }),
  },
  {
    id: 'timeline',
    rank: 8,
    label: 'Timeline',
    repairs: 'Records with a duration, placed in time.',
    gaps: (caps) => (startOf(caps) ? [] : [blocking('needs-start-role')]),
    config: (caps) => ({
      ...base,
      shell: 'two-pane',
      navigator: { surface: 'auto' },
      layout: caps.roles?.end
        ? { kind: 'timeline', startField: startOf(caps)!, endField: caps.roles.end }
        : { kind: 'timeline', startField: startOf(caps)! },
    }),
  },
] satisfies ViewEntry[]);

/** A view menu holding the ranked default views. */
export function defaultViewMenu(): Registry<ViewEntry> {
  const menu = createViewMenu();
  for (const entry of DEFAULT_VIEWS) menu.register(entry);
  return menu;
}
