/**
 * Foundry v14 (14.368) / dnd5e 6.0.5 compatibility tests for the chat, journal and dnd5e-table
 * domains (M3 lane E2). Every case runs against both the v13-shaped mock (the harness default) and
 * a v14 shape (`CONFIG.ChatMessage.modes`, `JOURNAL_ENTRY_PAGE_FORMATS`), so the feature-detected
 * paths stay green on both engines.
 *
 * Source facts these tests encode (checked in the 14.368 install at `C:\FoundryTest\app`):
 *   - `ChatMessage` visibility is the `whisper` id array plus `blind`; an EMPTY `whisper` is a
 *     public message. `style` is a plain field (0 OTHER, 1 OOC, 2 IC, 3 EMOTE). A `messageMode`
 *     create option is applied only when passed, and an unknown mode name falls back to the user's
 *     default mode (public), which is why `sendChatMessage` never passes one.
 *   - `JournalEntryPage` text: `text.content` (HTML), `text.markdown`, `text.format`
 *     (`JOURNAL_ENTRY_PAGE_FORMATS` HTML 1, MARKDOWN 2). The markdown editor shows `text.markdown`;
 *     the core HTML editor saves `{ format: HTML, markdown: '' }`.
 *   - dnd5e 6.0.5 `DND5E.validProperties.weapon`: ada amm fin fir foc hvy lgt lod mgc rch rel ret
 *     sil spc thr two ver.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';
import {
  ATTACK_DAMAGE_CANONICAL,
  ATTACK_PROPERTY_CANONICAL,
  NPC_CONDITION_CANONICAL,
  NPC_DAMAGE_CANONICAL,
  NPC_SIZE_MAP,
  NPC_SKILL_MAP,
} from './data-access/dnd5e-tables.js';

type Shape = 'v13' | 'v14';

let world: TestWorld;
let restore: () => void;
let da: FoundryDataAccess;
/** Payloads handed to `ChatMessage.create`, in order. */
let created: any[];

const g = globalThis as any;

function setUp(shape: Shape): void {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  world =
    shape === 'v14'
      ? createTestWorld({ foundryVersion: '14.368', systemVersion: '6.0.5' })
      : createTestWorld();
  restore = world.install();

  if (shape === 'v14') {
    // v14 message modes and page formats (`CONFIG.ChatMessage.modes`, `JOURNAL_ENTRY_PAGE_FORMATS`).
    g.CONFIG.ChatMessage = {
      modes: { public: 'public', gm: 'gm', blind: 'blind', self: 'self', ic: 'ic' },
    };
    g.CONST.JOURNAL_ENTRY_PAGE_FORMATS = { HTML: 1, MARKDOWN: 2 };
  }

  // Record what reaches `ChatMessage.create`, then store it like the harness does.
  created = [];
  const original = g.ChatMessage.create;
  g.ChatMessage.create = (data: unknown): Promise<unknown> => {
    created.push(data);
    return original(data) as Promise<unknown>;
  };

  da = new FoundryDataAccess();
}

function tearDown(): void {
  restore();
  vi.restoreAllMocks();
}

/** A message is public when nobody is named in `whisper` and it is not blind (core semantics). */
function isPublic(message: any): boolean {
  const whisper = Array.isArray(message?.whisper) ? message.whisper : [];
  return whisper.length === 0 && !message?.blind;
}

function lastStored(): any {
  const msgs = Array.from(world.messages.contents);
  return msgs[msgs.length - 1];
}

// =============================================================================
// sendChatMessage: every whisper path stays whispered
// =============================================================================

