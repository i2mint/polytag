import { describe, expect, it } from 'vitest';
import { createFormatRegistry, type FormatCodec } from '../src/formats/index.js';

describe('polytag/formats', () => {
  it('creates an empty registry that accepts a codec', () => {
    const formats = createFormatRegistry();
    expect(formats.list()).toEqual([]);
    const json: FormatCodec = { id: 'json', decode: JSON.parse, encode: (v) => JSON.stringify(v) };
    formats.register(json);
    expect(formats.get('json')?.decode('{"a":1}')).toEqual({ a: 1 });
    expect(() => formats.register(json)).toThrow(/format with id 'json'/);
  });

  it('each call returns an independent registry', () => {
    const a = createFormatRegistry();
    a.register({ id: 'json', decode: JSON.parse, encode: JSON.stringify });
    expect(createFormatRegistry().has('json')).toBe(false);
  });
});
