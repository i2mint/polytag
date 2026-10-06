import { describe, expect, it } from 'vitest';
import { createViewMenu } from '../src/views/index.js';

describe('polytag/views', () => {
  it('creates an empty menu keyed by the caller', () => {
    const menu = createViewMenu((v: { id: string; layout: string }) => v.id);
    expect(menu.list()).toEqual([]);
    menu.register({ id: 'three-pane', layout: 'three-pane' });
    expect(menu.has('three-pane')).toBe(true);
    expect(() => menu.register({ id: 'three-pane', layout: 'x' })).toThrow(/view with key 'three-pane'/);
  });
});
