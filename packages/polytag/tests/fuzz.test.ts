/**
 * Property test (from the PR #16 review's fuzz): random spaces over five profiles, with
 * tricky ids, labels, payloads, orders and kinds, in every grammar × format × variant. For
 * each: the report computed before writing (`assess`) equals the write's report, the read
 * equals what the report predicts (`roundTrip(...).ok`), nothing reported as dropped comes
 * back, and nothing throws. Seeded, so a failure is reproducible.
 */

import { describe, expect, it } from 'vitest';
import { type SpaceSnapshot, assess, createGrammarRegistry, edgeIdMinter, roundTrip } from '../src/index.js';

const TRICKY = ['010', '1e3', 'true', 'null', 'no', 'on', '~', 'a;b', 'a,b', 'a|b', 'a/b', 'a b', ' lead', 'x"y', "it's", 'line\nbreak', 'é', '日本', '🙂', '=1+1', '+cmd', '-2', '@x', '#h', '__proto__', 'constructor', 'toString', 'a:b', '[x]', '{y}', '0x1F', '2024-01-01', 'NaN', 'x'.repeat(300), '-', '*a', '&b', '!t', '%p', 'a\tb', 'a\r\nb', ''];
TRICKY.push("'=1", "''", "'", "''=x", "'-", 'ref', 'id', 'label', 'groups', 'parent', 'child', 'kind', 'children', 'tags', ' ', '%2F', 'a%3Ab', 'contains:a/b', '\u2028', '\t=x', '-1', '+', '@'); // from the verification's extended fuzz
const PLAIN = ['food', 'italian', 'veg', 'quick', 'carb', 'marg', 'salad', 'ramen', 'notes', 'g1', 'g2', 'i1', 'i2', 'i3'];
const PAYLOADS: unknown[] = [undefined, undefined, { n: 1 }, { s: '010' }, { b: true }, { arr: [1, 'a'] }, { nested: { k: 'v' } }, { d: '2024-01-01T00:00:00Z' }, { f: 0.1 }, { empty: '' }, { nul: null }, { nan: Number.NaN }, 'scalar', 42, [1, 2], null, { s: 'true' }];
PAYLOADS.push({ ref: 'g1' }, { id: 'zz' }, { children: ['x'] }, { tags: ['q'] }, { label: 'L' }, { f: "'=2" }, { k: '=cmd' }, { parent: 'p' }, { order: 'o' }, { deep: { a: { b: { c: { d: [1, { e: null }] } } } } });

function generator(seed: number) {
  let s = seed;
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
  return (profile: string, tricky: boolean): SpaceSnapshot => {
    const pool = tricky ? [...PLAIN, ...TRICKY] : PLAIN;
    const ids = [...new Set(Array.from({ length: 4 + Math.floor(rnd() * 7) }, () => pick(pool)))];
    const nodes = ids.map((id) => {
      const n: Record<string, unknown> = { id };
      if (rnd() < 0.3) n.label = pick([...TRICKY, 'Label']);
      if (rnd() < 0.3) {
        const p = pick(PAYLOADS);
        if (p !== undefined) n.payload = p;
      }
      return n as { id: string };
    });
    const nG = Math.max(1, Math.floor(ids.length / 3));
    const groups = ids.slice(0, nG);
    const items = ids.slice(nG);
    const edges: SpaceSnapshot['edges'][number][] = [];
    const mint = edgeIdMinter();
    const add = (parent: string, child: string, extra: Record<string, unknown> = {}): void => {
      if (parent === child) return;
      const kind = (extra.kind as string) ?? 'contains';
      edges.push({ id: mint(parent, child, kind), parent, child, kind, ...extra });
    };
    if (profile !== 'flatTags') {
      for (let i = 1; i < groups.length; i++) {
        add(groups[Math.floor(rnd() * i)]!, groups[i]!);
        if (profile === 'polyhierarchy' && i > 1 && rnd() < 0.5) add(groups[Math.floor(rnd() * (i - 1))]!, groups[i]!);
        if (rnd() < 0.1) add(groups[Math.floor(rnd() * i)]!, groups[i]!); // a parallel group edge
      }
    }
    for (const it of items) {
      const k = profile === 'filesystem' ? 1 : Math.floor(rnd() * 3);
      const ps = new Set<string>();
      for (let j = 0; j < k; j++) ps.add(pick(groups));
      for (const p of ps) {
        const ex: Record<string, unknown> = {};
        if (rnd() < 0.2) ex.label = pick([...TRICKY, 'nm']);
        if (rnd() < 0.2) ex.order = pick(['a0', 'a1', 'b', 'Z', 'a0V', 'a0']);
        if (rnd() < 0.1) ex.meta = pick([{ src: 'x' }, { n: null }]);
        add(p, it, ex);
      }
    }
    if (profile === 'thesaurus') {
      add(pick(ids), pick(ids), { kind: 'related' });
      add(pick(groups), pick(items.length ? items : groups), { kind: 'broader' });
    }
    return { nodes, edges };
  };
}

