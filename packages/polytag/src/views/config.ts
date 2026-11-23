/**
 * `ViewConfig`: the lens through which a collection is shown, as one plain, serialisable object.
 *
 * Four slots (ui-patterns §1.1, §3.3, revised in ADR 0001 §Revision 1): a **shell** (how many
 * panes), a **navigator** (how a group scope is picked), an item **layout** (how the items in
 * scope are drawn, a discriminated union on `kind`) and an **inspector**, plus the
 * **interaction** defaults. Selection, filter, sort and scope are *not* here: they live once in
 * the collection state, so switching layout keeps them. A named snapshot of a lens plus that
 * state is a {@link SavedView}.
 *
 * Every schema is strict: an unknown key is an error, not a silently kept extra, so nothing
 * that is not part of the lens (a token, a local id) can ride along into a share link. The
 * one opaque part is a saved view's `filter` (any JSON until zodal publishes a schema for its
 * filter expressions): what a filter holds goes into the link as it is.
 *
 * Tag-agnostic: families and navigator surfaces are named by string here; resolving them
 * against a group space is the tag-aware root's job.
 */

import { z } from 'zod';
import { stableStringify } from '../model/snapshot.js';

/** Slot 1: how many panes, and what lives in each. */
export const ShellSchema = z.enum(['single', 'two-pane', 'three-pane']);
export type Shell = z.infer<typeof ShellSchema>;

/**
 * Slot 2: how the user picks a group scope: `auto`, or one of `@zodal/groups-ui`'s navigator
 * surfaces (`tree`, `columns` for Miller columns, `facets`, `groupChips` for the phone
 * browser). `auto` lets the app choose by the space's profile (groups-ui's `(surface,
 * profile)` scores: filesystem -> tree, polyhierarchy/thesaurus -> columns, flat tags -> facets).
 */
export const NavigatorSurfaceSchema = z.enum(['auto', 'tree', 'columns', 'facets', 'groupChips']);
export type NavigatorSurface = z.infer<typeof NavigatorSurfaceSchema>;

export const NavigatorConfigSchema = z.strictObject({ surface: NavigatorSurfaceSchema });
export type NavigatorConfig = z.infer<typeof NavigatorConfigSchema>;

/** A family (a set of sibling tags, such as `status`) named by its key in the group space. */
export const FamilyRefSchema = z.strictObject({ family: z.string().min(1) });
export type FamilyRef = z.infer<typeof FamilyRefSchema>;

/** Slot 3: how the items in scope are drawn. Type-specific settings are required where the layout needs them. */
export const LayoutConfigSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('table'), tagColumn: z.string().optional() }),
  z.strictObject({ kind: z.literal('list') }),
  z.strictObject({
    kind: z.literal('cards'),
    cover: z.string().optional(),
    size: z.enum(['sm', 'md', 'lg']).optional(),
    masonry: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal('board'),
    groupBy: FamilyRefSchema,
    subGroupBy: FamilyRefSchema.optional(),
    /** What a card in several columns' tags does. Explicit, because polyhierarchy makes it load-bearing. */
    multiValue: z.enum(['duplicate', 'primary', 'forbid']),
    showEmpty: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('calendar'), dateField: z.string().min(1), range: z.enum(['month', 'week']) }),
  z.strictObject({ kind: z.literal('timeline'), startField: z.string().min(1), endField: z.string().optional() }),
  z.strictObject({ kind: z.literal('triage'), source: z.literal('untagged') }),
]);
export type LayoutConfig = z.infer<typeof LayoutConfigSchema>;
export type LayoutKind = LayoutConfig['kind'];

/** Slot 4: what is shown for the selected item(s), or `false` for no inspector. */
export const InspectorConfigSchema = z.union([
  z.literal(false),
  z.strictObject({ sections: z.array(z.enum(['fields', 'memberships', 'notes', 'preview'])).min(1) }),
]);
export type InspectorConfig = z.infer<typeof InspectorConfigSchema>;

/** Which fields a layout shows (columns, or card fields), and in what order. */
export const FieldsConfigSchema = z.strictObject({
  order: z.array(z.string()),
  hidden: z.array(z.string()).optional(),
});
export type FieldsConfig = z.infer<typeof FieldsConfigSchema>;

/** Interaction defaults (ui-patterns §3.3). */
export const InteractionConfigSchema = z.strictObject({
  tagCommit: z.enum(['immediate', 'staged']),
  /** A drop onto a group adds the membership by default (decision D15); `move` also removes the source one. */
  dragDefault: z.enum(['add', 'move']),
  /** Whether a selection survives a filter change that hides some of it. */
  selectionAcrossFilter: z.enum(['keep-visible', 'drop']),
});
export type InteractionConfig = z.infer<typeof InteractionConfigSchema>;

/** The interaction defaults every view starts from. */
export const DEFAULT_INTERACTION: InteractionConfig = Object.freeze({
  tagCommit: 'immediate',
  dragDefault: 'add',
  selectionAcrossFilter: 'keep-visible',
});

/** The lens: shell, navigator, layout, inspector, fields and interaction. */
export const ViewConfigSchema = z.strictObject({
  shell: ShellSchema,
  navigator: NavigatorConfigSchema.optional(),
  layout: LayoutConfigSchema,
  inspector: InspectorConfigSchema.optional(),
  fields: FieldsConfigSchema.optional(),
  interaction: InteractionConfigSchema,
});
export type ViewConfig = z.infer<typeof ViewConfigSchema>;

/**
 * A named snapshot: a lens plus the collection state it was saved with. No autosave: the app
 * compares the live state with the snapshot (see {@link isDirty}) and offers to save.
 *
 * `filter` is the collection's filter expression (zodal core's), kept opaque here; it must be
 * plain JSON data. `group` groups the items of a list or table layout; a board's columns come
 * from its own `layout.groupBy`, which wins for that layout.
 */
export const SavedViewSchema = z.strictObject({
  name: z.string().min(1),
  viewConfig: ViewConfigSchema,
  filter: z.json().optional(),
  sort: z.array(z.strictObject({ field: z.string().min(1), direction: z.enum(['asc', 'desc']) })).optional(),
  group: FamilyRefSchema.optional(),
  scope: z
    .strictObject({ group: z.string().optional(), descendants: z.boolean(), includeSmart: z.boolean() })
    .optional(),
});
export type SavedView = z.infer<typeof SavedViewSchema>;

/** Parse and validate a view config; throws a `ZodError` naming every problem. */
export const parseViewConfig = (raw: unknown): ViewConfig => ViewConfigSchema.parse(raw);

/** Parse and validate a saved view; throws a `ZodError` naming every problem. */
export const parseSavedView = (raw: unknown): SavedView => SavedViewSchema.parse(raw);

/** Structural dirty marker: does the live view differ from its saved snapshot? */
export function isDirty(saved: SavedView, live: SavedView): boolean {
  return stableStringify(saved) !== stableStringify(live);
}
