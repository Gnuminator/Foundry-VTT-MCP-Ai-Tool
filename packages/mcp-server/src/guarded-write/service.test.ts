import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  GuardedApplyRequest,
  GuardedOp,
  GuardedOpResult,
  OpSnapshot,
  PathValue,
} from '@gnuminator/shared';

import { AUDIT_INLINE_DELETED_LIMIT, AuditLog } from '../vault/audit.js';
import { VaultStore } from '../vault/store.js';
import { GuardedWriteService, PLAN_TTL_MS, type PlanView } from './service.js';
import { readDataPath, samePathValue, writeDataPath } from './values.js';

// ---------------------------------------------------------------------------
// A fake Foundry module: enough of snapshotGuardedOps/applyGuardedOps to run
// plan -> apply -> undo end to end (the real one is tested in the module).
// ---------------------------------------------------------------------------

interface FakeDoc {
  documentName: string;
  source: Record<string, any>;
}

class FakeFoundry {
  docs = new Map<string, FakeDoc>();
  features = [{ id: 'test-feature', name: 'Test', hint: '', enabled: true }];
  worldId = 'curse-of-strahd';
  connected = true;
  failLogGmChange = false;
  private seq = 0;
  private clock = 100;
  readonly calls: Array<[string, any]> = [];

  add(uuid: string, documentName: string, source: Record<string, any>): FakeDoc {
    const doc = {
      documentName,
      source: { ...source, _stats: { modifiedTime: (this.clock += 1) } },
    };
    this.docs.set(uuid, doc);
    return doc;
  }

  edit(uuid: string, pathValue: PathValue): void {
    const doc = this.docs.get(uuid)!;
    doc.source = writeDataPath(doc.source, pathValue);
    doc.source._stats = { modifiedTime: (this.clock += 1) };
  }

  query = vi.fn((method: string, data?: any): Promise<any> => {
    this.calls.push([method, data]);
    if (!this.connected) return Promise.reject(new Error('Foundry VTT module not connected'));
    try {
      return Promise.resolve(this.handle(method, data));
    } catch (error) {
      return Promise.reject(error);
    }
  });

  private handle(method: string, data: any): unknown {
    switch (method) {
      case 'foundry-mcp-bridge.getWorldInfo':
        return { id: this.worldId };
      case 'foundry-mcp-bridge.snapshotGuardedOps':
        return (data.ops as GuardedOp[]).map(op => this.snapshot(op));
      case 'foundry-mcp-bridge.applyGuardedOps':
        return this.apply(data as GuardedApplyRequest);
      case 'foundry-mcp-bridge.listGuardedFeatures':
        return this.features;
      case 'foundry-mcp-bridge.logGmChange':
        if (this.failLogGmChange) throw new Error('feed unavailable');
        return { logged: true };
      default:
        throw new Error(`unexpected ${method}`);
    }
  }

  private paths(op: Extract<GuardedOp, { kind: 'update' }>): string[] {
    return [...Object.keys(op.changes), ...(op.unset ?? [])];
  }

  private snapshot(op: GuardedOp): OpSnapshot {
    if (op.kind === 'create') {
      const idTaken =
        op.keepId === true &&
        this.docs.has(
          `${op.parentUuid ? `${op.parentUuid}.` : ''}${op.documentName}.${String(op.data._id)}`
        );
      return {
        exists: op.parentUuid ? this.docs.has(op.parentUuid) : true,
        documentName: op.documentName,
        name: (op.data.name as string) ?? null,
        idTaken,
      };
    }
    const doc = this.docs.get(op.uuid);
    if (!doc) return { exists: false };
    const base = { exists: true, documentName: doc.documentName, name: doc.source.name ?? null };
    if (op.kind === 'delete') return { ...base, modifiedTime: doc.source._stats.modifiedTime };
    return { ...base, values: this.paths(op).map(p => readDataPath(doc.source, p)) };
  }

  private apply(req: GuardedApplyRequest): unknown {
    if (req.mode === 'apply') {
      const feature = this.features.find(f => f.id === req.feature);
      if (!feature?.enabled) throw new Error(`The "${req.feature}" feature is switched off`);
    }
    req.ops.forEach((op, i) => {
      const now = this.snapshot(op);
      const want = req.expected[i];
      const same =
        op.kind === 'create'
          ? now.exists && !now.idTaken
          : now.exists === want.exists &&
            (op.kind === 'delete'
              ? want.modifiedTime == null || want.modifiedTime === now.modifiedTime
              : (want.values ?? []).every((v, j) => samePathValue(v, now.values![j])));
      if (!same) throw new Error(`Conflict, nothing was written: op ${i}`);
    });
    const results: GuardedOpResult[] = req.ops.map((op, index) => {
      if (op.kind === 'update') {
        const doc = this.docs.get(op.uuid)!;
        const paths = this.paths(op);
        const before = paths.map(p => readDataPath(doc.source, p));
        for (const [p, value] of Object.entries(op.changes)) {
          doc.source = writeDataPath(doc.source, { path: p, present: true, value });
        }
        for (const p of op.unset ?? []) {
          doc.source = writeDataPath(doc.source, { path: p, present: false });
        }
        doc.source._stats = { modifiedTime: (this.clock += 1) };
        return {
          index,
          kind: 'update',
          uuid: op.uuid,
          documentName: doc.documentName,
          name: doc.source.name ?? null,
          parentUuid: null,
          before,
          after: paths.map(p => readDataPath(doc.source, p)),
        };
      }
      if (op.kind === 'create') {
        const id = op.keepId ? String(op.data._id) : `new${(this.seq += 1)}`;
        const uuid = `${op.parentUuid ? `${op.parentUuid}.` : ''}${op.documentName}.${id}`;
        const doc = this.add(uuid, op.documentName, { ...op.data, _id: id });
        return {
          index,
          kind: 'create',
          uuid,
          documentName: op.documentName,
          name: doc.source.name ?? null,
          parentUuid: op.parentUuid ?? null,
          modifiedTime: doc.source._stats.modifiedTime,
        };
      }
      const doc = this.docs.get(op.uuid)!;
      this.docs.delete(op.uuid);
      return {
        index,
        kind: 'delete',
        uuid: op.uuid,
        documentName: doc.documentName,
        name: doc.source.name ?? null,
        parentUuid: null,
        deleted: doc.source,
      };
    });
    return {
      changeId: req.changeId,
      mode: req.mode,
      appliedAt: '2026-09-28T12:00:00.000Z',
      results,
    };
  }
}

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

  it('rejects bad input and missing targets', async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ feature: 'Bad Id', summary: 's', ops: [HP_UPDATE] }, /Invalid feature id/],
      [{ feature: 'test-feature', summary: '  ', ops: [HP_UPDATE] }, /needs a summary/],
      [{ feature: 'test-feature', summary: 's' }, /either Foundry ops or vault ops/],
      [
        { feature: 'test-feature', summary: 's', ops: [HP_UPDATE], vaultOps: [] },
        /either Foundry ops or vault ops/,
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
    expect(undoRow).toMatchObject({ changeId: undone.changeId, canUndo: false });
    expect(original).toMatchObject({ undoneBy: undone.changeId, canUndo: false });
    await expect(service.undo(applied.changeId, { confirm: true })).rejects.toThrow(
      /already undone/
    );
    await expect(service.undo(undone.changeId, { confirm: true })).rejects.toThrow(
      /cannot be undone/
    );
    await expect(service.undo('chg-nope', { confirm: true })).rejects.toThrow(/No recorded change/);
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
