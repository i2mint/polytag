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
 *    forbidden package (catches type-only imports), an `import()`/`require()` whose
 *    argument is not a string literal, or any other runtime loader esbuild cannot follow
 *    (`require` aliased or not in call position, `module.require`, `createRequire`, `eval`,
 *    `Function`, a computed member of `globalThis`/`global`/`self`/`window`), unless the line, or the one above, says
 *    `boundary-check: allow-dynamic` in a comment. The threat model is accidental coupling
 *    (see ESCAPE_NAMES). In a dependency, a forbidden
 *    package among its dependencies, peerDependencies or optionalDependencies.
 *    Also: a built file reached from a tag-agnostic entry whose source map lists a source file
 *    only the tag-aware root reaches (root code hoisted into a shared chunk).
 * 2. Types: every `types` file the exports map names (each condition must have one),
 *    walked through relative and package imports and `/// <reference>` directives.
 *    Violations: a forbidden specifier or `/// <reference types>`; reaching the root's
 *    declarations (tsup can hoist shared types into `index.d.ts`); a dependency that
 *    declares a forbidden package.
 *
 * 3. Tests: every test of only tag-agnostic code is listed in its subpath's `tests` in
 *    `subpaths.json`, which the runtime-guarded test run reads (see unlistedTestErrors).
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
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import ts from 'typescript';
import { DEFAULT_FORBIDDEN, makeIsForbidden } from './boundary-patterns.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_DIR = join(ROOT, 'packages', 'polytag');

export { DEFAULT_FORBIDDEN };

/** Marks a deliberate non-literal `import()`/`require()` in tag-agnostic code. */
export const ALLOW_DYNAMIC_MARKER = 'boundary-check: allow-dynamic';

const toPosix = (p) => p.split('\\').join('/');
const isFile = (p) => existsSync(p) && statSync(p).isFile();
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

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

/**
 * Runtime loaders esbuild cannot follow, as written by accident or by a well-meaning
 * workaround: `require` aliased or not in call position (`const r = require`,
 * `require.call`), `module.require`, `createRequire`, `eval`, `new Function`, a computed
 * member of a global object (`globalThis['req' + 'uire']`).
 *
 * Threat model: accidental coupling, not an adversary. A determined author can always reach
 * a module at runtime (`Module._load`, `''.constructor.constructor`, `vm`...), and no
 * deny-list closes that; the real guarantee is extracting the tag-agnostic code into a
 * package that does not depend on `@zodal/groups-*` (ADR 0001). Names are judged as free
 * references, so a local `window` parameter or `const self = this` is not a global.
 */
export const ESCAPE_NAMES = new Set(['require', 'createRequire', 'eval', 'Function']);

/** Global objects whose computed members (`globalThis[name]`) can reach an escape. */
export const GLOBAL_OBJECTS = new Set(['globalThis', 'global', 'self', 'window']);

/** Members of an escape name that invoke it (`require.call(null, n)`). */
const CALLING_MEMBERS = new Set(['call', 'apply', 'bind', 'constructor']);

/** Operators whose operands are only compared, never run. */
const COMPARISONS = new Set([
  ts.SyntaxKind.InstanceOfKeyword,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

/**
 * Is `node` inside esbuild's `var __require = ...` shim, which a built ESM file carries when
 * its source calls `require('literal')`? The source itself is scanned, so the shim adds nothing.
 */
function isInEsbuildRequireShim(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isVariableDeclaration(n)) return ts.isIdentifier(n.name) && n.name.text === '__require';
  }
  return false;
}

/** `node` without the parentheses and type assertions around it: `(globalThis as any)` -> `globalThis`. */
function unwrap(node) {
  let n = node;
  while (
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isTypeAssertionExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isSatisfiesExpression(n)
  ) {
    n = n.expression;
  }
  return n;
}

/** Is `node` inside a type (`f: Function`, `typeof eval` in a type), where it never runs? */
function isInType(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isTypeNode(n) && !ts.isExpressionWithTypeArguments(n)) return true;
    if (ts.isStatement(n) || ts.isSourceFile(n)) return false;
  }
  return false;
}

/**
 * Why `node` is a runtime loader esbuild cannot follow, or undefined. `isFree(id)` says
 * whether an identifier names nothing declared in the file (a global).
 */
