import { describe, expect, it } from 'vitest';
import { createFormatRegistry } from '../src/formats/index.js';

describe('polytag/formats', () => {
  it('creates an empty registry keyed by the caller', () => {
    const formats = createFormatRegistry((f: { id: string; extensions: string[] }) => f.id);
    expect(formats.list()).toEqual([]);
    formats.register({ id: 'json', extensions: ['.json'] });
    expect(formats.get('json')?.extensions).toEqual(['.json']);
    expect(() => formats.register({ id: 'json', extensions: [] })).toThrow(/format with key 'json'/);
  });

  it('each call returns an independent registry', () => {
    const keyOf = (f: { id: string }) => f.id;
    createFormatRegistry(keyOf).register({ id: 'json' });
    expect(createFormatRegistry(keyOf).has('json')).toBe(false);
  });
});
