/**
 * Self-check: this worker runs under the runtime boundary guard, so the guarded run cannot
 * pass vacuously (a config that lost its `--import` would fail here).
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const name = ['@zodal', 'groups-core'].join('/');

describe('runtime boundary guard is active in this worker', () => {
  it('refuses require()', () => {
    expect(() => createRequire(import.meta.url)(name)).toThrow(/boundary guard/);
  });

  it('refuses import()', async () => {
    await expect(import(/* @vite-ignore */ name)).rejects.toThrow(/boundary guard/);
  });

  it('refuses import() of a groups file by path, which vitest runs itself (the vite plugin)', async () => {
    const byPath = fileURLToPath(
      new URL('../../../../scripts/fixtures/runtime-guard/modules/@zodal/groups-core/index.cjs', import.meta.url),
    );
    expect(createRequire(import.meta.url).resolve(byPath)).toBe(byPath); // it exists: refused, not missing
    await expect(import(/* @vite-ignore */ byPath)).rejects.toThrow(/boundary guard/);
  });

  it('still loads what tag-agnostic code may use', async () => {
    expect(typeof (await import('yaml')).parse).toBe('function');
  });
});
