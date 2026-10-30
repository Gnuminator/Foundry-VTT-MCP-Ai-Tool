// A few seconds of memory for two slow page-load reads (I-098): get-play-stats and list-scenes.
// Two windows loading together, or a reload, share one bridge call (also while it is still
// running). Never the lists that show write results (Recent Changes, the Handouts queue, the Prep
// digest, combat): a stale one there would hide a change. Any other tool call through /api/tool,
// a play-session mark or a new game event clears everything.

/** Tools whose answer may be a few seconds old. */
export const CACHED_READ_TOOLS: ReadonlySet<string> = new Set(['get-play-stats', 'list-scenes']);

export const READ_CACHE_TTL_MS = 5_000;

interface Entry {
  at: number;
  value: Promise<unknown>;
}

export interface ReadCache {
  /** The cached answer for this call if one is fresh, else runs `load` and keeps its answer. */
  get<T>(name: string, args: Record<string, unknown>, load: () => Promise<T>): Promise<T>;
  clear(): void;
}

export function createReadCache(
  now: () => number = Date.now,
  ttlMs: number = READ_CACHE_TTL_MS
): ReadCache {
  const entries = new Map<string, Entry>();
  return {
    get<T>(name: string, args: Record<string, unknown>, load: () => Promise<T>): Promise<T> {
      const key = `${name}\u0000${JSON.stringify(args)}`;
      const hit = entries.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.value as Promise<T>;
      const value = load();
      const entry: Entry = { at: now(), value };
      entries.set(key, entry);
      // A failure is not kept: the next call asks again.
      value.catch(() => {
        if (entries.get(key) === entry) entries.delete(key);
      });
      return value;
    },
    clear(): void {
      entries.clear();
    },
  };
}
