/**
 * Scene mood presets and scene music (I-034, I-129): the module's read-only `planSceneMood` query
 * turns one request into generic guarded ops on the viewed scene and on playlists, and
 * `getSceneMoods` lists the presets and playlists. Nothing is written here; the backend stores the
 * ops as a plan under the feature `scene-mood` (off by default) and the guarded-write system
 * applies and undoes them.
 *
 * The wire contract is `shared/src/scene-mood.ts`; only its types are imported (the browser
 * cannot resolve `@gnuminator/shared` at runtime). The names are mirrored here and pinned by
 * `scene-mood.test.ts`.
 */
import type {
  GuardedOp,
  SceneMoodPlan,
  SceneMoodPlanRequest,
  SceneMoodPreset,
  SceneMoodSettings,
  SceneMoodsReply,
} from '@gnuminator/shared';

import { MODULE_ID } from './constants.js';
import { requireCurrentScene } from './scene-plan-geometry.js';

type Collection<T> = { contents?: T[] } | T[] | undefined;
interface SoundLike {
  id: string;
  uuid: string;
  playing?: boolean;
}
interface PlaylistLike {
  id: string;
  uuid: string;
  name: string;
  mode?: number;
  playing?: boolean;
  playbackOrder?: string[];
  sounds?: Collection<SoundLike>;
}
interface SceneLike {
  id: string;
  uuid: string;
  name: string;
  weather?: string;
  environment?: {
    darknessLevel?: number;
    darknessLock?: boolean;
    globalLight?: { enabled?: boolean };
  };
  flags?: Record<string, Record<string, unknown> | undefined>;
  getFlag?: (scope: string, key: string) => unknown;
}

export const SCENE_MOOD_PLAN_QUERY = 'planSceneMood';
export const SCENE_MOODS_QUERY = 'getSceneMoods';
export const SCENE_MOOD_FEATURE_ID = 'scene-mood';
export const SCENE_MOOD_FLAG = 'moods';

const SETTING_KEYS = ['darkness', 'globalLight', 'weather', 'playlist'] as const;

/** The flag key of a preset name: lower case letters, digits and dashes (a dot would split the path). */
export function presetKey(name: string): string {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!key) throw new Error('Give the preset a name with letters or digits.');
  return key;
}

function quoted(name: unknown): string {
  return `"${typeof name === 'string' ? name : ''}"`;
}

function contentsOf<T>(collection: Collection<T>): T[] {
  if (Array.isArray(collection)) return collection;
  return collection?.contents ?? [];
}

function playlists(): PlaylistLike[] {
  return contentsOf((game as unknown as { playlists?: Collection<PlaylistLike> }).playlists);
}

function findPlaylist(name: string): PlaylistLike {
  const lowered = name.toLowerCase();
  const found = playlists().find(
    (p: PlaylistLike) => p.name?.toLowerCase() === lowered || p.id === name
  );
  if (!found) {
    const names = playlists()
      .map((p: PlaylistLike) => quoted(p.name))
      .join(', ');
    throw new Error(`Playlist not found: ${name}. Playlists: ${names || 'none'}.`);
  }
  return found;
}

function savedPresets(scene: SceneLike): Record<string, SceneMoodPreset> {
  const raw =
    scene.getFlag?.(MODULE_ID, SCENE_MOOD_FLAG) ?? scene.flags?.[MODULE_ID]?.[SCENE_MOOD_FLAG];
  const out: Record<string, SceneMoodPreset> = {};
  if (!raw || typeof raw !== 'object') return out;
  // Each preset is stored as a JSON string: Foundry merges object updates, so a saved object
  // would keep the fields of the preset it replaces (and undo would not restore it exactly).
  for (const [key, value] of Object.entries(raw)) {
    try {
      const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
      if (parsed && typeof parsed === 'object') out[key] = parsed as SceneMoodPreset;
    } catch {
      // an unreadable entry is skipped
    }
  }
  return out;
}

function findPreset(scene: SceneLike, name: string): { key: string; preset: SceneMoodPreset } {
  const presets = savedPresets(scene);
  const key = presetKey(name);
  const preset = Object.hasOwn(presets, key) ? presets[key] : undefined;
  if (!preset) {
    const names = Object.values(presets)
      .map(p => quoted(p.name))
      .join(', ');
    throw new Error(
      `No mood preset ${quoted(name)} on ${quoted(scene.name)}. Saved: ${names || 'none'}.`
    );
  }
  return { key, preset };
}

