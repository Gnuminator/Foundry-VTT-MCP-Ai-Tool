/**
 * The dashboard theme, chosen by the GM once per world (D-085): the README brand
 * ("neutral", the default for any campaign) or a campaign theme on top of it ("veil",
 * the Curse of Strahd theme). The dashboard and the players' page both follow it.
 *
 * Stored in a small JSON file keyed by world id, so it survives a restart. Without a
 * file (tests, or no state folder) it lives in memory only. Per-viewer display choices
 * (mist motion, clear air) are not here: each browser keeps those itself.
 */
import { promises as fsp, readFileSync } from 'fs';
import * as path from 'path';

export const THEMES = ['neutral', 'veil'] as const;
export type ThemeId = (typeof THEMES)[number];
export const DEFAULT_THEME: ThemeId = 'neutral';

export function isTheme(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

interface ThemeFile {
  worlds: Record<string, ThemeId>;
}

export interface ThemeStoreLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export class ThemeStore {
  private readonly worlds = new Map<string, ThemeId>();
  /** Writes run one after another: two tabs saving at once must not race on the tmp file. */
  private writing: Promise<void> = Promise.resolve();

  /** @param file the JSON file to persist to, or null to keep themes in memory only */
  constructor(
    private readonly file: string | null,
    private readonly logger?: ThemeStoreLogger
  ) {
    if (!file) return;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<ThemeFile>;
      for (const [world, theme] of Object.entries(parsed.worlds ?? {})) {
        if (isTheme(theme)) this.worlds.set(world, theme);
      }
    } catch (error) {
      // A missing file is the normal first start; anything else is worth a line in the log.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger?.warn('Theme file unreadable; using the default theme', {
          file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** The world's theme, or the default before the world is known or chosen. */
  get(worldId: string | null | undefined): ThemeId {
    return (worldId ? this.worlds.get(worldId) : undefined) ?? DEFAULT_THEME;
  }

  /** Choose a world's theme and save it. Resolves once the file is written. */
  async set(worldId: string, theme: ThemeId): Promise<void> {
    this.worlds.set(worldId, theme);
    const write = (): Promise<void> => this.write();
    this.writing = this.writing.then(write, write);
    await this.writing;
  }

  /** Save every world's theme as it is now (the newest state wins). */
  private async write(): Promise<void> {
    if (!this.file) return;
    const data: ThemeFile = { worlds: Object.fromEntries(this.worlds) };
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await fsp.rename(tmp, this.file);
  }
}
