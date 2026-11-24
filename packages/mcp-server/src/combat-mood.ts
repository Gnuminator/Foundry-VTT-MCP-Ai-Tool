/**
 * Combat mood (idea 1.14): when a fight starts on the scene the GM is viewing, the scene's mood
 * preset named "Combat" is applied (darkness, light, weather, music); when that fight ends the
 * earlier look and music come back.
 *
 * It listens to the session events the event pump already reads (`combat-start`, `combat-end`),
 * so a fight is noticed within the pump interval (5 s by default). Everything it writes is an
 * ordinary guarded change under the feature `combat-mood` (off by default), so it shows in Recent
 * Changes and can be undone by hand. A scene without a "Combat" preset is left alone. The
 * restore is the Undo of the change this service made; when that conflicts (the GM changed the
 * light or the music during the fight, or a playlist moved on) it falls back to setting back what
 * was captured before the fight, and gives up quietly if that fails too.
 */
import {
  COMBAT_MOOD_FEATURE_ID,
  COMBAT_MOOD_PRESET,
  unwrapBridgeReply,
  type SceneMoodPlan,
  type SceneMoodPlanRequest,
  type SceneMoodsReply,
} from '@gnuminator/shared';

import type { FoundryClient } from './foundry-client.js';
import type { GuardedWriteService } from './guarded-write/service.js';
import type { Logger } from './logger.js';

/** A fight older than this when first seen (a replay after a restart) is not acted on. */
export const COMBAT_MOOD_MAX_EVENT_AGE_MS = 2 * 60 * 1000;
const SEEN_LIMIT = 200;
const ACTOR = 'Combat mood';

export interface CombatMoodServiceOptions {
  foundryClient: Pick<FoundryClient, 'query'>;
  guardedWrites: Pick<GuardedWriteService, 'createPlan' | 'applyPlan' | 'undo'>;
  logger: Logger;
  /** Injectable for tests. */
  now?: () => number;
}

interface Active {
  combatId: string;
  changeId: string;
  /** What the scene and the music were before the fight, for the fallback restore. */
  previous: SceneMoodPlanRequest;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CombatMoodService {
  private readonly foundryClient: Pick<FoundryClient, 'query'>;
  private readonly guardedWrites: CombatMoodServiceOptions['guardedWrites'];
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly active = new Map<string, Active>();
  private readonly seen = new Set<string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(options: CombatMoodServiceOptions) {
    this.foundryClient = options.foundryClient;
    this.guardedWrites = options.guardedWrites;
    this.logger = options.logger.child({ component: 'CombatMood' });
    this.now = options.now ?? Date.now;
  }

  /** The event pump's listener. Never throws; the work runs one fight at a time, in order. */
  onEvents(events: readonly unknown[]): void {
    for (const raw of events) {
      const e = raw as Record<string, unknown> | null;
      const type = e && typeof e === 'object' ? e.eventType : null;
      if (type !== 'combat-start' && type !== 'combat-end') continue;
      const id = str(e?.id);
      if (!id || this.seen.has(id)) continue;
      this.seen.add(id);
      if (this.seen.size > SEEN_LIMIT) {
        const oldest = this.seen.values().next().value;
        if (oldest !== undefined) this.seen.delete(oldest);
      }
      const details = (e?.details ?? {}) as Record<string, unknown>;
      const combatId = str(details.combatId);
      const sceneId = str(details.sceneId);
      if (!combatId || !sceneId) continue;
      const at =
        typeof e?.timestampMs === 'number' ? e.timestampMs : Date.parse(String(e?.timestamp));
      if (!Number.isFinite(at) || this.now() - at > COMBAT_MOOD_MAX_EVENT_AGE_MS) continue;
      const start = type === 'combat-start';
      this.queue = this.queue
        .then(() => (start ? this.onStart(combatId, sceneId) : this.onEnd(combatId, sceneId)))
        .catch(error => {
          this.logger.warn('Combat mood step failed', { error: message(error) });
        });
    }
  }

  /** Resolves when the work queued so far is done (tests). */
  idle(): Promise<void> {
    return this.queue;
  }

  private async enabled(): Promise<boolean> {
    const features = unwrapBridgeReply(
      await this.foundryClient.query('foundry-mcp-bridge.listGuardedFeatures'),
      'Feature list refused'
    );
    return features.find(f => f.id === COMBAT_MOOD_FEATURE_ID)?.enabled === true;
  }

  private async onStart(combatId: string, sceneId: string): Promise<void> {
    if (this.active.has(sceneId)) return;
    if (!(await this.enabled())) return;
    const before = unwrapBridgeReply<SceneMoodsReply>(
      await this.foundryClient.query('foundry-mcp-bridge.getSceneMoods'),
      'Could not read the moods'
    );
    // The mood tools act on the scene the GM is viewing; a fight somewhere else is left alone.
    if (before.sceneId !== sceneId) return;
    const playing = before.playlists.find(p => p.playing);
    const previous: SceneMoodPlanRequest = {
      action: 'set',
      darkness: before.current.darkness,
      globalLight: before.current.globalLight,
      weather: before.current.weather === '' ? 'none' : before.current.weather,
      playlist: playing ? playing.name : 'none',
    };
    let built: SceneMoodPlan;
    try {
      built = unwrapBridgeReply(
        await this.foundryClient.query('foundry-mcp-bridge.planSceneMood', {
          action: 'apply',
          preset: COMBAT_MOOD_PRESET,
        } satisfies SceneMoodPlanRequest),
        'Could not plan the combat mood'
      );
    } catch (error) {
      // No "Combat" preset on this scene, or it already looks like that: nothing to do.
      this.logger.info('No combat mood applied', { sceneId, reason: message(error) });
      return;
    }
    const plan = await this.guardedWrites.createPlan({
      feature: COMBAT_MOOD_FEATURE_ID,
      summary: `Combat started: ${built.summary}`,
      ops: built.ops,
    });
    const applied = await this.guardedWrites.applyPlan(plan.planId, { confirm: true }, ACTOR);
    this.active.set(sceneId, { combatId, changeId: applied.changeId, previous });
  }

  private async onEnd(combatId: string, sceneId: string): Promise<void> {
    const entry = this.active.get(sceneId);
    if (entry?.combatId !== combatId) return;
    this.active.delete(sceneId);
    try {
      await this.guardedWrites.undo(entry.changeId, { confirm: true }, ACTOR);
      return;
    } catch (error) {
      this.logger.info('Combat mood Undo refused, setting the earlier look back', {
        reason: message(error),
      });
    }
    try {
      // The set tools act on the viewed scene: never put one scene's look on another.
      const viewed = unwrapBridgeReply<SceneMoodsReply>(
        await this.foundryClient.query('foundry-mcp-bridge.getSceneMoods'),
        'Could not read the moods'
      );
      if (viewed.sceneId !== sceneId) {
        this.logger.info('Combat mood left as is: another scene is in view', { sceneId });
        return;
      }
      const built = unwrapBridgeReply(
        await this.foundryClient.query('foundry-mcp-bridge.planSceneMood', entry.previous),
        'Could not plan the restore'
      );
      const plan = await this.guardedWrites.createPlan({
        feature: COMBAT_MOOD_FEATURE_ID,
        summary: `Combat ended: ${built.summary}`,
        ops: built.ops,
      });
      await this.guardedWrites.applyPlan(plan.planId, { confirm: true }, ACTOR);
    } catch (error) {
      this.logger.warn('Combat mood could not restore the earlier look', {
        sceneId,
        reason: message(error),
      });
    }
  }
}
