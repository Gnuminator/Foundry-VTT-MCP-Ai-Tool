/**
 * O7 spoiler canary, through the real `createDashboard` path (D-065: no spoilers on the normal
 * screens). The fake bridge answers every tool with data that carries unique canary strings: an
 * unrevealed page, a GM secret block, another player's handout and sheet, the session-notes
 * journal, hidden tokens, blind GM rolls and NPC hit points. After the dashboard has written the
 * player vaults, every file under a player's folder (the `.obsidian` folder included, and the file
 * names too) must be free of every canary that player may not know. A positive and a control
 * check make sure the test cannot pass because nothing was written or nothing was planted.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { CharacterSheet } from '@gnuminator/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDashboard, type Dashboard } from '../app.js';
import { DEFAULT_SNIPPET_DIR } from './service.js';
import { config, type Config } from '../config.js';
import type { BridgeStatus, SessionEvent } from '../feed/types.js';
import { Logger } from '../logger.js';

const ALICE_ID = 'aaaaaaaaaaaaaaaa';
const BOB_ID = 'bbbbbbbbbbbbbbbb';
const GM_ID = 'gggggggggggggggg';

const REVEALED_UUID = 'JournalEntry.jjjjjjjjjjjjjjjj.JournalEntryPage.rrrrrrrrrrrrrrrr';
const UNREVEALED_UUID = 'JournalEntry.jjjjjjjjjjjjjjjj.JournalEntryPage.uuuuuuuuuuuuuuuu';

const T0 = new Date(2026, 9, 3, 20, 0, 0).getTime();

// Canaries that no player may ever see (GM side, unrevealed, NPC and hidden data).
const GM_CANARIES = {
  unrevealedPage: 'CANARY_UNREVEALED_PAGE_7f3a',
  unrevealedLinkLabel: 'CANARY_UNREVEALED_LINK_LABEL_2c9d',
  secretSection: 'CANARY_SECRET_SECTION_91be',
  attribute: 'CANARY_HTML_ATTRIBUTE_5d10',
  gmSummary: 'CANARY_GM_SUMMARY_e4a7',
  unrevealedRecap: 'CANARY_UNREVEALED_RECAP_38cc',
  searchHit: 'CANARY_SEARCH_JOURNALS_HIT_a0f2',
  catchAll: 'CANARY_CATCH_ALL_TOOL_b6d3',
  hiddenTokenName: 'CANARY_HIDDEN_TOKEN_NAME_17ee',
  hiddenTokenText: 'CANARY_HIDDEN_TOKEN_TEXT_c4b9',
  hiddenTokenDetail: 'CANARY_HIDDEN_TOKEN_DETAIL_6a21',
  blindRoll: 'CANARY_BLIND_ROLL_d85f',
  gmRollType: 'CANARY_GM_ROLL_TYPE_0b3e',
  unstampedEvent: 'CANARY_UNSTAMPED_EVENT_f19c',
  npcTrueName: 'CANARY_NPC_TRUE_NAME_72ad',
  npcHpText: 'CANARY_NPC_HP_TEXT_e08b',
  npcHpAmount: '918273645',
  gmCharacter: 'CANARY_GM_CHARACTER_4be6',
} as const;

// Canaries that belong to Bob (his handout and his sheet): Alice may not see them.
const BOB_CANARIES = {
  handout: 'CANARY_B_ONLY_HANDOUT_83d4',
  sheetName: 'CANARY_B_SHEET_NAME_c71a',
  biography: 'CANARY_B_BIOGRAPHY_2e95',
} as const;

// Alice's own revealed text: allowed in her folder, forbidden in Bob's.
const ALICE_ONLY_TEXT = 'ALICE_ONLY_LETTER_TEXT_5f08';

// Public text that must reach the player folders.
const PUBLIC_LETTER = 'PUBLIC_LETTER_TEXT_9b12';
const PUBLIC_LINK_LABEL = 'Open Door';
const PUBLIC_EVENT_TEXT = 'Ireena, Attack: 1d20+5 = 17';
const PUBLIC_EVENT_TEXT_2 = 'Ireena, Perception: 1d20+3 = 12';
const PUBLIC_NPC_LINE = 'Hooded Stranger was hit.';
const ALICE_SHEET_NAME = 'Ireena Kolyana';

function sheet(name: string, biography = ''): CharacterSheet {
  return {
    id: `actor-${name}`,
    name,
    level: 1,
    classes: [],
    species: null,
    background: null,
    alignment: null,
    xp: null,
    size: null,
    ac: null,
    hp: { value: 10, max: 10, temp: 0 },
    hitDice: { value: 0, max: 0 },
    deathSaves: { success: 0, failure: 0 },
    exhaustion: 0,
    inspiration: false,
    proficiencyBonus: null,
    initiative: null,
    speed: {},
    speedUnits: null,
    senses: [],
    abilities: [],
    skills: [],
    passivePerception: null,
    conditions: [],
    concentration: null,
    spellcasting: { ability: null, dc: null, attack: null },
    slots: [],
    spells: [],
    features: [],
    inventory: [],
    currency: {},
    languages: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    toolProficiencies: [],
    resistances: [],
    immunities: [],
    vulnerabilities: [],
    personality: { traits: biography, ideals: '', bonds: '', flaws: '', appearance: '' },
  };
}

function event(
  id: string,
  over: Partial<SessionEvent> & Pick<SessionEvent, 'eventType' | 'description'>,
  offset = 0
): SessionEvent {
  return {
    timestamp: new Date(T0 + offset).toISOString(),
    timestampMs: T0 + offset,
    actorName: null,
    actorId: null,
    details: {},
    ...over,
    id,
  };
}

/** The events a wrong projection would leak, plus public ones that must show. */
function makeEvents(prefix: string, offset: number): SessionEvent[] {
  return [
    // Public: a PC roll with its player-safe line.
    event(
      `${prefix}-pc-roll`,
      {
        eventType: 'roll',
        actorName: 'Ireena',
        actorId: 'actor-pc',
        description: PUBLIC_EVENT_TEXT,
        visibility: { subject: 'pc', tokenVisible: true, playerName: 'Ireena' },
      },
      offset
    ),
    // Public but redacted: a visible NPC hit shows only "<token name> was hit."
    event(
      `${prefix}-npc-visible-hit`,
      {
        eventType: 'damage',
        actorName: GM_CANARIES.npcTrueName,
        actorId: 'actor-npc',
        description: `${GM_CANARIES.npcTrueName} took ${GM_CANARIES.npcHpAmount} damage ${GM_CANARIES.npcHpText}`,
        details: {
          amount: Number(GM_CANARIES.npcHpAmount),
          hp: { value: GM_CANARIES.npcHpText, max: GM_CANARIES.npcHpAmount },
        },
        visibility: { subject: 'npc', tokenVisible: true, playerName: 'Hooded Stranger' },
      },
      offset + 1
    ),
    // NPC healing with the numbers in the details (never copied).
    event(
      `${prefix}-npc-heal`,
      {
        eventType: 'healing',
        actorName: GM_CANARIES.npcTrueName,
        actorId: 'actor-npc',
        description: `${GM_CANARIES.npcTrueName} healed ${GM_CANARIES.npcHpAmount} ${GM_CANARIES.npcHpText}`,
        details: { amount: Number(GM_CANARIES.npcHpAmount), note: GM_CANARIES.npcHpText },
        visibility: { subject: 'npc', tokenVisible: true, playerName: 'Hooded Stranger' },
      },
      offset + 2
    ),
    // Hidden token: damage, a condition and a death, all dropped.
    event(
      `${prefix}-hidden-damage`,
      {
        eventType: 'damage',
        actorName: GM_CANARIES.hiddenTokenName,
        actorId: 'actor-hidden',
        description: `${GM_CANARIES.hiddenTokenName} ${GM_CANARIES.hiddenTokenText}`,
        details: { amount: 12, note: GM_CANARIES.hiddenTokenDetail },
        visibility: {
          subject: 'npc',
          tokenVisible: false,
          playerName: GM_CANARIES.hiddenTokenName,
        },
      },
      offset + 3
    ),
    event(
      `${prefix}-hidden-condition`,
      {
        eventType: 'condition-applied',
        actorName: GM_CANARIES.hiddenTokenName,
        actorId: 'actor-hidden',
        description: `${GM_CANARIES.hiddenTokenName} is poisoned ${GM_CANARIES.hiddenTokenText}`,
        details: { note: GM_CANARIES.hiddenTokenDetail },
        visibility: {
          subject: 'npc',
          tokenVisible: false,
          playerName: GM_CANARIES.hiddenTokenName,
          statuses: ['poisoned'],
        },
      },
      offset + 4
    ),
    event(
      `${prefix}-hidden-death`,
      {
        eventType: 'death',
        actorName: GM_CANARIES.hiddenTokenName,
        actorId: 'actor-hidden',
        description: `${GM_CANARIES.hiddenTokenName} died ${GM_CANARIES.hiddenTokenText}`,
        visibility: {
          subject: 'npc',
          tokenVisible: false,
          playerName: GM_CANARIES.hiddenTokenName,
        },
      },
      offset + 5
    ),
    // GM-only (blind or private) roll: the roll line of a speaker players cannot see.
    event(
      `${prefix}-blind-roll`,
      {
        eventType: 'roll',
        actorName: GM_CANARIES.npcTrueName,
        actorId: 'actor-npc',
        description: `${GM_CANARIES.npcTrueName}, ${GM_CANARIES.blindRoll}: 1d20 = 20`,
        details: { blind: true, note: GM_CANARIES.blindRoll },
        visibility: { subject: 'npc', tokenVisible: false, playerName: null },
      },
      offset + 6
    ),
    event(
      `${prefix}-gm-roll-type`,
      {
        eventType: 'gm-roll',
        actorName: 'GM',
        description: `GM ${GM_CANARIES.gmRollType}`,
        details: { note: GM_CANARIES.gmRollType },
        visibility: { subject: null, tokenVisible: false, playerName: null },
      },
      offset + 7
    ),
    // An older module's event: no visibility stamp at all, so players never see it.
    event(
      `${prefix}-unstamped`,
      {
        eventType: 'roll',
        actorName: 'Ireena',
        description: `Ireena, ${GM_CANARIES.unstampedEvent}: 1d20 = 3`,
      },
      offset + 8
    ),
  ];
}

