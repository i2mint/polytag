/**
 * Every tag-agnostic subpath's BUILT files load, under `import` and `require`, in a plain Node
 * process with the boundary guard installed: what the published package executes reaches no
 * `@zodal/groups-*`. A child process, because vitest would run an ESM `import()` of these
 * files itself instead of through Node's loader. Runs after `build` (turbo: test dependsOn build).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkgDir = fileURLToPath(new URL('../..', import.meta.url));
const register = fileURLToPath(new URL('../../../../scripts/boundary-guard.register.mjs', import.meta.url));
const read = (f: string) => JSON.parse(readFileSync(join(pkgDir, f), 'utf8'));
const subpaths: Record<string, { tagAware?: boolean }> = read('subpaths.json');
const exportsMap: Record<string, { import: { default: string }; require: { default: string } }> = read('package.json').exports;
const agnostic = Object.keys(subpaths).filter((k) => !subpaths[k].tagAware);

/** Run `code` (an ES module) in a guarded Node; it prints how many exports it loaded. */
const guarded = (code: string) =>
  spawnSync(process.execPath, ['--import', register, '--input-type=module', '-e', code], { encoding: 'utf8' });

describe.each(agnostic)('%s, built, in a guarded Node', (subpath) => {
  const { import: esm, require: cjs } = exportsMap[subpath];

  it('loads under import', () => {
    const url = pathToFileURL(join(pkgDir, esm.default)).href;
    const r = guarded(`const m = await import(${JSON.stringify(url)}); console.log(Object.keys(m).length);`);
    expect(r.stderr).toBe('');
    expect(Number(r.stdout)).toBeGreaterThan(0);
  });

  it('loads under require', () => {
    const file = join(pkgDir, cjs.default);
    const r = guarded(
      `import { createRequire } from 'node:module'; const m = createRequire(import.meta.url)(${JSON.stringify(file)}); console.log(Object.keys(m).length);`,
    );
    expect(r.stderr).toBe('');
    expect(Number(r.stdout)).toBeGreaterThan(0);
  });
});

it('the guarded Node really refuses groups (control)', () => {
  const r = guarded(`import { createRequire } from 'node:module'; createRequire(import.meta.url)('@zodal/groups-core');`);
  expect(r.status).not.toBe(0);
  expect(r.stderr).toMatch(/boundary guard/);
});
