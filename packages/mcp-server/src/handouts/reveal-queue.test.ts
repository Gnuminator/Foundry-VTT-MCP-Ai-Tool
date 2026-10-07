/**
 * I-039 end to end: the reveal queue, reveals to chosen players and the seen
 * log. Plans go through the real GuardedWriteService on a temp vault; Foundry
 * is the fake module with a `getPagesForPlayers` handler (default ownership
 * only, like service.test.ts).
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageForPlayers } from '@gnuminator/shared';

import { GuardedWriteService } from '../guarded-write/service.js';
import { FakeFoundry } from '../test-support/fake-foundry.js';
import { AuditLog } from '../vault/audit.js';
import { VaultStore } from '../vault/store.js';
import { QUEUE_FILE } from './queue.js';
import { HandoutsService, handleRecordHandoutSeen } from './service.js';

const WORLD = 'curse-of-strahd';
const PAGE1 = 'JournalEntry.jjjjjjjjjjjjjjjj.JournalEntryPage.pppppppppppppppp';
const PAGE2 = 'JournalEntry.jjjjjjjjjjjjjjjj.JournalEntryPage.qqqqqqqqqqqqqqqq';
const HIDDEN = 'JournalEntry.gggggggggggggggg.JournalEntryPage.hhhhhhhhhhhhhhhh';
const ANNA = 'aaaaaaaaaaaaaaaa';
const BO = 'bbbbbbbbbbbbbbbb';
const SCENE = 'ssssssssssssssss';
const OTHER_SCENE = 'tttttttttttttttt';

let dataDir: string;
let foundry: FakeFoundry;
let store: VaultStore;
let guarded: GuardedWriteService;
let handouts: HandoutsService;
let now: number;

function pageForPlayers(uuid: string): PageForPlayers {
  const doc = foundry.docs.get(uuid);
  if (!doc) {
    return {
      uuid,
      exists: false,
      name: null,
      observable: false,
      journalObservable: false,
      html: null,
    };
  }
  const journal = foundry.docs.get(uuid.split('.JournalEntryPage.')[0]);
  const journalLevel = journal
    ? ((journal.source.ownership as Record<string, number> | undefined)?.default ?? 0)
    : undefined;
  const own = (doc.source.ownership as Record<string, number> | undefined)?.default;
  const pageLevel = own === undefined || own === -1 ? (journalLevel ?? 0) : own;
  const journalObservable = journal ? journalLevel! >= 2 : uuid !== HIDDEN;
  const text = doc.source.text as { content?: string } | undefined;
  return {
    uuid,
    exists: true,
    name: (doc.source.name as string | undefined) ?? null,
    observable: journalObservable && pageLevel >= 2,
    journalObservable,
    html: text?.content ?? null,
    type: 'text',
    src: null,
    caption: null,
  };
}

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'handout-queue-'));
  foundry = new FakeFoundry();
  foundry.worldId = WORLD;
  foundry.features = [{ id: 'handouts', name: 'Handouts', hint: '', enabled: true }];
  foundry.handlers['foundry-mcp-bridge.getPagesForPlayers'] = (data: {
    uuids: string[];
  }): { pages: PageForPlayers[] } => ({ pages: data.uuids.map(pageForPlayers) });
  store = new VaultStore({ dataDir });
  now = Date.parse('2026-09-30T20:00:00.000Z');
  const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  const worldIds = { current: (): Promise<string> => Promise.resolve(WORLD) };
  guarded = new GuardedWriteService({
    foundryClient: foundry,
    worldIds,
    store,
    audit: new AuditLog(store),
    logger,
    now: (): number => now,
  });
  handouts = new HandoutsService({
    guardedWrites: guarded,
    store,
    worldIds,
    foundryClient: foundry,
    now: (): number => now,
  });
  foundry.add(PAGE1, 'JournalEntryPage', {
    name: 'Letter from Kolyan',
    ownership: { default: 0 },
    text: { content: '<p>Come to Barovia.</p>' },
  });
  foundry.add(PAGE2, 'JournalEntryPage', {
    name: 'Map of Vallaki',
    ownership: { default: 0 },
    text: { content: '<p>A map.</p>' },
  });
  foundry.add(HIDDEN, 'JournalEntryPage', {
    name: 'Tome Page',
    ownership: { default: 0 },
    text: { content: '<p>Old text.</p>' },
  });
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

async function apply(planId: string): Promise<string> {
  const applied = await guarded.applyPlan(planId, { confirm: true, confirmDestructive: true });
  return applied.changeId;
}

function ownershipOf(uuid: string): Record<string, number> {
  return (foundry.docs.get(uuid)?.source.ownership as Record<string, number>) ?? {};
}

describe('reveal queue', () => {
  it('queues pages without touching Foundry and lists them oldest first with titles', async () => {
    const q1 = await handouts.queuePage({ pageUuid: PAGE1, sceneId: SCENE, players: [ANNA] });
    now += 1000;
    await handouts.queuePage({ pageUuid: PAGE2 });
    expect(q1).toMatchObject({ queued: true, pageUuid: PAGE1 });
    expect(q1.note).toContain('for 1 player');
    expect(ownershipOf(PAGE1)).toEqual({ default: 0 });
    const queue = await handouts.listQueue();
    expect(queue.map(q => [q.title, q.sceneId, q.players])).toEqual([
      ['Letter from Kolyan', SCENE, [ANNA]],
      ['Map of Vallaki', null, undefined],
    ]);
  });

  it('queueing a page again updates it in place; unqueue removes it', async () => {
    await handouts.queuePage({ pageUuid: PAGE1, sceneId: SCENE });
    const again = await handouts.queuePage({ pageUuid: PAGE1, sceneId: OTHER_SCENE });
    expect(again.note).toContain('already queued');
    expect((await handouts.listQueue()).map(q => q.sceneId)).toEqual([OTHER_SCENE]);
    await handouts.unqueuePage({ pageUuid: PAGE1 });
    expect(await handouts.listQueue()).toEqual([]);
    await expect(handouts.unqueuePage({ pageUuid: PAGE1 })).rejects.toThrow(
      /not in the reveal queue/
    );
  });

  it('tells the queue-changed listeners after a queue or unqueue, and not after a refusal', async () => {
    const listener = vi.fn();
    handouts.addQueueChangedListener(listener);
    await handouts.queuePage({ pageUuid: PAGE1 });
    expect(listener).toHaveBeenCalledTimes(1);
    await handouts.queuePage({ pageUuid: PAGE1, sceneId: SCENE });
    expect(listener).toHaveBeenCalledTimes(2);
    await handouts.unqueuePage({ pageUuid: PAGE1 });
    expect(listener).toHaveBeenCalledTimes(3);
    await expect(handouts.unqueuePage({ pageUuid: PAGE1 })).rejects.toThrow();
    await expect(
      handouts.queuePage({
        pageUuid: 'JournalEntry.jjjjjjjjjjjjjjjj.JournalEntryPage.zzzzzzzzzzzzzzzz',
      })
    ).rejects.toThrow();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('a throwing or rejecting queue-changed listener never fails the queue change', async () => {
    handouts.addQueueChangedListener(() => {
      throw new Error('boom');
    });
    // eslint-disable-next-line @typescript-eslint/require-await -- a listener that rejects
    handouts.addQueueChangedListener(async () => {
      throw new Error('async boom');
    });
    const last = vi.fn();
    handouts.addQueueChangedListener(last);
    await expect(handouts.queuePage({ pageUuid: PAGE1 })).resolves.toMatchObject({ queued: true });
    await expect(handouts.unqueuePage({ pageUuid: PAGE1 })).resolves.toMatchObject({
      queued: false,
    });
    expect(last).toHaveBeenCalledTimes(2);
    expect(await handouts.listQueue()).toEqual([]);
  });

  it('refuses to queue a page that does not exist, and bad players or scenes', async () => {
    const missing = 'JournalEntry.jjjjjjjjjjjjjjjj.JournalEntryPage.zzzzzzzzzzzzzzzz';
    await expect(handouts.queuePage({ pageUuid: missing })).rejects.toThrow(/does not exist/);
    await expect(handouts.queuePage({ pageUuid: PAGE1, players: ['nope'] })).rejects.toThrow(
      /user ids/
    );
    await expect(handouts.queuePage({ pageUuid: PAGE1, sceneId: 'x' })).rejects.toThrow(/scene id/);
  });

  it('reveal-next reveals the oldest page for the scene and takes it off the queue; undo puts it back', async () => {
    await handouts.queuePage({ pageUuid: PAGE1, sceneId: OTHER_SCENE });
    now += 1000;
    await handouts.queuePage({ pageUuid: PAGE2, sceneId: SCENE });
    const plan = await handouts.planPageReveal({ action: 'reveal-next', sceneId: SCENE });
    expect(plan.pageUuid).toBe(PAGE2);
    // Planning changes nothing yet.
    expect((await handouts.listQueue()).map(q => q.uuid)).toEqual([PAGE1, PAGE2]);
    const changeId = await apply(plan.planId);
    expect(ownershipOf(PAGE2).default).toBe(2);
    expect((await handouts.listQueue()).map(q => q.uuid)).toEqual([PAGE1]);
    await guarded.undo(changeId, { confirm: true });
    expect(ownershipOf(PAGE2).default).toBe(0);
    expect((await handouts.listQueue()).map(q => q.uuid)).toEqual([PAGE1, PAGE2]);
  });

  it('reveal-next without a scene takes the oldest page; an empty queue says so', async () => {
    await expect(handouts.planPageReveal({ action: 'reveal-next' })).rejects.toThrow(/empty/);
    await handouts.queuePage({ pageUuid: PAGE1, sceneId: OTHER_SCENE });
    await expect(
      handouts.planPageReveal({ action: 'reveal-next', sceneId: SCENE })
    ).rejects.toThrow(/No page is queued for this scene/);
    const plan = await handouts.planPageReveal({ action: 'reveal-next' });
    expect(plan.pageUuid).toBe(PAGE1);
  });

  it('a queued page that cannot be revealed names itself and how to go on', async () => {
    await handouts.queuePage({ pageUuid: PAGE1 });
    await apply((await handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal' })).planId);
    await expect(handouts.planPageReveal({ action: 'reveal-next' })).rejects.toThrow(/unqueue/);
  });

  it('keeps the vault file separate from reveals.json', async () => {
    await handouts.queuePage({ pageUuid: PAGE1 });
    expect((await store.read(WORLD, 'gm', QUEUE_FILE))?.data).toHaveProperty('entries');
    expect(await store.read(WORLD, 'gm', 'reveals.json')).toBeNull();
  });
});

describe('reveal to chosen players', () => {
  it('raises only their own ownership, and a hide restores it exactly', async () => {
    foundry.docs.get(PAGE1)!.source.ownership = { default: 0, [BO]: 1 };
    const plan = await handouts.planPageReveal({
      pageUuid: PAGE1,
      action: 'reveal',
      players: [ANNA, BO],
    });
    expect(plan.summary).toContain('2 chosen players');
    await apply(plan.planId);
    expect(ownershipOf(PAGE1)).toEqual({ default: 0, [ANNA]: 2, [BO]: 2 });
    const [row] = await handouts.listRevealed();
    expect(row?.players).toEqual([ANNA, BO]);

    await apply((await handouts.planPageReveal({ pageUuid: PAGE1, action: 'hide' })).planId);
    expect(ownershipOf(PAGE1)).toEqual({ default: 0, [BO]: 1 });
  });

  it('a copy for chosen players is hidden from everyone else; revealing again for all opens it', async () => {
    const plan = await handouts.planPageReveal({
      pageUuid: HIDDEN,
      action: 'reveal',
      players: [ANNA],
    });
    expect(plan.copy?.action).toBe('create');
    await apply(plan.planId);
    const copyUuid = plan.copy!.pageUuid;
    const created = foundry.docs.get(copyUuid) ?? foundry.docs.get(plan.copy!.journalUuid);
    expect(created).toBeTruthy();
    const view = await handouts.playerHandouts();
    // The fake counts default ownership only, so the chosen-player copy is not "observable";
    // the players list is what the dashboard filters on.
    const revealed = await handouts.listRevealed();
    expect(revealed.find(r => r.uuid === copyUuid)?.players).toEqual([ANNA]);
    expect(view.revealedUuids).toContain(copyUuid);

    const again = await handouts.planPageReveal({ pageUuid: HIDDEN, action: 'reveal' });
    expect(again.copy?.action).toBe('update');
    expect(again.summary).toContain('to players again');
    await apply(again.planId);
    expect((await handouts.listRevealed()).find(r => r.uuid === copyUuid)?.players).toBeUndefined();
  });
});

describe('seen log', () => {
  it('records the first open per player for a revealed page only', async () => {
    await apply((await handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal' })).planId);
    const pageId = 'pppppppppppppppp';
    expect(await handleRecordHandoutSeen(handouts, { pageId, userId: ANNA, name: 'Anna' })).toEqual(
      {
        recorded: true,
      }
    );
    now += 60_000;
    expect(await handouts.recordSeen(pageId, ANNA, 'Anna')).toEqual({ recorded: false });
    await handouts.recordSeen(pageId, BO, '  Bo   the Bold ');
    expect(await handouts.recordSeen('qqqqqqqqqqqqqqqq', ANNA, 'Anna')).toEqual({
      recorded: false,
    });
    const [row] = await handouts.listRevealed();
    expect(row?.seenBy).toEqual([
      { userId: ANNA, name: 'Anna', at: '2026-09-30T20:00:00.000Z' },
      { userId: BO, name: 'Bo the Bold', at: '2026-09-30T20:01:00.000Z' },
    ]);
  });

  it('ignores a player the page was not revealed to', async () => {
    await apply(
      (await handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal', players: [ANNA] })).planId
    );
    expect(await handouts.recordSeen('pppppppppppppppp', BO, 'Bo')).toEqual({ recorded: false });
  });

  it('rejects a malformed call', async () => {
    await expect(handleRecordHandoutSeen(handouts, { pageId: 'x' })).rejects.toThrow(/needs/);
    await expect(handouts.queue.markSeen('x', ANNA, 'Anna')).rejects.toThrow(/document ids/);
  });
});

describe('reveal-next with show it now (I-110)', () => {
  it('shows the next queued page to the players it was queued for', async () => {
    foundry.handlers['foundry-mcp-bridge.showJournalPage'] = (): unknown => ({ shown: true });
    await handouts.queuePage({ pageUuid: PAGE1, players: [ANNA] });
    const plan = await handouts.planPageReveal({ action: 'reveal-next', showNow: true });
    const line = plan.diff.find(d => d.kind === 'show');
    expect(line).toMatchObject({ target: PAGE1 });
    expect(line!.text).toContain('1 player');
    const applied = await guarded.applyPlan(plan.planId, {
      confirm: true,
      confirmDestructive: true,
    });
    expect(applied.shown).toEqual({ ok: true, users: [ANNA] });
    expect(foundry.calls.filter(([m]) => m.endsWith('showJournalPage')).map(([, d]) => d)).toEqual([
      { uuid: PAGE1, userIds: [ANNA] },
    ]);
  });

  it('plans no popup without showNow', async () => {
    await handouts.queuePage({ pageUuid: PAGE1 });
    const plan = await handouts.planPageReveal({ action: 'reveal-next' });
    expect(plan.diff.some(d => d.kind === 'show')).toBe(false);
  });
});
