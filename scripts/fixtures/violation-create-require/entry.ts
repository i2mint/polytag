import { createRequire } from 'node:module';
// esbuild does not follow a require created at runtime.
export const load = () => createRequire(import.meta.url)('@zodal/groups-core');
