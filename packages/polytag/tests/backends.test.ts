import { describe, expect, it } from 'vitest';
import { createBackendCatalog } from '../src/backends/index.js';

describe('polytag/backends', () => {
  it('creates an empty catalog over a caller-chosen descriptor type', () => {
    const catalog = createBackendCatalog<{ id: string; label: string }>();
    expect(catalog.list()).toEqual([]);
    catalog.register({ id: 'memory', label: 'In memory' });
    expect(catalog.get('memory')?.label).toBe('In memory');
    expect(() => catalog.register({ id: 'memory', label: 'again' })).toThrow(/backend with id 'memory'/);
  });
});
