/**
 * Ready for session (D3, PB-17): Ready turns on what is off and remembers it; End turns off
 * only that; Foundry dropping a write is reported, not hidden.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { featureSettingKey, resetGuardedFeaturesForTests } from './guarded-features.js';
import {
  SESSION_READY_SETTING,
  sessionSwitches,
  type SessionSwitchesResult,
} from './session-switches.js';

const MODULE_ID = 'foundry-mcp-bridge';
const g = globalThis as any;

let world: TestWorld;
let restore: () => void;

const HANDOUTS = featureSettingKey('handouts');
const LIVE = featureSettingKey('live-play');
const PARTY = featureSettingKey('party');
const TAROKKA = featureSettingKey('tarokka');

function setAll(
  writes: boolean,
  handouts: boolean,
  live: boolean,
  party: boolean,
  tarokka = false
): void {
  world.setSetting(MODULE_ID, 'allowWriteOperations', writes);
  world.setSetting(MODULE_ID, HANDOUTS, handouts);
  world.setSetting(MODULE_ID, LIVE, live);
  world.setSetting(MODULE_ID, PARTY, party);
  world.setSetting(MODULE_ID, TAROKKA, tarokka);
}

const on = (r: SessionSwitchesResult): string[] => r.switches.filter(s => s.on).map(s => s.id);

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
  resetGuardedFeaturesForTests();
});

afterEach(() => {
  restore();
});

describe('sessionSwitches', () => {
  it('get lists the five switches and no Ready record', async () => {
    setAll(true, false, true, false);
    const r = await sessionSwitches({});
    expect(r.switches.map(s => s.id)).toEqual([
      'writes',
      'handouts',
      'live-play',
      'party',
      'tarokka',
    ]);
    expect(r.switches[0]?.name).toBe('Allow Write Operations');
    expect(on(r)).toEqual(['writes', 'live-play']);
    expect(r.ready).toBeNull();
    expect(r.changed).toEqual([]);
  });

  it('ready turns on only what is off and remembers it', async () => {
    setAll(true, false, true, false);
    const r = await sessionSwitches({ action: 'ready' });
    expect(on(r)).toEqual(['writes', 'handouts', 'live-play', 'party', 'tarokka']);
    expect(r.changed).toEqual(['handouts', 'party', 'tarokka']);
    expect(r.ready?.turnedOn).toEqual(['handouts', 'party', 'tarokka']);
    expect(r.ready?.at).toBeGreaterThan(0);
  });

  it('end turns off only what Ready turned on, then forgets it', async () => {
    setAll(false, false, true, false);
    await sessionSwitches({ action: 'ready' });
    const r = await sessionSwitches({ action: 'end' });
    expect(r.changed).toEqual(['tarokka', 'party', 'handouts', 'writes']);
    expect(on(r)).toEqual(['live-play']);
    expect(r.ready).toBeNull();
    expect(world.settings.get(`${MODULE_ID}.${SESSION_READY_SETTING}`)).toBeNull();
  });

  it('a second ready keeps what the first one turned on', async () => {
    setAll(true, false, true, true, true);
    await sessionSwitches({ action: 'ready' });
    world.setSetting(MODULE_ID, PARTY, false); // the GM turns party off by hand
    const r = await sessionSwitches({ action: 'ready' });
    expect(r.ready?.turnedOn).toEqual(['handouts', 'party']);
  });

  it('end without Ready changes nothing', async () => {
    setAll(true, true, true, true, true);
    const r = await sessionSwitches({ action: 'end' });
    expect(r.changed).toEqual([]);
    expect(on(r)).toHaveLength(5);
  });

  it('reports a switch Foundry did not change', async () => {
    setAll(true, false, true, true, true);
    const realSet = g.game.settings.set as (m: string, k: string, v: unknown) => Promise<unknown>;
    g.game.settings.set = (moduleId: string, key: string, value: unknown): Promise<unknown> =>
      key === HANDOUTS ? Promise.resolve(value) : realSet(moduleId, key, value);
    const r = await sessionSwitches({ action: 'ready' });
    expect(r.failed).toEqual(['handouts']);
    expect(r.changed).toEqual([]);
    expect(r.ready?.turnedOn).toEqual([]);
  });

  it('refuses a non-GM client and an unknown action', async () => {
    await expect(sessionSwitches({ action: 'nope' })).rejects.toThrow(/Unknown action/);
    g.game.user = { ...g.game.user, isGM: false };
    await expect(sessionSwitches({ action: 'ready' })).rejects.toThrow(/Only a GM/);
  });
});
