import { defineConfig } from 'tsup';

// One entry per subpath export in package.json. `index` is the tag-aware root;
// `formats`, `backends` and `views` are tag-agnostic (see scripts/check-boundaries.mjs).
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    formats: 'src/formats/index.ts',
    backends: 'src/backends/index.ts',
    views: 'src/views/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
});
