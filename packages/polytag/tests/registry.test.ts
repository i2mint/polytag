import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src/internal/registry.js';

describe('createRegistry (shared by the menus)', () => {
  it('starts empty, keys entries with the given selector, keeps registration order', () => {
    const r = createRegistry((e: { name: string; n: number }) => e.name);
    expect(r.list()).toEqual([]);
    r.register({ name: 'b', n: 1 });
    r.register({ name: 'a', n: 2 });
    expect(r.list().map((e) => e.name)).toEqual(['b', 'a']);
    expect(r.get('a')).toEqual({ name: 'a', n: 2 });
    expect(r.has('b')).toBe(true);
    expect(r.get('missing')).toBeUndefined();
    expect(r.has('missing')).toBe(false);
  });

  it('refuses a duplicate key, naming the kind and the registered keys', () => {
    const r = createRegistry((e: { id: string }) => e.id, { kind: 'widget' });
    r.register({ id: 'x' });
    expect(() => r.register({ id: 'x' })).toThrow(/widget with key 'x' is already registered.*Registered keys: x/);
  });

  it('list() returns a copy', () => {
    const r = createRegistry((e: { id: string }) => e.id);
    r.register({ id: 'x' });
    r.list().pop();
    expect(r.list()).toHaveLength(1);
  });
});