function isPlaying(playlist: PlaylistLike): boolean {
  return Boolean(playlist.playing) || contentsOf(playlist.sounds).some((s: SoundLike) => s.playing);
}

/** A playlist `play` and `switch` can start: a soundboard playlist (mode -1) cannot play as a whole. */
function isSoundboard(playlist: PlaylistLike): boolean {
  const consts = (globalThis as { CONST?: { PLAYLIST_MODES?: { DISABLED?: number } } }).CONST;
  return playlist.mode === (consts?.PLAYLIST_MODES?.DISABLED ?? -1);
}

function findPlayablePlaylist(name: string): PlaylistLike {
  const playlist = findPlaylist(name);
  if (isSoundboard(playlist)) {
    throw new Error(
      `Playlist ${quoted(playlist.name)} is a soundboard: its sounds are played one by one, not as a playlist. Pick another playlist.`
    );
  }
  return playlist;
}

/** The sounds `play` starts: all in a simultaneous playlist, else the first of the play order. */
function soundsToStart(playlist: PlaylistLike): SoundLike[] {
  const sounds = contentsOf(playlist.sounds);
  if (sounds.length === 0) throw new Error(`Playlist ${quoted(playlist.name)} has no sounds.`);
  const consts = (globalThis as { CONST?: { PLAYLIST_MODES?: { SIMULTANEOUS?: number } } }).CONST;
  const simultaneous = consts?.PLAYLIST_MODES?.SIMULTANEOUS ?? 2;
  if (playlist.mode === simultaneous) return sounds;
  const order: string[] = playlist.playbackOrder ?? [];
  const first = order.length > 0 ? sounds.find((s: SoundLike) => s.id === order[0]) : undefined;
  return [first ?? sounds[0]];
}

function stopOps(playlist: PlaylistLike): GuardedOp[] {
  const ops: GuardedOp[] = [];
  for (const sound of contentsOf(playlist.sounds)) {
    if (sound.playing) {
      ops.push({ kind: 'update', uuid: sound.uuid, changes: { playing: false } });
    }
  }
  if (playlist.playing) {
    ops.push({ kind: 'update', uuid: playlist.uuid, changes: { playing: false } });
  }
  return ops;
}

function startOps(playlist: PlaylistLike): GuardedOp[] {
  const consts = (globalThis as { CONST?: { PLAYLIST_MODES?: { SIMULTANEOUS?: number } } }).CONST;
  const simultaneous = playlist.mode === (consts?.PLAYLIST_MODES?.SIMULTANEOUS ?? 2);
  // A sequential or shuffle playlist that is already on some track keeps it: starting the first
  // sound too would play two tracks at once.
  const alreadyOnTrack = !simultaneous && contentsOf(playlist.sounds).some(s => s.playing);
  const ops: GuardedOp[] = (alreadyOnTrack ? [] : soundsToStart(playlist))
    .filter((s: SoundLike) => !s.playing)
    .map(
      (s: SoundLike): GuardedOp => ({
        kind: 'update',
        uuid: s.uuid,
        changes: { playing: true },
      })
    );
  if (!playlist.playing) {
    ops.push({ kind: 'update', uuid: playlist.uuid, changes: { playing: true } });
  }
  return ops;
}

/** Stop everything that plays, then start `target` (or nothing for "none"). */
function switchOps(target: PlaylistLike | null): GuardedOp[] {
  const ops: GuardedOp[] = [];
  for (const other of playlists()) {
    if (other !== target && other.id !== target?.id && isPlaying(other))
      ops.push(...stopOps(other));
  }
  if (target) ops.push(...startOps(target));
  return ops;
}

/** Refuse a weather id Foundry does not know (it would be stored and show nothing). */
function checkWeather(id: string): string {
  const effects = (globalThis as { CONFIG?: { weatherEffects?: Record<string, unknown> } }).CONFIG
    ?.weatherEffects;
  if (!effects || typeof effects !== 'object') return id;
  const known = Object.keys(effects);
  const found = known.find(k => k.toLowerCase() === id.toLowerCase());
  if (!found) {
    throw new Error(
      `Unknown weather ${quoted(id)}. Valid: ${known.join(', ')}, or "none" to clear.`
    );
  }
  return found;
}

