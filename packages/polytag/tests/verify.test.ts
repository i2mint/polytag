/**
 * Regression tests for the verification of the PR #16 fixes (N1–N6, the rest of S1, and the
 * low-severity items). Each reproduces a verifier probe.
 */

import { describe, expect, it } from 'vitest';
import { csv, json } from '../src/formats/index.js';
import {
  type SnapshotEdge,
  type SpaceSnapshot,
  applyImport,
  assess,
  compareOrder,
  defaultEdgeId,
  detect,
  planImport,
  readText,
  roundTrip,
  tagsArray,
  toCollectionSeed,
  writeText,
} from '../src/index.js';

const E = (parent: string, child: string, extra: Partial<SnapshotEdge> = {}): SnapshotEdge => ({
  id: defaultEdgeId(parent, child, extra.kind ?? 'contains'),
  parent,
  child,
  kind: 'contains',
  ...extra,
});
const kinds = (losses: readonly { kind: string; severity: string; ids: readonly string[]; space?: string }[]) =>
  losses.map((l) => [l.space ?? '', l.kind, l.severity, l.ids]);

describe('N1 losses in secondary spaces are planned and reported', () => {
  const params = { spaces: { collections: 'collections' } };
  const prim: SpaceSnapshot = { nodes: [{ id: 'a' }, { id: 't' }], edges: [E('t', 'a')] };
  const sec: SpaceSnapshot = {
    nodes: [{ id: 'a' }, { id: 'c1', label: 'Coll One' }, { id: 'c0' }, { id: 'zz' }],
    edges: [E('c0', 'c1'), E('c1', 'a', { order: 'b' }), E('c0', 'a', { order: 'a' }), E('c1', 'zz'), E('', 'a'), E('c1', 'a', { id: 'contains:c1/a#2' })],
  };

  it('a lossy secondary space is reported (by space), assess = write, and the write leaves the losses out', async () => {
    const w = await writeText(prim, { format: 'json', grammar: 'tags-array', params, spaces: { collections: sec } });
    expect(w.loss.lossless).toBe(false);
    const got = kinds(w.loss.losses).filter(([space]) => space === 'collections');
    expect(got).toEqual(
      expect.arrayContaining([
        ['collections', 'group-edges', 'drop', [E('c0', 'c1').id]],
        ['collections', 'group-meta', 'drop', ['c1']],
        ['collections', 'edge-order', 'drop', expect.arrayContaining([E('c1', 'a').id])],
        ['collections', 'membership', 'drop', [E('c1', 'zz').id]],
        ['collections', 'identity-collision', 'drop', [E('', 'a').id]],
      ]),
    );
    expect(kinds(assess(prim, tagsArray, { format: 'json', params, spaces: { collections: sec } }).losses)).toEqual(kinds(w.loss.losses));
    expect(JSON.parse(w.text)).toEqual([{ id: 'a', tags: ['t'], collections: ['c1', 'c0', 'c1'] }]);
  });

  it('a secondary space round-trips as its plan', async () => {
    const rt = await roundTrip(prim, { format: 'json', grammar: 'tags-array', params, spaces: { collections: sec } });
    expect(rt.ok).toBe(true);
  });

  it('the map shape cannot hold secondary spaces: reported', async () => {
    const w = await writeText(prim, { format: 'json', grammar: 'tags-array', params: { ...params, shape: 'map' }, spaces: { collections: sec } });
    expect(w.loss.losses).toContainEqual(expect.objectContaining({ space: 'collections', kind: 'membership', severity: 'drop', count: sec.edges.length }));
  });
});

describe('N2 / N3 space names and fields', () => {
  const text = JSON.stringify([{ id: 'a', tags: ['t1'], collections: ['c1'] }]);

  it('a secondary space named like the primary is refused by toCollectionSeed', async () => {
    const read = await readText(text, { format: 'json', grammar: 'tags-array', params: { spaces: { groups: 'collections' } } });
    expect(() => toCollectionSeed(read)).toThrow(/'groups'.*primary/);
    expect(Object.keys(toCollectionSeed(read, { primary: 'tags' }).spaces).sort()).toEqual(['groups', 'tags']);
  });

  it('a space field may not be the tags, id or label field, nor repeat', async () => {
    await expect(readText(text, { format: 'json', grammar: 'tags-array', params: { spaces: { x: 'tags' } } })).rejects.toThrow(/spaces.*'tags'/);
    expect(() => tagsArray.resolveParams({ spaces: { x: 'id' } })).toThrow(/Invalid params/);
    expect(() => tagsArray.resolveParams({ spaces: { x: 'c', y: 'c' } })).toThrow(/Invalid params/);
  });
});

describe('N5 payload keys never collide with structural columns', () => {
  const s = (payload: unknown): SpaceSnapshot => ({ nodes: [{ id: 'g' }, { id: 'x', payload }], edges: [E('g', 'x')] });
  for (const grammar of ['edge-rows', 'delimited', 'one-hot']) {
    it(grammar, async () => {
      for (const payload of [{ label: 'L' }, { id: 'zz' }, { parent: 'p' }, { kind: 'k' }, { groups: 'q' }, { child: 'c' }, { order: 'o' }, { meta: 'm' }, { family: 'f' }, { payload: 'p' }]) {
        expect((await roundTrip(s(payload), { format: 'csv', grammar })).ok, JSON.stringify(payload)).toBe(true);
      }
    });
  }
});

