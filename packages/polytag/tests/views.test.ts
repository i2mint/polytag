import { describe, expect, it } from 'vitest';
import {
  availableViews,
  createViewMenu,
  DEFAULT_INTERACTION,
  DEFAULT_VIEWS,
  defaultViewMenu,
  GAP_MESSAGES,
  isDirty,
  parseSavedView,
  parseViewConfig,
  ViewConfigSchema,
  viewFromLink,
  viewToLink,
  type SavedView,
} from '../src/views/index.js';

describe('polytag/views: createViewMenu', () => {
  it('keeps the caller-keyed form', () => {
    const menu = createViewMenu((v: { id: string; layout: string }) => v.id);
    expect(menu.list()).toEqual([]);
    menu.register({ id: 'three-pane', layout: 'three-pane' });
    expect(menu.has('three-pane')).toBe(true);
    expect(() => menu.register({ id: 'three-pane', layout: 'x' })).toThrow(/view with key 'three-pane'/);
  });

  it('without a key function, holds view entries keyed by id', () => {
    const menu = defaultViewMenu();
    expect(menu.list().map((e) => e.id)).toEqual(DEFAULT_VIEWS.map((e) => e.id));
  });
});

describe('polytag/views: ViewConfig', () => {
  const view = {
    shell: 'three-pane',
    navigator: { surface: 'facets' },
    layout: { kind: 'board', groupBy: { family: 'status' }, multiValue: 'primary', showEmpty: true },
    inspector: { sections: ['fields', 'memberships'] },
    interaction: DEFAULT_INTERACTION,
  };

  it('parses the ui-patterns §3.7 example (minus the state that moved to SavedView)', () => {
    expect(parseViewConfig(view)).toEqual(view);
  });

  it('requires type-specific settings: a board needs groupBy, a calendar a dateField', () => {
    expect(() => parseViewConfig({ ...view, layout: { kind: 'board', multiValue: 'primary', showEmpty: true } })).toThrow();
    expect(() => parseViewConfig({ ...view, layout: { kind: 'calendar', range: 'month' } })).toThrow();
  });

  it('refuses unknown keys anywhere, so nothing extra rides along', () => {
    expect(ViewConfigSchema.safeParse({ ...view, token: 'sk-x' }).success).toBe(false);
    expect(ViewConfigSchema.safeParse({ ...view, layout: { kind: 'list', apiKey: 'x' } }).success).toBe(false);
  });
});

describe('polytag/views: availableViews', () => {
  it('with nothing known, greys out board, calendar and timeline with their gaps, and ranks the rest', () => {
    const items = availableViews(defaultViewMenu(), {});
    expect(items.map((i) => i.rank)).toEqual([...items.map((i) => i.rank)].sort((a, b) => a - b));
    const disabled = Object.fromEntries(items.filter((i) => !i.enabled).map((i) => [i.id, i.gaps.map((g) => g.code)]));
    expect(disabled).toEqual({
      board: ['needs-family'],
      calendar: ['needs-date-role'],
      timeline: ['needs-start-role'],
    });
    expect(items[0]).toMatchObject({ id: 'three-pane', enabled: true, suggested: true, repairs: '' });
    // A disabled view has no config to apply; every enabled one validates.
    for (const item of items) {
      if (item.enabled) expect(() => parseViewConfig(item.config)).not.toThrow();
      else expect(item.config).toBeUndefined();
    }
  });

  it('offers the gallery degraded, not disabled, without a cover role', () => {
    const gallery = availableViews(DEFAULT_VIEWS, {}).find((i) => i.id === 'gallery')!;
    expect(gallery.enabled).toBe(true);
    expect(gallery.gaps).toEqual([{ code: 'needs-cover-role', blocking: false }]);
    expect(GAP_MESSAGES['needs-cover-role']).toMatch(/cover/);
  });

  it('fills each template from the collection: family, date, cover, start/end', () => {
    const items = availableViews(DEFAULT_VIEWS, {
      roles: { cover: 'thumb', date: 'due', end: 'until' },
      families: [
        { name: 'topic', exclusive: false },
        { name: 'status', exclusive: true },
      ],
    });
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(items.every((i) => i.enabled)).toBe(true);
    expect(byId.board.config!.layout).toEqual({
      kind: 'board',
      groupBy: { family: 'status' },
      multiValue: 'forbid',
      showEmpty: true,
    });
    expect(byId.calendar.config!.layout).toEqual({ kind: 'calendar', dateField: 'due', range: 'month' });
    expect(byId.timeline.config!.layout).toEqual({ kind: 'timeline', startField: 'due', endField: 'until' });
    expect(byId.gallery.config!.layout).toEqual({ kind: 'cards', cover: 'thumb' });
    expect(byId.gallery.gaps).toEqual([]);
  });

  it('every non-default view says which weakness of the default it repairs', () => {
    for (const entry of DEFAULT_VIEWS.slice(1)) expect(entry.repairs.length).toBeGreaterThan(0);
  });
});

