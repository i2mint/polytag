# polytag

**Folders that overlap and tags that nest.** Headless CRUD for tag-based collections: items that belong to several groups at once, on top of [zodal](https://github.com/i2mint/zodal) and [zodal-groups](https://github.com/i2mint/zodal-groups).

> **Status: research and planning. No code yet.** Start with the [synthesis](docs/research/synthesis.md) and [ADR 0001](docs/decisions/0001-placement-and-seams.md).

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

## License

MIT
