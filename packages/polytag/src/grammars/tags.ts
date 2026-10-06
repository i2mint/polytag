/**
 * `tags-array` (b) and `tag-paths` (c): items listing their groups.
 *
 * ```json
 * [{ "id": "carbonara", "tags": ["italian", "quick"] }, { "id": "notes", "tags": [] }]
 * ```
 *
 * `tags-array` is flat: a group → group edge cannot be written (RD keeps 7 of 9 edges), and
 * group metadata, edge labels and group-major order are gone (formats-and-grammars §3(b)).
 * `tag-paths` writes each group as its root path (`food/italian`), which carries nesting;
 * a group with several parents is written as several paths (a convention: Obsidian reads
 * `food/italian` and `quick/italian` as two tags). Both read the records shape (an array, or
 * under `rootKey` where the format needs a table at the top, as TOML does) and the map shape
 * (`{ carbonara: [italian, quick] }`).
 */

import { z } from 'zod';
import { isPlainObject } from '../formats/index.js';
import { type Detection, defineGrammar, type GrammarCodec, noDetection } from '../grammar.js';
import type { GrammarCapabilities } from '../loss.js';
import { createSpaceBuilder } from './shared/builder.js';
import { type PathOptions, createFlatReader, flatRecords } from './shared/flat.js';
import { coerceString, own, readNodeData, type RecordLayout, writeRecord } from './shared/records.js';
import { LEXICON, dominantSeparator, inLexicon, isScalar, listFields, pickIdKey, recordArray } from './shared/shape.js';

const VALUE_FORMATS = ['json', 'jsonc', 'yaml', 'toml'] as const;

const baseParams = {
  /** Record field holding the item id. */
  idKey: z.string().min(1).default('id'),
  /** Record field holding the list of groups. */
  tagsKey: z.string().min(1).default('tags'),
  /** Record field holding the item label. */
  labelKey: z.string().min(1).default('label'),
  /** `records`: an array of objects; `map`: `{ itemId: [tags] }` (no item payload). */
  shape: z.enum(['records', 'map']).default('records'),
  /** Key the records array is written under when the format cannot hold a top-level array (TOML). */
  rootKey: z.string().min(1).default('items'),
};

/** Params of `tags-array`. */
export const tagsArrayParams = z.object(baseParams);
export type TagsArrayParams = z.infer<typeof tagsArrayParams>;

/** Params of `tag-paths`. */
export const tagPathsParams = z.object({
  ...baseParams,
  /** Path separator: `/` (Obsidian), `|` (Lightroom), `:` (Hydrus namespaces). */
  separator: z.string().min(1).default('/'),
  /** `leafOnly`: write the path to each group; `materialised`: also every ancestor path (Lightroom). */
  mode: z.enum(['leafOnly', 'materialised']).default('leafOnly'),
});
export type TagPathsParams = z.infer<typeof tagPathsParams>;

/** Item-major, no nesting. */
const FLAT: GrammarCapabilities = {
  itemsMultiParent: 'native',
  nestedGroups: 'no',
  groupsMultiParent: 'no',
  groupMeta: 'no',
  itemMeta: 'native',
  edgeOrder: 'item-major',
  edgeLabel: 'no',
  edgeMeta: 'no',
  isolatedNodes: 'native',
  edgeKinds: 'single',
  edgeIds: 'no',
  identity: 'token',
};

const PATHS: GrammarCapabilities = { ...FLAT, nestedGroups: 'native', groupsMultiParent: 'convention', identity: 'path' };

type CommonParams = TagsArrayParams & Partial<Pick<TagPathsParams, 'separator' | 'mode'>>;