describe.each<Shape>(['v13', 'v14'])('sendChatMessage whisper safety (%s shape)', shape => {
  beforeEach(() => setUp(shape));
  afterEach(tearDown);

  it('whispers to a named user with the whisper id array and the OTHER style', async () => {
    world.addUser({ id: 'u1', name: 'Alice', active: true, isGM: false });

    const result = await da.sendChatMessage({
      message: 'psst',
      messageType: 'whisper',
      whisperTargets: ['Alice'],
    });

    expect(result.success).toBe(true);
    const stored = lastStored();
    expect(stored.whisper).toEqual(['u1']);
    expect(isPublic(stored)).toBe(false);
    expect(stored.style).toBe(0);
    // No mode key is passed: an unknown/legacy mode would fall back to public on v14.
    expect(created[0]).not.toHaveProperty('messageMode');
    expect(created[0]).not.toHaveProperty('rollMode');
    expect(result.whisperedTo).toEqual(['Alice']);
    expect(result.warning).toBeUndefined();
  });

  it('matches target names case-insensitively and whispers to every match', async () => {
    world.addUser({ id: 'u1', name: 'Alice', active: true, isGM: false });
    world.addUser({ id: 'u2', name: 'Bob', active: true, isGM: false });

    await da.sendChatMessage({
      message: 'both of you',
      messageType: 'WHISPER',
      whisperTargets: ['alice', 'BOB'],
    });

    expect(lastStored().whisper).toEqual(['u1', 'u2']);
  });

  it('whispers to the users that resolve when only some targets are known', async () => {
    world.addUser({ id: 'u1', name: 'Alice', active: true, isGM: false });

    const result = await da.sendChatMessage({
      message: 'psst',
      messageType: 'whisper',
      whisperTargets: ['Alice', 'Ghost'],
    });

    const stored = lastStored();
    expect(stored.whisper).toEqual(['u1']);
    expect(isPublic(stored)).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  it('falls back to every GM user when no target resolves', async () => {
    world.addUser({ id: 'gm-a', name: 'GM A', active: true, isGM: true });
    world.addUser({ id: 'gm-b', name: 'GM B', active: false, isGM: true });
    world.addUser({ id: 'pl', name: 'Player', active: true, isGM: false });

    const result = await da.sendChatMessage({
      message: 'secret',
      messageType: 'whisper',
      whisperTargets: ['Ghost'],
    });

    const stored = lastStored();
    expect(stored.whisper).toEqual(['gm-a', 'gm-b']);
    expect(isPublic(stored)).toBe(false);
    expect(result.warning).toMatch(/No whisper targets resolved/);
  });

  it('falls back to the GM when whisperTargets is omitted or not an array', async () => {
    world.addUser({ id: 'gm-a', name: 'GM A', active: true, isGM: true });

    await da.sendChatMessage({ message: 'one', messageType: 'whisper' });
    expect(lastStored().whisper).toEqual(['gm-a']);

    await da.sendChatMessage({
      message: 'two',
      messageType: 'whisper',
      whisperTargets: 'Alice' as unknown as string[],
    });
    expect(lastStored().whisper).toEqual(['gm-a']);
    expect(created).toHaveLength(2);
  });

  it('whispers to the sending user when no target and no GM user resolve (never public)', async () => {
    // world.users is empty here: no target and no GM can be found.
    const result = await da.sendChatMessage({
      message: 'secret',
      messageType: 'whisper',
      whisperTargets: ['Ghost'],
    });

    const stored = lastStored();
    expect(stored.whisper).toEqual(['gm']); // the mock's current user id
    expect(isPublic(stored)).toBe(false);
    expect(result.warning).toMatch(/No whisper targets resolved/);
    expect(result.warning).toMatch(/sending user/);
  });

  it('refuses to post at all when there is no target, no GM and no sender id', async () => {
    g.game.user = { name: 'Nobody' }; // a user without an id

    await expect(
      da.sendChatMessage({ message: 'secret', messageType: 'whisper', whisperTargets: ['Ghost'] })
    ).rejects.toThrow(/no recipient/i);

    expect(created).toHaveLength(0);
    expect(world.messages.size).toBe(0);
  });

  it.each(['ic', 'ooc', 'emote'])('a %s message carries no whisper and is public', async type => {
    world.addUser({ id: 'u1', name: 'Alice', active: true, isGM: false });

    await da.sendChatMessage({
      message: 'hello',
      messageType: type,
      // Targets on a non-whisper type are ignored, not turned into a whisper.
      whisperTargets: ['Alice'],
    });

    expect(created[0]).not.toHaveProperty('whisper');
    expect(created[0]).not.toHaveProperty('messageMode');
    expect(isPublic(lastStored())).toBe(true);
  });

  it('maps the message types to the core chat styles', async () => {
    await da.sendChatMessage({ message: 'a', messageType: 'ooc' });
    expect(lastStored().style).toBe(1);
    await da.sendChatMessage({ message: 'b', messageType: 'ic' });
    expect(lastStored().style).toBe(2);
    await da.sendChatMessage({ message: 'c', messageType: 'emote' });
    expect(lastStored().style).toBe(3);
  });
});

// =============================================================================
// updateJournalContent: markdown pages are switched back to HTML
// =============================================================================

async function addPage(
  journalId: string,
  pageId: string,
  text: Record<string, unknown>
): Promise<{ journal: any; page: any }> {
  const journal = world.addJournal({ id: journalId, name: `J ${journalId}` });
  const [page] = await (journal as any).createEmbeddedDocuments('JournalEntryPage', [
    { id: pageId, name: 'Notes', type: 'text', text },
  ]);
  return { journal, page };
}

describe.each<Shape>(['v13', 'v14'])('updateJournalContent markdown handling (%s shape)', shape => {
  beforeEach(() => {
    setUp(shape);
    world.enableWrites();
  });
  afterEach(tearDown);

  it('clears stale markdown and switches to HTML when the first text page is markdown (mode 3)', async () => {
    const { page } = await addPage('j1', 'p1', {
      content: '<p>old</p>',
      markdown: 'old',
      format: 2,
    });
    const update = vi.spyOn(page, 'update');

    await da.updateJournalContent({ journalId: 'j1', content: '<p>new</p>' });

    expect(update).toHaveBeenCalledWith({
      'text.content': '<p>new</p>',
      'text.markdown': '',
      'text.format': 1,
    });
    expect(page.text).toEqual({ content: '<p>new</p>', markdown: '', format: 1 });
  });

  it('does the same for a page selected by id (mode 2)', async () => {
    const { page } = await addPage('j2', 'p2', {
      content: '<p>old</p>',
      markdown: 'old',
      format: 2,
    });
    const update = vi.spyOn(page, 'update');

    await da.updateJournalContent({ journalId: 'j2', pageId: 'p2', content: '<p>new</p>' });

    expect(update).toHaveBeenCalledWith({
      'text.content': '<p>new</p>',
      'text.markdown': '',
      'text.format': 1,
    });
  });

  it('treats a markdown-format page with an empty markdown field as markdown', async () => {
    const { page } = await addPage('j3', 'p3', { content: '<p>old</p>', markdown: '', format: 2 });
    const update = vi.spyOn(page, 'update');

    await da.updateJournalContent({ journalId: 'j3', content: '<p>new</p>' });

    expect(update).toHaveBeenCalledWith({
      'text.content': '<p>new</p>',
      'text.markdown': '',
      'text.format': 1,
    });
  });

  it('treats a page with leftover markdown as markdown even when the format says HTML', async () => {
    const { page } = await addPage('j4', 'p4', {
      content: '<p>old</p>',
      markdown: 'old',
      format: 1,
    });
    const update = vi.spyOn(page, 'update');

    await da.updateJournalContent({ journalId: 'j4', content: '<p>new</p>' });

    expect(update).toHaveBeenCalledWith({
      'text.content': '<p>new</p>',
      'text.markdown': '',
      'text.format': 1,
    });
  });

  it('sends only text.content for a plain HTML page', async () => {
    const { page } = await addPage('j5', 'p5', { content: '<p>old</p>', format: 1 });
    const update = vi.spyOn(page, 'update');

    await da.updateJournalContent({ journalId: 'j5', content: '<p>new</p>' });

    expect(update).toHaveBeenCalledWith({ 'text.content': '<p>new</p>' });
  });

  it('sends only text.content for a legacy page with no format or markdown field', async () => {
    const { page } = await addPage('j6', 'p6', { content: '<p>old</p>' });
    const update = vi.spyOn(page, 'update');

    await da.updateJournalContent({ journalId: 'j6', pageId: 'p6', content: '<p>new</p>' });

    expect(update).toHaveBeenCalledWith({ 'text.content': '<p>new</p>' });
  });

  it('appends new pages as HTML text pages with the content only (mode 1)', async () => {
    const { journal } = await addPage('j7', 'p7', { content: '<p>old</p>' });
    const create = vi.spyOn(journal, 'createEmbeddedDocuments');

    await da.updateJournalContent({ journalId: 'j7', newPageName: 'Extra', content: '<p>x</p>' });

    expect(create).toHaveBeenCalledWith('JournalEntryPage', [
      { type: 'text', name: 'Extra', text: { content: '<p>x</p>' } },
    ]);
  });
});

// =============================================================================
// dnd5e static tables against dnd5e 6.0.5
// =============================================================================

describe('dnd5e-tables against dnd5e 6.0.5', () => {
  it('ATTACK_PROPERTY_CANONICAL is exactly DND5E.validProperties.weapon', () => {
    expect([...ATTACK_PROPERTY_CANONICAL].sort()).toEqual(
      [
        'ada',
        'amm',
        'fin',
        'fir',
        'foc',
        'hvy',
        'lgt',
        'lod',
        'mgc',
        'rch',
        'rel',
        'ret',
        'sil',
        'spc',
        'thr',
        'two',
        'ver',
      ].sort()
    );
  });

  it('the damage sets are exactly the 13 damage types of DND5E.damageTypes', () => {
    const damage = [
      'acid',
      'bludgeoning',
      'cold',
      'fire',
      'force',
      'lightning',
      'necrotic',
      'piercing',
      'poison',
      'psychic',
      'radiant',
      'slashing',
      'thunder',
    ];
    expect([...NPC_DAMAGE_CANONICAL].sort()).toEqual(damage);
    expect([...ATTACK_DAMAGE_CANONICAL].sort()).toEqual(damage);
  });

  it('NPC_CONDITION_CANONICAL holds only keys of DND5E.conditionTypes', () => {
    // The 15 core conditions; dnd5e 6.0.5 also has bleeding, burning, cursed, dehydration, diseased,
    // falling, malnutrition, silenced, suffocation, surprised and transformed (not used for NPCs).
    const conditionTypes = new Set([
      'bleeding',
      'blinded',
      'burning',
      'charmed',
      'cursed',
      'dehydration',
      'deafened',
      'diseased',
      'exhaustion',
      'falling',
      'frightened',
      'grappled',
      'incapacitated',
      'invisible',
      'malnutrition',
      'paralyzed',
      'petrified',
      'poisoned',
      'prone',
      'restrained',
      'silenced',
      'stunned',
      'suffocation',
      'surprised',
      'transformed',
      'unconscious',
    ]);
    for (const condition of NPC_CONDITION_CANONICAL) {
      expect(conditionTypes.has(condition)).toBe(true);
    }
    expect(NPC_CONDITION_CANONICAL.size).toBe(15);
  });

  it('the size and skill maps use dnd5e 6.0.5 keys', () => {
    expect(Object.values(NPC_SIZE_MAP).sort()).toEqual(['grg', 'huge', 'lg', 'med', 'sm', 'tiny']);
    expect(Object.values(NPC_SKILL_MAP).sort()).toEqual(
      [
        'acr',
        'ani',
        'arc',
        'ath',
        'dec',
        'his',
        'ins',
        'itm',
        'inv',
        'med',
        'nat',
        'prc',
        'prf',
        'per',
        'rel',
        'slt',
        'ste',
        'sur',
      ].sort()
    );
  });
});

// =============================================================================
// getModuleManifest / getModules: Set-valued package fields (real v11+ packages)
// =============================================================================

describe.each<Shape>(['v13', 'v14'])('module Set fields (%s shape)', shape => {
  beforeEach(() => setUp(shape));
  afterEach(tearDown);

  function addSetModule(): void {
    // A real BaseModule holds `authors` and every `relationships` list as a Set.
    world.addModule({
      id: 'set-mod',
      title: 'Set Mod',
      version: '2.0.0',
      active: true,
      compatibility: { minimum: '13', verified: '14', maximum: '14' },
      authors: new Set([{ name: 'Bob', email: 'bob@example.com' }, { name: 'Carol' }]) as any,
      relationships: {
        systems: new Set([{ id: 'dnd5e', type: 'system' }]),
        requires: new Set([{ id: 'lib-wrapper', type: 'module' }]),
        recommends: new Set(),
        conflicts: new Set(),
        flags: {},
      } as any,
    });
    world.addModule({ id: 'lib-wrapper', title: 'libWrapper', active: false });
  }

  it('getModuleManifest keeps authors and relationships instead of flattening the Sets to {}', async () => {
    addSetModule();

    const { manifest } = await da.getModuleManifest({ moduleId: 'set-mod' });

    expect(manifest.authors).toEqual([
      { name: 'Bob', email: 'bob@example.com' },
      { name: 'Carol' },
    ]);
    expect(manifest.relationships).toEqual({
      systems: [{ id: 'dnd5e', type: 'system' }],
      requires: [{ id: 'lib-wrapper', type: 'module' }],
      recommends: [],
      conflicts: [],
      flags: {},
    });
    expect(manifest.compatibility).toEqual({ minimum: '13', verified: '14', maximum: '14' });
  });

  it('getModules resolves a Set-valued requires list', async () => {
    addSetModule();

    const result = await da.getModules({});
    const mod = result.modules.find((m: any) => m.id === 'set-mod');

    expect(mod.requires).toEqual([
      { id: 'lib-wrapper', installed: true, active: false, version: '1.0.0' },
    ]);
    expect(mod.issues).toContain('required dependency inactive: lib-wrapper');
  });
});
