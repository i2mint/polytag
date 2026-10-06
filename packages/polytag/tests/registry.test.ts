import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src/internal/registry.js';

describe('createRegistry (shared by the menus)', () => {
  it('starts empty and keeps registration order', () => {
    const r = createRegistry<{ id: string; n: number }>();
    expect(r.list()).toEqual([]);
    r.register({ id: 'b', n: 1 });
    r.register({ id: 'a', n: 2 });
    expect(r.list().map((e) => e.id)).toEqual(['b', 'a']);
    expect(r.get('a')).toEqual({ id: 'a', n: 2 });
    expect(r.has('b')).toBe(true);
    expect(r.get('missing')).toBeUndefined();
    expect(r.has('missing')).toBe(false);
  });

  it('refuses a duplicate id, naming the kind and the registered ids', () => {
    const r = createRegistry<{ id: string }>('widget');
    r.register({ id: 'x' });
    expect(() => r.register({ id: 'x' })).toThrow(/widget with id 'x' is already registered.*Registered ids: x/);
  });

  it('list() returns a copy', () => {
    const r = createRegistry<{ id: string }>();
    r.register({ id: 'x' });
    r.list().pop();
    expect(r.list()).toHaveLength(1);
  });
});
