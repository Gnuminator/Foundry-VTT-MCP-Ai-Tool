/**
 * The M2 proof (docs/design/CURSE-OF-STRAHD-PLAN.md feature 2): GM state is seeded
 * with unique canary strings, and none of them may appear in anything a player
 * can fetch or stream: `/api/player/state`, the player stream, the player role
 * on the legacy `/api/state` and `/api/stream`, `/player` and `player.js`,
 * whatever credential is presented. As a control, the GM endpoint does show
 * them (so the seeding is real). Runs the real Express app against a fake
 * bridge.
 */
import type { AddressInfo } from 'net';
import type { Server } from 'http';

import type { PlayerVisibility } from '@gnuminator/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CoGm, StreamRequest, StreamResult } from '../ai/anthropic-co-gm.js';
import { createDashboard, type Dashboard } from '../app.js';
import { config, type Config } from '../config.js';
import type { CombatState, SessionEvent } from '../feed/types.js';
import { Logger } from '../logger.js';

const GM_TOKEN = 'gm-token-for-the-canary-suite';

/** Unique strings standing for GM secrets; none may reach a player. */
const CANARY = {
  trueName: 'CANARY-TRUE-NAME-strahd',
  hiddenToken: 'CANARY-HIDDEN-TOKEN',
  hiddenCombatant: 'CANARY-HIDDEN-COMBATANT',
  blindRoll: 'CANARY-BLIND-ROLL',
  rollTarget: 'CANARY-ROLL-TARGET-AC',
  effect: 'CANARY-CUSTOM-EFFECT',
  sceneTrueName: 'CANARY-SCENE-TRUE-NAME',
  gmChange: 'CANARY-GM-CHANGE',
  oldModule: 'CANARY-OLD-MODULE-EVENT',
  unseenNpc: 'CANARY-UNSEEN-NPC',
  nameHidden: 'CANARY-NAME-DISPLAY-OFF',
  npcHp: 'CANARY-NPC-HP-7331',
  diag: 'CANARY-DIAGNOSTIC',
  worldId: 'CANARY-WORLD-ID',
  gmName: 'CANARY-GM-NAME',
  secretSection: 'CANARY-SECRET-SECTION',
  script: 'CANARY-SCRIPT',
  unrevealedLink: 'CANARY-UNREVEALED-LINK',
  inlineRoll: 'CANARY-INLINE-ROLL',
  tarokka: 'CANARY-TAROKKA-CARD',
  aiText: 'CANARY-AI-COMMENTARY',
} as const;

/** An enabled co-GM whose every answer is a canary: AI output is GM-only. */
const fakeCoGm = {
  enabled: true,
  isBusy: false,
  setWorld: (): void => undefined,
  abortActive: (): void => undefined,
  stream: (request: StreamRequest): Promise<StreamResult> => {
    request.onDelta(CANARY.aiText);
    return Promise.resolve({
      text: CANARY.aiText,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cacheHit: false,
      },
      aborted: false,
    });
  },
} as unknown as CoGm;

const REVEALED = 'JournalEntry.aaaaaaaaaaaaaaaa.JournalEntryPage.bbbbbbbbbbbbbbbb';
const UNREVEALED = 'JournalEntry.cccccccccccccccc.JournalEntryPage.dddddddddddddddd';

const visibility: PlayerVisibility = {
  schema: 1,
  computedAt: 0,
  pcActorIds: ['a-pc'],
  scene: { id: 's1', name: 'Village square' },
  tokens: [
    { tokenId: 't-npc', actorId: 'a-npc', name: 'Hooded figure', pc: false },
    { tokenId: 't-pc', actorId: 'a-pc', name: 'Ireena', pc: true },
  ],
};

let sentChat: unknown[] = [];

