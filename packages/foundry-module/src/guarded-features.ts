/**
 * Feature switches for guarded writes (plan step 0.2).
 *
 * Every feature that changes game state through the plan/apply flow has its own
 * world setting, shown in the module settings: off by default, or on for a feature
 * that replaces tools which worked without a switch (D-082, `defaultEnabled`). A feature registers
 * its switch when it ships; the apply handler refuses writes for a feature that
 * is unknown or switched off. Undo is allowed while a feature is off (turning a
 * feature off must not strand changes the GM wants to revert); it still needs
 * the master "Allow Write Operations" setting.
 */
import { MODULE_ID } from './constants.js';

export interface GuardedFeature {
  /** Stable id used in plans and the audit log, e.g. `npc-attitudes`. */
  id: string;
  /** Setting label, e.g. "AI Tool: NPC attitudes (writes)". */
  name: string;
  hint: string;
  /** Start switched on (D-082: the live-play and ownership switches). Default false. */
  defaultEnabled?: boolean;
}

const features = new Map<string, GuardedFeature>();

const FEATURE_ID = /^[a-z][a-z0-9-]{1,40}$/;

/** The world-setting key of a feature switch. */
export function featureSettingKey(id: string): string {
  return `feature.${id}.enabled`;
}

/**
 * Register a feature switch (a world setting, off unless `defaultEnabled`). Call
 * from the module `init` hook. Registering the same id twice is a no-op.
 */
export function registerGuardedFeature(feature: GuardedFeature): void {
  if (!FEATURE_ID.test(feature.id)) throw new Error(`Invalid feature id: ${feature.id}`);
  if (features.has(feature.id)) return;
  features.set(feature.id, feature);
  const on = feature.defaultEnabled === true;
  game.settings.register(MODULE_ID, featureSettingKey(feature.id), {
    name: feature.name,
    hint: `${feature.hint} ${on ? 'On' : 'Off'} by default; every change still asks for confirmation and can be undone.`,
    scope: 'world',
    config: true,
    type: Boolean,
    default: on,
  });
}

/** Whether a feature is known here. */
export function isKnownFeature(id: string): boolean {
  return features.has(id);
}

/** Whether a feature's switch is on (unknown features are off). */
export function isFeatureEnabled(id: string): boolean {
  if (!features.has(id)) return false;
  try {
    return game.settings.get(MODULE_ID, featureSettingKey(id)) === true;
  } catch {
    return false;
  }
}

/** Whether "Allow Write Operations" is on (off when it cannot be read). */
export function writeOperationsAllowed(): boolean {
  try {
    return game.settings.get(MODULE_ID, 'allowWriteOperations') === true;
  } catch {
    return false;
  }
}

/**
 * All registered features with their current state, plus "Allow Write Operations", which the
 * bridge checks itself for changes that never reach Foundry (vault-only plans and their undos).
 */
export function listGuardedFeatures(): Array<
  GuardedFeature & { enabled: boolean; writesAllowed: boolean }
> {
  const writesAllowed = writeOperationsAllowed();
  return [...features.values()].map(f => ({
    ...f,
    enabled: isFeatureEnabled(f.id),
    writesAllowed,
  }));
}

/** Test helper: forget registered features. */
export function resetGuardedFeaturesForTests(): void {
  features.clear();
}
