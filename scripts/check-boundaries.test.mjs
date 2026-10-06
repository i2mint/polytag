import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkDeclarations, checkSources } from './check-boundaries.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const script = join(here, 'check-boundaries.mjs');

const sources = (dir, options = {}) =>
  checkSources({
    entries: [join(fixtures, dir, 'entry.ts')],
    absWorkingDir: fixtures,
    nodePaths: [join(fixtures, 'modules')],
    ...options,
  }).then(([result]) => result.violations);

const declarations = (dir, options = {}) =>
  checkDeclarations({ entries: [join(fixtures, dir, 'entry.d.ts')], absWorkingDir: fixtures, ...options })[0]
    .violations;

describe('check-boundaries, runtime pass (esbuild metafile)', () => {
  it('passes a bundle that reaches no @zodal/groups-* code', async () => {
    expect(await sources('clean')).toEqual([]);
  });

  it('fails a direct import of @zodal/groups-*', async () => {
    const violations = await sources('violation-direct');
    expect(violations).toContainEqual({ kind: 'bundles', path: 'modules/@zodal/groups-core/index.js' });
    expect(violations).toContainEqual({ kind: 'imports', path: '@zodal/groups-core', from: 'violation-direct/entry.ts' });
  });

  it('fails a lazy import() reached through a local module', async () => {
    expect(await sources('violation-lazy')).toContainEqual({
      kind: 'imports',
      path: '@zodal/groups-core',
      from: 'violation-lazy/inner.ts',
    });
  });

  it('fails a path into a local zodal-groups checkout', async () => {
    const paths = (await sources('violation-local-checkout')).map((v) => v.path);
    expect(paths).toContain('violation-local-checkout/vendor/zodal-groups/index.ts');
  });

  it('fails reaching the file named as the tag-aware root', async () => {
    const violations = await sources('violation-root-reach', {
      forbiddenFiles: [join(fixtures, 'violation-root-reach', 'index.ts')],
    });
    expect(violations).toEqual([{ kind: 'bundles tag-aware root', path: 'violation-root-reach/index.ts' }]);
  });

  it('fails a type-only import, which esbuild erases (string-literal scan)', async () => {
    expect(await sources('violation-type-only')).toEqual([
      { kind: 'mentions', path: '@zodal/groups-core', from: 'violation-type-only/entry.ts' },
    ]);
  });

  it('fails a createRequire() call esbuild cannot follow (string-literal scan)', async () => {
    expect(await sources('violation-create-require')).toEqual([
      { kind: 'mentions', path: '@zodal/groups-core', from: 'violation-create-require/entry.ts' },
    ]);
  });

  it('does not flag a forbidden name in a comment', async () => {
    // The real subpaths' doc comments name `@zodal/groups-*`; the CLI test below runs on them.
    expect(await sources('clean')).toEqual([]);
  });

  it('fails closed when a forbidden package cannot be resolved', async () => {
    await expect(sources('violation-direct', { nodePaths: [] })).rejects.toThrow(
      /Could not resolve "@zodal\/groups-core"/,
    );
  });
});

describe('check-boundaries, types pass (declaration files)', () => {
  it('passes declarations that reach no @zodal/groups-*', () => {
    expect(declarations('types-clean')).toEqual([]);
  });

  it('fails a type import of @zodal/groups-* one relative hop away', () => {
    expect(declarations('types-violation')).toEqual([
      { kind: 'type-imports', path: '@zodal/groups-core', from: 'types-violation/shared.d.ts' },
    ]);
  });

  it("fails declarations that import the tag-aware root's", () => {
    const violations = declarations('types-root-reach', {
      forbiddenFiles: [join(fixtures, 'types-root-reach', 'index.d.ts')],
    });
    expect(violations).toEqual([{ kind: 'types reach tag-aware root', path: 'types-root-reach/index.d.ts' }]);
  });

  it('fails a /// <reference types> directive', () => {
    expect(declarations('types-reference-types')).toEqual([
      { kind: 'references types', path: '@zodal/groups-core', from: 'types-reference-types/entry.d.ts' },
    ]);
  });

  it('follows a /// <reference path> directive', () => {
    expect(declarations('types-reference-path')).toEqual([
      { kind: 'type-imports', path: '@zodal/groups-core', from: 'types-reference-path/shared.d.ts' },
    ]);
  });

  it('resolves an extensionless import of a directory to its index.d.ts', () => {
    expect(declarations('dts-dir-import')).toEqual([]);
  });

  it('fails closed on a missing declaration file', () => {
    expect(() => declarations('does-not-exist')).toThrow(/Declaration file not found/);
  });
});

describe('check-boundaries CLI', () => {
  it('passes on the real tag-agnostic subpaths, both passes', () => {
    const out = execFileSync(process.execPath, [script], { encoding: 'utf8' });
    for (const sub of ['formats', 'backends', 'views']) {
      expect(out).toMatch(new RegExp(`ok\\s+packages/polytag/src/${sub}/index\\.ts`));
      expect(out).toMatch(new RegExp(`ok\\s+packages/polytag/dist/${sub}\\.d\\.ts`));
      expect(out).toMatch(new RegExp(`ok\\s+packages/polytag/dist/${sub}\\.d\\.cts`));
    }
  });

  it('exits 1 and names the violation for a violating source entry', () => {
    const r = spawnSync(
      process.execPath,
      [script, '--node-path', join(fixtures, 'modules'), join(fixtures, 'violation-direct', 'entry.ts')],
      { encoding: 'utf8' },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/FAIL\s+scripts\/fixtures\/violation-direct\/entry\.ts/);
    expect(r.stderr).toMatch(/imports @zodal\/groups-core/);
  });

  it('exits 1 for a violating declaration entry', () => {
    const r = spawnSync(process.execPath, [script, join(fixtures, 'types-violation', 'entry.d.ts')], {
      encoding: 'utf8',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/type-imports @zodal\/groups-core/);
  });
});
