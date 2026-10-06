// Reaches groups only at runtime, through a name it computes: invisible to a bundler.
export const loadGroups = (suffix) => import(['@zodal', 'groups-' + suffix].join('/'));
