import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GuardedOp } from '@gnuminator/shared';

import { AUDIT_INLINE_DELETED_LIMIT, AuditLog } from '../vault/audit.js';
import { VaultStore } from '../vault/store.js';
import { GuardedWriteService, PLAN_TTL_MS, type PlanView } from './service.js';
import { FakeFoundry } from '../test-support/fake-foundry.js';

// ---------------------------------------------------------------------------

let dataDir: string;
let foundry: FakeFoundry;
let store: VaultStore;
let audit: AuditLog;
let service: GuardedWriteService;
let now: number;
let logger: any;

function makeService(
  extra: Partial<ConstructorParameters<typeof GuardedWriteService>[0]> = {}
): GuardedWriteService {
  return new GuardedWriteService({
    foundryClient: foundry,
    worldIds: {
      current: async (): Promise<string> =>
        (await foundry.query('foundry-mcp-bridge.getWorldInfo')).id,
    },
    store,
    audit,
    logger,
    now: (): number => now,
    ...extra,
  });
}

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'guarded-write-'));
  foundry = new FakeFoundry();
  store = new VaultStore({ dataDir });
  audit = new AuditLog(store);
  now = Date.parse('2026-09-28T10:00:00.000Z');
  logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  service = makeService();
  foundry.add('Actor.ireena', 'Actor', {
    name: 'Ireena',
    system: { hp: 10 },
    flags: { 'foundry-mcp-bridge': { attitude: 'friendly' } },
  });
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

const HP_UPDATE: GuardedOp = {
  kind: 'update',
  uuid: 'Actor.ireena',
  changes: { 'system.hp': 4 },
  unset: ['flags.foundry-mcp-bridge.attitude'],
};

function plan(ops: GuardedOp[], extra: Record<string, unknown> = {}): Promise<PlanView> {
  return service.createPlan({ feature: 'test-feature', summary: 'Hurt Ireena', ops, ...extra });
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

describe('createPlan (Foundry ops)', () => {
  it('snapshots the targets and returns a readable diff', async () => {
    const p = await plan([
      HP_UPDATE,
      { kind: 'create', documentName: 'Item', parentUuid: 'Actor.ireena', data: { name: 'Rope' } },
    ]);
    expect(p).toMatchObject({
      feature: 'test-feature',
      summary: 'Hurt Ireena',
      target: 'foundry',
      risk: 'write',
      worldId: 'curse-of-strahd',
      createdAt: '2026-09-28T10:00:00.000Z',
      expiresAt: '2026-09-28T10:15:00.000Z',
      requires: { confirm: true, confirmDestructive: false },
    });
    expect(p.planId).toMatch(/^plan-[a-z0-9]+-[0-9a-f]{8}$/);
    expect(p.diff.map(d => d.text)).toEqual([
      'Actor "Ireena": system.hp: 10 → 4',
      'Actor "Ireena": flags.foundry-mcp-bridge.attitude: "friendly" → (unset)',
      'Create Item "Rope" in Actor.ireena',
    ]);
    expect(service.getPlan(p.planId)).toEqual(p);
    expect(service.listPlans()).toEqual([p]);
  });

  it('marks a plan with a delete as destructive', async () => {
    const p = await plan([{ kind: 'delete', uuid: 'Actor.ireena' }]);
    expect(p.risk).toBe('destructive');
    expect(p.requires.confirmDestructive).toBe(true);
    expect(p.diff[0].text).toBe('Delete Actor "Ireena" (Actor.ireena)');
  });

  it('names known paths in the diff (F5): HP, temp HP, ownership, position', async () => {
    const p = await plan([
      {
        kind: 'update',
        uuid: 'Actor.ireena',
        changes: {
          'system.attributes.hp.value': 5,
          'system.attributes.hp.temp': 3,
          'ownership.u1': 3,
          'system.attributes.death.failure': 1,
        },
      },
    ]);
    expect(p.diff.map(d => d.text)).toEqual([
      'Actor "Ireena": HP (unset) → 5',
      'Actor "Ireena": temp HP (unset) → 3',
      'Actor "Ireena": ownership for user u1 (unset) → 3',
      'Actor "Ireena": death save failures (unset) → 1',
    ]);
  });

  it("uses the caller's pathLabels instead of the built-in label in the diff text (F5 L3)", async () => {
    const ops: GuardedOp[] = [
      {
        kind: 'update',
        uuid: 'Actor.ireena',
        changes: { 'ownership.u1': 2, 'system.attributes.hp.value': 5 },
      },
    ];
    const labelled = await plan(ops, { pathLabels: { 'ownership.u1': 'ownership for Player' } });
    expect(labelled.diff.map(d => d.text)).toEqual([
      'Actor "Ireena": ownership for Player (unset) → 2',
      'Actor "Ireena": HP (unset) → 5',
    ]);

    const plain = await plan(ops);
    expect(plain.diff.map(d => d.text)).toEqual([
      'Actor "Ireena": ownership for user u1 (unset) → 2',
      'Actor "Ireena": HP (unset) → 5',
    ]);
  });

  it('names scene dressing in the diff (I-112): darkness, light, coins, templates, notes, chat', async () => {
    // The fake module sends no parent labels or note texts; give the plan the ones Foundry sends.
    const real = foundry.query.getMockImplementation()!;
    foundry.query.mockImplementation((method: string, data?: any) =>
      method === 'foundry-mcp-bridge.snapshotGuardedOps'
        ? Promise.resolve([
            {
              exists: true,
              documentName: 'Scene',
              name: 'Field',
              values: [
                { path: 'environment.darknessLevel', present: true, value: 0.2 },
                { path: 'environment.darknessLock', present: true, value: true },
                { path: 'environment.globalLight.enabled', present: true, value: false },
              ],
            },
            {
              exists: true,
              documentName: 'Actor',
              name: 'Ireena',
              values: [{ path: 'system.currency.gp', present: true, value: 10 }],
            },
            {
              exists: true,
              documentName: 'Region',
              name: 'Circle Template',
              parent: { documentName: 'Scene', name: 'Field' },
              modifiedTime: 5,
            },
            {
              exists: true,
              documentName: 'Note',
              name: 'Trap',
              parent: { documentName: 'Scene', name: 'Field' },
              modifiedTime: 6,
            },
            {
              exists: true,
              documentName: 'Region',
              name: 'Circle Template',
              parent: { documentName: 'Scene', name: 'Field' },
            },
            {
              exists: true,
              documentName: 'Note',
              name: 'Trap',
              parent: { documentName: 'Scene', name: 'Field' },
            },
            { exists: true, documentName: 'ChatMessage', name: null },
          ])
        : real(method, data)
    );
    const p = await plan([
      {
        kind: 'update',
        uuid: 'Scene.s1',
        changes: {
          'environment.darknessLevel': 0.8,
          'environment.darknessLock': true,
          'environment.globalLight.enabled': true,
        },
      },
      { kind: 'update', uuid: 'Actor.ireena', changes: { 'system.currency.gp': 15 } },
      { kind: 'delete', uuid: 'Scene.s1.Region.r1' },
      { kind: 'delete', uuid: 'Scene.s1.Note.n1' },
      {
        kind: 'create',
        documentName: 'Region',
        parentUuid: 'Scene.s1',
        data: { name: 'Circle Template' },
      },
      { kind: 'create', documentName: 'Note', parentUuid: 'Scene.s1', data: { text: 'Trap' } },
      { kind: 'create', documentName: 'ChatMessage', data: { content: 'Loot' } },
    ]);
    expect(p.risk).toBe('destructive');
    expect(p.diff.map(d => d.text)).toEqual([
      'Scene "Field": darkness 0.2 → 0.8',
      'Scene "Field": darkness lock true → true',
      'Scene "Field": global light false → true',
      'Actor "Ireena": gp 10 → 15',
      'Delete Region "Circle Template" from Scene "Field"',
      'Delete Note "Trap" from Scene "Field"',
      'Create Region "Circle Template" on Scene "Field"',
      'Create Note "Trap" on Scene "Field"',
      'Create ChatMessage',
    ]);
  });

  it('keeps removing a status effect at one confirm, any other delete stays destructive (F5)', async () => {
    foundry.add('Actor.ireena.ActiveEffect.prone', 'ActiveEffect', { name: 'Prone' });
    const effect = await plan([{ kind: 'delete', uuid: 'Actor.ireena.ActiveEffect.prone' }]);
    expect(effect.risk).toBe('write');
    expect(effect.requires.confirmDestructive).toBe(false);
    const both = await plan([
      { kind: 'delete', uuid: 'Actor.ireena.ActiveEffect.prone' },
      { kind: 'delete', uuid: 'Actor.ireena' },
    ]);
    expect(both.risk).toBe('destructive');
  });

  it('rejects bad input and missing targets', async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ feature: 'Bad Id', summary: 's', ops: [HP_UPDATE] }, /Invalid feature id/],
      [{ feature: 'test-feature', summary: '  ', ops: [HP_UPDATE] }, /needs a summary/],
      [{ feature: 'test-feature', summary: 's' }, /Foundry ops, vault ops, or both/],
      [
        { feature: 'test-feature', summary: 's', ops: [HP_UPDATE], vaultOps: [] },
        /at least one op/,
      ],
      [{ feature: 'test-feature', summary: 's', ops: [] }, /at least one op/],
      [{ feature: 'test-feature', summary: 's', ops: [{ kind: 'zap' }] }, /Unknown op kind/],
      [
        { feature: 'test-feature', summary: 's', ops: [HP_UPDATE], rulesVersion: '2030' },
        /Unknown rules version/,
      ],
      [
        { feature: 'test-feature', summary: 's', ops: [{ kind: 'delete', uuid: 'Actor.gone' }] },
        /document not found: Actor.gone/,
      ],
      [
        {
          feature: 'test-feature',
          summary: 's',
          ops: [{ kind: 'create', documentName: 'Item', parentUuid: 'Actor.gone', data: {} }],
        },
        /parent not found/,
      ],
    ];
    for (const [input, message] of cases) {
      await expect(service.createPlan(input as never)).rejects.toThrow(message);
    }
    expect(service.listPlans()).toEqual([]);
  });

  it('surfaces a refused snapshot', async () => {
    foundry.query.mockResolvedValueOnce({ id: 'curse-of-strahd' });
    foundry.query.mockResolvedValueOnce({ success: false, error: 'Access denied' });
    await expect(plan([HP_UPDATE])).rejects.toThrow('Snapshot refused: Access denied');
  });

  it('expires plans after 15 minutes and caps how many are kept', async () => {
    const p = await plan([HP_UPDATE]);
    now += PLAN_TTL_MS;
    expect(() => service.getPlan(p.planId)).toThrow(/No pending plan/);

    service = makeService({ maxPlans: 2 });
    const a = await plan([HP_UPDATE]);
    now += 1;
    const b = await plan([HP_UPDATE]);
    now += 1;
    const c = await plan([HP_UPDATE]);
    expect(service.listPlans().map(x => x.planId)).toEqual([c.planId, b.planId]);
    expect(() => service.getPlan(a.planId)).toThrow(/No pending plan/);
  });
});

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

