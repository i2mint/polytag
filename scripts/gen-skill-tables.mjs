#!/usr/bin/env node
/**
 * Regenerate the menus in `skills/polytag/SKILL.md` from the registries, so the shipped skill
 * cannot drift from the code: formats (`polytag/formats`), grammars and the format × grammar
 * matrix (root entry), and the zodal-groups profiles (`@zodal/groups-core` `PROFILES`).
 *
 * Each table sits between `<!-- BEGIN generated:<name> -->` and `<!-- END generated:<name> -->`.
 * Reads the BUILT package, so run `pnpm build` first.
 *
 *   node scripts/gen-skill-tables.mjs           rewrite the tables in place
 *   node scripts/gen-skill-tables.mjs --check   exit 1 if any table is out of date (CI)
 */

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = join(ROOT, 'packages/polytag');
export const SKILL_PATH = join(ROOT, 'skills/polytag/SKILL.md');

const load = (rel) => import(pathToFileURL(join(PKG, rel)).href);

/** `@zodal/groups-core` as the package itself resolves it (a peer, installed for development). */
async function loadGroupsCore() {
  const require = createRequire(join(PKG, 'package.json'));
  return import(pathToFileURL(require.resolve('@zodal/groups-core')).href);
}

/**
 * What each profile is for: the one hand-written column (`null`: deprecated, left out). A profile
 * missing here fails the generator, so a new profile cannot ship without a line in the skill.
 */
const PROFILE_USES = {
  filesystem: 'folders: an item, and a folder, in exactly one place',
  flatTags: 'flat tags: many per item, no tags on tags',
  nestedTags: 'nested tags (`a/b`): many per item, the tag tree is a tree',
  labels: 'Gmail labels: many per item, the label tree is a tree',
  polyhierarchy: 'the general case: items and groups in several groups',
  taxonomy: null, // deprecated in groups-core: it cannot hold a space with an edge
  thesaurus: 'typed edges (`is_a`, `part_of`, `related`) with closure per kind',
  folksonomy: 'flat tags whose memberships are per user',
};

const cell = (v) => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head, rows) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
const list = (xs) => (xs.length ? xs.map((x) => `\`${x}\``).join(', ') : '—');

/** Every generated table, by marker name. */
export async function renderTables() {
  const formats = await load('dist/formats.js');
  const root = await load('dist/index.js');
  const groups = await loadGroupsCore();

  const formatRegistry = formats.createFormatRegistry();
  const grammarRegistry = root.createGrammarRegistry();
  const matrix = root.compatibility(grammarRegistry, formatRegistry);

  const formatRows = formatRegistry.list().map((f) => {
    const d = root.FORMAT_DEFAULTS[f.id];
    return [`\`${f.id}\``, f.label, list(f.extensions), f.kind, d ? `\`${d.import}\`` : '—', d ? `\`${d.export}\`` : '—'];
  });

  // A grammar keeps a feature when its capability is `yes` / `native` (or an order it keeps). A
  // capability can depend on the format (YAML anchors are native, JSON copies a convention), so
  // each cell is computed per compatible format and split when the formats disagree.
  const keeps = (v) => (v === 'yes' || v === 'native' || v === 'group-major' ? 'yes' : v === 'no' || v === 'single' ? 'no' : v);
  const COLUMNS = ['itemsMultiParent', 'nestedGroups', 'groupsMultiParent', 'groupMeta', 'edgeKinds'];
  const grammarRows = grammarRegistry.list().map((g) => {
    const fmts = matrix[g.id] ?? [];
    const cells = COLUMNS.map((key) => {
      const byValue = new Map();
      for (const f of fmts) {
        const v = keeps(g.capabilitiesFor(undefined, f)[key]);
        byValue.set(v, [...(byValue.get(v) ?? []), f]);
      }
      if (byValue.size <= 1) return [...byValue.keys()][0] ?? keeps(g.capabilities[key]);
      return [...byValue].map(([v, fs]) => `${v} (${fs.join(', ')})`).join('; ');
    });
    return [`\`${g.id}\``, g.description, list(fmts), ...cells];
  });

  const n = (v) => (v === null || v === Infinity || v === undefined ? 'any' : v);
  const yn = (v) => (v ? 'yes' : 'no');
  // Deprecated profiles are left out: groups-core's own list when it has one (0.1.0 does not), and
  // a `null` use below otherwise.
  const deprecated = groups.DEPRECATED_PROFILES ?? {};
  const profileRows = Object.values(groups.PROFILES)
    .filter((p) => !(p.name in deprecated))
    .filter((p) => {
      if (!(p.name in PROFILE_USES)) throw new Error(`profile '${p.name}' has no entry in PROFILE_USES: say what it is for`);
      return PROFILE_USES[p.name] !== null;
    })
    .map((p) => [
      `\`${p.name}\``,
      PROFILE_USES[p.name],
      n(p.maxParentsPerItem),
      n(p.maxParentsPerGroup),
      n(p.maxDepth),
      yn(p.groupsMayContainGroups),
      yn(p.groupsMayContainItems),
      yn(p.ordered),
    ]);

  return {
    formats: table(['format', 'name', 'extensions', 'reads as', 'import default', 'export default'], formatRows),
    grammars: table(
      ['grammar', 'what it is', 'formats', 'item in several groups', 'nested groups', 'group in several groups', 'group metadata', 'typed edges'],
      grammarRows,
    ),
    profiles: table(['profile', 'for', 'parents per item', 'parents per group', 'group depth', 'groups in groups', 'items in groups', 'ordered'], profileRows),
  };
}

/** `text` with each generated block replaced. Throws on a missing or unknown marker. */
export function fill(text, tables) {
  const seen = new Set();
  const out = text.replace(/(<!-- BEGIN generated:(\w+) -->\n)[\s\S]*?(<!-- END generated:\2 -->)/g, (_m, open, name, close) => {
    if (!(name in tables)) throw new Error(`unknown generated block '${name}'`);
    seen.add(name);
    return `${open}${tables[name]}\n${close}`;
  });
  const missing = Object.keys(tables).filter((k) => !seen.has(k));
  if (missing.length) throw new Error(`SKILL.md has no generated block for: ${missing.join(', ')}`);
  return out;
}

// Compare real paths: run through a symlink, `argv[1]` is the link and the check would silently skip.
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  const check = process.argv.includes('--check');
  const text = readFileSync(SKILL_PATH, 'utf8');
  const next = fill(text, await renderTables());
  if (check) {
    if (next !== text) {
      console.error('skills/polytag/SKILL.md is out of date: run `node scripts/gen-skill-tables.mjs` (after `pnpm build`).');
      process.exit(1);
    }
    console.log('skills/polytag/SKILL.md tables are up to date.');
  } else if (next !== text) {
    writeFileSync(SKILL_PATH, next);
    console.log('skills/polytag/SKILL.md: tables regenerated.');
  } else {
    console.log('skills/polytag/SKILL.md: already up to date.');
  }
}