const VARIANTS: Record<string, Record<string, unknown>[]> = {
  nested: [{}, { multiParent: 'duplicate' }, { multiParent: 'ref' }, { maxDepth: 2 }, { multiParent: 'duplicate', maxEntries: 5 }],
  'tag-paths': [{}, { mode: 'materialised' }],
  delimited: [{}, { pathSeparator: '/' }, { delimiter: '|' }],
  'tags-array': [{}, { shape: 'map' }],
};
const FORMATS = ['json', 'jsonc', 'yaml', 'toml', 'csv', 'tsv'];
const PROFILES = ['filesystem', 'flatTags', 'labels', 'polyhierarchy', 'thesaurus'];
const grammars = createGrammarRegistry();
const ids = (losses: readonly { kind: string; severity: string; ids: readonly string[] }[]) =>
  JSON.stringify(losses.map((l) => [l.kind, l.severity, [...l.ids].sort()]).sort());

describe.each([1, 7, 42, 1234])('fuzz seed %i', (seed) => {
  it('assess = write report; read = prediction; nothing dropped comes back; nothing throws', async () => {
    const gen = generator(seed);
    const failures: string[] = [];
    for (let t = 0; t < 12; t++) {
      const profile = PROFILES[t % PROFILES.length]!;
      const space = gen(profile, t % 3 !== 0);
      for (const g of grammars.list()) {
        for (const format of FORMATS.filter((f) => g.formats.includes(f))) {
          for (const params of VARIANTS[g.id] ?? [{}]) {
            const key = `${g.id}|${format}|${JSON.stringify(params)}|t${t}`;
            let rt;
            try {
              rt = await roundTrip(space, { format, grammar: g.id, params });
            } catch (e) {
              failures.push(`${key} THROW ${(e as Error).message}`);
              continue;
            }
            const before = assess(space, g, { params, format });
            if (ids(before.losses) !== ids(rt.loss.losses)) failures.push(`${key} ASSESS ${ids(before.losses)} != WRITE ${ids(rt.loss.losses)}`);
            if (!rt.ok) failures.push(`${key} RT ${JSON.stringify(rt.diff)} ${JSON.stringify(rt.read.diagnostics.filter((d) => d.severity === 'error'))}`);
            const back = new Set(rt.read.space.edges.map((e) => e.id));
            const over = rt.loss.losses.filter((l) => l.severity === 'drop' && ['group-edges', 'item-multi-parent', 'group-multi-parent', 'edge-kind', 'membership'].includes(l.kind)).flatMap((l) => l.ids).filter((id) => back.has(id));
            // A dropped id may be re-minted for a different surviving edge only if the space had parallel edges.
            if (over.length && !space.edges.some((e, i) => space.edges.findIndex((x) => x.parent === e.parent && x.child === e.child && x.kind === e.kind) !== i)) {
              failures.push(`${key} OVERREPORT ${over.join(',')}`);
            }
          }
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  }, 60_000);
});
