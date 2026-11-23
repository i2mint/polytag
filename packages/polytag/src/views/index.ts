/**
 * `polytag/views` — the view menu: how people work with a collection.
 *
 * - `ViewConfig` (the lens: shell, navigator, layout, inspector, fields, interaction) and
 *   `SavedView` (a named lens plus the collection state), as strict Zod schemas;
 * - the computed menu: `availableViews(menu, caps)` ranks the views and greys out the ones a
 *   collection cannot support, with gap codes; `defaultViewMenu()` holds the ranked defaults;
 * - `viewToLink` / `viewFromLink`: a view round-trips through a URL fragment, in holdall's
 *   versioned envelope.
 *
 * Tag-agnostic: this subpath must never import `@zodal/groups-*` (ADR 0001
 * §Consequences; enforced in CI by `scripts/check-boundaries.mjs`).
 *
 * extraction candidate: zodal (zodal#14 view generators)
 */

export type { Registry, RegistryOptions } from '../internal/registry.js';
export * from './config.js';
export * from './menu.js';
export * from './link.js';
