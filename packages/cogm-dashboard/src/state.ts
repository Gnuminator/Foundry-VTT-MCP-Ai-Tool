import type { CombatState, ModuleError, SessionEvent } from './feed/types.js';

/**
 * Bounded in-memory view of the game. Keeps a rolling window of recent events
 * and the latest combat snapshot — deliberately NOT the full session history —
 * so the context handed to the model stays small and cost-controlled.
 */
export class GameState {
  private events: SessionEvent[] = [];
  private readonly seen = new Set<string>();
  private errors: ModuleError[] = [];
  private readonly seenErrors = new Set<string>();
  private combatState: CombatState | null = null;

  constructor(
    private readonly maxEvents = 80,
    private readonly maxErrors = 100
  ) {}

  /** Merge new events (de-duplicated by id), keeping only the newest `maxEvents`. Returns those actually added. */
  addEvents(incoming: SessionEvent[]): SessionEvent[] {
    const added: SessionEvent[] = [];
    for (const event of incoming) {
      if (this.seen.has(event.id)) continue;
      this.seen.add(event.id);
      added.push(event);
    }
    if (added.length === 0) return added;

    this.events.push(...added);
    this.events.sort((a, b) => a.timestampMs - b.timestampMs);
    if (this.events.length > this.maxEvents) {
      const removed = this.events.splice(0, this.events.length - this.maxEvents);
      for (const event of removed) this.seen.delete(event.id);
    }
    return added;
  }

  /** Forget the events, module errors and combat of a world that is no longer the open one. */
  reset(): void {
    this.events = [];
    this.seen.clear();
    this.errors = [];
    this.seenErrors.clear();
    this.combatState = null;
  }

  get recentEvents(): SessionEvent[] {
    return this.events.slice();
  }

  /** Merge new module errors (de-duplicated by id), keeping the newest `maxErrors`. Returns those added. */
  addErrors(incoming: ModuleError[]): ModuleError[] {
    const added: ModuleError[] = [];
    for (const error of incoming) {
      if (this.seenErrors.has(error.id)) continue;
      this.seenErrors.add(error.id);
      added.push(error);
    }
    if (added.length === 0) return added;

    this.errors.push(...added);
    this.errors.sort((a, b) => a.timestampMs - b.timestampMs);
    if (this.errors.length > this.maxErrors) {
      const removed = this.errors.splice(0, this.errors.length - this.maxErrors);
      for (const error of removed) this.seenErrors.delete(error.id);
    }
    return added;
  }

  get recentErrors(): ModuleError[] {
    return this.errors.slice();
  }

  get combat(): CombatState | null {
    return this.combatState;
  }

  setCombat(combat: CombatState | null): void {
    this.combatState = combat;
  }

  /**
   * Signature that changes on any combat beat worth a co-GM comment: a turn/round
   * advance, OR a combatant crossing 0 HP, being defeated, or gaining/losing a
   * condition mid-turn. HP is bucketed (down/up, not exact) so routine chip
   * damage doesn't trigger, but the dramatic transitions do.
   */
  combatSignature(): string | null {
    if (!this.combatState) return null;
    const { round, turn, current, combatants } = this.combatState;
    const perCombatant = combatants
      .map(
        c =>
          `${c.id}:${c.hp.value <= 0 ? 'down' : 'up'}:${c.defeated ? 'D' : ''}:${[...c.conditions]
            .sort()
            .join(',')}`
      )
      .join('|');
    return `${round}:${turn}:${current?.id ?? 'none'}|${perCombatant}`;
  }
}
