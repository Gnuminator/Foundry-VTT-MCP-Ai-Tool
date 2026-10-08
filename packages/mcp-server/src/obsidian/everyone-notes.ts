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
 * note is left alone and simply stops being updated), but apart from the Obsidian export
 * (`export.ts`): its own folder, its own debounce, no link conventions of its own. Text from
 * Foundry is escaped (`md-escape.ts`). Only whole days are rendered (`byDay`): a day the history
 * no longer holds in full is not touched, so its note stays as it was last written, and when today
 * may be missing changes, the items its note holds that the history lost are carried over from
 * the note (`carriedBlocks`); nothing is deleted.
 * Re-rendered shortly after the change-journal pump appended records or a guarded write was
 * applied or undone, when `FOUNDRY_AI_OBSIDIAN_DIR` names the GM's vault.
 */
import { promises as fsp } from 'fs';
import * as path from 'path';

import type { ChangeDay, ChangeListItem } from '../change-history.js';
import type { Logger } from '../logger.js';

import { escapeInlineText, escapeLineStart } from './md-escape.js';
import { campaignDir, NoteWriter, type WrittenCache } from './note-writer.js';
import { checkMarkdownOwnership, withGeneratedHash } from './ownership.js';
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
  if (item.kind === 'ai') return item.requestedBy ? `AI, asked by ${item.requestedBy}` : 'AI';
  // A player who goes by the AI's own name is told apart from it (`carriedBlocks` reads it back).
  const name = isAiName(item.by) && !item.isGM ? `${item.by} (player)` : item.by;
  return `${name}${item.isGM ? ' (GM)' : ''}`;
}

/** The `who` text of an AI item. */
function isAiName(text: string): boolean {
  return text === 'AI' || text.startsWith('AI, asked by ');
}

/**
 * Text from Foundry (names, summaries, lines) as inert Markdown (the O4 rule, `md-escape.ts`), on
 * one line: a newline in a name would break the list item, and the middle dot is the head's
 * separator, so one in a name or summary is written as its entity.
 */
function esc(text: string): string {
  return escapeInlineText(text.replace(/[\r\n]+/g, ' ')).replace(/·/g, '&middot;');
}