/** Everything the fake bridge can serve, for the control check. */
function makeSource(): {
  handouts: unknown;
  visibility: unknown;
  sheets: Record<string, unknown>;
  live: SessionEvent[];
  liveLate: SessionEvent[];
  backfill: SessionEvent[];
  journals: unknown;
  catchAll: unknown;
} {
  const handouts = {
    handouts: [
      {
        id: 'handout-alice',
        title: 'The Old Letter',
        revealedAt: '2026-10-03T19:00:00.000Z',
        players: [ALICE_ID],
        html:
          `<p>${PUBLIC_LETTER} ${ALICE_ONLY_TEXT}</p>` +
          `<p data-note="${GM_CANARIES.attribute}">See @UUID[${UNREVEALED_UUID}]{${GM_CANARIES.unrevealedLinkLabel}} ` +
          `and @UUID[${REVEALED_UUID}]{${PUBLIC_LINK_LABEL}}.</p>` +
          `<section class="secret" id="secret-1"><p>${GM_CANARIES.secretSection}</p></section>`,
      },
      {
        id: 'handout-bob',
        title: 'Bob Private Note',
        revealedAt: '2026-10-03T19:05:00.000Z',
        players: [BOB_ID],
        html: `<p>${BOB_CANARIES.handout}</p>`,
      },
    ],
    revealedUuids: [REVEALED_UUID],
  };
  const visibility = {
    schema: 1,
    computedAt: T0,
    pcActorIds: ['actor-pc'],
    scene: { id: 's1', name: 'Village of Barovia' },
    tokens: [{ tokenId: 't1', actorId: 'actor-npc', name: 'Hooded Stranger', pc: false }],
  };
  const sheets: Record<string, unknown> = {
    [ALICE_ID]: { userId: ALICE_ID, userName: 'Alice', sheets: [sheet(ALICE_SHEET_NAME)] },
    [BOB_ID]: {
      userId: BOB_ID,
      userName: 'Bob',
      sheets: [sheet(BOB_CANARIES.sheetName, BOB_CANARIES.biography)],
    },
    [GM_ID]: {
      userId: GM_ID,
      userName: 'GM',
      sheets: [sheet(GM_CANARIES.gmCharacter, GM_CANARIES.gmCharacter)],
    },
  };
  const journals = {
    journals: [
      {
        id: 'journal-notes',
        name: 'Session Notes',
        pages: [
          { id: 'page-summary', name: 'GM summary', text: GM_CANARIES.gmSummary },
          { id: 'page-recap', name: 'Recap', text: GM_CANARIES.unrevealedRecap },
          { id: 'page-unrevealed', name: 'Crypt', text: GM_CANARIES.unrevealedPage },
        ],
      },
    ],
    results: [{ id: 'page-unrevealed', excerpt: GM_CANARIES.searchHit }],
  };
  const catchAll = { note: GM_CANARIES.catchAll, text: GM_CANARIES.unrevealedPage };
  return {
    handouts,
    visibility,
    sheets,
    live: makeEvents('live', 0),
    liveLate: [
      ...makeEvents('late', 100),
      event(
        'late-public-roll',
        {
          eventType: 'roll',
          actorName: 'Ireena',
          actorId: 'actor-pc',
          description: PUBLIC_EVENT_TEXT_2,
          visibility: { subject: 'pc', tokenVisible: true, playerName: 'Ireena' },
        },
        120
      ),
    ],
    backfill: makeEvents('back', 200),
    journals,
    catchAll,
  };
}

