Fixtures for `check-boundaries.test.mjs`. Not part of polytag.

- `modules/` stands in for `node_modules` (esbuild `nodePaths` / TypeScript `paths`, because `node_modules/` is gitignored): a fake `@zodal/groups-core`, and `uses-groups`, a dependency that declares it as a peer.
- Code pass: `clean/` and `allowed-dynamic/` must pass. Each `violation-*/` must fail: a direct import, an `import()` behind a local module, a path into a local zodal-groups checkout, reaching the tag-aware root, a type-only import, `createRequire`, a template-literal `import()`, a `require(variable)`, and a dependency that declares groups.
- Types pass: `types-clean/` and `dts-dir-import/` must pass; `types-violation/`, `types-root-reach/`, `types-reference-types/`, `types-reference-path/` and `types-via-dependency/` must fail.
- Whole-package check (`out/` stands in for `dist/`, which is gitignored): `pkg-clean/` passes; `pkg-built-violation/` has clean sources but a built `out/views.js` that imports groups; `pkg-missing-types/` exports a tag-agnostic subpath with no `types`.