/** The text back from `esc`, for the `people` property (the head of a carried block holds it escaped). */
function unesc(text: string): string {
  return text
    .replace(/\\(.)/g, '$1')
    .replace(/&middot;/g, '·')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/** A `people` value: a plain name, never a link (`[[x]]` in a property is a graph link). */
function personName(name: string): string {
  return name.replace(/[[\]]/g, '');
}

/** A list item of an existing note, kept when the history no longer holds the change (`carriedBlocks`). */
export interface CarriedBlock {
  /** The block id (`^id` at the head's end). */
  id: string;
  /** `HH:MM` from the head, for the order. */
  time: string;
  who: string;
  /** The summary as written (escaped), to tell a renamed copy of a fresh item. */
  summary: string;
  isAi: boolean;
  undone: boolean;
  /** The head line and the lines below it, as they were. */
  text: string[];
}

const BLOCK_HEAD = /^- \*\*(\d\d:\d\d|\?\?:\?\?)\*\* (.*) \^([A-Za-z0-9-]+)$/;

/**
 * The list items of a note this renderer wrote, read back. For a day that may be missing changes
 * (the audit ring full, records lost), the items the history no longer holds are carried over
 * from the note, which may be their only copy.
 */
export function carriedBlocks(noteText: string): CarriedBlock[] {
  const blocks: CarriedBlock[] = [];
  let current: CarriedBlock | null = null;
  for (const line of noteText.split('\n')) {
    const head = BLOCK_HEAD.exec(line);
    if (head) {
      // `esc` writes a middle dot inside a name or summary as `&middot;`, so the separators
      // are the only ` · ` in the head: who, the summary, then the undone state if any.
      const [whoText, summary = ''] = head[2].split(' · ');
      current = {
        id: head[3],
        time: head[1],
        who: unesc(whoText),
        summary,
        isAi: isAiName(whoText),
        undone: head[2].includes(' · undone'),
        text: [line],
      };
      blocks.push(current);
    } else if (current && line.startsWith('  - ')) {
      current.text.push(line);
    } else {
      current = null;
    }
  }
  return blocks;
}

/**
 * A block of the existing note is the fresh item `c`, so it is not carried beside it: the same
 * id, or an id that regrouping lengthened or shortened (`act:x` beside `act:x:own` when a
 * person's records were split from an AI burst on a later render), or the same minute and
 * summary under a new id by the same person, or with the AI on one side (the attribution
 * changed). Two people who made the same change in one minute are two items.
 */
function sameItem(block: CarriedBlock, c: ChangeListItem): boolean {
  const id = blockId(c.id);
  return (
    block.id === id ||
    id.startsWith(`${block.id}-`) ||
    block.id.startsWith(`${id}-`) ||
    (block.time === clock(c.at) &&
      block.summary === esc(c.summary) &&
      (block.who === unesc(esc(who(c))) || block.isAi || c.kind === 'ai'))
  );
}

/**
 * How the change was undone. An AI change carries who and when. A person's change only knows the
 * id of the undo entry: it is looked up among the day's changes (the undo is an AI change made
 * for someone), else the undo lies on another day.
 */
function state(item: ChangeListItem, byId: ReadonlyMap<string, ChangeListItem>): string {
  if (!item.undone) return '';
  if (item.kind === 'ai') {
    const when = item.undoneAt ? ` ${clock(item.undoneAt)}` : '';
    return ` · undone${when}${item.undoneBy ? ` by ${esc(item.undoneBy)}` : ''}`;
  }
  const undo = item.undoneBy ? byId.get(item.undoneBy) : undefined;
  if (undo?.kind !== 'ai') return ' · undone later';
  return ` · undone ${clock(undo.at)} by ${esc(undo.requestedBy ?? 'AI')}`;
}

/** One change as a list item with its lines below (left out when the summary says it all). */
function renderItem(item: ChangeListItem, byId: ReadonlyMap<string, ChangeListItem>): string[] {
  const head = `- **${clock(item.at)}** ${esc(who(item))} · ${esc(item.summary)}${state(item, byId)} ^${blockId(item.id)}`;
  const lines = item.lines.filter(line => line !== item.summary);
  if (item.lines.length <= 1 || lines.length === 0) return [head];
  return [head, ...item.lines.map(line => `  - ${escapeLineStart(esc(line))}`)];
}

/**
 * The note of one day. `carried` are the items of the existing note the history no longer holds
 * (a day that may be missing changes); they keep their place by time, before a new item of the
 * same minute.
 */
export function renderEveryoneNote(
  worldId: string,
  day: ChangeDay,
  carried: CarriedBlock[] = []
): string {
  const changes = day.changes;
  const byId = new Map(changes.map(c => [c.id, c]));
  const blocks = [
    ...carried.map(b => ({ time: b.time, text: b.text })),
    ...changes.map(c => ({ time: clock(c.at), text: renderItem(c, byId) })),
  ].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  const people = [
    ...new Set([...changes.map(who), ...carried.map(b => b.who)].map(personName)),
  ].sort();
  const count = (
    ofChange: (c: ChangeListItem) => boolean,
    ofBlock: (b: CarriedBlock) => boolean
  ): number => changes.filter(ofChange).length + carried.filter(ofBlock).length;
  const partial =
    day.incompleteBefore !== undefined
      ? [
          `Changes before ${clock(new Date(day.incompleteBefore).toISOString())} may be missing: the bridge's change history is only complete from then.`,
          '',
        ]
      : [];
  const newest = changes.reduce<string | null>(
    (max, c) => (max === null || c.at > max ? c.at : max),
    null
  );
  const props = generatedProps(
    'everyone-changes',
    worldId,
    {
      date: day.date,
      changes: blocks.length,
      by_people: count(
        c => c.kind === 'human',
        b => !b.isAi
      ),
      by_ai: count(
        c => c.kind === 'ai',
        b => b.isAi
      ),
      undone: count(
        c => c.undone,
        b => b.undone
      ),
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
      ...partial,
      ...blocks.flatMap(b => b.text),
      '',
    ].join('\n')
  );
}

export interface EveryoneNotesOptions {
  /** `byDay` gives null when `worldId` is not the current world (the history reads that one). */
  changeHistory: { byDay(worldId: string): Promise<ChangeDay[] | null> };
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
    const { vaultDir, changeHistory, logger } = this.options;
    const root = campaignDir(vaultDir, worldId);
    const writer = new NoteWriter(root, path.resolve(vaultDir), worldId, w.cache);
    const result = {
      written: writer.written,
      unchanged: writer.unchanged,
      skipped: writer.skipped,
      errors: writer.errors,
    };
    // The history reads the current world: a render scheduled for another world (the GM
    // switched worlds inside the debounce) must not land in that world's folder.
    const days = await changeHistory.byDay(worldId);
    if (days === null) {
      logger.info('Everyone notes skipped: not the current world', { worldId });
      return result;
    }
    await writer.assertRealFence(EVERYONE_FOLDER);
    for (const day of days) {
      const relPath = everyoneNotePath(day.date);
      // A day that may be missing changes keeps the items its note already holds and the history
      // does not any more: the note may be their only copy (the journal's records are gone, the
      // AI ring moved on).
      let carried: CarriedBlock[] = [];
      if (day.incompleteBefore !== undefined) {
        const existing = await fsp.readFile(path.join(root, relPath), 'utf8').catch(() => null);
        if (existing !== null && checkMarkdownOwnership(existing).owned) {
          carried = carriedBlocks(existing).filter(b => !day.changes.some(c => sameItem(b, c)));
        }
      }
      await writer.owned(
        relPath,
        renderEveryoneNote(worldId, day, carried),
        checkMarkdownOwnership
      );
    }
    return result;
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
