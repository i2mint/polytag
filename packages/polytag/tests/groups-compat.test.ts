/**
 * polytag's snapshots are structural: they fit zodal-groups' `Node` / `Edge` without
 * depending on a zodal-groups release (the published @zodal/groups-core 0.1.0 is a
 * devDependency, used only here).
 */

import {
  type Edge,
  type Node,
  type NodeId,
  childrenOf,
  createGroupSpace,
  edgeId,
  nodeId,
  parentsOf,
  unfiled,
} from '@zodal/groups-core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { type SnapshotEdge, type SnapshotNode, type SpaceSnapshot, diffSpaces, readText, snapshotOf, writeText } from '../src/index.js';
import { K, P, RD } from './fixtures/reference.js';

/** Mint zodal-groups' branded ids (compile-time only brands). */
const seed = (s: SpaceSnapshot): { nodes: Node[]; edges: Edge[] } => ({
  nodes: s.nodes.map((n) => ({ ...n, id: nodeId(n.id) })),
  edges: s.edges.map((e) => ({ ...e, id: edgeId(e.id), parent: nodeId(e.parent), child: nodeId(e.child) })),
});

describe('compatibility with @zodal/groups-core', () => {
  it('a zodal-groups Node / Edge is a SnapshotNode / SnapshotEdge', () => {
    expectTypeOf<Node>().toMatchTypeOf<SnapshotNode>();
    expectTypeOf<Edge>().toMatchTypeOf<SnapshotEdge>();
  });

  it.each([
    ['RD', RD, 'labels'],
    ['P', P, 'polyhierarchy'],
    ['K', K, 'polyhierarchy'],
  ] as const)('%s, parsed from text, seeds createGroupSpace under %s and comes back unchanged', async (_, space, profile) => {
    const read = await readText((await writeText(space, { format: 'json', grammar: 'edge-rows' })).text);
    const groups = createGroupSpace({ profile, ...seed(read.space) });
    expect(diffSpaces(space, snapshotOf(groups)).equal).toBe(true);
    expect(childrenOf(groups, nodeId('italian')).sort()).toEqual(['carbonara', 'margherita'].map(nodeId));
  });

  it('a polyhierarchy is refused by a tree profile, as zodal-groups decides (not polytag)', () => {
    expect(() => createGroupSpace({ profile: 'labels', ...seed(P) })).toThrow(/maxParentsPerGroup/);
  });

  it("a user tag named 'unfiled' is an ordinary group next to zodal-groups' computed unfiled()", async () => {
    const read = await readText('[{"id": "a", "tags": ["unfiled"]}, {"id": "b", "tags": []}]');
    expect(read.ok).toBe(true);
    const groups = createGroupSpace({ profile: 'flatTags', ...seed(read.space) });
    expect(childrenOf(groups, nodeId('unfiled'))).toEqual([nodeId('a')]);
    const computed = unfiled<unknown>(nodeId('smart:unfiled'));
    const matches = [...groups.nodes.values()].filter((n) => computed.rule(n, groups)).map((n) => n.id as NodeId);
    expect(matches).toEqual([nodeId('b')]);
    expect(parentsOf(groups, nodeId('a'))).toEqual([nodeId('unfiled')]);
  });
});
