/**
 * Handouts service end to end: plans go through the real GuardedWriteService,
 * the vault is a temp dir, Foundry is the fake module plus a handler for
 * `getPagesForPlayers` (the module side of the player-view contract, tested
 * for real in foundry-module).
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
import { HandoutsService } from './service.js';

const WORLD = 'curse-of-strahd';
const PAGE1 = 'JournalEntry.jjjjjjjjjjjjjjjj.JournalEntryPage.pppppppppppppppp';
const PAGE2 = 'JournalEntry.jjjjjjjjjjjjjjjj.JournalEntryPage.qqqqqqqqqqqqqqqq';
const MISSING = 'JournalEntry.jjjjjjjjjjjjjjjj.JournalEntryPage.zzzzzzzzzzzzzzzz';

let dataDir: string;
let foundry: FakeFoundry;
let store: VaultStore;
let guarded: GuardedWriteService;
let handouts: HandoutsService;
let now: number;
/** Pages whose journal no player can observe (the fake has no journal documents). */
let hiddenJournal: Set<string>;
/** Pages answered the way a module without `journalObservable` answers. */
let oldModule: Set<string>;

/** The module's `getPagesForPlayers`: derived from the fake docs' own fields. */
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
  const ownership = doc.source.ownership as Record<string, number> | undefined;
  const text = doc.source.text as { content?: string } | undefined;
  const journalObservable = !hiddenJournal.has(uuid);
  const page: PageForPlayers = {
    uuid,
    exists: true,
    name: (doc.source.name as string | undefined) ?? null,
    observable: journalObservable && (ownership?.default ?? 0) >= 2,
    journalObservable,
    html: text?.content ?? null,
  };
  if (oldModule.has(uuid)) delete (page as Partial<PageForPlayers>).journalObservable;
  return page;
}

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'handouts-'));
  hiddenJournal = new Set();
  oldModule = new Set();
  foundry = new FakeFoundry();
  foundry.worldId = WORLD;
  foundry.features = [{ id: 'handouts', name: 'Handouts', hint: '', enabled: true }];
  foundry.handlers['foundry-mcp-bridge.getPagesForPlayers'] = (data: {
    uuids: string[];
  }): { pages: PageForPlayers[] } => ({
    pages: data.uuids.map(pageForPlayers),
  });
  store = new VaultStore({ dataDir });
  now = Date.parse('2026-09-28T20:00:00.000Z');
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
    name: 'Wine Cellar Notes',
    ownership: { default: 0 },
    text: { content: '<p>The wine is poisoned.</p>' },
  });
  foundry.add(PAGE2, 'JournalEntryPage', {
    name: 'Party Handout',
    ownership: { default: 2 },
    text: { content: '<p>Welcome to Barovia.</p>' },
  });
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

async function apply(planId: string, destructive = false): Promise<string> {
  const applied = await guarded.applyPlan(planId, {
    confirm: true,
    ...(destructive ? { confirmDestructive: true } : {}),
  });
  return applied.changeId;
}

async function revealsData(): Promise<any> {
  return (await store.read(WORLD, 'gm', 'reveals.json'))?.data;
}

describe('listRevealed', () => {
  it('is empty with nothing allowlisted', async () => {
    expect(await handouts.listRevealed()).toEqual([]);
  });

  it('reports every allowlisted page, existing and not, observable and not', async () => {
    await apply(
      (await handouts.planPageReveal({ pageUuid: PAGE2, action: 'reveal' })).planId,
      true
    );
    const list = await handouts.listRevealed();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      uuid: PAGE2,
      title: 'Party Handout',
      exists: true,
      observable: true,
      feature: 'handouts',
    });
  });

  it('reports a page removed from Foundry as not existing', async () => {
    const uuidOnly = 'JournalEntry.jjjjjjjjjjjjjjjj.JournalEntryPage.qqqqqqqqqqqqqqqq';
    await apply(
      (await handouts.planPageReveal({ pageUuid: uuidOnly, action: 'reveal' })).planId,
      true
    );
    foundry.docs.delete(PAGE2);
    const list = await handouts.listRevealed();
    expect(list[0]).toMatchObject({ exists: false, observable: false, title: null });
  });
});

