/**
 * Tarokka provider (tarokka-reading 1.x), offers, deal detection, GM-to-GM
 * helper queries and link-candidate search. Fixtures follow the shapes
 * tarokka-reading 1.0.3 stores (`state.js`, `reading.js`): `secret` =
 * `{id, broadcast, cards[5], stages[5]}`, `plan` = `[{cardId, note}] x5`,
 * world `cardOverrides` = `{[id]: {name?}}`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestWorld,
  makeJournal,
  makeJournalPage,
  makeUser,
  type TestWorld,
} from './test-support/foundry-mock/index.js';
import {
  getTarokkaReading,
  onTarokkaSettingChanged,
  parseProviderReading,
  readTarokkaReadingLocal,
  resetTarokkaStateForTests,
  searchLinkCandidates,
  storeTarokkaOffer,
  tarokkaReadingProvider,
  type ProviderReading,
} from './tarokka.js';
import {
  GM_HELPER_QUERIES,
  fetchTarokkaReadingFromUser,
  registerGmHelperQueries,
  sendTarokkaOffer,
} from './gm-helper-queries.js';
import { registerGuardedFeature, resetGuardedFeaturesForTests } from './guarded-features.js';

const g = globalThis as any;
const TR = 'tarokka-reading';
let world: TestWorld;
let restore: () => void;

const CARDS = ['swords-7', 'glyphs-master', 'coins-2', 'raven', 'mists'];
const I18N: Record<string, string> = {
  'TAROKKA.Cards.swords-7': 'Localized Seven',
  'TAROKKA.Cards.raven': 'Localized Raven',
};

function install(foundryVersion = '14.368', version = '1.0.3', active = true): void {
  world = createTestWorld({ foundryVersion });
  world.modules.set(TR, { id: TR, title: 'Tarokka Reading', version, active });
  restore = world.install();
  g.game.i18n = {
    lang: 'en',
    has: (k: string) => k in I18N,
    localize: (k: string) => I18N[k] ?? k,
    format: (k: string) => k,
  };
  g.game.settings.register = vi.fn();
  g.CONFIG.queries = {};
  g.foundry.applications = {};
  resetTarokkaStateForTests();
  resetGuardedFeaturesForTests();
}

function deal(
  stages = ['hidden', 'hidden', 'hidden', 'hidden', 'hidden'],
  id = 'abcDEF123456'
): void {
  world.setSetting(TR, 'secret', { id, broadcast: false, cards: CARDS, stages });
  world.setSetting(TR, 'plan', [
    { cardId: null, note: '  Ask the GM about the tome  ' },
    { cardId: null, note: '' },
    { cardId: null, note: 'x'.repeat(3000) },
    { cardId: 'raven', note: 'Forced ally card' },
    { cardId: null, note: 42 },
  ]);
  world.setSetting(TR, 'cardOverrides', { 'glyphs-master': { name: 'Custom Name' } });
}

beforeEach(() => install());
afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

describe('tarokka-reading provider', () => {
  it('is gated on an active 1.x install', () => {
    expect(tarokkaReadingProvider()).toEqual({ active: true, version: '1.0.3' });
    restore();
    install('14.368', '2.0.0');
    expect(tarokkaReadingProvider()).toMatchObject({ active: false, reason: /1\.x only/ });
    restore();
    install('14.368', '1.0.3', false);
    expect(tarokkaReadingProvider()).toMatchObject({ active: false, reason: /not active/ });
    world.modules.delete(TR);
    expect(tarokkaReadingProvider()).toMatchObject({ active: false, reason: /not installed/ });
    expect(readTarokkaReadingLocal()).toBeNull();
  });

  it('reads the dealt reading with names, notes and stages', () => {
    deal(['revealed', 'placed', 'hidden', 'revealed', 'bogus']);
    const r = readTarokkaReadingLocal()!;
    expect(r).toMatchObject({
      source: 'tarokka-reading',
      providerVersion: '1.0.3',
      readingId: 'abcDEF123456',
      dealt: true,
      complete: false,
    });
    expect(r.slots.map(s => [s.position, s.cardId, s.cardName, s.stage])).toEqual([
      ['tome', 'swords-7', 'Localized Seven', 'revealed'],
      ['holySymbol', 'glyphs-master', 'Custom Name', 'placed'],
      ['sunsword', 'coins-2', null, 'hidden'],
      ['ally', 'raven', 'Localized Raven', 'revealed'],
      ['strahdLocation', 'mists', null, 'hidden'],
    ]);
    expect(r.slots[0].gmNote).toBe('Ask the GM about the tome');
    expect(r.slots[1].gmNote).toBeNull();
    expect(r.slots[2].gmNote).toHaveLength(2000);
    expect(r.slots[4].gmNote).toBeNull();
  });

  it('marks a fully revealed reading complete, and ignores no or malformed deals', () => {
    deal(Array(5).fill('revealed'));
    expect(readTarokkaReadingLocal()?.complete).toBe(true);
    world.setSetting(TR, 'secret', { id: null, cards: [], stages: [] });
    expect(readTarokkaReadingLocal()).toBeNull();
    world.setSetting(TR, 'secret', { id: '../x', cards: CARDS, stages: [] });
    expect(readTarokkaReadingLocal()).toBeNull();
    world.setSetting(TR, 'secret', { id: 'ok', cards: ['<b>', 'swords-1'], stages: [] });
    const partial = readTarokkaReadingLocal()!;
    expect(partial.dealt).toBe(false);
    expect(partial.slots[0].cardId).toBeNull();
  });

  it('validates a reading received from another client', () => {
    deal();
    const r = readTarokkaReadingLocal()!;
    expect(parseProviderReading(JSON.parse(JSON.stringify(r)))).toMatchObject({
      readingId: r.readingId,
      dealt: true,
    });
    expect(() => parseProviderReading({ ...r, source: 'x' })).toThrow(/expected a tarokka-reading/);
    expect(() => parseProviderReading({ ...r, readingId: 'a b' })).toThrow(/bad readingId/);
    expect(() => parseProviderReading({ ...r, slots: [] })).toThrow(/five slots/);
    const odd = parseProviderReading({
      ...r,
      slots: r.slots.map(s => ({ ...s, cardId: 'x y', stage: 'nope', cardName: 5 })),
    });
    expect(odd.slots[0]).toMatchObject({ cardId: null, cardName: null, stage: 'hidden' });
  });
});

describe('getTarokkaReading', () => {
  const noFetch = (): Promise<ProviderReading | null> => Promise.reject(new Error('no'));

  it('prefers the local deal, then an offer', async () => {
    expect(await getTarokkaReading({}, noFetch)).toMatchObject({
      available: false,
      reason: /No reading dealt/,
    });
    deal();
    const local = readTarokkaReadingLocal()!;
    storeTarokkaOffer({ ...local, readingId: 'offered1' }, 'gm2');
    expect(await getTarokkaReading({}, noFetch)).toMatchObject({ from: 'local' });
    world.setSetting(TR, 'secret', {});
    expect(await getTarokkaReading(undefined, noFetch)).toMatchObject({
      from: 'offer',
      reading: { readingId: 'offered1' },
    });
  });

  it('asks another GM when userId is given', async () => {
    deal();
    const reading = readTarokkaReadingLocal()!;
    const fetch = vi.fn(() => Promise.resolve(reading));
    expect(await getTarokkaReading({ userId: 'gm2' }, fetch)).toMatchObject({
      available: true,
      from: 'user:gm2',
    });
    expect(fetch).toHaveBeenCalledWith('gm2');
    expect(await getTarokkaReading({ userId: 'gm2' }, () => Promise.resolve(null))).toMatchObject({
      available: false,
    });
  });

  it('explains when the provider is missing', async () => {
    world.modules.delete(TR);
    expect(await getTarokkaReading({}, noFetch)).toMatchObject({
      available: false,
      reason: /not installed; use source builtin-roll/,
    });
  });
});

describe('deal detection', () => {
  function enableFeature(): void {
    registerGuardedFeature({ id: 'tarokka', name: 'Tarokka', hint: '' });
    world.setSetting('foundry-mcp-bridge', 'feature.tarokka.enabled', true);
  }

  it('asks once per new reading and sends the offer to the other active GMs', async () => {
    enableFeature();
    const gm2 = makeUser({ id: 'gm2', name: 'Other GM', isGM: true, active: true });
    const away = makeUser({ id: 'gm3', name: 'Away GM', isGM: true, active: false });
    const player = makeUser({ id: 'p1', name: 'Player', isGM: false, active: true });
    for (const u of [gm2, away, player]) world.users.set(u.id, u);
    const send = vi.fn(() => Promise.resolve());
    const ask = vi.fn(() => Promise.resolve(true));
    g.ui.notifications.info = vi.fn();

    expect(await onTarokkaSettingChanged('core.other', send, ask)).toBe('ignored');
    expect(await onTarokkaSettingChanged('tarokka-reading.secret', send, ask)).toBe('ignored'); // no deal
    deal();
    expect(await onTarokkaSettingChanged('tarokka-reading.secret', send, ask)).toBe('offered');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(gm2);
    expect(await getTarokkaReading({}, () => Promise.resolve(null))).toMatchObject({
      available: true,
    });
    // Placing or flipping cards changes the setting again: no second question.
    deal(['revealed', 'hidden', 'hidden', 'hidden', 'hidden']);
    expect(await onTarokkaSettingChanged('tarokka-reading.secret', send, ask)).toBe('ignored');
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('respects a declined question, the feature switch and non-GM clients', async () => {
    deal();
    const send = vi.fn();
    expect(
      await onTarokkaSettingChanged('tarokka-reading.secret', send, () => Promise.resolve(true))
    ).toBe('ignored'); // feature off
    enableFeature();
    expect(
      await onTarokkaSettingChanged('tarokka-reading.secret', send, () => Promise.resolve(false))
    ).toBe('declined');
    deal(undefined, 'second00');
    g.game.user = { ...g.game.user, isGM: false };
    expect(
      await onTarokkaSettingChanged('tarokka-reading.secret', send, () => Promise.resolve(true))
    ).toBe('ignored');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('Tarokka helper queries', () => {
  function sender(isGM: boolean): any {
    const user = makeUser({ id: isGM ? 'gm2' : 'p1', name: 'Sender', isGM, active: true });
    world.users.set(user.id, user);
    return { user };
  }

  it('registers both helpers on 14.352+', () => {
    registerGmHelperQueries();
    expect(typeof g.CONFIG.queries[GM_HELPER_QUERIES.tarokkaReading]).toBe('function');
    expect(typeof g.CONFIG.queries[GM_HELPER_QUERIES.offerTarokkaReading]).toBe('function');
  });

  it('returns the local reading to a GM sender only', () => {
    registerGmHelperQueries();
    deal();
    const handler = g.CONFIG.queries[GM_HELPER_QUERIES.tarokkaReading];
    expect(handler({}, sender(true))).toMatchObject({ readingId: 'abcDEF123456' });
    expect(() => handler({}, sender(false))).toThrow(/GM-only/);
    expect(() => handler({}, undefined)).toThrow(/no sender/);
  });

  it('stores an offer from a GM sender after validating it', async () => {
    registerGmHelperQueries();
    deal();
    const reading = readTarokkaReadingLocal()!;
    world.setSetting(TR, 'secret', {});
    const handler = g.CONFIG.queries[GM_HELPER_QUERIES.offerTarokkaReading];
    expect(() => handler(reading, sender(false))).toThrow(/GM-only/);
    expect(() => handler({ bogus: true }, sender(true))).toThrow(/Invalid payload/);
    expect(handler(reading, sender(true))).toEqual({ stored: true });
    expect(await getTarokkaReading({}, () => Promise.resolve(null))).toMatchObject({
      from: 'offer',
    });
  });

  it('fetches from and offers to another GM through User#query', async () => {
    deal();
    const reading = readTarokkaReadingLocal()!;
    const other = makeUser({ id: 'gm2', name: 'Other', isGM: true, active: true });
    other.query = vi.fn(() => Promise.resolve(reading));
    world.users.set('gm2', other);
    expect(await fetchTarokkaReadingFromUser('gm2')).toMatchObject({
      readingId: reading.readingId,
    });
    expect(other.query).toHaveBeenCalledWith(
      GM_HELPER_QUERIES.tarokkaReading,
      {},
      { timeout: 10_000 }
    );
    await sendTarokkaOffer(other as never, reading);
    expect(other.query).toHaveBeenLastCalledWith(GM_HELPER_QUERIES.offerTarokkaReading, reading, {
      timeout: 10_000,
    });
  });

  it('refuses cross-client reads before 14.352', async () => {
    restore();
    install('13.351');
    await expect(fetchTarokkaReadingFromUser('gm2')).rejects.toThrow(/14.352/);
    expect(await sendTarokkaOffer({} as never, {} as never)).toBeNull();
  });
});

describe('searchLinkCandidates', () => {
  it('finds journals, pages, scenes and actors by name', () => {
    world.journal.add(
      makeJournal({
        id: 'j1',
        name: 'Chapter 5: Vallaki',
        uuid: 'JournalEntry.j1',
        pages: [
          makeJournalPage({
            id: 'p1',
            name: 'Vallaki Overview',
            uuid: 'JournalEntry.j1.JournalEntryPage.p1',
          }),
          makeJournalPage({ id: 'p2', name: 'Other', uuid: 'JournalEntry.j1.JournalEntryPage.p2' }),
        ],
      }) as never
    );
    world.addScene({ id: 's1', name: 'Vallaki Town', uuid: 'Scene.s1' } as never);
    world.addActor({ id: 'a1', name: 'Baron of Vallaki', uuid: 'Actor.a1' } as never);
    world.addActor({ id: 'a2', name: 'Someone Else', uuid: 'Actor.a2' } as never);

    const { candidates } = searchLinkCandidates({ query: 'vallaki' });
    expect(candidates.map(c => [c.documentName, c.uuid])).toEqual([
      ['JournalEntry', 'JournalEntry.j1'],
      ['JournalEntryPage', 'JournalEntry.j1.JournalEntryPage.p1'],
      ['Scene', 'Scene.s1'],
      ['Actor', 'Actor.a1'],
    ]);
    expect(candidates[1].parentName).toBe('Chapter 5: Vallaki');
    expect(searchLinkCandidates({ query: 'vallaki', limit: 2 }).candidates).toHaveLength(2);
    expect(() => searchLinkCandidates({ query: 'v' })).toThrow(/2 to 100/);
    expect(() => searchLinkCandidates(undefined)).toThrow(/2 to 100/);
  });
});
