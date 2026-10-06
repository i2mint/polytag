#!/usr/bin/env node
/**
 * Release gate: should this push to main publish to npm?
 *
 * Publish when BOTH hold:
 * - a commit SUBJECT since the last release tag (`v<version>`, or the whole history if
 *   there is none) contains `[publish]` (or `[force publish]`). Only subjects count: a
 *   marker merely mentioned in a commit body never arms a release. Reading the whole
 *   range, not just the head commit, means a multi-commit push, or a run that was
 *   cancelled before it published, does not lose the release: it stays armed until a
 *   release tag lands.
 * - some public workspace package's version is not on the registry yet. A marker with no
 *   version bump therefore publishes nothing, and says so (a `::notice::`).
 *
 * Usage (CI):  node scripts/release-gate.mjs   -> writes publish=, force= to $GITHUB_OUTPUT
 * API:         decideRelease, subjectsSinceLastRelease, isPublished, publicPackages
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

/**
 * The pure decision.
 *
 * @param {object} input
 * @param {string[]} input.subjects   Commit subjects since the last release.
 * @param {{name: string, version: string, published: boolean}[]} input.packages
 * @returns {{publish: boolean, force: boolean, reason: string}}
 */
export function decideRelease({ subjects, packages }) {
  const force = subjects.some((s) => s.includes('[force publish]'));
  const armed = force || subjects.some((s) => s.includes('[publish]'));
  const pending = packages.filter((p) => !p.published).map((p) => `${p.name}@${p.version}`);
  if (!armed) return { publish: false, force: false, reason: 'no [publish] subject since the last release' };
  if (pending.length === 0) {
    const all = packages.map((p) => `${p.name}@${p.version}`).join(', ') || 'no public package';
    return { publish: false, force: false, reason: `[publish] found, but nothing to publish: ${all} already on the registry (bump a version)` };
  }
  return { publish: true, force, reason: `publishing ${pending.join(', ')}` };
}

/** Subjects of the commits after the most recent `v*` tag reachable from HEAD (all commits if none). */
export function subjectsSinceLastRelease(cwd = ROOT) {
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let lastTag = '';
  try {
    lastTag = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD');
  } catch {
    lastTag = ''; // no release yet
  }
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
  const out = git('log', '--format=%s', range);
  return out ? out.split('\n') : [];
}

/** Non-private packages under `packages/`. */
export function publicPackages(root = ROOT) {
  const dir = join(root, 'packages');
  return readdirSync(dir)
    .map((d) => join(dir, d, 'package.json'))
    .filter(existsSync)
    .map((p) => JSON.parse(readFileSync(p, 'utf8')))
    .filter((p) => !p.private)
    .map(({ name, version }) => ({ name, version }));
}

/**
 * Is `name@version` on the registry? 404 means no; any other non-2xx throws, so a
 * registry outage never reads as "unpublished".
 */
export async function isPublished(name, version, { registry = DEFAULT_REGISTRY, fetchImpl = fetch } = {}) {
  const encoded = name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
  const res = await fetchImpl(`${registry}/${encoded}/${encodeURIComponent(version)}`);
  if (res.status === 404) return false;
  if (res.ok) return true;
  throw new Error(`Registry answered ${res.status} for ${name}@${version}`);
}

async function main() {
  const subjects = subjectsSinceLastRelease();
  const packages = await Promise.all(
    publicPackages().map(async (p) => ({ ...p, published: await isPublished(p.name, p.version) })),
  );
  const { publish, force, reason } = decideRelease({ subjects, packages });
  console.log(`subjects since the last release: ${subjects.length}`);
  if (subjects.some((s) => s.includes('[publish]') || s.includes('[force publish]')) && !publish) {
    console.log(`::notice title=Release gate::${reason}`);
  } else {
    console.log(reason);
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\nforce=${force}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
