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

/**
 * The module's `getPagesForPlayers`: derived from the fake docs' own fields. A
 * page whose journal is a fake doc too (the "Handouts" journal a copy creates)
 * inherits that journal's ownership like Foundry's INHERIT; the setup pages
 * have no journal doc, so `hiddenJournal` decides for them.
 */
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
  const journalObservable = journal ? journalLevel! >= 2 : !hiddenJournal.has(uuid);
  const type = (doc.source.type as string | undefined) ?? 'text';
  const text = doc.source.text as { content?: string } | undefined;
  const image = doc.source.image as { caption?: string } | undefined;
  const page: PageForPlayers = {
    uuid,
    exists: true,
    name: (doc.source.name as string | undefined) ?? null,
    observable: journalObservable && pageLevel >= 2,
    journalObservable,
    html: type === 'text' ? (text?.content ?? null) : null,
    type,
    src: (doc.source.src as string | undefined) ?? null,
    caption: image?.caption ?? null,
  };
  if (oldModule.has(uuid)) {
    // A module from before the reveal copy: no journalObservable, type, src or caption.
    const old = page as Partial<PageForPlayers>;
    delete old.journalObservable;
    delete old.type;
    delete old.src;
    delete old.caption;
  }
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

  it('copy: false refuses to raise a page whose journal players cannot see (found live in M2)', async () => {
    hiddenJournal.add(PAGE1);
    const refused = handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal', copy: false });
    await expect(refused).rejects.toThrow(
      /Players cannot open the journal that holds "Wine Cellar Notes"/
    );
    // The refusal names the way out: a copy into the player journal.
    await expect(
      handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal', copy: false })
    ).rejects.toThrow(/Reveal with copy: true to copy it into the player journal "Handouts"/);
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

// ---------------------------------------------------------------------------
// Reveal copies a handout into the player journal "Handouts"
// ---------------------------------------------------------------------------

const ANY_PAGE_UUID = /^JournalEntry\.[A-Za-z0-9]{16}\.JournalEntryPage\.[A-Za-z0-9]{16}$/;

/** Reveal (or hide) and apply; returns the plan and the change id. */
async function planAndApply(
  args: Parameters<HandoutsService['planPageReveal']>[0]
): Promise<{ plan: Awaited<ReturnType<HandoutsService['planPageReveal']>>; changeId: string }> {
  const plan = await handouts.planPageReveal(args);
  return { plan, changeId: await apply(plan.planId, true) };
}

/** The allowlist entries that are copies: `[copyId, entry]`. */
function copyEntries(data: any): Array<[string, any]> {
  return Object.entries<any>(data?.pages ?? {}).filter(([, entry]) => entry.copiedFrom);
}

/** Every fake doc inside a journal (its pages), by uuid. */
function pagesIn(journalUuid: string): string[] {
  return [...foundry.docs.keys()].filter(key => key.startsWith(`${journalUuid}.JournalEntryPage.`));
}

describe('planPageReveal: copy into "Handouts"', () => {
  beforeEach(() => {
    hiddenJournal.add(PAGE1);
  });

  it('copies automatically when no player can open the journal (first use creates "Handouts")', async () => {
    const plan = await handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal' });
    expect(plan).toMatchObject({
      target: 'mixed',
      risk: 'destructive',
      summary: 'Reveal page "Wine Cellar Notes" to players (copied into Handouts)',
      pageUuid: PAGE1,
      copy: {
        action: 'create',
        sourceUuid: PAGE1,
        journalName: 'Handouts',
        journalCreated: true,
        secretsRemoved: 0,
      },
    });
    const copy = plan.copy!;
    expect(copy.pageUuid).toMatch(ANY_PAGE_UUID);
    expect(copy.pageUuid.startsWith(`${copy.journalUuid}.JournalEntryPage.`)).toBe(true);
    expect(plan.note).toMatch(/^Copied into Handouts: /);
    expect(plan.diff.map(d => d.text)).toContain('Create JournalEntry "Handouts"');
    await apply(plan.planId, true);

    // The journal: "Handouts", Observer for players; the copy inherits it.
    expect(foundry.docs.get(copy.journalUuid)?.source).toMatchObject({
      name: 'Handouts',
      ownership: { default: 2 },
    });
    expect(foundry.docs.get(copy.pageUuid)?.source).toMatchObject({
      name: 'Wine Cellar Notes',
      type: 'text',
      text: { content: '<p>The wine is poisoned.</p>', format: 1 },
      flags: { 'foundry-mcp-bridge': { copiedFrom: PAGE1 } },
    });
    expect(foundry.docs.get(copy.pageUuid)?.source.ownership).toBeUndefined();
    // The source page is never changed.
    expect(foundry.docs.get(PAGE1)?.source).toMatchObject({
      ownership: { default: 0 },
      text: { content: '<p>The wine is poisoned.</p>' },
    });

    const data = await revealsData();
    expect(data.handoutsJournal).toEqual({ uuid: copy.journalUuid });
    expect(data.pages).toEqual({
      [copy.pageUuid.split('.').pop()!]: {
        uuid: copy.pageUuid,
        feature: 'handouts',
        at: '2026-09-28T20:00:00.000Z',
        copiedFrom: PAGE1,
      },
    });
  });

  it('the player projection lists the copy as a revealed handout', async () => {
    const { plan } = await planAndApply({ pageUuid: PAGE1, action: 'reveal' });
    const copyUuid = plan.copy!.pageUuid;
    const view = await handouts.playerHandouts();
    expect(view.revealedUuids).toEqual([copyUuid]);
    expect(view.handouts).toEqual([
      {
        id: copyUuid.split('.').pop(),
        uuid: copyUuid,
        title: 'Wine Cellar Notes',
        html: '<p>The wine is poisoned.</p>',
        revealedAt: '2026-09-28T20:00:00.000Z',
      },
    ]);
    expect(await handouts.listRevealed()).toEqual([
      expect.objectContaining({
        uuid: copyUuid,
        title: 'Wine Cellar Notes',
        exists: true,
        observable: true,
        copiedFrom: PAGE1,
      }),
    ]);
  });

  it('copy: true copies a page players can already see, and leaves it alone', async () => {
    const { plan } = await planAndApply({ pageUuid: PAGE2, action: 'reveal', copy: true });
    expect(plan.copy).toMatchObject({ action: 'create', sourceUuid: PAGE2 });
    expect(foundry.docs.get(plan.copy!.pageUuid)?.source).toMatchObject({
      name: 'Party Handout',
      text: { content: '<p>Welcome to Barovia.</p>' },
    });
    expect(foundry.docs.get(PAGE2)?.source.ownership).toEqual({ default: 2 });
    const data = await revealsData();
    expect(data.pages[PAGE2.split('.').pop()!]).toBeUndefined();
  });

  it('a module without journalObservable copies only on copy: true', async () => {
    hiddenJournal.delete(PAGE1);
    oldModule.add(PAGE1);
    expect((await handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal' })).copy).toBe(
      undefined
    );
    const plan = await handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal', copy: true });
    expect(plan.copy).toMatchObject({ action: 'create' });
  });

  it('setOwnership: false keeps the allowlist-only reveal (no automatic copy)', async () => {
    const plan = await handouts.planPageReveal({
      pageUuid: PAGE1,
      action: 'reveal',
      setOwnership: false,
    });
    expect(plan.copy).toBeUndefined();
    expect(plan.target).toBe('vault');
  });

  it('a second copy goes into the remembered "Handouts" journal', async () => {
    const first = await planAndApply({ pageUuid: PAGE1, action: 'reveal' });
    const journalUuid = first.plan.copy!.journalUuid;
    const plan = await handouts.planPageReveal({ pageUuid: PAGE2, action: 'reveal', copy: true });
    expect(plan.copy).toMatchObject({ action: 'create', journalUuid, journalCreated: false });
    expect(plan.note).not.toContain('created by this change');
    expect(plan.diff.map(d => d.text)).toContain(
      `Create JournalEntryPage "Party Handout" in ${journalUuid}`
    );
    expect(plan.diff.some(d => d.path === 'handoutsJournal')).toBe(false);
    await apply(plan.planId, true);
    expect(pagesIn(journalUuid).sort()).toEqual(
      [first.plan.copy!.pageUuid, plan.copy!.pageUuid].sort()
    );
    expect(copyEntries(await revealsData())).toHaveLength(2);
  });

  it('creates "Handouts" again when the remembered journal was deleted', async () => {
    const first = await planAndApply({ pageUuid: PAGE1, action: 'reveal' });
    const oldJournal = first.plan.copy!.journalUuid;
    for (const key of [...foundry.docs.keys()]) {
      if (key === oldJournal || key.startsWith(`${oldJournal}.`)) foundry.docs.delete(key);
    }

    const plan = await handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal' });
    expect(plan.copy).toMatchObject({ action: 'create', journalCreated: true });
    expect(plan.copy!.journalUuid).not.toBe(oldJournal);
    await apply(plan.planId, true);

    const data = await revealsData();
    expect(data.handoutsJournal).toEqual({ uuid: plan.copy!.journalUuid });
    // The entry of the lost copy is replaced, not kept next to the new one.
    expect(copyEntries(data).map(([, entry]) => entry.uuid)).toEqual([plan.copy!.pageUuid]);
    expect(foundry.docs.get(plan.copy!.journalUuid)?.source.name).toBe('Handouts');
  });

  it('revealing the same source again updates its copy instead of making a duplicate', async () => {
    const first = await planAndApply({ pageUuid: PAGE1, action: 'reveal' });
    const copyUuid = first.plan.copy!.pageUuid;
    foundry.edit(PAGE1, { path: 'text.content', present: true, value: '<p>It was wine.</p>' });

    const plan = await handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal' });
    expect(plan).toMatchObject({
      target: 'foundry',
      risk: 'destructive',
      summary: 'Reveal page "Wine Cellar Notes" to players again (updates its copy in Handouts)',
      copy: { action: 'update', pageUuid: copyUuid, journalCreated: false },
    });
    expect(plan.diff).toHaveLength(1);
    expect(plan.diff[0]).toMatchObject({ target: copyUuid, path: 'text.content' });
    await apply(plan.planId, true);

    expect(foundry.docs.get(copyUuid)?.source.text).toMatchObject({
      content: '<p>It was wine.</p>',
    });
    expect(pagesIn(first.plan.copy!.journalUuid)).toEqual([copyUuid]);
    expect(copyEntries(await revealsData())).toHaveLength(1);
  });

  it('refuses a re-reveal while the copy is up to date', async () => {
    await planAndApply({ pageUuid: PAGE1, action: 'reveal' });
    await expect(handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal' })).rejects.toThrow(
      /already revealed to players: its copy in Handouts is up to date/
    );
  });

  it('a renamed source renames its copy on the next reveal', async () => {
    const first = await planAndApply({ pageUuid: PAGE1, action: 'reveal' });
    foundry.edit(PAGE1, { path: 'name', present: true, value: 'Cellar Letter' });
    const { plan } = await planAndApply({ pageUuid: PAGE1, action: 'reveal' });
    expect(plan.diff.map(d => d.path)).toEqual(['name']);
    expect(foundry.docs.get(first.plan.copy!.pageUuid)?.source.name).toBe('Cellar Letter');
  });

  it('refuses to copy a page that is itself a copy', async () => {
    const { plan } = await planAndApply({ pageUuid: PAGE1, action: 'reveal' });
    await expect(
      handouts.planPageReveal({ pageUuid: plan.copy!.pageUuid, action: 'reveal', copy: true })
    ).rejects.toThrow(/is already a copy in Handouts; reveal its source page/);
    // Without copy it is simply revealed already (the copy is observable).
    await expect(
      handouts.planPageReveal({ pageUuid: plan.copy!.pageUuid, action: 'reveal' })
    ).rejects.toThrow(/already revealed/);
  });

  it('notes how many secret blocks the copy leaves out', async () => {
    foundry.edit(PAGE1, {
      path: 'text.content',
      present: true,
      value: '<p>Open.</p><section class="secret"><p>Hush.</p></section>',
    });
    const plan = await handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal' });
    expect(plan.copy?.secretsRemoved).toBe(1);
    expect(plan.note).toContain('1 secret block left out.');
    await apply(plan.planId, true);
    expect(foundry.docs.get(plan.copy!.pageUuid)?.source.text.content).toBe('<p>Open.</p>');
  });
});

describe('planPageReveal: hide a copied handout', () => {
  beforeEach(() => {
    hiddenJournal.add(PAGE1);
  });

  it('by the source: deletes the copy and its entry; "Handouts" stays', async () => {
    const { plan: reveal } = await planAndApply({ pageUuid: PAGE1, action: 'reveal' });
    const { journalUuid, pageUuid: copyUuid } = reveal.copy!;

    const plan = await handouts.planPageReveal({ pageUuid: PAGE1, action: 'hide' });
    expect(plan).toMatchObject({
      target: 'mixed',
      risk: 'destructive',
      summary: 'Hide page "Wine Cellar Notes" from players (deletes its copy in Handouts)',
      copiesDeleted: [copyUuid],
    });
    expect(plan.note).toMatch(/the journal stays/);
    await apply(plan.planId, true);

    expect(foundry.docs.has(copyUuid)).toBe(false);
    expect(foundry.docs.get(journalUuid)?.source.name).toBe('Handouts');
    const data = await revealsData();
    expect(data.pages).toEqual({});
    expect(data.handoutsJournal).toEqual({ uuid: journalUuid });
    expect(await handouts.playerHandouts()).toEqual({ handouts: [], revealedUuids: [] });
    expect(foundry.docs.get(PAGE1)?.source.ownership).toEqual({ default: 0 });
  });

  it('by the copy: deletes it and its entry', async () => {
    const { plan: reveal } = await planAndApply({ pageUuid: PAGE1, action: 'reveal' });
    const copyUuid = reveal.copy!.pageUuid;
    const plan = await handouts.planPageReveal({ pageUuid: copyUuid, action: 'hide' });
    expect(plan.summary).toBe(
      'Hide page "Wine Cellar Notes" from players (deletes the copy in Handouts)'
    );
    expect(plan.risk).toBe('destructive');
    await apply(plan.planId, true);
    expect(foundry.docs.has(copyUuid)).toBe(false);
    expect((await revealsData()).pages).toEqual({});
  });

  it('a copy already deleted in Foundry only loses its entry', async () => {
    const { plan: reveal } = await planAndApply({ pageUuid: PAGE1, action: 'reveal' });
    foundry.docs.delete(reveal.copy!.pageUuid);
    const plan = await handouts.planPageReveal({ pageUuid: PAGE1, action: 'hide' });
    expect(plan.target).toBe('vault');
    expect(plan.summary).toBe('Hide page "Wine Cellar Notes" from players');
    expect(plan.copiesDeleted).toBeUndefined();
    await apply(plan.planId, true);
    expect((await revealsData()).pages).toEqual({});
  });
});

describe('planPageReveal: undo of copies', () => {
  beforeEach(() => {
    hiddenJournal.add(PAGE1);
  });

  it('undo of the first copy removes the copy, the journal it created and the entries', async () => {
    const { plan, changeId } = await planAndApply({ pageUuid: PAGE1, action: 'reveal' });
    await guarded.undo(changeId, { confirm: true });
    expect(foundry.docs.has(plan.copy!.journalUuid)).toBe(false);
    expect(foundry.docs.has(plan.copy!.pageUuid)).toBe(false);
    const data = await revealsData();
    expect(data.handoutsJournal).toBeUndefined();
    expect(copyEntries(data)).toEqual([]);
    expect(foundry.docs.get(PAGE1)?.source.ownership).toEqual({ default: 0 });
    // Revealing again starts over with a new journal.
    const again = await handouts.planPageReveal({ pageUuid: PAGE1, action: 'reveal' });
    expect(again.copy).toMatchObject({ action: 'create', journalCreated: true });
  });

  it('undo of a copy into an existing journal removes only that page', async () => {
    const first = await planAndApply({ pageUuid: PAGE1, action: 'reveal' });
    const second = await planAndApply({ pageUuid: PAGE2, action: 'reveal', copy: true });
    await guarded.undo(second.changeId, { confirm: true });
    const journalUuid = first.plan.copy!.journalUuid;
    expect(pagesIn(journalUuid)).toEqual([first.plan.copy!.pageUuid]);
    expect(copyEntries(await revealsData()).map(([, e]) => e.copiedFrom)).toEqual([PAGE1]);
  });

  it('undo of an update restores the previous copy content', async () => {
    const first = await planAndApply({ pageUuid: PAGE1, action: 'reveal' });
    foundry.edit(PAGE1, { path: 'text.content', present: true, value: '<p>New text.</p>' });
    const update = await planAndApply({ pageUuid: PAGE1, action: 'reveal' });
    await guarded.undo(update.changeId, { confirm: true });
    expect(foundry.docs.get(first.plan.copy!.pageUuid)?.source.text.content).toBe(
      '<p>The wine is poisoned.</p>'
    );
  });

  it('undo of a hide brings the copy back into "Handouts", revealed again', async () => {
    const { plan } = await planAndApply({ pageUuid: PAGE1, action: 'reveal' });
    const hide = await planAndApply({ pageUuid: PAGE1, action: 'hide' });
    await guarded.undo(hide.changeId, { confirm: true });
    expect(foundry.docs.get(plan.copy!.pageUuid)?.source).toMatchObject({
      name: 'Wine Cellar Notes',
      flags: { 'foundry-mcp-bridge': { copiedFrom: PAGE1 } },
    });
    expect((await handouts.playerHandouts()).handouts.map(h => h.uuid)).toEqual([
      plan.copy!.pageUuid,
    ]);
  });
});

describe('planPageReveal: copying page types', () => {
  const IMAGE = 'JournalEntry.jjjjjjjjjjjjjjjj.JournalEntryPage.iiiiiiiiiiiiiiii';
  const PDF = 'JournalEntry.jjjjjjjjjjjjjjjj.JournalEntryPage.ffffffffffffffff';
  const SPELLS = 'JournalEntry.jjjjjjjjjjjjjjjj.JournalEntryPage.ssssssssssssssss';

  beforeEach(() => {
    foundry.add(IMAGE, 'JournalEntryPage', {
      name: 'Map of the Valley',
      type: 'image',
      src: 'maps/valley.webp',
      image: { caption: 'Drawn in haste' },
      ownership: { default: 0 },
    });
    foundry.add(PDF, 'JournalEntryPage', { name: 'Rules', type: 'pdf', src: 'rules.pdf' });
    foundry.add(SPELLS, 'JournalEntryPage', { name: 'Spell List', type: 'spells' });
    for (const uuid of [IMAGE, PDF, SPELLS]) hiddenJournal.add(uuid);
  });

  it('an image page copies its source and caption', async () => {
    const { plan } = await planAndApply({ pageUuid: IMAGE, action: 'reveal' });
    expect(plan.copy).toMatchObject({ action: 'create', secretsRemoved: 0 });
    const source = foundry.docs.get(plan.copy!.pageUuid)?.source;
    expect(source).toMatchObject({
      name: 'Map of the Valley',
      type: 'image',
      src: 'maps/valley.webp',
      image: { caption: 'Drawn in haste' },
      flags: { 'foundry-mcp-bridge': { copiedFrom: IMAGE } },
    });
    expect(source?.text).toBeUndefined();
    expect(copyEntries(await revealsData()).map(([, e]) => e.copiedFrom)).toEqual([IMAGE]);
  });

  it('an image page without a caption copies none, and a later reveal follows the source', async () => {
    foundry.edit(IMAGE, { path: 'image.caption', present: false });
    const { plan } = await planAndApply({ pageUuid: IMAGE, action: 'reveal' });
    expect(foundry.docs.get(plan.copy!.pageUuid)?.source.image).toBeUndefined();

    foundry.edit(IMAGE, { path: 'src', present: true, value: 'maps/valley-2.webp' });
    foundry.edit(IMAGE, { path: 'image.caption', present: true, value: 'Second draft' });
    const update = await handouts.planPageReveal({ pageUuid: IMAGE, action: 'reveal' });
    expect(update.diff.map(d => d.path).sort()).toEqual(['image.caption', 'src']);
    await apply(update.planId, true);
    expect(foundry.docs.get(plan.copy!.pageUuid)?.source).toMatchObject({
      src: 'maps/valley-2.webp',
      image: { caption: 'Second draft' },
    });
  });

  it('refuses an image page without an image', async () => {
    foundry.edit(IMAGE, { path: 'src', present: false });
    await expect(handouts.planPageReveal({ pageUuid: IMAGE, action: 'reveal' })).rejects.toThrow(
      /The image page "Map of the Valley" has no image to copy/
    );
  });

  it('refuses other page types with a clear message, and writes nothing', async () => {
    await expect(handouts.planPageReveal({ pageUuid: PDF, action: 'reveal' })).rejects.toThrow(
      /Cannot copy "Rules": it is a "pdf" page, and a reveal copies only text and image pages/
    );
    await expect(
      handouts.planPageReveal({ pageUuid: SPELLS, action: 'reveal', copy: true })
    ).rejects.toThrow(/it is a "spells" page/);
    expect(await revealsData()).toBeUndefined();
    expect([...foundry.docs.values()].some(d => d.documentName === 'JournalEntry')).toBe(false);
  });

  it('a module without page types refuses to copy a non-text page', async () => {
    oldModule.add(IMAGE);
    await expect(
      handouts.planPageReveal({ pageUuid: IMAGE, action: 'reveal', copy: true })
    ).rejects.toThrow(/does not report page types. Update the module/);
  });
});
