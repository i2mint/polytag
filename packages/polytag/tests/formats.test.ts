import { describe, expect, it } from 'vitest';
import {
  FormatError,
  createFormatRegistry,
  csv,
  defaultFormats,
  detectFormat,
  extensionOf,
  hashComments,
  ioAffordances,
  json,
  jsonc,
  slashComments,
  toml,
  tryDecode,
  yaml,
} from '../src/formats/index.js';

describe('polytag/formats: registry', () => {
  it('registers the v1 formats by id and by extension', () => {
    const formats = createFormatRegistry();
    expect(formats.list().map((f) => f.id)).toEqual(['json', 'jsonc', 'yaml', 'toml', 'csv', 'tsv']);
    expect(formats.byExtension('recipes.YML')?.id).toBe('yaml');
    expect(formats.byExtension('.toml')?.id).toBe('toml');
    expect(formats.byExtension('tsv')?.id).toBe('tsv');
    expect(formats.byExtension('notes.md')).toBeUndefined();
    expect(extensionOf('a.b.JSONC')).toBe('.jsonc');
  });

  it('refuses a duplicate id or extension, and names an unknown format', async () => {
    expect(() => createFormatRegistry([json, json])).toThrow(/format with key 'json'/);
    expect(() => createFormatRegistry([json, { ...yaml, id: 'yaml2', extensions: ['.json'] }])).toThrow(/Extension '.json' is already registered to format 'json'/);
    await expect(createFormatRegistry().load('xml')).rejects.toThrow(/Unknown format 'xml'.*json, jsonc/);
  });

  it('each call returns an independent registry', () => {
    const a = createFormatRegistry([json]);
    expect(a.has('yaml')).toBe(false);
    expect(createFormatRegistry().has('yaml')).toBe(true);
    expect(defaultFormats).toHaveLength(6);
  });

  it('exposes the formats as zodal import/export affordances', () => {
    expect(ioAffordances()).toEqual({ import: ['json', 'jsonc', 'yaml', 'toml', 'csv', 'tsv'], export: ['json', 'jsonc', 'yaml', 'toml', 'csv', 'tsv'] });
    expect(ioAffordances(createFormatRegistry([csv]))).toEqual({ import: ['csv'], export: ['csv'] });
  });
});

