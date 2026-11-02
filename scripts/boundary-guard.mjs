/**
 * Runtime boundary guard: refuse every load of `@zodal/groups-*` while tag-agnostic code runs.
 *
 * The static check (`check-boundaries.mjs`) catches the loaders written by accident; a
 * determined one (`Module._load`, `''.constructor.constructor`, `vm`,
 * `process.getBuiltinModule('module')`...) can always slip past a scan. Loads go through
 * one of two loaders, and the guard covers both:
 * - Node's (`installBoundaryGuard`): a synchronous `module.registerHooks` resolve hook (the
 *   specifier, and where it resolved to) plus a load hook (a file loaded by path after
 *   `Module._resolveFilename`), for `import` and `require` alike;
 * - vitest's (`viteBoundaryGuard`): vitest runs every module outside `node_modules` itself
 *   (a local checkout linked in, a file imported by path, anything inlined), so Node's hooks
 *   never see those; a vite plugin refuses them at resolve and load.
 *
 * Not covered: a `worker_threads` Worker or a child process, which start their own loader
 * without the hooks. Both are visible to the static check's reviewers, not to this guard.
 *
 * The tag-agnostic subpaths' tests run under both (`packages/polytag/vitest.agnostic.config.ts`,
 * Node's through `boundary-guard.register.mjs`), so code reached only at call time is
 * guarded too, not just what loads at import.
 *
 * Requires Node >= 22.15 (or 23.5): `module.registerHooks`.
 *
 * API: installBoundaryGuard({ registerHooks }), viteBoundaryGuard(), BoundaryViolation
 */

import nodeModule from 'node:module';
import { makeIsForbidden } from './boundary-patterns.mjs';

const isForbidden = makeIsForbidden();

/** Thrown, from inside the loader, when something tries to load a forbidden module. */
export class BoundaryViolation extends Error {
  constructor(what, from) {
    super(`boundary guard: ${what}${from ? ` (from ${from})` : ''} is forbidden in tag-agnostic code (ADR 0001)`);
    this.name = 'BoundaryViolation';
    this.code = 'ERR_POLYTAG_BOUNDARY';
  }
}

/**
 * Install the guard in Node's loader for the rest of this thread.
 *
 * @param {object} [options]
 * @param {Function} [options.registerHooks]  `module.registerHooks` (injectable for tests).
 * @returns {{ deregister(): void }}
 */
export function installBoundaryGuard({ registerHooks = nodeModule.registerHooks } = {}) {
  if (typeof registerHooks !== 'function') {
    throw new Error(`boundary guard needs module.registerHooks (Node >= 22.15 or 23.5); this is Node ${process.versions.node}`);
  }
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      if (isForbidden(specifier)) throw new BoundaryViolation(specifier, context.parentURL);
      const resolved = nextResolve(specifier, context);
      if (isForbidden(decodeURIComponent(resolved.url))) throw new BoundaryViolation(resolved.url, context.parentURL);
      return resolved;
    },
    load(url, context, nextLoad) {
      if (isForbidden(decodeURIComponent(url))) throw new BoundaryViolation(url);
      return nextLoad(url, context);
    },
  });
}

/**
 * The same guard as a vite plugin, for the modules vitest runs itself (see the module doc):
 * refuses a forbidden specifier at resolve, and a forbidden file (however it was reached) at load.
 */
export function viteBoundaryGuard() {
  return {
    name: 'polytag-boundary-guard',
    enforce: 'pre',
    resolveId(id, importer) {
      if (isForbidden(id)) throw new BoundaryViolation(id, importer);
      return null;
    },
    load(id) {
      if (isForbidden(id)) throw new BoundaryViolation(id);
      return null;
    },
  };
}
