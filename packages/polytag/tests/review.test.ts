/**
 * Regression tests for the findings of the PR #16 reviews (B = blocker, S = should-fix,
 * N = nit). Each reproduces a reviewer probe.
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FormatError, csv, json, jsonc, locate, toml, yaml } from '../src/formats/index.js';
import {
  type SnapshotEdge,
  type SpaceSnapshot,
  applyImport,
  assess,
  defaultEdgeId,
  delimited,
  detect,
  diffSpaces,
  edgeRows,
  exportChoices,
  fromCollectionSeed,
  nested,
  planImport,
  readText,
  roundTrip,
  tagPaths,
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
const S = (ids: (string | { id: string })[], edges: SnapshotEdge[]): SpaceSnapshot => ({
  nodes: ids.map((n) => (typeof n === 'string' ? { id: n } : n)),
  edges,
});
const kinds = (losses: readonly { kind: string; severity: string; ids: readonly string[] }[]) => losses.map((l) => [l.kind, l.severity, l.ids]);

describe('B1 import plan', () => {
  it('re-importing an unchanged export plans only skips, in every grammar', async () => {
    const existing = S(['g', { id: 'a', label: 'A' } as { id: string }, 'b'], [E('g', 'a'), E('g', 'b')]);
    for (const grammar of ['nested', 'members-map', 'tags-array', 'node-link', 'edge-rows', 'tag-paths']) {
      const { text } = await writeText(existing, { format: 'json', grammar });
      const read = await readText(text, { format: 'json', grammar });
      const plan = planImport(existing, read.space);
      expect(plan.summary, grammar).toMatchObject({ update: 0, conflict: 0, create: 0 });
    }
    // An app's own fractional keys are compared by rank, not as strings.
    const ordered = S(['g', 'a', 'b'], [E('g', 'a', { order: 'a0' }), E('g', 'b', { order: 'a1' })]);
    const read = await readText((await writeText(ordered, { format: 'json', grammar: 'members-map' })).text, { format: 'json', grammar: 'members-map' });
    expect(planImport(ordered, read.space).summary).toMatchObject({ update: 0, conflict: 0 });
  });

  it('adding one member does not make its siblings conflict; a real reorder does', async () => {
    const ab = (await readText('{"g":["a","b"]}', { format: 'json', grammar: 'members-map' })).space;
    const abc = (await readText('{"g":["a","b","c"]}', { format: 'json', grammar: 'members-map' })).space;
    expect(planImport(ab, abc).edges.map((e) => [e.id, e.action])).toEqual([
      ['contains:g/a', 'skip'],
      ['contains:g/b', 'skip'],
      ['contains:g/c', 'create'],
    ]);
    const ba = (await readText('{"g":["b","a"]}', { format: 'json', grammar: 'members-map' })).space;
    expect(planImport(ab, ba).edges.filter((e) => e.action === 'conflict').map((e) => e.changes)).toEqual([['order'], ['order']]);
  });

  it("a field the source does not carry is kept, never cleared (members-map with onConflict 'update')", async () => {
    const existing = S(['g', { id: 'x', label: 'X', payload: { n: 1 } } as { id: string }], [E('g', 'x')]);
    const read = await readText('{"g":["x","y"]}', { format: 'json', grammar: 'members-map' });
    const plan = planImport(existing, read.space, { onConflict: 'update' });
    const applied = applyImport(existing, plan);
    if (!applied.ok) throw new Error('expected ok');
    expect(applied.space.nodes.find((n) => n.id === 'x')).toEqual({ id: 'x', label: 'X', payload: { n: 1 } });
    // A field it does carry, when changed, updates by merging.
    const relabel = planImport(existing, S([{ id: 'x', label: 'Y' } as { id: string }], []), { onConflict: 'update' });
    const merged = applyImport(existing, relabel);
    if (!merged.ok) throw new Error('expected ok');
    expect(merged.space.nodes.find((n) => n.id === 'x')).toEqual({ id: 'x', label: 'Y', payload: { n: 1 } });
  });

  it('resolve uses own keys only and accepts only skip/update', () => {
    const existing = S([{ id: 'constructor', label: 'a' } as { id: string }, { id: 'toString', label: 'a' } as { id: string }], []);
    const incoming = S([{ id: 'constructor', label: 'b' } as { id: string }, { id: 'toString', label: 'b' } as { id: string }], []);
    const plan = planImport(existing, incoming);
    expect(applyImport(existing, plan, { resolve: {} })).toMatchObject({ ok: false });
    expect(applyImport(existing, plan, { resolve: { constructor: 'delete' } as never })).toMatchObject({ ok: false });
    expect(() => applyImport(existing, plan, { resolve: 'overwrite' as never })).toThrow(/'skip' or 'update'/);
  });

  it('equality is exact (canonical form, NaN ≠ null), not a 53-bit hash; duplicate incoming ids are diagnosed', () => {
    const a = S([{ id: 'x', payload: { v: Number.NaN } } as { id: string }], []);
    const b = S([{ id: 'x', payload: { v: null } } as { id: string }], []);
    expect(planImport(a, b).nodes[0]!.action).toBe('conflict');
    const dup = planImport(S([], []), S([{ id: 'a', label: '1' } as { id: string }, { id: 'a', label: '2' } as { id: string }], []));
    expect(dup.diagnostics).toEqual([expect.objectContaining({ code: 'conflicting-duplicate', ids: ['a'] })]);
  });
});

describe('B2 what is reported is what the read gives', () => {
  it('a group id containing the delimiter: assess and exportChoices report it, and the read matches', async () => {
    const s = S(['a;b', 'x'], [E('a;b', 'x')]);
    const report = assess(s, delimited, { format: 'csv' });
    expect(report.lossless).toBe(false);
    expect(kinds(report.losses)).toEqual([['identity-collision', 'drop', [E('a;b', 'x').id]]]);
    const choices = exportChoices(s, { format: 'csv' });
    expect(choices.find((c) => c.grammar === 'delimited')!.loss.lossless).toBe(false);
    expect(choices[0]!.loss.lossless).toBe(true);
    const rt = await roundTrip(s, { format: 'csv', grammar: 'delimited' });
    expect(rt.ok).toBe(true);
    expect(rt.read.space.nodes.map((n) => n.id).sort()).toEqual(['a;b', 'x']);
  });

  it('a group id containing the path separator does not invent a hierarchy', async () => {
    const s = S(['food/italian', 'x'], [E('food/italian', 'x')]);
    expect(assess(s, tagPaths, { format: 'json' }).lossless).toBe(false);
    const rt = await roundTrip(s, { format: 'json', grammar: 'tag-paths' });
    expect(rt.ok).toBe(true);
    expect(rt.read.space.edges).toEqual([]);
  });

  it('a parallel group → group edge in tag-paths is reported', async () => {
    const s = S(['g', 'h', 'x'], [E('g', 'h'), { ...E('g', 'h'), id: 'contains:g/h#2' }, E('h', 'x')]);
    const report = assess(s, tagPaths, { format: 'json' });
    expect(kinds(report.losses)).toContainEqual(['membership', 'drop', ['contains:g/h#2']]);
    expect((await roundTrip(s, { format: 'json', grammar: 'tag-paths' })).ok).toBe(true);
  });

  it('TOML nulls are in assess and exportChoices, and the read matches', async () => {
    const s = S([{ id: 'x', payload: { a: null, b: 1 } } as { id: string }], []);
    for (const grammar of ['node-link', 'edge-rows', 'nested', 'tags-array']) {
      const report = assess(s, (await import('../src/index.js')).createGrammarRegistry().get(grammar)!, { format: 'toml' });
      expect(kinds(report.losses), grammar).toEqual([['format-value', 'drop', ['x']]]);
      expect((await roundTrip(s, { format: 'toml', grammar })).ok, grammar).toBe(true);
    }
    expect(exportChoices(s, { format: 'toml' }).every((c) => !c.loss.lossless)).toBe(true);
  });

  it('an empty-string label in a CSV is reported', async () => {
    const s = S(['g', { id: 'x', label: '' } as { id: string }], [E('g', 'x')]);
    for (const grammar of ['edge-rows', 'delimited', 'one-hot']) {
      expect(assess(s, (await import('../src/index.js')).createGrammarRegistry().get(grammar)!, { format: 'csv' }).lossless, grammar).toBe(false);
      expect((await roundTrip(s, { format: 'csv', grammar })).ok, grammar).toBe(true);
    }
  });

  it('a one-hot payload column of boolean-looking strings reads back as payload', async () => {
    const s = S(['g', { id: 'x', payload: { s: 'true' } } as { id: string }], [E('g', 'x')]);
    expect((await roundTrip(s, { format: 'csv', grammar: 'one-hot' })).ok).toBe(true);
  });

  it('same-order ties are not reported as reordered (writers keep sequence; so does the comparison)', async () => {
    const tie = S(['g', 'z', 'y'], [E('g', 'z', { order: 'a' }), E('g', 'y', { order: 'a' })]);
    for (const grammar of ['nested', 'members-map']) expect((await roundTrip(tie, { format: 'json', grammar })).ok).toBe(true);
  });
});

describe('B3 resource limits', () => {
  it('the CSV sniffer is linear (200 KB of spaces)', async () => {
    const t = Date.now();
    await detect(`${' '.repeat(200_000)}\n${' '.repeat(200_000)}`);
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it('maxBytes: a larger text is a diagnostic, not a parse', async () => {
    const read = await readText('{"g": ["a"]}', { maxBytes: 5 });
    expect(read.ok).toBe(false);
    expect(read.diagnostics[0]).toMatchObject({ code: 'too-large' });
    expect((await detect('{"g": ["a"]}', { maxBytes: 5 })).reasons.join(' ')).toMatch(/maxBytes/);
  });
});

describe('S1 deep inputs never throw', () => {
  const chain = (n: number): SpaceSnapshot => {
    const ids = Array.from({ length: n + 1 }, (_, i) => `n${i}`);
    return S([...ids, 'x'], [...ids.slice(1).map((id, i) => E(ids[i]!, id)), E(ids[n]!, 'x')]);
  };

  it('a 5000-deep JSON tree reads (or diagnoses) without throwing', async () => {
    let text = '"leaf"';
    for (let i = 0; i < 5000; i++) text = `{"id":"n${i}","children":[${text}]}`;
    const read = await readText(`[${text}]`, { format: 'json', grammar: 'nested' });
    expect(read.space.edges.length + read.diagnostics.length).toBeGreaterThan(0);
    await expect(readText(`[${text}]`)).resolves.toBeDefined();
  });

  it('writing a 5000-deep chain does not overflow the stack', async () => {
    const deep = chain(5000);
    for (const grammar of ['nested', 'tag-paths']) {
      const rt = await roundTrip(deep, { format: 'json', grammar });
      expect(rt.ok, grammar).toBe(true);
    }
  });
});

describe('S2 nested copies are bounded', () => {
  it('a diamond of 20 levels writes as refs past the budget, and says so', async () => {
    const ids: string[] = ['r'];
    const edges: SnapshotEdge[] = [];
    let prev = ['r'];
    for (let i = 0; i < 20; i++) {
      const a = `a${i}`;
      const b = `b${i}`;
      ids.push(a, b);
      for (const p of prev) edges.push(E(p, a), E(p, b));
      prev = [a, b];
    }
    const s = S(ids, edges);
    const report = assess(s, nested, { format: 'json' });
    expect(report.losses.some((l) => /ref/.test(l.message))).toBe(true);
    const w = await writeText(s, { format: 'json', grammar: 'nested' });
    expect(w.text.length).toBeLessThan(1_000_000);
    expect((await roundTrip(s, { format: 'json', grammar: 'nested' })).ok).toBe(true);
  });
});

describe('S3 CSV formula injection', () => {
  it('cells starting with = + - @ are escaped by default, reported as an encode, and read back unescaped', async () => {
    const s = S([{ id: '=1+1', label: '@SUM(A1)' } as { id: string }, "'=x", 'g'], [E('g', '=1+1'), E('g', "'=x")]);
    const w = await writeText(s, { format: 'csv', grammar: 'edge-rows' });
    expect(w.text).toMatch(/'=1\+1/);
    expect(w.loss.losses).toContainEqual(expect.objectContaining({ kind: 'format-value', severity: 'encode' }));
    expect(w.loss.lossless).toBe(true);
    expect((await roundTrip(s, { format: 'csv', grammar: 'edge-rows' })).ok).toBe(true);
    const off = await writeText(s, { format: 'csv', grammar: 'edge-rows', formatOptions: { csv: { escapeFormulae: false } } });
    expect(off.text).not.toMatch(/'=1\+1/);
  });
});

describe('S4 one FormatError class across entries (CJS too)', () => {
  it('require(polytag) and require(polytag/formats) share the format code', () => {
    const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
    const script = `const f = require('polytag/formats'); const r = require('polytag');
      r.writeText({ nodes: [{ id: 'x', payload: { b: 10n } }], edges: [] }, { format: 'json', grammar: 'node-link' })
        .then(() => console.log('no-throw'), (e) => console.log(e instanceof f.FormatError, f.isFormatError(e)));`;
    expect(execFileSync(process.execPath, ['-e', script], { cwd: pkgDir, encoding: 'utf8' }).trim()).toBe('true true');
  });
});

describe('S5 diagnostics carry a structured location, and locate() maps it to a line', () => {
  it('JSON, YAML and CSV', async () => {
    const jsonText = '{\n  "g": ["a", 5]\n}';
    const read = await readText(jsonText, { format: 'json', grammar: 'members-map' });
    const d = read.diagnostics.find((x) => x.code === 'coerced-scalar')!;
    expect(d.at).toEqual({ pointer: '/g/1' });
    expect(await locate(jsonText, 'json', d.at!)).toEqual({ line: 2, column: 14 });
    const yamlText = 'g:\n  - a\n  - 5\n';
    const ry = await readText(yamlText, { format: 'yaml', grammar: 'members-map' });
    expect(await locate(yamlText, 'yaml', ry.diagnostics.find((x) => x.code === 'coerced-scalar')!.at!)).toEqual({ line: 3, column: 5 });
    const csvText = 'id,groups\n"a\nb",x\n,y\n';
    const rc = await readText(csvText, { format: 'csv', grammar: 'delimited' });
    const missing = rc.diagnostics.find((x) => x.code === 'missing-id')!;
    expect(missing.at).toEqual({ row: 3 });
    expect(await locate(csvText, 'csv', missing.at!)).toEqual({ line: 4, column: 1 });
  });
});

describe('S6 seams for the collection facade', () => {
  it('a second id-list field is evidence, asks, and can be read as a named space', async () => {
    const text = JSON.stringify([
      { id: 'a', tags: ['x', 'y'], collections: ['c1'] },
      { id: 'b', tags: ['x'], collections: ['c1', 'c2'] },
    ]);
    const d = await detect(text);
    expect(d.needsConfirmation).toBe(true);
    expect(d.reasons.join(' ')).toMatch(/collections/);
    const read = await readText(text, { grammar: 'tags-array', params: { spaces: { collections: 'collections' } } });
    expect(read.records).toEqual(['a', 'b']);
    expect(read.spaces?.collections?.edges.map((e) => `${e.parent}>${e.child}`)).toEqual(['c1>a', 'c1>b', 'c2>b']);
    expect(read.space.nodes.find((n) => n.id === 'a')?.payload).toBeUndefined();
    const seed = toCollectionSeed(read, { primary: 'tags' });
    expect(seed.records.map((r) => r.id)).toEqual(['a', 'b']);
    expect(Object.keys(seed.spaces).sort()).toEqual(['collections', 'tags']);
    const back = fromCollectionSeed(seed, { primary: 'tags' });
    expect(diffSpaces(read.space, back.space).equal).toBe(true);
    const w = await writeText(back.space, { format: 'json', grammar: 'tags-array', params: { spaces: { collections: 'collections' } }, spaces: back.spaces });
    expect(JSON.parse(w.text)).toEqual(JSON.parse(text));
  });
});

describe('S7 detection', () => {
  it('JSONC that starts with a comment', async () => {
    const read = await readText('// note\n[{"id":"a","tags":["g",],},]');
    expect(read.format).toBe('jsonc');
    expect(read.grammar).toBe('tags-array');
  });

  it('JSON duplicate keys are a diagnostic', async () => {
    const read = await readText('{"g":["a"],"g":["b"]}', { format: 'json', grammar: 'members-map' });
    expect(read.diagnostics).toContainEqual(expect.objectContaining({ code: 'conflicting-duplicate', at: { pointer: '/g' } }));
  });

  it('lists of URLs are not confidently path tags', async () => {
    const d = await detect('[{"id":"a","urls":["http://x/1","http://x/2"]},{"id":"b","urls":["https://y.org/p"]}]');
    expect(d.needsConfirmation).toBe(true);
    expect(d.grammars[0]!.grammar === 'tag-paths' ? d.grammars[0]!.score : 0).toBeLessThan(0.6);
  });
});

// S8 (root code hoisted into a shared chunk) is tested with the boundary check: scripts/check-boundaries.test.mjs.

describe('nits', () => {
  it('ReadResult.formatOptions reproduces the dialect (CSV delimiter, YAML version)', async () => {
    const read = await readText('id;groups\na;x\nb;y\n');
    expect(read.formatOptions).toEqual({ delimiter: ';' });
    const w = await writeText(read.space, { format: 'csv', grammar: 'delimited', formatOptions: { csv: read.formatOptions! } });
    expect(w.text.split('\n')[0]).toBe('id;groups');
    expect((await readText('%YAML 1.1\n---\ng: [a]\n')).formatOptions).toEqual({ version: '1.1' });
  });

  it('a format candidate error is serialisable', async () => {
    const d = await detect('{\n  // c\n  "a": 1\n}', { filename: 'x.json' });
    const failed = JSON.parse(JSON.stringify(d.format.candidates.find((c) => c.format === 'json')));
    expect(failed.error).toMatchObject({ message: expect.any(String), code: 'syntax' });
  });

  it('TOML datetimes are coerced with a diagnostic', async () => {
    const read = await readText('[[items]]\nid = 1979-05-27T07:32:00Z\ntags = [1979-05-27]\n', { format: 'toml', grammar: 'tags-array' });
    expect(read.space.nodes.map((n) => n.id)).toEqual(['1979-05-27T07:32:00.000Z', '1979-05-27']);
    expect(read.diagnostics.filter((d) => d.code === 'coerced-scalar')).toHaveLength(2);
  });

  it('YAML block scalars and TOML multi-line strings are not comments', () => {
    expect(yaml.inspect('k: |\n  # inside block scalar\nj: 1 # real\n').comments.map((c) => c.line)).toEqual([3]);
    expect(toml.inspect('a = """\n# inside\n"""\n# real\n').comments.map((c) => c.line)).toEqual([4]);
  });

  it('formats keep their contracts', async () => {
    expect((await json.load()).decode('{"__proto__": 1}')).toHaveProperty('__proto__', 1);
    expect(Object.keys((await jsonc.load()).decode('{"a": 1}') as object)).toEqual(['a']);
    expect(csv.limits).toEqual({ null: true, nonFinite: false });
    expect(new FormatError('x', 'm')).toBeInstanceOf(Error);
    expect(diffSpaces(S(['a'], []), S(['a'], [])).equal).toBe(true);
    expect(edgeRows.id).toBe('edge-rows');
    expect(tagsArray.id).toBe('tags-array');
  });
});