describe('polytag/formats: codecs are zodal Codec<string, V>, fallible both ways', () => {
  it('json', async () => {
    const c = await json.load();
    expect(c.decode('{"a": [1, 2]}')).toEqual({ a: [1, 2] });
    expect(c.encode({ a: 1 })).toBe('{\n  "a": 1\n}\n');
    expect(() => c.decode('{"a": }')).toThrow(FormatError);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => c.encode(circular)).toThrow(expect.objectContaining({ code: 'value', format: 'json' }));
    expect(json.unrepresentable({ a: [1, Number.NaN], b: 10n })).toEqual(['/a/1', '/b']);
  });

  it('jsonc reads comments and trailing commas (loaded lazily) and reports them as formatting', async () => {
    const c = await jsonc.load();
    const text = '{\n  // a note\n  "a": [1, 2,],\n}';
    expect(c.decode(text)).toEqual({ a: [1, 2] });
    expect(jsonc.inspect(text).comments).toEqual([{ line: 2, text: '// a note' }]);
    const r = tryDecode(c, '{"a": 1 "b": 2}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ format: 'jsonc', line: 1 });
  });

  it('yaml: 1.2 numerics, quoting on write, duplicate keys, positions', async () => {
    const c = await yaml.load();
    expect(c.decode('[010, no, "010"]')).toEqual([10, 'no', '010']);
    expect(c.encode(['010', 'yes', 'true'])).toBe('- "010"\n- yes\n- "true"\n');
    expect(() => c.decode('a: 1\na: 2')).toThrow(expect.objectContaining({ code: 'syntax', line: 2 }));
    expect((await yaml.load({ version: '1.1' })).decode('[yes, 010]')).toEqual([true, 8]);
  });

  it('yaml: an anchor aliased 150 times fails with alias-limit unless allowed', async () => {
    const text = `- &g {id: g}\n${Array.from({ length: 150 }, () => '- *g').join('\n')}\n`;
    const r = tryDecode(await yaml.load(), text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('alias-limit');
    expect(((await yaml.load({ maxAliasCount: 1000 })).decode(text) as unknown[]).length).toBe(151);
  });

  it('yaml: shared objects are written as anchors and read back as one object', async () => {
    const c = await yaml.load();
    const shared = { id: 'x' };
    const text = c.encode([{ children: [shared] }, { children: [shared] }]);
    expect(text).toMatch(/&\w+/);
    const back = c.decode(text) as { children: unknown[] }[];
    expect(back[0]!.children[0]).toBe(back[1]!.children[0]);
  });

  it('toml: must be a table; nulls are stripped on write and listed as unrepresentable', async () => {
    const c = await toml.load();
    expect(() => c.encode([1])).toThrow(expect.objectContaining({ code: 'shape' }));
    const value = { a: { b: null, c: 1 }, list: [1, null, 2] };
    expect(toml.unrepresentable(value)).toEqual(['/a/b', '/list/1']);
    expect(c.decode(c.encode(value))).toEqual({ a: { c: 1 }, list: [1, 2] });
    expect(() => c.decode('a = ')).toThrow(expect.objectContaining({ format: 'toml', line: 1 }));
    expect(toml.inspect('# top\na = "#not"  # trailing\n').comments.map((x) => x.line)).toEqual([1, 2]);
  });

  it('csv: header + string cells, quoting, BOM, guessed delimiter; tsv', async () => {
    const c = await csv.load();
    const table = { columns: ['id', 'groups'], rows: [['a', 'x,y'], ['b', '']] };
    const text = c.encode(table);
    expect(text).toBe('id,groups\na,"x,y"\nb,\n');
    expect(c.decode(text)).toEqual(table);
    expect(c.decode('\uFEFFid;groups\na;x\n')).toEqual({ columns: ['id', 'groups'], rows: [['a', 'x']] });
    expect(() => c.encode({ nope: 1 } as never)).toThrow(expect.objectContaining({ code: 'shape' }));
    const tsvCodec = await createFormatRegistry().load('tsv');
    expect(tsvCodec.decode('id\tgroups\na\tx;y\n')).toEqual({ columns: ['id', 'groups'], rows: [['a', 'x;y']] });
  });
});

describe('polytag/formats: stage 1 detection (sniff, then confirm by decoding)', () => {
  const cases: [string, string][] = [
    ['json', '[{"id": "a", "tags": ["x"]}]'],
    ['jsonc', '{\n  // comment\n  "a": [1,],\n}'],
    ['yaml', 'a:\n  - x\n  - y\nb: []\n'],
    ['toml', '[[items]]\nid = "a"\ntags = ["x"]\n'],
    ['csv', 'id,groups\na,x;y\nb,z\n'],
    ['tsv', 'id\tgroups\na\tx\nb\ty\n'],
  ];

  it.each(cases)('%s', async (format, text) => {
    const d = await detectFormat(text);
    expect(d.decoded?.format).toBe(format);
    expect(d.candidates[0]!.format).toBe(format);
    expect(d.candidates[0]!.evidence.length).toBeGreaterThan(0);
  });

  it('a file extension is strong evidence, but a text that does not decode is demoted', async () => {
    expect((await detectFormat('a: 1\n', { filename: 'x.yml' })).decoded?.format).toBe('yaml');
    const d = await detectFormat('{\n  // c\n  "a": 1\n}', { filename: 'settings.json' });
    expect(d.decoded?.format).toBe('jsonc');
    expect(d.candidates.find((c) => c.format === 'json')?.error).toMatchObject({ format: 'json', code: 'syntax', message: expect.any(String) });
  });

  it('comment scanners skip quoted text', () => {
    expect(hashComments('a: "x # y" # real\n# full\n').map((c) => c.text)).toEqual(['# real', '# full']);
    expect(slashComments('{"u": "http://x"} /* b */').map((c) => c.text)).toEqual(['/* b */']);
  });
});
