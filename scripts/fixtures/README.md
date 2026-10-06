Fixtures for `check-boundaries.test.mjs`. Not part of polytag.

- `modules/` stands in for `node_modules` (passed as esbuild `nodePaths`, because `node_modules/` is gitignored); it holds a fake `@zodal/groups-core`.
- Sources pass: `clean/` must pass. Each `violation-*/` must fail: a direct import, an `import()` behind a local module, a path into a local zodal-groups checkout, reaching the file named as the tag-aware root, a type-only import (erased by esbuild, caught by the string-literal scan), and a `createRequire` call.
- Declarations pass: `types-clean/` and `dts-dir-import/` (an extensionless import of a directory) must pass. `types-violation/` (a type import one hop away), `types-root-reach/` (importing the root's declarations), `types-reference-types/` and `types-reference-path/` (triple-slash directives) must fail.
