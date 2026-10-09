/**
 * Tarokka service end to end: plans go through the real GuardedWriteService,
 * the vault is a temp dir, Foundry is the fake module. Includes the canary
 * checks: card names, card ids and GM notes never go to Foundry (where players
 * could read them) and never appear in change summaries.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeFoundry } from '../test-support/fake-foundry.js';
import { GuardedWriteService } from '../guarded-write/service.js';
import { AuditLog } from '../vault/audit.js';
import { VaultStore } from '../vault/store.js';
import {
  REVEALS_FILE,
  TAROKKA_CONFIG_FILE,
  TAROKKA_FILE,
  TarokkaService,
  revealHtml,
} from './service.js';

const WORLD = 'curse-of-strahd';
let dataDir: string;
let foundry: FakeFoundry;
let store: VaultStore;
let guarded: GuardedWriteService;
let tarokka: TarokkaService;
let now: number;

/** Deterministic roll: always the first available card. */
const firstCard = (): number => 0;

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tarokka-'));
  foundry = new FakeFoundry();
  foundry.worldId = WORLD;
  foundry.features = [{ id: 'tarokka', name: 'Tarokka', hint: '', enabled: true }];
  foundry.handlers['foundry-mcp-bridge.getTarokkaReading'] = (): unknown => ({
    available: false,
    reason: 'tarokka-reading is not installed; use source builtin-roll',
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
  tarokka = new TarokkaService({
    guardedWrites: guarded,
    store,
    worldIds,
    foundryClient: foundry,
    random: firstCard,
    now: (): number => now,
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

async function vaultData(file: string): Promise<any> {
  return (await store.read(WORLD, 'gm', file))?.data;
}

const TR_READING = {
  source: 'tarokka-reading',
  providerVersion: '1.0.3',
  readingId: 'abcDEF123456',
  dealt: true,
  complete: false,
  slots: [
    { position: 'tome', cardId: 'stars-4', cardName: 'Provider Name', gmNote: 'note 1' },
    { position: 'holySymbol', cardId: 'coins-master', cardName: null, gmNote: null },
    { position: 'sunsword', cardId: 'glyphs-2', cardName: null, gmNote: null },
    { position: 'ally', cardId: 'ghost', cardName: null, gmNote: 'secret ally note' },
    { position: 'strahdLocation', cardId: 'mists', cardName: null, gmNote: null },
  ],
};

describe('reading and import', () => {
  it('reports no reading before the first import', async () => {
    expect(await tarokka.getReading()).toMatchObject({
      available: false,
      archivedReadings: 0,
      revealJournalUuid: null,
    });
  });

  it('rolls a reading when tarokka-reading is unavailable, and stores it on apply', async () => {
    const plan = await tarokka.planImport({});
    expect(plan).toMatchObject({
      feature: 'tarokka',
      target: 'vault',
      risk: 'write',
      source: 'builtin-roll',
      providerNote: expect.stringMatching(/not installed/),
    });
    expect(plan.diff.map(d => d.text)).toContain(
      'gm/tarokka.json: current.source: (unset) → "builtin-roll"'
    );
    expect(await vaultData(TAROKKA_FILE)).toBeUndefined();

    await apply(plan.planId);
    const view = await tarokka.getReading();
    expect(view.available).toBe(true);
    expect(view.reading?.source).toBe('builtin-roll');
    expect(view.reading?.positions.map(p => [p.position, p.cardId, p.cardName])).toEqual([
      ['tome', 'swords-1', 'One of Swords'],
      ['holySymbol', 'swords-2', 'Two of Swords'],
      ['sunsword', 'swords-3', 'Three of Swords'],
      ['ally', 'artifact', 'Artifact'],
      ['strahdLocation', 'beast', 'Beast'],
    ]);
    expect(view.reading?.positions[0]).toMatchObject({
      label: 'Tome',
      deck: 'common',
      linked: false,
      revealed: false,
    });
  });

  it('imports the tarokka-reading deal, with names, notes and the dealing GM', async () => {
    const provider = vi.fn(() => ({ available: true, from: 'user:gm2', reading: TR_READING }));
    foundry.handlers['foundry-mcp-bridge.getTarokkaReading'] = provider;
    const plan = await tarokka.planImport({ source: 'tarokka-reading', userId: 'gm2' });
    expect(provider).toHaveBeenCalledWith({ userId: 'gm2' });
    await apply(plan.planId);
    const view = await tarokka.getReading();
    expect(view.reading).toMatchObject({
      readingId: 'tr-abcDEF123456',
      source: 'tarokka-reading',
      providerVersion: '1.0.3',
    });
    expect(view.reading?.positions[0]).toMatchObject({
      cardName: 'Provider Name',
      gmNote: 'note 1',
    });
    expect(view.reading?.positions[1].cardName).toBe('Master of Coins');
  });

  it('refuses tarokka-reading when unavailable or malformed', async () => {
    await expect(tarokka.planImport({ source: 'tarokka-reading' })).rejects.toThrow(
      /not installed/
    );
    foundry.handlers['foundry-mcp-bridge.getTarokkaReading'] = (): unknown => ({
      available: true,
      reading: {
        ...TR_READING,
        slots: TR_READING.slots.map((s, i) => (i === 3 ? { ...s, cardId: 'swords-1' } : s)),
      },
    });
    await expect(tarokka.planImport({ source: 'tarokka-reading' })).rejects.toThrow(
      /no valid card for Ally/
    );
    foundry.handlers['foundry-mcp-bridge.getTarokkaReading'] = (): unknown => ({
      success: false,
      error: 'Access denied',
    });
    await expect(tarokka.planImport({})).rejects.toThrow(/refused: Access denied/);
  });

  it('archives the previous reading, keeps reveals on a re-import of the same deal', async () => {
    await apply((await tarokka.planImport({ source: 'builtin-roll' })).planId);
    const first = (await tarokka.getReading()).reading!.readingId;
    now += 1000;
    const second = await tarokka.planImport({ source: 'builtin-roll' });
    expect(second.summary).toMatch(/archiving the previous one/);
    await apply(second.planId);
    const view = await tarokka.getReading();
    expect(view.archivedReadings).toBe(1);
    expect((await vaultData(TAROKKA_FILE)).archive[first].readingId).toBe(first);

    foundry.handlers['foundry-mcp-bridge.getTarokkaReading'] = (): unknown => ({
      available: true,
      reading: TR_READING,
    });
    await apply((await tarokka.planImport({})).planId);
    await apply(
      (await tarokka.planReveal({ position: 'tome', text: 'The book waits.' })).planId,
      true
    );
    const again = await tarokka.planImport({});
    expect(again.summary).not.toMatch(/archiving/);
    await apply(again.planId);
    const kept = (await tarokka.getReading()).reading!.positions[0];
    expect(kept.revealed).toBe(true);
    expect(kept.revealPageUuid).toMatch(/^JournalEntry\.[A-Za-z0-9]{16}\.JournalEntryPage\./);
  });

  it('can be undone, restoring the previous reading', async () => {
    await apply((await tarokka.planImport({ source: 'builtin-roll' })).planId);
    const before = await tarokka.getReading();
    now += 1000;
    const changeId = await apply((await tarokka.planImport({ source: 'builtin-roll' })).planId);
    await guarded.undo(changeId, { confirm: true });
    expect(await tarokka.getReading()).toEqual(before);
  });

  // Found in the live test: undoing the first import unsets the leaves and
  // leaves `current: {positions: {}}` behind, which crashed the read.
  it('treats what an undone first import leaves behind as no reading', async () => {
    const changeId = await apply((await tarokka.planImport({ source: 'builtin-roll' })).planId);
    await guarded.undo(changeId, { confirm: true });
    expect((await vaultData(TAROKKA_FILE)).current).toEqual({ positions: {} });
    expect(await tarokka.getReading()).toMatchObject({ available: false, archivedReadings: 0 });
    await expect(tarokka.planReveal({ position: 'tome', text: 'x' })).rejects.toThrow(
      /No current reading/
    );

    now += 1000;
    const next = await tarokka.planImport({ source: 'builtin-roll' });
    expect(next.summary).not.toMatch(/archiving/);
    expect(next.diff.some(d => d.path?.startsWith('archive.'))).toBe(false);
    await apply(next.planId);
    const view = await tarokka.getReading();
    expect(view).toMatchObject({ available: true, archivedReadings: 0 });
    expect(view.reading!.positions).toHaveLength(5);
  });

  it('needs the tarokka feature switch to apply', async () => {
    const plan = await tarokka.planImport({ source: 'builtin-roll' });
    foundry.features[0].enabled = false;
    await expect(apply(plan.planId)).rejects.toThrow(/switched off/);
  });
});

describe('links', () => {
  beforeEach(async () => {
    await apply((await tarokka.planImport({ source: 'builtin-roll' })).planId);
  });

  const PAGE = 'JournalEntry.aaaaaaaaaaaaaaaa.JournalEntryPage.bbbbbbbbbbbbbbbb';
  const SCENE = 'Scene.cccccccccccccccc';

  it("links the current card of a position, and applies to that card's future deals", async () => {
    const plan = await tarokka.planLinks({
      position: 'tome',
      journalPageUuid: PAGE,
      sceneUuid: SCENE,
      cardName: 'My Name',
    });
    expect(plan.risk).toBe('write');
    await apply(plan.planId);
    const tome = (await tarokka.getReading()).reading!.positions[0];
    expect(tome).toMatchObject({
      cardName: 'My Name',
      linked: true,
      links: { journalPageUuid: PAGE, sceneUuid: SCENE },
    });
    expect((await vaultData(TAROKKA_CONFIG_FILE)).links.tome['swords-1']).toEqual({
      journalPageUuid: PAGE,
      sceneUuid: SCENE,
    });
  });

  it('links a card in advance and clears links (destructive)', async () => {
    await apply(
      (
        await tarokka.planLinks({
          position: 'ally',
          cardId: 'raven',
          actorUuid: 'Actor.dddddddddddddddd',
        })
      ).planId
    );
    const clear = await tarokka.planLinks({ position: 'ally', cardId: 'raven', clear: true });
    expect(clear.risk).toBe('destructive');
    await apply(clear.planId, true);
    expect((await vaultData(TAROKKA_CONFIG_FILE)).links.ally).toEqual({});
  });

  it('validates position, card, uuids and that something changes', async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ position: 'moon' }, /position must be one of/],
      [
        { position: 'ally', cardId: 'swords-1', actorUuid: 'Actor.dddddddddddddddd' },
        /not a high-deck/,
      ],
      [{ position: 'tome', journalPageUuid: 'not a uuid' }, /journalPageUuid must be/],
      [{ position: 'tome' }, /Nothing to change/],
      [{ position: 'tome', clear: true }, /no links to clear/],
      [{ position: 'tome', cardName: '  ' }, /cardName must be/],
    ];
    for (const [args, message] of cases) {
      await expect(tarokka.planLinks(args as never)).rejects.toThrow(message);
    }
  });

  it('suggests candidates through the module search', async () => {
    const search = vi.fn(() => ({ query: 'vall', candidates: [{ uuid: SCENE }] }));
    foundry.handlers['foundry-mcp-bridge.searchLinkCandidates'] = search;
    expect(await tarokka.suggestLinks('vall', 5)).toEqual({
      query: 'vall',
      candidates: [{ uuid: SCENE }],
    });
    expect(search).toHaveBeenCalledWith({ query: 'vall', limit: 5 });
  });
});

