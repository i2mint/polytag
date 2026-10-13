/**
 * The shipped skill's menus are generated from the registries (i2mint/polytag#6): this fails
 * when `skills/polytag/SKILL.md` drifts from them. Needs the built package (`pnpm build`).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fill, renderTables, SKILL_PATH } from './gen-skill-tables.mjs';

describe('skills/polytag/SKILL.md', () => {
  it('has every generated table up to date', async () => {
    const text = readFileSync(SKILL_PATH, 'utf8');
    expect(fill(text, await renderTables()), 'run `node scripts/gen-skill-tables.mjs`').toBe(text);
  });

  it('starts with spec-clean frontmatter (name matches the folder, a description)', () => {
    const text = readFileSync(SKILL_PATH, 'utf8');
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '';
    expect(front).toMatch(/^name: polytag$/m);
    expect(front).toMatch(/^description: .{40,1024}$/m);
  });

  it('refuses a SKILL.md that lost a generated block, or names an unknown one', () => {
    expect(() => fill('no markers', { formats: 'x' })).toThrow(/no generated block for: formats/);
    expect(() => fill('<!-- BEGIN generated:nope -->\n<!-- END generated:nope -->', {})).toThrow(/unknown generated block 'nope'/);
  });
});
