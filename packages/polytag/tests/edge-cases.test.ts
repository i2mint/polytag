/**
 * Edge-case fixtures (i2mint/polytag#1 and its Revision; formats-and-grammars §8.3): each
 * produces diagnostics or an exact loss report, never an exception.
 */

import { describe, expect, it } from 'vitest';
import { createFormatRegistry } from '../src/formats/index.js';
import {
  type SpaceSnapshot,
  compatibility,
  createGrammarRegistry,
  defaultEdgeId,
  readText,
  roundTrip,
  writeText,
} from '../src/index.js';

const formats = createFormatRegistry();
const grammars = createGrammarRegistry();
const matrix = compatibility(grammars, formats);
const allPairs = Object.entries(matrix).flatMap(([grammar, fmts]) => fmts.map((format) => ({ grammar, format })));

const e = (parent: string, child: string) => ({ id: defaultEdgeId(parent, child), parent, child, kind: 'contains' });
const codes = (r: { diagnostics: readonly { code: string }[] }) => r.diagnostics.map((d) => d.code);

/** Texts that must never make any compatible grammar throw. */
const TEXTS: Record<string, { format: string; text: string }> = {
  orphanOnly: { format: 'json', text: '[{"id": "lonely", "tags": []}]' },
  emptyGroupOnly: { format: 'json', text: '{"empty": []}' },
  delimiterInLabel: { format: 'csv', text: 'id,label,groups\na,"salt;pepper",x;y\n' },
  tag010: { format: 'yaml', text: 'carbonara: [010, quick]\nnotes: []\n' },
  aliased150: {
    format: 'yaml',
    text: `- &shared {id: shared, children: [a]}\n${Array.from({ length: 150 }, (_, i) => `- {id: g${i}, children: [*shared]}`).join('\n')}\n`,
  },
  aliasCycle: { format: 'yaml', text: '- &a {id: a, children: [*a]}\n' },
  mapCycle: { format: 'json', text: '{"a": ["b"], "b": ["a"]}' },
  duplicates: { format: 'json', text: '[{"id": "x", "n": 1, "tags": ["g"]}, {"id": "x", "n": 2, "tags": ["h"]}]' },
  proto: { format: 'json', text: '{"__proto__": ["a"], "constructor": ["b"], "toString": []}' },
  protoOneHot: { format: 'csv', text: 'id,__proto__,constructor\na,1,0\nb,0,1\n' },
  garbage: { format: 'json', text: '[1, null, {"x": {}}, [[]], "s", true]' },
  emptyTable: { format: 'csv', text: 'id\n' },
};

describe('no grammar throws on any edge-case text', () => {
  const cases = Object.entries(TEXTS).flatMap(([name, { format, text }]) =>
    matrix && Object.entries(matrix).filter(([, f]) => f.includes(format)).map(([grammar]) => ({ name, grammar, format, text })),
  );
  it.each(cases)('$name as $grammar × $format', async ({ grammar, format, text }) => {
    const read = await readText(text, { format, grammar });
    expect(Array.isArray(read.diagnostics)).toBe(true);
  });

  it.each(Object.entries(TEXTS))('%s, detected', async (_, { text }) => {
    await expect(readText(text)).resolves.toBeDefined();
  });

  it('unparseable text is a diagnostic with a position', async () => {
    const read = await readText('{"a": [1, }', { format: 'json', grammar: 'members-map' });
    expect(read.ok).toBe(false);
    expect(read.diagnostics[0]).toMatchObject({ severity: 'error', code: 'format' });
    const yaml = await readText('a: [1\n', { format: 'yaml' });
    expect(yaml.diagnostics[0]).toMatchObject({ code: 'format', line: expect.any(Number) });
  });
});