describe('reveal', () => {
  beforeEach(async () => {
    foundry.handlers['foundry-mcp-bridge.getTarokkaReading'] = (): unknown => ({
      available: true,
      reading: TR_READING,
    });
    await apply((await tarokka.planImport({})).planId);
  });

  it('creates the player journal with the GM text, allowlists the page, marks it revealed', async () => {
    const plan = await tarokka.planReveal({
      position: 'ally',
      text: 'A friend will come.\n\nLook to the <mist>.',
      title: 'The ally',
    });
    expect(plan).toMatchObject({ target: 'mixed', risk: 'destructive' });
    expect(plan.requires.confirmDestructive).toBe(true);
    await expect(apply(plan.planId)).rejects.toThrow(/confirmDestructive/);
    await apply(plan.planId, true);

    const journalUuid = (await vaultData(TAROKKA_FILE)).revealJournal.uuid as string;
    const journal = foundry.docs.get(journalUuid)!;
    expect(journal.source).toMatchObject({ name: 'Tarokka reading', ownership: { default: 2 } });
    const page = foundry.docs.get(plan.pageUuid)!;
    expect(page.source).toMatchObject({
      name: 'The ally',
      type: 'text',
      text: { content: '<p>A friend will come.</p><p>Look to the &lt;mist&gt;.</p>' },
    });
    const pageId = plan.pageUuid.split('.').pop()!;
    expect((await vaultData(REVEALS_FILE)).pages[pageId]).toMatchObject({
      uuid: plan.pageUuid,
      feature: 'tarokka',
      position: 'ally',
      readingId: 'tr-abcDEF123456',
    });
    expect((await tarokka.getReading()).reading!.positions[3]).toMatchObject({
      revealed: true,
      revealPageUuid: plan.pageUuid,
    });
  });

  it('adds later reveals to the same journal and updates an existing page in place', async () => {
    const first = await tarokka.planReveal({ position: 'tome', text: 'One.' });
    await apply(first.planId, true);
    const second = await tarokka.planReveal({ position: 'sunsword', text: 'Two.' });
    const journalUuid = (await vaultData(TAROKKA_FILE)).revealJournal.uuid as string;
    expect(second.pageUuid.startsWith(`${journalUuid}.JournalEntryPage.`)).toBe(true);
    await apply(second.planId, true);
    expect(foundry.docs.get(second.pageUuid)?.source.name).toBe('Card 3');

    // Found in the live test: a re-reveal without a title renamed the page
    // back to "Card 1". Without a title the page keeps its name.
    await apply(
      (await tarokka.planReveal({ position: 'tome', text: 'One.', title: 'The tome' })).planId,
      true
    );
    const edit = await tarokka.planReveal({ position: 'tome', text: 'One, revised.' });
    expect(edit.pageUuid).toBe(first.pageUuid);
    expect(edit.target).toBe('foundry');
    expect(edit.diff.map(d => d.path)).toEqual(['text.content']);
    expect(edit.summary).toBe('Update the revealed Tarokka tome page');
    await apply(edit.planId, true);
    expect(foundry.docs.get(first.pageUuid)?.source).toMatchObject({
      name: 'The tome',
      text: { content: '<p>One, revised.</p>' },
    });
  });

  it('recreates the journal if the GM deleted it, and undo removes a reveal', async () => {
    const first = await tarokka.planReveal({ position: 'tome', text: 'One.' });
    const changeId = await apply(first.planId, true);
    await guarded.undo(changeId, { confirm: true });
    expect(foundry.docs.has(first.pageUuid)).toBe(false);
    expect((await tarokka.getReading()).reading!.positions[0].revealed).toBe(false);
    expect((await vaultData(REVEALS_FILE)).pages).toEqual({});

    await apply((await tarokka.planReveal({ position: 'tome', text: 'One.' })).planId, true);
    const journalUuid = (await vaultData(TAROKKA_FILE)).revealJournal.uuid as string;
    foundry.docs.delete(journalUuid);
    const again = await tarokka.planReveal({ position: 'holySymbol', text: 'Two.' });
    expect(again.diff.some(d => d.text.startsWith('Create JournalEntry'))).toBe(true);
  });

  it('shows the page to every player after the reveal only when showNow is true (I-110)', async () => {
    const show = vi.fn(() => ({ shown: true }));
    foundry.handlers['foundry-mcp-bridge.showJournalPage'] = show;
    const plain = await tarokka.planReveal({ position: 'tome', text: 'One.' });
    expect(plain.diff.some(d => d.kind === 'show')).toBe(false);
    await apply(plain.planId, true);
    expect(show).not.toHaveBeenCalled();

    // A re-reveal updates the page in place; the popup targets that same page.
    const again = await tarokka.planReveal({
      position: 'tome',
      text: 'One, revised.',
      showNow: true,
    });
    expect(again.diff.find(d => d.kind === 'show')).toMatchObject({ target: plain.pageUuid });
    await apply(again.planId, true);
    expect(show).toHaveBeenCalledWith({ uuid: plain.pageUuid, userIds: [] });

    const first = await tarokka.planReveal({ position: 'ally', text: 'Two.', showNow: true });
    expect(first.diff.at(-1)).toMatchObject({ kind: 'show', target: first.pageUuid });
    await expect(
      tarokka.planReveal({ position: 'tome', text: 'x', showNow: 'yes' as never })
    ).rejects.toThrow(/showNow must be/);
  });

  /** Replace the current reading with a fresh deal of the same cards under another id. */
  async function replaceReading(): Promise<void> {
    foundry.handlers['foundry-mcp-bridge.getTarokkaReading'] = (): unknown => ({
      available: true,
      reading: { ...TR_READING, readingId: 'newDEAL98765' },
    });
    await apply((await tarokka.planImport({})).planId);
    expect((await tarokka.getReading()).reading?.readingId).toBe('tr-newDEAL98765');
  }

  it('pins the reading: a reveal planned for a replaced reading writes nothing', async () => {
    const plan = await tarokka.planReveal({ position: 'tome', text: 'One.' });
    // The pin is no diff line: the GM sees only what changes.
    expect(plan.diff.some(d => d.path === 'current.readingId')).toBe(false);
    await replaceReading();
    const reveals = await vaultData(REVEALS_FILE);
    await expect(apply(plan.planId, true)).rejects.toThrow(
      /Conflict, nothing was written: tarokka\.json current\.readingId changed since/
    );
    expect(foundry.docs.has(plan.pageUuid)).toBe(false);
    expect(await vaultData(REVEALS_FILE)).toEqual(reveals);
    expect((await tarokka.getReading()).reading!.positions[0].revealed).toBe(false);
  });

  it('pins the reading for a re-reveal too (no vault ops of its own)', async () => {
    const first = await tarokka.planReveal({ position: 'tome', text: 'One.' });
    await apply(first.planId, true);
    const edit = await tarokka.planReveal({ position: 'tome', text: 'One, revised.' });
    expect(edit.target).toBe('foundry');
    await replaceReading();
    await expect(apply(edit.planId, true)).rejects.toThrow(/current\.readingId changed since/);
    expect(foundry.docs.get(first.pageUuid)?.source).toMatchObject({
      text: { content: '<p>One.</p>' },
    });
  });

  it('validates the request', async () => {
    await expect(tarokka.planReveal({ position: 'x', text: 'a' })).rejects.toThrow(/position/);
    await expect(tarokka.planReveal({ position: 'tome', text: '  ' })).rejects.toThrow(
      /text must be/
    );
    await expect(tarokka.planReveal({ position: 'tome', text: 'x'.repeat(5001) })).rejects.toThrow(
      /text must be/
    );
  });
});

