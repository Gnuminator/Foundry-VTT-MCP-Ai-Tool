import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestWorld,
  makeActor,
  makeJournal,
  makeJournalPage,
  type TestWorld,
} from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';
import { parseAllowlist, queryTerms, stem } from './data-access/rules-search.js';

let world: TestWorld;
let restore: () => void;
let da: FoundryDataAccess;
let allowlistSetting: string | undefined;

const GRAPPLE_HTML =
  '<h2>Grappling</h2><p>You can use the Attack action to make a <strong>Grapple</strong> unarmed strike. A @UUID[Compendium.x.y.z]{Grappled} target has Speed 0.</p>';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  allowlistSetting = undefined;
  const settings = (globalThis as any).game.settings;
  settings.get = (_ns: string, key: string): unknown =>
    key === 'rulesSearchPacks' ? allowlistSetting : undefined;

  world.addPack({
    id: 'dnd-players-handbook.content',
    label: "Player's Handbook",
    type: 'JournalEntry',
    documents: [
      makeJournal({
        id: 'phbj1',
        name: 'Playing the Game',
        pages: [
          makeJournalPage({ id: 'pg1', name: 'Grapple', text: { content: GRAPPLE_HTML } }),
          makeJournalPage({
            id: 'pg2',
            name: 'Resting',
            text: { content: '<p>A short rest lasts one hour.</p>' },
          }),
        ],
      }),
    ],
  });
  world.addPack({
    id: 'dnd5e.spells',
    label: 'Spells',
    type: 'Item',
    documents: [
      makeActor({
        id: 'sp1',
        name: 'Shield',
        type: 'spell',
        system: {
          description: { value: '<p>An invisible barrier of magical force protects you.</p>' },
        },
      }),
    ],
  });
  world.addPack({
    id: 'curse-of-strahd.book',
    label: 'Curse of Strahd',
    type: 'JournalEntry',
    documents: [
      makeJournal({
        id: 'cosj1',
        name: 'Castle Ravenloft',
        pages: [
          makeJournalPage({
            id: 'cp1',
            name: 'K1',
            text: { content: '<p>Strahd grapples the intruder.</p>' },
          }),
        ],
      }),
    ],
  });
  world.addJournal({
    id: 'wj1',
    name: 'Session notes',
    pages: [
      makeJournalPage({
        id: 'wp1',
        name: 'Notes',
        text: { content: '<p>The party grapples a wolf.</p>' },
      }),
    ],
  });
  da = new FoundryDataAccess();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

describe('search-rules text helpers', () => {
  it('stems grappling, grappled and grapple to the same word', () => {
    expect(new Set(['grappling', 'grappled', 'grapple', 'grapples'].map(stem)).size).toBe(1);
  });
  it('drops filler words from a question', () => {
    expect(queryTerms('how does grappling work')).toEqual([stem('grappling')]);
  });
  it('falls back to the default packages for an empty setting', () => {
    expect(parseAllowlist('')).toContain('dnd-players-handbook');
    expect(parseAllowlist('a, b.c')).toEqual(['a', 'b.c']);
  });
});

describe('FoundryDataAccess.searchRules', () => {
  it('finds the PHB page for "how does grappling work" with a snippet and ids', async () => {
    const res = await da.searchRules({ query: 'how does grappling work' });
    expect(res.results[0]).toMatchObject({
      source: 'compendium',
      packId: 'dnd-players-handbook.content',
      documentId: 'phbj1',
      pageId: 'pg1',
      pageName: 'Grapple',
    });
    expect(res.results[0].snippet).toContain('Grapple');
    expect(res.results[0].snippet).not.toContain('<');
    expect(res.results[0].snippet).not.toContain('@UUID');
  });

  it('searches Item descriptions', async () => {
    const res = await da.searchRules({ query: 'invisible barrier' });
    expect(res.results.map(r => r.documentId)).toEqual(['sp1']);
  });

  it('leaves adventure packs and world journals out by default', async () => {
    const res = await da.searchRules({ query: 'grapples' });
    const ids = res.results.map(r => r.documentId);
    expect(ids).not.toContain('cosj1');
    expect(ids).not.toContain('wj1');
    expect(res.searchedPacks).not.toContain('curse-of-strahd.book');
  });

  it('includes world journals and other packs only when asked', async () => {
    const res = await da.searchRules({
      query: 'grapples',
      includeWorld: true,
      includeOtherBooks: true,
    });
    const ids = res.results.map(r => r.documentId);
    expect(ids).toContain('cosj1');
    expect(ids).toContain('wj1');
    expect(res.results.find(r => r.documentId === 'wj1')?.source).toBe('world');
  });

  it('honours the allowlist setting', async () => {
    allowlistSetting = 'curse-of-strahd';
    const res = await da.searchRules({ query: 'grapples' });
    expect(res.results.map(r => r.documentId)).toEqual(['cosj1']);
  });

  it('rejects a query with no searchable words', async () => {
    await expect(da.searchRules({ query: 'how does' })).rejects.toThrow(/searchable/);
  });

  it('explains an empty result', async () => {
    const res = await da.searchRules({ query: 'zzzzqq' });
    expect(res.results).toEqual([]);
    expect(res.note).toMatch(/includeWorld/);
  });
});
