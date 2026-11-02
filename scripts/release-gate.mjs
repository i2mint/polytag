#!/usr/bin/env node
/**
 * Release gate: should this push to main publish to npm?
 *
 * Publish when BOTH hold:
 * - a commit SUBJECT in the release window ends with the marker `[publish]` (or
 *   `[force publish]`), optionally followed by the squash-merge suffix ` (#N)`. A subject
 *   that merely mentions the marker elsewhere (`docs: how the [publish] marker works`)
 *   never arms a release. The window is the first-parent history back to whichever comes
 *   first:
 *   - the last release tag (`v<version>`) whose version is on the registry, exclusive: a
 *     marker is spent once its release is out;
 *   - the last commit that changed a public package's public identity (its `version`, or
 *     its `private` flag), inclusive: a marker before that change never arms it, so neither
 *     a later bump nor a package going public publishes without a marker of its own.
 *   Inside the window a marker stays armed across later pushes, so a multi-commit push, or a
 *   run cancelled before it published, does not lose the release. Subjects of commits on a
 *   merged branch are never read (`--first-parent`), nor are bodies. A shallow clone only
 *   shrinks the window, so it errs towards not publishing.
 * - some public workspace package's version is not on the registry yet. A marker with no
 *   unpublished version publishes nothing, and the run says so (a `::notice::`); so does an
 *   unpublished version with no marker in the window.
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

/**
 * Does `subject` end with `marker` as its own token, optionally followed by a squash-merge
 * suffix (`feat: x [publish] (#12)`)? `x[publish]`, `[publish]ed` and a marker mid-subject do not count.
 */
export function hasMarker(subject, marker = PUBLISH_MARKER) {
  const escaped = marker.replace(/[[\]]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(\\s+\\(#\\d+\\))?\\s*$`).test(subject);
}

/**
 * The pure decision.
 *
 * @param {object} input
 * @param {string[]} input.subjects   Commit subjects in the release window.
 * @param {{name: string, version: string, published: boolean}[]} input.packages
 * @returns {{publish: boolean, force: boolean, armed: boolean, pending: string[], reason: string}}
 */
export function decideRelease({ subjects, packages }) {
  const force = subjects.some((s) => hasMarker(s, FORCE_MARKER));
  const armed = force || subjects.some((s) => hasMarker(s, PUBLISH_MARKER));
  const pending = packages.filter((p) => !p.published).map((p) => `${p.name}@${p.version}`);
  const decision = (publish, reason) => ({ publish, force: publish && force, armed, pending, reason });
  if (!armed) {
    return decision(
      false,
      pending.length
        ? `${pending.join(', ')} not on the registry, but no subject since the last release or version change ends with [publish]`
        : 'no [publish] subject since the last release or version change',
    );
  }
  if (pending.length === 0) {
    const all = packages.map((p) => `${p.name}@${p.version}`).join(', ') || 'no public package';
    return decision(false, `[publish] found, but nothing to publish: ${all} already on the registry (bump a version)`);
  }
  return decision(true, `publishing ${pending.join(', ')}`);
}

/**
 * Subjects in the release window (see the module doc), newest first.
 *
 * @param {string} [cwd]
 * @param {object} [options]
 * @param {string[]} [options.manifests]  Manifest paths relative to `cwd`; default: every package's under `packages/`.
 * @param {(tag: string) => Promise<boolean>} [options.isReleased]  Is this `v*` tag's version on the registry?
 *   Default: yes (the publish job pushes a tag only after the registry serves its version).
 */
export async function releaseWindowSubjects(
  cwd = ROOT,
  { manifests = packageManifests(cwd), isReleased = async () => true } = {},
) {
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const lines = (out) => (out ? out.split('\n') : []);
  /** What a release depends on: the version, and only while the package is public. */
  const publicVersion = (rev, manifest) => {
    try {
      const pkg = JSON.parse(git('show', `${rev}:${manifest}`));
      return pkg.private ? undefined : pkg.version;
    } catch {
      return undefined; // no such commit (the root's parent), no such file, or not JSON there
    }
  };
  const touching = new Set(manifests.length ? lines(git('log', '--first-parent', '--format=%H', 'HEAD', '--', ...manifests)) : []);
  const isChange = (sha) =>
    touching.has(sha) && manifests.some((m) => publicVersion(sha, m) !== publicVersion(`${sha}^1`, m));
  const tagsAt = new Map();
  // `%(*objectname)` is the commit an annotated tag points at; empty for a lightweight tag.
  for (const line of lines(git('for-each-ref', '--merged', 'HEAD', '--format=%(refname:short) %(objectname) %(*objectname)', 'refs/tags/v[0-9]*'))) {
    const [tag, sha, peeled] = line.split(' ');
    const commit = peeled || sha;
    tagsAt.set(commit, [...(tagsAt.get(commit) ?? []), tag]);
  }
  const subjects = [];
  for (const line of lines(git('log', '--first-parent', '--format=%H %s', 'HEAD'))) {
    const sha = line.slice(0, line.indexOf(' '));
    for (const tag of tagsAt.get(sha) ?? []) if (await isReleased(tag)) return subjects;
    subjects.push(line.slice(sha.length + 1));
    if (isChange(sha)) return subjects;
  }
  return subjects;
}

/** Manifest paths (relative to `root`) of every package under `packages/`, private ones included. */
export function packageManifests(root = ROOT) {
  const dir = join(root, 'packages');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((d) => join(dir, d, 'package.json'))
    .filter(existsSync)
    .map((p) => relative(root, p));
}

/** Non-private packages under `packages/`, with their manifest path relative to `root`. */
export function publicPackages(root = ROOT) {
  return packageManifests(root)
    .map((manifest) => ({ manifest, ...JSON.parse(readFileSync(join(root, manifest), 'utf8')) }))
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
  const publics = publicPackages();
  const isReleased = async (tag) =>
    (await Promise.all(publics.map((p) => isPublished(p.name, tag.slice(1))))).some(Boolean);
  const subjects = await releaseWindowSubjects(ROOT, { isReleased });
  const packages = await Promise.all(publics.map(async (p) => ({ ...p, published: await isPublished(p.name, p.version) })));
  const { publish, force, pending, reason } = decideRelease({ subjects, packages });
  console.log(`subjects in the release window: ${subjects.length}`);
  // Speak up only when this push asked for a release that will not happen, or a version waits for one.
  const headSubject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const headAsked = hasMarker(headSubject, PUBLISH_MARKER) || hasMarker(headSubject, FORCE_MARKER);
  const notice = !publish && (headAsked || pending.length > 0);
  console.log(notice ? `::notice title=Release gate::${reason}` : reason);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\nforce=${force}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
