// The Scene mood panel's words and small rules (item dashboard-mood-presets): read the answer of
// list-scene-moods, the plan-scene-mood arguments for one preset, the confirm question, what a
// preset sets, and which switches keep the buttons off. Pure; components/SceneMoodPanel.tsx draws
// it and sends nothing from here.
import { SCENE_MOOD_FEATURE_ID } from '../../../../../shared/src/scene-mood.js';
import type { SceneMoodPreset } from '../../../../../shared/src/scene-mood.js';
import { featureOffMessage } from '../../../../../shared/src/switch-off.js';

import type { FeatureList } from './switchOff';

export { SCENE_MOOD_FEATURE_ID };

/** The switch as Foundry's Game Settings name it, when the feature list does not say. */
export const SCENE_MOOD_SWITCH = 'AI Tool: Scene mood and music (writes)';

/** The viewed scene's presets and how it looks now, as the panel shows them. */
export interface MoodList {
  /** The scene the presets belong to; '' when the bridge did not say. */
  sceneId: string;
  sceneName: string;
  presets: SceneMoodPreset[];
  current: { darkness: number; globalLight: boolean; weather: string } | null;
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** One preset from the answer, or null when it has no name. Unknown fields are dropped. */
function readPreset(raw: unknown): SceneMoodPreset | null {
  if (!isRecord(raw) || typeof raw.name !== 'string' || raw.name.trim() === '') return null;
  const preset: SceneMoodPreset = { name: raw.name };
  if (typeof raw.darkness === 'number') preset.darkness = raw.darkness;
  if (typeof raw.globalLight === 'boolean') preset.globalLight = raw.globalLight;
  if (typeof raw.weather === 'string') preset.weather = raw.weather;
  if (typeof raw.playlist === 'string') preset.playlist = raw.playlist;
  return preset;
}

/** The answer of list-scene-moods, checked; null when it is not one. */
export function readMoods(raw: unknown): MoodList | null {
  if (!isRecord(raw) || !Array.isArray(raw.presets)) return null;
  const presets = raw.presets
    .map(readPreset)
    .filter((p): p is SceneMoodPreset => p !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  const c = raw.current;
  const current = isRecord(c)
    ? {
        darkness: typeof c.darkness === 'number' ? c.darkness : 0,
        globalLight: c.globalLight === true,
        weather: typeof c.weather === 'string' ? c.weather : '',
      }
    : null;
  return {
    sceneId: typeof raw.sceneId === 'string' ? raw.sceneId : '',
    sceneName: typeof raw.sceneName === 'string' && raw.sceneName ? raw.sceneName : 'this scene',
    presets,
    current,
  };
}

/** The plan-scene-mood arguments that apply one saved preset to the viewed scene. */
export function moodPlanArgs(preset: string): Record<string, unknown> {
  return { action: 'apply', preset };
}

const weatherWords = (w: string): string => (w === '' || w === 'none' ? 'clear' : w);

/** What a preset sets, for its button's tooltip: "darkness 0.8, weather rain, music Storm". */
export function presetDetails(p: SceneMoodPreset): string {
  const parts: string[] = [];
  if (p.darkness !== undefined) parts.push(`darkness ${p.darkness}`);
  if (p.globalLight !== undefined) parts.push(`global light ${p.globalLight ? 'on' : 'off'}`);
  if (p.weather !== undefined) parts.push(`weather ${weatherWords(p.weather)}`);
  if (p.playlist !== undefined) {
    parts.push(p.playlist === 'none' ? 'music stops' : `music ${p.playlist}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'Changes nothing';
}

/** How the scene looks now: "Now: darkness 0.2, global light off, weather clear." */
export function currentText(current: MoodList['current']): string {
  if (!current) return '';
  return `Now: darkness ${current.darkness}, global light ${current.globalLight ? 'on' : 'off'}, weather ${weatherWords(current.weather)}.`;
}

/** The confirm question, from the plan's own summary (it names the preset and the scene). */
export function moodQuestion(summary: string | null, preset: string): string {
  const head = summary ? `${summary}?` : `Apply the mood "${preset}"?`;
  return `${head} Undo stays in Recent Changes.`;
}

/** Which switches keep the mood buttons off, and the sentence for the module's own switch. */
export interface MoodOff {
  /** Short names, as the other gated controls list them ("GM Actions", "Scene mood and music"). */
  names: string[];
  /** Where to turn the module's switch on, or null when it is on (or cannot be read). */
  note: string | null;
}

/**
 * The switches that are off: `liveOff` (GM Actions and writes, from the session switches, which
 * the panel's own Turn on keeps current) and the module's "Scene mood and music" switch from GET
 * /api/features. Only that one entry is read from the feature list: its `writesAllowed` is a
 * second, older copy of the writes switch and would stay stale after Turn on. A feature list that
 * cannot be read adds nothing: the plan then says so itself, as a hint toast.
 */
export function moodOff(liveOff: readonly string[], features: FeatureList | null): MoodOff {
  const names = [...liveOff];
  let note: string | null = null;
  const feature = features?.features?.find(f => f.id === SCENE_MOOD_FEATURE_ID);
  if (feature && !feature.enabled) {
    const full = feature.name || SCENE_MOOD_SWITCH;
    names.push(full.replace(/^AI Tool: /, '').replace(/ \(writes\)$/, ''));
    note = featureOffMessage(full);
  }
  return { names, note };
}
