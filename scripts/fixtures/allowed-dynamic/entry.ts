// boundary-check: allow-dynamic (loads a user-supplied plugin URL, never a polytag dependency)
export const loadPlugin = (url: string) => import(url);
