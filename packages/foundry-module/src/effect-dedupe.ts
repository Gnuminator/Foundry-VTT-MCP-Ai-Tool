/**
 * Drops the second of two matching ActiveEffect events on one actor within a short window (P-026).
 *
 * Automated Conditions 5e mirrors dnd5e conditions as a second ActiveEffect document, so one
 * condition toggle fired createActiveEffect (or deleteActiveEffect) twice and both the live feed
 * (`session-events.ts`) and the play log (`play-recorder.ts`) showed it twice. Two events match
 * when they share the actor and the kind (add or remove) and either the effect name or any status.
 */

export const EFFECT_DEDUPE_WINDOW_MS = 1_500;

export interface EffectEventParts {
  /** Actor id or uuid; events without an actor are never deduped. */
  actor: string | null | undefined;
  /** 'add' / 'remove', or any caller-specific event type. */
  kind: string;
  name: string;
  statuses: readonly string[];
}

export class EffectEventDeduper {
  private readonly seen = new Map<string, number>();

  constructor(private readonly windowMs: number = EFFECT_DEDUPE_WINDOW_MS) {}

  /** True when a matching event was let through within the window; otherwise remembers this one. */
  isDuplicate(parts: EffectEventParts, now: number = Date.now()): boolean {
    if (!parts.actor) return false;
    for (const [key, t] of this.seen) {
      if (now - t > this.windowMs) this.seen.delete(key);
    }
    const prefix = `${parts.actor}\u0000${parts.kind}\u0000`;
    const keys = [
      `${prefix}name:${parts.name}`,
      ...parts.statuses.map(s => `${prefix}status:${s}`),
    ];
    if (keys.some(key => this.seen.has(key))) return true;
    for (const key of keys) this.seen.set(key, now);
    return false;
  }
}
