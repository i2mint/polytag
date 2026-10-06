/**
 * The published shape: every subpath in package.json `exports` resolves, by package
 * name, from the BUILT files, under both `import` and `require`, and every file the
 * exports map points at exists. Runs after `build` (turbo: test dependsOn build).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

/** The named runtime exports of each subpath (the root has none until #1/#4). */
const EXPECTED: Record<string, string[]> = {
  '.': [],
  './formats': ['createFormatRegistry'],
  './backends': ['createBackendCatalog'],
  './views': ['createViewMenu'],
};

/** Names exported by `specifier`, loaded in a fresh Node process via package self-reference. */
function exportedNames(specifier: string, mode: 'import' | 'require'): string[] {
  const script =
    mode === 'import'
      ? `import(${JSON.stringify(specifier)}).then(m => console.log(JSON.stringify(Object.keys(m))))`
      : `console.log(JSON.stringify(Object.keys(require(${JSON.stringify(specifier)}))))`;
  const out = execFileSync(process.execPath, ['-e', script], { cwd: pkgDir, encoding: 'utf8' });
  return JSON.parse(out.trim());
}

function filesIn(target: unknown): string[] {
  if (typeof target === 'string') return [target];
  if (target && typeof target === 'object') return Object.values(target).flatMap(filesIn);
  return [];
}

describe('package exports', () => {
  const subpaths = Object.keys(pkg.exports).filter((k) => k !== './package.json');

  it('lists exactly the expected subpaths', () => {
    expect(subpaths.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(subpaths)('every file %s points at exists', (subpath) => {
    for (const file of filesIn(pkg.exports[subpath])) {
      expect(existsSync(join(pkgDir, file)), `${subpath} -> ${file}`).toBe(true);
    }
  });

  it.each(subpaths)('%s resolves under import and require', (subpath) => {
    const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
    for (const mode of ['import', 'require'] as const) {
      expect(exportedNames(specifier, mode).sort()).toEqual([...EXPECTED[subpath]!].sort());
    }
  });
});
