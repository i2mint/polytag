#!/usr/bin/env node
/**
 * Boundary check: polytag's tag-agnostic subpaths never reach `@zodal/groups-*`.
 *
 * ADR 0001 §Consequences: `polytag/formats`, `polytag/backends` and `polytag/views` are
 * tag-agnostic so they can move to zodal when an untagged consumer appears. Pattern from
 * comparanda ADR-0005.
 *
 * The package's `subpaths.json` is the single source of truth: it lists every subpath,
 * its source entry and whether it is tag-aware; `tsup.config.ts` derives its entries from
 * it, and `package.json` `exports` must list exactly the same subpaths. For every
 * tag-agnostic subpath the check then inspects:
 *
 * 1. Code: the source entry AND every built JS file the exports map names (`import`,
 *    `require`, `default`...), each bundled by esbuild (nothing external but Node
 *    built-ins; `import()` included; `sideEffects` and pure annotations ignored, so a bare
 *    `import './chunk.js'` is followed). Violations: a bundled file or import specifier
 *    matching a forbidden pattern; reaching the tag-aware root (its source or built
 *    files); any esbuild warning; in the package's own files, a string literal naming a
 *    forbidden package (catches type-only imports and `createRequire`) or an
 *    `import()`/`require()` whose argument is not a string literal (unless the line, or
 *    the one above, says `boundary-check: allow-dynamic`); in a dependency, a forbidden
 *    package among its dependencies, peerDependencies or optionalDependencies.
 * 2. Types: every `types` file the exports map names (each condition must have one),
 *    walked through relative and package imports and `/// <reference>` directives.
 *    Violations: a forbidden specifier or `/// <reference types>`; reaching the root's
 *    declarations (tsup can hoist shared types into `index.d.ts`); a dependency that
 *    declares a forbidden package.
 *
 * Built files must exist (`pnpm build` first); anything that cannot be resolved or read
 * fails the check.
 *
 * Usage:  node scripts/check-boundaries.mjs                (the polytag package)
 *         node scripts/check-boundaries.mjs --package DIR  (another package, e.g. a fixture)
 *         node scripts/check-boundaries.mjs [--node-path DIR]... ENTRY...
 *           (just these entries: `.d.ts`/`.d.cts` -> types pass, otherwise code pass)
 * API:    checkPackage(dir, opts), checkSources(opts), checkDeclarations(opts)
 */

import { build } from 'esbuild';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_DIR = join(ROOT, 'packages', 'polytag');

/**
 * What a tag-agnostic subpath must not reach: the `@zodal/groups-*` packages, whether
 * through node_modules (`@zodal/groups-core`, pnpm's `.pnpm/@zodal+groups-core@x`) or a
 * local checkout of the zodal-groups repo (`../zodal-groups/...`).
 */
export const DEFAULT_FORBIDDEN = [/@zodal[\\/+]groups-/, /(^|[\\/])zodal-groups([\\/]|$)/];

/** Marks a deliberate non-literal `import()`/`require()` in tag-agnostic code. */
export const ALLOW_DYNAMIC_MARKER = 'boundary-check: allow-dynamic';

const toPosix = (p) => p.split('\\').join('/');
const isFile = (p) => existsSync(p) && statSync(p).isFile();
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const makeIsForbidden = (forbidden) => (p) => forbidden.some((re) => re.test(toPosix(p)));

/** The nearest `package.json` at or above `file`'s directory (memoised). */
const nearestPackageJson = (() => {
  const cache = new Map();
  return function find(file) {
    const dir = dirname(file);
    if (cache.has(dir)) return cache.get(dir);
    const candidate = join(dir, 'package.json');
    const found = existsSync(candidate) ? candidate : dir === dirname(dir) ? undefined : find(dir);
    cache.set(dir, found);
    return found;
  };
})();

/** Violations for a dependency package that declares a forbidden package. */
function dependencyViolations(packageJsonPath, isForbidden, rel) {
  const pkg = readJson(packageJsonPath);
  const declared = ['dependencies', 'peerDependencies', 'optionalDependencies'].flatMap((field) =>
    Object.keys(pkg[field] ?? {}),
  );
  return declared
    .filter(isForbidden)
    .map((dep) => ({ kind: 'dependency declares', path: dep, from: pkg.name ?? rel(packageJsonPath) }));
}

