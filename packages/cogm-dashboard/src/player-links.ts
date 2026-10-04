/**
 * Per-player links for the "My character" page (I-096): one random key per Foundry player
 * user and world, so a player opens `/me?k=<key>` and sees only the characters their user
 * owns. The GM makes, replaces or removes a player's link in the dashboard. Cloudflare Access
 * (I-022) can replace the key later without changing the page.
 *
 * Keys are 144 random bits (base64url), kept only on the dashboard's side (a JSON file in the
 * state folder, or in memory without one) and compared in constant time.
 */
import crypto from 'crypto';
import { promises as fsp, readFileSync } from 'fs';
import * as path from 'path';

export interface PlayerLink {
  userId: string;
  key: string;
  createdAt: string;
}

interface LinkFile {
  worlds: Record<string, Record<string, PlayerLink>>;
}

export interface PlayerLinkStoreLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

const USER_ID_RE = /^[A-Za-z0-9]{16}$/;
const KEY_RE = /^[A-Za-z0-9_-]{24}$/;

export function newPlayerKey(): string {
  return crypto.randomBytes(18).toString('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export class PlayerLinkStore {
  private readonly worlds = new Map<string, Map<string, PlayerLink>>();

  /** @param file the JSON file to keep the links in, or null to keep them in memory only */
  constructor(
    private readonly file: string | null,
    private readonly logger?: PlayerLinkStoreLogger
  ) {
    if (!file) return;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<LinkFile>;
      for (const [world, links] of Object.entries(parsed.worlds ?? {})) {
        const map = new Map<string, PlayerLink>();
        for (const link of Object.values(links ?? {})) {
          if (USER_ID_RE.test(link?.userId ?? '') && KEY_RE.test(link?.key ?? '')) {
            map.set(link.userId, link);
          }
        }
        this.worlds.set(world, map);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger?.warn('Player links file unreadable; starting without links', {
          file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** The world's links (user id to link). */
  list(worldId: string): PlayerLink[] {
    return [...(this.worlds.get(worldId)?.values() ?? [])];
  }

  /** The user whose key this is in the world, or null. */
  userFor(worldId: string, key: unknown): string | null {
    if (typeof key !== 'string' || !KEY_RE.test(key)) return null;
    let found: string | null = null;
    // Compare against every link (no early exit), each in constant time.
    for (const link of this.worlds.get(worldId)?.values() ?? []) {
      if (safeEqual(link.key, key)) found = link.userId;
    }
    return found;
  }

  /** Make a new link for a player, replacing an old one. */
  async create(worldId: string, userId: string, now = new Date()): Promise<PlayerLink> {
    if (!USER_ID_RE.test(userId)) throw new Error('Not a Foundry user id.');
    const link: PlayerLink = { userId, key: newPlayerKey(), createdAt: now.toISOString() };
    const map = this.worlds.get(worldId) ?? new Map<string, PlayerLink>();
    map.set(userId, link);
    this.worlds.set(worldId, map);
    await this.save();
    return link;
  }

  /** Remove a player's link; true when there was one. */
  async remove(worldId: string, userId: string): Promise<boolean> {
    const removed = this.worlds.get(worldId)?.delete(userId) ?? false;
    if (removed) await this.save();
    return removed;
  }

  private async save(): Promise<void> {
    if (!this.file) return;
    const data: LinkFile = { worlds: {} };
    for (const [world, map] of this.worlds) data.worlds[world] = Object.fromEntries(map);
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fsp.rename(tmp, this.file);
  }
}
