/**
 * Automatic Obsidian render (docs/design/OBSIDIAN-PLAN.md, O2).
 *
 * When `FOUNDRY_AI_OBSIDIAN_DIR` names the GM's vault, the backend re-renders a
 * world's notes shortly after its data changed: the event pump appended events,
 * a guarded change was applied or undone, or a play session was marked. Unset
 * means off (the `npm run obsidian -- export` command still works).
 *
 * Renders are debounced (a quiet period, with a maximum wait so steady play
 * still refreshes) and run one at a time per world. Each world keeps an export
 * cache, so unchanged session logs are not re-parsed and unchanged notes are not
 * re-read. A failed render is logged and never reaches the caller.
 */
import * as path from 'path';

import type { Logger } from '../logger.js';
import type { AuditLog } from '../vault/audit.js';
import type { VaultStore } from '../vault/store.js';

import {
  exportWorldToObsidian,
  newExportCache,
  type ExportCache,
  type ExportResult,
} from './export.js';

export const DEFAULT_RENDER_DEBOUNCE_MS = 3000;
export const DEFAULT_RENDER_MAX_WAIT_MS = 30_000;

/** The vault to render into, from the environment (null = auto-render off). */
export function obsidianAutoRenderSettings(env: NodeJS.ProcessEnv = process.env): {
  vaultDir: string | null;
} {
  const dir = env.FOUNDRY_AI_OBSIDIAN_DIR?.trim();
  return { vaultDir: dir ? path.resolve(dir) : null };
}

export interface ObsidianAutoRenderOptions {
  store: VaultStore;
  audit: Pick<AuditLog, 'list'>;
  vaultDir: string;
  logger: Pick<Logger, 'info' | 'warn'>;
  debounceMs?: number;
  maxWaitMs?: number;
  now?: () => number;
  /** The MCP tool names for the usage note (asked at render time; absent: left out). */
  toolNames?: () => readonly string[] | null;
  /** The exporter (tests inject a fake). */
  exportWorld?: typeof exportWorldToObsidian;
}

interface WorldState {
  cache: ExportCache;
  timer: NodeJS.Timeout | null;
  /** When the first change of the pending batch was scheduled. */
  pendingSince: number | null;
  running: Promise<void> | null;
  rerun: boolean;
  /** Skipped/error summary of the last render, so a lasting problem is logged once. */
  lastProblems: string;
}

export class ObsidianAutoRender {
  private readonly options: ObsidianAutoRenderOptions;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly now: () => number;
  private readonly exportWorld: typeof exportWorldToObsidian;
  private readonly worlds = new Map<string, WorldState>();
  private stopped = false;

  constructor(options: ObsidianAutoRenderOptions) {
    this.options = options;
    this.debounceMs = options.debounceMs ?? DEFAULT_RENDER_DEBOUNCE_MS;
    this.maxWaitMs = Math.max(options.maxWaitMs ?? DEFAULT_RENDER_MAX_WAIT_MS, this.debounceMs);
    this.now = options.now ?? ((): number => Date.now());
    this.exportWorld = options.exportWorld ?? exportWorldToObsidian;
  }

  /** Ask for a render of `worldId` soon. Cheap; safe to call on every change. */
  schedule(worldId: string): void {
    if (this.stopped) return;
    const w = this.state(worldId);
    const now = this.now();
    w.pendingSince ??= now;
    if (w.timer) clearTimeout(w.timer);
    const wait = Math.max(0, Math.min(this.debounceMs, w.pendingSince + this.maxWaitMs - now));
    w.timer = setTimeout(() => {
      w.timer = null;
      void this.render(worldId);
    }, wait);
    w.timer.unref?.();
  }

  /** Render every world with a pending change now (shutdown, tests). */
  async flush(): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const [worldId, w] of this.worlds) {
      if (w.timer) {
        clearTimeout(w.timer);
        w.timer = null;
        pending.push(this.render(worldId));
      } else if (w.running) {
        pending.push(w.running);
      }
    }
    await Promise.all(pending);
  }

  /** Cancel pending renders; later `schedule` calls do nothing. */
  stop(): void {
    this.stopped = true;
    for (const w of this.worlds.values()) {
      if (w.timer) clearTimeout(w.timer);
      w.timer = null;
    }
  }

  private state(worldId: string): WorldState {
    let w = this.worlds.get(worldId);
    if (!w) {
      w = {
        cache: newExportCache(),
        timer: null,
        pendingSince: null,
        running: null,
        rerun: false,
        lastProblems: '',
      };
      this.worlds.set(worldId, w);
    }
    return w;
  }

  private async render(worldId: string): Promise<void> {
    const w = this.state(worldId);
    if (w.running) {
      // A change arrived while rendering: render once more afterwards.
      w.rerun = true;
      return w.running;
    }
    w.pendingSince = null;
    w.running = this.renderOnce(worldId, w);
    try {
      await w.running;
    } finally {
      w.running = null;
    }
    if (w.rerun && !this.stopped) {
      w.rerun = false;
      this.schedule(worldId);
    }
  }

  private async renderOnce(worldId: string, w: WorldState): Promise<void> {
    const { store, audit, vaultDir, logger } = this.options;
    try {
      const result = await this.exportWorld({
        store,
        audit,
        worldId,
        vaultDir,
        cache: w.cache,
        toolNames: this.options.toolNames?.() ?? null,
      });
      this.report(result, w);
    } catch (error) {
      logger.warn('Obsidian render failed', {
        worldId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private report(result: ExportResult, w: WorldState): void {
    const { logger } = this.options;
    const changed = result.written.length + result.created.length + result.trashed.length;
    if (changed > 0) {
      logger.info('Obsidian notes updated', {
        worldId: result.worldId,
        written: result.written.length,
        created: result.created.length,
        trashed: result.trashed.length,
      });
    }
    const problems = JSON.stringify([result.skipped, result.errors]);
    if (problems !== w.lastProblems) {
      w.lastProblems = problems;
      if (result.skipped.length || result.errors.length) {
        logger.warn('Obsidian render skipped or failed notes (see AI Tool/_status.md)', {
          worldId: result.worldId,
          skipped: result.skipped.map(s => `${s.path}: ${s.reason}`),
          errors: result.errors.map(e => `${e.path}: ${e.error}`),
        });
      }
    }
  }
}
