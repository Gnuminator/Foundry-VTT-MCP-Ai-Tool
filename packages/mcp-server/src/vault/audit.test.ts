import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AUDIT_HISTORY_FILE,
  AUDIT_INLINE_DELETED_LIMIT,
  AUDIT_RING_SIZE,
  AuditLog,
  type AuditEntry,
} from './audit.js';
import type { GuardedOpResult } from '@gnuminator/shared';

import { VaultStore } from './store.js';

let dataDir: string;
let store: VaultStore;
let audit: AuditLog;

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vault-audit-'));
  store = new VaultStore({ dataDir });
  audit = new AuditLog(store);
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

function entry(changeId: string, extra: Partial<AuditEntry> = {}): AuditEntry {
  return {
    changeId,
    planId: `plan-${changeId}`,
    feature: 'npc-attitudes',
    summary: `Change ${changeId}`,
    risk: 'write',
    target: 'foundry',
    mode: 'apply',
    appliedAt: '2026-09-28T10:00:00.000Z',
    diff: [],
    results: [],
    ...extra,
  };
}

describe('AuditLog', () => {
  it('appends, lists newest first and gets by id', async () => {
    await audit.append('w1', entry('c1'));
    await audit.append('w1', entry('c2'));
    await audit.append('w1', entry('c3'));
    expect((await audit.list('w1')).map(e => e.changeId)).toEqual(['c3', 'c2', 'c1']);
    expect((await audit.list('w1', 2)).map(e => e.changeId)).toEqual(['c3', 'c2']);
    expect((await audit.get('w1', 'c2'))?.summary).toBe('Change c2');
    expect(await audit.get('w1', 'nope')).toBeNull();
    expect(await audit.list('w2')).toEqual([]);
  });

  it('keeps small deleted snapshots inline', async () => {
    const deleted = { _id: 'a', name: 'Small' };
    await audit.append('w1', entry('c1', { results: [delResult(0, deleted)] }));
    const stored = await audit.get('w1', 'c1');
    expect(stored?.backupRef).toBeUndefined();
    expect(stored?.results?.[0].deleted).toEqual(deleted);
    expect(await store.list('w1', 'backups')).toEqual([]);
  });

  it('moves big deleted snapshots to backups/ and reads them back', async () => {
    const big = { _id: 'a', name: 'Big', biography: 'x'.repeat(AUDIT_INLINE_DELETED_LIMIT) };
    await audit.append(
      'w1',
      entry('c1', { results: [delResult(0, big), updResult(1), delResult(2, { _id: 'b' })] })
    );
    const stored = await audit.get('w1', 'c1');
    expect(stored?.backupRef).toBe('c1.json');
    expect(stored?.results?.some(r => 'deleted' in r)).toBe(false);
    expect(await store.list('w1', 'backups')).toEqual(['c1.json']);

    const results = await audit.resultsWithDeleted('w1', stored!);
    expect(results[0].deleted).toEqual(big);
    expect(results[1].deleted).toBeUndefined();
    expect(results[2].deleted).toEqual({ _id: 'b' });

    await store.remove('w1', 'backups', 'c1.json');
    await expect(audit.resultsWithDeleted('w1', stored!)).rejects.toThrow(/backup .* is missing/);
  });

  it(`keeps the newest ${AUDIT_RING_SIZE} entries and deletes dropped backups`, async () => {
    const big = { _id: 'a', text: 'x'.repeat(AUDIT_INLINE_DELETED_LIMIT) };
    await audit.append('w1', entry('first', { results: [delResult(0, big)] }));
    const envelope = await store.read<{ entries: AuditEntry[] }>('w1', 'gm', 'audit.json');
    const filler = Array.from({ length: AUDIT_RING_SIZE - 1 }, (_, i) => entry(`f${i}`));
    await store.write('w1', 'gm', 'audit.json', {
      entries: [...envelope!.data.entries, ...filler],
    });
    expect(await store.list('w1', 'backups')).toEqual(['first.json']);

    await audit.append('w1', entry('last'));
    const all = await audit.list('w1', 10_000);
    expect(all).toHaveLength(AUDIT_RING_SIZE);
    expect(all[0].changeId).toBe('last');
    expect(all.some(e => e.changeId === 'first')).toBe(false);
    expect(await store.list('w1', 'backups')).toEqual([]);
  });

  it('records an undo and marks the original in one write', async () => {
    await audit.append('w1', entry('c1'));
    await audit.recordUndo(
      'w1',
      entry('u1', { mode: 'undo', planId: null, undoOf: 'c1', appliedAt: '2026-09-28T11:00:00Z' })
    );
    const [undo, original] = await audit.list('w1');
    expect(undo).toMatchObject({ changeId: 'u1', undoOf: 'c1' });
    expect(original).toMatchObject({
      changeId: 'c1',
      undoneBy: 'u1',
      undoneAt: '2026-09-28T11:00:00Z',
    });
    await expect(audit.recordUndo('w1', entry('u2', { mode: 'undo' }))).rejects.toThrow(/undoOf/);
  });

  it('appends a contract-2 line to gm/audit-log.jsonl for an apply, exact shape', async () => {
    await audit.append(
      'w1',
      entry('c1', {
        rulesVersion: '2024',
        results: [updResult(0)],
        vaultOps: [
          {
            file: 'tarokka.json',
            path: 'a',
            before: { path: 'a', present: false },
            after: { path: 'a', present: true, value: 1 },
          },
        ],
      })
    );
    const lines = await store.readLines('w1', 'gm', AUDIT_HISTORY_FILE);
    expect(lines).toEqual([
      {
        v: 1,
        changeId: 'c1',
        planId: 'plan-c1',
        feature: 'npc-attitudes',
        summary: 'Change c1',
        risk: 'write',
        target: 'foundry',
        mode: 'apply',
        appliedAt: '2026-09-28T10:00:00.000Z',
        diff: [],
        rulesVersion: '2024',
      },
    ]);
  });

  it('appends a contract-2 line to gm/audit-log.jsonl for an undo, with undoOf', async () => {
    await audit.append('w1', entry('c1'));
    await audit.recordUndo(
      'w1',
      entry('u1', { mode: 'undo', planId: null, undoOf: 'c1', appliedAt: '2026-09-28T11:00:00Z' })
    );
    const lines = (await store.readLines('w1', 'gm', AUDIT_HISTORY_FILE)) as Array<
      Record<string, unknown>
    >;
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({
      v: 1,
      changeId: 'u1',
      planId: null,
      feature: 'npc-attitudes',
      summary: 'Change u1',
      risk: 'write',
      target: 'foundry',
      mode: 'undo',
      appliedAt: '2026-09-28T11:00:00Z',
      diff: [],
      undoOf: 'c1',
    });
  });

  it('keeps requestedBy on the history line when a person asked, and omits it otherwise', async () => {
    await audit.append('w1', entry('c1', { requestedBy: 'Danni' }));
    await audit.append('w1', entry('c2'));
    const lines = (await store.readLines('w1', 'gm', AUDIT_HISTORY_FILE)) as Array<
      Record<string, unknown>
    >;
    expect(lines[0]).toMatchObject({ v: 1, changeId: 'c1', requestedBy: 'Danni' });
    expect(lines[1]).not.toHaveProperty('requestedBy');
  });

  it('keeps undoes in the ring and on the history line, and ring() lists oldest first', async () => {
    const undoes = { actions: ['x1'], changes: ['c0'] };
    await audit.append('w1', entry('c1', { undoes }));
    await audit.append('w1', entry('c2'));
    expect((await audit.get('w1', 'c1'))?.undoes).toEqual(undoes);
    const lines = (await store.readLines('w1', 'gm', AUDIT_HISTORY_FILE)) as Array<
      Record<string, unknown>
    >;
    expect(lines[0]).toMatchObject({ changeId: 'c1', undoes });
    expect(lines[1]).not.toHaveProperty('undoes');
    expect((await audit.ring('w1')).map(e => e.changeId)).toEqual(['c1', 'c2']);
    expect(await audit.ring('nobody')).toEqual([]);
  });

  // 505 real atomic writes: about 7s on a Windows disk with Defender, past the 5s default.
  it('keeps every history line even past the ring size (append-only, never trimmed)', async () => {
    for (let i = 0; i < AUDIT_RING_SIZE + 5; i++) {
      await audit.append('w1', entry(`c${i}`));
    }
    expect(await store.readLines('w1', 'gm', AUDIT_HISTORY_FILE)).toHaveLength(AUDIT_RING_SIZE + 5);
    expect((await audit.list('w1', 10_000)).length).toBe(AUDIT_RING_SIZE);
  }, 30_000);
});

function delResult(index: number, deleted: Record<string, unknown>): GuardedOpResult {
  return {
    index,
    kind: 'delete' as const,
    uuid: `Actor.${index}`,
    documentName: 'Actor',
    name: null,
    parentUuid: null,
    deleted,
  };
}

function updResult(index: number): GuardedOpResult {
  return {
    index,
    kind: 'update' as const,
    uuid: `Actor.${index}`,
    documentName: 'Actor',
    name: null,
    parentUuid: null,
    before: [],
    after: [],
  };
}