function escapeKind(node, isFree) {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    const [arg] = node.arguments;
    const loader = callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require');
    return loader && (!arg || !ts.isStringLiteralLike(arg)) ? 'non-literal import' : undefined;
  }
  if (ts.isImportSpecifier(node) || ts.isBindingElement(node)) {
    // `import { createRequire }`, `const { createRequire, require: r } = m`.
    const name = node.propertyName ?? node.name;
    return ts.isIdentifier(name) && (name.text === 'createRequire' || (ts.isBindingElement(node) && name.text === 'require'))
      ? 'runtime loader'
      : undefined;
  }
  if (ts.isPropertyAccessExpression(node)) {
    // `module.require`, `m.createRequire`, and `globalThis.eval` (any escape on a global object).
    const { text } = node.name;
    const target = unwrap(node.expression);
    const onGlobal = ts.isIdentifier(target) && GLOBAL_OBJECTS.has(target.text) && isFree(target);
    return text === 'require' || text === 'createRequire' || (onGlobal && ESCAPE_NAMES.has(text)) ? 'runtime loader' : undefined;
  }
  if (ts.isElementAccessExpression(node)) {
    const key = node.argumentExpression;
    if (ts.isStringLiteralLike(key)) return ESCAPE_NAMES.has(key.text) ? 'runtime loader' : undefined;
    const target = unwrap(node.expression);
    return ts.isIdentifier(target) && GLOBAL_OBJECTS.has(target.text) && isFree(target) ? 'computed global member' : undefined;
  }
  if (!ts.isIdentifier(node) || isInType(node)) return undefined;
  const { parent } = node;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return undefined; // judged above
  if (!isFree(node)) return undefined;
  if (ESCAPE_NAMES.has(node.text)) {
    if (node.text === 'require' && ts.isCallExpression(parent) && parent.expression === node) return undefined; // judged above
    if (ts.isTypeOfExpression(parent)) return undefined; // `typeof require !== 'undefined'`
    // `Function.prototype.toString`, `require.resolve`: reading a member is not loading; `.call`/`.apply`/`.bind`/`.constructor` can be.
    if (ts.isPropertyAccessExpression(parent) && parent.expression === node && !CALLING_MEMBERS.has(parent.name.text)) return undefined;
    if (ts.isBinaryExpression(parent) && COMPARISONS.has(parent.operatorToken.kind)) return undefined; // `x instanceof Function`
    if (isInEsbuildRequireShim(node)) return undefined;
    return 'runtime loader';
  }
  return undefined;
}

