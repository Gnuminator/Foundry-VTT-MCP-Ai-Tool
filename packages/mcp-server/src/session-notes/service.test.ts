/**
 * Recap lane (D-087) end to end on a temp vault: stage, the automatic put as a guarded change,
 * the waiting states and refusal codes, Undo back to staged (and its conflicts), the Recap in
 * the reveal queue, and approval by reveal or by hand. Foundry is the fake module.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageForPlayers } from '@gnuminator/shared';

import { GuardedWriteService } from '../guarded-write/service.js';
import { QUEUE_FILE } from '../handouts/queue.js';
import { HandoutsService } from '../handouts/service.js';
import { FakeFoundry } from '../test-support/fake-foundry.js';
import { AuditLog } from '../vault/audit.js';
import { VaultStore } from '../vault/store.js';
import { controlError, handleSessionNotes } from './control.js';
import { SessionNotesService } from './service.js';
import { SessionNotesError } from './types.js';

const WORLD = 'curse-of-strahd';
const FOLDER = 'ffffffffffffffff';

let dataDir: string;
let foundry: FakeFoundry;
let store: VaultStore;
let guarded: GuardedWriteService;
let handouts: HandoutsService;
let notes: SessionNotesService;
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
  const text = doc.source.text as { content?: string } | undefined;
  return {
    uuid,
    exists: true,
    name: (doc.source.name as string | undefined) ?? null,
    observable: false,
    journalObservable: false,
    html: text?.content ?? null,
    type: 'text',
    src: null,
    caption: null,
  };
}

function stageParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: '2026-10-03_0913-rehearsal',
    date: '2026-10-03',
    title: 'The road to Barovia',
    languages: ['da', 'en'],
    pages: [
      { key: 'scenes', html: '<h2>Scene 1</h2><p>Fog.</p>' },
      {
        key: 'recap',
        html: '<p>Vi gik ind i tågen.</p><h2>English</h2><p>We walked into the fog.</p>',
      },
      { key: 'summary', html: '<p>GM only.</p>' },
    ],
    ...overrides,
  };
}

function setFeature(enabled: boolean, writesAllowed = true): void {
  foundry.features = [
    {
      id: 'session-notes',
      name: 'AI Tool: Session notes (writes)',
      hint: '',
      enabled,
      writesAllowed,
    },
    { id: 'handouts', name: 'AI Tool: Handouts (writes)', hint: '', enabled: true, writesAllowed },
  ];
}

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof SessionNotesError ? error.code : `plain: ${String(error)}`;
  }
  return undefined;
}

async function stageAndSettle(overrides: Record<string, unknown> = {}): Promise<void> {
  await notes.stage(stageParams(overrides));
  await notes.idle();
}

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'session-notes-'));
  foundry = new FakeFoundry();
  foundry.worldId = WORLD;
  setFeature(true);
  foundry.handlers['foundry-mcp-bridge.ensureJournalFolder'] = (): unknown => ({
    folderId: FOLDER,
    created: false,
  });
  foundry.handlers['foundry-mcp-bridge.getPagesForPlayers'] = (data: {
    uuids: string[];
  }): { pages: PageForPlayers[] } => ({ pages: data.uuids.map(pageForPlayers) });
  store = new VaultStore({ dataDir });
  now = Date.parse('2026-10-04T08:00:00.000Z');
  const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  logger.child = (): unknown => logger;
  const worldIds = {
    current: (): Promise<string> =>
      foundry.connected ? Promise.resolve(WORLD) : Promise.reject(new Error('not connected')),
  };
  const audit = new AuditLog(store);
  guarded = new GuardedWriteService({
    foundryClient: foundry,
    worldIds,
    store,
    audit,
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
  notes = new SessionNotesService({
    foundryClient: foundry,
    worldIds,
    store,
    audit,
    guardedWrites: guarded,
    handouts,
    logger,
    now: (): number => now,
  });
});

afterEach(async () => {
  await notes.idle();
  await fsp.rm(dataDir, { recursive: true, force: true });
});

function journal(): { uuid: string; source: Record<string, any> } {
  const found = [...foundry.docs.entries()].find(([, d]) => d.documentName === 'JournalEntry');
  if (!found) throw new Error('no journal entry');
  return { uuid: found[0], source: found[1].source };
}

describe('stage', () => {
  it('sanitizes the pages and keeps them in Foundry order', async () => {
    setFeature(false);
    const item = await notes.stage(
      stageParams({
        pages: [
          { key: 'summary', html: '<p onclick="x()">Hi<script>alert(1)</script></p>' },
          { key: 'recap', html: '<h2 class="a">Recap</h2><img src=x onerror=y><p>ok</p>' },
        ],
      })
    );
    await notes.idle();
    expect(item.status).toBe('staged');
    expect(item.pages.map(p => p.key)).toEqual(['recap', 'summary']);
    expect(item.pages.map(p => p.title)).toEqual(['Recap', 'GM summary']);
    expect(item.waitingFor).toEqual(['feature-off']);
    const full = await notes.get({ sessionId: item.sessionId });
    expect(full.pages[0]!.html).toBe('<h2>Recap</h2><p>ok</p>');
    expect(full.pages[1]!.html).toBe('<p>Hi</p>');
  });

  it('refuses bad input with bad-request', async () => {
    expect(await code(notes.stage(stageParams({ sessionId: '../x' })))).toBe('bad-request');
    expect(await code(notes.stage(stageParams({ date: 'today' })))).toBe('bad-request');
    expect(
      await code(notes.stage(stageParams({ pages: [{ key: 'summary', html: '<p>x</p>' }] })))
    ).toBe('bad-request');
    expect(
      await code(
        notes.stage(stageParams({ pages: [{ key: 'recap', html: '<script>x</script>' }] }))
      )
    ).toBe('bad-request');
  });

  it('needs a world while Foundry is closed, and keeps the notes for that world', async () => {
    foundry.connected = false;
    expect(await code(notes.stage(stageParams()))).toBe('no-world');
    const item = await notes.stage(stageParams({ world: WORLD }));
    expect(item.waitingFor).toEqual(['foundry']);
    const status = await notes.status({ sessionId: item.sessionId });
    expect(status.status).toBe('staged');
  });

  it('replaces staged notes but not notes already in Foundry', async () => {
    setFeature(false);
    await stageAndSettle();
    await stageAndSettle({ title: 'New title' });
    expect((await notes.list()).items).toHaveLength(1);
    expect((await notes.list()).items[0]!.title).toBe('New title');
    setFeature(true);
    await notes.put({ sessionId: '2026-10-03_0913-rehearsal' });
    expect(await code(notes.stage(stageParams()))).toBe('not-staged');
  });
});

describe('automatic put (D-087)', () => {
  it('puts staged notes into a GM-only journal as one guarded change, Recap queued', async () => {
    await stageAndSettle();
    const [item] = (await notes.list()).items;
    expect(item!.status).toBe('in-foundry');
    expect(item!.changeId).toMatch(/^chg-/);
    expect(item!.waitingFor).toEqual([]);
    expect(item!.lastError).toBeUndefined();

    const entry = journal();
    expect(entry.source.name).toBe('2026-10-03: The road to Barovia');
    expect(entry.source.folder).toBe(FOLDER);
    expect(entry.source.ownership).toEqual({ default: 0 });
    expect(entry.source.flags['foundry-mcp-bridge']).toEqual({
      sessionNotes: true,
      sessionId: '2026-10-03_0913-rehearsal',
    });
    expect(entry.source.pages.map((p: { name: string }) => p.name)).toEqual([
      'Recap',
      'GM summary',
      'Scenes',
    ]);
    expect(item!.journalUuid).toBe(entry.uuid);
    expect(item!.recapPageUuid).toMatch(new RegExp(`^${entry.uuid}\\.JournalEntryPage\\.`));

    const queue = await store.read<{ entries: Record<string, { uuid: string }> }>(
      WORLD,
      'gm',
      QUEUE_FILE
    );
    expect(Object.values(queue!.data.entries).map(e => e.uuid)).toEqual([item!.recapPageUuid]);

    const [change] = await guarded.listRecentChanges();
    expect(change!.feature).toBe('session-notes');
    expect(change!.summary).toContain('automatically');
    expect(change!.canUndo).toBe(true);
  });

  it('waits while writes or the switch are off, and puts on the next pass once they are on', async () => {
    setFeature(true, false);
    await stageAndSettle();
    let [item] = (await notes.list()).items;
    expect(item!.status).toBe('staged');
    expect(item!.waitingFor).toEqual(['writes-off']);
    setFeature(false);
    [item] = (await notes.list()).items;
    expect(item!.waitingFor).toEqual(['feature-off']);

    setFeature(true);
    await notes.tick(); // not due: same connection, retry time not reached
    expect((await notes.list()).items[0]!.status).toBe('staged');
    foundry.connectionSerial += 1; // a GM client connected again
    await notes.tick();
    expect((await notes.list()).items[0]!.status).toBe('in-foundry');
  });

  it('tries again after the retry time on the same connection', async () => {
    setFeature(false);
    await stageAndSettle();
    setFeature(true);
    now += 3 * 60_000;
    await notes.tick();
    expect((await notes.list()).items[0]!.status).toBe('in-foundry');
  });
});

describe('put refusals', () => {
  it('codes feature-off, writes-off, not-found, not-connected and not-staged', async () => {
    setFeature(false);
    await stageAndSettle();
    const sessionId = '2026-10-03_0913-rehearsal';
    expect(await code(notes.put({ sessionId }))).toBe('feature-off');
    setFeature(true, false);
    expect(await code(notes.put({ sessionId }))).toBe('writes-off');
    setFeature(true);
    expect(await code(notes.put({ sessionId: 'nope' }))).toBe('not-found');
    foundry.connected = false;
    expect(await code(notes.put({ sessionId }))).toBe('not-connected');
    foundry.connected = true;
    const applied = await notes.put({ sessionId });
    expect(applied.item.status).toBe('in-foundry');
    expect(applied.changeId).toBe(applied.item.changeId);
    expect(applied.summary).not.toContain('automatically');
    expect(await code(notes.put({ sessionId }))).toBe('not-staged');
  });
});

describe('undo', () => {
  it('takes the journal out, unqueues the Recap and stops the automatic put', async () => {
    await stageAndSettle();
    const [item] = (await notes.list()).items;
    await guarded.undo(item!.changeId!, { confirm: true });
    await notes.idle();
    expect([...foundry.docs.values()].some(d => d.documentName === 'JournalEntry')).toBe(false);
    const after = (await notes.list()).items[0]!;
    expect(after.status).toBe('staged');
    expect(after.autoPut).toBe(false);
    expect(after.waitingFor).toEqual([]);
    const queue = await store.read<{ entries: Record<string, unknown> }>(WORLD, 'gm', QUEUE_FILE);
    expect(Object.keys(queue!.data.entries)).toEqual([]);

    foundry.connectionSerial += 1;
    await notes.tick();
    expect((await notes.list()).items[0]!.status).toBe('staged');
    const again = await notes.put({ sessionId: after.sessionId });
    expect(again.item.status).toBe('in-foundry');
    expect(again.item.autoPut).toBe(true);
  });

  it('refuses with a conflict when the GM edited a page', async () => {
    await stageAndSettle();
    const [item] = (await notes.list()).items;
    foundry.edit(item!.recapPageUuid!, {
      path: 'text.content',
      present: true,
      value: '<p>edited</p>',
    });
    const refusal = guarded.undo(item!.changeId!, { confirm: true });
    await expect(refusal).rejects.toThrow(/^Conflict, nothing was written: the page "Recap"/);
    expect(controlError(await refusal.catch(e => e)).code).toBe('conflict');
    expect(journal()).toBeDefined();
  });

  it('refuses with a conflict once the Recap was revealed, and that approves the session', async () => {
    await stageAndSettle();
    const plan = await handouts.planPageReveal({ action: 'reveal-next' });
    await guarded.applyPlan(plan.planId, { confirm: true, confirmDestructive: true });
    await notes.idle();
    const [item] = (await notes.list()).items;
    expect(item!.recapRevealed).toBe(true);
    expect(item!.status).toBe('approved');
    expect(item!.approvedBy).toBe('reveal');
    await expect(guarded.undo(item!.changeId!, { confirm: true })).rejects.toThrow(
      /Recap was revealed/
    );
  });
});

describe('approve and status', () => {
  it('approves without revealing, and status finds it while Foundry is closed', async () => {
    await stageAndSettle();
    const sessionId = '2026-10-03_0913-rehearsal';
    const approved = await notes.approve({ sessionId, by: 'Danni' });
    expect(approved.status).toBe('approved');
    expect(approved.approvedBy).toBe('Danni');
    expect(approved.recapRevealed).toBe(false);
    foundry.connected = false;
    const status = await notes.status({ sessionId });
    expect(status.approvedAt).toBe(approved.approvedAt);
    expect(await code(notes.status({ sessionId: 'nope' }))).toBe('not-found');
  });
});

describe('control method', () => {
  it('dispatches actions and refuses an unknown one with bad-request', async () => {
    setFeature(false);
    await handleSessionNotes(notes, { action: 'stage', ...stageParams() });
    await notes.idle();
    const listed = (await handleSessionNotes(notes, { action: 'list' })) as { items: unknown[] };
    expect(listed.items).toHaveLength(1);
    const error = await handleSessionNotes(notes, { action: 'delete' }).catch(e => e);
    expect(controlError(error)).toEqual({
      message: expect.stringContaining('action must be one of'),
      code: 'bad-request',
    });
    expect(controlError(new Error('boom'))).toEqual({ message: 'boom' });
  });
});
