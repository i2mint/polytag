/**
 * `members-map` (d): the inverse index, group → members.
 *
 * ```json
 * { "food": ["italian", "vegetarian", "ramen"], "italian": ["carbonara", "margherita"], "notes": [] }
 * ```
 *
 * The flat grammar closest to the canonical relation: nested groups (a member that is also a
 * key), several parents for items and groups, and group-major order (array position) are
 * native. A member may be `{ id, label?, meta? }` to carry the edge's name and metadata (a
 * convention). A node in no group and with no member is written as an empty group
 * (`"notes": []`), which reads back as the same isolated node; node labels and payloads have
 * nowhere to go (formats-and-grammars §3(d)).
 */

import { z } from 'zod';
import { isPlainObject } from '../formats/index.js';
import { type Detection, defineGrammar, noDetection } from '../grammar.js';
import type { GrammarCapabilities } from '../loss.js';
import { type SnapshotEdge, compareOrder, positionalOrders } from '../model/snapshot.js';
import { createSpaceBuilder } from './shared/builder.js';
import { coerceString, hasOwn, own } from './shared/records.js';
import { LEXICON, inLexicon, isScalar } from './shared/shape.js';

/** Params of `members-map`. */
export const membersMapParams = z.object({
  /** Key of a member object's id. */
  idKey: z.string().min(1).default('id'),
  /** Key of a member object's name within the group (the edge label). */
  labelKey: z.string().min(1).default('label'),
  /** Key of a member object's edge metadata. */
  metaKey: z.string().min(1).default('meta'),
  /** Read array position as the rank within the group. */
  order: z.boolean().default(true),
});
export type MembersMapParams = z.infer<typeof membersMapParams>;

const CAPS: GrammarCapabilities = {
  itemsMultiParent: 'native',
  nestedGroups: 'native',
  groupsMultiParent: 'native',
  groupMeta: 'no',
  itemMeta: 'no',
  edgeOrder: 'group-major',
  edgeLabel: 'convention',
  edgeMeta: 'convention',
  isolatedNodes: 'convention',
  edgeKinds: 'single',
  edgeIds: 'no',
  identity: 'id',
};

const isMember = (v: unknown): boolean => isScalar(v) || (isPlainObject(v) && hasOwn(v, 'id'));

function detect(input: unknown): Detection<MembersMapParams> {
  if (!isPlainObject(input)) return noDetection();
  const entries = Object.entries(input);
  if (!entries.length || !entries.every(([, v]) => Array.isArray(v) && v.every((m) => isMember(m) || m === null))) return noDetection();
  const members = entries.flatMap(([, v]) => v as unknown[]).map((m) => (isPlainObject(m) ? String(m.id) : String(m)));
  const distinct = new Set(members);
  const keys = new Set(entries.map(([k]) => k));
  const nesting = [...distinct].filter((m) => keys.has(m)).length;
  const objects = members.length - (entries.flatMap(([, v]) => v as unknown[]).filter(isScalar).length);
  const empties = entries.filter(([, v]) => !(v as unknown[]).length).length;
  // Groups are fewer than their members; a member that is also a key is a nested group.
  const groupSide = nesting > 0 ? 1 : entries.length < distinct.size ? 0.8 : entries.length === distinct.size ? 0.6 : 0.3;
  const name = entries.some(([k]) => inLexicon(k, LEXICON.tags)) ? 0.6 : 0.5;
  const evidence = [
    `a map of ${entries.length} keys to lists of ${distinct.size} distinct members`,
    ...(nesting ? [`${nesting} member(s) are also keys: nested groups`] : []),
    ...(objects ? [`${objects} member object(s) with an id`] : []),
    ...(empties ? [`${empties} empty list(s): empty groups (or orphan items)`] : []),
  ];
  return { score: 0.5 * groupSide + 0.3 * name + 0.2 * (empties > entries.length / 2 ? 0.2 : 1), evidence, suggestedParams: {} };
}