function validated(settings: SceneMoodSettings): SceneMoodSettings {
  const out: SceneMoodSettings = {};
  if (settings.darkness != null) {
    if (!Number.isFinite(settings.darkness)) throw new Error('darkness must be a number 0 to 1.');
    out.darkness = Math.max(0, Math.min(1, settings.darkness));
  }
  if (settings.globalLight != null) out.globalLight = Boolean(settings.globalLight);
  if (typeof settings.weather === 'string') {
    const weather = settings.weather.trim();
    out.weather = weather.toLowerCase() === 'none' ? '' : weather;
    if (out.weather) out.weather = checkWeather(out.weather);
  }
  if (typeof settings.playlist === 'string' && settings.playlist.trim()) {
    out.playlist = settings.playlist.trim();
  }
  return out;
}

function describe(s: SceneMoodSettings): string[] {
  const parts: string[] = [];
  if (s.darkness != null) parts.push(`darkness ${s.darkness}`);
  if (s.globalLight != null) parts.push(`global light ${s.globalLight ? 'on' : 'off'}`);
  if (s.weather != null) parts.push(s.weather ? `weather ${s.weather}` : 'clear weather');
  if (s.playlist != null) {
    parts.push(s.playlist.toLowerCase() === 'none' ? 'music off' : `music ${quoted(s.playlist)}`);
  }
  return parts;
}

/** Ops that bring the scene and the music to `settings`. */
function moodOps(scene: SceneLike, settings: SceneMoodSettings): GuardedOp[] {
  const ops: GuardedOp[] = [];
  const changes: Record<string, unknown> = {};
  if (settings.darkness != null) {
    changes['environment.darknessLevel'] = settings.darkness;
    // Foundry 14 drops a darkness update on a locked scene unless the lock is sent too.
    changes['environment.darknessLock'] = Boolean(scene.environment?.darknessLock);
  }
  if (settings.globalLight != null) {
    changes['environment.globalLight.enabled'] = settings.globalLight;
  }
  if (settings.weather != null) changes.weather = settings.weather;
  if (Object.keys(changes).length > 0) ops.push({ kind: 'update', uuid: scene.uuid, changes });
  if (settings.playlist != null) {
    const none = settings.playlist.toLowerCase() === 'none';
    ops.push(...switchOps(none ? null : findPlayablePlaylist(settings.playlist)));
  }
  return ops;
}

function currentSettings(scene: SceneLike): SceneMoodSettings {
  const out: SceneMoodSettings = {
    darkness: Number(scene.environment?.darknessLevel ?? 0),
    globalLight: Boolean(scene.environment?.globalLight?.enabled),
    weather: typeof scene.weather === 'string' ? scene.weather : '',
  };
  // A soundboard cannot be a preset's playlist, so it never counts as "the music".
  const playing = playlists().find(p => !isSoundboard(p) && isPlaying(p));
  out.playlist = playing ? String(playing.name) : 'none';
  return out;
}

function settingsOf(request: SceneMoodPlanRequest): SceneMoodSettings {
  const picked: SceneMoodSettings = {};
  for (const key of SETTING_KEYS) {
    if (request[key] !== undefined) (picked as Record<string, unknown>)[key] = request[key];
  }
  return validated(picked);
}

