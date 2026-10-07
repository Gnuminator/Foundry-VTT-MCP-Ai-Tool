/**
 * Everyone's changes as daily notes in the GM vault (I-109 PR 6, D-092 "everything is logged").
 *
 * One note per local day, `Campaigns/<worldId>/AI Tool/Everyone/<YYYY-MM-DD>.md`, with every
 * change the players, the GM and the AI made in Foundry that day, oldest first, in the same
 * readable lines the dashboard's Everyone tab and Foundry's Changes window show
 * (`change-history.ts`, `ChangeHistory.byDay()`). Read-only for the GM: undo stays in the
 * dashboard and in Foundry (D-067).
 *
 * Written like the other generated notes (front matter with the ownership marker, so an edited
 * note is left alone), but apart from the Obsidian export (`export.ts`): its own folder, its
 * own debounce, no link conventions of its own. The notes of days the history no longer holds
 * stay as they were written; nothing is deleted. Re-rendered shortly after the change-journal
 * pump appended records or a guarded write was applied or undone, when
 * `FOUNDRY_AI_OBSIDIAN_DIR` names the GM's vault.
 */
import * as path from 'path';

import type { ChangeDay, ChangeListItem } from '../change-history.js';
import type { Logger } from '../logger.js';

import { campaignDir, NoteWriter, type WrittenCache } from './note-writer.js';
import { checkMarkdownOwnership, neutralizeTemplater, withGeneratedHash } from './ownership.js';
import { frontmatter, generatedProps, GENERATED_BANNER } from './render.js';

export const EVERYONE_FOLDER = 'AI Tool/Everyone';
export const DEFAULT_EVERYONE_DEBOUNCE_MS = 3000;
export const DEFAULT_EVERYONE_MAX_WAIT_MS = 30_000;

/** The note path of one day, relative to the campaign folder. */
export function everyoneNotePath(date: string): string {
  return `${EVERYONE_FOLDER}/${date}.md`;
}

function clock(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '??:??';
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Obsidian block ids take letters, digits and dashes. */
function blockId(id: string): string {
  return id.replace(/[^A-Za-z0-9-]+/g, '-');
}

function who(item: ChangeListItem): string {
  if (item.kind === 'human') return `${item.by}${item.isGM ? ' (GM)' : ''}`;
  return item.requestedBy ? `AI, asked by ${item.requestedBy}` : 'AI';
}

function state(item: ChangeListItem): string {
  if (!item.undone) return '';
  const when = item.kind === 'ai' && item.undoneAt ? ` ${clock(item.undoneAt)}` : '';
  return ` · undone${when}${item.undoneBy ? ` by ${item.undoneBy}` : ''}`;
}

/** One change as a list item with its lines below (left out when the summary says it all). */
function renderItem(item: ChangeListItem): string[] {
  const head = `- **${clock(item.at)}** ${neutralizeTemplater(who(item))} · ${neutralizeTemplater(item.summary)}${neutralizeTemplater(state(item))} ^${blockId(item.id)}`;
  const lines = item.lines.filter(line => line !== item.summary);
  if (item.lines.length <= 1 || lines.length === 0) return [head];
  return [head, ...item.lines.map(line => `  - ${neutralizeTemplater(line)}`)];
}

/** The note of one day. */
export function renderEveryoneNote(worldId: string, day: ChangeDay): string {
  const changes = day.changes;
  const people = [...new Set(changes.map(who))].sort();
  const newest = changes.reduce<string | null>(
    (max, c) => (max === null || c.at > max ? c.at : max),
    null
  );
  const props = generatedProps(
    'everyone-changes',
    worldId,
    {
      date: day.date,
      changes: changes.length,
      by_people: changes.filter(c => c.kind === 'human').length,
      by_ai: changes.filter(c => c.kind === 'ai').length,
      undone: changes.filter(c => c.undone).length,
      people,
    },
    newest
  );
  return withGeneratedHash(
    [
      frontmatter(props),
      `# Everyone's changes ${day.date}`,
      '',
      GENERATED_BANNER,
      '',
      `Everything that changed in Foundry on this day: the players, the GM and the AI, oldest first (the server's local time). Undo any of them in the dashboard (Recent Changes, Everyone tab) or in Foundry's Changes window, not here.`,
      '',
      ...changes.flatMap(renderItem),
      '',
    ].join('\n')
  );
}

export interface EveryoneNotesOptions {
  changeHistory: { byDay(): Promise<ChangeDay[]> };
  vaultDir: string;
  logger: Pick<Logger, 'info' | 'warn'>;
  debounceMs?: number;
  maxWaitMs?: number;
  now?: () => number;
}

interface WorldState {
  cache: WrittenCache;
  timer: NodeJS.Timeout | null;
  pendingSince: number | null;
  running: Promise<void> | null;
  rerun: boolean;
  lastProblems: string;
}

/** Renders the daily notes, debounced per world like `ObsidianAutoRender`. */
export class EveryoneNotes {
  private readonly options: EveryoneNotesOptions;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly now: () => number;
  private readonly worlds = new Map<string, WorldState>();
  private stopped = false;

  constructor(options: EveryoneNotesOptions) {
    this.options = options;
    this.debounceMs = options.debounceMs ?? DEFAULT_EVERYONE_DEBOUNCE_MS;
    this.maxWaitMs = Math.max(options.maxWaitMs ?? DEFAULT_EVERYONE_MAX_WAIT_MS, this.debounceMs);
    this.now = options.now ?? ((): number => Date.now());
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

  /** Render now; the notes written, unchanged, skipped (edited in Obsidian) and failed. */
  async renderNow(worldId: string): Promise<{
    written: string[];
    unchanged: string[];
    skipped: Array<{ path: string; reason: string }>;
    errors: Array<{ path: string; error: string }>;
  }> {
    const w = this.state(worldId);
    const { vaultDir, changeHistory } = this.options;
    const writer = new NoteWriter(
      campaignDir(vaultDir, worldId),
      path.resolve(vaultDir),
      worldId,
      w.cache
    );
    const days = await changeHistory.byDay();
    for (const day of days) {
      await writer.owned(
        everyoneNotePath(day.date),
        renderEveryoneNote(worldId, day),
        checkMarkdownOwnership
      );
    }
    return {
      written: writer.written,
      unchanged: writer.unchanged,
      skipped: writer.skipped,
      errors: writer.errors,
    };
  }

  private state(worldId: string): WorldState {
    let w = this.worlds.get(worldId);
    if (!w) {
      w = {
        cache: { written: new Map() },
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
    w.pendingSince = null;
    if (w.running) {
      w.rerun = true;
      return w.running;
    }
    w.running = this.renderOnce(worldId, w).finally(() => {
      w.running = null;
    });
    await w.running;
    if (w.rerun && !this.stopped) {
      w.rerun = false;
      this.schedule(worldId);
    }
  }

  private async renderOnce(worldId: string, w: WorldState): Promise<void> {
    const { logger } = this.options;
    try {
      const result = await this.renderNow(worldId);
      if (result.written.length > 0) {
        logger.info('Everyone notes updated', { worldId, written: result.written.length });
      }
      const problems = JSON.stringify([result.skipped, result.errors]);
      if (problems !== w.lastProblems) {
        w.lastProblems = problems;
        if (result.skipped.length || result.errors.length) {
          logger.warn('Everyone notes skipped or failed', {
            worldId,
            skipped: result.skipped.map(s => `${s.path}: ${s.reason}`),
            errors: result.errors.map(e => `${e.path}: ${e.error}`),
          });
        }
      }
    } catch (error) {
      logger.warn('Everyone notes render failed', {
        worldId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
