/**
 * `planSceneMood` and `getSceneMoods` (I-034, I-129): read-only planners behind the `scene-mood`
 * feature. Driven through the Foundry-mock harness with playlists added by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SCENE_MOOD_FEATURE_ID as SHARED_FEATURE,
  SCENE_MOOD_FLAG as SHARED_FLAG,
  SCENE_MOOD_PLAN_QUERY as SHARED_PLAN,
  SCENE_MOODS_QUERY as SHARED_LIST,
} from '../../../shared/src/scene-mood.js';
import { MODULE_ID } from './constants.js';
import {
  getSceneMoods,
  planSceneMood,
  presetKey,
  SCENE_MOOD_FEATURE_ID,
  SCENE_MOOD_FLAG,
  SCENE_MOOD_PLAN_QUERY,
  SCENE_MOODS_QUERY,
} from './scene-mood.js';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { NON_WRITE_METHODS, WRITE_METHODS } from './write-gate.js';

let world: TestWorld;
let restore: () => void;
let scene: any;

function sound(id: string, playing = false): any {
  return { id, uuid: `Playlist.pl1.PlaylistSound.${id}`, playing };
}
function playlist(id: string, name: string, sounds: any[], extra: any = {}): any {
  return {
    id,
    name,
    uuid: `Playlist.${id}`,
    mode: 1,
    playing: sounds.some(s => s.playing),
    playbackOrder: sounds.map(s => s.id),
    sounds: { contents: sounds },
    ...extra,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  scene = world.addScene({
    id: 's1',
    name: 'Tavern',
    uuid: 'Scene.s1',
    active: true,
    tokens: [],
  });
  world.setActiveScene(scene.id);
  scene.environment = { darknessLevel: 0.2, darknessLock: false, globalLight: { enabled: false } };
  scene.weather = '';
  scene.flags = {};
  (game as any).playlists = {
    contents: [
      playlist('pl1', 'Tavern', [sound('a'), sound('b')]),
      playlist('pl2', 'Crypt', [{ ...sound('c', true), uuid: 'Playlist.pl2.PlaylistSound.c' }], {
        playing: true,
      }),
    ],
  };
});
afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

describe('names and classification', () => {
  it('mirrors the shared names; both queries are reads', () => {
    expect(SCENE_MOOD_FEATURE_ID).toBe(SHARED_FEATURE);
    expect(SCENE_MOOD_FLAG).toBe(SHARED_FLAG);
    expect(SCENE_MOOD_PLAN_QUERY).toBe(SHARED_PLAN);
    expect(SCENE_MOODS_QUERY).toBe(SHARED_LIST);
    for (const m of [SCENE_MOOD_PLAN_QUERY, SCENE_MOODS_QUERY]) {
      expect(NON_WRITE_METHODS).toContain(m);
      expect(WRITE_METHODS).not.toContain(m);
    }
  });

  it('turns a preset name into a flag-safe key', () => {
    expect(presetKey(' Crypt, deep & dark! ')).toBe('crypt-deep-dark');
    expect(() => presetKey('...')).toThrow(/name/);
  });
});

describe('set', () => {
  it('builds one scene update with the lock re-sent, and switches the music', () => {
    const plan = planSceneMood({
      action: 'set',
      darkness: 3,
      globalLight: true,
      weather: 'rain',
      playlist: 'Tavern',
    });
    expect(plan.ops[0]).toEqual({
      kind: 'update',
      uuid: 'Scene.s1',
      changes: {
        'environment.darknessLevel': 1,
        'environment.darknessLock': false,
        'environment.globalLight.enabled': true,
        weather: 'rain',
      },
    });
    // the Crypt sound and playlist stop, the Tavern first sound and playlist start
    expect(plan.ops.slice(1)).toEqual([
      { kind: 'update', uuid: 'Playlist.pl2.PlaylistSound.c', changes: { playing: false } },
      { kind: 'update', uuid: 'Playlist.pl2', changes: { playing: false } },
      { kind: 'update', uuid: 'Playlist.pl1.PlaylistSound.a', changes: { playing: true } },
      { kind: 'update', uuid: 'Playlist.pl1', changes: { playing: true } },
    ]);
    expect(plan.summary).toContain('darkness 1');
  });

  it('"none" clears the weather and stops all music', () => {
    const plan = planSceneMood({ action: 'set', weather: 'none', playlist: 'none' });
    expect(plan.ops[0]).toMatchObject({ changes: { weather: '' } });
    expect(plan.ops).toHaveLength(3);
  });

  it('refuses an empty request and an unknown playlist', () => {
    expect(() => planSceneMood({ action: 'set' })).toThrow(/Give darkness/);
    expect(() => planSceneMood({ action: 'set', playlist: 'Nope' })).toThrow(/Playlist not found/);
  });
});

describe('presets', () => {
  it('saves values on the scene flag', () => {
    const plan = planSceneMood({
      action: 'save',
      preset: 'Crypt',
      darkness: 0.9,
      playlist: 'Crypt',
    });
    expect(plan.ops).toEqual([
      {
        kind: 'update',
        uuid: 'Scene.s1',
        changes: {
          [`flags.${MODULE_ID}.moods.crypt`]: JSON.stringify({
            name: 'Crypt',
            darkness: 0.9,
            playlist: 'Crypt',
          }),
        },
      },
    ]);
  });

  it('saves the current look with fromCurrent', () => {
    const plan = planSceneMood({ action: 'save', preset: 'As is', fromCurrent: true });
    const saved = (plan.ops[0] as any).changes[`flags.${MODULE_ID}.moods.as-is`];
    expect(JSON.parse(saved as string)).toEqual({
      name: 'As is',
      darkness: 0.2,
      globalLight: false,
      weather: '',
      playlist: 'Crypt',
    });
  });

  it('replaces a preset whole: stored as one string, so no old field survives the merge', () => {
    scene.flags[MODULE_ID] = {
      moods: { crypt: JSON.stringify({ name: 'Crypt', darkness: 0.9, playlist: 'Crypt' }) },
    };
    const plan = planSceneMood({ action: 'save', preset: 'Crypt', darkness: 0.5 });
    expect(plan.summary).toMatch(/^Replace/);
    const value = (plan.ops[0] as any).changes[`flags.${MODULE_ID}.moods.crypt`];
    expect(typeof value).toBe('string');
    expect(JSON.parse(value as string)).toEqual({ name: 'Crypt', darkness: 0.5 });
  });

  it('does not find inherited names such as "constructor" as presets', () => {
    expect(() => planSceneMood({ action: 'apply', preset: 'constructor' })).toThrow(
      /No mood preset/
    );
  });

  it('applies a saved preset, lists it and removes it', () => {
    scene.flags[MODULE_ID] = {
      moods: { crypt: JSON.stringify({ name: 'Crypt', darkness: 0.9 }) },
    };
    const apply = planSceneMood({ action: 'apply', preset: 'crypt' });
    expect(apply.ops[0]).toMatchObject({ changes: { 'environment.darknessLevel': 0.9 } });
    expect(getSceneMoods().presets).toEqual([{ name: 'Crypt', darkness: 0.9 }]);
    const removal = planSceneMood({ action: 'remove-preset', preset: 'Crypt' });
    expect(removal.ops).toEqual([
      { kind: 'update', uuid: 'Scene.s1', changes: {}, unset: [`flags.${MODULE_ID}.moods.crypt`] },
    ]);
    expect(() => planSceneMood({ action: 'apply', preset: 'Nope' })).toThrow(/No mood preset/);
  });
});

describe('music', () => {
  it('stops a playing playlist and refuses when nothing plays', () => {
    const stop = planSceneMood({ action: 'music', playlist: 'Crypt', mode: 'stop' });
    expect(stop.ops).toHaveLength(2);
    expect(() => planSceneMood({ action: 'music', playlist: 'Tavern', mode: 'stop' })).toThrow(
      /not playing/
    );
  });

  it('play adds to what plays, switch replaces it', () => {
    expect(planSceneMood({ action: 'music', playlist: 'tavern', mode: 'play' }).ops).toHaveLength(
      2
    );
    expect(planSceneMood({ action: 'music', playlist: 'tavern' }).ops).toHaveLength(4);
    expect(() => planSceneMood({ action: 'music', playlist: 'Crypt', mode: 'play' })).toThrow(
      /already playing/
    );
  });

  it('plays every sound of a simultaneous playlist', () => {
    (game as any).playlists.contents[0].mode = 2;
    (globalThis as any).CONST = { PLAYLIST_MODES: { SIMULTANEOUS: 2 } };
    try {
      const plan = planSceneMood({ action: 'music', playlist: 'Tavern', mode: 'play' });
      expect(plan.ops).toHaveLength(3);
    } finally {
      delete (globalThis as any).CONST;
    }
  });
});

describe('locked audio', () => {
  it('refuses music changes until the browser unlocked audio, but not looks or presets', () => {
    (game as any).audio = { locked: true };
    try {
      expect(() => planSceneMood({ action: 'music', playlist: 'Tavern' })).toThrow(
        /unlocked audio/
      );
      expect(() => planSceneMood({ action: 'set', playlist: 'Tavern' })).toThrow(/unlocked audio/);
      expect(planSceneMood({ action: 'set', weather: 'rain' }).ops).toHaveLength(1);
      expect(planSceneMood({ action: 'save', preset: 'X', playlist: 'Tavern' }).ops).toHaveLength(
        1
      );
    } finally {
      delete (game as any).audio;
    }
  });
});

describe('getSceneMoods', () => {
  it('reports the look and the playlists', () => {
    expect(getSceneMoods()).toMatchObject({
      sceneName: 'Tavern',
      current: { darkness: 0.2, globalLight: false, weather: '' },
      playlists: [
        { name: 'Tavern', sounds: 2, playing: false },
        { name: 'Crypt', sounds: 1, playing: true },
      ],
    });
  });
});