const fakeClient = {
  isConnected: true,
  listTools: (): Promise<unknown[]> => Promise.resolve([]),
  callTool: <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const answers: Record<string, unknown> = {
      'get-world-info': {
        id: CANARY.worldId,
        title: 'Barovia',
        system: { id: 'dnd5e', version: '6.0.5' },
        foundry: { version: '14.368' },
        activeUsers: [{ name: CANARY.gmName, isGM: true }],
      },
      'get-player-visibility': visibility,
      'get-player-handouts': {
        revealedUuids: [REVEALED],
        handouts: [
          {
            id: 'bbbbbbbbbbbbbbbb',
            uuid: REVEALED,
            title: 'A letter',
            revealedAt: '2026-09-28T20:00:00.000Z',
            html:
              `<p>Dear friends, see @UUID[${REVEALED}]{the map}.</p>` +
              `<section class="secret"><p>${CANARY.secretSection}</p></section>` +
              `<script>${CANARY.script}</script>` +
              `<p>@UUID[${UNREVEALED}]{${CANARY.unrevealedLink}} [[/r 1d20 # ${CANARY.inlineRoll}]]</p>`,
          },
        ],
      },
      'check-secret-terms': {
        matches: String(args.text ?? '').includes(CANARY.tarokka)
          ? [{ category: 'tarokka-card', term: CANARY.tarokka }]
          : [],
      },
      'send-chat-message': { ok: true },
    };
    if (name === 'send-chat-message') sentChat.push(args);
    return name in answers
      ? Promise.resolve(answers[name] as T)
      : Promise.reject(new Error(`unknown tool ${name}`));
  },
};

function event(id: string, over: Partial<SessionEvent>): SessionEvent {
  return {
    id,
    timestamp: '2026-09-28T20:00:00.000Z',
    timestampMs: 1000,
    eventType: 'damage',
    actorName: null,
    actorId: null,
    description: '',
    details: {},
    ...over,
  };
}

const pcSeen = { subject: 'pc', tokenVisible: true, playerName: 'Ireena' } as const;
const npcSeen = { subject: 'npc', tokenVisible: true, playerName: 'Hooded figure' } as const;

const events: SessionEvent[] = [
  event('gm-change', {
    eventType: 'gm-change',
    description: `Applied: ${CANARY.gmChange}`,
    details: { note: CANARY.gmChange },
    visibility: { subject: null, tokenVisible: false, playerName: null },
  }),
  event('blind', {
    eventType: 'gm-roll',
    description: `${CANARY.trueName}, Bite attack ${CANARY.blindRoll}`,
    details: { breakdown: CANARY.blindRoll },
    visibility: npcSeen,
  }),
  event('public-roll', {
    eventType: 'roll',
    actorName: 'Hooded figure',
    description: 'Hooded figure, Bite attack: 1d20 (15) +4 modifier = 19',
    details: { breakdown: `vs AC 12: hit ${CANARY.rollTarget}` },
    visibility: npcSeen,
  }),
  // Foundry's chat alias is the true name here (found live in M2).
  event('sheet-roll', {
    eventType: 'roll',
    actorName: CANARY.trueName,
    description: `${CANARY.trueName}, Initiative: 1d20 (12) +2 DEX = 14`,
    visibility: npcSeen,
  }),
  event('nameless-roll', {
    eventType: 'damage-roll',
    actorName: CANARY.nameHidden,
    description: `${CANARY.nameHidden}, Bite damage: 2d4 (3, 2) +2 = 7 piercing`,
    visibility: { subject: 'npc', tokenVisible: true, playerName: null },
  }),
  event('npc-hit', {
    actorName: CANARY.trueName,
    description: `${CANARY.trueName} took ${CANARY.npcHp} damage`,
    details: { amount: 7331, from: 20, to: 13, source: CANARY.trueName },
    visibility: npcSeen,
  }),
  event('unseen', {
    actorName: CANARY.unseenNpc,
    description: `${CANARY.unseenNpc} took 3 damage`,
    visibility: { subject: 'npc', tokenVisible: false, playerName: null },
  }),
  event('effect', {
    eventType: 'condition-applied',
    actorName: 'Ireena',
    description: `Ireena gained "${CANARY.effect}"`,
    details: { effectName: CANARY.effect },
    visibility: { ...pcSeen, statuses: [CANARY.effect] },
  }),
  event('scene', {
    eventType: 'scene-change',
    description: `Scene changed to "${CANARY.sceneTrueName}"`,
    details: { sceneName: CANARY.sceneTrueName },
    visibility: {
      subject: null,
      tokenVisible: false,
      playerName: null,
      sceneName: 'Village square',
    },
  }),
  event('old-module', {
    description: `Ireena took 2 damage ${CANARY.oldModule}`,
    details: { note: CANARY.oldModule },
  }),
  event('pc-hit', {
    actorName: 'Ireena',
    description: 'Ireena took 4 damage',
    details: { amount: 4 },
    visibility: pcSeen,
  }),
];

