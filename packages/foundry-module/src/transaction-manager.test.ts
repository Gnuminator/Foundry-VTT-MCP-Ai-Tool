/**
 * Characterization tests for the TransactionManager — the write-safety rollback
 * layer used by actor/token creation. Pins the current (upstream-derived)
 * behavior so the Phase 9 from-scratch rewrite can be verified to parity.
 *
 * Driven through the Phase 9 Foundry-mock harness: rollback touches real Foundry
 * globals (`game.actors`, `Actor.create`, `game.scenes.current`, document
 * `update`/`delete`), which the harness now provides.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { TransactionManager, type TransactionAction } from './transaction-manager.js';

let world: TestWorld;
let restore: () => void;
let tm: TransactionManager;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  tm = new TransactionManager();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

describe('TransactionManager — lifecycle', () => {
  it('starts a transaction and lists it as active', () => {
    const id = tm.startTransaction('create goblins');
    expect(typeof id).toBe('string');
    const active = tm.getActiveTransactions();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      id,
      description: 'create goblins',
      completed: false,
      rolledBack: false,
      actions: [],
    });
    expect(active[0].timestamp).toBeInstanceOf(Date);
  });

  it('issues distinct ids for distinct transactions', () => {
    const a = tm.startTransaction('a');
    const b = tm.startTransaction('b');
    expect(a).not.toBe(b);
    expect(tm.getActiveTransactions()).toHaveLength(2);
  });

  it('adds actions to an active transaction', () => {
    const id = tm.startTransaction('t');
    tm.addAction(id, { type: 'create', entityType: 'Actor', entityId: 'a1' });
    expect(tm.getActiveTransactions()[0].actions).toHaveLength(1);
  });

  it('throws when adding an action to an unknown transaction', () => {
    expect(() => tm.addAction('nope', { type: 'create', entityType: 'Actor' })).toThrow(
      'Transaction nope not found or already completed'
    );
  });

  it('commits a transaction: removes from active, appends to history', () => {
    const id = tm.startTransaction('t');
    tm.commitTransaction(id);
    expect(tm.getActiveTransactions()).toHaveLength(0);
    const history = tm.getTransactionHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id, completed: true });
  });

  it('throws when committing an unknown transaction', () => {
    expect(() => tm.commitTransaction('nope')).toThrow('Transaction nope not found');
  });

  it('cancels an active transaction without rollback', () => {
    const id = tm.startTransaction('t');
    tm.cancelTransaction(id);
    expect(tm.getActiveTransactions()).toHaveLength(0);
    expect(tm.getTransactionHistory()).toHaveLength(0);
  });

  it('caps history at 50 transactions (oldest dropped)', () => {
    const ids: string[] = [];
    for (let i = 0; i < 51; i++) {
      const id = tm.startTransaction(`t${i}`);
      ids.push(id);
      tm.commitTransaction(id);
    }
    const history = tm.getTransactionHistory();
    expect(history).toHaveLength(50);
    expect(history.find(t => t.id === ids[0])).toBeUndefined();
    expect(history[history.length - 1].id).toBe(ids[50]);
  });

  it('getTransactionHistory / clearHistory', () => {
    const id = tm.startTransaction('t');
    tm.commitTransaction(id);
    expect(tm.getTransactionHistory()).not.toBe(tm.getTransactionHistory()); // returns a copy
    tm.clearHistory();
    expect(tm.getTransactionHistory()).toHaveLength(0);
  });

  it('builds the canned create-rollback actions', () => {
    expect(tm.createActorCreationAction('a1')).toEqual({
      type: 'create',
      entityType: 'Actor',
      entityId: 'a1',
    });
    expect(tm.createTokenCreationAction('t1')).toEqual({
      type: 'create',
      entityType: 'Token',
      entityId: 't1',
    });
  });
});

describe('TransactionManager — rollback (happy paths)', () => {
  it('rolls back an Actor create by deleting the actor', async () => {
    world.addActor({ id: 'a1', name: 'Goblin' });
    const id = tm.startTransaction('t');
    tm.addAction(id, tm.createActorCreationAction('a1'));

    const result = await tm.rollbackTransaction(id);

    expect(result).toEqual({ success: true, errors: [] });
    expect((globalThis as any).game.actors.get('a1')).toBeUndefined();
  });

  it('rolls back a Token create by deleting it from the current scene', async () => {
    const scene = world.addScene({
      id: 's1',
      active: true,
      tokens: [{ id: 't1', name: 'Goblin Token' }],
    });
    world.setActiveScene(scene.id);
    const id = tm.startTransaction('t');
    tm.addAction(id, tm.createTokenCreationAction('t1'));

    const result = await tm.rollbackTransaction(id);

    expect(result.success).toBe(true);
    expect(scene.tokens.get('t1')).toBeUndefined();
  });

  it('rolls back an Actor update by restoring the original data', async () => {
    const actor = world.addActor({ id: 'a1', name: 'Renamed' });
    const id = tm.startTransaction('t');
    tm.addAction(id, {
      type: 'update',
      entityType: 'Actor',
      entityId: 'a1',
      originalData: { name: 'Original' },
    });

    await tm.rollbackTransaction(id);

    expect(actor.name).toBe('Original');
  });

  it('rolls back an Actor delete by recreating it', async () => {
    const id = tm.startTransaction('t');
    tm.addAction(id, {
      type: 'delete',
      entityType: 'Actor',
      originalData: { id: 'phoenix', name: 'Reborn' },
    });

    const result = await tm.rollbackTransaction(id);

    expect(result.success).toBe(true);
    expect((globalThis as any).game.actors.get('phoenix')).toMatchObject({ name: 'Reborn' });
  });

  it('rolls back actions in reverse order', async () => {
    const actor = world.addActor({ id: 'a1', name: 'Current' });
    const id = tm.startTransaction('t');
    // Two updates to the SAME actor; reverse rollback applies action[1] then
    // action[0], so the FIRST action's originalData wins (proves LIFO order).
    tm.addAction(id, {
      type: 'update',
      entityType: 'Actor',
      entityId: 'a1',
      originalData: { name: 'first' },
    });
    tm.addAction(id, {
      type: 'update',
      entityType: 'Actor',
      entityId: 'a1',
      originalData: { name: 'second' },
    });

    await tm.rollbackTransaction(id);

    expect(actor.name).toBe('first');
  });

  it('rolls back a committed (history) transaction', async () => {
    world.addActor({ id: 'a1', name: 'Goblin' });
    const id = tm.startTransaction('t');
    tm.addAction(id, tm.createActorCreationAction('a1'));
    tm.commitTransaction(id);

    const result = await tm.rollbackTransaction(id);

    expect(result.success).toBe(true);
    expect((globalThis as any).game.actors.get('a1')).toBeUndefined();
  });

  it('no-ops gracefully when the create target no longer exists', async () => {
    const id = tm.startTransaction('t');
    tm.addAction(id, tm.createActorCreationAction('ghost'));
    const result = await tm.rollbackTransaction(id);
    expect(result).toEqual({ success: true, errors: [] });
  });
});

describe('TransactionManager — rollback (error handling)', () => {
  it('throws when rolling back an unknown transaction', async () => {
    await expect(tm.rollbackTransaction('nope')).rejects.toThrow('Transaction nope not found');
  });

  it('throws "already rolled back" on a second rollback of a committed transaction', async () => {
    // The guard only fires for committed txs: they persist in history with
    // rolledBack=true. An uncommitted tx is removed from `active` on rollback
    // and isn't in history, so a second attempt reports "not found" instead.
    const id = tm.startTransaction('t');
    tm.commitTransaction(id);
    await tm.rollbackTransaction(id);
    await expect(tm.rollbackTransaction(id)).rejects.toThrow(
      `Transaction ${id} has already been rolled back`
    );
  });

  it('reports "not found" on a second rollback of an uncommitted transaction', async () => {
    const id = tm.startTransaction('t');
    await tm.rollbackTransaction(id);
    await expect(tm.rollbackTransaction(id)).rejects.toThrow(`Transaction ${id} not found`);
  });

  it('collects an error for a create action missing entityId, but still completes', async () => {
    const id = tm.startTransaction('t');
    tm.addAction(id, { type: 'create', entityType: 'Actor' });

    const result = await tm.rollbackTransaction(id);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/missing entityId/);
    // The transaction is still consumed (removed from active) despite the error.
    expect(tm.getActiveTransactions()).toHaveLength(0);
  });

  it('collects an error for an update action missing originalData', async () => {
    const id = tm.startTransaction('t');
    tm.addAction(id, { type: 'update', entityType: 'Actor', entityId: 'a1' });
    const result = await tm.rollbackTransaction(id);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/missing entityId or originalData/);
  });

  it('collects an error for a delete action missing originalData', async () => {
    const id = tm.startTransaction('t');
    tm.addAction(id, { type: 'delete', entityType: 'Actor' });
    const result = await tm.rollbackTransaction(id);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/missing originalData/);
  });

  it('collects an error for an unimplemented entity type', async () => {
    const id = tm.startTransaction('t');
    tm.addAction(id, {
      type: 'create',
      entityType: 'Scene' as TransactionAction['entityType'],
      entityId: 's1',
    });
    const result = await tm.rollbackTransaction(id);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/Rollback not implemented for entity type: Scene/);
  });

  it('continues rolling back remaining actions after one fails', async () => {
    world.addActor({ id: 'a1', name: 'Goblin' });
    const id = tm.startTransaction('t');
    // action[0] succeeds (delete a1); action[1] fails (missing entityId).
    tm.addAction(id, tm.createActorCreationAction('a1'));
    tm.addAction(id, { type: 'create', entityType: 'Actor' });

    const result = await tm.rollbackTransaction(id);

    // Reverse order: the failing action runs first, the successful one still runs.
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect((globalThis as any).game.actors.get('a1')).toBeUndefined();
  });
});
