/**
 * Tests for {@link QueryHandlers} — the MCP→data-access dispatch router that
 * registers every `foundry-mcp-bridge.*` handler into the module-private
 * handler table (never into Foundry's `CONFIG.queries`, see bridge-handlers.ts).
 *
 * Like socket-bridge, this had zero coverage and is a live wire contract: a bad
 * registration or a broken gate breaks the bridge silently. The router itself
 * (register/unregister/handleQuery/getRegisteredMethods/isMethodRegistered) is
 * covered exhaustively; the ~80 handlers share one shape, so the GM gate +
 * input-validation + delegation + error-wrap convention is pinned on a
 * representative sample (plus `ping`, which diverges from it and has no gate).
 *
 * `qh.dataAccess` is public, so each test swaps in a stub and asserts the
 * handler maps args through and wraps results/errors per the contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { QueryHandlers } from './queries.js';
import { MODULE_ID } from './constants.js';
import { bridgeHandlers } from './bridge-handlers.js';
import { GM_HELPER_QUERIES, registerGmHelperQueries } from './gm-helper-queries.js';

let world: TestWorld;
let restore: () => void;
let qh: QueryHandlers;

/** Replace the real FoundryDataAccess with a stub carrying validateFoundryState. */
function stubDataAccess(overrides: Record<string, any> = {}) {
  const stub: any = { validateFoundryState: vi.fn(), ...overrides };
  (qh as any).dataAccess = stub;
  return stub;
}

/** Read/write view of the module-private handler table (where handlers now live). */
const queries = (): Record<string, any> =>
  new Proxy({} as Record<string, any>, {
    get: (_target, key: string) => bridgeHandlers.get(key),
    set: (_target, key: string, value) => {
      bridgeHandlers.set(key, value);
      return true;
    },
  });

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  (globalThis as any).CONFIG.queries = {};
  bridgeHandlers.deleteByPrefix('');
  qh = new QueryHandlers();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Registration / unregistration
// ---------------------------------------------------------------------------

