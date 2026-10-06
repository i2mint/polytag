#!/usr/bin/env node
/**
 * Boundary check: polytag's tag-agnostic subpaths never reach `@zodal/groups-*`.
 *
 * ADR 0001 §Consequences: `polytag/formats`, `polytag/backends` and `polytag/views` are
 * tag-agnostic so they can move to zodal when an untagged consumer appears. Pattern from
 * comparanda ADR-0005. Two passes:
 *
 * 1. Sources: bundle each subpath's source entry with esbuild (nothing external except
 *    Node built-ins; dynamic `import()` included) and read the metafile. A bundled file or
 *    import specifier matching a forbidden pattern, or the tag-aware root entry
 *    (`src/index.ts`), is a violation; so is any esbuild warning. An unresolvable
 *    forbidden package makes esbuild fail, so the pass fails closed. esbuild erases
 *    type-only imports and cannot follow `createRequire(...)('x')`, so the string literals
 *    (not comments) of every bundled file outside node_modules are scanned as well.
 * 2. Declarations: walk the built `.d.ts`/`.d.cts` files each subpath's `exports` points
 *    at, following relative imports and `/// <reference path>`, and flag a forbidden
 *    specifier or `/// <reference types>`, or a reach into the root entry's declarations
 *    (tsup can hoist shared types into `index.d.ts`). Needs `pnpm build` first.
 *
 * Every subpath in the package's `exports` must be classified below as tag-aware or
 * tag-agnostic, so a new subpath cannot silently skip the check.
 *
 * Usage:  node scripts/check-boundaries.mjs     (exit 0 clean, 1 on a violation)
 *         node scripts/check-boundaries.mjs [--node-path DIR]... ENTRY...
 *           check these entries instead (`.d.ts`/`.d.cts`: types pass; else runtime pass)
 * API:    checkSources({ entries, ... }), checkDeclarations({ entries, ... })
 */

import { build } from 'esbuild';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_DIR = join(ROOT, 'packages', 'polytag');

/** Tag-aware subpaths: allowed to depend on zodal-groups. */
export const TAG_AWARE = ['.', './package.json'];

/** Tag-agnostic subpaths and their source entries (relative to the package dir). */
export const TAG_AGNOSTIC = {
  './formats': 'src/formats/index.ts',
  './backends': 'src/backends/index.ts',
  './views': 'src/views/index.ts',
};

/**
 * What a tag-agnostic subpath must not reach: the `@zodal/groups-*` packages, whether
 * through node_modules (`@zodal/groups-core`, pnpm's `.pnpm/@zodal+groups-core@x`) or a
 * local checkout of the zodal-groups repo (`../zodal-groups/...`).
 */
export const DEFAULT_FORBIDDEN = [/@zodal[\\/+]groups-/, /(^|[\\/])zodal-groups([\\/]|$)/];

const toPosix = (p) => p.split('\\').join('/');
const isFile = (p) => existsSync(p) && statSync(p).isFile();

/** Every string literal in a source file (comments excluded): the backstop for specifiers esbuild cannot see. */
function stringLiterals(file) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false);
  const found = [];
  const visit = (node) => {
    if (ts.isStringLiteralLike(node)) found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * Runtime pass: bundle each source entry and return the forbidden inputs and imports.
 *
 * @param {object} options
 * @param {string[]} options.entries          Entry files (absolute, or relative to absWorkingDir).
 * @param {RegExp[]} [options.forbidden]      Patterns no bundled path or import specifier may match.
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
  const isForbidden = (p) => forbidden.some((re) => re.test(toPosix(p)));
  const forbiddenInputs = new Set(forbiddenFiles.map((f) => toPosix(relative(absWorkingDir, f))));
  const results = [];
  for (const entry of entries) {
    const { metafile, warnings } = await build({
      entryPoints: [entry],
      absWorkingDir,
      nodePaths,
      bundle: true,
      write: false,
      metafile: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
    });
    const violations = warnings.map((w) => ({
      kind: 'esbuild warning',
      path: w.text,
      from: w.location ? `${toPosix(w.location.file)}:${w.location.line}` : undefined,
    }));
    for (const [path, input] of Object.entries(metafile.inputs)) {
      if (isForbidden(path)) violations.push({ kind: 'bundles', path });
      if (!/(^|\/)node_modules\//.test(toPosix(path)) && !isForbidden(path)) {
        for (const literal of stringLiterals(resolve(absWorkingDir, path))) {
          if (isForbidden(literal)) violations.push({ kind: 'mentions', path: literal, from: path });
        }
      }
      if (forbiddenInputs.has(toPosix(path))) violations.push({ kind: 'bundles tag-aware root', path });
      for (const imp of input.imports) {
        const specifier = imp.original ?? imp.path;
        if (isForbidden(specifier) && !isForbidden(path)) {
          violations.push({ kind: 'imports', path: specifier, from: path });
        }
      }
    }
    results.push({ entry, violations });
  }
  return results;
}

/** Candidate declaration files for a relative specifier written in a `.d.ts`/`.d.cts` file. */
function declarationCandidates(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  const swaps = [
    [/\.js$/, '.d.ts'],
    [/\.cjs$/, '.d.cts'],
    [/\.mjs$/, '.d.mts'],
  ];
  for (const [re, ext] of swaps) if (re.test(base)) return [base.replace(re, ext)];
  return [base, `${base}.d.ts`, `${base}.d.cts`, join(base, 'index.d.ts')];
}