/** Lines (0-based) holding, or directly below, a comment that carries ALLOW_DYNAMIC_MARKER. */
function allowedLines(source) {
  const text = source.getFullText();
  const lines = new Set();
  const seen = new Set();
  const mark = (ranges = []) => {
    for (const { pos, end } of ranges) {
      if (seen.has(pos) || !text.slice(pos, end).includes(ALLOW_DYNAMIC_MARKER)) continue;
      seen.add(pos);
      const line = source.getLineAndCharacterOfPosition(end).line;
      lines.add(line).add(line + 1);
    }
  };
  const visit = (node) => {
    mark(ts.getLeadingCommentRanges(text, node.pos));
    mark(ts.getTrailingCommentRanges(text, node.end));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

/**
 * String literals, and runtime loaders esbuild cannot follow, in one of the package's own
 * files. A loader is allowed when a comment on its line, or on the line above, carries
 * ALLOW_DYNAMIC_MARKER (a string that contains it does not count).
 */
function scanOwnFile(file) {
  // A one-file program with no lib: a name that resolves to nothing is a global.
  // A JSON (or other non-script) input is not a program root: scan its literals only.
  const script = /\.[cm]?[jt]sx?$/.test(file);
  const program = script && ts.createProgram([file], { noLib: true, noResolve: true, allowJs: true, types: [], noEmit: true });
  const source = program ? program.getSourceFile(file) : ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const checker = program && program.getTypeChecker();
  // Free: declared nowhere in this file (`globalThis` resolves to a built-in symbol with no declaration).
  const isFree = (id) => !(checker.getSymbolAtLocation(id)?.declarations ?? []).some((d) => d.getSourceFile() === source);
  const allowed = allowedLines(source);
  const literals = [];
  const dynamicCalls = [];
  const visit = (node) => {
    if (ts.isStringLiteralLike(node)) literals.push(node.text);
    const kind = checker && escapeKind(node, isFree);
    if (kind) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
      if (!allowed.has(line)) dynamicCalls.push({ kind, line: line + 1, code: node.getText(source).slice(0, 80) });
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
 * @returns {Promise<{entry: string, violations: {kind: string, path: string, from?: string}[], reached: string[]}[]>}
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
        for (const { kind, line, code } of dynamicCalls) {
          violations.push({ kind, path: code, from: `${path}:${line}` });
        }
      } else if (pkgJson && !checkedPackages.has(pkgJson)) {
        checkedPackages.add(pkgJson);
        violations.push(...dependencyViolations(pkgJson, isForbidden, rel));
      }
    }
    const reached = Object.keys(metafile.inputs).map((path) => resolve(absWorkingDir, path)).filter(isFile);
    results.push({ entry: rel(entryAbs), violations, reached });
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
  const sourceResults = await checkSources({ entries: [...new Set(sources)], forbidden, forbiddenFiles, absWorkingDir, nodePaths });
  const rootOnly = await rootOwnedSources(
    aware.map((k) => inPkg(subpaths[k].source)).filter(isFile),
    sourceResults.flatMap((r) => r.reached),
    { absWorkingDir, nodePaths, packageDir },
  );
  errors.push(...(await unlistedTestErrors(packageDir, subpaths, rootOnly, { absWorkingDir, nodePaths, forbidden })));
  const rel = (f) => toPosix(relative(absWorkingDir, f));
  const results = [
    ...sourceResults.map(({ entry, violations, reached }) => ({ entry, violations: [...violations, ...hoistedRootSources(reached, rootOnly, rel)] })),
    ...checkDeclarations({ entries: [...new Set(declarations)], forbidden, forbiddenFiles, absWorkingDir, compilerOptions }),
  ];
  return { errors, results };
}

/**
 * The guarded test run (`vitest.agnostic.config.ts`) covers each tag-agnostic subpath's
 * `tests` in `subpaths.json`; this keeps that list honest (i2mint/polytag#26). A test file
 * under `tests/` (not `tests/agnostic/`, which the guarded run always includes) is
 * tag-agnostic when its static imports reach at least one of the package's own source files,
 * none of them root-only, and no forbidden module. Errors: a tag-agnostic test nobody lists
 * (it would run unguarded), and a listed test that reaches tag-aware code.
 */
async function unlistedTestErrors(packageDir, subpaths, rootOnly, { absWorkingDir, nodePaths, forbidden = DEFAULT_FORBIDDEN }) {
  const testsDir = join(packageDir, 'tests');
  if (!existsSync(testsDir)) return [];
  const isForbidden = makeIsForbidden(forbidden);
  const listed = new Set(Object.values(subpaths).filter((s) => !s.tagAware).flatMap((s) => s.tests ?? []));
  const inPkg = (f) => toPosix(relative(packageDir, f));
  const tests = readdirSync(testsDir, { recursive: true })
    .map((f) => toPosix(join('tests', String(f))))
    .filter((f) => /\.test\.[cm]?[jt]sx?$/.test(f) && !f.startsWith('tests/agnostic/'))
    .sort();
  const errors = [];
  for (const test of tests) {
    // Bare imports stay external: they are judged by name, and nothing needs bundling them.
    const { metafile } = await build({ entryPoints: [join(packageDir, test)], absWorkingDir, nodePaths, bundle: true, write: false, metafile: true, platform: 'node', format: 'esm', logLevel: 'silent', packages: 'external' });
    const own = Object.keys(metafile.inputs)
      .map((path) => realpathOr(resolve(absWorkingDir, path)))
      .filter((f) => { const r = inPkg(f); return !r.startsWith('..') && !r.startsWith('tests/') && !r.includes('node_modules/'); });
    const externals = Object.values(metafile.inputs).flatMap((input) => input.imports.filter((i) => i.external).map((i) => i.path));
    const tagAware = own.some((f) => rootOnly.has(f)) || externals.some(isForbidden);
    if (listed.has(test) && tagAware) errors.push(`subpaths.json lists ${test} as tag-agnostic, but it reaches tag-aware code`);
    if (!listed.has(test) && !tagAware && own.length) {
      errors.push(`${test} tests only tag-agnostic code, but no tag-agnostic subpath lists it in subpaths.json "tests" (the guarded run would skip it)`);
    }
  }
  return errors;
}

/**
 * The package's own source files that only the tag-aware root reaches: bundled from the
 * root's sources, minus everything a tag-agnostic entry's sources reach.
 */
async function rootOwnedSources(rootSources, agnosticReached, { absWorkingDir, nodePaths, packageDir }) {
  if (!rootSources.length) return new Set();
  const agnostic = new Set(agnosticReached.map((f) => realpathOr(f)));
  const own = (f) => !toPosix(relative(packageDir, f)).startsWith('..') && !toPosix(f).includes('/node_modules/');
  const out = new Set();
  for (const entry of rootSources) {
    const { metafile } = await build({ entryPoints: [entry], absWorkingDir, nodePaths, bundle: true, write: false, metafile: true, platform: 'node', format: 'esm', logLevel: 'silent', ignoreAnnotations: true });
    for (const path of Object.keys(metafile.inputs)) {
      const abs = realpathOr(resolve(absWorkingDir, path));
      if (isFile(abs) && own(abs) && !agnostic.has(abs) && !/\.(c|m)?js$/.test(abs)) out.add(abs);
    }
  }
  return out;
}

/**
 * Violations for built files (reached from a tag-agnostic entry) whose source map lists a
 * root-owned source: root code hoisted into a shared chunk, which bundling alone cannot see
 * (the chunk is the package's own file and imports nothing forbidden).
 */
function hoistedRootSources(reached, rootOnly, rel) {
  if (!rootOnly.size) return [];
  const violations = [];
  for (const file of reached) {
    const mapFile = `${file}.map`;
    if (!/\.(c|m)?js$/.test(file) || !isFile(mapFile)) continue;
    let map;
    try {
      map = readJson(mapFile);
    } catch {
      violations.push({ kind: 'unreadable source map', path: rel(mapFile) });
      continue;
    }
    const base = resolve(dirname(mapFile), map.sourceRoot ?? '');
    for (const source of map.sources ?? []) {
      const abs = realpathOr(resolve(base, source));
      if (rootOnly.has(abs)) violations.push({ kind: 'bundles root-owned source', path: rel(abs), from: rel(file) });
    }
  }
  return violations;
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
