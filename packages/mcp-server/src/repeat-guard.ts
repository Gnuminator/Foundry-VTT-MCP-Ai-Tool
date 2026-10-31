/**
 * Repeat guard for the double-clickable writes (control channel `call_tool` and module requests).
 *
 * A double click (or a retrying client) can send the same write twice within a moment. The same
 * tool with the same arguments from the same requester inside `windowMs` gets the FIRST answer
 * back instead of running again: a call still running is shared, a call that succeeded is
 * replayed. Replay rather than refuse, because both callers want the truth about what happened
 * (a refusal would show the second click as a failure while the first one worked), and a caller
 * that retries a call whose answer it lost gets that answer.
 *
 * Guarded: only the allowlist below. Everything else (reads, plans, direct writes, dice rolls) runs
 * every time. A failed call is not remembered (it changed nothing, so the retry must run), and
 * any other guarded call that succeeds forgets the remembered answers, so an undo, redo, undo of
 * one change inside the window is not swallowed. Apply and undo are keyed by their
 * arguments, so two different plans or changes never collide; the same plan id twice is the key
 * case. The service's own "already applied" check stays behind it for the later repeat.
 *
 * Pure: no SDK, no I/O; the clock is injectable.
 */
/** Window in which the same call is a repeat (the live-repeat-guard item). */
export const REPEAT_WINDOW_MS = 3000;

/**
 * The guarded tools: the ones a double click hits (the Apply and Undo buttons, the Session
 * window's start and end). Direct writes such as use-npc-activity, advance-combat-turn or
 * use-item are NOT here: a quick identical repeat of those is often meant (a Multiattack is two
 * identical calls, Next turn twice skips a dead monster) and a replay would swallow it silently.
 */
const REPEAT_GUARDED: ReadonlySet<string> = new Set([
  'apply-planned-change',
  'undo-change',
  'mark-play-session',
]);

/** Whether a repeat of this tool is guarded. */
export function isRepeatGuarded(tool: string): boolean {
  return REPEAT_GUARDED.has(tool);
}

/** JSON with sorted object keys, so `{a,b}` and `{b,a}` are the same arguments. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k];
      return sorted;
    }
    return v;
  });
}

interface Entry {
  promise: Promise<unknown>;
  /** Set once the call succeeded: the replay window ends at `expires`. */
  expires: number | undefined;
}

export class RepeatGuard {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly windowMs: number = REPEAT_WINDOW_MS,
    private readonly now: () => number = Date.now
  ) {}

  /** Run `run`, or return the first answer when the same call ran within the window. */
  async run<T>(tool: string, args: unknown, requester: string, run: () => Promise<T>): Promise<T> {
    if (!isRepeatGuarded(tool)) return run();
    this.sweep();
    const key = `${tool}\u0000${requester}\u0000${stableStringify(args)}`;
    const existing = this.entries.get(key);
    if (existing) return existing.promise as Promise<T>;

    const entry: Entry = { promise: run(), expires: undefined };
    this.entries.set(key, entry);
    try {
      const result = (await entry.promise) as T;
      // The world moved on: an answer remembered for another key may be stale now.
      for (const [k, e] of this.entries) {
        if (k !== key && e.expires !== undefined) this.entries.delete(k);
      }
      entry.expires = this.now() + this.windowMs;
      return result;
    } catch (e) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw e;
    }
  }

  private sweep(): void {
    const t = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expires !== undefined && entry.expires <= t) this.entries.delete(key);
    }
  }
}
