/**
 * Every subpath's types resolve for TypeScript consumers under each module resolution
 * mode they may use, including `node10` (which ignores `exports`, hence `typesVersions`).
 * A dependency-free stand-in for `@arethetypeswrong/cli`. Runs after `build`.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const subpaths = Object.keys(pkg.exports).filter((k) => k !== './package.json');

// A consumer project whose node_modules/polytag is this package.
const consumer = mkdtempSync(join(tmpdir(), 'polytag-types-'));
mkdirSync(join(consumer, 'node_modules'));
symlinkSync(pkgDir, join(consumer, 'node_modules', 'polytag'), 'dir');
afterAll(() => rmSync(consumer, { recursive: true, force: true }));

const MODES = [
  { label: 'node10', options: { moduleResolution: ts.ModuleResolutionKind.Node10 }, ext: '.d.ts' },
  { label: 'bundler', options: { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext }, ext: '.d.ts' },
  {
    label: 'node16 (import)',
    options: { moduleResolution: ts.ModuleResolutionKind.Node16, module: ts.ModuleKind.Node16 },
    ext: '.d.ts',
    mode: ts.ModuleKind.ESNext,
  },
  {
    label: 'node16 (require)',
    options: { moduleResolution: ts.ModuleResolutionKind.Node16, module: ts.ModuleKind.Node16 },
    ext: '.d.cts',
    mode: ts.ModuleKind.CommonJS,
  },
] as const;

describe.each(MODES)('types resolve under $label', ({ options, ext, ...rest }) => {
  it.each(subpaths)('%s', (subpath) => {
    const specifier = subpath === '.' ? 'polytag' : `polytag/${subpath.slice(2)}`;
    const base = subpath === '.' ? 'index' : subpath.slice(2);
    const { resolvedModule } = ts.resolveModuleName(
      specifier,
      join(consumer, 'index.ts'),
      options,
      ts.sys,
      undefined,
      undefined,
      'mode' in rest ? (rest.mode as ts.ResolutionMode) : undefined,
    );
    expect(resolvedModule?.resolvedFileName.replaceAll('\\', '/')).toMatch(new RegExp(`/dist/${base}\\${ext}$`));
  });
});