/** `members-map`: `{ group: [members] }`. */
export const membersMap = defineGrammar<MembersMapParams>({
  id: 'members-map',
  label: 'Group → members map',
  description: 'Each group lists its members; a member that is also a key is a nested group. Node labels and payloads are not written.',
  inputs: ['value'],
  formats: ['json', 'jsonc', 'yaml', 'toml'],
  params: membersMapParams,
  capabilities: CAPS,
  detect,

  parse(input, p) {
    const builder = createSpaceBuilder();
    if (!isPlainObject(input)) {
      builder.diag({ severity: 'error', code: 'shape', message: 'expected a map of group → list of members', path: '' });
      builder.leftover('', input);
      return builder.build();
    }
    for (const [group, list] of Object.entries(input)) {
      const path = `/${group}`;
      builder.node(group);
      if (list === null) continue;
      if (!Array.isArray(list)) {
        builder.diag({ severity: 'warning', code: 'shape', message: `members of '${group}' are not a list; skipped`, path, ids: [group] });
        builder.leftover(path, list);
        continue;
      }
      const edgeIds: string[] = [];
      list.forEach((m, i) => {
        const at = `${path}/${i}`;
        if (m === null || m === undefined) {
          builder.diag({ severity: 'info', code: 'empty-token', message: 'an empty member was skipped', path: at, ids: [group] });
          return;
        }
        let child: string | undefined;
        let label: string | undefined;
        let meta: Record<string, unknown> | undefined;
        if (isPlainObject(m)) {
          child = coerceString(own(m, p.idKey), 'member id', `${at}/${p.idKey}`, builder);
          label = coerceString(own(m, p.labelKey), 'member label', `${at}/${p.labelKey}`, builder);
          const rawMeta = own(m, p.metaKey);
          if (isPlainObject(rawMeta)) meta = rawMeta;
          else if (rawMeta !== undefined) builder.diag({ severity: 'warning', code: 'ignored-field', message: `'${p.metaKey}' is not an object; ignored`, path: at, ids: [group] });
          const extra = Object.keys(m).filter((k) => k !== p.idKey && k !== p.labelKey && k !== p.metaKey);
          if (extra.length) builder.leftover(at, Object.fromEntries(extra.map((k) => [k, own(m, k)])));
        } else {
          child = coerceString(m, 'member', at, builder);
        }
        if (child === undefined) {
          builder.diag({ severity: 'error', code: 'missing-id', message: 'member has no id; skipped', path: at, ids: [group] });
          builder.leftover(at, m);
          return;
        }
        const id = builder.edge(group, child, { label, meta }, at);
        if (id !== undefined) edgeIds.push(id);
      });
      if (p.order) {
        const keys = positionalOrders(edgeIds.length);
        edgeIds.forEach((id, i) => builder.setOrder(id, keys[i]!));
      }
    }
    return builder.build();
  },

  write(space, p) {
    const out = new Map<string, SnapshotEdge[]>();
    for (const e of space.edges) {
      const list = out.get(e.parent);
      if (list) list.push(e);
      else out.set(e.parent, [e]);
    }
    const touched = new Set(space.edges.flatMap((e) => [e.parent, e.child]));
    const member = (e: SnapshotEdge): unknown =>
      e.label === undefined && e.meta === undefined
        ? e.child
        : Object.fromEntries([[p.idKey, e.child], ...(e.label !== undefined ? [[p.labelKey, e.label]] : []), ...(e.meta !== undefined ? [[p.metaKey, e.meta]] : [])]);
    const entries = space.nodes
      .filter((n) => out.has(n.id) || !touched.has(n.id))
      .map((n) => {
        const edges = (out.get(n.id) ?? []).map((e, i) => ({ e, i })).sort((a, b) => compareOrder(a.e.order, b.e.order) || a.i - b.i);
        return [n.id, edges.map(({ e }) => member(e))] as const;
      });
    return { output: Object.fromEntries(entries) };
  },
});
