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
 * Usage (CI):  node scripts/release-gate.mjs           -> writes publish=, force= to $GITHUB_OUTPUT
 *              node scripts/release-gate.mjs --list    -> name@version of each public package, one per line
 *              node scripts/release-gate.mjs --tag     -> the release tag v<version> (versions must agree)
 *              node scripts/release-gate.mjs --verify  -> waits until the registry serves every public version
 * "Public package" means a non-private package of the pnpm workspace, as `pnpm ls -r` lists it:
 * exactly what `pnpm -r publish` publishes.
 * API:         decideRelease, hasMarker, releaseWindowSubjects, isPublished, publicPackages, publicSpecs,
 *              releaseTag, verifyPublished, workspaceDirs, pnpmWorkspaceDirs
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
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
 * @param {string} [input.headSubject]  This push's own subject: a notice is due when it asked for a release that will not happen.
 * @returns {{publish: boolean, force: boolean, armed: boolean, pending: string[], notice: boolean, reason: string}}
 *   `notice`: say `reason` as a CI notice, because this push asked for a release that will
 *   not happen, or a version waits for a marker. Silent otherwise (every push after a release).
 */
export function decideRelease({ subjects, packages, headSubject = '' }) {
  const force = subjects.some((s) => hasMarker(s, FORCE_MARKER));
  const armed = force || subjects.some((s) => hasMarker(s, PUBLISH_MARKER));
  const pending = packages.filter((p) => !p.published).map((p) => `${p.name}@${p.version}`);
  const headAsked = hasMarker(headSubject, PUBLISH_MARKER) || hasMarker(headSubject, FORCE_MARKER);
  const decision = (publish, reason) => ({
    publish,
    force: publish && force,
    armed,
    pending,
    notice: !publish && (headAsked || pending.length > 0),
    reason,
  });
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
 * @param {string[]} [options.manifests]  Manifest paths relative to `cwd`; default: every workspace package's.
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
  for (const line of lines(git('for-each-ref', '--merged', 'HEAD', '--format=%(refname:lstrip=2) %(objectname) %(*objectname)', 'refs/tags/v[0-9]*'))) {
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

/**
 * The workspace's package directories, relative to `root` (the root itself excluded: pnpm
 * does not publish it without `include-workspace-root`), exactly as pnpm sees them, so
 * there is no second reading of `pnpm-workspace.yaml` to drift from `pnpm -r publish`.
 *
 * @param {string} [root]
 * @param {{listWorkspace?: (root: string) => string[]}} [options]  Absolute package dirs, root included.
 *   Default: `pnpm ls -r --depth -1 --json` (no install needed).
 */
export function workspaceDirs(root = ROOT, { listWorkspace = pnpmWorkspaceDirs } = {}) {
  const dirs = listWorkspace(root);
  const rootReal = realpathSync(root);
  return dirs
    .map((dir) => realpathSync(dir))
    .filter((dir) => dir !== rootReal)
    .map((dir) => relative(rootReal, dir));
}

/** Absolute directories of every workspace package, root included, from pnpm itself. */
export function pnpmWorkspaceDirs(root = ROOT) {
  let out;
  try {
    out = execFileSync('pnpm', ['ls', '-r', '--depth', '-1', '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    throw new Error(`cannot list the pnpm workspace (is pnpm on PATH?): ${err.message.split('\n')[0]}`);
  }
  if (!out.trim()) throw new Error(`cannot list the pnpm workspace: pnpm lists nothing at ${root} (no package.json / pnpm-workspace.yaml?)`);
  return JSON.parse(out).map((p) => p.path);
}

/** Manifest paths (relative to `root`) of every workspace package, private ones included. */
export function packageManifests(root = ROOT, options = {}) {
  return workspaceDirs(root, options)
    .map((d) => join(d, 'package.json'))
    .filter((m) => existsSync(join(root, m)));
}

/** Non-private workspace packages, with their manifest path relative to `root`. */
export function publicPackages(root = ROOT, options = {}) {
  return packageManifests(root, options)
    .map((manifest) => ({ manifest, ...JSON.parse(readFileSync(join(root, manifest), 'utf8')) }))
    .filter((p) => !p.private)
    .map(({ name, version, manifest }) => ({ name, version, manifest }));
}

/** `name@version` of each public package: what a publish releases, and what the registry must then serve. */
export function publicSpecs(root = ROOT, options = {}) {
  return publicPackages(root, options).map(({ name, version }) => `${name}@${version}`);
}

/** The release tag, `v<version>`: the public packages must agree on one version. */
export function releaseTag(packages) {
  const versions = [...new Set(packages.map((p) => p.version))];
  if (versions.length !== 1) {
    throw new Error(`cannot derive one release tag: public package versions are ${versions.join(', ') || '(no public package)'}`);
  }
  return `v${versions[0]}`;
}

/**
 * Wait until the registry serves every package's version; throw if one never appears. A 404
 * means "not visible yet" (a new name can lag for minutes); a registry error is retried too,
 * and named in the failure, so an outage never reads as a failed publish without saying so.
 *
 * @param {{name: string, version: string}[]} packages
 * @param {object} [options]
 * @param {number} [options.attempts]
 * @param {number} [options.intervalMs]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {typeof isPublished} [options.isPublishedImpl]
 * @param {(line: string) => void} [options.log]
 */
export async function verifyPublished(
  packages,
  {
    attempts = 20,
    intervalMs = 15_000,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    isPublishedImpl = isPublished,
    log = console.log,
  } = {},
) {
  if (packages.length === 0) throw new Error('no public package to verify');
  for (const { name, version } of packages) {
    const spec = `${name}@${version}`;
    let last = 'not visible yet';
    let confirmed = false;
    for (let attempt = 1; attempt <= attempts && !confirmed; attempt++) {
      try {
        confirmed = await isPublishedImpl(name, version);
        last = 'not visible yet';
      } catch (err) {
        last = `registry error: ${err.message}`;
      }
      log(confirmed ? `${spec} confirmed on the registry (attempt ${attempt})` : `${spec} ${last} (attempt ${attempt}/${attempts})`);
      if (!confirmed && attempt < attempts) await sleep(intervalMs);
    }
    if (!confirmed) throw new Error(`${spec} never appeared on the registry (${last}): the publish failed`);
  }
}

/**
 * Is `name@version` on the registry? 404 means no; any other non-2xx throws, so a
 * registry outage never reads as "unpublished".
 */
export async function isPublished(
  name,
  version,
  { registry = DEFAULT_REGISTRY, fetchImpl = fetch, timeoutMs = 30_000 } = {},
) {
  const encoded = name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
  // A hung connection is an error (retried by verifyPublished), not a five-minute wait.
  const res = await fetchImpl(`${registry}/${encoded}/${encodeURIComponent(version)}`, { signal: AbortSignal.timeout(timeoutMs) });
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
  const headSubject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const { publish, force, notice, reason } = decideRelease({ subjects, packages, headSubject });
  // The publish job tags v<version>: refuse here, before anything is published, if there is no one version.
  if (publish) releaseTag(publics);
  console.log(`subjects in the release window: ${subjects.length}`);
  console.log(notice ? `::notice title=Release gate::${reason}` : reason);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\nforce=${force}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [mode] = process.argv.slice(2);
  try {
    if (mode === '--list') console.log(publicSpecs().join('\n'));
    else if (mode === '--tag') console.log(releaseTag(publicPackages()));
    else if (mode === '--verify') await verifyPublished(publicPackages());
    else if (mode === undefined) await main();
    else throw new Error(`unknown option ${mode} (expected --list, --tag or --verify)`);
  } catch (err) {
    console.error(`::error title=Release gate::${err.message}`); // stderr: `TAG=$(... --tag)` must not swallow it
    process.exit(1);
  }
}
