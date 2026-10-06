import { describe, expect, it } from 'vitest';
import {
  type AnyGrammar,
  assess,
  contentHash,
  defaultEdgeId,
  diffSpaces,
  edgeIdMinter,
  edgeRows,
  exportChoices,
  featuresOf,
  findCycles,
  membersMap,
  nested,
  nodeLink,
  positionalOrders,
  reduce,
  snapshotOf,
  tagPaths,
  tagsArray,
  writeText,
} from '../src/index.js';
import { K, P, RD } from './fixtures/reference.js';

describe('snapshot model', () => {
  it('deterministic edge ids escape their separators and count parallel edges', () => {
    expect(defaultEdgeId('food', 'italian')).toBe('contains:food/italian');
    expect(defaultEdgeId('a/b', 'c:d', 'is#a', 1)).toBe('is%23a:a%2Fb/c%3Ad#2');
    const mint = edgeIdMinter();
    expect([mint('a', 'b'), mint('a', 'b'), mint('a', 'b', 'related')]).toEqual(['contains:a/b', 'contains:a/b#2', 'related:a/b']);
  });

  it('positional orders are increasing, fixed-width keys in the fractional-index alphabet', () => {
    for (const n of [1, 3, 61, 62, 500]) {
      const keys = positionalOrders(n);
      expect(keys).toHaveLength(n);
      expect(new Set(keys.map((k) => k.length)).size).toBe(1);
      expect([...keys].sort()).toEqual(keys);
      expect(new Set(keys).size).toBe(n);
      expect(keys.every((k) => /^[0-9A-Za-z]+$/.test(k))).toBe(true);
    }
  });

  it('diffSpaces compares order by rank among the members the expected space orders', () => {
    const base = { nodes: [{ id: 'g' }, { id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [] };
    const e = (child: string, order?: string) => ({ id: defaultEdgeId('g', child), parent: 'g', child, kind: 'contains', ...(order ? { order } : {}) });
    const expected = { ...base, edges: [e('a', 'x'), e('b', 'm'), e('c')] };
    expect(diffSpaces(expected, { ...base, edges: [e('a', 'A'), e('b', 'Z'), e('c', 'B')] }).reordered).toEqual(['g']);
    expect(diffSpaces(expected, { ...base, edges: [e('a', '9'), e('b', '1'), e('c', '5')] }).equal).toBe(true);
    expect(diffSpaces(expected, { ...base, edges: [e('a'), e('b', '1'), e('c')] }).reordered).toEqual(['g']);
  });

  it('snapshotOf accepts a GroupSpace-shaped value (maps) or arrays', () => {
    const space = { nodes: new Map(RD.nodes.map((n) => [n.id, n])), edges: new Map(RD.edges.map((x) => [x.id, x])) };
    expect(snapshotOf(space)).toEqual(RD);
    expect(snapshotOf(RD)).toEqual(RD);
  });

  it('content hashes ignore key order', () => {
    expect(contentHash({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(contentHash({ b: [1, { d: 3, c: 2 }], a: 1 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });

  it('findCycles returns each cycle once, with its path', () => {
    const e = (p: string, c: string) => ({ id: `${p}${c}`, parent: p, child: c, kind: 'contains' });
    expect(findCycles([e('a', 'b'), e('b', 'c'), e('c', 'a'), e('c', 'd')])).toEqual([['a', 'b', 'c', 'a']]);
    expect(findCycles([e('a', 'a')])).toEqual([['a', 'a']]);
    expect(findCycles(RD.edges)).toEqual([]);
  });
});

describe('featuresOf', () => {
  it('RD: the labels profile (items multi-parent, groups a tree, one orphan)', () => {
    const f = featuresOf(RD);
    expect(f.groups).toEqual(['food', 'italian', 'vegetarian', 'quick']);
    expect(f.isolated).toEqual(['notes']);
    expect(f.multiParentItems).toEqual(['carbonara', 'margherita', 'salad']);
    expect(f.multiParentGroups).toEqual([]);
    expect(f.groupEdges).toEqual([defaultEdgeId('food', 'italian'), defaultEdgeId('food', 'vegetarian')]);
    expect(f.customEdgeIds).toEqual([]);
  });

  it('P and K: polyhierarchy and every other feature', () => {
    expect(featuresOf(P).multiParentGroups).toEqual(['italian']);
    const k = featuresOf(K);
    expect(k.groupMeta).toEqual(['food', 'quick']);
    expect(k.orderedEdges).toHaveLength(3);
    expect(k.labelledEdges).toHaveLength(1);
    expect(k.edgeMeta).toHaveLength(1);
    expect(k.otherKinds).toEqual(['related:carbonara/ramen']);
    expect(k.customEdgeIds).toEqual(['e-qc']);
    // `related` is not a membership: carbonara stays an item.
    expect(k.groups).not.toContain('carbonara');
  });
});

describe('the loss report (computed before writing)', () => {
  it('a polyhierarchy written to tags-array reports exactly the group → group edges it drops', () => {
    const report = assess(P, tagsArray);
    expect(report.lossless).toBe(false);
    expect(report.losses).toEqual([
      expect.objectContaining({
        kind: 'group-edges',
        severity: 'drop',
        count: 3,
        ids: [defaultEdgeId('food', 'italian'), defaultEdgeId('food', 'vegetarian'), defaultEdgeId('quick', 'italian')],
      }),
    ]);
  });

  it('serialise reports what assess predicted', () => {
    const all: AnyGrammar[] = [tagsArray, tagPaths, membersMap, nested, edgeRows, nodeLink];
    for (const g of all) {
      expect(g.serialise(K, {}, { format: 'json' }).loss).toEqual(assess(K, g, { format: 'json' }));
    }
  });

  it('capabilities depend on the format: nested copies in JSON (degrade), anchors in YAML (native)', () => {
    expect(assess(RD, nested, { format: 'json' }).losses).toEqual([expect.objectContaining({ kind: 'item-multi-parent', severity: 'degrade' })]);
    expect(assess(RD, nested, { format: 'yaml' }).lossless).toBe(true);
    expect(assess(RD, nested, { format: 'yaml', params: { multiParent: 'ref' } }).losses).toEqual([expect.objectContaining({ severity: 'encode' })]);
  });

  it('tag-paths writes a group with two parents by convention (encode), not a drop', () => {
    expect(assess(P, tagPaths).losses).toEqual([expect.objectContaining({ kind: 'group-multi-parent', severity: 'encode', ids: ['italian'] })]);
  });

  it('reduce keeps node and edge order and remints ids where ids cannot be written', () => {
    const { space } = reduce(K, tagsArray.capabilities);
    expect(space.nodes.map((n) => n.id)).toEqual(K.nodes.map((n) => n.id));
    expect(space.edges.find((e) => e.parent === 'quick' && e.child === 'carbonara')?.id).toBe(defaultEdgeId('quick', 'carbonara'));
  });

  it('formatting: overwriting a commented file reports its comments and layout', async () => {
    const previous = '# my recipes\nfood: [italian]  # the root\n';
    const report = assess(RD, nested, { format: 'yaml', previous });
    expect(report.lossless).toBe(false);
    expect(report.losses).toEqual([
      expect.objectContaining({ kind: 'formatting', severity: 'drop', ids: ['line 1', 'line 2'] }),
      expect.objectContaining({ kind: 'formatting', severity: 'degrade' }),
    ]);
    expect(assess(RD, nested, { format: 'yaml', previous: 'food: [italian]\n' }).lossless).toBe(true);
    const written = await writeText(RD, { format: 'yaml', grammar: 'nested', previous });
    expect(written.loss.losses.map((l) => l.kind)).toEqual(['formatting', 'formatting']);
  });

  it('format limits join the report: TOML cannot write null', async () => {
    const space = { nodes: [{ id: 'a', payload: { x: null, y: 1 } }], edges: [] };
    const { loss, text } = await writeText(space, { format: 'toml', grammar: 'edge-rows' });
    expect(loss.losses).toEqual([expect.objectContaining({ kind: 'format-value', severity: 'drop', ids: ['a'] })]);
    expect(text).not.toMatch(/null/);
  });

  it('exportChoices: lossless first, then the familiar shape (formats-and-grammars §8.5)', () => {
    expect(exportChoices(RD, { format: 'json' })[0]!.grammar).toBe('tag-paths');
    expect(exportChoices(P, { format: 'json' }).slice(0, 2).map((c) => c.grammar)).toEqual(['node-link', 'edge-rows']);
    const flat = { nodes: [{ id: 'g' }, { id: 'a' }], edges: [{ id: defaultEdgeId('g', 'a'), parent: 'g', child: 'a', kind: 'contains' }] };
    expect(exportChoices(flat, { format: 'json' })[0]!.grammar).toBe('tags-array');
    expect(exportChoices(flat, { format: 'csv' })[0]!.grammar).toBe('delimited');
    expect(exportChoices(RD, { format: 'csv' })[0]!.grammar).toBe('edge-rows');
  });
});