describe('N6 whitespace-only ids survive CSV', () => {
  for (const grammar of ['edge-rows', 'delimited', 'one-hot']) {
    it(grammar, async () => {
      for (const id of [' ', '  x', 'x ', '\t']) {
        const s: SpaceSnapshot = { nodes: [{ id: 'g' }, { id }, { id: 'y' }], edges: [E('g', 'y')] };
        expect((await roundTrip(s, { format: 'csv', grammar })).ok, JSON.stringify(id)).toBe(true);
      }
    });
  }
});

describe('N4 papaparse is bounded', () => {
  it('one long row of quoted fields is refused fast, with a diagnostic', async () => {
    const t = '",'.repeat(400 * 1024);
    const t0 = Date.now();
    await detect(t);
    const read = await readText(t, { format: 'csv' });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(read.ok).toBe(false);
    expect(read.diagnostics[0]!.message).toMatch(/maxLineLength/);
  });

  it('the line cap is an option', async () => {
    const c = await csv.load({ maxLineLength: 10 });
    expect(() => c.decode('id\nabcdefghijklmnop\n')).toThrow(expect.objectContaining({ code: 'limit' }));
  });
});

describe('S1 the rest: deep JSON and deep YAML writes', () => {
  it('JSON deeper than the duplicate-key walk can go still reads, with an info diagnostic', async () => {
    let text = '"leaf"';
    for (let i = 0; i < 20000; i++) text = `{"id":"n${i}","children":[${text}]}`;
    const read = await readText(`[${text}]`, { format: 'json', grammar: 'nested' });
    expect(read.diagnostics.filter((d) => d.code === 'internal')).toEqual([]);
    expect(read.space.edges.length).toBe(20000);
    expect((await json.load()).warnings!(`[${text}]`).every((w) => w.code === 'unchecked')).toBe(true);
  });

  it('writing a deep chain as nested YAML or TOML works with the default maxDepth', async () => {
    const n = 2000;
    const ids = Array.from({ length: n + 1 }, (_, i) => `n${i}`);
    const chain: SpaceSnapshot = { nodes: ids.map((id) => ({ id })), edges: ids.slice(1).map((id, i) => E(ids[i]!, id)) };
    for (const format of ['yaml', 'toml', 'json']) expect((await roundTrip(chain, { format, grammar: 'nested' })).ok, format).toBe(true);
  });
});

describe('low', () => {
  it('a partial reorder moves only what it must; unmentioned siblings keep their place', async () => {
    const ex: SpaceSnapshot = {
      nodes: ['g', 'a', 'b', 'c', 'd'].map((id) => ({ id })),
      edges: ['a', 'b', 'c', 'd'].map((c, i) => E('g', c, { order: `a${i}` })),
    };
    const read = await readText('{"g":["d","a"]}', { format: 'json', grammar: 'members-map' });
    const plan = planImport(ex, read.space);
    expect(plan.edges.filter((e) => e.changes?.includes('order')).map((e) => e.id)).toEqual([E('g', 'd').id]);
    const applied = applyImport(ex, plan, { resolve: 'update' });
    if (!applied.ok) throw new Error('expected ok');
    const order = [...applied.space.edges].sort((x, y) => compareOrder(x.order, y.order)).map((e) => e.child);
    expect(order).toEqual(['d', 'a', 'b', 'c']);
    expect(applied.delta.removed).toEqual([E('g', 'd').id]);
    // Unordered existing siblings: the parent is re-keyed, and the plan says which edges that touches.
    const loose: SpaceSnapshot = { nodes: ex.nodes, edges: ['a', 'b', 'c', 'd'].map((c) => E('g', c)) };
    const plan2 = planImport(loose, read.space);
    expect(plan2.rekey.map((r) => r.id).sort()).toEqual(['a', 'b', 'c'].map((c) => E('g', c).id).sort());
    const applied2 = applyImport(loose, plan2, { resolve: 'update' });
    if (!applied2.ok) throw new Error('expected ok');
    expect([...applied2.space.edges].sort((x, y) => compareOrder(x.order, y.order)).map((e) => e.child)).toEqual(['d', 'a', 'b', 'c']);
  });

  it("a foreign CSV cell like '=SUM(A1) is unescaped with a diagnostic", async () => {
    const read = await readText("id,label\nx,'=SUM(A1)\n", { format: 'csv', grammar: 'delimited' });
    expect(read.space.nodes[0]).toMatchObject({ label: '=SUM(A1)' });
    expect(read.diagnostics).toContainEqual(expect.objectContaining({ code: 'unescaped', at: { row: 2, column: 'label' } }));
    const kept = await readText("id,label\nx,'=SUM(A1)\n", { format: 'csv', grammar: 'delimited', formatOptions: { csv: { escapeFormulae: false } } });
    expect(kept.space.nodes[0]).toMatchObject({ label: "'=SUM(A1)" });
  });
});
