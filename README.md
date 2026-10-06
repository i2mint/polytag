# polytag

**Folders that overlap and tags that nest.** Headless CRUD for tag-based collections: items that belong to several groups at once, on top of [zodal](https://github.com/i2mint/zodal) and [zodal-groups](https://github.com/i2mint/zodal-groups).

> **Status: repo scaffold; no usable API yet.** Start with the [synthesis](docs/research/synthesis.md) and [ADR 0001](docs/decisions/0001-placement-and-seams.md).

## The idea

Bring your data in whatever shape it already has (a nested JSON tree, a CSV with a tags column, YAML, TOML, Markdown with frontmatter), pick where it lives (memory, browser, files, HTTP, S3, Supabase), pick how people work with it (a file manager, a three-pane library, a gallery, faceted search, a triage inbox, a board), and get create/read/update/delete, tagging, bulk tagging, rename and merge of tags, and undo, with the same membership model underneath every choice.

zodal-groups holds that model: membership is the canonical data, and every folder tree, tag cloud and facet panel is a projection of it. polytag is the composition layer: data in (formats × grammars, with a report of what a format would lose), a menu of backends, a menu of views, and a playground to try the combinations.

## Docs

| | |
|---|---|
| [Synthesis](docs/research/synthesis.md) | what exists, what is missing, what we will build |
| [ADR 0001](docs/decisions/0001-placement-and-seams.md) | placement in the zodal ecosystem, and the v1 seams |
| [Terminology](docs/research/terminology.md) | tag-based organisation, polyhierarchy, the API vocabulary |
| [Prior art](docs/research/prior-art.md) | libraries and products, with licences and verdicts |
| [UI patterns](docs/research/ui-patterns.md) | the view menu, the operations, the affordance/rendering split |
| [Formats and grammars](docs/research/formats-and-grammars.md) | json/yaml/toml/csv layouts for tagged data, and which are lossless |

## Development

pnpm workspaces + Turborepo. Node 22, pnpm 9 (pinned in `package.json`).

```bash
pnpm install
pnpm build        # tsup (ESM + CJS + .d.ts) for packages/polytag, Vite for apps/playground
pnpm typecheck
pnpm test         # package tests (after build), then the scripts' tests
pnpm check:boundaries
```

| Path | What |
|---|---|
| `packages/polytag` | the `polytag` npm package: `polytag` (tag-aware root), `polytag/formats`, `polytag/backends`, `polytag/views` (tag-agnostic) |
| `apps/playground` | private Vite app, not published |
| `packages/polytag/subpaths.json` | the list of subpaths, their sources and which are tag-aware (read by tsup and the boundary check) |
| `scripts/check-boundaries.mjs` | the boundary check below |
| `scripts/release-gate.mjs` | decides whether a push to `main` publishes |

**The boundary rule.** `polytag/formats`, `polytag/backends` and `polytag/views` are tag-agnostic: they must never import `@zodal/groups-*`, so they can move to zodal when a consumer without tags appears ([ADR 0001](docs/decisions/0001-placement-and-seams.md) §Consequences). `scripts/check-boundaries.mjs` checks each one's source, every built JS file and every `.d.ts` that `exports` names: it fails on any `@zodal/groups-*` (or local `zodal-groups` checkout) they bundle, import, name in a string or declare through a dependency, on reaching the tag-aware root, and on an `import()`/`require()` with a computed argument. CI runs it after the build.

**Releases.** A push to `main` publishes when a commit *subject* since the last `v*` tag contains `[publish]` **and** the version in `packages/polytag/package.json` is not on npm yet (a marker without a version bump publishes nothing; the run says so in a notice). The publish job waits for approval on the `npm-publish` environment, publishes with `pnpm -r publish` (never `npm publish`: it ships `workspace:*` literally), checks the registry serves the version, then tags `v<version>`. `@zodal/*` packages are peers with a caret on the lowest version used ([zodal versioning](https://github.com/i2mint/zodal/blob/main/docs/versioning.md)); none is a dependency yet.

## License

MIT
