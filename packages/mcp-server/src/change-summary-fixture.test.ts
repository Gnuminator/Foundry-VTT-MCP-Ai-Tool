/**
 * The bridge's change summary (`list-changes`) as a shared fixture. This test builds the list with
 * the real ChangeHistory and compares it to `shared/fixtures/bridge/change-list.json`; the
 * dashboard's changes.test.ts reads the same file, so a change to the bridge's summary shape
 * fails here and a dashboard that stops reading a field fails there. Rewrite the file after an
 * intended change with `UPDATE_FIXTURES=1 npm test -w packages/mcp-server -- change-summary-fixture`.
 */
import { promises as fsp, readFileSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

import type { ChangeRecord, PathValue } from '@gnuminator/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { changeJournalFileName } from './change-journal-pump.js';
import { ChangeHistory } from './change-history.js';
import { localDateKey } from './event-pump.js';
import type { RecentChange } from './guarded-write/service.js';
import type { UndoState } from './guarded-write/undo-state.js';
import { VaultStore } from './vault/store.js';

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../shared/fixtures/bridge/change-list.json'
);

// Fixed in UTC so the times in the fixture do not depend on the machine's time zone.
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const MIN = 60_000;

const val = (p: string, value: unknown): PathValue => ({ path: p, present: true, value });

let counter = 0;
function hp(before: number, after: number, overrides: Partial<ChangeRecord> = {}): ChangeRecord {
  counter += 1;
  return {
    v: 1,
    key: `update:Actor.a1:${counter}`,
    seq: counter,
    t: NOW - 10 * MIN,
    actionId: `act-${counter}`,
    op: 'update',
    userId: 'u1',
    userName: 'Ilvara',
    userIsGM: false,
    documentName: 'Actor',
    uuid: 'Actor.a1',
    parentUuid: null,
    name: 'Ilvara',
    rootUuid: 'Actor.a1',
    rootName: 'Ilvara',
    sceneId: null,
    before: [val('system.attributes.hp.value', before)],
    after: [val('system.attributes.hp.value', after)],
    ...overrides,
  };
}

function ai(overrides: Partial<RecentChange> = {}): RecentChange {
  return {
    changeId: 'chg-1',
    planId: 'plan-1',
    feature: 'actor-change',
    summary: 'Damage Wolf 2',
    target: 'foundry',
    mode: 'apply',
    risk: 'write',
    appliedAt: new Date(NOW - 5 * MIN).toISOString(),
    diff: ['Actor "Wolf 2": HP 11 → 5'],
    documents: ['Actor.wolf2'],
    canUndo: true,
    ...overrides,
  };
}

describe('change summary fixture', () => {
  let dataDir: string;
  let store: VaultStore;

  beforeEach(async () => {
    counter = 0;
    dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'change-fixture-'));
    store = new VaultStore({ dataDir });
  });

  afterEach(async () => {
    await store.flush();
    await fsp.rm(dataDir, { recursive: true, force: true });
  });

  it('matches what the bridge answers for a human change, an AI change, an undo and an undone one', async () => {
    const records = [
      hp(10, 5, { actionId: 'h1', t: NOW - 20 * MIN }),
      hp(20, 12, { actionId: 'h0', t: NOW - 40 * MIN, userId: 'u2', userName: 'Aldric' }),
    ];
    await store.appendLines('w1', 'gm', changeJournalFileName(localDateKey(NOW)), records);
    const audit: RecentChange[] = [
      ai({
        changeId: 'chg-3',
        appliedAt: new Date(NOW - 2 * MIN).toISOString(),
        requestedBy: 'Danni',
      }),
      ai({
        changeId: 'chg-2',
        feature: 'change-undo',
        mode: 'undo',
        undoOf: 'chg-1',
        summary: 'Undo: Reveal',
        appliedAt: new Date(NOW - 3 * MIN).toISOString(),
        ownData: true,
      }),
      ai({
        changeId: 'chg-1',
        appliedAt: new Date(NOW - 60 * MIN).toISOString(),
        canUndo: false,
        undoneBy: 'chg-2',
        undoneAt: new Date(NOW - 50 * MIN).toISOString(),
      }),
    ];
    const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    logger.child = (): unknown => logger;
    const history = new ChangeHistory({
      store,
      worldIds: { current: (): Promise<string> => Promise.resolve('w1') },
      guardedWrites: {
        listRecentChanges: (): Promise<RecentChange[]> => Promise.resolve(audit),
        undoState: (): Promise<UndoState> => Promise.resolve(new Map()),
      },
      logger,
      now: () => NOW,
    });
    const actual = JSON.parse(JSON.stringify(await history.list()));
    if (process.env['UPDATE_FIXTURES'] === '1') {
      writeFileSync(FIXTURE, JSON.stringify(actual, null, 2) + '\n');
    }
    expect(actual).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')));
    // Every kind the dashboard reads is in the sample.
    const kinds = new Set(actual.changes.map((c: { kind: string }) => c.kind));
    expect([...kinds].sort()).toEqual(['ai', 'human']);
  });
});
