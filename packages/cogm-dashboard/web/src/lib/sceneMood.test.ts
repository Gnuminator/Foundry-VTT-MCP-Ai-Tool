import { describe, expect, it } from 'vitest';

import {
  currentText,
  moodOff,
  moodPlanArgs,
  moodQuestion,
  presetDetails,
  readMoods,
} from './sceneMood';

const FEATURE = { id: 'scene-mood', name: 'AI Tool: Scene mood and music (writes)', enabled: true };

describe('readMoods', () => {
  it('reads the presets sorted by name, the scene and how it looks now', () => {
    const list = readMoods({
      sceneId: 's1',
      sceneName: 'Village',
      presets: [
        { name: 'Storm', darkness: 0.8, weather: 'rain', extra: 1 },
        { name: 'Calm', globalLight: true },
      ],
      current: { darkness: 0.2, globalLight: false, weather: '' },
      playlists: [],
    });
    expect(list).toEqual({
      sceneId: 's1',
      sceneName: 'Village',
      presets: [
        { name: 'Calm', globalLight: true },
        { name: 'Storm', darkness: 0.8, weather: 'rain' },
      ],
      current: { darkness: 0.2, globalLight: false, weather: '' },
    });
  });

  it('drops presets without a name and is null for an answer that is not a list', () => {
    expect(readMoods({ presets: [{ name: '' }, { darkness: 1 }, 'x'] })?.presets).toEqual([]);
    expect(readMoods({ presets: [] })?.sceneName).toBe('this scene');
    expect(readMoods(null)).toBeNull();
    expect(readMoods({ sceneName: 'Village' })).toBeNull();
  });
});

describe('moodPlanArgs', () => {
  it('applies one saved preset', () => {
    expect(moodPlanArgs('Storm')).toEqual({ action: 'apply', preset: 'Storm' });
  });
});

describe('presetDetails and currentText', () => {
  it('says what a preset sets, in plain words', () => {
    expect(
      presetDetails({
        name: 'Storm',
        darkness: 0.8,
        globalLight: false,
        weather: 'rain',
        playlist: 'Thunder',
      })
    ).toBe('darkness 0.8, global light off, weather rain, music Thunder');
    expect(presetDetails({ name: 'Quiet', weather: 'none', playlist: 'none' })).toBe(
      'weather clear, music stops'
    );
    expect(presetDetails({ name: 'Empty' })).toBe('Changes nothing');
  });

  it('says how the scene looks now, or nothing when unknown', () => {
    expect(currentText({ darkness: 0, globalLight: true, weather: 'fog' })).toBe(
      'Now: darkness 0, global light on, weather fog.'
    );
    expect(currentText(null)).toBe('');
  });
});

describe('moodQuestion', () => {
  it("asks with the plan's own summary, or with the preset's name", () => {
    expect(moodQuestion('Apply mood "Storm" on "Village": darkness 0.8', 'Storm')).toBe(
      'Apply mood "Storm" on "Village": darkness 0.8? Undo stays in Recent Changes.'
    );
    expect(moodQuestion(null, 'Storm')).toBe(
      'Apply the mood "Storm"? Undo stays in Recent Changes.'
    );
  });
});

describe('moodOff', () => {
  it('is empty when every switch is on or the features cannot be read', () => {
    expect(moodOff([], { features: [FEATURE], writesAllowed: true })).toEqual({
      names: [],
      note: null,
    });
    expect(moodOff([], null)).toEqual({ names: [], note: null });
    expect(moodOff([], { features: null, writesAllowed: null })).toEqual({
      names: [],
      note: null,
    });
  });

  it('names the module switch and where to turn it on', () => {
    const off = moodOff([], { features: [{ ...FEATURE, enabled: false }], writesAllowed: true });
    expect(off.names).toEqual(['Scene mood and music']);
    expect(off.note).toBe(
      '"AI Tool: Scene mood and music (writes)" is switched off. In Foundry, open the Settings tab, Game Settings, Foundry AI Tool and turn on "AI Tool: Scene mood and music (writes)".'
    );
  });

  it('keeps the session switches first and leaves writes to them', () => {
    expect(
      moodOff(['GM Actions', 'Allow Write Operations'], {
        features: [{ ...FEATURE, enabled: false }],
        writesAllowed: false,
      }).names
    ).toEqual(['GM Actions', 'Allow Write Operations', 'Scene mood and music']);
    // A stale writesAllowed copy never adds a reason of its own (it outlived Turn on).
    expect(moodOff([], { features: [FEATURE], writesAllowed: false }).names).toEqual([]);
  });
});
