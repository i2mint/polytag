import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BoundaryViolation, installBoundaryGuard, viteBoundaryGuard } from './boundary-guard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, 'fixtures', 'runtime-guard');
const register = join(here, 'boundary-guard.register.mjs');

const run = (way, { guarded }) =>
  spawnSync(process.execPath, [...(guarded ? ['--import', register] : []), join(fixture, 'smuggle.mjs'), way], {
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: join(fixture, 'modules') },
  });

describe('boundary guard, end to end (a child process per way of loading)', () => {
  const ways = ['moduleLoad', 'createRequire', 'builtin', 'byPath', 'functionCtor'];

  it.each(ways)('the fixture really loads groups-core by %s without the guard (control)', (way) => {
    const r = run(way, { guarded: false });
    expect(r.stdout.trim()).toBe('LOADED');
  });

  it.each(ways)('fails a smuggled load by %s under the guard', (way) => {
    const r = run(way, { guarded: true });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('LOADED');
    expect(r.stderr).toMatch(/boundary guard: .*groups-core.* is forbidden in tag-agnostic code/);
  });
});

describe('installBoundaryGuard (hooks driven directly)', () => {
  const capture = () => {
    let hooks;
    installBoundaryGuard({ registerHooks: (h) => ((hooks = h), { deregister() {} }) });
    return hooks;
  };
  const next = (url) => () => ({ url });

  it('refuses a forbidden specifier before resolving it', () => {
    const { resolve } = capture();
    expect(() => resolve('@zodal/groups-core', { parentURL: 'file:///a.js' }, next('x'))).toThrow(BoundaryViolation);
  });

  it('refuses an innocent specifier that resolves into a forbidden path (pnpm store, local checkout)', () => {
    const { resolve } = capture();
    const ctx = { parentURL: 'file:///a.js' };
    expect(() => resolve('./alias', ctx, next('file:///r/node_modules/.pnpm/@zodal+groups-core@0.1.0/x.js'))).toThrow(BoundaryViolation);
    expect(() => resolve('../x', ctx, next('file:///p/zodal-groups/packages/core/index.js'))).toThrow(BoundaryViolation);
  });

  it('refuses loading a forbidden file by URL (a path resolved outside the resolve hook)', () => {
    const { load } = capture();
    expect(() => load('file:///r/node_modules/%40zodal/groups-core/index.cjs', {}, next('x'))).toThrow(/groups-core/);
  });

  it('passes everything else through untouched', () => {
    const { resolve, load } = capture();
    const resolved = { url: 'file:///r/node_modules/@zodal/core/index.js' };
    expect(resolve('@zodal/core', {}, () => resolved)).toBe(resolved);
    expect(load('file:///r/x.js', {}, () => 'source')).toBe('source');
  });

  it('says which Node it needs when module.registerHooks is missing', () => {
    expect(() => installBoundaryGuard({ registerHooks: null })).toThrow(/Node >= 22\.15/);
  });
});

describe('viteBoundaryGuard (the plugin for modules vitest runs itself)', () => {
  const plugin = viteBoundaryGuard();

  it('refuses a forbidden specifier at resolve and a forbidden file at load', () => {
    expect(() => plugin.resolveId('@zodal/groups-core', '/r/src/a.ts')).toThrow(BoundaryViolation);
    expect(() => plugin.load('/p/zodal-groups/packages/groups-core/src/index.ts')).toThrow(BoundaryViolation);
  });

  it('defers everything else to the other plugins (returns null)', () => {
    expect(plugin.resolveId('@zodal/core', '/r/src/a.ts')).toBeNull();
    expect(plugin.load('/r/src/a.ts')).toBeNull();
  });
});
