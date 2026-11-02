/**
 * Runtime boundary guard: while it is installed, nothing in this process can load
 * `@zodal/groups-*`, however the load is written.
 *
 * The static check (`check-boundaries.mjs`) catches the loaders written by accident; a
 * determined one (`Module._load`, `''.constructor.constructor`, `vm`,
 * `process.getBuiltinModule('module')`...) can always slip past a scan. Every one of them
 * still goes through Node's module loader, so a synchronous `module.registerHooks` resolve
 * hook (the specifier, and where it resolved to) plus a load hook (a file loaded by path
 * after `Module._resolveFilename`) sees them all, for `import` and `require` alike.
 *
 * The tag-agnostic subpaths' tests run under it (`packages/polytag/vitest.agnostic.config.ts`,
 * through `boundary-guard.register.mjs`), so code that is only reached at call time is
 * guarded too, not just what loads at import.
 *
 * Requires Node >= 22.15 (or 23.5): `module.registerHooks`.
 *
 * API: installBoundaryGuard({ forbidden, registerHooks }), BoundaryViolation
 */

import nodeModule from 'node:module';
import { DEFAULT_FORBIDDEN, makeIsForbidden } from './boundary-patterns.mjs';

/** Thrown, from inside the loader, when something tries to load a forbidden module. */
export class BoundaryViolation extends Error {
  constructor(what, from) {
    super(`boundary guard: ${what}${from ? ` (from ${from})` : ''} is forbidden in tag-agnostic code (ADR 0001)`);
    this.name = 'BoundaryViolation';
    this.code = 'ERR_POLYTAG_BOUNDARY';
  }
}

/**
 * Install the guard for the rest of this process.
 *
 * @param {object} [options]
 * @param {RegExp[]} [options.forbidden]  What may not be loaded (specifier, resolved URL or file path).
 * @param {Function} [options.registerHooks]  `module.registerHooks` (injectable for tests).
 * @returns {{ deregister(): void }}
 */
export function installBoundaryGuard({ forbidden = DEFAULT_FORBIDDEN, registerHooks = nodeModule.registerHooks } = {}) {
  if (typeof registerHooks !== 'function') {
    throw new Error(`boundary guard needs module.registerHooks (Node >= 22.15 or 23.5); this is Node ${process.versions.node}`);
  }
  const isForbidden = makeIsForbidden(forbidden);
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
