import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { decideRelease, isPublished, publicPackages, subjectsSinceLastRelease } from './release-gate.mjs';

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

describe('subjectsSinceLastRelease', () => {
  const repo = mkdtempSync(join(tmpdir(), 'polytag-gate-'));
  afterAll(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd: repo });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'first');

  it('reads the whole history before any release tag', () => {
    expect(subjectsSinceLastRelease(repo)).toEqual(['first']);
  });

  it('reads only the commits after the last v* tag (a cancelled release stays armed)', () => {
    git('tag', '-a', 'v0.0.1', '-m', 'release');
    git('commit', '-q', '--allow-empty', '-m', 'feat: x [publish]', '-m', 'body');
    git('commit', '-q', '--allow-empty', '-m', 'docs: y');
    expect(subjectsSinceLastRelease(repo)).toEqual(['docs: y', 'feat: x [publish]']);
  });

  it('never reads commit bodies', () => {
    git('commit', '-q', '--allow-empty', '-m', 'docs: z', '-m', 'mentions [publish] in the body');
    expect(subjectsSinceLastRelease(repo)).not.toContain('mentions [publish] in the body');
    expect(decideRelease({ subjects: ['docs: z'], packages: unpublished }).publish).toBe(false);
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
  it('lists the non-private packages of this repo', () => {
    expect(publicPackages().map((p) => p.name)).toEqual(['polytag']);
  });
});
