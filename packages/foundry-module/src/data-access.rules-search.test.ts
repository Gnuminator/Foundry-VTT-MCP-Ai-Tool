import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestWorld,
  makeActor,
  makeJournal,
  makeJournalPage,
  type TestWorld,
} from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';
import {
  parseAllowlist,
  plainText,
  queryTerms,
  stem,
  termPattern,
} from './data-access/rules-search.js';

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
          description: { value: '<p>A glimmering dome of force surrounds the caster.</p>' },
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

describe('plainText', () => {
  it('keeps roll arguments, reference names and table cells; decodes entities in order', () => {
    expect(plainText('<p>Take [[/damage 2d6 type=fire]] on a failed [[/save dex dc=15]]</p>')).toBe(
      'Take damage 2d6 type=fire on a failed save dex dc=15'
    );
    expect(plainText('See &Reference[Grappled] and &amp;Reference[Prone=1]')).toBe(
      'See Grappled and Prone'
    );
    expect(plainText('&amp;Reference[prone]{Prone} and &#99999999; &#x27;')).toBe(
      "Prone and &#99999999; '"
    );
    expect(plainText('<table><tr><td>a</td><td>b</td></tr></table>')).toBe('a b');
    expect(plainText('x&#233;y &amp;lt; z @UUID[Compendium.a.b.c] ok')).toBe('xéy &lt; z ok');
  });
});

describe('termPattern', () => {
  it('matches word starts and whole short words only', () => {
    expect(termPattern('rest').test('a long rest')).toBe(true);
    expect(termPattern('rest').test('the forest')).toBe(false);
    expect(termPattern('ac').test('reach')).toBe(false);
    expect(termPattern('ac').test('your AC rises')).toBe(true);
    expect(termPattern('grappl').test('grappling')).toBe(true);
    expect(termPattern('advantag').test('disadvantage')).toBe(false);
    // Terms that stem() shortened must still find their own word.
    for (const word of [
      'prone',
      'dodge',
      'shove',
      'large',
      'surge',
      'resting',
      'saves',
      'uses',
      'bless',
      'class',
    ]) {
      expect(termPattern(stem(word)).test(`a ${word} creature`), word).toBe(true);
    }
    expect(termPattern(stem('saves')).test('you save')).toBe(true);
    expect(termPattern(stem('resting')).test('a rest')).toBe(true);
  });
});

describe('FoundryDataAccess.searchRules', () => {
  it('reports a pack that fails to load and one that matches nothing', async () => {
    world.addPack({
      id: 'dnd5e.broken',
      label: 'Broken',
      type: 'JournalEntry',
      getDocuments: () => Promise.reject(new Error('boom')),
    });
    const res = await da.searchRules({ query: 'grapple' });
    expect(res.skippedPacks).toEqual(['dnd5e.broken']);
    allowlistSetting = 'nothing-matches-this';
    const none = await da.searchRules({ query: 'grapple' });
    expect(none.note).toMatch(/No pack matches/);
  });

  it('treats a non-numeric limit as the default and shares one index build', async () => {
    const pack = world.packs.get('dnd-players-handbook.content');
    const spy = vi.spyOn(pack as { getDocuments: () => Promise<unknown[]> }, 'getDocuments');
    await Promise.all([
      da.searchRules({ query: 'grapple', limit: Number.NaN }),
      da.searchRules({ query: 'grapple' }),
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

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
    const res = await da.searchRules({ query: 'glimmering dome' });
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

  it('lists a page that two packs share only once, from the first pack on the allowlist', async () => {
    world.addPack({
      id: 'dnd5e.content24',
      label: 'SRD 5.2',
      type: 'JournalEntry',
      documents: [
        makeJournal({
          id: 'srdj1',
          name: 'Playing the Game',
          pages: [makeJournalPage({ id: 'sp9', name: 'Grapple', text: { content: GRAPPLE_HTML } })],
        }),
      ],
    });
    const res = await da.searchRules({ query: 'grapple' });
    const grapple = res.results.filter(r => r.pageName === 'Grapple');
    expect(grapple.map(r => r.packId)).toEqual(['dnd-players-handbook.content']);
  });

  it('returns a longer excerpt on request', async () => {
    const long = `<p>${'Grapple rules text. '.repeat(100)}</p>`;
    world.addJournal({
      id: 'wj2',
      name: 'Long',
      pages: [makeJournalPage({ id: 'wp2', name: 'Long', text: { content: long } })],
    });
    const short = await da.searchRules({ query: 'grapple', includeWorld: true });
    const big = await da.searchRules({ query: 'grapple', includeWorld: true, excerptChars: 1500 });
    const pick = (r: typeof short): number =>
      r.results.find(h => h.documentId === 'wj2')!.snippet.length;
    expect(pick(short)).toBeLessThan(300);
    expect(pick(big)).toBeGreaterThan(1400);
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
