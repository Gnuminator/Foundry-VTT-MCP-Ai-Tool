import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import type { CharacterSheet, PlayerHandout } from '@gnuminator/shared';

import type { SessionEvent } from '../feed/types.js';
import type { Logger } from '../logger.js';
import { projectEvent } from '../player/projection.js';
import type { ThemeId } from '../theme.js';

import type { PlayerLogStore } from './log-store.js';
import { renderPlayerVault } from './render.js';
import type { PlayerVaultInput, VaultPlayer } from './types.js';
import { writePlayerVault } from './writer.js';

/** The most events the one-time backfill asks the bridge for (`get-session-log`). */
export const PLAYER_VAULT_BACKFILL_LIMIT = 1000;

/** Events seen before the world is known are held here, at most this many. */
const PENDING_LIMIT = 1000;

/** The design plugin's built theme snippets, next to this package in the repo and the installer. */
export const DEFAULT_SNIPPET_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'obsidian-plugin',
  'dist',
  'snippets'
);

/** The bridge calls the service needs (the MCP control client satisfies it). */
export interface PlayerVaultClient {
  callTool<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
  characterSheet?(userId: string): Promise<unknown>;
  readonly isConnected?: boolean;
}

export interface PlayerVaultServiceOptions {
  /** `FOUNDRY_AI_PLAYER_VAULTS_DIR`: one folder per player below it. */
  rootDir: string;
  intervalMs: number;
  client: PlayerVaultClient;
  logger: Logger;
  store: PlayerLogStore;
  /** The current world, or null while Foundry is not connected. */
  world: () => { id: string; title: string } | null;
  /** The world's players (non-GM users), e.g. `PlayerDirectory.list()`. */
  players: () => VaultPlayer[];
  /** Refresh the player list from the bridge when it is old. */
  refreshPlayers?: () => Promise<void>;
  /** Revealed handouts, already sanitized (`PlayerViewSource.handouts`). */
  handouts: () => PlayerHandout[];
  theme: (worldId: string) => ThemeId;
  /** Folder with `aitool-theme-<id>.css`; default {@link DEFAULT_SNIPPET_DIR}. */
  snippetDir?: string;
}

/** What one rebuild did, for logs and tests. */
export interface PlayerVaultRebuild {
  written: string[];
  unchanged: string[];
  failed: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * O7 player vaults (vault `Design/O7 player vault design 2026-10-06.md`): keeps one Obsidian vault
 * per player current under `rootDir`, one way. Inputs are only what that player may already see:
 * revealed handouts (a recap is a revealed handout; the session-notes journal is never read),
 * the sheets of characters the player owns (`character_sheet`), and the public session log
 * (events through `projectEvent`, stored by {@link PlayerLogStore}). A player's folder is
 * rewritten only when its inputs changed.
 */
export class PlayerVaultService {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<PlayerVaultRebuild> | null = null;
  private readonly lastHash = new Map<string, string>();
  private readonly backfilled = new Set<string>();
  private pending: SessionEvent[] = [];

  constructor(private readonly options: PlayerVaultServiceOptions) {}

  /** Feed events (from the polling feed); only their player projection is kept. */
  onEvents(events: SessionEvent[]): void {
    const world = this.options.world();
    if (!world) {
      this.pending = [...this.pending, ...events].slice(-PENDING_LIMIT);
      return;
    }
    this.store(world.id, events);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.rebuild(), this.options.intervalMs);
    this.timer.unref();
    void this.rebuild();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over every player; concurrent calls share the pass in flight. */
  rebuild(): Promise<PlayerVaultRebuild> {
    if (!this.running) {
      this.running = this.rebuildOnce().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private store(worldId: string, events: SessionEvent[]): void {
    const projected = events.map(projectEvent).filter(e => e !== null);
    if (projected.length > 0) this.options.store.append(worldId, projected);
  }

  private async rebuildOnce(): Promise<PlayerVaultRebuild> {
    const result: PlayerVaultRebuild = { written: [], unchanged: [], failed: [] };
    const { client, logger } = this.options;
    const world = this.options.world();
    if (!world || client.isConnected === false) return result;

    if (this.pending.length > 0) {
      this.store(world.id, this.pending);
      this.pending = [];
    }
    await this.backfill(world.id);
    await this.options.refreshPlayers?.().catch(() => undefined);

    const theme = this.options.theme(world.id);
    const css = this.snippet(theme);
    const sessions = this.options.store.sessions(world.id);
    const handouts = this.options.handouts();

    for (const player of this.options.players()) {
      try {
        const sheets = await this.sheets(player.userId);
        if (sheets === null) {
          // Keep the folder as it is rather than write a vault without the character.
          result.failed.push(player.name);
          continue;
        }
        const input: PlayerVaultInput = {
          worldTitle: world.title,
          player,
          handouts: handouts.filter(h => !h.players || h.players.includes(player.userId)),
          sheets,
          sessions,
          theme: { id: theme, css },
        };
        const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
        const key = `${world.id}\u0000${player.userId}`;
        if (this.lastHash.get(key) === hash) {
          result.unchanged.push(player.name);
          continue;
        }
        await writePlayerVault(this.options.rootDir, player, renderPlayerVault(input), logger);
        this.lastHash.set(key, hash);
        result.written.push(player.name);
      } catch (error) {
        result.failed.push(player.name);
        logger.warn('Player vault not written', { player: player.name, error: errorText(error) });
      }
    }
    if (result.written.length > 0) {
      logger.info('Player vaults updated', { written: result.written.length });
    }
    return result;
  }

  /** Once per world and process: the current session's events from the bridge. */
  private async backfill(worldId: string): Promise<void> {
    if (this.backfilled.has(worldId)) return;
    try {
      const raw = await this.options.client.callTool('get-session-log', {
        limit: PLAYER_VAULT_BACKFILL_LIMIT,
      });
      const events = asRecord(raw)?.events;
      if (Array.isArray(events)) this.store(worldId, events as SessionEvent[]);
      this.backfilled.add(worldId);
    } catch (error) {
      this.options.logger.warn('Player vault: session log backfill failed, retrying later', {
        error: errorText(error),
      });
    }
  }

  /** The player's own sheets, or null when the bridge could not answer. */
  private async sheets(userId: string): Promise<CharacterSheet[] | null> {
    const { client } = this.options;
    if (typeof client.characterSheet !== 'function') return [];
    try {
      const record = asRecord(await client.characterSheet(userId));
      if (!record || record.userId !== userId || !Array.isArray(record.sheets)) return null;
      return record.sheets as CharacterSheet[];
    } catch {
      return null;
    }
  }

  private snippet(theme: ThemeId): string | null {
    const dir = this.options.snippetDir ?? DEFAULT_SNIPPET_DIR;
    try {
      const css = readFileSync(path.join(dir, `aitool-theme-${theme}.css`), 'utf8');
      return css.trim() === '' ? null : css;
    } catch {
      return null;
    }
  }
}
