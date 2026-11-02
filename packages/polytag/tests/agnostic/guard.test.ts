/**
 * Self-check: this worker runs under the runtime boundary guard, so the guarded run cannot
 * pass vacuously (a config that lost its `--import` would fail here).
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const name = ['@zodal', 'groups-core'].join('/');

describe('runtime boundary guard is active in this worker', () => {
  it('refuses require()', () => {
    expect(() => createRequire(import.meta.url)(name)).toThrow(/boundary guard/);
  });

  it('refuses import()', async () => {
    await expect(import(/* @vite-ignore */ name)).rejects.toThrow(/boundary guard/);
  });

  it('still loads what tag-agnostic code may use', async () => {
    expect(typeof (await import('yaml')).parse).toBe('function');
  });
});