describe('playerHandouts', () => {
  it('is empty with nothing allowlisted', async () => {
    expect(await handouts.playerHandouts()).toEqual({ handouts: [], revealedUuids: [] });
  });

  it('includes only allowlisted pages that exist and are observable, with raw html', async () => {
    // PAGE1 starts not observable; reveal it with ownership so it becomes observable.
    await apply(
      (await handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal' })).planId,
      true
    );
    // PAGE2 is already observable; allowlist it too.
    await apply(
      (await handouts.planPageReveal({ pageUuid: PAGE2, action: 'reveal' })).planId,
      true
    );

    const view = await handouts.playerHandouts();
    expect(view.revealedUuids.sort()).toEqual([PAGE1, PAGE2].sort());
    expect(view.handouts).toHaveLength(2);
    const byUuid = Object.fromEntries(view.handouts.map(h => [h.uuid, h]));
    expect(byUuid[PAGE1]).toMatchObject({
      title: 'Wine Cellar Notes',
      html: '<p>The wine is poisoned.</p>',
    });
    expect(byUuid[PAGE2]).toMatchObject({ title: 'Party Handout' });
  });

  it('still lists a not-yet-observable allowlisted page in revealedUuids but not in handouts', async () => {
    await apply(
      (await handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal', setOwnership: false }))
        .planId,
      true
    );
    const view = await handouts.playerHandouts();
    expect(view.revealedUuids).toEqual([PAGE1]);
    expect(view.handouts).toEqual([]);
  });
});

describe('planPageReveal: reveal', () => {
  it('raises ownership to Observer and records previousOwnership when the page is not observable', async () => {
    const plan = await handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal' });
    expect(plan.target).toBe('mixed');
    expect(plan.risk).toBe('destructive');
    expect(plan.requires.confirmDestructive).toBe(true);
    await apply(plan.planId, true);

    expect(foundry.docs.get(PAGE1)?.source.ownership).toMatchObject({ default: 2 });
    const data = await revealsData();
    const pageId = PAGE1.split('.').pop();
    expect(data.pages[pageId]).toMatchObject({
      uuid: PAGE1,
      feature: 'handouts',
      previousOwnership: 0,
    });
    expect(typeof data.pages[pageId].at).toBe('string');
  });

  it('does not touch ownership or record previousOwnership when the page is already observable', async () => {
    const plan = await handouts.planPageReveal({ pageUuid: PAGE2, action: 'reveal' });
    expect(plan.target).toBe('vault');
    await apply(plan.planId, true);
    const data = await revealsData();
    const pageId = PAGE2.split('.').pop();
    expect(data.pages[pageId].previousOwnership).toBeUndefined();
  });

  it('does not touch ownership when setOwnership is false, even if the page is not observable', async () => {
    const plan = await handouts.planPageReveal({
      pageUuid: PAGE1,
      action: 'reveal',
      setOwnership: false,
    });
    expect(plan.target).toBe('vault');
    await apply(plan.planId, true);
    expect(foundry.docs.get(PAGE1)?.source.ownership).toMatchObject({ default: 0 });
    const data = await revealsData();
    const pageId = PAGE1.split('.').pop();
    expect(data.pages[pageId].previousOwnership).toBeUndefined();
  });

  it('refuses a page that does not exist in Foundry', async () => {
    await expect(handouts.planPageReveal({ pageUuid: MISSING, action: 'reveal' })).rejects.toThrow(
      /does not exist/
    );
  });

  it('refuses to reveal a page that is already allowlisted and observable', async () => {
    await apply(
      (await handouts.planPageReveal({ pageUuid: PAGE2, action: 'reveal' })).planId,
      true
    );
    await expect(handouts.planPageReveal({ pageUuid: PAGE2, action: 'reveal' })).rejects.toThrow(
      /already revealed/
    );
  });

  it('refuses to re-reveal an allowlisted, not-observable page when setOwnership is false', async () => {
    await apply(
      (await handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal', setOwnership: false }))
        .planId,
      true
    );
    await expect(
      handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal', setOwnership: false })
    ).rejects.toThrow(/already revealed/);
  });

  it('allows fixing ownership on an allowlisted page that lost its access', async () => {
    await apply(
      (await handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal', setOwnership: false }))
        .planId,
      true
    );
    // Still not observable (setOwnership was false); a second reveal with setOwnership true fixes it.
    const plan = await handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal' });
    expect(plan.target).toBe('mixed');
    await apply(plan.planId, true);
    expect(foundry.docs.get(PAGE1)?.source.ownership).toMatchObject({ default: 2 });
  });

  it('refuses to raise a page whose journal players cannot see (found live in M2)', async () => {
    hiddenJournal.add(PAGE1);
    await expect(handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal' })).rejects.toThrow(
      /Players cannot open the journal that holds "Wine Cellar Notes"/
    );
    expect(await revealsData()).toBeUndefined();
    expect(foundry.docs.get(PAGE1)?.source.ownership).toMatchObject({ default: 0 });
  });

  it('still allowlists such a page when setOwnership is false (it shows once players can open it)', async () => {
    hiddenJournal.add(PAGE1);
    const plan = await handouts.planPageReveal({
      pageUuid: PAGE1,
      action: 'reveal',
      setOwnership: false,
    });
    expect(plan.target).toBe('vault');
    await apply(plan.planId, true);
    expect((await handouts.playerHandouts()).handouts).toEqual([]);
    hiddenJournal.delete(PAGE1);
    foundry.docs.get(PAGE1)!.source.ownership = { default: 2 };
    expect((await handouts.playerHandouts()).handouts.map(h => h.title)).toEqual([
      'Wine Cellar Notes',
    ]);
  });

  it('a module without journalObservable keeps the page-only behavior', async () => {
    oldModule.add(PAGE1);
    const plan = await handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal' });
    expect(plan.target).toBe('mixed');
  });

  it('never writes the page title or html into the plan summary beyond the title itself', async () => {
    const plan = await handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal' });
    expect(plan.summary).toBe('Reveal page "Wine Cellar Notes" to players');
    expect(plan.summary).not.toContain('poisoned');
  });
});

describe('planPageReveal: hide', () => {
  async function reveal(uuid: string, setOwnership = true): Promise<void> {
    await apply(
      (await handouts.planPageReveal({ pageUuid: uuid, action: 'reveal', setOwnership })).planId,
      true
    );
  }

  it('removes the allowlist entry and restores previous ownership', async () => {
    await reveal(PAGE1);
    expect(foundry.docs.get(PAGE1)?.source.ownership).toMatchObject({ default: 2 });

    const plan = await handouts.planPageReveal({ pageUuid: PAGE1, action: 'hide' });
    expect(plan.risk).toBe('destructive');
    await apply(plan.planId, true);

    expect(foundry.docs.get(PAGE1)?.source.ownership).toMatchObject({ default: 0 });
    const data = await revealsData();
    expect(data.pages).toEqual({});
  });

  it('does not touch ownership when setOwnership is false', async () => {
    await reveal(PAGE1);
    await apply(
      (await handouts.planPageReveal({ pageUuid: PAGE1, action: 'hide', setOwnership: false }))
        .planId,
      true
    );
    expect(foundry.docs.get(PAGE1)?.source.ownership).toMatchObject({ default: 2 });
  });

  it('has nothing to restore when the reveal never changed ownership', async () => {
    await reveal(PAGE2); // already observable: no previousOwnership recorded
    const plan = await handouts.planPageReveal({ pageUuid: PAGE2, action: 'hide' });
    expect(plan.target).toBe('vault');
    await apply(plan.planId, true);
    expect(foundry.docs.get(PAGE2)?.source.ownership).toMatchObject({ default: 2 });
  });

  it('still removes a stale allowlist entry when the page was deleted from Foundry', async () => {
    await reveal(PAGE1);
    foundry.docs.delete(PAGE1);
    const plan = await handouts.planPageReveal({ pageUuid: PAGE1, action: 'hide' });
    expect(plan.target).toBe('vault');
    await apply(plan.planId, true);
    const data = await revealsData();
    expect(data.pages).toEqual({});
  });

  it('refuses to hide a page that is not allowlisted', async () => {
    await expect(handouts.planPageReveal({ pageUuid: PAGE2, action: 'hide' })).rejects.toThrow(
      /not revealed/
    );
  });
});
