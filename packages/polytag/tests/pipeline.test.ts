import { composeCodecs } from '@zodal/core';
import { describe, expect, it } from 'vitest';
import { yaml } from '../src/formats/index.js';
import {
  applyImport,
  defaultEdgeId,
  delimited,
  detect,
  diffSpaces,
  grammarCodec,
  planImport,
  readText,
  scopeSpace,
  tagsArray,
  textCodec,
  writeText,
} from '../src/index.js';
import { K, RD } from './fixtures/reference.js';

describe('two-stage detection', () => {
  it('returns evidence, suggested params and a preview for the top candidates', async () => {
    const d = await detect('id;categories\nnotes;\ncarbonara;italian|quick\nmargherita;italian|vegetarian\n');
    expect(d.format.decoded?.format).toBe('csv');
    const [top] = d.grammars;
    expect(top).toMatchObject({ grammar: 'delimited', params: { tagsKey: 'categories', delimiter: '|', idKey: 'id' } });
    expect(top!.evidence.join(' ')).toMatch(/categories/);
    expect(top!.preview).toMatchObject({ nodes: 6, groups: 3, items: 3, edges: 4, isolated: 1, multiParentItems: 2, errors: 0 });
  });

  it('reads YAML anchors as polyhierarchy by reference, and says so', async () => {
    const text = '- id: a\n  children: [&x {id: x}]\n- id: b\n  children: [*x]\n';
    const d = await detect(text);
    expect(d.grammars[0]).toMatchObject({ grammar: 'nested' });
    expect(d.grammars[0]!.evidence.join(' ')).toMatch(/anchors/);
    expect(d.grammars[0]!.preview?.multiParentItems).toBe(1);
  });

  it('asks when the best reading is weak or ambiguous (formats-and-grammars §6.4)', async () => {
    const ambiguous = await detect('{"a": ["b"], "c": ["d"]}');
    expect(ambiguous.needsConfirmation).toBe(true);
    expect(ambiguous.reasons.join(' ')).toMatch(/within|below/);
    const clear = await detect(JSON.stringify({ graph: { nodes: { a: {} }, edges: [] } }));
    expect(clear.needsConfirmation).toBe(false);
    const nothing = await detect('just some prose, not data');
    expect(nothing.needsConfirmation).toBe(true);
  });

  it('suggests the direction of a two-column edge table from cardinality', async () => {
    const read = await readText('item,tag\na,x\nb,x\nc,x\nc,y\n');
    expect(read.grammar).toBe('edge-rows');
    expect(read.params).toMatchObject({ parentKey: 'tag', childKey: 'item' });
    expect(read.space.edges.map((e) => `${e.parent}>${e.child}`)).toEqual(['x>a', 'x>b', 'x>c', 'y>c']);
  });

  it('reads a parent-pointer table (a3) as edge rows with roots as node rows', async () => {
    const read = await readText('id,parent\nfood,\nitalian,food\ncarbonara,italian\n');
    expect(read.grammar).toBe('edge-rows');
    expect(read.space.edges.map((e) => `${e.parent}>${e.child}`)).toEqual(['food>italian', 'italian>carbonara']);
  });

  it('reads d3 / NetworkX node-link and Cytoscape elements', async () => {
    const d3 = await readText(JSON.stringify({ nodes: [{ id: 'g', label: 'G' }, { id: 'a', size: 3 }], links: [{ source: 'g', target: 'a', weight: 2 }] }));
    expect(d3.grammar).toBe('node-link');
    expect(d3.space).toEqual({
      nodes: [{ id: 'g', label: 'G' }, { id: 'a', payload: { size: 3 } }],
      edges: [{ id: 'contains:g/a', parent: 'g', child: 'a', kind: 'contains', meta: { weight: 2 } }],
    });
    const cy = await readText(JSON.stringify({ elements: { nodes: [{ data: { id: 'g' } }, { data: { id: 'a', parent: 'g' } }], edges: [] } }));
    expect(cy.space.edges.map((e) => `${e.parent}>${e.child}`)).toEqual(['g>a']);
  });
});

describe('codecs compose (zodal Codec)', () => {
  it('format ∘ grammar is a Codec<string, ParseResult>', async () => {
    const codec = textCodec(await yaml.load(), tagsArray);
    const parsed = codec.decode('- {id: a, tags: [g]}\n');
    expect(parsed.space.edges).toEqual([{ id: 'contains:g/a', parent: 'g', child: 'a', kind: 'contains' }]);
    expect(codec.encode(parsed)).toBe('- id: a\n  tags:\n    - g\n');
    const same = composeCodecs(await yaml.load(), grammarCodec(tagsArray));
    expect(same.decode('- {id: a, tags: [g]}\n')).toEqual(parsed);
  });

  it('a table grammar composes with CSV', async () => {
    const { csv } = await import('../src/formats/index.js');
    const codec = textCodec(await csv.load(), delimited, {}, { kind: 'table' });
    const parsed = codec.decode('id,groups\na,x;y\n');
    expect(parsed.space.edges).toHaveLength(2);
    expect(codec.encode(parsed)).toBe('id,groups\na,x;y\n');
  });
});

