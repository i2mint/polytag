import { describe, expect, it } from 'vitest';
import { createViewMenu } from '../src/views/index.js';

describe('polytag/views', () => {
  it('creates an empty menu over a caller-chosen view type', () => {
    const menu = createViewMenu<{ id: string; layout: string }>();
    expect(menu.list()).toEqual([]);
    menu.register({ id: 'three-pane', layout: 'three-pane' });
    expect(menu.has('three-pane')).toBe(true);
    expect(() => menu.register({ id: 'three-pane', layout: 'x' })).toThrow(/view with id 'three-pane'/);
  });
});
