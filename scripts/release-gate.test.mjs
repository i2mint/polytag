import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { decideRelease, hasMarker, isPublished, publicPackages, releaseWindowSubjects } from './release-gate.mjs';

const unpublished = [{ name: 'polytag', version: '0.1.0', published: false }];
const published = [{ name: 'polytag', version: '0.1.0', published: true }];

describe('decideRelease', () => {
  it('does nothing without a marker', () => {
    expect(decideRelease({ subjects: ['feat: x', 'fix: y'], packages: unpublished }).publish).toBe(false);
  });

  it('publishes when the marker is in ANY subject of the range, not only the head', () => {
    const d = decideRelease({ subjects: ['docs: later commit', 'feat: x [publish]'], packages: unpublished });
    expect(d).toMatchObject({ publish: true, force: false, reason: 'publishing polytag@0.1.0' });
  });

  it('a marker with no unpublished version publishes nothing, and says why', () => {
    const d = decideRelease({ subjects: ['chore: release [publish]'], packages: published });
    expect(d.publish).toBe(false);
    expect(d.reason).toMatch(/nothing to publish: polytag@0\.1\.0 already on the registry/);
  });

  it('reports what is pending even when nothing arms it', () => {
    const d = decideRelease({ subjects: ['feat: x'], packages: unpublished });
    expect(d).toMatchObject({ publish: false, armed: false, pending: ['polytag@0.1.0'] });
    expect(d.reason).toMatch(/polytag@0\.1\.0 not on the registry, but no subject/);
  });

  it('[force publish] arms a release and sets force', () => {
    expect(decideRelease({ subjects: ['x [force publish]'], packages: unpublished })).toMatchObject({
      publish: true,
      force: true,
    });
  });
});

describe('hasMarker', () => {
  it.each([
    ['feat: x [publish]', true],
    ['feat: x [publish] (#12)', true],
    ['chore: release\t[publish]', true],
    ['[publish]', true],
    ['[publish] feat: x', false],
    ['docs: explain the [publish] marker', false],
    ['feat: x[publish]', false],
    ['docs: [publish]ing', false],
    ['feat: x [publish] (draft)', false],
    ['feat: x', false],
  ])('%j -> %s', (subject, expected) => {
    expect(hasMarker(subject)).toBe(expected);
  });

  it('[force publish] is its own token, and does not contain [publish]', () => {
    expect(hasMarker('x [force publish]', '[force publish]')).toBe(true);
    expect(hasMarker('x [force publish]')).toBe(false);
  });
});

