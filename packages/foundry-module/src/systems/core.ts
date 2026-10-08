/**
 * Foundry core version adapter (plan step 0.4).
 *
 * The module supports Foundry v13 and v14. New code reads and writes version-
 * dependent core data only through these helpers, so each difference is handled
 * in one place and tested against both shapes. Feature detection is preferred;
 * a build number is used only where a change has nothing to detect (the query
 * sender).
 *
 * Verified v14 changes this file covers (release notes 14.349 to 14.368):
 * - 14.349: `-=key` deletions deprecated for the `_del` ForcedDeletion marker
 *   (old keys work until v16); `ActiveEffect#icon` removed for `img`.
 * - 14.352: `CONFIG.queries` handlers receive the sender (foundryvtt#13418);
 *   effect change `mode` becomes a string `type`; MeasuredTemplate removed
 *   (templates are Regions).
 * - 14.353: effect changes move to `system.changes`; duration becomes
 *   `{value, units, expiry}`; Scene Levels (backgrounds live on a level).
 */

/** Foundry core generation (13, 14, ...), from `game.release` or the version string. */
export function coreGeneration(): number {
  const generation = game.release?.generation;
  if (typeof generation === 'number' && generation > 0) return generation;
  return Number.parseInt(String(game.version ?? '0').split('.')[0] ?? '0', 10) || 0;
}

/** Foundry core build within its generation (e.g. 368 for 14.368). */
export function coreBuild(): number {
  const build = game.release?.build;
  if (typeof build === 'number' && build > 0) return build;
  return Number.parseInt(String(game.version ?? '0').split('.')[1] ?? '0', 10) || 0;
}

/**
 * Whether `CONFIG.queries` handlers receive the requesting user as
 * `context.user` (14.352+). There is no feature to detect, so this is a build
 * check; callers must still reject a missing `user`.
 */
export function coreSupportsQuerySender(): boolean {
  const generation = coreGeneration();
  return generation > 14 || (generation === 14 && coreBuild() >= 352);
}

/**
 * Whether the v14 ActiveEffect data model is present (typed effects with
 * `system.changes`). Feature-detected through `foundry.data`.
 */
export function hasTypedActiveEffects(): boolean {
  return typeof foundry?.data?.ActiveEffectTypeDataModel === 'function';
}

/**
 * Whether scenes can hold MeasuredTemplate documents. They were removed in
 * 14.352 (templates are Regions since then), but 14.368 still ships a
 * deprecated `BaseMeasuredTemplate` shim (`client/documents/measured-template.mjs`),
 * so the class is no signal: the Scene's embedded document types are (seen
 * live on 14.368: `Region` and `Level`, no `MeasuredTemplate`).
 */
export function supportsMeasuredTemplates(): boolean {
  const embedded = (
    foundry?.documents as { BaseScene?: { metadata?: { embedded?: unknown } } } | undefined
  )?.BaseScene?.metadata?.embedded;
  if (embedded && typeof embedded === 'object') return 'MeasuredTemplate' in embedded;
  if (coreGeneration() < 14) return true;
  return typeof foundry?.documents?.BaseMeasuredTemplate === 'function';
}

/** Thrown by tools whose Foundry feature does not exist in the running core version. */
export class UnsupportedOnThisFoundryError extends Error {
  constructor(feature: string, detail: string) {
    super(`${feature} is not available on Foundry ${game.version}: ${detail}`);
    this.name = 'UnsupportedOnThisFoundryError';
  }
}

// ---------------------------------------------------------------------------
// Scene Levels (v14)
// ---------------------------------------------------------------------------

/** Whether this scene has v14 Scene Levels. */
export function sceneHasLevels(scene: Scene): boolean {
  return scene.levels !== undefined && scene.levels !== null;
}

/**
 * The level new placeables on `scene` should go to: the level the canvas is
 * showing when it shows this scene, else the scene's initial level. Undefined
 * on v13 (no levels). Set it explicitly on creation: a token created without
 * `level` lands on `defaultLevel0000`, which need not be the current level.
 */
export function currentLevelId(scene: Scene): string | undefined {
  if (!sceneHasLevels(scene)) return undefined;
  const cv = typeof canvas === 'undefined' ? undefined : canvas;
  if (cv?.scene?.id === scene.id && cv.level?.id) return cv.level.id;
  const initial = scene.initialLevel;
  if (typeof initial === 'string' && initial) return initial;
  if (initial && typeof initial === 'object' && initial.id) return initial.id;
  return scene.levels?.contents[0]?.id;
}