describe('canary: nothing secret reaches Foundry or the change summaries', () => {
  it('sends only GM-typed text to Foundry and keeps card data out of summaries', async () => {
    foundry.handlers['foundry-mcp-bridge.getTarokkaReading'] = (): unknown => ({
      available: true,
      reading: TR_READING,
    });
    await apply((await tarokka.planImport({})).planId);
    await apply(
      (await tarokka.planLinks({ position: 'strahdLocation', sceneUuid: 'Scene.cccccccccccccccc' }))
        .planId
    );
    const text = 'The players may know this.';
    await apply((await tarokka.planReveal({ position: 'ally', text })).planId, true);

    const secrets = [
      'Provider Name',
      'note 1',
      'secret ally note',
      'stars-4',
      'ghost',
      'mists',
      'Master of Coins',
      'Scene.cccccccccccccccc',
    ];
    // Everything sent to Foundry, except the read-only requests for the reading itself.
    const sent = JSON.stringify(
      foundry.calls.filter(
        ([method]) =>
          !method.endsWith('getTarokkaReading') && !method.endsWith('searchLinkCandidates')
      )
    );
    for (const secret of secrets) expect(sent).not.toContain(secret);
    expect(sent).toContain(text);

    const summaries = (await guarded.listRecentChanges()).map(c => c.summary).join('\n');
    for (const secret of secrets) expect(summaries).not.toContain(secret);
  });

  it('escapes GM text as HTML', () => {
    expect(revealHtml(' a & b\nc\n\n  "d" ')).toBe('<p>a &amp; b<br>c</p><p>&quot;d&quot;</p>');
  });
});