const combat: CombatState = {
  active: true,
  round: 2,
  turn: 0,
  current: null,
  combatants: [
    {
      id: 'c-npc',
      name: CANARY.trueName,
      initiative: 17,
      isCurrentTurn: true,
      actedThisRound: false,
      hp: { value: 7331, max: 9000, temp: 0 },
      conditions: [CANARY.effect],
      isPC: false,
      category: 'enemy',
      defeated: false,
      deathSaves: null,
      tokenId: 't-npc',
      actorId: 'a-npc',
      statuses: ['prone', CANARY.effect],
    },
    {
      id: 'c-hidden-token',
      name: CANARY.hiddenToken,
      initiative: 15,
      isCurrentTurn: false,
      actedThisRound: false,
      hp: { value: 5, max: 5, temp: 0 },
      conditions: [],
      isPC: false,
      category: 'enemy',
      defeated: false,
      deathSaves: null,
      tokenId: 't-not-visible',
      actorId: 'a-other',
    },
    {
      id: 'c-hidden',
      name: CANARY.hiddenCombatant,
      initiative: 14,
      isCurrentTurn: false,
      actedThisRound: false,
      hp: { value: 5, max: 5, temp: 0 },
      conditions: [],
      isPC: false,
      category: 'enemy',
      defeated: false,
      deathSaves: null,
      hidden: true,
      tokenId: 't-npc',
      actorId: 'a-npc',
    },
  ],
};

let dashboard: Dashboard;
let server: Server;
let base = '';

async function get(
  path: string,
  token?: string
): Promise<{ status: number; text: string; headers: Headers }> {
  const res = await fetch(`${base}${path}`, token ? { headers: { 'X-CoGM-Token': token } } : {});
  return { status: res.status, text: await res.text(), headers: res.headers };
}

/** Everything a stream sends in `ms`, as text. */
async function readStream(path: string, ms: number, token?: string): Promise<string> {
  const controller = new AbortController();
  const res = await fetch(`${base}${path}`, {
    signal: controller.signal,
    ...(token ? { headers: { 'X-CoGM-Token': token } } : {}),
  });
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    for (;;) {
      const chunk = await reader?.read();
      if (!chunk || chunk.done) break;
      text += decoder.decode(chunk.value);
    }
  } catch {
    // aborted: the read window is over
  } finally {
    clearTimeout(timer);
  }
  return text;
}

function leaks(text: string): string[] {
  return Object.values(CANARY).filter(canary => text.includes(canary));
}

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

beforeAll(async () => {
  const logger = new Logger('error', 'canary');
  const testConfig: Config = {
    ...config,
    auth: { ...config.auth, splitEnabled: true, gmToken: GM_TOKEN, playerToken: '' },
    playerView: { showEnemyConditions: true, showEnemyHpBands: true },
    commentDebounceMs: 10,
    commentMinIntervalMs: 0,
  };
  dashboard = createDashboard({
    config: testConfig,
    logger,
    client: fakeClient,
    coGm: fakeCoGm,
  });
  server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  dashboard.handlers.onStatus({
    controlChannel: 'connected',
    foundry: 'reachable',
    lastError: null,
    lastPollAt: null,
  });
  dashboard.handlers.onEvents(events, { initial: true });
  dashboard.handlers.onCombat(combat);
  dashboard.handlers.onErrors(
    [
      {
        id: 'd1',
        timestamp: '2026-09-28T20:00:00.000Z',
        timestampMs: 1000,
        level: 'error',
        message: CANARY.diag,
        stack: null,
        module: null,
      },
    ],
    { initial: true }
  );
  await wait(300); // world info and the player view context arrive asynchronously
});

