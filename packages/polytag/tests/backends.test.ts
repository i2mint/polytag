import { describe, expect, it } from 'vitest';
import { createBackendCatalog } from '../src/backends/index.js';

describe('polytag/backends', () => {
  it('keys descriptors by a caller-chosen field (zodal ProviderDescriptor uses `name`)', () => {
    const catalog = createBackendCatalog((d: { name: string; label: string }) => d.name);
    expect(catalog.list()).toEqual([]);
    catalog.register({ name: 'memory', label: 'In memory' });
    expect(catalog.get('memory')?.label).toBe('In memory');
    expect(() => catalog.register({ name: 'memory', label: 'again' })).toThrow(/backend with key 'memory'/);
  });
});