function itemTagsGrammar<P extends CommonParams>(options: {
  id: 'tags-array' | 'tag-paths';
  label: string;
  description: string;
  params: z.ZodType<P>;
  caps: GrammarCapabilities;
  pathsOf: (p: P) => PathOptions | undefined;
}): GrammarCodec<P> {
  const { id, pathsOf } = options;
  const layoutOf = (p: P): RecordLayout => ({ idKey: p.idKey, labelKey: p.labelKey, structural: [p.tagsKey] });

  return defineGrammar<P>({
    id,
    label: options.label,
    description: options.description,
    inputs: ['value'],
    formats: VALUE_FORMATS,
    params: options.params,
    capabilities: (p) => (p.shape === 'map' ? { ...options.caps, itemMeta: 'no' } : options.caps),

    detect(input): Detection<P> {
      const found = recordArray(input);
      const paths = id === 'tag-paths';
      const judge = (tags: readonly string[]): { sep: string; pathScore: number } => {
        const { separator, share } = dominantSeparator(tags);
        return { sep: separator, pathScore: share };
      };
      if (found && found.array.length && found.array.every((r) => isPlainObject(r) || typeof r === 'string')) {
        const objects = found.array.filter(isPlainObject);
        const [field] = listFields(objects);
        if (!field) return noDetection();
        const idKey = pickIdKey(objects, [field.key]);
        const { sep, pathScore } = judge(field.values);
        const structural = field.coverage * (paths ? Math.min(1, pathScore / 0.3) : 1 - Math.min(1, pathScore / 0.3) * 0.8);
        const name = inLexicon(field.key, LEXICON.tags) ? 1 : 0.3 + 0.4 * field.repetition;
        const integrity = idKey ? 1 : 0.4;
        const evidence = [
          `${found.array.length} records${found.key ? ` under '${found.key}'` : ''}; '${field.key}' is a list in ${Math.round(field.coverage * 100)}% of them`,
          ...(paths || pathScore ? [`${Math.round(pathScore * 100)}% of tags contain '${sep}'`] : []),
          idKey ? `'${idKey}' is a unique id` : 'no unique id field',
        ];
        const suggested = { tagsKey: field.key, ...(idKey ? { idKey } : {}), ...(found.key ? { rootKey: found.key } : {}), ...(paths ? { separator: sep } : {}) };
        return { score: 0.5 * structural + 0.3 * name + 0.2 * integrity, evidence, suggestedParams: suggested as Partial<P> };
      }
      if (isPlainObject(input)) {
        // Map shape: { item: [groups] }. Keys are items; tags repeat and are rarely keys themselves.
        const entries = Object.entries(input);
        if (!entries.length || !entries.every(([, v]) => v === null || (Array.isArray(v) && v.every(isScalar)))) return noDetection();
        const values = entries.flatMap(([, v]) => (v as unknown[] | null) ?? []).map(String);
        const distinct = new Set(values);
        const keysAsValues = entries.filter(([k]) => distinct.has(k)).length / entries.length;
        const empties = entries.filter(([, v]) => !v || !(v as unknown[]).length).length;
        const { sep, pathScore } = judge(values);
        // Items outnumber their groups; equal counts are ambiguous with a group → members map.
        const itemSide = Math.min(1, (entries.length > distinct.size ? 1 : entries.length === distinct.size ? 0.6 : 0.3) + (empties ? 0.2 : 0));
        const structural = (1 - keysAsValues) * itemSide * (paths ? Math.min(1, pathScore / 0.3) : 1 - Math.min(1, pathScore / 0.3) * 0.8);
        const evidence = [
          `a map of ${entries.length} keys to lists (${distinct.size} distinct values, ${Math.round(keysAsValues * 100)}% of keys are also values)`,
          ...(empties ? [`${empties} key(s) with an empty list (orphan items)`] : []),
          ...(paths || pathScore ? [`${Math.round(pathScore * 100)}% of values contain '${sep}'`] : []),
        ];
        const suggested = { shape: 'map', ...(paths ? { separator: sep } : {}) };
        return { score: 0.5 * structural + 0.3 * 0.3 + 0.2 * itemSide, evidence, suggestedParams: suggested as Partial<P> };
      }
      return noDetection();
    },

    parse(input, p) {
      const builder = createSpaceBuilder();
      const reader = createFlatReader(builder, pathsOf(p));
      const layout = layoutOf(p);
      const readTags = (raw: unknown, item: string, path: string): string[] => {
        if (raw === undefined || raw === null) return [];
        if (typeof raw === 'string') {
          builder.diag({ severity: 'warning', code: 'shape', message: `'${p.tagsKey}' is a string, read as one tag`, path, ids: [item] });
          return [raw];
        }
        if (!Array.isArray(raw)) {
          builder.diag({ severity: 'warning', code: 'ignored-field', message: `'${p.tagsKey}' is not a list; ignored`, path, ids: [item] });
          return [];
        }
        return raw.flatMap((t, i) => {
          if (t === null || t === undefined) {
            builder.diag({ severity: 'info', code: 'empty-token', message: 'an empty tag was skipped', path: `${path}/${i}`, ids: [item] });
            return [];
          }
          const s = coerceString(t, 'tag', `${path}/${i}`, builder);
          if (s === undefined) builder.diag({ severity: 'warning', code: 'ignored-field', message: 'a tag is not a scalar; ignored', path: `${path}/${i}`, ids: [item] });
          return s === undefined ? [] : [s];
        });
      };

      const found = p.shape === 'records' || !isPlainObject(input) ? recordArray(input, p.rootKey) : undefined;
      if (found) {
        for (const [k, v] of found.rest) builder.leftover(`/${k}`, v);
        const base = found.key !== undefined ? `/${found.key}` : '';
        found.array.forEach((record, i) => {
          const path = `${base}/${i}`;
          if (isScalar(record)) {
            const item = coerceString(record, 'id', path, builder)!;
            builder.node(item);
            return;
          }
          if (!isPlainObject(record)) {
            builder.diag({ severity: 'warning', code: 'shape', message: 'not a record; skipped', path });
            builder.leftover(path, record);
            return;
          }
          const item = coerceString(own(record, p.idKey), 'id', `${path}/${p.idKey}`, builder);
          if (item === undefined) {
            builder.diag({ severity: 'error', code: 'missing-id', message: `record has no '${p.idKey}'; skipped`, path, hint: 'set the idKey param' });
            builder.leftover(path, record);
            return;
          }
          builder.node(item, readNodeData(record, layout, path, builder), path);
          reader.memberships(item, readTags(own(record, p.tagsKey), item, `${path}/${p.tagsKey}`), `${path}/${p.tagsKey}`);
        });
      } else if (isPlainObject(input)) {
        for (const [item, raw] of Object.entries(input)) {
          builder.node(item);
          reader.memberships(item, readTags(raw, item, `/${item}`), `/${item}`);
        }
      } else {
        builder.diag({ severity: 'error', code: 'shape', message: `expected a list of records or a map of item → ${p.tagsKey}`, path: '' });
        builder.leftover('', input);
      }
      return builder.build();
    },

    write(space, p, ctx) {
      const { records, losses } = flatRecords(space, pathsOf(p));
      if (p.shape === 'map') return { output: Object.fromEntries(records.map((r) => [r.node.id, [...r.tags]])), losses };
      const layout = layoutOf(p);
      const array = records.map((r) => writeRecord(r.node, layout, [[p.tagsKey, [...r.tags]]]));
      return { output: ctx.rootArray === false ? Object.fromEntries([[p.rootKey, array]]) : array, losses };
    },
  });
}

/** `tags-array`: items with a list of (flat) tags. */
export const tagsArray = itemTagsGrammar<TagsArrayParams>({
  id: 'tags-array',
  label: 'Items with a tags array',
  description: 'Each item lists its groups. Flat: group → group edges, group metadata and group order are not written.',
  params: tagsArrayParams,
  caps: FLAT,
  pathsOf: () => undefined,
});

/** `tag-paths`: items with path-string tags (`food/italian`). */
export const tagPaths = itemTagsGrammar<TagPathsParams>({
  id: 'tag-paths',
  label: 'Items with path tags',
  description: 'Each item lists the paths of its groups (food/italian); prefixes give the nesting. Group metadata and group order are not written.',
  params: tagPathsParams,
  caps: PATHS,
  pathsOf: (p) => ({ separator: p.separator, mode: p.mode }),
});
