/**
 * The tag-agnostic tests, run again under the runtime boundary guard
 * (`scripts/boundary-guard.mjs`, i2mint/polytag#21): in these workers neither Node's loader
 * (`--import` of the register module) nor vitest's (the vite plugin) loads `@zodal/groups-*`,
 * however the load is written, so code reached only at call time is checked too. Which tests: each tag-agnostic subpath's `tests` in `subpaths.json`, plus
 * `tests/agnostic/` (the guard's own self-check and the built entries).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
// @ts-expect-error -- a plain .mjs script with no declarations
import { viteBoundaryGuard } from '../../scripts/boundary-guard.mjs';

type Subpath = { source: string; tagAware?: boolean; tests?: string[] };
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const subpaths: Record<string, Subpath> = JSON.parse(readFileSync(here('./subpaths.json'), 'utf8'));
const agnostic = Object.entries(subpaths).filter(([, s]) => !s.tagAware);
// A tag-agnostic subpath with no tests would be guarded only through its built entries: say so.
const untested = agnostic.filter(([, s]) => !s.tests?.length).map(([k]) => k);
if (untested.length) throw new Error(`subpaths.json: tag-agnostic subpath(s) with no "tests": ${untested.join(', ')}`);
const listed = [...new Set(agnostic.flatMap(([, s]) => s.tests ?? []))];
// A listed file that does not exist would match nothing and pass silently: fail instead.
const missing = listed.filter((t) => !existsSync(here(`./${t}`)));
if (missing.length) throw new Error(`subpaths.json lists tests that do not exist: ${missing.join(', ')}`);

export default defineConfig({
  plugins: [viteBoundaryGuard()],
  test: {
    include: ['tests/agnostic/**/*.test.ts', ...listed],
    pool: 'forks',
    poolOptions: { forks: { execArgv: ['--import', here('../../scripts/boundary-guard.register.mjs')] } },
  },
});
