/**
 * Every tag-agnostic subpath's BUILT files load, under `import` and `require`, with the
 * runtime boundary guard on: what the published package executes reaches no `@zodal/groups-*`.
 * Runs after `build` (turbo: test dependsOn build).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkgDir = fileURLToPath(new URL('../..', import.meta.url));
const read = (f: string) => JSON.parse(readFileSync(join(pkgDir, f), 'utf8'));
const subpaths: Record<string, { tagAware?: boolean }> = read('subpaths.json');
const exportsMap: Record<string, { import: { default: string }; require: { default: string } }> = read('package.json').exports;
const agnostic = Object.keys(subpaths).filter((k) => !subpaths[k].tagAware);

describe.each(agnostic)('%s, built, under the guard', (subpath) => {
  const { import: esm, require: cjs } = exportsMap[subpath];

  it('loads under import', async () => {
    const mod = await import(/* @vite-ignore */ pathToFileURL(join(pkgDir, esm.default)).href);
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  it('loads under require', () => {
    const mod = createRequire(import.meta.url)(join(pkgDir, cjs.default));
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});
