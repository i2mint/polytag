import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

  it('fails a createRequire() call esbuild cannot follow (string-literal scan + its import)', async () => {
    expect(await sources('violation-create-require')).toEqual([
      { kind: 'mentions', path: '@zodal/groups-core', from: 'violation-create-require/entry.ts' },
      { kind: 'runtime loader', path: 'createRequire', from: 'violation-create-require/entry.ts:1' },
    ]);
  });

  // i2mint/polytag#15 item 2: loaders that name no forbidden string and call no literal-less
  // require()/import(), so only a scan for the loader itself sees them. Line 5 uses the
  // createRequire imported on line 2, which is where it is flagged.
  it.each([
    [2, 'runtime loader', 'createRequire'],
    [6, 'runtime loader', 'require'],
    [7, 'runtime loader', 'require'],
    [8, 'runtime loader', 'module.require'],
    [9, 'runtime loader', 'Function'],
    [10, 'runtime loader', 'eval'],
    [11, 'computed global member', "(globalThis as any)['req' + 'uire']"],
    [12, 'runtime loader', "(globalThis as any)['require']"],
    [13, 'runtime loader', 'createRequire: cr'],
  ])('fails line %i: %s `%s`', async (line, kind, code) => {
    const violations = await sources('violation-escape-hatches');
    expect(violations).toContainEqual({ kind, path: code, from: `violation-escape-hatches/entry.ts:${line}` });
  });

  it('flags no other line of the escape-hatch fixture', async () => {
    const lines = (await sources('violation-escape-hatches')).map((v) => Number(v.from.split(':')[1]));
    expect([...new Set(lines)]).toEqual([2, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('does not flag look-alikes: member names, types, typeof, comparisons, feature detection, locals named like globals, a marked escape', async () => {
    expect(await sources('clean-escape-lookalikes')).toEqual([]);
  });

  it("scans an imported JSON file's literals without crashing", async () => {
    expect(await sources('clean-json-import')).toEqual([]);
  });

  it("does not flag esbuild's own __require shim in a built ESM file", async () => {
    expect(await sources('clean-esbuild-require-shim')).toEqual([]);
  });

  it('honours the allow marker only in a comment, not in a string on the same line', async () => {
    expect(await sources('violation-marker-in-string')).toEqual([
      { kind: 'non-literal import', path: 'require(n)', from: 'violation-marker-in-string/entry.ts:1' },
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

  // A bundler can hoist root-only code into a chunk a tag-agnostic entry imports; the chunk is
  // the package's own file and imports nothing forbidden, so only its source map tells.
  it('passes a shared chunk whose source map lists only shared sources', async () => {
    const { errors, results } = await checkFixturePackage('pkg-hoisted-root-clean');
    expect(errors).toEqual([]);
    expect(results.flatMap((r) => r.violations)).toEqual([]);
  });

  it('fails a shared chunk whose source map lists a source only the tag-aware root reaches', async () => {
    const { results } = await checkFixturePackage('pkg-hoisted-root-violation');
    const byEntry = Object.fromEntries(results.map((r) => [r.entry, r.violations]));
    expect(byEntry['pkg-hoisted-root-violation/out/views.js']).toEqual([
      { kind: 'bundles root-owned source', path: 'pkg-hoisted-root-violation/src/root-only.ts', from: 'pkg-hoisted-root-violation/out/chunk.js' },
    ]);
    expect(byEntry['pkg-hoisted-root-violation/src/views/index.ts']).toEqual([]);
  });

  // i2mint/polytag#26: the guarded test run reads each tag-agnostic subpath's `tests`.
  const LISTING_ERRORS = [
    'subpaths.json lists tests/listed-imports-groups.test.ts as tag-agnostic, but it reaches tag-aware code',
    'tests/unlisted-by-name.test.ts tests only tag-agnostic code, but no tag-agnostic subpath lists it in subpaths.json "tests" (the guarded run would skip it)',
    'tests/unlisted.test.ts tests only tag-agnostic code, but no tag-agnostic subpath lists it in subpaths.json "tests" (the guarded run would skip it)',
    'subpaths.json lists tests/wrongly-listed.test.ts as tag-agnostic, but it reaches tag-aware code',
  ];

  it('fails a tag-agnostic test nobody lists, and a listed test that reaches tag-aware code; ignores the rest', async () => {
    const { errors } = await checkFixturePackage('pkg-tests-listing');
    expect(errors).toEqual(LISTING_ERRORS);
    // Not flagged: views.test.ts (listed); root.test.ts, self-import.test.ts (the package by its
    // own name), built-root.test.ts (the root's built file), uses-groups.test.ts (all tag-aware,
    // unlisted); no-sources.test.ts (reaches no source); tests/agnostic/ (always guarded).
  });

  // esbuild reports inputs relative to the REAL working dir; compared as real paths.
  it.each([
    ['a symlinked package path', true, false],
    ['a symlinked working dir', false, true],
    ['both symlinked', true, true],
  ])('gives the same answers through %s', async (_, linkPackage, linkWorkingDir) => {
    const dir = mkdtempSync(join(tmpdir(), 'polytag-link-'));
    try {
      const wd = linkWorkingDir ? join(dir, 'fixtures') : fixtures;
      if (linkWorkingDir) symlinkSync(fixtures, wd, 'dir');
      const pkgPath = (name) => {
        if (!linkPackage) return join(wd, name);
        const link = join(dir, `link-${name}`);
        symlinkSync(join(fixtures, name), link, 'dir');
        return link;
      };
      const options = { absWorkingDir: wd, nodePaths: [join(fixtures, 'modules')] };
      expect((await checkPackage(pkgPath('pkg-tests-listing'), options)).errors).toEqual(LISTING_ERRORS);
      // The code pass too: a built file's groups import and its literal mention survive the links.
      const { results } = await checkPackage(pkgPath('pkg-built-violation'), options);
      const kinds = results.flatMap((r) => r.violations.map((v) => v.kind));
      expect(kinds).toEqual(expect.arrayContaining(['imports', 'mentions']));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
