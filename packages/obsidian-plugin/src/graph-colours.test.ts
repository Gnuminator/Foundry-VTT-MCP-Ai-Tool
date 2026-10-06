import { describe, expect, it } from 'vitest';

import {
  ADVENTURE_PALETTE,
  LIBRARY_GREY,
  campaignRootOf,
  isOurGroup,
  libraryRootOf,
  mergeGraphColourGroups,
  ourGroups,
  type HubInfo,
} from './graph-colours.js';

const strahd: HubInfo = {
  path: 'Campaigns/w1/AI Tool/Foundry/Adventures/Curse of Strahd.md',
  folders: ['AI Tool/Foundry/Journals/Curse of Strahd', 'AI Tool/Foundry/Scenes/Curse of Strahd/'],
};
const rime: HubInfo = {
  path: 'Campaigns/w1/AI Tool/Foundry/Adventures/Rime.md',
  folders: ['AI Tool/Foundry/Journals/Rime'],
};
const rootHub: HubInfo = {
  path: 'AI Tool/Foundry/Adventures/Solo.md',
  folders: ['AI Tool/Foundry/Journals/Solo'],
};

const userGroup = { query: 'tag:#npc', color: { a: 1, rgb: 123 } };

describe('campaignRootOf', () => {
  it('returns the part before AI Tool/Foundry/Adventures/', () => {
    expect(campaignRootOf(strahd.path)).toBe('Campaigns/w1');
  });
  it('returns an empty string at the vault root', () => {
    expect(campaignRootOf(rootHub.path)).toBe('');
  });
  it('returns null for paths that are not hub paths', () => {
    expect(campaignRootOf('Campaigns/w1/AI Tool/Foundry/Journals/X.md')).toBeNull();
    expect(campaignRootOf('Campaigns/w1/AI Tool/Foundry/Adventures/sub/X.md')).toBeNull();
    expect(campaignRootOf('Campaigns/w1/AI Tool/Foundry/Adventures/X.txt')).toBeNull();
    expect(campaignRootOf('XAI Tool/Foundry/Adventures/X.md')).toBeNull();
    expect(campaignRootOf('')).toBeNull();
  });
});

describe('libraryRootOf', () => {
  it('finds the root of a library note', () => {
    expect(libraryRootOf('Campaigns/w1/AI Tool/Library/PHB/PHB.md')).toBe('Campaigns/w1');
    expect(libraryRootOf('AI Tool/Library/PHB/PHB.md')).toBe('');
    expect(libraryRootOf('Campaigns/w1/AI Tool/Foundry/Journals/X.md')).toBeNull();
  });
});

describe('ourGroups', () => {
  it('makes one group per hub, sorted by hub path, then a grey Library group per root', () => {
    const groups = ourGroups([strahd, rime], []);
    expect(groups).toEqual([
      {
        query:
          'path:"Campaigns/w1/AI Tool/Foundry/Adventures/Curse of Strahd.md" OR path:"Campaigns/w1/AI Tool/Foundry/Journals/Curse of Strahd/" OR path:"Campaigns/w1/AI Tool/Foundry/Scenes/Curse of Strahd/"',
        color: { a: 1, rgb: ADVENTURE_PALETTE[0] },
      },
      {
        query:
          'path:"Campaigns/w1/AI Tool/Foundry/Adventures/Rime.md" OR path:"Campaigns/w1/AI Tool/Foundry/Journals/Rime/"',
        color: { a: 1, rgb: ADVENTURE_PALETTE[1] },
      },
      { query: 'path:"Campaigns/w1/AI Tool/Library/"', color: { a: 1, rgb: LIBRARY_GREY } },
    ]);
    expect(LIBRARY_GREY).toBe(0x8a8a8a);
  });

  it('sorts regardless of input order and wraps the palette', () => {
    const hubs = Array.from({ length: 12 }, (_, i) => ({
      path: `Campaigns/w/AI Tool/Foundry/Adventures/A${String(i).padStart(2, '0')}.md`,
      folders: [],
    }));
    const groups = ourGroups([...hubs].reverse(), []);
    expect(groups).toHaveLength(13);
    expect(groups[0]?.query).toBe('path:"Campaigns/w/AI Tool/Foundry/Adventures/A00.md"');
    expect(groups[10]?.color.rgb).toBe(ADVENTURE_PALETTE[0]);
    expect(groups[11]?.color.rgb).toBe(ADVENTURE_PALETTE[1]);
    expect(new Set(ADVENTURE_PALETTE).size).toBe(10);
  });

  it('does not let a folder match a longer folder name', () => {
    const [group] = ourGroups([strahd], []);
    expect(group?.query).toContain('Journals/Curse of Strahd/"');
    expect(group?.query).not.toContain('Journals/Curse of Strahd"');
  });

  it('handles a vault root campaign (no leading slash)', () => {
    const groups = ourGroups([rootHub], []);
    expect(groups[0]?.query).toBe(
      'path:"AI Tool/Foundry/Adventures/Solo.md" OR path:"AI Tool/Foundry/Journals/Solo/"'
    );
    expect(groups[1]?.query).toBe('path:"AI Tool/Library/"');
  });

  it('adds Library roots from the library notes and does not repeat a root', () => {
    const groups = ourGroups([strahd], ['Campaigns/w1', 'Campaigns/w2', '']);
    const queries = groups.map(g => g.query);
    expect(queries.filter(q => q.includes('AI Tool/Library/'))).toEqual([
      'path:"AI Tool/Library/"',
      'path:"Campaigns/w1/AI Tool/Library/"',
      'path:"Campaigns/w2/AI Tool/Library/"',
    ]);
  });

  it('skips a hub whose path is not a hub path', () => {
    expect(ourGroups([{ path: 'Notes/x.md', folders: [] }], [])).toEqual([]);
  });
});

