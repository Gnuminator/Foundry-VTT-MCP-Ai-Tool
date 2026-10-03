/**
 * `get-prep-digest`: the vault parts come from real session and play logs in a
 * temp vault; Foundry, handouts, pre-flight, changes and Tarokka are stubs.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlayActorRef, PlayRecord, PrepScan } from '@gnuminator/shared';

import type { SessionEvent } from '../obsidian/grouping.js';
import { VaultStore } from '../vault/store.js';

import { PrepDigestTools, type PrepDigestToolsOptions } from './prep-digest.js';

const WORLD = 'w1';
const PC: PlayActorRef = { uuid: 'Actor.pc1', isPC: true, name: 'Ireena' };
const S1 = Date.parse('2026-10-01T12:00:00.000Z');
const S2 = S1 + 4 * 60 * 60 * 1000; // over the 3h gap: a second session
const MIN = 60_000;
const EM_DASH = String.fromCharCode(0x2014);

let dataDir: string;
let store: VaultStore;

function logger(): any {
  const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  l.child = (): unknown => l;
  return l;
}

function event(
  id: string,
  t: number,
  eventType: string,
  description: string,
  actorName: string | null = null
): SessionEvent {
  return {
    id,
    timestamp: new Date(t).toISOString(),
    timestampMs: t,
    eventType,
    actorName,
    description,
    details: null,
  };
}

function sceneRecord(key: string, t: number, sceneId: string, sceneName: string): PlayRecord {
  return {
    v: 2,
    key,
    t,
    seq: 1,
    kind: 'scene',
    userId: null,
    sceneId,
    actor: null,
    data: { sceneName },
  } as unknown as PlayRecord;
}

function hpRecord(key: string, t: number, sceneId: string): PlayRecord {
  return {
    v: 2,
    key,
    t,
    seq: 1,
    kind: 'hp',
    userId: null,
    sceneId,
    actor: PC,
    path: 'system.attributes.hp.value',
    before: 20,
    after: 0,
    delta: -20,
  } as unknown as PlayRecord;
}

const SCAN: PrepScan = {
  schema: 1,
  computedAt: 5,
  quests: [
    { journalId: 'q1', name: 'Find the Sunsword', status: 'Active', open: true },
    { journalId: 'q2', name: 'Bury the dead', status: 'Completed', open: false },
  ],
  campaigns: [
    {
      journalId: 'c1',
      name: 'Barovia',
      campaignId: 'barovia',
      parts: [
        { partId: 'p1', title: 'Arrival', status: 'completed' },
        { partId: 'p2', title: 'The Village', status: 'in_progress' },
        { partId: 'p3', title: 'Old Bonegrinder', status: 'skipped' },
      ],
    },
    {
      journalId: 'c2',
      name: 'Side plots',
      campaignId: 'side',
      parts: [{ partId: 'p9', title: 'Done', status: 'completed' }],
    },
  ],
  nextSession: {
    journalId: 'n1',
    name: 'Next session',
    pages: [{ pageId: 'np1', name: 'Plan', text: 'Open with the funeral.', truncated: false }],
    playerVisible: false,
  },
  bosses: [
    {
      sceneId: 's3',
      sceneName: 'Crypt',
      tokenId: 't1',
      tokenName: 'Vampire',
      actorName: 'Vampire',
      hidden: true,
      legendary: { max: 3, spent: 0, remaining: 3 },
      resistances: { max: 3, spent: 0, remaining: 3 },
      lair: null,
    },
  ],
};

interface Setup {
  scan?: PrepScan | Error | { success: false; error: string };
  revealed?: unknown[] | Error;
  queue?: unknown[] | Error;
  checks?: unknown;
  changes?: unknown[] | Error;
  tarokka?: unknown;
}

function makeTools(setup: Setup = {}): PrepDigestTools {
  const settle = (value: unknown): Promise<any> =>
    value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  const options: PrepDigestToolsOptions = {
    foundryClient: { query: vi.fn(() => settle(setup.scan ?? SCAN)) as any },
    worldIds: { current: (): Promise<string> => Promise.resolve(WORLD) },
    store,
    handouts: {
      listRevealed: () => settle(setup.revealed ?? []),
      listQueue: () => settle(setup.queue ?? []),
    },
    preflight: {
      checks: () =>
        settle(
          setup.checks ?? {
            ready: true,
            checks: [{ id: 'foundry-link', label: 'Foundry connected', status: 'ok', detail: '' }],
          }
        ),
    },
    guardedWrites: { listRecentChanges: () => settle(setup.changes ?? []) },
    tarokka: { getReading: () => settle(setup.tarokka ?? { available: false }) },
    logger: logger(),
    now: () => 1234,
  };
  return new PrepDigestTools(options);
}

async function seedSessions(extraBeats = 0): Promise<void> {
  await store.appendLines(WORLD, 'sessions', '2026-10-01.jsonl', [
    event('a1', S1, 'scene-change', 'Old session scene'),
  ]);
  const events: SessionEvent[] = [
    event('b1', S2, 'scene-change', 'The party reaches the village'),
    event('b2', S2 + 5 * MIN, 'hp-change', 'Not a beat'),
    event('b3', S2 + 10 * MIN, 'combat-start', 'Zombies attack'),
    event('b4', S2 + 20 * MIN, 'death', 'Zombie dies', 'Zombie'),
    event('b5', S2 + 21 * MIN, 'death', 'Zombie dies', 'Zombie'),
    event('b6', S2 + 22 * MIN, 'death', 'Ireena dies', 'Ireena'),
    event('b7', S2 + 30 * MIN, 'combat-end', 'The fight is over'),
    event('b8', S2 + 40 * MIN, 'journal-updated', 'Notes changed', 'Gamemaster'),
  ];
  for (let i = 0; i < extraBeats; i++) {
    events.push(event(`x${i}`, S2 + 50 * MIN + i * 1000, 'journal-created', `Extra ${i}`));
  }
  await store.appendLines(WORLD, 'sessions', '2026-10-01.jsonl', events);
  await store.appendLines(WORLD, 'sessions', '2026-10-01.play.jsonl', [
    sceneRecord('p0', S1, 's1', 'Castle'),
    sceneRecord('p1', S2, 's2', 'Village'),
    hpRecord('p2', S2 + 12 * MIN, 's3'),
    sceneRecord('p3', S2 + 14 * MIN, 's3', 'Crypt'),
    hpRecord('p4', S2 + 25 * MIN, 's2'),
  ]);
}

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'prep-digest-'));
  store = new VaultStore({ dataDir });
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe('get-prep-digest', () => {
  it('is one read tool with an action parameter', () => {
    const defs = makeTools().getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['get-prep-digest']);
    expect(defs[0]?.inputSchema.properties).toHaveProperty('action');
    expect(defs[0]?.description).toMatch(/GM ONLY/);
    expect(defs[0]?.description).not.toContain(EM_DASH);
  });

  it('rejects an unknown action', async () => {
    await expect(makeTools().handleGetPrepDigest({ action: 'all' })).rejects.toThrow();
  });

  it('an empty vault has no last session, and the Foundry parts still come back', async () => {
    const digest = await makeTools().handleGetPrepDigest({});
    expect(digest).toMatchObject({
      schema: 1,
      action: 'summary',
      worldId: WORLD,
      computedAt: 1234,
      lastSession: null,
      handoutQueue: [],
      tarokka: { hasReading: false },
      recentChanges: { count: 0, latest: [] },
      warnings: [],
    });
    expect(digest.openQuests?.map(q => q.name)).toEqual(['Find the Sunsword']);
  });

  it('describes the latest session: numbering, scenes in first-visit order, who went down, beats', async () => {
    await seedSessions();
    const digest = await makeTools().handleGetPrepDigest({});
    const last = digest.lastSession;
    expect(last).toMatchObject({
      number: 2,
      label: expect.stringMatching(/ S02$/),
      startedAt: new Date(S2).toISOString(),
      // Dropped to 0 HP, split by the play log's PC flag: Ireena is a PC, the zombie is not.
      wentDown: { pcs: ['Ireena'], others: ['Zombie'] },
      beatsTruncated: false,
    });
    expect(last?.scenes).toEqual(['Village', 'Crypt']);
    expect(last?.beats.map(b => b.kind)).toEqual([
      'scene-change',
      'combat-start',
      'death',
      'death',
      'death',
      'combat-end',
      'journal-updated',
    ]);
    expect(last?.beats[0]).toEqual({
      at: new Date(S2).toISOString(),
      kind: 'scene-change',
      text: 'The party reaches the village',
      actorName: null,
    });
    expect(JSON.stringify(last)).not.toContain('Old session scene');
  });

  it('summary keeps the most recent 25 beats, last-session up to 200', async () => {
    await seedSessions(30); // 7 beats plus 30 extras = 37
    const summary = await makeTools().handleGetPrepDigest({ action: 'summary' });
    expect(summary.lastSession?.beats).toHaveLength(25);
    expect(summary.lastSession?.beatsTruncated).toBe(true);
    expect(summary.lastSession?.beats.at(-1)?.text).toBe('Extra 29');
    const full = await makeTools().handleGetPrepDigest({ action: 'last-session' });
    expect(full.action).toBe('last-session');
    expect(full.lastSession?.beats).toHaveLength(37);
    expect(full.lastSession?.beatsTruncated).toBe(false);
  });

  it('lists handouts revealed in the last session only, and the queue with scene names', async () => {
    await seedSessions();
    const digest = await makeTools({
      revealed: [
        {
          title: 'Letter',
          uuid: 'JournalEntry.a.JournalEntryPage.b',
          revealedAt: new Date(S2 + 15 * MIN).toISOString(),
          seenBy: [
            { name: 'Ann', at: 'x' },
            { name: 'Ann', at: 'y' },
            { name: 'Bo', at: 'z' },
          ],
        },
        {
          title: 'Earlier map',
          uuid: 'JournalEntry.c.JournalEntryPage.d',
          revealedAt: new Date(S1).toISOString(),
          seenBy: [],
        },
      ],
      queue: [
        { title: 'Crypt note', uuid: 'u1', sceneId: 's3', players: ['user1'] },
        { title: 'Anywhere note', uuid: 'u2', sceneId: null },
        { title: 'Lost scene note', uuid: 'u3', sceneId: 'gone' },
      ],
    }).handleGetPrepDigest({});
    expect(digest.lastSession?.handoutsRevealed).toEqual([
      { title: 'Letter', uuid: 'JournalEntry.a.JournalEntryPage.b', seenBy: ['Ann', 'Bo'] },
    ]);
    expect(digest.handoutQueue).toEqual([
      { title: 'Crypt note', uuid: 'u1', sceneId: 's3', sceneName: 'Crypt', players: ['user1'] },
      { title: 'Anywhere note', uuid: 'u2', sceneId: null, sceneName: null },
      { title: 'Lost scene note', uuid: 'u3', sceneId: 'gone', sceneName: null },
    ]);
  });

  it('keeps open quests, unfinished campaign parts, the Next session journal and bosses', async () => {
    const digest = await makeTools().handleGetPrepDigest({});
    expect(digest.openQuests).toEqual([SCAN.quests[0]]);
    expect(digest.openCampaignParts).toEqual([
      {
        journalId: 'c1',
        name: 'Barovia',
        parts: [{ partId: 'p2', title: 'The Village', status: 'in_progress' }],
      },
    ]);
    expect(digest.nextSession?.pages[0]?.text).toBe('Open with the funeral.');
    expect(digest.bosses).toEqual(SCAN.bosses);
  });

  it('a missing Next session journal is null, not undefined', async () => {
    const digest = await makeTools({
      scan: { ...SCAN, nextSession: null },
    }).handleGetPrepDigest({});
    expect(digest.nextSession).toBeNull();
  });

  it('without Foundry the Foundry parts are null, nextSession is absent and a warning says so', async () => {
    await seedSessions();
    const digest = await makeTools({
      scan: new Error('Foundry is not connected'),
    }).handleGetPrepDigest({});
    expect(digest.openQuests).toBeNull();
    expect(digest.openCampaignParts).toBeNull();
    expect(digest.bosses).toBeNull();
    expect('nextSession' in digest).toBe(false);
    expect(digest.lastSession?.number).toBe(2);
    expect(digest.warnings).toHaveLength(1);
    expect(digest.warnings[0]).toMatch(/Foundry did not answer the prep scan/);
    expect(digest.warnings[0]).toMatch(/Foundry is not connected/);
  });

  it('treats a refused scan (an old module) like no Foundry', async () => {
    const digest = await makeTools({
      scan: { success: false, error: 'Unknown query' },
    }).handleGetPrepDigest({});
    expect(digest.openQuests).toBeNull();
    expect(digest.warnings[0]).toMatch(/Unknown query/);
  });

  it('summarizes pre-flight: counts, failing first, at most 8 items', async () => {
    const checks = [
      { id: 'a', label: 'Warn one', status: 'warn', detail: '' },
      { id: 'b', label: 'Fail one', status: 'fail', detail: '' },
      { id: 'c', label: 'Fine', status: 'ok', detail: '' },
      { id: 'd', label: 'Just info', status: 'info', detail: '' },
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `w${i}`,
        label: `Warn ${i}`,
        status: 'warn',
        detail: '',
      })),
    ];
    const digest = await makeTools({ checks: { ready: false, checks } }).handleGetPrepDigest({});
    expect(digest.preflight?.fail).toBe(1);
    expect(digest.preflight?.warn).toBe(11);
    expect(digest.preflight?.items).toHaveLength(8);
    expect(digest.preflight?.items[0]).toEqual({ severity: 'fail', title: 'Fail one' });
    expect(digest.preflight?.items[1]).toEqual({ severity: 'warn', title: 'Warn one' });
  });

  it('counts applied changes (not undos) and returns the latest five, newest first', async () => {
    const changes = [
      { mode: 'undo', summary: 'Undid 7', appliedAt: '2026-10-01T10:07:00.000Z' },
      ...Array.from({ length: 7 }, (_, i) => ({
        mode: 'apply',
        summary: `Change ${7 - i}`,
        appliedAt: `2026-10-01T10:0${7 - i}:00.000Z`,
      })),
    ];
    const digest = await makeTools({ changes }).handleGetPrepDigest({});
    expect(digest.recentChanges.count).toBe(7);
    expect(digest.recentChanges.latest).toHaveLength(5);
    expect(digest.recentChanges.latest[0]).toEqual({
      title: 'Change 7',
      appliedAt: '2026-10-01T10:07:00.000Z',
    });
  });

  it('says only whether a Tarokka reading exists, never the cards', async () => {
    const digest = await makeTools({
      tarokka: { available: true, reading: { positions: [{ card: 'The Tower of Doom' }] } },
    }).handleGetPrepDigest({});
    expect(digest.tarokka).toEqual({ hasReading: true });
    expect(JSON.stringify(digest)).not.toContain('Tower of Doom');
  });

  it('fails soft: each broken source becomes one warning and the rest still comes back', async () => {
    await seedSessions();
    const digest = await makeTools({
      revealed: new Error('revealed boom'),
      queue: new Error('queue boom'),
      checks: new Error('preflight boom'),
      changes: new Error('changes boom'),
      tarokka: new Error('tarokka boom'),
    }).handleGetPrepDigest({});
    expect(digest.lastSession?.number).toBe(2);
    expect(digest.lastSession?.handoutsRevealed).toEqual([]);
    expect(digest.handoutQueue).toEqual([]);
    expect(digest.preflight).toBeNull();
    expect(digest.recentChanges).toEqual({ count: 0, latest: [] });
    expect(digest.tarokka.hasReading).toBe(false);
    expect(digest.openQuests).toHaveLength(1);
    expect(digest.warnings).toHaveLength(5);
    for (const word of ['revealed', 'queue', 'preflight', 'changes', 'tarokka']) {
      expect(
        digest.warnings.some(w => w.includes(`${word} boom`)),
        word
      ).toBe(true);
    }
  });

  it('a vault that cannot be read is a warning, not an error', async () => {
    const tools = makeTools();
    (tools as any).options.store = {
      list: (): Promise<string[]> => Promise.reject(new Error('disk gone')),
      readLines: (): Promise<unknown[]> => Promise.resolve([]),
    };
    const digest = await tools.handleGetPrepDigest({});
    expect(digest.lastSession).toBeNull();
    expect(digest.warnings.join(' ')).toMatch(/last session could not be read.*disk gone/);
  });

  it('writes no em dashes in its warnings', async () => {
    const digest = await makeTools({
      scan: new Error('no link'),
      checks: new Error('x'),
    }).handleGetPrepDigest({});
    expect(digest.warnings.join(' ')).not.toContain(EM_DASH);
  });
});
