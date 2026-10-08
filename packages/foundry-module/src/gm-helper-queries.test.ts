/**
 * Tests for the GM-to-GM helper queries: the only handlers this module puts in
 * Foundry's `CONFIG.queries`. Foundry relays queries from any user holding
 * "Query Users" (Player by default), so every helper must reject a missing,
 * unknown, forged or non-GM sender, and must validate its payload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, makeUser, type TestWorld } from './test-support/foundry-mock/index.js';
import {
  GM_HELPER_QUERIES,
  openDocumentForGm,
  parseUuidPayload,
  registerGmHelperQueries,
  requireGmSender,
  resolveGmTarget,
  unregisterGmHelperQueries,
} from './gm-helper-queries.js';

let world: TestWorld;
let restore: () => void;
const g = globalThis as any;

const PAGE_UUID = 'JournalEntry.aaaaaaaaaaaaaaaa.JournalEntryPage.bbbbbbbbbbbbbbbb';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  world = createTestWorld({ foundryVersion: '14.368' });
  restore = world.install();
  g.CONFIG.queries = {};
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

function addUser(opts: Record<string, unknown>): any {
  const user = makeUser(opts);
  world.users.set(user.id, user);
  return user;
}

describe('requireGmSender', () => {
  it('rejects a missing context or a context without user', () => {
    expect(() => requireGmSender(undefined)).toThrow(/no sender/);
    expect(() => requireGmSender({ timeout: 5000 })).toThrow(/no sender/);
  });

  it('rejects a non-GM sender', () => {
    const player = addUser({ id: 'player1', name: 'Player', isGM: false });
    expect(() => requireGmSender({ user: player })).toThrow(/GM-only/);
  });

  it('rejects a forged user object that is not the world user document', () => {
    addUser({ id: 'gm2', name: 'Real GM', isGM: true });
    const forged = { id: 'gm2', name: 'Real GM', isGM: true };
    expect(() => requireGmSender({ user: forged as any })).toThrow(/not a user of this world/);
  });

  it('rejects an unknown user id', () => {
    expect(() => requireGmSender({ user: 'nobody' as any })).toThrow(/not a user of this world/);
  });

  it('accepts a GM user document or a GM user id', () => {
    const gm = addUser({ id: 'gm2', name: 'Real GM', isGM: true });
    expect(requireGmSender({ user: gm })).toBe(gm);
    expect(requireGmSender({ user: 'gm2' as any })).toBe(gm);
  });
});

describe('parseUuidPayload', () => {
  it.each([
    'Actor.abcdefghijklmnop',
    PAGE_UUID,
    'Compendium.dnd-monster-manual.actors.Actor.mmVampire0000000',
  ])('accepts %s', uuid => {
    expect(parseUuidPayload({ uuid })).toBe(uuid);
  });

  it.each([
    undefined,
    null,
    {},
    { uuid: 42 },
    { uuid: 'Actor.short' },
    { uuid: 'javascript:alert(1)' },
    { uuid: `Actor.${'a'.repeat(16)}.${'x'.repeat(300)}` },
  ])('rejects %j', data => {
    expect(() => parseUuidPayload(data)).toThrow(/Invalid payload/);
  });
});

describe('registerGmHelperQueries', () => {
  it('registers nothing on Foundry 13 (no sender is passed there)', () => {
    g.game.release = { generation: 13, build: 351 };
    expect(registerGmHelperQueries()).toBe(false);
    expect(Object.keys(g.CONFIG.queries)).toEqual([]);
  });

  it('registers nothing on 14 builds before 14.352', () => {
    g.game.release = { generation: 14, build: 351 };
    expect(registerGmHelperQueries()).toBe(false);
  });

  it('registers only the helper names on 14.352+, and unregisters them', () => {
    expect(registerGmHelperQueries()).toBe(true);
    expect(Object.keys(g.CONFIG.queries).sort()).toEqual(Object.values(GM_HELPER_QUERIES).sort());
    unregisterGmHelperQueries();
    expect(Object.keys(g.CONFIG.queries)).toEqual([]);
  });

  it('the registered openDocument handler rejects a player sender before touching anything', async () => {
    registerGmHelperQueries();
    const fromUuid = vi.fn();
    g.fromUuid = fromUuid;
    const player = addUser({ id: 'player1', name: 'Player', isGM: false });

    const handler = g.CONFIG.queries[GM_HELPER_QUERIES.openDocument];
    await expect(handler({ uuid: PAGE_UUID }, { user: player })).rejects.toThrow(/GM-only/);
    await expect(handler({ uuid: PAGE_UUID }, { timeout: 1 })).rejects.toThrow(/no sender/);
    expect(fromUuid).not.toHaveBeenCalled();
  });

  it('the registered openDocument handler opens a journal page for a GM sender', async () => {
    registerGmHelperQueries();
    const render = vi.fn();
    g.fromUuid = vi.fn().mockResolvedValue({
      documentName: 'JournalEntryPage',
      id: 'bbbbbbbbbbbbbbbb',
      name: 'Page',
      parent: { sheet: { render } },
    });
    const gm = addUser({ id: 'gm2', name: 'Real GM', isGM: true });

    const res = await g.CONFIG.queries[GM_HELPER_QUERIES.openDocument](
      { uuid: PAGE_UUID },
      { user: gm }
    );

    expect(render).toHaveBeenCalledWith(true, { pageId: 'bbbbbbbbbbbbbbbb' });
    expect(res).toEqual({ opened: true, documentName: 'JournalEntryPage', name: 'Page' });
  });
});

describe('resolveGmTarget / openDocumentForGm', () => {
  it('opens locally when this client is the only GM', async () => {
    const render = vi.fn();
    g.fromUuid = vi
      .fn()
      .mockResolvedValue({ documentName: 'Actor', name: 'Ireena', sheet: { render } });

    const res = await openDocumentForGm({ uuid: 'Actor.abcdefghijklmnop' });

    expect(render).toHaveBeenCalledWith(true);
    expect(res).toMatchObject({ opened: true, userId: 'gm' });
  });

  it('sends a helper query to the one other active full GM (the human GM)', async () => {
    const query = vi.fn().mockResolvedValue({ opened: true, documentName: 'Actor', name: 'X' });
    addUser({ id: 'human', name: 'Human GM', isGM: true, active: true, role: 4, query });
    addUser({ id: 'asst2', name: 'Other Assistant', isGM: true, active: true, role: 3 });

    const res = await openDocumentForGm({ uuid: 'Actor.abcdefghijklmnop' });

    expect(query).toHaveBeenCalledWith(
      GM_HELPER_QUERIES.openDocument,
      { uuid: 'Actor.abcdefghijklmnop' },
      { timeout: 10_000 }
    );
    expect(res.userId).toBe('human');
  });

  it('asks for userId when several full GMs are logged in', () => {
    addUser({ id: 'a', name: 'A', isGM: true, active: true, role: 4 });
    addUser({ id: 'b', name: 'B', isGM: true, active: true, role: 4 });
    expect(() => resolveGmTarget()).toThrow(/pass userId/);
  });

  it('refuses a non-GM or logged-out target', () => {
    addUser({ id: 'p', name: 'P', isGM: false, active: true });
    addUser({ id: 'off', name: 'Off', isGM: true, active: false });
    expect(() => resolveGmTarget('p')).toThrow(/not a GM/);
    expect(() => resolveGmTarget('off')).toThrow(/not logged in/);
  });

  it('needs 14.352+ to reach another client', async () => {
    g.game.release = { generation: 13, build: 351 };
    addUser({ id: 'human', name: 'Human GM', isGM: true, active: true, role: 4, query: vi.fn() });
    await expect(openDocumentForGm({ uuid: 'Actor.abcdefghijklmnop' })).rejects.toThrow(/14\.352/);
  });
});
