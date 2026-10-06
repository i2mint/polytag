import { defineConfig } from 'tsup';
import subpaths from './subpaths.json';

// One entry per subpath in subpaths.json, the single source of truth shared with
// scripts/check-boundaries.mjs (which also checks that package.json `exports` agrees).
// The entry name is the built file's basename: `.` -> index, `./formats` -> formats.
const entry = Object.fromEntries(
  Object.entries(subpaths).map(([subpath, { source }]) => [subpath === '.' ? 'index' : subpath.slice(2), source]),
);

export default defineConfig({
  entry,
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
});