describe('import plan (dry run) and apply', () => {
  const existing = RD;
  const incoming = {
    nodes: [{ id: 'carbonara' }, { id: 'ramen', label: 'Ramen!' }, { id: 'pho' }],
    edges: [RD.edges.find((e) => e.child === 'ramen')!, { id: defaultEdgeId('food', 'pho'), parent: 'food', child: 'pho', kind: 'contains' }, { ...RD.edges[0]!, order: 'a' }],
  };

  it('plans create / skip (identical by content hash) / conflict per id', () => {
    const plan = planImport(existing, incoming);
    expect(plan.nodes.map((e) => [e.id, e.action, e.reason])).toEqual([
      ['carbonara', 'skip', 'identical'],
      ['ramen', 'conflict', 'changed'],
      ['pho', 'create', 'new'],
    ]);
    expect(plan.edges.map((e) => e.action)).toEqual(['skip', 'create', 'conflict']);
    expect(plan.summary).toEqual({ create: 2, update: 0, skip: 2, conflict: 2 });
    expect(planImport(existing, incoming, { onConflict: 'update' }).summary).toEqual({ create: 2, update: 2, skip: 2, conflict: 0 });
  });

  it('refuses to write until every conflict is resolved, then returns the space and an EdgeDelta', () => {
    const plan = planImport(existing, incoming);
    const refused = applyImport(existing, plan);
    expect(refused).toEqual({ ok: false, conflicts: [expect.objectContaining({ id: 'ramen' }), expect.objectContaining({ id: RD.edges[0]!.id })] });
    const partial = applyImport(existing, plan, { resolve: { ramen: 'update' } });
    expect(partial.ok).toBe(false);
    const applied = applyImport(existing, plan, { resolve: { ramen: 'update', [RD.edges[0]!.id]: 'skip' } });
    if (!applied.ok) throw new Error('expected ok');
    expect(applied.space.nodes.find((n) => n.id === 'ramen')).toEqual({ id: 'ramen', label: 'Ramen!' });
    expect(applied.space.nodes.at(-1)).toEqual({ id: 'pho' });
    expect(applied.delta).toEqual({ addedNodes: [{ id: 'pho' }], upsertNodes: [{ id: 'ramen', label: 'Ramen!' }], added: [incoming.edges[1]], removed: [] });
    const all = applyImport(existing, plan, { resolve: 'update' });
    if (!all.ok) throw new Error('expected ok');
    expect(all.delta.removed).toEqual([RD.edges[0]!.id]);
    expect(all.space.edges[0]).toMatchObject({ order: 'a' });
  });

  it('a round trip through a lossless grammar plans nothing but skips', async () => {
    const back = await readText((await writeText(K, { format: 'csv', grammar: 'edge-rows' })).text, { format: 'csv', grammar: 'edge-rows' });
    expect(diffSpaces(K, back.space).equal).toBe(true);
    // Order keys are carried verbatim by edge-rows, so even the hashes match.
    expect(planImport(K, back.space).summary).toEqual({ create: 0, update: 0, skip: K.nodes.length + K.edges.length, conflict: 0 });
  });
});

describe('export scope', () => {
  it('all is the whole space', () => {
    expect(scopeSpace(RD, { scope: 'all' })).toBe(RD);
  });

  it('selected items keep their groups and the groups above them', () => {
    const s = scopeSpace(RD, { scope: 'selected', ids: ['margherita'] });
    expect(s.nodes.map((n) => n.id)).toEqual(['food', 'italian', 'vegetarian', 'margherita']);
    expect(s.edges.map((e) => `${e.parent}>${e.child}`)).toEqual(['food>italian', 'food>vegetarian', 'italian>margherita', 'vegetarian>margherita']);
  });

  it("a filtered group with descendants brings its members, and keeps their other groups (not those groups' members)", () => {
    const s = scopeSpace(RD, { scope: 'filtered', ids: ['vegetarian'], descendants: true });
    expect(s.nodes.map((n) => n.id)).toEqual(['food', 'italian', 'vegetarian', 'quick', 'margherita', 'salad']);
    expect(s.nodes.map((n) => n.id)).not.toContain('carbonara');
  });
});