/** Background image of a scene: the current level's on v14, `background.src` on v13. */
export function sceneBackgroundSrc(scene: Scene): string | null {
  if (sceneHasLevels(scene)) {
    const levelId = currentLevelId(scene);
    const level = levelId ? scene.levels?.get(levelId) : undefined;
    return level?.background?.src ?? null;
  }
  type LegacyBackground = { background?: { src?: string | null } } | undefined;
  const legacy = (scene as unknown as LegacyBackground)?.background;
  const source = scene._source as LegacyBackground;
  return legacy?.src ?? source?.background?.src ?? null;
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

/**
 * An update that removes the key at `path`: `{[path]: _del}` on v14 (the
 * ForcedDeletion marker), `{'parent.-=key': null}` on v13.
 */
export function unsetKeyUpdate(path: string): Record<string, unknown> {
  const forcedDeletion = (globalThis as { _del?: unknown })._del;
  if (forcedDeletion !== undefined) return { [path]: forcedDeletion };
  const dot = path.lastIndexOf('.');
  const legacyKey = dot === -1 ? `-=${path}` : `${path.slice(0, dot)}.-=${path.slice(dot + 1)}`;
  return { [legacyKey]: null };
}

// ---------------------------------------------------------------------------
// ActiveEffect shape (v13 vs v14)
// ---------------------------------------------------------------------------

/** One effect change in the v14 vocabulary. */
export interface EffectChange {
  key: string;
  /** `add`, `multiply`, `override`, `upgrade`, `downgrade` or `custom`. */
  type: string;
  value: unknown;
  priority?: number;
  /** v14 application phase, when present. */
  phase?: string;
}

/** v13 numeric `mode` (CONST.ACTIVE_EFFECT_MODES) to the v14 `type` string. */
const LEGACY_CHANGE_MODES: Record<number, string> = {
  0: 'custom',
  1: 'multiply',
  2: 'add',
  3: 'downgrade',
  4: 'upgrade',
  5: 'override',
};

interface RawEffectChange {
  key?: unknown;
  type?: unknown;
  mode?: unknown;
  value?: unknown;
  priority?: unknown;
  phase?: unknown;
}

/** An effect's changes, read from `system.changes` (v14) or `changes` (v13). */
export function effectChanges(effect: ActiveEffect): EffectChange[] {
  const v14 = (effect.system as { changes?: unknown } | undefined)?.changes;
  const raw = Array.isArray(v14) ? v14 : Array.isArray(effect.changes) ? effect.changes : [];
  return (raw as RawEffectChange[]).map(change => {
    const type =
      typeof change.type === 'string'
        ? change.type
        : (LEGACY_CHANGE_MODES[Number(change.mode)] ?? 'custom');
    const normalized: EffectChange = {
      key: typeof change.key === 'string' ? change.key : '',
      type,
      value: change.value,
    };
    if (typeof change.priority === 'number') normalized.priority = change.priority;
    if (typeof change.phase === 'string') normalized.phase = change.phase;
    return normalized;
  });
}

/** An effect's duration in the v14 vocabulary. */
export interface EffectDuration {
  value: number | null;
  /** e.g. `rounds`, `turns`, `seconds`, `minutes`; null when permanent. */
  units: string | null;
  expired: boolean;
}

/** Normalized duration: `{value, units}` (v14) or rounds/turns/seconds (v13). */
export function effectDuration(effect: ActiveEffect): EffectDuration {
  const duration = (effect.duration ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && v > 0 ? v : null);
  let value: number | null = null;
  let units: string | null = null;
  if (typeof duration.units === 'string') {
    value = num(duration.value);
    units = value === null ? null : duration.units;
  } else if (num(duration.rounds) !== null) {
    value = num(duration.rounds);
    units = 'rounds';
  } else if (num(duration.turns) !== null) {
    value = num(duration.turns);
    units = 'turns';
  } else if (num(duration.seconds) !== null) {
    value = num(duration.seconds);
    units = 'seconds';
  }
  const remaining = duration.remaining;
  const expired =
    typeof effect.expired === 'boolean'
      ? effect.expired
      : typeof remaining === 'number' && units !== null && remaining <= 0;
  return { value, units, expired };
}

/** An effect's image (`img`; v13 data may still carry the removed `icon`). */
export function effectImg(effect: ActiveEffect): string | null {
  const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  if (nonEmpty(effect.img)) return effect.img;
  const legacyIcon = (effect as unknown as { icon?: unknown }).icon;
  return nonEmpty(legacyIcon) ? legacyIcon : null;
}