describe('QueryHandlers — registration', () => {
  it('registers handlers as functions under the module prefix', () => {
    qh.registerHandlers();
    for (const key of ['getCharacterInfo', 'listActors', 'ping', 'getModules', 'sendChatMessage']) {
      expect(typeof queries()[`${MODULE_ID}.${key}`]).toBe('function');
    }
  });

  it('registers token methods under BOTH camelCase and kebab-case, routed to one handler', async () => {
    qh.registerHandlers();
    expect(typeof queries()[`${MODULE_ID}.moveToken`]).toBe('function');
    expect(typeof queries()[`${MODULE_ID}.move-token`]).toBe('function');

    const da = stubDataAccess({ moveToken: vi.fn().mockResolvedValue({ ok: true }) });
    await queries()[`${MODULE_ID}.moveToken`]({ tokenId: 't', x: 1, y: 2 });
    await queries()[`${MODULE_ID}.move-token`]({ tokenId: 't', x: 1, y: 2 });
    expect(da.moveToken).toHaveBeenCalledTimes(2);
  });

  it('getRegisteredMethods lists the stripped method names', () => {
    qh.registerHandlers();
    const methods = qh.getRegisteredMethods();
    expect(methods).toContain('ping');
    expect(methods).toContain('listActors');
    expect(methods).not.toContain(`${MODULE_ID}.ping`);
  });

  it('isMethodRegistered reflects registration state', () => {
    qh.registerHandlers();
    expect(qh.isMethodRegistered('ping')).toBe(true);
    expect(qh.isMethodRegistered('definitelyNotAThing')).toBe(false);
  });

  it('unregisterHandlers removes only the module-prefixed keys', () => {
    queries()['core.someOtherQuery'] = () => {};
    qh.registerHandlers();
    expect(qh.getRegisteredMethods().length).toBeGreaterThan(0);

    qh.unregisterHandlers();

    expect(qh.getRegisteredMethods()).toEqual([]);
    expect(typeof queries()['core.someOtherQuery']).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Query lockdown: nothing reachable through Foundry's query relay
// ---------------------------------------------------------------------------

describe('QueryHandlers — query lockdown', () => {
  const bridgeKeysInConfigQueries = (): string[] =>
    Object.keys((globalThis as any).CONFIG.queries).filter(k => k.startsWith(`${MODULE_ID}.`));

  it('registers no bridge handler in CONFIG.queries (Foundry 13: nothing at all)', () => {
    qh.registerHandlers();
    registerGmHelperQueries();

    expect(qh.getRegisteredMethods().length).toBeGreaterThan(90);
    expect(bridgeKeysInConfigQueries()).toEqual([]);
  });

  it('on Foundry 14.352+ only the sender-checked GM helpers are in CONFIG.queries', () => {
    (globalThis as any).game.release = { generation: 14, build: 368 };
    qh.registerHandlers();
    registerGmHelperQueries();

    expect(bridgeKeysInConfigQueries().sort()).toEqual(Object.values(GM_HELPER_QUERIES).sort());
    for (const method of qh.getRegisteredMethods()) {
      expect((globalThis as any).CONFIG.queries[`${MODULE_ID}.${method}`]).toBeUndefined();
    }
  });

  it('a player-style relay of a bridge method finds no CONFIG.queries handler', () => {
    qh.registerHandlers();
    // What Foundry's relay does on the GM client: look the name up in CONFIG.queries.
    const relayed = (globalThis as any).CONFIG.queries[`${MODULE_ID}.setActorOwnership`];
    expect(relayed).toBeUndefined();
    expect(typeof queries()[`${MODULE_ID}.setActorOwnership`]).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Guarded writes (plan/apply/undo live in the backend; the module executes)
// ---------------------------------------------------------------------------

describe('QueryHandlers — guarded-write handlers', () => {
  const GUARDED = ['snapshotGuardedOps', 'applyGuardedOps', 'logGmChange', 'listGuardedFeatures'];

  it('registers the Tarokka read handlers, GM-gated', async () => {
    qh.registerHandlers();
    expect(qh.isMethodRegistered('getTarokkaReading')).toBe(true);
    expect(qh.isMethodRegistered('searchLinkCandidates')).toBe(true);
    stubDataAccess();
    await expect(queries()[`${MODULE_ID}.searchLinkCandidates`]({ query: 'x' })).rejects.toThrow(
      'Failed to search link candidates: query must be 2 to 100 characters'
    );
    (globalThis as any).game.user = { ...(globalThis as any).game.user, isGM: false };
    expect(await queries()[`${MODULE_ID}.getTarokkaReading`]({})).toEqual({
      error: 'Access denied',
      success: false,
    });
  });

  it('registers the four guarded-write handlers', () => {
    qh.registerHandlers();
    for (const method of GUARDED) expect(qh.isMethodRegistered(method)).toBe(true);
  });

  it('gates them to the GM and wraps errors with a prefix', async () => {
    qh.registerHandlers();
    stubDataAccess();
    await expect(queries()[`${MODULE_ID}.snapshotGuardedOps`]({ ops: [] })).rejects.toThrow(
      'Failed to snapshot planned change: A plan needs at least one op'
    );
    await expect(queries()[`${MODULE_ID}.logGmChange`]({})).rejects.toThrow(
      'Failed to log change: logGmChange needs changeId and feature'
    );
    expect(await queries()[`${MODULE_ID}.listGuardedFeatures`]()).toEqual(expect.any(Array));

    (globalThis as any).game.user = { ...(globalThis as any).game.user, isGM: false };
    for (const method of GUARDED) {
      expect(await queries()[`${MODULE_ID}.${method}`]({})).toEqual({
        error: 'Access denied',
        success: false,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// handleQuery — the internal dispatch entry point
// ---------------------------------------------------------------------------

describe('QueryHandlers — handleQuery dispatch', () => {
  it('invokes the registered handler and returns its result', async () => {
    queries()[`${MODULE_ID}.x`] = async (d: any) => ({ got: d });
    const res = await qh.handleQuery(`${MODULE_ID}.x`, { a: 1 });
    expect(res).toEqual({ got: { a: 1 } });
  });

  it('returns a failure object when the handler is missing', async () => {
    const res = await qh.handleQuery(`${MODULE_ID}.missing`, {});
    expect(res).toEqual({
      error: `Query handler not found: ${MODULE_ID}.missing`,
      success: false,
    });
  });

  it('returns a failure object when the handler throws', async () => {
    queries()[`${MODULE_ID}.boom`] = async () => {
      throw new Error('boom');
    };
    const res = await qh.handleQuery(`${MODULE_ID}.boom`, {});
    expect(res).toEqual({ error: 'boom', success: false });
  });
});

// ---------------------------------------------------------------------------
// GM gate
// ---------------------------------------------------------------------------

describe('QueryHandlers — GM gate', () => {
  it('non-GM callers get a silent Access denied without touching dataAccess', async () => {
    (globalThis as any).game.user.isGM = false;
    const da = stubDataAccess({ getCharacterInfo: vi.fn() });

    const res = await (qh as any).handleGetCharacterInfo({ characterName: 'X' });

    expect(res).toEqual({ error: 'Access denied', success: false });
    expect(da.getCharacterInfo).not.toHaveBeenCalled();
  });

  it('handlePing is ungated — returns status/version/world/user even for non-GM', async () => {
    (globalThis as any).game.user.isGM = false;
    const res = await (qh as any).handlePing();
    expect(res).toMatchObject({ status: 'ok', module: MODULE_ID });
    expect(res.foundryVersion).toBeDefined();
    expect(res.worldId).toBeDefined();
  });

  // Whole-surface gate contract: every registered query must silently deny
  // non-GM callers, EXCEPT `ping` (intentionally ungated). Pins the exact set so
  // the withGmGate consolidation can't silently add/drop a gate. (The 3 dnd5e
  // spell/feature writers were brought under the gate for consistency.)
  it('gates every registered query for non-GM except the known ungated handlers', async () => {
    (globalThis as any).game.user.isGM = false;
    stubDataAccess();
    qh.registerHandlers();
    const ungated: string[] = [];
    for (const fullName of bridgeHandlers.methods()) {
      const short = fullName.slice(MODULE_ID.length + 1);
      try {
        const res: any = await bridgeHandlers.get(fullName)!({});
        const denied = res && res.error === 'Access denied' && res.success === false;
        if (!denied) ungated.push(short);
      } catch {
        ungated.push(short);
      }
    }

    expect([...new Set(ungated)].sort()).toEqual(['ping']);
  });

  // The allowNonGmAccess setting (default off) opens the same gate to the non-GM
  // user running this client: a standard handler then delegates instead of denying.
  it('allows non-GM callers when allowNonGmAccess is enabled', async () => {
    (globalThis as any).game.user.isGM = false;
    await (globalThis as any).game.settings.set(MODULE_ID, 'allowNonGmAccess', true);
    const da = stubDataAccess({ getCharacterInfo: vi.fn().mockResolvedValue({ name: 'Aldric' }) });

    const res = await (qh as any).handleGetCharacterInfo({ characterName: 'Aldric' });

    expect(da.getCharacterInfo).toHaveBeenCalledWith('Aldric');
    expect(res).toEqual({ name: 'Aldric' });
  });
});

// ---------------------------------------------------------------------------
// Handler convention: validation, delegation, error wrapping
// ---------------------------------------------------------------------------

describe('QueryHandlers — handler convention', () => {
  it('delegates the resolved identifier to dataAccess and returns its result', async () => {
    const da = stubDataAccess({ getCharacterInfo: vi.fn().mockResolvedValue({ name: 'Aldric' }) });
    const res = await (qh as any).handleGetCharacterInfo({ characterName: 'Aldric' });
    expect(da.getCharacterInfo).toHaveBeenCalledWith('Aldric');
    expect(res).toEqual({ name: 'Aldric' });
  });

  it('throws a wrapped error when a required input is missing', async () => {
    stubDataAccess({ getCharacterInfo: vi.fn() });
    await expect((qh as any).handleGetCharacterInfo({})).rejects.toThrow(
      'Failed to get character info: characterName or characterId is required'
    );
  });

  it('wraps a dataAccess failure with the handler-specific prefix', async () => {
    stubDataAccess({ getCharacterInfo: vi.fn().mockRejectedValue(new Error('nope')) });
    await expect((qh as any).handleGetCharacterInfo({ characterId: 'id' })).rejects.toThrow(
      'Failed to get character info: nope'
    );
  });

  it('handleListActors filters by type only when supplied', async () => {
    stubDataAccess({
      listActors: vi.fn().mockResolvedValue([
        { name: 'A', type: 'npc' },
        { name: 'B', type: 'character' },
      ]),
    });
    expect(await (qh as any).handleListActors({})).toHaveLength(2);
    expect(await (qh as any).handleListActors({ type: 'npc' })).toEqual([
      { name: 'A', type: 'npc' },
    ]);
  });

  it('handleListCreaturesByCriteria wraps the result under { response }', async () => {
    stubDataAccess({ listCreaturesByCriteria: vi.fn().mockResolvedValue([{ name: 'Goblin' }]) });
    const res = await (qh as any).handleListCreaturesByCriteria({ challengeRating: 1 });
    expect(res).toEqual({ response: [{ name: 'Goblin' }] });
  });
});
