/* eslint-disable @typescript-eslint/require-await -- fakes that mimic async module calls */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GuardedApplyOutcome, GuardedOp } from '@gnuminator/shared';

import { FakeFoundry } from '../test-support/fake-foundry.js';
import { AuditLog } from '../vault/audit.js';
import { VaultStore } from '../vault/store.js';
import { APPLY_TIMEOUT_MS, GuardedWriteService } from './service.js';

const APPLY = 'foundry-mcp-bridge.applyGuardedOps';
const OUTCOME = 'foundry-mcp-bridge.guardedApplyOutcome';
const LOST = 'Query foundry-mcp-bridge.applyGuardedOps failed: Query timeout: applyGuardedOps';

const HP_UPDATE: GuardedOp = { kind: 'update', uuid: 'Actor.ireena', changes: { 'system.hp': 4 } };

let dataDir: string;
let foundry: FakeFoundry;
let logger: any;
let service: GuardedWriteService;
/** What the apply query does; default: behave like the fake module. */
let applyImpl: (data: any, options: any) => Promise<any>;
let outcomeImpl: (data: any) => Promise<any>;
const applyOptions: unknown[] = [];

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'guarded-outcome-'));
  foundry = new FakeFoundry();
  foundry.add('Actor.ireena', 'Actor', { name: 'Ireena', system: { hp: 10 } });
  logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  applyOptions.length = 0;
  applyImpl = (data): Promise<any> => foundry.query(APPLY, data);
  outcomeImpl = (): Promise<any> => Promise.reject(new Error('not configured'));
  const store = new VaultStore({ dataDir });
  service = new GuardedWriteService({
    foundryClient: {
      query: vi.fn((method: string, data?: any, options?: any): Promise<any> => {
        if (method === APPLY) {
          applyOptions.push(options);
          return applyImpl(data, options);
        }
        if (method === OUTCOME) return outcomeImpl(data);
        return foundry.query(method, data);
      }),
    } as any,
    worldIds: { current: async (): Promise<string> => 'curse-of-strahd' },
    store,
    audit: new AuditLog(store),
    logger,
    outcomePollIntervalMs: 5,
    outcomeDeadlineMs: 80,
  });
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

async function planAndApply(): Promise<Awaited<ReturnType<GuardedWriteService['applyPlan']>>> {
  const p = await service.createPlan({
    feature: 'test-feature',
    summary: 'Hurt Ireena',
    ops: [HP_UPDATE],
  });
  return service.applyPlan(p.planId, { confirm: true });
}

describe('apply timeout and outcome polling (PB-04)', () => {
  it('sends the apply with the long timeout', async () => {
    await planAndApply();
    expect(applyOptions).toEqual([{ timeoutMs: APPLY_TIMEOUT_MS }]);
    expect(APPLY_TIMEOUT_MS).toBe(120_000);
  });

  it('recovers an applied change after a lost answer: audit entry and undo exist', async () => {
    let applied: any;
    applyImpl = async (data): Promise<any> => {
      applied = await foundry.query(APPLY, data); // the module did apply it
      throw new Error(LOST);
    };
    outcomeImpl = async (data): Promise<GuardedApplyOutcome> => ({
      changeId: data.changeId,
      status: 'applied',
      result: applied,
    });
    const change = await planAndApply();
    expect(change.mode).toBe('apply');
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(4);
    const [row] = await service.listRecentChanges();
    expect(row).toMatchObject({ changeId: change.changeId, canUndo: true });

    applyImpl = (data): Promise<any> => foundry.query(APPLY, data);
    await service.undo(change.changeId, { confirm: true });
    expect(foundry.docs.get('Actor.ireena')!.source.system.hp).toBe(10);
  });

  it('also recovers after "Connection closed" and "not connected"', async () => {
    for (const message of [
      'Query x failed: Connection closed',
      'Foundry VTT module not connected. Please ensure Foundry is running',
    ]) {
      foundry.edit('Actor.ireena', { path: 'system.hp', present: true, value: 10 });
      let applied: any;
      applyImpl = async (data): Promise<any> => {
        applied = await foundry.query(APPLY, data);
        throw new Error(message);
      };
      outcomeImpl = async (data): Promise<GuardedApplyOutcome> => ({
        changeId: data.changeId,
        status: 'applied',
        result: applied,
      });
      await expect(planAndApply()).resolves.toMatchObject({ mode: 'apply' });
    }
  });

  it('throws the failure the module recorded', async () => {
    applyImpl = (): Promise<any> => Promise.reject(new Error(LOST));
    outcomeImpl = async (data): Promise<GuardedApplyOutcome> => ({
      changeId: data.changeId,
      status: 'failed',
      error: 'Conflict, nothing was written: op 0',
    });
    await expect(planAndApply()).rejects.toThrow('Conflict, nothing was written: op 0');
    expect(await service.listRecentChanges()).toHaveLength(0);
  });

  it('keeps asking while in-progress or while the link is down, then uses the result', async () => {
    let applied: any;
    applyImpl = async (data): Promise<any> => {
      applied = await foundry.query(APPLY, data);
      throw new Error(LOST);
    };
    let calls = 0;
    outcomeImpl = async (data): Promise<GuardedApplyOutcome> => {
      calls += 1;
      if (calls === 1) throw new Error('Foundry VTT module not connected');
      if (calls <= 3) return { changeId: data.changeId, status: 'in-progress' };
      return { changeId: data.changeId, status: 'applied', result: applied };
    };
    await expect(planAndApply()).resolves.toMatchObject({ mode: 'apply' });
    expect(calls).toBe(4);
  });

  it('gives up with the exact message on an unknown outcome and logs an error', async () => {
    applyImpl = (): Promise<any> => Promise.reject(new Error(LOST));
    outcomeImpl = async (data): Promise<GuardedApplyOutcome> => ({
      changeId: data.changeId,
      status: 'unknown',
    });
    await expect(planAndApply()).rejects.toThrow(
      /^The change may or may not have been applied in Foundry \(no answer within \d+ s\)\. Check Foundry before planning it again\.$/
    );
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('gives up when the deadline passes while the link stays down', async () => {
    applyImpl = (): Promise<any> => Promise.reject(new Error(LOST));
    outcomeImpl = (): Promise<any> => Promise.reject(new Error('not connected'));
    const started = Date.now();
    await expect(planAndApply()).rejects.toThrow(/may or may not have been applied/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(75);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('does not poll when Foundry refuses the change', async () => {
    applyImpl = (): Promise<any> =>
      Promise.reject(new Error('Query x failed: Conflict, nothing was written: op 0'));
    const spy = vi.fn();
    outcomeImpl = spy;
    await expect(planAndApply()).rejects.toThrow(/Conflict/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects an applied outcome whose result does not match the change', async () => {
    applyImpl = (): Promise<any> => Promise.reject(new Error(LOST));
    outcomeImpl = async (data): Promise<GuardedApplyOutcome> => ({
      changeId: data.changeId,
      status: 'applied',
      result: { changeId: 'someone-else', results: [], appliedAt: 'now' } as any,
    });
    await expect(planAndApply()).rejects.toThrow('Foundry returned an unexpected apply result');
  });
});