const CONNECTED: BridgeStatus = {
  controlChannel: 'connected',
  foundry: 'reachable',
  lastError: null,
  lastPollAt: null,
  foundryDownSince: null,
};

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out.sort();
}

/** Every file name and file body under a folder, joined, for substring checks. */
async function folderText(dir: string): Promise<{ files: string[]; text: string }> {
  const files = await walk(dir);
  const parts: string[] = [];
  for (const file of files) {
    parts.push(path.relative(dir, file));
    parts.push(await fsp.readFile(file, 'utf8'));
  }
  return {
    files: files.map(f => path.relative(dir, f).split(path.sep).join('/')),
    text: parts.join('\n'),
  };
}

/**
 * Markdown escapes `_` and `*`, wraps lines and encodes links, so a plain substring check could
 * miss a leaked canary. Both sides are reduced to letters and digits before they are compared.
 */
function squash(text: string): string {
  return text.replace(/[^A-Za-z0-9]/g, '');
}

function has(folder: { text: string }, needle: string): boolean {
  return squash(folder.text).includes(squash(needle));
}

let tmp: string;
let dashboard: Dashboard | null = null;

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'player-vault-canary-'));
});

afterEach(async () => {
  dashboard?.close();
  dashboard = null;
  await fsp.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('O7 player vault spoiler canary (real createDashboard path)', () => {
  it('never writes a canary into a player folder, and does write the public text', async () => {
    const source = makeSource();
    const toolCalls: string[] = [];
    const sheetCalls: string[] = [];
    const backfillArgs: Array<Record<string, unknown> | undefined> = [];

    const vaultsDir = path.join(tmp, 'vaults');
    const testConfig: Config = {
      ...config,
      stateDir: path.join(tmp, 'state'),
      playerVaultsDir: vaultsDir,
      playerVaultIntervalMs: 50,
    };

    dashboard = createDashboard({
      config: testConfig,
      logger: new Logger('error', 'vault-canary'),
      client: {
        isConnected: true,
        listTools: (): Promise<unknown[]> => Promise.resolve([]),
        callTool: <T>(name: string, args?: Record<string, unknown>): Promise<T> => {
          toolCalls.push(name);
          switch (name) {
            case 'get-world-info':
              return Promise.resolve({
                id: 'w-canary',
                title: 'Barovia',
                system: { id: 'dnd5e', version: '6.0.5' },
                foundry: { version: '14.368' },
                playerUsers: [
                  { id: ALICE_ID, name: 'Alice', isGM: false },
                  { id: BOB_ID, name: 'Bob', isGM: false },
                  { id: GM_ID, name: 'GM', isGM: true },
                ],
                activeUsers: [{ id: GM_ID, name: 'GM', isGM: true }],
              } as T);
            case 'get-player-visibility':
              return Promise.resolve(source.visibility as T);
            case 'get-player-handouts':
              return Promise.resolve(source.handouts as T);
            case 'get-session-log':
              backfillArgs.push(args);
              return Promise.resolve({ events: source.backfill } as T);
            case 'list-journals':
            case 'search-journals':
            case 'get-journal':
            case 'get-journal-page':
            case 'list-revealed-pages':
              return Promise.resolve(source.journals as T);
            default:
              // Any tool the vault should never need: it answers with canaries.
              return Promise.resolve(source.catchAll as T);
          }
        },
        characterSheet: (userId: string): Promise<unknown> => {
          sheetCalls.push(userId);
          return Promise.resolve(source.sheets[userId] ?? null);
        },
      },
      coGm: {
        enabled: false,
        isBusy: false,
        setWorld: (): void => undefined,
        abortActive: (): void => undefined,
        stream: () => Promise.reject(new Error('off')),
      } as never,
    });

    // Live events that arrive before the world is known are held, then stored.
    dashboard.handlers.onEvents(source.live, { initial: false });
    dashboard.start();
    dashboard.handlers.onStatus(CONNECTED);

    const alice = path.join(vaultsDir, 'Alice');
    const bob = path.join(vaultsDir, 'Bob');

    // Wait until both folders hold everything public: the handout, the sheet and the log.
    await vi.waitFor(
      async () => {
        const a = await folderText(alice);
        const b = await folderText(bob);
        expect(has(a, PUBLIC_LETTER), `missing ${PUBLIC_LETTER}`).toBe(true);
        expect(has(a, ALICE_SHEET_NAME), `missing ${ALICE_SHEET_NAME}`).toBe(true);
        expect(has(a, PUBLIC_EVENT_TEXT), `missing ${PUBLIC_EVENT_TEXT}`).toBe(true);
        expect(has(b, BOB_CANARIES.handout), `missing ${BOB_CANARIES.handout}`).toBe(true);
        expect(has(b, BOB_CANARIES.sheetName), `missing ${BOB_CANARIES.sheetName}`).toBe(true);
        expect(has(b, PUBLIC_EVENT_TEXT), `missing ${PUBLIC_EVENT_TEXT}`).toBe(true);
      },
      { timeout: 8_000, interval: 50 }
    );

    // A second batch of live events, now that the world is known, goes through the same path.
    dashboard.handlers.onEvents(source.liveLate, { initial: false });
    await vi.waitFor(
      async () => {
        expect(has(await folderText(alice), PUBLIC_EVENT_TEXT_2)).toBe(true);
        expect(has(await folderText(bob), PUBLIC_EVENT_TEXT_2)).toBe(true);
      },
      { timeout: 8_000, interval: 50 }
    );
    // Let any rebuild still in flight finish before the final read.
    await new Promise(resolve => setTimeout(resolve, 250));

    const a = await folderText(alice);
    const b = await folderText(bob);

    // The folders are real vaults. The walk includes `.obsidian` whenever the theme snippet is built.
    expect(a.files).toContain('Home.md');
    expect(b.files).toContain('Home.md');
    expect((await fsp.readdir(vaultsDir)).sort()).toEqual(['Alice', 'Bob']);
    // With the plugin built (CI builds before it tests), the walk really covers `.obsidian`.
    if ((await fsp.readdir(DEFAULT_SNIPPET_DIR).catch(() => [])).length > 0) {
      expect(a.files).toContain('.obsidian/appearance.json');
    }

    // Alice: no GM canary and no canary of Bob's.
    const forAliceForbidden = [...Object.values(GM_CANARIES), ...Object.values(BOB_CANARIES)];
    for (const canary of forAliceForbidden) {
      expect(has(a, canary), `Alice's folder leaked ${canary}`).toBe(false);
    }

    // Bob: no GM canary and nothing that is only Alice's. His own handout and sheet are allowed.
    const forBobForbidden = [...Object.values(GM_CANARIES), ALICE_ONLY_TEXT];
    for (const canary of forBobForbidden) {
      expect(has(b, canary), `Bob's folder leaked ${canary}`).toBe(false);
    }

    // Positives: the public text reached the folders.
    expect(has(a, PUBLIC_LETTER), `missing ${PUBLIC_LETTER}`).toBe(true);
    expect(has(a, ALICE_ONLY_TEXT), `missing ${ALICE_ONLY_TEXT}`).toBe(true);
    expect(has(a, PUBLIC_LINK_LABEL), `missing ${PUBLIC_LINK_LABEL}`).toBe(true);
    expect(has(a, ALICE_SHEET_NAME), `missing ${ALICE_SHEET_NAME}`).toBe(true);
    expect(has(a, PUBLIC_EVENT_TEXT), `missing ${PUBLIC_EVENT_TEXT}`).toBe(true);
    expect(has(a, PUBLIC_NPC_LINE), `missing ${PUBLIC_NPC_LINE}`).toBe(true);
    expect(has(b, BOB_CANARIES.handout), `missing ${BOB_CANARIES.handout}`).toBe(true);
    expect(has(b, BOB_CANARIES.sheetName), `missing ${BOB_CANARIES.sheetName}`).toBe(true);
    expect(has(b, ALICE_SHEET_NAME)).toBe(false);

    // Control: the canaries really sat in the data the fake bridge could serve.
    const served = JSON.stringify(source);
    for (const canary of [
      ...Object.values(GM_CANARIES),
      ...Object.values(BOB_CANARIES),
      ALICE_ONLY_TEXT,
    ]) {
      expect(served.includes(canary), `${canary} is not planted in the fake source`).toBe(true);
    }
    // Both feeds carried hidden and blind events, and the backfill really ran.
    for (const feed of [source.live, source.liveLate, source.backfill]) {
      const feedText = JSON.stringify(feed);
      expect(feedText).toContain(GM_CANARIES.hiddenTokenName);
      expect(feedText).toContain(GM_CANARIES.blindRoll);
      expect(feedText).toContain(GM_CANARIES.npcHpText);
    }
    expect(toolCalls).toContain('get-session-log');
    expect(backfillArgs.length).toBeGreaterThan(0);
    expect(new Set(sheetCalls)).toEqual(new Set([ALICE_ID, BOB_ID]));
    expect(sheetCalls).not.toContain(GM_ID);
  });
}, 30_000);
