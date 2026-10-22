/**
 * `plan-paper-sync` (Paper nights A): Foundry is a fake module, the guarded-write service is the
 * real one. The tests check the switch check, the strict parameters, the plan the tool stores
 * (risk, feature, no auto-apply), and the whole plan, apply and undo round trip for every kind of
 * op the module emits: updates, an item delete (destructive, second confirm), an item create and
 * a status effect create and delete.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GuardedOp, PaperSyncPlan } from '@gnuminator/shared';

import { GuardedWriteService } from '../guarded-write/service.js';
import { FakeFoundry } from '../test-support/fake-foundry.js';
import { AuditLog } from '../vault/audit.js';
import { VaultStore } from '../vault/store.js';
import { PaperSyncTools } from './paper-sync.js';

let dataDir: string;
let foundry: FakeFoundry;
let service: GuardedWriteService;
let tools: PaperSyncTools;
let logger: any;
let built: PaperSyncPlan | (() => PaperSyncPlan);

const planFor = (ops: GuardedOp[], changes: PaperSyncPlan['changes'] = []): PaperSyncPlan => ({
  summary: 'Paper sync Mira: HP 31 to 18 of 31',
  ops,
  actor: { name: 'Mira', uuid: 'Actor.mira' },
  changes,
  unchanged: ['gp already 112'],
  warnings: [],
});

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'paper-sync-'));
  foundry = new FakeFoundry();
  foundry.features = [
    { id: 'paper-sync', name: 'Paper sync', hint: '', enabled: true, writesAllowed: true },
  ];
  foundry.handlers['foundry-mcp-bridge.planPaperSync'] = (): PaperSyncPlan =>
    typeof built === 'function' ? built() : built;
  const store = new VaultStore({ dataDir });
  logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  service = new GuardedWriteService({
    foundryClient: foundry,
    worldIds: {
      current: async (): Promise<string> =>
        (await foundry.query('foundry-mcp-bridge.getWorldInfo')).id,
    },
    store,
    audit: new AuditLog(store),
    logger,
  });
  tools = new PaperSyncTools({ foundryClient: foundry, guardedWrites: service, logger });
  foundry.add('Actor.mira', 'Actor', {
    name: 'Mira',
    system: {
      attributes: { hp: { value: 31, max: 31 }, inspiration: false },
      currency: { gp: 112 },
    },
  });
  // Like Foundry's source data, every embedded document carries its `_id` (undo restores by it).
  foundry.add('Actor.mira.Item.rope', 'Item', {
    _id: 'rope',
    name: 'Rope',
    system: { quantity: 1 },
  });
  foundry.add('Actor.mira.Item.potion', 'Item', {
    _id: 'potion',
    name: 'Potion',
    system: { quantity: 2 },
  });
  foundry.add('Actor.mira.ActiveEffect.pois', 'ActiveEffect', { _id: 'pois', name: 'Poisoned' });
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

const HP_AND_COINS: GuardedOp = {
  kind: 'update',
  uuid: 'Actor.mira',
  changes: {
    'system.attributes.hp.value': 18,
    'system.currency.gp': 87,
    'system.attributes.inspiration': true,
  },
};

describe('definition', () => {
  it('lists plan-paper-sync with a strict schema and no XP, level or class field', () => {
    const [def] = tools.getToolDefinitions();
    expect(def?.name).toBe('plan-paper-sync');
    const schema = def?.inputSchema as any;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['actor']);
    expect(Object.keys(schema.properties)).toEqual([
      'actor',
      'hp',
      'tempHp',
      'slots',
      'hitDice',
      'resources',
      'coins',
      'exhaustion',
      'conditions',
      'inspiration',
      'resetDeathSaves',
      'inventory',
    ]);
    expect(Object.keys(schema.properties.slots.properties)).toEqual([
      ...'123456789'.split(''),
      'pact',
    ]);
    expect(Object.keys(schema.properties.coins.properties)).toEqual(['pp', 'gp', 'ep', 'sp', 'cp']);
    expect(def?.description).toMatch(/Never changes XP/);
  });
});

describe('plan-paper-sync', () => {
  it('stores one plan under the paper-sync feature and never auto-applies', async () => {
    built = planFor(
      [HP_AND_COINS],
      [{ field: 'hp', label: 'HP', before: 31, after: 18, line: 'HP 31 to 18 of 31' }]
    );
    const result = await tools.handleToolCall('plan-paper-sync', { actor: 'Mira', hp: 18 });
    expect(result).toMatchObject({
      feature: 'paper-sync',
      risk: 'write',
      summary: 'Paper sync Mira: HP 31 to 18 of 31',
      actor: { name: 'Mira', uuid: 'Actor.mira' },
      unchanged: ['gp already 112'],
      autoApply: false,
    });
    expect(result.changes[0]?.line).toBe('HP 31 to 18 of 31');
    const sent = foundry.calls.find(([m]) => m.endsWith('planPaperSync'))![1];
    expect(sent).toEqual({ actor: 'Mira', hp: 18 });
    // Nothing is written until apply-planned-change.
    expect(foundry.docs.get('Actor.mira')!.source.system.attributes.hp.value).toBe(31);
  });

  it('says plainly that the switch is off, without asking the module to plan', async () => {
    foundry.features = [
      { id: 'paper-sync', name: 'Paper sync', hint: '', enabled: false, writesAllowed: true },
    ];
    built = planFor([HP_AND_COINS]);
    await expect(
      tools.handleToolCall('plan-paper-sync', { actor: 'Mira', hp: 18 })
    ).rejects.toThrow(/Paper sync is switched off.*AI Tool: Paper sync \(writes\)/);
    expect(foundry.calls.some(([m]) => m.endsWith('planPaperSync'))).toBe(false);
  });

  it('refuses xp, level, class and max HP before asking the module', async () => {
    built = planFor([HP_AND_COINS]);
    for (const extra of [{ xp: 900 }, { level: 6 }, { class: 'Rogue' }, { maxHp: 40 }]) {
      await expect(
        tools.handleToolCall('plan-paper-sync', { actor: 'Mira', hp: 18, ...extra })
      ).rejects.toThrow(/never changes XP, level, class or max HP/);
    }
    expect(foundry.calls.some(([m]) => m.endsWith('planPaperSync'))).toBe(false);
  });

  it('refuses negative or fractional numbers, an unknown slot or coin, a line with both item and uuid', async () => {
    built = planFor([HP_AND_COINS]);
    const bad: Record<string, unknown>[] = [
      { hp: -1 },
      { hp: 1.5 },
      { slots: { '10': 1 } },
      { coins: { dubloons: 1 } },
      { inventory: [{ quantity: 1 }] },
      { inventory: [{ item: 'Rope', uuid: 'Compendium.x.y.z', quantity: 1 }] },
      { hitDice: [{ class: 'Fighter' }] },
    ];
    for (const extra of bad) {
      await expect(
        tools.handleToolCall('plan-paper-sync', { actor: 'Mira', ...extra })
      ).rejects.toThrow(/Not planned/);
    }
    await expect(tools.handleToolCall('plan-paper-sync', {})).rejects.toThrow(/actor/);
  });

  it('passes the module refusal (a value above the maximum) on', async () => {
    built = (): PaperSyncPlan => {
      throw new Error('Not planned for Mira: HP 40 is more than the maximum 31');
    };
    await expect(
      tools.handleToolCall('plan-paper-sync', { actor: 'Mira', hp: 40 })
    ).rejects.toThrow(/HP 40 is more than the maximum 31/);
    expect(service.listPlans()).toHaveLength(0);
  });

  it('rejects another tool name', async () => {
    await expect(tools.handleToolCall('plan-other', {})).rejects.toThrow(/Unknown paper sync tool/);
  });
});

describe('apply and undo (the inverse ops)', () => {
  it('applies updates with one confirm and undoes them to the old values', async () => {
    built = planFor([HP_AND_COINS]);
    const plan = await tools.handleToolCall('plan-paper-sync', { actor: 'Mira', hp: 18 });
    expect(plan.requires).toEqual({ confirm: true, confirmDestructive: false });
    const applied = await service.applyPlan(plan.planId, { confirm: true });
    const system = (): any => foundry.docs.get('Actor.mira')!.source.system;
    expect(system().attributes.hp.value).toBe(18);
    expect(system().currency.gp).toBe(87);
    expect(system().attributes.inspiration).toBe(true);

    await service.undo(applied.changeId, { confirm: true });
    expect(system().attributes.hp.value).toBe(31);
    expect(system().currency.gp).toBe(112);
    expect(system().attributes.inspiration).toBe(false);
  });

  it('makes an item removal destructive: a second confirm, and undo puts the item back', async () => {
    built = planFor([
      { kind: 'update', uuid: 'Actor.mira.Item.potion', changes: { 'system.quantity': 1 } },
      { kind: 'delete', uuid: 'Actor.mira.Item.rope' },
    ]);
    const plan = await tools.handleToolCall('plan-paper-sync', { actor: 'Mira' });
    expect(plan.risk).toBe('destructive');
    expect(plan.requires).toEqual({ confirm: true, confirmDestructive: true });
    await expect(service.applyPlan(plan.planId, { confirm: true })).rejects.toThrow(
      /destructive.*confirmDestructive: true/
    );
    expect(foundry.docs.has('Actor.mira.Item.rope')).toBe(true);

    const applied = await service.applyPlan(plan.planId, {
      confirm: true,
      confirmDestructive: true,
    });
    expect(foundry.docs.has('Actor.mira.Item.rope')).toBe(false);
    expect(foundry.docs.get('Actor.mira.Item.potion')!.source.system.quantity).toBe(1);

    await service.undo(applied.changeId, { confirm: true, confirmDestructive: true });
    expect(foundry.docs.get('Actor.mira.Item.rope')!.source.name).toBe('Rope');
    expect(foundry.docs.get('Actor.mira.Item.potion')!.source.system.quantity).toBe(2);
  });

  it('undoes an added item and a removed condition effect', async () => {
    built = planFor([
      {
        kind: 'create',
        documentName: 'Item',
        parentUuid: 'Actor.mira',
        data: { name: 'Torch', system: { quantity: 4 } },
      },
      { kind: 'delete', uuid: 'Actor.mira.ActiveEffect.pois' },
    ]);
    const plan = await tools.handleToolCall('plan-paper-sync', { actor: 'Mira' });
    // Removing a status effect is everyday play: one confirm.
    expect(plan.risk).toBe('write');
    const applied = await service.applyPlan(plan.planId, { confirm: true });
    const torch = [...foundry.docs.entries()].find(([, d]) => d.source.name === 'Torch');
    expect(torch?.[1].source.system.quantity).toBe(4);
    expect(foundry.docs.has('Actor.mira.ActiveEffect.pois')).toBe(false);

    await service.undo(applied.changeId, { confirm: true });
    expect([...foundry.docs.values()].some(d => d.source.name === 'Torch')).toBe(false);
    expect(foundry.docs.has('Actor.mira.ActiveEffect.pois')).toBe(true);
  });

  it('writes nothing when the sheet in Foundry changed after the plan (conflict)', async () => {
    built = planFor([HP_AND_COINS, { kind: 'delete', uuid: 'Actor.mira.Item.rope' }]);
    const plan = await tools.handleToolCall('plan-paper-sync', { actor: 'Mira', hp: 18 });
    foundry.edit('Actor.mira', { path: 'system.attributes.hp.value', present: true, value: 25 });
    await expect(
      service.applyPlan(plan.planId, { confirm: true, confirmDestructive: true })
    ).rejects.toThrow(/Conflict/);
    const system = foundry.docs.get('Actor.mira')!.source.system;
    expect(system.attributes.hp.value).toBe(25);
    expect(system.currency.gp).toBe(112);
    expect(foundry.docs.has('Actor.mira.Item.rope')).toBe(true);
  });

  it('refuses the apply when the paper-sync switch is turned off after planning', async () => {
    built = planFor([HP_AND_COINS]);
    const plan = await tools.handleToolCall('plan-paper-sync', { actor: 'Mira', hp: 18 });
    foundry.features = [
      { id: 'paper-sync', name: 'Paper sync', hint: '', enabled: false, writesAllowed: true },
    ];
    await expect(service.applyPlan(plan.planId, { confirm: true })).rejects.toThrow(/switched off/);
    expect(foundry.docs.get('Actor.mira')!.source.system.attributes.hp.value).toBe(31);
  });
});