describe('the fixtures', () => {
  it('orphan only: one isolated node, in every grammar × format', async () => {
    const read = await readText(TEXTS.orphanOnly!.text);
    expect(read.space).toEqual({ nodes: [{ id: 'lonely' }], edges: [] });
    const space: SpaceSnapshot = { nodes: [{ id: 'lonely' }], edges: [] };
    for (const { grammar, format } of allPairs) expect((await roundTrip(space, { grammar, format })).ok, `${grammar} × ${format}`).toBe(true);
  });

  it('empty group only: an isolated node (members-map; one-hot with groupColumns)', async () => {
    expect((await readText(TEXTS.emptyGroupOnly!.text, { grammar: 'members-map' })).space.nodes).toEqual([{ id: 'empty' }]);
    const oneHot = await readText('id,empty\n', { format: 'csv', grammar: 'one-hot', params: { groupColumns: ['empty'] } });
    expect(oneHot.space).toEqual({ nodes: [{ id: 'empty' }], edges: [] });
  });

  it('a label containing the delimiter survives (its own column); a group id containing it is reported', async () => {
    const read = await readText(TEXTS.delimiterInLabel!.text, { grammar: 'delimited' });
    expect(read.space.nodes.find((n) => n.id === 'a')?.label).toBe('salt;pepper');
    const space: SpaceSnapshot = { nodes: [{ id: 'salt;pepper' }, { id: 'a', label: 'x;y' }], edges: [e('salt;pepper', 'a')] };
    const { loss, text } = await writeText(space, { format: 'csv', grammar: 'delimited' });
    expect(loss.losses).toContainEqual(expect.objectContaining({ kind: 'identity-collision', severity: 'drop', ids: [defaultEdgeId('salt;pepper', 'a')] }));
    // The membership is left out (reported), so the read gives no phantom groups.
    expect((await readText(text, { format: 'csv', grammar: 'delimited' })).space.nodes.map((n) => n.id).sort()).toEqual(['a', 'salt;pepper']);
    const paths = await writeText({ nodes: [{ id: 'a/b' }, { id: 'x' }], edges: [e('a/b', 'x')] }, { format: 'json', grammar: 'tag-paths' });
    expect(paths.loss.losses).toContainEqual(expect.objectContaining({ kind: 'identity-collision', ids: [defaultEdgeId('a/b', 'x')] }));
  });

  it("tag 010: YAML reads unquoted 010 as 10 and says so; a '010' id round-trips quoted", async () => {
    const read = await readText(TEXTS.tag010!.text, { grammar: 'tags-array' });
    expect(read.diagnostics).toContainEqual(expect.objectContaining({ code: 'coerced-scalar', severity: 'warning', ids: ['10'] }));
    const space: SpaceSnapshot = { nodes: [{ id: '010' }, { id: 'x' }], edges: [e('010', 'x')] };
    for (const { grammar, format } of allPairs) expect((await roundTrip(space, { grammar, format })).ok, `${grammar} × ${format}`).toBe(true);
  });

  it('a group aliased 150 times: an alias-limit diagnostic with a hint, then reads with maxAliasCount', async () => {
    const { text } = TEXTS.aliased150!;
    const read = await readText(text, { format: 'yaml', grammar: 'nested' });
    expect(read.ok).toBe(false);
    expect(read.diagnostics).toEqual([expect.objectContaining({ code: 'alias-limit', hint: expect.stringMatching(/maxAliasCount/) })]);
    const ok = await readText(text, { format: 'yaml', grammar: 'nested', formatOptions: { yaml: { maxAliasCount: 1000 } } });
    expect(ok.ok).toBe(true);
    expect(ok.space.edges.filter((x) => x.child === 'shared')).toHaveLength(150);
  });

  it('a cycle through a YAML alias is detected, kept and reported, without looping', async () => {
    const read = await readText(TEXTS.aliasCycle!.text, { format: 'yaml', grammar: 'nested' });
    expect(read.space.edges).toEqual([expect.objectContaining({ parent: 'a', child: 'a' })]);
    expect(read.diagnostics).toContainEqual(expect.objectContaining({ code: 'cycle', ids: ['a', 'a'] }));
  });

  it('a cycle in a members map is reported with its path; a cyclic space writes losslessly as nested refs', async () => {
    const read = await readText(TEXTS.mapCycle!.text, { grammar: 'members-map' });
    expect(read.diagnostics).toContainEqual(expect.objectContaining({ code: 'cycle', ids: ['a', 'b', 'a'] }));
    for (const format of ['json', 'yaml', 'toml']) expect((await roundTrip(read.space, { format, grammar: 'nested' })).ok).toBe(true);
    // As paths, the edge that closes the cycle cannot be written: reported, not thrown.
    const paths = await writeText({ nodes: [{ id: 'a' }, { id: 'b' }, { id: 'x' }], edges: [e('a', 'b'), e('b', 'a'), e('b', 'x')] }, { format: 'json', grammar: 'tag-paths' });
    expect(paths.loss.losses).toContainEqual(expect.objectContaining({ kind: 'group-edges', severity: 'drop', ids: [defaultEdgeId('b', 'a')] }));
  });

  it('duplicate ids with different payloads: the first wins, the conflict is a warning, memberships are merged', async () => {
    const read = await readText(TEXTS.duplicates!.text, { grammar: 'tags-array' });
    expect(read.space.nodes.find((n) => n.id === 'x')?.payload).toEqual({ n: 1 });
    expect(read.diagnostics).toContainEqual(expect.objectContaining({ code: 'conflicting-duplicate', ids: ['x'] }));
    expect(read.space.edges.map((x) => x.parent).sort()).toEqual(['g', 'h']);
    const rows = await readText(',x,,"{""n"":1}"\n'.replace(/^/, 'parent,child,label,payload\n') + ',x,,"{""n"":2}"\n', { format: 'csv', grammar: 'edge-rows' });
    expect(codes(rows)).toContain('conflicting-duplicate');
    const tree = await readText('[{"id": "x", "n": 1}, {"id": "x", "n": 2}]', { format: 'json', grammar: 'nested' });
    expect(codes(tree)).toContain('conflicting-duplicate');
  });

  it('groups named __proto__ and constructor are ordinary ids (members-map, one-hot), and nothing is polluted', async () => {
    const read = await readText(TEXTS.proto!.text, { grammar: 'members-map' });
    expect(read.space.nodes.map((n) => n.id)).toEqual(['__proto__', 'a', 'constructor', 'b', 'toString']);
    const oneHot = await readText(TEXTS.protoOneHot!.text, { grammar: 'one-hot' });
    expect(oneHot.space.edges.map((x) => `${x.parent}>${x.child}`)).toEqual(['__proto__>a', 'constructor>b']);
    const space: SpaceSnapshot = {
      nodes: [{ id: '__proto__' }, { id: 'constructor' }, { id: 'hasOwnProperty', payload: { __proto__x: 1 } }, { id: 'a' }],
      edges: [e('__proto__', 'a'), e('constructor', 'a'), e('constructor', 'hasOwnProperty')],
    };
    for (const { grammar, format } of allPairs) expect((await roundTrip(space, { grammar, format })).ok, `${grammar} × ${format}`).toBe(true);
    expect(({} as Record<string, unknown>).a).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('a');
  });

  it('non-records and junk are diagnostics and residue', async () => {
    const read = await readText(TEXTS.garbage!.text, { format: 'json', grammar: 'tags-array' });
    expect(read.residue.length).toBeGreaterThan(0);
    expect(codes(read)).toEqual(expect.arrayContaining(['shape', 'missing-id']));
  });

  it('unknown ids and incompatible pairs are programmer errors or diagnostics, as documented', async () => {
    await expect(readText('{}', { grammar: 'xml-tree' })).rejects.toThrow(/Unknown grammar 'xml-tree'/);
    const r = await readText('id,groups\na,b\n', { format: 'csv', grammar: 'nested' });
    expect(r.diagnostics[0]).toMatchObject({ code: 'undetermined' });
    await expect(writeText({ nodes: [], edges: [] }, { format: 'csv', grammar: 'nested' })).rejects.toThrow(/cannot write CSV/);
    expect(() => grammars.get('delimited')!.serialise({ nodes: [], edges: [] }, { delimiter: '' })).toThrow(/Invalid params for grammar 'delimited'/);
  });
});
