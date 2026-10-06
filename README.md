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
| `scripts/check-boundaries.mjs` | the boundary check below |

**The boundary rule.** `polytag/formats`, `polytag/backends` and `polytag/views` are tag-agnostic: they must never import `@zodal/groups-*`, so they can move to zodal when a consumer without tags appears ([ADR 0001](docs/decisions/0001-placement-and-seams.md) §Consequences). `scripts/check-boundaries.mjs` bundles each with esbuild and fails if the metafile shows any `@zodal/groups-*` (or a local `zodal-groups` checkout) in it; CI runs it on every push. A new subpath export must be classified as tag-aware or tag-agnostic in that script, or the check fails.

**Releases.** Only a commit whose *subject* contains `[publish]` publishes, from CI, with `pnpm -r publish` (never `npm publish`: it ships `workspace:*` literally). `@zodal/*` packages are peers with a caret on the lowest version used ([zodal versioning](https://github.com/i2mint/zodal/blob/main/docs/versioning.md)); none is a dependency yet.

## License

MIT