/**
 * Types pass: walk each declaration entry's relative imports and return the forbidden
 * specifiers it reaches. A relative import that resolves to no file throws (fail closed).
 *
 * @param {object} options
 * @param {string[]} options.entries          Declaration files (absolute, or relative to absWorkingDir).
 * @param {RegExp[]} [options.forbidden]      Patterns no import specifier may match.
 * @param {string[]} [options.forbiddenFiles] Absolute declaration files no entry may reach.
 * @param {string} [options.absWorkingDir]    Base for relative paths. Defaults to the repo root.
 */
export function checkDeclarations({ entries, forbidden = DEFAULT_FORBIDDEN, forbiddenFiles = [], absWorkingDir = ROOT }) {
  const isForbidden = (p) => forbidden.some((re) => re.test(toPosix(p)));
  const forbiddenSet = new Set(forbiddenFiles.map((f) => resolve(absWorkingDir, f)));
  const rel = (f) => toPosix(relative(absWorkingDir, f));
  return entries.map((entry) => {
    const violations = [];
    const seen = new Set();
    const queue = [resolve(absWorkingDir, entry)];
    while (queue.length) {
      const file = queue.shift();
      if (seen.has(file)) continue;
      seen.add(file);
      if (!isFile(file)) throw new Error(`Declaration file not found: ${rel(file)} (run \`pnpm build\` first?)`);
      if (forbiddenSet.has(file)) violations.push({ kind: 'types reach tag-aware root', path: rel(file) });
      const { importedFiles, referencedFiles, typeReferenceDirectives } = ts.preProcessFile(
        readFileSync(file, 'utf8'),
        true,
        true,
      );
      for (const { fileName: name } of typeReferenceDirectives) {
        if (isForbidden(name)) violations.push({ kind: 'references types', path: name, from: rel(file) });
      }
      // `/// <reference path>` is always relative to the file, with or without a leading dot.
      const specifiers = [
        ...importedFiles.map((f) => f.fileName),
        ...referencedFiles.map((f) => (f.fileName.startsWith('.') ? f.fileName : `./${f.fileName}`)),
      ];
      for (const specifier of specifiers) {
        if (specifier.startsWith('.')) {
          const target = declarationCandidates(file, specifier).find(isFile);
          if (!target) throw new Error(`${rel(file)} imports '${specifier}', which resolves to no declaration file.`);
          if (isForbidden(rel(target))) violations.push({ kind: 'type-imports', path: rel(target), from: rel(file) });
          queue.push(target);
        } else if (isForbidden(specifier)) {
          violations.push({ kind: 'type-imports', path: specifier, from: rel(file) });
        }
      }
    }
    return { entry: toPosix(entry), violations };
  });
}

/** The `types` files a package `exports` target points at, under every condition. */
function typesFiles(target) {
  if (!target || typeof target !== 'object') return [];
  return Object.entries(target).flatMap(([k, v]) => (k === 'types' && typeof v === 'string' ? [v] : typesFiles(v)));
}

function report(results) {
  let failed = false;
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
    options: { 'node-path': { type: 'string', multiple: true, default: [] } },
  });
  const nodePaths = values['node-path'].map((p) => resolve(p));
  const isDeclaration = (p) => /\.d\.[cm]?ts$/.test(p);
  let sources, declarations;
  let forbiddenFiles = [];
  if (positionals.length) {
    const entries = positionals.map((p) => relative(ROOT, resolve(p)));
    sources = entries.filter((p) => !isDeclaration(p));
    declarations = entries.filter(isDeclaration);
  } else {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8'));
    const exportsMap = pkg.exports ?? {};
    const unclassified = Object.keys(exportsMap).filter((k) => !TAG_AWARE.includes(k) && !(k in TAG_AGNOSTIC));
    const missing = Object.keys(TAG_AGNOSTIC).filter((k) => !(k in exportsMap));
    if (unclassified.length || missing.length) {
      if (unclassified.length) console.error(`Unclassified subpath export(s): ${unclassified.join(', ')}.`);
      if (missing.length) console.error(`TAG_AGNOSTIC lists subpath(s) not in exports: ${missing.join(', ')}.`);
      console.error('Keep TAG_AWARE / TAG_AGNOSTIC in scripts/check-boundaries.mjs in step with package.json exports.');
      process.exit(1);
    }
    sources = Object.values(TAG_AGNOSTIC).map((src) => relative(ROOT, join(PACKAGE_DIR, src)));
    declarations = Object.keys(TAG_AGNOSTIC).flatMap((k) =>
      typesFiles(exportsMap[k]).map((f) => relative(ROOT, join(PACKAGE_DIR, f))),
    );
    forbiddenFiles = [
      join(PACKAGE_DIR, 'src', 'index.ts'),
      ...typesFiles(exportsMap['.']).map((f) => join(PACKAGE_DIR, f)),
    ];
  }
  let results;
  try {
    results = [
      ...(await checkSources({ entries: sources, nodePaths, forbiddenFiles })),
      ...checkDeclarations({ entries: declarations, forbiddenFiles }),
    ];
  } catch (err) {
    console.error(`Boundary check could not complete:\n${err.message}`);
    process.exit(1);
  }
  if (report(results)) {
    console.error('\nTag-agnostic subpaths must not import @zodal/groups-* or the root entry (ADR 0001 §Consequences).');
    process.exit(1);
  }
}

const invokedDirectly = (() => {
  const arg = process.argv[1];
  if (!arg) return false;
  const real = (p) => (existsSync(p) ? realpathSync(p) : p);
  return real(isAbsolute(arg) ? arg : resolve(arg)) === real(fileURLToPath(import.meta.url));
})();

if (invokedDirectly) await main();
