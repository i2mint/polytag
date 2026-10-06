# polytag

Headless CRUD for tag-based collections, on top of [zodal](https://github.com/i2mint/zodal) and [zodal-groups](https://github.com/i2mint/zodal-groups). Pre-release: data in (formats × grammars, detection, the loss report) works; see the [repository](https://github.com/i2mint/polytag) for the plan.

Entry points: `polytag` (tag-aware: grammars, `readText` / `writeText`, the loss report, import plans), `polytag/formats` (tag-agnostic: json, jsonc, yaml, toml, csv, tsv), `polytag/backends`, `polytag/views` (tag-agnostic).

```bash
npm install polytag @zodal/core zod
```

```ts
import { readText, exportChoices, writeText } from 'polytag';

const read = await readText(text, { filename: 'recipes.yaml' }); // format + grammar detected
exportChoices(read.space, { format: 'csv' });                    // every CSV grammar, with what it would lose
const { text: csv, loss } = await writeText(read.space, { format: 'csv', grammar: 'edge-rows' });
```

Grammars: `nested`, `tags-array`, `tag-paths`, `members-map`, `edge-rows`, `delimited`, `one-hot`, `node-link`. Reading never throws on bad data (problems are `diagnostics`); the loss report lists every dropped id before anything is written.