afterAll(async () => {
  dashboard.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('canary suite: nothing GM-only reaches a player', () => {
  it('control: the GM endpoint does carry the seeded secrets', async () => {
    const gm = await get('/api/state', GM_TOKEN);
    expect(gm.status).toBe(200);
    for (const canary of [
      CANARY.trueName,
      CANARY.gmChange,
      CANARY.diag,
      CANARY.worldId,
      CANARY.blindRoll,
      CANARY.nameHidden,
    ]) {
      expect(gm.text).toContain(canary);
    }
  });

  it('/api/player/state leaks nothing, with or without a GM token', async () => {
    for (const token of [undefined, GM_TOKEN]) {
      const res = await get('/api/player/state', token);
      expect(res.status).toBe(200);
      expect(leaks(res.text)).toEqual([]);
      const state = JSON.parse(res.text) as {
        events: Array<{ id: string; text: string }>;
        combat: { combatants: Array<{ name: string }> };
      };
      // It still shows what players may see.
      expect(state.events.map(e => e.id)).toEqual([
        'public-roll',
        'sheet-roll',
        'npc-hit',
        'scene',
        'pc-hit',
      ]);
      expect(state.events.find(e => e.id === 'npc-hit')?.text).toBe('Hooded figure was hit.');
      expect(state.events.find(e => e.id === 'sheet-roll')?.text).toBe(
        'Hooded figure, Initiative: 1d20 (12) +2 DEX = 14'
      );
      expect(state.combat.combatants.map(c => c.name)).toEqual(['Hooded figure']);
      expect(res.text).toContain('the map'); // a link to a revealed page keeps its label
    }
  });

  it('the legacy /api/state gives the player role the same projection', async () => {
    const res = await get('/api/state');
    expect(res.status).toBe(200);
    expect(leaks(res.text)).toEqual([]);
    expect(res.text).not.toContain('"errors"');
    expect(res.text).not.toContain('"settings"');
  });

  it('no player stream frame leaks, including later broadcasts', async () => {
    const reading = Promise.all([
      readStream('/api/player/stream', 800),
      readStream('/api/player/stream', 800, GM_TOKEN),
      readStream('/api/stream', 800), // the player role on the legacy stream
    ]);
    const gmReading = readStream('/api/stream', 800, GM_TOKEN);
    await wait(100);
    // AI output: an answer to the GM, and commentary on the events below.
    const ask = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CoGM-Token': GM_TOKEN },
      body: JSON.stringify({ question: 'What happens next?' }),
    });
    expect(ask.status).toBe(200);
    dashboard.handlers.onEvents(
      [
        event('late-blind', {
          eventType: 'gm-roll',
          description: CANARY.blindRoll,
          visibility: npcSeen,
        }),
        event('late-pc', { description: 'x', details: { amount: 1 }, visibility: pcSeen }),
      ],
      { initial: false }
    );
    dashboard.handlers.onCombat({ ...combat, round: 3 });
    for (const text of await reading) {
      expect(text).toContain('event: state');
      expect(leaks(text)).toEqual([]);
    }
    // Control: the GM stream did carry the AI output.
    expect(await gmReading).toContain(CANARY.aiText);
  });

  it('the player page and script carry no GM data, and the page has a strict CSP', async () => {
    for (const path of ['/player', '/player.html', '/player.js']) {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(leaks(res.text)).toEqual([]);
    }
    const page = await get('/player');
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
  });
});

describe('whisper guard', () => {
  it('refuses a whisper naming a GM secret until the GM confirms', async () => {
    sentChat = [];
    const post = (body: Record<string, unknown>): Promise<Response> =>
      fetch(`${base}/api/post-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CoGM-Token': GM_TOKEN },
        body: JSON.stringify(body),
      });
    const refused = await post({ text: `The ${CANARY.tarokka} points to the church.` });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'secret-terms' });
    expect(sentChat).toHaveLength(0);

    const forced = await post({
      text: `The ${CANARY.tarokka} points to the church.`,
      allowSecrets: true,
    });
    expect(forced.status).toBe(200);
    expect(sentChat).toHaveLength(1);

    const plain = await post({ text: 'Remember the bridge toll.' });
    expect(plain.status).toBe(200);
    expect(sentChat).toHaveLength(2);
  });

  it('a player cannot post at all', async () => {
    const res = await fetch(`${base}/api/post-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hi' }),
    });
    expect(res.status).toBe(403);
  });
});
