# polytag

**Folders that overlap and tags that nest.** Headless CRUD for tag-based collections: items that belong to several groups at once, on top of [zodal](https://github.com/i2mint/zodal) and [zodal-groups](https://github.com/i2mint/zodal-groups).

> **Status: pre-release.** Data in (formats × grammars, detection, the loss report) works; the backend menu, view menu, facade and playground are next. Start with the [synthesis](docs/research/synthesis.md) and [ADR 0001](docs/decisions/0001-placement-and-seams.md).

## The idea

Bring your data in whatever shape it already has (a nested JSON tree, a CSV with a tags column, YAML, TOML, Markdown with frontmatter), pick where it lives (memory, browser, files, HTTP, S3, Supabase), pick how people work with it (a file manager, a three-pane library, a gallery, faceted search, a triage inbox, a board), and get create/read/update/delete, tagging, bulk tagging, rename and merge of tags, and undo, with the same membership model underneath every choice.

zodal-groups holds that model: membership is the canonical data, and every folder tree, tag cloud and facet panel is a projection of it. polytag is the composition layer: data in (formats × grammars, with a report of what a format would lose), a menu of backends, a menu of views, and a playground to try the combinations.

## Data in

Read whatever shape the data already has; polytag detects the format and the grammar (how items, groups and memberships are laid out), and tells you what any export would lose before it writes.

```ts
import { readText, exportChoices, writeText } from 'polytag';

const read = await readText(text, { filename: 'recipes.yaml' }); // format + grammar detected
read.space;        // { nodes, edges }: the canonical relation (zodal-groups' Node / Edge, structurally)
read.diagnostics;  // problems, located; reading never throws on bad data
read.detection;    // ranked candidates with evidence and a preview, and whether to ask

exportChoices(read.space, { format: 'csv' });  // every CSV grammar with its loss report, best first
const out = await writeText(read.space, { format: 'csv', grammar: 'delimited' });
out.loss;          // e.g. { lossless: false, losses: [{ kind: 'group-edges', severity: 'drop', ids: ['contains:food/italian', …] }] }
```

Formats (`polytag/formats`, tag-agnostic, each parser loaded on first use): `json`, `jsonc`, `yaml`, `toml`, `csv`, `tsv`. Grammars (root entry): `nested` (folders as nested objects; YAML anchors for an item in several folders), `tags-array`, `tag-paths` (`food/italian`), `members-map` (group → members), `edge-rows` (one row per membership plus node rows; lossless, polytag's own interchange), `delimited` (CSV tags cell), `one-hot` (a boolean column per group), `node-link` (JSON Graph Format; lossless). `compatibility(createGrammarRegistry(), createFormatRegistry())` gives the matrix.

The loss report names every dropped, degraded or encoded id, computed from the grammar's capabilities before writing (`assess`), and includes the comments of an existing file being overwritten. Imports are planned first: `planImport(existing, incoming)` lists create / update / skip / conflict per id (by content hash), and `applyImport` writes only once conflicts are resolved. Exports take a `scope` (`scopeSpace(space, { scope: 'selected', ids })`). Both codecs are zodal `Codec`s, composed by `textCodec(format, grammar)`.

**The round-trip gate.** `packages/polytag/tests/roundtrip.test.ts` writes and reads back the reference dataset of the research, its polyhierarchy variant and a space using every feature, in every grammar × compatible format, and fails the build unless the result is exactly what the loss report predicted (edge order by rank, deterministic edge ids).

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

**The boundary rule.** `polytag/formats`, `polytag/backends` and `polytag/views` are tag-agnostic: they must never import `@zodal/groups-*`, so they can move to zodal when a consumer without tags appears ([ADR 0001](docs/decisions/0001-placement-and-seams.md) §Consequences). `scripts/check-boundaries.mjs` checks each one's source, every built JS file and every `.d.ts` that `exports` names: it fails on any `@zodal/groups-*` (or local `zodal-groups` checkout) they bundle, import, name in a string or declare through a dependency, on reaching the tag-aware root, and on an `import()`/`require()` with a computed argument. It follows every import a runtime would execute, including the bare chunk imports of code splitting that `sideEffects: false` lets a bundler drop. CI runs it after the build.

**Releases.** A push to `main` publishes when a commit *subject* since the last `v*` tag contains `[publish]` **and** the version in `packages/polytag/package.json` is not on npm yet (a marker without a version bump publishes nothing; the run says so in a notice). The publish job waits for approval on the `npm-publish` environment, publishes with `pnpm -r publish` (never `npm publish`: it ships `workspace:*` literally), checks the registry serves the version, then tags `v<version>`. `@zodal/*` packages are peers with a caret on the lowest version used ([zodal versioning](https://github.com/i2mint/zodal/blob/main/docs/versioning.md)): `@zodal/core` ^0.2.0 and `zod` ^4.0.0 today. `@zodal/groups-core` is only a devDependency (the snapshots are structural).

## License

MIT