describe('polytag/views: SavedView and links', () => {
  const saved: SavedView = {
    name: 'Reading status',
    viewConfig: availableViews(DEFAULT_VIEWS, {}).find((i) => i.id === 'three-pane')!.config!,
    filter: { field: 'read', operator: 'eq', value: false },
    sort: [{ field: 'title', direction: 'asc' }],
    scope: { group: 'papers', descendants: true, includeSmart: false },
  };

  it('round-trips through a URL fragment', () => {
    const link = viewToLink(saved, 'https://example.org/app');
    expect(link.url.startsWith('https://example.org/app#ptview=')).toBe(true);
    expect(link.tier).toBe('portable');
    expect(viewFromLink(link.url)).toEqual(saved);
  });

  it('reads null from a link without a view, and refuses a foreign or tampered payload', () => {
    expect(viewFromLink('https://example.org/app')).toBeNull();
    const link = viewToLink(saved, 'https://example.org/app');
    expect(() => viewFromLink(link.url.replace(/ptview=[^&]*/, 'ptview=j1.e30'))).toThrow();
    expect(viewFromLink('https://example.org/app#view=grid')).toBeNull(); // an app's own param
  });

  it('refuses to encode anything beyond the view, so a secret never reaches a link', () => {
    const leaky = { ...saved, apiKey: 'sk-secret-1234' } as unknown as SavedView;
    expect(() => viewToLink(leaky, 'https://example.org/app')).toThrow();
    const link = viewToLink(saved, 'https://example.org/app');
    expect(link.url).not.toContain('sk-secret');
  });

  it('marks a view dirty structurally, ignoring key order', () => {
    const reordered = parseSavedView(JSON.parse(JSON.stringify({ sort: saved.sort, ...saved })));
    expect(isDirty(saved, reordered)).toBe(false);
    expect(isDirty(saved, { ...saved, sort: [{ field: 'title', direction: 'desc' }] })).toBe(true);
  });
});

describe('polytag/views: review regressions', () => {
  it('a board over a non-exclusive family is offered degraded, duplicating multi-tagged cards', () => {
    const board = availableViews(DEFAULT_VIEWS, { families: [{ name: 'topic', exclusive: false }] }).find((i) => i.id === 'board')!;
    expect(board.enabled).toBe(true);
    expect(board.gaps).toEqual([{ code: 'needs-exclusive-family', blocking: false }]);
    expect(board.config!.layout).toMatchObject({ groupBy: { family: 'topic' }, multiValue: 'duplicate' });
  });

  it('a timeline with a date but no end is offered degraded', () => {
    const tl = availableViews(DEFAULT_VIEWS, { roles: { date: 'd' } }).find((i) => i.id === 'timeline')!;
    expect(tl).toMatchObject({ enabled: true, gaps: [{ code: 'needs-end-role', blocking: false }] });
  });

  it('triage stays available but is not suggested when items are never tagged', () => {
    const triage = (caps: { maxGroupsPerItem?: number | null }) => availableViews(DEFAULT_VIEWS, caps).find((i) => i.id === 'triage')!;
    expect(triage({ maxGroupsPerItem: 0 })).toMatchObject({ enabled: true, suggested: false });
    expect(triage({ maxGroupsPerItem: null })).toMatchObject({ enabled: true, suggested: true });
  });

  it('greys out an entry whose config does not validate or that throws, instead of breaking the menu', () => {
    const board = availableViews(DEFAULT_VIEWS, { families: [{ name: '', exclusive: true }] }).find((i) => i.id === 'board')!;
    expect(board).toMatchObject({ enabled: false, gaps: [{ code: 'invalid-config', blocking: true }] });
    const boom = { id: 'boom', rank: 0, label: 'x', repairs: 'x', gaps: () => { throw new Error('no'); }, config: () => { throw new Error('no'); } };
    expect(availableViews([boom], {})[0]).toMatchObject({ enabled: false, gaps: [{ code: 'invalid-config', blocking: true }] });
  });

  it('hands out configs that can be edited, and default entries that cannot', () => {
    const [first] = availableViews(DEFAULT_VIEWS, {});
    first!.config!.interaction.tagCommit = 'staged';
    expect(DEFAULT_INTERACTION.tagCommit).toBe('immediate');
    expect(() => {
      (DEFAULT_VIEWS[0] as { rank: number }).rank = 99;
    }).toThrow();
  });

  it('always puts a view in the fragment, never the query string', () => {
    const saved = { name: 'v', viewConfig: availableViews(DEFAULT_VIEWS, {})[0]!.config! };
    const link = viewToLink(saved, 'https://example.org/app', { part: 'search' } as never);
    expect(new URL(link.url).search).toBe('');
    expect(viewFromLink(link.url)).toEqual(saved);
  });
});
