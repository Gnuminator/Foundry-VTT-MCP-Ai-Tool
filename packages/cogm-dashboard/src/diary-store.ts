/**
 * Character diaries (I-183, route A): the entries a player writes for their own character, kept
 * per world and per Foundry user in a JSON file in the dashboard's state folder (memory only
 * without one). Only the player's own private link reads or writes them; nothing here reaches
 * `/player`, the GM state stream or any other player's page.
 */
import crypto from 'crypto';
import { promises as fsp, readFileSync } from 'fs';
import * as path from 'path';

interface DiaryEntry {
  id: string;
  /** The character the entry is about (free text, as the player typed or Claude drafted it). */
  character: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

const DIARY_TEXT_MAX = 4000;
const DIARY_NAME_MAX = 80;
const DIARY_ENTRIES_MAX = 200;

const ID_RE = /^[A-Za-z0-9_-]{12}$/;
const USER_ID_RE = /^[A-Za-z0-9]{16}$/;

interface DiaryFile {
  worlds: Record<string, Record<string, DiaryEntry[]>>;
}

interface DiaryStoreLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

type DiarySaveResult =
  | { ok: true; entry: DiaryEntry }
  | { ok: false; code: 'empty' | 'too-long' | 'full' | 'not-found' | 'bad-id' };

export class DiaryStore {
  private readonly worlds = new Map<string, Map<string, DiaryEntry[]>>();
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string | null,
    private readonly logger?: DiaryStoreLogger
  ) {
    if (!file) return;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<DiaryFile>;
      for (const [world, users] of Object.entries(parsed.worlds ?? {})) {
        const map = new Map<string, DiaryEntry[]>();
        for (const [userId, entries] of Object.entries(users ?? {})) {
          if (!USER_ID_RE.test(userId) || !Array.isArray(entries)) continue;
          map.set(
            userId,
            entries.filter(
              e =>
                ID_RE.test(e?.id ?? '') &&
                typeof e.text === 'string' &&
                typeof e.character === 'string' &&
                typeof e.createdAt === 'string' &&
                typeof e.updatedAt === 'string'
            )
          );
        }
        this.worlds.set(world, map);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger?.warn('Diary file unreadable; starting without diaries', {
          file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** False without a state folder: the entries then vanish when the dashboard restarts. */
  get persistent(): boolean {
    return this.file !== null;
  }

  /** The player's entries, newest first. */
  list(worldId: string, userId: string): DiaryEntry[] {
    const entries = this.worlds.get(worldId)?.get(userId) ?? [];
    return [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Add an entry, or replace the text of the player's own entry when `id` is given. */
  save(
    worldId: string,
    userId: string,
    input: { id?: string; character?: unknown; text?: unknown }
  ): DiarySaveResult {
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text) return { ok: false, code: 'empty' };
    if (text.length > DIARY_TEXT_MAX) return { ok: false, code: 'too-long' };
    const character =
      typeof input.character === 'string' ? input.character.trim().slice(0, DIARY_NAME_MAX) : '';
    let users = this.worlds.get(worldId);
    if (!users) this.worlds.set(worldId, (users = new Map<string, DiaryEntry[]>()));
    const entries = users.get(userId) ?? [];
    const now = new Date().toISOString();
    let entry: DiaryEntry;
    if (input.id !== undefined) {
      if (!ID_RE.test(input.id)) return { ok: false, code: 'bad-id' };
      const found = entries.find(e => e.id === input.id);
      if (!found) return { ok: false, code: 'not-found' };
      found.text = text;
      found.character = character || found.character;
      found.updatedAt = now;
      entry = found;
    } else {
      if (entries.length >= DIARY_ENTRIES_MAX) return { ok: false, code: 'full' };
      entry = {
        id: crypto.randomBytes(9).toString('base64url'),
        character,
        text,
        createdAt: now,
        updatedAt: now,
      };
      entries.push(entry);
    }
    users.set(userId, entries);
    this.persist();
    return { ok: true, entry };
  }

  remove(worldId: string, userId: string, id: string): boolean {
    const users = this.worlds.get(worldId);
    const entries = users?.get(userId);
    if (!users || !entries) return false;
    const next = entries.filter(e => e.id !== id);
    if (next.length === entries.length) return false;
    users.set(userId, next);
    this.persist();
    return true;
  }

  private persist(): void {
    const file = this.file;
    if (!file) return;
    const out: DiaryFile = { worlds: {} };
    for (const [world, users] of this.worlds) {
      out.worlds[world] = Object.fromEntries(users);
    }
    const json = JSON.stringify(out);
    this.writing = this.writing
      .then(async () => {
        await fsp.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await fsp.writeFile(tmp, json, 'utf8');
        await fsp.rename(tmp, file);
      })
      .catch(error => {
        this.logger?.warn('Could not save the diaries', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  /** Resolves when the last write has finished (tests). */
  flush(): Promise<void> {
    return this.writing;
  }
}