describe('applyPlan (Foundry ops)', () => {
  it('needs confirm, and confirmDestructive for a destructive plan', async () => {
    const p = await plan([HP_UPDATE]);
    await expect(service.applyPlan(p.planId, {})).rejects.toThrow(/needs confirm: true/);
    const d = await plan([{ kind: 'delete', uuid: 'Actor.ireena' }]);
    await expect(service.applyPlan(d.planId, { confirm: true })).rejects.toThrow(
      /confirmDestructive/
    );
    expect(foundry.docs.has('Actor.ireena')).toBe(true);
    expect(service.listPlans()).toHaveLength(2);
  });

  it('applies, records the audit entry and consumes the plan', async () => {
    const p = await plan([HP_UPDATE], { rulesVersion: '2024' });
    const applied = await service.applyPlan(p.planId, { confirm: true });
    expect(applied).toMatchObject({
      planId: p.planId,
      feature: 'test-feature',
      target: 'foundry',
      mode: 'apply',
      risk: 'write',
      appliedAt: '2026-09-28T12:00:00.000Z',
      documents: ['Actor.ireena'],
    });
    expect(applied.changeId).toMatch(/^chg-/);
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(4);

    const request = foundry.calls.find(([m]) => m.endsWith('applyGuardedOps'))![1];
    expect(request).toMatchObject({
      changeId: applied.changeId,
      feature: 'test-feature',
      mode: 'apply',
      rulesVersion: '2024',
    });

    const entry = await audit.get('curse-of-strahd', applied.changeId);
    expect(entry).toMatchObject({ target: 'foundry', rulesVersion: '2024', diff: applied.diff });
    expect(entry?.results?.[0].before).toEqual([
      { path: 'system.hp', present: true, value: 10 },
      { path: 'flags.foundry-mcp-bridge.attitude', present: true, value: 'friendly' },
    ]);
    expect(() => service.getPlan(p.planId)).toThrow(/No pending plan/);
    const [recent] = await service.listRecentChanges();
    expect(recent).toMatchObject({ changeId: applied.changeId, canUndo: true });
  });

  it('keeps the plan and records nothing when Foundry refuses or conflicts', async () => {
    const p = await plan([HP_UPDATE]);
    foundry.features[0].enabled = false;
    await expect(service.applyPlan(p.planId, { confirm: true })).rejects.toThrow(/switched off/);
    foundry.features[0].enabled = true;

    foundry.edit('Actor.ireena', { path: 'system.hp', present: true, value: 9 });
    await expect(service.applyPlan(p.planId, { confirm: true })).rejects.toThrow(/Conflict/);
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(9);
    expect(await service.listRecentChanges()).toEqual([]);
    expect(service.getPlan(p.planId).planId).toBe(p.planId);
  });

  it('surfaces a GM-gate refusal returned as data', async () => {
    const p = await plan([HP_UPDATE]);
    foundry.query.mockResolvedValueOnce({ id: 'curse-of-strahd' });
    foundry.query.mockResolvedValueOnce({ error: 'Access denied', success: false });
    await expect(service.applyPlan(p.planId, { confirm: true })).rejects.toThrow(
      'Foundry refused the change: Access denied'
    );
  });

  it('refuses a plan made for another world', async () => {
    const p = await plan([HP_UPDATE]);
    foundry.worldId = 'other-world';
    await expect(service.applyPlan(p.planId, { confirm: true })).rejects.toThrow(
      /made for world "curse-of-strahd", not "other-world"/
    );
  });

  it('applies a plan only once, even when confirmed twice at the same time', async () => {
    const p = await plan([HP_UPDATE]);
    const results = await Promise.allSettled([
      service.applyPlan(p.planId, { confirm: true }),
      service.applyPlan(p.planId, { confirm: true }),
    ]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(await service.listRecentChanges()).toHaveLength(1);
  });

  it('reports a change that was applied but could not be recorded', async () => {
    const p = await plan([HP_UPDATE]);
    vi.spyOn(audit, 'append').mockRejectedValueOnce(new Error('disk full'));
    await expect(service.applyPlan(p.planId, { confirm: true })).rejects.toThrow(
      /was applied but could not be recorded .*disk full/
    );
    expect(logger.error).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

describe('recorded listeners and undo guards', () => {
  it('waits for a listener, but never longer than listenerWaitMs', async () => {
    service = makeService({ listenerWaitMs: 20 });
    const seen: string[] = [];
    service.addRecordedListener(async (_world, changeId) => {
      await new Promise(r => setTimeout(r, 5));
      seen.push(changeId);
    });
    service.addRecordedListener(() => new Promise<void>(() => undefined)); // never settles
    const p = await plan([HP_UPDATE]);
    const applied = await service.applyPlan(p.planId, { confirm: true });
    expect(seen).toEqual([applied.changeId]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('listeners still running'),
      expect.objectContaining({ changeId: applied.changeId })
    );
  });

  it('a failing listener is logged and the change still answers', async () => {
    service.addRecordedListener(() => Promise.reject(new Error('listener broke')));
    const p = await plan([HP_UPDATE]);
    await expect(service.applyPlan(p.planId, { confirm: true })).resolves.toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith('onRecorded listener failed', {
      error: 'listener broke',
    });
  });

  it('an undo guard refuses with a conflict and writes nothing', async () => {
    const p = await plan([HP_UPDATE]);
    const applied = await service.applyPlan(p.planId, { confirm: true });
    service.setUndoGuard('test-feature', () => Promise.resolve('the GM edited it'));
    await expect(service.undo(applied.changeId, { confirm: true })).rejects.toThrow(
      'Conflict, nothing was written: the GM edited it'
    );
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(4);
  });
});

describe('undo (Foundry ops)', () => {
  it('restores the previous state and marks the change undone', async () => {
    const applied = await service.applyPlan((await plan([HP_UPDATE])).planId, { confirm: true });
    await expect(service.undo(applied.changeId, {})).rejects.toThrow(/needs confirm/);
    foundry.features[0].enabled = false; // undo works with the feature switched off

    const undone = await service.undo(applied.changeId, { confirm: true });
    expect(undone).toMatchObject({ mode: 'undo', undoOf: applied.changeId, planId: null });
    expect(foundry.docs.get('Actor.ireena')!.source).toMatchObject({
      system: { hp: 10 },
      flags: { 'foundry-mcp-bridge': { attitude: 'friendly' } },
    });
    const request = foundry.calls.filter(([m]) => m.endsWith('applyGuardedOps'))[1][1];
    expect(request.mode).toBe('undo');
    expect(request.expected[0].values).toEqual([
      { path: 'system.hp', present: true, value: 4 },
      { path: 'flags.foundry-mcp-bridge.attitude', present: false },
    ]);

    const [undoRow, original] = await service.listRecentChanges();
    // An undo can itself be undone (the redo), so its row stays undoable.
    expect(undoRow).toMatchObject({ changeId: undone.changeId, canUndo: true });
    expect(original).toMatchObject({ undoneBy: undone.changeId, canUndo: false });
    await expect(service.undo(applied.changeId, { confirm: true })).rejects.toThrow(
      /already undone/
    );
    await expect(service.undo('chg-nope', { confirm: true })).rejects.toThrow(/No recorded change/);
  });

  it('redoes a change by undoing its undo, and undoes it again', async () => {
    const applied = await service.applyPlan((await plan([HP_UPDATE])).planId, { confirm: true });
    const undone = await service.undo(applied.changeId, { confirm: true });
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(10);

    const redone = await service.undo(undone.changeId, { confirm: true });
    expect(redone).toMatchObject({ mode: 'undo', undoOf: undone.changeId });
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(4);
    await expect(service.undo(undone.changeId, { confirm: true })).rejects.toThrow(
      /already undone/
    );

    // The original is live again, the first undo is the undone one.
    const rows = await service.listRecentChanges();
    expect(rows.find(r => r.changeId === applied.changeId)).toMatchObject({ canUndo: true });
    expect(rows.find(r => r.changeId === applied.changeId)?.undoneBy).toBeUndefined();
    expect(rows.find(r => r.changeId === undone.changeId)).toMatchObject({
      canUndo: false,
      undoneBy: redone.changeId,
    });

    const again = await service.undo(applied.changeId, { confirm: true });
    expect(again.undoOf).toBe(applied.changeId);
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(10);
    expect((await service.undoState()).get(applied.changeId)?.undoneBy).toBe(again.changeId);
  });

  it('leaves a delete that found its document already gone out of the undo (no blank create)', async () => {
    // The redo of an AI item delete: dnd5e ends the concentration effect by itself when the
    // item goes, so the module reports that delete as alreadyGone. Undoing the redo must bring
    // the item back and leave the effect alone instead of sending `create ActiveEffect {}`.
    foundry.add('Actor.ireena.Item.spell', 'Item', { _id: 'spell', name: 'Bless' });
    foundry.add('Actor.ireena.ActiveEffect.conc', 'ActiveEffect', {
      _id: 'conc',
      name: 'Concentrating',
    });
    const p = await plan([
      { kind: 'delete', uuid: 'Actor.ireena.ActiveEffect.conc' },
      { kind: 'delete', uuid: 'Actor.ireena.Item.spell' },
    ]);
    const applied = await service.applyPlan(p.planId, { confirm: true, confirmDestructive: true });
    const undone = await service.undo(applied.changeId, { confirm: true });
    expect(foundry.docs.has('Actor.ireena.ActiveEffect.conc')).toBe(true);

    foundry.docs.delete('Actor.ireena.ActiveEffect.conc'); // dnd5e ends the concentration first
    const redone = await service.undo(undone.changeId, { confirm: true });
    const redoEntry = await audit.get('curse-of-strahd', redone.changeId);
    expect(redoEntry?.results?.map(r => [r.kind, r.alreadyGone ?? false])).toEqual([
      ['delete', true],
      ['delete', false],
    ]);

    const again = await service.undo(redone.changeId, { confirm: true });
    const requests = foundry.calls.filter(([m]) => m.endsWith('applyGuardedOps'));
    expect(requests).toHaveLength(4);
    const lastOps = requests[3][1].ops as GuardedOp[];
    expect(lastOps).toHaveLength(1);
    expect(lastOps[0]).toMatchObject({ kind: 'create', documentName: 'Item', keepId: true });
    expect(foundry.docs.get('Actor.ireena.Item.spell')?.source.name).toBe('Bless');
    expect([...foundry.docs.keys()].filter(k => k.includes('ActiveEffect'))).toEqual([]);
    const entry = await audit.get('curse-of-strahd', again.changeId);
    expect(entry?.diff).toContain(
      'Left alone: Actor.ireena.ActiveEffect.conc (it was already gone when the change ran)'
    );
  });

  it("refuses a redo while the original feature's switch is off (undo-change and a planned undo)", async () => {
    const applied = await service.applyPlan((await plan([HP_UPDATE])).planId, { confirm: true });
    foundry.features[0].enabled = false;
    // The undo itself works with the switch off.
    const undone = await service.undo(applied.changeId, { confirm: true });
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(10);

    await expect(service.undo(undone.changeId, { confirm: true })).rejects.toThrow(
      /"test-feature" feature is switched off/
    );
    foundry.features.push({ id: 'change-undo', name: '', hint: '', enabled: true });
    const redoPlan = await plan([HP_UPDATE], {
      feature: 'change-undo',
      undoes: { changes: [undone.changeId] },
    });
    await expect(service.applyPlan(redoPlan.planId, { confirm: true })).rejects.toThrow(
      /"test-feature" feature is switched off/
    );
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(10);

    foundry.features[0].enabled = true;
    await service.undo(undone.changeId, { confirm: true });
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(4);
  });

  it('carries the undoes of a plan and notes onto the audit entry and the diff', async () => {
    const p = await plan([HP_UPDATE], {
      notes: ['Kept, changed later: Ireena: HP stays 3'],
      undoes: { actions: ['x1'], changes: ['chg-old'] },
    });
    expect(p.diff.at(-1)).toMatchObject({
      kind: 'note',
      text: 'Kept, changed later: Ireena: HP stays 3',
    });
    const applied = await service.applyPlan(p.planId, { confirm: true });
    const entry = await audit.get('curse-of-strahd', applied.changeId);
    expect(entry?.undoes).toEqual({ actions: ['x1'], changes: ['chg-old'] });
    expect(entry?.diff.at(-1)).toBe('Kept, changed later: Ireena: HP stays 3');
    const state = await service.undoState();
    expect(state.get('act:x1')?.undoneBy).toBe(applied.changeId);
    // A plain apply has no undoes.
    const plain = await service.applyPlan((await plan([HP_UPDATE])).planId, { confirm: true });
    expect((await audit.get('curse-of-strahd', plain.changeId))?.undoes).toBeUndefined();
  });

  it('records who asked for an undo on its audit entry, and nothing for Claude', async () => {
    const first = await service.applyPlan((await plan([HP_UPDATE])).planId, { confirm: true });
    const byGm = await service.undo(first.changeId, { confirm: true }, 'Danni');
    expect((await audit.get('curse-of-strahd', byGm.changeId))?.requestedBy).toBe('Danni');

    const second = await service.applyPlan((await plan([HP_UPDATE])).planId, { confirm: true });
    const byClaude = await service.undo(second.changeId, { confirm: true });
    expect(await audit.get('curse-of-strahd', byClaude.changeId)).not.toHaveProperty('requestedBy');
  });

  it('shows who asked in list-recent-changes, only for changes a person asked for', async () => {
    const byGm = await service.applyPlan(
      (await plan([HP_UPDATE])).planId,
      { confirm: true },
      'Danni'
    );
    expect(byGm.requestedBy).toBe('Danni');
    const byClaude = await service.applyPlan((await plan([HP_UPDATE])).planId, { confirm: true });
    expect(byClaude).not.toHaveProperty('requestedBy');
    const undone = await service.undo(byGm.changeId, { confirm: true }, 'Mira');
    const rows = await service.listRecentChanges();
    expect(rows.find(r => r.changeId === byGm.changeId)?.requestedBy).toBe('Danni');
    expect(rows.find(r => r.changeId === undone.changeId)?.requestedBy).toBe('Mira');
    expect(rows.find(r => r.changeId === byClaude.changeId)).not.toHaveProperty('requestedBy');
  });

  it('records who asked for an apply on its audit entry, and nothing for Claude', async () => {
    const byGm = await service.applyPlan(
      (await plan([HP_UPDATE])).planId,
      { confirm: true },
      'Danni'
    );
    expect((await audit.get('curse-of-strahd', byGm.changeId))?.requestedBy).toBe('Danni');

    const byClaude = await service.applyPlan((await plan([HP_UPDATE])).planId, { confirm: true });
    expect(await audit.get('curse-of-strahd', byClaude.changeId)).not.toHaveProperty('requestedBy');
  });

  it('reports a conflict instead of clobbering a later edit', async () => {
    const applied = await service.applyPlan((await plan([HP_UPDATE])).planId, { confirm: true });
    foundry.edit('Actor.ireena', { path: 'system.hp', present: true, value: 1 });
    await expect(service.undo(applied.changeId, { confirm: true })).rejects.toThrow(/Conflict/);
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(1);
    expect((await service.listRecentChanges())[0].canUndo).toBe(true);
  });

  it('round-trips create and a big delete (snapshot kept in backups/)', async () => {
    foundry.add('JournalEntry.notes', 'JournalEntry', {
      _id: 'notes',
      name: 'Notes',
      text: 'x'.repeat(AUDIT_INLINE_DELETED_LIMIT),
    });
    const p = await plan([
      { kind: 'delete', uuid: 'JournalEntry.notes' },
      { kind: 'create', documentName: 'JournalEntry', data: { name: 'New' } },
    ]);
    const applied = await service.applyPlan(p.planId, { confirm: true, confirmDestructive: true });
    expect(foundry.docs.has('JournalEntry.notes')).toBe(false);
    expect(await store.list('curse-of-strahd', 'backups')).toEqual([`${applied.changeId}.json`]);

    await service.undo(applied.changeId, { confirm: true });
    expect(foundry.docs.has('JournalEntry.new1')).toBe(false);
    expect(foundry.docs.get('JournalEntry.notes')?.source.name).toBe('Notes');
    const undoOps = foundry.calls.filter(([m]) => m.endsWith('applyGuardedOps'))[1][1].ops;
    expect(undoOps.map((o: GuardedOp) => o.kind)).toEqual(['delete', 'create']);
  });
});

// ---------------------------------------------------------------------------
// Vault ops
// ---------------------------------------------------------------------------

describe('vault ops', () => {
  function vaultPlan(vaultOps: unknown[]): Promise<PlanView> {
    return service.createPlan({
      feature: 'test-feature',
      summary: 'Raise attention',
      vaultOps: vaultOps as never,
    });
  }

  it('plans, applies, logs and undoes a vault change', async () => {
    await store.write('curse-of-strahd', 'gm', 'attention.json', { vallaki: 1, secret: 'x' }, 2);
    const p = await vaultPlan([
      { kind: 'vault-set', file: 'attention.json', path: 'vallaki', value: 2 },
      { kind: 'vault-set', file: 'attention.json', path: 'regions.krezk.level', value: 1 },
    ]);
    expect(p).toMatchObject({ target: 'vault', risk: 'write' });
    expect(p.diff.map(d => d.text)).toEqual([
      'gm/attention.json: vallaki: 1 → 2',
      'gm/attention.json: regions.krezk.level: (unset) → 1',
    ]);

    const applied = await service.applyPlan(p.planId, { confirm: true });
    const file = await store.read('curse-of-strahd', 'gm', 'attention.json');
    expect(file).toMatchObject({
      schema: 2,
      data: { vallaki: 2, secret: 'x', regions: { krezk: { level: 1 } } },
    });
    expect(foundry.calls.find(([m]) => m.endsWith('logGmChange'))?.[1]).toEqual({
      changeId: applied.changeId,
      feature: 'test-feature',
      summary: 'Raise attention',
      mode: 'apply',
    });

    await service.undo(applied.changeId, { confirm: true });
    expect((await store.read('curse-of-strahd', 'gm', 'attention.json'))?.data).toEqual({
      vallaki: 1,
      secret: 'x',
      regions: { krezk: {} },
    });
  });

  it('creates a missing file, and a delete makes the plan destructive', async () => {
    const created = await vaultPlan([
      { kind: 'vault-set', file: 'npc-secrets.json', path: 'strahd.note', value: 'watching' },
    ]);
    await service.applyPlan(created.planId, { confirm: true });
    const del = await vaultPlan([
      { kind: 'vault-delete', file: 'npc-secrets.json', path: 'strahd' },
    ]);
    expect(del.risk).toBe('destructive');
    await expect(service.applyPlan(del.planId, { confirm: true })).rejects.toThrow(
      /confirmDestructive/
    );
    await service.applyPlan(del.planId, { confirm: true, confirmDestructive: true });
    expect((await store.read('curse-of-strahd', 'gm', 'npc-secrets.json'))?.data).toEqual({});
  });

  it('refuses when the feature is off or Foundry cannot be asked', async () => {
    const p = await vaultPlan([{ kind: 'vault-set', file: 'a.json', path: 'x', value: 1 }]);
    foundry.features[0].enabled = false;
    await expect(service.applyPlan(p.planId, { confirm: true })).rejects.toThrow(/switched off/);
    foundry.features = [];
    await expect(service.applyPlan(p.planId, { confirm: true })).rejects.toThrow(/Unknown feature/);
    foundry.features = [{ id: 'test-feature', name: '', hint: '', enabled: true }];

    const worldOnly = makeService({
      worldIds: { current: () => Promise.resolve('curse-of-strahd') },
    });
    const q = await worldOnly.createPlan({
      feature: 'test-feature',
      summary: 's',
      vaultOps: [{ kind: 'vault-set', file: 'a.json', path: 'x', value: 1 }],
    });
    foundry.connected = false;
    await expect(worldOnly.applyPlan(q.planId, { confirm: true })).rejects.toThrow(
      /Cannot check the "test-feature" switch/
    );
    expect(await store.read('curse-of-strahd', 'gm', 'a.json')).toBeNull();
  });

  it('refuses apply and undo while "Allow Write Operations" is off (the module never sees them)', async () => {
    const p = await vaultPlan([{ kind: 'vault-set', file: 'a.json', path: 'x', value: 1 }]);
    foundry.features[0].writesAllowed = false;
    await expect(service.applyPlan(p.planId, { confirm: true })).rejects.toThrow(
      /Write operations are disabled/
    );
    expect(await store.read('curse-of-strahd', 'gm', 'a.json')).toBeNull();

    foundry.features[0].writesAllowed = true;
    const applied = await service.applyPlan(p.planId, { confirm: true });
    foundry.features[0].writesAllowed = false;
    await expect(service.undo(applied.changeId, { confirm: true })).rejects.toThrow(
      /Write operations are disabled/
    );
    expect((await store.read('curse-of-strahd', 'gm', 'a.json'))?.data).toEqual({ x: 1 });

    // Undo needs the write switch, not the feature switch.
    foundry.features[0].writesAllowed = true;
    foundry.features[0].enabled = false;
    await service.undo(applied.changeId, { confirm: true });
    expect((await store.read('curse-of-strahd', 'gm', 'a.json'))?.data).toEqual({});
  });

  it('treats a module that does not report the write switch (before 0.19.0) as allowed', async () => {
    const p = await vaultPlan([{ kind: 'vault-set', file: 'a.json', path: 'x', value: 1 }]);
    delete foundry.features[0].writesAllowed;
    await service.applyPlan(p.planId, { confirm: true });
    expect((await store.read('curse-of-strahd', 'gm', 'a.json'))?.data).toEqual({ x: 1 });
  });

  it('does not fail when the GM feed cannot be reached', async () => {
    foundry.failLogGmChange = true;
    const p = await vaultPlan([{ kind: 'vault-set', file: 'a.json', path: 'x', value: 1 }]);
    await service.applyPlan(p.planId, { confirm: true });
    expect(logger.warn).toHaveBeenCalledWith(
      'Could not log the change to the GM feed',
      expect.objectContaining({ error: 'feed unavailable' })
    );
  });

  it('writes nothing when a value changed after the plan', async () => {
    await store.write('curse-of-strahd', 'gm', 'a.json', { x: 1, y: 1 });
    const p = await vaultPlan([
      { kind: 'vault-set', file: 'a.json', path: 'x', value: 2 },
      { kind: 'vault-set', file: 'a.json', path: 'y', value: 2 },
    ]);
    await store.write('curse-of-strahd', 'gm', 'a.json', { x: 1, y: 5 });
    await expect(service.applyPlan(p.planId, { confirm: true })).rejects.toThrow(
      /Conflict, nothing was written: a.json y changed since/
    );
    expect((await store.read('curse-of-strahd', 'gm', 'a.json'))?.data).toEqual({ x: 1, y: 5 });
  });

  it('validates vault ops', async () => {
    const cases: Array<[unknown, RegExp]> = [
      [{ kind: 'vault-zap', file: 'a.json', path: 'x' }, /Unknown vault op kind/],
      [{ kind: 'vault-set', file: '../a.json', path: 'x', value: 1 }, /file name/],
      [{ kind: 'vault-set', file: 'a.jsonl', path: 'x', value: 1 }, /\.json files/],
      [{ kind: 'vault-set', file: 'audit.json', path: 'x', value: 1 }, /Reserved/],
      [{ kind: 'vault-set', file: 'a.json', path: '__proto__.x', value: 1 }, /Invalid vault path/],
      [{ kind: 'vault-set', file: 'a.json', path: 'a..b', value: 1 }, /Invalid vault path/],
      [{ kind: 'vault-set', file: 'a.json', path: 'x' }, /needs a value/],
      [{ kind: 'vault-delete', file: 'a.json', path: 'x' }, /nothing to delete/],
    ];
    for (const [op, message] of cases) {
      await expect(vaultPlan([op])).rejects.toThrow(message);
    }
  });
});

// ---------------------------------------------------------------------------
// Mixed plans (Foundry + vault in one change)
// ---------------------------------------------------------------------------

describe('mixed plans', () => {
  const MIXED = {
    feature: 'test-feature',
    summary: 'Reveal a card',
    ops: [HP_UPDATE],
    vaultOps: [
      { kind: 'vault-set', file: 'reveals.json', path: 'pages.p1', value: { at: 'now' } },
      { kind: 'vault-set', file: 'reveals.json', path: 'pages.p1.feature', value: 'tarokka' },
    ],
  } as const;

  it('diffs both parts, counts earlier ops on the same file, and can be forced destructive', async () => {
    const p = await service.createPlan({ ...MIXED, risk: 'destructive' } as never);
    expect(p).toMatchObject({ target: 'mixed', risk: 'destructive' });
    expect(p.diff.map(d => d.text)).toEqual([
      'Actor "Ireena": system.hp: 10 → 4',
      'Actor "Ireena": flags.foundry-mcp-bridge.attitude: "friendly" → (unset)',
      'gm/reveals.json: pages.p1: (unset) → {"at":"now"}',
      'gm/reveals.json: pages.p1.feature: (unset) → "tarokka"',
    ]);
    await expect(service.createPlan({ ...MIXED, risk: 'mild' } as never)).rejects.toThrow(
      /Unknown risk override/
    );
  });

  it('applies and undoes both parts together', async () => {
    const p = await service.createPlan(MIXED as never);
    const applied = await service.applyPlan(p.planId, { confirm: true });
    expect(applied.target).toBe('mixed');
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(4);
    expect((await store.read('curse-of-strahd', 'gm', 'reveals.json'))?.data).toEqual({
      pages: { p1: { at: 'now', feature: 'tarokka' } },
    });
    // The Foundry apply logs its own gm-change event; no extra logGmChange.
    expect(foundry.calls.some(([m]) => m.endsWith('logGmChange'))).toBe(false);

    await service.undo(applied.changeId, { confirm: true });
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(10);
    expect((await store.read('curse-of-strahd', 'gm', 'reveals.json'))?.data).toEqual({
      pages: {},
    });
  });

  it('writes nothing in Foundry when the vault part conflicts', async () => {
    const p = await service.createPlan(MIXED as never);
    await store.write('curse-of-strahd', 'gm', 'reveals.json', { pages: { p1: 'taken' } });
    await expect(service.applyPlan(p.planId, { confirm: true })).rejects.toThrow(/Conflict/);
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(10);
    expect(foundry.calls.some(([m]) => m.endsWith('applyGuardedOps'))).toBe(false);
  });

  it('rolls the Foundry part back when the vault write fails', async () => {
    const p = await service.createPlan(MIXED as never);
    vi.spyOn(store, 'update').mockRejectedValueOnce(new Error('disk full'));
    await expect(service.applyPlan(p.planId, { confirm: true })).rejects.toThrow(
      /vault write failed \(disk full\); the Foundry part was rolled back/
    );
    expect(foundry.docs.get('Actor.ireena')!.source).toMatchObject({
      system: { hp: 10 },
      flags: { 'foundry-mcp-bridge': { attitude: 'friendly' } },
    });
    expect(await service.listRecentChanges()).toEqual([]);
  });

  it('rolls back without a blank create when the Foundry part only found things already gone', async () => {
    foundry.add('Actor.ireena.ActiveEffect.conc', 'ActiveEffect', {
      _id: 'conc',
      name: 'Concentrating',
    });
    const p = await service.createPlan({
      ...MIXED,
      ops: [{ kind: 'delete', uuid: 'Actor.ireena.ActiveEffect.conc' }],
    } as never);
    const applied = await service.applyPlan(p.planId, { confirm: true, confirmDestructive: true });
    const undone = await service.undo(applied.changeId, { confirm: true });
    foundry.docs.delete('Actor.ireena.ActiveEffect.conc'); // dnd5e took it first

    vi.spyOn(store, 'update').mockRejectedValueOnce(new Error('disk full'));
    await expect(service.undo(undone.changeId, { confirm: true })).rejects.toThrow(
      /vault write failed \(disk full\); the Foundry part was rolled back/
    );
    // apply, undo, the failed redo: no rollback request, nothing re-created from empty data.
    expect(foundry.calls.filter(([m]) => m.endsWith('applyGuardedOps'))).toHaveLength(3);
    expect([...foundry.docs.keys()].filter(k => k.includes('ActiveEffect'))).toEqual([]);
  });

  it('reports a rollback that also fails', async () => {
    const p = await service.createPlan(MIXED as never);
    vi.spyOn(store, 'update').mockRejectedValueOnce(new Error('disk full'));
    const real = foundry.query.getMockImplementation()!;
    let applies = 0;
    foundry.query.mockImplementation((method: string, data?: any) => {
      if (method.endsWith('applyGuardedOps') && ++applies === 2) {
        return Promise.reject(new Error('Conflict'));
      }
      return real(method, data);
    });
    await expect(service.applyPlan(p.planId, { confirm: true })).rejects.toThrow(
      /could not be rolled back: Conflict/
    );
  });
});

// ---------------------------------------------------------------------------
// Vault checks (pins the plan was built on)
// ---------------------------------------------------------------------------

describe('vault checks', () => {
  const W = 'curse-of-strahd';
  const PIN = { file: 'reading.json', path: 'current.id', value: 'r1' };

  beforeEach(async () => {
    await store.write(W, 'gm', 'reading.json', { current: { id: 'r1', seen: false } });
  });

  function pinned(extra: Record<string, unknown> = {}): Promise<PlanView> {
    return plan([HP_UPDATE], { vaultChecks: [PIN], ...extra });
  }

  it('adds no diff line, keeps the target, and records no vault ops', async () => {
    const p = await pinned();
    expect(p.target).toBe('foundry');
    expect(p.diff.map(d => d.text)).toEqual([
      'Actor "Ireena": system.hp: 10 → 4',
      'Actor "Ireena": flags.foundry-mcp-bridge.attitude: "friendly" → (unset)',
    ]);
    const update = vi.spyOn(store, 'update');
    const applied = await service.applyPlan(p.planId, { confirm: true });
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(4);
    // A check-only file is compared, never rewritten (no Obsidian mirror churn).
    expect(update.mock.calls.some(([, , file]) => file === 'reading.json')).toBe(false);
    const entry = await audit.get(W, applied.changeId);
    expect(entry?.vaultOps).toBeUndefined();
    expect(entry?.diff).toEqual(p.diff.map(d => d.text));
    // Undo takes back only the Foundry part.
    await service.undo(applied.changeId, { confirm: true });
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(10);
    expect((await store.read(W, 'gm', 'reading.json'))?.data).toEqual({
      current: { id: 'r1', seen: false },
    });
  });

  it('refuses and writes nothing when a pinned value changed before the apply', async () => {
    const p = await pinned({
      vaultOps: [{ kind: 'vault-set', file: 'reading.json', path: 'current.seen', value: true }],
    });
    expect(p.target).toBe('mixed');
    await store.write(W, 'gm', 'reading.json', { current: { id: 'r2', seen: false } });
    await expect(service.applyPlan(p.planId, { confirm: true })).rejects.toThrow(
      /Conflict, nothing was written: reading.json current.id changed since/
    );
    expect(foundry.calls.some(([m]) => m.endsWith('applyGuardedOps'))).toBe(false);
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(10);
    expect((await store.read(W, 'gm', 'reading.json'))?.data).toEqual({
      current: { id: 'r2', seen: false },
    });
  });

  it('writes the vault ops on a pinned file when the pin holds, and records only them', async () => {
    const p = await pinned({
      vaultOps: [{ kind: 'vault-set', file: 'reading.json', path: 'current.seen', value: true }],
    });
    expect(p.diff.map(d => d.text).at(-1)).toBe('gm/reading.json: current.seen: false → true');
    const applied = await service.applyPlan(p.planId, { confirm: true });
    expect((await store.read(W, 'gm', 'reading.json'))?.data).toEqual({
      current: { id: 'r1', seen: true },
    });
    expect((await audit.get(W, applied.changeId))?.vaultOps).toEqual([
      {
        file: 'reading.json',
        path: 'current.seen',
        before: { path: 'current.seen', present: true, value: false },
        after: { path: 'current.seen', present: true, value: true },
      },
    ]);
  });

  it('needs the feature switch for a pin, like a vault op', async () => {
    const p = await pinned();
    foundry.features[0].enabled = false;
    await expect(service.applyPlan(p.planId, { confirm: true })).rejects.toThrow(/switched off/);
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(10);
  });

  it('rolls the Foundry part back when a pinned file changes during the apply', async () => {
    const p = await pinned();
    const real = foundry.query.getMockImplementation()!;
    foundry.query.mockImplementation(async (method: string, data?: any) => {
      const result = await real(method, data);
      if (method.endsWith('applyGuardedOps') && data?.mode === 'apply') {
        await store.write(W, 'gm', 'reading.json', { current: { id: 'r2' } });
      }
      return result;
    });
    await expect(service.applyPlan(p.planId, { confirm: true })).rejects.toThrow(
      /reading.json changed during the write.*rolled back/
    );
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(10);
    expect(await service.listRecentChanges()).toEqual([]);
  });

  it('refuses at plan time when the pinned value already differs', async () => {
    await expect(plan([HP_UPDATE], { vaultChecks: [{ ...PIN, value: 'r0' }] })).rejects.toThrow(
      /Conflict: reading.json current.id changed while the plan was made/
    );
    await expect(
      plan([HP_UPDATE], { vaultChecks: [{ file: 'none.json', path: 'x', value: 1 }] })
    ).rejects.toThrow(/Conflict: none.json is missing; plan it again/);
  });

  it('records a vault op that sets the value it already has, without rewriting the file', async () => {
    const p = await plan([HP_UPDATE], {
      vaultOps: [{ kind: 'vault-set', file: 'reading.json', path: 'current.id', value: 'r1' }],
    });
    const update = vi.spyOn(store, 'update');
    const applied = await service.applyPlan(p.planId, { confirm: true });
    expect(update.mock.calls.some(([, , file]) => file === 'reading.json')).toBe(false);
    expect((await audit.get(W, applied.changeId))?.vaultOps).toEqual([
      {
        file: 'reading.json',
        path: 'current.id',
        before: { path: 'current.id', present: true, value: 'r1' },
        after: { path: 'current.id', present: true, value: 'r1' },
      },
    ]);
  });

  it('validates vault checks', async () => {
    const cases: Array<[unknown, RegExp]> = [
      ['x', /must be a list/],
      [[null], /needs file and path/],
      [[{ file: '../a.json', path: 'x', value: 1 }], /file name/],
      [[{ file: 'a.jsonl', path: 'x', value: 1 }], /\.json files/],
      [[{ file: 'audit.json', path: 'x', value: 1 }], /Reserved/],
      [[{ file: 'a.json', path: '__proto__.x', value: 1 }], /Invalid vault path/],
      [[{ file: 'a.json', path: 'x' }], /needs a value/],
    ];
    for (const [vaultChecks, message] of cases) {
      await expect(plan([HP_UPDATE], { vaultChecks })).rejects.toThrow(message);
    }
  });
});

// ---------------------------------------------------------------------------
// onRecorded
// ---------------------------------------------------------------------------

describe('onRecorded', () => {
  it('is called with the world and changeId after apply and after undo', async () => {
    const onRecorded = vi.fn();
    service = makeService({ onRecorded });
    const applied = await service.applyPlan((await plan([HP_UPDATE])).planId, { confirm: true });
    expect(onRecorded).toHaveBeenCalledWith('curse-of-strahd', applied.changeId);
    expect(onRecorded).toHaveBeenCalledTimes(1);

    const undone = await service.undo(applied.changeId, { confirm: true });
    expect(onRecorded).toHaveBeenCalledWith('curse-of-strahd', undone.changeId);
    expect(onRecorded).toHaveBeenCalledTimes(2);
  });

  it('is not called when the audit write fails', async () => {
    const onRecorded = vi.fn();
    service = makeService({ onRecorded });
    const p = await plan([HP_UPDATE]);
    vi.spyOn(audit, 'append').mockRejectedValueOnce(new Error('disk full'));
    await expect(service.applyPlan(p.planId, { confirm: true })).rejects.toThrow(/disk full/);
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('isolates a throwing listener: the apply still succeeds and the error is logged', async () => {
    const onRecorded = vi.fn(() => {
      throw new Error('boom');
    });
    service = makeService({ onRecorded });
    const p = await plan([HP_UPDATE]);
    const applied = await service.applyPlan(p.planId, { confirm: true });
    expect(applied.changeId).toMatch(/^chg-/);
    expect(onRecorded).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'onRecorded listener failed',
      expect.objectContaining({ error: 'boom' })
    );
  });
});

// ---------------------------------------------------------------------------
// autoApplyEnabled (F5)
// ---------------------------------------------------------------------------

describe('autoApplyEnabled', () => {
  function setLive(state: Record<string, unknown>): void {
    foundry.features = [
      {
        id: 'live-play',
        name: 'Live play',
        hint: '',
        enabled: true,
        writesAllowed: true,
        ...state,
      },
    ];
  }

  it('is true when the feature and its apply-without-confirming switch are on', async () => {
    setLive({ autoApply: true });
    await expect(service.autoApplyEnabled('live-play')).resolves.toBe(true);
  });

  it('is false when the switch is off or the feature does not offer it', async () => {
    setLive({ autoApply: false });
    await expect(service.autoApplyEnabled('live-play')).resolves.toBe(false);
    setLive({});
    await expect(service.autoApplyEnabled('live-play')).resolves.toBe(false);
  });

  it('is false when the feature switch is off', async () => {
    setLive({ autoApply: true, enabled: false });
    await expect(service.autoApplyEnabled('live-play')).resolves.toBe(false);
  });

  it('is false when "Allow Write Operations" is off', async () => {
    setLive({ autoApply: true, writesAllowed: false });
    await expect(service.autoApplyEnabled('live-play')).resolves.toBe(false);
  });

  it('is false for an unknown feature', async () => {
    setLive({ autoApply: true });
    await expect(service.autoApplyEnabled('ghost')).resolves.toBe(false);
  });

  it('is false when Foundry cannot be asked or refuses', async () => {
    setLive({ autoApply: true });
    foundry.connected = false;
    await expect(service.autoApplyEnabled('live-play')).resolves.toBe(false);
    foundry.connected = true;
    foundry.query.mockResolvedValueOnce({ success: false, error: 'GM only' });
    await expect(service.autoApplyEnabled('live-play')).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Show it now (I-110)
// ---------------------------------------------------------------------------

describe('showToPlayers (Show it now, I-110)', () => {
  const PAGE = 'JournalEntry.aaaaaaaaaaaaaaaa.JournalEntryPage.bbbbbbbbbbbbbbbb';
  const REVEAL: GuardedOp = {
    kind: 'update',
    uuid: PAGE,
    changes: { 'ownership.default': 2 },
  };
  let show: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    foundry.add(PAGE, 'JournalEntryPage', { name: 'The letter', ownership: { default: 0 } });
    show = vi.fn(() => ({ shown: true }));
    foundry.handlers['foundry-mcp-bridge.showJournalPage'] = show;
  });

  const showCalls = (): unknown[] =>
    foundry.calls.filter(([m]) => m.endsWith('showJournalPage')).map(([, d]) => d);

  it('adds one show line at the end of the diff', async () => {
    const p = await plan([REVEAL], { showToPlayers: { uuid: PAGE, users: [] } });
    expect(p.diff).toHaveLength(2);
    expect(p.diff[1]).toMatchObject({
      op: 1,
      kind: 'show',
      target: PAGE,
      label: 'JournalEntryPage "The letter"',
      text: "Show it now: pops the page up for every player who can see it (Foundry's Show Players; Undo cannot take this back)",
    });
    expect(showCalls()).toHaveLength(0);
    const one = await plan([REVEAL], { showToPlayers: { uuid: PAGE, users: ['u1'] } });
    expect(one.diff[1].text).toContain('pops the page up for 1 player (');
    const two = await plan([REVEAL], { showToPlayers: { uuid: PAGE, users: ['u1', 'u2'] } });
    expect(two.diff[1].text).toContain('pops the page up for 2 players (');
  });

  it('falls back to the uuid as the label when the page is not in the ops', async () => {
    const copy = 'JournalEntry.cccccccccccccccc.JournalEntryPage.dddddddddddddddd';
    const p = await plan([REVEAL], { showToPlayers: { uuid: copy, users: [] } });
    expect(p.diff[1]).toMatchObject({ kind: 'show', target: copy, label: copy });
  });

  it('shows the page after a successful apply, with the planned players', async () => {
    const p = await plan([REVEAL], { showToPlayers: { uuid: PAGE, users: ['u1', 'u2'] } });
    const applied = await service.applyPlan(p.planId, { confirm: true });
    expect(showCalls()).toEqual([{ uuid: PAGE, userIds: ['u1', 'u2'] }]);
    expect(applied.shown).toEqual({ ok: true, users: ['u1', 'u2'] });
    const applyIndex = foundry.calls.findIndex(([m]) => m.endsWith('applyGuardedOps'));
    const showIndex = foundry.calls.findIndex(([m]) => m.endsWith('showJournalPage'));
    expect(showIndex).toBeGreaterThan(applyIndex);
  });

  it('does not ask to show anything without showToPlayers', async () => {
    const applied = await service.applyPlan((await plan([REVEAL])).planId, { confirm: true });
    expect(showCalls()).toHaveLength(0);
    expect(applied).not.toHaveProperty('shown');
  });

  it('never shows on undo and leaves the show line out of the undo diff', async () => {
    const p = await plan([REVEAL], { showToPlayers: { uuid: PAGE, users: [] } });
    const applied = await service.applyPlan(p.planId, { confirm: true });
    expect(applied.diff.some(line => line.startsWith('Show it now:'))).toBe(true);
    const undone = await service.undo(applied.changeId, { confirm: true });
    expect(showCalls()).toHaveLength(1);
    expect(undone).not.toHaveProperty('shown');
    expect(undone.diff).toHaveLength(1);
    expect(undone.diff.some(line => line.includes('Show it now'))).toBe(false);
    expect(foundry.docs.get(PAGE)!.source.ownership.default).toBe(0);
  });

  it('still returns the applied change when the popup fails', async () => {
    show.mockImplementation(() => {
      throw new Error('socket closed');
    });
    const p = await plan([REVEAL], { showToPlayers: { uuid: PAGE, users: [] } });
    const applied = await service.applyPlan(p.planId, { confirm: true });
    expect(applied).toMatchObject({ mode: 'apply', shown: { ok: false, error: 'socket closed' } });
    expect(foundry.docs.get(PAGE)!.source.ownership.default).toBe(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Show it now failed'),
      expect.objectContaining({ uuid: PAGE })
    );
  });

  it('reports a refusal from the module as a failed popup', async () => {
    show.mockReturnValue({ success: false, error: 'Access denied' });
    const p = await plan([REVEAL], { showToPlayers: { uuid: PAGE, users: [] } });
    const applied = await service.applyPlan(p.planId, { confirm: true });
    expect(applied.shown).toEqual({ ok: false, error: 'Show refused: Access denied' });
  });

  it('refuses a bad uuid or users list when planning', async () => {
    const bad = (showToPlayers: unknown): Promise<PlanView> => plan([REVEAL], { showToPlayers });
    await expect(bad({ uuid: '', users: [] })).rejects.toThrow(/journal page or journal/);
    await expect(bad({ uuid: 'Actor.ireena', users: [] })).rejects.toThrow(
      /journal page or journal/
    );
    await expect(bad({ uuid: 42, users: [] })).rejects.toThrow(/journal page or journal/);
    await expect(bad({ uuid: PAGE, users: 'u1' })).rejects.toThrow(/user ids/);
    await expect(bad({ uuid: PAGE, users: [''] })).rejects.toThrow(/user ids/);
    await expect(bad({ uuid: PAGE, users: Array(51).fill('u') })).rejects.toThrow(/at most 50/);
  });
});