describe('releaseWindowSubjects', () => {
  const repo = mkdtempSync(join(tmpdir(), 'polytag-gate-'));
  afterAll(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
      cwd: repo,
      encoding: 'utf8',
    });
  const manifest = (dir, fields) => {
    mkdirSync(join(repo, 'packages', dir), { recursive: true });
    writeFileSync(join(repo, 'packages', dir, 'package.json'), `${JSON.stringify({ name: dir, ...fields }, null, 2)}\n`);
    git('add', '-A');
  };
  const commit = (...messages) => git('commit', '-q', '--allow-empty', ...messages.flatMap((m) => ['-m', m]));
  const window = (options) => releaseWindowSubjects(repo, options);
  const decide = async (version, options) =>
    decideRelease({ subjects: await window(options), packages: [{ name: 'p', version, published: false }] });
  git('init', '-q', '-b', 'main');
  commit('first');

  it('reads the whole first-parent history while nothing bounds it', async () => {
    expect(await window()).toEqual(['first']);
  });

  it('starts at the commit that sets the version, inclusive', async () => {
    manifest('p', { version: '0.1.0' });
    commit('feat: scaffold [publish]');
    commit('docs: later');
    expect(await window()).toEqual(['docs: later', 'feat: scaffold [publish]']);
  });

  it('a marker before the last bump does not arm it (#15 item 1)', async () => {
    commit('chore: release [publish]');
    manifest('p', { version: '0.2.0' });
    commit('chore: bump to 0.2.0');
    expect(await window()).toEqual(['chore: bump to 0.2.0']);
    expect((await decide('0.2.0')).publish).toBe(false);
  });

  it('a subject that only mentions the marker does not arm a pending bump', async () => {
    commit('docs: explain the [publish] marker in CONTRIBUTING');
    expect((await decide('0.2.0')).publish).toBe(false);
  });

  it('a marker after the bump arms it, and stays armed across later pushes', async () => {
    commit('chore: release 0.2.0 [publish] (#7)');
    commit('fix: y');
    expect(await decide('0.2.0')).toMatchObject({ publish: true, armed: true });
  });

  it('a released tag spends the marker: the window starts after it', async () => {
    git('tag', '-a', 'v0.2.0', '-m', 'Release v0.2.0');
    commit('docs: after the release');
    expect(await window()).toEqual(['docs: after the release']);
  });

  it('a tag whose version is not on the registry does not bound the window', async () => {
    const isReleased = async (tag) => tag !== 'v0.2.0';
    expect((await window({ isReleased })).slice(0, 3)).toEqual(['docs: after the release', 'fix: y', 'chore: release 0.2.0 [publish] (#7)']);
  });

  it('a manifest edit that leaves the version alone (even rewriting its line) does not move the window', async () => {
    commit('chore: x [publish]');
    manifest('p', { version: '0.2.0', description: 'changed' }); // the version line gains a comma
    commit('docs: describe p');
    expect(await window()).toEqual(['docs: describe p', 'chore: x [publish]', 'docs: after the release']);
  });

  it('a package going public moves the window: an old marker cannot publish it (review finding 1)', async () => {
    manifest('b', { version: '0.1.0', private: true });
    commit('chore: add private b');
    commit('chore: a [publish]');
    manifest('b', { version: '0.1.0' });
    commit('chore: make b public (not releasing yet)');
    expect(await window()).toEqual(['chore: make b public (not releasing yet)']);
  });

  it('never reads commit bodies', async () => {
    manifest('p', { version: '0.3.0', description: 'changed' });
    commit('chore: bump to 0.3.0', 'mentions [publish] in the body');
    expect(await window()).toEqual(['chore: bump to 0.3.0']);
  });

  it("never reads a merged branch's own subjects (--first-parent)", async () => {
    git('switch', '-q', '-c', 'side');
    commit('wip [publish]');
    git('switch', '-q', 'main');
    git('merge', '-q', '--no-ff', 'side', '-m', 'Merge branch side');
    expect(await window()).toEqual(['Merge branch side', 'chore: bump to 0.3.0']);
  });

  it('a bump merged with a merge commit starts the window at the merge, and does not publish without a marker there', async () => {
    git('switch', '-q', '-c', 'bump');
    manifest('p', { version: '0.4.0', description: 'changed' });
    commit('chore: bump to 0.4.0 [publish]');
    git('switch', '-q', 'main');
    git('merge', '-q', '--no-ff', 'bump', '-m', 'Merge pull request #9 from x/bump');
    expect(await window()).toEqual(['Merge pull request #9 from x/bump']);
    expect(await decide('0.4.0')).toMatchObject({ publish: false, armed: false, pending: ['p@0.4.0'] });
  });
});

describe('isPublished', () => {
  const fakeFetch = (status) => async (url) => ({ status, ok: status >= 200 && status < 300, url });

  it('maps 200 to true and 404 to false', async () => {
    expect(await isPublished('polytag', '0.0.0', { fetchImpl: fakeFetch(200) })).toBe(true);
    expect(await isPublished('polytag', '0.0.0', { fetchImpl: fakeFetch(404) })).toBe(false);
  });

  it('throws on any other status, so an outage never reads as unpublished', async () => {
    await expect(isPublished('polytag', '0.0.0', { fetchImpl: fakeFetch(503) })).rejects.toThrow(/503/);
  });

  it('encodes scoped names as the registry expects', async () => {
    let seen = '';
    await isPublished('@zodal/core', '0.2.0', {
      fetchImpl: async (url) => ((seen = url), { status: 200, ok: true }),
    });
    expect(seen).toBe('https://registry.npmjs.org/@zodal%2Fcore/0.2.0');
  });
});

describe('publicPackages', () => {
  it('lists the non-private packages of this repo, with their manifests', () => {
    expect(publicPackages().map(({ name, manifest }) => ({ name, manifest }))).toEqual([
      { name: 'polytag', manifest: join('packages', 'polytag', 'package.json') },
    ]);
  });
});
