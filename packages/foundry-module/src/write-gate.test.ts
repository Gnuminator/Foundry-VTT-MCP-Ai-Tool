/**
 * P-036: "Allow Write Operations" gates every bridge handler that changes the
 * world, and every registered handler is classified as write or non-write.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bridgeHandlers } from './bridge-handlers.js';
import { MODULE_ID } from './constants.js';
import { FoundryDataAccess } from './data-access.js';
import { permissionManager } from './permissions.js';
import { QueryHandlers } from './queries.js';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { NON_WRITE_METHODS, WRITE_METHODS, WRITES_DISABLED_MESSAGE } from './write-gate.js';

let world: TestWorld;
let restore: () => void;
let qh: QueryHandlers;

const wire = (method: string): string => `${MODULE_ID}.${method}`;

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

/** A data-access stub whose every method resolves, recording calls. */
function stubEverything(): ReturnType<typeof vi.fn> {
  const calls = vi.fn();
  (qh as any).dataAccess = new Proxy(
    { validateFoundryState: vi.fn() },
    {
      get: (target: Record<string, unknown>, key: string) =>
        key in target
          ? target[key]
          : (...args: unknown[]): Promise<{ success: boolean }> => {
              calls(key, ...args);
              return Promise.resolve({ success: true });
            },
    }
  );
  return calls;
}

describe('write gate: classification', () => {
  it('classifies every registered handler as write or non-write, exactly once', () => {
    qh.registerHandlers();
    const registered = bridgeHandlers.methods().map(m => m.slice(MODULE_ID.length + 1));
    const both = WRITE_METHODS.filter(m => NON_WRITE_METHODS.includes(m));
    expect(both).toEqual([]);
    const unclassified = registered.filter(
      m => !WRITE_METHODS.includes(m) && !NON_WRITE_METHODS.includes(m)
    );
    expect(unclassified, 'add new handlers to write-gate.ts').toEqual([]);
    const stale = [...WRITE_METHODS, ...NON_WRITE_METHODS].filter(m => !registered.includes(m));
    expect(stale, 'names in write-gate.ts that are not registered').toEqual([]);
  });

  it('covers the handlers named in P-036', () => {
    for (const m of ['setActorOwnership', 'setTokenVisionLight', 'addActorItems', 'deleteTokens'])
      expect(WRITE_METHODS).toContain(m);
  });
});

describe('write gate: behaviour', () => {
  it('refuses every write handler while "Allow Write Operations" is off, before any work', async () => {
    const calls = stubEverything();
    world.setSetting(MODULE_ID, 'allowWriteOperations', false);
    qh.registerHandlers();
    for (const method of WRITE_METHODS) {
      await expect(bridgeHandlers.get(wire(method))!({}), method).rejects.toThrow(
        WRITES_DISABLED_MESSAGE
      );
    }
    expect(calls).not.toHaveBeenCalled();
  });

  it('lets writes through when the switch is on', async () => {
    const calls = stubEverything();
    world.enableWrites();
    qh.registerHandlers();
    await bridgeHandlers.get(wire('moveToken'))!({ tokenId: 't', x: 1, y: 2 });
    expect(calls).toHaveBeenCalledWith('moveToken', expect.anything());
  });

  it('never gates reads', async () => {
    const calls = stubEverything();
    world.setSetting(MODULE_ID, 'allowWriteOperations', false);
    qh.registerHandlers();
    await expect(bridgeHandlers.get(wire('ping'))!({})).resolves.toBeDefined();
    await bridgeHandlers.get(wire('listActors'))!({});
    expect(calls).toHaveBeenCalledWith('listActors');
  });
});

describe('permissions: requiresGM and the P-036 functions', () => {
  it('refuses a GM-only operation (delete, world structure) for a non-GM user', () => {
    world.enableWrites();
    (globalThis as any).game.user.isGM = false;
    for (const op of ['deleteData', 'modifyWorld']) {
      const check = permissionManager.checkWritePermission(op);
      expect(check.allowed, op).toBe(false);
      expect(check.reason).toMatch(/needs a GM user/);
    }
    expect(permissionManager.checkWritePermission('modifyScene').allowed).toBe(true);
  });

  it('refuses the four direct write paths when writes are off (data access, no bridge)', async () => {
    const da = new FoundryDataAccess();
    world.setSetting(MODULE_ID, 'allowWriteOperations', false);
    await expect(
      da.setActorOwnership({ actorId: 'a', userId: 'u', permission: 3 })
    ).rejects.toThrow(/disabled in module settings/);
    await expect(
      da.setTokenVisionLight({ tokenName: 'Wolf 1', sightEnabled: true })
    ).rejects.toThrow(/disabled in module settings/);
    await expect(
      da.createActorFromCompendiumEntry({ packId: 'p', itemId: 'i', customNames: ['A'] })
    ).rejects.toThrow(/disabled in module settings/);
    await expect(
      da.addActorItems({ actorIdentifier: 'a', items: [{ name: 'x', type: 'loot' }] })
    ).rejects.toThrow(/disabled in module settings/);
  });

  it('treats deleting tokens as a GM-only delete', async () => {
    const da = new FoundryDataAccess();
    world.enableWrites();
    (globalThis as any).game.user.isGM = false;
    await expect(da.deleteTokens({ tokenIds: ['t1'] })).rejects.toThrow(/needs a GM user/);
  });
});
