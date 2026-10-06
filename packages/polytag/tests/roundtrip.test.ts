/**
 * THE ROUND-TRIP GATE (i2mint/polytag#1, formats-and-grammars §8.3). Fails the build when a
 * grammar × format stops honouring its contract.
 *
 * For every grammar, every compatible format and several param variants, and for RD, P
 * (polyhierarchy) and K (every feature): write, read back with the same params, and compare
 * with what the loss report predicts (`reduce(space, capabilities)`): nodes and edges by id
 * and content, edge order by rank, deterministic edge ids. Then, separately: RD round-trips
 * with no difference at all in every grammar the loss report calls lossless, and the hand-
 * written RD fixtures parse to RD minus exactly the declared drops.
 */

import { describe, expect, it } from 'vitest';
import { createFormatRegistry } from '../src/formats/index.js';
import {
  type SpaceSnapshot,
  assess,
  compatibility,
  createGrammarRegistry,
  diffSpaces,
  readText,
  roundTrip,
} from '../src/index.js';
import { K, P, RD, RD_TEXTS } from './fixtures/reference.js';

const formats = createFormatRegistry();
const grammars = createGrammarRegistry();
const matrix = compatibility(grammars, formats);

/** Param variants exercised besides the defaults. */
const VARIANTS: Record<string, Record<string, unknown>[]> = {
  nested: [{}, { multiParent: 'ref' }, { multiParent: 'duplicate' }, { idKey: 'name', childrenKey: 'items' }],
  'tags-array': [{}, { shape: 'map' }, { tagsKey: 'categories', idKey: 'slug' }],
  'tag-paths': [{}, { mode: 'materialised' }, { separator: '|' }, { shape: 'map' }],
  'members-map': [{}],
  'edge-rows': [{}, { nodeRows: 'all', edgeIds: 'always' }],
  delimited: [{}, { delimiter: '|' }, { pathSeparator: '/' }],
  'one-hot': [{}, { columnPrefix: 'tag:', trueValue: 'x', falseValue: '' }],
  'node-link': [{}, { edgeIds: 'always' }],
};

const SPACES: Record<string, SpaceSnapshot> = { RD, P, K };

const cases = Object.entries(matrix).flatMap(([grammar, fmts]) =>
  fmts.flatMap((format) =>
    (VARIANTS[grammar] ?? [{}]).flatMap((params) => Object.keys(SPACES).map((space) => ({ grammar, format, params, space }))),
  ),
);

describe('round-trip gate: parse(serialise(S)) equals what the loss report predicts', () => {
  it('covers every grammar of the v1 set in at least one format', () => {
    expect(Object.keys(matrix).sort()).toEqual(['delimited', 'edge-rows', 'members-map', 'nested', 'node-link', 'one-hot', 'tag-paths', 'tags-array']);
    for (const fmts of Object.values(matrix)) expect(fmts.length).toBeGreaterThan(0);
  });

  it.each(cases)('$grammar × $format $params on $space', async ({ grammar, format, params, space }) => {
    const r = await roundTrip(SPACES[space]!, { format, grammar, params });
    expect(r.read.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.diff).toMatchObject({ equal: true });
    expect(r.ok).toBe(true);
  });
});

describe('round-trip gate: RD is value-exact wherever the report says lossless', () => {
  const lossless = Object.entries(matrix).flatMap(([grammar, fmts]) =>
    fmts.filter((format) => assess(RD, grammars.get(grammar)!, { format }).lossless).map((format) => ({ grammar, format })),
  );

  it('RD is lossless in nested (YAML), tag-paths, members-map, edge-rows and node-link, in every compatible format', () => {
    const got = new Set(lossless.map((c) => `${c.grammar}×${c.format}`));
    for (const g of ['tag-paths', 'members-map', 'edge-rows', 'node-link']) for (const f of matrix[g]!) expect(got).toContain(`${g}×${f}`);
    expect(got).toContain('nested×yaml');
    // Copies of a multi-parent item in JSON are a degrade; flat grammars drop RD's group edges.
    for (const g of ['tags-array', 'delimited', 'one-hot']) for (const f of matrix[g]!) expect(got).not.toContain(`${g}×${f}`);
    expect(got).not.toContain('nested×json');
  });

  it.each(lossless)('$grammar × $format', async ({ grammar, format }) => {
    const r = await roundTrip(RD, { format, grammar });
    expect(diffSpaces(RD, r.read.space).equal).toBe(true);
  });

  it.each(Object.entries(matrix).flatMap(([grammar, fmts]) => fmts.map((format) => ({ grammar, format }))))(
    'RD keeps every node and every non-dropped edge in $grammar × $format',
    async ({ grammar, format }) => {
      const r = await roundTrip(RD, { format, grammar });
      const dropped = new Set(r.loss.losses.filter((l) => l.severity === 'drop').flatMap((l) => l.ids));
      const d = diffSpaces(RD, r.read.space);
      expect(d.missingNodes).toEqual([]);
      expect([...d.missingEdges].sort()).toEqual(RD.edges.map((e) => e.id).filter((id) => dropped.has(id)).sort());
      expect(d.extraNodes).toEqual([]);
      expect(d.extraEdges).toEqual([]);
    },
  );
});

describe('hand-written RD fixtures (formats-and-grammars §3) parse to RD', () => {
  it.each(RD_TEXTS)('$grammar × $format', async ({ grammar, format, text, params, dropped = [] }) => {
    const read = await readText(text, { format, grammar, params });
    expect(read.ok).toBe(true);
    const d = diffSpaces(RD, read.space);
    expect(d.missingNodes).toEqual([]);
    expect(d.extraNodes).toEqual([]);
    expect(d.extraEdges).toEqual([]);
    expect([...d.missingEdges].sort()).toEqual([...dropped].sort());
  });

  it.each(RD_TEXTS)('$grammar × $format is detected without being told', async ({ grammar, format, text }) => {
    const read = await readText(text);
    expect(read.format).toBe(format);
    expect(read.grammar).toBe(grammar);
  });
});