describe('isOurGroup', () => {
  it('recognises hub and library queries only', () => {
    const [hub, , lib] = ourGroups([strahd, rime], []);
    expect(isOurGroup(hub)).toBe(true);
    expect(isOurGroup(lib)).toBe(true);
    expect(isOurGroup({ query: 'path:"AI Tool/Library/"', color: { a: 1, rgb: 1 } })).toBe(true);
    expect(isOurGroup(userGroup)).toBe(false);
    expect(isOurGroup({ query: 'path:"Journal/"' })).toBe(false);
    expect(isOurGroup({ query: 'path:"AI Tool/Library/Books/"' })).toBe(false);
    expect(isOurGroup({})).toBe(false);
    expect(isOurGroup(null)).toBe(false);
    expect(isOurGroup('x')).toBe(false);
  });
});

describe('mergeGraphColourGroups', () => {
  const groups = ourGroups([strahd, rime], []);

  it('puts the user groups first and keeps every other key', () => {
    const graph = { search: 'x', showTags: true, colorGroups: [userGroup] };
    const { json, added, kept } = mergeGraphColourGroups(graph, groups);
    expect(json.colorGroups).toEqual([userGroup, ...groups]);
    expect(json.search).toBe('x');
    expect(json.showTags).toBe(true);
    expect(added).toBe(3);
    expect(kept).toBe(1);
  });

  it('replaces our old groups instead of duplicating them', () => {
    const first = mergeGraphColourGroups({ colorGroups: [userGroup] }, groups).json;
    const second = mergeGraphColourGroups(first, ourGroups([rime], [])).json;
    const list = second.colorGroups as { query: string }[];
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual(userGroup);
    expect(list.some(g => g.query.includes('Curse of Strahd'))).toBe(false);
  });

  it('keeps the user groups ahead of ours even when ours were first in the file', () => {
    const graph = { colorGroups: [...groups, userGroup] };
    const { json } = mergeGraphColourGroups(graph, groups);
    expect((json.colorGroups as unknown[])[0]).toEqual(userGroup);
  });

  it('keeps a colour the user changed', () => {
    const recoloured = groups.map((g, i) => (i === 0 ? { ...g, color: { a: 0.5, rgb: 42 } } : g));
    const { json } = mergeGraphColourGroups({ colorGroups: recoloured }, groups);
    const list = json.colorGroups as { color: { a: number; rgb: number } }[];
    expect(list[0]?.color).toEqual({ a: 0.5, rgb: 42 });
    expect(list[1]?.color).toEqual(groups[1]?.color);
  });

  it('keeps the colour when the hub gains a folder (same hub path)', () => {
    const recoloured = [{ ...groups[0], color: { a: 1, rgb: 7 } }];
    const wider = ourGroups(
      [{ ...strahd, folders: [...strahd.folders, 'AI Tool/Foundry/Actors'] }],
      []
    );
    const { json } = mergeGraphColourGroups({ colorGroups: recoloured }, wider);
    const list = json.colorGroups as { query: string; color: { rgb: number } }[];
    expect(list[0]?.query).toContain('Actors/');
    expect(list[0]?.color.rgb).toBe(7);
  });

  it('is idempotent', () => {
    const once = mergeGraphColourGroups({ colorGroups: [userGroup], other: 1 }, groups);
    const twice = mergeGraphColourGroups(once.json, groups);
    expect(twice.json).toEqual(once.json);
    expect(twice.kept).toBe(1);
    expect(twice.added).toBe(3);
  });

  it('handles a vault root campaign', () => {
    const rootGroups = ourGroups([rootHub], []);
    const once = mergeGraphColourGroups({}, rootGroups);
    expect(mergeGraphColourGroups(once.json, rootGroups).json).toEqual(once.json);
  });

  it.each([null, undefined, 'text', 5, [], [1, 2], { colorGroups: 'nope' }, { colorGroups: null }])(
    'treats %j as an empty graph.json',
    input => {
      const { json, kept } = mergeGraphColourGroups(input, groups);
      expect(json).toEqual({ colorGroups: groups });
      expect(kept).toBe(0);
    }
  );

  it('keeps odd entries in colorGroups as user groups', () => {
    const { json, kept } = mergeGraphColourGroups({ colorGroups: [5, null, userGroup] }, groups);
    expect((json.colorGroups as unknown[]).slice(0, 3)).toEqual([5, null, userGroup]);
    expect(kept).toBe(3);
  });

  it('does not change its input', () => {
    const graph = { colorGroups: [userGroup, ...groups] };
    const copy = JSON.parse(JSON.stringify(graph)) as unknown;
    mergeGraphColourGroups(graph, groups);
    expect(graph).toEqual(copy);
  });
});