/** String literals and non-literal import()/require() calls in one of the package's own files. */
function scanOwnFile(file) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  const lines = text.split('\n');
  const literals = [];
  const dynamicCalls = [];
  const isLoader = (callee) =>
    callee.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(callee) && callee.text === 'require') ||
    (ts.isCallExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'createRequire');
  const visit = (node) => {
    if (ts.isStringLiteralLike(node)) literals.push(node.text);
    if (ts.isCallExpression(node) && isLoader(node.expression)) {
      const [arg] = node.arguments;
      if (!arg || !ts.isStringLiteralLike(arg)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
        const allowed = [lines[line], lines[line - 1]].some((l) => l?.includes(ALLOW_DYNAMIC_MARKER));
        if (!allowed) dynamicCalls.push({ line: line + 1, code: node.getText(source).slice(0, 80) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { literals, dynamicCalls };
}

/**
 * Code pass: bundle each entry (source or built JS) and return what it reaches.
 *
 * @param {object} options
 * @param {string[]} options.entries          Entry files (absolute, or relative to absWorkingDir).
 * @param {RegExp[]} [options.forbidden]      Patterns no bundled path, specifier or dependency may match.
 * @param {string[]} [options.forbiddenFiles] Absolute files no entry may reach (the tag-aware root).
 * @param {string} [options.absWorkingDir]    Base for relative paths. Defaults to the repo root.
 * @param {string[]} [options.nodePaths]      Extra module directories (the tests' fixtures).
 * @returns {Promise<{entry: string, violations: {kind: string, path: string, from?: string}[]}[]>}
 */
export async function checkSources({
  entries,
  forbidden = DEFAULT_FORBIDDEN,
  forbiddenFiles = [],
  absWorkingDir = ROOT,
  nodePaths = [],
}) {
  const isForbidden = makeIsForbidden(forbidden);
  const rel = (f) => toPosix(relative(absWorkingDir, f));
  const forbiddenSet = new Set(forbiddenFiles.map((f) => resolve(absWorkingDir, f)));
  const results = [];
  for (const entry of entries) {
    const entryAbs = resolve(absWorkingDir, entry);
    const owner = nearestPackageJson(entryAbs);
    const { metafile, warnings } = await build({
      entryPoints: [entryAbs],
      absWorkingDir,
      nodePaths,
      bundle: true,
      write: false,
      metafile: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
      // Follow every import a runtime would execute, even ones a bundler may drop because the
      // package says `sideEffects: false` (a code-split entry bare-imports the chunks it needs
      // for evaluation order): fail closed, and no "ignoring this import" warning.
      ignoreAnnotations: true,
    });
    const violations = warnings.map((w) => ({
      kind: 'esbuild warning',
      path: w.text,
      from: w.location ? `${toPosix(w.location.file)}:${w.location.line}` : undefined,
    }));
    const checkedPackages = new Set();
    for (const [path, input] of Object.entries(metafile.inputs)) {
      const abs = resolve(absWorkingDir, path);
      if (isForbidden(path)) violations.push({ kind: 'bundles', path });
      if (forbiddenSet.has(abs)) violations.push({ kind: 'bundles tag-aware root', path });
      for (const imp of input.imports) {
        const specifier = imp.original ?? imp.path;
        if (isForbidden(specifier) && !isForbidden(path)) {
          violations.push({ kind: 'imports', path: specifier, from: path });
        }
      }
      if (isForbidden(path) || !isFile(abs)) continue;
      const pkgJson = nearestPackageJson(abs);
      if (pkgJson === owner) {
        const { literals, dynamicCalls } = scanOwnFile(abs);
        for (const literal of literals.filter(isForbidden)) {
          violations.push({ kind: 'mentions', path: literal, from: path });
        }
        for (const { line, code } of dynamicCalls) {
          violations.push({ kind: 'non-literal import', path: code, from: `${path}:${line}` });
        }
      } else if (pkgJson && !checkedPackages.has(pkgJson)) {
        checkedPackages.add(pkgJson);
        violations.push(...dependencyViolations(pkgJson, isForbidden, rel));
      }
    }
    results.push({ entry: rel(entryAbs), violations });
  }
  return results;
}

/** Resolution settings a declaration import is resolved under: bundler, then node16 import/require. */
const RESOLUTIONS = [
  [{ moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext }, undefined],
  [{ moduleResolution: ts.ModuleResolutionKind.Node16, module: ts.ModuleKind.Node16 }, ts.ModuleKind.ESNext],
  [{ moduleResolution: ts.ModuleResolutionKind.Node16, module: ts.ModuleKind.Node16 }, ts.ModuleKind.CommonJS],
];

/** Every distinct declaration file `specifier` (written in `fromFile`) resolves to. */
function resolveDeclaration(specifier, fromFile, compilerOptions) {
  const found = new Set();
  for (const [options, mode] of RESOLUTIONS) {
    const { resolvedModule } = ts.resolveModuleName(
      specifier,
      fromFile,
      { ...options, ...compilerOptions },
      ts.sys,
      undefined,
      undefined,
      mode,
    );
    if (resolvedModule && /\.d\.[cm]?ts$/.test(resolvedModule.resolvedFileName)) {
      found.add(realpathSync(resolvedModule.resolvedFileName));
    }
  }
  return [...found];
}

/**
 * Types pass: walk each declaration entry's imports and references and return what it reaches.
 * A relative import or reference that resolves to no file throws (fail closed).
 *
 * @param {object} options
 * @param {string[]} options.entries           Declaration files (absolute, or relative to absWorkingDir).
 * @param {RegExp[]} [options.forbidden]       Patterns no specifier or dependency may match.
 * @param {string[]} [options.forbiddenFiles]  Absolute declaration files no entry may reach.
 * @param {string} [options.absWorkingDir]     Base for relative paths. Defaults to the repo root.
 * @param {object} [options.compilerOptions]   Extra TypeScript options for resolving imports (the tests' fixtures).
 */
export function checkDeclarations({
  entries,
  forbidden = DEFAULT_FORBIDDEN,
  forbiddenFiles = [],
  absWorkingDir = ROOT,
  compilerOptions = {},
}) {
  const isForbidden = makeIsForbidden(forbidden);
  const forbiddenSet = new Set(forbiddenFiles.map((f) => realpathOr(resolve(absWorkingDir, f))));
  const rel = (f) => toPosix(relative(absWorkingDir, f));
  return entries.map((entry) => {
    const entryAbs = resolve(absWorkingDir, entry);
    if (!isFile(entryAbs)) throw new Error(`Declaration file not found: ${rel(entryAbs)} (run \`pnpm build\` first?)`);
    const owner = nearestPackageJson(realpathSync(entryAbs));
    const violations = [];
    const seen = new Set();
    const checkedPackages = new Set();
    const queue = [realpathSync(entryAbs)];
    while (queue.length) {
      const file = queue.shift();
      if (seen.has(file)) continue;
      seen.add(file);
      if (forbiddenSet.has(file)) violations.push({ kind: 'types reach tag-aware root', path: rel(file) });
      const pkgJson = nearestPackageJson(file);
      if (pkgJson && pkgJson !== owner && !checkedPackages.has(pkgJson)) {
        checkedPackages.add(pkgJson);
        violations.push(...dependencyViolations(pkgJson, isForbidden, rel));
      }
      const { importedFiles, referencedFiles, typeReferenceDirectives } = ts.preProcessFile(
        readFileSync(file, 'utf8'),
        true,
        true,
      );
      for (const { fileName: name } of typeReferenceDirectives) {
        if (isForbidden(name)) violations.push({ kind: 'references types', path: name, from: rel(file) });
      }
      for (const { fileName: name } of referencedFiles) {
        const target = resolve(dirname(file), name);
        if (!isFile(target)) throw new Error(`${rel(file)} references '${name}', which is not a file.`);
        queue.push(realpathSync(target));
      }
      for (const { fileName: specifier } of importedFiles) {
        if (isForbidden(specifier)) {
          violations.push({ kind: 'type-imports', path: specifier, from: rel(file) });
          continue;
        }
        const targets = resolveDeclaration(specifier, file, compilerOptions);
        if (targets.length === 0 && specifier.startsWith('.')) {
          throw new Error(`${rel(file)} imports '${specifier}', which resolves to no declaration file.`);
        }
        for (const target of targets) {
          if (isForbidden(target)) violations.push({ kind: 'type-imports', path: rel(target), from: rel(file) });
          else queue.push(target);
        }
      }
    }
    return { entry: rel(entryAbs), violations };
  });
}

function realpathOr(p) {
  return existsSync(p) ? realpathSync(p) : p;
}

/** Every file an `exports` target names, split into `types` files and the rest. */
function exportFiles(target) {
  const types = [];
  const code = [];
  const walk = (t, key) => {
    if (typeof t === 'string') (key === 'types' ? types : code).push(t);
    else if (t && typeof t === 'object') for (const [k, v] of Object.entries(t)) walk(v, k);
  };
  walk(target, undefined);
  return { types, code };
}

/** Condition objects in an `exports` target that point at code but give no `types`. */
function conditionsWithoutTypes(target, path = []) {
  if (!target || typeof target !== 'object') return [];
  const here = Object.values(target).some((v) => typeof v === 'string') && !('types' in target) ? [path.join('.') || '(top)'] : [];
  return [
    ...here,
    ...Object.entries(target).flatMap(([k, v]) => (k === 'types' ? [] : conditionsWithoutTypes(v, [...path, k]))),
  ];
}

/**
 * Check one package: its `subpaths.json`, `exports` and the tag-agnostic subpaths.
 *
 * @param {string} packageDir
 * @param {object} [options]  `absWorkingDir`, `nodePaths`, `compilerOptions`, `forbidden` (see the passes).
 * @returns {Promise<{errors: string[], results: {entry: string, violations: object[]}[]}>}
 */
export async function checkPackage(packageDir, { absWorkingDir = ROOT, nodePaths = [], compilerOptions, forbidden } = {}) {
  const errors = [];
  const pkg = readJson(join(packageDir, 'package.json'));
  const subpathsFile = join(packageDir, 'subpaths.json');
  if (!isFile(subpathsFile)) return { errors: [`${packageDir}: no subpaths.json`], results: [] };
  const subpaths = readJson(subpathsFile);
  const exportsMap = pkg.exports ?? {};
  const exported = Object.keys(exportsMap).filter((k) => k !== './package.json');

  const notListed = exported.filter((k) => !(k in subpaths));
  const notExported = Object.keys(subpaths).filter((k) => !(k in exportsMap));
  if (notListed.length) errors.push(`exports subpath(s) missing from subpaths.json: ${notListed.join(', ')}`);
  if (notExported.length) errors.push(`subpaths.json subpath(s) missing from exports: ${notExported.join(', ')}`);
  const tsupConfig = join(packageDir, 'tsup.config.ts');
  if (isFile(tsupConfig) && !readFileSync(tsupConfig, 'utf8').includes('subpaths.json')) {
    errors.push('tsup.config.ts must derive its entries from subpaths.json');
  }

  const agnostic = Object.keys(subpaths).filter((k) => !subpaths[k].tagAware && k in exportsMap);
  const aware = Object.keys(subpaths).filter((k) => subpaths[k].tagAware);
  const inPkg = (f) => join(packageDir, f);

  const forbiddenFiles = aware.flatMap((k) => {
    const { types, code } = exportFiles(exportsMap[k]);
    return [subpaths[k].source, ...types, ...code].filter(Boolean).map(inPkg);
  });
  const sources = [];
  const declarations = [];
  for (const k of agnostic) {
    const { types, code } = exportFiles(exportsMap[k]);
    const missingTypes = conditionsWithoutTypes(exportsMap[k]);
    if (typeof exportsMap[k] === 'string' || missingTypes.length || types.length === 0) {
      errors.push(`exports['${k}'] needs a types file for every condition (missing at: ${missingTypes.join(', ') || '(top)'})`);
    }
    for (const f of [subpaths[k].source, ...code, ...types]) {
      if (!isFile(inPkg(f))) errors.push(`exports['${k}']: ${f} does not exist (run \`pnpm build\` first?)`);
    }
    sources.push(inPkg(subpaths[k].source), ...code.map(inPkg));
    declarations.push(...types.map(inPkg));
  }
  if (errors.length) return { errors, results: [] };
  const results = [
    ...(await checkSources({ entries: [...new Set(sources)], forbidden, forbiddenFiles, absWorkingDir, nodePaths })),
    ...checkDeclarations({ entries: [...new Set(declarations)], forbidden, forbiddenFiles, absWorkingDir, compilerOptions }),
  ];
  return { errors, results };
}

function report({ errors, results }) {
  for (const e of errors) console.error(`ERROR ${e}`);
  let failed = errors.length > 0;
  for (const { entry, violations } of results) {
    if (violations.length === 0) {
      console.log(`ok    ${entry}`);
      continue;
    }
    failed = true;
    console.error(`FAIL  ${entry} reaches a tag-aware dependency:`);
    for (const v of violations) console.error(`        ${v.from ? `${v.from} ` : ''}${v.kind} ${v.path}`);
  }
  return failed;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'node-path': { type: 'string', multiple: true, default: [] },
      package: { type: 'string' },
    },
  });
  const nodePaths = values['node-path'].map((p) => resolve(p));
  let outcome;
  try {
    if (positionals.length) {
      const entries = positionals.map((p) => resolve(p));
      const isDeclaration = (p) => /\.d\.[cm]?ts$/.test(p);
      outcome = {
        errors: [],
        results: [
          ...(await checkSources({ entries: entries.filter((p) => !isDeclaration(p)), nodePaths })),
          ...checkDeclarations({ entries: entries.filter(isDeclaration) }),
        ],
      };
    } else {
      outcome = await checkPackage(values.package ? resolve(values.package) : PACKAGE_DIR, { nodePaths });
    }
  } catch (err) {
    console.error(`Boundary check could not complete:\n${err.message}`);
    process.exit(1);
  }
  if (report(outcome)) {
    console.error('\nTag-agnostic subpaths must not reach @zodal/groups-* or the root entry (ADR 0001 §Consequences).');
    process.exit(1);
  }
}

const invokedDirectly = (() => {
  const arg = process.argv[1];
  if (!arg) return false;
  return realpathOr(isAbsolute(arg) ? arg : resolve(arg)) === realpathOr(fileURLToPath(import.meta.url));
})();

if (invokedDirectly) await main();
