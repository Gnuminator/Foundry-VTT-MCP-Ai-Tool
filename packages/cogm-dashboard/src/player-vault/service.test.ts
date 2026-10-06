import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { CharacterSheet, PlayerHandout } from '@gnuminator/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SessionEvent } from '../feed/types.js';
import { Logger } from '../logger.js';
import type { ThemeId } from '../theme.js';
import { PlayerLogStore } from './log-store.js';
import { PlayerVaultService, type PlayerVaultClient } from './service.js';
import type { VaultPlayer } from './types.js';
import { PLAYER_MARKER_FILE } from './writer.js';

const logger = new Logger('error');

const ALICE: VaultPlayer = { userId: 'aaaaaaaaaaaaaaaa', name: 'Alice' };
const BOB: VaultPlayer = { userId: 'bbbbbbbbbbbbbbbb', name: 'Bob' };
const T0 = new Date(2026, 9, 3, 20, 0, 0).getTime();

function sheet(name: string): CharacterSheet {
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
    personality: { traits: '', ideals: '', bonds: '', flaws: '', appearance: '' },
  };
}

function handout(over: Partial<PlayerHandout> & { title: string }): PlayerHandout {
  return { id: over.id ?? over.title, html: '<p>Body</p>', revealedAt: null, ...over };
}

/** A public PC roll: the projection keeps its line. */
function pcRoll(id: string, line: string, timestampMs = T0): SessionEvent {
  return {
    id,
    timestamp: new Date(timestampMs).toISOString(),
    timestampMs,
    eventType: 'roll',
    actorName: 'Ireena',
    actorId: 'a1',
    description: line,
    details: {},
    visibility: { subject: 'pc', tokenVisible: true, playerName: 'Ireena' },
  };
}

/** A GM-only event type that players never see. */
function gmChange(id: string, timestampMs = T0): SessionEvent {
  return {
    id,
    timestamp: new Date(timestampMs).toISOString(),
    timestampMs,
    eventType: 'gm-change',
    actorName: null,
    actorId: null,
    description: 'GM-ONLY-NOTE',
    details: { note: 'GM-ONLY-NOTE' },
    visibility: { subject: null, tokenVisible: false, playerName: null },
  };
}

interface Rig {
  svc: PlayerVaultService;
  store: PlayerLogStore;
  root: string;
  snippetDir: string;
  calls: string[];
  sheetCalls: string[];
  state: {
    world: { id: string; title: string } | null;
    players: VaultPlayer[];
    handouts: PlayerHandout[];
    handoutsReady: boolean;
    theme: ThemeId;
    connected: boolean;
    sessionLog: SessionEvent[];
    sessionLogFails: number;
    sheetFor: (userId: string) => unknown;
  };
}

let tmp: string;
beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'player-vault-svc-'));
});
afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

