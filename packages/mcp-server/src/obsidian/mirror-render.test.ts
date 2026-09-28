import type {
  ExportActorEntry,
  ExportEntryBase,
  ExportEntry,
  ExportItemEntry,
  ExportJournalEntry,
  ExportPageEntry,
  ExportSceneEntry,
} from '@gnuminator/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  emptyMirrorStatus,
  MIRROR_NOTE_TYPES,
  MIRROR_STATUS_PATH,
  relativeLinkTarget,
  type LinkContext,
  type LinkTarget,
  type MirrorNoteType,
  type MirrorRenderContext,
  type MirrorStatus,
  type RenderedNote,
} from './mirror-common.js';
import {
  mirrorNoteType,
  MIRROR_BASE_FILES,
  renderMirrorBases,
  renderMirrorNote,
  renderMirrorStatusNote,
  sameMirrorContent,
} from './mirror-render.js';
import { baseOwnershipCheck, checkMarkdownOwnership } from './ownership.js';
import { generatedProps, renderCampaignHome, renderStatusNote } from './render.js';

const converter = vi.hoisted(() => ({
  html: vi.fn<(html: string, ctx: LinkContext) => string>(),
  markdown: vi.fn<(markdown: string, ctx: LinkContext) => string>(),
}));

vi.mock('./html-to-md.js', () => ({
  htmlToMarkdown: converter.html,
  markdownPageText: converter.markdown,
}));

