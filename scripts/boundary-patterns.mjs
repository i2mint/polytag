/**
 * What a tag-agnostic subpath must not reach, shared by the static boundary check
 * (`check-boundaries.mjs`) and the runtime guard (`boundary-guard.mjs`): the
 * `@zodal/groups-*` packages, whether through node_modules (`@zodal/groups-core`, pnpm's
 * `.pnpm/@zodal+groups-core@x`) or a local checkout of the zodal-groups repo
 * (`../zodal-groups/...`).
 */
export const DEFAULT_FORBIDDEN = [/@zodal[\\/+]groups-/, /(^|[\\/])zodal-groups([\\/]|$)/];

/** A predicate over specifiers, paths and URLs (separators normalised to `/`). */
export const makeIsForbidden = (forbidden = DEFAULT_FORBIDDEN) => (p) =>
  forbidden.some((re) => re.test(String(p).split('\\').join('/')));