function makeRig(): Rig {
  const root = path.join(tmp, 'vaults');
  const snippetDir = path.join(tmp, 'snippets');
  const calls: string[] = [];
  const sheetCalls: string[] = [];
  const state: Rig['state'] = {
    world: { id: 'w1', title: 'Barovia' },
    players: [ALICE, BOB],
    handouts: [],
    handoutsReady: true,
    theme: 'neutral',
    connected: true,
    sessionLog: [],
    sessionLogFails: 0,
    sheetFor: userId => ({
      userId,
      userName: userId === ALICE.userId ? 'Alice' : 'Bob',
      sheets: [sheet(userId === ALICE.userId ? 'Ireena' : 'Ismark')],
    }),
  };
  const client: PlayerVaultClient = {
    get isConnected(): boolean {
      return state.connected;
    },
    callTool: <T>(name: string): Promise<T> => {
      calls.push(name);
      if (name === 'get-session-log') {
        if (state.sessionLogFails > 0) {
          state.sessionLogFails--;
          return Promise.reject(new Error('bridge busy'));
        }
        return Promise.resolve({ events: state.sessionLog } as T);
      }
      return Promise.reject(new Error(`unexpected tool ${name}`));
    },
    characterSheet: (userId: string): Promise<unknown> => {
      sheetCalls.push(userId);
      try {
        return Promise.resolve(state.sheetFor(userId));
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
  const store = new PlayerLogStore(null, logger);
  const svc = new PlayerVaultService({
    rootDir: root,
    intervalMs: 60_000,
    client,
    logger,
    store,
    world: () => state.world,
    players: () => state.players,
    handouts: () => state.handouts,
    handoutsReady: () => state.handoutsReady,
    theme: () => state.theme,
    snippetDir,
  });
  return { svc, store, root, snippetDir, calls, sheetCalls, state };
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

async function read(root: string, player: string, rel: string): Promise<string> {
  return fsp.readFile(path.join(root, player, ...rel.split('/')), 'utf8');
}

async function exists(file: string): Promise<boolean> {
  try {
    await fsp.stat(file);
    return true;
  } catch {
    return false;
  }
}

const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

describe('PlayerVaultService: writing', () => {
  it('writes one folder per player with a marker and the home note', async () => {
    const rig = makeRig();
    const result = await rig.svc.rebuild();
    expect(result.written.sort()).toEqual(['Alice', 'Bob']);
    expect(result.failed).toEqual([]);
    expect((await fsp.readdir(rig.root)).sort()).toEqual(['Alice', 'Bob']);
    for (const [name, player] of [
      ['Alice', ALICE],
      ['Bob', BOB],
    ] as const) {
      const files = await listFiles(path.join(rig.root, name));
      expect(files).toContain('Home.md');
      expect(files).toContain(PLAYER_MARKER_FILE);
      expect(files).toContain('My character.md');
      const marker = JSON.parse(await read(rig.root, name, PLAYER_MARKER_FILE)) as {
        userId: string;
      };
      expect(marker.userId).toBe(player.userId);
    }
    expect(await read(rig.root, 'Alice', 'My character.md')).toContain('# Ireena');
    expect(await read(rig.root, 'Bob', 'My character.md')).toContain('# Ismark');
  });

  it('a second rebuild with unchanged inputs writes nothing', async () => {
    const rig = makeRig();
    rig.state.handouts = [handout({ title: 'A letter', html: '<p>Dear friends</p>' })];
    await rig.svc.rebuild();
    const aliceHome = path.join(rig.root, 'Alice', 'Home.md');
    const bobHome = path.join(rig.root, 'Bob', 'Home.md');
    const before = [(await fsp.stat(aliceHome)).mtimeMs, (await fsp.stat(bobHome)).mtimeMs];
    const filesBefore = await listFiles(rig.root);
    await pause(30);

    const second = await rig.svc.rebuild();
    expect(second.written).toEqual([]);
    expect(second.unchanged.sort()).toEqual(['Alice', 'Bob']);
    expect(second.failed).toEqual([]);
    expect([(await fsp.stat(aliceHome)).mtimeMs, (await fsp.stat(bobHome)).mtimeMs]).toEqual(
      before
    );
    expect(await listFiles(rig.root)).toEqual(filesBefore);
  });

  it('a new projected event rewrites every player vault', async () => {
    const rig = makeRig();
    await rig.svc.rebuild();
    rig.svc.onEvents([pcRoll('r1', 'Ireena, Longsword attack: 1d20 (15) +5 = 20')]);
    const result = await rig.svc.rebuild();
    expect(result.written.sort()).toEqual(['Alice', 'Bob']);
    const sessions = (await listFiles(path.join(rig.root, 'Alice'))).filter(f =>
      f.startsWith('Session log/')
    );
    expect(sessions).toHaveLength(1);
    expect(await read(rig.root, 'Alice', sessions[0])).toContain('Longsword attack');
    // And then it is quiet again.
    expect((await rig.svc.rebuild()).written).toEqual([]);
  });

  it('an event type players never see is not stored, so nothing is rewritten', async () => {
    const rig = makeRig();
    await rig.svc.rebuild();
    rig.svc.onEvents([gmChange('g1')]);
    expect(rig.store.sessions('w1')).toEqual([]);
    expect((await rig.svc.rebuild()).written).toEqual([]);
  });

  it('a changed handout list rewrites, a removed handout leaves the folder', async () => {
    const rig = makeRig();
    rig.state.handouts = [handout({ title: 'A letter' })];
    await rig.svc.rebuild();
    expect(await listFiles(path.join(rig.root, 'Alice'))).toContain('Handouts/A letter.md');
    rig.state.handouts = [];
    const result = await rig.svc.rebuild();
    expect(result.written.sort()).toEqual(['Alice', 'Bob']);
    expect(await listFiles(path.join(rig.root, 'Alice'))).not.toContain('Handouts/A letter.md');
  });
});

describe('PlayerVaultService: waits for the handouts', () => {
  it('writes nothing until the handout source has answered once', async () => {
    const rig = makeRig();
    rig.state.handoutsReady = false;
    rig.state.handouts = [handout({ title: 'A letter' })];
    rig.svc.onEvents([pcRoll('r1', 'Ireena, Perception: 1d20 = 12')]);
    const early = await rig.svc.rebuild();
    expect(early).toEqual({ written: [], unchanged: [], failed: [], waiting: true });
    expect(await exists(rig.root)).toBe(false);
    expect(rig.sheetCalls).toEqual([]);
    // The log is still collected while it waits.
    expect(rig.store.sessions('w1')).toHaveLength(1);

    rig.state.handoutsReady = true;
    const ready = await rig.svc.rebuild();
    expect(ready.waiting).toBeUndefined();
    expect(ready.written.sort()).toEqual(['Alice', 'Bob']);
    expect(await listFiles(path.join(rig.root, 'Alice'))).toContain('Handouts/A letter.md');
  });

  it("asks for each player's own handouts", async () => {
    const rig = makeRig();
    const asked: string[] = [];
    const svc = new PlayerVaultService({
      rootDir: rig.root,
      intervalMs: 60_000,
      client: { callTool: (): Promise<never> => Promise.resolve({ events: [] }) as never },
      logger,
      store: rig.store,
      world: (): { id: string; title: string } | null => rig.state.world,
      players: (): VaultPlayer[] => rig.state.players,
      handouts: (userId: string): PlayerHandout[] => {
        asked.push(userId);
        return [handout({ title: userId === ALICE.userId ? 'For Alice' : 'For Bob' })];
      },
      theme: (): ThemeId => 'neutral',
      snippetDir: rig.snippetDir,
    });
    await svc.rebuild();
    expect(asked.sort()).toEqual([ALICE.userId, BOB.userId]);
    expect(await listFiles(path.join(rig.root, 'Alice'))).toContain('Handouts/For Alice.md');
    expect(await listFiles(path.join(rig.root, 'Alice'))).not.toContain('Handouts/For Bob.md');
    expect(await listFiles(path.join(rig.root, 'Bob'))).toContain('Handouts/For Bob.md');
  });
});

describe('PlayerVaultService: a player whose sheet cannot be read', () => {
  it('is skipped with the folder untouched while the others are written', async () => {
    const rig = makeRig();
    await rig.svc.rebuild();
    const before = await read(rig.root, 'Alice', 'Home.md');
    const aliceFilesBefore = await listFiles(path.join(rig.root, 'Alice'));

    rig.svc.onEvents([pcRoll('r1', 'Ireena, Stealth check: 1d20 (9) +3 = 12')]);
    rig.state.sheetFor = (userId: string): unknown => {
      if (userId === ALICE.userId) throw new Error('character_sheet failed');
      return { userId, userName: 'Bob', sheets: [sheet('Ismark')] };
    };
    const result = await rig.svc.rebuild();
    expect(result.failed).toEqual(['Alice']);
    expect(result.written).toEqual(['Bob']);
    expect(await listFiles(path.join(rig.root, 'Alice'))).toEqual(aliceFilesBefore);
    expect(await read(rig.root, 'Alice', 'Home.md')).toBe(before);
    const bobFiles = await listFiles(path.join(rig.root, 'Bob'));
    expect(bobFiles.some(f => f.startsWith('Session log/'))).toBe(true);
    expect(await listFiles(path.join(rig.root, 'Alice'))).not.toContain(
      bobFiles.find(f => f.startsWith('Session log/'))
    );
  });

  it('a different userId in the answer is refused (no folder is made for that player)', async () => {
    const rig = makeRig();
    rig.state.sheetFor = (userId: string): unknown => ({
      // Alice's call answers with Bob's sheets: it must not be written into Alice's vault.
      userId: userId === ALICE.userId ? BOB.userId : userId,
      userName: 'x',
      sheets: [sheet(userId === ALICE.userId ? 'BOB-SECRET-CHARACTER' : 'Ismark')],
    });
    const result = await rig.svc.rebuild();
    expect(result.failed).toEqual(['Alice']);
    expect(result.written).toEqual(['Bob']);
    expect(await fsp.readdir(rig.root)).toEqual(['Bob']);
    for (const file of await listFiles(rig.root)) {
      expect(await fsp.readFile(path.join(rig.root, file), 'utf8')).not.toContain(
        'BOB-SECRET-CHARACTER'
      );
    }
  });

  it('a malformed answer (no sheets array, not an object) is refused', async () => {
    const rig = makeRig();
    rig.state.sheetFor = (userId: string): unknown =>
      userId === ALICE.userId ? { userId, sheets: 'nope' } : userId === BOB.userId ? null : null;
    const result = await rig.svc.rebuild();
    expect(result.failed.sort()).toEqual(['Alice', 'Bob']);
    expect(result.written).toEqual([]);
    expect(await exists(rig.root)).toBe(false);
  });

  it('recovers on the next pass once the bridge answers again', async () => {
    const rig = makeRig();
    rig.state.sheetFor = (): unknown => {
      throw new Error('down');
    };
    expect((await rig.svc.rebuild()).failed.sort()).toEqual(['Alice', 'Bob']);
    rig.state.sheetFor = (userId: string): unknown => ({
      userId,
      userName: 'x',
      sheets: [sheet('Ireena')],
    });
    expect((await rig.svc.rebuild()).written.sort()).toEqual(['Alice', 'Bob']);
  });
});