beforeEach(() => {
  converter.html.mockReset();
  converter.markdown.mockReset();
  converter.html.mockImplementation((html, ctx) => `[html ${ctx.fromPath}] ${html}`);
  converter.markdown.mockImplementation(
    (markdown, ctx) => `[markdown ${ctx.fromPath}] ${markdown}`
  );
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const W = 'strahd-test';
const OPEN = 'http://localhost:3000';
const MODIFIED = Date.UTC(2026, 8, 29, 10, 30, 0);
const HOSTILE =
  'Evil <%= tp.system.prompt() %> [[Secret|link]] #tag ^blk\n# Injected heading\n---\nInjected: true';

/** A 16-character Foundry id. */
const fid = (seed: string): string => seed.padEnd(16, '0');

const PC_UUID = `Actor.${fid('pc1')}`;
const NPC_UUID = `Actor.${fid('npc1')}`;
const SCENE_UUID = `Scene.${fid('scene1')}`;
const JOURNAL_UUID = `JournalEntry.${fid('jr1')}`;
const PAGE1_UUID = `${JOURNAL_UUID}.JournalEntryPage.${fid('pg1')}`;
const PAGE2_UUID = `${JOURNAL_UUID}.JournalEntryPage.${fid('pg2')}`;
const PAGE3_UUID = `${JOURNAL_UUID}.JournalEntryPage.${fid('pg3')}`;
const PAGE4_UUID = `${JOURNAL_UUID}.JournalEntryPage.${fid('pg4')}`;
const ITEM_UUID = `Item.${fid('item1')}`;

const PATHS: Record<string, string> = {
  [PC_UUID]: 'AI Tool/Foundry/PCs/Test Hero.md',
  [NPC_UUID]: 'AI Tool/Foundry/NPCs/Wolf.md',
  [SCENE_UUID]: 'AI Tool/Foundry/Scenes/Castle Ravenloft.md',
  [JOURNAL_UUID]: 'AI Tool/Foundry/Journals/Barovia.md',
  [ITEM_UUID]: 'AI Tool/Foundry/Items/Sun Blade.md',
};
const PAGE_PATHS: Record<string, string> = {
  [PAGE1_UUID]: 'AI Tool/Foundry/Journals/Barovia/Village.md',
  [PAGE2_UUID]: 'AI Tool/Foundry/Journals/Barovia/Vallaki.md',
};

interface CtxOptions {
  notes?: Record<string, string>;
  pages?: Record<string, string>;
  targets?: Record<string, LinkTarget>;
  revealed?: string[];
  stats?: Record<string, string>;
  prep?: Record<string, string>;
  openBase?: string;
  findByName?: LinkContext['findByName'];
}

function makeCtx(options: CtxOptions = {}): MirrorRenderContext {
  const notes = options.notes ?? PATHS;
  const pages = options.pages ?? PAGE_PATHS;
  const targets = options.targets ?? {};
  const stats = options.stats ?? { [PC_UUID]: 'AI Tool/Stats/PCs/Test Hero.md' };
  const prep = options.prep ?? { [NPC_UUID]: 'Prep/NPCs/Wolf.md' };
  const revealed = new Set(options.revealed ?? [PAGE2_UUID]);
  return {
    openBase: options.openBase ?? OPEN,
    notePath: uuid => notes[uuid] ?? null,
    pageNotePath: uuid => pages[uuid] ?? null,
    resolve: (uuid): LinkTarget | null => {
      const target = targets[uuid];
      if (target) return target;
      const notePath = notes[uuid] ?? pages[uuid];
      return notePath === undefined ? null : { notePath, name: null };
    },
    ...(options.findByName ? { findByName: options.findByName } : {}),
    revealedPageUuids: revealed,
    statsNotePath: uuid => stats[uuid] ?? null,
    prepNotePath: uuid => prep[uuid] ?? null,
  };
}

function baseFields(uuid: string, name: string): Omit<ExportEntryBase, 'kind'> {
  return {
    uuid,
    id: uuid.slice(-16),
    name,
    folder: null,
    created: 1,
    modified: MODIFIED,
    sig: 'sig-1',
    playerAccess: 'none',
    playerVisible: false,
    rules: null,
  };
}

function pc(over: Partial<ExportActorEntry> = {}): ExportActorEntry {
  return {
    ...baseFields(PC_UUID, 'Test Hero'),
    kind: 'actor',
    actorType: 'character',
    pc: true,
    owners: ['Player'],
    hpMax: 28,
    ac: 18,
    size: 'med',
    alignment: 'neutral good',
    disposition: 'friendly',
    tokenName: 'Test Hero',
    playerName: 'Test Hero',
    level: 3,
    classes: [{ name: 'Fighter', levels: 3, subclass: 'Champion' }],
    species: 'Human',
    background: 'Soldier',
    cr: null,
    creatureType: null,
    sourceBook: null,
    features: [
      { name: 'Second Wind', type: 'feat' },
      { name: 'Action Surge', type: 'feat' },
      { name: 'Fighter', type: 'class' },
      { name: 'Human', type: 'race' },
      { name: 'Soldier', type: 'background' },
    ],
    notableItems: [
      { name: 'Sun Blade', sourceUuid: ITEM_UUID },
      { name: 'Ring of Warmth', sourceUuid: null },
    ],
    folder: { id: 'f1', path: ['Party'] },
    playerAccess: 'owner',
    playerVisible: true,
    rules: '2024',
    ...over,
  };
}

function npc(over: Partial<ExportActorEntry> = {}): ExportActorEntry {
  return {
    ...baseFields(NPC_UUID, 'Wolf'),
    kind: 'actor',
    actorType: 'npc',
    pc: false,
    owners: [],
    hpMax: 11,
    ac: 13,
    size: 'med',
    alignment: 'unaligned',
    disposition: 'hostile',
    tokenName: 'Wolf',
    playerName: 'Wolf',
    level: null,
    classes: [],
    species: null,
    background: null,
    cr: 0.25,
    creatureType: 'beast',
    sourceBook: 'MM 2014',
    features: [
      { name: 'Pack Tactics', type: 'feat' },
      { name: 'Bite', type: 'weapon' },
      { name: 'Keen Hearing and Smell', type: 'feat' },
    ],
    notableItems: [],
    rules: '2014',
    ...over,
  };
}

function scene(over: Partial<ExportSceneEntry> = {}): ExportSceneEntry {
  return {
    ...baseFields(SCENE_UUID, 'Castle Ravenloft'),
    kind: 'scene',
    navName: null,
    navigation: true,
    journal: { uuid: JOURNAL_UUID, pageUuid: PAGE1_UUID },
    pins: [
      { label: 'The crypt', entryUuid: JOURNAL_UUID, pageUuid: PAGE1_UUID },
      { label: null, entryUuid: `JournalEntry.${fid('gone')}`, pageUuid: null },
      { label: 'Unlinked note', entryUuid: null, pageUuid: null },
    ],
    ...over,
  };
}

function page(uuid: string, over: Partial<ExportPageEntry> = {}): ExportPageEntry {
  return {
    uuid,
    id: uuid.slice(-16),
    name: 'A page',
    type: 'text',
    category: null,
    sort: 100,
    modified: MODIFIED,
    playerAccess: 'none',
    playerVisible: false,
    ...over,
  };
}

function journal(over: Partial<ExportJournalEntry> = {}): ExportJournalEntry {
  return {
    ...baseFields(JOURNAL_UUID, 'Barovia'),
    kind: 'journal',
    categories: [
      { id: 'cat1', name: 'Places', sort: 20 },
      { id: 'cat2', name: 'People', sort: 10 },
    ],
    textIncluded: true,
    pages: [
      page(PAGE1_UUID, {
        name: 'Village',
        category: 'cat1',
        sort: 100,
        playerAccess: 'observer',
        playerVisible: true,
        text: { format: 'html', content: '<p>Mist and fog.</p>', truncated: false },
      }),
      page(PAGE2_UUID, {
        name: 'Vallaki',
        category: 'cat1',
        sort: 200,
        text: { format: 'markdown', content: 'The **festival** never ends.', truncated: false },
      }),
      page(PAGE3_UUID, { name: 'Map', type: 'image', category: 'cat2', sort: 300 }),
      page(PAGE4_UUID, { name: 'Long tale', sort: 400, text: null, textOmitted: 'budget' }),
    ],
    pagesTotal: 4,
    ...over,
  };
}

function item(over: Partial<ExportItemEntry> = {}): ExportItemEntry {
  return {
    ...baseFields(ITEM_UUID, 'Sun Blade'),
    kind: 'item',
    itemType: 'weapon',
    rarity: 'rare',
    attunement: 'required',
    magical: true,
    identified: true,
    playerName: 'Sun Blade',
    holders: [
      { uuid: PC_UUID, name: 'Test Hero', match: 'source' },
      { uuid: NPC_UUID, name: 'Wolf', match: 'name' },
      { uuid: `Actor.${fid('ghost')}`, name: 'Ghost', match: 'name' },
    ],
    rules: '2024',
    ...over,
  };
}

function only(notes: RenderedNote[]): string {
  expect(notes).toHaveLength(1);
  return notes[0]?.text ?? '';
}

/** The journal index note (the first note of a journal render). */
function renderIndex(entry: ExportJournalEntry, ctx: MirrorRenderContext = makeCtx()): string {
  return renderMirrorNote(W, entry, ctx)[0]?.text ?? '';
}

function render(entry: ExportEntry, ctx: MirrorRenderContext = makeCtx()): string {
  return only(renderMirrorNote(W, entry, ctx));
}

/** The property lines and the body lines of a rendered note. */
function split(text: string): { head: string[]; body: string[] } {
  const lines = text.split('\n');
  expect(lines[0]).toBe('---');
  const end = lines.indexOf('---', 1);
  expect(end).toBeGreaterThan(0);
  return { head: lines.slice(1, end), body: lines.slice(end + 1) };
}

function propertyKeys(text: string): string[] {
  return split(text)
    .head.filter(line => /^[a-z_]+:/.test(line))
    .map(line => line.slice(0, line.indexOf(':')));
}

const HEAD = ['type', 'fvtt_world', 'fvtt_uuid', 'fvtt_type', 'name', 'folder'];
const TAIL = [
  'aliases',
  'fvtt_modified',
  'fvtt_sig',
  'player_access',
  'player_visible',
  'rules',
  'schema',
  'tags',
  'generated_by',
  'generated_hash',
];
const OWN: Record<MirrorNoteType, string[]> = {
  pc: ['player', 'class', 'level', 'species', 'background', 'hp_max', 'ac', 'stats', 'prep'],
  npc: [
    'cr',
    'creature_type',
    'size',
    'alignment',
    'disposition',
    'token_name',
    'player_name',
    'hp_max',
    'ac',
    'source_book',
    'prep',
  ],
  scene: ['nav_name', 'player_name', 'navigation', 'journal', 'pins'],
  journal: ['pages', 'pages_player_visible', 'pages_revealed', 'text_mirrored', 'categories'],
  'journal-page': ['fvtt_journal', 'journal', 'page_type', 'revealed', 'sort'],
  'story-item': [
    'item_type',
    'rarity',
    'attunement',
    'magical',
    'identified',
    'player_name',
    'holders',
  ],
};
const orderFor = (type: MirrorNoteType): string[] => [
  ...HEAD,
  ...OWN[type],
  // Page notes carry no fvtt_sig (reconcile compares top-level documents only).
  ...TAIL.filter(key => type !== 'journal-page' || key !== 'fvtt_sig'),
];

// ---------------------------------------------------------------------------
// mirrorNoteType
// ---------------------------------------------------------------------------

describe('mirrorNoteType', () => {
  it('maps every export kind to a note type', () => {
    expect(mirrorNoteType(pc())).toBe('pc');
    expect(mirrorNoteType(npc())).toBe('npc');
    expect(mirrorNoteType(scene())).toBe('scene');
    expect(mirrorNoteType(journal())).toBe('journal');
    expect(mirrorNoteType(item())).toBe('story-item');
  });

  it('follows hasPlayerOwner, not the actor type', () => {
    expect(mirrorNoteType(npc({ pc: true, owners: ['Player'] }))).toBe('pc');
    expect(mirrorNoteType(pc({ pc: false, owners: [] }))).toBe('npc');
  });
});

// ---------------------------------------------------------------------------
// Notes: one snapshot per kind
// ---------------------------------------------------------------------------

describe('renderMirrorNote snapshots', () => {
  it('PC', () => {
    expect(render(pc())).toMatchInlineSnapshot(`
      "---
      type: "pc"
      fvtt_world: "strahd-test"
      fvtt_uuid: "Actor.pc10000000000000"
      fvtt_type: "Actor"
      name: "Test Hero"
      folder: "Party"
      player:
        - "Player"
      class: "Fighter 3"
      level: 3
      species: "Human"
      background: "Soldier"
      hp_max: 28
      ac: 18
      stats: "[[Campaigns/strahd-test/AI Tool/Stats/PCs/Test Hero|Test Hero stats]]"
      prep: null
      aliases:
        - "Test Hero"
      fvtt_modified: "2026-09-29T10:30:00.000Z"
      fvtt_sig: "sig-1"
      player_access: "owner"
      player_visible: true
      rules: "2024"
      schema: 1
      tags:
        - "campaign/strahd-test"
        - "pc"
      generated_by: "foundry-ai-tool"
      generated_hash: "4ef708ae590b6445"
      ---
      # Test Hero

      > [!info] Mirrored from Foundry by the AI Tool
      > The AI Tool rewrites this note when the document changes in Foundry. If you edit it here, the tool stops updating it and lists it in \`AI Tool/Foundry/_status.md\`. Write your own notes in \`Prep/\`.

      [Open in Foundry](http://localhost:3000/open?uuid=Actor.pc10000000000000)

      Played by Player.

      ## Classes

      - Fighter 3 (Champion)

      ## Notable items

      - Ring of Warmth
      - [Sun Blade](../Items/Sun%20Blade.md)

      ## Features

      ### Feat

      - Action Surge
      - Second Wind

      ## Related notes

      - [Stats](../../Stats/PCs/Test%20Hero.md)
      "
    `);
  });

  it('NPC', () => {
    expect(render(npc())).toMatchInlineSnapshot(`
      "---
      type: "npc"
      fvtt_world: "strahd-test"
      fvtt_uuid: "Actor.npc1000000000000"
      fvtt_type: "Actor"
      name: "Wolf"
      folder: null
      cr: 0.25
      creature_type: "beast"
      size: "med"
      alignment: "unaligned"
      disposition: "hostile"
      token_name: "Wolf"
      player_name: "Wolf"
      hp_max: 11
      ac: 13
      source_book: "MM 2014"
      prep: "[[Campaigns/strahd-test/Prep/NPCs/Wolf|Wolf prep]]"
      aliases:
        - "Wolf"
      fvtt_modified: "2026-09-29T10:30:00.000Z"
      fvtt_sig: "sig-1"
      player_access: "none"
      player_visible: false
      rules: "2014"
      schema: 1
      tags:
        - "campaign/strahd-test"
        - "npc"
      generated_by: "foundry-ai-tool"
      generated_hash: "2a0303ae81b95e5b"
      ---
      # Wolf

      > [!info] Mirrored from Foundry by the AI Tool
      > The AI Tool rewrites this note when the document changes in Foundry. If you edit it here, the tool stops updating it and lists it in \`AI Tool/Foundry/_status.md\`. Write your own notes in \`Prep/\`.

      [Open in Foundry](http://localhost:3000/open?uuid=Actor.npc1000000000000)

      Players see this creature as: **Wolf**.

      ## Features

      ### Feat

      - Keen Hearing and Smell
      - Pack Tactics

      ### Weapon

      - Bite

      ## Related notes

      - [Prep](../../../Prep/NPCs/Wolf.md)
      "
    `);
  });

  it('scene', () => {
    expect(render(scene())).toMatchInlineSnapshot(`
      "---
      type: "scene"
      fvtt_world: "strahd-test"
      fvtt_uuid: "Scene.scene10000000000"
      fvtt_type: "Scene"
      name: "Castle Ravenloft"
      folder: null
      nav_name: null
      player_name: "Castle Ravenloft"
      navigation: true
      journal: "[[Campaigns/strahd-test/AI Tool/Foundry/Journals/Barovia|JournalEntry.jr10000000000000]]"
      pins: 3
      aliases:
        - "Castle Ravenloft"
      fvtt_modified: "2026-09-29T10:30:00.000Z"
      fvtt_sig: "sig-1"
      player_access: "none"
      player_visible: false
      rules: null
      schema: 1
      tags:
        - "campaign/strahd-test"
        - "scene"
      generated_by: "foundry-ai-tool"
      generated_hash: "142ae8f6252ff073"
      ---
      # Castle Ravenloft

      > [!info] Mirrored from Foundry by the AI Tool
      > The AI Tool rewrites this note when the document changes in Foundry. If you edit it here, the tool stops updating it and lists it in \`AI Tool/Foundry/_status.md\`. Write your own notes in \`Prep/\`.

      [Open in Foundry](http://localhost:3000/open?uuid=Scene.scene10000000000)

      The active scene is always visible to players, whatever the navigation settings say.

      > [!warning] Players see the true name
      > This scene is in the navigation bar and has no navigation name, so players see "Castle Ravenloft" there.

      ## Journal

      - [JournalEntry.jr10000000000000.JournalEntryPage.pg10000000000000](../Journals/Barovia/Village.md)

      ## Map pins

      - [The crypt](../Journals/Barovia/Village.md)
      - JournalEntry.gone000000000000 \`JournalEntry.gone000000000000 (not found)\`
      - Unlinked note
      "
    `);
  });

  it('journal index and page notes', () => {
    const notes = renderMirrorNote(W, journal(), makeCtx());
    expect(notes.map(n => n.path)).toMatchInlineSnapshot(`
      [
        "AI Tool/Foundry/Journals/Barovia.md",
        "AI Tool/Foundry/Journals/Barovia/Village.md",
        "AI Tool/Foundry/Journals/Barovia/Vallaki.md",
      ]
    `);
    expect(notes[0]?.text).toMatchInlineSnapshot(`
      "---
      type: "journal"
      fvtt_world: "strahd-test"
      fvtt_uuid: "JournalEntry.jr10000000000000"
      fvtt_type: "JournalEntry"
      name: "Barovia"
      folder: null
      pages: 4
      pages_player_visible: 1
      pages_revealed: 1
      text_mirrored: true
      categories:
        - "People"
        - "Places"
      aliases:
        - "Barovia"
      fvtt_modified: "2026-09-29T10:30:00.000Z"
      fvtt_sig: "sig-1"
      player_access: "none"
      player_visible: false
      rules: null
      schema: 1
      tags:
        - "campaign/strahd-test"
        - "journal"
      generated_by: "foundry-ai-tool"
      generated_hash: "215bf41f51cae1dd"
      ---
      # Barovia

      > [!info] Mirrored from Foundry by the AI Tool
      > The AI Tool rewrites this note when the document changes in Foundry. If you edit it here, the tool stops updating it and lists it in \`AI Tool/Foundry/_status.md\`. Write your own notes in \`Prep/\`.

      [Open in Foundry](http://localhost:3000/open?uuid=JournalEntry.jr10000000000000)

      ## Pages

      ### People

      - Map (image, access none) ^p-pg30000000000000

      ### Places

      - [Village](Barovia/Village.md) (text, access observer, players can open) ^p-pg10000000000000
      - [Vallaki](Barovia/Vallaki.md) (text, access none, revealed) ^p-pg20000000000000

      ### No category

      - Long tale (text, access none, text over budget) ^p-pg40000000000000
      "
    `);
    expect(notes[1]?.text).toMatchInlineSnapshot(`
      "---
      type: "journal-page"
      fvtt_world: "strahd-test"
      fvtt_uuid: "JournalEntry.jr10000000000000.JournalEntryPage.pg10000000000000"
      fvtt_type: "JournalEntryPage"
      name: "Village"
      folder: null
      fvtt_journal: "JournalEntry.jr10000000000000"
      journal: "[[Campaigns/strahd-test/AI Tool/Foundry/Journals/Barovia|Barovia]]"
      page_type: "text"
      revealed: false
      sort: 100
      aliases:
        - "Village"
      fvtt_modified: "2026-09-29T10:30:00.000Z"
      player_access: "observer"
      player_visible: true
      rules: null
      schema: 1
      tags:
        - "campaign/strahd-test"
        - "journal-page"
      generated_by: "foundry-ai-tool"
      generated_hash: "3707fa135eed89ea"
      ---
      # Village

      > [!info] Mirrored from Foundry by the AI Tool
      > The AI Tool rewrites this note when the document changes in Foundry. If you edit it here, the tool stops updating it and lists it in \`AI Tool/Foundry/_status.md\`. Write your own notes in \`Prep/\`.

      [Open in Foundry](http://localhost:3000/open?uuid=JournalEntry.jr10000000000000.JournalEntryPage.pg10000000000000)

      Back to journal: [Barovia](../Barovia.md#^p-pg10000000000000)

      [html AI Tool/Foundry/Journals/Barovia/Village.md] <p>Mist and fog.</p>
      "
    `);
    expect(notes[2]?.text).toMatchInlineSnapshot(`
      "---
      type: "journal-page"
      fvtt_world: "strahd-test"
      fvtt_uuid: "JournalEntry.jr10000000000000.JournalEntryPage.pg20000000000000"
      fvtt_type: "JournalEntryPage"
      name: "Vallaki"
      folder: null
      fvtt_journal: "JournalEntry.jr10000000000000"
      journal: "[[Campaigns/strahd-test/AI Tool/Foundry/Journals/Barovia|Barovia]]"
      page_type: "text"
      revealed: true
      sort: 200
      aliases:
        - "Vallaki"
      fvtt_modified: "2026-09-29T10:30:00.000Z"
      player_access: "none"
      player_visible: false
      rules: null
      schema: 1
      tags:
        - "campaign/strahd-test"
        - "journal-page"
      generated_by: "foundry-ai-tool"
      generated_hash: "1df2215d2956ca07"
      ---
      # Vallaki

      > [!info] Mirrored from Foundry by the AI Tool
      > The AI Tool rewrites this note when the document changes in Foundry. If you edit it here, the tool stops updating it and lists it in \`AI Tool/Foundry/_status.md\`. Write your own notes in \`Prep/\`.

      [Open in Foundry](http://localhost:3000/open?uuid=JournalEntry.jr10000000000000.JournalEntryPage.pg20000000000000)

      Back to journal: [Barovia](../Barovia.md#^p-pg20000000000000)

      [markdown AI Tool/Foundry/Journals/Barovia/Vallaki.md] The **festival** never ends.
      "
    `);
  });

  it('story item', () => {
    expect(render(item())).toMatchInlineSnapshot(`
      "---
      type: "story-item"
      fvtt_world: "strahd-test"
      fvtt_uuid: "Item.item100000000000"
      fvtt_type: "Item"
      name: "Sun Blade"
      folder: null
      item_type: "weapon"
      rarity: "rare"
      attunement: "required"
      magical: true
      identified: true
      player_name: "Sun Blade"
      holders:
        - "[[Campaigns/strahd-test/AI Tool/Foundry/PCs/Test Hero|Test Hero]]"
        - "[[Campaigns/strahd-test/AI Tool/Foundry/NPCs/Wolf|Wolf]]"
        - "Ghost"
      aliases:
        - "Sun Blade"
      fvtt_modified: "2026-09-29T10:30:00.000Z"
      fvtt_sig: "sig-1"
      player_access: "none"
      player_visible: false
      rules: "2024"
      schema: 1
      tags:
        - "campaign/strahd-test"
        - "story-item"
      generated_by: "foundry-ai-tool"
      generated_hash: "81dea794778b7be3"
      ---
      # Sun Blade

      > [!info] Mirrored from Foundry by the AI Tool
      > The AI Tool rewrites this note when the document changes in Foundry. If you edit it here, the tool stops updating it and lists it in \`AI Tool/Foundry/_status.md\`. Write your own notes in \`Prep/\`.

      [Open in Foundry](http://localhost:3000/open?uuid=Item.item100000000000)

      ## Held by

      - [Test Hero](../PCs/Test%20Hero.md) (same source item)
      - [Wolf](../NPCs/Wolf.md) (same name)
      - Ghost (same name)
      "
    `);
  });
});

describe('renderMirrorNote behavior', () => {
  it('returns nothing when the context has no path for the entry', () => {
    expect(renderMirrorNote(W, pc(), makeCtx({ notes: {} }))).toEqual([]);
  });

  it('emits the properties in the documented order for every note type', () => {
    expect(propertyKeys(render(pc()))).toEqual(orderFor('pc'));
    expect(propertyKeys(render(npc()))).toEqual(orderFor('npc'));
    expect(propertyKeys(render(scene()))).toEqual(orderFor('scene'));
    const notes = renderMirrorNote(W, journal(), makeCtx());
    expect(propertyKeys(notes[0]?.text ?? '')).toEqual(orderFor('journal'));
    expect(propertyKeys(notes[1]?.text ?? '')).toEqual(orderFor('journal-page'));
    expect(propertyKeys(render(item()))).toEqual(orderFor('story-item'));
  });

  it('writes the tags, hash placeholder-free marker and schema the scan needs', () => {
    const text = render(pc());
    expect(text).toContain('type: "pc"');
    expect(text).toContain(`fvtt_uuid: "${PC_UUID}"`);
    expect(text).toContain('schema: 1');
    expect(text).toContain(`  - "campaign/${W}"`);
    expect(text).toContain('generated_by: "foundry-ai-tool"');
    expect(text).toMatch(/^generated_hash: "[0-9a-f]{16}"$/m);
    expect(text).toContain('fvtt_modified: "2026-09-29T10:30:00.000Z"');
    expect(text).toContain('fvtt_sig: "sig-1"');
  });

  it('is deterministic and owned by the O2 ownership check', () => {
    const entries: ExportEntry[] = [pc(), npc(), scene(), journal(), item()];
    for (const entry of entries) {
      for (const note of renderMirrorNote(W, entry, makeCtx())) {
        expect(checkMarkdownOwnership(note.text)).toEqual({ owned: true, legacy: false });
        expect(renderMirrorNote(W, entry, makeCtx()).find(n => n.path === note.path)?.text).toBe(
          note.text
        );
        expect(checkMarkdownOwnership(note.text.replace('# ', '# Edited '))).toEqual({
          owned: false,
          reason: 'edited in Obsidian',
        });
      }
    }
  });

  it('shows player access and visibility as advisory properties', () => {
    const seen = render(npc({ playerAccess: 'observer', playerVisible: true }));
    expect(seen).toContain('player_access: "observer"');
    expect(seen).toContain('player_visible: true');
    const hidden = render(npc());
    expect(hidden).toContain('player_access: "none"');
    expect(hidden).toContain('player_visible: false');
  });

  it('turns off Open in Foundry links when the address is not usable', () => {
    for (const openBase of ['', 'http://bad host', 'http://a/(b)', 'http://a/<b>']) {
      const text = render(npc(), makeCtx({ openBase }));
      expect(text).toContain('Open in Foundry is off');
      expect(text).not.toContain('](http');
    }
    const on = render(npc(), makeCtx({ openBase: 'https://gm.example.com' }));
    expect(on).toContain(`[Open in Foundry](https://gm.example.com/open?uuid=${NPC_UUID})`);
  });

  it('links notable items to their mirror notes and hides class-like features', () => {
    const text = render(pc());
    expect(text).toContain('- [Sun Blade](../Items/Sun%20Blade.md)');
    expect(text).toContain('- Ring of Warmth');
    expect(text).not.toContain('### Class');
    expect(text).not.toContain('### Race');
    expect(text).toContain('### Feat');
    expect(text).toContain('- [Stats](../../Stats/PCs/Test%20Hero.md)');
  });

  it('leaves the stats and prep properties null without those notes', () => {
    const text = render(pc(), makeCtx({ stats: {}, prep: {} }));
    expect(text).toContain('stats: null');
    expect(text).toContain('prep: null');
    expect(text).not.toContain('## Related notes');
  });

  it('uses wikilinks in properties only for notes that exist', () => {
    const text = render(pc());
    expect(text).toContain(
      'stats: "[[Campaigns/strahd-test/AI Tool/Stats/PCs/Test Hero|Test Hero stats]]"'
    );
    expect(text).toContain('prep: null');
    const wolf = render(npc());
    expect(wolf).toContain('prep: "[[Campaigns/strahd-test/Prep/NPCs/Wolf|Wolf prep]]"');
  });

  it('falls back to plain text for a wikilink target the syntax cannot carry', () => {
    const text = render(pc(), makeCtx({ stats: { [PC_UUID]: 'AI Tool/Stats/PCs/Odd [x].md' } }));
    expect(text).toContain('stats: "Test Hero stats"');
    expect(text).not.toContain('Odd [x]');
  });

  it('renders a player-owned npc-type actor as a PC and a character without owners as an NPC', () => {
    const asPc = render(npc({ pc: true, owners: ['Player'] }));
    expect(asPc).toContain('type: "pc"');
    const asNpc = render(pc({ pc: false, owners: [] }), makeCtx());
    expect(asNpc).toContain('type: "npc"');
    expect(asNpc).toContain('## Classes');
  });

  it('rejects a bad world id or uuid', () => {
    expect(() => renderMirrorNote('../escape', pc(), makeCtx())).toThrow(/world id/);
    expect(() => renderMirrorNote('', pc(), makeCtx())).toThrow(/world id/);
    expect(() => renderMirrorNote(W, pc({ uuid: 'not a uuid' }), makeCtx())).toThrow(/uuid/);
  });
});

describe('scene notes', () => {
  it('warns when the true name shows in the navigation bar', () => {
    expect(render(scene())).toContain('[!warning] Players see the true name');
    expect(render(scene({ navName: 'The Keep' }))).not.toContain('[!warning]');
    expect(render(scene({ navigation: false }))).not.toContain('[!warning]');
  });

  it('gives the name players see', () => {
    expect(render(scene({ navName: 'The Keep' }))).toContain('player_name: "The Keep"');
    expect(render(scene())).toContain('player_name: "Castle Ravenloft"');
    expect(render(scene())).toContain('nav_name: null');
  });

  it('marks pins with a missing document as not found and unmirrored ones with their uuid', () => {
    const ghost = `JournalEntry.${fid('other')}`;
    const text = render(
      scene({
        journal: { uuid: ghost, pageUuid: null },
        pins: [{ label: 'Elsewhere', entryUuid: ghost, pageUuid: null }],
      }),
      makeCtx({ targets: { [ghost]: { notePath: null, name: 'Elsewhere journal' } } })
    );
    expect(text).toContain(`Elsewhere \`${ghost}\``);
    expect(text).toContain(`journal: "${ghost}"`);
    const gone = render(scene(), makeCtx());
    expect(gone).toContain(`\`JournalEntry.${fid('gone')} (not found)\``);
  });

  it('links the journal property and pins to the page block when the resolver gives one', () => {
    const text = render(
      scene(),
      makeCtx({
        targets: {
          [PAGE1_UUID]: {
            notePath: PATHS[JOURNAL_UUID] ?? null,
            name: 'Village',
            blockId: 'p-pg1',
          },
          [JOURNAL_UUID]: { notePath: PATHS[JOURNAL_UUID] ?? null, name: 'Barovia' },
        },
      })
    );
    expect(text).toContain('[Village](../Journals/Barovia.md#^p-pg1)');
    expect(text).toContain('[The crypt](../Journals/Barovia.md#^p-pg1)');
    expect(text).toContain(
      'journal: "[[Campaigns/strahd-test/AI Tool/Foundry/Journals/Barovia|Barovia]]"'
    );
  });

  it('ignores a block id that is not a valid Obsidian block id', () => {
    const text = render(
      scene(),
      makeCtx({
        targets: {
          [PAGE1_UUID]: {
            notePath: PATHS[JOURNAL_UUID] ?? null,
            name: 'Village',
            blockId: 'x y^z]',
          },
        },
      })
    );
    expect(text).toContain('[Village](../Journals/Barovia.md)');
    expect(text).not.toContain('x y^z');
  });
});

describe('journal notes', () => {
  it('groups pages by category in category order and lists pages without a category last', () => {
    const text = renderIndex(journal(), makeCtx());
    const people = text.indexOf('### People');
    const places = text.indexOf('### Places');
    const none = text.indexOf('### No category');
    expect(people).toBeGreaterThan(0);
    expect(places).toBeGreaterThan(people);
    expect(none).toBeGreaterThan(places);
  });

  it('lists pages flat when there are no categories', () => {
    const text = renderIndex(
      journal({
        categories: [],
        pages: (journal().pages ?? []).map(p => ({ ...p, category: null })),
      }),
      makeCtx()
    );
    expect(text).not.toContain('###');
    expect(text).toContain('\n## Pages\n');
    expect(text).toContain('categories: []');
  });

  it('gives every page line a block id that page links can jump to', () => {
    const notes = renderMirrorNote(W, journal(), makeCtx());
    expect(notes[0]?.text).toContain(` ^p-${fid('pg1')}`);
    expect(notes[1]?.text).toContain(`Back to journal: [Barovia](../Barovia.md#^p-${fid('pg1')})`);
  });

  it('counts pages, player-visible pages and revealed pages', () => {
    const text = renderIndex(journal(), makeCtx());
    expect(text).toContain('pages: 4');
    expect(text).toContain('pages_player_visible: 1');
    expect(text).toContain('pages_revealed: 1');
    expect(text).toContain('text_mirrored: true');
    expect(renderIndex(journal({ textIncluded: false }), makeCtx())).toContain(
      'text_mirrored: false'
    );
  });

  it('notes a capped page list', () => {
    const text = renderIndex(journal({ pagesTotal: 1500 }), makeCtx());
    expect(text).toContain('Showing the first 4 of 1500 pages.');
  });

  it('writes page notes only for opted-in journals, pages with text and an allocated path', () => {
    const off = renderMirrorNote(W, journal({ textIncluded: false }), makeCtx());
    expect(off).toHaveLength(1);
    const noPaths = renderMirrorNote(W, journal(), makeCtx({ pages: {} }));
    expect(noPaths).toHaveLength(1);
    expect(noPaths[0]?.text).not.toContain('Village](');
    const one = renderMirrorNote(
      W,
      journal(),
      makeCtx({ pages: { [PAGE2_UUID]: 'AI Tool/Foundry/Journals/Barovia/Vallaki.md' } })
    );
    expect(one.map(n => n.path)).toEqual([
      'AI Tool/Foundry/Journals/Barovia.md',
      'AI Tool/Foundry/Journals/Barovia/Vallaki.md',
    ]);
  });

  it('runs page text through the converters with the link context of the page note', () => {
    const findByName: LinkContext['findByName'] = () => null;
    const notes = renderMirrorNote(W, journal(), makeCtx({ findByName }));
    expect(converter.html).toHaveBeenCalledTimes(1);
    expect(converter.markdown).toHaveBeenCalledTimes(1);
    const [html, htmlCtx] = converter.html.mock.calls[0] ?? [];
    expect(html).toBe('<p>Mist and fog.</p>');
    expect(htmlCtx?.pageUuid).toBe(PAGE1_UUID);
    expect(htmlCtx?.fromPath).toBe('AI Tool/Foundry/Journals/Barovia/Village.md');
    expect(htmlCtx?.openBase).toBe(OPEN);
    expect(htmlCtx && 'findByName' in htmlCtx).toBe(true);
    expect(notes[1]?.text).toContain(
      '[html AI Tool/Foundry/Journals/Barovia/Village.md] <p>Mist and fog.</p>'
    );
    expect(notes[2]?.text).toContain(
      '[markdown AI Tool/Foundry/Journals/Barovia/Vallaki.md] The **festival** never ends.'
    );
    renderMirrorNote(W, journal(), makeCtx());
    const [, plain] = converter.html.mock.calls[1] ?? [];
    expect(plain && 'findByName' in plain).toBe(false);
  });

  it('marks a page with no text and warns about a cut text', () => {
    converter.html.mockReturnValue('   \n');
    const empty = renderMirrorNote(W, journal(), makeCtx());
    expect(empty[1]?.text).toContain('(This page has no text.)');
    converter.html.mockReturnValue('kept');
    const cut = journal();
    const first = cut.pages[0];
    if (first?.text) first.text.truncated = true;
    const notes = renderMirrorNote(W, cut, makeCtx());
    expect(notes[1]?.text).toContain('[!warning] Text cut');
    expect(notes[1]?.text).toContain('longer than 512 KB');
    expect(notes[2]?.text).not.toContain('Text cut');
  });

  it('lets a converter error reach the caller', () => {
    converter.markdown.mockImplementation(() => {
      throw new Error('bad markup');
    });
    expect(() => renderMirrorNote(W, journal(), makeCtx())).toThrow('bad markup');
  });

  it('gives a page note no signature, its own access, and the journal link', () => {
    const notes = renderMirrorNote(W, journal({ sig: 'journal-sig' }), makeCtx());
    const text = notes[1]?.text ?? '';
    expect(text).toContain('fvtt_type: "JournalEntryPage"');
    expect(text).toContain(`fvtt_journal: "${JOURNAL_UUID}"`);
    expect(text).not.toContain('fvtt_sig');
    expect(text).toContain('player_access: "observer"');
    expect(text).toContain('player_visible: true');
    expect(text).toContain('rules: null');
    expect(text).toContain(
      'journal: "[[Campaigns/strahd-test/AI Tool/Foundry/Journals/Barovia|Barovia]]"'
    );
    expect(notes[2]?.text).toContain('revealed: true');
    expect(text).toContain('revealed: false');
  });
});

describe('story item notes', () => {
  it('links holders that have notes and names the rest', () => {
    const text = render(item());
    expect(text).toContain('- [Test Hero](../PCs/Test%20Hero.md) (same source item)');
    expect(text).toContain('- [Wolf](../NPCs/Wolf.md) (same name)');
    expect(text).toContain('- Ghost (same name)');
    expect(text).toContain(
      '  - "[[Campaigns/strahd-test/AI Tool/Foundry/PCs/Test Hero|Test Hero]]"'
    );
    expect(text).toContain('  - "Ghost"');
  });

  it('says so when nobody holds it', () => {
    const text = render(item({ holders: [] }));
    expect(text).toContain('holders: []');
    expect(text).toContain('- (none)');
  });
});

// ---------------------------------------------------------------------------
// Canary: hostile Foundry data stays inert
// ---------------------------------------------------------------------------

const WIKILINK_VALUE = /^\[\[Campaigns\/strahd-test\/[^[\]|#^]+(\|[^[\]|#^]*)?\]\]$/;

function assertInert(text: string): void {
  const { head, body } = split(text);
  expect(text).not.toContain('<%');
  expect(text).not.toContain('[[Secret|link]]');
  // Every property line is a key, a key with a scalar, or a quoted list item.
  for (const line of head) {
    expect(line).toMatch(/^(?:[a-z_]+:(?: .*)?| {2}- ".*")$/);
    if (line.includes('[[')) {
      const raw = line.replace(/^\s*- /, '').replace(/^[a-z_]+: /, '');
      const value: unknown = JSON.parse(raw);
      expect(value).toMatch(WIKILINK_VALUE);
    }
  }
  // The title is one H1 line, and nothing the data said became a heading, rule or property.
  expect(body[0]).toMatch(/^# \S/);
  expect(body.filter(line => line === '---')).toEqual([]);
  expect(body.filter(line => /^# /.test(line))).toHaveLength(1);
  expect(body).not.toContain('# Injected heading');
  expect(body).not.toContain('Injected: true');
  // A `]` that ends a link label must be escaped when hostile text supplies it.
  expect(body.some(line => /(?<!\\)\]\(https:\/\/evil/.test(line))).toBe(false);
}

describe('hostile Foundry data', () => {
  const evilPin = 'x](https://evil.example) [y';

  it('keeps a PC inert in properties, title, lists and links', () => {
    const entry = pc({
      name: HOSTILE,
      owners: [HOSTILE],
      classes: [{ name: HOSTILE, levels: 3, subclass: HOSTILE }],
      species: HOSTILE,
      background: HOSTILE,
      folder: { id: 'f', path: [HOSTILE, 'a]] [[b'] },
      features: [{ name: HOSTILE, type: HOSTILE }],
      notableItems: [{ name: HOSTILE, sourceUuid: ITEM_UUID }],
    });
    const text = render(entry);
    assertInert(text);
    expect(text).toMatchInlineSnapshot(`
      "---
      type: "pc"
      fvtt_world: "strahd-test"
      fvtt_uuid: "Actor.pc10000000000000"
      fvtt_type: "Actor"
      name: "Evil &lt;%= tp.system.prompt() %> [ [Secret|link] ] #tag ^blk # Injected heading --- Injected: true"
      folder: "Evil &lt;%= tp.system.prompt() %> [ [Secret|link] ] #tag ^blk # Injected heading --- Injected: true/a] ] [ [b"
      player:
        - "Evil &lt;%= tp.system.prompt() %> [ [Secret|link] ] #tag ^blk # Injected heading --- Injected: true"
      class: "Evil &lt;%= tp.system.prompt() %> [ [Secret|link] ] #tag ^blk # Injected heading --- Injected: true 3"
      level: 3
      species: "Evil &lt;%= tp.system.prompt() %> [ [Secret|link] ] #tag ^blk # Injected heading --- Injected: true"
      background: "Evil &lt;%= tp.system.prompt() %> [ [Secret|link] ] #tag ^blk # Injected heading --- Injected: true"
      hp_max: 28
      ac: 18
      stats: "[[Campaigns/strahd-test/AI Tool/Stats/PCs/Test Hero|Evil &lt;%= tp.system.prompt() %> Secret link tag blk Injected heading --- Injected: true stats]]"
      prep: null
      aliases:
        - "Evil &lt;%= tp.system.prompt() %> [ [Secret|link] ] #tag ^blk # Injected heading --- Injected: true"
      fvtt_modified: "2026-09-29T10:30:00.000Z"
      fvtt_sig: "sig-1"
      player_access: "owner"
      player_visible: true
      rules: "2024"
      schema: 1
      tags:
        - "campaign/strahd-test"
        - "pc"
      generated_by: "foundry-ai-tool"
      generated_hash: "1b543ddb6facaae1"
      ---
      # Evil &lt;\\%\\= tp.system.prompt() \\%\\> \\[\\[Secret\\|link\\]\\] \\#tag \\^blk \\# Injected heading --- Injected: true

      > [!info] Mirrored from Foundry by the AI Tool
      > The AI Tool rewrites this note when the document changes in Foundry. If you edit it here, the tool stops updating it and lists it in \`AI Tool/Foundry/_status.md\`. Write your own notes in \`Prep/\`.

      [Open in Foundry](http://localhost:3000/open?uuid=Actor.pc10000000000000)

      Played by Evil &lt;\\%\\= tp.system.prompt() \\%\\> \\[\\[Secret\\|link\\]\\] \\#tag \\^blk \\# Injected heading --- Injected: true.

      ## Classes

      - Evil &lt;\\%\\= tp.system.prompt() \\%\\> \\[\\[Secret\\|link\\]\\] \\#tag \\^blk \\# Injected heading --- Injected: true 3 (Evil &lt;\\%\\= tp.system.prompt() \\%\\> \\[\\[Secret\\|link\\]\\] \\#tag \\^blk \\# Injected heading --- Injected: true)

      ## Notable items

      - [Evil &lt;\\%\\= tp.system.prompt() \\%\\> \\[\\[Secret\\|link\\]\\] \\#tag \\^blk \\# Injected heading --- Injected: true](../Items/Sun%20Blade.md)

      ## Features

      ### Evil &lt;\\%\\= tp.system.prompt() \\%\\> \\[\\[secret\\|link\\]\\] \\#tag \\^blk \\# injected heading --- injected: true

      - Evil &lt;\\%\\= tp.system.prompt() \\%\\> \\[\\[Secret\\|link\\]\\] \\#tag \\^blk \\# Injected heading --- Injected: true

      ## Related notes

      - [Stats](../../Stats/PCs/Test%20Hero.md)
      "
    `);
  });

  it('keeps an NPC inert', () => {
    const entry = npc({
      name: HOSTILE,
      playerName: HOSTILE,
      tokenName: HOSTILE,
      creatureType: HOSTILE,
      alignment: HOSTILE,
      sourceBook: HOSTILE,
      features: [{ name: HOSTILE, type: HOSTILE }],
    });
    assertInert(render(entry));
  });

  it('keeps a scene inert, including pins that try to close a link', () => {
    const entry = scene({
      name: HOSTILE,
      navName: HOSTILE,
      pins: [
        { label: evilPin, entryUuid: JOURNAL_UUID, pageUuid: PAGE1_UUID },
        { label: HOSTILE, entryUuid: 'weird`` `uuid', pageUuid: null },
      ],
    });
    const text = render(entry);
    assertInert(text);
    expect(text).toContain('x\\](https://evil.example) \\[y');
    expect(text).toContain('```weird`` `uuid (not found)```');
  });

  it('keeps journals, pages and categories inert', () => {
    const base = journal();
    const entry = journal({
      name: HOSTILE,
      categories: [{ id: 'cat1', name: HOSTILE, sort: 1 }],
      pages: (base.pages ?? []).map(p => ({
        ...p,
        name: HOSTILE,
        type: HOSTILE,
        category: 'cat1',
      })),
    });
    for (const note of renderMirrorNote(W, entry, makeCtx())) assertInert(note.text);
  });

  it('keeps a story item and its holders inert', () => {
    const entry = item({
      name: HOSTILE,
      itemType: HOSTILE,
      rarity: HOSTILE,
      playerName: HOSTILE,
      holders: [
        { uuid: PC_UUID, name: HOSTILE, match: 'source' },
        { uuid: `Actor.${fid('ghost')}`, name: HOSTILE, match: 'name' },
      ],
    });
    assertInert(render(entry));
  });

  it('does not let an odd path from the context break a property wikilink or a link', () => {
    // The pump allocates safe paths (mirror-paths); the renderer still does not trust them.
    const odd = 'AI Tool/Foundry/PCs/Odd ]] | # ^ (x).md';
    const text = render(item(), makeCtx({ notes: { ...PATHS, [PC_UUID]: odd } }));
    expect(text).toContain('- [Test Hero](../PCs/Odd%20%5D%5D%20%7C%20%23%20%5E%20%28x%29.md)');
    expect(text).toContain('  - "Test Hero"');
    expect(text).not.toContain('Odd ]]');
  });
});

// ---------------------------------------------------------------------------
// sameMirrorContent
// ---------------------------------------------------------------------------

describe('sameMirrorContent', () => {
  it('ignores fvtt_modified and the hash it changes', () => {
    const a = render(pc({ modified: MODIFIED }));
    const b = render(pc({ modified: MODIFIED + 60_000 }));
    expect(a).not.toBe(b);
    expect(sameMirrorContent(a, b)).toBe(true);
  });

  it('sees a change in properties or text', () => {
    const a = render(pc());
    expect(sameMirrorContent(a, render(pc({ hpMax: 40 })))).toBe(false);
    expect(sameMirrorContent(a, render(pc({ sig: 'sig-2' })))).toBe(false);
    expect(sameMirrorContent(a, render(pc({ features: [] })))).toBe(false);
    expect(sameMirrorContent(a, render(pc({ playerVisible: false })))).toBe(false);
  });

  it('compares only the property block, never the body', () => {
    const head = ['---', 'fvtt_modified: "a"', 'generated_hash: "1"', '---'];
    const withBody = (line: string): string => [...head, line, ''].join('\n');
    expect(sameMirrorContent(withBody('fvtt_modified: "1"'), withBody('fvtt_modified: "2"'))).toBe(
      false
    );
    expect(sameMirrorContent('no properties', 'no properties')).toBe(true);
    expect(sameMirrorContent('no properties', 'other text')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bases
// ---------------------------------------------------------------------------

function base(file: string): string {
  const found = renderMirrorBases(W).find(note => note.path === `AI Tool/Bases/${file}`);
  expect(found).toBeDefined();
  return found?.text ?? '';
}

describe('renderMirrorBases', () => {
  it('PCs.base', () => {
    expect(base('PCs.base')).toMatchInlineSnapshot(`
      "filters:
        and:
          - file.inFolder("Campaigns/strahd-test/AI Tool/Foundry")
          - file.hasTag("pc")
      views:
        - type: table
          name: PCs
          order:
            - file.name
            - player
            - class
            - level
            - species
            - background
            - hp_max
            - ac
            - player_access
          sort:
            - property: file.name
              direction: ASC
      "
    `);
  });

  it('NPCs.base', () => {
    expect(base('NPCs.base')).toMatchInlineSnapshot(`
      "filters:
        and:
          - file.inFolder("Campaigns/strahd-test/AI Tool/Foundry")
          - file.hasTag("npc")
      views:
        - type: table
          name: NPCs
          order:
            - file.name
            - cr
            - creature_type
            - disposition
            - player_name
            - player_visible
            - folder
          sort:
            - property: file.name
              direction: ASC
      "
    `);
  });

  it('Scenes.base', () => {
    expect(base('Scenes.base')).toMatchInlineSnapshot(`
      "filters:
        and:
          - file.inFolder("Campaigns/strahd-test/AI Tool/Foundry")
          - file.hasTag("scene")
      views:
        - type: table
          name: Scenes
          order:
            - file.name
            - nav_name
            - player_name
            - navigation
            - player_visible
            - folder
          sort:
            - property: file.name
              direction: ASC
      "
    `);
  });

  it('Journals.base', () => {
    expect(base('Journals.base')).toMatchInlineSnapshot(`
      "filters:
        and:
          - file.inFolder("Campaigns/strahd-test/AI Tool/Foundry")
          - file.hasTag("journal")
      views:
        - type: table
          name: Journals
          order:
            - file.name
            - pages
            - pages_player_visible
            - pages_revealed
            - text_mirrored
            - folder
          sort:
            - property: file.name
              direction: ASC
      "
    `);
  });

  it('Story items.base', () => {
    expect(base('Story items.base')).toMatchInlineSnapshot(`
      "filters:
        and:
          - file.inFolder("Campaigns/strahd-test/AI Tool/Foundry")
          - file.hasTag("story-item")
      views:
        - type: table
          name: Story items
          order:
            - file.name
            - item_type
            - rarity
            - magical
            - identified
            - holders
            - player_visible
          sort:
            - property: file.name
              direction: ASC
      "
    `);
  });

  it('Player visible.base', () => {
    expect(base('Player visible.base')).toMatchInlineSnapshot(`
      "filters:
        and:
          - file.inFolder("Campaigns/strahd-test/AI Tool/Foundry")
          - player_visible == true
      views:
        - type: table
          name: Player visible
          order:
            - file.name
            - type
            - player_access
            - folder
          sort:
            - property: file.name
              direction: ASC
      "
    `);
  });

  it('writes six bases at the paths the file list names, in a stable order', () => {
    const notes = renderMirrorBases(W);
    expect(notes.map(n => n.path)).toEqual(MIRROR_BASE_FILES.map(f => f.path));
    expect(notes).toHaveLength(6);
    expect(renderMirrorBases(W)).toEqual(notes);
  });

  it('filters on the mirror folder of the world and sorts by name', () => {
    for (const note of renderMirrorBases(W)) {
      expect(note.text).toContain(`- file.inFolder("Campaigns/${W}/AI Tool/Foundry")`);
      expect(note.text).toContain('- property: file.name');
      expect(note.text).not.toContain('<%');
      expect(baseOwnershipCheck(note.text)(note.text)).toEqual({
        owned: true,
        legacy: false,
        same: true,
      });
    }
  });

  it('shows only visible notes in Player visible.base', () => {
    expect(base('Player visible.base')).toContain('- player_visible == true');
    expect(base('PCs.base')).not.toContain('player_visible ==');
  });

  it('only names columns the notes actually carry', () => {
    const typeOf: Record<string, MirrorNoteType> = {
      'PCs.base': 'pc',
      'NPCs.base': 'npc',
      'Scenes.base': 'scene',
      'Journals.base': 'journal',
      'Story items.base': 'story-item',
    };
    for (const [file, type] of Object.entries(typeOf)) {
      const columns = [...base(file).matchAll(/^ {6}- (\S+)$/gm)].map(m => m[1] ?? '');
      const known = new Set([...orderFor(type), 'file.name']);
      for (const column of columns.filter(c => c !== 'property:')) {
        expect(known.has(column), `${file}: ${column}`).toBe(true);
      }
    }
    const visible = [...base('Player visible.base').matchAll(/^ {6}- (\S+)$/gm)].map(
      m => m[1] ?? ''
    );
    for (const column of visible.filter(c => c !== 'property:')) {
      expect([...HEAD, ...TAIL, 'file.name']).toContain(column);
    }
  });

  it('rejects a world id that could leave the campaign folder', () => {
    expect(() => renderMirrorBases('../x')).toThrow(/world id/);
    expect(() => renderMirrorBases('a b')).toThrow(/world id/);
  });
});

// ---------------------------------------------------------------------------
// Campaign Home and the O2 status note (render.ts changes)
// ---------------------------------------------------------------------------

describe('O2 render changes', () => {
  it('Campaign Home links the mirror bases at the paths renderMirrorBases writes', () => {
    const home = renderCampaignHome(W);
    const linked = [...home.matchAll(/\]\((AI%20Tool\/Bases\/[^)]+\.base)\)/g)].map(m =>
      decodeURIComponent(m[1] ?? '')
    );
    for (const note of renderMirrorBases(W)) expect(linked).toContain(note.path);
    expect(home).toContain(`](${relativeLinkTarget('Home.md', MIRROR_STATUS_PATH)})`);
    expect(renderCampaignHome(W)).toBe(home);
  });

  it('the O2 status note points at the mirror status note and stays deterministic', () => {
    const input = { notesManaged: 3, skipped: [], errors: [] };
    const text = renderStatusNote(W, input);
    expect(text).toContain(
      `[Foundry/_status.md](${relativeLinkTarget('AI Tool/_status.md', MIRROR_STATUS_PATH)})`
    );
    expect(renderStatusNote(W, input)).toBe(text);
    expect(checkMarkdownOwnership(text)).toEqual({ owned: true, legacy: false });
  });

  it('generatedProps keeps player_visible false unless asked, in the same place', () => {
    const off = generatedProps('session', W, { events: 1 }, null);
    const on = generatedProps('session', W, { events: 1 }, null, true);
    expect(off['player_visible']).toBe(false);
    expect(on['player_visible']).toBe(true);
    expect(Object.keys(off)).toEqual(Object.keys(on));
    expect(Object.keys(off)).toEqual([
      'type',
      'fvtt_world',
      'events',
      'fvtt_modified',
      'player_visible',
      'schema',
      'tags',
      'generated_by',
      'generated_hash',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Status note
// ---------------------------------------------------------------------------

function fullStatus(): MirrorStatus {
  return {
    ...emptyMirrorStatus({ enabled: true, vaultDirSet: true, worldId: W, openBase: OPEN }),
    lastCycleAt: '2026-09-29T10:00:00.000Z',
    lastReconcileAt: '2026-09-29T09:00:00.000Z',
    lastError: 'transient',
    counts: { pc: 1, npc: 3, scene: 2, journal: 1, 'journal-page': 2, 'story-item': 1 },
    skipped: [
      { path: 'AI Tool/Foundry/NPCs/Wolf.md', reason: 'edited in Obsidian' },
      { path: 'AI Tool/Foundry/PCs/Test Hero.md', reason: HOSTILE },
    ],
    movedByGm: [{ path: 'Prep/Moved Wolf.md', uuid: NPC_UUID }],
    duplicates: [{ path: 'AI Tool/Foundry/NPCs/Wolf copy.md', uuid: NPC_UUID }],
    keptDeleted: [{ path: 'AI Tool/Foundry/Items/Old.md', uuid: `Item.${fid('old')}` }],
    truncated: [{ kind: 'actor', total: 6000, cap: 5000 }],
    errors: [{ path: 'AI Tool/Foundry/Journals/Barovia/Village.md', error: 'bad markup `x`' }],
  };
}

describe('renderMirrorStatusNote', () => {
  it('an empty status', () => {
    const note = renderMirrorStatusNote(
      W,
      emptyMirrorStatus({ enabled: true, vaultDirSet: true, worldId: W, openBase: OPEN })
    );
    expect(note.path).toBe(MIRROR_STATUS_PATH);
    expect(note.text).toMatchInlineSnapshot(`
      "---
      type: "mirror-status"
      fvtt_world: "strahd-test"
      notes_managed: 0
      notes_pc: 0
      notes_npc: 0
      notes_scene: 0
      notes_journal: 0
      notes_journal_page: 0
      notes_story_item: 0
      notes_skipped: 0
      notes_errored: 0
      fvtt_modified: null
      player_visible: false
      schema: 1
      tags:
        - "campaign/strahd-test"
        - "mirror-status"
      generated_by: "foundry-ai-tool"
      generated_hash: "04f0d1b8ad9c8d1b"
      ---
      # Foundry mirror status

      > [!info] Mirrored from Foundry by the AI Tool
      > The AI Tool rewrites this note when the document changes in Foundry. If you edit it here, the tool stops updating it and lists it in \`AI Tool/Foundry/_status.md\`. Write your own notes in \`Prep/\`.

      The mirror is on and keeps 0 note(s) under \`AI Tool/Foundry/\`. Notes it no longer produces go to the vault trash; a note you delete comes back at the next check.

      Open in Foundry links: \`http://localhost:3000\`.

      ## Notes

      | Type | Notes |
      | --- | --- |
      | PCs | 0 |
      | NPCs | 0 |
      | Scenes | 0 |
      | Journals | 0 |
      | Journal pages (text) | 0 |
      | Story items | 0 |

      ## Skipped (edited in Obsidian, or foreign)

      - (none)

      ## Moved outside the mirror folder (never written again)

      - (none)

      ## Duplicates (a document with more than one note)

      - (none)

      ## Deleted in Foundry, kept because you edited the note

      - (none)

      ## Not fully mirrored (world caps)

      - (none)

      ## Errors

      - (none)
      "
    `);
  });

  it('a status with everything in it', () => {
    expect(renderMirrorStatusNote(W, fullStatus()).text).toMatchInlineSnapshot(`
      "---
      type: "mirror-status"
      fvtt_world: "strahd-test"
      notes_managed: 10
      notes_pc: 1
      notes_npc: 3
      notes_scene: 2
      notes_journal: 1
      notes_journal_page: 2
      notes_story_item: 1
      notes_skipped: 2
      notes_errored: 1
      fvtt_modified: null
      player_visible: false
      schema: 1
      tags:
        - "campaign/strahd-test"
        - "mirror-status"
      generated_by: "foundry-ai-tool"
      generated_hash: "f3b2f6ae3929c2d9"
      ---
      # Foundry mirror status

      > [!info] Mirrored from Foundry by the AI Tool
      > The AI Tool rewrites this note when the document changes in Foundry. If you edit it here, the tool stops updating it and lists it in \`AI Tool/Foundry/_status.md\`. Write your own notes in \`Prep/\`.

      The mirror is on and keeps 10 note(s) under \`AI Tool/Foundry/\`. Notes it no longer produces go to the vault trash; a note you delete comes back at the next check.

      Open in Foundry links: \`http://localhost:3000\`.

      ## Notes

      | Type | Notes |
      | --- | --- |
      | PCs | 1 |
      | NPCs | 3 |
      | Scenes | 2 |
      | Journals | 1 |
      | Journal pages (text) | 2 |
      | Story items | 1 |

      ## Skipped (edited in Obsidian, or foreign)

      - \`AI Tool/Foundry/NPCs/Wolf.md\`: edited in Obsidian
      - \`AI Tool/Foundry/PCs/Test Hero.md\`: Evil &lt;\\%\\= tp.system.prompt() \\%\\> \\[\\[Secret\\|link\\]\\] \\#tag \\^blk \\# Injected heading --- Injected: true

      ## Moved outside the mirror folder (never written again)

      - \`Prep/Moved Wolf.md\` (\`Actor.npc1000000000000\`)

      ## Duplicates (a document with more than one note)

      - \`AI Tool/Foundry/NPCs/Wolf copy.md\` (\`Actor.npc1000000000000\`)

      ## Deleted in Foundry, kept because you edited the note

      - \`AI Tool/Foundry/Items/Old.md\` (\`Item.old0000000000000\`)

      ## Not fully mirrored (world caps)

      - actor: the world has 6000, the mirror takes the first 5000.

      ## Errors

      - \`AI Tool/Foundry/Journals/Barovia/Village.md\`: bad markup \\\`x\\\`
      "
    `);
  });

  it('is owned, keeps no times, and does not depend on input order', () => {
    const status = fullStatus();
    const note = renderMirrorStatusNote(W, status);
    expect(checkMarkdownOwnership(note.text)).toEqual({ owned: true, legacy: false });
    expect(note.text).not.toContain('2026-09-29');
    expect(note.text).not.toContain('transient');
    const two: MirrorStatus = {
      ...status,
      truncated: [
        { kind: 'scene', total: 2000, cap: 1000 },
        { kind: 'actor', total: 6000, cap: 5000 },
      ],
    };
    const reversed: MirrorStatus = {
      ...two,
      skipped: [...two.skipped].reverse(),
      movedByGm: [...two.movedByGm].reverse(),
      truncated: [...two.truncated].reverse(),
    };
    expect(renderMirrorStatusNote(W, reversed).text).toBe(renderMirrorStatusNote(W, two).text);
  });

  it('counts notes per type and in total', () => {
    const text = renderMirrorStatusNote(W, fullStatus()).text;
    expect(text).toContain('notes_managed: 10');
    for (const type of MIRROR_NOTE_TYPES) {
      expect(text).toContain(`notes_${type.replace(/-/g, '_')}: `);
    }
    expect(text).toContain('notes_skipped: 2');
    expect(text).toContain('notes_errored: 1');
  });

  it('keeps hostile reasons and paths on one inert line', () => {
    const text = renderMirrorStatusNote(W, {
      ...fullStatus(),
      errors: [{ path: 'a`b\nc', error: `${HOSTILE} \`\`\`` }],
    }).text;
    expect(text).not.toContain('<%');
    const { body } = split(text);
    expect(body.filter(line => line === '---')).toEqual([]);
    expect(body).not.toContain('# Injected heading');
    expect(body).not.toContain('Injected: true');
  });

  it('says when the mirror is off and when Open in Foundry has no usable address', () => {
    const off = renderMirrorStatusNote(W, {
      ...emptyMirrorStatus({ enabled: false, vaultDirSet: true, worldId: W, openBase: 'bad host' }),
    });
    expect(off.text).toContain('The mirror is off');
    expect(off.text).toContain('Open in Foundry links: off');
  });

  it('rejects a bad world id', () => {
    expect(() =>
      renderMirrorStatusNote(
        '../x',
        emptyMirrorStatus({ enabled: true, vaultDirSet: true, worldId: null, openBase: OPEN })
      )
    ).toThrow(/world id/);
  });
});
