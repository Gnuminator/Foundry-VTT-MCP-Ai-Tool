/**
 * Handout reveal queue and seen log (I-039), bridge vault side.
 *
 * - The queue (`gm/handout-queue.json`) is GM prep: pages staged per scene,
 *   optionally for chosen players, revealed later in one click. Queueing
 *   changes nothing in Foundry and nothing players see, so it is written
 *   directly (like the play session markers), not as a guarded plan. The
 *   reveal of a queued page is a normal guarded reveal; its plan also removes
 *   the entry, so an undo puts the page back in the queue.
 * - The seen log (`gm/handouts-seen.json`) records which player opened which
 *   handout on /player (their self-picked name, D-065). It is written by the
 *   control method `record_handout_seen`, never by a tool, and holds page ids,
 *   user ids, names and times only.
 */
import type { VaultStore } from '../vault/store.js';
import type { WorldIdResolver } from '../vault/world-id.js';

export const QUEUE_FILE = 'handout-queue.json';
export const SEEN_FILE = 'handouts-seen.json';
/** A Foundry document id (users, scenes, pages). */
export const DOCUMENT_ID = /^[A-Za-z0-9]{16}$/;
const MAX_QUEUE = 100;
const MAX_NAME = 80;

/** One staged page, `entries.<entryId>` in the queue file. */
export interface QueueEntry {
  uuid: string;
  /** The scene the page belongs to (null: any scene). */
  sceneId: string | null;
  /** Reveal only to these users (Foundry user ids); absent: every player. */
  players?: string[];
  addedAt: string;
}

export interface QueueFile {
  entries?: Record<string, QueueEntry>;
}

/** Who opened a handout: `pages.<pageId>.<userId>`. */
export interface SeenFile {
  pages?: Record<string, Record<string, { name: string; at: string }>>;
}

export interface SeenEntry {
  userId: string;
  name: string;
  at: string;
}

/** Queue entries oldest first (the order the GM staged them). */
export function orderedQueue(file: QueueFile): Array<[string, QueueEntry]> {
  return Object.entries(file.entries ?? {}).sort(([, a], [, b]) =>
    a.addedAt === b.addedAt ? 0 : a.addedAt < b.addedAt ? -1 : 1
  );
}

/** Check a players list: Foundry user ids, no duplicates; empty means every player. */
export function assertPlayers(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every(v => typeof v === 'string' && DOCUMENT_ID.test(v))) {
    throw new Error('players must be a list of Foundry user ids');
  }
  const unique = [...new Set(value as string[])];
  return unique.length > 0 ? unique : undefined;
}

export interface HandoutQueueOptions {
  store: VaultStore;
  worldIds: Pick<WorldIdResolver, 'current'>;
  now?: () => number;
  newId: () => string;
}

export class HandoutQueue {
  private readonly store: VaultStore;
  private readonly worldIds: HandoutQueueOptions['worldIds'];
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(options: HandoutQueueOptions) {
    this.store = options.store;
    this.worldIds = options.worldIds;
    this.now = options.now ?? ((): number => Date.now());
    this.newId = options.newId;
  }

  async load(worldId?: string): Promise<QueueFile> {
    const id = worldId ?? (await this.worldIds.current());
    return (await this.store.read<QueueFile>(id, 'gm', QUEUE_FILE))?.data ?? {};
  }

  /** Stage a page; a page already queued gets its scene and players replaced. */
  async add(
    uuid: string,
    sceneId: string | null,
    players: string[] | undefined
  ): Promise<{ entryId: string; entry: QueueEntry; replaced: boolean }> {
    const worldId = await this.worldIds.current();
    let result: { entryId: string; entry: QueueEntry; replaced: boolean } | null = null;
    await this.store.update<QueueFile>(worldId, 'gm', QUEUE_FILE, 1, current => {
      const entries = { ...(current?.data?.entries ?? {}) };
      const existing = Object.entries(entries).find(([, e]) => e.uuid === uuid);
      if (!existing && Object.keys(entries).length >= MAX_QUEUE) {
        throw new Error(`The handout queue is full (${MAX_QUEUE} pages)`);
      }
      const entryId = existing?.[0] ?? this.newId();
      const entry: QueueEntry = {
        uuid,
        sceneId,
        ...(players ? { players } : {}),
        addedAt: existing?.[1].addedAt ?? new Date(this.now()).toISOString(),
      };
      entries[entryId] = entry;
      result = { entryId, entry, replaced: existing !== undefined };
      return { ...(current?.data ?? {}), entries };
    });
    return result!;
  }

  /** Remove a page from the queue; false when it was not queued. */
  async remove(uuid: string): Promise<boolean> {
    const worldId = await this.worldIds.current();
    let removed = false;
    await this.store.update<QueueFile>(worldId, 'gm', QUEUE_FILE, 1, current => {
      const entries = { ...(current?.data?.entries ?? {}) };
      for (const [id, e] of Object.entries(entries)) {
        if (e.uuid !== uuid) continue;
        delete entries[id];
        removed = true;
      }
      return { ...(current?.data ?? {}), entries };
    });
    return removed;
  }

  /** The seen log for every page. */
  async seen(worldId?: string): Promise<Record<string, SeenEntry[]>> {
    const id = worldId ?? (await this.worldIds.current());
    const file = (await this.store.read<SeenFile>(id, 'gm', SEEN_FILE))?.data ?? {};
    const out: Record<string, SeenEntry[]> = {};
    for (const [pageId, users] of Object.entries(file.pages ?? {})) {
      out[pageId] = Object.entries(users)
        .map(([userId, v]) => ({ userId, name: v.name, at: v.at }))
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    }
    return out;
  }

  /** Record the first time a player opened a handout (later opens keep the first time). */
  async markSeen(pageId: string, userId: string, name: string): Promise<{ recorded: boolean }> {
    if (!DOCUMENT_ID.test(pageId) || !DOCUMENT_ID.test(userId)) {
      throw new Error('pageId and userId must be Foundry document ids');
    }
    const cleanName = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) || 'Player';
    const worldId = await this.worldIds.current();
    let recorded = false;
    await this.store.update<SeenFile>(worldId, 'gm', SEEN_FILE, 1, current => {
      const pages = { ...(current?.data?.pages ?? {}) };
      const users = { ...(pages[pageId] ?? {}) };
      if (!users[userId]) {
        users[userId] = { name: cleanName, at: new Date(this.now()).toISOString() };
        recorded = true;
      }
      pages[pageId] = users;
      return { ...(current?.data ?? {}), pages };
    });
    return { recorded };
  }
}
