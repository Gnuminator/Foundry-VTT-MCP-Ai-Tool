/**
 * Unit tests for the player-visibility domain (Curse of Strahd plan feature 2
 * "spoiler-safe /player", M2): `computePlayerVisibility`, `eventVisibilityFor`
 * and `pagesForPlayers`.
 *
 * Harness: Phase 9 Foundry-mock (`test-support/foundry-mock`). Ownership is
 * exercised through the mock's `testUserPermission`/`getUserLevel`/
 * `hasPlayerOwner` surface (added for this domain; see `documents.ts`), which
 * reads `game.users` — built by `world.install()` — so fixtures are built
 * before or after install interchangeably (the collections are live).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestWorld,
  makeActor,
  makeJournalPage,
  makeToken,
  type TestWorld,
} from './test-support/foundry-mock/index.js';
import {
  computePlayerVisibility,
  eventVisibilityFor,
  pagesForPlayers,
} from './player-visibility.js';
import { UNKNOWN_CREATURE, UNKNOWN_SCENE } from '@gnuminator/shared';

let world: TestWorld;
let restore: () => void;

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
});

afterEach(() => {
  restore();
});

// Token display modes, verified against `common/constants.mjs` TOKEN_DISPLAY_MODES.
const NONE = 0;
const CONTROL = 10;
const OWNER_HOVER = 20;
const HOVER = 30;
const ALWAYS = 50;

// ---------------------------------------------------------------------------
// computePlayerVisibility — pcActorIds
// ---------------------------------------------------------------------------

describe('computePlayerVisibility — pcActorIds', () => {
  it('includes an actor a non-GM user owns, excludes one only the GM owns', () => {
    world.addUser({ id: 'p1', name: 'Alice', isGM: false });
    world.addActor({ id: 'hero', name: 'Silvera', type: 'character', ownership: { p1: 3 } });
    world.addActor({ id: 'villain', name: 'Strahd', type: 'npc', ownership: { default: 0 } });

    const result = computePlayerVisibility();
    expect(result.pcActorIds).toEqual(['hero']);
  });

  it('schema and computedAt are stamped', () => {
    const before = Date.now();
    const result = computePlayerVisibility();
    expect(result.schema).toBe(1);
    expect(result.computedAt).toBeGreaterThanOrEqual(before);
  });
});

// ---------------------------------------------------------------------------
// computePlayerVisibility — scene
// ---------------------------------------------------------------------------

describe('computePlayerVisibility — scene', () => {
  it('is null when there is no active scene', () => {
    world.addScene({ id: 's1', name: 'Death House Basement', active: false });
    expect(computePlayerVisibility().scene).toBeNull();
    expect(computePlayerVisibility().tokens).toEqual([]);
  });

  it('uses navName when set', () => {
    world.addScene({
      id: 's1',
      name: 'Death House Basement',
      navName: 'Village Square',
      active: true,
    });
    expect(computePlayerVisibility().scene).toEqual({ id: 's1', name: 'Village Square' });
  });

  it('falls back to UNKNOWN_SCENE when navName is unset (never the true scene name)', () => {
    world.addScene({ id: 's1', name: 'Death House Basement', active: true });
    expect(computePlayerVisibility().scene).toEqual({ id: 's1', name: UNKNOWN_SCENE });
  });

  it('falls back to UNKNOWN_SCENE when navName is blank', () => {
    world.addScene({ id: 's1', name: 'Death House Basement', navName: '', active: true });
    expect(computePlayerVisibility().scene).toEqual({ id: 's1', name: UNKNOWN_SCENE });
  });
});

// ---------------------------------------------------------------------------
// computePlayerVisibility — tokens
// ---------------------------------------------------------------------------

describe('computePlayerVisibility — tokens', () => {
  it('excludes hidden tokens', () => {
    const shown = makeToken({ id: 't1', name: 'Guard', hidden: false, displayName: ALWAYS });
    const hidden = makeToken({ id: 't2', name: 'Ambusher', hidden: true, displayName: ALWAYS });
    world.addScene({ id: 's1', active: true, tokens: [shown, hidden] });

    const tokens = computePlayerVisibility().tokens;
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenId).toBe('t1');
  });

  it.each([
    ['NONE', NONE, false],
    ['CONTROL', CONTROL, false],
    ['OWNER_HOVER', OWNER_HOVER, false],
    ['HOVER', HOVER, true],
    ['ALWAYS', ALWAYS, true],
  ] as const)('display mode %s reveals the name to non-owners: %s', (_label, mode, revealsName) => {
    const npcActor = world.addActor({ id: 'npc1', name: 'Rahadin', type: 'npc' });
    const token = makeToken({
      id: 't1',
      name: 'Rahadin',
      hidden: false,
      displayName: mode,
      actorId: 'npc1',
      actor: npcActor,
    });
    world.addScene({ id: 's1', active: true, tokens: [token] });

    const [visible] = computePlayerVisibility().tokens;
    expect(visible.name).toBe(revealsName ? 'Rahadin' : UNKNOWN_CREATURE);
    expect(visible.pc).toBe(false);
  });

  it('a player-owned token shows its name regardless of display mode (NONE)', () => {
    world.addUser({ id: 'p1', name: 'Alice', isGM: false });
    const pcActor = world.addActor({
      id: 'hero',
      name: 'Silvera',
      type: 'character',
      ownership: { p1: 3 },
    });
    const token = makeToken({
      id: 't1',
      name: 'Silvera',
      hidden: false,
      displayName: NONE,
      actorId: 'hero',
      actor: pcActor,
    });
    world.addScene({ id: 's1', active: true, tokens: [token] });

    const [visible] = computePlayerVisibility().tokens;
    expect(visible.name).toBe('Silvera');
    expect(visible.pc).toBe(true);
  });

  it('a linked token uses the base actor for ownership', () => {
    world.addUser({ id: 'p1', name: 'Alice', isGM: false });
    const baseActor = world.addActor({
      id: 'hero',
      name: 'Silvera',
      type: 'character',
      ownership: { p1: 3 },
    });
    const token = makeToken({
      id: 't1',
      name: 'Silvera',
      hidden: false,
      displayName: NONE,
      actorLink: true,
      actorId: 'hero',
      actor: baseActor,
    });
    world.addScene({ id: 's1', active: true, tokens: [token] });

    const [visible] = computePlayerVisibility().tokens;
    expect(visible.pc).toBe(true);
    expect(visible.actorId).toBe('hero');
  });

  it('an unlinked token uses its own synthetic actor for ownership, not the base actor', () => {
    // Base (world) actor: GM-only. The unlinked token's own delta actor has
    // been given to a player instead — the token must reflect the synthetic
    // actor's ownership, not the base actor's.
    world.addUser({ id: 'p1', name: 'Alice', isGM: false });
    world.addActor({ id: 'hero', name: 'Silvera', type: 'character', ownership: { default: 0 } });
    // A detached actor (not registered in `world.actors`): its own delta,
    // built the same way `makeActor` builds any actor so it gets the live
    // `hasPlayerOwner` getter — never looked up by id.
    const syntheticActor = makeActor({
      id: 'hero',
      name: 'Silvera (disguised)',
      type: 'character',
      ownership: { p1: 3 },
    });
    const token = makeToken({
      id: 't1',
      name: 'Silvera (disguised)',
      hidden: false,
      displayName: NONE,
      actorLink: false,
      actorId: 'hero',
      actor: syntheticActor,
    });
    world.addScene({ id: 's1', active: true, tokens: [token] });

    const [visible] = computePlayerVisibility().tokens;
    expect(visible.pc).toBe(true);
    expect(visible.name).toBe('Silvera (disguised)');
  });
});

// ---------------------------------------------------------------------------
// eventVisibilityFor
// ---------------------------------------------------------------------------

describe('eventVisibilityFor', () => {
  it('a null/undefined actor has no subject', () => {
    expect(eventVisibilityFor(null)).toEqual({
      subject: null,
      tokenVisible: false,
      playerName: null,
    });
    expect(eventVisibilityFor(undefined)).toEqual({
      subject: null,
      tokenVisible: false,
      playerName: null,
    });
  });

  it('a PC actor: subject pc, playerName is its own name', () => {
    world.addUser({ id: 'p1', name: 'Alice', isGM: false });
    const actor = world.addActor({
      id: 'hero',
      name: 'Silvera',
      type: 'character',
      ownership: { p1: 3 },
    });

    const vis = eventVisibilityFor(actor);
    expect(vis.subject).toBe('pc');
    expect(vis.playerName).toBe('Silvera');
    // No scene/token at all → not visible, but still a known subject.
    expect(vis.tokenVisible).toBe(false);
  });

  it('a PC actor with a non-hidden token on the active scene: tokenVisible true', () => {
    world.addUser({ id: 'p1', name: 'Alice', isGM: false });
    const actor = world.addActor({
      id: 'hero',
      name: 'Silvera',
      type: 'character',
      ownership: { p1: 3 },
    });
    const token = makeToken({ id: 't1', hidden: false, actorId: 'hero' });
    world.addScene({ id: 's1', active: true, tokens: [token] });

    expect(eventVisibilityFor(actor).tokenVisible).toBe(true);
  });

  it('an NPC with a visible (ALWAYS) token: subject npc, playerName from the token', () => {
    const actor = world.addActor({ id: 'npc1', name: 'Rahadin', type: 'npc' });
    const token = makeToken({
      id: 't1',
      name: 'Rahadin',
      hidden: false,
      displayName: ALWAYS,
      actorId: 'npc1',
    });
    world.addScene({ id: 's1', active: true, tokens: [token] });

    const vis = eventVisibilityFor(actor);
    expect(vis.subject).toBe('npc');
    expect(vis.tokenVisible).toBe(true);
    expect(vis.playerName).toBe('Rahadin');
  });

  it('an NPC whose token does not reveal its name: playerName null even though the token is visible', () => {
    const actor = world.addActor({ id: 'npc1', name: 'Rahadin', type: 'npc' });
    const token = makeToken({
      id: 't1',
      name: 'Rahadin',
      hidden: false,
      displayName: NONE,
      actorId: 'npc1',
    });
    world.addScene({ id: 's1', active: true, tokens: [token] });

    const vis = eventVisibilityFor(actor);
    expect(vis.subject).toBe('npc');
    expect(vis.tokenVisible).toBe(true);
    expect(vis.playerName).toBeNull();
  });

  it('an NPC whose token is hidden: tokenVisible false, playerName null', () => {
    const actor = world.addActor({ id: 'npc1', name: 'Rahadin', type: 'npc' });
    const token = makeToken({
      id: 't1',
      name: 'Rahadin',
      hidden: true,
      displayName: ALWAYS,
      actorId: 'npc1',
    });
    world.addScene({ id: 's1', active: true, tokens: [token] });

    const vis = eventVisibilityFor(actor);
    expect(vis.tokenVisible).toBe(false);
    expect(vis.playerName).toBeNull();
  });

  it('a synthetic (unlinked-token) actor resolves visibility through its own token', () => {
    const token = makeToken({ id: 't1', name: 'Wolf', hidden: false, displayName: ALWAYS });
    const syntheticActor = { id: 'a1', name: 'Wolf', hasPlayerOwner: false, token };

    const vis = eventVisibilityFor(syntheticActor);
    expect(vis.subject).toBe('npc');
    expect(vis.tokenVisible).toBe(true);
    expect(vis.playerName).toBe('Wolf');
  });

  it('a synthetic actor whose own token is hidden: tokenVisible false', () => {
    const token = makeToken({ id: 't1', name: 'Wolf', hidden: true, displayName: ALWAYS });
    const syntheticActor = { id: 'a1', name: 'Wolf', hasPlayerOwner: false, token };

    expect(eventVisibilityFor(syntheticActor).tokenVisible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pagesForPlayers
// ---------------------------------------------------------------------------

describe('pagesForPlayers', () => {
  it('an observable text page: exists, name, html, observable all populated', () => {
    world.addUser({ id: 'p1', name: 'Alice', isGM: false });
    const page = makeJournalPage({
      id: 'pg1',
      name: 'Rumors of Barovia',
      type: 'text',
      text: { content: '<p>The mists never lift.</p>' },
      ownership: { p1: 2 },
    });
    world.addJournal({ id: 'j1', name: 'Handouts', pages: [page], ownership: { p1: 2 } });

    const { pages } = pagesForPlayers(['JournalEntry.j1.JournalEntryPage.pg1']);
    expect(pages).toEqual([
      {
        uuid: 'JournalEntry.j1.JournalEntryPage.pg1',
        exists: true,
        name: 'Rumors of Barovia',
        observable: true,
        journalObservable: true,
        html: '<p>The mists never lift.</p>',
        type: 'text',
        src: null,
        caption: null,
      },
    ]);
  });

  it('reports type, src and caption for the reveal copy (image page)', () => {
    const page = makeJournalPage({
      id: 'pg1',
      name: 'Map of the Valley',
      type: 'image',
      src: 'maps/valley.webp',
      image: { caption: 'Drawn in haste' },
    });
    world.addJournal({ id: 'j1', name: 'Chapter 1 (GM)', pages: [page] });

    const [out] = pagesForPlayers(['JournalEntry.j1.JournalEntryPage.pg1']).pages;
    expect(out).toMatchObject({
      exists: true,
      type: 'image',
      src: 'maps/valley.webp',
      caption: 'Drawn in haste',
      html: null,
      journalObservable: false,
    });
  });

  it('an image page without a caption, and a page of a system type, report null / the type', () => {
    const image = makeJournalPage({ id: 'pg1', name: 'Map', type: 'image', src: 'map.webp' });
    const blank = makeJournalPage({ id: 'pg2', name: 'Blank', type: 'image', src: '' });
    const spells = makeJournalPage({ id: 'pg3', name: 'Spell List', type: 'spells' });
    world.addJournal({ id: 'j1', name: 'GM Notes', pages: [image, blank, spells] });

    const pages = pagesForPlayers([
      'JournalEntry.j1.JournalEntryPage.pg1',
      'JournalEntry.j1.JournalEntryPage.pg2',
      'JournalEntry.j1.JournalEntryPage.pg3',
    ]).pages;
    expect(pages.map(p => [p.type, p.src, p.caption])).toEqual([
      ['image', 'map.webp', null],
      ['image', null, null],
      ['spells', null, null],
    ]);
  });

  it('a page players may observe is not observable while its journal is hidden from them (found live in M2)', () => {
    world.addUser({ id: 'p1', name: 'Alice', isGM: false });
    const page = makeJournalPage({ id: 'pg1', name: 'Letter', type: 'text', ownership: { p1: 2 } });
    world.addJournal({ id: 'j1', name: 'Chapter 2 (GM)', pages: [page] });

    const [out] = pagesForPlayers(['JournalEntry.j1.JournalEntryPage.pg1']).pages;
    expect(out.observable).toBe(false);
    expect(out.journalObservable).toBe(false);
  });

  it('the journal and the page must be observable by the same player', () => {
    world.addUser({ id: 'p1', name: 'Alice', isGM: false });
    world.addUser({ id: 'p2', name: 'Bob', isGM: false });
    const page = makeJournalPage({
      id: 'pg1',
      name: 'Letter',
      type: 'text',
      ownership: { default: 0, p1: 2 },
    });
    world.addJournal({ id: 'j1', name: 'Handouts', pages: [page], ownership: { p2: 2 } });

    const [out] = pagesForPlayers(['JournalEntry.j1.JournalEntryPage.pg1']).pages;
    expect(out.journalObservable).toBe(true);
    expect(out.observable).toBe(false);
  });

  it('observability is inherited from the parent journal when the page ownership is INHERIT (default)', () => {
    world.addUser({ id: 'p1', name: 'Alice', isGM: false });
    const page = makeJournalPage({ id: 'pg1', name: 'Handout', type: 'text' });
    world.addJournal({ id: 'j1', name: 'GM Notes', pages: [page], ownership: { p1: 2 } });

    const { pages } = pagesForPlayers(['JournalEntry.j1.JournalEntryPage.pg1']);
    expect(pages[0].observable).toBe(true);
  });

  it('not observable when neither the page nor the journal grants a non-GM user OBSERVER', () => {
    world.addUser({ id: 'p1', name: 'Alice', isGM: false });
    const page = makeJournalPage({ id: 'pg1', name: 'Secret', type: 'text' });
    world.addJournal({ id: 'j1', name: 'GM Notes', pages: [page] });

    const { pages } = pagesForPlayers(['JournalEntry.j1.JournalEntryPage.pg1']);
    expect(pages[0].observable).toBe(false);
  });

  it('a non-text page has null html even when observable', () => {
    world.addUser({ id: 'p1', name: 'Alice', isGM: false });
    const page = makeJournalPage({
      id: 'pg1',
      name: 'Map',
      type: 'image',
      src: 'map.webp',
      ownership: { p1: 2 },
    });
    world.addJournal({ id: 'j1', name: 'Handouts', pages: [page], ownership: { p1: 2 } });

    const { pages } = pagesForPlayers(['JournalEntry.j1.JournalEntryPage.pg1']);
    expect(pages[0].html).toBeNull();
    expect(pages[0].observable).toBe(true);
  });

  it('a uuid that does not resolve reports exists:false', () => {
    const { pages } = pagesForPlayers(['JournalEntry.missing.JournalEntryPage.alsoMissing']);
    expect(pages).toEqual([
      {
        uuid: 'JournalEntry.missing.JournalEntryPage.alsoMissing',
        exists: false,
        name: null,
        observable: false,
        journalObservable: false,
        html: null,
      },
    ]);
  });

  it('drops invalid entries entirely: wrong shape, non-string, empty input', () => {
    const page = makeJournalPage({ id: 'pg1', name: 'Handout', type: 'text' });
    world.addJournal({ id: 'j1', name: 'GM Notes', pages: [page] });

    expect(pagesForPlayers(['Actor.hero', 'not-a-uuid', 42, null, undefined]).pages).toEqual([]);
    expect(pagesForPlayers('not-an-array').pages).toEqual([]);
    expect(pagesForPlayers(undefined).pages).toEqual([]);
  });

  it('caps the batch at 100 entries', () => {
    const uuids = Array.from(
      { length: 105 },
      (_, i) => `JournalEntry.j${i}.JournalEntryPage.p${i}`
    );
    expect(pagesForPlayers(uuids).pages).toHaveLength(100);
  });
});
