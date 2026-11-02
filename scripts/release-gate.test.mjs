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
    expect(d).toEqual({ publish: true, force: false, reason: 'publishing polytag@0.1.0' });
  });

  it('a marker with no unpublished version publishes nothing, and says why', () => {
    const d = decideRelease({ subjects: ['chore: release [publish]'], packages: published });
    expect(d.publish).toBe(false);
    expect(d.reason).toMatch(/nothing to publish: polytag@0\.1\.0 already on the registry/);
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
    ['[publish] feat: x', true],
    ['chore: release\t[publish]', true],
    ['feat: x[publish]', false],
    ['docs: [publish]ing', false],
    ['docs: the [publishing] flow', false],
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
  const manifest = (fields) => {
    mkdirSync(join(repo, 'packages', 'p'), { recursive: true });
    writeFileSync(join(repo, 'packages', 'p', 'package.json'), `${JSON.stringify({ name: 'p', ...fields }, null, 2)}\n`);
    git('add', '-A');
  };
  const commit = (...messages) => git('commit', '-q', '--allow-empty', ...messages.flatMap((m) => ['-m', m]));
  const window = () => releaseWindowSubjects(repo);
  git('init', '-q', '-b', 'main');
  commit('first');

  it('is empty while no commit has set a public version', () => {
    expect(window()).toEqual([]);
  });

  it('starts at the commit that sets the version, inclusive', () => {
    manifest({ version: '0.1.0' });
    commit('feat: scaffold [publish]');
    commit('docs: later');
    expect(window()).toEqual(['docs: later', 'feat: scaffold [publish]']);
  });

  it('a marker before the last bump does not arm it (#15 item 1)', () => {
    commit('docs: explain how the [publish] marker works');
    manifest({ version: '0.2.0' });
    commit('chore: bump to 0.2.0');
    expect(window()).toEqual(['chore: bump to 0.2.0']);
    expect(decideRelease({ subjects: window(), packages: [{ name: 'p', version: '0.2.0', published: false }] }).publish).toBe(false);
  });

  it('a marker after the bump arms it, and stays armed across later pushes', () => {
    commit('chore: release [publish]');
    commit('fix: y');
    expect(decideRelease({ subjects: window(), packages: [{ name: 'p', version: '0.2.0', published: false }] }).publish).toBe(true);
  });

  it('a manifest change that leaves the version alone does not move the window', () => {
    manifest({ version: '0.2.0', description: 'changed' });
    commit('docs: describe p');
    expect(window().at(-1)).toBe('chore: bump to 0.2.0');
  });

  it('never reads commit bodies', () => {
    manifest({ version: '0.3.0', description: 'changed' });
    commit('chore: bump to 0.3.0', 'mentions [publish] in the body');
    expect(window()).toEqual(['chore: bump to 0.3.0']);
  });

  it("never reads a merged branch's own subjects (--first-parent)", () => {
    git('switch', '-q', '-c', 'side');
    commit('wip [publish]');
    git('switch', '-q', 'main');
    git('merge', '-q', '--no-ff', 'side', '-m', 'Merge branch side');
    expect(window()).toEqual(['Merge branch side', 'chore: bump to 0.3.0']);
  });

  it('a version bump made on a merged branch still starts the window at the merge', () => {
    git('switch', '-q', '-c', 'bump');
    manifest({ version: '0.4.0', description: 'changed' });
    commit('chore: bump to 0.4.0 [publish]');
    git('switch', '-q', 'main');
    git('merge', '-q', '--no-ff', 'bump', '-m', 'Merge branch bump');
    expect(window()).toEqual(['Merge branch bump']);
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
