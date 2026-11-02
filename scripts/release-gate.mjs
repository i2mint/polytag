#!/usr/bin/env node
/**
 * Release gate: should this push to main publish to npm?
 *
 * Publish when BOTH hold:
 * - a commit SUBJECT in the release window carries the marker `[publish]` (or
 *   `[force publish]`) as a whole token. The window is the first-parent history from the
 *   last commit that changed a public package's `version` (inclusive) to HEAD. So:
 *   - a marker before the bump never arms it: a marker that published nothing, or a subject
 *     that merely mentions it (`docs: how the [publish] marker works`), cannot make a later
 *     bump publish without its own marker;
 *   - a marker at or after the bump keeps the release armed across later pushes, so a
 *     multi-commit push, or a run cancelled before it published, does not lose it;
 *   - subjects of commits on a merged branch are not read (`--first-parent`), and bodies
 *     never are.
 * - some public workspace package's version is not on the registry yet. A marker with no
 *   unpublished version therefore publishes nothing, and says so (a `::notice::`). The
 *   registry, not a git tag, says what was released: a tag pushed for a failed publish, or a
 *   publish whose tag push failed, cannot mislead the gate.
 *
 * Two bumps pushed while an earlier publish awaits approval publish only the newer version:
 * the publish job's concurrency group keeps one pending run and cancels the older one, so
 * the intermediate version is never released (bump again, or publish it by hand, to keep it).
 *
 * Usage (CI):  node scripts/release-gate.mjs   -> writes publish=, force= to $GITHUB_OUTPUT
 * API:         decideRelease, hasMarker, releaseWindowSubjects, isPublished, publicPackages
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
export const PUBLISH_MARKER = '[publish]';
export const FORCE_MARKER = '[force publish]';

/** Does `subject` carry `marker` as a whole whitespace-delimited token (not `x[publish]`, not `[publish]ed`)? */
export function hasMarker(subject, marker = PUBLISH_MARKER) {
  return ` ${subject} `.replace(/\s/g, ' ').includes(` ${marker} `);
}

/**
 * The pure decision.
 *
 * @param {object} input
 * @param {string[]} input.subjects   Commit subjects in the release window.
 * @param {{name: string, version: string, published: boolean}[]} input.packages
 * @returns {{publish: boolean, force: boolean, reason: string}}
 */
export function decideRelease({ subjects, packages }) {
  const force = subjects.some((s) => hasMarker(s, FORCE_MARKER));
  const armed = force || subjects.some((s) => hasMarker(s, PUBLISH_MARKER));
  const pending = packages.filter((p) => !p.published).map((p) => `${p.name}@${p.version}`);
  if (!armed) return { publish: false, force: false, reason: 'no [publish] subject since the last version change' };
  if (pending.length === 0) {
    const all = packages.map((p) => `${p.name}@${p.version}`).join(', ') || 'no public package';
    return { publish: false, force: false, reason: `[publish] found, but nothing to publish: ${all} already on the registry (bump a version)` };
  }
  return { publish: true, force, reason: `publishing ${pending.join(', ')}` };
}

/**
 * Subjects of the first-parent commits from the last one that changed the `version` of one
 * of `manifests` (inclusive) to HEAD, newest first. Empty when no commit ever set one.
 * "Changed" compares the parsed value with the first parent's, so a manifest edit that
 * leaves the version alone (even one that rewrites its line) does not move the window.
 *
 * @param {string} [cwd]
 * @param {{manifests?: string[]}} [options]  Manifest paths relative to `cwd`; default: the public packages'.
 */
export function releaseWindowSubjects(cwd = ROOT, { manifests = publicPackages(cwd).map((p) => p.manifest) } = {}) {
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const versionAt = (rev, manifest) => {
    try {
      return JSON.parse(git('show', `${rev}:${manifest}`)).version;
    } catch {
      return undefined; // no such commit (the root's parent) or no such file there
    }
  };
  if (manifests.length === 0) return [];
  const touching = git('log', '--first-parent', '--format=%H', 'HEAD', '--', ...manifests).split('\n').filter(Boolean);
  const bump = touching.find((sha) => manifests.some((m) => versionAt(sha, m) !== versionAt(`${sha}^1`, m)));
  if (!bump) return [];
  const after = git('log', '--first-parent', '--format=%s', `${bump}..HEAD`);
  return [...(after ? after.split('\n') : []), git('log', '-1', '--format=%s', bump)];
}

/** Non-private packages under `packages/`, with their manifest path relative to `root`. */
export function publicPackages(root = ROOT) {
  const dir = join(root, 'packages');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((d) => join(dir, d, 'package.json'))
    .filter(existsSync)
    .map((p) => ({ manifest: relative(root, p), ...JSON.parse(readFileSync(p, 'utf8')) }))
    .filter((p) => !p.private)
    .map(({ name, version, manifest }) => ({ name, version, manifest }));
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
  const subjects = releaseWindowSubjects();
  const packages = await Promise.all(
    publicPackages().map(async (p) => ({ ...p, published: await isPublished(p.name, p.version) })),
  );
  const { publish, force, reason } = decideRelease({ subjects, packages });
  console.log(`subjects since the last version change: ${subjects.length}`);
  const marked = subjects.some((s) => hasMarker(s, PUBLISH_MARKER) || hasMarker(s, FORCE_MARKER));
  console.log(marked && !publish ? `::notice title=Release gate::${reason}` : reason);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\nforce=${force}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