function planApply(scene: SceneLike, request: SceneMoodPlanRequest): SceneMoodPlan {
  if (!request.preset) throw new Error('Give the preset name.');
  const { preset } = findPreset(scene, request.preset);
  let settings: SceneMoodSettings;
  let ops: GuardedOp[];
  try {
    settings = validated(preset);
    ops = moodOps(scene, settings);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Preset ${quoted(preset.name)} cannot be applied: ${reason} Save it again or remove it.`
    );
  }
  if (ops.length === 0) throw new Error(`Preset ${quoted(preset.name)} changes nothing right now.`);
  return {
    summary: `Apply mood ${quoted(preset.name)} on ${quoted(scene.name)}: ${describe(settings).join(', ')}`,
    ops,
    sceneId: scene.id,
  };
}

function planSet(scene: SceneLike, request: SceneMoodPlanRequest): SceneMoodPlan {
  const settings = settingsOf(request);
  const parts = describe(settings);
  if (parts.length === 0) throw new Error('Give darkness, globalLight, weather and/or playlist.');
  const ops = moodOps(scene, settings);
  if (ops.length === 0) throw new Error('The scene and the music are already like that.');
  return {
    summary: `Set the mood on ${quoted(scene.name)}: ${parts.join(', ')}`,
    ops,
    sceneId: scene.id,
  };
}

function planSave(scene: SceneLike, request: SceneMoodPlanRequest): SceneMoodPlan {
  if (!request.preset) throw new Error('Give the preset name.');
  const key = presetKey(request.preset);
  const settings = request.fromCurrent ? validated(currentSettings(scene)) : settingsOf(request);
  if (settings.playlist && settings.playlist.toLowerCase() !== 'none') {
    findPlayablePlaylist(settings.playlist);
  }
  const parts = describe(settings);
  if (parts.length === 0)
    throw new Error('Give darkness, globalLight, weather and/or playlist, or fromCurrent.');
  const replacing = Object.hasOwn(savedPresets(scene), key);
  const preset: SceneMoodPreset = { name: request.preset.trim(), ...settings };
  return {
    summary: `${replacing ? 'Replace' : 'Save'} mood preset ${quoted(preset.name)} on ${quoted(scene.name)}: ${parts.join(', ')}`,
    ops: [
      {
        kind: 'update',
        uuid: scene.uuid,
        changes: { [`flags.${MODULE_ID}.${SCENE_MOOD_FLAG}.${key}`]: JSON.stringify(preset) },
      },
    ],
    sceneId: scene.id,
  };
}

function planRemove(scene: SceneLike, request: SceneMoodPlanRequest): SceneMoodPlan {
  if (!request.preset) throw new Error('Give the preset name.');
  const { key, preset } = findPreset(scene, request.preset);
  return {
    summary: `Remove mood preset ${quoted(preset.name)} from ${quoted(scene.name)}`,
    ops: [
      {
        kind: 'update',
        uuid: scene.uuid,
        changes: {},
        unset: [`flags.${MODULE_ID}.${SCENE_MOOD_FLAG}.${key}`],
      },
    ],
    sceneId: scene.id,
  };
}

function planMusic(scene: SceneLike, request: SceneMoodPlanRequest): SceneMoodPlan {
  const mode = request.mode ?? 'switch';
  const name = request.playlist;
  if (!name) throw new Error('Give the playlist.');
  const playlist = mode === 'stop' ? findPlaylist(name) : findPlayablePlaylist(name);
  const ops =
    mode === 'stop'
      ? stopOps(playlist)
      : mode === 'play'
        ? startOps(playlist)
        : switchOps(playlist);
  if (ops.length === 0) {
    throw new Error(
      mode === 'stop'
        ? `${quoted(playlist.name)} is not playing.`
        : `${quoted(playlist.name)} is already playing.`
    );
  }
  const verb = mode === 'stop' ? 'Stop' : mode === 'play' ? 'Play' : 'Switch the music to';
  return { summary: `${verb} playlist ${quoted(playlist.name)}`, ops, sceneId: scene.id };
}

/** `planSceneMood`: one request into one plan. Writes nothing. */
export function planSceneMood(request: unknown): SceneMoodPlan {
  const plan = buildPlan(request);
  // Foundry refuses to start or stop a sound until the browser has unlocked audio (one click in
  // the window); the apply would fail half way, so refuse while planning instead.
  const audio = (game as unknown as { audio?: { locked?: boolean } }).audio;
  const touchesMusic = plan.ops.some(op => 'uuid' in op && op.uuid.startsWith('Playlist.'));
  if (touchesMusic && audio?.locked) {
    throw new Error(
      'Foundry has not unlocked audio in the GM browser yet. Click anywhere in the Foundry window once, then ask again.'
    );
  }
  return plan;
}

function buildPlan(request: unknown): SceneMoodPlan {
  const req = request as SceneMoodPlanRequest | null;
  if (!req || typeof req !== 'object') throw new Error('A request is required.');
  const scene = requireCurrentScene() as SceneLike;
  switch (req.action) {
    case 'apply':
      return planApply(scene, req);
    case 'set':
      return planSet(scene, req);
    case 'save':
      return planSave(scene, req);
    case 'remove-preset':
      return planRemove(scene, req);
    case 'music':
      return planMusic(scene, req);
    default:
      throw new Error(`Unknown scene mood action: ${String((req as { action?: unknown }).action)}`);
  }
}

/** `getSceneMoods`: the viewed scene's presets, what it looks like now and the playlists. */
export function getSceneMoods(): SceneMoodsReply {
  const scene = requireCurrentScene() as SceneLike;
  const current = currentSettings(scene);
  return {
    sceneId: scene.id,
    sceneName: scene.name,
    presets: Object.values(savedPresets(scene)),
    current: {
      darkness: current.darkness ?? 0,
      globalLight: current.globalLight ?? false,
      weather: current.weather ?? '',
    },
    playlists: playlists().map((p: PlaylistLike) => ({
      name: String(p.name),
      sounds: contentsOf(p.sounds).length,
      playing: isPlaying(p),
    })),
  };
}
