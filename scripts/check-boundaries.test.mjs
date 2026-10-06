import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkDeclarations, checkPackage, checkSources } from './check-boundaries.mjs';

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
  checkDeclarations({
    entries: [join(fixtures, dir, 'entry.d.ts')],
    absWorkingDir: fixtures,
    compilerOptions: { baseUrl: fixtures, paths: { '*': ['modules/*'] } },
    ...options,
  })[0].violations;

const checkFixturePackage = (dir) =>
  checkPackage(join(fixtures, dir), { absWorkingDir: fixtures, nodePaths: [join(fixtures, 'modules')] });

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

  it('fails a template-literal import() (non-literal argument)', async () => {
    expect(await sources('violation-dynamic-template')).toContainEqual({
      kind: 'non-literal import',
      path: 'import(`@zodal/groups-${k}`)',
      from: 'violation-dynamic-template/entry.ts:1',
    });
  });

  it('fails a require(variable)', async () => {
    expect(await sources('violation-dynamic-require')).toContainEqual({
      kind: 'non-literal import',
      path: 'require(name)',
      from: 'violation-dynamic-require/entry.ts:2',
    });
  });

  it('allows a non-literal import() marked boundary-check: allow-dynamic', async () => {
    expect(await sources('allowed-dynamic')).toEqual([]);
  });

  it('fails a dependency that declares @zodal/groups-* (even if it hides the import)', async () => {
    expect(await sources('violation-via-dependency')).toEqual([
      { kind: 'dependency declares', path: '@zodal/groups-core', from: 'uses-groups' },
    ]);
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

  it('follows a package import into a dependency that declares @zodal/groups-*', () => {
    expect(declarations('types-via-dependency')).toEqual([
      { kind: 'dependency declares', path: '@zodal/groups-core', from: 'uses-groups' },
    ]);
  });

  it('fails closed on a missing declaration file', () => {
    expect(() => declarations('does-not-exist')).toThrow(/Declaration file not found/);
  });
});

describe('check-boundaries, whole package (subpaths.json + exports)', () => {
  it('passes a clean package', async () => {
    const { errors, results } = await checkFixturePackage('pkg-clean');
    expect(errors).toEqual([]);
    expect(results.map((r) => r.entry)).toEqual([
      'pkg-clean/src/views/index.ts',
      'pkg-clean/out/views.js',
      'pkg-clean/out/views.d.ts',
    ]);
    expect(results.flatMap((r) => r.violations)).toEqual([]);
  });

  it('fails a built file that imports groups even when the sources are clean', async () => {
    const { results } = await checkFixturePackage('pkg-built-violation');
    const byEntry = Object.fromEntries(results.map((r) => [r.entry, r.violations]));
    expect(byEntry['pkg-built-violation/src/views/index.ts']).toEqual([]);
    expect(byEntry['pkg-built-violation/out/views.js']).toContainEqual({
      kind: 'imports',
      path: '@zodal/groups-core',
      from: 'pkg-built-violation/out/views.js',
    });
  });

  // A code-split entry bare-imports chunks (`import './chunk.js'`) for evaluation order; with
  // `sideEffects: false` a bundler may drop them, but Node runs them, so the check follows them.
  it('follows a bare chunk import in a side-effect-free package: clean passes without warnings', async () => {
    const { errors, results } = await checkFixturePackage('pkg-side-effect-chunk-clean');
    expect(errors).toEqual([]);
    expect(results.flatMap((r) => r.violations)).toEqual([]);
  });

  it('follows a bare chunk import in a side-effect-free package: a groups import there fails', async () => {
    const { results } = await checkFixturePackage('pkg-side-effect-chunk-violation');
    const byEntry = Object.fromEntries(results.map((r) => [r.entry, r.violations]));
    expect(byEntry['pkg-side-effect-chunk-violation/out/views.js']).toContainEqual({
      kind: 'imports',
      path: '@zodal/groups-core',
      from: 'pkg-side-effect-chunk-violation/out/chunk-b.js',
    });
  });

  it('fails a tag-agnostic subpath export without a types file', async () => {
    const { errors } = await checkFixturePackage('pkg-missing-types');
    expect(errors).toEqual([expect.stringMatching(/exports\['\.\/views'\] needs a types file for every condition \(missing at: import\)/)]);
  });
});

describe('check-boundaries CLI', () => {
  it('passes on the real tag-agnostic subpaths, both passes', () => {
    const out = execFileSync(process.execPath, [script], { encoding: 'utf8' });
    for (const sub of ['formats', 'backends', 'views']) {
      expect(out).toMatch(new RegExp(`ok\\s+packages/polytag/src/${sub}/index\\.ts`));
      expect(out).toMatch(new RegExp(`ok\\s+packages/polytag/dist/${sub}\\.js`));
      expect(out).toMatch(new RegExp(`ok\\s+packages/polytag/dist/${sub}\\.cjs`));
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

  it('exits 1 for a package whose built JS reaches groups', () => {
    const r = spawnSync(
      process.execPath,
      [script, '--package', join(fixtures, 'pkg-built-violation'), '--node-path', join(fixtures, 'modules')],
      { encoding: 'utf8' },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/FAIL\s+scripts\/fixtures\/pkg-built-violation\/out\/views\.js/);
  });

  it('exits 1 for a violating declaration entry', () => {
    const r = spawnSync(process.execPath, [script, join(fixtures, 'types-violation', 'entry.d.ts')], {
      encoding: 'utf8',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/type-imports @zodal\/groups-core/);
  });
});
